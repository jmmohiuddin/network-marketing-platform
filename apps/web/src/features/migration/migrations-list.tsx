'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button, LinkButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Select, TextInput } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { tableError, usePagedList } from '../admin/resource'
import { FormDialog } from '../admin/form-dialog'
import { periodRange } from '../data/format'
import type { Batch } from '../data/types'
import { TableSection } from '../data/ui'
import { periodName, periodText } from '../periods/format'
import type { PeriodList } from '../periods/types'
import { MIGRATIONS_PATH, migrationPage, STATE_BADGES, STATE_LABELS } from './format'
import type { Migration } from './types'

const VOLUME_KEY = /^[a-z][a-z0-9_]{0,31}$/
// shortcut: the newest 50 loaded migration batches and 200 periods of the batch's months (one API page each) are offered;
// a tenant migrates one market at a time, so more never stand open at once. Page through if that changes.
const BATCH_LIMIT = 50
const PERIOD_LIMIT = 200
const DAY_MS = 86_400_000
const ID = { batch: 'migration-batch', period: 'migration-cutover', volume: 'migration-volume-key' } as const

/** "YYYY-MM" of an instant in a time zone (a period's month in its market's zone, as the server checks it). */
export function monthIn(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(iso))
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`
}

/**
 * GET /v1/periods bounds around the batch's months (starts_at >= from, ends_at <= to): a day of slack for any time zone
 * before the first month, and the whole month after the last for a period starting in it (calendars are weekly or monthly).
 */
export function periodWindow(batch: Pick<Batch, 'period_from' | 'period_to'>): { readonly from: string; readonly to: string } {
  const [toYear, toMonth] = batch.period_to.split('-').map(Number) as [number, number]
  return {
    from: new Date(Date.parse(`${batch.period_from}-01T00:00:00Z`) - DAY_MS).toISOString(),
    to: new Date(Date.UTC(toYear, toMonth + 1, 1) + DAY_MS).toISOString(),
  }
}

/** Periods of the batch market's calendars whose month (in the market's zone) lies within the batch's months (CUTOVER_OUTSIDE_BATCH otherwise). */
export function cutoverChoices(batch: Pick<Batch, 'market' | 'period_from' | 'period_to'> | undefined, market: Pick<Market, 'time_zone'> | undefined, list: PeriodList | null): { readonly value: string; readonly label: string }[] {
  if (batch === undefined || market === undefined || list === null) return []
  return list.periods.flatMap((period) => {
    const calendar = list.calendars.find((c) => c.id === period.calendar_id && c.market.code === batch.market)
    if (calendar === undefined) return []
    const month = monthIn(period.starts_at, market.time_zone)
    return month >= batch.period_from && month <= batch.period_to
      ? [{ value: period.id, label: `${periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone)} · ${calendar.name}` }] : []
  })
}

/** New migration (migration.manage): a loaded migration batch of a market in implementation, the cutover period, the volume key. */
function NewMigrationDialog({ onClose }: { readonly onClose: () => void }) {
  const api = useApi()
  const router = useRouter()
  const batches = useResource<Batch[]>('/v1/imports', { kind: 'migration', state: 'loaded', limit: BATCH_LIMIT })
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [batchId, setBatchId] = useState('')
  const [periodId, setPeriodId] = useState('')
  const [volumeKey, setVolumeKey] = useState('')
  const [errors, setErrors] = useState<Partial<Record<keyof typeof ID, string>>>({})
  const batch = batches.data?.find((b) => b.id === batchId)
  const market = markets.data?.find((m) => m.code === batch?.market)
  const periods = useResource<PeriodList>(batch === undefined ? null : '/v1/periods', batch === undefined ? undefined : { ...periodWindow(batch), limit: PERIOD_LIMIT })
  const choices = cutoverChoices(batch, market, periods.data)
  function submit(idempotencyKey: string) {
    const found = {
      ...(batchId === '' ? { batch: 'Choose the loaded migration batch.' } : {}),
      ...(periodId === '' ? { period: 'Choose the cutover period.' } : {}),
      ...(!VOLUME_KEY.test(volumeKey.trim()) ? { volume: 'Enter the volume key: lower-case letters, digits and _, starting with a letter.' } : {}),
    }
    setErrors(found)
    const items = (Object.entries(found) as [keyof typeof ID, string][]).map(([field, message]) => ({ fieldId: ID[field], message }))
    if (items.length > 0) return { items }
    return {
      items: [],
      fieldIds: { import_batch_id: ID.batch, cutover_period_id: ID.period, volume_key: ID.volume },
      send: async () => {
        const { data } = await api.post<Migration>(MIGRATIONS_PATH, { import_batch_id: batchId, cutover_period_id: periodId, volume_key: volumeKey.trim() }, { idempotencyKey })
        router.push(migrationPage(data.id))
      },
    }
  }
  const loadProblem = batches.error ?? markets.error ?? periods.error
  return (
    <FormDialog title="New migration" submitLabel="Create migration" onClose={onClose} onSubmit={submit}>
      <p>The migration starts as a draft. Its cutover period is the first period the platform commits, and the period the parallel run compares.</p>
      {loadProblem !== null && <p role="alert" className="font-caption text-caption text-error">The batches, markets or periods could not be loaded. {errorMessage(loadProblem)}</p>}
      <Select id={ID.batch} label="Migration batch" value={batchId} error={errors.batch}
        placeholder={batches.loading ? 'Loading batches…' : (batches.data ?? []).length === 0 ? 'No loaded migration batch' : 'Choose a batch'}
        helper="Loaded batches imported with kind Migration."
        options={(batches.data ?? []).map((b) => ({ value: b.id, label: `${b.market} · ${periodRange(b.period_from, b.period_to)}` }))}
        onChange={(event) => { setBatchId(event.target.value); setPeriodId('') }} />
      <Select id={ID.period} label="Cutover period" value={periodId} error={errors.period} disabled={batch === undefined}
        placeholder={batch === undefined ? 'Choose a batch first' : periods.loading || markets.loading ? 'Loading periods…' : choices.length === 0 ? 'No period of the market within the batch months' : 'Choose a period'}
        helper="A period of the batch's months; its legacy payouts are compared."
        options={choices} onChange={(event) => setPeriodId(event.target.value)} />
      <TextInput id={ID.volume} label="Volume key" value={volumeKey} error={errors.volume} helper="The plan measure the migrated order volumes are stored under, for example pv."
        onChange={(event) => setVolumeKey(event.target.value)} />
    </FormDialog>
  )
}

/** SC-16 list: migrations of the markets in scope, newest first, and New migration. */
export function MigrationsList() {
  const { can, readOnly } = useSession()
  const list = usePagedList<Migration>(MIGRATIONS_PATH)
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [creating, setCreating] = useState(false)
  if (!can('migration.manage') && !can('migration.signoff')) return <NotAvailable />
  const zone = (id: string) => markets.data?.find((m) => m.id === id)?.time_zone
  const mayCreate = !readOnly && can('migration.manage')
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        title="Migrations"
        summary="A market in implementation takes its legacy history once: apply a migration batch, post the opening balances, compare a parallel run and sign it off before the first commit."
        actions={<>
          {mayCreate && <LinkButton href="/imports/new?kind=migration" icon="cloud_upload">Upload migration batch</LinkButton>}
          {mayCreate && <Button variant="primary" icon="add_circle" data-testid="primary-action" onClick={() => setCreating(true)}>New migration</Button>}
        </>}
      />
      <TableSection first title="Migrations" summary="One migration per market; a draft can be cancelled, an applied one cannot be undone.">
        <DataTable
          bare
          stackOnPhone
          caption="Migrations, newest first"
          columns={[
            { key: 'market', header: 'Market', cell: (m) => <span className="font-data-mono-sm text-data-mono-sm font-bold text-primary">{m.market.code}</span> },
            { key: 'state', header: 'State', cell: (m) => <StatusBadge state={STATE_BADGES[m.state]} label={STATE_LABELS[m.state]} /> },
            { key: 'batch', header: 'Batch', cell: (m) => periodRange(m.batch.period_from, m.batch.period_to) },
            { key: 'cutover', header: 'Cutover period', cell: (m) => periodText(m.cutover_period, zone(m.market.id)) },
            { key: 'created', header: 'Created', cell: (m) => formatDateTime(m.created_at) },
            { key: 'actions', header: 'Actions', align: 'end', cell: (m) => <LinkButton size="sm" icon="visibility" href={migrationPage(m.id)} aria-label={`Open migration ${m.market.code}`}>Open</LinkButton> },
          ]}
          rows={list.rows}
          rowKey={(m) => m.id}
          loading={list.loading}
          error={tableError(list)}
          empty={{ title: 'No migration yet. Upload a migration batch, load it, then start a migration.' }}
          pagination={list.pagination}
        />
      </TableSection>
      {creating && <NewMigrationDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
