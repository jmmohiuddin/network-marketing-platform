'use client'

import { useId, useState, type ReactNode } from 'react'
import { Button } from '../../components/button'

// Hand-written SVG charts (UI-04 Chart): axes from zero, direct labels, hairline grid, a "View as table" twin always.
// Colours are CSS classes (data.css), never inline styles: the page CSP allows no style attributes.

const WIDTH = 560
const LINE_HEIGHT = 240
const MARGIN = { top: 28, right: 88, bottom: 32, left: 56 } as const
const TICK_COUNT = 4
const NICE_STEPS = [1, 2, 2.5, 5, 10] as const
const COMPACT_FROM = 10_000
const MAX_X_LABELS = 8
const DOT_RADIUS = 4
const HIT_RADIUS = 12
const LABEL_OFFSET = 8
const BAR_THICKNESS = 14
const BAR_GAP = 2
const BAR_RADIUS = 4
const BAR_LEFT = 8
// Room after the longest bar for its label ("62.50 % (2025-02)").
const BAR_LABEL_ROOM = 144
const ROW_LABEL_HEIGHT = 22
const ROW_GAP = 14
const SPARK = { width: 120, height: 32, pad: 4, dot: 3 } as const

/** Where a value sits on the chart. Positions only: every label shows the exact decimal string, never this number. */
const position = (value: string) => Number(value)

export interface Scale {
  readonly min: number
  readonly max: number
  readonly ticks: readonly number[]
}

/** Axis from zero (lower for negative data) to a round number at or above the data: never a truncated axis. */
export function niceScale(values: readonly number[]): Scale {
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  const raw = (high - low || 1) / TICK_COUNT
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = magnitude * (NICE_STEPS.find((candidate) => candidate * magnitude >= raw) ?? 10)
  // toPrecision drops binary noise (3 * 0.1 = 0.30000000000000004) from axis ends and ticks.
  const round = (value: number) => Number(value.toPrecision(12))
  const min = round(Math.floor(low / step) * step)
  const max = round(Math.max(Math.ceil(high / step) * step, min + step))
  const count = Math.round((max - min) / step)
  return { min, max, ticks: Array.from({ length: count + 1 }, (_, index) => round(min + index * step)) }
}

function tickLabel(tick: number, scale: Scale): string {
  const compact = Math.max(Math.abs(scale.min), Math.abs(scale.max)) >= COMPACT_FROM
  return tick.toLocaleString(undefined, compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 })
}

export interface ChartBlockProps {
  readonly title: string
  /** The sentence above the chart that states what it shows (UI-04: summary sentence above). */
  readonly summary: string
  readonly legend?: ReactNode
  /** The same values as a table: the chart's text alternative. */
  readonly table: ReactNode
  readonly children: ReactNode
}

/** A chart with its title, summary sentence and the "View as table" toggle (always present). */
export function ChartBlock({ title, summary, legend, table, children }: ChartBlockProps) {
  const [asTable, setAsTable] = useState(false)
  const titleId = useId()
  return (
    <figure className="chart" aria-labelledby={titleId}>
      <div className="chart-head">
        <div>
          <h3 id={titleId}>{title}</h3>
          <p className="data-note">{summary}</p>
        </div>
        <Button variant="tertiary" aria-pressed={asTable} onClick={() => setAsTable((current) => !current)}>View as table</Button>
      </div>
      {asTable ? table : <>{legend}{children}</>}
    </figure>
  )
}

export type Series = 'a' | 'b'

/** Two-series legend; the swatch carries the colour, the text stays in text colour. */
export function Legend({ items }: { readonly items: readonly { readonly name: string; readonly series: Series }[] }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.series}><span className={`chart-swatch chart-series-${item.series}`} aria-hidden="true" />{item.name}</li>
      ))}
    </ul>
  )
}

export interface LinePoint {
  /** The period. */
  readonly label: string
  /** Decimal string. */
  readonly value: string
  /** The value with its unit, as the figure states it ("62.50 %"). */
  readonly text: string
  /** The value alone, for the label at the line's end ("62.50"). */
  readonly short: string
}

function YAxis({ scale, unit, y, right }: { readonly scale: Scale; readonly unit: string; readonly y: (value: number) => number; readonly right: number }) {
  return (
    <g className="chart-axis" aria-hidden="true">
      <text x={0} y={MARGIN.top / 2}>{unit}</text>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line className="chart-grid" x1={MARGIN.left} x2={right} y1={y(tick)} y2={y(tick)} />
          <text x={MARGIN.left - LABEL_OFFSET} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tickLabel(tick, scale)}</text>
        </g>
      ))}
    </g>
  )
}

/** Trend of one figure over periods (single series, --color-action-primary); points focusable, latest labelled. */
export function LineChart({ name, unit, points }: { readonly name: string; readonly unit: string; readonly points: readonly LinePoint[] }) {
  const [active, setActive] = useState(points.length - 1)
  const scale = niceScale(points.map((point) => position(point.value)))
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotBottom = LINE_HEIGHT - MARGIN.bottom
  const x = (index: number) => MARGIN.left + (points.length === 1 ? plotWidth / 2 : (index * plotWidth) / (points.length - 1))
  const y = (value: number) => MARGIN.top + ((scale.max - value) / (scale.max - scale.min)) * (plotBottom - MARGIN.top)
  const every = Math.ceil(points.length / MAX_X_LABELS)
  const current = points[Math.min(active, points.length - 1)]
  const last = points.at(-1)
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(position(point.value))}`).join('')
  return (
    <div className="chart-body">
      <p className="chart-readout" aria-live="polite">{current === undefined ? '' : `${current.text} in ${current.label}`}</p>
      <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${LINE_HEIGHT}`} role="group" aria-label={`${name}, by period`}>
        <YAxis scale={scale} unit={unit} y={y} right={WIDTH - MARGIN.right} />
        <g className="chart-axis" aria-hidden="true">
          {points.map((point, index) => (index % every === 0 || index === points.length - 1) && (
            <text key={point.label} x={x(index)} y={plotBottom + LABEL_OFFSET * 2} textAnchor="middle">{point.label}</text>
          ))}
        </g>
        {current !== undefined && <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={plotBottom} aria-hidden="true" />}
        <path className="chart-line" d={path} aria-hidden="true" />
        {points.map((point, index) => (
          <g key={point.label} className="chart-point" tabIndex={0} role="img" aria-label={`${point.label}: ${point.text}`}
            onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)}>
            <circle className="chart-hit" cx={x(index)} cy={y(position(point.value))} r={HIT_RADIUS} />
            <circle className="chart-dot" cx={x(index)} cy={y(position(point.value))} r={DOT_RADIUS} />
          </g>
        ))}
        {last !== undefined && (
          <text className="chart-value" x={x(points.length - 1) + LABEL_OFFSET + DOT_RADIUS} y={y(position(last.value))} dominantBaseline="middle" aria-hidden="true">
            {last.short}
          </text>
        )}
      </svg>
    </div>
  )
}

/** A horizontal bar from the baseline: square at the baseline, 4px rounded at the data end. */
export function barPath(from: number, to: number, top: number, height: number): string {
  const radius = Math.min(BAR_RADIUS, Math.abs(to - from), height / 2)
  const bottom = top + height
  if (to >= from) return `M${from},${top}H${to - radius}A${radius},${radius} 0 0 1 ${to},${top + radius}V${bottom - radius}A${radius},${radius} 0 0 1 ${to - radius},${bottom}H${from}Z`
  return `M${from},${top}H${to + radius}A${radius},${radius} 0 0 0 ${to},${top + radius}V${bottom - radius}A${radius},${radius} 0 0 0 ${to + radius},${bottom}H${from}Z`
}

export interface BarValue {
  readonly value: string
  readonly text: string
}

export interface PairedRow {
  readonly key: string
  readonly label: string
  readonly a: BarValue | null
  readonly b: BarValue | null
}

/** Two periods side by side per figure (series a, b), on one axis from zero; values labelled at the bar ends. */
export function PairedBarChart({ name, unit, series, rows }: {
  readonly name: string
  readonly unit: string
  readonly series: Readonly<Record<Series, string>>
  readonly rows: readonly PairedRow[]
}) {
  const scale = niceScale(rows.flatMap((row) => [row.a, row.b]).flatMap((bar) => (bar === null ? [] : [position(bar.value)])))
  const rowHeight = ROW_LABEL_HEIGHT + BAR_THICKNESS * 2 + BAR_GAP + ROW_GAP
  const plotBottom = MARGIN.top + rows.length * rowHeight
  const height = plotBottom + MARGIN.bottom
  const x = (value: number) => BAR_LEFT + ((value - scale.min) / (scale.max - scale.min)) * (WIDTH - BAR_LEFT - BAR_LABEL_ROOM)
  const bars = (row: PairedRow): [Series, BarValue][] => [['a', row.a], ['b', row.b]].filter((pair): pair is [Series, BarValue] => pair[1] !== null)
  return (
    <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${height}`} role="group" aria-label={name}>
      <g className="chart-axis" aria-hidden="true">
        <text x={BAR_LEFT} y={MARGIN.top / 2}>{unit}</text>
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={plotBottom} />
            <text x={x(tick)} y={plotBottom + LABEL_OFFSET * 2} textAnchor="middle">{tickLabel(tick, scale)}</text>
          </g>
        ))}
      </g>
      {rows.map((row, index) => {
        const top = MARGIN.top + index * rowHeight
        return (
          <g key={row.key}>
            <text className="chart-label" x={BAR_LEFT} y={top + ROW_LABEL_HEIGHT - LABEL_OFFSET}>{row.label}</text>
            {bars(row).map(([which, bar]) => {
              const barTop = top + ROW_LABEL_HEIGHT + (which === 'a' ? 0 : BAR_THICKNESS + BAR_GAP)
              const end = x(position(bar.value))
              const base = x(0)
              return (
                <g key={which}>
                  {end !== base && <path className={`chart-bar chart-series-${which}`} d={barPath(base, end, barTop, BAR_THICKNESS)}><title>{`${series[which]}: ${bar.text}`}</title></path>}
                  <text className="chart-value" x={Math.max(base, end) + LABEL_OFFSET / 2} y={barTop + BAR_THICKNESS / 2} dominantBaseline="middle">
                    {`${bar.text} (${series[which]})`}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

/** Decorative trend line beside a KPI (UI-04: aria-hidden; the change text carries the information). */
export function Sparkline({ values }: { readonly values: readonly string[] }) {
  if (values.length < 2) return null
  const numbers = values.map(position)
  const low = Math.min(...numbers)
  const span = Math.max(...numbers) - low || 1
  const x = (index: number) => SPARK.pad + (index * (SPARK.width - SPARK.pad * 2)) / (numbers.length - 1)
  const y = (value: number) => SPARK.height - SPARK.pad - ((value - low) / span) * (SPARK.height - SPARK.pad * 2)
  const lastIndex = numbers.length - 1
  return (
    <svg className="sparkline" viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} width={SPARK.width} height={SPARK.height} aria-hidden="true" focusable="false">
      <polyline className="sparkline-line" points={numbers.map((value, index) => `${x(index)},${y(value)}`).join(' ')} />
      <circle className="sparkline-dot" cx={x(lastIndex)} cy={y(numbers[lastIndex]!)} r={SPARK.dot} />
    </svg>
  )
}
