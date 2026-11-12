import type { FigureSummary, ReportCode } from './types'

/** SC-10 snapshot list (SC-46, the overview, is /compliance). */
export const SNAPSHOTS_PATH = '/compliance/snapshots'

// shortcut: snapshot views carry market_id only (no code, no markets endpoint); show the code once the API adds it.
export function marketLabel(marketId: string): string {
  return `market ${marketId}`
}

/** "2025-01" or "2025-01 to 2025-03". */
export function periodRange(from: string, to: string): string {
  return from === to ? from : `${from} to ${to}`
}

/** Date and time in the user's locale. */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** An integer decimal string (counts, minor units) with the locale's digit grouping; bigint-safe. */
export function integer(value: string | number): string {
  return BigInt(value).toLocaleString()
}

/** "payout_lines" -> "Payout lines"; "amount_minor" -> "Amount (minor units)". */
export function humanize(name: string): string {
  const minor = name.endsWith('_minor')
  const words = (minor ? name.slice(0, -'_minor'.length) : name).replace(/[_.]+/g, ' ').trim()
  const text = words.charAt(0).toUpperCase() + words.slice(1)
  return minor ? `${text} (minor units)` : text
}

export const REPORT_NAMES: Readonly<Record<ReportCode, string>> = {
  R1: 'Retail-customer share',
  R2: 'Personal-use share',
  R3: 'Payout sources',
  R4: 'Qualification by purchase',
  R5: 'Earnings distribution',
}

// Past tense and "in the period/year" on purpose: figures describe history, never what anyone will earn (BR-HON-01).
const FIGURE_LABELS: Readonly<Record<string, string>> = {
  net_sales_cents: 'Net sales',
  customer_share_pct: 'Customer share of net sales',
  customer_plus_declared_resale_pct: 'Customer share including declared resale',
  starter_kit_share_pct: 'Starter-kit share of net sales',
  participant_orders_purpose_unknown_pct: 'Participant orders with unknown purpose',
  rewarded_volume_cents: 'Volume that earned multi-level pay',
  personal_use_share_pct: 'Personal-use share of rewarded volume',
  unknown_purpose_share_pct: 'Unknown-purpose share of rewarded volume',
  unattributable_lines: 'Payout lines without a known source order',
  unattributable_amount_cents: 'Pay on lines without a known source order',
  payees_with_multilevel_pay: 'Payees who received multi-level pay',
  payees_above_flag: 'Payees above the personal-use flag',
  flag_threshold: 'Personal-use flag threshold',
  gross_cents: 'Payouts excluding clawbacks',
  clawback_cents: 'Clawbacks',
  active_distributors: 'Active distributors',
  active_with_no_customer_order_pct: 'Active distributors with no customer order',
  late_threshold_crossing_orders: 'Late orders that crossed a threshold',
  of_which_refunded_later: 'Of those, refunded later',
  count: 'Participants of an earning type',
  earned_more_than_zero_pct: 'Share who earned more than zero',
  mean: 'Mean earnings in the year',
  median: 'Median earnings in the year',
  p75: '75th percentile of earnings in the year',
  p90: '90th percentile of earnings in the year',
  p99: '99th percentile of earnings in the year',
  max: 'Largest earnings in the year',
}

/** Reader's name of a figure key; R3 shares and R5 bands carry their kind or band in the key. */
export function figureLabel(key: string): string {
  if (key.startsWith('share_pct.')) return `Share of payouts from ${humanize(key.slice('share_pct.'.length)).toLowerCase()}`
  if (key.startsWith('bands.')) return `Participants with earnings ${key.slice('bands.'.length)}`
  return FIGURE_LABELS[key] ?? humanize(key)
}

/** The value as stated by the method, with its unit; "Not stated" when the method gives none. */
export function figureValue(figure: Pick<FigureSummary, 'unit' | 'value'>): string {
  if (figure.value === null) return 'Not stated'
  switch (figure.unit) {
    case 'percent': return `${figure.value} %`
    case 'count': return integer(figure.value)
    case 'minor': return `${integer(figure.value)} minor units`
    case 'currency': return `${figure.value} currency units`
    case 'ratio': return figure.value
  }
}

/** `{report}.{period}.{key}` split back; the key may itself contain dots. */
export function parseFigureId(id: string): { readonly report: ReportCode; readonly period: string; readonly key: string } | null {
  const match = /^(R[1-5])\.(\d{4}(?:-\d{2})?)\.(.+)$/.exec(id)
  if (match === null) return null
  return { report: match[1] as ReportCode, period: match[2]!, key: match[3]! }
}
