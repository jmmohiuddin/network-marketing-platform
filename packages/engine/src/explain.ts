// Statement explanation of one result line from its compact trace (FR-COMP-007: trace totals = line amount).
import { formatUnits as decimal, RAW_SCALE, toRaw } from './money.js'
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

const DAY_US = 86_400_000_000n
const pad = (v: bigint, width: number): string => v.toString().padStart(width, '0')

/** µs since the Unix epoch as an ISO-8601 UTC instant with microseconds (civil-from-days in bigint, no Date: BUG-092). */
function isoInstant(us: bigint): string {
  let days = us / DAY_US
  let inDay = us % DAY_US
  if (inDay < 0n) {
    inDay += DAY_US
    days -= 1n
  }
  const z = days + 719468n // days from 0000-03-01
  const era = (z >= 0n ? z : z - 146096n) / 146097n
  const doe = z - era * 146097n
  const yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n)
  const mp = (5n * doy + 2n) / 153n
  const day = doy - (153n * mp + 2n) / 5n + 1n
  const month = mp < 10n ? mp + 3n : mp - 9n
  const year = yoe + era * 400n + (month <= 2n ? 1n : 0n)
  const s = inDay / 1_000_000n
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(s / 3600n, 2)}:${pad((s / 60n) % 60n, 2)}:${pad(s % 60n, 2)}.${pad(inDay % 1_000_000n, 6)}Z`
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
    `${t.rule} (${t.kind}, pass ${t.pass}) for position ${t.payeePositionId}${ranks ? `; paid-as ${ranks}` : ''}${t.tree ? `; ${t.tree.kind} tree known at ${isoInstant(t.tree.knownAtUs)}` : ''}`,
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
