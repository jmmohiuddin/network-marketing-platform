// @vitest-environment jsdom
import '../../test/dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TextField } from '../../components/form-field'
import { ApiError } from '../../lib/api'
import { FormDialog } from './form-dialog'

function Probe({ keys }: { readonly keys: string[] }) {
  const [name, setName] = useState('Acme')
  return (
    <FormDialog
      title="Create role"
      submitLabel="Create"
      onClose={() => undefined}
      onSubmit={(idempotencyKey) => ({
        items: [],
        send: async () => {
          keys.push(idempotencyKey)
          throw new ApiError(0, 'NETWORK_ERROR', 'The request did not reach the service.')
        },
      })}
    >
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
    </FormDialog>
  )
}

describe('FormDialog', () => {
  it('retries the same values with the same Idempotency-Key and edited values with a new one', async () => {
    const user = userEvent.setup()
    const keys: string[] = []
    render(<Probe keys={keys} />)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByText(/Cannot reach the service/)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await user.type(screen.getByLabelText('Name'), ' Ltd')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await vi.waitFor(() => expect(keys).toHaveLength(3))
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })
})
