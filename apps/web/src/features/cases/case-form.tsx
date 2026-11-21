'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { FileDropZone } from '../../components/file-drop-zone'
import { Select } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { ApiError, isApiError, newIdempotencyKey } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { LoadingState } from '../../components/states'
import { LoadFailure } from '../admin/page-states'
import { summaryOf, TextAreaField } from '../admin/form-dialog'
import { useEvidenceFile } from '../markets/evidence-forms'
import { extensionsOf } from '../markets/format'
import type { DocumentLimits } from '../markets/types'
import { isStructuralCode, reasonLabel, structuralText, type CaseTypeInfo } from './format'
import type { CaseRecord } from './types'

/** The API's limit on a case note (and on a restatement's payload note). */
export const NOTE_MAX = 2000

/** What a case form sends besides reason, note and evidence; items = its own field errors. */
export interface CaseProposal {
  readonly items: readonly SummaryItem[]
  readonly subjectType: string
  readonly subjectId: string | null
  readonly payload: unknown
}

interface CaseFormProps {
  readonly idPrefix: string
  readonly info: CaseTypeInfo
  /** Receives the chosen reason code ('' while none): a transfer's legal basis depends on it. */
  readonly prepare: (reason: string) => CaseProposal
  /** Body paths of payload fields -> field ids, for VALIDATION_FAILED issues. */
  readonly fieldIds: Readonly<Record<string, string>>
  readonly submitLabel: string
  /** false: the type's payload carries its own required note (restatement), so the optional statement is not asked. */
  readonly statement?: boolean
  /** The statement field's helper (a grievance's statement summarises the complaint, not a requested change). */
  readonly statementHelper?: string
  /** The type's own refusals at create, in words (adjustment: ADJUSTMENT_BLOCKED). */
  readonly explain?: (error: unknown) => unknown
  /** The reason chosen at first (an upheld dispute's adjustment: DISPUTE_UPHELD). */
  readonly initialReason?: string
  /** required (default), optional (a grievance about a participant) or none (a grievance whose complainant is not on record, D-BM-13). */
  readonly evidence?: 'required' | 'optional' | 'none'
  /** The reason field's label ("Category" for a grievance). */
  readonly reasonFieldLabel?: string
  /** Fields that depend on the chosen reason, shown under it (a transfer's legal basis). */
  readonly details?: (reason: string) => ReactNode
  readonly children: ReactNode
}

/** A structural refusal at create (409 GEN_CYCLE …) in the words of the effect preview. */
function explained(error: unknown): unknown {
  if (!isApiError(error) || !isStructuralCode(error.code)) return error
  return new ApiError(error.status, error.code, structuralText(error.code), error.details, error.requestId)
}

/**
 * SC-08 case filing: POST /v1/cases (the type dry-runs the structural change and refuses a cycle), upload the evidence
 * (POST /v1/documents, class evidence), attach it, then open the case page to submit it. A case opened before a failed
 * evidence step is kept: the retry only attaches the evidence.
 */
export function CaseForm({
  idPrefix, info, prepare, fieldIds, submitLabel, statement = true, statementHelper = 'Why the change is needed; kept with the case.', explain = (error) => error, initialReason = '', evidence: evidenceRule = 'required',
  reasonFieldLabel = 'Reason', details, children,
}: CaseFormProps) {
  const api = useApi()
  const router = useRouter()
  const toast = useToast()
  const limits = useResource<DocumentLimits>(evidenceRule === 'none' ? null : '/v1/documents/limits')
  const evidence = useEvidenceFile()
  const [reason, setReason] = useState(initialReason)
  const [note, setNote] = useState('')
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  // One Idempotency-Key per identical body: a retry of the same case reuses it, any change gets a new one.
  const [attempt, setAttempt] = useState<{ readonly key: string; readonly body: string } | null>(null)
  // A new key per chosen file: a retry after a lost response with another file must not reuse the earlier body's key.
  const [evidenceKey, setEvidenceKey] = useState(newIdempotencyKey)
  const [opened, setOpened] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = { reason: `${idPrefix}-reason`, note: `${idPrefix}-note`, evidence: `${idPrefix}-evidence` }
  const reasonCodes = info.reasonCodes ?? []
  const reasonOptions = reasonCodes.map((code) => ({ value: code, label: reasonLabel(code) }))
  const chosenReason = reasonCodes.includes(reason) ? reason : ''

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const proposal = prepare(chosenReason)
    const own = {
      [ids.reason]: opened === null && chosenReason === '' ? `Choose a ${reasonFieldLabel.toLowerCase()}.` : null,
      [ids.evidence]: evidenceRule === 'required' && evidence.file === null ? 'Choose the evidence file.' : null,
    }
    setErrors(own)
    const items = [
      ...(opened === null ? proposal.items : []),
      ...Object.entries(own).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }])),
    ]
    setSummary(items)
    if (items.length > 0) return
    setBusy(true)
    try {
      let caseId = opened
      if (caseId === null) {
        const body = {
          type: info.type, subject_type: proposal.subjectType, subject_id: proposal.subjectId, reason_code: chosenReason, payload: proposal.payload,
          // A statement typed before the field was hidden (grievance switched to "Not on record") is not sent.
          ...(!statement || note.trim() === '' ? {} : { note: note.trim() }),
        }
        const text = JSON.stringify(body)
        const key = attempt !== null && attempt.body === text ? attempt.key : newIdempotencyKey()
        setAttempt({ key, body: text })
        caseId = (await api.post<CaseRecord>('/v1/cases', body, { idempotencyKey: key })).data.id
        setOpened(caseId)
      }
      const attach = evidenceRule !== 'none' && evidence.file !== null
      if (attach) {
        const document = await evidence.upload(api)
        await api.post(`/v1/cases/${caseId}/evidence`, { document_id: document.id }, { idempotencyKey: evidenceKey })
      }
      toast({ message: `Case opened${attach ? ' with its evidence' : ''}. Submit it for a decision when it is complete.` })
      router.push(`/cases/${caseId}`)
    } catch (error) {
      setSummary(summaryOf(explain(explained(error)), { ...fieldIds, reason_code: ids.reason }))
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-space-md" noValidate onSubmit={submit}>
      <ErrorSummary items={summary} />
      {opened !== null && (
        <Banner tone="info" title="The case is open">
          The evidence is not attached yet. Try again, or <Link className="text-primary underline" href={`/cases/${opened}`}>open the case</Link> and attach it there.
        </Banner>
      )}
      <fieldset className="flex flex-col gap-space-md min-w-0" disabled={opened !== null}>
        {children}
        <Select id={ids.reason} label={reasonFieldLabel} placeholder={`Choose a ${reasonFieldLabel.toLowerCase()}`} value={chosenReason} options={reasonOptions} error={errors[ids.reason]} onChange={(event) => setReason(event.target.value)} />
        {details?.(chosenReason)}
        {statement && <TextAreaField id={ids.note} label="Statement" optional helper={statementHelper} maxLength={NOTE_MAX} value={note} onChange={setNote} />}
      </fieldset>
      {evidenceRule === 'none' ? null : limits.error !== null ? <LoadFailure error={limits.error} onRetry={limits.reload} section />
        : limits.data === null ? <LoadingState label="Loading the evidence file rules" />
          : (
            <FileDropZone id={ids.evidence} label="Evidence" optional={evidenceRule === 'optional'} extensions={extensionsOf(limits.data.types)} maxBytes={limits.data.max_file_bytes} error={errors[ids.evidence]} onFiles={(files) => {
              evidence.choose(files)
              setEvidenceKey(newIdempotencyKey())
            }} />
          )}
      <Button type="submit" variant="primary" icon="assignment_add" loading={busy} className="self-start" data-testid="primary-action">{opened === null ? submitLabel : 'Attach evidence'}</Button>
    </form>
  )
}
