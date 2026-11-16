// @vitest-environment jsdom
import '../test/dom'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useCursorPages } from '../lib/cursor-pages'
import { DataTable, type DataTableColumn } from './data-table'

interface Batch {
  readonly id: string
  readonly rows: number
}

const columns: readonly DataTableColumn<Batch>[] = [
  { key: 'id', header: 'Batch', cell: (row) => row.id },
  { key: 'rows', header: 'Rows', cell: (row) => row.rows, align: 'end' },
]
const base = { caption: '2 batches', columns, rowKey: (row: Batch) => row.id, empty: { title: 'No imports yet.' } }

describe('Table', () => {
  it('renders rows with the first cell as the row header', () => {
    render(<DataTable {...base} rows={[{ id: 'b-1', rows: 10 }, { id: 'b-2', rows: 20 }]} />)
    const table = screen.getByRole('table', { name: '2 batches' })
    expect(within(table).getByRole('rowheader', { name: 'b-1' })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: '20' }).className).toContain('text-right tabular-nums')
    // The caption names the table for screen readers only; the section heading says it on screen (BUG-042).
    expect(table.querySelector('caption')?.className).toBe('sr-only')
  })

  it('labels each cell with its column header and keeps explicit roles when rows stack on phones (BUG-022)', () => {
    render(<DataTable {...base} rows={[{ id: 'b-1', rows: 10 }]} stackOnPhone />)
    const table = screen.getByRole('table', { name: '2 batches' })
    expect(table.className).toContain('max-sm:block')
    expect(table.getAttribute('role')).toBe('table')
    expect(within(table).getByRole('rowheader', { name: 'b-1' }).getAttribute('data-label')).toBe('Batch')
    expect(within(table).getByRole('cell', { name: '10' }).getAttribute('data-label')).toBe('Rows')
  })

  it('contains its sr-only content in the scroll area, so a wide table never widens the page (BUG-051)', () => {
    render(<DataTable {...base} rows={[{ id: 'b-1', rows: 10 }]} />)
    const scroller = screen.getByRole('table').parentElement!
    expect(scroller.className).toContain('overflow-x-auto')
    expect(scroller.className).toContain('relative')
  })

  it('draws its own card unless it sits bare inside one', () => {
    const { rerender, container } = render(<DataTable {...base} rows={[]} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('shadow-sm')
    rerender(<DataTable {...base} rows={[]} bare />)
    expect((container.firstElementChild as HTMLElement).className).toBe('overflow-hidden')
  })

  it('shows loading, empty and error states', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DataTable {...base} rows={[]} loading />)
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Loading rows')
    rerender(<DataTable {...base} rows={[]} />)
    expect(screen.getByText('No imports yet.')).toBeTruthy()
    const onRetry = vi.fn()
    rerender(<DataTable {...base} rows={[]} error={{ message: 'This page could not be loaded.', onRetry }} />)
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('pages with Previous and Next, disabled at the ends', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<DataTable {...base} rows={[{ id: 'b-1', rows: 1 }]} pagination={{ hasPrevious: false, hasNext: true, onPrevious: vi.fn(), onNext }} />)
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onNext).toHaveBeenCalled()
  })
})

describe('useCursorPages', () => {
  it('keeps the trail of cursors so Previous works', () => {
    const { result } = renderHook(() => useCursorPages())
    expect(result.current.cursor).toBeUndefined()
    act(() => result.current.next('c2'))
    act(() => result.current.next('c3'))
    expect(result.current).toMatchObject({ cursor: 'c3', hasPrevious: true })
    act(() => result.current.previous())
    expect(result.current.cursor).toBe('c2')
    act(() => result.current.reset())
    expect(result.current).toMatchObject({ cursor: undefined, hasPrevious: false })
  })
})

describe('DataTable selection and sticky column', () => {
  it('marks the selected row as current and keeps the first column sticky', () => {
    render(<DataTable {...base} rows={[{ id: 'b-1', rows: 1 }, { id: 'b-2', rows: 2 }]} selectedKey="b-2" stickyFirstColumn />)
    const selected = screen.getByRole('rowheader', { name: 'b-2' }).closest('tr')!
    expect(selected.getAttribute('aria-current')).toBe('true')
    expect(selected.className).toContain('bg-primary-fixed/20')
    expect(screen.getByRole('rowheader', { name: 'b-1' }).closest('tr')!.hasAttribute('aria-current')).toBe(false)
    expect(screen.getByRole('columnheader', { name: 'Batch' }).className).toContain('md:sticky')
  })
})
