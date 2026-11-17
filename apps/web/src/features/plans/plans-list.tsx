'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog } from '../admin/form-dialog'
import { tableError, usePagedList } from '../admin/resource'
import { CHECK_GRID, FIELDSET, LEGEND } from '../admin/ui'
import { TableSection } from '../data/ui'
import { effectiveText, PLANS_PATH, STATE_LABELS, versionPage } from './format'
import type { PeriodsView, PlanSummary } from './types'
import { NOTE } from './ui'

const NAME_ID = 'plan-name'
const MARKETS_ID = 'plan-markets'
const CALENDARS_ID = 'plan-calendars'

/** POST /v1/plans: name, markets, and calendars of those markets that no plan uses yet; opens version 1 (draft). */
function NewPlanDialog({ markets, onClose }: { readonly markets: readonly Market[]; readonly onClose: () => void }) {
  const api = useApi()
  const router = useRouter()
  const periods = useResource<PeriodsView>('/v1/periods', { limit: 1 })
  const [name, setName] = useState('')
  const [marketIds, setMarketIds] = useState<readonly string[]>([])
  const [calendarIds, setCalendarIds] = useState<readonly string[]>([])
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const calendars = (periods.data?.calendars ?? []).filter((c) => c.plan === null && marketIds.includes(c.market.id))
  const toggle = (list: readonly string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id))
  function submit(idempotencyKey: string) {
    const chosen = calendarIds.filter((id) => calendars.some((c) => c.id === id))
    const found = {
      [NAME_ID]: requiredError('a plan name', name),
      [MARKETS_ID]: marketIds.length === 0 ? 'Choose at least one market.' : null,
      [CALENDARS_ID]: chosen.length === 0 ? 'Choose at least one calendar of the chosen markets.' : null,
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    return {
      items: [],
      fieldIds: { name: NAME_ID, market_ids: MARKETS_ID, calendar_ids: CALENDARS_ID },
      send: async () => {
        const { data } = await api.post<{ plan: PlanSummary }>(PLANS_PATH, { name: name.trim(), market_ids: marketIds, calendar_ids: chosen }, { idempotencyKey })
        router.push(versionPage(data.plan.id, 1))
      },
    }
  }
  return (
    <FormDialog title="New plan" submitLabel="Create plan" onClose={onClose} onSubmit={submit}>
      <TextInput id={NAME_ID} label="Plan name" value={name} maxLength={100} error={errors[NAME_ID]} onChange={(event) => setName(event.target.value)} />
      <fieldset id={MARKETS_ID} tabIndex={-1} className={FIELDSET} aria-describedby={errors[MARKETS_ID] ? `${MARKETS_ID}-error` : undefined}>
        <legend className={LEGEND}>Markets</legend>
        <div className={CHECK_GRID}>
          {markets.map((market) => (
            <Checkbox key={market.id} label={`${market.name} (${market.code})`} checked={marketIds.includes(market.id)}
              onChange={(event) => setMarketIds(toggle(marketIds, market.id, event.target.checked))} />
          ))}
        </div>
        {errors[MARKETS_ID] && <p id={`${MARKETS_ID}-error`} className="font-caption text-caption text-error">{errors[MARKETS_ID]}</p>}
      </fieldset>
      <fieldset id={CALENDARS_ID} tabIndex={-1} className={FIELDSET} aria-describedby={errors[CALENDARS_ID] ? `${CALENDARS_ID}-error` : `${CALENDARS_ID}-helper`}>
        <legend className={LEGEND}>Calendars</legend>
        <p id={`${CALENDARS_ID}-helper`} className={NOTE}>Calendars of the chosen markets that no other plan uses. Each calendar runs this plan.</p>
        {periods.error !== null && <p className="font-caption text-caption text-error">Calendars could not be loaded. Close and try again.</p>}
        {marketIds.length > 0 && periods.data !== null && calendars.length === 0 && <p className={NOTE}>The chosen markets have no calendar without a plan.</p>}
        <div className={CHECK_GRID}>
          {calendars.map((calendar) => (
            <Checkbox key={calendar.id} label={`${calendar.name} (${calendar.market.code}, ${calendar.cadence})`} checked={calendarIds.includes(calendar.id)}
              onChange={(event) => setCalendarIds(toggle(calendarIds, calendar.id, event.target.checked))} />
          ))}
        </div>
        {errors[CALENDARS_ID] && <p id={`${CALENDARS_ID}-error`} className="font-caption text-caption text-error">{errors[CALENDARS_ID]}</p>}
      </fieldset>
    </FormDialog>
  )
}

/** The version a plan row opens: the one being authored, else the one in force. */
function openVersion(plan: PlanSummary): number | null {
  return plan.authoring_version?.version ?? plan.current_version?.version ?? null
}

const columns = (markets: readonly Market[] | null): readonly DataTableColumn<PlanSummary>[] => [
  {
    key: 'name', header: 'Plan', cell: (plan) => {
      const version = openVersion(plan)
      return version === null ? plan.name : <Link className="text-primary hover:underline" href={versionPage(plan.id, version)}>{plan.name}</Link>
    },
  },
  { key: 'markets', header: 'Markets', cell: (plan) => <span className="font-data-mono-sm text-data-mono-sm">{plan.markets.map((m) => m.code).join(', ')}</span> },
  { key: 'calendars', header: 'Calendars', cell: (plan) => plan.calendars.map((c) => `${c.name} (${c.market_code})`).join(', ') },
  {
    key: 'current', header: 'In force', cell: (plan) => plan.current_version === null ? 'None' : (
      <span className="flex flex-col">
        <Link className="text-primary hover:underline" href={versionPage(plan.id, plan.current_version.version)}>Version {plan.current_version.version}</Link>
        <span className="font-caption text-caption text-secondary">Since {plan.current_version.effective_from === null ? '—' : effectiveText(plan.current_version.effective_from, plan.calendars, markets)}</span>
      </span>
    ),
  },
  {
    key: 'authoring', header: 'Being authored', cell: (plan) => plan.authoring_version === null ? 'None' : (
      <span className="flex flex-wrap items-center gap-space-xs">
        <Link className="text-primary hover:underline" href={versionPage(plan.id, plan.authoring_version.version)}>Version {plan.authoring_version.version}</Link>
        <StatusBadge state={plan.authoring_version.state} label={STATE_LABELS[plan.authoring_version.state]} />
      </span>
    ),
  },
]

function PlansTable({ marketId, markets }: { readonly marketId: string; readonly markets: readonly Market[] | null }) {
  const list = usePagedList<PlanSummary>(PLANS_PATH, { market_id: marketId === '' ? undefined : marketId })
  return (
    <DataTable caption="Plans" columns={columns(markets)} rows={list.rows} rowKey={(plan) => plan.id} loading={list.loading} error={tableError(list)}
      empty={{ title: marketId === '' ? 'No plan yet. Create one to start a first version.' : 'No plan covers this market.' }} pagination={list.pagination} bare />
  )
}

/** SC-04 plans list (sc_28 table pattern): plans with the version in force and the one being authored; New plan. */
export function PlansList() {
  const { can, readOnly } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  const [creating, setCreating] = useState(false)
  const marketId = params.get('market') ?? ''
  const canCreate = can('plan.edit') && can('period.read') && !readOnly && markets.data !== null
  const filter = (
    <Select label="Market" value={marketId} options={[{ value: '', label: 'All markets' }, ...(markets.data ?? []).map((m) => ({ value: m.id, label: `${m.name} (${m.code})` }))]}
      onChange={(event) => router.replace(event.target.value === '' ? pathname : `${pathname}?market=${event.target.value}`)} />
  )
  return (
    <>
      <PageHeader
        title="Plans"
        summary="Compensation plans by market, with the version in force and the version being authored."
        actions={canCreate ? <Button variant="primary" icon="add" data-testid="primary-action" onClick={() => setCreating(true)}>New plan</Button> : undefined}
      />
      <TableSection title="Plans" summary="Open a plan to edit its draft, simulate it or follow its approval." controls={filter} first>
        <PlansTable key={marketId} marketId={marketId} markets={markets.data} />
      </TableSection>
      {creating && markets.data !== null && <NewPlanDialog markets={markets.data} onClose={() => setCreating(false)} />}
    </>
  )
}
