// @vitest-environment jsdom
import '../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../lib/me'
import { useSession } from '../lib/session'
import { enterSupportSession, storedSupportSession } from '../lib/support-session'
import { ok } from '../test/fetch'
import { renderWithProviders } from '../test/render'
import { callsOf, fetchRoutes } from '../features/data/test-support'
import { AppShell } from './app-shell'

const navigation = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router, usePathname: () => '/compliance' }))
const leavePage = vi.hoisted(() => vi.fn())
vi.mock('../lib/leave-page', () => ({ leavePage }))

const NOW = Date.parse('2026-11-12T10:00:00.000Z')
const ENGINEER = { id: 'v1', email: 'engineer@vendor.example', display_name: 'Eve Engineer' }

// GET /v1/me inside a session: tenant realm, the session as the only role, no user (support/access.ts inSession).
const inSession = {
  tenant: { id: 't1', slug: 'acme', legal_name: 'Acme Ltd', region: 'eu', state: 'live' },
  realm: 'tenant',
  roles: [{ assignment_id: 'ss1', role_id: 'ss1', name: 'Support session', market_ids: null }],
  permissions: ['compliance.read', 'snapshot.create'],
  mfa: { required: true, enrolled: true, verified: true },
  step_up_at: null,
  navigation: [{ key: 'compliance', path: '/compliance', label: 'Compliance' }],
}

function Page() {
  const { can, readOnly } = useSession()
  return <p>{readOnly ? 'Read-only view' : can('snapshot.create') ? 'May create' : 'Cannot create'}</p>
}

describe('support-session frame', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true })
    window.sessionStorage.clear()
    leavePage.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    window.sessionStorage.clear()
  })

  it('reads the tenant app inside the session: header on reads, frame with countdown, write controls hidden', async () => {
    enterSupportSession({ id: 'ss1', tenantSlug: 'acme', endsAt: new Date(NOW + (2 * 60 + 41) * 60_000).toISOString(), user: ENGINEER })
    const fetchMock = fetchRoutes(['GET', /^\/v1\/me$/, () => ok(inSession)])
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchMock)
    const bar = await screen.findByRole('region', { name: 'Vendor support session' })
    expect(bar.textContent).toContain('Vendor support session · read-only · acme · ends in 02:41')
    expect(screen.getByText('Read-only view')).toBeTruthy()
    expect(screen.getByText('Eve Engineer')).toBeTruthy()
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Support-Session')).toBe('ss1')
  })

  it('ends the session from the frame in the vendor realm and returns to the console', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    enterSupportSession({ id: 'ss1', tenantSlug: 'acme', endsAt: new Date(NOW + 60 * 60_000).toISOString(), user: ENGINEER })
    const fetchMock = fetchRoutes(['GET', /^\/v1\/me$/, () => ok(inSession)], ['POST', /^\/v1\/support-sessions\/ss1\/end$/, () => ok({ id: 'ss1', state: 'ended' })])
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchMock)
    await user.click(within(await screen.findByRole('region', { name: 'Vendor support session' })).getByRole('button', { name: 'End session' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End session' }))
    await vi.waitFor(() => expect(leavePage).toHaveBeenCalledWith('/vendor/support-sessions'))
    expect(callsOf(fetchMock)).toContain('POST /v1/support-sessions/ss1/end')
    const end = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/end'))
    expect(new Headers(end?.[1]?.headers).get('X-Support-Session')).toBeNull()
    expect(storedSupportSession()).toBeNull()
  })

  it('draws no frame for a stored session the server does not confirm', async () => {
    enterSupportSession({ id: 'ss1', tenantSlug: 'acme', endsAt: new Date(NOW + 60 * 60_000).toISOString(), user: ENGINEER })
    const tenantUser: Me = {
      ...inSession, realm: 'tenant', roles: [], user: { id: 'u1', email: 'officer@acme.example', display_name: null },
    } as Me
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchRoutes(['GET', /^\/v1\/me$/, () => ok(tenantUser)]))
    expect(await screen.findByText('May create')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Vendor support session' })).toBeNull()
  })
})
