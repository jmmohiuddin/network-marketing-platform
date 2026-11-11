import type { ImportFile, RowErrorCode } from './vocabulary.js'

/** One blocking validation error; becomes an import_row_error row. rowNo counts the header as line 1. */
export interface Finding {
  readonly file: ImportFile
  readonly rowNo: number | null
  readonly column: string | null
  readonly code: RowErrorCode
  readonly detail: string
}

/** A non-blocking observation kept in import_batch.report.warnings. */
export interface ImportWarning {
  readonly code: string
  readonly file: ImportFile
  readonly count: number
  readonly detail: string
}

/**
 * Collects findings. Every finding is counted; at most `cap` are kept, so a huge broken file cannot exhaust
 * memory or the database.
 * shortcut: only the first `cap` findings are stored (the total is in report.error_count); raise the cap if
 * partners need complete reports of very large broken files.
 */
export interface FindingLog {
  add(finding: Finding): void
  readonly kept: readonly Finding[]
  total(): number
}

export function findingLog(cap: number): FindingLog {
  const kept: Finding[] = []
  let total = 0
  return {
    add(finding) {
      total += 1
      if (kept.length < cap) kept.push(finding)
    },
    kept,
    total: () => total,
  }
}

/** First data record is on line 2 (the header is line 1), as a spreadsheet shows it. */
export const lineOf = (recordIndex: number): number => recordIndex + 2
