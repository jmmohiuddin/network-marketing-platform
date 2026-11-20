// Plan-change governance (PLAN B6 D-B6-02, D-B6-03; API-16): filing records per plan market and the SC-44 checklist view
// of the gates a version passes before it is scheduled.
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { outstandingDecisions } from '../cpl/index.js'
import { getSetting } from '../ten/index.js'
import { planVersionFor, sqlState, type PlanRow, type VersionRow } from './access.js'
import { transitionRows } from './content.js'
import { missingTransitions } from './views.js'

const STATUSES = ['filed', 'acknowledged', 'not_required'] as const
const filingBody = z.strictObject({
  market_id: z.uuid(),
  status: z.enum(STATUSES),
  reference: z.string().trim().min(1).max(200).optional(),
  filed_on: z.iso.date().optional(),
  document_id: z.uuid().optional(),
  note: z.string().trim().min(1).max(1000).optional(),
})
type FilingBody = z.infer<typeof filingBody>
// AC-PLN7-4: what each status must carry (the plan_version_filing CHECKs).
const REQUIRED: Readonly<Record<FilingBody['status'], readonly (keyof FilingBody)[]>> = {
  filed: ['reference', 'filed_on', 'document_id'],
  acknowledged: ['reference', 'filed_on', 'document_id'],
  not_required: ['note', 'document_id'],
}

const FILING_COLUMNS = `f.id, f.market_id, f.status, f.reference, to_char(f.filed_on, 'YYYY-MM-DD') AS filed_on, f.document_id, f.note,
  jsonb_build_object('id', f.recorded_by, 'display_name', (SELECT u.display_name FROM user_account u WHERE u.id = f.recorded_by)) AS recorded_by,
  f.recorded_at`

interface FilingView {
  id: string
  market_id: string
  status: FilingBody['status']
  reference: string | null
  filed_on: string | null
  document_id: string | null
  note: string | null
  recorded_by: { id: string; display_name: string | null }
  recorded_at: Date
}

interface Item {
  key: 'simulation' | 'goldens' | 'guardrails' | 'transitions' | 'filing' | 'notice' | 'approvals'
  ok: boolean
  reason: string | null
  details: unknown
}

const item = (key: Item['key'], ok: boolean, reason: string, details: unknown = null): Item => ({ key, ok, reason: ok ? null : reason, details })

async function filings(tx: Tx, plan: PlanRow, version: VersionRow) {
  const { rows: markets } = await tx.query<{ id: string; code: string }>('SELECT id, code FROM market WHERE id = ANY ($1::uuid[]) ORDER BY code', [plan.market_ids])
  // BR-PLN-03: a filing recorded for earlier content (before a rejection and edit) is history, never the current status.
  const { rows } = await tx.query<FilingView & { for_content: boolean }>(
    `SELECT ${FILING_COLUMNS}, f.content_hash IS NOT DISTINCT FROM v.content_hash AS for_content
     FROM plan_version_filing f JOIN plan_version v ON v.id = f.plan_version_id
     WHERE f.plan_version_id = $1 ORDER BY f.recorded_at DESC, f.id DESC`, [version.id])
  const history = rows.map(({ for_content: forContent, ...filing }) => ({ filing, forContent }))
  const requiredIds = new Set((await getSetting(tx, 'plan.filing_requirements'))?.market_ids ?? [])
  return markets.map((market) => {
    const own = history.filter(({ filing }) => filing.market_id === market.id)
    return { market, required: requiredIds.has(market.id), current: own.find((f) => f.forContent)?.filing ?? null, history: own.map(({ filing }) => filing) }
  })
}

async function approver(tx: Tx, approvalId: string | null): Promise<{ by: { id: string; display_name: string | null }; at: Date } | null> {
  if (approvalId === null) return null
  const { rows } = await tx.query<{ by: { id: string; display_name: string | null }; at: Date }>(
    `SELECT jsonb_build_object('id', a.approver_id, 'display_name', u.display_name) AS by, a.decided_at AS at
     FROM approval a JOIN user_account u ON u.id = a.approver_id WHERE a.id = $1`, [approvalId])
  return rows[0] ?? null
}

/** SC-44 (AC-PLN7-5): the schedule gates with their state, the filings per plan market, the notice and the approvals. */
async function governanceView(tx: Tx, plan: PlanRow, version: VersionRow) {
  const { rows: facts } = await tx.query<{ simulated: boolean; goldens_ok: boolean; missing_filings: string[]; notice_sent_at: Date | null; notice_recipients: number | null; first_run_id: string | null }>(
    `SELECT plan_version_simulated(v.id) AS simulated,
            NOT EXISTS (SELECT 1 FROM golden_dataset g WHERE g.plan_version_id = v.id
                        AND (g.last_result ->> 'status' IS DISTINCT FROM 'pass' OR g.last_result ->> 'content_hash' IS DISTINCT FROM encode(v.content_hash, 'hex'))) AS goldens_ok,
            plan_filing_missing(v.id) AS missing_filings, v.notice_sent_at, v.notice_recipients,
            -- D-B6-03: the run that applies (or will apply) pass 0; a failed or discarded run has no report in force.
            (SELECT r.id FROM run r JOIN period p ON p.id = r.period_id WHERE r.plan_version_id = v.id AND r.state NOT IN ('failed', 'discarded')
             ORDER BY p.starts_at, r.created_at, r.id LIMIT 1) AS first_run_id
     FROM plan_version v WHERE v.id = $1`, [version.id])
  const fact = facts[0]!
  const outstanding = await outstandingDecisions(tx, version.id)
  const missing = await missingTransitions(tx, plan, version, await transitionRows(tx, version.id))
  const filingRows = await filings(tx, plan, version)
  const days = await getSetting(tx, 'plan.activation_notice_days')
  const { rows: earliest } = await tx.query<{ at: Date | null }>('SELECT CASE WHEN $1::int IS NULL THEN NULL ELSE now() + make_interval(days => $1::int) END AS at', [days])
  const notice = { days, earliest_effective_from: earliest[0]!.at, sent_at: fact.notice_sent_at, recipients: fact.notice_recipients }
  const approvals = { compliance: await approver(tx, version.approval_id), activation: await approver(tx, version.activation_approval_id) }
  const anyRequired = filingRows.some((f) => f.required)
  const items: Item[] = [
    item('simulation', fact.simulated, 'Run a simulation of this exact version before scheduling it.'),
    item('goldens', fact.goldens_ok, 'A golden dataset has not passed on this exact version.'),
    item('guardrails', outstanding.length === 0, 'Acknowledge or override the open guardrail decisions first.', { decisions: outstanding }),
    item('transitions', missing.length === 0, 'Declare a transition for every state item of the previous version.', { state_items: missing }),
    {
      ...item('filing', fact.missing_filings.length === 0, 'A market requires a recorded filing status for this version.', { market_ids: fact.missing_filings }),
      ...(anyRequired ? {} : { reason: 'No market requires a filing.' }),
    },
    // The notice gate (effective_from >= earliest_effective_from) is judged at schedule time; before it the item states it.
    { key: 'notice', ok: true, reason: days === null || fact.notice_sent_at !== null ? null : `Schedule on or after ${notice.earliest_effective_from!.toISOString().slice(0, 10)} (${days} days' notice).`, details: notice },
    item('approvals', approvals.compliance !== null && approvals.activation !== null, 'The version needs the compliance approval and the activation approval.'),
  ]
  return {
    version: { id: version.id, version: version.version, state: version.state, effective_from: version.effective_from, notice_sent_at: fact.notice_sent_at, notice_recipients: fact.notice_recipients },
    items, filings: filingRows, notice, approvals, first_run_id: fact.first_run_id,
  }
}

async function recordFiling(tx: Tx, plan: PlanRow, version: VersionRow, body: FilingBody): Promise<FilingView> {
  const missing = REQUIRED[body.status].filter((field) => body[field] === undefined)
  if (missing.length > 0) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'The request is not valid.', { issues: missing.map((path) => ({ path, message: `required when status is ${body.status}` })) })
  }
  if (!plan.market_ids.includes(body.market_id)) throw new ApiError(422, 'MARKET_NOT_IN_PLAN', 'The market is not a market of the plan.')
  if (version.state !== 'in_review' && version.state !== 'approved') {
    throw new ApiError(409, 'VERSION_STATE', 'A filing is recorded while the version is in review or approved.', { state: version.state })
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO plan_version_filing (tenant_id, plan_version_id, market_id, status, reference, filed_on, document_id, note)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [version.id, body.market_id, body.status, body.reference ?? null, body.filed_on ?? null, body.document_id ?? null, body.note ?? null],
  ).catch((error: unknown) => {
    // assert_document_referenceable: unknown, someone else's, not evidence, or already referenced.
    if (sqlState(error) === 'P0002') throw new ApiError(422, 'DOCUMENT_NOT_REFERENCEABLE', 'Upload the evidence document yourself, then record the filing.')
    throw error
  })
  const id = rows[0]!.id
  await recordAudit(tx, { action: 'PLAN_FILING.RECORDED', objectType: 'plan_version_filing', objectId: id, after: { version_id: version.id, market_id: body.market_id, status: body.status } })
  const { rows: view } = await tx.query<FilingView>(`SELECT ${FILING_COLUMNS} FROM plan_version_filing f WHERE f.id = $1`, [id])
  return view[0]!
}

export function registerGovernanceRoutes(app: FastifyInstance): void {
  const base = '/v1/plans/:id/versions/:v'

  app.get(`${base}/governance`, { preHandler: [requireRealm('tenant'), requirePermission('plan.read')] }, async (request) =>
    inTenant(request, async (tx) => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.read', false)
      return envelope(await governanceView(tx, plan, version))
    }))

  // A contributor of the version may record a filing: filing is not content (AC-PLN7-4).
  app.post(`${base}/filings`, { preHandler: [requireRealm('tenant'), requirePermission('plan.approve'), requireStepUp()] }, async (request, reply) => {
    const body = parse(filingBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { plan, version } = await planVersionFor(tx, request, 'plan.approve')
      return { statusCode: 201, body: envelope(await recordFiling(tx, plan, version, body)) }
    }))
    return sendIdempotent(reply, result)
  })
}
