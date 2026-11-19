'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { ApiError, isApiError, newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'
import { MONO } from '../admin/ui'
import { PARTICIPANTS_PATH } from './types'
import { Facts, RecordCard } from './ui'

/** GET /v1/participants/:id/portal-account (D-B5-05). */
export interface PortalAccount {
  readonly state: 'none' | 'invited' | 'active' | 'deactivated'
  readonly email_masked: string | null
  readonly invited_at: string | null
  readonly last_sign_in_at: string | null
  readonly mfa_enrolled: boolean
}

const STATE_LABELS: Readonly<Record<PortalAccount['state'], string>> = {
  none: 'No portal account', invited: 'Invited', active: 'Active', deactivated: 'Deactivated',
}
const STATE_BADGES: Readonly<Record<PortalAccount['state'], string>> = { none: 'draft', invited: 'pending', active: 'active', deactivated: 'retired' }

/** 422 PORTAL_NOT_ELIGIBLE reasons (iam/portal-accounts.ts assertEligible). */
const NOT_ELIGIBLE: Readonly<Record<string, string>> = {
  pseudonymised: 'their personal data was erased',
  inactive: 'they are not active (merged into another participant)',
  not_can_earn: 'their type is not an earning type',
  no_contact_email: 'no contact email address is recorded',
}

/** PORTAL_NOT_ELIGIBLE in words; other errors unchanged (PORTAL_EMAIL_IN_USE keeps the API's sentence). */
export function portalRefusal(error: unknown): unknown {
  if (!isApiError(error, 'PORTAL_NOT_ELIGIBLE')) return error
  const reason = (error.details as { reason?: string } | null)?.reason ?? ''
  const why = NOT_ELIGIBLE[reason]
  return why === undefined ? error : new ApiError(error.status, error.code, `This member cannot have a portal account: ${why}.`, error.details, error.requestId)
}

const DEACTIVATE_REASON = 'portal-deactivate-reason'

const sending = (account: PortalAccount): boolean => account.state === 'invited' && account.invited_at === null

function DeactivateDialog({ path, onClose, onDone }: { readonly path: string; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: DEACTIVATE_REASON, message: missing }] }
    return {
      items: [],
      fieldIds: { reason: DEACTIVATE_REASON },
      send: async () => {
        await api.post(`${path}/deactivate`, { reason: reason.trim() })
        toast({ message: 'Portal account deactivated. Its sessions have ended.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Deactivate the portal account" submitLabel="Deactivate account" submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>The member is signed out at once and can no longer sign in. A deactivated account is never reopened: invite the member again for a new one.</p>
      <TextAreaField id={DEACTIVATE_REASON} label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

/**
 * SC-09 "Portal access" (PLAN B5 §5, D-B5-05): the member's portal account (state, masked email, last sign-in) and,
 * for participant.manage holders, Invite / Re-send invitation / Deactivate.
 */
export function PortalAccess({ participantId, erased }: { readonly participantId: string; readonly erased: boolean }) {
  const api = useApi()
  const toast = useToast()
  const { can, readOnly } = useSession()
  const path = `${PARTICIPANTS_PATH}/${participantId}/portal-account`
  // The invitation is written by the mail job after the 201: ask again until it shows (BUG-113).
  const account = useResource<PortalAccount>(path, undefined, sending)
  // One key per invitation attempt: a lost answer is retried with it; a later invitation (after a deactivation) gets a new one.
  const [inviteKey, setInviteKey] = useState(newIdempotencyKey)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const manage = can('participant.manage') && !readOnly

  async function act(send: () => Promise<unknown>, message: string) {
    setBusy(true)
    setProblem(null)
    try {
      await send()
      toast({ message })
      setInviteKey(newIdempotencyKey())
      account.reload()
    } catch (error) {
      setProblem(errorMessage(portalRefusal(error)))
    } finally {
      setBusy(false)
    }
  }

  const data = account.data
  const state = data?.state
  const actions = !manage || data === null ? undefined : (
    <div className="flex flex-wrap gap-space-xs">
      {(state === 'none' || state === 'deactivated') && !erased && (
        <Button size="sm" icon="forward_to_inbox" loading={busy}
          onClick={() => act(() => api.post(path, undefined, { idempotencyKey: inviteKey }), 'Invitation sent to the member’s contact email.')}>
          {state === 'none' ? 'Invite to the portal' : 'Invite again'}
        </Button>
      )}
      {state === 'invited' && (
        <Button size="sm" icon="send" loading={busy} onClick={() => act(() => api.post(`${path}/invitation`), 'Invitation sent again.')}>Re-send invitation</Button>
      )}
      {(state === 'invited' || state === 'active') && (
        <Button size="sm" variant="destructive" icon="block" disabled={busy} onClick={() => setDeactivating(true)}>Deactivate</Button>
      )}
    </div>
  )
  return (
    <RecordCard id="portal-title" icon="login" title="Portal access" testId="portal-access" action={actions}>
      {account.error !== null && <LoadFailure error={account.error} onRetry={account.reload} section />}
      {account.error === null && data === null && <LoadingState label="Loading portal access" />}
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      {data !== null && (
        <Facts items={[
          { label: 'State', value: <StatusBadge state={STATE_BADGES[data.state]} label={STATE_LABELS[data.state]} /> },
          { label: 'Sign-in email', value: <span className={MONO}>{data.email_masked ?? '—'}</span> },
          { label: 'Invitation sent', value: <span className={MONO}>{data.invited_at !== null ? formatDateTime(data.invited_at) : sending(data) ? 'Being sent' : '—'}</span> },
          { label: 'Last sign-in', value: <span className={MONO}>{data.last_sign_in_at === null ? 'Never' : formatDateTime(data.last_sign_in_at)}</span> },
          { label: 'Authenticator app', value: data.mfa_enrolled ? 'Set up' : 'Not set up' },
        ]} />
      )}
      {data?.state === 'none' && <p className="font-caption text-caption text-secondary">The invitation goes to the member’s contact email; accepting it sets the portal password.</p>}
      {deactivating && <DeactivateDialog path={path} onClose={() => setDeactivating(false)} onDone={() => {
        setDeactivating(false)
        account.reload()
      }} />}
    </RecordCard>
  )
}
