'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Checkbox, TextField } from '../../../components/form-field'
import type { SummaryItem } from '../../../components/error-summary'
import { useToast } from '../../../components/toast'
import { durationLabel } from '../format'
import { FormDialog, TextAreaField } from '../form-dialog'
import type { SupportSession } from '../types'

const MINUTES_ID = 'support-decision-minutes'
const REGION_ID = 'support-decision-region'
const REASON_ID = 'support-decision-reason'
const WHOLE_NUMBER = /^\d+$/

/** The approved window in minutes: a whole number from 1 to what was requested. */
export function minutesError(value: string, requested: number): string | null {
  if (!WHOLE_NUMBER.test(value.trim())) return 'Enter the number of minutes as a whole number.'
  const minutes = Number(value.trim())
  if (minutes < 1) return 'Approve at least 1 minute.'
  return minutes > requested ? `Approve at most the ${requested} minutes requested (${durationLabel(requested)}).` : null
}

/** The requester works outside the tenant's data region (unknown counts as outside, E-ADR-24). */
export function outOfRegion(session: SupportSession, tenantRegion: string | null): boolean {
  return session.scope.requester_region === null || session.scope.requester_region !== tenantRegion
}

export interface SupportDecisionDialogProps {
  readonly session: SupportSession
  readonly approve: boolean
  readonly tenantRegion: string | null
  readonly onClose: () => void
  readonly onDecided: () => void
}

/**
 * SC-14 Approve / Deny (FR-IAM-005, API-08): POST /v1/support-sessions/:id/decision with a fresh second factor
 * (the API asks; ApiProvider prompts) and an Idempotency-Key. Approval sets the window (at most the request) and,
 * for a requester outside the data region, the explicit region approval (AC-31.1).
 */
export function SupportDecisionDialog({ session, approve, tenantRegion, onClose, onDecided }: SupportDecisionDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [minutes, setMinutes] = useState(String(session.requested_minutes))
  const [regionApproved, setRegionApproved] = useState(false)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ minutes?: string | null; region?: string | null }>({})
  const needsRegion = approve && outOfRegion(session, tenantRegion)

  function submit(idempotencyKey: string) {
    const found = {
      minutes: approve ? minutesError(minutes, session.requested_minutes) : null,
      region: needsRegion && !regionApproved ? 'Confirm access from outside your data region, or deny the request.' : null,
    }
    setErrors(found)
    const items: SummaryItem[] = [
      ...(found.minutes === null ? [] : [{ fieldId: MINUTES_ID, message: found.minutes }]),
      ...(found.region === null ? [] : [{ fieldId: REGION_ID, message: found.region }]),
    ]
    if (items.length > 0) return { items }
    const body = {
      approved: approve,
      minutes: approve ? Number(minutes.trim()) : null,
      region_approved: needsRegion && regionApproved,
      reason: reason.trim() === '' ? null : reason.trim(),
    }
    return {
      items,
      fieldIds: { minutes: MINUTES_ID, region_approved: REGION_ID, reason: REASON_ID },
      send: async () => {
        await api.post(`/v1/support-sessions/${session.id}/decision`, body, { idempotencyKey })
        toast({ message: approve ? `Access approved for ${durationLabel(body.minutes ?? 0)}. It ends automatically.` : 'The request was denied. Nothing can be accessed.' })
        onDecided()
      },
    }
  }

  return (
    <FormDialog
      title={approve ? 'Approve vendor access' : 'Deny vendor access'}
      submitLabel={approve ? 'Approve access' : 'Deny access'}
      submitVariant={approve ? 'primary' : 'destructive-solid'}
      onClose={onClose}
      onSubmit={submit}
    >
      <p>{approve ? 'Vendor staff can read, not change, what the request names until the window ends or you end it.' : 'Vendor staff get no access. They can send a new request.'}</p>
      {approve && (
        <TextField
          id={MINUTES_ID}
          label="Access window in minutes"
          inputMode="numeric"
          helper={`Requested: ${session.requested_minutes} minutes (${durationLabel(session.requested_minutes)}). You can approve this or less. The window starts now.`}
          data-autofocus
          value={minutes}
          error={errors.minutes}
          onChange={(event) => setMinutes(event.target.value)}
        />
      )}
      {needsRegion && (
        <>
          <Banner tone="warning" title="Outside your data region">
            The requester works {session.scope.requester_region === null ? 'in an unknown region' : `in ${session.scope.requester_region}`}; your data is held in {tenantRegion ?? 'your region'}.
          </Banner>
          <Checkbox
            id={REGION_ID}
            label="I approve access from outside our data region"
            checked={regionApproved}
            error={errors.region}
            onChange={(event) => setRegionApproved(event.target.checked)}
          />
        </>
      )}
      <TextAreaField id={REASON_ID} label="Note for the log" optional value={reason} onChange={setReason} />
      <p className="admin-note">You will be asked for a code from your authenticator app.</p>
    </FormDialog>
  )
}
