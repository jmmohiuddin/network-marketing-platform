'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { FileDropZone } from '../../components/file-drop-zone'
import { Select } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { ApiError, newIdempotencyKey } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadingState } from '../../components/states'
import { LoadFailure } from '../admin/page-states'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { withApprovers } from '../admin/settings/labels'
import { extensionsOf } from '../markets/format'
import { useEvidenceFile } from '../markets/evidence-forms'
import type { DocumentLimits } from '../markets/types'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { erasureRefusal } from '../privacy/format'
import type { PrivacyPayload } from '../privacy/types'
import { caseTypeLabel, personName, type CaseTypeInfo } from './format'
import type { CaseDetail, CaseRecord } from './types'

const NOTE_MAX = 2000
const REASON_FIELD = 'case-reason'

export type CaseDialog = 'approve' | 'reject' | 'withdraw' | 'assign' | 'submit'

interface DialogProps {
  readonly record: CaseDetail
  readonly info: CaseTypeInfo
  readonly onClose: () => void
  readonly onDone: () => void
}

/**
 * Decision refusals that leave the case submitted and can simply be tried again (D-B4-08/09): another posting or
 * commit holds the market's ledger or periods.
 */
export function decisionRefusal(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  const busy = error.code === 'LEDGER_BUSY' || (error.code === 'PERIOD_NOT_OPEN' && (error.details as { state?: string } | null)?.state === 'busy')
  if (!busy) return error
  return new ApiError(error.status, error.code, 'Another posting or commit is using this market right now, so nothing was decided. Decide the case again in a moment.', error.details, error.requestId)
}

/** A dispute's decision is upheld or not upheld, and its reason is the explanation the distributor reads (D-B5-15). */
export const DECISION_LABELS: Readonly<Record<'approve' | 'reject', string>> = { approve: 'Approve', reject: 'Reject' }
export const DISPUTE_DECISION_LABELS: Readonly<Record<'approve' | 'reject', string>> = { approve: 'Uphold', reject: 'Not upheld' }
/** D-BM-08: approving a grievance resolves it upheld, rejecting resolves it not upheld. */
export const GRIEVANCE_DECISION_LABELS: Readonly<Record<'approve' | 'reject', string>> = { approve: 'Resolve: upheld', reject: 'Resolve: not upheld' }

/** The approve/reject button words of a case type. */
export function decisionLabelsOf(type: string): Readonly<Record<'approve' | 'reject', string>> {
  return type === 'dispute' ? DISPUTE_DECISION_LABELS : type === 'grievance' ? GRIEVANCE_DECISION_LABELS : DECISION_LABELS
}

/** Approve or reject (type.decide, step-up through ApiProvider with the dialog's Idempotency-Key), or withdraw (opener). */
export function ReasonDialog({ record, info, action, onClose, onDone }: DialogProps & { readonly action: 'approve' | 'reject' | 'withdraw' }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  // An erasure that must wait (409 ERASURE_DEFERRED) names amounts in the market's currency.
  const markets = useResource<Market[]>(record.type === 'privacy' ? MARKETS_PATH : null)
  const dispute = record.type === 'dispute'
  const grievance = record.type === 'grievance'
  const label = caseTypeLabel(record.type).toLowerCase()
  function submit(idempotencyKey: string) {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: REASON_FIELD, message: missing }] }
    return {
      items: [],
      fieldIds: { reason: REASON_FIELD },
      send: async () => {
        try {
          if (action === 'withdraw') {
            await api.post(`/v1/cases/${record.id}/withdraw`, { reason: reason.trim() })
            toast({ message: 'Case withdrawn.' })
          } else {
            const { data } = await api.post<CaseRecord>(`/v1/cases/${record.id}/decision`, { decision: action, reason: reason.trim() }, { idempotencyKey })
            // D-B4-10: a case that needs two approvals stays submitted after the first.
            const first = action === 'approve' && data.state === 'submitted'
            const decided = dispute
              ? `Dispute ${action === 'approve' ? 'upheld' : 'not upheld'}. The distributor is told with your explanation.`
              : grievance ? `Grievance resolved: ${action === 'approve' ? 'upheld' : 'not upheld'}.`
              : action === 'approve' ? 'Case approved. Its change is applied.' : 'Case rejected.'
            toast({ message: first ? 'First approval recorded. A second approver decides next.' : decided })
          }
        } catch (failure) {
          throw withApprovers(erasureRefusal(decisionRefusal(failure), markets.data ?? undefined), info.deciderRole)
        }
        onDone()
      },
    }
  }
  const titles = dispute
    ? { approve: 'Uphold this dispute', reject: 'Do not uphold this dispute', withdraw: `Withdraw this ${label}` }
    : grievance
      ? { approve: 'Resolve this grievance as upheld', reject: 'Resolve this grievance as not upheld', withdraw: `Withdraw this ${label}` }
      : { approve: `Approve this ${label}`, reject: `Reject this ${label}`, withdraw: `Withdraw this ${label}` }
  const labels = { ...decisionLabelsOf(record.type), withdraw: 'Withdraw case' }
  return (
    <FormDialog title={titles[action]} submitLabel={labels[action]} submitVariant={action === 'approve' ? 'primary' : 'destructive-solid'} onClose={onClose} onSubmit={submit}>
      {action === 'approve' && <p>{dispute
        ? 'Upholding tells the distributor they are right, with your explanation. It changes no amount by itself: propose an adjustment or request a restatement afterwards.'
        : grievance ? 'The grievance is recorded as resolved and upheld in the register.' : 'Approving applies the change in the same step.'} You may be asked for a code from your authenticator app.</p>}
      {action === 'reject' && <p>{dispute ? 'The dispute is closed as not upheld and the distributor is sent your explanation.' : grievance ? 'The grievance is recorded as resolved and not upheld in the register.' : 'The case is closed and nothing changes.'} You may be asked for a code from your authenticator app.</p>}
      {action === 'withdraw' && <p>The case is closed without a decision and nothing changes.</p>}
      <TextAreaField id={REASON_FIELD} label={dispute && action !== 'withdraw' ? 'Explanation sent to the distributor' : 'Reason'} value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

/** Request types whose submit needs a retention basis (privacy-case.ts NEEDS_RETENTION_BASIS). */
const NEEDS_RETENTION_BASIS = new Set(['access', 'portability', 'erasure'])
const RETENTION_FIELD = 'case-retention-basis'

/**
 * A privacy case is submitted with the retention basis (what is kept and why, D-B5-16): PATCH the payload, then submit.
 * A correction needs none; its corrected fields are saved on the request first (SC-15).
 */
export function PrivacySubmitDialog({ record, requestType, onClose, onDone }: DialogProps & { readonly requestType: string }) {
  const api = useApi()
  const toast = useToast()
  const current = record.payload as PrivacyPayload
  const needsBasis = NEEDS_RETENTION_BASIS.has(requestType)
  const [basis, setBasis] = useState(current.retention_basis ?? '')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const missing = needsBasis ? requiredError('the retention basis', basis) : null
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: RETENTION_FIELD, message: missing }] }
    return {
      items: [],
      fieldIds: { 'payload.retention_basis': RETENTION_FIELD, retention_basis: RETENTION_FIELD },
      send: async () => {
        if (needsBasis && basis.trim() !== current.retention_basis) await api.patch(`/v1/cases/${record.id}`, { payload: { ...current, retention_basis: basis.trim() } })
        await api.post(`/v1/cases/${record.id}/submit`, {})
        toast({ message: 'Case submitted. Another DPO decides it.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Submit the privacy request" submitLabel="Submit for decision" onClose={onClose} onSubmit={submit}>
      <p>Another DPO decides it. The effect preview is calculated now: the identity must be verified first.</p>
      {needsBasis && (
        <TextAreaField id={RETENTION_FIELD} label="Retention basis" helper="What the company keeps after this request and the legal reason for keeping it; sent with the outcome."
          maxLength={NOTE_MAX} value={basis} error={error} onChange={setBasis} />
      )}
    </FormDialog>
  )
}

/** A returned payment is submitted with the payout officer's note (PATCH the payload, then submit). */
export function ReturnedSubmitDialog({ record, onClose, onDone }: DialogProps) {
  const api = useApi()
  const toast = useToast()
  const current = record.payload as { readonly instruction_id: string; readonly note?: string }
  const [note, setNote] = useState(current.note ?? '')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const missing = requiredError('the note', note)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: REASON_FIELD, message: missing }] }
    return {
      items: [],
      fieldIds: { 'payload.note': REASON_FIELD },
      send: async () => {
        if (note.trim() !== current.note) await api.patch(`/v1/cases/${record.id}`, { payload: { instruction_id: current.instruction_id, note: note.trim() } })
        await api.post(`/v1/cases/${record.id}/submit`, {})
        toast({ message: 'Case submitted. A Finance approver decides it.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Submit the returned payment" submitLabel="Submit for decision" onClose={onClose} onSubmit={submit}>
      <p>The returned amount is already back in the payee’s payable. Say what was found and what happens next; a Finance approver decides.</p>
      <TextAreaField id={REASON_FIELD} label="Note" maxLength={NOTE_MAX} value={note} error={error} onChange={setNote} />
    </FormDialog>
  )
}

/** POST /v1/cases/:id/assign: to me, to someone who may decide it, or to nobody. */
export function AssignDialog({ record, onClose, onDone }: DialogProps) {
  const api = useApi()
  const toast = useToast()
  const { me } = useSession()
  const [userId, setUserId] = useState(record.assigned_to ?? '')
  // shortcut: GET /v1/cases/:id names eligible people only once submitted, so an open case offers only you or nobody;
  // list the type's create/decide holders when the API returns assignable users for open cases.
  const others = (record.eligible_approvers ?? []).filter((approver) => approver.user_id !== me.user.id)
  const options = [
    { value: '', label: 'Nobody' },
    { value: me.user.id, label: 'Me' },
    ...others.map((approver) => ({ value: approver.user_id, label: personName(approver.user_id, me.user.id, others) })),
  ]
  function submit() {
    return {
      items: [],
      send: async () => {
        await api.post(`/v1/cases/${record.id}/assign`, { user_id: userId === '' ? null : userId })
        toast({ message: userId === '' ? 'Case unassigned.' : 'Case assigned.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Assign case" submitLabel="Save assignment" onClose={onClose} onSubmit={submit}>
      <Select label="Assign to" helper={others.length === 0 ? 'Take the case yourself or leave it unassigned.' : 'You, someone who can decide this case, or nobody.'} value={userId} options={options} onChange={(event) => setUserId(event.target.value)} />
    </FormDialog>
  )
}

/** Open cases take evidence: upload the file once (class evidence), then attach it with an optional note. */
export function AddEvidence({ caseId, onAdded }: { readonly caseId: string; readonly onAdded: () => void }) {
  const api = useApi()
  const toast = useToast()
  const limits = useResource<DocumentLimits>('/v1/documents/limits')
  const evidence = useEvidenceFile()
  const [note, setNote] = useState('')
  const [key, setKey] = useState(newIdempotencyKey)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (limits.error !== null) return <LoadFailure error={limits.error} onRetry={limits.reload} section />
  if (limits.data === null) return <LoadingState label="Loading the evidence file rules" />
  async function attach() {
    if (evidence.file === null) {
      setProblem('Choose the evidence file first.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const document = await evidence.upload(api)
      await api.post(`/v1/cases/${caseId}/evidence`, { document_id: document.id, ...(note.trim() === '' ? {} : { note: note.trim() }) }, { idempotencyKey: key })
      toast({ message: `${document.file_name ?? 'Evidence'} attached.` })
      onAdded() // the case reloads, which mounts a fresh form
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-space-sm pt-space-sm border-t border-surface-container" data-testid="add-evidence">
      <FileDropZone id="case-evidence" label="Add evidence" extensions={extensionsOf(limits.data.types)} maxBytes={limits.data.max_file_bytes} onFiles={(files) => {
        evidence.choose(files)
        setKey(newIdempotencyKey())
      }} />
      <TextAreaField id="case-evidence-note" label="Note" optional maxLength={NOTE_MAX} value={note} onChange={(value) => {
        setNote(value)
        setKey(newIdempotencyKey())
      }} />
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      <Button icon="file_upload" loading={busy} className="self-start" onClick={attach}>Attach evidence</Button>
    </div>
  )
}
