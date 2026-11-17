'use client'

import { useState } from 'react'
import { Modal } from '../../components/modal'
import { requiredError } from '../../lib/validation'
import { TextAreaField } from '../admin/form-dialog'
import { CaseForm, NOTE_MAX } from './case-form'
import { caseTypeInfo } from './format'

const PREFIX = 'restatement'
const NOTE_ID = `${PREFIX}-note`

export interface RestatementPeriod {
  readonly id: string
  /** How the opener names the period ("Oct 1, 2026 – Oct 31, 2026"). */
  readonly label: string
}

/**
 * "Request restatement" (SC-06 restatement type, opened from SC-01 and SC-32): a restatement case on a committed
 * period with reason, note and evidence. The case opens with its evidence; the opener then submits it on the case
 * page, which calculates the effect (diff per payee and bonus) for a second person to decide.
 */
export function RestatementDialog({ period, onClose }: { readonly period: RestatementPeriod; readonly onClose: () => void }) {
  const info = caseTypeInfo('restatement')!
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  function prepare() {
    const missing = requiredError('the note', note)
    setNoteError(missing)
    return {
      items: missing === null ? [] : [{ fieldId: NOTE_ID, message: missing }],
      subjectType: 'period', subjectId: period.id, payload: { note: note.trim() },
    }
  }
  return (
    <Modal open onClose={onClose} title="Request restatement" size="lg" icon="history_edu" description={period.label}>
      <CaseForm idPrefix={PREFIX} info={info} prepare={prepare} fieldIds={{ 'payload.note': NOTE_ID }} submitLabel="Open restatement case" statement={false}>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          The committed period is never edited. Once submitted, the period is recalculated as known now; an approved difference is paid in the next run of its calendar.
        </p>
        <TextAreaField id={NOTE_ID} label="Note" helper="What is wrong in the committed result and why." maxLength={NOTE_MAX} value={note} error={noteError} onChange={setNote} />
      </CaseForm>
    </Modal>
  )
}
