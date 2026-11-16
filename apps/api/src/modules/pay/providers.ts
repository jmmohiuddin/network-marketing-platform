import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'

// D-B1-12: B1 records a payment or payout provider's eligibility for a market (approval, evidence, date, funds
// holder; BR-PAY-11). No credentials and no adapter calls: those arrive in B4 with sandbox adapters only.

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
         to_char(p.approved_at, 'YYYY-MM-DD') AS approved_at, p.funds_holder, p.state, p.created_by,
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
     FROM provider_config WHERE market_id = $1 AND state = 'recorded' AND kind IN ('payout', 'payment')
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
     WHERE ($1::uuid[] IS NULL OR p.market_id = ANY ($1)) AND ($2::uuid IS NULL OR p.market_id = $2)
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
         approved_at, funds_holder, state, created_by)
       VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, 'recorded', current_setting('app.user_id')::uuid) RETURNING id`,
      [input.market_id, input.kind, input.provider, input.approved_description, input.approval_document_id, input.approved_at, input.funds_holder],
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
  const { rows: found } = await tx.query<{ market_id: string | null }>('SELECT market_id FROM provider_config WHERE id = $1', [id])
  if (found[0] === undefined || (scope !== null && (found[0].market_id === null || !scope.includes(found[0].market_id)))) throw notFound()
  if (found[0].market_id !== null) await lockMarketForProviders(tx, found[0].market_id) // market first, as go-live does
  const { rows } = await tx.query<{ market_id: string | null; state: string }>('SELECT market_id, state FROM provider_config WHERE id = $1 FOR UPDATE', [id])
  const row = rows[0]!
  if (row.state !== 'recorded') throw new ApiError(409, 'PROVIDER_NOT_RECORDED', 'This provider approval is already withdrawn.')
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
