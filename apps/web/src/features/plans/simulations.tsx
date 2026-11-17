'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { FormDialog } from '../admin/form-dialog'
import { tableError, usePagedList } from '../admin/resource'
import { periodText } from '../periods/format'
import { calendarZone, currencyOf, delta, money, simulationPage, type Currency } from './format'
import type { PeriodsView, PlanSummary, SimulationRow, VersionView } from './types'
import { explainedError, NOTE, useCalendarPeriods } from './ui'

export const SIMULATIONS_PATH = '/v1/simulations'
const PERIOD_ID = 'simulation-period'

/** Ended periods of the plan's calendars, newest first: what a simulation may run on (D-B3-15). */
function endedPeriods(plan: PlanSummary, periods: PeriodsView | null) {
  const calendars = new Map(plan.calendars.map((c) => [c.id, c]))
  return (periods?.periods ?? []).filter((p) => p.cut_off_passed && calendars.has(p.calendar_id)).map((p) => {
    const calendar = periods!.calendars.find((c) => c.id === p.calendar_id)
    return { ...p, label: `${calendars.get(p.calendar_id)!.name}: ${periodText(p, calendar?.cutoff_time_zone)}` }
  })
}

export interface RunSimulationDialogProps {
  readonly plan: PlanSummary
  readonly versionId: string
  readonly title?: string
  readonly onClose: () => void
  /** The simulation was queued. */
  readonly onCreated: (simulation: { readonly id: string }) => void
}

/** POST /v1/simulations: the version on a chosen ended period of one of its calendars (needs period.read for the list). */
export function RunSimulationDialog({ plan, versionId, title = 'Run simulation', onClose, onCreated }: RunSimulationDialogProps) {
  const api = useApi()
  const [now] = useState(() => new Date().toISOString())
  const periods = useCalendarPeriods(plan.calendars.map((c) => c.id), { to: now })
  const choices = endedPeriods(plan, periods.data)
  const [chosen, setChosen] = useState('')
  const periodId = chosen === '' ? choices[0]?.id ?? '' : chosen
  const [error, setError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = periodId === '' ? 'Choose a period that has ended.' : null
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: PERIOD_ID, message: missing }] }
    return {
      items: [],
      send: async () => {
        try {
          const { data } = await api.post<{ id: string }>(SIMULATIONS_PATH, { plan_version_id: versionId, period_id: periodId }, { idempotencyKey })
          onCreated(data)
        } catch (failure) {
          throw explainedError(failure)
        }
      },
    }
  }
  return (
    <FormDialog title={title} submitLabel={title} onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>The version runs on a full period that has ended, as a staff-only comparison with the period&apos;s committed run when there is one. Nothing is paid, posted or shown to participants.</p>
      {periods.error !== null && <p role="alert" className="font-caption text-caption text-error" id={PERIOD_ID}>The periods could not be loaded. {errorMessage(periods.error)}</p>}
      {periods.loading && <p role="status" className={NOTE}>Loading the ended periods…</p>}
      {periods.data !== null && (choices.length === 0
        ? <p className={NOTE} id={PERIOD_ID}>No period of this plan&apos;s calendars has ended yet.</p>
        : <Select id={PERIOD_ID} label="Period" value={periodId} error={error} options={choices.map((p) => ({ value: p.id, label: p.label }))} onChange={(event) => setChosen(event.target.value)} />)}
    </FormDialog>
  )
}

/** The simulated, baseline and delta of a row, in the period's currency. */
function amounts(row: SimulationRow, currency: Currency | null): { simulated: string; baseline: string; change: string } {
  if (row.totals === null) return { simulated: '—', baseline: '—', change: '—' }
  return {
    simulated: money(row.totals.simulated_minor, currency),
    baseline: row.totals.baseline_minor === null ? 'No committed run' : money(row.totals.baseline_minor, currency),
    change: row.totals.delta_minor === null ? '—' : delta(row.totals.delta_minor, currency),
  }
}

/** The period of a simulation of the version (GET …/versions/:v lists them with their period). */
export const simulationPeriod = (version: Pick<VersionView, 'simulations'>, simulationId: string) => version.simulations.find((s) => s.id === simulationId)?.period

/** The SC-04 Simulations tab: every simulation of the version with its totals; a row opens SC-42. */
export function SimulationsTab({ plan, version, markets }: { readonly plan: PlanSummary; readonly version: VersionView; readonly markets: readonly Market[] | null }) {
  const list = usePagedList<SimulationRow>(SIMULATIONS_PATH, { plan_version_id: version.id })
  const currency = (row: SimulationRow) => currencyOf(simulationPeriod(version, row.id)?.calendar_id, plan.calendars, markets)
  const columns: readonly DataTableColumn<SimulationRow>[] = [
    {
      key: 'period', header: 'Period', cell: (row) => {
        const period = simulationPeriod(version, row.id)
        return <Link className="text-primary hover:underline" href={simulationPage(plan.id, version.version, row.id)}>{period === undefined ? `Simulation ${row.id.slice(0, 8)}` : periodText(period, calendarZone(period.calendar_id, plan.calendars, markets))}</Link>
      },
    },
    { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state} /> },
    { key: 'simulated', header: 'Simulated total', align: 'end', cell: (row) => amounts(row, currency(row)).simulated },
    { key: 'baseline', header: 'Baseline total', align: 'end', cell: (row) => amounts(row, currency(row)).baseline },
    { key: 'delta', header: 'Change', align: 'end', cell: (row) => amounts(row, currency(row)).change },
    { key: 'requested', header: 'Requested', cell: (row) => formatDateTime(row.requested_at) },
  ]
  return (
    <DataTable caption="Simulations of this version" columns={columns} rows={[...list.rows].sort((a, b) => b.requested_at.localeCompare(a.requested_at))} rowKey={(row) => row.id} loading={list.loading} error={tableError(list)}
      empty={{ title: 'No simulation of this version yet. Run one on an ended period before scheduling it.' }} pagination={list.pagination} />
  )
}
