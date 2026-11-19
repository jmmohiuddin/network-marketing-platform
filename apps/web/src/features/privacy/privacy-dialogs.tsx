'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { RadioGroup, TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { emailError, requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { ParticipantPicker } from '../cases/pickers'
import type { ParticipantRow } from '../cases/types'
import { METHOD_LABELS } from './format'
import { PRIVACY_REQUESTS_PATH, type Corrections, type PrivacyRequestDetail, type VerificationMethod } from './types'

const NOTE_MAX = 1000
const IDS = { method: 'verify-method', subject: 'verify-subject', note: 'verify-note', name: 'correct-name', email: 'correct-email', phone: 'correct-phone' } as const
const METHODS: readonly VerificationMethod[] = ['contact_match', 'document', 'other']
// An email match proves no control of the mailbox, so the API refuses it for these (VERIFICATION_METHOD_NOT_ALLOWED).
const MAILBOX_PROOF_NEEDED: ReadonlySet<string> = new Set(['erasure', 'correction'])
const METHOD_HELP: Readonly<Record<VerificationMethod, string>> = {
  contact_match: 'Refused unless the requester’s email equals the member’s contact email.',
  document: 'Attach the identity document to the case first.',
  other: 'Describe the check in the note.',
}

interface DialogProps {
  readonly request: PrivacyRequestDetail
  readonly onClose: () => void
  readonly onDone: () => void
}

/**
 * POST /v1/privacy-requests/:id/verify (step-up via ApiProvider): the method, the member the request is about (found by
 * reference or name) and a note. Sets the subject and the deadline (privacy.policy of the member's market).
 */
export function VerifyDialog({ request, onClose, onDone }: DialogProps) {
  const api = useApi()
  const toast = useToast()
  const [method, setMethod] = useState<VerificationMethod | ''>('')
  const [subject, setSubject] = useState<ParticipantRow | null>(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function submit() {
    const found = {
      [IDS.method]: method === '' ? 'Choose how the identity was checked.' : null,
      [IDS.subject]: subject === null ? 'Choose the member the request is about.' : null,
      [IDS.note]: requiredError('the note', note),
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    return {
      items: [],
      fieldIds: { method: IDS.method, subject_participant_id: IDS.subject, note: IDS.note },
      send: async () => {
        await api.post(`${PRIVACY_REQUESTS_PATH}/${request.id}/verify`, { method, subject_participant_id: subject!.id, note: note.trim() })
        toast({ message: 'Identity verified. The deadline now runs for the member’s market.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Verify the requester’s identity" size="lg" submitLabel="Record verification" onClose={onClose} onSubmit={submit}>
      <div id={IDS.method} tabIndex={-1}>
        <RadioGroup legend="How the identity was checked" name="verify-method" value={method} error={errors[IDS.method]} onChange={(value) => setMethod(value as VerificationMethod)}
          options={METHODS.filter((value) => value !== 'contact_match' || !MAILBOX_PROOF_NEEDED.has(request.type)).map((value) => ({ value, label: METHOD_LABELS[value], helper: METHOD_HELP[value] }))} />
      </div>
      {method === 'document' && (
        <p className="font-body-sm text-body-sm">
          Add the document as evidence on the <Link className="text-primary underline" href={`/cases/${request.case_id}`}>privacy case</Link> before recording this.
        </p>
      )}
      <ParticipantPicker id={IDS.subject} label="Member the request is about" chosen={subject} onChoose={setSubject} error={errors[IDS.subject]} />
      <TextAreaField id={IDS.note} label="Note" helper="What was compared or seen; kept with the request." maxLength={NOTE_MAX} value={note} error={errors[IDS.note]} onChange={setNote} />
    </FormDialog>
  )
}

/**
 * PUT /v1/privacy-requests/:id/corrections (D-B5-19, step-up): the corrected values, stored sealed; only their field names
 * go into the case. Empty fields are not corrected.
 */
export function CorrectionsDialog({ request, onClose, onDone }: DialogProps) {
  const api = useApi()
  const toast = useToast()
  const saved: Corrections = request.corrections ?? {}
  const [values, setValues] = useState({ name: saved.display_name ?? '', email: saved.contact?.email ?? '', phone: saved.contact?.phone ?? '' })
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const set = (field: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [field]: value }))
  function submit() {
    const name = values.name.trim()
    const email = values.email.trim()
    const phone = values.phone.trim()
    const found = {
      [IDS.name]: name === '' && email === '' && phone === '' ? 'Enter at least one corrected value.' : null,
      [IDS.email]: email === '' ? null : emailError(email),
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    const contact = { ...(email === '' ? {} : { email }), ...(phone === '' ? {} : { phone }) }
    const body = { ...(name === '' ? {} : { display_name: name }), ...(Object.keys(contact).length === 0 ? {} : { contact }) }
    return {
      items: [],
      fieldIds: { display_name: IDS.name, 'contact.email': IDS.email, 'contact.phone': IDS.phone },
      send: async () => {
        await api.put(`${PRIVACY_REQUESTS_PATH}/${request.id}/corrections`, body)
        toast({ message: 'Corrected values saved. They apply when the case is approved.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Corrected values" submitLabel="Save corrected values" onClose={onClose} onSubmit={submit}>
      <p>Only the fields you fill in are corrected. The values stay sealed; the case lists the field names only.</p>
      <TextInput id={IDS.name} label="Name" optional maxLength={200} value={values.name} error={errors[IDS.name]} onChange={(event) => set('name')(event.target.value)} />
      <TextInput id={IDS.email} label="Email address" type="email" optional maxLength={320} value={values.email} error={errors[IDS.email]} onChange={(event) => set('email')(event.target.value)} />
      <TextInput id={IDS.phone} label="Phone" type="tel" optional maxLength={40} value={values.phone} onChange={(event) => set('phone')(event.target.value)} />
    </FormDialog>
  )
}
