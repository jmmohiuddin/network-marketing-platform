// @vitest-environment jsdom
import '../test/dom'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { errorMessage } from '../lib/messages'
import { apiError, fetchReturning, ok, requestBody, requestHeaders } from '../test/fetch'
import { renderWithProviders } from '../test/render'
import { useApi } from './api-provider'
import { Modal } from './modal'

function Approve() {
  const api = useApi()
  const [result, setResult] = useState('')
  async function approve() {
    try {
      await api.post('/v1/role-grant-requests/r1/decision', { approved: true }, { idempotencyKey: 'action-1' })
      setResult('Grant approved.')
    } catch (error) {
      setResult(errorMessage(error))
    }
  }
  return (
    <>
      <button type="button" onClick={approve}>Approve grant</button>
      <p>{result}</p>
    </>
  )
}

/** An action dialog whose primary button needs step-up; it stays open to show the outcome. */
function ApproveInDialog() {
  const api = useApi()
  const [result, setResult] = useState('')
  async function approve() {
    try {
      await api.post('/v1/role-grant-requests/r1/decision', { approved: true }, { idempotencyKey: 'action-2' })
      setResult('Grant approved.')
    } catch (error) {
      setResult(errorMessage(error))
    }
  }
  return (
    <Modal open onClose={() => undefined} title="Approve role grant" footer={<button type="button" onClick={approve}>Approve grant</button>}>
      <p>{result}</p>
    </Modal>
  )
}

describe('step-up through ApiProvider', () => {
  it('BUG-045: never stacks dialogs; code field focused, same key retried, focus back on the primary button', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(apiError(403, 'STEP_UP_REQUIRED'), ok({ assurance: 'aal2' }), ok({ id: 'r1' }))
    renderWithProviders(<ApproveInDialog />, fetchMock)
    const primary = screen.getByRole('button', { name: 'Approve grant' })
    await user.click(primary)
    const code = await screen.findByLabelText('Verification code')
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Confirm with your authenticator app' }).hasAttribute('open')).toBe(true)
    expect(document.activeElement).toBe(code)
    await user.type(code, '222222')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Grant approved.')).toBeTruthy()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Approve role grant' }).hasAttribute('open')).toBe(true)
    expect(document.activeElement).toBe(primary)
    expect(requestHeaders(fetchMock, 0).get('Idempotency-Key')).toBe('action-2')
    expect(requestHeaders(fetchMock, 2).get('Idempotency-Key')).toBe('action-2')
  })

  it('BUG-045: a cancelled step-up shows the action dialog again with its refusal', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApproveInDialog />, fetchReturning(apiError(403, 'STEP_UP_REQUIRED')))
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('This action needs the code from your authenticator app. Nothing was changed.')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Approve role grant' }).hasAttribute('open')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve grant' }))
  })

  it('asks for a code on STEP_UP_REQUIRED and retries the action once', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(
      apiError(403, 'STEP_UP_REQUIRED'),
      apiError(422, 'MFA_CODE_INVALID', 'The code is not valid. Enter the current code from your app.'),
      ok({ assurance: 'aal2' }),
      ok({ id: 'r1' }),
    )
    renderWithProviders(<Approve />, fetchMock)
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    const code = await screen.findByLabelText('Verification code')
    expect(screen.getByRole('dialog', { name: 'Confirm with your authenticator app' })).toBeTruthy()
    await user.type(code, '111111')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('The code is not valid. Enter the current code from your app.')).toBeTruthy()
    await user.clear(code)
    await user.type(code, '222222')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Grant approved.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/v1/role-grant-requests/r1/decision',
      '/v1/auth/sessions/current/step-up',
      '/v1/auth/sessions/current/step-up',
      '/v1/role-grant-requests/r1/decision',
    ])
    expect(requestBody(fetchMock, 2)).toEqual({ code: '222222' })
    expect(requestHeaders(fetchMock, 3).get('Idempotency-Key')).toBe('action-1')
  })

  it('asks a portal user for the password on STEP_UP_REQUIRED (D-B5-04) and retries the action once', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/portal/more/payment-details')
    const fetchMock = fetchReturning(apiError(403, 'STEP_UP_REQUIRED'), ok({ step_up_at: '2026-11-19T10:00:00Z' }), ok({ id: 'r1' }))
    renderWithProviders(<Approve />, fetchMock)
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    expect(await screen.findByRole('dialog', { name: 'Confirm it is you' })).toBeTruthy()
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Grant approved.')).toBeTruthy()
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/v1/role-grant-requests/r1/decision', '/v1/auth/sessions/current/reauth', '/v1/role-grant-requests/r1/decision',
    ])
    expect(requestBody(fetchMock, 1)).toEqual({ password: 'correct horse battery' })
    window.history.replaceState(null, '', '/')
  })

  it('asks for the password on an auth page that returns to the portal (portal TOTP enrolment needs re-auth)', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/signin/enrol?next=%2Fportal%2Fmore')
    renderWithProviders(<Approve />, fetchReturning(apiError(403, 'STEP_UP_REQUIRED')))
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    expect(await screen.findByRole('dialog', { name: 'Confirm it is you' })).toBeTruthy()
    window.history.replaceState(null, '', '/')
  })

  it('BUG-110: a user without an authenticator app sets one up in the dialog, and the action goes ahead', async () => {
    const user = userEvent.setup()
    const enrolment = { secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/NMP:ann%40acme.example?secret=JBSWY3DPEHPK3PXP&issuer=NMP' }
    const fetchMock = fetchReturning(apiError(403, 'STEP_UP_REQUIRED'), ok(enrolment, 201), ok({ assurance: 'aal2' }), ok({ id: 'r1' }))
    renderWithProviders(<Approve />, fetchMock)
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    await user.click(await screen.findByRole('button', { name: 'Set one up now' }))
    expect(await screen.findByRole('dialog', { name: 'Set up your authenticator app' })).toBeTruthy()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    await user.type(screen.getByLabelText('Verification code'), '333333')
    await user.click(screen.getByRole('button', { name: 'Confirm code' }))
    expect(await screen.findByText('Grant approved.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/v1/role-grant-requests/r1/decision', '/v1/auth/mfa/totp', '/v1/auth/mfa/totp/confirm', '/v1/role-grant-requests/r1/decision',
    ])
    expect(requestBody(fetchMock, 2)).toEqual({ code: '333333' })
    expect(requestHeaders(fetchMock, 3).get('Idempotency-Key')).toBe('action-1')
  })

  it('BUG-110: an already enrolled user who asks to set one up is sent back to the code', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Approve />, fetchReturning(apiError(403, 'STEP_UP_REQUIRED'), apiError(409, 'MFA_ALREADY_ENROLLED')))
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    await user.click(await screen.findByRole('button', { name: 'Set one up now' }))
    expect(await screen.findByText('Your account already has an authenticator app. Enter the code it shows.')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Confirm with your authenticator app' })).toBeTruthy()
  })

  it('reports the refused action when the user cancels', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Approve />, fetchReturning(apiError(403, 'STEP_UP_REQUIRED')))
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('This action needs the code from your authenticator app. Nothing was changed.')).toBeTruthy()
  })
})
