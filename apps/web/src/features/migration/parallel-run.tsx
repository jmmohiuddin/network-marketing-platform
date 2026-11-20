'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, FOCUS_RING } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { RadioGroup, Select, TextInput } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { useToast } from '../../components/toast'
import { ApiError, newIdempotencyKey } from '../../lib/api'
import { countLabel, formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource, type Resource } from '../../lib/use-resource'
import { tableError, usePagedList } from '../admin/resource'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { withApprovers } from '../admin/settings/labels'
import { NOTE, Panel } from '../data/ui'
import { marketMoney, signedMoney } from '../periods/format'
import { isBonus, PLANS_PATH, versionApi } from '../plans/format'
import type { PlanSummary, VersionView } from '../plans/types'
import { CLASS_LABELS, MIGRATIONS_PATH, RUN_STATE_LABELS } from './format'
import type { Difference, DifferenceClass, Migration, ParallelRun } from './types'

type MoneyMarket = Pick<Market, 'currency' | 'minor_unit'> | undefined

export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'mismatches', label: 'Mismatches' },
  { value: 'rounding', label: 'Rounding' },
  { value: 'rule', label: 'Rule' },
  { value: 'data', label: 'Data' },
  { value: 'unexplained', label: 'Unexplained' },
] as const
type Filter = (typeof FILTERS)[number]['value']

const CLASS_OPTIONS = [
  { value: 'rounding', label: 'Rounding', helper: 'The legacy system rounds differently.' },
  { value: 'rule', label: 'Rule', helper: 'The legacy plan pays a rule the platform plan does not have, or differently.' },
  { value: 'data', label: 'Data', helper: 'The legacy data or the migrated data differ.' },
] as const

export const runsPath = (migration: Migration): string => `${MIGRATIONS_PATH}/${migration.id}/parallel-runs`
const differencesPath = (migration: Migration, run: ParallelRun): string => `${runsPath(migration)}/${run.id}/differences`
const BLANK_TYPE = 'no bonus type'

/** The batch's legacy bonus types of the cutover month that the run's bonus map does not name ('' = lines without one). */
export function unmappedTypes(migration: Migration, run: ParallelRun): string[] {
  return migration.legacy_bonus_types.filter((type) => !Object.hasOwn(run.bonus_map, type))
}

/**
 * Bonus rule keys of the plan version in force for the market (plan.read).
 * shortcut: the plan's current version stands in for the version in force at the cutover period; they differ only once a
 * later version is scheduled, and the API refuses an unknown key (RULE_UNKNOWN) either way.
 */
function useRuleKeys(marketId: string): { readonly keys: readonly string[] | null; readonly failed: boolean } {
  const plans = useResource<PlanSummary[]>(PLANS_PATH)
  const plan = plans.data?.find((p) => p.current_version !== null && p.markets.some((m) => m.id === marketId))
  const version = useResource<VersionView>(plan === undefined ? null : versionApi(plan.id, plan.current_version!.version))
  const keys = version.data?.rules.filter((rule) => isBonus(rule.kind)).map((rule) => rule.rule_key) ?? null
  return { keys, failed: plans.error !== null || version.error !== null || (plans.data !== null && plan === undefined) }
}

/**
 * The bonus map editor (each legacy bonus type of the batch's cutover month → a plan rule key, prefilled from the last
 * run's map) and Run comparison (migration.manage). Lines without a bonus type cannot be mapped: they compare per payee.
 */
function BonusMap({ migration, latest, onRequested }: {
  readonly migration: Migration
  readonly latest: ParallelRun | undefined
  readonly onRequested: () => void
}) {
  const api = useApi()
  const toast = useToast()
  const rules = useRuleKeys(migration.market.id)
  const types = migration.legacy_bonus_types.filter((type) => type !== '')
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(types.map((type) => [type, latest?.bonus_map[type] ?? ''])))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One Idempotency-Key per attempt at the same map: a retry after a lost response replays instead of superseding.
  const [attempt, setAttempt] = useState<{ readonly body: string; readonly key: string } | null>(null)
  const choose = (type: string, rule: string) => setChosen((current) => ({ ...current, [type]: rule }))
  async function run() {
    const body = { bonus_map: Object.fromEntries(types.flatMap((type) => (chosen[type]!.trim() === '' ? [] : [[type, chosen[type]!.trim()]]))) }
    const sent = JSON.stringify(body)
    const key = attempt?.body === sent ? attempt.key : newIdempotencyKey()
    setAttempt({ body: sent, key })
    setBusy(true)
    setProblem(null)
    try {
      await api.post(runsPath(migration), body, { idempotencyKey: key })
      toast({ message: 'Comparison started.', tone: 'success' })
      onRequested()
    } catch (error) {
      const keys = error instanceof ApiError ? ((error.details ?? {}) as { rule_keys?: readonly string[] }).rule_keys : undefined
      setProblem(`${errorMessage(error)}${keys === undefined ? '' : ` Unknown: ${keys.join(', ')}.`}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Bonus map" className="flex flex-col gap-space-sm p-space-sm rounded-lg bg-surface-container-low">
      <h3 className="font-body-sm text-body-sm font-semibold text-on-surface">Bonus map</h3>
      {types.length === 0
        ? <p className={NOTE}>The legacy payouts of the cutover month name no bonus type, so every payee is compared at payee level.</p>
        : <p className={NOTE}>Map each legacy bonus type of the cutover month to the plan rule that pays it. Unmapped legacy types are compared per payee with the plan rules no legacy type maps to.</p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-space-xs">
        {types.map((type) => (
          <li key={type}>
            {rules.keys !== null
              ? <Select label={`Plan rule for ${type}`} value={chosen[type]!} placeholder="Not mapped" options={rules.keys.map((key) => ({ value: key, label: key }))} onChange={(event) => choose(type, event.target.value)} />
              : <TextInput label={`Plan rule for ${type}`} value={chosen[type]!} helper={rules.failed ? 'The plan rules could not be read: type the rule key.' : undefined} onChange={(event) => choose(type, event.target.value)} />}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button variant="primary" icon="play_circle" loading={busy} onClick={run}>Run comparison</Button>
      </div>
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
    </section>
  )
}

/** Classify (consultant) a non-zero difference: class and note. Mount only while open. */
function ClassifyDialog({ path, difference, onClose, onDone }: { readonly path: string; readonly difference: Difference; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const [kind, setKind] = useState<DifferenceClass | ''>(difference.class ?? '')
  const [note, setNote] = useState(difference.class_note ?? '')
  const [errors, setErrors] = useState<{ class?: string; note?: string }>({})
  function submit() {
    const found = { ...(kind === '' ? { class: 'Choose the class.' } : {}), ...(note.trim() === '' ? { note: 'Enter why the amounts differ.' } : {}) }
    setErrors(found)
    if (kind === '' || note.trim() === '') return { items: Object.entries(found).map(([field, message]) => ({ fieldId: `classify-${field}`, message })) }
    return {
      items: [], fieldIds: { class: 'classify-class', note: 'classify-note' },
      send: async () => {
        await api.post(`${path}/${difference.id}/classify`, { class: kind, note: note.trim() })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={`Classify the difference of ${payeeOf(difference)}`} submitLabel="Classify" onClose={onClose} onSubmit={submit}>
      <p>Classifying explains nothing by itself: a Finance approver accepts the difference.</p>
      <div id="classify-class" tabIndex={-1}><RadioGroup legend="Class" name="class" options={CLASS_OPTIONS} value={kind} error={errors.class} onChange={(value) => setKind(value as DifferenceClass)} /></div>
      <TextAreaField id="classify-note" label="Note" value={note} error={errors.note} maxLength={1000} onChange={setNote} />
    </FormDialog>
  )
}

/** Accept (migration.signoff, step-up, not the classifier) a classified difference. Mount only while open. */
function AcceptDialog({ path, difference, onClose, onDone }: { readonly path: string; readonly difference: Difference; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const missing = reason.trim() === '' ? 'Enter the reason for accepting it.' : null
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'accept-reason', message: missing }] }
    return {
      items: [], fieldIds: { reason: 'accept-reason' },
      send: async () => {
        try {
          await api.post(`${path}/${difference.id}/accept`, { reason: reason.trim() })
        } catch (failure) {
          throw withApprovers(failure, 'Finance approver')
        }
        onDone()
      },
    }
  }
  return (
    <FormDialog title={`Accept the difference of ${payeeOf(difference)}`} submitLabel="Accept difference" onClose={onClose} onSubmit={submit}>
      <p>Classified as {difference.class === null ? '—' : CLASS_LABELS[difference.class].toLowerCase()}: {difference.class_note}. Acceptance is final. You may be asked for a code from your authenticator app.</p>
      <TextAreaField id="accept-reason" label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

const payeeOf = (d: Difference): string => d.participant?.external_ref ?? d.payee_ref

/** The difference table of one compared run, filtered (keyed by filter, so paging restarts on a change). */
function Differences({ migration, run, filter, market, onChanged }: { readonly migration: Migration; readonly run: ParallelRun; readonly filter: Filter; readonly market: MoneyMarket; readonly onChanged: () => void }) {
  const { me, can, readOnly } = useSession()
  const path = differencesPath(migration, run)
  const list = usePagedList<Difference>(path, { filter })
  const [dialog, setDialog] = useState<{ readonly kind: 'classify' | 'accept'; readonly difference: Difference } | null>(null)
  const current = run.state === 'compared' && migration.state === 'opening_posted' && !readOnly
  const done = () => {
    setDialog(null)
    list.reload()
    onChanged()
  }
  return (
    <>
      <DataTable
        bare
        stackOnPhone
        density="compact"
        caption="Differences by payee and bonus"
        columns={[
          { key: 'payee', header: 'Payee', cell: (d) => <span className="flex flex-col"><span className="font-data-mono-sm text-data-mono-sm font-semibold text-primary">{payeeOf(d)}</span>{d.participant?.display_name != null && <span className="text-secondary">{d.participant.display_name}</span>}</span> },
          { key: 'bonus', header: 'Bonus', cell: (d) => (
            <span className="flex flex-col">
              {d.rule_key === null ? <span className="font-caption text-caption font-semibold px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container w-fit">Payee level</span> : <span className="font-data-mono-sm text-data-mono-sm">{d.rule_key}</span>}
              {d.legacy_bonus_types.length > 0 && <span className="text-secondary">Legacy: {d.legacy_bonus_types.join(', ')}</span>}
            </span>
          ) },
          { key: 'legacy', header: 'Legacy', align: 'end', cell: (d) => marketMoney(d.legacy_minor, market) },
          { key: 'platform', header: 'Platform', align: 'end', cell: (d) => marketMoney(d.platform_minor, market) },
          { key: 'delta', header: 'Delta', align: 'end', cell: (d) => <span className={d.delta_minor === '0' ? 'text-secondary' : 'text-error font-semibold'}>{signedMoney(d.delta_minor, market)}</span> },
          { key: 'class', header: 'Class', cell: (d) => (d.class === null ? '—' : <span className="flex flex-col"><span>{CLASS_LABELS[d.class]}</span>{d.class_note !== null && <span className="text-secondary">{d.class_note}</span>}</span>) },
          { key: 'accepted', header: 'Accepted', cell: (d) => (d.accepted_at !== null ? `Accepted ${formatDateTime(d.accepted_at)}` : d.delta_minor === '0' ? '—' : 'Not accepted') },
          { key: 'actions', header: 'Actions', align: 'end', cell: (d) => {
            const open = current && d.delta_minor !== '0' && d.accepted_at === null
            return (
              <span className="flex justify-end gap-1">
                {open && can('migration.manage') && <Button size="sm" aria-label={`Classify ${payeeOf(d)} ${d.rule_key ?? 'payee level'}`} onClick={() => setDialog({ kind: 'classify', difference: d })}>Classify</Button>}
                {open && can('migration.signoff') && d.classified_by !== null && d.classified_by !== me.user.id && (
                  <Button size="sm" variant="primary" aria-label={`Accept ${payeeOf(d)} ${d.rule_key ?? 'payee level'}`} onClick={() => setDialog({ kind: 'accept', difference: d })}>Accept</Button>
                )}
              </span>
            )
          } },
        ]}
        rows={list.rows}
        rowKey={(d) => d.id}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: filter === 'all' ? 'No payee has an amount on either side.' : 'No difference matches this filter.' }}
        pagination={list.pagination}
      />
      {dialog?.kind === 'classify' && <ClassifyDialog path={path} difference={dialog.difference} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'accept' && <AcceptDialog path={path} difference={dialog.difference} onClose={() => setDialog(null)} onDone={done} />}
    </>
  )
}

/** sc_16 segmented difference filter (six options: wraps on a phone instead of scrolling). */
function FilterPills({ value, onChange }: { readonly value: Filter; readonly onChange: (value: Filter) => void }) {
  return (
    <div role="group" aria-label="Show differences" className="flex flex-wrap items-center bg-surface-container p-0.5 rounded gap-0.5">
      {FILTERS.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
          className={`px-2 py-1 rounded font-caption text-caption ${FOCUS_RING} ${value === option.value ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-sm' : 'text-secondary hover:text-on-surface font-medium'}`}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** The four sc_16 KPI cards of a compared run (page level, above the work area). */
export function RunKpis({ run, market }: { readonly run: ParallelRun; readonly market: MoneyMarket }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-sm" data-testid="kpis">
      <KpiCard label="Legacy total" icon="history_edu" value={marketMoney(run.legacy_total_minor, market)} detail="Legacy payouts of the cutover month" />
      <KpiCard label="Platform total" icon="sync_alt" value={marketMoney(run.platform_total_minor, market)} detail="The plan's calculation of the same period" />
      <KpiCard label="Payees" icon="groups" value={String(run.summary.payees)} detail={`${countLabel(run.summary.zero, 'row')} without a difference`} />
      <KpiCard label="Unexplained" icon="rule" value={String(run.summary.unexplained)} detail={`${countLabel(run.summary.accepted, 'difference')} accepted`} />
    </div>
  )
}

/** SC-16 Parallel run step (D-B6-11): bonus map, Run comparison, filter and difference table; `runs` is newest first. */
export function ParallelRunStep({ migration, market, runs, onChanged }: {
  readonly migration: Migration
  readonly market: MoneyMarket
  readonly runs: Resource<ParallelRun[]>
  readonly onChanged: () => void
}) {
  const { can, readOnly } = useSession()
  const [filter, setFilter] = useState<Filter>('all')
  const latest = runs.data?.[0]
  const compared = latest?.state === 'compared' ? latest : undefined
  const unmapped = compared === undefined ? [] : unmappedTypes(migration, compared)
  const changed = () => {
    runs.reload()
    onChanged()
  }
  const mayRun = migration.state === 'opening_posted' && can('migration.manage') && !readOnly
  return (
    <Panel title="Parallel run" icon="compare_arrows" meta={latest === undefined ? undefined : `${RUN_STATE_LABELS[latest.state]} · requested ${formatDateTime(latest.requested_at)}`}>
      <p className={NOTE}>The cutover period calculated by the plan and compared per payee and bonus with the legacy payouts of the same month. Every non-zero difference is classified and accepted before sign-off.</p>
      {mayRun && runs.data !== null && <BonusMap key={latest?.id ?? 'none'} migration={migration} latest={latest} onRequested={changed} />}
      {runs.error !== null && <Banner tone="danger" action={<Button onClick={runs.reload}>Try again</Button>}>The parallel runs could not be loaded. {errorMessage(runs.error)}</Banner>}
      {runs.data !== null && latest === undefined && <p className={NOTE}>No comparison has run yet.</p>}
      {latest?.state === 'calculating' && <Banner tone="info" title="Calculating">The cutover period is being calculated and compared; this page updates by itself.</Banner>}
      {latest?.state === 'failed' && <Banner tone="danger" title="The comparison failed">The calculation ended with {latest.error?.code ?? 'an error'}. Fix the cause and run the comparison again.</Banner>}
      {compared !== undefined && (
        <>
          {compared.bonus_detail_missing && (
            <Banner tone="warning" title="Legacy file lacks bonus detail">
              Payee-level comparison: legacy amounts of a bonus type the map does not name are compared per payee against the plan rules no legacy type maps to.
              {unmapped.length > 0 && ` Not mapped: ${unmapped.map((type) => type || BLANK_TYPE).join(', ')}. Check the map for a misspelt type, map them and run the comparison again.`}
            </Banner>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
            <h3 className="font-section-heading text-section-heading text-on-surface">Differences</h3>
            <FilterPills value={filter} onChange={setFilter} />
          </div>
          <p className={NOTE} data-testid="differences-summary">
            {countLabel(compared.summary.payees, 'payee')} compared: {countLabel(compared.summary.unexplained, 'difference')} unexplained, {compared.summary.accepted} accepted, {countLabel(compared.summary.zero, 'row')} without a difference.
          </p>
          <Differences key={`${compared.id}:${filter}`} migration={migration} run={compared} filter={filter} market={market} onChanged={changed} />
        </>
      )}
    </Panel>
  )
}
