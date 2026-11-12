'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { TextField } from '../../../components/form-field'
import { useToast } from '../../../components/toast'
import { emailError, requiredError } from '../../../lib/validation'
import { FormDialog } from '../form-dialog'

const EMAIL_ID = 'invite-email'
const NAME_ID = 'invite-name'
const NAME_MAX_LENGTH = 200

export interface InviteDialogProps {
  readonly onClose: () => void
  readonly onInvited: () => void
  /** POST endpoint: tenant staff (default) or vendor users (/v1/vendor-users, which asks for step-up). */
  readonly endpoint?: string
  readonly title?: string
  /** What happens after the invitation, for this kind of user. */
  readonly intro?: string
}

/** SC-28 Invite user: POST /v1/users. The one-time link is mailed to the invitee, never shown here. */
export function InviteDialog({
  onClose, onInvited, endpoint = '/v1/users', title = 'Invite user',
  intro = 'The person gets an email with a link to choose a password. They have no role until you assign one.',
}: InviteDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const check = (value: string) => requiredError('the email address', value) ?? emailError(value)
  function submit(idempotencyKey: string) {
    const found = check(email)
    setError(found)
    if (found !== null) return { items: [{ fieldId: EMAIL_ID, message: found }] }
    const body = { email: email.trim(), ...(name.trim() === '' ? {} : { display_name: name.trim() }) }
    return {
      items: [],
      fieldIds: { email: EMAIL_ID, display_name: NAME_ID },
      send: async () => {
        await api.post(endpoint, body, { idempotencyKey })
        toast({ message: `Invitation sent to ${body.email}. The link in it works once.` })
        onInvited()
      },
    }
  }
  return (
    <FormDialog title={title} submitLabel="Send invitation" onClose={onClose} onSubmit={submit}>
      <p>{intro}</p>
      <TextField
        id={EMAIL_ID}
        label="Email address"
        type="email"
        autoComplete="off"
        data-autofocus
        value={email}
        error={error}
        onChange={(event) => setEmail(event.target.value)}
        onBlur={() => email !== '' && setError(check(email))}
      />
      <TextField id={NAME_ID} label="Name" optional maxLength={NAME_MAX_LENGTH} value={name} onChange={(event) => setName(event.target.value)} />
    </FormDialog>
  )
}
