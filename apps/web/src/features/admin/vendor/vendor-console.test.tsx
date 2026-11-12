// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf, renderAs, vendorMe } from '../test-support'
import type { SupportSession, TenantDetail, VendorUser } from '../types'
import { checkProvisioning, ProvisionTenantPage } from './provision-form'
import { sessionMinutesError } from './request-session-dialog'
import { storedSupportSession } from '../../../lib/support-session'
import { canEnd, canOpen, VendorSessionsPage } from './sessions-page'
import { TenantDetailPage } from './tenant-detail'
import { TenantsPage } from './tenants-page'
import { VendorUsersPage } from './vendor-users-page'

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/vendor', useSearchParams: () => new URLSearchParams() }))
const leavePage = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/leave-page', () => ({ leavePage }))

const ME = vendorMe()
const DPA = '0b9e6c1a-1f2d-4c3b-9a8e-7d6c5b4a3f21'

function tenant(overrides: Partial<TenantDetail> = {}): TenantDetail {
  return {
    id: 't1', slug: 'acme', legal_name: 'Acme Ltd', region: 'eu', isolation_tier: 'pooled', state: 'provisioning', dpa_document_id: DPA,
    created_at: '2026-11-01T10:00:00.000Z', job_health: { queued: 2, running: 0, failed: 1 },
    markets: [{ id: 'm1', code: 'DE', currency: 'EUR', minor_unit: 2, time_zone: 'Europe/Berlin', languages: ['de'], market_pack: 'de-2026', state: 'live' }],
    ...overrides,
  }
}

function session(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 's1', tenant_id: 't1', tenant_slug: 'acme', requester_id: ME.user.id, reason: 'Ticket 42', scope: { permissions: ['audit.read'], requester_region: 'eu' },
    requested_minutes: 60, state: 'active', decided_by: 'a1', starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z',
    created_at: '2026-11-12T08:00:00.000Z', ...overrides,
  }
}

describe('vendor console', () => {
  it('lists tenants with operational metadata and job health only', async () => {
    renderAs(ME, <TenantsPage />, fetchByRoute({ 'GET /v1/tenants': () => ok([tenant()]) }))
    const row = (await screen.findByRole('link', { name: 'Acme Ltd (acme)' })).closest('tr')!
    expect(within(row).getByText('2 queued · 0 running · 1 failed')).toBeTruthy()
    expect(screen.getByText(/operational metadata only/)).toBeTruthy()
  })

  it('shows the second-person rule when the creator tries to approve provisioning', async () => {
    const user = userEvent.setup()
    const refusal = 'A second vendor user must approve the tenant you created.'
    const fetchMock = fetchByRoute({
      'GET /v1/tenants/t1': () => ok(tenant()),
      'POST /v1/tenants/t1/approve': () => apiError(422, 'SOD_SELF_APPROVAL', refusal),
    })
    renderAs(ME, <TenantDetailPage tenantId="t1" />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Approve provisioning' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve provisioning' }))
    expect(await screen.findByText(refusal)).toBeTruthy()
    expect(headerOf(callsTo(fetchMock, 'POST', '/v1/tenants/t1/approve')[0]![1], 'Idempotency-Key')).not.toBeNull()
  })

  it('makes a tenant in implementation live', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/tenants/t1': () => ok(tenant({ state: 'implementation' })),
      'POST /v1/tenants/t1/go-live': () => ok(tenant({ state: 'live' })),
    })
    renderAs(ME, <TenantDetailPage tenantId="t1" />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Go live' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Go live' }))
    expect(await screen.findByText('Acme Ltd is live.')).toBeTruthy()
  })

  it('provisions a tenant after checking every field', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({ 'POST /v1/tenants': () => ok(tenant(), 201) })
    renderAs(ME, <ProvisionTenantPage />, fetchMock)
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter the legal name.')
    await user.type(screen.getByLabelText('Legal name'), 'Acme Ltd')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.type(screen.getByLabelText('Data region'), 'eu')
    await user.selectOptions(screen.getByLabelText('Isolation tier'), 'pooled')
    await user.type(screen.getByLabelText('Signed data processing agreement ID'), DPA)
    await user.type(screen.getByLabelText('Country code'), 'DE')
    await user.type(screen.getByLabelText('Currency'), 'EUR')
    await user.type(screen.getByLabelText('Currency decimals'), '2')
    await user.type(screen.getByLabelText('Time zone'), 'Europe/Berlin')
    await user.type(screen.getByLabelText('Languages'), 'de, en')
    await user.type(screen.getByLabelText('Market pack'), 'de-2026')
    const firstAdmin = within(screen.getByRole('group', { name: 'First admin' }))
    const secondAdmin = within(screen.getByRole('group', { name: 'Second admin' }))
    await user.type(firstAdmin.getByLabelText('Email address'), 'first@acme.example')
    await user.type(secondAdmin.getByLabelText('Email address'), 'FIRST@acme.example')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter a different person from the first admin.')
    await user.clear(secondAdmin.getByLabelText('Email address'))
    await user.type(secondAdmin.getByLabelText('Email address'), 'second@acme.example')
    await user.type(secondAdmin.getByLabelText('Name (optional)'), 'Sam Second')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    expect(await screen.findByText(/Another vendor user must approve it/)).toBeTruthy()
    expect(router.push).toHaveBeenCalledWith('/vendor/tenants/t1')
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/tenants')[0]![1])).toEqual({
      legal_name: 'Acme Ltd', slug: 'acme', region: 'eu', isolation_tier: 'pooled', dpa_document_id: DPA,
      markets: [{ code: 'DE', currency: 'EUR', minor_unit: 2, time_zone: 'Europe/Berlin', languages: ['de', 'en'], market_pack: 'de-2026' }],
      first_admin: { email: 'first@acme.example', display_name: null },
      second_admin: { email: 'second@acme.example', display_name: 'Sam Second' },
    })
  })

  it('retries provisioning with the same Idempotency-Key, and a corrected body with a new one', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const fetchMock = fetchByRoute({
      'POST /v1/tenants': () => (++attempts < 3 ? apiError(503, 'SERVICE_UNAVAILABLE') : ok(tenant(), 201)),
    })
    renderAs(ME, <ProvisionTenantPage />, fetchMock)
    const fill: [string, string][] = [
      ['Legal name', 'Acme Ltd'], ['Slug', 'acme'], ['Data region', 'eu'], ['Signed data processing agreement ID', DPA], ['Country code', 'DE'],
      ['Currency', 'EUR'], ['Currency decimals', '2'], ['Time zone', 'Europe/Berlin'], ['Languages', 'de'], ['Market pack', 'de-2026'],
    ]
    for (const [label, value] of fill) await user.type(screen.getByLabelText(label), value)
    await user.type(within(screen.getByRole('group', { name: 'First admin' })).getByLabelText('Email address'), 'first@acme.example')
    await user.type(within(screen.getByRole('group', { name: 'Second admin' })).getByLabelText('Email address'), 'second@acme.example')
    await user.selectOptions(screen.getByLabelText('Isolation tier'), 'pooled')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/tenants')).toHaveLength(2))
    await user.type(screen.getByLabelText('Legal name'), ' GmbH')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/vendor/tenants/t1'))
    const keys = callsTo(fetchMock, 'POST', '/v1/tenants').map(([, init]) => headerOf(init, 'Idempotency-Key'))
    expect(keys[0]).not.toBeNull()
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('requests a support session for a tenant that can decide', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': () => ok([]),
      'GET /v1/tenants': () => ok([tenant({ state: 'live' }), tenant({ id: 't2', slug: 'new', legal_name: 'New Co', state: 'provisioning' })]),
      'GET /v1/support-sessions/limits': () => ok({ max_minutes: 120, scopes: ['compliance.read', 'audit.read'] }),
      'POST /v1/support-sessions': () => ok(session({ state: 'requested' }), 201),
    })
    renderAs(ME, <VendorSessionsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Request support session' }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('option', { name: 'Acme Ltd (acme)' })
    expect(within(dialog).queryByRole('option', { name: 'New Co (new)' })).toBeNull()
    await user.selectOptions(within(dialog).getByLabelText('Tenant'), 't1')
    await user.type(within(dialog).getByLabelText('Reason'), 'Ticket 42')
    // The areas and the longest duration come from the API (GET /v1/support-sessions/limits).
    // Sessions are view-only: the scope names areas to see, never actions (BUG-023).
    expect(within(dialog).getByRole('group', { name: 'Areas you need to see' })).toBeTruthy()
    await user.click(await within(dialog).findByLabelText('Audit log'))
    expect(within(dialog).getByLabelText('Compliance reports')).toBeTruthy()
    expect(within(dialog).queryByLabelText('Settings')).toBeNull()
    expect(within(dialog).getByText(/Up to 120 minutes/)).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Duration in minutes'), '121')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    expect(within(dialog).getAllByText(/Ask for 1 to 120 minutes/).length).toBeGreaterThan(0)
    await user.clear(within(dialog).getByLabelText('Duration in minutes'))
    await user.type(within(dialog).getByLabelText('Duration in minutes'), '90')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText(/Nothing can be accessed until the tenant approves it/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/support-sessions')[0]!
    expect(bodyOf(init)).toEqual({ tenant: 't1', reason: 'Ticket 42', scope: { permissions: ['audit.read'] }, minutes: 90 })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('ends only the vendor user’s own active session', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': () => ok([session(), session({ id: 's2', tenant_slug: 'other', requester_id: 'someone-else' })]),
      'POST /v1/support-sessions/s1/end': () => ok(session({ state: 'ended' })),
    })
    renderAs(ME, <VendorSessionsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'End session for acme' }))
    expect(screen.queryByRole('button', { name: 'End session for other' })).toBeNull()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End session' }))
    expect(await screen.findByText('Your support session has ended.')).toBeTruthy()
  })
})

function vendorUser(overrides: Partial<VendorUser> = {}): VendorUser {
  return {
    id: 'v2', email: 'ola@vendor.example', display_name: 'Ola Operator', state: 'active', mfa_enrolled: true, last_sign_in_at: null,
    created_at: '2026-11-12T08:00:00.000Z', created_by: ME.user.id, ...overrides,
  }
}

describe('vendor console: vendor users (BUG-011)', () => {
  it('invites a second vendor user with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/vendor-users': () => ok([vendorUser({ id: ME.user.id, email: ME.user.email, display_name: 'Vera Vendor' })]),
      'POST /v1/vendor-users': () => ok({ user: vendorUser({ state: 'invited' }) }, 201),
    })
    renderAs(ME, <VendorUsersPage />, fetchMock)
    expect(await screen.findByText('Vera Vendor (vera@vendor.example) · you')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Vendor users' }).getAttribute('href')).toBe('/vendor/users')
    await user.click(screen.getByRole('button', { name: 'Invite vendor user' }))
    const dialog = screen.getByRole('dialog', { name: 'Invite vendor user' })
    await user.type(within(dialog).getByLabelText('Email address'), 'ola@vendor.example')
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText(/Invitation sent to ola@vendor.example/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/vendor-users')[0]!
    expect(bodyOf(init)).toEqual({ email: 'ola@vendor.example' })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('resends an open invitation and shows why the last vendor user stays', async () => {
    const user = userEvent.setup()
    const refusal = 'This would leave no vendor user who can sign in.'
    const fetchMock = fetchByRoute({
      'GET /v1/vendor-users': () => ok([vendorUser({ state: 'invited' }), vendorUser({ id: 'v3', email: 'max@vendor.example', display_name: null })]),
      'POST /v1/vendor-users/v2/invitation': () => ok({ user: vendorUser({ state: 'invited' }) }, 202),
      'POST /v1/vendor-users/v3/deactivate': () => apiError(422, 'LAST_VENDOR_USER', refusal),
    })
    renderAs(ME, <VendorUsersPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Resend invitation to ola@vendor.example' }))
    expect(screen.queryByRole('button', { name: 'Resend invitation to max@vendor.example' })).toBeNull()
    await user.click(within(screen.getByRole('dialog', { name: 'Resend invitation' })).getByRole('button', { name: 'Resend invitation' }))
    expect(await screen.findByText('A new invitation was sent to ola@vendor.example.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Deactivate max@vendor.example' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Deactivate vendor user' })).getByRole('button', { name: 'Deactivate vendor user' }))
    expect(await screen.findByText(refusal)).toBeTruthy()
  })
})

describe('vendor console: working in a support session', () => {
  it('opens the tenant app for the vendor user’s own approved session, read-only', async () => {
    const user = userEvent.setup()
    window.sessionStorage.clear()
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': () => ok([
        session({ state: 'approved', starts_at: '2020-01-01T00:00:00.000Z' }),
        session({ id: 's2', tenant_slug: 'other', state: 'approved', starts_at: '2020-01-01T00:00:00.000Z', requester_id: 'someone-else' }),
      ]),
    })
    renderAs(ME, <VendorSessionsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Open the tenant app of acme (read-only)' }))
    expect(screen.queryByRole('button', { name: 'Open the tenant app of other (read-only)' })).toBeNull()
    expect(storedSupportSession()).toBe('s1')
    expect(leavePage).toHaveBeenCalledWith('/')
    window.sessionStorage.clear()
  })

  it('may open only a decided session it requested, inside its window', () => {
    const now = Date.parse('2026-11-12T10:00:00.000Z')
    expect(canOpen(session({ state: 'approved' }), ME.user.id, now)).toBe(true)
    expect(canOpen(session(), ME.user.id, now)).toBe(true)
    expect(canOpen(session({ state: 'requested', starts_at: null, ends_at: null }), ME.user.id, now)).toBe(false)
    expect(canOpen(session({ ends_at: '2026-11-12T09:30:00.000Z' }), ME.user.id, now)).toBe(false)
    expect(canOpen(session({ requester_id: 'x' }), ME.user.id, now)).toBe(false)
  })
})

describe('vendor console rules', () => {
  it('may end only an active session it requested', () => {
    expect(canEnd(session(), ME.user.id)).toBe(true)
    expect(canEnd(session({ state: 'approved' }), ME.user.id)).toBe(false)
    expect(canEnd(session({ requester_id: 'x' }), ME.user.id)).toBe(false)
  })

  it('asks for 1 minute up to the API limit', () => {
    expect(sessionMinutesError('480', 480)).toBeNull()
    expect(sessionMinutesError('481', 480)).toContain('1 to 480')
    expect(sessionMinutesError('1.5', 480)).toContain('whole number')
  })

  it('checks markets for duplicates, codes and time zones', () => {
    const tenantDraft = {
      legal_name: 'A', slug: 'a', region: 'eu', isolation_tier: 'pooled', dpa_document_id: DPA, 'first_admin.email': 'a@b.example', 'first_admin.display_name': '',
      'second_admin.email': 'c@b.example', 'second_admin.display_name': '',
    }
    const market = { code: 'DE', currency: 'EUR', minor_unit: '2', time_zone: 'Mars/Base', languages: 'de', market_pack: 'p' }
    expect(checkProvisioning(tenantDraft, [market, market])).toEqual({
      'markets.0.time_zone': 'Enter a time zone such as Europe/Berlin.',
      'markets.1.code': 'Each market may appear once.',
      'markets.1.time_zone': 'Enter a time zone such as Europe/Berlin.',
    })
  })

  it('requires a second admin who is not the first (BUG-024)', () => {
    const tenantDraft = {
      legal_name: 'A', slug: 'a', region: 'eu', isolation_tier: 'pooled', dpa_document_id: DPA, 'first_admin.email': 'a@b.example', 'first_admin.display_name': '',
      'second_admin.email': '', 'second_admin.display_name': '',
    }
    const market = { code: 'DE', currency: 'EUR', minor_unit: '2', time_zone: 'Europe/Berlin', languages: 'de', market_pack: 'none' }
    expect(checkProvisioning(tenantDraft, [market])).toEqual({ 'second_admin.email': 'Enter the second admin’s email address.' })
    expect(checkProvisioning({ ...tenantDraft, 'second_admin.email': ' A@B.example ' }, [market])).toEqual({ 'second_admin.email': 'Enter a different person from the first admin.' })
    expect(checkProvisioning({ ...tenantDraft, 'second_admin.email': 'c@b.example' }, [market])).toEqual({})
  })

  it('says the agreement ID is a UUID and what a market pack takes (BUG-016)', () => {
    const tenantDraft = {
      legal_name: 'A', slug: 'a', region: 'eu', isolation_tier: 'pooled', dpa_document_id: 'DPA-2026-0042', 'first_admin.email': 'a@b.example', 'first_admin.display_name': '',
      'second_admin.email': 'c@b.example', 'second_admin.display_name': '',
    }
    const market = { code: 'DE', currency: 'EUR', minor_unit: '2', time_zone: 'Europe/Berlin', languages: 'de', market_pack: '' }
    const errors = checkProvisioning(tenantDraft, [market])
    expect(errors.dpa_document_id).toContain('as a UUID, like')
    expect(errors['markets.0.market_pack']).toBe('Enter the market pack, or none if the market has no pack.')
    expect(checkProvisioning(tenantDraft, [{ ...market, market_pack: 'x'.repeat(65) }])['markets.0.market_pack']).toBe('Use at most 64 characters.')
    expect(checkProvisioning({ ...tenantDraft, dpa_document_id: DPA }, [{ ...market, market_pack: 'none' }])).toEqual({})
  })
})
