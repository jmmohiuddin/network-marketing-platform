// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, fetchReturning, ok, requestBody } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { adminMe } from '../admin/test-support'
import { MfaEnrolment, MfaVerification } from './mfa'

const navigation = vi.hoisted(() => ({ search: 'next=%2Fimports', router: { replace: vi.fn() }, leavePage: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router, useSearchParams: () => new URLSearchParams(navigation.search) }))
vi.mock('../../lib/leave-page', () => ({ leavePage: navigation.leavePage }))

const ENROLMENT = { secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/NMP:ada%40acme.example?secret=JBSWY3DPEHPK3PXP&issuer=NMP' }

describe('MfaEnrolment', () => {
  beforeEach(() => navigation.router.replace.mockClear())

  it('starts on request, shows QR and key, confirms the code and continues', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok(ENROLMENT, 201), ok({ assurance: 'aal2' }))
    renderWithProviders(<MfaEnrolment />, fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Set up authenticator app' }))
    expect(await screen.findByRole('img', { name: /QR code that adds this account/ })).toBeTruthy()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    await user.type(screen.getByLabelText('Verification code'), '123 456')
    await user.click(screen.getByRole('button', { name: 'Confirm code' }))
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/imports'))
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/auth/mfa/totp/confirm')
    expect(requestBody(fetchMock, 1)).toEqual({ code: '123456' })
    expect(screen.getByText('Your authenticator app is set up.')).toBeTruthy()
  })

  it('goes to verification when a factor is already enrolled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MfaEnrolment />, fetchReturning(apiError(409, 'MFA_ALREADY_ENROLLED')))
    await user.click(screen.getByRole('button', { name: 'Set up authenticator app' }))
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/signin/mfa?next=%2Fimports'))
  })
})

describe('MfaVerification', () => {
  beforeEach(() => navigation.router.replace.mockClear())

  it('puts focus on the code field on arrival (BUG-021)', () => {
    renderWithProviders(<MfaVerification />, fetchReturning())
    expect(document.activeElement).toBe(screen.getByLabelText('Verification code'))
  })

  it('checks the code format before sending and shows a wrong code on the field', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok(adminMe()), apiError(422, 'MFA_CODE_INVALID', 'The code is not valid. Enter the current code from your app.'), ok({ assurance: 'aal2' }))
    renderWithProviders(<MfaVerification />, fetchMock)
    const field = screen.getByLabelText('Verification code')
    await user.type(field, '123')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(screen.getByText('The code has 6 digits.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.type(field, '456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByText('The code is not valid. Enter the current code from your app.')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith('/imports')) // a full load: the app page's own CSP
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/auth/sessions/current/mfa')
  })

  it('shows who is signing in, from GET /v1/me (sc_27 identity box)', async () => {
    renderWithProviders(<MfaVerification />, fetchReturning(ok(adminMe())))
    expect(await screen.findByText('Ada Admin')).toBeTruthy()
    expect(screen.getByText('ada@acme.example')).toBeTruthy()
    expect(screen.getByText('Step 2 / 2')).toBeTruthy()
  })
})
