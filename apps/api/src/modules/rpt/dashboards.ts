import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'
import { syncHealth } from '../int/index.js'

// D-B6-07 role dashboards, computed on read from committed data only (FR-RPT-001). Money as bigint minor-unit strings,
// percentages by integer arithmetic. shortcut: computed per request; add a projection refreshed on commit and ingestion
// when a dashboard read exceeds 300 ms p95.

export const DASHBOARD_TREND_PERIODS = 12

type Scope = readonly string[] | null

const FINISHED = `('committed', 'paid', 'closed')`

/** part / whole in percent, rounded half up (away from zero) to 2 decimals; null when whole <= 0. */
export function percentHalfUp(part: bigint, whole: bigint): string | null {
  if (whole <= 0n) return null
  const magnitude = part < 0n ? -part : part
  const hundredths = (magnitude * 20_000n + whole) / (2n * whole)
  const text = `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`
  return part < 0n && hundredths !== 0n ? `-${text}` : text
}

interface PeriodFigures {
  readonly id: string
  readonly starts_at: Date
  readonly ends_at: Date
  readonly state: string
  readonly run_id: string | null
  readonly net_sales_minor: string
  readonly payout_minor: string | null
  readonly active_earners: number
}

/**
 * Per period: net sales = amounts credited in [starts_at, ends_at) minus the money returned by order events occurring in
 * it (every type: refunds, returns, chargebacks, cancellations, unequal exchanges) plus chargebacks reversed in it, as
 * the late-event estimate signs them (0302); orders of the period's market. Payout = the committed run's gross;
 * earners = payees of that run with gross > 0. Oldest first.
 */
async function periodFigures(tx: Tx, periodIds: readonly string[]): Promise<PeriodFigures[]> {
  const { rows } = await tx.query<PeriodFigures>(
    `SELECT p.id, p.starts_at, p.ends_at, p.state, p.committed_run_id AS run_id,
            (coalesce(sales.total, 0) - coalesce(refunds.total, 0))::text AS net_sales_minor, r.totals ->> 'gross_minor' AS payout_minor,
            (SELECT count(*)::int FROM run_settlement s WHERE s.run_id = p.committed_run_id AND s.gross_minor > 0) AS active_earners
     FROM unnest($1::uuid[]) AS u (id) JOIN period p ON p.id = u.id JOIN calendar c ON c.id = p.calendar_id
     LEFT JOIN run r ON r.id = p.committed_run_id
     LEFT JOIN LATERAL (SELECT sum(o.amount_minor) AS total FROM sales_order o
                        WHERE o.market_id = c.market_id AND o.credited_at >= p.starts_at AND o.credited_at < p.ends_at) sales ON true
     LEFT JOIN LATERAL (SELECT sum(CASE e.type WHEN 'chargeback_reversed' THEN -e.refund_minor ELSE e.refund_minor END) AS total
                        FROM order_event e JOIN sales_order o ON o.id = e.order_id
                        WHERE o.market_id = c.market_id AND e.occurred_at >= p.starts_at AND e.occurred_at < p.ends_at) refunds ON true
     ORDER BY p.starts_at, p.id`,
    [periodIds],
  )
  return rows
}

const money = (p: PeriodFigures) => ({
  net_sales_minor: p.net_sales_minor,
  payout_minor: p.payout_minor,
  payout_share_pct: p.payout_minor === null ? null : percentHalfUp(BigInt(p.payout_minor), BigInt(p.net_sales_minor)),
  active_earners: p.active_earners,
})

interface Selected {
  readonly market_id: string
  readonly code: string
  readonly currency: string
  readonly minor_unit: number
  readonly calendar_id: string
  readonly period_id: string
  readonly retail_month: string
}

export interface ExecutiveQuery {
  readonly market_id?: string | undefined
  readonly calendar_id?: string | undefined
  readonly period_id?: string | undefined
}

/**
 * Per market in scope: its calendar (the given one, the given period's, else the first by name) and the given or latest
 * finished period of it. A market without a finished period has no row.
 */
async function selectPeriods(tx: Tx, scope: Scope, query: ExecutiveQuery): Promise<Selected[]> {
  const { rows } = await tx.query<Selected>(
    `SELECT m.id AS market_id, m.code, m.currency, m.minor_unit::int, c.id AS calendar_id, p.id AS period_id,
            to_char(date_trunc('month', p.starts_at AT TIME ZONE m.time_zone), 'YYYY-MM-DD') AS retail_month
     FROM market m
     JOIN LATERAL (SELECT c.id FROM calendar c
                   WHERE c.market_id = m.id AND c.id = coalesce($3::uuid, (SELECT x.calendar_id FROM period x WHERE x.id = $4), c.id)
                   ORDER BY c.name, c.id LIMIT 1) c ON true
     JOIN LATERAL (SELECT p.id, p.starts_at FROM period p
                   WHERE p.calendar_id = c.id AND p.state IN ${FINISHED} AND ($4::uuid IS NULL OR p.id = $4)
                   ORDER BY p.starts_at DESC LIMIT 1) p ON true
     WHERE ($1::uuid[] IS NULL OR m.id = ANY ($1)) AND ($2::uuid IS NULL OR m.id = $2)
     ORDER BY m.code, m.id`,
    [scope, query.market_id ?? null, query.calendar_id ?? null, query.period_id ?? null],
  )
  return rows
}

/** The market's sources behind or failing now (the run gate's evaluation of INT sync health, D-B3-10). */
async function syncProblems(tx: Tx, marketIds: readonly string[]): Promise<Map<string, { source: string; name: string; state: string }[]>> {
  const health = await syncHealth(tx)
  const sources = health.sources as { source: string; kind: string; name: string; state: string; market?: { id: string } | null }[]
  const { rows } = await tx.query<{ source: string; market_id: string }>(
    `SELECT s.source, m.id AS market_id FROM unnest($1::text[]) AS s (source) CROSS JOIN unnest($2::uuid[]) AS m (id)
     WHERE EXISTS (SELECT 1 FROM sales_order o WHERE o.source_system = substr(s.source, 5) AND o.market_id = m.id)`,
    [sources.filter((s) => s.kind === 'api').map((s) => s.source), marketIds],
  )
  const problems = new Map<string, { source: string; name: string; state: string }[]>(marketIds.map((id) => [id, []]))
  for (const s of sources.filter((source) => source.state === 'behind' || source.state === 'failing')) {
    const markets = s.kind === 'connector' ? [s.market?.id] : rows.filter((row) => row.source === s.source).map((row) => row.market_id)
    for (const id of markets) problems.get(id ?? '')?.push({ source: s.source, name: s.name, state: s.state })
  }
  return problems
}

/** R1 customer_share_pct of the newest ready snapshot of the market whose months include `month`. */
async function retailShare(tx: Tx, marketId: string, month: string) {
  const { rows } = await tx.query<{ id: string; value: string | null }>(
    `SELECT s.id, f.value_num::text AS value FROM compliance_report_snapshot s
     LEFT JOIN compliance_figure f ON f.snapshot_id = s.id AND f.report = 'R1' AND f.key = 'customer_share_pct' AND f.period_kind = 'month'
                                   AND f.period = $2::date
     WHERE s.market_id = $1 AND s.state = 'ready' AND s.period_from <= $2::date AND s.period_to >= $2::date
     ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    [marketId, month],
  )
  const snapshot = rows[0]
  if (snapshot === undefined) return { retail_share_pct: null, retail_share_reason: 'no_snapshot', retail_snapshot_id: null }
  return { retail_share_pct: snapshot.value, retail_share_reason: snapshot.value === null ? 'no_value' : null, retail_snapshot_id: snapshot.id }
}

/** GET /v1/dashboards/executive (SC-35): a selector naming nothing in scope is 404; the trend only for one market. */
export async function executiveDashboard(tx: Tx, scope: Scope, query: ExecutiveQuery) {
  const selected = await selectPeriods(tx, scope, query)
  const narrowed = query.market_id !== undefined || query.calendar_id !== undefined || query.period_id !== undefined
  if (narrowed && selected.length === 0) {
    const { rows } = await tx.query(
      `SELECT 1 FROM market m WHERE ($1::uuid[] IS NULL OR m.id = ANY ($1)) AND ($2::uuid IS NULL OR m.id = $2)
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM calendar c WHERE c.id = $3 AND c.market_id = m.id))
         AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM period p JOIN calendar c ON c.id = p.calendar_id
                                         WHERE p.id = $4 AND c.market_id = m.id AND c.id = coalesce($3, c.id) AND p.state IN ${FINISHED}))`,
      [scope, query.market_id ?? null, query.calendar_id ?? null, query.period_id ?? null],
    )
    if (rows.length === 0) throw notFound()
  }
  const figures = new Map((await periodFigures(tx, selected.map((s) => s.period_id))).map((p) => [p.id, p]))
  const problems = await syncProblems(tx, selected.map((s) => s.market_id))
  const rows = []
  for (const s of selected) {
    const p = figures.get(s.period_id)!
    const partial = problems.get(s.market_id) ?? []
    rows.push({
      market: { id: s.market_id, code: s.code, currency: s.currency, minor_unit: s.minor_unit }, calendar_id: s.calendar_id,
      period: { id: p.id, starts_at: p.starts_at, ends_at: p.ends_at, state: p.state }, run_id: p.run_id, ...money(p),
      ...(await retailShare(tx, s.market_id, s.retail_month)), partial: partial.length > 0, partial_reasons: partial,
    })
  }
  const only = selected.length === 1 && narrowed ? selected[0]! : null
  return only === null ? { rows } : { rows, trend: await trend(tx, only) }
}

/** The last DASHBOARD_TREND_PERIODS finished periods of the calendar up to the selected one, oldest first. */
async function trend(tx: Tx, selected: Selected) {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT p.id FROM period p WHERE p.calendar_id = $1 AND p.state IN ${FINISHED}
       AND p.starts_at <= (SELECT starts_at FROM period WHERE id = $2)
     ORDER BY p.starts_at DESC LIMIT $3`,
    [selected.calendar_id, selected.period_id, DASHBOARD_TREND_PERIODS],
  )
  const figures = await periodFigures(tx, rows.map((row) => row.id))
  return figures.map((p) => ({ period: { id: p.id, starts_at: p.starts_at, ends_at: p.ends_at }, ...money(p) }))
}

async function marketOf(tx: Tx, scope: Scope, marketId: string) {
  const { rows } = await tx.query<{ id: string; code: string; currency: string; minor_unit: number }>(
    'SELECT id, code, currency, minor_unit::int FROM market WHERE id = $1 AND ($2::uuid[] IS NULL OR id = ANY ($2))', [marketId, scope])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

/**
 * GET /v1/dashboards/finance (SC-33 KPI row): balances by account type on the normal side (as GET /v1/ledger/summary),
 * failed payouts not replaced by a retry.
 */
export async function financeDashboard(tx: Tx, scope: Scope, marketId: string) {
  const market = await marketOf(tx, scope, marketId)
  const { rows } = await tx.query<Record<string, string>>(
    `SELECT coalesce(sum(x.credit_minor - x.debit_minor) FILTER (WHERE a.type = 'payee_payable'), 0)::text AS payables_minor,
            coalesce(sum(x.credit_minor - x.debit_minor) FILTER (WHERE a.type = 'payout_in_transit'), 0)::text AS in_transit_minor,
            coalesce(sum(x.debit_minor - x.credit_minor) FILTER (WHERE a.type = 'clawback_receivable'), 0)::text AS receivables_minor,
            coalesce(sum(x.credit_minor - x.debit_minor) FILTER (WHERE a.type = 'withholding_payable'), 0)::text AS withholding_minor
     FROM ledger_account a JOIN posting x ON x.account_id = a.id
     WHERE a.market_id = $1 AND a.type IN ('payee_payable', 'payout_in_transit', 'clawback_receivable', 'withholding_payable')`,
    [marketId],
  )
  const { rows: failed } = await tx.query<{ count: number; amount_minor: string }>(
    `SELECT count(*)::int AS count, coalesce(sum(i.amount_minor), 0)::text AS amount_minor
     FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id
     WHERE b.market_id = $1 AND i.state = 'failed' AND NOT EXISTS (SELECT 1 FROM payout_instruction n WHERE n.retry_of = i.id)`,
    [marketId],
  )
  return { market, ...rows[0], failed_payouts: failed[0] }
}

/** GET /v1/dashboards/compliance (SC-46): cases without a market count only for readers of every market. */
export async function complianceDashboard(tx: Tx, scope: Scope, marketId: string | undefined) {
  if (marketId !== undefined) await marketOf(tx, scope, marketId)
  const params = [scope, marketId ?? null]
  const inScope = (column: string) => `($1::uuid[] IS NULL OR ${column} = ANY ($1)) AND ($2::uuid IS NULL OR ${column} = $2)`
  const { rows: warnings } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM plan_version v CROSS JOIN LATERAL guardrail_outstanding(v.id) g
     WHERE v.state <> 'retired'
       AND ($1::uuid[] IS NULL OR NOT EXISTS (SELECT 1 FROM plan_market pm WHERE pm.plan_id = v.plan_id AND NOT pm.market_id = ANY ($1)))
       AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM plan_market pm WHERE pm.plan_id = v.plan_id AND pm.market_id = $2))`,
    params,
  )
  const { rows: open } = await tx.query<{ type: string; count: number }>(
    `SELECT type, count(*)::int AS count FROM case_file WHERE state IN ('open', 'submitted') AND ${inScope('market_id')} GROUP BY type ORDER BY type`,
    params,
  )
  const { rows: overdue } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM case_file WHERE state = 'submitted' AND due_at < now() AND ${inScope('market_id')}`, params)
  return { guardrail_warnings: warnings[0]!.n, open_cases: open, overdue_cases: overdue[0]!.n }
}
