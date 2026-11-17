'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { FileDropZone } from '../../components/file-drop-zone'
import { Select } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
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
import { caseTypeLabel, personName, type CaseTypeInfo } from './format'
import type { CaseDetail } from './types'

const NOTE_MAX = 2000
const REASON_FIELD = 'case-reason'

export type CaseDialog = 'approve' | 'reject' | 'withdraw' | 'assign'

interface DialogProps {
  readonly record: CaseDetail
  readonly info: CaseTypeInfo
  readonly onClose: () => void
  readonly onDone: () => void
}

/** Approve or reject (type.decide, step-up through ApiProvider with the dialog's Idempotency-Key), or withdraw (opener). */
export function ReasonDialog({ record, info, action, onClose, onDone }: DialogProps & { readonly action: 'approve' | 'reject' | 'withdraw' }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
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
          if (action === 'withdraw') await api.post(`/v1/cases/${record.id}/withdraw`, { reason: reason.trim() })
          else await api.post(`/v1/cases/${record.id}/decision`, { decision: action, reason: reason.trim() }, { idempotencyKey })
        } catch (failure) {
          throw withApprovers(failure, info.deciderRole)
        }
        toast({ message: action === 'approve' ? 'Case approved. Its change is applied.' : action === 'reject' ? 'Case rejected.' : 'Case withdrawn.' })
        onDone()
      },
    }
  }
  const titles = { approve: `Approve this ${label}`, reject: `Reject this ${label}`, withdraw: `Withdraw this ${label}` }
  const labels = { approve: 'Approve', reject: 'Reject', withdraw: 'Withdraw case' }
  return (
    <FormDialog title={titles[action]} submitLabel={labels[action]} submitVariant={action === 'approve' ? 'primary' : 'destructive-solid'} onClose={onClose} onSubmit={submit}>
      {action === 'approve' && <p>Approving applies the change in the same step. You may be asked for a code from your authenticator app.</p>}
      {action === 'reject' && <p>The case is closed and nothing changes. You may be asked for a code from your authenticator app.</p>}
      {action === 'withdraw' && <p>The case is closed without a decision and nothing changes.</p>}
      <TextAreaField id={REASON_FIELD} label="Reason" value={reason} error={error} onChange={setReason} />
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
