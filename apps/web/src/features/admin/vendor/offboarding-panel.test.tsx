// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf, renderAs, vendorMe } from '../test-support'
import type { TenantDetail, VendorOffboarding } from '../types'
import { TenantDetailPage } from './tenant-detail'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/vendor/tenants/t1', useSearchParams: () => new URLSearchParams() }))

const EXPORT_ID = '00000000-0000-4000-8000-0000000000e1'

function offboarding(overrides: Partial<VendorOffboarding> = {}): VendorOffboarding {
  return {
    id: 'o1', state: 'confirmed', requested_at: '2026-11-20T09:00:00.000Z', confirmed_at: '2026-11-21T09:00:00.000Z', archived_at: null,
    retain_until: null, purge_requested_by: null, blockers: [{ kind: 'case_open', blocking: true, count: 0 }, { kind: 'credits_outstanding', blocking: false, count: 4 }],
    ...overrides,
  }
}

function tenant(overrides: Partial<TenantDetail> = {}): TenantDetail {
  return {
    id: 't1', slug: 'offboard', legal_name: 'Offboard Demo', region: 'eu', isolation_tier: 'pooled', state: 'live', dpa_document_id: null,
    created_at: '2026-11-01T10:00:00.000Z', job_health: { queued: 0, running: 0, failed: 0 }, markets: [], offboarding: null, ...overrides,
  }
}

describe('SC-39 offboarding panel (D-V1A-07)', () => {
  it('requests an offboarding of a live tenant with a reason and an Idempotency-Key', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/tenants/t1': () => ok(tenant()),
      'POST /v1/tenants/t1/offboarding': () => ok(offboarding({ state: 'requested', confirmed_at: null }), 201),
    })
    renderAs(vendorMe(), <TenantDetailPage tenantId="t1" />, fetchMock)
    const panel = await screen.findByTestId('offboarding')
    expect(within(panel).getByText(/No offboarding has been requested/)).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Request offboarding' }))
    const dialog = screen.getByRole('dialog', { name: 'Request offboarding' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Contract ended')
    await user.click(within(dialog).getByRole('button', { name: 'Request offboarding' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/tenants/t1/offboarding')).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/tenants/t1/offboarding')[0]!
    expect(bodyOf(init)).toEqual({ reason: 'Contract ended' })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
  })

  it('shows the timeline and blocker counts only, and archives with the named export', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/tenants/t1': () => ok(tenant({ offboarding: offboarding() })),
      'POST /v1/tenants/t1/offboarding/archive': () => ok(offboarding({ state: 'archived' })),
    })
    renderAs(vendorMe(), <TenantDetailPage tenantId="t1" />, fetchMock)
    const panel = await screen.findByTestId('offboarding')
    expect(within(panel).getByRole('list', { name: 'Offboarding steps' })).toBeTruthy()
    expect(within(panel).getByText('4 members holding unexpired non-cash rewards')).toBeTruthy()
    expect(within(panel).queryByText(/open case/)).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Archive tenant' }))
    const dialog = screen.getByRole('dialog', { name: 'Archive the tenant' })
    await user.type(within(dialog).getByLabelText('Full export id'), 'not-an-id')
    await user.click(within(dialog).getByRole('button', { name: 'Archive tenant' }))
    expect(await within(dialog).findAllByText('Enter the export id the tenant gives you (36 characters).')).toBeTruthy()
    await user.clear(within(dialog).getByLabelText('Full export id'))
    await user.type(within(dialog).getByLabelText('Full export id'), EXPORT_ID)
    await user.click(within(dialog).getByRole('button', { name: 'Archive tenant' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/tenants/t1/offboarding/archive')).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/tenants/t1/offboarding/archive')[0]![1])).toEqual({ export_id: EXPORT_ID })
  })

  it('names retain_until and shows the refusals of purge request and of a non-independent approval', async () => {
    const user = userEvent.setup()
    const archived = offboarding({ state: 'archived', archived_at: '2026-11-22T09:00:00.000Z', retain_until: '2027-11-22' })
    const view = renderAs(vendorMe(), <TenantDetailPage tenantId="t1" />, fetchByRoute({
      'GET /v1/tenants/t1': () => ok(tenant({ state: 'archived', offboarding: archived })),
      'POST /v1/tenants/t1/offboarding/purge-request': () => apiError(409, 'RETENTION_NOT_ELAPSED', 'The retention period has not passed.', { retain_until: '2027-11-22' }),
    }))
    const panel = await screen.findByTestId('offboarding')
    expect(within(panel).getByText(/Archive kept until/)).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Restore tenant' })).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Request purge' }))
    const dialog = screen.getByRole('dialog', { name: 'Request the purge' })
    await user.click(within(dialog).getByRole('button', { name: 'Request purge' }))
    expect(await within(dialog).findByText(/retention period has not passed/)).toBeTruthy()
    view.unmount()

    renderAs(vendorMe(), <TenantDetailPage tenantId="t1" />, fetchByRoute({
      'GET /v1/tenants/t1': () => ok(tenant({ state: 'archived', offboarding: { ...archived, state: 'purge_requested', purge_requested_by: vendorMe().user.id } })),
      'POST /v1/tenants/t1/offboarding/purge-approve': () => apiError(422, 'SOD_SELF_APPROVAL', 'Another vendor user must approve the purge.'),
    }))
    await user.click(await screen.findByRole('button', { name: 'Approve purge' }))
    const approve = screen.getByRole('dialog', { name: 'Approve the purge' })
    await user.click(within(approve).getByRole('button', { name: 'Approve purge' }))
    expect(await within(approve).findByText(/Another vendor user must approve the purge/)).toBeTruthy()
  })
})
