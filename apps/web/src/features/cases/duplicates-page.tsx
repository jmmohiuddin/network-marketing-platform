'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { RadioGroup, Select } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { EmptyState, LoadingState, NotAvailable } from '../../components/states'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { OUTCOME_LABELS, SIGNAL_LABELS, STATE_BADGES, STATE_LABELS } from './format'
import { Sc08Nav } from './genealogy-case-page'
import { participantPath } from './refs'
import type { CaseDetail, CaseRecord, DuplicateOutcome, DuplicatePayload, ParticipantDetail } from './types'

const CARD = 'bg-surface-container-lowest border border-outline-variant rounded p-space-md flex flex-col gap-space-sm shadow-sm'
const LABEL = 'font-caption text-caption text-secondary uppercase font-semibold'
const QUEUE_STATES = [{ value: 'open', label: 'Open' }, { value: 'submitted', label: 'Waiting for decision' }, { value: '', label: 'All states' }]
const OUTCOMES = (Object.keys(OUTCOME_LABELS) as DuplicateOutcome[]).map((value) => ({ value, label: OUTCOME_LABELS[value] }))

const currentType = (participant: ParticipantDetail) => participant.types.find((entry) => entry.valid_to === null)?.type.name ?? 'No type'

/** One side of the comparison (sc_08 entity match grid): the record as the participant API shows it, contact masked. */
function ParticipantSide({ id, heading }: { readonly id: string; readonly heading: string }) {
  const participant = useResource<ParticipantDetail>(participantPath(id))
  const data = participant.data
  return (
    <section className="p-space-sm bg-surface rounded border border-outline-variant flex flex-col gap-1 min-w-0" aria-label={heading}>
      <span className={LABEL}>{heading}</span>
      {participant.error !== null && <LoadFailure error={participant.error} onRetry={participant.reload} section />}
      {data === null && participant.error === null && <LoadingState label={`Loading ${heading.toLowerCase()}`} />}
      {data !== null && (
        <>
          <Link className="font-body-sm text-body-sm font-semibold text-primary hover:underline break-words" href={`/people/${id}`}>{data.display_name ?? data.external_ref}</Link>
          <span className="font-data-mono-sm text-data-mono-sm text-on-surface">{data.external_ref} · {data.market.code}</span>
          <span className="font-caption text-caption text-secondary">{currentType(data)} · enrolled {formatDateTime(data.enrolled_at)}</span>
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge state={data.status} />
            {data.duplicate_hold && <StatusBadge state="under_review" label="Duplicate review" />}
          </span>
          {data.contact_masked !== null && (
            <dl className="font-caption text-caption text-on-surface-variant">
              {(['email', 'phone', 'address'] as const).filter((field) => data.contact_masked?.[field] !== undefined).map((field) => (
                <div key={field} className="flex gap-1"><dt className="capitalize">{field}:</dt><dd className="break-all">{data.contact_masked?.[field]}</dd></div>
              ))}
            </dl>
          )}
          <ul className="flex flex-col gap-0.5" aria-label={`Positions of ${data.external_ref}`}>
            {data.positions.filter((position) => position.owned_to === null).map((position) => (
              <li key={position.id} className="flex items-center justify-between gap-space-xs">
                <Link className="font-data-mono-sm text-data-mono-sm text-primary hover:underline" href={`/genealogy?root=${position.id}`}>{position.position_ref}</Link>
                <StatusBadge state={position.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** Proposed outcome (PATCH /v1/cases/:id payload) and submit, by the investigator while the case is open. */
function OutcomeForm({ record, onChanged }: { readonly record: CaseDetail; readonly onChanged: () => void }) {
  const api = useApi()
  const toast = useToast()
  const payload = record.payload as DuplicatePayload
  const [outcome, setOutcome] = useState<string>(payload.proposed_outcome ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      toast({ message })
      onChanged()
    } catch (error) {
      setProblem(errorMessage(error))
      setBusy(false)
    }
  }
  const saved = payload.proposed_outcome
  const dirty = outcome !== '' && outcome !== saved
  return (
    <div className="flex flex-col gap-space-sm">
      <RadioGroup legend="Proposed outcome" name="duplicate-outcome" value={outcome} options={OUTCOMES} onChange={setOutcome} disabled={busy} />
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      <div className="flex flex-wrap gap-space-xs">
        <Button disabled={!dirty} loading={busy}
          onClick={() => run(() => api.patch(`/v1/cases/${record.id}`, { payload: { ...payload, proposed_outcome: outcome } }), 'Proposed outcome saved.')}>
          Save proposed outcome
        </Button>
        {saved !== undefined && !dirty && (
          <Button variant="primary" icon="send" loading={busy} data-testid="primary-action"
            onClick={() => run(() => api.post(`/v1/cases/${record.id}/submit`, {}), 'Duplicate review submitted. A second person decides it.')}>
            Submit for decision
          </Button>
        )}
      </div>
      {saved === undefined && <p className="font-caption text-caption text-secondary">Save a proposed outcome before submitting.</p>}
    </div>
  )
}

/** The selected review: subject and matched participant side by side, matched signal kinds only (never values). */
function Investigation({ caseId }: { readonly caseId: string }) {
  const { can, readOnly } = useSession()
  const detail = useResource<CaseDetail>(`/v1/cases/${caseId}`)
  if (detail.error !== null) return <LoadFailure error={detail.error} onRetry={detail.reload} section />
  if (detail.data === null) return <LoadingState label="Loading the duplicate review" />
  const record = detail.data
  const payload = record.payload as DuplicatePayload
  return (
    <div className="flex flex-col gap-space-md" data-testid="investigation">
      <section className={CARD} aria-labelledby="match-title">
        <div className="flex items-center justify-between gap-space-sm border-b border-outline-variant pb-space-sm">
          <h2 id="match-title" className="font-section-heading text-section-heading text-on-surface flex items-center gap-2">
            <Icon name="fingerprint" size={20} className="text-error" /> Duplicate review {shortId(record.id)}
          </h2>
          <StatusBadge state={STATE_BADGES[record.state]} label={STATE_LABELS[record.state]} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ParticipantSide id={record.subject_id} heading="Subject under review" />
          <ParticipantSide id={payload.matched_participant_id} heading="Matched participant" />
        </div>
        <div className="p-space-xs bg-surface-container-low rounded border border-outline-variant flex flex-col gap-1.5">
          <span className={LABEL}>Matching signals</span>
          {payload.matched_kinds.length === 0 ? <p className="font-caption text-caption text-secondary">Opened by staff without a signal match.</p> : (
            <ul className="flex flex-wrap gap-1.5" aria-label="Matching signals">
              {payload.matched_kinds.map((kind) => (
                <li key={kind} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-error-container text-on-error-container font-caption text-caption font-semibold">
                  <Icon name="check" size={14} /> {SIGNAL_LABELS[kind] ?? kind}
                </li>
              ))}
            </ul>
          )}
          <p className="font-caption text-caption text-secondary">Signals are compared as one-way hashes; their values are never stored or shown.</p>
        </div>
      </section>
      <section className={CARD} aria-labelledby="determination-title">
        <h2 id="determination-title" className={LABEL}>Determination</h2>
        {record.state === 'open' && !readOnly && can('case.duplicate.create')
          ? <OutcomeForm record={record} onChanged={detail.reload} />
          : <p className="font-body-sm text-body-sm text-on-surface">Proposed outcome: {payload.proposed_outcome === undefined ? 'not chosen yet' : OUTCOME_LABELS[payload.proposed_outcome]}</p>}
        <LinkButton className="self-start" icon="open_in_new" href={`/cases/${record.id}`}>Open case record</LinkButton>
      </section>
    </div>
  )
}

/** GET /v1/cases?type=duplicate in one state; mount it with the state as key so paging restarts. */
function DuplicateQueue({ state, selected }: { readonly state: string; readonly selected: string | null }) {
  const pathname = usePathname()
  const list = usePagedList<CaseRecord>('/v1/cases', { type: 'duplicate', state: state === '' ? undefined : state })
  return (
    <DataTable
      caption="Duplicate reviews"
      columns={[
        { key: 'case', header: 'Review', cell: (row: CaseRecord) => <Link className="text-primary font-semibold hover:underline" href={`${pathname}?${new URLSearchParams({ state, case: row.id }).toString()}`} aria-current={row.id === selected ? true : undefined}>Review {shortId(row.id)}</Link> },
        { key: 'signals', header: 'Matching signals', cell: (row: CaseRecord) => (row.payload as DuplicatePayload).matched_kinds.map((kind) => SIGNAL_LABELS[kind] ?? kind).join(', ') || '—' },
        { key: 'outcome', header: 'Proposed outcome', cell: (row: CaseRecord) => { const outcome = (row.payload as DuplicatePayload).proposed_outcome; return outcome === undefined ? '—' : OUTCOME_LABELS[outcome] } },
        { key: 'opened', header: 'Opened', cell: (row: CaseRecord) => formatDateTime(row.created_at) },
        { key: 'state', header: 'State', cell: (row: CaseRecord) => <StatusBadge state={STATE_BADGES[row.state]} label={STATE_LABELS[row.state]} /> },
      ]}
      rows={list.rows}
      rowKey={(row) => row.id}
      selectedKey={selected ?? undefined}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No duplicate reviews in this state' }}
      pagination={list.pagination}
      stackOnPhone
    />
  )
}

/** SC-08 /cases/duplicates: the duplicate-review queue and the side-by-side investigation of the selected case. */
export function DuplicatesPage() {
  const { can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const state = params.get('state') ?? 'open'
  const selected = params.get('case')
  if (!can('case.duplicate.read')) return <NotAvailable />
  const go = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    router.replace(`${pathname}?${next.toString()}`)
  }
  return (
    <>
      <PageHeader
        title="Duplicate investigation"
        breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Duplicate investigation' }]}
        summary="Participants whose identity, payment, address or device signals match another participant. Propose an outcome; a second person decides."
      />
      <div>
        <Sc08Nav current="duplicates" />
        <div className="pt-space-md grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
          <section className="xl:col-span-7 flex flex-col gap-space-sm min-w-0" aria-labelledby="queue-title">
            <div className="flex flex-wrap items-end justify-between gap-space-sm">
              <h2 id="queue-title" className="font-section-heading text-section-heading text-on-surface">Review queue</h2>
              <Select label="State" value={state} options={QUEUE_STATES} onChange={(event) => go({ state: event.target.value, case: null })} />
            </div>
            <DuplicateQueue key={state} state={state} selected={selected} />
          </section>
          <div className="xl:col-span-5 min-w-0">
            {selected === null
              ? <EmptyState title="Choose a review">Pick a review from the queue to compare the two participants.</EmptyState>
              : <Investigation key={selected} caseId={selected} />}
          </div>
        </div>
      </div>
    </>
  )
}
