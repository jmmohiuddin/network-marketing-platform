'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './button'

// Hand-written SVG charts (UI-04 Chart): axes from zero, direct labels, hairline grid, a "View as table" twin always.
// Colours are Tailwind fill/stroke classes, never inline styles: the page CSP allows no style attributes.

const WIDTH = 560
const LINE_HEIGHT = 240
const MARGIN = { top: 28, right: 88, bottom: 32, left: 56 } as const
const TICK_COUNT = 4
const NICE_STEPS = [1, 2, 2.5, 5, 10] as const
const COMPACT_FROM = 10_000
// Room per period label on the x axis ("2025-11" at 11 px is about 44 px wide).
const X_LABEL_ROOM = 64
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
const AXIS = 'fill-secondary font-caption text-[11px]'
const GRID = 'stroke-surface-container-high'
const VALUE = 'fill-on-surface font-data-mono-sm text-[12px] font-semibold'
// Two series: primary-container and tertiary-container (blue and green), each >= 3:1 on white; labels are direct.
const BAR = { a: 'fill-primary-container', b: 'fill-tertiary-container' } as const
const SWATCH = { a: 'bg-primary-container', b: 'bg-tertiary-container' } as const

/**
 * The chart's drawn width in CSS pixels, so the SVG is laid out 1:1 and its 11 px text stays 11 px on a phone
 * (BUG-035: a fixed 560 viewBox scaled text down to about 5 px at 390). WIDTH until measured (and in tests).
 */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(WIDTH)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry?.contentRect.width ?? 0)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** Indices of the x labels that fit: counted back from the last period, so the last never collides with its neighbour. */
export function xLabelIndices(count: number, plotWidth: number): ReadonlySet<number> {
  const fit = Math.max(2, Math.floor(plotWidth / X_LABEL_ROOM))
  const every = Math.ceil(count / fit)
  return new Set(Array.from({ length: count }, (_, index) => index).filter((index) => (count - 1 - index) % every === 0))
}

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

export interface ChartCardProps {
  readonly title: string
  /** The sentence above the chart that states what it shows (UI-04: summary sentence above). */
  readonly summary: string
  readonly legend?: ReactNode
  /** The same values as a table: the chart's text alternative. */
  readonly table: ReactNode
  readonly children: ReactNode
}

/** Chart card (sc_35 l.175 card): title, summary sentence and the "View as table" toggle (always present). */
export function ChartCard({ title, summary, legend, table, children }: ChartCardProps) {
  const [asTable, setAsTable] = useState(false)
  const titleId = useId()
  return (
    <figure className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-space-sm" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-space-sm">
        <div className="min-w-0">
          <h3 id={titleId} className="font-section-heading text-section-heading text-on-surface">{title}</h3>
          <p className="font-body-sm text-body-sm text-secondary">{summary}</p>
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
    <ul className="flex flex-wrap gap-space-md font-caption text-caption text-on-surface">
      {items.map((item) => (
        <li key={item.series} className="flex items-center gap-space-xs"><span className={`inline-block w-3 h-3 rounded-sm ${SWATCH[item.series]}`} aria-hidden="true" />{item.name}</li>
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
    <g className={AXIS} aria-hidden="true">
      <text x={0} y={MARGIN.top / 2}>{unit}</text>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line className={GRID} strokeDasharray="3 3" x1={MARGIN.left} x2={right} y1={y(tick)} y2={y(tick)} />
          <text x={MARGIN.left - LABEL_OFFSET} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tickLabel(tick, scale)}</text>
        </g>
      ))}
    </g>
  )
}

/** Trend of one figure over periods (single series, --color-action-primary); points focusable, latest labelled. */
export function LineChart({ name, unit, points }: { readonly name: string; readonly unit: string; readonly points: readonly LinePoint[] }) {
  const [active, setActive] = useState(points.length - 1)
  const { ref, width } = useMeasuredWidth()
  const scale = niceScale(points.map((point) => position(point.value)))
  const plotWidth = width - MARGIN.left - MARGIN.right
  const plotBottom = LINE_HEIGHT - MARGIN.bottom
  const x = (index: number) => MARGIN.left + (points.length === 1 ? plotWidth / 2 : (index * plotWidth) / (points.length - 1))
  const y = (value: number) => MARGIN.top + ((scale.max - value) / (scale.max - scale.min)) * (plotBottom - MARGIN.top)
  const labelled = xLabelIndices(points.length, plotWidth)
  const current = points[Math.min(active, points.length - 1)]
  const last = points.at(-1)
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(position(point.value))}`).join('')
  return (
    <div ref={ref} className="flex flex-col gap-space-xs">
      <p className="min-h-4 font-data-mono-sm text-data-mono-sm text-on-surface" aria-live="polite">{current === undefined ? '' : `${current.text} in ${current.label}`}</p>
      <svg className="w-full h-auto overflow-visible" viewBox={`0 0 ${width} ${LINE_HEIGHT}`} role="group" aria-label={`${name}, by period`}>
        <YAxis scale={scale} unit={unit} y={y} right={width - MARGIN.right} />
        <g className={AXIS} aria-hidden="true">
          {points.map((point, index) => labelled.has(index) && (
            <text key={point.label} x={x(index)} y={plotBottom + LABEL_OFFSET * 2} textAnchor="middle">{point.label}</text>
          ))}
        </g>
        {current !== undefined && <line className="stroke-outline-variant" x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={plotBottom} aria-hidden="true" />}
        <path className="fill-none stroke-primary-container stroke-2" d={path} aria-hidden="true" />
        {points.map((point, index) => (
          <g key={point.label} className="group outline-none" tabIndex={0} role="img" aria-label={`${point.label}: ${point.text}`}
            onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)}>
            <circle className="fill-transparent" cx={x(index)} cy={y(position(point.value))} r={HIT_RADIUS} />
            <circle className="fill-primary-container group-focus-visible:stroke-on-surface group-focus-visible:stroke-2" cx={x(index)} cy={y(position(point.value))} r={DOT_RADIUS} />
          </g>
        ))}
        {last !== undefined && (
          <text className={VALUE} x={x(points.length - 1) + LABEL_OFFSET + DOT_RADIUS} y={y(position(last.value))} dominantBaseline="middle" aria-hidden="true">
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
  const { ref, width } = useMeasuredWidth()
  const scale = niceScale(rows.flatMap((row) => [row.a, row.b]).flatMap((bar) => (bar === null ? [] : [position(bar.value)])))
  const rowHeight = ROW_LABEL_HEIGHT + BAR_THICKNESS * 2 + BAR_GAP + ROW_GAP
  const plotBottom = MARGIN.top + rows.length * rowHeight
  const height = plotBottom + MARGIN.bottom
  const x = (value: number) => BAR_LEFT + ((value - scale.min) / (scale.max - scale.min)) * (width - BAR_LEFT - BAR_LABEL_ROOM)
  const bars = (row: PairedRow): [Series, BarValue][] => [['a', row.a], ['b', row.b]].filter((pair): pair is [Series, BarValue] => pair[1] !== null)
  return (
    <div ref={ref}>
      <svg className="w-full h-auto overflow-visible" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={name}>
        <g className={AXIS} aria-hidden="true">
          <text x={BAR_LEFT} y={MARGIN.top / 2}>{unit}</text>
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line className={GRID} strokeDasharray="3 3" x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={plotBottom} />
              <text x={x(tick)} y={plotBottom + LABEL_OFFSET * 2} textAnchor="middle">{tickLabel(tick, scale)}</text>
            </g>
          ))}
        </g>
        {rows.map((row, index) => {
          const top = MARGIN.top + index * rowHeight
          return (
            <g key={row.key}>
              <text className="fill-on-surface font-body-sm text-[12px]" x={BAR_LEFT} y={top + ROW_LABEL_HEIGHT - LABEL_OFFSET}>{row.label}</text>
              {bars(row).map(([which, bar]) => {
                const barTop = top + ROW_LABEL_HEIGHT + (which === 'a' ? 0 : BAR_THICKNESS + BAR_GAP)
                const end = x(position(bar.value))
                const base = x(0)
                return (
                  <g key={which}>
                    {end !== base && <path data-series={which} className={BAR[which]} d={barPath(base, end, barTop, BAR_THICKNESS)}><title>{`${series[which]}: ${bar.text}`}</title></path>}
                    <text className={VALUE} x={Math.max(base, end) + LABEL_OFFSET / 2} y={barTop + BAR_THICKNESS / 2} dominantBaseline="middle">
                      {`${bar.text} (${series[which]})`}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
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
    <svg className="shrink-0 overflow-visible" viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} width={SPARK.width} height={SPARK.height} aria-hidden="true" focusable="false">
      <polyline className="fill-none stroke-primary-container stroke-[1.5]" points={numbers.map((value, index) => `${x(index)},${y(value)}`).join(' ')} />
      <circle className="fill-primary-container" cx={x(lastIndex)} cy={y(numbers[lastIndex]!)} r={SPARK.dot} />
    </svg>
  )
}

export interface MeterBarProps {
  /** 0 to 100; computed by the caller from the API's exact values (position only, never shown as a number). */
  readonly percent: number
  /** What the bar shows, with the exact value ("Retail share 62.50 %"). */
  readonly label: string
}

/**
 * Progress or share bar as SVG (guidelines §5: data-driven widths may not use style attributes; SVG presentation
 * attributes are not style attributes). Track and fill from sc_03 l.369.
 */
export function MeterBar({ percent, label }: MeterBarProps) {
  const width = Math.min(100, Math.max(0, percent))
  return (
    <svg className="block h-1.5 w-full" role="img" aria-label={label}>
      <rect width="100%" height="100%" rx="3" className="fill-surface-container-high" />
      <rect width={`${width}%`} height="100%" rx="3" className="fill-primary" />
    </svg>
  )
}
