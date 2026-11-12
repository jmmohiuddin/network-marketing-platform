// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, fetchReturning, ok, requestBody } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { SignInForm } from './sign-in-form'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router, useSearchParams: () => new URLSearchParams(navigation.search) }))

async function fill(user: ReturnType<typeof userEvent.setup>, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) await user.type(screen.getByLabelText(label), value)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInForm', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.router.replace.mockClear()
  })

  it('renders the sc_27 card header and one full-width primary submit', () => {
    renderWithProviders(<SignInForm realm="vendor" />, fetchReturning())
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to the operations console' })).toBeTruthy()
    expect(screen.getByText('Operations console')).toBeTruthy()
    expect(screen.getByTestId('primary-action').textContent).toContain('Sign in')
    expect(screen.queryByLabelText('Company')).toBeNull()
  })

  it('lists missing fields in a focused summary without calling the API', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning()
    renderWithProviders(<SignInForm realm="tenant" />, fetchMock)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const summary = screen.getByRole('alert')
    expect(document.activeElement).toBe(summary)
    expect(summary.textContent).toContain('Enter your company sign-in name.')
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fills in and fixes the company named by an invitation link', async () => {
    const user = userEvent.setup()
    navigation.search = 'tenant=acme'
    const fetchMock = fetchReturning(ok({ expires_at: '2026-11-12T20:00:00Z', next_step: 'none' }))
    renderWithProviders(<SignInForm realm="tenant" />, fetchMock)
    const company = screen.getByLabelText('Company') as HTMLInputElement
    expect(company.value).toBe('acme')
    expect(company.readOnly).toBe(true)
    await fill(user, { 'Email address': 'ada@acme.example', Password: 'correct horse battery' })
    expect(requestBody(fetchMock)).toEqual({ tenant: 'acme', email: 'ada@acme.example', password: 'correct horse battery' })
  })

  it('signs in to the tenant and goes to MFA verification, keeping next', async () => {
    const user = userEvent.setup()
    navigation.search = 'next=%2Fsettings%2Faudit'
    const fetchMock = fetchReturning(ok({ expires_at: '2026-11-12T20:00:00Z', next_step: 'mfa_verification' }, 201))
    renderWithProviders(<SignInForm realm="tenant" />, fetchMock)
    await fill(user, { Company: ' Acme ', 'Email address': 'ada@acme.example', Password: 'correct horse battery' })
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/signin/mfa?next=%2Fsettings%2Faudit'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/sessions')
    expect(requestBody(fetchMock)).toEqual({ tenant: 'acme', email: 'ada@acme.example', password: 'correct horse battery' })
  })

  it('shows the generic failure and lets the user try again', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignInForm realm="tenant" />, fetchReturning(apiError(401, 'INVALID_CREDENTIALS', 'The email or password is not correct.')))
    await fill(user, { Company: 'acme', 'Email address': 'ada@acme.example', Password: 'wrong' })
    expect((await screen.findByRole('alert')).textContent).toContain('The email or password is not correct.')
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).getAttribute('aria-busy')).toBeNull()
    expect(navigation.router.replace).not.toHaveBeenCalled()
  })

  it('uses the vendor endpoint without a company field and lands on the console', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok({ expires_at: '2026-11-12T20:00:00Z', next_step: 'none' }, 201))
    renderWithProviders(<SignInForm realm="vendor" />, fetchMock)
    expect(screen.queryByLabelText('Company')).toBeNull()
    await fill(user, { 'Email address': 'ops@vendor.example', Password: 'long enough secret' })
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/vendor'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/vendor-sessions')
  })

  it('confirms a sign-out', () => {
    navigation.search = 'reason=signed_out'
    renderWithProviders(<SignInForm realm="tenant" />, fetchReturning())
    expect(screen.getByText('You are signed out.').closest('[role="status"]')?.getAttribute('data-tone')).toBe('info')
  })
})
