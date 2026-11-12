// @vitest-environment jsdom
import '../test/dom'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../lib/me'
import { useSession } from '../lib/session'
import { fetchReturning, noContent, ok } from '../test/fetch'
import { renderWithProviders } from '../test/render'
import { AppShell } from './app-shell'

const navigation = vi.hoisted(() => ({ pathname: '/settings/users', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router, usePathname: () => navigation.pathname }))
const leavePage = vi.hoisted(() => vi.fn())
vi.mock('../lib/leave-page', () => ({ leavePage }))

function me(overrides: Partial<Me> = {}): Me {
  return {
    user: { id: 'u1', email: 'admin@acme.example', display_name: 'Ada Admin' },
    tenant: { id: 't1', slug: 'acme', legal_name: 'Acme Ltd', region: 'eu', state: 'live' },
    realm: 'tenant',
    roles: [],
    permissions: ['user.manage', 'audit.read'],
    mfa: { required: true, enrolled: true, verified: true },
    step_up_at: null,
    navigation: [
      { key: 'users', path: '/settings/users', label: 'Users and roles' },
      { key: 'audit', path: '/settings/audit', label: 'Audit log' },
    ],
    ...overrides,
  }
}

function Page() {
  const { can } = useSession()
  return <p>{can('user.manage') ? 'May invite users' : 'Read only'}</p>
}

describe('AppShell', () => {
  beforeEach(() => {
    navigation.pathname = '/settings/users'
    navigation.router.replace.mockClear()
  })

  it('builds the navigation from /v1/me and marks the current page', async () => {
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(me())))
    expect(await screen.findByText('May invite users')).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav.querySelectorAll('a')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Users and roles' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Acme Ltd')).toBeTruthy()
  })

  it('starts each page with focus on its main content (BUG-021)', async () => {
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(me())))
    await screen.findByText('May invite users')
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('shows "Not found or not available to you" outside the navigation', async () => {
    navigation.pathname = '/imports'
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(me())))
    expect(await screen.findByRole('heading', { name: 'Not found or not available to you' })).toBeTruthy()
    expect(screen.queryByText('May invite users')).toBeNull()
  })

  it('sends a user with a required factor to enrolment before any page (AC-35.1)', async () => {
    const pending = me({ mfa: { required: true, enrolled: false, verified: false }, navigation: [] })
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(pending)))
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/signin/enrol?next=%2Fsettings%2Fusers'))
    expect(screen.queryByText('May invite users')).toBeNull()
  })

  it('keeps the query string of the page to come back to after MFA', async () => {
    window.history.replaceState(null, '', '/settings/users?tab=roles')
    const pending = me({ mfa: { required: false, enrolled: true, verified: false }, navigation: [] })
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(pending)))
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/signin/mfa?next=%2Fsettings%2Fusers%3Ftab%3Droles'))
    window.history.replaceState(null, '', '/')
  })

  it('sends a vendor user away from the staff shell', async () => {
    const vendor = me({ realm: 'vendor', tenant: null, navigation: [{ key: 'console', path: '/vendor', label: 'Operations console' }] })
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(vendor)))
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/'))
  })

  it('signs out and reloads the sign-in page', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok(me()), noContent())
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(leavePage).toHaveBeenCalledWith('/signin?reason=signed_out'))
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })
})
