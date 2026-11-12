'use client'

import type { ReactNode } from 'react'
import { Button } from './button'
import { Icon } from './icon'
import { EmptyState } from './states'

export interface DataTableColumn<T> {
  readonly key: string
  /** Units or currency go here, once per table ("Amount (EUR)"). */
  readonly header: string
  readonly cell: (row: T) => ReactNode
  /** end: numbers, right-aligned and tabular. */
  readonly align?: 'start' | 'end'
}

export interface Pagination {
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  readonly onPrevious: () => void
  readonly onNext: () => void
  /** "Showing 50 rows" style text on the left of the footer, from the response meta. */
  readonly rangeText?: string
}

export interface DataTableProps<T> {
  /** The table's name ("1,284 payees · 412,300.00 total"), visually hidden: the section heading names it on screen. */
  readonly caption: string
  readonly columns: readonly DataTableColumn<T>[]
  readonly rows: readonly T[]
  readonly rowKey: (row: T) => string
  readonly loading?: boolean
  /** A failed load: the message and a retry that keeps the current filters. */
  readonly error?: { readonly message: string; readonly onRetry: () => void } | null
  /** First use: what will appear and the first action. No results: say so and offer to clear filters. */
  readonly empty: { readonly title: string; readonly action?: ReactNode }
  /** Cursor pagination (useCursorPages): Previous and Next only, no page numbers. */
  readonly pagination?: Pagination
  /** comfortable 44 px rows, compact 32 px. */
  readonly density?: 'comfortable' | 'compact'
  /**
   * Below 640 px each row becomes a card of "header: value" lines instead of scrolling sideways (approvals usable
   * on phones). Explicit roles keep the table semantics that display: block would drop.
   */
  readonly stackOnPhone?: boolean
  /** The first column stays visible while the table scrolls sideways (md and up). */
  readonly stickyFirstColumn?: boolean
  /** The row shown as selected (sc_01 `bg-primary-fixed/20`). */
  readonly selectedKey?: string
  /** Inside a card that already draws the surface (TableSection, a panel, a dialog): no own card background, radius or shadow. */
  readonly bare?: boolean
}

const SKELETON_ROWS = 5
const PAD: Readonly<Record<'comfortable' | 'compact', string>> = { comfortable: 'py-2.5 px-3', compact: 'py-1.5 px-3' }
const STACK_CELL = 'max-sm:flex max-sm:justify-between max-sm:gap-space-sm max-sm:px-0 max-sm:py-1 max-sm:text-right max-sm:before:content-[attr(data-label)] max-sm:before:font-caption max-sm:before:text-caption max-sm:before:text-secondary max-sm:before:text-left'
const STICKY = 'md:sticky md:left-0 md:z-10 md:bg-inherit'

function FullRow({ span, children }: { readonly span: number; readonly children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="p-0">{children}</td>
    </tr>
  )
}

/** sc_01 l.417 footer: range text, then Previous / Next icon buttons. */
export function PaginationBar({ label, pagination, busy = false }: { readonly label: string; readonly pagination: Pagination; readonly busy?: boolean }) {
  const pageButton = 'p-1 rounded text-secondary hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'
  return (
    <nav className="px-space-md py-2 bg-surface-container-low flex items-center justify-between gap-space-sm font-caption text-caption text-secondary" aria-label={label}>
      <span>{pagination.rangeText}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={pageButton} aria-label="Previous page" title="Previous page" onClick={pagination.onPrevious} disabled={!pagination.hasPrevious || busy}>
          <Icon name="chevron_left" size={16} />
        </button>
        <button type="button" className={pageButton} aria-label="Next page" title="Next page" onClick={pagination.onNext} disabled={!pagination.hasNext || busy}>
          <Icon name="chevron_right" size={16} />
        </button>
      </div>
    </nav>
  )
}

/**
 * Data table (sc_01 l.248): cursor pages, loading skeleton, empty and error states. The first column names the
 * row (a th) and should hold its link.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, loading = false, error = null, empty, pagination, density = 'comfortable', stackOnPhone = false, stickyFirstColumn = false, selectedKey, bare = false }: DataTableProps<T>) {
  const span = columns.length
  const role = (name: string) => (stackOnPhone ? name : undefined)
  const cellClass = (column: DataTableColumn<T>, first: boolean) => [
    PAD[density], 'text-on-surface align-middle',
    column.align === 'end' ? 'text-right tabular-nums' : 'text-left',
    first && stickyFirstColumn ? STICKY : '',
    stackOnPhone ? STACK_CELL : '',
  ].filter(Boolean).join(' ')
  function body(): ReactNode {
    if (loading) {
      return Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {columns.map((column) => <td key={column.key} className={PAD[density]}><span className="block h-3 w-3/4 rounded bg-surface-container motion-safe:animate-pulse" /></td>)}
        </tr>
      ))
    }
    if (error !== null) {
      return (
        <FullRow span={span}>
          <div className="p-space-lg flex flex-col items-center gap-space-sm text-center" role="alert">
            <Icon name="error" size={24} className="text-error" />
            <p className="font-body-sm text-body-sm text-on-surface">{error.message}</p>
            <Button onClick={error.onRetry}>Try again</Button>
          </div>
        </FullRow>
      )
    }
    if (rows.length === 0) return <FullRow span={span}><EmptyState title={empty.title} action={empty.action} plain /></FullRow>
    const label = (column: DataTableColumn<T>) => (stackOnPhone ? column.header : undefined)
    return rows.map((row) => {
      const key = rowKey(row)
      const selected = key === selectedKey
      return (
        <tr key={key} role={role('row')} aria-current={selected ? true : undefined}
          className={`${selected ? 'bg-primary-fixed/20 hover:bg-primary-fixed/30' : 'bg-surface-container-lowest hover:bg-surface-container-low'} transition-colors${stackOnPhone ? ' max-sm:block max-sm:p-space-sm' : ''}`}>
          {columns.map((column, index) => index === 0
            ? <th key={column.key} scope="row" role={role('rowheader')} className={`${cellClass(column, true)} font-semibold`} data-label={label(column)}>{column.cell(row)}</th>
            : <td key={column.key} role={role('cell')} className={cellClass(column, false)} data-label={label(column)}>{column.cell(row)}</td>)}
        </tr>
      )
    })
  }
  return (
    <div className={bare ? 'overflow-hidden' : 'bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden'}>
      <div className="w-full overflow-x-auto">
        <table className={`w-full text-left border-collapse${stackOnPhone ? ' max-sm:block' : ''}`} role={role('table')} aria-busy={loading || undefined}>
          {/* Names the table for assistive technology; the section heading above already says it on screen (BUG-042). */}
          <caption className="sr-only">{caption}</caption>
          <thead role={role('rowgroup')} className={stackOnPhone ? 'max-sm:sr-only' : undefined}>
            <tr role={role('row')} className="bg-surface-container-low text-secondary font-caption text-[11px] uppercase tracking-wider">
              {columns.map((column, index) => (
                <th key={column.key} scope="col" role={role('columnheader')}
                  className={`py-2.5 px-3 font-semibold ${column.align === 'end' ? 'text-right' : 'text-left'}${index === 0 && stickyFirstColumn ? ` ${STICKY}` : ''}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role={role('rowgroup')} className={`font-body-sm text-body-sm divide-y divide-surface-container${stackOnPhone ? ' max-sm:block max-sm:divide-y-0 max-sm:space-y-space-sm' : ''}`}>{body()}</tbody>
        </table>
      </div>
      {loading && <p className="sr-only" role="status">Loading rows</p>}
      {pagination !== undefined && <PaginationBar label={`Pages of ${caption}`} pagination={pagination} busy={loading} />}
    </div>
  )
}
