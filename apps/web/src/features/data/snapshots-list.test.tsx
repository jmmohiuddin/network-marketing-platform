// @vitest-environment jsdom
import '../../test/dom'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok, requestBody, requestHeaders } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { SnapshotsList } from './snapshots-list'
import { callsOf, fetchRoutes, withSession } from './test-support'
import { POLL_INTERVAL_MS } from '../../lib/use-resource'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/compliance', useSearchParams: () => new URLSearchParams('') }))

const snapshot = (state: string) => ({
  id: 's1', state, market_id: 'mk', period_from: '2025-01', period_to: '2025-12', method_version: 'cpl-method-1.0.0', failure_reason: null,
  created_at: '2026-11-01T10:00:00Z', reports: ['R1', 'R5'], input_batch_ids: ['b1'], input_mapping_versions: [3],
})
const page = (state: string) => json(200, { data: [snapshot(state)], meta: { next_cursor: null } })

describe('SnapshotsList', () => {
  afterEach(() => vi.useRealTimers())

  it('lists snapshots with their state and refreshes while one is computing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    const fetchMock = fetchRoutes(['GET', /^\/v1\/compliance\/snapshots\?/, () => page(++calls === 1 ? 'computing' : 'ready')])
    renderWithProviders(withSession(<SnapshotsList />, ['compliance.read']), fetchMock)
    expect(await screen.findByText('Computing')).toBeTruthy()
    expect(screen.getByRole('link', { name: '2025-01 to 2025-12' }).getAttribute('href')).toBe('/compliance/snapshots/s1')
    expect(screen.queryByRole('button', { name: 'Create snapshot' })).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(await screen.findByText('Ready')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2))
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it('creates a snapshot with an Idempotency-Key and names the months no loaded import covers', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const fetchMock = fetchRoutes(
      ['GET', /^\/v1\/compliance\/snapshots\?/, () => page('ready')],
      ['POST', /^\/v1\/compliance\/snapshots$/, () => (++attempts === 1
        ? apiError(422, 'NO_DATA_FOR_RANGE', 'Loaded imports of this market do not cover every month of the period range.', { uncovered_months: ['2025-12'] })
        : ok({ ...snapshot('computing'), id: 's2' }, 202))],
    )
    renderWithProviders(withSession(<SnapshotsList />, ['compliance.read', 'snapshot.create', 'mapping.approve']), fetchMock)
    expect(await screen.findByRole('link', { name: 'Import mappings' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }))
    const dialog = screen.getByRole('dialog', { name: 'Create snapshot' })
    await user.type(within(dialog).getByLabelText('Market'), 'DE')
    fireEvent.change(within(dialog).getByLabelText('First month'), { target: { value: '2025-01' } })
    fireEvent.change(within(dialog).getByLabelText('Last month'), { target: { value: '2025-12' } })
    await user.click(within(dialog).getByLabelText('R2 Personal-use share'))
    await user.click(within(dialog).getByRole('button', { name: 'Create snapshot' }))
    expect((await within(dialog).findAllByText(/Months without loaded data: 2025-12/)).length).toBeGreaterThan(0)
    await user.click(within(dialog).getByRole('button', { name: 'Create snapshot' }))
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/compliance/snapshots/s2'))
    const posts = callsOf(fetchMock).flatMap((call, index) => (call.startsWith('POST') ? [index] : []))
    expect(requestBody(fetchMock, posts[0])).toEqual({ market: 'DE', period_from: '2025-01', period_to: '2025-12', reports: ['R1', 'R3', 'R4', 'R5'] })
    expect(requestHeaders(fetchMock, posts[1]).get('Idempotency-Key')).toBe(requestHeaders(fetchMock, posts[0]).get('Idempotency-Key'))
  })
})
