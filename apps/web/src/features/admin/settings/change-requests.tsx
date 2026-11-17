'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { RequestCard } from '../../../components/request-card'
import { LoadingState } from '../../../components/states'
import { StatusBadge } from '../../../components/status-badge'
import { useToast } from '../../../components/toast'
import { useSession } from '../../../lib/session'
import type { Resource } from '../../../lib/use-resource'
import { requiredError } from '../../../lib/validation'
import { FormDialog, TextAreaField } from '../form-dialog'
import { formatDateTime, shortId } from '../format'
import { LoadFailure } from '../page-states'
import { NOTE, SECTION_CARD, SectionTitle } from '../ui'
import { approvalOf, approverNames, FINANCE_APPROVAL, keyLabel, noApproverText, valueText, withApprovers, type Approval } from './labels'
import type { ChangeRequest } from './types'

const REASON_ID = 'change-request-reason'

type Action = { readonly kind: 'approve' | 'reject' | 'withdraw'; readonly request: ChangeRequest }

// A request whose key lost its approver is shown as a Finance one (the only approver role before B2).
const approverOf = (request: ChangeRequest): Approval => approvalOf(request.key) ?? FINANCE_APPROVAL

const TITLES = { approve: 'Approve', reject: 'Reject', withdraw: 'Withdraw' } as const

/**
 * Decides (settings.approve, step-up through ApiProvider: the retry reuses the dialog's Idempotency-Key) or withdraws
 * (the requester) one money change request. A separation-of-duties refusal names who can decide instead.
 */
function RequestDialog({ action, onClose, onDone }: { readonly action: Action; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { kind, request } = action
  const label = `${TITLES[kind]} ${keyLabel(request.key).toLowerCase()} change`
  function submit(idempotencyKey: string) {
    const missing = requiredError(`the reason ${kind === 'withdraw' ? 'for withdrawing' : 'for your decision'}`, reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: REASON_ID, message: missing }] }
    return {
      items: [],
      fieldIds: { reason: REASON_ID },
      send: async () => {
        try {
          if (kind === 'withdraw') {
            await api.post(`/v1/setting-change-requests/${request.id}/withdraw`, { reason: reason.trim() })
          } else {
            await api.post(`/v1/setting-change-requests/${request.id}/decision`, { decision: kind, reason: reason.trim() }, { idempotencyKey })
          }
        } catch (failure) {
          throw withApprovers(failure, approverOf(request).role)
        }
        toast({ message: kind === 'approve' ? `${keyLabel(request.key)} change approved.` : kind === 'reject' ? `${keyLabel(request.key)} change rejected.` : `${keyLabel(request.key)} change withdrawn.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={label} submitLabel={label} submitVariant={kind === 'approve' ? 'primary' : 'destructive-solid'} onClose={onClose} onSubmit={submit}>
      <p>
        {valueText(request.key, request.value)} from {formatDateTime(request.effective_from)}.
        {kind === 'approve' && ' Approving saves the new version. You may be asked for a code from your authenticator app.'}
        {kind === 'reject' && ' No version is saved. You may be asked for a code from your authenticator app.'}
      </p>
      <TextAreaField id={REASON_ID} label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

interface CardProps {
  readonly request: ChangeRequest
  /** Approve is the primary action only when it is the only request listed (one primary per view). */
  readonly single: boolean
  readonly onAction: (action: Action) => void
}

function ChangeRequestCard({ request, single, onAction }: CardProps) {
  const { me, can, readOnly } = useSession()
  const approval = approverOf(request)
  const own = request.requested_by.id === me.user.id
  const canDecide = !readOnly && can(approval.permission) && !own && !request.no_eligible_approver
  const actions = readOnly ? undefined : (
    <>
      {own && can('settings.manage') && <Button onClick={() => onAction({ kind: 'withdraw', request })}>Withdraw</Button>}
      {canDecide && <Button variant="destructive" onClick={() => onAction({ kind: 'reject', request })}>Reject</Button>}
      {canDecide && <Button variant={single ? 'primary' : 'secondary'} icon="verified_user" onClick={() => onAction({ kind: 'approve', request })}>Approve</Button>}
    </>
  )
  return (
    <li>
      <RequestCard
        reference={shortId(request.id)}
        title={keyLabel(request.key)}
        state={<StatusBadge state="pending" label={`Waiting for ${approval.short} approval`} />}
        fields={[
          { label: 'New value', value: valueText(request.key, request.value) },
          { label: 'Effective from', value: formatDateTime(request.effective_from), detail: `Based on version ${request.base_version}` },
          { label: 'Requested by', value: request.requested_by.display_name ?? 'Another user', detail: formatDateTime(request.requested_at) },
          {
            label: 'Can approve',
            value: request.no_eligible_approver ? noApproverText(approval.role) : approverNames(request.eligible_approvers),
          },
        ]}
        reason={request.reason}
        actions={actions}
      >
        {own && <p className={NOTE}>You requested this change, so a {approval.role} who did not request it must decide it.</p>}
      </RequestCard>
    </li>
  )
}

/** FR-TEN-003 changes waiting for their approver (second person, FR-IAM-004): money for Finance, visibility for the DPO. */
export function ChangeRequestsSection({ requests, onChanged }: { readonly requests: Resource<readonly ChangeRequest[]>; readonly onChanged: () => void }) {
  const [action, setAction] = useState<Action | null>(null)
  const list = requests.data ?? []
  return (
    <section className={SECTION_CARD} aria-labelledby="change-requests-title">
      <SectionTitle id="change-requests-title" icon="pending_actions" title="Changes waiting for approval" />
      <p className={NOTE}>Money policy changes take effect only after a Finance approver who did not request them approves; downline depth masking after the DPO approves.</p>
      {requests.loading && <LoadingState label="Loading changes waiting for approval" />}
      {requests.error !== null && <LoadFailure error={requests.error} onRetry={requests.reload} section />}
      {requests.data !== null && list.length === 0 && <p className={NOTE}>No change is waiting for approval.</p>}
      {list.length > 0 && (
        <ul aria-label="Changes waiting for approval" className="flex flex-col gap-space-md">
          {list.map((request) => <ChangeRequestCard key={request.id} request={request} single={list.length === 1} onAction={setAction} />)}
        </ul>
      )}
      {action !== null && (
        <RequestDialog
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null)
            onChanged()
          }}
        />
      )}
    </section>
  )
}
