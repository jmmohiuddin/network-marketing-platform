// Version lifecycle (PLAN B3 D-B3-04): submit (plan.edit) -> decision (plan.approve, step-up, SoD vs submitter and content
// contributors) -> schedule (plan.activate, step-up, SoD vs submitter, contributors and the compliance approver) -> active, at
// once when effective_from has passed, else by the cron pln.versions.activate.
import { withSystem, type Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant, runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type StoredResponse } from '../../lib/idempotency.js'
import { defineSystemJob } from '../../lib/jobs.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { approveAcrossMarkets, decideAcrossMarkets, evaluateGuardrails, outstandingDecisions } from '../cpl/index.js'
import { getSetting } from '../ten/index.js'
import { assertDraft, loadVersion, planVersionFor, storedError, type PlanRow, type VersionRow } from './access.js'
import { ruleRows, transitionRows, validationOf, validationView } from './content.js'
import { runGoldens, type GoldenResult } from './goldens.js'
import { missingTransitions, uncoveredExtensions, versionFields } from './views.js'

const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(1).max(500) })
const scheduleBody = z.strictObject({ effective_from: z.iso.datetime({ offset: true }), justification: z.string().trim().min(1).max(2000) })

const failedGoldens = (results: readonly GoldenResult[]): { id: string; name: string; mismatches: GoldenResult['mismatches']; error: GoldenResult['error'] }[] =>
  results.filter((r) => r.status === 'fail').map((r) => ({ id: r.id, name: r.name, mismatches: r.mismatches, error: r.error }))

/**
 * Everyone who wrote the version's content: rule creators and editors, rule deleters, transition and crediting-event
 * writers, golden dataset creators and deleters. They may not approve or activate it (D-B3-04 SoD).
 * shortcut: deletions are found through the audit refs (no row is left), scanning the tenant's plan_rule and
 * golden_dataset audit events; index the version id in audit if that log grows large.
 */
async function contributors(tx: Tx, versionId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT unnest(ARRAY[created_by, updated_by]) AS id FROM plan_rule WHERE plan_version_id = $1
     UNION
     SELECT actor_id FROM audit.audit_event
     WHERE actor_id IS NOT NULL AND object_type = 'plan_version' AND object_id = $1
       AND action IN ('PLAN_VERSION.UPDATED', 'PLAN_TRANSITION.SAVED', 'PLAN_TRANSITION.DELETED')
     UNION
     SELECT actor_id FROM audit.audit_event
     WHERE actor_id IS NOT NULL AND object_type IN ('plan_rule', 'golden_dataset')
       AND action IN ('PLAN_RULE.SAVED', 'PLAN_RULE.DELETED', 'GOLDEN_DATASET.CREATED', 'GOLDEN_DATASET.DELETED')
       AND CASE WHEN action IN ('PLAN_RULE.SAVED', 'GOLDEN_DATASET.CREATED') THEN after_ref::jsonb -> 'after' ->> 'plan_version_id'
                ELSE before_ref::jsonb ->> 'plan_version_id' END = $1::text
     ORDER BY 1`,
    [versionId],
  )
  return rows.map((r) => r.id)
}

async function reloaded(tx: Tx, version: VersionRow): Promise<StoredResponse> {
  return { statusCode: 200, body: envelope(versionFields(await loadVersion(tx, version.plan_id, version.version))) }
}

/** scheduled -> active (the previous active version retires), when due. Shared by schedule and the cron. */
export async function activate(tx: Tx, versionId: string): Promise<boolean> {
  await tx.query('SELECT 1 FROM plan WHERE id = (SELECT plan_id FROM plan_version WHERE id = $1) FOR UPDATE', [versionId])
  const { rows } = await tx.query<{ plan_id: string; effective_from: Date }>(
    "SELECT plan_id, effective_from FROM plan_version WHERE id = $1 AND state = 'scheduled' AND effective_from <= now() FOR UPDATE", [versionId],
  )
  const due = rows[0]
  if (due === undefined) return false
  // A later version already took effect (this one's activation failed until then): an older plan never replaces it.
  // shortcut: the superseded version stays 'scheduled' and is re-checked each minute (the DB has no scheduled -> retired);
  // add that transition if it must leave the due list.
  const { rows: newer } = await tx.query(
    "SELECT 1 FROM plan_version WHERE plan_id = $1 AND state IN ('active', 'retired') AND effective_from > (SELECT effective_from FROM plan_version WHERE id = $2) LIMIT 1",
    [due.plan_id, versionId],
  )
  if (newer.length > 0) return false
  const { rows: retired } = await tx.query<{ id: string }>(
    "UPDATE plan_version SET state = 'retired', retired_at = now() WHERE plan_id = $1 AND state = 'active' RETURNING id", [due.plan_id],
  )
  for (const r of retired) await recordAudit(tx, { action: 'PLAN_VERSION.RETIRED', objectType: 'plan_version', objectId: r.id, after: { state: 'retired', replaced_by: versionId } })
  await tx.query("UPDATE plan_version SET state = 'active', activated_at = now() WHERE id = $1", [versionId])
  await enqueueOutbox(tx, { type: 'plan.version.activated', key: due.plan_id, payload: { plan_id: due.plan_id, plan_version_id: versionId, effective_from: due.effective_from.toISOString() } })
  await recordAudit(tx, { action: 'PLAN_VERSION.ACTIVATED', objectType: 'plan_version', objectId: versionId, after: { state: 'active', effective_from: due.effective_from } })
  return true
}

/** System cron (every minute): activates every due scheduled version, one tenant transaction each. */
export const activateVersionsJob = defineSystemJob({
  name: 'pln.versions.activate',
  cron: '* * * * *',
  async run(ctx) {
    const { rows } = await withSystem((tx) => tx.query<{ tenant_id: string; plan_version_id: string }>('SELECT tenant_id, plan_version_id FROM pln_due_activations()'))
    for (const row of rows) {
      try {
        await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: ctx.jobId, supportSessionId: null }, (tx) => activate(tx, row.plan_version_id))
      } catch (error) {
        ctx.log.error({ err: error, planVersionId: row.plan_version_id }, 'plan version activation failed; retried next minute')
      }
    }
  },
})

/** Schedule gates of D-B3-04 except goldens and SoD; throws the first refusal. */
async function assertSchedulable(tx: Tx, plan: PlanRow, version: VersionRow, effectiveFrom: string): Promise<void> {
  const refuse = (code: string, message: string, details: unknown = null): never => {
    throw new ApiError(422, code, message, details)
  }
  const { rows: offBoundary } = await tx.query<{ calendar_id: string }>(
    `SELECT pc.calendar_id FROM plan_calendar pc WHERE pc.plan_id = $1
       AND NOT EXISTS (SELECT 1 FROM period p WHERE p.calendar_id = pc.calendar_id AND p.starts_at = $2::timestamptz)
     ORDER BY pc.calendar_id LIMIT 1`,
    [plan.id, effectiveFrom],
  )
  if (offBoundary[0] !== undefined) refuse('EFFECTIVE_NOT_AT_BOUNDARY', 'The effective time must be the start of a period of every plan calendar.', { calendar_id: offBoundary[0].calendar_id })
  const { rows: committed } = await tx.query(
    `SELECT 1 FROM plan_calendar pc JOIN period p ON p.calendar_id = pc.calendar_id
     WHERE pc.plan_id = $1 AND p.state IN ('committed', 'paid', 'closed') AND p.starts_at >= $2::timestamptz LIMIT 1`,
    [plan.id, effectiveFrom],
  )
  if (committed.length > 0) refuse('EFFECTIVE_IN_COMMITTED_PERIOD', 'A committed period starts at or after the effective time; choose a later period.')
  const { rows: later } = await tx.query(
    "SELECT 1 FROM plan_version WHERE plan_id = $1 AND id <> $2 AND state IN ('scheduled', 'active', 'retired') AND effective_from >= $3::timestamptz LIMIT 1",
    [plan.id, version.id, effectiveFrom],
  )
  if (later.length > 0) refuse('EFFECTIVE_NOT_AFTER_PREVIOUS', 'The effective time must be after the effective time of the previous version.')
  const noticeDays = await getSetting(tx, 'plan.activation_notice_days')
  if (noticeDays !== null) {
    const { rows } = await tx.query<{ short: boolean }>('SELECT $1::timestamptz < now() + make_interval(days => $2) AS short', [effectiveFrom, noticeDays])
    if (rows[0]!.short) refuse('NOTICE_PERIOD_NOT_MET', `Plan changes need ${noticeDays} days' notice.`, { notice_days: noticeDays })
  }
  await assertCreditingConsistent(tx, plan, version, effectiveFrom)
  const { rows: simulated } = await tx.query<{ ok: boolean }>('SELECT plan_version_simulated($1) AS ok', [version.id])
  if (!simulated[0]!.ok) refuse('SIMULATION_REQUIRED', 'Run a simulation of this exact version before scheduling it.')
  const missing = await missingTransitions(tx, plan, version, await transitionRows(tx, version.id))
  if (missing.length > 0) refuse('TRANSITION_MISSING', 'Declare a transition for every state item of the previous version.', { state_items: missing })
}

/**
 * BR-PER-02: a past effective time must not re-credit orders already ingested under another crediting event, and no
 * other plan covering a market may be in force at an overlapping instant with another crediting event.
 */
async function assertCreditingConsistent(tx: Tx, plan: PlanRow, version: VersionRow, effectiveFrom: string): Promise<void> {
  const fallback = await getSetting(tx, 'orders.crediting_event')
  const { rows: ingested } = await tx.query<{ market_id: string }>(
    `SELECT pm.market_id FROM plan_market pm WHERE pm.plan_id = $1 AND $2::timestamptz < now() AND EXISTS (
       SELECT 1 FROM sales_order o WHERE o.market_id = pm.market_id AND o.ordered_at >= $2::timestamptz AND o.ordered_at < now()
         AND coalesce(plan_crediting_event(pm.market_id, o.ordered_at), $3) IS DISTINCT FROM $4)
     ORDER BY 1 LIMIT 1`,
    [plan.id, effectiveFrom, fallback, version.crediting_event],
  )
  const conflict = (marketId: string, reason: string): never => {
    throw new ApiError(422, 'CREDITING_EVENT_CONFLICT', 'The crediting event conflicts with how orders of a market are credited.', { market_id: marketId, reason })
  }
  if (ingested[0] !== undefined) conflict(ingested[0].market_id, 'ingested_orders')
  const { rows: other } = await tx.query<{ market_id: string }>(
    `SELECT pm.market_id FROM plan_market pm
     JOIN plan_market om ON om.tenant_id = pm.tenant_id AND om.market_id = pm.market_id AND om.plan_id <> pm.plan_id
     JOIN plan_version ov ON ov.tenant_id = om.tenant_id AND ov.plan_id = om.plan_id AND ov.state IN ('scheduled', 'active', 'retired')
     WHERE pm.plan_id = $1 AND ov.crediting_event IS DISTINCT FROM $3
       AND NOT EXISTS (SELECT 1 FROM plan_version w WHERE w.plan_id = ov.plan_id AND w.state IN ('scheduled', 'active', 'retired')
                       AND w.effective_from > ov.effective_from AND w.effective_from <= $2::timestamptz)
     ORDER BY 1 LIMIT 1`,
    [plan.id, effectiveFrom, version.crediting_event],
  )
  if (other[0] !== undefined) conflict(other[0].market_id, 'other_plan')
}

export function registerLifecycleRoutes(app: FastifyInstance): void {
  const base = '/v1/plans/:id/versions/:v'

  app.post(`${base}/submit`, { preHandler: [requireRealm('tenant'), requirePermission('plan.edit')] }, async (request, reply) => {
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.edit')
      assertDraft(version)
      const rules = await ruleRows(tx, version.id)
      const validation = validationOf(rules, plan.calendar_ids, version.placement_width)
      if (!validation.ok || !version.compiled_ok) throw new ApiError(422, 'PLAN_INVALID', 'Fix the validation errors before submitting.', { errors: validationView(validation).errors })
      if (version.crediting_event === null) throw new ApiError(422, 'CREDITING_EVENT_NOT_SET', 'Choose the crediting event before submitting.')
      const uncovered = await uncoveredExtensions(tx, version.id, rules)
      if (uncovered.length > 0) throw new ApiError(422, 'EXTENSION_NOT_COVERED', 'Each extension rule needs a golden dataset that covers it.', { rule_keys: uncovered })
      // Evaluated again (guardrail rules may have changed since the last save); the rows commit with the refusal.
      await evaluateGuardrails(tx, version.id)
      const outstanding = await outstandingDecisions(tx, version.id)
      if (outstanding.length > 0) return storedError(request, 422, 'GUARDRAIL_OUTSTANDING', 'Acknowledge or override the open guardrail decisions first.', { decisions: outstanding })
      const failed = failedGoldens(await runGoldens(tx, version.id))
      if (failed.length > 0) return storedError(request, 422, 'GOLDEN_FAILED', 'A golden dataset does not match; the version stays a draft.', { datasets: failed })
      await tx.query("UPDATE plan_version SET state = 'in_review', submitted_by = app_user_id(), submitted_at = now() WHERE id = $1", [version.id])
      await recordAudit(tx, { action: 'PLAN_VERSION.SUBMITTED', objectType: 'plan_version', objectId: version.id, after: { state: 'in_review', content_hash: version.content_hash } })
      return reloaded(tx, version)
    }))
    return sendIdempotent(reply, result)
  })

  app.post(`${base}/decision`, { preHandler: [requireRealm('tenant'), requirePermission('plan.approve'), requireStepUp()] }, async (request, reply) => {
    const body = parse(decisionBody, request.body)
    const result = await decideAcrossMarkets(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.approve')
      if (version.state !== 'in_review') throw new ApiError(409, 'VERSION_NOT_IN_REVIEW', 'Only a version in review can be decided.')
      const approve = body.decision === 'approve'
      const { approvalId } = await approveAcrossMarkets(tx, {
        objectType: 'plan_version', objectId: version.id, preparerId: version.submitted_by!, contributorIds: await contributors(tx, version.id),
        excludedIds: [], decision: approve ? 'approved' : 'rejected', reason: body.reason, factorVerifiedAt: currentAuth(request).stepUpAt,
        approverPermission: 'plan.approve', marketIds: plan.market_ids,
      })
      if (approve) await tx.query("UPDATE plan_version SET state = 'approved', approval_id = $2 WHERE id = $1", [version.id, approvalId])
      else await tx.query("UPDATE plan_version SET state = 'draft' WHERE id = $1", [version.id])
      await recordAudit(tx, { action: approve ? 'PLAN_VERSION.APPROVED' : 'PLAN_VERSION.REJECTED', objectType: 'plan_version', objectId: version.id, after: { approval_id: approvalId, state: approve ? 'approved' : 'draft' }, reason: body.reason })
      return reloaded(tx, version)
    })
    return sendIdempotent(reply, result)
  })

  app.post(`${base}/schedule`, { preHandler: [requireRealm('tenant'), requirePermission('plan.activate'), requireStepUp()] }, async (request, reply) => {
    const body = parse(scheduleBody, request.body)
    const result = await decideAcrossMarkets(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.activate')
      if (version.state !== 'approved') throw new ApiError(409, 'VERSION_NOT_APPROVED', 'Only an approved version can be scheduled.')
      await assertSchedulable(tx, plan, version, body.effective_from)
      const failed = failedGoldens(await runGoldens(tx, version.id))
      if (failed.length > 0) return storedError(request, 422, 'GOLDEN_FAILED', 'A golden dataset no longer matches; the version stays approved.', { datasets: failed })
      const { approvalId } = await approveAcrossMarkets(tx, {
        objectType: 'plan_version', objectId: version.id, preparerId: version.submitted_by!,
        contributorIds: [...(await contributors(tx, version.id)), ...(version.approved_by === null ? [] : [version.approved_by])],
        excludedIds: [], decision: 'approved', reason: body.justification, factorVerifiedAt: currentAuth(request).stepUpAt,
        approverPermission: 'plan.activate', marketIds: plan.market_ids,
      })
      await tx.query(
        "UPDATE plan_version SET state = 'scheduled', activation_approval_id = $2, effective_from = $3, justification = $4 WHERE id = $1",
        [version.id, approvalId, body.effective_from, body.justification],
      )
      await recordAudit(tx, { action: 'PLAN_VERSION.SCHEDULED', objectType: 'plan_version', objectId: version.id, after: { effective_from: body.effective_from, activation_approval_id: approvalId }, reason: body.justification })
      await activate(tx, version.id)
      return reloaded(tx, version)
    })
    return sendIdempotent(reply, result)
  })
}
