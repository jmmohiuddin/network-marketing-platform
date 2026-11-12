// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { FigureRows } from './figure-rows'
import { callsOf, fetchRoutes, withSession } from './test-support'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => router, usePathname: () => '/compliance/snapshots/s1/rows',
  useSearchParams: () => new URLSearchParams('figure=R1.2025-01.customer_share_pct'),
}))

const ROWS_PATH = /^\/v1\/compliance\/snapshots\/s1\/figures\/R1\.2025-01\.customer_share_pct\/rows\?/
const PAGE = {
  data: [{ order_ref: 'o1', order_month: '2025-01', buyer_ref: 'p1', amount_minor: '10000', is_starter_kit: false }],
  meta: {
    next_cursor: null, set: 'numerator', entity: 'order', row_count: 1, notice: 'Indicator figures computed from loaded historical data.',
    figure: { id: 'R1.2025-01.customer_share_pct', unit: 'percent', value: '62.50', numerator: '10000', denominator: '16000', population: 'Orders in the month', method: 'Net sales share.', method_version: 'cpl-method-1.0.0', note: null },
  },
}

describe('FigureRows', () => {
  beforeEach(() => router.replace.mockReset())

  it('shows the definition and the numerator rows, without export for users who may not export', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchRoutes(['GET', ROWS_PATH, () => json(200, PAGE)])
    renderWithProviders(withSession(<FigureRows snapshotId="s1" />, ['compliance.read']), fetchMock)
    expect(await screen.findByRole('heading', { name: 'R1 Retail-customer share · Customer share of net sales · 2025-01' })).toBeTruthy()
    expect(screen.getByRole('table', { name: '1 orders in the numerator set' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Amount (minor units)' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'No' })).toBeTruthy()
    expect(callsOf(fetchMock)[0]).toContain('set=numerator')
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Denominator rows' }))
    expect(router.replace).toHaveBeenCalledWith('/compliance/snapshots/s1/rows?figure=R1.2025-01.customer_share_pct&set=denominator')
  })

  it('exports both row sets after confirmation and explains a refusal above the row cap', async () => {
    const user = userEvent.setup()
    let exports = 0
    const fetchMock = fetchRoutes(
      ['GET', /rows\?export=true$/, () => (++exports === 1
        ? apiError(422, 'EXPORT_ROW_CAP_EXCEEDED', 'The export is larger than the row limit. Request a scheduled export instead.')
        : new Response('set,order_ref\nnumerator,o1\n', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="compliance-rows-e1.csv"' } }))],
      ['GET', ROWS_PATH, () => json(200, PAGE)],
    )
    // jsdom has no object URLs.
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = () => 'blob:csv'
      static override revokeObjectURL = () => undefined
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('compliance-rows-e1.csv')
    })
    renderWithProviders(withSession(<FigureRows snapshotId="s1" />, ['compliance.read', 'export']), fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Export rows (logged)' }))
    const dialog = screen.getByRole('dialog', { name: 'Export rows' })
    expect(dialog.textContent).toContain('recorded in the audit log')
    await user.click(within(dialog).getByRole('button', { name: 'Export rows' }))
    expect(await within(dialog).findByText(/Request a scheduled export instead/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Export rows' }))
    expect(await screen.findByText('Rows exported. The export is recorded in the audit log.')).toBeTruthy()
    expect(click).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('explains why an omitted figure has no rows', async () => {
    renderWithProviders(withSession(<FigureRows snapshotId="s1" />, ['compliance.read']), fetchRoutes(['GET', ROWS_PATH, () => apiError(422, 'FIGURE_OMITTED', 'This indicator was not computed, so it has no rows.')]))
    expect(await screen.findByText('This indicator was not computed, so it has no rows.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the snapshot' }).getAttribute('href')).toBe('/compliance/snapshots/s1?report=R1')
  })
})
