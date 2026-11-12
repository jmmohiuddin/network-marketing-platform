// @vitest-environment jsdom
import '../test/dom'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useCursorPages } from '../lib/cursor-pages'
import { Table, type TableColumn } from './table'

interface Batch {
  readonly id: string
  readonly rows: number
}

const columns: readonly TableColumn<Batch>[] = [
  { key: 'id', header: 'Batch', cell: (row) => row.id },
  { key: 'rows', header: 'Rows', cell: (row) => row.rows, align: 'end' },
]
const base = { caption: '2 batches', columns, rowKey: (row: Batch) => row.id, empty: { title: 'No imports yet.' } }

describe('Table', () => {
  it('renders rows with the first cell as the row header', () => {
    render(<Table {...base} rows={[{ id: 'b-1', rows: 10 }, { id: 'b-2', rows: 20 }]} />)
    const table = screen.getByRole('table', { name: '2 batches' })
    expect(within(table).getByRole('rowheader', { name: 'b-1' })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: '20' }).className).toBe('cell-end')
  })

  it('shows loading, empty and error states', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Table {...base} rows={[]} loading />)
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Loading rows')
    rerender(<Table {...base} rows={[]} />)
    expect(screen.getByText('No imports yet.')).toBeTruthy()
    const onRetry = vi.fn()
    rerender(<Table {...base} rows={[]} error={{ message: 'This page could not be loaded.', onRetry }} />)
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('pages with Previous and Next, disabled at the ends', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Table {...base} rows={[{ id: 'b-1', rows: 1 }]} pagination={{ hasPrevious: false, hasNext: true, onPrevious: vi.fn(), onNext }} />)
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
