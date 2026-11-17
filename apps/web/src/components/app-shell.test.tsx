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

  it('shows the user as initials, name and roles, with an icon per known navigation key', async () => {
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(me({ roles: [{ assignment_id: 'a1', role_id: 'r1', name: 'Tenant admin', market_ids: null }] }))))
    await screen.findByText('May invite users')
    expect(screen.getByText('AA').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('Ada Admin')).toBeTruthy()
    expect(screen.getByText('Tenant admin')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Users and roles' })
    expect(link.getAttribute('title')).toBe('Users and roles')
    expect(link.querySelector('.material-symbols-outlined')?.textContent).toBe('admin_panel_settings')
  })

  it('shows the B1 settings entries the API grants with their icons, the deepest matching one current', async () => {
    navigation.pathname = '/settings/markets/m1/checklist'
    const entries = [
      { key: 'settings', path: '/settings', label: 'Settings' },
      { key: 'markets', path: '/settings/markets', label: 'Markets' },
      { key: 'integrations', path: '/settings/integrations', label: 'Integrations' },
    ]
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(me({ navigation: entries }))))
    await screen.findByText('May invite users')
    const markets = screen.getByRole('link', { name: 'Markets' })
    const integrations = screen.getByRole('link', { name: 'Integrations' })
    expect([markets, integrations].map((link) => link.querySelector('.material-symbols-outlined')?.textContent)).toEqual(['public', 'hub'])
    expect(markets.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBeNull()
  })

  it('shows the B2 entries the API grants with their icons; a genealogy case page is under Cases', async () => {
    navigation.pathname = '/cases/genealogy/new'
    const entries = [
      { key: 'people', path: '/people', label: 'People' },
      { key: 'genealogy', path: '/genealogy', label: 'Genealogy' },
      { key: 'cases', path: '/cases', label: 'Cases' },
      { key: 'orders', path: '/orders', label: 'Orders' },
      { key: 'late', path: '/periods/late', label: 'Late transactions' },
    ]
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(me({ navigation: entries }))))
    await screen.findByText('May invite users')
    const links = entries.map((entry) => screen.getByRole('link', { name: entry.label }))
    expect(links.map((link) => link.querySelector('.material-symbols-outlined')?.textContent))
      .toEqual(['account_tree', 'lan', 'rule_folder', 'receipt_long', 'history_toggle_off'])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'page', null, null])
  })

  it('opens the navigation as an overlay from Menu and closes it with Escape', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppShell realm="tenant"><Page /></AppShell>, fetchReturning(ok(me())))
    const menu = await screen.findByRole('button', { name: 'Menu' })
    const aside = document.getElementById('shell-nav')!
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(aside.className).toContain('hidden')
    await user.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(aside.className).toContain('flex shadow-xl')
    screen.getByRole('link', { name: 'Audit log' }).focus()
    await user.keyboard('{Escape}')
    expect(menu.getAttribute('aria-expanded')).toBe('false')
  })

  it('gives the vendor console its sections instead of the single API entry', async () => {
    navigation.pathname = '/vendor/users'
    const vendor = me({ realm: 'vendor', tenant: null, navigation: [{ key: 'console', path: '/vendor', label: 'Operations console' }] })
    renderWithProviders(<AppShell realm="vendor"><Page /></AppShell>, fetchReturning(ok(vendor)))
    const nav = await screen.findByRole('navigation', { name: 'Console' })
    expect([...nav.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['corporate_fareTenants', 'vpn_keySupport sessions', 'admin_panel_settingsVendor users', 'history_eduAudit log'])
    expect(screen.getByRole('link', { name: 'Vendor users' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Operations console')).toBeTruthy()
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
