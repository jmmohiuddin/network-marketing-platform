import { createHash } from 'node:crypto'
import { METHOD_VERSION, type ReportCode } from '@nmp/compliance'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { enqueue } from '../../lib/jobs.js'
import { loadedBatches, tryLockLoads } from '../imp/index.js'
import { getEffectiveSettings } from '../ten/index.js'
import { computeSnapshotJob } from './compute.js'
import {
  SNAPSHOT_COLUMNS, toSnapshot, type InputRefs, type MarketScope, type Snapshot, type SnapshotRecord,
} from './snapshot-row.js'

// R5 states earnings in currency units with two decimals (@nmp/compliance r5.ts assumes 100 minor units).
const R5_MINOR_UNIT = 2

export interface SnapshotRequest {
  readonly market: string
  /** 'YYYY-MM', inclusive */
  readonly periodFrom: string
  readonly periodTo: string
  readonly reports: readonly ReportCode[]
  /** Markets the caller may create snapshots for (snapshot.create). */
  readonly scope: MarketScope
}

function inScope(scope: MarketScope, marketId: string): boolean {
  return scope === null || scope.includes(marketId)
}

/** A market of the tenant by code. Unknown and out-of-scope markets look the same (no existence leak). */
async function resolveMarket(tx: Tx, request: SnapshotRequest): Promise<string> {
  const { rows } = await tx.query<{ id: string; minor_unit: number }>('SELECT id, minor_unit FROM market WHERE code = $1', [
    request.market,
  ])
  const market = rows[0]
  if (market === undefined || !inScope(request.scope, market.id)) {
    throw new ApiError(422, 'MARKET_UNKNOWN', 'The market does not exist.')
  }
  if (request.reports.includes('R5') && market.minor_unit !== R5_MINOR_UNIT) {
    throw new ApiError(422, 'CURRENCY_NOT_SUPPORTED', 'R5 states earnings for currencies with two decimals only. Request the other reports for this market.')
  }
  return market.id
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 'YYYY-MM-DD'.length)
}

const MONTHS_IN_YEAR = 12

/** Every month 'YYYY-MM' from `from` to `to`, inclusive. */
function monthsOf(from: string, to: string): string[] {
  const index = (month: string): number => Number(month.slice(0, 4)) * MONTHS_IN_YEAR + Number(month.slice(5, 7)) - 1
  const label = (value: number): string =>
    `${Math.floor(value / MONTHS_IN_YEAR)}-${String((value % MONTHS_IN_YEAR) + 1).padStart(2, '0')}`
  return Array.from({ length: index(to) - index(from) + 1 }, (_, offset) => label(index(from) + offset))
}

const sortedDistinct = <T extends string | number>(values: readonly T[]): T[] =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * The loaded batches behind the range, under the market's input lock (migration 0030): a batch load that
 * commits after this point waits for the new snapshot and then retires it. API-04: every month of the range
 * must lie in a loaded batch, or the snapshot would state figures for months it has no data for.
 */
async function loadedInputs(tx: Tx, marketId: string, request: SnapshotRequest): Promise<Omit<InputRefs, 'reports'>> {
  await tx.query('SELECT cpl_lock_inputs(app_tenant_id(), $1)', [marketId])
  const batches = await loadedBatches(tx, marketId, `${request.periodFrom}-01`, monthEnd(request.periodTo))
  const uncovered = monthsOf(request.periodFrom, request.periodTo).filter(
    (month) => !batches.some((batch) => batch.periodFrom.slice(0, 7) <= month && month <= batch.periodTo.slice(0, 7)),
  )
  if (uncovered.length > 0) {
    throw new ApiError(422, 'NO_DATA_FOR_RANGE', 'Loaded imports of this market do not cover every month of the period range.', {
      uncovered_months: uncovered,
    })
  }
  return {
    batch_ids: sortedDistinct(batches.map((batch) => batch.id)),
    mapping_ids: sortedDistinct(batches.map((batch) => batch.mappingId)),
    mapping_versions: sortedDistinct(batches.map((batch) => batch.mappingVersion)),
  }
}

function inputsHash(fields: Record<string, unknown>): Buffer {
  return createHash('sha256').update(JSON.stringify(fields)).digest()
}

/**
 * API-04: records a computing snapshot on the market's loaded batches for the range, with the settings version
 * in force and the method version (BR-CPL-01), and queues its computation in the same transaction.
 */
export async function createSnapshot(tx: Tx, request: SnapshotRequest): Promise<Snapshot> {
  const marketId = await resolveMarket(tx, request)
  if (!(await tryLockLoads(tx, marketId))) {
    throw new ApiError(409, 'INPUTS_CHANGING', 'An import is being loaded into this market. Create the snapshot when the load has finished.')
  }
  const periodFrom = `${request.periodFrom}-01`
  const periodTo = monthEnd(request.periodTo)
  const loaded = await loadedInputs(tx, marketId, request)
  const settings = await getEffectiveSettings(tx)
  const inputs: InputRefs = { ...loaded, reports: [...request.reports] }
  const settingsVersionId = settings?.versionId ?? null
  const mappingId = loaded.mapping_ids.length === 1 ? loaded.mapping_ids[0]! : null
  const hash = inputsHash({
    market_id: marketId, period_from: periodFrom, period_to: periodTo, settings_version_id: settingsVersionId,
    method_version: METHOD_VERSION, ...inputs,
  })
  const { rows } = await tx.query<SnapshotRecord>(
    `INSERT INTO compliance_report_snapshot (tenant_id, market_id, period_from, period_to, method_version, mapping_id,
       settings_version_id, input_refs, state, created_by, inputs_hash)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, 'computing', current_setting('app.user_id')::uuid, $8)
     RETURNING ${SNAPSHOT_COLUMNS}`,
    [marketId, periodFrom, periodTo, METHOD_VERSION, mappingId, settingsVersionId, inputs, hash],
  )
  const snapshot = toSnapshot(rows[0]!)
  await recordAudit(tx, {
    action: 'SNAPSHOT.CREATED', objectType: 'compliance_report_snapshot', objectId: snapshot.id,
    after: {
      state: snapshot.state, market_id: marketId, period_from: request.periodFrom, period_to: request.periodTo,
      reports: inputs.reports, batch_count: inputs.batch_ids.length, settings_version_id: settingsVersionId,
    },
  })
  await enqueue(tx, computeSnapshotJob, { snapshotId: snapshot.id })
  return snapshot
}

/** One snapshot of the caller's tenant (RLS) within the caller's markets; anything else is 404. */
export async function findSnapshot(tx: Tx, id: string, scope: MarketScope): Promise<Snapshot> {
  const { rows } = await tx.query<SnapshotRecord>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM compliance_report_snapshot WHERE id = $1 AND ($2::uuid[] IS NULL OR market_id = ANY ($2))`,
    [id, scope],
  )
  if (rows[0] === undefined) throw notFound()
  return toSnapshot(rows[0])
}

/** Newest first; afterId is the last snapshot of the previous page. Fetches limit + 1 rows for toPage. */
export async function listSnapshots(tx: Tx, scope: MarketScope, afterId: string | undefined, limit: number): Promise<Snapshot[]> {
  const { rows } = await tx.query<SnapshotRecord>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM compliance_report_snapshot
     WHERE ($1::uuid[] IS NULL OR market_id = ANY ($1))
       AND ($2::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM compliance_report_snapshot WHERE id = $2))
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [scope, afterId ?? null, limit + 1],
  )
  return rows.map(toSnapshot)
}
