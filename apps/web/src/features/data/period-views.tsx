'use client'

import { countLabel } from '../../lib/format'
import { useId, useState } from 'react'
import { Select } from '../../components/form-field'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { ChartCard, Legend, LineChart, PairedBarChart, type BarValue, type LinePoint, type PairedRow } from '../../components/charts'
import { changeLabel, compareDecimal, figureLabel, figureValue, HEADLINE_KEYS, integer, UNIT_NAMES } from './format'
import type { Figure, PeriodResult } from './types'
import { CONTROLS, SECTION_HEADING } from './ui'

export interface PeriodChoice {
  /** The period shown (the latest when the URL names none). */
  readonly period: string
  /** A second period compared with it, or null. */
  readonly compare: string | null
}

/** SC-10 period selector: one filter row above everything it scopes (period, then the period it is compared with). */
export function PeriodFilters({ periods, choice, onChange }: {
  readonly periods: readonly string[]
  readonly choice: PeriodChoice
  readonly onChange: (choice: PeriodChoice) => void
}) {
  return (
    <div className={`${CONTROLS} bg-surface-container-lowest rounded shadow-sm p-space-sm`} role="group" aria-label="Periods">
      <Select
        label="Period"
        value={choice.period}
        options={periods.map((period) => ({ value: period, label: period }))}
        onChange={(event) => onChange({ period: event.target.value, compare: null })}
      />
      <Select
        label="Compare with"
        value={choice.compare ?? ''}
        options={[{ value: '', label: 'No comparison' }, ...periods.filter((period) => period !== choice.period).map((period) => ({ value: period, label: period }))]}
        onChange={(event) => onChange({ ...choice, compare: event.target.value === '' ? null : event.target.value })}
      />
    </div>
  )
}

const stated = (figure: Figure | undefined): figure is Figure & { readonly value: string } => figure?.value != null

/** The figure's value without its unit, for labels at the end of a line ("62.50", "1,600"). */
function shortValue(figure: Figure & { readonly value: string }): string {
  return figure.unit === 'count' || figure.unit === 'minor' ? integer(figure.value) : figure.value
}

/** Figure keys stated in at least two of the periods: the ones a trend can show. */
export function trendKeys(results: readonly PeriodResult[]): readonly string[] {
  const keys = [...new Set(results.flatMap((result) => result.figures.map((figure) => figure.key)))]
  return keys.filter((key) => results.filter((result) => stated(result.figures.find((figure) => figure.key === key))).length >= 2)
}

/** "lowest 58.00 % (2025-02), highest 62.50 % (2025-01), latest 60.00 % (2025-03)": exact decimal comparisons. */
export function trendSummary(points: readonly LinePoint[]): string {
  const pick = (better: (order: number) => boolean) =>
    points.reduce((best, point) => (better(compareDecimal(point.value, best.value) ?? 0) ? point : best))
  const low = pick((order) => order < 0)
  const high = pick((order) => order > 0)
  const latest = points.at(-1)!
  return `Lowest ${low.text} (${low.label}), highest ${high.text} (${high.label}), latest ${latest.text} (${latest.label}).`
}

interface TrendRow {
  readonly period: string
  readonly figure: Figure | undefined
}

/** One figure by period: a line from zero with its table twin (period, value, numerator, denominator). */
export function TrendChart({ results, figureKey }: { readonly results: readonly PeriodResult[]; readonly figureKey: string }) {
  const rows: TrendRow[] = results.map((result) => ({ period: result.period, figure: result.figures.find((figure) => figure.key === figureKey) }))
  const points: LinePoint[] = rows.flatMap((row) => (stated(row.figure)
    ? [{ label: row.period, value: row.figure.value, text: figureValue(row.figure), short: shortValue(row.figure) }]
    : []))
  if (points.length < 2) return null
  const unit = rows.find((row) => row.figure !== undefined)?.figure?.unit ?? 'count'
  const label = figureLabel(figureKey)
  const columns: DataTableColumn<TrendRow>[] = [
    { key: 'period', header: 'Period', cell: (row) => row.period },
    { key: 'value', header: label, align: 'end', cell: (row) => (row.figure === undefined ? 'Not computed' : figureValue(row.figure)) },
    { key: 'numerator', header: 'Numerator', align: 'end', cell: (row) => (row.figure?.numerator == null ? '—' : integer(row.figure.numerator)) },
    { key: 'denominator', header: 'Denominator', align: 'end', cell: (row) => (row.figure?.denominator == null ? '—' : integer(row.figure.denominator)) },
  ]
  const missing = rows.length - points.length
  return (
    <ChartCard
      title={`${label} by period`}
      summary={`${trendSummary(points)}${missing > 0 ? ` ${countLabel(missing, 'period')} ${missing === 1 ? 'has' : 'have'} no value and ${missing === 1 ? 'is' : 'are'} left out of the line.` : ''}`}
      table={<DataTable caption={`${label} in each period`} columns={columns} rows={rows} rowKey={(row) => row.period} empty={{ title: 'No periods.' }} density="compact" bare />}
    >
      <LineChart name={label} unit={UNIT_NAMES[unit]} points={points} />
    </ChartCard>
  )
}

/** SC-10 trend of a monthly figure over the snapshot's months, the figure chosen here. Past periods only (BR-HON-01). */
export function TrendSection({ results }: { readonly results: readonly PeriodResult[] }) {
  const titleId = useId()
  const keys = trendKeys(results)
  const report = results[0]?.report
  const [chosen, setChosen] = useState<string | null>(null)
  if (keys.length === 0 || report === undefined) return null
  const key = chosen !== null && keys.includes(chosen) ? chosen : keys.includes(HEADLINE_KEYS[report]) ? HEADLINE_KEYS[report] : keys[0]!
  return (
    <section className="flex flex-col gap-space-sm" aria-labelledby={titleId}>
      <h2 id={titleId} className={SECTION_HEADING}>Trend</h2>
      <div className={CONTROLS}>
        <Select label="Figure" value={key} options={keys.map((option) => ({ value: option, label: figureLabel(option) }))} onChange={(event) => setChosen(event.target.value)} />
      </div>
      <TrendChart results={results} figureKey={key} />
    </section>
  )
}

interface CompareRow {
  readonly key: string
  readonly a: Figure | undefined
  readonly b: Figure | undefined
}

const barOf = (figure: Figure | undefined): BarValue | null => (stated(figure) ? { value: figure.value, text: figureValue(figure) } : null)

/** SC-10 compare two periods: every figure of both, the exact difference, and a bar chart of the percentages. */
export function CompareSection({ a, b }: { readonly a: PeriodResult; readonly b: PeriodResult }) {
  const titleId = useId()
  const keys = [...new Set([...a.figures, ...b.figures].map((figure) => figure.key))]
  const rows: CompareRow[] = keys.map((key) => ({
    key, a: a.figures.find((figure) => figure.key === key), b: b.figures.find((figure) => figure.key === key),
  }))
  const value = (figure: Figure | undefined) => (figure === undefined ? 'Not computed' : figureValue(figure))
  const columns: DataTableColumn<CompareRow>[] = [
    { key: 'figure', header: 'Figure', cell: (row) => figureLabel(row.key) },
    { key: 'a', header: a.period, align: 'end', cell: (row) => value(row.a) },
    { key: 'b', header: b.period, align: 'end', cell: (row) => value(row.b) },
    {
      key: 'difference', header: `Difference (${a.period} minus ${b.period})`, align: 'end',
      cell: (row) => (row.a === undefined || row.b === undefined || row.a.unit !== row.b.unit ? 'Not comparable' : changeLabel(row.a.unit, row.a.value, row.b.value)),
    },
  ]
  // One axis per chart: only the percentages share a scale. Every figure, with its exact difference, is in the table.
  const percentRows = rows.filter((row) => row.a?.unit === 'percent' || row.b?.unit === 'percent')
  const bars: PairedRow[] = percentRows.map((row) => ({ key: row.key, label: figureLabel(row.key), a: barOf(row.a), b: barOf(row.b) }))
  const tableOf = (items: readonly CompareRow[], caption: string, bare = false) =>
    <DataTable caption={caption} columns={columns} rows={items} rowKey={(row) => row.key} empty={{ title: 'No figures.' }} density="compact" bare={bare} />
  return (
    <section className="flex flex-col gap-space-sm" aria-labelledby={titleId}>
      <h2 id={titleId} className={SECTION_HEADING}>{`Compare ${a.period} with ${b.period}`}</h2>
      {bars.length > 0 && (
        <ChartCard
          title="Percentages in both periods"
          summary={`${bars.length === 1 ? 'The percentage figure' : `The ${bars.length} percentage figures`}, on one axis from zero. The table below lists every figure with the exact difference.`}
          legend={<Legend items={[{ name: a.period, series: 'a' }, { name: b.period, series: 'b' }]} />}
          table={tableOf(percentRows, `${countLabel(percentRows.length, 'percentage figure')} in ${a.period} and ${b.period}`, true)}
        >
          <PairedBarChart name={`Percentages in ${a.period} and ${b.period}`} unit={UNIT_NAMES.percent} series={{ a: a.period, b: b.period }} rows={bars} />
        </ChartCard>
      )}
      {tableOf(rows, `${countLabel(keys.length, 'figure')} in ${a.period} and ${b.period}`)}
    </section>
  )
}
