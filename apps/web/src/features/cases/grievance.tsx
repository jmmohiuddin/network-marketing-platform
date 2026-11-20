'use client'

import { useState, type ReactNode } from 'react'
import { RadioGroup, Select, TextInput } from '../../components/form-field'
import { Modal } from '../../components/modal'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { fromLocalInput } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { inScope, marketScope } from '../markets/format'
import { CaseForm } from './case-form'
import { caseTypeInfo } from './format'
import { ParticipantPicker } from './pickers'
import type { CaseEventKind, CaseRecord, CaseState, ParticipantRow } from './types'

/** D-BM-08 (apps/api cpl/grievance-case.ts): a grievance is recorded within this many days of its receipt. */
const RECEIVED_MAX_AGE_DAYS = 366
const DAY_MS = 86_400_000
const REFERENCE_MAX = 100
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/

export const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  email: 'E-mail', phone: 'Phone', letter: 'Letter', portal: 'Distributor portal', in_person: 'In person', other: 'Other',
}

/** Case states in grievance words (D-BM-08): submitted = acknowledged, approved/rejected = resolved upheld/not upheld. */
export const GRIEVANCE_STATE: Readonly<Record<CaseState, string>> = {
  open: 'Received', submitted: 'Acknowledged', approved: 'Resolved: upheld', rejected: 'Resolved: not upheld', withdrawn: 'Withdrawn',
}

/** Timeline events in grievance words (the case framework's submit/approve/reject, D-BM-08). */
export const GRIEVANCE_EVENTS: Readonly<Partial<Record<CaseEventKind, string>>> = {
  submitted: 'Acknowledged', approved: 'Resolved: upheld', rejected: 'Resolved: not upheld',
}

export const OUTCOME_LABELS: Readonly<Record<'upheld' | 'not_upheld', string>> = { upheld: 'Upheld', not_upheld: 'Not upheld' }

export const DEADLINE_LABELS: Readonly<Record<string, string>> = { ack: 'Acknowledgement', resolution: 'Resolution' }

export interface GrievancePayload {
  readonly received_at: string
  readonly channel: string
  readonly external_ref?: string
}

/** GET /v1/registers/grievances rows (PLAN B-MKT §2.3). */
export interface GrievanceRow {
  readonly case_id: string
  readonly market_id: string
  readonly subject: { readonly type: 'participant' | 'market'; readonly id: string; readonly external_ref: string | null }
  readonly category: string
  readonly channel: string
  readonly external_ref: string | null
  readonly received_at: string
  readonly ack_due_at: string
  readonly acknowledged_at: string | null
  readonly resolution_due_at: string
  readonly resolved_at: string | null
  readonly outcome: 'upheld' | 'not_upheld' | null
  readonly state: CaseRecord['state']
  readonly ack_overdue: boolean
  readonly resolution_overdue: boolean
  readonly escalated: readonly string[]
  readonly rule_id: string
}

/** Why a received date-time cannot be used, or null: it must lie in the last 366 days and not in the future. */
export function receivedError(value: string, now: number): string | null {
  const iso = fromLocalInput(value)
  if (iso === null) return 'Enter the date and time the grievance was received.'
  const at = Date.parse(iso)
  if (at > now) return 'The received date cannot be in the future.'
  if (at < now - RECEIVED_MAX_AGE_DAYS * DAY_MS) return `The received date must be within the last ${RECEIVED_MAX_AGE_DAYS} days.`
  return null
}

const PREFIX = 'grievance'
const IDS = {
  subject: `${PREFIX}-subject`, participant: `${PREFIX}-participant`, market: `${PREFIX}-market`, channel: `${PREFIX}-channel`,
  received: `${PREFIX}-received`, reference: `${PREFIX}-reference`,
}

/**
 * "Record grievance" (SC-06, FR-CPL-013): the complainant (a participant, or not on record with the market), category,
 * channel, received date-time (fixed once recorded), the tenant's own reference and, for a participant, optional evidence.
 */
export function GrievanceDialog({ onClose }: { readonly onClose: () => void }) {
  const info = caseTypeInfo('grievance')!
  const { me } = useSession()
  const markets = useResource<Market[]>(MARKETS_PATH)
  const scope = marketScope(me, 'case.grievance.create')
  const [subject, setSubject] = useState<'participant' | 'market'>('participant')
  const [participant, setParticipant] = useState<ParticipantRow | null>(null)
  const [marketId, setMarketId] = useState('')
  const [channel, setChannel] = useState('')
  const [received, setReceived] = useState('')
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const marketOptions = (markets.data ?? []).filter((market) => inScope(scope, market.id)).map((market) => ({ value: market.id, label: marketName(market) }))

  function prepare() {
    const ref = reference.trim()
    const found = {
      [IDS.participant]: subject === 'participant' && participant === null ? 'Choose the participant who complained.' : null,
      [IDS.market]: subject === 'market' && marketId === '' ? 'Choose the market the grievance concerns.' : null,
      [IDS.channel]: channel === '' ? 'Choose how the grievance was received.' : null,
      [IDS.received]: receivedError(received, Date.now()),
      [IDS.reference]: ref === '' || PRINTABLE_ASCII.test(ref) ? null : 'Use letters, digits and punctuation without accents (printable ASCII).',
    }
    setErrors(found)
    return {
      items: Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }])),
      subjectType: subject,
      subjectId: subject === 'participant' ? participant?.id ?? null : marketId,
      payload: { received_at: fromLocalInput(received) ?? '', channel, ...(ref === '' ? {} : { external_ref: ref }) },
    }
  }
  return (
    <Modal open onClose={onClose} title="Record grievance" size="lg" icon="campaign"
      description="A complaint received through your own channels. Its deadlines come from the market pack's grievance register.">
      {markets.error !== null ? <LoadFailure error={markets.error} onRetry={markets.reload} section /> : markets.data === null ? <LoadingState label="Loading markets" /> : (
        <CaseForm idPrefix={PREFIX} info={info} prepare={prepare} submitLabel="Record grievance" reasonFieldLabel="Category"
          evidence={subject === 'market' ? 'none' : 'optional'} statement={subject === 'participant'}
          statementHelper="A short summary of the complaint in your words; kept with the case."
          fieldIds={{ subject_id: subject === 'participant' ? IDS.participant : IDS.market, 'payload.channel': IDS.channel, 'payload.received_at': IDS.received, 'payload.external_ref': IDS.reference }}>
          <RadioGroup legend="Complainant" name={IDS.subject} value={subject} onChange={(value) => setSubject(value === 'market' ? 'market' : 'participant')} options={[
            { value: 'participant', label: 'A participant on record' },
            { value: 'market', label: 'Not on record', helper: 'No personal data is stored: only the market, codes and your reference. Evidence cannot be attached.' },
          ]} />
          {subject === 'participant'
            ? <ParticipantPicker id={IDS.participant} label="Participant" chosen={participant} onChoose={setParticipant} error={errors[IDS.participant]} />
            : <Select id={IDS.market} label="Market" placeholder="Choose a market" value={marketId} options={marketOptions} error={errors[IDS.market]} onChange={(event) => setMarketId(event.target.value)} />}
          <Select id={IDS.channel} label="Channel" placeholder="Choose a channel" value={channel} error={errors[IDS.channel]}
            options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} onChange={(event) => setChannel(event.target.value)} />
          <TextInput id={IDS.received} label="Received at" type="datetime-local" value={received} error={errors[IDS.received]}
            helper={`Your local time, within the last ${RECEIVED_MAX_AGE_DAYS} days. It cannot be changed once recorded: the deadlines count from it.`} onChange={(event) => setReceived(event.target.value)} />
          <TextInput id={IDS.reference} label="Your reference" optional maxLength={REFERENCE_MAX} value={reference} error={errors[IDS.reference]}
            helper="Your own ticket or letter reference." onChange={(event) => setReference(event.target.value)} />
        </CaseForm>
      )}
    </Modal>
  )
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="font-caption text-caption uppercase text-secondary font-semibold">{label}</dt>
      <dd className="font-body-sm text-body-sm text-on-surface break-words">{children}</dd>
    </div>
  )
}

/** "Due …", with an overdue chip, or when it was done and whether that was late. */
function DeadlineText({ due, doneAt, doneWord, overdue }: { readonly due: string; readonly doneAt: string | null; readonly doneWord: string; readonly overdue: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-space-xs">
      <span className={MONO}>{formatDateTime(due)}</span>
      {doneAt === null
        ? overdue && <StatusBadge state="blocked" label="Overdue" />
        : <span className="font-caption text-caption text-secondary">{doneWord} {formatDateTime(doneAt)}{Date.parse(doneAt) > Date.parse(due) ? ' (late)' : ''}</span>}
    </span>
  )
}

/** One grievance's register row: acknowledge-by and resolve-by deadlines, overdue chips, outcome and escalations. */
export function GrievanceDeadlines({ row }: { readonly row: GrievanceRow }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
      <Fact label="Acknowledge by"><DeadlineText due={row.ack_due_at} doneAt={row.acknowledged_at} doneWord="Acknowledged" overdue={row.ack_overdue} /></Fact>
      <Fact label="Resolve by"><DeadlineText due={row.resolution_due_at} doneAt={row.resolved_at} doneWord="Resolved" overdue={row.resolution_overdue} /></Fact>
      <Fact label="Outcome">{row.outcome === null ? 'Not resolved yet' : OUTCOME_LABELS[row.outcome]}</Fact>
      <Fact label="Escalations">{row.escalated.length === 0 ? 'None' : row.escalated.map((deadline) => `${DEADLINE_LABELS[deadline] ?? deadline} deadline near`).join(', ')}</Fact>
      <Fact label="Pack rule"><span className={`${MONO} break-all`}>{row.rule_id}</span></Fact>
    </dl>
  )
}

/** SC-06 detail: the grievance's deadlines from GET /v1/registers/grievances?case_id (no money effect on a grievance). */
export function GrievanceDeadlinesCard({ caseId }: { readonly caseId: string }) {
  const register = useResource<GrievanceRow[]>('/v1/registers/grievances', { case_id: caseId })
  const row = register.data?.[0]
  return (
    <section className="bg-surface-container-lowest rounded shadow-sm p-space-md flex flex-col gap-space-sm" aria-labelledby="deadlines-title" data-testid="deadlines">
      <h2 id="deadlines-title" className="font-caption text-caption uppercase text-secondary font-semibold">Deadlines</h2>
      {register.error !== null && <LoadFailure error={register.error} onRetry={register.reload} section />}
      {register.data === null && register.error === null && <LoadingState label="Loading the deadlines" />}
      {register.data !== null && (row === undefined ? <p className={NOTE}>This grievance is not in a register you can read.</p> : <GrievanceDeadlines row={row} />)}
    </section>
  )
}

/** The grievance's payload facts: received at, channel and the tenant's reference. */
export function grievanceFacts(payload: GrievancePayload): readonly (readonly [string, string])[] {
  return [
    ['Received at', formatDateTime(payload.received_at)],
    ['Channel', CHANNEL_LABELS[payload.channel] ?? payload.channel],
    ['Your reference', payload.external_ref ?? '—'],
  ]
}
