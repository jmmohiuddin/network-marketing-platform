import { eligibleApprovers, type Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { checklistItem, evaluateChecklist, missingItems, summaryOf, type Evaluation } from './checklist.js'
import { getMarket, lockMarket, type MarketView } from './markets.js'
import { pgCode } from './pg.js'
import { inScope } from './scope.js'
import { approveOrRefuse } from './sod.js'
import { recordStructureChange } from './structure.js'

export const MARKET_SIGNOFF = 'market.signoff'
const OBJECT_TYPE = 'market_go_live_request'

const documentNotFound = () =>
  new ApiError(422, 'DOCUMENT_NOT_FOUND', 'The document does not exist, is not your evidence upload or is already used.')

function mapDocumentErrors(error: unknown): never {
  const code = pgCode(error)
  if (code === 'P0002' || code === '23503') throw documentNotFound()
  throw error
}

interface RequestRow {
  id: string
  market_id: string
  state: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  requested_by: string
  requested_by_name: string | null
  requested_at: Date
  checklist: unknown
  decided_by: string | null
  decided_by_name: string | null
  decided_at: Date | null
  decision_reason: string | null
  risk_acceptance: unknown
  risk_document_id: string | null
}

const REQUEST_SELECT = `
  SELECT r.id, r.market_id, r.state, r.requested_by, ru.display_name AS requested_by_name, r.requested_at, r.checklist,
         r.decided_by, du.display_name AS decided_by_name, r.decided_at, r.decision_reason, r.risk_acceptance, r.risk_document_id
  FROM market_go_live_request r
  JOIN user_account ru ON ru.id = r.requested_by
  LEFT JOIN user_account du ON du.id = r.decided_by`

const toView = (row: RequestRow) => ({
  id: row.id, market_id: row.market_id, state: row.state,
  requested_by: { id: row.requested_by, display_name: row.requested_by_name }, requested_at: row.requested_at,
  checklist: row.checklist,
  decided_by: row.decided_by === null ? null : { id: row.decided_by, display_name: row.decided_by_name },
  decided_at: row.decided_at, decision_reason: row.decision_reason, risk_acceptance: row.risk_acceptance,
  risk_document_id: row.risk_document_id,
})

export type GoLiveRequestView = ReturnType<typeof toView>

async function requestView(tx: Tx, id: string): Promise<GoLiveRequestView> {
  const { rows } = await tx.query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [id])
  return toView(rows[0]!)
}

async function pendingRequest(tx: Tx, marketId: string): Promise<RequestRow | undefined> {
  const { rows } = await tx.query<RequestRow>(`${REQUEST_SELECT} WHERE r.market_id = $1 AND r.state = 'pending'`, [marketId])
  return rows[0]
}

function assertDraft(market: MarketView): void {
  if (market.state !== 'draft') throw new ApiError(409, 'MARKET_NOT_DRAFT', 'The market is not a draft any more.', { state: market.state })
}

const goLivePending = () => new ApiError(409, 'GO_LIVE_PENDING', 'A go-live request is waiting for sign-off: decide or withdraw it first.')

/**
 * SoD contributors of a pending request (BR-SEC-06): its requester, the actors behind the entries and provider records
 * its checklist snapshot counted, and those the checklist counts now.
 */
async function requestContributors(tx: Tx, request: RequestRow, evaluation: Evaluation): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `WITH item AS (SELECT value FROM jsonb_array_elements($1::jsonb -> 'items'))
     SELECT e.recorded_by AS id FROM item JOIN market_checklist_entry e ON e.id = (item.value ->> 'entry_id')::uuid
     UNION
     SELECT p.created_by FROM item CROSS JOIN jsonb_array_elements_text(item.value -> 'provider_ids') AS pid (id)
       JOIN provider_config p ON p.id = pid.id::uuid`,
    [JSON.stringify(request.checklist)],
  )
  return [...new Set([request.requested_by, ...evaluation.contributors, ...rows.map((row) => row.id)])]
}

function signers(tx: Tx, marketId: string, contributors: readonly string[]) {
  return eligibleApprovers(tx, { permission: MARKET_SIGNOFF, marketId, excludeUserIds: contributors })
}

/** GET /v1/markets/:id/checklist (SC-17). */
export async function checklistView(tx: Tx, marketId: string, scope: readonly string[] | null) {
  if (!inScope(scope, marketId)) throw notFound()
  const market = await getMarket(tx, marketId)
  if (market === null) throw notFound()
  const evaluation = await evaluateChecklist(tx, market)
  const pending = await pendingRequest(tx, marketId)
  const contributors = pending === undefined ? evaluation.contributors : await requestContributors(tx, pending, evaluation)
  return {
    market: { id: market.id, code: market.code, name: market.name, state: market.state, market_pack: market.market_pack },
    items: evaluation.items, summary: summaryOf(evaluation),
    pending_request: pending === undefined ? null : toView(pending),
    eligible_signers: await signers(tx, marketId, contributors),
  }
}

export interface NewEntry {
  readonly document_id?: string
  readonly note?: string
}

/** POST /v1/markets/:id/checklist/:item/entries: evidence needs a document, an attestation a note. */
export async function recordEntry(tx: Tx, marketId: string, scope: readonly string[] | null, item: string, input: NewEntry) {
  const definition = checklistItem(item)
  if (definition === undefined) throw notFound()
  const market = await lockMarket(tx, marketId, scope)
  if (definition.kind === 'provider' || definition.kind === 'automatic') {
    throw new ApiError(422, 'ITEM_NOT_RECORDABLE', `${definition.title} is completed by ${definition.kind === 'provider' ? 'a provider approval record' : 'the configuration it checks'}, not by an entry.`)
  }
  if (definition.kind === 'evidence' && input.document_id === undefined) throw new ApiError(422, 'EVIDENCE_REQUIRED', `${definition.title} needs an evidence document.`)
  if (definition.kind === 'attestation' && input.note === undefined) throw new ApiError(422, 'NOTE_REQUIRED', `${definition.title} needs an attestation note.`)
  assertDraft(market)
  if ((await pendingRequest(tx, marketId)) !== undefined) throw goLivePending()
  let id: string
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO market_checklist_entry (tenant_id, market_id, item, document_id, note, recorded_by)
       VALUES (app_tenant_id(), $1, $2, $3, $4, current_setting('app.user_id')::uuid) RETURNING id`,
      [marketId, item, input.document_id ?? null, input.note ?? null],
    )
    id = rows[0]!.id
  } catch (error) {
    mapDocumentErrors(error)
  }
  await recordAudit(tx, {
    action: 'MARKET.CHECKLIST_RECORDED', objectType: 'market_checklist_entry', objectId: id,
    after: { market_id: marketId, item, document_id: input.document_id ?? null },
  })
  const evaluation = await evaluateChecklist(tx, market)
  return evaluation.items.find((view) => view.item === item)!
}

/** AC-38.1, AC-53.1, AC-TEN4-1: a complete checklist (screening rules aside) opens one pending request. */
export async function requestGoLive(tx: Tx, marketId: string, scope: readonly string[] | null): Promise<GoLiveRequestView> {
  const market = await lockMarket(tx, marketId, scope)
  assertDraft(market)
  if ((await pendingRequest(tx, marketId)) !== undefined) throw goLivePending()
  const evaluation = await evaluateChecklist(tx, market)
  assertComplete(evaluation)
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO market_go_live_request (tenant_id, market_id, state, requested_by, checklist)
     VALUES (app_tenant_id(), $1, 'pending', current_setting('app.user_id')::uuid, $2) RETURNING id`,
    [marketId, evaluation.snapshot],
  )
  const id = rows[0]!.id
  await recordAudit(tx, { action: 'MARKET.GO_LIVE_REQUESTED', objectType: OBJECT_TYPE, objectId: id, after: { market_id: marketId, code: market.code } })
  return requestView(tx, id)
}

function assertComplete(evaluation: Evaluation): void {
  const missing = missingItems(evaluation)
  if (missing.length > 0) {
    throw new ApiError(422, 'CHECKLIST_INCOMPLETE', `The launch checklist is incomplete: ${missing.map((m) => m.title).join(', ')}.`, { missing })
  }
}

export async function listGoLiveRequests(tx: Tx, marketId: string, scope: readonly string[] | null): Promise<GoLiveRequestView[]> {
  if (!inScope(scope, marketId) || (await getMarket(tx, marketId)) === null) throw notFound()
  const { rows } = await tx.query<RequestRow>(`${REQUEST_SELECT} WHERE r.market_id = $1 ORDER BY r.requested_at DESC, r.id DESC`, [marketId])
  return rows.map(toView)
}

/** The request (locked) and its market (locked) when the market is in scope; 404 otherwise; 409 unless pending. */
async function lockPending(tx: Tx, id: string, scope: readonly string[] | null): Promise<{ request: RequestRow; market: MarketView }> {
  const { rows: found } = await tx.query<{ market_id: string }>('SELECT market_id FROM market_go_live_request WHERE id = $1', [id])
  if (found[0] === undefined || !inScope(scope, found[0].market_id)) throw notFound()
  const market = await lockMarket(tx, found[0].market_id, scope)
  await tx.query('SELECT 1 FROM market_go_live_request WHERE id = $1 FOR UPDATE', [id])
  const { rows } = await tx.query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [id])
  const request = rows[0]!
  if (request.state !== 'pending') {
    throw new ApiError(409, 'GO_LIVE_NOT_PENDING', 'This go-live request is already decided or withdrawn.', { state: request.state })
  }
  return { request, market }
}

/** The requester withdraws its own pending request (decided_by stays NULL); other users see 404. */
export async function withdrawGoLive(tx: Tx, id: string, reason: string): Promise<GoLiveRequestView> {
  const { rows } = await tx.query('SELECT 1 FROM market_go_live_request WHERE id = $1 AND requested_by = app_user_id()', [id])
  if (rows.length === 0) throw notFound()
  const { request } = await lockPending(tx, id, null)
  await tx.query(`UPDATE market_go_live_request SET state = 'withdrawn', decided_at = now(), decision_reason = $2 WHERE id = $1`, [id, reason])
  await recordAudit(tx, { action: 'MARKET.GO_LIVE_WITHDRAWN', objectType: OBJECT_TYPE, objectId: id, before: { state: 'pending' }, after: { state: 'withdrawn', market_id: request.market_id }, reason })
  return requestView(tx, id)
}

export interface GoLiveDecision {
  readonly decision: 'approve' | 'reject'
  readonly reason: string
  readonly risk_acceptance?: { readonly statement: string; readonly document_id?: string }
  readonly factorVerifiedAt: Date | null
}

/**
 * AC-TEN4-2/3, AC-CPL12-1: approve re-evaluates the checklist, requires a written risk acceptance for mandatory rules
 * at screening, records the signer's approval (SoD over requester and contributors) and sets the market live.
 */
export async function decideGoLive(tx: Tx, id: string, scope: readonly string[] | null, decision: GoLiveDecision) {
  const { request, market } = await lockPending(tx, id, scope)
  const evaluation = await evaluateChecklist(tx, market)
  const approve = decision.decision === 'approve'
  const accepted = evaluation.screeningRules.map((rule) => ({ id: rule.id, title: rule.title, basis_status: rule.basis_status }))
  if (approve) {
    assertComplete(evaluation)
    if (accepted.length > 0 && decision.risk_acceptance === undefined) {
      throw new ApiError(422, 'RISK_ACCEPTANCE_REQUIRED', 'Mandatory market-pack rules are still at screening: accept the risk in writing to go live.', { rules: accepted })
    }
  }
  const approval = await approveOrRefuse(tx, {
    objectType: OBJECT_TYPE, objectId: id, preparerId: request.requested_by,
    contributorIds: await requestContributors(tx, request, evaluation), excludedIds: [],
    decision: approve ? 'approved' : 'rejected', reason: decision.reason, factorVerifiedAt: decision.factorVerifiedAt,
    approverPermission: MARKET_SIGNOFF, marketId: market.id,
  })
  const riskAcceptance = approve && decision.risk_acceptance !== undefined
    ? { statement: decision.risk_acceptance.statement, accepted_rules: accepted }
    : null
  try {
    await tx.query(
      `UPDATE market_go_live_request SET state = $2, decided_by = app_user_id(), decided_at = $3, decision_reason = $4,
         approval_id = $5, risk_acceptance = $6, risk_document_id = $7 WHERE id = $1`,
      [id, approve ? 'approved' : 'rejected', approval.decidedAt, decision.reason, approval.approvalId, riskAcceptance,
        riskAcceptance === null ? null : (decision.risk_acceptance?.document_id ?? null)],
    )
  } catch (error) {
    mapDocumentErrors(error)
  }
  if (approve) {
    await tx.query(`UPDATE market SET state = 'live' WHERE id = $1`, [market.id])
    await recordStructureChange(tx, `Market ${market.code} went live: ${decision.reason}`)
    await recordAudit(tx, {
      action: 'MARKET.WENT_LIVE', objectType: 'market', objectId: market.id, before: { state: 'draft' },
      after: { state: 'live', request_id: id, approver: await approverId(tx), approval_id: approval.approvalId, accepted_rules: accepted },
      reason: decision.reason,
    })
    await enqueueOutbox(tx, { type: 'market.went_live', key: market.id, payload: { market_id: market.id, code: market.code } })
  } else {
    await recordAudit(tx, { action: 'MARKET.GO_LIVE_REJECTED', objectType: OBJECT_TYPE, objectId: id, before: { state: 'pending' }, after: { state: 'rejected', market_id: market.id, approval_id: approval.approvalId }, reason: decision.reason })
  }
  return { request: await requestView(tx, id), market: (await getMarket(tx, market.id))! }
}

async function approverId(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{ id: string }>('SELECT app_user_id() AS id')
  return rows[0]!.id
}
