import type { ComplianceFacts, ParticipantFact, PayoutLineFact, ReportCode } from '@nmp/compliance'
import type { FigureRef } from './figures.js'

/**
 * AC-41.1 / TS-34: the per-participant amounts behind a participant figure, so its rows sum to (or rank to) the
 * figure's components. Same selections as @nmp/compliance: R2 positive downline_volume lines of the month,
 * R4 own orders of earning-type participants in the month, R5 payout lines of the year net of clawbacks.
 */
export interface ParticipantMeasures {
  readonly columns: readonly string[]
  /** One amount per column, minor units; a participant without any is zero in every column. */
  readonly of: (participant: ParticipantFact) => readonly bigint[]
}

type Totals = ReadonlyMap<string, readonly bigint[]>

function totalsBy<T>(items: readonly T[], keyOf: (item: T) => string, amountsOf: (item: T) => readonly bigint[]): Totals {
  const totals = new Map<string, readonly bigint[]>()
  for (const item of items) {
    const amounts = amountsOf(item)
    const previous = totals.get(keyOf(item)) ?? amounts.map(() => 0n)
    totals.set(keyOf(item), previous.map((total, index) => total + amounts[index]!))
  }
  return totals
}

function r2Pay(facts: ComplianceFacts, month: string): Totals {
  const purposeOf = new Map(facts.orders.map((order) => [order.orderRef, order.purpose]))
  const lines = facts.payoutLines.filter((l) => l.payMonth === month && l.sourceKind === 'downline_volume' && l.amountMinor > 0n)
  const personal = (line: PayoutLineFact): bigint =>
    line.sourceOrderRef !== null && purposeOf.get(line.sourceOrderRef) === 'personal' ? line.amountMinor : 0n
  return totalsBy(lines, (line) => line.payeeRef, (line) => [line.amountMinor, personal(line)])
}

function r4Volume(facts: ComplianceFacts, month: string): Totals {
  const earners = new Set(facts.participants.filter((p) => p.canEarn).map((p) => p.participantRef))
  const orders = facts.orders.filter((order) => order.orderMonth === month && earners.has(order.buyerRef))
  return totalsBy(orders, (order) => order.buyerRef, (order) => [order.volumeMinor])
}

function r5Earnings(facts: ComplianceFacts, year: string): Totals {
  const lines = facts.payoutLines.filter((line) => line.payMonth.startsWith(`${year}-`))
  return totalsBy(lines, (line) => line.payeeRef, (line) => [line.amountMinor])
}

const MEASURES: Readonly<Partial<Record<ReportCode, { columns: readonly string[]; totals: (facts: ComplianceFacts, period: string) => Totals }>>> = {
  R2: { columns: ['multilevel_pay_minor', 'personal_use_pay_minor'], totals: r2Pay },
  R4: { columns: ['personal_volume_minor'], totals: r4Volume },
  R5: { columns: ['earnings_minor'], totals: r5Earnings },
}

export function participantMeasures(ref: FigureRef, facts: ComplianceFacts): ParticipantMeasures {
  const measure = MEASURES[ref.report]
  if (measure === undefined) return { columns: [], of: () => [] }
  const totals = measure.totals(facts, ref.period)
  const zero = measure.columns.map(() => 0n)
  return { columns: measure.columns, of: (participant) => totals.get(participant.participantRef) ?? zero }
}
