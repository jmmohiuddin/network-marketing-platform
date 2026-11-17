'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { Checkbox, TextInput } from '../../../components/form-field'
import { StatusBadge } from '../../../components/status-badge'
import { useToast } from '../../../components/toast'
import { useSession } from '../../../lib/session'
import { useResource } from '../../../lib/use-resource'
import { requiredError } from '../../../lib/validation'
import { FormDialog, TextAreaField } from '../form-dialog'
import { formatDateTime } from '../format'
import { tableError } from '../resource'
import { CHIP, FIELDSET, LEGEND, MONO, NOTE, ROW_ACTIONS, SECTION_CARD, SectionTitle } from '../ui'
import { approverNames, noApproverText, withApprovers } from './labels'
import { PARTICIPANT_TYPES_PATH, type ParticipantType } from './types'

export const COMPLIANCE_OFFICER = 'Compliance officer'
const TYPE_CODE = /^[A-Z][A-Z0-9_]{0,31}$/
const NAME_MAX = 100
const APPROVE = 'participant_type.approve'

const FLAGS = [
  { field: 'can_earn', label: 'Can earn' },
  { field: 'can_sponsor', label: 'Can sponsor' },
  { field: 'can_hold_positions', label: 'Can hold positions' },
  { field: 'counts_as_end_customer', label: 'Counts as end customer' },
] as const
type Flag = (typeof FLAGS)[number]['field']

const STATE_BADGES: Readonly<Record<ParticipantType['state'], { readonly state: string; readonly label: string }>> = {
  pending: { state: 'pending', label: 'Waiting for Compliance approval' },
  active: { state: 'active', label: 'Active' },
  rejected: { state: 'rejected', label: 'Rejected' },
  withdrawn: { state: 'retired', label: 'Withdrawn' },
}

/** The error of a type code (the API's pattern), or null. */
export function typeCodeError(code: string): string | null {
  return TYPE_CODE.test(code) ? null : 'Use capital letters, digits and underscores, starting with a letter (at most 32), for example DIST.'
}

/** POST /v1/participant-types: a proposal a Compliance officer approves; the flags never change afterwards (D-B2-09). */
function ProposeTypeDialog({ onClose, onDone }: { readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [flags, setFlags] = useState<ReadonlySet<Flag>>(new Set())
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const ids = { code: 'type-code', name: 'type-name', reason: 'type-reason' }
  function submit(idempotencyKey: string) {
    const found = { code: typeCodeError(code), name: requiredError('a name', name), reason: requiredError('the reason', reason) }
    setErrors(found)
    const items = Object.entries(found).flatMap(([field, message]) => (message === null ? [] : [{ fieldId: ids[field as keyof typeof ids], message }]))
    if (items.length > 0) return { items }
    const body = { code, name: name.trim(), ...Object.fromEntries(FLAGS.map(({ field }) => [field, flags.has(field)])), reason: reason.trim() }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        await api.post(PARTICIPANT_TYPES_PATH, body, { idempotencyKey })
        toast({ message: `Type ${code} proposed. A Compliance officer must approve it.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Propose participant type" submitLabel="Propose type" onClose={onClose} onSubmit={submit}>
      <p>A Compliance officer who did not propose it approves the type. Its flags cannot change later: a different rule needs a new code.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
        <TextInput id={ids.code} label="Code" helper="For example DIST or RETAIL." maxLength={32} value={code} error={errors.code} onChange={(event) => setCode(event.target.value.toUpperCase())} />
        <TextInput id={ids.name} label="Name" maxLength={NAME_MAX} value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
      </div>
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>What members of this type may do</legend>
        {FLAGS.map(({ field, label }) => (
          <Checkbox key={field} label={label} checked={flags.has(field)}
            onChange={(event) => setFlags((current) => new Set([...current].filter((flag) => flag !== field).concat(event.target.checked ? [field] : [])))} />
        ))}
      </fieldset>
      <TextAreaField id={ids.reason} label="Reason" helper="Shown to the approver and kept in the audit log." value={reason} error={errors.reason} onChange={setReason} />
    </FormDialog>
  )
}

type Action = { readonly kind: 'approve' | 'reject' | 'withdraw'; readonly type: ParticipantType }
const TITLES = { approve: 'Approve', reject: 'Reject', withdraw: 'Withdraw' } as const

/** Decision (step-up through ApiProvider; the retry keeps the Idempotency-Key) or withdrawal of a proposed type. */
function TypeActionDialog({ action, onClose, onDone }: { readonly action: Action; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { kind, type } = action
  const label = `${TITLES[kind]} type ${type.code}`
  function submit(idempotencyKey: string) {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'type-action-reason', message: missing }] }
    return {
      items: [],
      fieldIds: { reason: 'type-action-reason' },
      send: async () => {
        try {
          if (kind === 'withdraw') await api.post(`${PARTICIPANT_TYPES_PATH}/${type.id}/withdraw`, { reason: reason.trim() })
          else await api.post(`${PARTICIPANT_TYPES_PATH}/${type.id}/decision`, { decision: kind, reason: reason.trim() }, { idempotencyKey })
        } catch (failure) {
          throw withApprovers(failure, COMPLIANCE_OFFICER)
        }
        toast({ message: `Type ${type.code} ${kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : 'withdrawn'}.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={label} submitLabel={label} submitVariant={kind === 'approve' ? 'primary' : 'destructive-solid'} onClose={onClose} onSubmit={submit}>
      <p>
        {type.name} ({type.code}).
        {kind === 'approve' && ' Approving makes the type available to enrolments at once. You may be asked for a code from your authenticator app.'}
        {kind === 'reject' && ' The code becomes free for another proposal. You may be asked for a code from your authenticator app.'}
      </p>
      <TextAreaField id="type-action-reason" label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

function flagChips(type: ParticipantType) {
  const held = FLAGS.filter(({ field }) => type[field])
  return held.length === 0
    ? <span className={NOTE}>No rights</span>
    : <ul className="flex flex-wrap gap-1" aria-label={`Flags of ${type.code}`}>{held.map(({ field, label }) => <li key={field} className={CHIP}>{label}</li>)}</ul>
}

/**
 * SC-29 Participant types (FR-PAR-001, D-B2-09): proposals by a Tenant admin (settings.manage), decisions by a
 * Compliance officer who did not propose them (participant_type.approve, step-up), withdrawal by the proposer.
 */
export function ParticipantTypesSection() {
  const { me, can, readOnly } = useSession()
  const types = useResource<readonly ParticipantType[]>(PARTICIPANT_TYPES_PATH)
  const [proposing, setProposing] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const done = () => {
    setProposing(false)
    setAction(null)
    types.reload()
  }
  const actionsOf = (type: ParticipantType) => {
    if (readOnly || type.state !== 'pending') return null
    const own = type.requested_by.id === me.user.id
    const decide = can(APPROVE) && !own && type.eligible_approvers !== null && type.eligible_approvers.length > 0
    return (
      <div className={ROW_ACTIONS}>
        {own && can('settings.manage') && <Button size="sm" aria-label={`Withdraw type ${type.code}`} onClick={() => setAction({ kind: 'withdraw', type })}>Withdraw</Button>}
        {decide && <Button size="sm" variant="destructive" aria-label={`Reject type ${type.code}`} onClick={() => setAction({ kind: 'reject', type })}>Reject</Button>}
        {decide && <Button size="sm" icon="verified_user" aria-label={`Approve type ${type.code}`} onClick={() => setAction({ kind: 'approve', type })}>Approve</Button>}
      </div>
    )
  }
  const columns: readonly DataTableColumn<ParticipantType>[] = [
    {
      key: 'type', header: 'Type', cell: (type) => (
        <div className="flex flex-col"><span className="font-semibold text-on-surface">{type.name}</span><span className={`${MONO} text-secondary`}>{type.code}</span></div>
      ),
    },
    { key: 'flags', header: 'Rights', cell: flagChips },
    { key: 'state', header: 'State', cell: (type) => <StatusBadge {...STATE_BADGES[type.state]} /> },
    {
      key: 'requested', header: 'Proposed', cell: (type) => (
        <div className="flex flex-col"><span>{type.requested_by.display_name ?? 'Another user'}</span><span className={`${MONO} text-secondary`}>{formatDateTime(type.requested_at)}</span><span className={NOTE}>{type.reason}</span></div>
      ),
    },
    {
      key: 'decision', header: 'Decision', cell: (type) => type.state === 'pending'
        ? <span className={NOTE}>{type.eligible_approvers === null || type.eligible_approvers.length === 0 ? noApproverText(COMPLIANCE_OFFICER) : `Can approve: ${approverNames(type.eligible_approvers)}`}</span>
        : <div className="flex flex-col"><span>{type.decided_by?.display_name ?? (type.state === 'withdrawn' ? 'Withdrawn by the proposer' : '—')}</span><span className={`${MONO} text-secondary`}>{formatDateTime(type.decided_at)}</span>{type.decision_reason !== null && <span className={NOTE}>{type.decision_reason}</span>}</div>,
    },
    { key: 'actions', header: 'Actions', align: 'end', cell: actionsOf },
  ]
  return (
    <section className={SECTION_CARD} aria-labelledby="types-title">
      <SectionTitle id="types-title" icon="badge" title="Participant types"
        action={!readOnly && can('settings.manage') ? <Button icon="add" onClick={() => setProposing(true)}>Propose type</Button> : undefined} />
      <p className={NOTE}>Types say who may earn, sponsor, hold positions or count as an end customer. Enrolments use active types only.</p>
      <DataTable
        bare caption="Participant types" columns={columns} rows={types.data ?? []} rowKey={(type) => type.id} loading={types.loading}
        error={tableError(types)} empty={{ title: 'No participant type yet. Propose one for each kind of participant you enrol.' }}
      />
      {proposing && <ProposeTypeDialog onClose={() => setProposing(false)} onDone={done} />}
      {action !== null && <TypeActionDialog action={action} onClose={() => setAction(null)} onDone={done} />}
    </section>
  )
}
