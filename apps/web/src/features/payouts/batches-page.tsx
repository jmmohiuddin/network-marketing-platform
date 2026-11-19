'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button, LinkButton } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { ApiError, isApiError } from '../../lib/api'
import { countLabel, formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { FormDialog } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { inScope, marketScope } from '../markets/format'
import type { ProviderRecord } from '../markets/types'
import { marketMoney } from '../periods/format'
import { adapterText, BATCH_BADGES, batchPath, batchPeriod, BATCH_STATE_LABELS, marketsById, totalsText, unconfiguredSetting } from './format'
import { BATCHES_PATH, PROVIDERS_PATH, SUMMARY_PATH, type Batch, type ProviderSummary } from './types'
import { LINK, MONO, RegisterCard } from './ui'

// One open (draft/reviewed) batch per market (D-B4-12): this many covers every market of a tenant.
// shortcut: open batches beyond 200 markets are not counted in the KPIs; page the open lists when a tenant has more.
const OPEN_LIMIT = 200


function batchColumns(markets: ReadonlyMap<string, Market>): DataTableColumn<Batch>[] {
  return [
    {
      key: 'batch', header: 'Batch and period', cell: (b) => (
        <div className="flex flex-col">
          <Link className={`${LINK} ${MONO}`} href={batchPath(b.id)} aria-label={`Batch ${shortId(b.id)}, ${b.market.code}`}>{shortId(b.id)}</Link>
          <span className="font-caption text-caption text-secondary">{b.market.code} · {batchPeriod(b, markets.get(b.market.id))}</span>
        </div>
      ),
    },
    {
      key: 'provider', header: 'Provider', cell: (b) => (
        <div className="flex flex-col">
          <span className="font-medium text-on-surface">{b.provider.provider}</span>
          <span className={`${MONO} text-outline`}>{adapterText(b.provider.adapter)}</span>
        </div>
      ),
    },
    { key: 'total', header: 'Net amount', align: 'end', cell: (b) => <span className="font-data-mono-md text-data-mono-md font-bold whitespace-nowrap">{marketMoney(b.total_minor, markets.get(b.market.id))}</span> },
    { key: 'payees', header: 'Payees', align: 'end', cell: (b) => <span className={`${MONO} font-semibold`}>{b.line_count.toLocaleString()}</span> },
    { key: 'state', header: 'Status', cell: (b) => <StatusBadge state={BATCH_BADGES[b.state]} label={BATCH_STATE_LABELS[b.state]} /> },
    {
      key: 'signoff', header: 'Sign-off', cell: (b) => (
        <div className="flex flex-col font-caption text-caption">
          <span className="text-on-surface font-semibold">Prepared by {b.prepared_by.display_name ?? 'a user without a name'}</span>
          {b.approved_by !== null && <span className="text-secondary">Approved by {b.approved_by.display_name ?? 'a user without a name'} · {formatDateTime(b.approved_at)}</span>}
        </div>
      ),
    },
    { key: 'action', header: 'Action', align: 'end', cell: (b) => <LinkButton size="sm" href={batchPath(b.id)} aria-label={`Inspect batch ${shortId(b.id)}`}>Inspect</LinkButton> },
  ]
}

const NOT_LOADED = 'Could not be loaded: retry above.'

function PayoutKpis({ open, summary, markets, failed: loadFailed }: {
  readonly open: readonly Batch[] | null; readonly summary: readonly ProviderSummary[] | null; readonly markets: ReadonlyMap<string, Market>; readonly failed: boolean
}) {
  const ready = markets.size > 0
  // KpiCard: a null value needs its detail to say why.
  const why = (missing: boolean, detail?: string) => (missing && loadFailed ? NOT_LOADED : detail)
  const transit = summary === null || !ready ? null : totalsText(summary.map((p) => ({ minor: p.in_transit.amount_minor, marketId: p.market_id })), markets)
  const sum = (pick: (p: ProviderSummary) => number) => (summary === null ? null : summary.reduce((total, p) => total + pick(p), 0))
  const transitCount = sum((p) => p.in_transit.count)
  const failed = sum((p) => p.failed.count)
  const excluded = open === null ? null : open.reduce((total, b) => total + b.exclusions.length, 0)
  const openTotal = open === null || !ready ? null : totalsText(open.map((b) => ({ minor: b.total_minor, marketId: b.market.id })), markets)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Open batch total" icon="payments" value={openTotal}
        detail={why(openTotal === null, open === null ? undefined : `${countLabel(open.length, 'batch', 'batches')} in draft or awaiting approval`)} />
      <KpiCard label="In transit" icon="sync_alt" value={transit} detail={why(transit === null, transitCount === null ? undefined : `${countLabel(transitCount, 'instruction')} not yet settled`)} />
      <KpiCard label="Payees excluded" icon="person_off" value={excluded === null ? null : excluded.toLocaleString()} detail={why(excluded === null, 'From the open batches, each with its reasons')} />
      <KpiCard label="Failed instructions" icon="error" value={failed === null ? null : failed.toLocaleString()} detail={why(failed === null, 'Retry them from their batch')} />
    </div>
  )
}

/** POST /v1/payout-batches: market (payout.prepare scope) and one of its recorded payout providers with an adapter. */
function PrepareBatchDialog({ markets, onClose }: { readonly markets: readonly Market[]; readonly onClose: () => void }) {
  const api = useApi()
  const router = useRouter()
  const toast = useToast()
  const [marketId, setMarketId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const providers = useResource<readonly ProviderRecord[]>(marketId === '' ? null : PROVIDERS_PATH, { market_id: marketId, kind: 'payout', state: 'recorded' })
  const usable = (providers.data ?? []).filter((p) => p.adapter !== null)
  const ids = { market_id: 'prepare-market', provider_config_id: 'prepare-provider' }
  function submit(idempotencyKey: string) {
    const found = { market_id: marketId === '' ? 'Choose the market to pay.' : null, provider_config_id: providerId === '' ? 'Choose the payout provider.' : null }
    setErrors(found)
    const items = Object.entries(found).flatMap(([field, message]) => (message === null ? [] : [{ fieldId: ids[field as keyof typeof ids], message }]))
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        try {
          const { data } = await api.post<Batch>(BATCHES_PATH, { market_id: marketId, provider_config_id: providerId }, { idempotencyKey })
          toast({ message: `Batch prepared: ${countLabel(data.line_count, 'payee')} included, ${countLabel(data.exclusions.length, 'payee')} excluded.` })
          router.push(batchPath(data.id))
        } catch (error) {
          const open = isApiError(error, 'BATCH_OPEN') ? (error.details as { batch_id?: string } | null)?.batch_id : undefined
          if (open !== undefined) {
            toast({ message: 'The market already has an open batch: it is shown instead.', tone: 'info' })
            router.push(batchPath(open))
            return
          }
          const unset = unconfiguredSetting(error)
          if (unset !== null && error instanceof ApiError) throw new ApiError(error.status, error.code, unset, error.details, error.requestId)
          throw error
        }
      },
    }
  }
  return (
    <FormDialog title="Prepare batch" submitLabel="Prepare batch" onClose={onClose} onSubmit={submit}>
      <p>Every payee with a payable balance in the market&apos;s committed periods is included at the full amount, unless a rule excludes them; excluded payees are listed with their reasons and keep their balance.</p>
      <Select id={ids.market_id} label="Market" placeholder="Choose a market" value={marketId} error={errors.market_id}
        options={markets.map((m) => ({ value: m.id, label: `${m.code} (${m.currency})` }))}
        onChange={(event) => {
          setMarketId(event.target.value)
          setProviderId('')
        }} />
      {providers.error !== null && <LoadFailure error={providers.error} onRetry={providers.reload} section />}
      {marketId !== '' && providers.loading && <LoadingState label="Loading the market's payout providers" />}
      {marketId !== '' && providers.error === null && (
        <Select id={ids.provider_config_id} label="Payout provider" placeholder="Choose a provider" value={providerId} error={errors.provider_config_id} disabled={providers.data === null}
          helper={providers.data === null ? undefined : usable.length === 0 ? 'No recorded payout provider of this market has an adapter: configure one in Integrations.' : 'Recorded payout providers of the market with an adapter.'}
          options={usable.map((p) => ({ value: p.id, label: `${p.provider} (${adapterText(p.adapter)})` }))} onChange={(event) => setProviderId(event.target.value)} />
      )}
    </FormDialog>
  )
}

/** SC-03 payout batches (FR-PAY-001, D-B4-12): KPIs, the batch register and Prepare batch (payout.prepare). */
export function PayoutBatchesPage() {
  const { me, can, readOnly } = useSession()
  const marketList = useResource<readonly Market[]>(MARKETS_PATH)
  const markets = marketsById(marketList.data)
  const list = usePagedList<Batch>(BATCHES_PATH)
  const drafts = useResource<readonly Batch[]>(BATCHES_PATH, { state: 'draft', limit: OPEN_LIMIT })
  const reviewed = useResource<readonly Batch[]>(BATCHES_PATH, { state: 'reviewed', limit: OPEN_LIMIT })
  const summary = useResource<{ readonly providers: readonly ProviderSummary[] }>(SUMMARY_PATH)
  const [preparing, setPreparing] = useState(false)
  if (isNotAvailable(list.error)) return <LoadFailure error={list.error} onRetry={list.reload} />
  const open = drafts.data === null || reviewed.data === null ? null : [...drafts.data, ...reviewed.data]
  const canPrepare = can('payout.prepare') && !readOnly
  const prepareScope = marketScope(me, 'payout.prepare')
  const sources = [marketList, drafts, reviewed, summary]
  const kpiError = sources.find((source) => source.error !== null)?.error ?? null
  const retryKpis = () => sources.filter((source) => source.error !== null).forEach((source) => source.reload())
  return (
    <>
      <PageHeader
        title="Payout batches"
        summary="Prepare a batch per market and provider, have a second person approve it, and follow its instructions until they settle."
        actions={canPrepare ? <Button variant="primary" icon="add_circle" data-testid="primary-action" disabled={marketList.error !== null} onClick={() => setPreparing(true)}>Prepare batch</Button> : undefined}
      />
      {kpiError !== null && <LoadFailure error={kpiError} onRetry={retryKpis} section />}
      <PayoutKpis open={open} summary={summary.data?.providers ?? null} markets={markets} failed={kpiError !== null} />
      <RegisterCard title="Batch register" note="Newest first">
        <DataTable
          bare caption="Payout batches" columns={batchColumns(markets)} rows={list.rows} rowKey={(b) => b.id} loading={list.loading}
          error={tableError(list)} pagination={list.pagination} stackOnPhone
          empty={{ title: canPrepare ? 'No batch yet. Prepare one once a period is committed.' : 'No payout batch yet.' }}
        />
      </RegisterCard>
      {preparing && marketList.data !== null && <PrepareBatchDialog markets={marketList.data.filter((m) => inScope(prepareScope, m.id))} onClose={() => setPreparing(false)} />}
    </>
  )
}
