// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../test-support'
import type { GrantRequest, RoleView, UserView } from '../types'
import { marketIdsError, parseMarketIds } from './grant-dialog'
import { UsersPage } from './users-page'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/settings/users',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const ME = adminMe()
const MARKET = '0b9e6c1a-1f2d-4c3b-9a8e-7d6c5b4a3f21'
const created = '2026-11-01T10:00:00.000Z'

const USERS: UserView[] = [
  {
    id: 'u2', email: 'bob@acme.example', display_name: 'Bob Builder', state: 'active', mfa_enrolled: true, last_sign_in_at: null, created_at: created,
    roles: [{ assignment_id: 'a1', role_id: 'r-analyst', name: 'Commission analyst', market_ids: null, valid_to: null }],
  },
  { id: 'u3', email: 'cy@acme.example', display_name: null, state: 'invited', mfa_enrolled: false, last_sign_in_at: null, created_at: created, roles: [] },
]
const ROLES: RoleView[] = [
  { id: 'r-admin', name: 'Tenant admin', permissions: ['user.manage', 'settings.manage'], is_base: true, mfa_required: true, privileged: true },
  { id: 'r-analyst', name: 'Commission analyst', permissions: ['compliance.read'], is_base: true, mfa_required: false, privileged: false },
]
const PENDING: GrantRequest[] = [
  { id: 'g1', user_id: 'u2', role_id: 'r-admin', market_ids: null, valid_to: null, requested_by: ME.user.id, state: 'pending', created_at: created },
  { id: 'g2', user_id: 'u3', role_id: 'r-admin', market_ids: [MARKET], valid_to: null, requested_by: 'u2', state: 'pending', created_at: created },
]

function routes(extra: Record<string, () => Response> = {}) {
  return fetchByRoute({
    'GET /v1/users': () => ok(USERS),
    'GET /v1/roles': () => json(200, { data: ROLES, meta: { permissions: ['user.manage', 'settings.manage', 'compliance.read'] } }),
    'GET /v1/role-grant-requests': () => ok(PENDING),
    ...extra,
  })
}

describe('UsersPage', () => {
  beforeEach(() => {
    navigation.search = ''
  })

  it('lists users with roles, scopes and grants waiting for a second admin', async () => {
    renderAs(ME, <UsersPage />, routes())
    const bob = (await screen.findByText('Bob Builder (bob@acme.example)')).closest('tr')!
    expect(within(bob).getByText('Commission analyst · All markets')).toBeTruthy()
    expect(within(bob).getByText('Waiting for a second admin')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Pending approvals (2)' })).toBeTruthy()
    const cy = screen.getByText('cy@acme.example').closest('tr')!
    expect(within(cy).getByRole('button', { name: 'Resend invitation to cy@acme.example' })).toBeTruthy()
  })

  it('invites a user with an Idempotency-Key and reloads the list', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/users': () => ok({ user: USERS[1] }, 201) })
    renderAs(ME, <UsersPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Invite user' }))
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter the email address.')
    await user.type(screen.getByLabelText('Email address'), 'new@acme.example')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Invitation sent to new@acme.example. The link in it works once.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/users')[0]!
    expect(bodyOf(init)).toEqual({ email: 'new@acme.example' })
    expect(headerOf(init, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(callsTo(fetchMock, 'GET', '/v1/users').length).toBe(2)
  })

  it('assigns a privileged role for some markets and says it waits for a second admin', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/users/u2/role-assignments': () => ok({ assignment: null, request: PENDING[0] }, 202) })
    renderAs(ME, <UsersPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Assign role to bob@acme.example' }))
    await user.selectOptions(screen.getByLabelText('Role'), 'r-admin')
    expect(screen.getByText(/takes effect only after another admin approves it/)).toBeTruthy()
    await user.click(screen.getByLabelText('Only some markets'))
    await user.type(screen.getByLabelText('Market IDs'), 'DE')
    await user.click(screen.getByRole('button', { name: 'Assign role' }))
    expect(screen.getByRole('alert').textContent).toContain('"DE" is not a market ID.')
    await user.clear(screen.getByLabelText('Market IDs'))
    await user.type(screen.getByLabelText('Market IDs'), MARKET)
    await user.click(screen.getByRole('button', { name: 'Assign role' }))
    expect(await screen.findByText(/Tenant admin for Bob Builder \(bob@acme.example\) waits for a second admin/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/users/u2/role-assignments')[0]!
    expect(bodyOf(init)).toEqual({ role_id: 'r-admin', market_ids: [MARKET] })
  })

  it('revokes a role after confirmation', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/role-assignments/a1/revoke': () => ok({ id: 'a1' }) })
    renderAs(ME, <UsersPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Revoke Commission analyst from bob@acme.example' }))
    expect(screen.getByText('bob@acme.example loses Commission analyst (All markets) now.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Revoke role' }))
    expect(await screen.findByText('Commission analyst was revoked from bob@acme.example.')).toBeTruthy()
  })

  it('keeps the confirmation open with the reason when the last admin would be removed', async () => {
    const user = userEvent.setup()
    const refusal = 'This would leave the tenant without an administrator.'
    renderAs(ME, <UsersPage />, routes({ 'POST /v1/users/u2/deactivate': () => apiError(422, 'LAST_ADMIN', refusal) }))
    await user.click(await screen.findByRole('button', { name: 'Deactivate bob@acme.example' }))
    await user.click(screen.getByRole('button', { name: 'Deactivate user' }))
    expect(await screen.findByText(refusal)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Deactivate user' })).toBeTruthy()
  })

  it('shows why the requester cannot decide their own grant and shows the SoD refusal of the API', async () => {
    navigation.search = 'tab=approvals'
    const user = userEvent.setup()
    const refusal = 'A grant must be decided by an admin who neither requested nor receives it.'
    const fetchMock = routes({ 'POST /v1/role-grant-requests/g2/decision': () => apiError(422, 'SOD_SELF_APPROVAL', refusal) })
    renderAs(ME, <UsersPage />, fetchMock)
    const own = (await screen.findByText('You asked for this grant. Another admin must decide it.')).closest('tr')!
    expect(within(own).queryByRole('button')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Approve Tenant admin grant' }))
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    expect(await screen.findByText(refusal)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/role-grant-requests/g2/decision')[0]!
    expect(bodyOf(init)).toEqual({ decision: 'approved', reason: null })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })
})

describe('UsersPage roles tab (SC-28 permission matrix)', () => {
  it('shows capabilities as rows and roles as columns, and the changes from the starting role before creating', async () => {
    navigation.search = 'tab=roles'
    const user = userEvent.setup()
    renderAs(ME, <UsersPage />, routes())
    const matrix = await screen.findByRole('table', { name: /Permission matrix/ })
    expect(within(matrix).getByRole('columnheader', { name: 'Tenant admin (base role)' })).toBeTruthy()
    const row = within(matrix).getByText('Read compliance reports').closest('tr')!
    expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['No', 'Yes'])
    await user.click(screen.getByRole('button', { name: 'Create role' }))
    const dialog = screen.getByRole('dialog', { name: 'Create role' })
    await user.selectOptions(within(dialog).getByLabelText(/Start from the permissions of/), 'r-admin')
    await user.click(within(dialog).getByLabelText('Change tenant settings'))
    await user.click(within(dialog).getByLabelText('Read compliance reports'))
    expect(within(dialog).getByRole('status').textContent).toBe('Changes from Tenant admin: adds Read compliance reports. removes Change tenant settings.')
  })
})

describe('market ids of a grant', () => {
  it('splits lines and commas, drops duplicates and checks the format', () => {
    expect(parseMarketIds(`${MARKET},\n${MARKET}  `)).toEqual([MARKET])
    expect(marketIdsError([])).toContain('at least one')
    expect(marketIdsError([MARKET])).toBeNull()
  })
})
