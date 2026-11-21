import type { Tx } from '@nmp/db'
import { ApiError } from '../../lib/errors.js'
import { syncHealth } from '../int/index.js'
import { previousPeriod, type PeriodRow } from './period.js'
import { provisionalBlockers } from './provisional.js'
import { withholdingInstructions } from './snapshot.js'

// §2.4 run preflight (one function for POST /v1/periods/:id/runs and the blockers of GET /v1/periods) and the sync
// health of a period's market (D-B3-10).

export interface Blocker {
  readonly status: 409 | 422
  readonly code: string
  readonly message: string
  readonly details: Record<string, unknown>
}

interface Source {
  readonly source: string
  readonly kind: 'connector' | 'api'
  readonly name: string
  readonly state: string
  readonly last_success_at: Date | null
  readonly market?: { id: string } | null
}

export interface MarketSync {
  /** Worst state of the relevant sources; 'none' when the market has none. */
  readonly state: 'failing' | 'behind' | 'thresholds_not_set' | 'healthy' | 'none'
  readonly thresholds_set: boolean
  readonly last_sync_at: Date | null
  readonly sources: readonly { source: string; name: string; state: string; last_success_at: Date | null }[]
  /** Behind or failing sources: they block a run (SYNC_BEHIND) and a commit (exception sync_stale). */
  readonly blocking: readonly { source: string; name: string; state: string; last_success_at: Date | null }[]
}

const SEVERITY = ['none', 'healthy', 'thresholds_not_set', 'behind', 'failing'] as const

/**
 * D-B3-10: the market's connectors and the API sources that delivered an order of the market. Without thresholds a
 * source is only ever failing or thresholds_not_set (int stateOf), so only failing blocks.
 */
export async function marketSync(tx: Tx, marketId: string): Promise<MarketSync> {
  const health = await syncHealth(tx)
  const sources = health.sources as unknown as Source[]
  // One probe per API source: sales_order's unique (tenant_id, source_system, source_order_id) index finds the
  // source's first order of the market, instead of reading every order of the market.
  const { rows } = await tx.query<{ source: string }>(
    `SELECT s.source FROM unnest($2::text[]) AS s(source)
     WHERE EXISTS (SELECT 1 FROM sales_order o WHERE o.source_system = substr(s.source, 5) AND o.market_id = $1)`,
    [marketId, sources.filter((s) => s.kind === 'api').map((s) => s.source)],
  )
  const apiSources = new Set(rows.map((row) => row.source))
  const relevant = sources
    .filter((s) => (s.kind === 'connector' && s.market?.id === marketId) || (s.kind === 'api' && apiSources.has(s.source)))
    .map((s) => ({ source: s.source, name: s.name, state: s.state, last_success_at: s.last_success_at }))
  const blocking = relevant.filter((s) => s.state === 'behind' || s.state === 'failing')
  const state = relevant.reduce<MarketSync['state']>(
    (worst, s) => (SEVERITY.indexOf(s.state as MarketSync['state']) > SEVERITY.indexOf(worst) ? (s.state as MarketSync['state']) : worst),
    'none',
  )
  const times = blocking.map((s) => s.last_success_at).filter((at): at is Date => at !== null)
  const lastSync = times.length === 0 ? null : new Date(Math.min(...times.map((at) => at.getTime())))
  return { state, thresholds_set: health.thresholds !== null, last_sync_at: lastSync, sources: relevant, blocking }
}

const blocker = (status: 409 | 422, code: string, message: string, details: Record<string, unknown> = {}): Blocker => ({ status, code, message, details })

const CLOSED = ['committed', 'paid', 'closed']

/** Every reason the period cannot be calculated now, in §2.4 order (empty = a run may be requested). */
export async function preflight(tx: Tx, period: PeriodRow, sync?: MarketSync): Promise<Blocker[]> {
  const blockers: Blocker[] = await provisionalBlockers(tx, period)
  if (CLOSED.includes(period.state)) blockers.push(blocker(409, 'PERIOD_COMMITTED', 'The period is already committed.'))
  if (!period.cut_off_passed) blockers.push(blocker(422, 'BEFORE_CUTOFF', 'The period has not reached its cut-off yet.', { ends_at: period.ends_at }))
  const { rows } = await tx.query<{ version: string | null }>('SELECT plan_version_for_period($1) AS version', [period.id])
  if (rows[0]!.version === null) blockers.push(blocker(422, 'PLAN_VERSION_MISSING', 'No plan version is in force for this period.'))
  const previous = await previousPeriod(tx, period)
  if (previous !== null) {
    const { rows: covered } = await tx.query<{ version: string | null }>('SELECT plan_version_for_period($1) AS version', [previous.id])
    if (covered[0]!.version !== null && !CLOSED.includes(previous.state)) {
      blockers.push(blocker(422, 'PRIOR_PERIOD_OPEN', 'Commit the previous period of this calendar first.', { period_id: previous.id }))
    } else if (covered[0]!.version !== null && previous.committed_run_id === null) {
      blockers.push(blocker(422, 'PRIOR_STATE_MISSING', 'The previous period was committed without a run: its qualification state must be migrated first.', { period_id: previous.id }))
    }
  }
  const migration = await migrationBlocker(tx, period.id)
  if (migration !== null) blockers.push(migration)
  const health = sync ?? (await marketSync(tx, period.market_id))
  if (health.blocking.length > 0) {
    blockers.push(blocker(422, 'SYNC_BEHIND', 'Order sync of this market is behind or failing.', {
      last_sync_at: health.last_sync_at, sources: health.blocking,
    }))
  }
  return blockers
}

/**
 * D-B6-11: the period is the cutover of a migration that is not signed off (SQL mig_period_blocker), so it neither runs
 * nor commits before the opening is posted and the parallel run signed off.
 */
async function migrationBlocker(tx: Tx, periodId: string): Promise<Blocker | null> {
  const { rows } = await tx.query<{ blocker: { migration_id: string; state: string } | null }>('SELECT mig_period_blocker($1) AS blocker', [periodId])
  const found = rows[0]!.blocker
  return found === null ? null : blocker(422, 'MIGRATION_NOT_SIGNED_OFF', "The market's migration must be signed off before its cutover period runs or commits.", {
    migration_id: found.migration_id, state: found.state,
  })
}

/** Commit: refused while the period's migration is not signed off. */
export async function assertMigrationSignedOff(tx: Tx, periodId: string): Promise<void> {
  const found = await migrationBlocker(tx, periodId)
  if (found !== null) throw new ApiError(found.status, found.code, found.message, found.details)
}

/**
 * Single-period view: the pack's withholding rules that would refuse POST runs (422 TAX_RULES_INVALID, D-BM-03), as a
 * blocker. Under a savepoint, since the SQL refusal (TX001) aborts the transaction. Not on the period list: the SQL reads
 * every payee's committed gross of the tax year.
 */
export async function taxRulesBlocker(tx: Tx, period: PeriodRow): Promise<Blocker | null> {
  if (CLOSED.includes(period.state)) return null
  await tx.query('SAVEPOINT tax_rules')
  try {
    await withholdingInstructions(tx, period.id)
    await tx.query('RELEASE SAVEPOINT tax_rules')
    return null
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    await tx.query('ROLLBACK TO SAVEPOINT tax_rules')
    return blocker(422, error.code, error.message, error.details as Record<string, unknown>)
  }
}

/** POST runs: the first blocker, as an error. */
export async function assertRunnable(tx: Tx, period: PeriodRow): Promise<void> {
  const first = (await preflight(tx, period))[0]
  if (first !== undefined) throw new ApiError(first.status, first.code, first.message, first.details)
  await withholdingInstructions(tx, period.id) // 422 TAX_RULES_INVALID before a run is queued (D-BM-03)
}
