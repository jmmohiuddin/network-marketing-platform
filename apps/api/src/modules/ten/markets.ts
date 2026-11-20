import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { invalidField, isCountryCode, validateMarketFields } from './market-validation.js'
import { pgCode } from './pg.js'
import { inScope } from './scope.js'
import { recordStructureChange } from './structure.js'

export type MarketState = 'draft' | 'live' | 'suspended'

export interface MarketView {
  id: string
  code: string
  name: string
  currency: string
  state: MarketState
  market_pack: string
  time_zone: string
  languages: string[]
  minor_unit: number
}

// The market table has no name column (DATABASE.md): the name is the ISO region name of the code.
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

/** The English name of a market's country or region; the code itself when it is not an ISO region code. */
export function marketName(code: string): string {
  try {
    return REGION_NAMES.of(code) ?? code
  } catch {
    return code // RangeError: not a well-formed region code (only rows written outside provisioning)
  }
}

const MARKET_COLUMNS = 'id, code, currency, state, market_pack, time_zone, languages, minor_unit'
type MarketRow = Omit<MarketView, 'name'>
const view = (row: MarketRow): MarketView => ({ ...row, name: marketName(row.code) })

/** The caller's tenant's markets (RLS), ordered by code. */
export async function listMarkets(tx: Tx): Promise<MarketView[]> {
  const { rows } = await tx.query<MarketRow>(`SELECT ${MARKET_COLUMNS} FROM market ORDER BY code`)
  return rows.map(view)
}

/** One market of the caller's tenant, or null (TEN facade for B2/B3). */
export async function getMarket(tx: Tx, id: string): Promise<MarketView | null> {
  const { rows } = await tx.query<MarketRow>(`SELECT ${MARKET_COLUMNS} FROM market WHERE id = $1`, [id])
  return rows[0] === undefined ? null : view(rows[0])
}

/** AC-38.2: enrolment and order ingestion (B2) accept only a live market of the tenant. */
export async function assertMarketLive(tx: Tx, marketId: string): Promise<void> {
  const market = await getMarket(tx, marketId)
  if (market?.state !== 'live') {
    throw new ApiError(422, 'MARKET_NOT_LIVE', 'This market is not live yet: complete its launch checklist first.', {
      market_id: marketId, state: market?.state ?? null,
    })
  }
}

export async function lockMarket(tx: Tx, id: string, scope: readonly string[] | null): Promise<MarketView> {
  if (!inScope(scope, id)) throw notFound()
  const { rows } = await tx.query<MarketRow>(`SELECT ${MARKET_COLUMNS} FROM market WHERE id = $1 FOR UPDATE`, [id])
  if (rows[0] === undefined) throw notFound()
  return view(rows[0])
}

export type MarketReferences = Record<string, number>

export async function marketReferences(tx: Tx, id: string): Promise<MarketReferences> {
  const { rows } = await tx.query<{ refs: MarketReferences }>('SELECT market_references($1) AS refs', [id])
  return rows[0]!.refs
}

const referenced = (refs: MarketReferences) => Object.values(refs).some((count) => count > 0)

/** GET /v1/markets/:id: the market, what references it and whether it can be deleted. */
export async function marketDetail(tx: Tx, id: string, scope: readonly string[] | null) {
  if (!inScope(scope, id)) throw notFound()
  const market = await getMarket(tx, id)
  if (market === null) throw notFound()
  const references = await marketReferences(tx, id)
  return { ...market, references, deletable: market.state === 'draft' && !referenced(references) }
}

export interface NewMarket {
  readonly code: string
  readonly currency: string
  readonly time_zone: string
  readonly languages: readonly string[]
  readonly market_pack: string
  readonly reason: string
}

/** AC-TEN2-1/2/7: a draft market with ISO-validated codes; minor_unit from the pinned ISO 4217 table. */
export async function createMarket(tx: Tx, input: NewMarket): Promise<MarketView> {
  if (!isCountryCode(input.code)) throw invalidField('code', 'not an ISO 3166-1 alpha-2 country code')
  const { languages, minorUnit } = validateMarketFields(input)
  let row: MarketRow
  try {
    const { rows } = await tx.query<MarketRow>(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state, created_by)
       VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, 'draft', current_setting('app.user_id')::uuid)
       RETURNING ${MARKET_COLUMNS}`,
      [input.code, input.currency, minorUnit, input.time_zone, languages, input.market_pack],
    )
    row = rows[0]!
  } catch (error) {
    if (pgCode(error) === '23505') throw new ApiError(409, 'MARKET_CODE_TAKEN', `The tenant already has market ${input.code}.`)
    throw error
  }
  await recordAudit(tx, { action: 'MARKET.CREATED', objectType: 'market', objectId: row.id, after: { code: row.code, currency: row.currency }, reason: input.reason })
  await recordStructureChange(tx, input.reason)
  return view(row)
}

export interface MarketPatch {
  readonly time_zone?: string
  readonly languages?: readonly string[]
  readonly market_pack?: string
  readonly currency?: string
  readonly reason: string
}

/**
 * PATCH: zone and languages any time; pack and currency only while draft with no pending go-live, pack only without a
 * grievance, currency only while unreferenced.
 */
export async function updateMarket(tx: Tx, id: string, scope: readonly string[] | null, patch: MarketPatch): Promise<MarketView> {
  const market = await lockMarket(tx, id, scope)
  const { languages, minorUnit } = validateMarketFields(patch)
  if ((patch.market_pack !== undefined || patch.currency !== undefined) && market.state !== 'draft') {
    throw new ApiError(409, 'MARKET_NOT_DRAFT', 'The pack and currency of a market change only while it is a draft.', { state: market.state })
  }
  if (patch.market_pack !== undefined || patch.currency !== undefined) {
    // A pending go-live request was checked against this pack and currency (AC-TEN4-2).
    const { rowCount } = await tx.query(`SELECT 1 FROM market_go_live_request WHERE market_id = $1 AND state = 'pending'`, [id])
    if (rowCount !== 0) throw new ApiError(409, 'GO_LIVE_PENDING', 'A go-live request is waiting for sign-off: decide or withdraw it first.')
  }
  if (patch.market_pack !== undefined && patch.market_pack !== market.market_pack) {
    // BUG-130: a grievance's deadlines come from the pack in force when it was received (cpl grievance-case.ts).
    const { rows: counted } = await tx.query<{ grievances: number }>(
      `SELECT count(*)::int AS grievances FROM case_file WHERE market_id = $1 AND type = 'grievance'`, [id])
    const grievances = counted[0]!.grievances
    if (grievances !== 0) {
      throw new ApiError(409, 'MARKET_REFERENCED', 'The pack cannot change once the market has a grievance: its deadlines come from the pack.', {
        references: { grievances },
      })
    }
  }
  if (patch.currency !== undefined && patch.currency !== market.currency) {
    const references = await marketReferences(tx, id)
    if (referenced(references)) throw new ApiError(409, 'MARKET_REFERENCED', 'The currency cannot change once the market is referenced.', { references })
  }
  const { rows } = await tx.query<MarketRow>(
    `UPDATE market SET time_zone = coalesce($2, time_zone), languages = coalesce($3, languages),
       market_pack = coalesce($4, market_pack), currency = coalesce($5, currency), minor_unit = coalesce($6, minor_unit)
     WHERE id = $1 RETURNING ${MARKET_COLUMNS}`,
    [id, patch.time_zone ?? null, languages ?? null, patch.market_pack ?? null, patch.currency ?? null, minorUnit ?? null],
  )
  const updated = view(rows[0]!)
  const fields = (['time_zone', 'languages', 'market_pack', 'currency'] as const).filter((field) => patch[field] !== undefined)
  await recordAudit(tx, {
    action: 'MARKET.UPDATED', objectType: 'market', objectId: id,
    before: Object.fromEntries(fields.map((field) => [field, market[field]])),
    after: Object.fromEntries(fields.map((field) => [field, updated[field]])), reason: patch.reason,
  })
  await recordStructureChange(tx, patch.reason)
  return updated
}

/** AC-TEN2-3: only an unreferenced draft market is deleted; a residual foreign key also answers MARKET_REFERENCED. */
export async function deleteMarket(tx: Tx, id: string, scope: readonly string[] | null, reason: string): Promise<void> {
  const market = await lockMarket(tx, id, scope)
  if (market.state !== 'draft') throw new ApiError(409, 'MARKET_NOT_DRAFT', 'Only a draft market can be deleted.', { state: market.state })
  const references = await marketReferences(tx, id)
  if (referenced(references)) throw new ApiError(409, 'MARKET_REFERENCED', 'The market is referenced and cannot be deleted.', { references })
  await tx.query('SAVEPOINT market_delete')
  try {
    await tx.query('DELETE FROM market WHERE id = $1', [id])
  } catch (error) {
    if (pgCode(error) !== '23503') throw error
    await tx.query('ROLLBACK TO SAVEPOINT market_delete')
    throw new ApiError(409, 'MARKET_REFERENCED', 'The market is referenced and cannot be deleted.', { references: await marketReferences(tx, id) })
  }
  await recordAudit(tx, { action: 'MARKET.DELETED', objectType: 'market', objectId: id, before: { code: market.code }, reason })
  await recordStructureChange(tx, reason)
}
