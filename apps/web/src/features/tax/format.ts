// Words of SC-12 (PLAN B-MKT §5): rates as percent by string arithmetic, money from decimal strings, never floats.
import { countLabel, formatDay } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { marketAmount } from '../periods/format'
import type { GenerationResult, RateBasis, TaxYearRule, ThresholdBasis, WithholdingRule, YearEndReason } from './types'

/** "0.020000" -> "2 %", "0.205000" -> "20.5 %": the decimal point moved two places in the string, never through a float. */
export function percentText(rate: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rate)
  if (match === null) return rate
  const [, whole, fraction = ''] = match
  const digits = fraction.padEnd(2, '0')
  const integer = `${whole}${digits.slice(0, 2)}`.replace(/^0+(?=\d)/, '')
  const rest = digits.slice(2).replace(/0+$/, '')
  return `${integer}${rest === '' ? '' : `.${rest}`} %`
}

const THRESHOLD_BASIS: Readonly<Record<ThresholdBasis, string>> = {
  current_year_cumulative: 'cumulative',
  prior_year_payer_total: "on the previous tax year's total from this payer",
}

const ROUNDING: Readonly<Record<string, string>> = { half_up: 'half up', half_even: 'half to even' }

export const RATE_BASIS_LABELS: Readonly<Record<RateBasis, string>> = {
  rate: 'Rate of the rule',
  missing_id_rate: 'No tax id: higher rate',
  below_threshold: 'Below the annual threshold',
  no_duty: 'No withholding duty',
}

const ENTITY_WORDS: Readonly<Record<string, string>> = { individual: 'individuals', company: 'companies', partnership: 'partnerships', other: 'other entities' }

/** "2 % above 23.50 per tax year (cumulative), 20 % without a tax id, half up"; "No withholding duty" for rate NULL. */
export function withholdingText(rule: WithholdingRule, market: Pick<Market, 'minor_unit'>): string {
  if (rule.rate === null) return 'No withholding duty'
  const threshold = rule.threshold_minor === null || rule.threshold_basis === null
    ? ''
    : ` above ${marketAmount(rule.threshold_minor, market)} per tax year (${THRESHOLD_BASIS[rule.threshold_basis]})`
  const missing = rule.missing_id_rate === null ? '' : `, ${percentText(rule.missing_id_rate)} without a tax id`
  return `${percentText(rule.rate)}${threshold}${missing}, ${ROUNDING[rule.rounding] ?? rule.rounding}`
}

/** Who a withholding rule applies to (D-BM-03 conditions). */
export function conditionsText(conditions: WithholdingRule['conditions']): string {
  const parts = [
    ...(conditions.entity_types === undefined ? [] : [conditions.entity_types.map((type) => ENTITY_WORDS[type] ?? type).join(', ')]),
    ...(conditions.residency === undefined ? [] : [`resident in ${conditions.residency.join(', ')}`]),
  ]
  return parts.length === 0 ? 'Applies to every payee' : `Applies to ${parts.join('; ')}`
}

export const effectiveText = (rule: { readonly effective_from: string; readonly effective_to: string | null }): string =>
  rule.effective_to === null ? `From ${formatDay(rule.effective_from)}` : `${formatDay(rule.effective_from)} to ${formatDay(rule.effective_to)}`

/** "Starts on November 1 each year": the tax-year rule's month and day in words (BUG-137). */
export function taxYearStartText(rule: Pick<TaxYearRule, 'start_month' | 'start_day'>): string {
  const start = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2000, rule.start_month - 1, rule.start_day))
  return `Starts on ${start} each year; a tax year is named by the calendar year it starts in.`
}

export const REASON_TEXT: Readonly<Record<YearEndReason, string>> = {
  FORM_NOT_DEFINED: "The market's pack defines no year-end form for this tax year.",
  TAX_YEAR_NOT_DEFINED: "The market's pack defines no tax year.",
  TAX_YEAR_NOT_ENDED: "The tax year has not ended yet in the market's time zone.",
  TAX_YEAR_NOT_CLOSED: 'Close these periods first: a period of the tax year is committed or paid but not closed, or has a run waiting to be committed.',
}

/** Today as YYYY-MM-DD in a time zone (en-CA formats dates that way). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** The tax year containing `today` (label = the calendar year it starts in); the calendar year without a tax-year rule. */
export function taxYearOf(today: string, rule: Pick<TaxYearRule, 'start_month' | 'start_day'> | null): number {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  if (rule === null) return year
  const started = month > rule.start_month || (month === rule.start_month && day >= rule.start_day)
  return started ? year : year - 1
}

/** "1 statement generated, 1 unchanged, 1 held: missing tax id". */
export function generationText(result: Pick<GenerationResult, 'generated' | 'unchanged' | 'held'>): string {
  return `${countLabel(result.generated, 'statement')} generated, ${result.unchanged} unchanged, ${result.held.length} held: missing tax id`
}
