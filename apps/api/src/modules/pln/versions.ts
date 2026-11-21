// Draft authoring routes of API-16: version read / fields, rules, transitions, diff, guardrail evaluation and
// acknowledgement. Every draft write needs If-Match (412 / 428), recompiles the version (D-B3-02) and moves its revision.
import { ruleDependencies, rulePass, validateRule, type RuleKind } from '@nmp/engine'
import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { acknowledgeDecision, evaluateGuardrails, restoreEvaluations, type Evaluation } from '../cpl/index.js'
import { assertDraft, assertRevision, etag, ifMatch, loadPlan, loadVersion, planVersionFor, sqlState, versionParams } from './access.js'
import { recompile, ruleRows, ruleView, validationView, type RuleRow } from './content.js'
import { diffView, versionFields, versionView } from './views.js'

const RULE_KEY = /^[a-z][a-z0-9_]{0,63}$/
const STATE_ITEM = /^(title|paid_as|carry|counter|one_time|banked)\.([a-z0-9_]+|\*)$/
const ruleParams = versionParams.extend({ ruleKey: z.string().regex(RULE_KEY) })
const transitionParams = versionParams.extend({ stateItem: z.string().regex(STATE_ITEM) })
const decisionParams = versionParams.extend({ decisionId: z.uuid() })
const ruleBody = z.strictObject({
  kind: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()),
  reversal_policy: z.enum(['order_line', 'restatement']).nullable().optional(),
  calendar_id: z.uuid().nullable().optional(),
  ordinal: z.number().int().min(-1000).max(1000).optional(),
  credit_type_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/).nullable().optional(),
})
const transitionBody = z.strictObject({
  rule: z.enum(['carry', 'map', 'reset']),
  map: z.array(z.strictObject({ from: z.string().min(1).max(64), to: z.string().min(1).max(64) })).max(100).optional(),
  reason: z.string().trim().min(1).max(500).nullable().optional(),
})
/** The engine refuses a mapped rank its ladder does not define (rank.ts priorIndex): every `to` is a rank of this version. */
async function assertMapTargets(tx: Tx, versionId: string, ladderKey: string, map: readonly { readonly to: string }[]): Promise<void> {
  const ranks = (await ruleRows(tx, versionId))
    .filter((r) => r.kind === 'ladder' && (ladderKey === '*' || r.rule_key === ladderKey))
    .flatMap((r) => (r.params.ranks as readonly { readonly key: string }[]).map((rank) => rank.key))
  const issues = map.flatMap((m, i) => (ranks.includes(m.to) ? [] : [{ path: `map[${i}].to`, message: `${m.to} is not a rank of ${ladderKey === '*' ? 'any ladder' : `ladder ${ladderKey}`} of this version` }]))
  if (issues.length > 0) throw new ApiError(422, 'VALIDATION_FAILED', 'A map transition maps to ranks of this version.', { issues })
}

const patchBody = z.strictObject({
  effective_from: z.iso.datetime({ offset: true }).nullable().optional(),
  justification: z.string().trim().min(1).max(2000).nullable().optional(),
  crediting_event: z.enum(['paid', 'fulfilled']).nullable().optional(),
  placement_width: z.number().int().min(2).max(20).nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, 'send at least one field')
const diffQuery = z.strictObject({ against: z.coerce.number().int().min(1).max(1_000_000) })

const newDecisions = (evaluations: readonly Evaluation[]): Record<string, unknown>[] =>
  evaluations.filter((e) => e.created).map((e) => ({ id: e.id, rule_id: e.rule_id, title: e.title, outcome: e.outcome, overridable: e.overridable, detail: e.detail }))

/** A rule's configured content, recorded before and after every write so the audit can reconstruct reverted values. */
const RULE_CONTENT = 'kind, params, reversal_policy, calendar_id, ordinal'

const calendarError = (error: unknown): never => {
  if (sqlState(error) === '23514' || sqlState(error) === '23503') throw new ApiError(422, 'CALENDAR_NOT_IN_PLAN', 'The calendar is not a calendar of the plan.')
  throw error
}

const invalid = (path: string, message: string): ApiError => new ApiError(422, 'VALIDATION_FAILED', 'The request is not valid.', { issues: [{ path, message }] })

/**
 * D-V1A-03: the stored params of a rule write. A pay rule's credit_type_code becomes the engine's `award` (so the
 * compiled plan and content_hash carry it); `award` itself is never written directly.
 */
function storedParams(body: z.infer<typeof ruleBody>): Record<string, unknown> {
  if (Object.hasOwn(body.params, 'award')) throw invalid('params.award', 'set credit_type_code instead')
  const code = body.credit_type_code ?? null
  if (code === null) return body.params
  if (!body.kind.startsWith('pay.')) throw invalid('credit_type_code', 'only pay rules can pay in credits')
  return { ...body.params, award: { creditType: code } }
}

/** 422 CREDIT_TYPE_UNKNOWN / CREDIT_TYPE_INACTIVE for the credit type a pay rule names. */
async function assertCreditType(tx: Tx, code: string | null | undefined): Promise<void> {
  if (code == null) return
  const { rows } = await tx.query<{ active: boolean }>('SELECT active FROM credit_type WHERE code = $1', [code])
  if (rows[0] === undefined) throw new ApiError(422, 'CREDIT_TYPE_UNKNOWN', 'No credit type has this code.', { credit_type_code: code })
  if (!rows[0].active) throw new ApiError(422, 'CREDIT_TYPE_INACTIVE', 'The credit type is not active.', { credit_type_code: code })
}

function withEtag<T>(reply: FastifyReply, revision: number, body: T): T {
  reply.header('etag', etag(revision))
  return body
}

export function registerVersionRoutes(app: FastifyInstance): void {
  const base = '/v1/plans/:id/versions/:v'
  const read = { preHandler: [requireRealm('tenant'), requirePermission('plan.read')] }
  const edit = { preHandler: [requireRealm('tenant'), requirePermission('plan.edit')] }

  app.get(base, read, async (request, reply) => {
    const params = parse(versionParams, request.params)
    return inTenant(request, async (tx) => {
      const plan = await loadPlan(tx, request, params.id, 'plan.read')
      const version = await loadVersion(tx, plan.id, params.v)
      return withEtag(reply, version.revision, envelope(await versionView(tx, plan, version)))
    })
  })

  app.patch(base, edit, async (request, reply) => {
    const expected = ifMatch(request)
    const body = parse(patchBody, request.body)
    return inTenant(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.edit')
      assertRevision(version, expected)
      const set = (name: keyof typeof body): unknown => (Object.hasOwn(body, name) ? body[name] : version[name])
      await tx.query(
        `UPDATE plan_version SET effective_from = $2, justification = $3, crediting_event = $4, placement_width = $5 WHERE id = $1`,
        [version.id, set('effective_from'), set('justification'), set('crediting_event'), set('placement_width')],
      )
      // Recompiled (and the revision moved on) because placement_width takes part in validation (D-B4-21 a).
      const { validation } = await recompile(tx, { ...version, placement_width: set('placement_width') as number | null }, plan.calendar_ids)
      const fields = Object.keys(body).sort() as (keyof typeof body)[]
      await recordAudit(tx, {
        action: 'PLAN_VERSION.UPDATED', objectType: 'plan_version', objectId: version.id,
        before: Object.fromEntries(fields.map((name) => [name, version[name]])),
        after: { fields, values: Object.fromEntries(fields.map((name) => [name, body[name]])) },
      })
      const updated = await loadVersion(tx, version.plan_id, version.version)
      return withEtag(reply, updated.revision, envelope({ ...versionFields(updated), validation: validationView(validation) }))
    })
  })

  app.get(`${base}/diff`, read, async (request) => {
    const params = parse(versionParams, request.params)
    const query = parse(diffQuery, request.query)
    return inTenant(request, async (tx) => {
      const plan = await loadPlan(tx, request, params.id, 'plan.read')
      return envelope(await diffView(tx, plan, await loadVersion(tx, plan.id, params.v), await loadVersion(tx, plan.id, query.against)))
    })
  })

  // FR-PLN-002/FR-CPL-007: save one rule; a blocked, non-overridable guardrail match refuses it but its decision commits.
  app.put(`${base}/rules/:ruleKey`, edit, async (request, reply) => {
    const expected = ifMatch(request)
    const { ruleKey } = parse(ruleParams, request.params)
    const body = parse(ruleBody, request.body)
    const params = storedParams(body)
    const issues = validateRule(body.kind, params)
    if (issues.length > 0) throw new ApiError(422, 'RULE_INVALID', 'The rule parameters are not valid.', { errors: issues })
    const outcome = await inTenant(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.edit')
      assertRevision(version, expected)
      await assertCreditType(tx, body.credit_type_code)
      const { rows: prior } = await tx.query(`SELECT ${RULE_CONTENT} FROM plan_rule WHERE plan_version_id = $1 AND rule_key = $2`, [version.id, ruleKey])
      await tx.query('SAVEPOINT rule_save')
      const input = { ruleKey, kind: body.kind, params, reversalPolicy: body.reversal_policy ?? null, calendarId: body.calendar_id ?? null, ordinal: body.ordinal ?? 0 }
      const { rows } = await tx.query<RuleRow & { id: string; inserted: boolean }>(
        `INSERT INTO plan_rule (tenant_id, plan_version_id, rule_key, kind, pass, params, depends_on, reversal_policy, calendar_id, ordinal, created_by, updated_by)
         VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, app_user_id(), app_user_id())
         ON CONFLICT (plan_version_id, rule_key) DO UPDATE SET kind = EXCLUDED.kind, pass = EXCLUDED.pass, params = EXCLUDED.params,
           depends_on = EXCLUDED.depends_on, reversal_policy = EXCLUDED.reversal_policy, calendar_id = EXCLUDED.calendar_id,
           ordinal = EXCLUDED.ordinal, updated_by = app_user_id(), updated_at = now()
         RETURNING id, rule_key, kind, pass, params, depends_on, reversal_policy, calendar_id, ordinal, created_by, updated_by, xmax = 0 AS inserted`,
        [version.id, ruleKey, body.kind, rulePass(body.kind as RuleKind), params, ruleDependencies(input), input.reversalPolicy, input.calendarId, input.ordinal],
      ).catch(calendarError)
      const { validation, revision } = await recompile(tx, version, plan.calendar_ids)
      const evaluations = await evaluateGuardrails(tx, version.id)
      // An opaque block is saved and goes to compliance review (D-B4-21 b); only a checked non-overridable block refuses.
      const refuses = (e: Evaluation): boolean => e.outcome === 'blocked' && !e.overridable && !e.detail.opaque
      const blocking = evaluations.find((e) => refuses(e) && e.detail.rule_keys.includes(ruleKey))
      if (blocking !== undefined) {
        await tx.query('ROLLBACK TO SAVEPOINT rule_save')
        await restoreEvaluations(tx, version.id, evaluations.filter(refuses))
        return { blocking } as const
      }
      const rule = rows[0]!
      await recordAudit(tx, {
        action: 'PLAN_RULE.SAVED', objectType: 'plan_rule', objectId: rule.id, before: prior[0] ?? null,
        after: {
          plan_version_id: version.id, rule_key: ruleKey, kind: rule.kind, params: rule.params, reversal_policy: rule.reversal_policy,
          calendar_id: rule.calendar_id, ordinal: rule.ordinal, created: rule.inserted, revision,
        },
      })
      return { rule, validation, revision, evaluations, minorDigits: plan.minor_digits, blocking: undefined }
    })
    if (outcome.blocking !== undefined) {
      const b = outcome.blocking
      throw new ApiError(422, 'GUARDRAIL_BLOCKED', 'A guardrail of this market blocks the rule, so it was not saved.', {
        decision_id: b.id, rule_id: b.rule_id, title: b.title, explanation: b.detail.explanation, basis_status: b.basis_status,
      })
    }
    return withEtag(reply, outcome.revision, envelope({ rule: ruleView(outcome.rule, outcome.minorDigits), validation: validationView(outcome.validation), guardrails: { new_decisions: newDecisions(outcome.evaluations) } }))
  })

  app.delete(`${base}/rules/:ruleKey`, edit, async (request, reply) => {
    const expected = ifMatch(request)
    const { ruleKey } = parse(ruleParams, request.params)
    const revision = await inTenant(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.edit')
      assertRevision(version, expected)
      const { rows } = await tx.query<{ id: string } & Record<string, unknown>>(
        `DELETE FROM plan_rule WHERE plan_version_id = $1 AND rule_key = $2 RETURNING id, ${RULE_CONTENT}`, [version.id, ruleKey])
      if (rows[0] === undefined) throw notFound()
      const { id: ruleId, ...content } = rows[0]
      const recompiled = await recompile(tx, version, plan.calendar_ids)
      await evaluateGuardrails(tx, version.id)
      await recordAudit(tx, { action: 'PLAN_RULE.DELETED', objectType: 'plan_rule', objectId: ruleId, before: { plan_version_id: version.id, rule_key: ruleKey, ...content } })
      return recompiled.revision
    })
    return reply.header('etag', etag(revision)).code(204).send()
  })

  app.put(`${base}/transitions/:stateItem`, edit, async (request, reply) => {
    const expected = ifMatch(request)
    const { stateItem } = parse(transitionParams, request.params)
    const body = parse(transitionBody, request.body)
    if (body.rule === 'reset' && (body.reason ?? null) === null) throw new ApiError(422, 'VALIDATION_FAILED', 'A reset transition needs a reason.', { issues: [{ path: 'reason', message: 'required for reset' }] })
    if (body.rule === 'map' && (body.map ?? []).length === 0) throw new ApiError(422, 'VALIDATION_FAILED', 'A map transition lists at least one mapping.', { issues: [{ path: 'map', message: 'required for map' }] })
    const [itemKind, ladderKey] = stateItem.split('.') as [string, string]
    if (body.rule === 'map' && itemKind !== 'title' && itemKind !== 'paid_as') throw new ApiError(422, 'VALIDATION_FAILED', 'Only title and paid-as ranks are mapped.', { issues: [{ path: 'rule', message: 'map applies to title.* and paid_as.* items only' }] })
    return inTenant(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.edit')
      assertRevision(version, expected)
      if (body.rule === 'map') await assertMapTargets(tx, version.id, ladderKey, body.map!)
      const { rows } = await tx.query(
        `INSERT INTO plan_transition (tenant_id, to_version_id, state_item, rule, map, reason, created_by)
         VALUES (app_tenant_id(), $1, $2, $3, $4, $5, app_user_id())
         ON CONFLICT (to_version_id, state_item) DO UPDATE SET rule = EXCLUDED.rule, map = EXCLUDED.map, reason = EXCLUDED.reason, created_by = app_user_id()
         RETURNING state_item, rule, map, reason`,
        [version.id, stateItem, body.rule, JSON.stringify(body.map ?? []), body.reason ?? null],
      )
      const { validation, revision } = await recompile(tx, version, plan.calendar_ids)
      await recordAudit(tx, { action: 'PLAN_TRANSITION.SAVED', objectType: 'plan_version', objectId: version.id, after: { state_item: stateItem, rule: body.rule, revision } })
      return withEtag(reply, revision, envelope({ transition: rows[0], validation: validationView(validation) }))
    })
  })

  app.delete(`${base}/transitions/:stateItem`, edit, async (request, reply) => {
    const expected = ifMatch(request)
    const { stateItem } = parse(transitionParams, request.params)
    const revision = await inTenant(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.edit')
      assertRevision(version, expected)
      const { rowCount } = await tx.query('DELETE FROM plan_transition WHERE to_version_id = $1 AND state_item = $2', [version.id, stateItem])
      if (rowCount !== 1) throw notFound()
      const recompiled = await recompile(tx, version, plan.calendar_ids)
      await recordAudit(tx, { action: 'PLAN_TRANSITION.DELETED', objectType: 'plan_version', objectId: version.id, before: { state_item: stateItem } })
      return recompiled.revision
    })
    return reply.header('etag', etag(revision)).code(204).send()
  })

  app.post(`${base}/guardrails/evaluate`, edit, async (request, reply) => {
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { version } = await planVersionFor(tx, request, 'plan.edit', false)
      assertDraft(version)
      return { statusCode: 200, body: envelope({ new_decisions: newDecisions(await evaluateGuardrails(tx, version.id)) }) }
    }))
    return sendIdempotent(reply, result)
  })

  app.post(`${base}/guardrail-decisions/:decisionId/acknowledge`, edit, async (request, reply) => {
    const { decisionId } = parse(decisionParams, request.params)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { version } = await planVersionFor(tx, request, 'plan.edit', false)
      // Acknowledging is authoring: after submission the reviewer decides on what was acknowledged then.
      assertDraft(version)
      return { statusCode: 201, body: envelope(await acknowledgeDecision(tx, version.id, decisionId)) }
    }))
    return sendIdempotent(reply, result)
  })
}

