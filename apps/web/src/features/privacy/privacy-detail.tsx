'use client'

import { useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { PageHeader } from '../../components/page-header'
import { ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { BlockerLines } from '../cases/b5-effects'
import { EffectPreview } from '../cases/effect-preview'
import { ParticipantLink } from '../cases/refs'
import type { CaseRecord } from '../cases/types'
import { saveFile } from '../data/transfer'
import { RecordCard, Facts } from '../people/ui'
import { CHANNEL_LABELS, deadlineOf, FIELD_LABELS, METHOD_LABELS, referenceOf, STATE_BADGES, STATE_LABELS, TYPE_LABELS } from './format'
import { CorrectionsDialog, VerifyDialog } from './privacy-dialogs'
import { DeadlineText, useEscalateDays } from './privacy-list'
import { PRIVACY_REQUESTS_PATH, type PrivacyRequestDetail } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const NOTE = 'font-body-sm text-body-sm text-on-surface-variant'

const value = (text: string | null | undefined): ReactNode => (text === null || text === undefined || text === '' ? <span className="text-secondary">Not given</span> : text)

/** The deadline with the market it was set for (C-B5-4: "No deadline configured for DE"). */
function DeadlineFact({ request, market }: { readonly request: PrivacyRequestDetail; readonly market: Market | undefined }) {
  const escalateDays = useEscalateDays()
  const deadline = deadlineOf(request, Date.now(), escalateDays)
  return (
    <span className="flex flex-col">
      <DeadlineText deadline={deadline.text === 'No deadline configured' ? { ...deadline, text: `No deadline configured for ${market?.code ?? 'the member’s market'}` } : deadline} />
      {request.due_at !== null && <span className={MONO}>{formatDateTime(request.due_at)}</span>}
    </span>
  )
}

function Requester({ request }: { readonly request: PrivacyRequestDetail }) {
  const requester = request.requester
  return (
    <RecordCard id="requester-title" icon="person" title="Requester">
      {request.channel === 'portal' && <p className={NOTE}>Made in the portal by the signed-in member.</p>}
      {requester === null
        ? request.channel !== 'portal' && <p className={NOTE}>The requester’s details were cleared after the outcome was sent.</p>
        : (
          <Facts items={[
            ...(request.channel === 'portal' ? [] : [
              { label: 'Name', value: value(requester.full_name) },
              { label: 'Email address', value: <span className={MONO}>{value(requester.email)}</span> },
              { label: 'Member reference given', value: <span className={MONO}>{value(requester.participant_ref)}</span> },
            ]),
            ...(request.channel === 'staff' ? [{ label: 'Received via', value: value(requester.received_via) }] : []),
            { label: 'Details', value: value(requester.details) },
          ]} />
        )}
      {requester !== null && <p className="font-caption text-caption text-secondary">Reading these details is recorded in the audit log.</p>}
    </RecordCard>
  )
}

function Verification({ request, onVerify }: { readonly request: PrivacyRequestDetail; readonly onVerify?: () => void }) {
  return (
    <RecordCard id="verification-title" icon="fingerprint" title="Identity verification"
      action={onVerify === undefined ? undefined : <Button size="sm" variant="primary" icon="fingerprint" data-testid="primary-action" onClick={onVerify}>Verify identity</Button>}>
      {request.verified_at === null
        ? <p className={NOTE}>Not verified yet. The request cannot be submitted, and its deadline is not set, until the identity is verified.</p>
        : (
          <Facts items={[
            { label: 'Method', value: request.verification_method === null ? '—' : METHOD_LABELS[request.verification_method] },
            { label: 'Verified', value: <span className={MONO}>{formatDateTime(request.verified_at)}</span> },
            { label: 'Member', value: request.subject === null ? '—' : <ParticipantLink id={request.subject.id} /> },
            { label: 'Note', value: value(request.verification_note) },
          ]} />
        )}
    </RecordCard>
  )
}

function CorrectionsCard({ request, onEdit }: { readonly request: PrivacyRequestDetail; readonly onEdit?: () => void }) {
  const saved = request.corrections
  const rows = saved === null ? [] : [
    ...(saved.display_name === undefined ? [] : [{ label: FIELD_LABELS.display_name!, value: saved.display_name }]),
    ...(saved.contact?.email === undefined ? [] : [{ label: FIELD_LABELS['contact.email']!, value: <span className={MONO}>{saved.contact.email}</span> }]),
    ...(saved.contact?.phone === undefined ? [] : [{ label: FIELD_LABELS['contact.phone']!, value: <span className={MONO}>{saved.contact.phone}</span> }]),
  ]
  return (
    <RecordCard id="corrections-title" icon="edit_note" title="Corrected values"
      action={onEdit === undefined ? undefined : <Button size="sm" icon="edit" onClick={onEdit}>{saved === null ? 'Enter corrected values' : 'Change corrected values'}</Button>}>
      {rows.length === 0
        ? <p className={NOTE}>{request.outcome === null ? 'No corrected value saved yet. Save them before submitting the case.' : 'Applied or discarded with the decision.'}</p>
        : <Facts items={rows} />}
    </RecordCard>
  )
}

function ExportCard({ request }: { readonly request: PrivacyRequestDetail }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const file = request.export
  if (file === null) return null
  async function download() {
    setBusy(true)
    setProblem(null)
    try {
      const { data } = await api.get<Blob>(`${PRIVACY_REQUESTS_PATH}/${request.id}/export`, { responseType: 'blob', headers: { Accept: 'application/json' } })
      saveFile(data, `privacy-export-${request.id}.json`)
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <RecordCard id="export-title" icon="download" title="Export"
      action={<Button size="sm" icon="download" loading={busy} onClick={download}>Download export</Button>}>
      <Facts items={[
        { label: 'Created', value: <span className={MONO}>{formatDateTime(file.created_at)}</span> },
        { label: 'Stored size', value: <span className={MONO}>{file.bytes.toLocaleString()} bytes (compressed)</span> },
        { label: 'SHA-256 of the stored file', value: <span className={`${MONO} break-all`}>{file.sha256}</span> },
      ]} />
      <p className="font-caption text-caption text-secondary">Each download is recorded in the audit log.</p>
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
    </RecordCard>
  )
}

/** Erasure before submit: what defers it now; the cleared and retained lists come with the case's preview at submit. */
function ErasureNow({ request, markets }: { readonly request: PrivacyRequestDetail; readonly markets: readonly Market[] | undefined }) {
  return (
    <RecordCard id="erasure-title" icon="enhanced_encryption" title="Erasure">
      {request.blockers === null
        ? <p className={NOTE}>Blockers are checked once the member is known (verification).</p>
        : <BlockerLines blockers={request.blockers} markets={markets} />}
      <p className={NOTE}>What is cleared and what is kept is listed in the case’s effect preview when the case is submitted.</p>
    </RecordCard>
  )
}

function caseLinkLabel(state: string): string {
  if (state === 'open') return 'Open the case to submit'
  if (state === 'submitted') return 'Open the case to decide'
  return 'Open the case'
}

/** SC-15 detail (GET /v1/privacy-requests/:id): requester, verification, corrections, erasure preview, export, and the case. */
export function PrivacyRequestPage({ requestId }: { readonly requestId: string }) {
  const { can } = useSession()
  const readable = can('privacy.manage') && isUuid(requestId)
  const detail = useResource<PrivacyRequestDetail>(readable ? `${PRIVACY_REQUESTS_PATH}/${requestId}` : null)
  if (!readable) return <NotAvailable />
  if (detail.error !== null) return <LoadFailure error={detail.error} onRetry={detail.reload} />
  if (detail.data === null) return <LoadingState label="Loading the privacy request" />
  return <RequestView request={detail.data} reload={detail.reload} />
}

function RequestView({ request, reload }: { readonly request: PrivacyRequestDetail; readonly reload: () => void }) {
  const { supportReadOnly } = useSession()
  const caseRecord = useResource<CaseRecord>(`/v1/cases/${request.case_id}`)
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [dialog, setDialog] = useState<'verify' | 'corrections' | null>(null)
  const market = markets.data?.find((candidate) => candidate.id === request.market_id)
  const open = request.case_state === 'open'
  const done = () => {
    setDialog(null)
    reload()
    caseRecord.reload()
  }
  return (
    <>
      <PageHeader
        title={`${TYPE_LABELS[request.type]} request ${referenceOf(request.id)}`}
        breadcrumbs={[{ label: 'Privacy requests', href: '/privacy' }, { label: referenceOf(request.id) }]}
        state={<StatusBadge state={STATE_BADGES[request.state]} label={STATE_LABELS[request.state]} />}
        summary={`${CHANNEL_LABELS[request.channel]} · received ${formatDateTime(request.received_at)}`}
        actions={<LinkButton icon="gavel" href={`/cases/${request.case_id}`}>{caseLinkLabel(request.case_state)}</LinkButton>}
      />
      {request.escalated_at !== null && request.outcome === null && (
        <Banner tone="warning" title="Escalated">Escalated on {formatDateTime(request.escalated_at)}: the deadline is close or has passed.</Banner>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
        <div className="lg:col-span-7 flex flex-col gap-space-md min-w-0">
          <RecordCard id="request-title" icon="assignment" title="Request" testId="card">
            <Facts items={[
              { label: 'Type', value: TYPE_LABELS[request.type] },
              { label: 'Channel', value: CHANNEL_LABELS[request.channel] },
              { label: 'Received', value: <span className={MONO}>{formatDateTime(request.received_at)}</span> },
              { label: 'Deadline', value: <DeadlineFact request={request} market={market} /> },
              { label: 'Retention basis', value: value(request.retention_basis) },
              { label: 'Outcome', value: request.outcome === null ? 'Not decided' : `${STATE_LABELS[request.outcome]} on ${formatDateTime(request.closed_at)}` },
            ]} />
          </RecordCard>
          <Requester request={request} />
          {request.type === 'correction' && <CorrectionsCard request={request} onEdit={open && !supportReadOnly ? () => setDialog('corrections') : undefined} />}
        </div>
        <div className="lg:col-span-5 flex flex-col gap-space-md min-w-0">
          <Verification request={request} onVerify={request.verified_at === null && open && !supportReadOnly ? () => setDialog('verify') : undefined} />
          {/* Erasure: the pre-submit blockers only once the case is read without a preview, so the two statements never alternate. */}
          {caseRecord.error !== null && <ErrorState section message={errorMessage(caseRecord.error)} onRetry={caseRecord.reload} />}
          {caseRecord.loading && request.type === 'erasure' && <LoadingState label="Loading the erasure preview" />}
          {caseRecord.data !== null && (caseRecord.data.effect_preview === null
            ? request.type === 'erasure' && <ErasureNow request={request} markets={markets.data ?? undefined} />
            : <EffectPreview record={caseRecord.data} />)}
          <ExportCard request={request} />
        </div>
      </div>
      {dialog === 'verify' && <VerifyDialog request={request} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'corrections' && <CorrectionsDialog request={request} onClose={() => setDialog(null)} onDone={done} />}
    </>
  )
}
