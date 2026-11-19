import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { seal } from '../../lib/secret-box.js'

// D-B1-12: B1 records a payment or payout provider's eligibility for a market (approval, evidence, date, funds
// holder; BR-PAY-11). No credentials and no adapter calls: those arrive in B4 with sandbox adapters only.
// Commerce connectors share provider_config (D-B2-14) but are reachable only through /v1/connectors (its guard and audit).
const PROVIDER_KINDS = "kind IN ('payout', 'payment')"

export type ProviderKind = 'payout' | 'payment'

export interface ProviderView {
  id: string
  market_id: string | null
  kind: string
  provider: string
  approved_description: string | null
  approval_document: { id: string; file_name: string | null } | null
  approved_at: string | null
  funds_holder: string | null
  state: 'recorded' | 'withdrawn'
  adapter: 'sandbox' | 'bank_file_csv' | null
  webhook_configured: boolean
  review_due_on: string | null
  created_by: { id: string; display_name: string | null }
  created_at: Date
  withdrawn_at: Date | null
}

interface ProviderRow extends Omit<ProviderView, 'approval_document' | 'created_by'> {
  approval_document_id: string | null
  file_name: string | null
  created_by: string
  created_by_name: string | null
}

const PROVIDER_SELECT = `
  SELECT p.id, p.market_id, p.kind, p.provider, p.approved_description, p.approval_document_id, d.file_name,
         to_char(p.approved_at, 'YYYY-MM-DD') AS approved_at, p.funds_holder, p.state, p.adapter,
         p.webhook_secret_sealed IS NOT NULL AS webhook_configured, to_char(p.review_due_on, 'YYYY-MM-DD') AS review_due_on, p.created_by,
         u.display_name AS created_by_name, p.created_at, p.withdrawn_at
  FROM provider_config p
  JOIN user_account u ON u.id = p.created_by
  LEFT JOIN LATERAL document_summary(p.approval_document_id) d ON true`

function toView(row: ProviderRow): ProviderView {
  const { approval_document_id: documentId, file_name: fileName, created_by: createdBy, created_by_name: createdByName, ...rest } = row
  return {
    ...rest,
    approval_document: documentId === null ? null : { id: documentId, file_name: fileName },
    created_by: { id: createdBy, display_name: createdByName },
  }
}

export interface RecordedProvider {
  readonly id: string
  readonly kind: ProviderKind
  readonly provider: string
  readonly approvedAt: string
  readonly fundsHolder: string
  readonly createdBy: string
}

/** PAY facade (checklist, FR-TEN-004): the market's recorded payout and payment provider approvals. */
export async function recordedProviders(tx: Tx, marketId: string): Promise<RecordedProvider[]> {
  const { rows } = await tx.query<RecordedProvider>(
    `SELECT id, kind, provider, to_char(approved_at, 'YYYY-MM-DD') AS "approvedAt", funds_holder AS "fundsHolder",
            created_by AS "createdBy"
     FROM provider_config WHERE market_id = $1 AND state = 'recorded' AND ${PROVIDER_KINDS}
     ORDER BY kind, provider, id`,
    [marketId],
  )
  return rows
}

export interface ProviderFilter {
  readonly market_id?: string
  readonly kind?: string
  readonly state?: string
}

/** Provider records of the markets in scope (null = all, tenant-wide records included). */
export async function listProviders(tx: Tx, scope: readonly string[] | null, filter: ProviderFilter): Promise<ProviderView[]> {
  const { rows } = await tx.query<ProviderRow>(
    `${PROVIDER_SELECT}
     WHERE p.${PROVIDER_KINDS} AND ($1::uuid[] IS NULL OR p.market_id = ANY ($1)) AND ($2::uuid IS NULL OR p.market_id = $2)
       AND ($3::text IS NULL OR p.kind = $3) AND ($4::text IS NULL OR p.state = $4)
     ORDER BY p.created_at DESC, p.id DESC`,
    [scope, filter.market_id ?? null, filter.kind ?? null, filter.state ?? null],
  )
  return rows.map(toView)
}

async function providerView(tx: Tx, id: string): Promise<ProviderView> {
  const { rows } = await tx.query<ProviderRow>(`${PROVIDER_SELECT} WHERE p.id = $1`, [id])
  return toView(rows[0]!)
}

export interface NewProvider {
  readonly market_id: string
  readonly kind: ProviderKind
  readonly provider: string
  readonly approved_description: string
  readonly approval_document_id: string
  readonly approved_at: string
  readonly funds_holder: string
  readonly review_due_on?: string | null | undefined
}

const documentNotFound = () =>
  new ApiError(422, 'DOCUMENT_NOT_FOUND', 'The approval document does not exist, is not your evidence upload or is already used.')

/**
 * Locks the market (the lock go-live requests and sign-off take) and refuses 409 GO_LIVE_PENDING while a go-live
 * request waits: its checklist snapshot and SoD contributors include the market's provider records (AC-TEN4-2).
 * False when the market does not exist.
 */
async function lockMarketForProviders(tx: Tx, marketId: string): Promise<boolean> {
  const { rows } = await tx.query<{ pending: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM market_go_live_request r WHERE r.market_id = m.id AND r.state = 'pending') AS pending
     FROM market m WHERE m.id = $1 FOR UPDATE OF m`,
    [marketId],
  )
  if (rows[0]?.pending === true) {
    throw new ApiError(409, 'GO_LIVE_PENDING', 'A go-live request is waiting for sign-off: decide or withdraw it first.')
  }
  return rows[0] !== undefined
}

/** AC-38.1 input: a provider approval for a market in scope, with an evidence document the caller uploaded (D-B1-04). */
export async function recordProvider(tx: Tx, scope: readonly string[] | null, input: NewProvider): Promise<ProviderView> {
  if ((scope !== null && !scope.includes(input.market_id)) || !(await lockMarketForProviders(tx, input.market_id))) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'market_id is not valid: no such market.', { issues: [{ path: 'market_id', message: 'no such market' }] })
  }
  let id: string
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO provider_config (tenant_id, market_id, kind, provider, approved_description, approval_document_id,
         approved_at, funds_holder, state, created_by, review_due_on)
       VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, 'recorded', current_setting('app.user_id')::uuid, $8) RETURNING id`,
      [input.market_id, input.kind, input.provider, input.approved_description, input.approval_document_id, input.approved_at, input.funds_holder,
        input.review_due_on ?? null],
    )
    id = rows[0]!.id
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'P0002' || code === '23503') throw documentNotFound()
    if (code === '23505') throw new ApiError(409, 'PROVIDER_ALREADY_RECORDED', 'This provider is already recorded for the market and kind.')
    throw error
  }
  await recordAudit(tx, {
    action: 'PROVIDER.ELIGIBILITY_RECORDED', objectType: 'provider_config', objectId: id,
    after: { market_id: input.market_id, kind: input.kind, provider: input.provider, approval_document_id: input.approval_document_id },
  })
  return providerView(tx, id)
}

/** Withdraws a recorded provider approval of a market in scope; 409 PROVIDER_NOT_RECORDED once withdrawn. */
export async function withdrawProvider(tx: Tx, id: string, scope: readonly string[] | null, reason: string): Promise<ProviderView> {
  const { rows: found } = await tx.query<{ market_id: string | null }>(`SELECT market_id FROM provider_config WHERE id = $1 AND ${PROVIDER_KINDS}`, [id])
  if (found[0] === undefined || (scope !== null && (found[0].market_id === null || !scope.includes(found[0].market_id)))) throw notFound()
  if (found[0].market_id !== null) await lockMarketForProviders(tx, found[0].market_id) // market first, as go-live does
  const { rows } = await tx.query<{ market_id: string | null; state: string }>('SELECT market_id, state FROM provider_config WHERE id = $1 FOR UPDATE', [id])
  const row = rows[0]!
  if (row.state !== 'recorded') throw notRecorded()
  await assertNoMoneyInFlight(tx, id)
  await tx.query(
    `UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = current_setting('app.user_id')::uuid WHERE id = $1`,
    [id],
  )
  await recordAudit(tx, {
    action: 'PROVIDER.ELIGIBILITY_WITHDRAWN', objectType: 'provider_config', objectId: id,
    before: { state: 'recorded' }, after: { state: 'withdrawn', market_id: row.market_id }, reason,
  })
  return providerView(tx, id)
}

const notRecorded = () => new ApiError(409, 'PROVIDER_NOT_RECORDED', 'This provider approval is already withdrawn.')

/** 409 BATCH_OPEN while money of the provider is in flight: its webhooks, status queries and dispatch must keep working. */
async function assertNoMoneyInFlight(tx: Tx, providerId: string): Promise<void> {
  const { rows } = await tx.query<{ batch_id: string }>(
    `SELECT b.id AS batch_id FROM payout_batch b WHERE b.provider_config_id = $1 AND EXISTS (
       SELECT 1 FROM payout_instruction i WHERE i.batch_id = b.id AND i.state IN ('pending', 'instructed', 'accepted'))
     ORDER BY b.created_at LIMIT 1`,
    [providerId],
  )
  if (rows[0] !== undefined) throw new ApiError(409, 'BATCH_OPEN', 'Payouts through this provider are still in flight.', { batch_id: rows[0].batch_id })
}

async function lockProvider(tx: Tx, id: string, scope: readonly string[] | null): Promise<{ kind: string; market_id: string | null }> {
  const { rows } = await tx.query<{ kind: string; market_id: string | null; state: string }>(
    `SELECT kind, market_id, state FROM provider_config WHERE id = $1 AND ${PROVIDER_KINDS} FOR UPDATE`, [id])
  const row = rows[0]
  if (row === undefined || (scope !== null && (row.market_id === null || !scope.includes(row.market_id)))) throw notFound()
  if (row.state !== 'recorded') throw notRecorded()
  return row
}

/** D-B4-20: the review date of a recorded provider (null clears it). */
export async function setReviewDate(tx: Tx, id: string, scope: readonly string[] | null, reviewDueOn: string | null): Promise<ProviderView> {
  await lockProvider(tx, id, scope)
  const { rows } = await tx.query<{ before: string | null }>(
    `UPDATE provider_config p SET review_due_on = $2 FROM provider_config o WHERE p.id = $1 AND o.id = p.id
     RETURNING to_char(o.review_due_on, 'YYYY-MM-DD') AS before`,
    [id, reviewDueOn],
  )
  await recordAudit(tx, {
    action: 'PROVIDER.REVIEW_DATE_SET', objectType: 'provider_config', objectId: id,
    before: { review_due_on: rows[0]!.before }, after: { review_due_on: reviewDueOn },
  })
  return providerView(tx, id)
}

export const ADAPTERS = ['sandbox', 'bank_file_csv'] as const
export type Adapter = (typeof ADAPTERS)[number]
export const webhookSecretContext = (id: string): string => `provider_webhook:${id}`

/**
 * D-B4-14: a recorded payout provider gets the sandbox adapter (with its webhook signing secret, written once and never
 * returned) or the bank-file adapter. Refused while one of its batches is open or has money in flight.
 */
export async function configureAdapter(tx: Tx, key: Buffer, id: string, adapter: Adapter, secret: string | null): Promise<ProviderView> {
  // AC-PAY2-1: payment and commerce records alike (integration.manage reads connectors too, so this reveals nothing).
  const { rows: kinds } = await tx.query<{ kind: string }>('SELECT kind FROM provider_config WHERE id = $1', [id])
  if (kinds[0] !== undefined && kinds[0].kind !== 'payout') throw new ApiError(422, 'PROVIDER_KIND_NOT_PAYOUT', 'Adapters belong to payout providers only.')
  await lockProvider(tx, id, null)
  const { rows } = await tx.query<{ id: string }>(
    `SELECT b.id FROM payout_batch b WHERE b.provider_config_id = $1 AND (b.state IN ('draft', 'reviewed', 'approved', 'instructing')
       OR EXISTS (SELECT 1 FROM payout_instruction i WHERE i.batch_id = b.id AND i.state IN ('pending', 'instructed', 'accepted')))
     ORDER BY b.created_at LIMIT 1`, [id])
  if (rows[0] !== undefined) throw new ApiError(409, 'BATCH_OPEN', 'A batch of this provider is open or still paying.', { batch_id: rows[0].id })
  await tx.query('UPDATE provider_config SET adapter = $2, webhook_secret_sealed = $3 WHERE id = $1', [
    id, adapter, secret === null ? null : seal(key, secret, webhookSecretContext(id)),
  ])
  await recordAudit(tx, {
    action: 'PROVIDER.ADAPTER_CONFIGURED', objectType: 'provider_config', objectId: id, after: { adapter, secret_rotated: secret !== null },
  })
  return providerView(tx, id)
}
