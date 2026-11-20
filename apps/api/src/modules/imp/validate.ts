import { projectCsv, readCsv, type CsvTable } from './csv-table.js'
import { findingLog, type Finding, type FindingLog, type ImportWarning } from './findings.js'
import { holdsEmailAddresses, isForbiddenColumn } from './forbidden-columns.js'
import {
  checkGenealogy, checkOrders, checkParticipants, checkPayoutLines, type OrderCheck, type OrderRow, type ParticipantCheck,
  type ParticipantRow, type PayoutRow, type Period,
} from './validate-rows.js'
import { IMPORT_FILES, MAX_CODES, REQUIRED_COLUMNS, type ImportFile, type ImportKind } from './vocabulary.js'

/** At most this many findings are stored per batch (see FindingLog). */
export const MAX_KEPT_FINDINGS = 10_000

export interface RowCounts {
  readonly participants: number
  readonly orders: number
  readonly payout_lines: number
}

/** Sums in minor units, as decimal strings (bigint, never Number). */
export interface ControlTotals {
  readonly order_amount_minor: string
  readonly order_volume_minor: string
  readonly order_refunded_minor: string
  readonly payout_amount_minor: string
}

/** Distinct partner codes with their row counts: what a mapping has to cover (FR-IMP-002). */
export interface SourceValues {
  readonly participant_types: Readonly<Record<string, number>>
  readonly purposes: Readonly<Record<string, number>>
  readonly source_kinds: Readonly<Record<string, number>>
  /** Non-empty is_starter_kit codes; codes other than 0 and 1 need a starter_kits mapping. */
  readonly starter_kits: Readonly<Record<string, number>>
}

export interface ImportRows {
  readonly participants: readonly ParticipantRow[]
  readonly orders: readonly OrderRow[]
  readonly payoutLines: readonly PayoutRow[]
}

export interface ValidationResult {
  readonly errorCount: number
  readonly findings: readonly Finding[]
  readonly warnings: readonly ImportWarning[]
  readonly rowCounts: RowCounts | null
  /** Only when there is no error, like sourceValues and rows. */
  readonly controlTotals: ControlTotals | null
  readonly sourceValues: SourceValues | null
  readonly rows: ImportRows | null
  /**
   * What is stored for the load: each file with the published columns only, re-serialised (projectCsv), so a
   * column outside the format never reaches the FileStore. Only when there is no error.
   */
  readonly storedFiles: Readonly<Record<ImportFile, Buffer>> | null
}

/** File-level checks (MVP_A 3.3 V1-V3): readable CSV, no forbidden column, every required column once. */
function readTable(file: ImportFile, data: Buffer, log: FindingLog): CsvTable | null {
  const result = readCsv(data)
  if (!result.ok) {
    log.add({ file, rowNo: result.line, column: null, code: 'SCHEMA_MISMATCH', detail: `${file}.csv: ${result.detail}` })
    return null
  }
  const { columns } = result.table
  const lower = columns.map((column) => column.toLowerCase())
  const outsideFormat = (index: number): boolean => !REQUIRED_COLUMNS[file].includes(lower[index]!)
  columns.forEach((column, index) => {
    if (isForbiddenColumn(column) || (outsideFormat(index) && holdsEmailAddresses(result.table, index))) {
      log.add({ file, rowNo: 1, column, code: 'FORBIDDEN_COLUMN', detail: 'the column looks like personal or bank data and must be removed before upload' })
    }
    if (lower.indexOf(lower[index]!) !== index) {
      log.add({ file, rowNo: 1, column, code: 'SCHEMA_MISMATCH', detail: 'the column appears more than once' })
    }
  })
  for (const required of REQUIRED_COLUMNS[file]) {
    if (!lower.includes(required)) {
      log.add({ file, rowNo: 1, column: required, code: 'SCHEMA_MISMATCH', detail: 'a required column is missing' })
    }
  }
  return result.table
}

function countBy<T>(rows: readonly T[], codeOf: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(codeOf(row), (counts.get(codeOf(row)) ?? 0) + 1)
  return Object.fromEntries([...counts].sort(([left], [right]) => (left < right ? -1 : 1)))
}

const sum = (values: readonly bigint[]): string => values.reduce((total, value) => total + value, 0n).toString()

function totalsOf(rows: ImportRows): ControlTotals {
  return {
    order_amount_minor: sum(rows.orders.map((order) => order.amount)),
    order_volume_minor: sum(rows.orders.map((order) => order.volume)),
    order_refunded_minor: sum(rows.orders.map((order) => order.refunded)),
    payout_amount_minor: sum(rows.payoutLines.map((line) => line.amount)),
  }
}

function warningsOf(participants: ParticipantCheck, orders: OrderCheck): ImportWarning[] {
  const types = Object.keys(countBy(participants.rows, (row) => row.typeCode))
  const warnings: ImportWarning[] = [{
    code: 'PARTICIPANT_TYPES', file: 'participants', count: types.length,
    detail: `participant types found: ${types.join(', ')}; confirm in the mapping which are end customers and which can earn`,
  }]
  if (participants.sponsorsOutsideFile > 0) {
    warnings.push({
      code: 'SPONSOR_NOT_IN_FILE', file: 'participants', count: participants.sponsorsOutsideFile,
      detail: 'participants have a sponsor_id not in the file (export cut-off or data error)',
    })
  }
  if (orders.refundsWithoutMonth > 0) {
    warnings.push({
      code: 'REFUND_WITHOUT_MONTH', file: 'orders', count: orders.refundsWithoutMonth,
      detail: 'refunded orders have no refund_month (R4 refund follow-up will miss them)',
    })
  }
  return warnings
}

/** Codes per vocabulary are capped where a mapping is (MAX_CODES); more could never be mapped. */
const CODE_COLUMNS: readonly (readonly [ImportFile, string, keyof SourceValues])[] = [
  ['participants', 'type', 'participant_types'], ['orders', 'purpose', 'purposes'],
  ['orders', 'is_starter_kit', 'starter_kits'], ['payout_lines', 'source_kind', 'source_kinds'],
]

function checkCodeCounts(values: SourceValues, log: FindingLog): void {
  for (const [file, column, key] of CODE_COLUMNS) {
    const count = Object.keys(values[key]).length
    if (count > MAX_CODES) {
      log.add({ file, rowNo: null, column, code: 'INVALID_VALUE', detail: `${count} distinct ${column} values; a mapping can name at most ${MAX_CODES}` })
    }
  }
}

function sourceValuesOf(rows: ImportRows): SourceValues {
  return {
    participant_types: countBy(rows.participants, (row) => row.typeCode),
    purposes: countBy(rows.orders, (row) => row.purposeCode),
    source_kinds: countBy(rows.payoutLines, (row) => row.sourceKindCode),
    starter_kits: countBy(rows.orders.filter((row) => row.starterKitCode !== ''), (row) => row.starterKitCode),
  }
}

const storedFilesOf = (tables: readonly CsvTable[]): Record<ImportFile, Buffer> =>
  Object.fromEntries(IMPORT_FILES.map((file, index) => [file, projectCsv(tables[index]!, REQUIRED_COLUMNS[file])])) as Record<ImportFile, Buffer>

const rejectedEarly = (log: FindingLog): ValidationResult => ({
  errorCount: log.total(), findings: log.kept, warnings: [], rowCounts: null, controlTotals: null, sourceValues: null, rows: null,
  storedFiles: null,
})

/**
 * Validates the three export files against the published format (FR-IMP-001, MVP_A 3.3) before anything is
 * stored. File-level problems stop the check before the rows (as the prototype). A migration batch also gets the
 * genealogy checks (checkGenealogy). Pure: same input, same result.
 */
export function validateImport(files: Readonly<Record<ImportFile, Buffer>>, period: Period, kind: ImportKind): ValidationResult {
  const log = findingLog(MAX_KEPT_FINDINGS)
  const [participantTable, orderTable, payoutTable] = IMPORT_FILES.map((file) => readTable(file, files[file], log))
  if (log.total() > 0 || participantTable == null || orderTable == null || payoutTable == null) return rejectedEarly(log)

  const checked = checkParticipants(participantTable, log)
  if (kind === 'migration') checkGenealogy(checked, log)
  // A migration's sponsors outside the file are errors (checkGenealogy), not the overlay's warning.
  const participants = kind === 'migration' ? { ...checked, sponsorsOutsideFile: 0 } : checked
  const orders = checkOrders(orderTable, log, participants.ids, period)
  const payoutLines = checkPayoutLines(payoutTable, log, participants.ids, orders.ids, period)
  const rowCounts = {
    participants: participantTable.records.length, orders: orderTable.records.length, payout_lines: payoutTable.records.length,
  }
  const warnings = warningsOf(participants, orders)
  const rows = { participants: participants.rows, orders: orders.rows, payoutLines }
  const sourceValues = sourceValuesOf(rows)
  checkCodeCounts(sourceValues, log)
  if (log.total() > 0) {
    return {
      errorCount: log.total(), findings: log.kept, warnings, rowCounts, controlTotals: null, sourceValues: null, rows: null, storedFiles: null,
    }
  }
  const storedFiles = storedFilesOf([participantTable, orderTable, payoutTable])
  return { errorCount: 0, findings: [], warnings, rowCounts, controlTotals: totalsOf(rows), sourceValues, rows, storedFiles }
}
