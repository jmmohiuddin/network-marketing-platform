'use client'

import { useEffect, useRef, useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Select, TextInput } from '../../components/form-field'
import { Modal } from '../../components/modal'
import { useToast } from '../../components/toast'
import { countLabel } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { requiredError } from '../../lib/validation'
import { FormDialog } from '../admin/form-dialog'
import { MONO, NOTE } from '../admin/ui'
import { ACCOUNT_TYPES } from './format'
import { PARTICIPANTS_PATH, type AccountHolder, type AccountType, type HolderRole, type ParticipantDetail } from './types'
import { Facts, RecordCard } from './ui'

/** D-V1A-10 ACCOUNT_HOLDERS_MAX. */
const HOLDERS_MAX = 4
const ROLE_LABELS: Readonly<Record<HolderRole, string>> = { joint_holder: 'Joint holder', authorised_signatory: 'Authorised signatory' }
const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as HolderRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }))
/** The holder role an account type needs at least once (apps/api par/accounts.ts REQUIRED_ROLE). */
const REQUIRED_ROLE: Readonly<Record<AccountType, HolderRole | null>> = { individual: null, joint: 'joint_holder', entity: 'authorised_signatory' }
const TYPE_OPTIONS = (Object.keys(ACCOUNT_TYPES) as AccountType[]).map((value) => ({ value, label: ACCOUNT_TYPES[value] }))

/**
 * SC-09 Account section (FR-PAR-004, D-V1A-06): the account type and how many holders are recorded; holder names only
 * through the audited unmask (step-up), never on the page.
 */
export function AccountCard({ detail, onEdit, onShowHolders }: {
  readonly detail: ParticipantDetail
  readonly onEdit?: () => void
  readonly onShowHolders?: () => void
}) {
  const count = detail.account_holders_count
  const action = onEdit === undefined && onShowHolders === undefined ? undefined : (
    <div className="flex flex-wrap gap-space-xs">
      {onShowHolders !== undefined && <Button size="sm" icon="visibility" onClick={onShowHolders}>Show holders</Button>}
      {onEdit !== undefined && <Button size="sm" icon="edit" onClick={onEdit}>Edit account</Button>}
    </div>
  )
  return (
    <RecordCard id="account-title" testId="account" icon="group" title="Account" action={action}>
      <Facts items={[
        { label: 'Account type', value: detail.account_type === null ? 'Not recorded' : ACCOUNT_TYPES[detail.account_type] },
        { label: 'Holders and signatories', value: count === 0 ? 'None recorded' : `${countLabel(count, 'name')} recorded (masked)` },
      ]} />
    </RecordCard>
  )
}

interface HolderRow {
  readonly key: number
  readonly name: string
  readonly role: HolderRole
}

/**
 * PUT /v1/participants/:id/account (participant.manage): the type and, for joint and business accounts, every holder.
 * The recorded names are not shown here, so the list is entered in full and replaces the recorded one.
 */
export function AccountDialog({ detail, onClose, onDone }: { readonly detail: ParticipantDetail; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [type, setType] = useState<AccountType>(detail.account_type ?? 'individual')
  const [rows, setRows] = useState<readonly HolderRow[]>([])
  const [nextKey, setNextKey] = useState(0)
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const required = REQUIRED_ROLE[type]
  const nameId = (key: number) => `account-holder-${key}`
  function add() {
    setRows((current) => [...current, { key: nextKey, name: '', role: required ?? 'joint_holder' }])
    setNextKey((key) => key + 1)
  }
  function update(key: number, change: Partial<HolderRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }
  function submit() {
    const holders = required === null ? [] : rows
    const found: Record<string, string | null> = Object.fromEntries(holders.map((row) => [nameId(row.key), requiredError('the name', row.name)]))
    const roleMissing = required !== null && !holders.some((row) => row.role === required)
    found['account-holders'] = roleMissing ? `Add at least one ${ROLE_LABELS[required].toLowerCase()}.` : null
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    const body = required === null
      ? { account_type: type }
      : { account_type: type, holders: holders.map((row) => ({ name: row.name.trim(), role: row.role })) }
    return {
      items,
      fieldIds: { account_type: 'account-type', holders: 'account-holders' },
      send: async () => {
        await api.put(`${PARTICIPANTS_PATH}/${detail.id}/account`, body)
        toast({ message: 'Account updated.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Edit account" submitLabel="Save account" onClose={onClose} onSubmit={submit}>
      <Select id="account-type" label="Account type" options={TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value as AccountType)} />
      {required !== null && (
        <fieldset id="account-holders" tabIndex={-1} className="flex flex-col gap-space-sm focus:outline-none">
          <legend className="font-caption text-caption text-on-surface-variant font-medium mb-space-xs">Holders and signatories (up to {HOLDERS_MAX})</legend>
          <p className={NOTE}>Enter every name: the list replaces the recorded one, whose names stay masked. A {type === 'joint' ? 'joint' : 'business'} account needs at least one {ROLE_LABELS[required].toLowerCase()}.</p>
          {rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 sm:grid-cols-[1fr_12rem_auto] gap-space-xs items-end">
              <TextInput id={nameId(row.key)} label={`Name ${index + 1}`} autoComplete="off" maxLength={200} value={row.name}
                error={errors[nameId(row.key)]} onChange={(event) => update(row.key, { name: event.target.value })} />
              <Select id={`${nameId(row.key)}-role`} label={`Role of name ${index + 1}`} options={ROLE_OPTIONS} value={row.role}
                onChange={(event) => update(row.key, { role: event.target.value as HolderRole })} />
              <Button icon="delete" onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} aria-label={`Remove name ${index + 1}`}>Remove</Button>
            </div>
          ))}
          {errors['account-holders'] != null && <Banner tone="danger">{errors['account-holders']}</Banner>}
          {rows.length < HOLDERS_MAX && <div><Button icon="add" onClick={add}>Add name</Button></div>}
        </fieldset>
      )}
      <p className={NOTE}>The audit log records the account type and the number of names, never the names.</p>
    </FormDialog>
  )
}

/** POST /v1/participants/:id/unmask {fields: ['account_holders']} (participant.unmask, step-up): names shown here only. */
export function HoldersDialog({ participantId, onClose }: { readonly participantId: string; readonly onClose: () => void }) {
  const api = useApi()
  const [holders, setHolders] = useState<readonly AccountHolder[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (holders !== null) shown.current?.focus()
  }, [holders])
  async function reveal() {
    setBusy(true)
    setProblem(null)
    try {
      const { data } = await api.post<{ account_holders: readonly AccountHolder[] | null }>(`${PARTICIPANTS_PATH}/${participantId}/unmask`, { fields: ['account_holders'] })
      setHolders(data.account_holders ?? [])
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const footer = holders === null
    ? <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon="visibility" loading={busy} onClick={reveal}>Show holders</Button></>
    : <Button variant="primary" onClick={onClose}>Hide and close</Button>
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title="Show account holders" icon="visibility" footer={footer}>
      {holders === null
        ? (
          <>
            <p>Showing the holder names is recorded in the audit log. You may be asked for a code from your authenticator app.</p>
            {problem !== null && <Banner tone="danger">{problem}</Banner>}
          </>
        )
        : (
          <ul ref={shown} tabIndex={-1} data-autofocus aria-label="Account holders shown" className="flex flex-col gap-space-sm focus:outline-none">
            {holders.length === 0 && <li className={NOTE}>No names are recorded.</li>}
            {holders.map((holder, index) => (
              <li key={index} className="flex flex-col gap-1">
                <span className={`${MONO} text-on-surface break-words`}>{holder.name}</span>
                <span className="font-caption text-caption text-on-surface-variant">{ROLE_LABELS[holder.role]}</span>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  )
}
