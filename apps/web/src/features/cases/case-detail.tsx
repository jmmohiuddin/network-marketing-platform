'use client'

import { useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { ApprovalBar } from '../../components/approval-bar'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { Modal } from '../../components/modal'
import { ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { approverNames, noApproverText } from '../admin/settings/labels'
import { formatMegabytes } from '../../components/file-drop-zone'
import { AdjustmentDialog, adjustmentRefusal } from './adjustment-dialog'
import { privacyFacts, type DisputePayload, type DisputePreview } from './b5-effects'
import { AddEvidence, AssignDialog, decisionLabelsOf, PrivacySubmitDialog, ReasonDialog, ReturnedSubmitDialog, type CaseDialog } from './case-actions'
import { GRIEVANCE_EVENTS, GRIEVANCE_STATE, GrievanceDeadlinesCard, grievanceFacts, type GrievancePayload } from './grievance'
import { RestatementDialog } from './restatement-dialog'
import { PRIVACY_REQUESTS_PATH, type PrivacyPayload, type PrivacyRequestDetail } from '../privacy/types'
import { EffectPreview } from './effect-preview'
import { MONEY_CASE_TYPES, payeeLink, useCaseMarket } from './money-effects'
import {
  actorName, caseTypeInfo, contributorsOf, DOCUMENT_KIND_LABELS, EVENT_LABELS, inSentence, instantText, isLive, KIND_LABELS, openerText, OUTCOME_LABELS, personName, reasonLabel,
  SIGNAL_LABELS, STATE_BADGES, STATE_LABELS, type CaseTypeInfo,
} from './format'
import { DocumentLink } from '../markets/gate-inspector'
import { ParticipantLink, PeriodLink, PositionLink, SubjectLink } from './refs'
import { marketMoney, periodText, signedMoney } from '../periods/format'
import type { CaseDetail, CaseEvent, DuplicatePayload, RelationshipPayload, TransferPayload, WriteOffPreview } from './types'

const CARD = 'bg-surface-container-lowest rounded shadow-sm p-space-md flex flex-col gap-space-sm'
const LABEL = 'font-caption text-caption uppercase text-secondary font-semibold'

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className={LABEL}>{label}</dt>
      <dd className="font-body-sm text-body-sm text-on-surface break-words">{children}</dd>
    </div>
  )
}

/** The proposal of a B4 money case (PLAN B4 §2.1–2.3 payloads); amounts in the case market's currency. */
function MoneyPayloadFacts({ record }: { readonly record: CaseDetail }) {
  const market = useCaseMarket(record)
  const payload = record.payload as { readonly period_id?: string; readonly amount_minor?: string; readonly note?: string; readonly request_id?: string; readonly instruction_id?: string }
  return (
    <>
      {payload.period_id !== undefined && <Fact label="Period"><PeriodLink id={payload.period_id} /></Fact>}
      {payload.amount_minor !== undefined && <Fact label="Amount"><span className="font-data-mono-sm text-data-mono-sm font-semibold">{(record.type === 'adjustment' ? signedMoney : marketMoney)(payload.amount_minor, market)}</span></Fact>}
      {payload.request_id !== undefined && <Fact label="Bank-detail request">{shortId(payload.request_id)} (masked values in the effect preview)</Fact>}
      {payload.instruction_id !== undefined && <Fact label="Payout instruction">{shortId(payload.instruction_id)}</Fact>}
      {record.type !== 'bank_detail' && <Fact label="Note">{payload.note ?? 'None yet'}</Fact>}
    </>
  )
}

/** The proposal of the case, per type (PLAN B2 2.4 payloads). */
function PayloadFacts({ record }: { readonly record: CaseDetail }) {
  if (record.type === 'transfer') {
    const payload = record.payload as TransferPayload
    return (
      <>
        <Fact label="New owner"><ParticipantLink id={payload.to_participant_id} /></Fact>
        <Fact label="Effective from">{instantText(payload.effective_from, formatDateTime)}</Fact>
        {payload.legal_basis !== undefined && (
          <Fact label="Legal basis">{DOCUMENT_KIND_LABELS[payload.legal_basis.document_kind] ?? payload.legal_basis.document_kind} · <span className="font-data-mono-sm text-data-mono-sm">{payload.legal_basis.reference}</span></Fact>
        )}
      </>
    )
  }
  if (record.type === 'restatement') {
    return <Fact label="Note">{(record.payload as { readonly note: string }).note}</Fact>
  }
  if (MONEY_CASE_TYPES.includes(record.type)) return <MoneyPayloadFacts record={record} />
  if (record.type === 'dispute') {
    // The line's stored trace is attached to the case; the page links to it, never dumps it (PLAN B5 §5 SC-06).
    return <Fact label="Distributor’s message">{(record.payload as DisputePayload).message}</Fact>
  }
  if (record.type === 'privacy') return <>{privacyFacts(record).map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}</>
  if (record.type === 'grievance') return <>{grievanceFacts(record.payload as GrievancePayload).map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}</>
  if (record.type === 'duplicate') {
    const payload = record.payload as DuplicatePayload
    return (
      <>
        <Fact label="Matched participant"><ParticipantLink id={payload.matched_participant_id} /></Fact>
        <Fact label="Matching signals">{payload.matched_kinds.length === 0 ? '—' : payload.matched_kinds.map((kind) => SIGNAL_LABELS[kind] ?? kind).join(', ')}</Fact>
        <Fact label="Proposed outcome">{payload.proposed_outcome === undefined ? 'Not chosen yet' : OUTCOME_LABELS[payload.proposed_outcome]}</Fact>
      </>
    )
  }
  const payload = record.payload as RelationshipPayload
  const from = payload.effective_from ?? payload.valid_from
  return (
    <>
      <Fact label="Tree">{KIND_LABELS[payload.kind]}</Fact>
      <Fact label="Proposed parent"><PositionLink id={payload.proposed_parent_position_id} withOwner={isLive(record)} /></Fact>
      {payload.leg !== undefined && <Fact label="Leg">{payload.leg}</Fact>}
      {from !== undefined && <Fact label={payload.valid_from === undefined ? 'Effective from' : 'Correct from'}>{instantText(from, formatDateTime)}</Fact>}
    </>
  )
}

function eventDetail(event: CaseEvent, myId: string): string | null {
  const data = event.data ?? {}
  if (typeof data.reason === 'string') return data.reason
  if (typeof data.note === 'string') return data.note
  if (event.kind === 'assigned') return data.user_id === null ? 'Unassigned' : `Assigned to ${inSentence(personName(String(data.user_id), myId))}`
  if (event.kind === 'updated' && Array.isArray(data.fields)) return `Changed: ${data.fields.map((field) => String(field).replace('_', ' ')).join(', ')}`
  return null
}

function Timeline({ record, myId }: { readonly record: CaseDetail; readonly myId: string }) {
  return (
    <section className={CARD} aria-labelledby="timeline-title">
      <h2 id="timeline-title" className={LABEL}>History</h2>
      <ol className="flex flex-col divide-y divide-surface-container">
        {record.events.map((event) => {
          const detail = eventDetail(event, myId)
          return (
            <li key={event.id} className="py-2 flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-space-sm">
                <span className="font-body-sm text-body-sm font-semibold text-on-surface">{(record.type === 'grievance' ? GRIEVANCE_EVENTS[event.kind] : undefined) ?? EVENT_LABELS[event.kind]}</span>
                <span className="font-data-mono-sm text-data-mono-sm text-secondary">{formatDateTime(event.occurred_at)}</span>
              </div>
              <span className="font-caption text-caption text-secondary">{actorName(record, event.actor_id, myId, record.eligible_approvers)}</span>
              {detail !== null && <p className="font-body-sm text-body-sm text-on-surface-variant break-words">{detail}</p>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Evidence({ record, canAdd, onAdded, myId }: { readonly record: CaseDetail; readonly canAdd: boolean; readonly onAdded: () => void; readonly myId: string }) {
  return (
    <section className={CARD} aria-labelledby="evidence-title">
      <h2 id="evidence-title" className={LABEL}>Evidence ({record.evidence.length})</h2>
      {record.evidence.length === 0 ? <p className="font-body-sm text-body-sm text-secondary">No evidence attached.</p> : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-space-xs">
          {record.evidence.map((item) => (
            <li key={item.id} className="p-2 rounded bg-surface border border-outline-variant flex items-start gap-2 min-w-0">
              <Icon name="description" size={18} className="text-primary shrink-0" />
              <div className="flex flex-col min-w-0">
                <DocumentLink className="text-primary font-semibold hover:underline break-all" document={{ id: item.document_id, file_name: item.file_name }} fallback="Evidence document" />
                <span className="font-data-mono-sm text-[10px] text-secondary">{formatMegabytes(item.size_bytes)} · {personName(item.added_by, myId)} · {formatDateTime(item.added_at)}</span>
                {item.note !== null && <span className="font-caption text-caption text-on-surface-variant break-words">{item.note}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canAdd && <AddEvidence caseId={record.id} onAdded={onAdded} />}
    </section>
  )
}

/** D-B4-10: "Approval 1 of 2 by Fay Finance on … — awaiting a second approver", or that none is given yet. */
export function approvalProgress(record: CaseDetail, myId: string): string {
  const first = record.first_approval
  if (first === null || first === undefined) return 'Needs two approvals by different people: approval 1 of 2 is not given yet.'
  const by = first.approver.id === myId ? 'you' : first.approver.display_name ?? 'another user'
  return `Approval 1 of 2 by ${by} on ${formatDateTime(first.decided_at)} — awaiting a second approver.`
}

/** sc_06 separation-of-duties panel: who prepared it, who may decide it. */
function Duties({ record, info, myId, involved }: { readonly record: CaseDetail; readonly info: CaseTypeInfo; readonly myId: string; readonly involved: boolean }) {
  const approvers = record.eligible_approvers
  return (
    <section className={CARD} aria-labelledby="duties-title">
      <h2 id="duties-title" className={LABEL}>Separation of duties</h2>
      <p className="font-body-sm text-body-sm text-on-surface">
        Opened by {openerText(record, myId)} · {formatDateTime(record.created_at)}
        {record.submitted_by !== null && <> · submitted by {inSentence(actorName(record, record.submitted_by, myId, approvers))} · {formatDateTime(record.submitted_at)}</>}
      </p>
      {approvers !== null && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {approvers.length === 0 ? noApproverText(info.deciderRole) : `Can decide: ${approverNames(approvers)}`}
        </p>
      )}
      {record.state === 'submitted' && record.approvals_required === 2 && (
        <p className="font-body-sm text-body-sm text-on-surface" data-testid="approval-progress">{approvalProgress(record, myId)}</p>
      )}
      {involved && <p className="font-caption text-caption text-error">You prepared or contributed to this case, so someone else must decide it.</p>}
    </section>
  )
}

/** The privacy case's submit dialog, once the request's type (which decides whether a retention basis is needed) is read. */
function PrivacyRequestSubmit(props: { readonly record: CaseDetail; readonly info: CaseTypeInfo; readonly onClose: () => void; readonly onDone: () => void }) {
  const request = useResource<PrivacyRequestDetail>(`${PRIVACY_REQUESTS_PATH}/${(props.record.payload as PrivacyPayload).request_id}`)
  if (request.data !== null) return <PrivacySubmitDialog {...props} requestType={request.data.type} />
  // Loading and a failed read stay inside the dialog, so Close always returns to the case and Try again reads it again.
  return (
    <Modal open onClose={props.onClose} title="Submit the privacy request">
      {request.error === null
        ? <LoadingState label="Loading the privacy request" />
        : <ErrorState section message={errorMessage(request.error)} onRetry={request.reload} />}
    </Modal>
  )
}

/** SC-06 case detail (GET /v1/cases/:id): subject, proposal, evidence, effect preview, history and the decision bar. */
export function CaseDetailPage({ caseId }: { readonly caseId: string }) {
  const detail = useResource<CaseDetail>(`/v1/cases/${caseId}`)
  if (detail.error !== null) return <LoadFailure error={detail.error} onRetry={detail.reload} />
  if (detail.data === null) return <LoadingState label="Loading the case" />
  const info = caseTypeInfo(detail.data.type)
  if (info === undefined) return <NotAvailable />
  return <CaseView record={detail.data} info={info} reload={detail.reload} />
}

function CaseView({ record, info, reload }: { readonly record: CaseDetail; readonly info: CaseTypeInfo; readonly reload: () => void }) {
  const api = useApi()
  const toast = useToast()
  const { me, can, readOnly, supportReadOnly } = useSession()
  const [dialog, setDialog] = useState<CaseDialog | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [follow, setFollow] = useState<'adjustment' | 'restatement' | null>(null)
  const myId = me.user.id
  const preparing = record.state === 'open'
  const live = isLive(record)
  // A read-only tenant still answers data-subject requests through the privacy case (C-V1A-18, the API's CASE_ACTION allowlist);
  // evidence stays hidden because its upload (POST /v1/documents) is refused.
  const writable = record.type === 'privacy' ? !supportReadOnly : !readOnly
  const canCreate = writable && can(info.create)
  const canDecide = writable && can(info.decide)
  const firstApprover = record.first_approval?.approver.id === myId
  const involved = contributorsOf(record).has(myId) || firstApprover
  async function submit() {
    setSubmitting(true)
    setProblem(null)
    try {
      await api.post(`/v1/cases/${record.id}/submit`, {})
      toast({ message: record.type === 'grievance' ? 'Grievance acknowledged. It is now due by its resolution deadline.' : 'Case submitted. A second person decides it.' })
      reload()
    } catch (error) {
      setProblem(errorMessage(adjustmentRefusal(error)))
      setSubmitting(false)
    }
  }
  const done = () => {
    setDialog(null)
    reload()
  }
  // D-B5-15: "Start review" is assigning the dispute to yourself; the distributor then sees it under review.
  async function startReview() {
    setProblem(null)
    try {
      await api.post(`/v1/cases/${record.id}/assign`, { user_id: myId })
      toast({ message: 'Review started. The distributor sees the dispute as under review.' })
      reload()
    } catch (error) {
      setProblem(errorMessage(error))
    }
  }
  const dispute = record.type === 'dispute'
  // A dispute's subject is a result line: named by its position and period (BUG-117), not its id.
  const disputed = dispute ? record.effect_preview as DisputePreview | null : null
  const upheld = record.state === 'approved' ? disputed : null
  const decisionLabels = decisionLabelsOf(record.type)
  const grievance = record.type === 'grievance'
  // D-BM-13: a grievance whose complainant is not on record takes no evidence.
  const takesEvidence = !(grievance && record.subject_type === 'market')
  const overdue = record.state === 'submitted' && record.due_at !== null && Date.parse(record.due_at) < Date.now()
  const submitDialog = record.type === 'returned_payment' || record.type === 'privacy'
  // A write-off's subject is a ledger account: name whose receivable it is from the preview (BUG-103).
  const market = useCaseMarket(record)
  const receivableOf = record.type === 'write_off' ? (record.effect_preview as WriteOffPreview | null)?.payee : undefined
  const actions = (
    <>
      {upheld !== null && !readOnly && can('case.adjustment.create') && market !== undefined && <Button icon="exposure" onClick={() => setFollow('adjustment')}>Propose adjustment</Button>}
      {upheld !== null && !readOnly && can('restatement.request') && <Button icon="history_edu" onClick={() => setFollow('restatement')}>Request restatement</Button>}
      {live && canDecide && dispute && record.assigned_to === null
        ? <Button variant="primary" icon="rate_review" data-testid="primary-action" onClick={startReview}>Start review</Button>
        : live && canDecide && <Button icon="person_add" onClick={() => setDialog('assign')}>Assign</Button>}
      {live && canCreate && record.opened_by === myId && <Button variant="destructive" onClick={() => setDialog('withdraw')}>Withdraw</Button>}
      {preparing && canCreate && <Button variant="primary" icon="send" loading={submitting} data-testid="primary-action" onClick={submitDialog ? () => setDialog('submit') : submit}>{grievance ? 'Acknowledge' : 'Submit for decision'}</Button>}
    </>
  )
  return (
    <div className={`flex flex-col gap-space-md${record.state === 'submitted' ? ' pb-24' : ''}`}>
      <PageHeader
        title={`${info.label} ${shortId(record.id)}`}
        breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: info.label }]}
        state={<StatusBadge state={STATE_BADGES[record.state]} label={(grievance ? GRIEVANCE_STATE : STATE_LABELS)[record.state]} />}
        summary={`${reasonLabel(record.reason_code)} · opened ${formatDateTime(record.created_at)} by ${openerText(record, myId)}${record.due_at === null ? '' : ` · due ${formatDateTime(record.due_at)}`}`}
        actions={actions}
      />
      {problem !== null && <Banner tone="danger" title="The action did not go through">{problem}</Banner>}
      {overdue && <Banner tone="warning" title="Overdue">The response date {formatDateTime(record.due_at)} has passed; the case is still waiting for a decision.</Banner>}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
        <div className="lg:col-span-7 flex flex-col gap-space-md min-w-0">
          <section className={`${CARD} border-l-4 border-l-primary`} aria-labelledby="proposal-title" data-testid="card">
            <h2 id="proposal-title" className={LABEL}>{grievance ? 'Complainant and complaint' : 'Subject and proposal'}</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
              <Fact label={`Subject (${disputed === null ? record.subject_type.replace(/_/g, ' ') : 'commission line'})`}>
                {receivableOf !== undefined ? <>Clawback receivable of {payeeLink(receivableOf)}</>
                  : disputed !== null ? <>Line of <PositionLink id={disputed.position.id} withOwner={false} /> in <PeriodLink id={disputed.period.id} /></>
                    : <SubjectLink subjectType={record.subject_type} id={record.subject_id} withOwner={live} />}
              </Fact>
              <Fact label="Reason">{reasonLabel(record.reason_code)}</Fact>
              <PayloadFacts record={record} />
              <Fact label="Assigned to">{record.assigned_to === null ? 'Nobody' : personName(record.assigned_to, myId, record.eligible_approvers)}</Fact>
            </dl>
            {record.type === 'duplicate' && <LinkButton className="self-start" icon="compare" href={`/cases/duplicates?case=${record.id}`}>Compare side by side</LinkButton>}
          </section>
          <Evidence record={record} canAdd={preparing && canCreate && !readOnly && takesEvidence} onAdded={reload} myId={myId} />
          <Timeline record={record} myId={myId} />
        </div>
        <div className="lg:col-span-5 flex flex-col gap-space-md min-w-0">
          {grievance ? <GrievanceDeadlinesCard caseId={record.id} /> : <EffectPreview record={record} />}
          <Duties record={record} info={info} myId={myId} involved={!firstApprover && involved && canDecide} />
        </div>
      </div>
      {record.state === 'submitted' && (
        <ApprovalBar
          preparedBy={`Prepared by ${inSentence(actorName(record, record.opened_by ?? record.submitted_by, myId, record.eligible_approvers))}`}
          preparedAt={formatDateTime(record.submitted_at)}
          blockedReason={canDecide && involved ? (firstApprover ? 'You gave the first approval, so a second approver must decide it.' : 'You prepared or contributed to this case, so someone else must decide it.') : undefined}
          approvers={record.eligible_approvers === null ? undefined : record.eligible_approvers.length === 0 ? noApproverText(info.deciderRole) : `Can decide: ${approverNames(record.eligible_approvers)}`}
          actions={canDecide && !involved ? (
            <>
              <Button variant="destructive" onClick={() => setDialog('reject')}>{decisionLabels.reject}</Button>
              <Button variant="primary" icon="verified_user" onClick={() => setDialog('approve')}>{decisionLabels.approve}</Button>
            </>
          ) : undefined}
        />
      )}
      {dialog === 'submit' && record.type === 'privacy' && <PrivacyRequestSubmit record={record} info={info} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'submit' && record.type === 'returned_payment' && <ReturnedSubmitDialog record={record} info={info} onClose={() => setDialog(null)} onDone={done} />}
      {follow === 'adjustment' && upheld !== null && market !== undefined && (
        <AdjustmentDialog onClose={() => setFollow(null)} dispute={{
          disputeCaseId: record.id,
          position: { position_id: upheld.position.id, position_ref: upheld.position.position_ref, owner: null, status: null, market_code: market.code, leg: null },
        }} />
      )}
      {follow === 'restatement' && upheld !== null && <RestatementDialog period={{ id: upheld.period.id, label: periodText(upheld.period, undefined) }} onClose={() => setFollow(null)} />}
      {dialog === 'assign' && <AssignDialog record={record} info={info} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog === 'approve' || dialog === 'reject' || dialog === 'withdraw') && (
        <ReasonDialog record={record} info={info} action={dialog} onClose={() => setDialog(null)} onDone={done} />
      )}
    </div>
  )
}
