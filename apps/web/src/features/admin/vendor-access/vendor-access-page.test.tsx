// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../test-support'
import type { SupportSession } from '../types'
import { minutesError, outOfRegion } from './decision-dialog'
import { logDetails } from './session-log-dialog'
import { VendorAccessPage } from './vendor-access-page'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/settings/vendor-access',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const ADMIN_ROLE = { assignment_id: 'as1', role_id: 'r-admin', name: 'Tenant admin', market_ids: null }
const ME = adminMe({ roles: [ADMIN_ROLE], permissions: ['user.manage', 'audit.read', 'settings.manage', 'vendor_access.decide', 'compliance.read', 'import.manage'] })
const REQUESTER = { id: 'v1', display_name: 'Vera Vendor', email: 'vera@vendor.example' }

function session(overrides: Partial<SupportSession> = {}): SupportSession & { requester: typeof REQUESTER | null } {
  return {
    id: 's1', tenant_id: 't1', tenant_slug: 'acme', requester_id: 'v1', reason: 'Ticket 42: snapshot failed',
    scope: { permissions: ['compliance.read'], requester_region: 'us' }, requested_minutes: 240, state: 'requested',
    decided_by: null, starts_at: null, ends_at: null, created_at: '2026-11-12T08:00:00.000Z', requester: REQUESTER, ...overrides,
  }
}

/** GET /v1/support-sessions answered by its ?state= filter (no filter: the history). */
function sessionsByState(lists: Readonly<Record<string, readonly SupportSession[]>>) {
  return (query: URLSearchParams) => ok(lists[query.get('state') ?? 'history'] ?? [])
}

describe('VendorAccessPage', () => {
  beforeEach(() => {
    navigation.search = ''
  })

  it('approves a request for at most the requested window, with an explicit region approval', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': sessionsByState({ requested: [session()] }),
      'POST /v1/support-sessions/s1/decision': () => ok(session({ state: 'approved' })),
    })
    renderAs(ME, <VendorAccessPage />, fetchMock)
    expect(await screen.findByText('Ticket 42: snapshot failed')).toBeTruthy()
    expect(screen.getByText(/works outside your data region/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    const minutes = screen.getByLabelText('Access window in minutes')
    expect((minutes as HTMLInputElement).value).toBe('240')
    await user.clear(minutes)
    await user.type(minutes, '300')
    await user.click(screen.getByRole('button', { name: 'Approve access' }))
    const summary = screen.getByRole('alert').textContent
    expect(summary).toContain('Approve at most the 240 minutes requested (4 h).')
    expect(summary).toContain('Confirm access from outside your data region')
    await user.clear(minutes)
    await user.type(minutes, '120')
    await user.click(screen.getByLabelText('I approve access from outside our data region'))
    await user.click(screen.getByRole('button', { name: 'Approve access' }))
    expect(await screen.findByText('Access approved for 2 h. It ends automatically.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/support-sessions/s1/decision')[0]!
    expect(bodyOf(init)).toEqual({ approved: true, minutes: 120, region_approved: true, reason: null })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('denies a request and shows a server refusal in the dialog', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': sessionsByState({ requested: [session()] }),
      'POST /v1/support-sessions/s1/decision': () => apiError(422, 'SUPPORT_REQUEST_EXPIRED', 'This request expired before a decision.'),
    })
    renderAs(ME, <VendorAccessPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Deny' }))
    await user.type(screen.getByLabelText(/Note for the log/), 'Not needed')
    await user.click(screen.getByRole('button', { name: 'Deny access' }))
    expect(await screen.findByText('This request expired before a decision.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/support-sessions/s1/decision')[0]!
    expect(bodyOf(init)).toEqual({ approved: false, minutes: null, region_approved: false, reason: 'Not needed' })
  })

  it('shows an open session with its latest log entries, ends it now and reads the full log', async () => {
    const user = userEvent.setup()
    const active = session({ state: 'active', starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z' })
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': sessionsByState({ active: [active] }),
      'GET /v1/support-sessions/s1/log': () => ok([{ seq: '7', occurred_at: '2026-11-12T09:05:00.000Z', actor_type: 'vendor_user', actor_id: 'v1', action: 'SUPPORT_SESSION.ACCESSED', object_type: null, object_id: null, before: null, after: { method: 'GET', route: '/v1/compliance/snapshots' }, reason: null, request_id: 'r' }]),
      'POST /v1/support-sessions/s1/end': () => ok(session({ state: 'ended' })),
    })
    renderAs(ME, <VendorAccessPage />, fetchMock)
    const card = (await screen.findByRole('heading', { name: 'Vendor session' })).closest('li')!
    expect(await within(card).findByText('GET /v1/compliance/snapshots')).toBeTruthy()
    expect(callsTo(fetchMock, 'GET', '/v1/support-sessions/s1/log')[0]![0]).toContain('limit=5')
    await user.click(within(card).getByRole('button', { name: 'View log' }))
    expect(await within(screen.getByRole('dialog', { name: 'Support session log' })).findByText('GET /v1/compliance/snapshots')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'End now' }))
    await user.click(screen.getByRole('button', { name: 'End session now' }))
    expect(await screen.findByText('The vendor session has ended.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/support-sessions/s1/end').length).toBe(1)
  })

  it('BUG-023: names the vendor requester on request, open-session and history views', async () => {
    const asked = session({ scope: { permissions: ['import.manage', 'user.manage'], requester_region: 'eu' } })
    const active = session({ id: 's2', state: 'active', starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z' })
    const unresolved = { ...session({ id: 's3', state: 'ended', requester_id: '7733a8df-0000-4000-8000-000000000003' }), requester: null }
    renderAs(ME, <VendorAccessPage />, fetchByRoute({
      'GET /v1/support-sessions': sessionsByState({ requested: [asked], active: [active], history: [unresolved] }),
      'GET /v1/support-sessions/s2/log': () => ok([]),
    }))
    expect(await screen.findByText('Areas asked for (view only)')).toBeTruthy()
    expect(screen.getByText('Data imports, Users and roles')).toBeTruthy()
    expect(screen.getAllByText('Vera Vendor (vera@vendor.example)')).toHaveLength(2)
    expect(await screen.findByRole('cell', { name: 'Vendor user 7733a8df' })).toBeTruthy()
    expect(screen.queryByText(/Upload and load|Manage users/)).toBeNull()
  })

  it('BUG-047: names the areas the admin cannot approve before Approve', async () => {
    const asked = session({ scope: { permissions: ['compliance.read', 'export'], requester_region: 'eu' } })
    renderAs(ME, <VendorAccessPage />, fetchByRoute({ 'GET /v1/support-sessions': sessionsByState({ requested: [asked] }) }))
    expect(await screen.findByText('You cannot approve: Row exports')).toBeTruthy()
  })

  it('BUG-047: names areas held only for some markets', async () => {
    const scoped = adminMe({ roles: [{ ...ADMIN_ROLE, market_ids: ['m1'] }], permissions: ME.permissions })
    renderAs(scoped, <VendorAccessPage />, fetchByRoute({ 'GET /v1/support-sessions': sessionsByState({ requested: [session()] }) }))
    expect(await screen.findByText('You cannot approve: Compliance reports')).toBeTruthy()
  })

  it('BUG-046: says a code may be asked for when deciding', async () => {
    const user = userEvent.setup()
    renderAs(ME, <VendorAccessPage />, fetchByRoute({ 'GET /v1/support-sessions': sessionsByState({ requested: [session()] }) }))
    await user.click(await screen.findByRole('button', { name: 'Deny' }))
    expect(within(screen.getByRole('dialog')).getByText('You may be asked for a code from your authenticator app.')).toBeTruthy()
  })

  it('BUG-028: after End now, focus lands on the open-sessions heading, not the body', async () => {
    const user = userEvent.setup()
    const active = session({ state: 'active', starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z' })
    renderAs(ME, <VendorAccessPage />, fetchByRoute({
      'GET /v1/support-sessions': sessionsByState({ active: [active] }),
      'GET /v1/support-sessions/s1/log': () => ok([]),
      'POST /v1/support-sessions/s1/end': () => ok(session({ state: 'ended' })),
    }))
    await user.click(await screen.findByRole('button', { name: 'End now' }))
    await user.click(screen.getByRole('button', { name: 'End session now' }))
    expect(await screen.findByText('The vendor session has ended.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Open sessions' }))
  })

  it('says when there are no requests, no open sessions and no history', async () => {
    renderAs(ME, <VendorAccessPage />, fetchByRoute({ 'GET /v1/support-sessions': () => ok([]) }))
    expect(await screen.findByText('No requests. When vendor staff ask for access, the request appears here.')).toBeTruthy()
    expect(await screen.findByText('No vendor session is open.')).toBeTruthy()
    expect(await screen.findByText('Vendor staff have not asked for access yet.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Requests waiting for your decision' })).toBeTruthy()
  })

  it('counts open sessions and waiting requests and shows the data region', async () => {
    const active = session({ id: 's2', state: 'active', starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z' })
    renderAs(ME, <VendorAccessPage />, fetchByRoute({
      'GET /v1/support-sessions': sessionsByState({ requested: [session()], active: [active] }),
      'GET /v1/support-sessions/s2/log': () => ok([]),
    }))
    expect(await screen.findByText('Nothing has been logged for this session yet.')).toBeTruthy()
    expect(screen.getByText(/First one ends in/)).toBeTruthy()
    expect(screen.getByText('eu')).toBeTruthy()
  })
})

describe('support decision rules', () => {
  it('accepts whole minutes up to the request', () => {
    expect(minutesError('240', 240)).toBeNull()
    expect(minutesError('0', 240)).toBe('Approve at least 1 minute.')
    expect(minutesError('1.5', 240)).toBe('Enter the number of minutes as a whole number.')
  })

  it('treats an unknown requester region as outside the data region', () => {
    expect(outOfRegion(session({ scope: { permissions: [], requester_region: 'eu' } }), 'eu')).toBe(false)
    expect(outOfRegion(session({ scope: { permissions: [], requester_region: null } }), 'eu')).toBe(true)
  })

  it('describes refusals and endings in the session log', () => {
    expect(logDetails({ after: { refusal: 'SUPPORT_SESSION_READ_ONLY', method: 'POST', route: '/v1/imports' } })).toBe('Refused (SUPPORT_SESSION_READ_ONLY): POST /v1/imports')
    expect(logDetails({ after: { by: 'tenant' } })).toBe('By tenant')
    // BUG-020: the recorded params and query are shown, not the route pattern only.
    expect(logDetails({ after: { method: 'GET', route: '/v1/settings/:key', params: { key: 'privacy.breach_contacts' }, query: {} } }))
      .toBe('GET /v1/settings/privacy.breach_contacts')
    expect(logDetails({ after: { method: 'GET', route: '/v1/compliance/snapshots/:id/figures/:figure/rows', params: { id: 's9', figure: 'r1.customer_share_pct' }, query: { set: 'numerator', limit: '50' } } }))
      .toBe('GET /v1/compliance/snapshots/s9/figures/r1.customer_share_pct/rows?set=numerator&limit=50')
    expect(logDetails({ after: null })).toBe('')
  })
})
