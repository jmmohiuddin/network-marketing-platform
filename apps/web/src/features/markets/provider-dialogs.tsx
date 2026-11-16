'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { FileDropZone } from '../../components/file-drop-zone'
import { TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { PAIR } from '../admin/ui'
import { useEvidenceFile } from './evidence-forms'
import { extensionsOf, todayLocal } from './format'
import { summaryItems } from './structure-dialogs'
import type { DocumentLimits, ProviderRecord } from './types'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DESCRIPTION_MAX = 2000
const HOLDER_MAX = 200

export interface ProviderFields {
  readonly provider: string
  readonly description: string
  readonly approved_at: string
  readonly funds_holder: string
}

/** Client checks of a provider approval record (the API checks the document and the date again). */
export function providerErrors(fields: ProviderFields, hasFile: boolean, today: string): Record<string, string | null> {
  return {
    'provider-name': requiredError('the provider’s name', fields.provider),
    'provider-description': requiredError('what the approval covers', fields.description),
    'provider-document': hasFile ? null : 'Choose the approval document.',
    'provider-date': !DATE.test(fields.approved_at) ? 'Enter the approval date.' : fields.approved_at > today ? 'The approval date cannot be in the future.' : null,
    'provider-holder': requiredError('who holds the funds', fields.funds_holder),
  }
}

export interface ProviderDialogProps {
  readonly marketId: string
  readonly kind: 'payout' | 'payment'
  /** Loaded before the dialog can open (the inspector shows "Record provider approval" only then). */
  readonly limits: DocumentLimits
  readonly onClose: () => void
  readonly onSaved: () => void
}

/**
 * BR-PAY-11 provider eligibility (D-B1-12): upload the approval document, then POST /v1/provider-configs with what the
 * approval covers, its date and who holds the funds. No credentials: providers stay sandbox adapters until B4.
 */
export function ProviderDialog({ marketId, kind, limits, onClose, onSaved }: ProviderDialogProps) {
  const api = useApi()
  const toast = useToast()
  const evidence = useEvidenceFile()
  const [fields, setFields] = useState<ProviderFields>({ provider: '', description: '', approved_at: '', funds_holder: '' })
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const set = (field: keyof ProviderFields) => (value: string) => setFields({ ...fields, [field]: value })
  const noun = kind === 'payout' ? 'payout' : 'payment'
  function submit(idempotencyKey: string) {
    const found = providerErrors(fields, evidence.file !== null, todayLocal())
    setErrors(found)
    const items = summaryItems(found)
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: { provider: 'provider-name', approved_description: 'provider-description', approved_at: 'provider-date', funds_holder: 'provider-holder', approval_document_id: 'provider-document' },
      send: async () => {
        const document = await evidence.upload(api)
        await api.post<ProviderRecord>('/v1/provider-configs', {
          market_id: marketId, kind, provider: fields.provider.trim(), approved_description: fields.description.trim(),
          approval_document_id: document.id, approved_at: fields.approved_at, funds_holder: fields.funds_holder.trim(),
        }, { idempotencyKey })
        toast({ message: `${fields.provider.trim()} recorded as an approved ${noun} provider.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={`Record ${noun} provider approval`} size="lg" submitLabel="Record approval" onClose={onClose} onSubmit={submit}>
      <div className={PAIR}>
        <TextInput id="provider-name" label="Provider" maxLength={100} value={fields.provider} error={errors['provider-name']} onChange={(event) => set('provider')(event.target.value)} data-autofocus />
        <TextInput id="provider-date" type="date" label="Approved on" max={todayLocal()} value={fields.approved_at} error={errors['provider-date']} onChange={(event) => set('approved_at')(event.target.value)} />
        <TextInput id="provider-holder" label="Funds holder" helper="Who holds participants’ money in transit." maxLength={HOLDER_MAX} value={fields.funds_holder} error={errors['provider-holder']} onChange={(event) => set('funds_holder')(event.target.value)} />
      </div>
      <TextAreaField id="provider-description" label="What the approval covers" maxLength={DESCRIPTION_MAX} value={fields.description} error={errors['provider-description']} onChange={set('description')} />
      <FileDropZone
        id="provider-document"
        label="Approval document"
        extensions={extensionsOf(limits.types)}
        maxBytes={limits.max_file_bytes}
        error={errors['provider-document']}
        onFiles={evidence.choose}
      />
    </FormDialog>
  )
}

/** POST /v1/provider-configs/:id/withdraw with a reason. */
export function WithdrawProviderDialog({ record, onClose, onSaved }: { readonly record: ProviderRecord; readonly onClose: () => void; readonly onSaved: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const missing = requiredError('the reason for withdrawing it', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'provider-withdraw-reason', message: missing }] }
    return {
      items: [],
      fieldIds: { reason: 'provider-withdraw-reason' },
      send: async () => {
        await api.post(`/v1/provider-configs/${record.id}/withdraw`, { reason: reason.trim() })
        toast({ message: `${record.provider} approval withdrawn.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={`Withdraw ${record.provider} approval`} submitLabel="Withdraw approval" submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>The record stays on file as withdrawn. The checklist item is complete again only with another recorded approval.</p>
      <TextAreaField id="provider-withdraw-reason" label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}
