import type {
  ComplianceConfig, ComplianceReports, Figure, OrderFact, ParticipantFact, PayoutLineFact, ReportCode, ReportPeriod,
} from '../src/index.js'

/** The prototype's fixture configuration (DEFAULT_CONFIG in analytics.py). Test values only; the product ships none. */
export const FIXTURE_CONFIG: ComplianceConfig = {
  activePvMinor: 5000n,
  rankThresholdsPvMinor: { active: 5000n, leader: 10000n },
  lateOrderDay: 27,
  personalShareFlag: { numerator: 1n, denominator: 3n },
}

export function period(reports: ComplianceReports, report: ReportCode, key: string): ReportPeriod {
  const found = reports.reports.find((r) => r.report === report && r.period === key)
  if (!found) throw new Error(`no ${report} for ${key}`)
  return found
}

export function figure(reports: ComplianceReports, report: ReportCode, periodKey: string, key: string): Figure {
  const found = period(reports, report, periodKey).figures.find((f) => f.key === key)
  if (!found) throw new Error(`no figure ${report} ${periodKey} ${key}`)
  return found
}

export function value(reports: ComplianceReports, report: ReportCode, periodKey: string, key: string): string | null {
  return figure(reports, report, periodKey, key).value
}

export function participant(participantRef: string, kind: 'distributor' | 'customer', enrolledMonth: string, servicingRef: string | null = null): ParticipantFact {
  const isCustomer = kind === 'customer'
  return { participantRef, typeCode: kind, countsAsEndCustomer: isCustomer, canEarn: !isCustomer, enrolledMonth, servicingRef }
}

export function order(orderRef: string, orderDay: number | null, buyerRef: string, amountMinor: bigint, purpose: OrderFact['purpose'], overrides: Partial<OrderFact> = {}): OrderFact {
  return {
    orderRef, orderMonth: '2025-01', orderDay, buyerRef, amountMinor, volumeMinor: amountMinor, purpose,
    isStarterKit: false, refundedMinor: 0n, refundMonth: null, ...overrides,
  }
}

export function line(lineRef: string, payMonth: string, payeeRef: string, sourceKind: PayoutLineFact['sourceKind'], sourceOrderRef: string | null, amountMinor: bigint): PayoutLineFact {
  return { lineRef, payMonth, payeeRef, bonusType: sourceKind, sourceKind, sourceOrderRef, amountMinor }
}
