import type { Context } from './context.js'
import { formatRatio } from './percent.js'
import { sum } from './stats.js'
import type { Figure, OmittedIndicator, OrderFact, PayoutLineFact, Ratio, ReportPeriod } from './types.js'

const LINE_POPULATION = 'Positive payout lines of source kind downline_volume paid in the month'
const ORDER_POPULATION = 'Distinct source orders of the positive downline_volume payout lines paid in the month'
const PAYEE_POPULATION = 'Payees with at least one positive downline_volume payout line in the month'
const FLAG_DECIMALS = 4
const FLAG_UNSET = 'The personal-use share flag threshold is not set for this tenant; it is set by the tenant\'s counsel and has no default.'

interface PayeePay { total: bigint; personal: bigint }

const volumeOf = (orders: readonly OrderFact[]): bigint => sum(orders.map((o) => o.volumeMinor))
const orderRefs = (orders: readonly OrderFact[]): string[] => orders.map((o) => o.orderRef)

function payByPayee(lines: readonly PayoutLineFact[], sourceOf: (line: PayoutLineFact) => OrderFact | undefined): Map<string, PayeePay> {
  const pay = new Map<string, PayeePay>()
  for (const line of lines) {
    const previous = pay.get(line.payeeRef) ?? { total: 0n, personal: 0n }
    const personal = sourceOf(line)?.purpose === 'personal' ? line.amountMinor : 0n
    pay.set(line.payeeRef, { total: previous.total + line.amountMinor, personal: previous.personal + personal })
  }
  return pay
}

function flagFigures(ctx: Context, pay: ReadonlyMap<string, PayeePay>, flag: Ratio): Figure[] {
  const payees = [...pay.keys()]
  const flagged = payees.filter((payee) => {
    const { total, personal } = pay.get(payee) ?? { total: 0n, personal: 0n }
    return personal * flag.denominator > flag.numerator * total
  })
  return [
    ctx.figure({
      key: 'payees_above_flag', unit: 'count', value: flagged.length.toString(),
      numerator: BigInt(flagged.length), denominator: BigInt(payees.length), population: PAYEE_POPULATION,
      method: 'Payees whose pay from personal-use orders is strictly greater than the flag threshold share of their multi-level pay. Payee ids only.',
      entity: 'participant', numeratorIds: flagged, denominatorIds: payees,
    }),
    ctx.figure({
      key: 'flag_threshold', unit: 'ratio', value: formatRatio(flag, FLAG_DECIMALS),
      numerator: flag.numerator, denominator: flag.denominator, population: PAYEE_POPULATION, populationCount: payees.length,
      method: 'Tenant setting: personal-use share of multi-level pay above which a payee is flagged.',
      entity: 'participant', numeratorIds: [],
    }),
  ]
}

/** R2: personal-use share of the volume that multi-level pay was earned on, per payout month. */
export function computeR2(ctx: Context, month: string): ReportPeriod {
  const lines = (ctx.linesByMonth.get(month) ?? []).filter((l) => l.sourceKind === 'downline_volume' && l.amountMinor > 0n)
  const sourceOf = (line: PayoutLineFact): OrderFact | undefined =>
    line.sourceOrderRef === null ? undefined : ctx.ordersByRef.get(line.sourceOrderRef)
  const unattributable = lines.filter((l) => sourceOf(l) === undefined)
  const orders = [...new Set(lines.map(sourceOf).filter((o): o is OrderFact => o !== undefined))]
  const volume = volumeOf(orders)
  const pay = payByPayee(lines, sourceOf)
  const purposeShare = (key: string, purpose: OrderFact['purpose']): Figure => {
    const matching = orders.filter((o) => o.purpose === purpose)
    return ctx.percentFigure({
      key, numerator: volumeOf(matching), denominator: volume, population: ORDER_POPULATION,
      method: `Volume of rewarded source orders with purpose ${purpose}, over rewarded volume. Full order volume, not net of refunds; lines without a known source order are excluded.`,
      entity: 'order', numeratorIds: orderRefs(matching), denominatorIds: orderRefs(orders),
    })
  }
  const unattributableFigure = (key: string, unit: 'count' | 'minor', value: bigint): Figure =>
    ctx.figure({
      key, unit, value: value.toString(), numerator: value, population: LINE_POPULATION,
      method: 'Lines with no source order reference, or one that matches no order. Excluded from rewarded volume; their pay still counts in the payee\'s multi-level pay, never as personal-use pay.',
      entity: 'payout_line', numeratorIds: unattributable.map((l) => l.lineRef), denominatorIds: lines.map((l) => l.lineRef),
    })
  const flag = ctx.config.personalShareFlag
  const omitted: OmittedIndicator[] = flag ? [] : [{ key: 'payees_above_flag', reason: FLAG_UNSET }, { key: 'flag_threshold', reason: FLAG_UNSET }]
  return {
    report: 'R2', period: month, periodKind: 'month', partial: false, omitted,
    notes: unattributable.length > 0
      ? [`${unattributable.length} multi-level payout line(s) could not be attributed to a source order and are excluded from rewarded volume.`]
      : [],
    figures: [
      ctx.figure({
        key: 'rewarded_volume_cents', unit: 'minor', value: volume.toString(), numerator: volume, population: ORDER_POPULATION,
        method: 'Sum of the full volume of each distinct source order (not net of refunds).',
        entity: 'order', numeratorIds: orderRefs(orders),
      }),
      purposeShare('personal_use_share_pct', 'personal'),
      purposeShare('unknown_purpose_share_pct', 'unknown'),
      unattributableFigure('unattributable_lines', 'count', BigInt(unattributable.length)),
      unattributableFigure('unattributable_amount_cents', 'minor', sum(unattributable.map((l) => l.amountMinor))),
      ctx.figure({
        key: 'payees_with_multilevel_pay', unit: 'count', value: pay.size.toString(), numerator: BigInt(pay.size),
        population: PAYEE_POPULATION, method: 'Count of distinct payees.', entity: 'participant', numeratorIds: [...pay.keys()],
      }),
      ...(flag ? flagFigures(ctx, pay, flag) : []),
    ],
  }
}
