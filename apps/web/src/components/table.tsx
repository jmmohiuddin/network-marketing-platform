'use client'

import type { ReactNode } from 'react'
import { Button } from './button'
import { EmptyState } from './states'

export interface TableColumn<T> {
  readonly key: string
  /** Units or currency go here, once per table ("Amount (EUR)"). */
  readonly header: string
  readonly cell: (row: T) => ReactNode
  /** end: numbers, right-aligned and tabular. */
  readonly align?: 'start' | 'end'
}

export interface TablePagination {
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  readonly onPrevious: () => void
  readonly onNext: () => void
}

export interface TableProps<T> {
  /** The summary sentence above the table ("1,284 payees · 412,300.00 total"); also the table's name. */
  readonly caption: string
  readonly columns: readonly TableColumn<T>[]
  readonly rows: readonly T[]
  readonly rowKey: (row: T) => string
  readonly loading?: boolean
  /** A failed load: the message and a retry that keeps the current filters. */
  readonly error?: { readonly message: string; readonly onRetry: () => void } | null
  /** First use: what will appear and the first action. No results: say so and offer to clear filters. */
  readonly empty: { readonly title: string; readonly action?: ReactNode }
  /** Cursor pagination (useCursorPages): Previous and Next only, no page numbers. */
  readonly pagination?: TablePagination
  readonly density?: 'comfortable' | 'compact'
}

const SKELETON_ROWS = 5
function FullRow({ span, children }: { readonly span: number; readonly children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="table-full-row">{children}</td>
    </tr>
  )
}

/**
 * Data table (UI-04, UX-05 §6.2): cursor pages, loading skeleton, empty and error states.
 * The first column names the row (a th) and should hold its link.
 */
export function Table<T>({ caption, columns, rows, rowKey, loading = false, error = null, empty, pagination, density = 'comfortable' }: TableProps<T>) {
  const span = columns.length
  const alignClass = (column: TableColumn<T>) => (column.align === 'end' ? 'cell-end' : undefined)
  function body(): ReactNode {
    if (loading) {
      return Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {columns.map((column) => <td key={column.key}><span className="skeleton" /></td>)}
        </tr>
      ))
    }
    if (error !== null) {
      return (
        <FullRow span={span}>
          <div className="table-error" role="alert">
            <p>{error.message}</p>
            <Button onClick={error.onRetry}>Try again</Button>
          </div>
        </FullRow>
      )
    }
    if (rows.length === 0) return <FullRow span={span}><EmptyState title={empty.title} action={empty.action} /></FullRow>
    return rows.map((row) => (
      <tr key={rowKey(row)}>
        {columns.map((column, index) => index === 0
          ? <th key={column.key} scope="row" className={alignClass(column)}>{column.cell(row)}</th>
          : <td key={column.key} className={alignClass(column)}>{column.cell(row)}</td>)}
      </tr>
    ))
  }
  return (
    <div className="table-block">
      <div className="table-scroll">
        <table className={`table table-${density}`} aria-busy={loading || undefined}>
          <caption className="table-caption">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={alignClass(column)}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>{body()}</tbody>
        </table>
      </div>
      {loading && <p className="visually-hidden" role="status">Loading rows</p>}
      {pagination !== undefined && (
        <nav className="pagination" aria-label={`Pages of ${caption}`}>
          <Button onClick={pagination.onPrevious} disabled={!pagination.hasPrevious || loading}>Previous page</Button>
          <Button onClick={pagination.onNext} disabled={!pagination.hasNext || loading}>Next page</Button>
        </nav>
      )}
    </div>
  )
}
