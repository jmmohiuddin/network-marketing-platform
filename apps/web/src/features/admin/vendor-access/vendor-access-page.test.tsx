// @vitest-environment jsdom
import '../../../test/dom'
import { screen } from '@testing-library/react'
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

const ME = adminMe()

function session(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 's1', tenant_id: 't1', tenant_slug: 'acme', requester_id: 'v1', reason: 'Ticket 42: snapshot failed',
    scope: { permissions: ['compliance.read'], requester_region: 'us' }, requested_minutes: 240, state: 'requested',
    decided_by: null, starts_at: null, ends_at: null, created_at: '2026-11-12T08:00:00.000Z', ...overrides,
  }
}

describe('VendorAccessPage', () => {
  beforeEach(() => {
    navigation.search = ''
  })

  it('approves a request for at most the requested window, with an explicit region approval', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': () => ok([session()]),
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
      'GET /v1/support-sessions': () => ok([session()]),
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

  it('ends an open session now and reads its log', async () => {
    navigation.search = 'tab=active'
    const user = userEvent.setup()
    const active = session({ state: 'active', starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2099-01-01T00:00:00.000Z' })
    const fetchMock = fetchByRoute({
      'GET /v1/support-sessions': (query) => ok(query.get('state') === 'active' ? [active] : []),
      'GET /v1/support-sessions/s1/log': () => ok([{ seq: '7', occurred_at: '2026-11-12T09:05:00.000Z', actor_type: 'vendor_user', actor_id: 'v1', action: 'SUPPORT_SESSION.ACCESSED', object_type: null, object_id: null, before: null, after: { method: 'GET', route: '/v1/compliance/snapshots' }, reason: null, request_id: 'r' }]),
      'POST /v1/support-sessions/s1/end': () => ok(session({ state: 'ended' })),
    })
    renderAs(ME, <VendorAccessPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'View log' }))
    expect(await screen.findByText('GET /v1/compliance/snapshots')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'End now' }))
    await user.click(screen.getByRole('button', { name: 'End session now' }))
    expect(await screen.findByText('The vendor session has ended.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/support-sessions/s1/end').length).toBe(1)
  })

  it('says when there are no requests', async () => {
    renderAs(ME, <VendorAccessPage />, fetchByRoute({ 'GET /v1/support-sessions': () => ok([]) }))
    expect(await screen.findByText('No requests. When vendor staff ask for access, the request appears here.')).toBeTruthy()
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
    expect(logDetails({ after: null })).toBe('')
  })
})
