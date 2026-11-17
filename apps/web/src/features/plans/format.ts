// Words, paths and exact money text of SC-04, SC-05, SC-42. A simulation is labelled "Simulated" (BR-HON-01).
import { formatDateTimeIn } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { isUuid } from '../admin/format'
import { decimal, integer } from '../data/format'
import { minorToDecimal } from '../orders/format'
import type { CalendarRef, GateName, VersionState } from './types'

export const PLANS_PATH = '/v1/plans'
const VERSION_MAX = 1_000_000

/** The version number of a /plans/[id]/versions/[v] route, or null when the id or number cannot be one (they go into API paths). */
export function versionNumber(planId: string, v: string): number | null {
  const version = Number(v)
  return isUuid(planId) && /^[1-9]\d*$/.test(v) && version <= VERSION_MAX ? version : null
}
export const versionApi = (planId: string, version: number): string => `${PLANS_PATH}/${planId}/versions/${version}`
export const versionPage = (planId: string, version: number): string => `/plans/${planId}/versions/${version}`
export const simulationPage = (planId: string, version: number, simulationId: string): string => `${versionPage(planId, version)}/simulations/${simulationId}`

/** The rule kinds of the engine catalogue (packages/engine plan.ts RULE_KINDS) in words. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  'volume.personal': 'Personal volume',
  'volume.group': 'Group volume',
  'volume.enrolled_group': 'Enrolled-group volume',
  'count.customers': 'Customer count',
  'count.enrolled': 'Enrolled count',
  'measure.derived': 'Derived measure (expression)',
  ladder: 'Rank ladder',
  'pay.retail_margin': 'Retail margin',
  'pay.percent_by_level': 'Percent by level',
  'pay.generations': 'Generations',
  'pay.percent_of_measure': 'Percent of a measure',
  'pay.differential': 'Differential',
  'pay.override': 'Override',
  'pay.matching': 'Matching',
  'pay.fast_start': 'Fast start',
  'pay.flat': 'Flat amount',
  'pay.one_time': 'One-time amount',
  'pay.pool': 'Pool',
  'limit.max_per_period': 'Maximum per period',
  'limit.max_share_from_purpose': 'Maximum share from a purpose',
  cap: 'Cap',
  carry: 'Carry',
  counter: 'Counter',
  points_factor: 'Points factor',
  customer_roll_up: 'Customer roll-up',
  'genealogy.reparent_on_termination': 'Re-parent on termination',
  'genealogy.change_window': 'Genealogy change window',
  'genealogy.positions_limit': 'Positions per participant',
}
export const RULE_KINDS = Object.keys(KIND_LABELS)

export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind
export const isBonus = (kind: string): boolean => kind.startsWith('pay.')
/** Measures a bonus, cap or pool can name. */
export const isMeasure = (kind: string): boolean => kind.startsWith('volume.') || kind.startsWith('count.') || kind === 'measure.derived'

/** Engine passes in run order (plan_rule.pass) with what each computes. */
export const PASSES: readonly { readonly pass: string; readonly title: string }[] = [
  { pass: '1', title: 'Personal volume' },
  { pass: '2', title: 'Group measures and derived values' },
  { pass: '3', title: 'Ranks, carry and counters' },
  { pass: '4', title: 'Bonuses' },
  { pass: '5', title: 'Matching' },
  { pass: '6', title: 'Pools' },
  { pass: '7', title: 'Participant limits' },
  { pass: '8', title: 'Caps' },
  { pass: '10', title: 'Points factors' },
  { pass: 'structure', title: 'Genealogy rules' },
]
export const passBadge = (pass: string): string => (pass === 'structure' ? 'STRUCTURE' : `PASS ${pass}`)

export const STATE_LABELS: Readonly<Record<VersionState, string>> = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved', scheduled: 'Scheduled', active: 'Active', retired: 'Retired',
}

export const CREDITING_LABELS = { paid: 'When paid', fulfilled: 'When fulfilled' } as const
export const REVERSAL_LABELS = { order_line: 'Reverse the order line', restatement: 'Restate the period' } as const

/** The submit and schedule gates (D-B3-04) as the governance checklist names them. */
export const GATE_LABELS: Readonly<Record<GateName, string>> = {
  validation: 'Rules valid',
  crediting_event: 'Crediting event chosen',
  goldens: 'Golden datasets pass',
  coverage: 'Extension rules covered',
  guardrails: 'Guardrail decisions resolved',
  simulation: 'Simulated in this form',
  transitions: 'Transitions declared',
}

/** GET /v1/simulations/:id distribution buckets (per-payee change against the baseline). */
export const BUCKET_LABELS: Readonly<Record<string, string>> = {
  '<-10%': 'More than 10% lower',
  '-10..-1%': '1% to 10% lower',
  '-1..+1%': 'Within 1%',
  '+1..+10%': '1% to 10% higher',
  '>+10%': 'More than 10% higher',
  new: 'New payees',
  gone: 'No longer paid',
}

export const CAP_METHOD_LABELS: Readonly<Record<string, string>> = { proportional: 'Proportional', priority: 'Priority', per_person: 'Per person' }

/** The currency and minor unit of a plan calendar's market, from the plan's calendars and GET /v1/markets. */
export interface Currency { readonly code: string; readonly minorUnit: number }

export function currencyOf(calendarId: string | undefined, calendars: readonly CalendarRef[], markets: readonly Market[] | null): Currency | null {
  const market = calendarMarket(calendarId, calendars, markets)
  return market === undefined ? null : { code: market.currency, minorUnit: market.minor_unit }
}

function calendarMarket(calendarId: string | undefined, calendars: readonly CalendarRef[], markets: readonly Market[] | null): Market | undefined {
  const code = calendars.find((c) => c.id === calendarId)?.market_code
  return code === undefined ? undefined : markets?.find((m) => m.code === code)
}

/**
 * The zone a plan calendar's periods and effective times are named in (BUG-091); undefined while unknown (the
 * viewer's zone, named). shortcut: the calendar's market zone stands in for its cut-off zone, which plan screens do not
 * load (GET /v1/periods); read the calendar's zone if markets and calendars ever differ.
 */
export const calendarZone = (calendarId: string | undefined, calendars: readonly CalendarRef[], markets: readonly Market[] | null): string | undefined =>
  calendarMarket(calendarId, calendars, markets)?.time_zone

/** A version's effective instant (a period start of the plan's calendars) in the zone of its first calendar, named. */
export const effectiveText = (at: string, calendars: readonly CalendarRef[], markets: readonly Market[] | null): string =>
  formatDateTimeIn(at, calendarZone(calendars[0]?.id, calendars, markets))

/** Exact money text of a minor-unit string; minor units as such while the currency is unknown. */
export function money(minor: string, currency: Currency | null): string {
  return currency === null ? `${integer(minor)} minor units` : `${decimal(minorToDecimal(minor, currency.minorUnit))} ${currency.code}`
}

/** A change with its sign: "+12.00 EUR", "−3.00 EUR" (U+2212), "0.00 EUR". */
export function delta(minor: string, currency: Currency | null): string {
  if (minor.startsWith('-')) return `−${money(minor.slice(1), currency)}`
  return BigInt(minor) === 0n ? money(minor, currency) : `+${money(minor, currency)}`
}

