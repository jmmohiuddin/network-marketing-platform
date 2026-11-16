'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { FileDropZone } from '../../components/file-drop-zone'
import { useToast } from '../../components/toast'
import { newIdempotencyKey, type ApiClient } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { requiredError } from '../../lib/validation'
import { TextAreaField } from '../admin/form-dialog'
import { extensionsOf } from './format'
import type { DocumentLimits, DocumentSummary } from './types'

const NOTE_MAX = 2000

/** POST /v1/documents (D-B1-04): one evidence file, uploaded once, then referenced by id. */
export async function uploadEvidence(api: ApiClient, file: File, idempotencyKey: string): Promise<DocumentSummary> {
  const form = new FormData()
  form.append('class', 'evidence')
  form.append('file', file)
  return (await api.post<DocumentSummary>('/v1/documents', form, { idempotencyKey })).data
}

/**
 * The evidence document of one attempt: uploaded at most once per chosen file (its own Idempotency-Key), so a failed
 * second step retries without a second upload. Choosing another file starts again.
 */
export function useEvidenceFile(): {
  readonly file: File | null
  readonly choose: (files: readonly File[]) => void
  readonly upload: (api: ApiClient) => Promise<DocumentSummary>
} {
  const [file, setFile] = useState<File | null>(null)
  const [key, setKey] = useState(newIdempotencyKey)
  const [uploaded, setUploaded] = useState<DocumentSummary | null>(null)
  return {
    file,
    choose: (files) => {
      setFile(files[0] ?? null)
      setKey(newIdempotencyKey())
      setUploaded(null)
    },
    upload: async (api) => {
      if (uploaded !== null) return uploaded
      if (file === null) throw new Error('no file chosen')
      const document = await uploadEvidence(api, file, key)
      setUploaded(document)
      return document
    },
  }
}

interface EntryFormProps {
  readonly marketId: string
  readonly item: string
  readonly title: string
  readonly onRecorded: () => void
}

/** Evidence item: choose a file, upload it, record it as the item's entry (POST …/checklist/:item/entries). */
export function EvidenceForm({ marketId, item, title, limits, onRecorded }: EntryFormProps & { readonly limits: DocumentLimits }) {
  const api = useApi()
  const toast = useToast()
  const evidence = useEvidenceFile()
  const [entryKey, setEntryKey] = useState(newIdempotencyKey)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function attach() {
    if (evidence.file === null) {
      setProblem('Choose the evidence file first.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const document = await evidence.upload(api)
      await api.post(`/v1/markets/${marketId}/checklist/${item}/entries`, { document_id: document.id }, { idempotencyKey: entryKey })
      toast({ message: `${title}: ${document.file_name ?? 'evidence'} recorded.` })
      setEntryKey(newIdempotencyKey())
      onRecorded()
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <FileDropZone
        id={`evidence-${item}`}
        label={`Evidence for ${title.toLowerCase()}`}
        extensions={extensionsOf(limits.types)}
        maxBytes={limits.max_file_bytes}
        onFiles={evidence.choose}
      />
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      <Button icon="file_upload" loading={busy} className="w-full justify-center" onClick={attach}>Attach evidence file</Button>
    </div>
  )
}

/** Attestation item: a note recorded as the item's entry. */
export function AttestationForm({ marketId, item, title, onRecorded }: EntryFormProps) {
  const api = useApi()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [key, setKey] = useState(newIdempotencyKey)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function record() {
    const missing = requiredError('the attestation note', note)
    setError(missing)
    if (missing !== null) return
    setBusy(true)
    try {
      await api.post(`/v1/markets/${marketId}/checklist/${item}/entries`, { note: note.trim() }, { idempotencyKey: key })
      toast({ message: `${title} recorded.` })
      setNote('')
      setKey(newIdempotencyKey())
      onRecorded()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <TextAreaField
        id={`attestation-${item}`}
        label="Attestation note"
        helper={item === 'plan_variant' ? 'Name the plan variant this market runs.' : 'State what you confirm.'}
        maxLength={NOTE_MAX}
        value={note}
        error={error}
        onChange={(value) => {
          setNote(value)
          setKey(newIdempotencyKey())
        }}
      />
      <Button icon="edit_note" loading={busy} className="w-full justify-center" onClick={record}>Record attestation</Button>
    </div>
  )
}
