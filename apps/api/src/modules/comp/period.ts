import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'
import { getSettingsVersion } from '../ten/index.js'
import type { RoundingMode } from './rounding.js'

// Periods and calendars are TEN rows COMP reads in SQL (D-B3-01). Instants stay text: `*_us` are epoch microseconds
// computed in SQL (exact numeric epoch), never round-tripped through a JS Date.

/** SQL: epoch microseconds of a timestamptz column as decimal text. */
export const us = (column: string): string => `(extract(epoch FROM ${column}) * 1000000)::bigint::text`

export interface PeriodRow {
  readonly id: string
  readonly calendar_id: string
  readonly market_id: string
  readonly currency: string
  readonly minor_unit: number
  readonly starts_at: Date
  readonly ends_at: Date
  readonly starts_us: string
  readonly ends_us: string
  readonly state: string
  readonly committed_run_id: string | null
  readonly cut_off_passed: boolean
  readonly closed_at: Date | null
  readonly closed_by: string | null
  readonly close_note: string | null
  readonly close_journal_export_id: string | null
}

export const PERIOD_COLUMNS = `p.id, p.calendar_id, c.market_id, m.currency, m.minor_unit::int AS minor_unit, p.starts_at, p.ends_at,
  ${us('p.starts_at')} AS starts_us, ${us('p.ends_at')} AS ends_us, p.state, p.committed_run_id, now() >= p.ends_at AS cut_off_passed,
  p.closed_at, p.closed_by, p.close_note, p.close_journal_export_id`
export const PERIOD_FROM = 'FROM period p JOIN calendar c ON c.id = p.calendar_id JOIN market m ON m.id = c.market_id'
export const PERIOD_SELECT = `SELECT ${PERIOD_COLUMNS} ${PERIOD_FROM}`

/** The period when it exists and its market is in scope (null = all markets); 404 otherwise. */
export async function periodInScope(tx: Tx, id: string, scope: readonly string[] | null, lock = false): Promise<PeriodRow> {
  const { rows } = await tx.query<PeriodRow>(`${PERIOD_SELECT} WHERE p.id = $1 ${lock ? 'FOR UPDATE OF p' : ''}`, [id])
  const period = rows[0]
  if (period === undefined || (scope !== null && !scope.includes(period.market_id))) throw notFound()
  return period
}

export async function loadPeriod(tx: Tx, id: string, lock = false): Promise<PeriodRow> {
  return periodInScope(tx, id, null, lock)
}

/** The period of the same calendar ending where this one starts, or null (the calendar's first period). */
export async function previousPeriod(tx: Tx, period: PeriodRow): Promise<PeriodRow | null> {
  const { rows } = await tx.query<PeriodRow>(
    `${PERIOD_SELECT} WHERE p.calendar_id = $1 AND p.ends_at = (SELECT starts_at FROM period WHERE id = $2)`,
    [period.calendar_id, period.id],
  )
  return rows[0] ?? null
}

/** D-B3-09: serialises run requests, workers and commits of one period. */
export async function lockRunKey(tx: Tx, period: Pick<PeriodRow, 'id' | 'calendar_id'>): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('run:' || app_tenant_id() || ':' || $1 || ':' || $2, 0))`, [
    period.calendar_id, period.id,
  ])
}

/** D-B3-05: commit holds the market's periods exclusively while ORD's late detection holds it shared. */
export async function lockMarketPeriods(tx: Tx, marketId: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('periods:' || app_tenant_id() || ':' || $1, 0))`, [marketId])
}

/** D-B4-09: the periods lock shared, without waiting; false while a commit of the market holds or awaits it. */
export async function tryShareMarketPeriods(tx: Tx, marketId: string): Promise<boolean> {
  const { rows } = await tx.query<{ held: boolean }>(
    `SELECT pg_try_advisory_xact_lock_shared(hashtextextended('periods:' || app_tenant_id() || ':' || $1, 0)) AS held`, [marketId])
  return rows[0]!.held
}

export interface RunSettingsRow {
  readonly versionId: string
  readonly roundingMode: RoundingMode
  readonly restockingFeeAffectsVolume: boolean
  readonly largeLineMinor: string | null
}

/** The tenant settings version in force at the period's last instant (ends_at - 1 µs), or null when none exists. */
export async function settingsVersionAt(tx: Tx, periodId: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT v.id FROM tenant_setting_version v, period p
     WHERE p.id = $1 AND v.effective_from <= p.ends_at - interval '1 microsecond'
     ORDER BY v.effective_from DESC, v.version DESC LIMIT 1`,
    [periodId],
  )
  return rows[0]?.id ?? null
}

/** RunSettings of a version (§0.1): rounding half_up when unset (BR-MNY-02); restocking fee proportional only when set. */
export async function runSettings(tx: Tx, versionId: string): Promise<RunSettingsRow> {
  const version = await getSettingsVersion(tx, versionId)
  if (version === null) throw new Error(`settings version ${versionId} does not exist`)
  const values = version.values
  return {
    versionId,
    roundingMode: values['money.rounding_mode'] ?? 'half_up',
    restockingFeeAffectsVolume: values['orders.restocking_fee_volume_effect'] === 'proportional',
    largeLineMinor: values['runs.exception_thresholds']?.large_line_minor ?? null,
  }
}
