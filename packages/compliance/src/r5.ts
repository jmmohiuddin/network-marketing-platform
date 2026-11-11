import type { Context } from './context.js'
import { roundedRatio } from './percent.js'
import { isPartialYear, payoutLinesOfYear } from './r3.js'
import { interpolatedPercentile, sortedAscending, sum } from './stats.js'
import type { Figure, Ratio, ReportPeriod } from './types.js'

// shortcut: currency statistics assume 100 minor units per currency unit; make this a per-market exponent when a zero- or three-decimal currency is onboarded.
const MINOR_PER_UNIT = 100n
const CURRENCY_DECIMALS = 2
const LAST_MONTH = '12'
const MEDIAN = 50

const POPULATION = 'All participants of an earning type enrolled on or before the year end, including those who earned nothing'
const BASIS = 'Gross commissions and bonuses net of clawbacks, before expenses; currency units'
const NO_POPULATION = 'Not stated: no participant of an earning type was enrolled on or before the year end.'
const NO_TERMINATION_DATA = 'The export carries no agreement end dates, so every earning-type participant enrolled on or before the year end is included.'

/** Upper bounds in currency units; a value falls in the first band whose bound it does not exceed. */
const BANDS: ReadonlyArray<{ name: string; upTo: bigint | null }> = [
  { name: '0 or less', upTo: 0n },
  { name: '0.01-100', upTo: 100n },
  { name: '100.01-1,000', upTo: 1000n },
  { name: '1,000.01-10,000', upTo: 10000n },
  { name: '>10,000', upTo: null },
]

const PERCENTILES: ReadonlyArray<{ key: string; percentile: number; method: string }> = [
  { key: 'median', percentile: MEDIAN, method: 'Median of yearly earnings (mean of the middle two when the population is even).' },
  { key: 'p75', percentile: 75, method: '75th percentile of yearly earnings, linear interpolation between closest ranks.' },
  { key: 'p90', percentile: 90, method: '90th percentile of yearly earnings, linear interpolation between closest ranks.' },
  { key: 'p99', percentile: 99, method: '99th percentile of yearly earnings, linear interpolation between closest ranks.' },
]

function currency(minor: Ratio | null): string | null {
  return minor === null ? null : roundedRatio(minor.numerator, minor.denominator * MINOR_PER_UNIT, CURRENCY_DECIMALS)
}

function bandIndex(minor: bigint): number {
  const index = BANDS.findIndex((band) => band.upTo !== null && minor <= band.upTo * MINOR_PER_UNIT)
  return index === -1 ? BANDS.length - 1 : index
}

function earningsByParticipant(ctx: Context, year: string): Map<string, bigint> {
  const paid = new Map<string, bigint>()
  for (const line of payoutLinesOfYear(ctx, year)) paid.set(line.payeeRef, (paid.get(line.payeeRef) ?? 0n) + line.amountMinor)
  const yearEnd = `${year}-${LAST_MONTH}`
  const population = [...ctx.participants.values()].filter((p) => p.canEarn && p.enrolledMonth <= yearEnd)
  return new Map(population.map((p) => [p.participantRef, paid.get(p.participantRef) ?? 0n]))
}

/** R5: earnings distribution over all earning-type participants for one calendar year. */
export function computeR5(ctx: Context, year: string): ReportPeriod {
  const earnings = earningsByParticipant(ctx, year)
  const ids = [...earnings.keys()]
  const sorted = sortedAscending([...earnings.values()])
  const count = BigInt(sorted.length)
  const total = sum(sorted)
  const earners = ids.filter((id) => (earnings.get(id) ?? 0n) > 0n)
  const emptyNote = sorted.length === 0 ? NO_POPULATION : null
  const statistic = (key: string, method: string, value: Ratio | null, numerator: bigint | null = null, denominator: bigint | null = null): Figure =>
    ctx.figure({
      key, unit: 'currency', value: currency(value), numerator, denominator, population: POPULATION,
      method: `${method} ${BASIS}.`, note: emptyNote, entity: 'participant', numeratorIds: ids,
    })
  const partial = isPartialYear(ctx, year)
  const largest = sorted.at(-1)
  return {
    report: 'R5', period: year, periodKind: 'year', partial, omitted: [],
    notes: [NO_TERMINATION_DATA, ...(partial ? ['Partial year: fewer than 12 months of payout data. Not publishable.'] : [])],
    figures: [
      ctx.figure({
        key: 'count', unit: 'count', value: count.toString(), numerator: count, population: POPULATION,
        method: 'Count of the population; equals the sum of the band counts.', entity: 'participant', numeratorIds: ids,
      }),
      ctx.percentFigure({
        key: 'earned_more_than_zero_pct', numerator: BigInt(earners.length), denominator: count, population: POPULATION,
        method: `Participants whose payout lines in the year sum to more than zero, over the population. ${BASIS}.`,
        entity: 'participant', numeratorIds: earners, denominatorIds: ids,
      }),
      statistic('mean', 'Sum of yearly earnings over the population count.', sorted.length === 0 ? null : { numerator: total, denominator: count }, total, count),
      ...PERCENTILES.map(({ key, percentile, method }) => statistic(key, method, interpolatedPercentile(sorted, percentile))),
      statistic('max', 'Largest yearly earnings in the population.', largest === undefined ? null : { numerator: largest, denominator: 1n }),
      ...BANDS.map((band, index) => {
        const inBand = ids.filter((id) => bandIndex(earnings.get(id) ?? 0n) === index)
        return ctx.figure({
          key: `bands.${band.name}`, unit: 'count', value: inBand.length.toString(), numerator: BigInt(inBand.length), denominator: count,
          population: POPULATION, method: `Participants whose yearly earnings fall in the band ${band.name} (currency units). ${BASIS}.`,
          entity: 'participant', numeratorIds: inBand, denominatorIds: ids,
        })
      }),
    ],
  }
}
