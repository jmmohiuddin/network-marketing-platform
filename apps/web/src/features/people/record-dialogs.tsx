'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { Modal } from '../../components/modal'
import { useToast } from '../../components/toast'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { fromLocalInput } from '../admin/format'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { FIELDSET, LEGEND, MONO } from '../admin/ui'
import { PARTICIPANT_TYPES_PATH, type ParticipantType } from '../admin/settings/types'
import type { Contact, ContactField, OwnedPosition, PositionStatus } from './types'

const CONTACT_LABELS: Readonly<Record<ContactField, string>> = { email: 'Email address', phone: 'Phone', address: 'Address' }
const POSITION_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

type Errors = Readonly<Record<string, string | null>>
const itemsOf = (errors: Errors, ids: Readonly<Record<string, string>>) =>
  Object.entries(errors).flatMap(([field, message]) => (message === null ? [] : [{ fieldId: ids[field]!, message }]))

/** An optional datetime-local value: '' = now (omitted), else the instant; past or future checked by the caller. */
function instantOf(local: string): { readonly iso?: string; readonly error: string | null } {
  if (local === '') return { error: null }
  const iso = fromLocalInput(local)
  return iso === null ? { error: 'Enter a valid date and time.' } : { iso, error: null }
}

/**
 * POST /v1/participants/:id/unmask (participant.unmask, step-up through ApiProvider): the chosen contact fields, shown
 * in this dialog only and gone when it closes. The API records PARTICIPANT.UNMASKED with the field names, never values.
 */
export function UnmaskDialog({ participantId, available, onClose }: { readonly participantId: string; readonly available: readonly ContactField[]; readonly onClose: () => void }) {
  const api = useApi()
  const [chosen, setChosen] = useState<ReadonlySet<ContactField>>(new Set(available))
  const [shown, setShown] = useState<Contact | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function reveal() {
    if (chosen.size === 0) {
      setProblem('Choose at least one field to show.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const { data } = await api.post<{ contact: Contact }>(`/v1/participants/${participantId}/unmask`, { fields: available.filter((field) => chosen.has(field)) })
      setShown(data.contact)
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const footer = shown === null
    ? <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon="visibility" loading={busy} onClick={reveal}>Show contact</Button></>
    : <Button variant="primary" onClick={onClose}>Hide and close</Button>
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title="Show contact details" icon="visibility" footer={footer}>
      {shown === null
        ? (
          <>
            <p>Showing contact details is recorded in the audit log with the fields you choose. You may be asked for a code from your authenticator app.</p>
            <fieldset className={FIELDSET}>
              <legend className={LEGEND}>Fields to show</legend>
              {available.map((field) => (
                <Checkbox key={field} label={CONTACT_LABELS[field]} checked={chosen.has(field)}
                  onChange={(event) => setChosen((current) => new Set([...current].filter((entry) => entry !== field).concat(event.target.checked ? [field] : [])))} />
              ))}
            </fieldset>
            {problem !== null && <Banner tone="danger">{problem}</Banner>}
          </>
        )
        : (
          <dl className="flex flex-col gap-space-sm" aria-label="Contact details shown">
            {(Object.keys(shown) as ContactField[]).map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <dt className="font-caption text-caption text-on-surface-variant font-medium">{CONTACT_LABELS[field]}</dt>
                <dd className={`${MONO} text-on-surface break-all`}>{shown[field] ?? 'Not recorded'}</dd>
              </div>
            ))}
          </dl>
        )}
    </Modal>
  )
}

const STATUS_LABELS: Readonly<Record<Exclude<PositionStatus, 'pending'>, string>> = { active: 'Active', suspended: 'Suspended', terminated: 'Terminated' }

type NextStatus = Exclude<PositionStatus, 'pending'>
/** The moves gen_set_position_status (migration 0207) accepts. */
const NEXT_STATUS: Readonly<Record<PositionStatus, readonly NextStatus[]>> = {
  pending: ['active', 'terminated'], active: ['suspended', 'terminated'], suspended: ['active', 'terminated'], terminated: ['active'],
}

export interface StatusPermissions { readonly canManage: boolean; readonly canTerminate: boolean; readonly duplicateHold: boolean }

/**
 * The statuses a position may move to by this user, as the API allows: termination and reinstating a terminated one
 * need participant.terminate, every other move participant.manage; a duplicate hold blocks activating a pending one.
 */
export function statusChoices(current: PositionStatus, { canManage, canTerminate, duplicateHold }: StatusPermissions): NextStatus[] {
  return NEXT_STATUS[current].filter((next) => (next === 'terminated' || current === 'terminated' ? canTerminate : canManage)
    && !(current === 'pending' && next === 'active' && duplicateHold))
}

/**
 * POST /v1/positions/:id/status (FR-PAR-005): effective now or earlier, with a reason. A termination asks for step-up
 * and reassigns the position's customers by the tenant's rule (the toast says how many moved).
 */
export function StatusDialog({ position, choices, onClose, onDone }: { readonly position: OwnedPosition; readonly choices: readonly NextStatus[]; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [status, setStatus] = useState<string>(choices[0] ?? '')
  // "Now" is the moment the dialog opened: a retry with the same Idempotency-Key must send the same body.
  const [openedAt] = useState(() => new Date().toISOString())
  const [local, setLocal] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const ids = { status: 'status-new', effective_from: 'status-effective', reason: 'status-reason' }
  function submit(idempotencyKey: string) {
    const effective = instantOf(local)
    const future = effective.iso !== undefined && Date.parse(effective.iso) > Date.now() ? 'A status change takes effect now or earlier.' : null
    const found = { status: status === '' ? 'Choose the new status.' : null, effective_from: effective.error ?? future, reason: requiredError('the reason', reason) }
    setErrors(found)
    const items = itemsOf(found, ids)
    if (items.length > 0) return { items }
    const body = { status, effective_from: effective.iso ?? openedAt, reason: reason.trim() }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        const { data } = await api.post<{ reassigned_customers: number }>(`/v1/positions/${position.id}/status`, body, { idempotencyKey })
        const moved = data.reassigned_customers > 0 ? ` ${data.reassigned_customers === 1 ? '1 customer was' : `${data.reassigned_customers} customers were`} reassigned.` : ''
        toast({ message: `Position ${position.position_ref} is now ${STATUS_LABELS[status as keyof typeof STATUS_LABELS].toLowerCase()}.${moved}` })
        onDone()
      },
    }
  }
  const terminating = status === 'terminated'
  return (
    <FormDialog title={`Change status of ${position.position_ref}`} submitLabel={terminating ? 'Terminate position' : 'Change status'} submitVariant={terminating ? 'destructive-solid' : 'primary'} onClose={onClose} onSubmit={submit}>
      <Select id={ids.status} label="New status" value={status} error={errors.status} onChange={(event) => setStatus(event.target.value)}
        options={choices.map((choice) => ({ value: choice, label: STATUS_LABELS[choice] }))} />
      <TextInput id={ids.effective_from} type="datetime-local" label="Effective from" optional helper="Your local time. Empty: now. Never in the future or inside a committed period."
        value={local} error={errors.effective_from} onChange={(event) => setLocal(event.target.value)} />
      <TextAreaField id={ids.reason} label="Reason" helper="Kept in the position's status history and the audit log." value={reason} error={errors.reason} onChange={setReason} />
      {terminating && (
        <Banner tone="warning" title="Termination reassigns customers">
          The customers this position services move by your reassignment rule. The position stays in the tree. You may be asked for a code from your authenticator app.
        </Banner>
      )}
    </FormDialog>
  )
}

/** POST /v1/participants/:id/type: a new effective-dated type from now or later (FR-PAR-001). */
export function TypeDialog({ participantId, currentCode, onClose, onDone }: { readonly participantId: string; readonly currentCode: string | null; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const types = useResource<readonly ParticipantType[]>(PARTICIPANT_TYPES_PATH, { state: 'active' })
  const [code, setCode] = useState('')
  const [local, setLocal] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const ids = { type_code: 'type-new', valid_from: 'type-from', reason: 'type-reason' }
  function submit(idempotencyKey: string) {
    const from = instantOf(local)
    const past = from.iso !== undefined && Date.parse(from.iso) < Date.now() ? 'A type change starts now or later.' : null
    const found = { type_code: code === '' ? 'Choose the new type.' : null, valid_from: from.error ?? past, reason: requiredError('the reason', reason) }
    setErrors(found)
    const items = itemsOf(found, ids)
    if (items.length > 0) return { items }
    const body = { type_code: code, ...(from.iso === undefined ? {} : { valid_from: from.iso }), reason: reason.trim() }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        await api.post(`/v1/participants/${participantId}/type`, body, { idempotencyKey })
        toast({ message: `Type changed to ${code}.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Change participant type" submitLabel="Change type" onClose={onClose} onSubmit={submit}>
      <Select id={ids.type_code} label="New type" placeholder={types.loading ? 'Loading types' : 'Choose a type'} value={code} error={errors.type_code}
        options={(types.data ?? []).filter((type) => type.code !== currentCode).map((type) => ({ value: type.code, label: `${type.name} (${type.code})` }))}
        onChange={(event) => setCode(event.target.value)} />
      <TextInput id={ids.valid_from} type="datetime-local" label="Valid from" optional helper="Your local time. Empty: now. Never in the past."
        value={local} error={errors.valid_from} onChange={(event) => setLocal(event.target.value)} />
      <TextAreaField id={ids.reason} label="Reason" value={reason} error={errors.reason} onChange={setReason} />
      {types.error !== null && <Banner tone="danger">{errorMessage(types.error)}</Banner>}
    </FormDialog>
  )
}

/** PUT /v1/customers/:id/servicing (API-35): a position reference or the company, from now or later. */
export function ServicerDialog({ customerId, onClose, onDone }: { readonly customerId: string; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [company, setCompany] = useState(false)
  const [ref, setRef] = useState('')
  const [local, setLocal] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const ids = { position_ref: 'servicer-ref', valid_from: 'servicer-from', reason: 'servicer-reason' }
  function submit(idempotencyKey: string) {
    const from = instantOf(local)
    const past = from.iso !== undefined && Date.parse(from.iso) < Date.now() ? 'The new servicer starts now or later.' : null
    const found = {
      position_ref: company || POSITION_REF.test(ref.trim()) ? null : 'Enter the servicing position’s reference, or choose the company.',
      valid_from: from.error ?? past,
      reason: requiredError('the reason', reason),
    }
    setErrors(found)
    const items = itemsOf(found, ids)
    if (items.length > 0) return { items }
    const body = { position_ref: company ? null : ref.trim(), ...(from.iso === undefined ? {} : { valid_from: from.iso }), reason: reason.trim() }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        await api.put(`/v1/customers/${customerId}/servicing`, body, { idempotencyKey })
        toast({ message: company ? 'The company services this customer now.' : `Position ${body.position_ref} services this customer.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Change servicer" submitLabel="Change servicer" onClose={onClose} onSubmit={submit}>
      <Checkbox label="The company services this customer" checked={company} onChange={(event) => setCompany(event.target.checked)} />
      {!company && <TextInput id={ids.position_ref} label="Servicing position" value={ref} error={errors.position_ref} onChange={(event) => setRef(event.target.value)} />}
      <TextInput id={ids.valid_from} type="datetime-local" label="Valid from" optional helper="Your local time. Empty: now. Never in the past."
        value={local} error={errors.valid_from} onChange={(event) => setLocal(event.target.value)} />
      <TextAreaField id={ids.reason} label="Reason" value={reason} error={errors.reason} onChange={setReason} />
    </FormDialog>
  )
}
