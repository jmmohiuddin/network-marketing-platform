'use client'

import { useState } from 'react'
import { Button, LinkButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Icon } from '../../components/icon'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { Stepper, type Step } from '../../components/stepper'
import { countLabel, formatDateIn, formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { DocumentLink } from '../markets/gate-inspector'
import { reviewPath } from '../periods/format'
import { FILING_LABELS, FilingDialog, type FilingTarget } from './filing-dialog'
import { calendarZone, STATE_LABELS, versionApi, versionPage } from './format'
import { GovernanceBar } from './governance'
import type { DraftScope } from './rules-tab'
import { RULE_LABELS } from './transitions-tab'
import type { ApprovalRecord, Filing, Governance, GovernanceKey, PlanDetail, RequiredFiling, VersionView } from './types'
import { MONO, NOTE, RefusalBanner, useKeptData, usePlanData, type PlanData, type RefusalNames } from './ui'

/** sc_44 section cards are p-space-lg (the shared plans CARD is p-space-md). */
const SECTION = 'bg-surface-container-lowest rounded-lg shadow-sm p-space-lg flex flex-col gap-space-sm'

const ITEM_LABELS: Readonly<Record<GovernanceKey, string>> = {
  simulation: 'Simulation of this exact version',
  goldens: 'Golden datasets pass',
  guardrails: 'Guardrail decisions resolved',
  transitions: 'Transitions declared',
  filing: 'Filing status per market',
  notice: 'Notice period',
  approvals: 'Approvals',
}

const LINK = 'text-primary font-semibold hover:underline'

/** sc_44 card head: icon, title-md h2 and a caption. */
function SectionHead({ icon, title, note, id }: { readonly icon: string; readonly title: string; readonly note: string; readonly id: string }) {
  return (
    <div className="flex items-center gap-space-sm pb-space-sm">
      <Icon name={icon} size={20} className="text-primary" />
      <div className="min-w-0">
        <h2 id={id} className="font-title-md text-title-md text-on-surface">{title}</h2>
        <p className="font-caption text-caption text-secondary">{note}</p>
      </div>
    </div>
  )
}
const who = (by: { readonly display_name: string | null }): string => by.display_name ?? 'Another user'

type Item = Governance['items'][number]
const itemOf = (governance: Governance, key: GovernanceKey): Item | undefined => governance.items.find((item) => item.key === key)
const ok = (governance: Governance, key: GovernanceKey): boolean => itemOf(governance, key)?.ok ?? false
const isScheduled = (state: VersionView['state']): boolean => state === 'scheduled' || state === 'active' || state === 'retired'

/**
 * The six stages of FR-PLN-007 (Draft · Simulation · Compliance review · Filing · Notice · Scheduled) from the governance
 * view; dates are calendar days in `zone`, the plan calendar's (BUG-124).
 */
export function changeSteps(governance: Governance, zone: string | undefined): Step[] {
  const dateOf = (iso: string): string => formatDateIn(iso, zone)
  const { state } = governance.version
  const reviewed = governance.approvals.compliance !== null
  const filingItem = itemOf(governance, 'filing')
  const missingFilings = (filingItem?.details as { market_ids?: readonly string[] } | null)?.market_ids ?? []
  const codes = missingFilings.map((id) => governance.filings.find((f) => f.market.id === id)?.market.code ?? id)
  const { notice } = governance
  const simulated = ok(governance, 'simulation') && ok(governance, 'goldens')
  return [
    { label: 'Draft', status: state === 'draft' ? 'current' : 'done' },
    simulated
      ? { label: 'Simulation', status: 'done', detail: 'Simulated, goldens pass' }
      : { label: 'Simulation', status: state === 'draft' ? 'todo' : 'blocked', detail: itemOf(governance, ok(governance, 'simulation') ? 'goldens' : 'simulation')?.reason ?? undefined },
    reviewed
      ? { label: 'Compliance review', status: 'done', detail: `Approved ${dateOf(governance.approvals.compliance!.at)}` }
      : { label: 'Compliance review', status: state === 'in_review' ? 'current' : 'todo' },
    filingItem?.ok === true
      ? { label: 'Filing', status: 'done', detail: filingItem.reason ?? 'Recorded for every required market' }
      : { label: 'Filing', status: state === 'in_review' || state === 'approved' ? 'blocked' : 'todo', detail: `Missing: ${codes.join(', ')}` },
    notice.sent_at !== null
      ? { label: 'Notice', status: 'done', detail: `Sent ${dateOf(notice.sent_at)}` }
      : notice.days === null
        ? { label: 'Notice', status: 'done', detail: 'No notice period set' }
        : { label: 'Notice', status: 'todo', detail: `${notice.days} days' notice` },
    isScheduled(state)
      ? { label: 'Scheduled', status: 'done', detail: governance.version.effective_from === null ? undefined : `From ${dateOf(governance.version.effective_from)}` }
      : { label: 'Scheduled', status: state === 'approved' ? 'current' : 'todo' },
  ]
}

/** An item's details in words (open guardrail decisions, undeclared state items, markets without a filing). */
function itemDetail(item: Item, governance: Governance): string | null {
  const details = (item.details ?? {}) as { decisions?: readonly unknown[]; state_items?: readonly string[]; market_ids?: readonly string[] }
  if (item.key === 'guardrails' && (details.decisions?.length ?? 0) > 0) return countLabel(details.decisions!.length, 'open decision')
  if (item.key === 'transitions' && (details.state_items?.length ?? 0) > 0) return `Undeclared: ${details.state_items!.join(', ')}`
  if (item.key === 'filing' && (details.market_ids?.length ?? 0) > 0) {
    return `Missing: ${details.market_ids!.map((id) => governance.filings.find((f) => f.market.id === id)?.market.code ?? id).join(', ')}`
  }
  return null
}

/** sc_44 stage list: each gate with ok/missing and the reason. */
function Checklist({ governance }: { readonly governance: Governance }) {
  return (
    <section className={SECTION} aria-labelledby="checklist-title" data-testid="card">
      <SectionHead id="checklist-title" icon="timeline" title="Checks before scheduling" note="Each gate with its state; the server checks them again when the version is scheduled." />
      <ul aria-label="Checks before scheduling" className="space-y-3">
        {governance.items.map((item) => {
          const extra = itemDetail(item, governance)
          return (
            <li key={item.key} className="flex items-start gap-space-md p-space-sm rounded-lg bg-surface-container-low">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${item.ok ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-error-container text-on-error-container'}`}>
                <Icon name={item.ok ? 'check' : 'priority_high'} size={18} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-space-xs">
                  <span className="font-section-heading text-section-heading text-on-surface">{ITEM_LABELS[item.key]}</span>
                  <span className={`font-caption text-caption px-2 py-0.5 rounded bg-surface-container-lowest font-semibold uppercase ${item.ok ? 'text-tertiary' : 'text-error'}`}>{item.ok ? 'OK' : 'Missing'}</span>
                </div>
                {item.reason !== null && <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{item.reason}</p>}
                {extra !== null && <p className={`${MONO} text-secondary mt-1`}>{extra}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function FilingCell({ filing }: { readonly filing: Filing | null }) {
  if (filing?.document_id == null) return <span className="text-secondary">—</span>
  return <DocumentLink document={{ id: filing.document_id, file_name: null }} fallback="Evidence" className={`${LINK} ${MONO}`} />
}

/** Earlier records of a market, newest first (the first history row is the current status). */
function History({ history }: { readonly history: readonly Filing[] }) {
  const earlier = history.slice(1)
  if (earlier.length === 0) return <span className="text-secondary">No earlier record</span>
  return (
    <details>
      <summary className={`${LINK} cursor-pointer`}>{countLabel(earlier.length, 'earlier record')}</summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {earlier.map((f) => <li key={f.id} className={MONO}>{FILING_LABELS[f.status]} · {f.reference ?? '—'} · {formatDateTime(f.recorded_at)} by {who(f.recorded_by)}</li>)}
      </ul>
    </details>
  )
}

/** "Market pack (authority)" / "Tenant setting" for a market whose filing is required (D-BM-10), "—" otherwise. */
export function requiredByText(required: readonly RequiredFiling[], marketId: string): string {
  const entry = required.find((r) => r.market_id === marketId)
  if (entry === undefined) return '—'
  return entry.sources.map((source) => (source === 'pack' ? `Market pack${entry.authority === null ? '' : ` (${entry.authority})`}` : 'Tenant setting')).join(', ')
}

/** sc_44 filing table: one row per plan market with status, reference, date, evidence, history and Record filing. */
function Filings({ governance, onRecord }: { readonly governance: Governance; readonly onRecord?: (market: FilingTarget['market']) => void }) {
  const required = governance.filings.filter((f) => f.required)
  const requiredBy = ((itemOf(governance, 'filing')?.details ?? {}) as { required?: readonly RequiredFiling[] }).required ?? []
  return (
    <section className={SECTION} aria-labelledby="filings-title">
      <SectionHead id="filings-title" icon="policy" title="Filings per market"
        note={required.length === 0 ? 'No market requires a filing.' : `Required for ${required.map((f) => f.market.code).join(', ')} before the version is scheduled.`} />
      <DataTable
        bare
        stackOnPhone
        caption="Filing status per plan market"
        density="compact"
        columns={[
          { key: 'market', header: 'Market', cell: (row) => <span className={`${MONO} font-bold text-primary`}>{row.market.code}</span> },
          { key: 'required', header: 'Required', cell: (row) => (row.required ? 'Yes' : 'No') },
          { key: 'required_by', header: 'Required by', cell: (row) => requiredByText(requiredBy, row.market.id) },
          { key: 'status', header: 'Status', cell: (row) => (row.current === null
            ? <StatusBadge state={row.required ? 'blocked' : 'retired'} label={row.required ? 'Missing' : 'Not recorded'} />
            : <StatusBadge state={row.current.status === 'not_required' ? 'retired' : 'accepted'} label={FILING_LABELS[row.current.status]} />) },
          { key: 'reference', header: 'Reference', cell: (row) => <span className={MONO}>{row.current?.reference ?? '—'}</span> },
          { key: 'date', header: 'Date', cell: (row) => <span className={MONO}>{row.current?.filed_on ?? '—'}</span> },
          { key: 'evidence', header: 'Evidence', cell: (row) => <FilingCell filing={row.current} /> },
          { key: 'recorded', header: 'Recorded', cell: (row) => (row.current === null ? '—' : <span className="flex flex-col"><span>{who(row.current.recorded_by)}</span><span className={`${MONO} text-secondary`}>{formatDateTime(row.current.recorded_at)}</span>{row.current.note !== null && <span className="text-secondary">{row.current.note}</span>}</span>) },
          { key: 'history', header: 'History', cell: (row) => <History history={row.history} /> },
          ...(onRecord === undefined ? [] : [{ key: 'actions', header: 'Actions', align: 'end' as const, cell: (row: Governance['filings'][number]) => (
            <Button size="sm" icon="upload_file" aria-label={`Record filing for ${row.market.code}`} onClick={() => onRecord(row.market)}>Record filing</Button>
          ) }]),
        ]}
        rows={governance.filings}
        rowKey={(row) => row.market.id}
        empty={{ title: 'The plan has no markets.' }}
      />
    </section>
  )
}

function NoticeCard({ governance }: { readonly governance: Governance }) {
  const { notice } = governance
  const fact = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-space-sm">
      <dt className="font-caption text-caption text-secondary uppercase font-semibold">{label}</dt>
      <dd className={`${MONO} text-on-surface text-right`}>{value}</dd>
    </div>
  )
  return (
    <section className={SECTION} aria-labelledby="notice-title">
      <SectionHead id="notice-title" icon="calendar_month" title="Notice" note="Distributors are notified in the transaction that schedules the version." />
      <dl className="flex flex-col gap-space-xs p-space-sm rounded-lg bg-surface-container-low">
        {fact('Notice period', notice.days === null ? 'No notice period set' : `${notice.days} days`)}
        {fact('Earliest effective date', notice.earliest_effective_on ?? '—')}
        {fact('Sent at', notice.sent_at === null ? 'Not sent yet' : formatDateTime(notice.sent_at))}
        {fact('Recipients', notice.recipients === null ? '—' : String(notice.recipients))}
      </dl>
    </section>
  )
}

function ApprovalsCard({ governance }: { readonly governance: Governance }) {
  const row = (label: string, record: ApprovalRecord | null, waiting: string) => (
    <li className="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1">
      <span className="font-caption text-caption text-secondary uppercase font-semibold">{label}</span>
      {record === null
        ? <span className="font-body-sm text-body-sm text-secondary">{waiting}</span>
        : <><span className="font-body-md text-body-md font-semibold text-on-surface">{who(record.by)}</span><span className={`${MONO} text-secondary`}>Approved {formatDateTime(record.at)}</span></>}
    </li>
  )
  return (
    <section className={SECTION} aria-labelledby="approvals-title">
      <SectionHead id="approvals-title" icon="draw" title="Approvals" note="Two people other than the authors approve a plan change." />
      <ul className="flex flex-col gap-space-sm">
        {row('Compliance approval', governance.approvals.compliance, 'Waiting for a compliance officer')}
        {row('Activation (scheduling)', governance.approvals.activation, 'Waiting for a Finance approver')}
      </ul>
    </section>
  )
}

/** Declared transitions with a link to the SC-04 Transitions tab, and the first run's transition report once one exists. */
function TransitionsCard({ plan, version, firstRunId }: { readonly plan: PlanDetail; readonly version: VersionView; readonly firstRunId: string | null }) {
  const run = useResource<{ readonly period_id: string }>(firstRunId === null ? null : `/v1/runs/${firstRunId}`)
  return (
    <section className={SECTION} aria-labelledby="transitions-title">
      <SectionHead id="transitions-title" icon="swap_horiz" title="Transitions" note="How each state item of the previous version enters this one." />
      {version.transitions.length === 0
        ? <p className={NOTE}>No transition is declared.</p>
        : (
          <ul aria-label="Declared transitions" className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
            {version.transitions.map((t) => (
              <li key={t.state_item} className="p-space-sm rounded-lg bg-surface-container-low flex flex-col">
                <span className={`${MONO} font-semibold text-on-surface`}>{t.state_item}</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">{RULE_LABELS[t.rule]}{t.reason === null ? '' : `: ${t.reason}`}</span>
              </li>
            ))}
          </ul>
        )}
      <div className="flex flex-wrap items-center gap-space-sm">
        <LinkButton size="sm" icon="open_in_new" href={`${versionPage(plan.id, version.version)}?tab=transitions`}>Open the Transitions tab</LinkButton>
        {firstRunId !== null && run.data !== null && (
          <LinkButton size="sm" icon="compare_arrows" href={`${reviewPath(run.data.period_id, firstRunId)}?tab=changes`}>Transition report</LinkButton>
        )}
        {firstRunId === null && <span className={NOTE}>The transition report appears once a period runs under this version.</span>}
        {firstRunId !== null && run.error !== null && <span className={NOTE}>A run reviewer can open the transition report of the first run under this version.</span>}
      </div>
    </section>
  )
}

/** A schedule refusal to expect now: the open items the server would refuse first. */
function scheduleNote(governance: Governance): string | undefined {
  const open = governance.items.filter((item) => !item.ok && item.key !== 'approvals')
  if (open.length === 0) return undefined
  return `Open before scheduling: ${open.map((item) => ITEM_LABELS[item.key].toLowerCase()).join('; ')}.`
}

/** SC-44 plan change workflow (FR-PLN-007/008): stages, checklist, filings, notice, transitions and the approval bar. */
export function ChangePage({ planId, version: number }: { readonly planId: string; readonly version: number }) {
  const data = usePlanData(planId, number)
  const governance = useKeptData(useResource<Governance>(`${versionApi(planId, number)}/governance`))
  const failure = data.plan.error ?? data.version.error ?? governance.error
  const reload = () => [data.plan, data.version, governance].forEach((r) => r.reload())
  if (failure !== null) return <LoadFailure error={failure} onRetry={reload} />
  if (data.plan.data === null || data.version.data === null || governance.data === null) return <LoadingState label="Loading the plan change workflow" />
  return <ChangeScreen plan={data.plan.data} version={data.version.data} governance={governance.data} data={data} reload={reload} />
}

interface ChangeScreenProps {
  readonly plan: PlanDetail
  readonly version: VersionView
  readonly governance: Governance
  readonly data: PlanData
  readonly reload: () => void
}

function ChangeScreen({ plan, version, governance, data, reload }: ChangeScreenProps) {
  const { can, readOnly } = useSession()
  const [refusal, setRefusal] = useState<unknown>(null)
  const [recording, setRecording] = useState<FilingTarget | null>(null)
  const markets: readonly Market[] | null = data.markets.data
  const zone = calendarZone(plan.calendars[0]?.id, plan.calendars, markets)
  const scope: DraftScope = { plan, version, canEdit: version.state === 'draft' && can('plan.edit') && !readOnly, reload }
  const names: RefusalNames = {
    calendar: (id) => plan.calendars.find((c) => c.id === id)?.name ?? 'a plan calendar',
    market: (id) => plan.markets.find((m) => m.id === id)?.code ?? 'a plan market',
  }
  const mayRecord = !readOnly && can('plan.approve') && (version.state === 'in_review' || version.state === 'approved')
  return (
    <div className="flex flex-col gap-space-md pb-56 md:pb-28">
      <PageHeader
        breadcrumbs={[{ label: 'Plans', href: '/plans' }, { label: plan.name }, { label: `Version ${version.version}`, href: versionPage(plan.id, version.version) }, { label: 'Change workflow' }]}
        eyebrow={`${plan.name} · version ${version.version}`}
        title="Plan change workflow"
        state={<StatusBadge state={version.state} label={STATE_LABELS[version.state]} />}
        summary="A plan change is simulated, reviewed by compliance, filed where a market requires it, announced with notice, and scheduled by a Finance approver."
        actions={<LinkButton href={versionPage(plan.id, version.version)} icon="arrow_back">Back to the version</LinkButton>}
      />
      {refusal !== null && <RefusalBanner error={refusal} names={names} />}
      <Stepper label="Plan change stages" steps={changeSteps(governance, zone)} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
        <div className="lg:col-span-8 flex flex-col gap-space-md min-w-0">
          <Checklist governance={governance} />
          <Filings governance={governance} onRecord={mayRecord ? (market) => setRecording({ planId: plan.id, version: version.version, market }) : undefined} />
          <TransitionsCard plan={plan} version={version} firstRunId={governance.first_run_id} />
        </div>
        <div className="lg:col-span-4 flex flex-col gap-space-md min-w-0">
          <NoticeCard governance={governance} />
          <ApprovalsCard governance={governance} />
        </div>
      </div>
      <GovernanceBar scope={scope} names={names} markets={markets} onRefused={setRefusal} scheduleNote={scheduleNote(governance)} />
      {recording !== null && <FilingDialog target={recording} onClose={() => setRecording(null)} onRecorded={() => { setRecording(null); reload() }} />}
    </div>
  )
}
