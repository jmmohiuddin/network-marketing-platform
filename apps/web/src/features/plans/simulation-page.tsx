'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { MeterBar } from '../../components/charts'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { TabPanel, Tabs } from '../../components/tabs'
import { countLabel, formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure, useTabParam } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { downloadCsv, saveFile } from '../data/transfer'
import { periodText } from '../periods/format'
import { BUCKET_LABELS, CAP_METHOD_LABELS, calendarZone, currencyOf, delta, money, simulationPage, versionPage, type Currency } from './format'
import { FreezeDialog, GoldenTable, RunSuiteButton } from './goldens-tab'
import type { DraftScope } from './rules-tab'
import { RunSimulationDialog, SIMULATIONS_PATH, simulationPeriod } from './simulations'
import type { CapEffect, Comparison, PayeeImpact, PlanDetail, SimulationDetail, VersionView } from './types'
import { CARD, CardHead, MONO, NOTE, outstandingText, usePlanData, type PlanData } from './ui'

const TABS = [
  { id: 'payees', label: 'Payee impact' },
  { id: 'bonuses', label: 'By bonus' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'caps', label: 'Cap effects' },
  { id: 'goldens', label: 'Golden datasets' },
] as const

const running = (d: SimulationDetail) => d.simulation.state === 'queued' || d.simulation.state === 'running'

/** Payee impact: per payee baseline, simulated and change, largest change first (GET …/payees?sort=delta, plan.simulate). */
function PayeeImpactTab({ simulationId, currency }: { readonly simulationId: string; readonly currency: Currency | null }) {
  const { can } = useSession()
  const list = usePagedList<PayeeImpact>(`${SIMULATIONS_PATH}/${simulationId}/payees`, { sort: 'delta' })
  const [exporting, setExporting] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  async function exportCsv() {
    setExporting(true)
    setFailure(null)
    try {
      const { blob, filename } = await downloadCsv(`${SIMULATIONS_PATH}/${simulationId}/payees`, { format: 'csv' })
      saveFile(blob, filename)
    } catch (error) {
      setFailure(error)
    } finally {
      setExporting(false)
    }
  }
  const columns: readonly DataTableColumn<PayeeImpact>[] = [
    { key: 'payee', header: 'Payee', cell: (p) => <span className="flex flex-col"><span>{p.participant.display_name}</span><span className={`${MONO} text-secondary`}>{p.participant.external_ref}</span></span> },
    { key: 'baseline', header: 'Baseline', align: 'end', cell: (p) => money(p.baseline_minor, currency) },
    { key: 'simulated', header: 'Simulated', align: 'end', cell: (p) => money(p.simulated_minor, currency) },
    { key: 'delta', header: 'Change', align: 'end', cell: (p) => delta(p.delta_minor, currency) },
    { key: 'rules', header: 'By bonus', cell: (p) => <span className="font-caption text-caption text-secondary">{p.by_rule.map((r) => `${r.rule_key}: ${delta((BigInt(r.simulated_minor) - BigInt(r.baseline_minor)).toString(), currency)}`).join(' · ')}</span> },
  ]
  if (!can('plan.simulate')) return <p className={`${CARD} ${NOTE}`}>Per-payee results need the plan simulation permission. The totals, bonuses and distribution are shown in the other tabs.</p>
  return (
    <section className={CARD} aria-labelledby="payees-title">
      <CardHead id="payees-title" icon="analytics" title="Payee impact" note="Sorted by the size of the change; staff only."
        aside={<Button icon="file_download" loading={exporting} onClick={exportCsv}>Export CSV</Button>} />
      {failure !== null && <Banner tone="danger">The export did not complete. {errorMessage(failure)}</Banner>}
      <DataTable caption="Payee impact" columns={columns} rows={list.rows} rowKey={(p) => p.participant.id} loading={list.loading} error={tableError(list)}
        empty={{ title: 'No payee has a line in the simulation or its baseline.' }} pagination={list.pagination} bare />
    </section>
  )
}

function ByBonusTab({ comparison, currency }: { readonly comparison: Comparison; readonly currency: Currency | null }) {
  const columns: readonly DataTableColumn<Comparison['by_rule'][number]>[] = [
    { key: 'rule', header: 'Bonus', cell: (r) => <span className={MONO}>{r.rule_key}</span> },
    { key: 'baseline', header: 'Baseline', align: 'end', cell: (r) => money(r.baseline_minor, currency) },
    { key: 'simulated', header: 'Simulated', align: 'end', cell: (r) => money(r.simulated_minor, currency) },
    { key: 'delta', header: 'Change', align: 'end', cell: (r) => delta(r.delta_minor, currency) },
  ]
  return (
    <section className={CARD} aria-labelledby="bonuses-title">
      <CardHead id="bonuses-title" icon="schema" title="By bonus" note="Totals per rule; the baseline counts the committed run's regular lines only." />
      <DataTable caption="Totals by bonus" columns={columns} rows={comparison.by_rule} rowKey={(r) => r.rule_key} empty={{ title: 'No line in either run.' }} bare />
    </section>
  )
}

/** sc_42 bucket cards: payees per change bucket, with a bar relative to the largest bucket. */
function DistributionTab({ comparison }: { readonly comparison: Comparison }) {
  const total = comparison.distribution.reduce((sum, b) => sum + b.payees, 0)
  const largest = Math.max(1, ...comparison.distribution.map((b) => b.payees))
  return (
    <section className={CARD} aria-labelledby="distribution-title">
      <CardHead id="distribution-title" icon="bar_chart" title="Distribution of payee changes" note={`${countLabel(total, 'payee')}, each in one bucket by the change against the baseline.`} />
      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {comparison.distribution.map((b) => (
          <li key={b.bucket} className="p-space-sm rounded bg-surface-container-low flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-caption text-caption text-on-surface font-semibold">{BUCKET_LABELS[b.bucket] ?? b.bucket}</span>
              <span className={`${MONO} font-semibold text-on-surface`}>{b.payees.toLocaleString()}</span>
            </div>
            <MeterBar percent={(b.payees / largest) * 100} label={`${BUCKET_LABELS[b.bucket] ?? b.bucket}: ${countLabel(b.payees, 'payee')}`} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function CapEffectsTab({ comparison, currency }: { readonly comparison: Comparison; readonly currency: Currency | null }) {
  const columns: readonly DataTableColumn<CapEffect>[] = [
    { key: 'cap', header: 'Cap', cell: (c) => <span className={MONO}>{c.cap_key}</span> },
    { key: 'method', header: 'Method', cell: (c) => CAP_METHOD_LABELS[c.method] ?? c.method },
    { key: 'base', header: 'Base', align: 'end', cell: (c) => money(c.base_minor, currency) },
    { key: 'cap-amount', header: 'Cap', align: 'end', cell: (c) => money(c.cap_minor, currency) },
    { key: 'proposed', header: 'Before the cap', align: 'end', cell: (c) => money(c.proposed_minor, currency) },
    { key: 'bound', header: 'Bound', cell: (c) => (c.bound ? 'Yes' : 'No') },
    { key: 'affected', header: 'Lines reduced', align: 'end', cell: (c) => String(c.affected.length) },
  ]
  return (
    <section className={CARD} aria-labelledby="caps-title">
      <CardHead id="caps-title" icon="tune" title="Cap effects" note="Amounts each cap removed; removed amounts are not earned." />
      <DataTable caption="Cap effects" columns={columns} rows={comparison.cap_effects} rowKey={(c) => c.cap_key} empty={{ title: 'No cap applied in this period.' }} bare />
    </section>
  )
}

function SimulationScreen({ plan, version, data, detail, onRerun }: {
  readonly plan: PlanDetail; readonly version: VersionView; readonly data: PlanData; readonly detail: SimulationDetail; readonly onRerun: (() => void) | undefined
}) {
  const { can, readOnly } = useSession()
  const [tab, selectTab] = useTabParam(TABS)
  const [freezing, setFreezing] = useState(false)
  const { simulation, totals, comparison, warnings } = detail
  const period = simulationPeriod(version, simulation.id)
  const currency = currencyOf(period?.calendar_id, plan.calendars, data.markets.data)
  const scope: DraftScope = { plan, version, canEdit: version.state === 'draft' && can('plan.edit') && !readOnly, reload: data.version.reload }
  const done = simulation.state === 'completed' && totals !== null && comparison !== null
  return (
    <>
      <Banner tone="info" title="Simulation — staff only, never shown to participants">
        Version {version.version} of {plan.name} on {period === undefined ? 'an ended period' : periodText(period, calendarZone(period.calendar_id, plan.calendars, data.markets.data))}. Nothing is paid, posted or written to the period.
        {done && (comparison.reconciles ? ' The simulated total equals the sum of its lines.' : ' The simulated total does not reconcile with its lines; report this simulation.')}
      </Banner>
      {running(detail) && <LoadingState label="The simulation is calculating. This page updates when it finishes." />}
      {simulation.state === 'failed' && <Banner tone="danger" title="The simulation failed">{simulation.error?.message ?? 'It did not complete.'} {onRerun === undefined ? '' : 'Run a new simulation after fixing the cause.'}</Banner>}
      {warnings.length > 0 && <Banner tone="warning" title="Warnings"><ul className="list-disc pl-space-md">{warnings.map((w) => <li key={`${w.code}-${w.message}`}>{w.message}</li>)}</ul></Banner>}
      {done && comparison.guardrail_flags.length > 0 && (
        <Banner tone="warning" title="Open guardrail decisions">
          <ul className="list-disc pl-space-md">{comparison.guardrail_flags.map((f) => <li key={f.decision_id}>{outstandingText(f)}</li>)}</ul>
        </Banner>
      )}
      {done && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md" data-testid="kpis">
            <KpiCard label="Simulated total" value={money(totals.simulated_minor, currency)} icon="calculate" />
            <KpiCard label="Baseline total" value={totals.baseline_minor === null ? null : money(totals.baseline_minor, currency)} icon="history" detail={totals.baseline_minor === null ? 'The period has no committed run.' : 'Regular lines of the committed run'} />
            <KpiCard label="Change" value={totals.delta_minor === null ? null : delta(totals.delta_minor, currency)} icon="compare_arrows" detail={totals.delta_minor === null ? 'No baseline to compare with.' : undefined} />
            <KpiCard label="Payees changed" value={comparison.payees_changed.toLocaleString()} icon="group" />
          </div>
          <div>
            <Tabs label="Simulation views" idPrefix="simulation" tabs={TABS} selected={tab} onSelect={selectTab} />
            <TabPanel idPrefix="simulation" tabId={tab}>
              {tab === 'payees' && <PayeeImpactTab simulationId={simulation.id} currency={currency} />}
              {tab === 'bonuses' && <ByBonusTab comparison={comparison} currency={currency} />}
              {tab === 'distribution' && <DistributionTab comparison={comparison} />}
              {tab === 'caps' && <CapEffectsTab comparison={comparison} currency={currency} />}
              {tab === 'goldens' && (
                <section className={CARD} aria-labelledby="sim-goldens-title">
                  <CardHead id="sim-goldens-title" icon="rule_settings" title="Golden datasets" note="Golden cases of this version and their last run."
                    aside={(
                      <>
                        {can('plan.simulate') && !readOnly && version.goldens.length > 0 && <RunSuiteButton scope={scope} />}
                        {scope.canEdit && <Button icon="ac_unit" onClick={() => setFreezing(true)}>Save as golden case</Button>}
                      </>
                    )} />
                  <GoldenTable scope={scope} data={data} />
                </section>
              )}
            </TabPanel>
          </div>
        </>
      )}
      {freezing && <FreezeDialog scope={scope} simulationId={simulation.id} onClose={() => setFreezing(false)} />}
      <p className={NOTE}>Requested {formatDateTime(simulation.requested_at)}{simulation.finished_at === null ? '' : `, finished ${formatDateTime(simulation.finished_at)}`}.</p>
    </>
  )
}

/** SC-42 simulation results and golden datasets of one simulation. */
export function SimulationPage({ planId, version: number, simulationId }: { readonly planId: string; readonly version: number; readonly simulationId: string }) {
  const router = useRouter()
  const { can, readOnly } = useSession()
  const data = usePlanData(planId, number)
  const detail = useResource<SimulationDetail>(`${SIMULATIONS_PATH}/${simulationId}`, undefined, running)
  const [rerunning, setRerunning] = useState(false)
  const failed = data.plan.error ?? data.version.error ?? detail.error
  if (failed !== null) return <LoadFailure error={failed} onRetry={() => { data.plan.reload(); data.version.reload(); detail.reload() }} />
  if (data.plan.data === null || data.version.data === null || detail.data === null) return <LoadingState label="Loading the simulation" />
  const plan = data.plan.data
  const version = data.version.data
  // A simulation of another version (or plan) is not shown under this version's name.
  if (detail.data.simulation.plan_version_id !== version.id) return <NotAvailable />
  const canRun = can('plan.simulate') && can('period.read') && !readOnly
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        breadcrumbs={[{ label: 'Plans', href: '/plans' }, { label: plan.name }, { label: `Version ${version.version}`, href: versionPage(plan.id, version.version) }, { label: 'Simulation' }]}
        title={`Simulation of version ${version.version}`}
        display
        state={<StatusBadge state={detail.data.simulation.state} />}
        summary="A staff-only comparison of this version with the committed run of a full ended period."
        actions={canRun ? <Button variant="primary" icon="play_circle" data-testid="primary-action" onClick={() => setRerunning(true)}>Run new simulation</Button> : undefined}
      />
      <SimulationScreen plan={plan} version={version} data={data} detail={detail.data} onRerun={canRun ? () => setRerunning(true) : undefined} />
      {rerunning && (
        <RunSimulationDialog plan={plan} versionId={version.id} title="Run new simulation" onClose={() => setRerunning(false)}
          onCreated={(simulation) => {
            setRerunning(false)
            router.push(simulationPage(plan.id, version.version, simulation.id))
          }} />
      )}
    </div>
  )
}
