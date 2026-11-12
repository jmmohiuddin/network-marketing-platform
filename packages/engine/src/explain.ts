// Statement explanation of one result line from its compact trace (FR-COMP-007: trace totals = line amount).
import { RAW_SCALE, toRaw } from './money.js'
import type { ResultLine, Trace, TraceSource } from './types.js'

export interface Explanation {
  readonly lines: readonly string[] // statement text, one entry per source or step
  readonly reconciles: boolean // sources sum to trace.raw and the steps lead to the line amount
}

/** Minor amount the trace arrives at, or null when the sources do not sum to trace.raw or no whole amount results. */
export function traceAmountMinor(trace: Trace): bigint | null {
  const sources = trace.sources.reduce((a, s) => a + s.raw, 0n) + trace.omitted.raw
  if (sources !== trace.raw) return null
  let raw = trace.raw
  let minor: bigint | null = null
  for (const s of trace.steps) {
    if (s.step === 'constraint' || s.step === 'points') {
      if (s.beforeRaw !== raw) return null
      raw = s.afterRaw
      minor = null
    } else if (s.step === 'rounding') {
      if (s.raw !== raw) return null
      minor = s.minor
      raw = toRaw(minor)
    } else {
      minor = s.afterMinor // cap or allocation fixes the amount
      raw = toRaw(minor)
    }
  }
  return minor ?? (raw % RAW_SCALE === 0n ? raw / RAW_SCALE : null)
}

/** Decimal text of `units` scaled by 10^digits, e.g. (12345n, 2) -> "123.45", (-5n, 2) -> "-0.05". */
function decimal(units: bigint, digits: number, trim: boolean): string {
  const negative = units < 0n
  const magnitude = (negative ? -units : units).toString().padStart(digits + 1, '0')
  const whole = magnitude.slice(0, magnitude.length - digits)
  let fraction = magnitude.slice(magnitude.length - digits)
  if (trim) fraction = fraction.replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

const RAW_DIGITS = RAW_SCALE.toString().length - 1

/** Raw (minor x RAW_SCALE) as currency text with at least minorDigits places and no trailing zeros beyond them. */
function rawText(raw: bigint, minorDigits: number): string {
  const full = decimal(raw, minorDigits + RAW_DIGITS, true)
  const [whole, fraction = ''] = full.split('.')
  return `${whole}.${fraction.padEnd(minorDigits, '0')}`.replace(/\.$/, '')
}

function sourceText(s: TraceSource, minorDigits: number): string {
  const where = [s.level === null ? null : `level ${s.level}`, s.positionId === null ? 'company' : `position ${s.positionId}`, s.ruleKey === null ? null : `bonus ${s.ruleKey}`]
  const base = s.baseScale === 'minor' ? decimal(s.base, minorDigits, false) : rawText(s.base, minorDigits)
  const what = s.measure === null ? base : `${s.measure} ${base}`
  const orders = s.orders.length > 0 ? `; orders ${s.orders.map((o) => `${o.orderId} ${rawText(o.raw, minorDigits)}`).join(', ')}` : ''
  const over = s.compressedOver.length > 0 ? `; compressed over ${s.compressedOver.join(', ')}` : ''
  const share = s.share === null ? '' : ` x ${s.share.num}/${s.share.den}`
  const cap = s.capMinor === null ? '' : ` capped at ${decimal(s.capMinor, minorDigits, false)}`
  return `${where.filter((w) => w !== null).join(', ')}: ${what}${s.rate === null ? '' : ` x ${s.rate}`}${share}${cap} = ${rawText(s.raw, minorDigits)}${orders}${over}`
}

export function explain(line: ResultLine, minorDigits: number): Explanation {
  const t = line.trace
  const money = (minor: bigint): string => decimal(minor, minorDigits, false)
  const raw = (r: bigint): string => rawText(r, minorDigits)
  const ranks = t.rankEvaluated.map((r) => `${r.ladder} ${r.rank ?? 'none'}`).join(', ')
  const out: string[] = [
    `${t.rule} (${t.kind}, pass ${t.pass}) for position ${t.payeePositionId}${ranks ? `; paid-as ${ranks}` : ''}${t.tree ? `; ${t.tree.kind} tree known at ${t.tree.knownAtUs}` : ''}`,
    ...t.sources.map((s) => sourceText(s, minorDigits)),
  ]
  if (t.omitted.count > 0) out.push(`${t.omitted.count} further sources = ${raw(t.omitted.raw)}`)
  out.push(`calculated = ${raw(t.raw)}`)
  for (const s of t.steps) {
    if (s.step === 'constraint') out.push(`limit ${s.key}: ${raw(s.beforeRaw)} -> ${raw(s.afterRaw)}`)
    else if (s.step === 'cap') out.push(`cap ${s.key} (${s.method}): ${raw(s.beforeRaw)} -> ${money(s.afterMinor)}`)
    else if (s.step === 'allocation') out.push(`allocation ${s.key}: weight ${s.weight} of ${money(s.totalMinor)} -> ${money(s.afterMinor)}`)
    else if (s.step === 'points') out.push(`points x ${s.factor}: ${raw(s.beforeRaw)} -> ${raw(s.afterRaw)}`)
    else out.push(`rounded ${s.mode}: ${raw(s.raw)} -> ${money(s.minor)}`)
  }
  if (line.origin) out.push(`origin ${line.origin.originType} ${line.origin.originId}${line.origin.originalPeriodId ? ` (period ${line.origin.originalPeriodId})` : ''}`)
  out.push(`amount ${money(line.amountMinor)} ${line.currency}`)
  return { lines: out, reconciles: traceAmountMinor(t) === line.amountMinor }
}
