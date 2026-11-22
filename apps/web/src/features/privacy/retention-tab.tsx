'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { Select, TextInput } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { ErrorState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { countLabel, formatDateTime, formatDay } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { utcToday } from '../cases/format'
import { tableError, usePagedList } from '../admin/resource'
import { MONO, NOTE, ROW_ACTIONS, SECTION_CARD, SectionTitle } from '../admin/ui'
import {
  RETENTION_RUNS_PATH, RETENTION_SCHEDULES_PATH, type DataClass, type RetentionPreview, type RetentionRun, type RetentionSchedule,
} from './types'

/** The API's bounds on retain_days (D-V1A-08). */
const RETAIN_DAYS_MAX = 3650
const ALL_MARKETS = ''

export const DATA_CLASS_LABELS: Readonly<Record<DataClass, string>> = {
  privacy_request: 'Closed privacy requests',
  terminated_participant: 'Terminated members',
}
const DATA_CLASS_HELP: Readonly<Record<DataClass, string>> = {
  privacy_request: 'Clears the sealed requester and correction details and deletes the data export; the request record stays.',
  terminated_participant: 'Erases (pseudonymises) members with no live position, counted from their latest termination.',
}
const STATE_BADGES: Readonly<Record<RetentionSchedule['state'], { readonly state: string; readonly label: string }>> = {
  proposed: { state: 'awaiting_approval', label: 'Waiting for a second DPO' },
  approved: { state: 'approved', label: 'Approved' },
  rejected: { state: 'rejected', label: 'Rejected' },
}

const userName = (user: { readonly display_name: string | null } | null, myId: string, id?: string): string =>
  user === null ? '—' : id === myId ? 'You' : user.display_name ?? 'Another user'

/** POST /v1/retention/schedules: a proposal another privacy manager approves (no default period, DEC-14). */
function ProposeDialog({ markets, onClose, onDone }: { readonly markets: readonly Market[]; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [values, setValues] = useState({ dataClass: '', market: ALL_MARKETS, days: '', basis: '', from: utcToday() })
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const ids = { data_class: 'schedule-class', market_id: 'schedule-market', retain_days: 'schedule-days', basis: 'schedule-basis', effective_from: 'schedule-from' }
  const set = (field: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [field]: value }))
  function submit(idempotencyKey: string) {
    const days = Number(values.days)
    const found = {
      [ids.data_class]: values.dataClass === '' ? 'Choose the data class.' : null,
      [ids.retain_days]: Number.isInteger(days) && days >= 1 && days <= RETAIN_DAYS_MAX ? null : `Enter whole days from 1 to ${RETAIN_DAYS_MAX}.`,
      [ids.basis]: requiredError('the legal basis', values.basis),
      [ids.effective_from]: values.from === '' ? 'Enter the date it applies from.' : values.from < utcToday() ? 'Choose today (UTC) or a later date.' : null,
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    const body = {
      data_class: values.dataClass, market_id: values.market === ALL_MARKETS ? null : values.market, retain_days: days, basis: values.basis.trim(), effective_from: values.from,
    }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        await api.post(RETENTION_SCHEDULES_PATH, body, { idempotencyKey })
        toast({ message: 'Schedule proposed. Another privacy manager must approve it.' })
        onDone()
      },
    }
  }
  const chosen = values.dataClass === '' ? null : values.dataClass as DataClass
  return (
    <FormDialog title="Propose a retention schedule" submitLabel="Propose schedule" onClose={onClose} onSubmit={submit}>
      <p>Another privacy manager approves the schedule. A change is a new schedule from its own date; nothing is deleted until one is approved and in force.</p>
      <Select id={ids.data_class} label="Data class" placeholder="Choose a data class" value={values.dataClass} error={errors[ids.data_class]}
        helper={chosen === null ? undefined : DATA_CLASS_HELP[chosen]}
        options={(Object.keys(DATA_CLASS_LABELS) as DataClass[]).map((value) => ({ value, label: DATA_CLASS_LABELS[value] }))} onChange={(event) => set('dataClass')(event.target.value)} />
      <Select id={ids.market_id} label="Market" value={values.market} helper="A market's own schedule wins over the one for all markets."
        options={[{ value: ALL_MARKETS, label: 'All markets' }, ...markets.map((market) => ({ value: market.id, label: `${market.code} · ${market.name}` }))]}
        onChange={(event) => set('market')(event.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
        <TextInput id={ids.retain_days} label="Keep for (days)" inputMode="numeric" value={values.days} error={errors[ids.retain_days]} onChange={(event) => set('days')(event.target.value)} />
        <TextInput id={ids.effective_from} label="Applies from" type="date" min={utcToday()} helper="A UTC date: the server's today or later." value={values.from} error={errors[ids.effective_from]} onChange={(event) => set('from')(event.target.value)} />
      </div>
      <TextAreaField id={ids.basis} label="Legal basis" helper="The law or policy that sets this period." value={values.basis} error={errors[ids.basis]} onChange={set('basis')} />
    </FormDialog>
  )
}

type Decision = { readonly kind: 'approve' | 'reject'; readonly schedule: RetentionSchedule }

/** POST …/decision (privacy.manage, step-up through ApiProvider): the proposer is refused (SOD_SELF_APPROVAL, shown here). */
function DecisionDialog({ decision, onClose, onDone }: { readonly decision: Decision; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [note, setNote] = useState('')
  const { kind, schedule } = decision
  const title = `${kind === 'approve' ? 'Approve' : 'Reject'} the ${DATA_CLASS_LABELS[schedule.data_class].toLowerCase()} schedule`
  function submit(idempotencyKey: string) {
    const body = note.trim() === '' ? { decision: kind } : { decision: kind, note: note.trim() }
    return {
      items: [],
      fieldIds: { note: 'schedule-note' },
      send: async () => {
        await api.post(`${RETENTION_SCHEDULES_PATH}/${schedule.id}/decision`, body, { idempotencyKey })
        toast({ message: kind === 'approve' ? 'Schedule approved.' : 'Schedule rejected.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={title} submitLabel={kind === 'approve' ? 'Approve schedule' : 'Reject schedule'} submitVariant={kind === 'approve' ? 'primary' : 'destructive-solid'}
      onClose={onClose} onSubmit={submit}>
      <p>
        {schedule.market?.code ?? 'All markets'}: keep for {countLabel(schedule.retain_days, 'day')} from {formatDay(schedule.effective_from)}. Basis: {schedule.basis}
      </p>
      {kind === 'approve' && <p className={NOTE}>Once in force, the daily retention job applies it. Preview what is due first. You may be asked for a code from your authenticator app.</p>}
      <TextAreaField id="schedule-note" label="Note" optional value={note} onChange={setNote} />
    </FormDialog>
  )
}

/** GET …/preview: due and held counts and up to 20 due items; the same SQL as the job, nothing written. */
function PreviewDrawer({ schedule, onClose }: { readonly schedule: RetentionSchedule; readonly onClose: () => void }) {
  const preview = useResource<RetentionPreview>(`${RETENTION_SCHEDULES_PATH}/${schedule.id}/preview`)
  const data = preview.data
  return (
    <Drawer open onClose={onClose} icon="preview" title="What this schedule would apply now"
      description={`${DATA_CLASS_LABELS[schedule.data_class]} · ${schedule.market?.code ?? 'All markets'} · ${countLabel(schedule.retain_days, 'day')}`}>
      {preview.error !== null && <ErrorState message={errorMessage(preview.error)} onRetry={preview.reload} />}
      {preview.error === null && data === null && <LoadingState label="Counting what is due" />}
      {data !== null && (
        <div className="flex flex-col gap-space-md" data-testid="retention-preview">
          <div className="grid grid-cols-2 gap-space-sm">
            <KpiCard label="Due" icon="auto_delete" value={String(data.due)} detail="Applied by the next run" />
            <KpiCard label="Held" icon="gavel" value={String(data.held)} detail="Skipped: legal hold" />
          </div>
          {data.sample.length === 0
            ? <p className={NOTE}>Nothing is due today.</p>
            : (
              <ul className="flex flex-col gap-space-xs" aria-label="Due items (first 20)">
                {data.sample.map((item) => (
                  <li key={item.object_id} className="flex items-center justify-between gap-space-sm py-space-xs border-b border-outline-variant/40">
                    <span className={NOTE}>{item.object_type === 'participant' ? 'Member' : 'Privacy request'}</span>
                    <Link className={`${MONO} text-primary hover:underline`} href={item.object_type === 'participant' ? `/people/${item.object_id}` : `/privacy/${item.object_id}`}>{item.ref}</Link>
                  </li>
                ))}
              </ul>
            )}
          <p className={NOTE}>Shows at most 20 due items. Members with open payables, payouts or outstanding credits are deferred by the run and logged.</p>
        </div>
      )}
    </Drawer>
  )
}

function RunLog() {
  const runs = usePagedList<RetentionRun>(RETENTION_RUNS_PATH)
  const columns: readonly DataTableColumn<RetentionRun>[] = [
    { key: 'class', header: 'Schedule', cell: (run) => DATA_CLASS_LABELS[run.data_class] },
    { key: 'started', header: 'Run at', cell: (run) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(run.started_at)}</span> },
    { key: 'due', header: 'Due', align: 'end', cell: (run) => <span className={MONO}>{run.due}</span> },
    { key: 'applied', header: 'Applied', align: 'end', cell: (run) => <span className={MONO}>{run.applied}</span> },
    { key: 'held', header: 'Held', align: 'end', cell: (run) => <span className={MONO}>{run.held}</span> },
    { key: 'deferred', header: 'Deferred', align: 'end', cell: (run) => <span className={MONO}>{run.deferred}</span> },
  ]
  return (
    <section className={SECTION_CARD} aria-labelledby="retention-runs-title">
      <SectionTitle id="retention-runs-title" icon="history" title="Run log" />
      <p className={NOTE}>Each daily run of an in-force schedule: items applied, skipped for a legal hold, or deferred (money or credits still owed).</p>
      <DataTable bare caption="Retention runs" columns={columns} rows={runs.rows} rowKey={(run) => run.id} loading={runs.loading}
        error={tableError(runs)} empty={{ title: 'No retention run yet' }} pagination={runs.pagination} stackOnPhone />
    </section>
  )
}

/** SC-15 Retention tab (FR-PRV-003, D-V1A-08): schedules (propose, second-person decision, dry run) and the run log. */
export function RetentionTab() {
  const { me, readOnly } = useSession()
  const schedules = useResource<RetentionSchedule[]>(RETENTION_SCHEDULES_PATH)
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [proposing, setProposing] = useState(false)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [previewed, setPreviewed] = useState<RetentionSchedule | null>(null)
  const done = () => {
    setProposing(false)
    setDecision(null)
    schedules.reload()
  }
  const rows = schedules.data ?? []
  const inForce = rows.filter((row) => row.in_force).length
  const waiting = rows.filter((row) => row.state === 'proposed').length
  const columns: readonly DataTableColumn<RetentionSchedule>[] = [
    {
      key: 'class', header: 'Data class', cell: (row) => (
        <div className="flex flex-col"><span className="font-semibold text-on-surface">{DATA_CLASS_LABELS[row.data_class]}</span><span className={`${MONO} text-secondary`}>{row.market?.code ?? 'All markets'}</span></div>
      ),
    },
    { key: 'days', header: 'Keep for', cell: (row) => <span className={MONO}>{countLabel(row.retain_days, 'day')}</span> },
    { key: 'from', header: 'From', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDay(row.effective_from)}</span> },
    { key: 'basis', header: 'Basis', cell: (row) => <span className={NOTE}>{row.basis}</span> },
    {
      key: 'state', header: 'State', cell: (row) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge {...STATE_BADGES[row.state]} />
          {row.in_force && <StatusBadge state="active" label="In force" />}
        </span>
      ),
    },
    {
      key: 'people', header: 'Proposed / decided', cell: (row) => (
        <div className="flex flex-col">
          <span>{userName(row.proposed_by, me.user.id, row.proposed_by.id)}</span>
          {row.approver !== null && <span className={NOTE}>{row.state === 'approved' ? 'Approved' : 'Decided'} by {userName(row.approver, me.user.id, row.approver.id)}</span>}
          {row.state === 'proposed' && row.proposed_by.id === me.user.id && <span className={NOTE}>Another privacy manager must decide.</span>}
        </div>
      ),
    },
    {
      key: 'actions', header: 'Actions', align: 'end', cell: (row) => {
        const label = `${DATA_CLASS_LABELS[row.data_class]} ${row.market?.code ?? 'all markets'}`
        return (
          <div className={ROW_ACTIONS}>
            {row.state !== 'rejected' && <Button size="sm" icon="preview" aria-label={`Preview ${label}`} onClick={() => setPreviewed(row)}>Preview</Button>}
            {!readOnly && row.state === 'proposed' && <Button size="sm" variant="destructive" aria-label={`Reject ${label}`} onClick={() => setDecision({ kind: 'reject', schedule: row })}>Reject</Button>}
            {!readOnly && row.state === 'proposed' && <Button size="sm" icon="verified_user" aria-label={`Approve ${label}`} onClick={() => setDecision({ kind: 'approve', schedule: row })}>Approve</Button>}
          </div>
        )
      },
    },
  ]
  return (
    <div className="flex flex-col gap-space-md">
      <section className={SECTION_CARD} aria-labelledby="retention-title">
        <SectionTitle id="retention-title" icon="auto_delete" title="Retention schedules"
          action={readOnly || markets.data === null ? undefined : <Button variant="primary" icon="add_circle" data-testid="retention-propose" onClick={() => setProposing(true)}>Propose schedule</Button>} />
        <p className={NOTE}>
          {schedules.data === null
            ? 'How long each data class is kept per market; nothing is deleted without an approved schedule in force.'
            : `${countLabel(inForce, 'schedule')} in force, ${waiting} waiting for a decision. Nothing is deleted without an approved schedule in force; members under a legal hold are skipped.`}
        </p>
        <DataTable bare caption="Retention schedules" columns={columns} rows={rows} rowKey={(row) => row.id} loading={schedules.loading}
          error={tableError(schedules)} empty={{ title: 'No retention schedule yet: no data is deleted on a timer' }} stackOnPhone />
      </section>
      {markets.error !== null && <ErrorState section message={`Markets could not be loaded, so no schedule can be proposed. ${errorMessage(markets.error)}`} onRetry={markets.reload} />}
      <RunLog />
      {proposing && markets.data !== null && <ProposeDialog markets={markets.data} onClose={() => setProposing(false)} onDone={done} />}
      {decision !== null && <DecisionDialog decision={decision} onClose={() => setDecision(null)} onDone={done} />}
      {previewed !== null && <PreviewDrawer schedule={previewed} onClose={() => setPreviewed(null)} />}
    </div>
  )
}
