'use client'

import { niceScale, useMeasuredWidth, xLabelIndices, type Scale } from '../../components/charts'
import { minorToDecimal } from '../orders/format'

// SC-35 12-period chart: net sales as bars (left axis, the market's currency) and payout share of sales as a line (right
// axis, percent), axes from zero, hairline grid, period labels thinned to fit. The "View as table" twin is ChartCard's.

const HEIGHT = 240
const MARGIN = { top: 28, right: 56, bottom: 32, left: 64 } as const
const BAR_SHARE = 0.6
const DOT_RADIUS = 4
const LABEL_OFFSET = 8
const AXIS = 'fill-secondary font-caption text-[11px]'
const GRID = 'stroke-surface-container-high'

export interface TrendPoint {
  /** The period's id: periods may share a short label. */
  readonly id: string
  /** The period, short, in its calendar's zone ("Sep 2026"). */
  readonly label: string
  readonly salesMinor: string
  /** Decimal string; null when net sales are zero or less. */
  readonly sharePct: string | null
}

const tick = (value: number, scale: Scale) => value.toLocaleString(undefined, Math.max(Math.abs(scale.min), Math.abs(scale.max)) >= 10_000
  ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 })

/** Bars and line over the same periods; positions only: every label shows the API's exact decimal string. */
export function TrendChart({ name, currency, minorUnit, points }: {
  readonly name: string
  readonly currency: string
  readonly minorUnit: number
  readonly points: readonly TrendPoint[]
}) {
  const { ref, width } = useMeasuredWidth()
  const sales = points.map((point) => Number(minorToDecimal(point.salesMinor, minorUnit)))
  const shares = points.map((point) => (point.sharePct === null ? null : Number(point.sharePct)))
  const left = niceScale(sales)
  const right = niceScale(shares.filter((share): share is number => share !== null))
  const plotWidth = width - MARGIN.left - MARGIN.right
  const bottom = HEIGHT - MARGIN.bottom
  const slot = plotWidth / Math.max(points.length, 1)
  const x = (index: number) => MARGIN.left + slot * (index + 0.5)
  const y = (scale: Scale, value: number) => MARGIN.top + ((scale.max - value) / (scale.max - scale.min)) * (bottom - MARGIN.top)
  const labelled = xLabelIndices(points.length, plotWidth)
  const line = shares.flatMap((share, index) => (share === null ? [] : [`${x(index)},${y(right, share)}`])).join(' ')
  return (
    <div ref={ref}>
      <svg className="w-full h-auto overflow-visible" viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`${name}: net sales in ${currency} as bars, payout share of sales in percent as a line, by period`}>
        <g className={AXIS} aria-hidden="true">
          <text x={0} y={MARGIN.top / 2}>{currency}</text>
          <text x={width} y={MARGIN.top / 2} textAnchor="end">%</text>
          {left.ticks.map((value) => (
            <g key={`l${value}`}>
              <line className={GRID} strokeDasharray="3 3" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(left, value)} y2={y(left, value)} />
              <text x={MARGIN.left - LABEL_OFFSET} y={y(left, value)} textAnchor="end" dominantBaseline="middle">{tick(value, left)}</text>
            </g>
          ))}
          {right.ticks.map((value) => (
            <text key={`r${value}`} x={width - MARGIN.right + LABEL_OFFSET} y={y(right, value)} dominantBaseline="middle">{tick(value, right)}</text>
          ))}
          {points.map((point, index) => labelled.has(index) && (
            <text key={point.id} x={x(index)} y={bottom + LABEL_OFFSET * 2} textAnchor="middle">{point.label}</text>
          ))}
        </g>
        <g aria-hidden="true">
          {sales.map((value, index) => {
            const top = Math.min(y(left, value), y(left, 0))
            return <rect key={points[index]!.id} className="fill-primary-container" x={x(index) - (slot * BAR_SHARE) / 2} width={slot * BAR_SHARE} y={top} height={Math.abs(y(left, value) - y(left, 0))} rx={2} />
          })}
          {line !== '' && <polyline className="fill-none stroke-tertiary-container stroke-2" points={line} />}
          {shares.map((share, index) => share !== null && <circle key={points[index]!.id} className="fill-tertiary-container" cx={x(index)} cy={y(right, share)} r={DOT_RADIUS} />)}
        </g>
      </svg>
    </div>
  )
}
