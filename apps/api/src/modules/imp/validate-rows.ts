import { cellReader, type CsvTable } from './csv-table.js'
import { lineOf, type FindingLog } from './findings.js'
import {
  MAX_CODE_LENGTH, MAX_ID_LENGTH, ORDER_LEVEL_SOURCE_KINDS, type ImportFile, type RowErrorCode,
} from './vocabulary.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const INTEGER = /^-?\d{1,19}$/
const DAY = /^\d{1,2}$/
const INT8_MIN = -(2n ** 63n)
const INT8_MAX = 2n ** 63n - 1n
const MAX_QUOTED_LENGTH = 40

/** Declared period of a batch, months as YYYY-MM, both inclusive. */
export interface Period {
  readonly from: string
  readonly to: string
}

export interface ParticipantRow {
  readonly ref: string
  readonly typeCode: string
  /** YYYY-MM-01 */
  readonly enrolledMonth: string
  readonly servicingRef: string | null
}

export interface OrderRow {
  readonly ref: string
  /** YYYY-MM-DD */
  readonly orderDate: string
  readonly buyerRef: string
  readonly amount: bigint
  readonly volume: bigint
  readonly purposeCode: string
  /** Partner code of is_starter_kit as exported ('' when empty); resolved at load (mapping or published 0/1). */
  readonly starterKitCode: string
  readonly refunded: bigint
  /** YYYY-MM-01 or null */
  readonly refundMonth: string | null
}

export interface PayoutRow {
  readonly ref: string
  /** YYYY-MM-01 */
  readonly payMonth: string
  readonly payeeRef: string
  readonly bonusType: string
  readonly sourceKindCode: string
  readonly sourceOrderRef: string | null
  readonly amount: bigint
}

interface RecordCheck {
  fail(code: RowErrorCode, column: string, detail: string): void
  ok(): boolean
}

function recordCheck(log: FindingLog, file: ImportFile, recordIndex: number): RecordCheck {
  let ok = true
  return {
    fail(code, column, detail) {
      ok = false
      log.add({ file, rowNo: lineOf(recordIndex), column, code, detail })
    },
    ok: () => ok,
  }
}

/** An id with '@' is an email address, not a pseudonym (BR-IMP-02, OQ-30: no content detection beyond this). */
const looksLikeEmail = (value: string): boolean => value.includes('@')

/** A cell value for a finding's detail; an email-like value is never echoed into the stored report. */
const quote = (value: string): string => {
  if (looksLikeEmail(value)) return '(value withheld: looks like an email address)'
  return `'${value.length > MAX_QUOTED_LENGTH ? `${value.slice(0, MAX_QUOTED_LENGTH)}...` : value}'`
}

/** Integer minor units ('' = 0, as the prototype), within bigint range; null when not a whole number. */
function minorUnits(value: string): bigint | null {
  if (value === '') return 0n
  if (!INTEGER.test(value)) return null
  const amount = BigInt(value)
  return amount < INT8_MIN || amount > INT8_MAX ? null : amount
}

function daysIn(month: string): number {
  const [year, monthNo] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, monthNo!, 0)).getUTCDate()
}

/** A YYYY-MM inside the declared period; returns whether it is a valid month at all. */
function checkPeriodMonth(check: RecordCheck, label: string, month: string, period: Period): boolean {
  if (!MONTH.test(month)) {
    check.fail('INVALID_VALUE', 'month', `${label}: month ${quote(month)} is not YYYY-MM`)
    return false
  }
  if (month < period.from || month > period.to) {
    check.fail('OUT_OF_RANGE', 'month', `${label}: month ${month} is outside the declared period ${period.from}..${period.to}`)
  }
  return true
}

function checkAmount(check: RecordCheck, label: string, column: string, value: string): bigint | null {
  const amount = minorUnits(value)
  if (amount === null) {
    check.fail('INVALID_VALUE', column, `${label}: ${column}=${quote(value)} is not an integer (amounts must be whole minor units)`)
  }
  return amount
}

/** Order amounts are never negative; only payout lines are signed (clawbacks). */
function checkOrderAmount(check: RecordCheck, label: string, column: string, value: string): bigint | null {
  const amount = checkAmount(check, label, column, value)
  if (amount === null || amount >= 0n) return amount
  check.fail('INVALID_VALUE', column, `${label}: ${column} is negative (only payout line amounts may be)`)
  return null
}

/** Every id copied into the facts: pseudonymous (BR-IMP-02) and short enough for the fact indexes. */
function checkId(check: RecordCheck, column: string, value: string): boolean {
  if (looksLikeEmail(value)) {
    check.fail('NOT_PSEUDONYMOUS', column, `${column} looks like an email address; ids must be pseudonymous`)
    return false
  }
  if (value.length > MAX_ID_LENGTH) {
    check.fail('INVALID_VALUE', column, `${column} is longer than ${MAX_ID_LENGTH} characters`)
    return false
  }
  return true
}

/** A partner code a mapping names: non-empty (unless optional) and within the mapping's code length. */
function checkCode(check: RecordCheck, label: string, column: string, value: string, optional = false): void {
  if (value === '' && !optional) check.fail('INVALID_VALUE', column, `${label}: ${column} is empty`)
  if (value.length > MAX_CODE_LENGTH) check.fail('INVALID_VALUE', column, `${label}: ${column} is longer than ${MAX_CODE_LENGTH} characters`)
}

/** Non-empty and unique key; every key seen is remembered so later references to it are not orphans. */
function checkKey(check: RecordCheck, column: string, value: string, seen: Set<string>): void {
  if (value === '') {
    check.fail('INVALID_VALUE', column, `${column} is empty`)
    return
  }
  if (checkId(check, column, value) && seen.has(value)) check.fail('DUPLICATE_KEY', column, `duplicate ${column} ${quote(value)}`)
  seen.add(value)
}

function checkReference(check: RecordCheck, label: string, column: string, value: string, known: ReadonlySet<string>, file: string): void {
  if (value === '') check.fail('INVALID_VALUE', column, `${label}: ${column} is empty`)
  else if (checkId(check, column, value) && !known.has(value)) {
    check.fail('ORPHAN_REFERENCE', column, `${label}: ${column} ${quote(value)} not in ${file}`)
  }
}

export interface ParticipantCheck {
  readonly rows: readonly ParticipantRow[]
  readonly ids: ReadonlySet<string>
  readonly sponsorsOutsideFile: number
}

export function checkParticipants(table: CsvTable, log: FindingLog): ParticipantCheck {
  const cell = cellReader(table)
  const ids = new Set<string>()
  const rows: ParticipantRow[] = []
  table.records.forEach((record, index) => {
    const check = recordCheck(log, 'participants', index)
    const ref = cell(record, 'participant_id')
    const label = `participant ${quote(ref)}`
    checkKey(check, 'participant_id', ref, ids)
    const typeCode = cell(record, 'type')
    checkCode(check, label, 'type', typeCode)
    const enrolled = cell(record, 'enrolled_month')
    if (!MONTH.test(enrolled)) {
      check.fail('INVALID_VALUE', 'enrolled_month', `${label}: enrolled_month ${quote(enrolled)} is not YYYY-MM`)
    }
    // sponsor_id becomes the servicing reference in the facts (R4), so it must be pseudonymous as well.
    const sponsor = cell(record, 'sponsor_id')
    if (sponsor !== '') checkId(check, 'sponsor_id', sponsor)
    if (check.ok()) rows.push({ ref, typeCode, enrolledMonth: `${enrolled}-01`, servicingRef: sponsor === '' ? null : sponsor })
  })
  const sponsorsOutsideFile = rows.filter((row) => row.servicingRef !== null && !ids.has(row.servicingRef)).length
  return { rows, ids, sponsorsOutsideFile }
}

export interface OrderCheck {
  readonly rows: readonly OrderRow[]
  readonly ids: ReadonlySet<string>
  readonly refundsWithoutMonth: number
}

function checkDay(check: RecordCheck, label: string, day: string, month: string | null): void {
  const last = month === null ? 31 : daysIn(month)
  if (!DAY.test(day) || Number(day) < 1 || Number(day) > last) {
    check.fail('INVALID_VALUE', 'day', `${label}: day ${quote(day)} is not a day of the month`)
  }
}

function checkOrderCodes(check: RecordCheck, label: string, purpose: string, kit: string, refundMonth: string): void {
  checkCode(check, label, 'purpose', purpose)
  checkCode(check, label, 'is_starter_kit', kit, true)
  if (refundMonth !== '' && !MONTH.test(refundMonth)) {
    check.fail('INVALID_VALUE', 'refund_month', `${label}: refund_month ${quote(refundMonth)} is not YYYY-MM`)
  }
}

export function checkOrders(table: CsvTable, log: FindingLog, participantIds: ReadonlySet<string>, period: Period): OrderCheck {
  const cell = cellReader(table)
  const ids = new Set<string>()
  const rows: OrderRow[] = []
  let refundsWithoutMonth = 0
  table.records.forEach((record, index) => {
    const check = recordCheck(log, 'orders', index)
    const ref = cell(record, 'order_id')
    const label = `order ${quote(ref)}`
    checkKey(check, 'order_id', ref, ids)
    const month = cell(record, 'month')
    const day = cell(record, 'day')
    checkDay(check, label, day, checkPeriodMonth(check, label, month, period) ? month : null)
    const buyerRef = cell(record, 'buyer_id')
    checkReference(check, label, 'buyer_id', buyerRef, participantIds, 'participants.csv')
    const amount = checkOrderAmount(check, label, 'amount_cents', cell(record, 'amount_cents'))
    const volume = checkOrderAmount(check, label, 'volume_cents', cell(record, 'volume_cents'))
    const refunded = checkOrderAmount(check, label, 'refunded_cents', cell(record, 'refunded_cents'))
    if (amount !== null && refunded !== null && refunded > amount) {
      check.fail('REFUND_EXCEEDS_AMOUNT', 'refunded_cents', `${label}: refunded more than the order amount`)
    }
    const [purposeCode, kit, refundMonth] = [cell(record, 'purpose'), cell(record, 'is_starter_kit'), cell(record, 'refund_month')]
    checkOrderCodes(check, label, purposeCode, kit, refundMonth)
    if (!check.ok() || amount === null || volume === null || refunded === null) return
    if (refunded > 0n && refundMonth === '') refundsWithoutMonth += 1
    rows.push({
      ref, orderDate: `${month}-${day.padStart(2, '0')}`, buyerRef, amount, volume, purposeCode, starterKitCode: kit,
      refunded, refundMonth: refundMonth === '' ? null : `${refundMonth}-01`,
    })
  })
  return { rows, ids, refundsWithoutMonth }
}

function checkSourceOrder(check: RecordCheck, label: string, kind: string, sourceOrder: string, orderIds: ReadonlySet<string>): void {
  checkCode(check, label, 'source_kind', kind)
  if (sourceOrder !== '' && checkId(check, 'source_order_id', sourceOrder) && !orderIds.has(sourceOrder)) {
    check.fail('ORPHAN_REFERENCE', 'source_order_id', `${label}: source_order_id ${quote(sourceOrder)} not in orders.csv`)
  }
  if (sourceOrder === '' && ORDER_LEVEL_SOURCE_KINDS.has(kind)) {
    check.fail('ORPHAN_REFERENCE', 'source_order_id', `${label}: a ${kind} line must name its source order (needed for R2 and R3)`)
  }
}

export function checkPayoutLines(
  table: CsvTable, log: FindingLog, participantIds: ReadonlySet<string>, orderIds: ReadonlySet<string>, period: Period,
): readonly PayoutRow[] {
  const cell = cellReader(table)
  const ids = new Set<string>()
  const rows: PayoutRow[] = []
  table.records.forEach((record, index) => {
    const check = recordCheck(log, 'payout_lines', index)
    const ref = cell(record, 'line_id')
    const label = `line ${quote(ref)}`
    checkKey(check, 'line_id', ref, ids)
    const month = cell(record, 'month')
    checkPeriodMonth(check, label, month, period)
    const payeeRef = cell(record, 'payee_id')
    checkReference(check, label, 'payee_id', payeeRef, participantIds, 'participants.csv')
    const [sourceKindCode, sourceOrder] = [cell(record, 'source_kind'), cell(record, 'source_order_id')]
    checkSourceOrder(check, label, sourceKindCode, sourceOrder, orderIds)
    const amount = checkAmount(check, label, 'amount_cents', cell(record, 'amount_cents'))
    if (!check.ok() || amount === null) return
    rows.push({
      ref, payMonth: `${month}-01`, payeeRef, bonusType: cell(record, 'bonus_type'), sourceKindCode,
      sourceOrderRef: sourceOrder === '' ? null : sourceOrder, amount,
    })
  })
  return rows
}
