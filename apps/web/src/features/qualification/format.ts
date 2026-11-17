// SC-43 words for a committed qualification state row (engine state fields; values are minor-unit strings).
import { decimal, integer } from '../data/format'
import { minorToDecimal } from '../orders/format'
import type { QualificationRow } from './types'

/**
 * How values print (BUG-090): volumes (measures, carry, banked) on the market's currency scale like SC-31, counts
 * (count.* measures, unit 1) as integers. Whole minor units while the market or the plan's measure kinds are unknown.
 */
export interface MeasureScale {
  readonly minorUnit: number
  readonly counts: ReadonlySet<string>
}

/** Keys of the count measures of a plan version's rules. */
export const countMeasures = (rules: readonly { readonly rule_key: string; readonly kind: string }[]): ReadonlySet<string> =>
  new Set(rules.filter((rule) => rule.kind.startsWith('count.')).map((rule) => rule.rule_key))

const volumeText = (minor: string, scale: MeasureScale | null): string =>
  scale === null ? integer(minor) : decimal(minorToDecimal(minor, scale.minorUnit))

/** "main: R1" per ladder (paid-as and title are separate ladders' worth of facts, AC-46.1). */
export function ranksText(ranks: QualificationRow['paid_as']): string {
  return ranks.length === 0 ? '—' : ranks.map((rank) => `${rank.ladder}: ${rank.rank ?? 'none'}`).join(', ')
}

/** Measure keys across rows, sorted, for one column each. */
export function measureKeys(rows: readonly QualificationRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.measures.map((measure) => measure.measure)))].sort()
}

export function measureText(row: QualificationRow, key: string, scale: MeasureScale | null): string {
  const found = row.measures.find((measure) => measure.measure === key)
  if (found === undefined) return '—'
  return scale?.counts.has(key) === true ? integer(found.valueMinor) : volumeText(found.valueMinor, scale)
}

/** Headers of the state facts besides ranks and measures, in stateFacts order. */
export const STATE_FACTS = ['Carry', 'Counters', 'Flags', 'Banked', 'Grace used'] as const

/** Carry, counters, one-time flags, banked volumes and grace used of a row, as text in STATE_FACTS order. */
export function stateFacts(row: QualificationRow, scale: MeasureScale | null): readonly string[] {
  const list = (items: readonly string[]) => (items.length === 0 ? '—' : items.join(', '))
  return [
    list(row.carry.map((carry) => `${carry.key} ${volumeText(carry.amountMinor, scale)} (${carry.periodsHeld} held)`)),
    list(row.counters.map((counter) => `${counter.key} ${counter.value}`)),
    list(row.one_time_flags),
    list(row.banked.map((bank) => `${bank.key} ${volumeText(bank.amountMinor, scale)}`)),
    list(row.grace_used.map((grace) => `${grace.ladder} ${grace.periods}`)),
  ]
}

/** Every compared fact of a row as label -> text (Compare periods). */
export function factsOf(row: QualificationRow, keys: readonly string[], scale: MeasureScale | null): readonly (readonly [string, string])[] {
  const state = stateFacts(row, scale)
  return [
    ['Paid-as', ranksText(row.paid_as)],
    ['Title', ranksText(row.titles)],
    ...keys.map((key) => [`Measure ${key}`, measureText(row, key, scale)] as const),
    ...STATE_FACTS.map((label, index) => [label, state[index]!] as const),
  ]
}
