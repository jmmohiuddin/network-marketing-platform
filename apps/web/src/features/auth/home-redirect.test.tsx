// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchReturning, ok } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { HomeRedirect } from './home-redirect'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const base = {
  user: { id: 'u', email: 'ops@vendor.example', display_name: null },
  tenant: null,
  roles: [],
  permissions: [],
  mfa: { required: true, enrolled: true, verified: true },
  step_up_at: null,
}

describe('HomeRedirect', () => {
  beforeEach(() => router.replace.mockClear())

  it('opens the first navigation entry of the role', async () => {
    renderWithProviders(<HomeRedirect />, fetchReturning(ok({ ...base, realm: 'vendor', navigation: [{ key: 'console', path: '/vendor', label: 'Operations console' }] })))
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/vendor'))
  })

  it('explains when the account opens no page', async () => {
    renderWithProviders(<HomeRedirect />, fetchReturning(ok({ ...base, realm: 'tenant', navigation: [] })))
    expect(await screen.findByRole('heading', { name: 'No pages are available to your account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('shows a blocking error with a reference and retries', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(
      new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x', details: null, request_id: '7F3A' } }), { status: 500 }),
      ok({ ...base, realm: 'tenant', navigation: [{ key: 'audit', path: '/settings/audit', label: 'Audit log' }] }),
    )
    renderWithProviders(<HomeRedirect />, fetchMock)
    expect((await screen.findByRole('alert')).textContent).toContain('Reference: 7F3A')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/settings/audit'))
  })
})
