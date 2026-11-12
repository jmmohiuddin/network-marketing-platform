// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { json } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { ImportsList } from './imports-list'
import { callsOf, fetchRoutes, withSession } from './test-support'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const search = vi.hoisted(() => ({ value: '' }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/imports', useSearchParams: () => new URLSearchParams(search.value) }))

const BATCH = {
  id: 'b1', market: 'DE', period_from: '2025-01', period_to: '2025-03', state: 'superseded', mapping_id: 'm2', mapping_version: 2, superseded_by: 'b2',
  created_at: '2026-11-01T10:00:00Z', row_counts: { participants: 3, orders: 3, payout_lines: 4 },
  control_totals: { order_amount_minor: '16000', order_volume_minor: '0', order_refunded_minor: '0', payout_amount_minor: '0' },
  report: { error_count: 0, errors_stored: 0, warnings: [] }, data_quality: null,
}

describe('ImportsList', () => {
  it('lists batches with state, counts and control total, and filters by state through the URL', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchRoutes(['GET', /^\/v1\/imports\?/, () => json(200, { data: [BATCH], meta: { next_cursor: null } })])
    renderWithProviders(withSession(<ImportsList />, ['import.manage']), fetchMock)
    expect((await screen.findByRole('link', { name: 'DE · 2025-01 to 2025-03' })).getAttribute('href')).toBe('/imports/b1')
    expect(within(screen.getByRole('table')).getByText('Superseded')).toBeTruthy()
    expect(screen.getByText('3 / 3 / 4')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View details: DE · 2025-01 to 2025-03' }).getAttribute('href')).toBe('/imports/b1')
    expect(screen.queryByRole('link', { name: 'Open mapping' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Upload export' }).getAttribute('href')).toBe('/imports/new')
    await user.selectOptions(screen.getByLabelText('State'), 'loaded')
    expect(router.replace).toHaveBeenCalledWith('/imports?state=loaded')
    expect(callsOf(fetchMock)[0]).toBe('GET /v1/imports?limit=50')
  })

  it('sends the state filter from the URL and offers to clear it when nothing matches', async () => {
    search.value = 'state=rejected'
    const fetchMock = fetchRoutes(['GET', /^\/v1\/imports\?/, () => json(200, { data: [], meta: { next_cursor: null } })])
    renderWithProviders(withSession(<ImportsList />, ['import.manage']), fetchMock)
    expect(await screen.findByText('No batches are in this state.')).toBeTruthy()
    expect(callsOf(fetchMock)[0]).toBe('GET /v1/imports?state=rejected&limit=50')
    expect(screen.getByRole('button', { name: 'Show all states' })).toBeTruthy()
  })
})
