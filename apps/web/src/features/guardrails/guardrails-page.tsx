'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { FileDropZone } from '../../components/file-drop-zone'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Select } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
import { useCursorPages } from '../../lib/cursor-pages'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { TextAreaField } from '../admin/form-dialog'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError } from '../admin/resource'
import { withApprovers } from '../admin/settings/labels'
import { extensionsOf } from '../markets/format'
import { DocumentLink } from '../markets/gate-inspector'
import { useEvidenceFile } from '../markets/evidence-forms'
import type { DocumentLimits } from '../markets/types'
import { PLANS_PATH, STATE_LABELS, versionPage } from '../plans/format'
import { basisLabel, resolutionText } from '../plans/guardrails-tab'
import type { Decision, PlanSummary } from '../plans/types'

const DECISIONS_PATH = '/v1/guardrail-decisions'
const JUSTIFICATION_MIN = 20
const JUSTIFICATION_MAX = 2000
const JUSTIFICATION_ID = 'override-justification'
const COMPLIANCE = 'Compliance officer'
const CAPTION = 'font-caption text-caption uppercase tracking-wider text-on-surface-variant font-semibold'

const OUTCOMES = [{ value: 'blocked', label: 'Blocked' }, { value: 'warned', label: 'Warned' }, { value: 'reported', label: 'Reported' }]
const KINDS = [{ value: 'evaluation', label: 'Evaluations' }, { value: 'acknowledgement', label: 'Acknowledgements' }, { value: 'override', label: 'Overrides' }]
const FILTER_KEYS = ['outcome', 'kind', 'pack', 'version'] as const
type FilterKey = (typeof FILTER_KEYS)[number]
type Filters = Readonly<Record<FilterKey, string>>

interface Counts { readonly blocked: number; readonly warned: number; readonly reported: number; readonly overridden: number }

/** Filters and the inspected decision live in the URL (UI_UX 4.7). */
function useUrlState(): { filters: Filters; decision: string | null; set: (changes: Readonly<Record<string, string | null>>) => void } {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ''])) as Filters
  const set = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  // Only an id goes into the API path: anything else (dot segments, '?') would reach another endpoint.
  const decision = params.get('decision')
  return { filters, decision: decision !== null && isUuid(decision) ? decision : null, set }
}

/** True when an override may be approved on this decision (FR-CPL-008): an overridable warned or blocked evaluation. */
export function overridable(d: Decision): boolean {
  return d.kind === 'evaluation' && d.outcome !== 'reported' && d.rule.overridable && d.override === null
}

/** Inline override approval inside the inspector (one dialog at a time): justification, optional evidence, step-up. */
function OverrideForm({ decision, onDone }: { readonly decision: Decision; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const limits = useResource<DocumentLimits>('/v1/documents/limits')
  const evidence = useEvidenceFile()
  const [justification, setJustification] = useState('')
  const [key, setKey] = useState(newIdempotencyKey)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    const length = justification.trim().length
    const problem = length < JUSTIFICATION_MIN ? `Write at least ${JUSTIFICATION_MIN} characters on why the override is justified.` : null
    setError(problem)
    if (problem !== null) return
    setBusy(true)
    setFailure(null)
    try {
      const document = evidence.file === null ? null : await evidence.upload(api)
      await api.post(`${DECISIONS_PATH}/${decision.id}/override`, { justification: justification.trim(), ...(document === null ? {} : { evidence_document_id: document.id }) }, { idempotencyKey: key })
      toast({ message: `Override of ${decision.rule.id} approved.` })
      onDone()
    } catch (refusal) {
      setFailure(withApprovers(refusal, COMPLIANCE))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-space-sm p-space-sm rounded bg-surface-container-low" onSubmit={submit} onChange={() => setKey(newIdempotencyKey())} noValidate aria-label="Approve override">
      <span className={CAPTION}>Approve override</span>
      <p className="font-caption text-caption text-on-surface-variant">The rule stays in the plan; the override is logged with your justification. You may be asked for a code from your authenticator app.</p>
      {failure !== null && <Banner tone="danger">{errorMessage(failure)}</Banner>}
      <TextAreaField id={JUSTIFICATION_ID} label="Justification" value={justification} error={error} maxLength={JUSTIFICATION_MAX}
        helper={`${JUSTIFICATION_MIN} to ${JUSTIFICATION_MAX} characters.`} onChange={setJustification} />
      {limits.data !== null && (
        <FileDropZone label="Evidence" optional extensions={extensionsOf(limits.data.types)} maxBytes={limits.data.max_file_bytes}
          onFiles={(files) => {
            evidence.choose(files)
            setKey(newIdempotencyKey())
          }} />
      )}
      {limits.error !== null && <p className="font-caption text-caption text-error">Evidence upload is not available right now. {errorMessage(limits.error)}</p>}
      <Button type="submit" variant="primary" icon="gavel" className="self-end" loading={busy}>Approve override</Button>
    </form>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-space-xxs" aria-label={title}>
      <h3 className={CAPTION}>{title}</h3>
      <div className="p-space-sm bg-surface-container-low rounded flex flex-col gap-space-xs">{children}</div>
    </section>
  )
}

/** sc_11 decision inspector: target, rule and basis, explanation, acknowledgement and override, and the override form. */
function Inspector({ id, onClose, onChanged }: { readonly id: string; readonly onClose: () => void; readonly onChanged: () => void }) {
  const { can, readOnly } = useSession()
  const decision = useResource<Decision>(`${DECISIONS_PATH}/${id}`)
  const d = decision.data
  return (
    <Drawer open onClose={onClose} title={d === null ? 'Guardrail decision' : `${d.rule.id}: ${d.rule.title}`} description={d === null ? undefined : `Decided ${formatDateTime(d.decided_at)}`} icon="gavel">
      {decision.loading && <LoadingState label="Loading the decision" />}
      {decision.error !== null && <LoadFailure error={decision.error} onRetry={decision.reload} section />}
      {d !== null && (
        <>
          <div className="flex flex-wrap items-center gap-space-xs"><StatusBadge state={d.outcome} /><span className="font-caption text-caption text-secondary">{d.kind === 'evaluation' ? 'Evaluation' : d.kind === 'override' ? 'Override' : 'Acknowledgement'}</span></div>
          <Section title="Target">
            <Link className="font-body-sm text-body-sm font-semibold text-primary hover:underline" href={versionPage(d.plan.id, d.version.version)}>{d.plan.name}, version {d.version.version} ({STATE_LABELS[d.version.state]})</Link>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Rules matched: <span className="font-data-mono-sm text-data-mono-sm">{d.detail.rule_keys.join(', ')}</span></p>
          </Section>
          <Section title="Rule and basis">
            <p className="font-body-sm text-body-sm text-on-surface">{d.rule.basis}</p>
            <p className="font-caption text-caption text-on-surface-variant">Basis status: {basisLabel(d.rule.basis_status)} · Market pack: {d.rule.market_pack} · {d.rule.overridable ? 'Can be overridden' : 'Cannot be overridden'}{d.rule.mandatory ? ' · Mandatory' : ''}</p>
            {d.rule.source_ref !== null && <p className="font-caption text-caption text-on-surface-variant">Source reference: {d.rule.source_ref}</p>}
          </Section>
          <Section title="Explanation">
            <p className="font-body-sm text-body-sm text-on-surface">{d.detail.explanation}</p>
            {d.detail.opaque && <p className="font-caption text-caption text-on-surface-variant">An expression or module hides what the rule pays on, so it is routed to compliance review.</p>}
          </Section>
          <Section title="Acknowledgement and override">
            <p className="font-body-sm text-body-sm text-on-surface">{resolutionText(d)}</p>
            {d.override !== null && (
              <>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Justification: {d.override.justification}</p>
                {d.override.evidence_document_id !== null && (
                  <DocumentLink className="font-data-mono-sm text-data-mono-sm text-primary underline" document={{ id: d.override.evidence_document_id, file_name: null }} fallback="Evidence document" />
                )}
              </>
            )}
            <p className="font-caption text-caption text-on-surface-variant">Evaluated for {d.decided_by.display_name ?? 'another user'}&apos;s change on {formatDateTime(d.decided_at)}.</p>
          </Section>
          {can('override.approve') && !readOnly && overridable(d) && (
            <OverrideForm decision={d} onDone={() => {
              decision.reload()
              onChanged()
            }} />
          )}
        </>
      )}
    </Drawer>
  )
}

const columns = (inspect: (id: string) => void): readonly DataTableColumn<Decision>[] => [
  {
    key: 'rule', header: 'Rule and basis', cell: (d) => (
      <span className="flex flex-col"><span className="font-data-mono-sm text-data-mono-sm font-semibold text-primary">{d.rule.id}</span><span className="font-caption text-caption text-on-surface-variant">{basisLabel(d.rule.basis_status)}</span></span>
    ),
  },
  {
    key: 'target', header: 'Target', cell: (d) => (
      <span className="flex flex-col"><span className="font-semibold text-on-surface">{d.plan.name}, version {d.version.version}</span><span className="font-data-mono-sm text-caption text-on-surface-variant">{d.detail.rule_keys.join(', ')}</span></span>
    ),
  },
  { key: 'check', header: 'Check', cell: (d) => <span className="flex flex-col"><span className="font-medium">{d.rule.title}</span><span className="text-on-surface-variant text-caption line-clamp-2">{d.detail.explanation}</span></span> },
  { key: 'pack', header: 'Market pack', cell: (d) => <span className="font-data-mono-sm text-data-mono-sm">{d.rule.market_pack}</span> },
  { key: 'outcome', header: 'Outcome', cell: (d) => <span className="flex flex-col items-start gap-1"><StatusBadge state={d.outcome} /><span className="font-caption text-caption text-secondary">{KINDS.find((k) => k.value === d.kind)?.label.replace(/s$/, '')}</span></span> },
  { key: 'status', header: 'Status', cell: (d) => (d.kind === 'evaluation' ? resolutionText(d) : '—') },
  { key: 'actions', header: 'Actions', align: 'end', cell: (d) => <Button size="sm" aria-label={`Inspect ${d.rule.id} decision of ${d.plan.name} version ${d.version.version}`} onClick={() => inspect(d.id)}>Inspect</Button> },
]

/** SC-11 guardrails and overrides log (FR-CPL-007/008): counts, filters, decisions, inspector with override approval. */
export function GuardrailsPage() {
  const { can } = useSession()
  const { filters, decision, set } = useUrlState()
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  const plans = useResource<readonly PlanSummary[]>(can('plan.read') ? PLANS_PATH : null, { limit: 200 })
  const pages = useCursorPages()
  const packs = [...new Set((markets.data ?? []).map((m) => m.market_pack))].sort()
  const versions = (plans.data ?? []).flatMap((p) => [p.current_version, p.authoring_version].flatMap((v) => (v === null ? [] : [{ value: v.id, label: `${p.name}, version ${v.version}` }])))
  const query = { outcome: filters.outcome || undefined, kind: filters.kind || undefined, market_pack: filters.pack || undefined, plan_version_id: filters.version || undefined }
  const list = useResource<readonly Decision[]>(DECISIONS_PATH, { ...query, cursor: pages.cursor })
  const next = typeof list.meta.next_cursor === 'string' ? list.meta.next_cursor : null
  const counts = (list.meta.counts ?? null) as Counts | null
  const filtered = Object.values(query).some((value) => value !== undefined)
  // A filter change starts again at the first page.
  const setFilters = (changes: Readonly<Record<string, string | null>>) => {
    pages.reset()
    set(changes)
  }
  const labelOf: Readonly<Record<FilterKey, (value: string) => string>> = {
    outcome: (v) => `Outcome: ${OUTCOMES.find((o) => o.value === v)?.label ?? v}`,
    kind: (v) => `Kind: ${KINDS.find((k) => k.value === v)?.label ?? v}`,
    pack: (v) => `Market pack: ${v}`,
    version: (v) => `Plan version: ${versions.find((o) => o.value === v)?.label ?? 'chosen version'}`,
  }
  const chips: FilterChip[] = FILTER_KEYS.filter((key) => filters[key] !== '').map((key) => ({ key, label: labelOf[key](filters[key]), onRemove: () => setFilters({ [key]: null }) }))
  const select = (key: FilterKey, label: string, all: string, options: readonly { value: string; label: string }[]) => (
    <Select label={label} value={filters[key]} options={[{ value: '', label: all }, ...options]} onChange={(event) => setFilters({ [key]: event.target.value })} />
  )
  return (
    <>
      <PageHeader title="Guardrails" summary="Guardrail decisions on plan versions: what each rule matched, and the acknowledgements and overrides that resolved them." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis">
        <KpiCard label="Blocked" value={counts === null ? null : String(counts.blocked)} icon="block" detail={counts === null ? 'Loading' : 'Evaluations matching the filters'} />
        <KpiCard label="Warned" value={counts === null ? null : String(counts.warned)} icon="warning" detail={counts === null ? 'Loading' : 'Evaluations matching the filters'} />
        <KpiCard label="Reported" value={counts === null ? null : String(counts.reported)} icon="flag" detail={counts === null ? 'Loading' : 'Evaluations matching the filters'} />
        <KpiCard label="Overridden" value={counts === null ? null : String(counts.overridden)} icon="gavel" detail={counts === null ? 'Loading' : 'Overrides matching the filters'} />
      </div>
      <FiltersBar label="Filter guardrail decisions" chips={chips} onClear={() => setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}>
        {select('outcome', 'Outcome', 'All outcomes', OUTCOMES)}
        {select('kind', 'Kind', 'All kinds', KINDS)}
        {select('pack', 'Market pack', 'All market packs', packs.map((p) => ({ value: p, label: p })))}
        {can('plan.read') && select('version', 'Plan version', 'All plan versions', versions)}
      </FiltersBar>
      <DataTable caption="Guardrail decisions" columns={columns((id) => set({ decision: id }))} rows={list.data ?? []} rowKey={(d) => d.id} loading={list.loading} error={tableError(list)}
        empty={{ title: filtered ? 'No decision matches these filters.' : 'No guardrail decision yet. Decisions appear when plan rules are saved.' }}
        pagination={{ hasPrevious: pages.hasPrevious, hasNext: next !== null, onPrevious: pages.previous, onNext: () => next !== null && pages.next(next) }} />
      {decision !== null && <Inspector id={decision} onClose={() => set({ decision: null })} onChanged={list.reload} />}
    </>
  )
}
