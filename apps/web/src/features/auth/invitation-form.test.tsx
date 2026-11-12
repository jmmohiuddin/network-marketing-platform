// @vitest-environment jsdom
import '../../test/dom'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { apiError, fetchReturning, noContent, requestBody } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { InvitationForm, tokenFromHash } from './invitation-form'

const PASSWORD = 'a long enough passphrase'

async function choosePassword(user: ReturnType<typeof userEvent.setup>, password: string, repeat = password) {
  await user.type(await screen.findByLabelText('New password'), password)
  await user.type(screen.getByLabelText('Repeat the password'), repeat)
  await user.click(screen.getByRole('button', { name: 'Set password' }))
}

describe('InvitationForm', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('reads the token from the fragment, removes it from the address bar and sets the password', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/invitation#token=tok_123')
    const fetchMock = fetchReturning(noContent())
    renderWithProviders(<InvitationForm />, fetchMock)
    await choosePassword(user, PASSWORD)
    expect(window.location.hash).toBe('')
    expect(await screen.findByRole('heading', { name: 'Your password is set' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to sign-in' }).getAttribute('href')).toBe('/signin')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/invitations/accept')
    expect(requestBody(fetchMock)).toEqual({ token: 'tok_123', password: PASSWORD })
  })

  it('sends the invitee to a sign-in with the company from the link filled in', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/invitation?tenant=acme-eu#token=tok_123')
    renderWithProviders(<InvitationForm />, fetchReturning(noContent()))
    await choosePassword(user, PASSWORD)
    expect(window.location.hash).toBe('')
    expect((await screen.findByRole('link', { name: 'Go to sign-in' })).getAttribute('href')).toBe('/signin?tenant=acme-eu')
  })

  it('ignores a company value that is not a tenant slug', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/invitation?tenant=Acme%20Ltd#token=tok_123')
    renderWithProviders(<InvitationForm />, fetchReturning(noContent()))
    await choosePassword(user, PASSWORD)
    expect((await screen.findByRole('link', { name: 'Go to sign-in' })).getAttribute('href')).toBe('/signin')
  })

  it('checks length and repetition before sending', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/invitation#token=tok_123')
    const fetchMock = fetchReturning()
    renderWithProviders(<InvitationForm />, fetchMock)
    await choosePassword(user, 'short', 'other')
    const summary = screen.getByRole('alert')
    expect(summary.textContent).toContain('Use at least 12 characters.')
    expect(summary.textContent).toContain('Enter the same password in both fields.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains a used or expired link', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/invitation#token=used')
    renderWithProviders(<InvitationForm />, fetchReturning(apiError(422, 'INVITATION_INVALID')))
    await choosePassword(user, PASSWORD)
    expect(await screen.findByRole('heading', { name: 'This invitation link does not work' })).toBeTruthy()
  })

  it('says so when the link has no token', async () => {
    window.history.replaceState(null, '', '/invitation')
    renderWithProviders(<InvitationForm />, fetchReturning())
    expect(await screen.findByRole('heading', { name: 'This invitation link is not complete' })).toBeTruthy()
  })

  it('accepts only a plausible token', () => {
    expect(tokenFromHash('#token=abc')).toBe('abc')
    expect(tokenFromHash('#token=')).toBeNull()
    expect(tokenFromHash(`#token=${'x'.repeat(129)}`)).toBeNull()
  })
})
