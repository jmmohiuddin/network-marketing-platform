import type { ComplianceConfig, ComplianceConfigInput, ComplianceFacts, Ratio } from './types.js'

export class ComplianceInputError extends Error {
  override readonly name = 'ComplianceInputError'
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const FIRST_DAY = 1
const LAST_DAY = 31

function requireMonth(value: string, where: string): void {
  if (!MONTH_PATTERN.test(value)) throw new ComplianceInputError(`${where}: '${value}' is not a YYYY-MM month`)
}

function requireDay(value: number, where: string): void {
  if (!Number.isInteger(value) || value < FIRST_DAY || value > LAST_DAY) {
    throw new ComplianceInputError(`${where}: ${value} is not a day of the month`)
  }
}

function requireUnique(refs: readonly string[], kind: string): void {
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref)) throw new ComplianceInputError(`duplicate ${kind} reference '${ref}'`)
    seen.add(ref)
  }
}

function requireVolume(value: unknown, where: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) throw new ComplianceInputError(`${where} must be a non-negative bigint volume`)
  return value
}

function requireRankThresholds(value: unknown): Readonly<Record<string, bigint>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ComplianceInputError('config.rankThresholdsPvMinor must be an object of named thresholds')
  }
  return Object.fromEntries(Object.entries(value).map(([name, volume]) => [name, requireVolume(volume, `config.rankThresholdsPvMinor.${name}`)]))
}

function requireFlag(value: unknown): Ratio {
  const { numerator, denominator } = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof Ratio, unknown>>
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n || numerator < 0n) {
    throw new ComplianceInputError('config.personalShareFlag must be a non-negative bigint fraction with a positive denominator')
  }
  return { numerator, denominator }
}

/**
 * Validates the tenant settings and drops unset ones. A null setting (the usual shape of an unset stored
 * setting) is unset, never zero: no threshold has a default (E-ADR-11).
 */
export function resolveConfig(input: ComplianceConfigInput): ComplianceConfig {
  if (typeof input !== 'object' || input === null) throw new ComplianceInputError('config must be an object')
  const { activePvMinor, rankThresholdsPvMinor, lateOrderDay, personalShareFlag } = input
  if (lateOrderDay != null) requireDay(lateOrderDay, 'config.lateOrderDay')
  return {
    ...(activePvMinor == null ? {} : { activePvMinor: requireVolume(activePvMinor, 'config.activePvMinor') }),
    ...(rankThresholdsPvMinor == null ? {} : { rankThresholdsPvMinor: requireRankThresholds(rankThresholdsPvMinor) }),
    ...(lateOrderDay == null ? {} : { lateOrderDay }),
    ...(personalShareFlag == null ? {} : { personalShareFlag: requireFlag(personalShareFlag) }),
  }
}

/** Fails fast on input the reports cannot be computed from; the import validator is expected to prevent all of these. */
export function validateInput(facts: ComplianceFacts, drillIdCap: number): void {
  if (!Number.isInteger(drillIdCap) || drillIdCap < 0) {
    throw new ComplianceInputError(`drillIdCap ${drillIdCap} is not a non-negative integer`)
  }
  requireUnique(facts.participants.map((p) => p.participantRef), 'participant')
  requireUnique(facts.orders.map((o) => o.orderRef), 'order')
  requireUnique(facts.payoutLines.map((l) => l.lineRef), 'payout line')
  const participantRefs = new Set(facts.participants.map((p) => p.participantRef))
  for (const participant of facts.participants) {
    requireMonth(participant.enrolledMonth, `participant ${participant.participantRef} enrolledMonth`)
  }
  for (const order of facts.orders) {
    requireMonth(order.orderMonth, `order ${order.orderRef} orderMonth`)
    if (order.orderDay !== null) requireDay(order.orderDay, `order ${order.orderRef} orderDay`)
    if (!participantRefs.has(order.buyerRef)) {
      throw new ComplianceInputError(`order ${order.orderRef}: buyer ${order.buyerRef} is not a participant`)
    }
  }
  for (const line of facts.payoutLines) requireMonth(line.payMonth, `payout line ${line.lineRef} payMonth`)
}
