import { yearOf, type Context } from './context.js'
import { sum } from './stats.js'
import type { PayoutLineFact, ReportPeriod } from './types.js'

const MONTHS_IN_YEAR = 12
const SHARE_METHOD = 'Sum of payout amounts of this source kind, over gross payouts (all source kinds except clawback).'

const amountOf = (lines: readonly PayoutLineFact[]): bigint => sum(lines.map((l) => l.amountMinor))
const refs = (lines: readonly PayoutLineFact[]): string[] => lines.map((l) => l.lineRef)

function mix(ctx: Context, period: string, periodKind: 'month' | 'year', lines: readonly PayoutLineFact[], partial: boolean): ReportPeriod {
  const population = `All payout lines paid in the ${periodKind}`
  const populationCount = lines.length // every R3 figure is taken over all lines, clawbacks included (BUG-019)
  const clawbacks = lines.filter((l) => l.sourceKind === 'clawback')
  const grossLines = lines.filter((l) => l.sourceKind !== 'clawback')
  const gross = amountOf(grossLines)
  const kinds = [...new Set(grossLines.map((l) => l.sourceKind))].sort()
  const notes = [
    ...(kinds.includes('unknown') ? ['Some payout lines have source kind unknown; they are included in gross payouts and shown as their own share.'] : []),
    ...(partial ? ['Partial year: fewer than 12 months of payout data. Not publishable.'] : []),
  ]
  return {
    report: 'R3', period, periodKind, partial, omitted: [], notes,
    figures: [
      ctx.figure({
        key: 'gross_cents', unit: 'minor', value: gross.toString(), numerator: gross, population, populationCount,
        method: 'Sum of payout amounts of every source kind except clawback.', entity: 'payout_line', numeratorIds: refs(grossLines),
      }),
      ctx.figure({
        key: 'clawback_cents', unit: 'minor', value: amountOf(clawbacks).toString(), numerator: amountOf(clawbacks), population, populationCount,
        method: 'Sum of payout amounts of source kind clawback (negative); reported separately, not in the shares.',
        entity: 'payout_line', numeratorIds: refs(clawbacks),
      }),
      ...kinds.map((kind) => {
        const ofKind = grossLines.filter((l) => l.sourceKind === kind)
        return ctx.percentFigure({
          key: `share_pct.${kind}`, numerator: amountOf(ofKind), denominator: gross, population, populationCount, method: SHARE_METHOD,
          entity: 'payout_line', numeratorIds: refs(ofKind), denominatorIds: refs(grossLines),
        })
      }),
    ],
  }
}

/** R3: payout source mix for one payout month. */
export function computeR3Month(ctx: Context, month: string): ReportPeriod {
  return mix(ctx, month, 'month', ctx.linesByMonth.get(month) ?? [], false)
}

export function payoutMonthsOfYear(ctx: Context, year: string): string[] {
  return [...ctx.linesByMonth.keys()].filter((month) => yearOf(month) === year)
}

export function isPartialYear(ctx: Context, year: string): boolean {
  return payoutMonthsOfYear(ctx, year).length < MONTHS_IN_YEAR
}

export function payoutLinesOfYear(ctx: Context, year: string): PayoutLineFact[] {
  return payoutMonthsOfYear(ctx, year).flatMap((month) => ctx.linesByMonth.get(month) ?? [])
}

/** R3: payout source mix for one calendar year. */
export function computeR3Year(ctx: Context, year: string): ReportPeriod {
  return mix(ctx, year, 'year', payoutLinesOfYear(ctx, year), isPartialYear(ctx, year))
}
