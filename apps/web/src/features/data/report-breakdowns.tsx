import Link from 'next/link'
import type { ReactNode } from 'react'
import { MeterBar } from '../../components/charts'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { figureAmount, figureLabel, figureValue, humanize, integer, sharePercent } from './format'
import type { Figure, PeriodResult, ReportCode } from './types'
import { NOTE } from './ui'

// sc_10 report anatomy drawn from the period's own figures: R1 segmentation bar (l.118), R3 breakdown table (l.233),
// R5 distribution mini-chart (l.333). Every number is a figure the API states, or an exact share of two of them.

const SHARE_PREFIX = 'share_pct.'
const BAND_PREFIX = 'bands.'
const LINK = 'text-primary hover:underline font-medium'

/** Figure keys a breakdown shows as rows, so they are not repeated as figure cards. */
export function inBreakdown(report: ReportCode, key: string): boolean {
  return (report === 'R3' && key.startsWith(SHARE_PREFIX)) || (report === 'R5' && key.startsWith(BAND_PREFIX))
}

const stated = (figure: Figure | undefined): figure is Figure & { readonly value: string } => figure?.value != null
const position = (percent: string | null) => (percent === null ? 0 : Number(percent))

/** sc_10 card shell: header strip with the report chip and a title, then the drawing. */
function BreakdownCard({ code, title, meta, children }: { readonly code: ReportCode; readonly title: string; readonly meta?: string; readonly children: ReactNode }) {
  return (
    <article aria-label={title} className="rounded bg-surface-container-lowest border border-outline-variant shadow-sm overflow-hidden">
      <div className="bg-surface-container-low px-space-md py-space-sm border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="px-2 py-0.5 rounded bg-primary text-on-primary font-data-mono-sm text-data-mono-sm font-bold">{code}</span>
          <h3 className="font-section-heading text-section-heading text-on-surface">{title}</h3>
        </div>
        {meta !== undefined && <span className="font-data-mono-sm text-data-mono-sm text-secondary">{meta}</span>}
      </div>
      <div className="p-space-md flex flex-col gap-space-sm">{children}</div>
    </article>
  )
}

interface Segment {
  readonly name: string
  readonly amount: bigint
  readonly percent: string | null
  readonly fill: string
  readonly swatch: string
}

/**
 * R1 net sales split by buyer: end-customer buyers, participant orders declared as resale, other participant orders.
 * The three parts partition the month's orders (customer_plus_declared_resale adds only non-customer resale orders).
 */
export function r1Segments(figures: readonly Figure[]): readonly Segment[] | null {
  const of = (key: string) => figures.find((figure) => figure.key === key)
  const net = of('net_sales_cents')
  const customer = of('customer_share_pct')?.numerator
  const withResale = of('customer_plus_declared_resale_pct')?.numerator
  if (!stated(net) || customer == null || withResale == null) return null
  const total = BigInt(net.value)
  const parts = [
    { name: 'End-customer buyers', amount: BigInt(customer), fill: 'fill-tertiary-container', swatch: 'bg-tertiary-container' },
    { name: 'Participant orders declared as resale', amount: BigInt(withResale) - BigInt(customer), fill: 'fill-primary-container', swatch: 'bg-primary-container' },
    { name: 'Other participant orders', amount: total - BigInt(withResale), fill: 'fill-secondary', swatch: 'bg-secondary' },
  ]
  if (total <= 0n || parts.some((part) => part.amount < 0n)) return null
  return parts.map((part) => ({ ...part, percent: sharePercent(part.amount, total) }))
}

function R1Breakdown({ result }: { readonly result: PeriodResult }) {
  const segments = r1Segments(result.figures)
  const net = result.figures.find((figure) => figure.key === 'net_sales_cents')
  if (segments === null || net === undefined) return null
  const lefts = segments.map((_, index) => segments.slice(0, index).reduce((sum, part) => sum + position(part.percent), 0))
  const label = `Net sales by buyer: ${segments.map((part) => `${part.name} ${part.percent ?? '—'} %`).join(', ')}`
  return (
    <BreakdownCard code="R1" title="Net sales by buyer" meta={`${figureValue(net)} in total`}>
      {/* Widths are SVG attributes, not style attributes (CSP). */}
      <svg className="block h-6 w-full rounded bg-surface-container border border-outline-variant" role="img" aria-label={label}>
        {segments.map((part, index) => (
          <rect key={part.name} className={part.fill} x={`${lefts[index]}%`} width={`${position(part.percent)}%`} height="100%" />
        ))}
      </svg>
      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-body-sm text-body-sm">
        {segments.map((part) => (
          <li key={part.name} className="flex flex-col">
            <span className="flex items-center gap-1 text-on-surface font-medium">
              <span className={`h-2 w-2 shrink-0 rounded-full ${part.swatch}`} aria-hidden="true" />{part.name}
            </span>
            <span className="font-data-mono-sm text-data-mono-sm text-secondary">{integer(part.amount.toString())} minor units ({part.percent ?? '—'} %)</span>
          </li>
        ))}
      </ul>
    </BreakdownCard>
  )
}

const rowsLink = (rowsHref: (figureId: string) => string, figure: Figure, text: string) => (
  <Link href={rowsHref(figure.id)} className={LINK} aria-label={`${text}: open the rows behind ${figureLabel(figure.key).toLowerCase()}`}>{text}</Link>
)

/** R3 breakdown table: each source kind's payouts (the share's numerator) and its share of gross payouts. */
function R3Breakdown({ result, rowsHref }: { readonly result: PeriodResult; readonly rowsHref: (figureId: string) => string }) {
  const shares = result.figures.filter((figure) => figure.key.startsWith(SHARE_PREFIX))
  const [first] = shares
  if (first === undefined) return null
  const columns: DataTableColumn<Figure>[] = [
    { key: 'kind', header: 'Source kind', cell: (figure) => rowsLink(rowsHref, figure, humanize(figure.key.slice(SHARE_PREFIX.length))) },
    { key: 'amount', header: 'Paid (minor units)', align: 'end', cell: (figure) => (figure.numerator === null ? '—' : integer(figure.numerator)) },
    { key: 'share', header: 'Share of payouts', align: 'end', cell: (figure) => figureAmount(figure) },
  ]
  return (
    <BreakdownCard code="R3" title="Payouts by source kind">
      <div className="border border-outline-variant rounded overflow-hidden">
        <DataTable caption={`Payouts by source kind, ${result.period}`} columns={columns} rows={shares} rowKey={(figure) => figure.id} empty={{ title: 'No payouts.' }} density="compact" bare />
      </div>
      <p className={NOTE}>{first.method === null ? '' : `${first.method} `}Population: {first.population ?? '—'}.</p>
    </BreakdownCard>
  )
}

/** R5 distribution mini-chart: participants per yearly-earnings band, as count and exact share of the population. */
function R5Breakdown({ result, rowsHref }: { readonly result: PeriodResult; readonly rowsHref: (figureId: string) => string }) {
  const bands = result.figures.filter(stated).filter((figure) => figure.key.startsWith(BAND_PREFIX))
  if (bands.length === 0) return null
  return (
    <BreakdownCard code="R5" title="Participants by yearly earnings" meta="Bands in currency units">
      <ul className="flex flex-col gap-1.5 font-caption text-caption">
        {bands.map((band) => {
          const name = band.key.slice(BAND_PREFIX.length)
          const percent = band.denominator === null ? null : sharePercent(band.value, band.denominator)
          return (
            <li key={band.id} className="flex flex-col gap-1">
              <div className="flex justify-between items-center gap-space-sm">
                {rowsLink(rowsHref, band, name)}
                <span className="font-data-mono-sm text-data-mono-sm font-medium text-on-surface">{percent === null ? integer(band.value) : `${percent} % (${integer(band.value)})`}</span>
              </div>
              <MeterBar percent={position(percent)} label={`${figureLabel(band.key)}: ${integer(band.value)}${percent === null ? '' : `, ${percent} %`}`} />
            </li>
          )
        })}
      </ul>
    </BreakdownCard>
  )
}

/** The drawn breakdown of one report period, or nothing when the report has none or its figures are not stated. */
export function ReportBreakdown({ result, rowsHref }: { readonly result: PeriodResult; readonly rowsHref: (figureId: string) => string }) {
  if (result.report === 'R1') return <R1Breakdown result={result} />
  if (result.report === 'R3') return <R3Breakdown result={result} rowsHref={rowsHref} />
  if (result.report === 'R5') return <R5Breakdown result={result} rowsHref={rowsHref} />
  return null
}
