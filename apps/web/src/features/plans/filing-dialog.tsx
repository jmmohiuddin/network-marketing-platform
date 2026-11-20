'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { FileDropZone } from '../../components/file-drop-zone'
import { RadioGroup, TextInput } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { useEvidenceFile } from '../markets/evidence-forms'
import { extensionsOf } from '../markets/format'
import type { DocumentLimits } from '../markets/types'
import { versionApi } from './format'
import type { FilingStatus } from './types'

export const FILING_LABELS: Readonly<Record<FilingStatus, string>> = { filed: 'Filed', acknowledged: 'Acknowledged', not_required: 'Not required' }

const STATUS_OPTIONS = [
  { value: 'filed', label: 'Filed', helper: 'Submitted to the authority: reference, date and the filing as evidence.' },
  { value: 'acknowledged', label: 'Acknowledged', helper: 'The authority confirmed receipt: reference, date and its acknowledgement.' },
  { value: 'not_required', label: 'Not required', helper: "Counsel's statement that this change needs no filing, with a note." },
] as const

const REFERENCE_MAX = 200
const NOTE_MAX = 1000
const ID = { status: 'filing-status', reference: 'filing-reference', filed_on: 'filing-date', document: 'filing-evidence', note: 'filing-note' } as const
type Field = keyof typeof ID

export interface FilingTarget {
  readonly planId: string
  readonly version: number
  readonly market: { readonly id: string; readonly code: string }
}

/** Client checks of AC-PLN7-4 (the server checks them again): what each status must carry. */
export function filingErrors(status: FilingStatus | '', values: { readonly reference: string; readonly filedOn: string; readonly note: string; readonly hasEvidence: boolean }): Partial<Record<Field, string>> {
  if (status === '') return { status: 'Choose the filing status.' }
  const evidence = values.hasEvidence ? {} : { document: 'Choose the evidence file.' }
  if (status === 'not_required') return { ...(values.note.trim() === '' ? { note: 'Enter why no filing is required.' } : {}), ...evidence }
  return {
    ...(values.reference.trim() === '' ? { reference: 'Enter the filing reference.' } : {}),
    ...(values.filedOn === '' ? { filed_on: 'Enter the date of the filing.' } : {}),
    ...evidence,
  }
}

/**
 * SC-44 "Record filing" (plan.approve, step-up): status, reference, date, evidence uploaded as a document first, note.
 * Mount only while open.
 */
export function FilingDialog({ target, onClose, onRecorded }: { readonly target: FilingTarget; readonly onClose: () => void; readonly onRecorded: () => void }) {
  const api = useApi()
  const toast = useToast()
  const limits = useResource<DocumentLimits>('/v1/documents/limits')
  const evidence = useEvidenceFile()
  const [status, setStatus] = useState<FilingStatus | ''>('')
  const [reference, setReference] = useState('')
  const [filedOn, setFiledOn] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  // Own key: choosing another file changes the body but fires no form change event (FormDialog's key would stay).
  const [key, setKey] = useState(newIdempotencyKey)
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setKey(newIdempotencyKey())
  }
  function submit() {
    const found = filingErrors(status, { reference, filedOn, note, hasEvidence: evidence.file !== null })
    setErrors(found)
    const items = (Object.entries(found) as [Field, string][]).map(([field, message]) => ({ fieldId: ID[field], message }))
    if (items.length > 0 || status === '') return { items }
    const filed = status !== 'not_required'
    return {
      items: [],
      fieldIds: { status: ID.status, reference: ID.reference, filed_on: ID.filed_on, document_id: ID.document, note: ID.note },
      send: async () => {
        const document = await evidence.upload(api)
        await api.post(`${versionApi(target.planId, target.version)}/filings`, {
          market_id: target.market.id, status, document_id: document.id,
          ...(filed ? { reference: reference.trim(), filed_on: filedOn } : {}),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        }, { idempotencyKey: key })
        toast({ message: `Filing status of ${target.market.code} recorded.`, tone: 'success' })
        onRecorded()
      },
    }
  }
  const filed = status === 'filed' || status === 'acknowledged'
  return (
    <FormDialog title={`Record filing: ${target.market.code}`} submitLabel="Record filing" size="lg" onClose={onClose} onSubmit={submit}>
      <p>Each record is kept; the newest one is the market&apos;s filing status for this version. You may be asked for a code from your authenticator app.</p>
      <div id={ID.status} tabIndex={-1}>
        <RadioGroup legend="Filing status" name="filing-status" options={STATUS_OPTIONS} value={status} error={errors.status} onChange={changed((value: string) => setStatus(value as FilingStatus))} />
      </div>
      {filed && (
        <>
          <TextInput id={ID.reference} label="Reference" value={reference} maxLength={REFERENCE_MAX} error={errors.reference} onChange={(event) => changed(setReference)(event.target.value)} />
          <TextInput id={ID.filed_on} label="Date" type="date" value={filedOn} error={errors.filed_on} onChange={(event) => changed(setFiledOn)(event.target.value)} />
        </>
      )}
      {limits.loading && <LoadingState label="Loading the evidence limits" />}
      {limits.error !== null && <p role="alert" className="font-caption text-caption text-error">Evidence upload is not available right now. {errorMessage(limits.error)}</p>}
      {limits.data !== null && (
        <FileDropZone id={ID.document} label="Evidence" extensions={extensionsOf(limits.data.types)} maxBytes={limits.data.max_file_bytes} error={errors.document}
          onFiles={(files) => {
            evidence.choose(files)
            setKey(newIdempotencyKey())
          }} />
      )}
      <TextAreaField id={ID.note} label="Note" optional={status !== 'not_required'} value={note} error={errors.note} maxLength={NOTE_MAX} onChange={changed(setNote)} />
    </FormDialog>
  )
}
