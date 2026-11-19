// SC-11 guardrail decisions and the overrides log (PLAN B3 section 2.2, FR-CPL-008).
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { assertStepUp, currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { COMPLIANCE_REVIEW, DECISION_VIEW, decisionViews, PLAN_IN_SCOPE } from './guardrails.js'
import { approveAcrossMarkets, decideAcrossMarkets } from './sod.js'

const JUSTIFICATION = { min: 20, max: 2000 }

const listQuery = z.strictObject({
  kind: z.enum(['evaluation', 'acknowledgement', 'override']).optional(),
  outcome: z.enum(['blocked', 'warned', 'reported']).optional(),
  market_pack: z.string().min(1).max(100).optional(),
  plan_version_id: z.uuid().optional(),
  overridable: z.enum(['true', 'false']).optional(),
  ...pageQuery,
})
const cursorSchema = z.tuple([z.string(), z.uuid()])
const overrideBody = z.strictObject({ justification: z.string(), evidence_document_id: z.uuid().optional() })
const idParams = z.strictObject({ id: z.uuid() })

const FILTERS = `($2::text IS NULL OR d.kind = $2) AND ($3::text IS NULL OR d.outcome = $3) AND ($4::text IS NULL OR g.market_pack = $4)
  AND ($5::uuid IS NULL OR d.plan_version_id = $5) AND ($6::boolean IS NULL OR g.overridable = $6)`

async function visibleDecision(tx: Tx, id: string, scope: readonly string[] | null): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<{ id: string }>(`${DECISION_VIEW} WHERE d.id = $1 AND ${PLAN_IN_SCOPE('p.id', '$2')}`, [id, scope])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

export function registerGuardrailRoutes(app: FastifyInstance): void {
  app.get('/v1/guardrail-decisions', { preHandler: [requireRealm('tenant'), requirePermission('guardrail.read')] }, async (request) => {
    const q = parse(listQuery, request.query)
    const scope = marketScope(currentAuth(request), 'guardrail.read')
    const after = decodeCursor(q.cursor, cursorSchema)
    const filters = [scope, q.kind ?? null, q.outcome ?? null, q.market_pack ?? null, q.plan_version_id ?? null, q.overridable === undefined ? null : q.overridable === 'true']
    return inTenant(request, async (tx) => {
      const { rows } = await tx.query<{ id: string; decided_at: Date }>(
        `SELECT * FROM (${DECISION_VIEW} WHERE ${PLAN_IN_SCOPE('p.id', '$1')} AND ${FILTERS}) AS x
         WHERE ($7::timestamptz IS NULL OR (date_trunc('milliseconds', x.decided_at), x.id) < ($7::timestamptz, $8::uuid))
         ORDER BY date_trunc('milliseconds', x.decided_at) DESC, x.id DESC LIMIT $9`, // the cursor holds a JS Date: compare at its ms
        [...filters, after?.[0] ?? null, after?.[1] ?? null, q.limit + 1],
      )
      const { rows: counts } = await tx.query<Record<string, string>>(
        `SELECT count(*) FILTER (WHERE d.kind = 'evaluation' AND d.outcome = 'blocked') AS blocked,
                count(*) FILTER (WHERE d.kind = 'evaluation' AND d.outcome = 'warned') AS warned,
                count(*) FILTER (WHERE d.kind = 'evaluation' AND d.outcome = 'reported') AS reported,
                count(*) FILTER (WHERE d.kind = 'override') AS overridden
         FROM guardrail_decision d JOIN guardrail_rule g ON g.id = d.rule_id
         JOIN plan_version v ON v.tenant_id = d.tenant_id AND v.id = d.plan_version_id
         JOIN plan p ON p.tenant_id = v.tenant_id AND p.id = v.plan_id
         WHERE ${PLAN_IN_SCOPE('p.id', '$1')} AND ${FILTERS}`,
        filters,
      )
      const page = toPage(rows, q.limit, (row) => [row.decided_at, row.id])
      const c = counts[0]!
      return envelope(page.data, { ...page.meta, counts: { blocked: Number(c.blocked), warned: Number(c.warned), reported: Number(c.reported), overridden: Number(c.overridden) } })
    })
  })

  app.get('/v1/guardrail-decisions/:id', { preHandler: [requireRealm('tenant'), requirePermission('guardrail.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), 'guardrail.read')
    return inTenant(request, async (tx) => {
      const decision = await visibleDecision(tx, id, scope)
      const { rows } = await tx.query<{ id: string }>('SELECT id FROM guardrail_decision WHERE refers_to_decision_id = $1 ORDER BY decided_at, id', [id])
      return envelope({ ...decision, decisions: await decisionViews(tx, { ids: rows.map((r) => r.id) }) })
    })
  })

  // FR-CPL-008: a Compliance officer overrides a warned or blocked evaluation of an overridable rule, or an opaque blocked
  // one of any rule (compliance review, D-B4-21 b); SoD vs its decider and the matched rules' authors.
  app.post('/v1/guardrail-decisions/:id/override', { preHandler: [requireRealm('tenant'), requirePermission('override.approve')] }, async (request, reply) => {
    assertStepUp(request)
    const { id } = parse(idParams, request.params)
    const body = parse(overrideBody, request.body)
    const length = body.justification.trim().length
    if (length < JUSTIFICATION.min || length > JUSTIFICATION.max) {
      throw new ApiError(422, 'VALIDATION_FAILED', `The justification needs ${JUSTIFICATION.min} to ${JUSTIFICATION.max} characters.`, { issues: [{ path: 'justification', message: 'length' }] })
    }
    const scope = marketScope(currentAuth(request), 'override.approve')
    const result = await decideAcrossMarkets(request, async (tx) => {
      const decision = await visibleDecision(tx, id, scope)
      const { rows } = await tx.query<{ kind: string; outcome: string; overridable: boolean; review: boolean; decided_by: string; overridden: boolean; market_ids: string[] }>(
        `SELECT d.kind, d.outcome, g.overridable, ${COMPLIANCE_REVIEW} AS review, d.decided_by,
                EXISTS (SELECT 1 FROM guardrail_decision o WHERE o.refers_to_decision_id = d.id AND o.kind = 'override') AS overridden,
                array(SELECT pm.market_id FROM plan_version v JOIN plan_market pm ON pm.tenant_id = v.tenant_id AND pm.plan_id = v.plan_id
                      WHERE v.id = d.plan_version_id ORDER BY pm.market_id) AS market_ids
         FROM guardrail_decision d JOIN guardrail_rule g ON g.id = d.rule_id WHERE d.id = $1`,
        [id],
      )
      const evaluation = rows[0]!
      if (evaluation.kind !== 'evaluation' || evaluation.outcome === 'reported' || !(evaluation.overridable || evaluation.review)) {
        throw new ApiError(422, 'NOT_OVERRIDABLE', 'This guardrail decision cannot be overridden.')
      }
      if (evaluation.overridden) throw new ApiError(409, 'ALREADY_OVERRIDDEN', 'This decision is already overridden.')
      // SoD against whoever wrote the matched rules, not only whoever triggered the evaluation (0306 mirrors it).
      const { rows: authors } = await tx.query<{ id: string }>('SELECT guardrail_rule_authors($1) AS id', [id])
      const { approvalId } = await approveAcrossMarkets(tx, {
        objectType: 'guardrail_decision', objectId: id, preparerId: evaluation.decided_by, contributorIds: authors.map((a) => a.id), excludedIds: [],
        decision: 'approved', reason: body.justification.trim(), factorVerifiedAt: currentAuth(request).stepUpAt,
        approverPermission: 'override.approve', marketIds: evaluation.market_ids,
      })
      const created = await tx.query<{ id: string }>(
        `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail, refers_to_decision_id,
           justification, evidence_document_id, approval_id)
         SELECT tenant_id, rule_id, plan_version_id, 'override', outcome, content_sha256, detail, id, $2, $3, $4
         FROM guardrail_decision WHERE id = $1 RETURNING id`,
        [id, body.justification.trim(), body.evidence_document_id ?? null, approvalId],
      ).catch((error: { code?: string }) => {
        if (error.code === 'P0002') throw new ApiError(422, 'EVIDENCE_NOT_USABLE', 'Upload the evidence document yourself; a document can be referenced once.')
        // One override per evaluation: the unique index decides a concurrent second one (rows are insert-only, no lock).
        if (error.code === '23505') throw new ApiError(409, 'ALREADY_OVERRIDDEN', 'This decision is already overridden.')
        throw error
      })
      const overrideId = created.rows[0]!.id
      await recordAudit(tx, {
        action: 'GUARDRAIL.OVERRIDDEN', objectType: 'guardrail_decision', objectId: overrideId,
        after: { refers_to_decision_id: id, rule_id: (decision.rule as { id: string }).id, approval_id: approvalId, evidence_document_id: body.evidence_document_id ?? null },
      })
      return { statusCode: 201, body: envelope((await decisionViews(tx, { ids: [overrideId] }))[0]) }
    })
    return sendIdempotent(reply, result)
  })
}
