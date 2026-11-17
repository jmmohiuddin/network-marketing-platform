'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { Select, TextInput } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { TabPanel, Tabs } from '../../components/tabs'
import { useToast } from '../../components/toast'
import { countLabel } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure, useTabParam } from '../admin/page-states'
import { CompareTab } from './compare-tab'
import { CREDITING_LABELS, currencyOf, delta, effectiveText, money, simulationPage, STATE_LABELS, versionApi, versionPage } from './format'
import { GoldensTab } from './goldens-tab'
import { GovernanceBar } from './governance'
import { GuardrailsTab } from './guardrails-tab'
import { RulesTab, type DraftScope } from './rules-tab'
import { RunSimulationDialog, SIMULATIONS_PATH, SimulationsTab } from './simulations'
import { TransitionsTab } from './transitions-tab'
import type { CreditingEvent, PlanDetail, PlanSummary, SimulationDetail, VersionView } from './types'
import { CAPTION, CARD, MONO, NOTE, RefusalBanner, ifMatch, reloadedIfStale, usePlanData, type PlanData, type RefusalNames } from './ui'

const TABS = [
  { id: 'rules', label: 'Rules' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'compare', label: 'Compare' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'goldens', label: 'Golden datasets' },
  { id: 'simulations', label: 'Simulations' },
] as const
const WIDTH_MIN = 2
const WIDTH_MAX = 20

/** Draft fields saved by PATCH with If-Match: crediting event (required at submit) and placement width (2..20 or none). */
function DraftFields({ scope, onRefused }: { readonly scope: DraftScope; readonly onRefused: (error: unknown) => void }) {
  const api = useApi()
  const toast = useToast()
  const { version } = scope
  const [crediting, setCrediting] = useState<string>(version.crediting_event ?? '')
  const [width, setWidth] = useState(version.placement_width === null ? '' : String(version.placement_width))
  const [widthError, setWidthError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault()
    const parsed = width.trim() === '' ? null : Number(width)
    const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < WIDTH_MIN || parsed > WIDTH_MAX)
    setWidthError(invalid ? `Enter a whole number from ${WIDTH_MIN} to ${WIDTH_MAX}, or leave it empty.` : null)
    if (invalid) return
    setBusy(true)
    onRefused(null)
    try {
      await api.patch(versionApi(scope.plan.id, version.version), { crediting_event: crediting === '' ? null : (crediting as CreditingEvent), placement_width: parsed }, { headers: ifMatch(version) })
      toast({ message: 'Draft fields saved.' })
      scope.reload()
    } catch (error) {
      onRefused(reloadedIfStale(error, scope.reload))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-space-sm" onSubmit={save} noValidate aria-label="Draft fields">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-space-sm items-end">
        <Select label="Crediting event" value={crediting} placeholder="Choose when an order counts" options={Object.entries(CREDITING_LABELS).map(([value, label]) => ({ value, label }))} onChange={(event) => setCrediting(event.target.value)} />
        <TextInput label="Placement width" optional inputMode="numeric" value={width} error={widthError} helper="Legs per position for automatic placement." onChange={(event) => setWidth(event.target.value)} />
        <Button type="submit" icon="save" loading={busy}>Save draft fields</Button>
      </div>
    </form>
  )
}

/** sc_04 "State & Baseline Badges Row": the version's fields as they are. */
function Facts({ plan, version, markets }: { readonly plan: PlanSummary; readonly version: VersionView; readonly markets: readonly Market[] | null }) {
  const open = Object.values(version.gates).filter((ok) => !ok).length
  const fact = (label: string, value: string) => (
    <div className="flex items-center gap-1.5">
      <span className={CAPTION}>{label}:</span>
      <span className={`px-2 py-0.5 rounded bg-surface-container text-on-surface-variant ${MONO}`}>{value}</span>
    </div>
  )
  return (
    <div className="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-low px-space-sm py-1.5 rounded">
      <div className="flex flex-wrap items-center gap-space-md">
        {fact('Effective from', version.effective_from === null ? 'Not scheduled' : effectiveText(version.effective_from, plan.calendars, markets))}
        {fact('Crediting event', version.crediting_event === null ? 'Not set' : CREDITING_LABELS[version.crediting_event])}
        {fact('Placement width', version.placement_width === null ? 'Not set' : String(version.placement_width))}
        {fact('Engine', version.engine_version)}
      </div>
      {open > 0 && <StatusBadge state="blocked" label={`${countLabel(open, 'check')} open`} />}
    </div>
  )
}

/** KPI cards: rules, goldens, guardrails, and the newest completed simulation's total ("Simulated", BR-HON-01). */
function Kpis({ plan, version, data }: { readonly plan: PlanDetail; readonly version: VersionView; readonly data: PlanData }) {
  const passing = version.goldens.filter((g) => g.last_result?.status === 'pass').length
  // version.simulations is newest first.
  const latest = version.simulations.find((s) => s.state === 'completed')
  const detail = useResource<SimulationDetail>(latest === undefined ? null : `${SIMULATIONS_PATH}/${latest.id}`)
  const currency = currencyOf(latest?.period.calendar_id, plan.calendars, data.markets.data)
  const totals = detail.data?.totals ?? null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Rules" value={String(version.rules.length)} icon="rule" detail={version.validation.ok ? 'No validation errors' : countLabel(version.validation.errors.length, 'validation error')} />
      <KpiCard label="Golden datasets" value={`${passing} / ${version.goldens.length}`} icon="fact_check" detail="Passing on their last run" />
      <KpiCard label="Guardrail decisions open" value={String(version.guardrails.outstanding.length)} icon="security_update_warning" detail={countLabel(version.guardrails.decisions.length, 'decision')} />
      <KpiCard label="Simulated payout total" value={totals === null ? null : money(totals.simulated_minor, currency)} icon="calculate"
        detail={totals !== null ? (totals.baseline_minor === null ? 'No committed run to compare with' : `Committed run: ${money(totals.baseline_minor, currency)}`)
          : latest === undefined ? 'No completed simulation yet' : detail.error !== null ? 'The total could not be loaded' : 'Loading the total'}
        delta={totals?.delta_minor == null ? undefined : `${delta(totals.delta_minor, currency)} against the committed run`} />
    </div>
  )
}

/** SC-04 plan version: header, fields, KPIs, tabs and the governance bar. */
export function VersionPage({ planId, version: number }: { readonly planId: string; readonly version: number }) {
  const data = usePlanData(planId, number)
  const { plan, version } = data
  if (plan.error !== null || version.error !== null) {
    const error = plan.error ?? version.error
    return <LoadFailure error={error} onRetry={() => { plan.reload(); version.reload() }} />
  }
  if (plan.data === null || version.data === null) return <LoadingState label="Loading the plan version" />
  return <VersionScreen plan={plan.data} version={version.data} data={data} />
}

function VersionScreen({ plan, version, data }: { readonly plan: PlanDetail; readonly version: VersionView; readonly data: PlanData }) {
  const router = useRouter()
  const { can, readOnly } = useSession()
  const [tab, selectTab] = useTabParam(TABS)
  const [refusal, setRefusal] = useState<unknown>(null)
  const [simulating, setSimulating] = useState(false)
  const reload = () => {
    data.version.reload()
    data.plan.reload()
  }
  const scope: DraftScope = { plan, version, canEdit: version.state === 'draft' && can('plan.edit') && !readOnly, reload }
  const names: RefusalNames = {
    calendar: (id) => plan.calendars.find((c) => c.id === id)?.name ?? 'a plan calendar',
    market: (id) => plan.markets.find((m) => m.id === id)?.code ?? 'a plan market',
  }
  const canSimulate = can('plan.simulate') && can('period.read') && !readOnly
  return (
    <div className="flex flex-col gap-space-md pb-56 md:pb-28">
      <PageHeader
        breadcrumbs={[{ label: 'Plans', href: '/plans' }, { label: plan.name }, { label: `Version ${version.version}` }]}
        eyebrow={`Version ${version.version}`}
        title={plan.name}
        state={<StatusBadge state={version.state} label={STATE_LABELS[version.state]} />}
        summary={`${plan.markets.map((m) => m.code).join(', ')} · ${plan.calendars.map((c) => c.name).join(', ')}. Rules, golden datasets and simulations of this version; a second person approves and a Finance approver schedules it.`}
        actions={(
          <>
            <LinkButton href={`${versionPage(plan.id, version.version)}/caps`} icon="tune">Caps and pools</LinkButton>
            {canSimulate && <Button variant="primary" icon="play_arrow" data-testid="primary-action" onClick={() => setSimulating(true)}>Run simulation</Button>}
          </>
        )}
      />
      {refusal !== null && <RefusalBanner error={refusal} names={names} />}
      <section className={CARD} aria-label="Version fields" data-testid="card">
        <Facts plan={plan} version={version} markets={data.markets.data} />
        {scope.canEdit && <DraftFields key={version.revision} scope={scope} onRefused={setRefusal} />}
        {version.state !== 'draft' && version.justification !== null && <p className={NOTE}>Justification: {version.justification}</p>}
      </section>
      {version.state === 'draft' && !version.validation.ok && <Banner tone="warning">The draft has validation errors, so it cannot be simulated or submitted. See the Rules tab.</Banner>}
      <Kpis plan={plan} version={version} data={data} />
      <div>
        <Tabs label="Plan version views" idPrefix="version" tabs={TABS} selected={tab} onSelect={selectTab} />
        <TabPanel idPrefix="version" tabId={tab}>
          {tab === 'rules' && <RulesTab scope={scope} />}
          {tab === 'transitions' && <TransitionsTab scope={scope} />}
          {tab === 'compare' && <CompareTab plan={plan} version={version.version} />}
          {tab === 'guardrails' && <GuardrailsTab scope={scope} />}
          {tab === 'goldens' && <GoldensTab scope={scope} data={data} canSimulate={can('plan.simulate') && !readOnly} />}
          {tab === 'simulations' && <SimulationsTab plan={plan} version={version} markets={data.markets.data} />}
        </TabPanel>
      </div>
      <GovernanceBar scope={scope} names={names} markets={data.markets.data} onRefused={setRefusal} />
      {simulating && (
        <RunSimulationDialog plan={plan} versionId={version.id} onClose={() => setSimulating(false)}
          onCreated={(simulation) => router.push(simulationPage(plan.id, version.version, simulation.id))} />
      )}
    </div>
  )
}
