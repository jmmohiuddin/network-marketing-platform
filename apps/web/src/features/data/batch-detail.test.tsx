// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json, ok, requestBody } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { BatchDetail } from './batch-detail'
import { callsOf, fetchRoutes, withSession } from './test-support'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/imports/b1', useSearchParams: () => new URLSearchParams('') }))

const BATCH = {
  id: 'b1', market: 'DE', period_from: '2025-01', period_to: '2025-03', state: 'validated', mapping_id: null, mapping_version: null,
  superseded_by: null, created_at: '2026-11-01T10:00:00Z',
  row_counts: { participants: 3, orders: 3, payout_lines: 4 },
  control_totals: { order_amount_minor: '16000', order_volume_minor: '15000', order_refunded_minor: '0', payout_amount_minor: '3100' },
  report: { error_count: 0, errors_stored: 0, warnings: [{ code: 'TYPES', file: 'participants', count: 2, detail: 'participant types found: customer, distributor' }] },
  data_quality: null,
}
const VERSIONS = [
  { id: 'm2', version: 2, state: 'approved', notes: null, created_by: 'x', created_at: '2026-11-01T10:00:00Z', approved_by: 'y' },
  { id: 'm3', version: 3, state: 'draft', notes: null, created_by: 'x', created_at: '2026-11-02T10:00:00Z', approved_by: null },
]
const PERMISSIONS = ['import.manage', 'compliance.read']

describe('BatchDetail', () => {
  it('attaches an approved mapping version and names the codes it does not cover', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const fetchMock = fetchRoutes(
      ['GET', /^\/v1\/imports\/b1$/, () => ok(BATCH)],
      ['GET', /^\/v1\/import-mappings\?/, () => json(200, { data: VERSIONS, meta: { next_cursor: null } })],
      ['POST', /^\/v1\/imports\/b1\/mapping$/, () => (++attempts === 1
        ? apiError(422, 'MAPPING_INCOMPLETE', 'The mapping does not cover every participant type.', { participant_types: ['partner'] })
        : ok({ ...BATCH, state: 'mapped', mapping_id: 'm2', mapping_version: 2 }))],
    )
    renderWithProviders(withSession(<BatchDetail batchId="b1" />, PERMISSIONS), fetchMock)
    expect(await screen.findByRole('heading', { name: 'Import DE · 2025-01 to 2025-03' })).toBeTruthy()
    expect(screen.getByText(/participant types found/).textContent).toContain('(2)')
    const select = await screen.findByLabelText('Approved mapping version')
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Version 2'])
    await user.click(screen.getByRole('button', { name: 'Attach mapping version' }))
    expect((await screen.findByText(/Map these codes in a new version/)).textContent).toContain('partner')
    await user.click(screen.getByRole('button', { name: 'Attach mapping version' }))
    const post = callsOf(fetchMock).lastIndexOf('POST /v1/imports/b1/mapping')
    expect(requestBody(fetchMock, post)).toEqual({ mapping_id: 'm2' })
    expect(await screen.findByText('Mapping version 2 attached.')).toBeTruthy()
  })

  it('loads a mapped batch after confirmation and reports superseded batches', async () => {
    const user = userEvent.setup()
    let loaded = false
    const fetchMock = fetchRoutes(
      ['GET', /^\/v1\/imports\/b1$/, () => ok(loaded ? { ...BATCH, state: 'loaded', mapping_version: 2, data_quality: {
        orders: 3, orders_unknown_purpose: 1, refunded_orders: 0, refunds_without_month: 0, payout_lines: 4,
        payout_lines_without_source_order: 0, payout_lines_unknown_source_kind: 0, unmapped: { purposes: ['R'], source_kinds: [] },
      } } : { ...BATCH, state: 'mapped', mapping_id: 'm2', mapping_version: 2 })],
      ['GET', /^\/v1\/import-mappings\?/, () => json(200, { data: VERSIONS, meta: { next_cursor: null } })],
      ['POST', /^\/v1\/imports\/b1\/load$/, () => {
        loaded = true
        return json(200, { data: { ...BATCH, state: 'loaded' }, meta: { superseded: ['b0'] } })
      }],
    )
    renderWithProviders(withSession(<BatchDetail batchId="b1" />, PERMISSIONS), fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Load batch' }))
    const dialog = screen.getByRole('dialog', { name: 'Load batch' })
    expect(dialog.textContent).toContain('mapping version 2')
    await user.click(within(dialog).getByRole('button', { name: 'Load batch' }))
    expect(await screen.findByText('Batch loaded. 1 earlier batch(es) of this period are now superseded.')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Data-quality report' })).toBeTruthy()
    expect(screen.getByText('1 of 3')).toBeTruthy()
    expect(screen.getByText('R')).toBeTruthy()
  })

  it('keeps the dialog open with the reason when loading is refused', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchRoutes(
      ['GET', /^\/v1\/imports\/b1$/, () => ok({ ...BATCH, state: 'mapped', mapping_id: 'm2', mapping_version: 2 })],
      ['GET', /^\/v1\/import-mappings\?/, () => json(200, { data: VERSIONS, meta: { next_cursor: null } })],
      ['POST', /^\/v1\/imports\/b1\/load$/, () => apiError(422, 'BREACH_CONTACT_REQUIRED', 'Record at least one breach-notification contact before the first data load.')],
    )
    renderWithProviders(withSession(<BatchDetail batchId="b1" />, PERMISSIONS), fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Load batch' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Load batch' }))
    expect(await within(screen.getByRole('dialog')).findByText(/breach-notification contact/)).toBeTruthy()
  })

  it('shows a rejected batch with its paged validation errors', async () => {
    const user = userEvent.setup()
    const rejected = { ...BATCH, state: 'rejected', row_counts: null, control_totals: null, report: { error_count: 2, errors_stored: 2, warnings: [] } }
    const fetchMock = fetchRoutes(
      ['GET', /^\/v1\/imports\/b1$/, () => ok(rejected)],
      ['GET', /^\/v1\/imports\/b1\/errors\?limit=50$/, () => json(200, { data: [{ seq: '1', file: 'participants.csv', row_no: 1, column_name: 'email', code: 'FORBIDDEN_COLUMN', detail: 'the column looks like personal or bank data' }], meta: { next_cursor: 'c1' } })],
      ['GET', /^\/v1\/imports\/b1\/errors\?cursor=c1/, () => json(200, { data: [{ seq: '2', file: 'orders.csv', row_no: 7, column_name: 'day', code: 'OUT_OF_RANGE', detail: 'day must be 1 to 31' }], meta: { next_cursor: null } })],
    )
    renderWithProviders(withSession(<BatchDetail batchId="b1" />, PERMISSIONS), fetchMock)
    expect(await screen.findByText('Rejected: nothing was stored')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upload corrected files' })).toBeTruthy()
    expect(await screen.findByText('FORBIDDEN_COLUMN')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('OUT_OF_RANGE')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load batch' })).toBeNull()
  })

  it('says not found for a batch outside the user\'s reach', async () => {
    renderWithProviders(withSession(<BatchDetail batchId="b1" />, PERMISSIONS), fetchRoutes(['GET', /^\/v1\/imports\/b1$/, () => apiError(404, 'NOT_FOUND')]))
    expect(await screen.findByRole('heading', { name: 'Not found or not available to you' })).toBeTruthy()
  })
})
