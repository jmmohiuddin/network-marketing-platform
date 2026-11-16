'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { ApprovalBar } from '../../components/approval-bar'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { ApiError } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import type { Resource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { approverNames, noApproverText, withApprovers } from '../admin/settings/labels'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { tableError } from '../admin/resource'
import { NOTE, SectionTitle } from '../admin/ui'
import { summaryItems } from './structure-dialogs'
import type { Checklist, GoLiveRequest } from './types'

export const COMPLIANCE_OFFICER = 'Compliance officer'
const STATEMENT_MAX = 4000

type Decision = 'approve' | 'reject' | 'withdraw'

export interface DecisionDialogProps {
  readonly request: GoLiveRequest
  readonly decision: Decision
  readonly marketCode: string
  /** Mandatory pack rules at screening: approving needs a written risk acceptance naming them (FR-CPL-012). */
  readonly riskRules: readonly string[]
  readonly onClose: () => void
  readonly onDone: () => void
}

/** The rules RISK_ACCEPTANCE_REQUIRED names, as one sentence. */
function ruleTitles(error: ApiError): string {
  const rules = (error.details as { rules?: { title: string }[] } | null)?.rules ?? []
  return rules.map((rule) => rule.title).join(', ')
}

/**
 * Sign off (approve), reject (market.signoff, step-up through ApiProvider with the dialog's Idempotency-Key) or
 * withdraw (the requester) a go-live request. Approving with mandatory rules at screening needs a risk statement.
 */
export function DecisionDialog({ request, decision, marketCode, riskRules, onClose, onDone }: DecisionDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [statement, setStatement] = useState('')
  const [riskAsked, setRiskAsked] = useState(riskRules.length > 0)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const askRisk = decision === 'approve' && riskAsked
  function submit(idempotencyKey: string) {
    const found = {
      'go-live-reason': requiredError('the reason for your decision', reason),
      'go-live-statement': askRisk ? requiredError('your risk acceptance statement', statement) : null,
    }
    setErrors(found)
    const items = summaryItems(found)
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: { reason: 'go-live-reason', 'risk_acceptance.statement': 'go-live-statement' },
      send: async () => {
        try {
          if (decision === 'withdraw') {
            await api.post(`/v1/market-go-live-requests/${request.id}/withdraw`, { reason: reason.trim() })
          } else {
            const body = { decision, reason: reason.trim(), ...(askRisk ? { risk_acceptance: { statement: statement.trim() } } : {}) }
            await api.post(`/v1/market-go-live-requests/${request.id}/decision`, body, { idempotencyKey })
          }
        } catch (failure) {
          if (failure instanceof ApiError && failure.code === 'RISK_ACCEPTANCE_REQUIRED') {
            setRiskAsked(true)
            throw new ApiError(failure.status, failure.code, `Risk acceptance required: ${ruleTitles(failure)} still at screening. Write your risk acceptance statement to sign off.`, failure.details, failure.requestId)
          }
          throw withApprovers(failure, COMPLIANCE_OFFICER)
        }
        toast({ message: decision === 'approve' ? `${marketCode} is live.` : decision === 'reject' ? `Go-live of ${marketCode} rejected.` : 'Go-live request withdrawn.' })
        onDone()
      },
    }
  }
  const title = decision === 'approve' ? `Sign off go-live of ${marketCode}` : decision === 'reject' ? `Reject go-live of ${marketCode}` : 'Withdraw go-live request'
  return (
    <FormDialog title={title} size="lg" submitLabel={decision === 'approve' ? 'Sign off' : decision === 'reject' ? 'Reject' : 'Withdraw request'} submitVariant={decision === 'approve' ? 'primary' : 'destructive-solid'} onClose={onClose} onSubmit={submit}>
      {decision === 'approve' && <p>Signing off makes {marketCode} live: enrolments and orders for it are accepted from then on. You may be asked for a code from your authenticator app.</p>}
      {decision === 'reject' && <p>The request is closed and the market stays a draft. You may be asked for a code from your authenticator app.</p>}
      {askRisk && (
        <>
          <Banner tone="warning" title="Risk acceptance required">
            {riskRules.length === 0 ? 'Mandatory market-pack rules are still at screening status.' : `Mandatory market-pack rules still at screening status: ${riskRules.join('; ')}.`} Going live accepts that risk in writing; your statement is kept with the request.
          </Banner>
          <TextAreaField id="go-live-statement" label="Risk acceptance statement" maxLength={STATEMENT_MAX} value={statement} error={errors['go-live-statement']} onChange={setStatement} />
        </>
      )}
      <TextAreaField id="go-live-reason" label="Reason" value={reason} error={errors['go-live-reason']} onChange={setReason} />
    </FormDialog>
  )
}

export interface SignOffBarProps {
  readonly checklist: Checklist
  readonly request: GoLiveRequest
  readonly onDecide: (decision: Decision) => void
}

/** sc_17 two-person rule as the pinned approval bar: requester, who can sign off, and the decision actions. */
export function SignOffBar({ checklist, request, onDecide }: SignOffBarProps) {
  const { me, can, readOnly } = useSession()
  const eligible = checklist.eligible_signers.some((signer) => signer.user_id === me.user.id)
  const own = request.requested_by.id === me.user.id
  const signer = can('market.signoff') && !readOnly
  const blocked = signer && !eligible
    ? 'You prepared or contributed to this checklist, so another Compliance officer must sign off.'
    : undefined
  return (
    <ApprovalBar
      preparedBy={`Go-live requested by ${request.requested_by.display_name ?? 'another user'}`}
      preparedAt={formatDateTime(request.requested_at)}
      blockedReason={blocked}
      approvers={checklist.eligible_signers.length === 0 ? noApproverText(COMPLIANCE_OFFICER) : `Can sign off: ${approverNames(checklist.eligible_signers)}`}
      actions={readOnly ? undefined : (
        <>
          {own && can('market.manage') && <Button onClick={() => onDecide('withdraw')}>Withdraw request</Button>}
          {signer && eligible && <Button variant="destructive" onClick={() => onDecide('reject')}>Reject</Button>}
          {signer && eligible && <Button variant="primary" icon="verified_user" onClick={() => onDecide('approve')}>Sign off</Button>}
        </>
      )}
    />
  )
}

const STATE_LABELS = { pending: 'Waiting for sign-off', approved: 'Signed off', rejected: 'Rejected', withdrawn: 'Withdrawn' } as const

/** GET /v1/markets/:id/go-live-requests: every request, newest first. */
export function RequestHistory({ requests }: { readonly requests: Resource<readonly GoLiveRequest[]> }) {
  return (
    <section className="bg-surface-container-lowest rounded shadow-sm overflow-hidden" aria-labelledby="history-title">
      <div className="p-space-lg flex flex-col gap-0.5">
        <SectionTitle id="history-title" icon="history" title="Go-live requests" />
        <p className={NOTE}>Each request keeps a snapshot of the checklist it was made on.</p>
      </div>
      <DataTable
        bare
        density="compact"
        caption="Go-live requests"
        columns={[
          { key: 'requested', header: 'Requested', cell: (row) => <div className="flex flex-col"><span>{row.requested_by.display_name ?? 'Another user'}</span><span className="font-caption text-caption text-secondary">{formatDateTime(row.requested_at)}</span></div> },
          { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state === 'withdrawn' ? 'retired' : row.state} label={STATE_LABELS[row.state]} /> },
          { key: 'decided', header: 'Decided', cell: (row) => (row.decided_at === null ? '—' : <div className="flex flex-col"><span>{row.decided_by?.display_name ?? (row.state === 'withdrawn' ? 'The requester' : 'Another user')}</span><span className="font-caption text-caption text-secondary">{formatDateTime(row.decided_at)}</span></div>) },
          { key: 'reason', header: 'Reason', cell: (row) => row.decision_reason ?? '—' },
          { key: 'risk', header: 'Risk acceptance', cell: (row) => row.risk_acceptance?.statement ?? '—' },
        ]}
        rows={requests.data ?? []}
        rowKey={(row) => row.id}
        loading={requests.loading}
        error={tableError(requests)}
        empty={{ title: 'No go-live request yet' }}
      />
    </section>
  )
}
