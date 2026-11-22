import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'
import { encodeCursor } from '../../lib/pagination.js'
import { PERIOD_COLUMNS, PERIOD_FROM, periodInScope, type PeriodRow } from './period.js'
import { marketSync, preflight, taxRulesBlocker, type MarketSync } from './preflight.js'

// API-18/19 reads: periods with their blockers (§2.4) and runs. Scope: the calendar's market (D-B3-23).

const IN_SCOPE = '($1::uuid[] IS NULL OR c.market_id = ANY ($1))'

export interface PeriodFilter {
  readonly calendar_id?: string | undefined
  readonly state?: string | undefined
  readonly from?: string | undefined
  readonly to?: string | undefined
}

export interface PeriodCursor {
  readonly starts_at: string
  readonly id: string
}

async function calendars(tx: Tx, scope: readonly string[] | null) {
  const { rows } = await tx.query(
    `SELECT c.id, c.name, c.cadence, c.cutoff_time_zone, jsonb_build_object('id', m.id, 'code', m.code) AS market,
            (SELECT jsonb_build_object('id', pl.id, 'name', pl.name) FROM plan_calendar pc JOIN plan pl ON pl.id = pc.plan_id
             WHERE pc.calendar_id = c.id) AS plan,
            (SELECT jsonb_build_object('id', f.id, 'name', f.name) FROM calendar f WHERE f.id = c.provisional_for_calendar_id) AS provisional_for,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name, x.id)
                      FROM calendar x WHERE x.provisional_for_calendar_id = c.id), '[]') AS provisional_calendars
     FROM calendar c JOIN market m ON m.id = c.market_id WHERE ${IN_SCOPE} ORDER BY m.code, c.name, c.id`,
    [scope],
  )
  return rows
}

/** D-B6-04 close fields of a period (null until closed). */
const closeOf = (p: PeriodRow) => ({
  closed_at: p.closed_at, closed_by: p.closed_by, close_note: p.close_note, close_journal_export_id: p.close_journal_export_id,
})

const blockerView = ({ code, message, details }: { code: string; message: string; details: unknown }) => ({ code, message, details })

interface LateCounts { pending: number; decided: number; consumed: number }

/** Late items per state of each period, in one query for a page. */
async function lateCounts(tx: Tx, periodIds: readonly string[]): Promise<Map<string, LateCounts>> {
  const { rows } = await tx.query<LateCounts & { id: string }>(
    `SELECT original_period_id AS id, count(*) FILTER (WHERE state = 'pending')::int AS pending,
            count(*) FILTER (WHERE state = 'decided')::int AS decided, count(*) FILTER (WHERE state = 'consumed')::int AS consumed
     FROM late_transaction WHERE original_period_id = ANY ($1::uuid[]) GROUP BY original_period_id`,
    [periodIds],
  )
  return new Map(rows.map(({ id, ...counts }) => [id, counts]))
}

const lateOf = (counts: Map<string, LateCounts>, id: string): LateCounts => counts.get(id) ?? { pending: 0, decided: 0, consumed: 0 }

/** GET /v1/periods: the calendars in scope and one page of their periods, newest first. */
export async function listPeriods(tx: Tx, scope: readonly string[] | null, filter: PeriodFilter, after: PeriodCursor | undefined, limit: number) {
  const { rows } = await tx.query<PeriodRow & { latest_run: unknown }>(
    `SELECT ${PERIOD_COLUMNS},
            (SELECT jsonb_build_object('id', r.id, 'state', r.state, 'gross_minor', r.totals ->> 'gross_minor', 'finished_at', r.finished_at,
                                       'true_up_runs', (SELECT count(DISTINCT o.provisional_run_id)::int FROM adjustment_origin o WHERE o.run_id = r.id))
             FROM run r WHERE r.period_id = p.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_run
     ${PERIOD_FROM}
     WHERE ${IN_SCOPE} AND ($2::uuid IS NULL OR p.calendar_id = $2) AND ($3::text IS NULL OR p.state = $3)
       AND ($4::timestamptz IS NULL OR p.starts_at >= $4) AND ($5::timestamptz IS NULL OR p.ends_at <= $5)
       AND ($6::timestamptz IS NULL OR (p.starts_at, p.id) < ($6, $7::uuid))
     ORDER BY p.starts_at DESC, p.id DESC LIMIT $8`,
    [scope, filter.calendar_id ?? null, filter.state ?? null, filter.from ?? null, filter.to ?? null, after?.starts_at ?? null,
      after?.id ?? null, limit + 1],
  )
  const page = rows.slice(0, limit)
  const sync = new Map<string, MarketSync>()
  const lateByPeriod = await lateCounts(tx, page.map((period) => period.id))
  const periods = []
  for (const period of page) {
    if (!sync.has(period.market_id)) sync.set(period.market_id, await marketSync(tx, period.market_id))
    const late = lateOf(lateByPeriod, period.id)
    periods.push({
      id: period.id, calendar_id: period.calendar_id, starts_at: period.starts_at, ends_at: period.ends_at,
      cut_off_passed: period.cut_off_passed, state: period.state, committed_run_id: period.committed_run_id, ...closeOf(period), latest_run: period.latest_run,
      blockers: (await preflight(tx, period, sync.get(period.market_id))).map(blockerView),
      late: { pending: late.pending, decided: late.decided },
    })
  }
  const last = page.at(-1)
  const nextCursor = rows.length > limit && last !== undefined ? encodeCursor({ starts_at: last.starts_at.toISOString(), id: last.id }) : null
  return { data: { calendars: await calendars(tx, scope), periods }, meta: { next_cursor: nextCursor } }
}

const syncView = (sync: MarketSync) => ({ state: sync.state, last_sync_at: sync.last_sync_at, sources: sync.sources })

/** GET /v1/periods/:id. */
export async function periodDetail(tx: Tx, id: string, scope: readonly string[] | null) {
  const period = await periodInScope(tx, id, scope)
  const { rows: runs } = await tx.query(
    `SELECT r.id, r.state, r.run_request_id, jsonb_build_object('id', u.id, 'display_name', u.display_name) AS prepared_by,
            r.started_at, r.finished_at, r.totals ->> 'gross_minor' AS gross_minor
     FROM run r JOIN user_account u ON u.id = r.prepared_by WHERE r.period_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [id],
  )
  const { rows: version } = await tx.query(
    `SELECT jsonb_build_object('id', v.id, 'plan', jsonb_build_object('id', pl.id, 'name', pl.name), 'version', v.version) AS plan_version
     FROM plan_version v JOIN plan pl ON pl.id = v.plan_id WHERE v.id = plan_version_for_period($1)`,
    [id],
  )
  const { rows: restatements } = await tx.query(
    `SELECT s.id, s.case_id, CASE WHEN c.state = 'withdrawn' THEN 'withdrawn' ELSE s.state END AS state
     FROM restatement s JOIN case_file c ON c.id = s.case_id WHERE s.period_id = $1 ORDER BY s.created_at, s.id`,
    [id],
  )
  const sync = await marketSync(tx, period.market_id)
  const taxRules = await taxRulesBlocker(tx, period)
  return {
    id: period.id, calendar_id: period.calendar_id, market_id: period.market_id, starts_at: period.starts_at, ends_at: period.ends_at,
    cut_off_passed: period.cut_off_passed, state: period.state, committed_run_id: period.committed_run_id, ...closeOf(period), runs,
    plan_version: (version[0] as { plan_version: unknown } | undefined)?.plan_version ?? null,
    blockers: [...(await preflight(tx, period, sync)), ...(taxRules === null ? [] : [taxRules])].map(blockerView), sync: syncView(sync), late: lateOf(await lateCounts(tx, [id]), id), restatements,
  }
}

export interface RunView {
  readonly id: string
  readonly period_id: string
  readonly market_id: string
  readonly state: string
  readonly plan_version_id: string
  readonly settings_version_id: string
  readonly prepared_by: string
  readonly commit_requested_by: string | null
  readonly review_opened_at: Date | null
  readonly totals: Record<string, unknown> | null
  readonly outputs: Record<string, unknown> | null
  readonly snapshot_id: string | null
  readonly inputs_hash: string | null
  readonly lines_hash: string | null
  readonly engine_version: string
}

/** The run (any state) when its calendar's market is in scope; 404 otherwise. */
export async function runInScope(tx: Tx, id: string, scope: readonly string[] | null, lock = false): Promise<RunView> {
  const { rows } = await tx.query<RunView>(
    `SELECT r.id, r.period_id, c.market_id, r.state, r.plan_version_id, r.settings_version_id, r.prepared_by, r.commit_requested_by,
            r.review_opened_at, r.totals, r.outputs, r.snapshot_id, r.inputs_hash, r.lines_hash, r.engine_version
     FROM run r JOIN period p ON p.id = r.period_id JOIN calendar c ON c.id = p.calendar_id WHERE r.id = $1
     ${lock ? 'FOR UPDATE OF r' : ''}`,
    [id],
  )
  const run = rows[0]
  if (run === undefined || (scope !== null && !scope.includes(run.market_id))) throw notFound()
  return run
}

/** GET /v1/runs/:id. */
export async function runDetail(tx: Tx, id: string, scope: readonly string[] | null) {
  await runInScope(tx, id, scope)
  const { rows } = await tx.query(
    `SELECT r.id, r.period_id, r.state, r.run_request_id, r.progress, r.totals, r.error, r.settings_version_id, r.inputs_hash,
            r.lines_hash, r.engine_version, jsonb_build_object('id', u.id, 'display_name', u.display_name) AS prepared_by,
            r.review_opened_at, r.review_opened_by, r.commit_requested_at, r.commit_requested_by, r.approval_id, r.started_at,
            r.finished_at, r.committed_at, r.created_at,
            jsonb_build_object('id', v.id, 'plan', jsonb_build_object('id', pl.id, 'name', pl.name), 'version', v.version) AS plan_version,
            (SELECT jsonb_build_object('known_at', s.known_at, 'row_counts', s.row_counts - 'late_item_ids')
             FROM run_snapshot s WHERE s.id = r.snapshot_id) AS snapshot,
            (SELECT e.id FROM journal_entry e WHERE e.origin_type = 'run' AND e.origin_id = r.id) AS journal_entry_id,
            CASE WHEN c.provisional_for_calendar_id IS NOT NULL THEN jsonb_build_object('final_period_id', provisional_final_period(p.id),
              'final_calendar_id', c.provisional_for_calendar_id) END AS provisional,
            (SELECT jsonb_build_object('provisional_run_ids', jsonb_agg(DISTINCT o.provisional_run_id ORDER BY o.provisional_run_id),
                                       'offsets_minor', sum(o.amount_minor)::text)
             FROM adjustment_origin o WHERE o.run_id = r.id AND o.provisional_run_id IS NOT NULL HAVING count(*) > 0) AS true_up,
            (SELECT coalesce(sum(a.amount_minor), 0)::text FROM credit_award a WHERE a.run_id = r.id) AS credit_awards_minor
     FROM run r JOIN user_account u ON u.id = r.prepared_by JOIN plan_version v ON v.id = r.plan_version_id JOIN plan pl ON pl.id = v.plan_id
     JOIN period p ON p.id = r.period_id JOIN calendar c ON c.id = p.calendar_id
     WHERE r.id = $1`,
    [id],
  )
  return rows[0]
}
