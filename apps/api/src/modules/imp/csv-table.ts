import { parse } from 'csv-parse/sync'

/** A parsed CSV file: header as written (trimmed) and the data records. */
export interface CsvTable {
  readonly columns: readonly string[]
  readonly records: readonly (readonly string[])[]
}

export type CsvReadResult =
  | { readonly ok: true; readonly table: CsvTable }
  | { readonly ok: false; readonly line: number | null; readonly detail: string }

const BYTE_ORDER_MARK = '﻿'

/** Strict UTF-8 (a BOM is tolerated, as the prototype's utf-8-sig); every record must have the header's width. */
export function readCsv(data: Buffer): CsvReadResult {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return { ok: false, line: null, detail: 'the file is not UTF-8 text' }
  }
  let rows: string[][]
  try {
    rows = parse(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text, { skip_empty_lines: true })
  } catch (error) {
    // csv-parse messages can quote cell values; report the position only.
    const line = (error as { lines?: unknown }).lines
    return {
      ok: false,
      line: typeof line === 'number' ? line : null,
      detail: 'the file is not well-formed CSV (an unbalanced quote or a row with a different number of columns)',
    }
  }
  const [header, ...records] = rows
  if (header === undefined) return { ok: false, line: null, detail: 'the file is empty (no header row)' }
  return { ok: true, table: { columns: header.map((column) => column.trim()), records } }
}

/** Reads a cell by (case-insensitive) column name, trimmed; a column the header lacks reads as ''. */
export function cellReader(table: CsvTable): (record: readonly string[], column: string) => string {
  const index = new Map(table.columns.map((column, position) => [column.toLowerCase(), position]))
  return (record, column) => {
    const position = index.get(column)
    return position === undefined ? '' : (record[position] ?? '').trim()
  }
}

const quoted = (value: string): string => `"${value.replaceAll('"', '""')}"`

/** The table re-serialised with only these columns, cells trimmed and every field quoted (reads back to the same cells). */
export function projectCsv(table: CsvTable, columns: readonly string[]): Buffer {
  const cell = cellReader(table)
  const lines = [columns, ...table.records.map((record) => columns.map((column) => cell(record, column)))]
  return Buffer.from(`${lines.map((line) => line.map(quoted).join(',')).join('\n')}\n`)
}
