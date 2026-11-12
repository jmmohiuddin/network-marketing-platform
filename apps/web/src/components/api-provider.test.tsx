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

describe('step-up through ApiProvider', () => {
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

  it('reports the refused action when the user cancels', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Approve />, fetchReturning(apiError(403, 'STEP_UP_REQUIRED')))
    await user.click(screen.getByRole('button', { name: 'Approve grant' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('This action needs the code from your authenticator app. Nothing was changed.')).toBeTruthy()
  })
})
