'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { useResource, type Query } from '../../lib/use-resource'
import { emailError, requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { tableError, usePagedList } from '../admin/resource'
import { CHANNEL_LABELS, deadlineOf, referenceOf, REQUEST_TYPES, STATE_BADGES, STATE_LABELS, TYPE_HELP, TYPE_LABELS, type Deadline } from './format'
import { PRIVACY_REQUESTS_PATH, type PrivacyRequestDetail, type PrivacyRequestRow, type RequestState, type RequestType } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
/** The API's page limit: the KPIs count open requests from one page of each state. */
const KPI_LIMIT = 200
const FILTER_KEYS = ['state', 'type', 'overdue'] as const
const STATES = Object.keys(STATE_LABELS) as RequestState[]

const DEADLINE_CLASS: Readonly<Record<Deadline['tone'], string>> = {
  neutral: 'text-on-surface-variant',
  warning: 'text-amber-900 font-semibold',
  danger: 'text-error font-semibold',
}

/** The deadline indicator: "n days left", "Overdue by n days", "No deadline configured" (C-B5-4). */
export function DeadlineText({ deadline }: { readonly deadline: Deadline }) {
  return <span className={`${MONO} ${DEADLINE_CLASS[deadline.tone]}`}>{deadline.text}</span>
}

/** privacy.policy escalate_before_days, or null while unset or unreadable. */
export function useEscalateDays(): number | null {
  const policy = useResource<{ readonly value: { readonly escalate_before_days: number } | null }>('/v1/settings/privacy.policy')
  return policy.data?.value?.escalate_before_days ?? null
}

function columns(now: number, escalateDays: number | null): readonly DataTableColumn<PrivacyRequestRow>[] {
  return [
    {
      key: 'request', header: 'Request', cell: (row) => (
        <div className="flex flex-col">
          <Link className="text-primary font-semibold hover:underline" href={`/privacy/${row.id}`}>{TYPE_LABELS[row.type]}</Link>
          <span className={`${MONO} text-secondary`}>{referenceOf(row.id)}</span>
        </div>
      ),
    },
    { key: 'channel', header: 'Channel', cell: (row) => CHANNEL_LABELS[row.channel] },
    { key: 'subject', header: 'Member', cell: (row) => (row.subject === null ? <span className="text-secondary">Not verified yet</span> : <span className={MONO}>{row.subject.external_ref}</span>) },
    { key: 'received', header: 'Received', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.received_at)}</span> },
    { key: 'deadline', header: 'Deadline', cell: (row) => <DeadlineText deadline={deadlineOf(row, now, escalateDays)} /> },
    { key: 'state', header: 'State', cell: (row) => <StatusBadge state={STATE_BADGES[row.state]} label={STATE_LABELS[row.state]} /> },
  ]
}

/**
 * sc_15 four KPI cards over the open requests (received + in progress).
 * shortcut: counted from the first 200 of each state (no counts route); "n+" says when there are more. Add a counts route if queues grow.
 */
function PrivacyKpis({ now, escalateDays }: { readonly now: number; readonly escalateDays: number | null }) {
  const received = useResource<PrivacyRequestRow[]>(PRIVACY_REQUESTS_PATH, { state: 'received', limit: KPI_LIMIT })
  const inProgress = useResource<PrivacyRequestRow[]>(PRIVACY_REQUESTS_PATH, { state: 'in_progress', limit: KPI_LIMIT })
  const loaded = received.data !== null && inProgress.data !== null
  const open = [...(received.data ?? []), ...(inProgress.data ?? [])]
  const more = typeof received.meta.next_cursor === 'string' || typeof inProgress.meta.next_cursor === 'string'
  const count = (rows: readonly PrivacyRequestRow[]) => (loaded ? `${rows.length}${more ? '+' : ''}` : null)
  const failed = received.error !== null || inProgress.error !== null ? 'Could not be loaded.' : undefined
  const overdue = open.filter((row) => deadlineOf(row, now, escalateDays).tone === 'danger')
  const soon = open.filter((row) => deadlineOf(row, now, escalateDays).tone === 'warning')
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Open requests" icon="assignment_turned_in" value={count(open)} detail={failed ?? 'Received or in progress'} />
      <KpiCard label="Overdue" icon="lock_clock" value={count(overdue)} detail={failed ?? 'Past their deadline'} />
      <KpiCard label="Due soon" icon="timer" value={escalateDays === null ? null : count(soon)}
        detail={failed ?? (escalateDays === null ? 'No escalation days configured' : `Due within ${escalateDays} days`)} />
      <KpiCard label="Not verified" icon="fingerprint" value={received.data === null ? null : `${received.data.length}${typeof received.meta.next_cursor === 'string' ? '+' : ''}`} detail={failed ?? 'Identity still to check'} />
    </div>
  )
}

const RECORD_IDS = { type: 'record-type', name: 'record-name', email: 'record-email', ref: 'record-ref', details: 'record-details', via: 'record-via' } as const

/** POST /v1/privacy-requests (step-up via ApiProvider): a request the DPO received by mail or phone (D-B5-16 staff channel). */
function RecordRequestDialog({ onClose }: { readonly onClose: () => void }) {
  const api = useApi()
  const router = useRouter()
  const toast = useToast()
  const [values, setValues] = useState({ type: '', name: '', email: '', ref: '', details: '', via: '' })
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const set = (field: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [field]: value }))
  const optional = (value: string) => (value.trim() === '' ? undefined : value.trim())
  function submit(idempotencyKey: string) {
    const found = {
      [RECORD_IDS.type]: values.type === '' ? 'Choose the request type.' : null,
      [RECORD_IDS.email]: values.email.trim() === '' ? null : emailError(values.email),
      [RECORD_IDS.details]: values.type === 'correction' ? requiredError('what should be corrected', values.details) : null,
      [RECORD_IDS.via]: requiredError('how the request was received', values.via),
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    return {
      items: [],
      fieldIds: { type: RECORD_IDS.type, full_name: RECORD_IDS.name, email: RECORD_IDS.email, participant_ref: RECORD_IDS.ref, details: RECORD_IDS.details, received_via: RECORD_IDS.via },
      send: async () => {
        const body = {
          type: values.type, full_name: optional(values.name), email: optional(values.email), participant_ref: optional(values.ref),
          details: optional(values.details), received_via: values.via.trim(),
        }
        const { data } = await api.post<PrivacyRequestDetail>(PRIVACY_REQUESTS_PATH, body, { idempotencyKey })
        toast({ message: 'Request recorded. Verify the requester’s identity next.' })
        router.push(`/privacy/${data.id}`)
      },
    }
  }
  return (
    <FormDialog title="Record a privacy request" size="lg" submitLabel="Record request" onClose={onClose} onSubmit={submit}>
      <p>A request that reached you by mail, phone or in person. It opens a privacy case; verify the identity before submitting it.</p>
      <Select id={RECORD_IDS.type} label="Request type" placeholder="Choose a type" value={values.type} error={errors[RECORD_IDS.type]}
        options={REQUEST_TYPES.map((type) => ({ value: type, label: `${TYPE_LABELS[type]}: ${TYPE_HELP[type]}` }))} onChange={(event) => set('type')(event.target.value)} />
      <TextInput id={RECORD_IDS.name} label="Requester’s name" optional value={values.name} onChange={(event) => set('name')(event.target.value)} maxLength={200} />
      <TextInput id={RECORD_IDS.email} label="Requester’s email address" type="email" optional value={values.email} error={errors[RECORD_IDS.email]} onChange={(event) => set('email')(event.target.value)} />
      <TextInput id={RECORD_IDS.ref} label="Member reference" optional helper="Names the market of the request; without it only DPOs for all markets see it." value={values.ref} onChange={(event) => set('ref')(event.target.value)} maxLength={100} />
      <TextAreaField id={RECORD_IDS.details} label="Details" optional={values.type !== 'correction'} maxLength={2000} value={values.details} error={errors[RECORD_IDS.details]} onChange={set('details')} />
      <TextInput id={RECORD_IDS.via} label="Received via" helper="For example: letter of 12 November, phone call." value={values.via} error={errors[RECORD_IDS.via]} onChange={(event) => set('via')(event.target.value)} maxLength={200} />
    </FormDialog>
  )
}

function RequestTable({ query, now, escalateDays }: { readonly query: Query; readonly now: number; readonly escalateDays: number | null }) {
  const list = usePagedList<PrivacyRequestRow>(PRIVACY_REQUESTS_PATH, query)
  return (
    <DataTable caption="Privacy requests" columns={columns(now, escalateDays)} rows={list.rows} rowKey={(row) => row.id} loading={list.loading}
      error={tableError(list)} empty={{ title: 'No privacy request matches these filters' }} pagination={list.pagination} stackOnPhone />
  )
}

/** SC-15 Privacy requests (FR-PRV-001, PLAN B5 §5): KPIs, filters in the URL, the request table with its deadline indicator. */
export function PrivacyRequestsPage() {
  const { can, readOnly } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const escalateDays = useEscalateDays()
  const [recording, setRecording] = useState(false)
  if (!can('privacy.manage')) return <NotAvailable />
  const now = Date.now()
  const update = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  const state = STATES.find((value) => value === params.get('state')) ?? ''
  const type = REQUEST_TYPES.find((value) => value === params.get('type')) ?? ''
  const overdue = params.get('overdue') === 'true'
  const chips: FilterChip[] = [
    ...(state === '' ? [] : [{ key: 'state', label: `State: ${STATE_LABELS[state]}`, onRemove: () => update({ state: null }) }]),
    ...(type === '' ? [] : [{ key: 'type', label: `Type: ${TYPE_LABELS[type as RequestType]}`, onRemove: () => update({ type: null }) }]),
    ...(overdue ? [{ key: 'overdue', label: 'Overdue', onRemove: () => update({ overdue: null }) }] : []),
  ]
  const query: Query = { state: state === '' ? undefined : state, type: type === '' ? undefined : type, overdue: overdue ? 'true' : undefined }
  return (
    <>
      <PageHeader
        title="Privacy requests"
        summary="Data-subject requests from the portal, the public form and staff. Verify the requester, submit the case with its retention basis; another DPO decides."
        actions={!readOnly && <Button variant="primary" icon="add_circle" data-testid="primary-action" onClick={() => setRecording(true)}>Record a request</Button>}
      />
      <PrivacyKpis now={now} escalateDays={escalateDays} />
      <FiltersBar label="Filter privacy requests" chips={chips} onClear={() => update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}>
        <Select label="State" value={state} options={[{ value: '', label: 'All states' }, ...STATES.map((value) => ({ value, label: STATE_LABELS[value] }))]} onChange={(event) => update({ state: event.target.value })} />
        <Select label="Type" value={type} options={[{ value: '', label: 'All types' }, ...REQUEST_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }))]} onChange={(event) => update({ type: event.target.value })} />
        <Checkbox label="Overdue only" checked={overdue} onChange={(event) => update({ overdue: event.target.checked ? 'true' : null })} />
      </FiltersBar>
      <RequestTable key={JSON.stringify(query)} query={query} now={now} escalateDays={escalateDays} />
      {recording && <RecordRequestDialog onClose={() => setRecording(false)} />}
    </>
  )
}
