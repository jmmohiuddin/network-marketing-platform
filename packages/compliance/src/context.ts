import { buildFigure, buildPercentFigure, DEFAULT_DRILL_ID_CAP, type FigureInput, type PercentInput } from './figure.js'
import type {
  ComplianceConfig, ComplianceConfigInput, ComplianceFacts, ComputeOptions, Figure, OrderFact, ParticipantFact, PayoutLineFact,
} from './types.js'
import { ComplianceInputError, resolveConfig, validateInput } from './validate.js'

export interface Context {
  readonly config: ComplianceConfig
  readonly participants: ReadonlyMap<string, ParticipantFact>
  readonly ordersByRef: ReadonlyMap<string, OrderFact>
  readonly ordersByMonth: ReadonlyMap<string, readonly OrderFact[]>
  readonly linesByMonth: ReadonlyMap<string, readonly PayoutLineFact[]>
  /** Sorted distinct months over orders and payout lines. */
  readonly months: readonly string[]
  /** Sorted distinct calendar years of `months`. */
  readonly years: readonly string[]
  buyer(order: OrderFact): ParticipantFact
  figure(input: FigureInput): Figure
  percentFigure(input: PercentInput): Figure
}

const YEAR_LENGTH = 4

export function yearOf(month: string): string {
  return month.slice(0, YEAR_LENGTH)
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const group = groups.get(keyOf(item))
    if (group) group.push(item)
    else groups.set(keyOf(item), [item])
  }
  return groups
}

export function buildContext(facts: ComplianceFacts, configInput: ComplianceConfigInput, options: ComputeOptions): Context {
  const cap = options.drillIdCap ?? DEFAULT_DRILL_ID_CAP
  validateInput(facts, cap)
  const config = resolveConfig(configInput)
  const participants = new Map(facts.participants.map((p) => [p.participantRef, p]))
  const ordersByMonth = groupBy(facts.orders, (o) => o.orderMonth)
  const linesByMonth = groupBy(facts.payoutLines, (l) => l.payMonth)
  const months = [...new Set([...ordersByMonth.keys(), ...linesByMonth.keys()])].sort()
  return {
    config,
    participants,
    ordersByRef: new Map(facts.orders.map((o) => [o.orderRef, o])),
    ordersByMonth,
    linesByMonth,
    months,
    years: [...new Set(months.map(yearOf))],
    buyer(order) {
      const buyer = participants.get(order.buyerRef)
      if (!buyer) throw new ComplianceInputError(`order ${order.orderRef}: buyer ${order.buyerRef} is not a participant`)
      return buyer
    },
    figure: (input) => buildFigure(input, cap),
    percentFigure: (input) => buildPercentFigure(input, cap),
  }
}
