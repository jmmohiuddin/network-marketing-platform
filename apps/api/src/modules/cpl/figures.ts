import type { FigureUnit, ReportCode } from '@nmp/compliance'
import type { Tx } from '@nmp/db'
import { periodDate } from './compute.js'

/** A figure as the API names it: `{report}.{period}.{key}`, e.g. `R1.2025-01.customer_share_pct` (API-04). */
export interface FigureRef {
  readonly report: ReportCode
  /** 'YYYY-MM' or 'YYYY' */
  readonly period: string
  readonly periodKind: 'month' | 'year'
  readonly key: string
}

const FIGURE_ID = /^(R[1-5])\.(\d{4}(?:-(?:0[1-9]|1[0-2]))?)\.(.+)$/

export function parseFigureId(id: string): FigureRef | null {
  const match = FIGURE_ID.exec(id)
  if (match === null) return null
  const [, report, period, key] = match as unknown as [string, ReportCode, string, string]
  return { report, period, periodKind: period.length === 'YYYY'.length ? 'year' : 'month', key }
}

export interface StoredFigure {
  report: ReportCode
  period_kind: 'month' | 'year'
  period: string
  key: string
  /** null = the indicator was omitted (note holds the reason). */
  unit: FigureUnit | null
  /** Decimal string with the scale the method states; bigints as strings. */
  value: string | null
  numerator: string | null
  denominator: string | null
  population_count: number | null
  population: string | null
  method: string | null
  method_version: string | null
  note: string | null
  partial: boolean
  period_notes: string[]
}

const FIGURE_COLUMNS = `report, period_kind,
  to_char(period, CASE period_kind WHEN 'year' THEN 'YYYY' ELSE 'YYYY-MM' END) AS period, key, unit,
  value_num AS value, numerator, denominator, population_count, population, method, method_version, note, partial,
  period_notes`

export async function findStoredFigure(tx: Tx, snapshotId: string, ref: FigureRef): Promise<StoredFigure | null> {
  const { rows } = await tx.query<StoredFigure>(
    `SELECT ${FIGURE_COLUMNS} FROM compliance_figure
     WHERE snapshot_id = $1 AND report = $2 AND period_kind = $3 AND period = $4::date AND key = $5`,
    [snapshotId, ref.report, ref.periodKind, periodDate(ref.period), ref.key],
  )
  return rows[0] ?? null
}

function figureView(snapshotId: string, figure: StoredFigure) {
  const id = `${figure.report}.${figure.period}.${figure.key}`
  return {
    id, key: figure.key, unit: figure.unit, value: figure.value, numerator: figure.numerator,
    denominator: figure.denominator, population: figure.population, population_count: figure.population_count,
    method: figure.method, method_version: figure.method_version, note: figure.note,
    rows: `/v1/compliance/snapshots/${snapshotId}/figures/${encodeURIComponent(id)}/rows`,
  }
}

export interface PeriodResult {
  report: ReportCode
  period: string
  period_kind: 'month' | 'year'
  /** Year with fewer than 12 months of payout data: labelled partial, not publishable (FR-CPL-005). */
  partial: boolean
  notes: string[]
  figures: ReturnType<typeof figureView>[]
  omitted: { key: string; reason: string | null }[]
}

/** The snapshot's figures grouped by report and period (months before years), in the method's order. */
export async function readResults(tx: Tx, snapshotId: string): Promise<PeriodResult[]> {
  const { rows } = await tx.query<StoredFigure>(
    `SELECT ${FIGURE_COLUMNS} FROM compliance_figure WHERE snapshot_id = $1 ORDER BY report, period_kind, period, position`,
    [snapshotId],
  )
  const groups = new Map<string, PeriodResult>()
  for (const figure of rows) {
    const groupKey = `${figure.report}.${figure.period}`
    const group = groups.get(groupKey) ?? {
      report: figure.report, period: figure.period, period_kind: figure.period_kind, partial: figure.partial,
      notes: figure.period_notes, figures: [], omitted: [],
    }
    groups.set(groupKey, group)
    if (figure.unit === null) group.omitted.push({ key: figure.key, reason: figure.note })
    else group.figures.push(figureView(snapshotId, figure))
  }
  return [...groups.values()]
}
