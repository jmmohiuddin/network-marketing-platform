'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { LoadingState, NotAvailable } from '../../components/states'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { marketName, MARKETS_PATH, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { useCursorPages } from '../../lib/cursor-pages'
import { tableError } from '../admin/resource'
import { integer } from '../data/format'
import { PositionLink } from '../cases/refs'
import { HANDLING_LABELS, LATE_STATE_LABELS, moneyText, volumesText } from './format'
import type { LateItem, LatePreview, LateState, OrderRow } from './types'

const STATES = (Object.keys(LATE_STATE_LABELS) as LateState[]).map((value) => ({ value, label: LATE_STATE_LABELS[value] }))
const MONO = 'font-data-mono-sm text-data-mono-sm'
const REASON_ID = 'late-reason'

/** The currency of an item's order (an order's currency is its market's, CURRENCY_MISMATCH). */
type ItemMarket = (item: LateItem) => Market | undefined

/** Money in the market's currency (BUG-071); exact minor units while the market is not known. */
const amountText = (minor: string, market: Market | undefined) =>
  market === undefined ? `${integer(minor)} minor units` : moneyText(minor, market.currency, market.minor_unit)

/**
 * The market of each item: the filtered market, else the market of the item's order.
 * shortcut: one GET /v1/orders/:id per order on the page while no market is chosen, since late items carry no market
 * (PLAN B2 GET /v1/late-transactions); add the market to the item's order there to drop these lookups.
 */
function useItemMarket(rows: readonly LateItem[], markets: readonly Market[], marketId: string): ItemMarket {
  const api = useApi()
  const [orderMarkets, setOrderMarkets] = useState<ReadonlyMap<string, string | null>>(new Map())
  const chosen = markets.find((market) => market.id === marketId)
  const missing = chosen === undefined ? [...new Set(rows.map((row) => row.order.id))].filter((id) => !orderMarkets.has(id)).join(',') : ''
  useEffect(() => {
    if (missing === '') return
    let current = true
    // A failed lookup records null (the amount stays in minor units) so it is not asked again on every render.
    void Promise.all(missing.split(',').map((id) => api.get<OrderRow>(`/v1/orders/${id}`).then(({ data }) => [id, data.market.id] as const, () => [id, null] as const)))
      .then((found) => {
        if (current) setOrderMarkets((known) => new Map([...known, ...found]))
      })
    return () => {
      current = false
    }
  }, [api, missing])
  return (item) => chosen ?? markets.find((market) => market.id === orderMarkets.get(item.order.id))
}

/** The one market of a selection, else undefined (several currencies, or one not known yet). */
function selectionMarket(items: readonly LateItem[], marketOf: ItemMarket): Market | undefined {
  const found = items.map(marketOf)
  const first = found[0]
  return first !== undefined && found.every((market) => market?.currency === first.currency) ? first : undefined
}

const periodText = (period: LateItem['original_period']) => `${formatDateTime(period.starts_at)} – ${formatDateTime(period.ends_at)}`

function Facts({ items }: { readonly items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="flex flex-col gap-1 font-body-sm text-body-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-space-sm">
          <dt className="text-secondary">{label}</dt>
          <dd className={`${MONO} text-on-surface text-right min-w-0 break-words`}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Accept the proposed handling of the selection: POST preview first (count, totals, positions), then decide with one key. */
function AcceptDialog({ ids: chosen, market, onClose, onDone }: { readonly ids: readonly string[]; readonly market: Market | undefined; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [ids] = useState(chosen) // the selection as it was when the dialog opened
  const [preview, setPreview] = useState<{ readonly data: LatePreview | null; readonly error: unknown }>({ data: null, error: null })
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.post<LatePreview>('/v1/late-transactions/preview', { ids }).then(
      ({ data }) => setPreview({ data, error: null }),
      (failure: unknown) => setPreview({ data: null, error: failure }),
    )
  }, [api, ids, previewAttempt])
  function retryPreview() {
    setPreview({ data: null, error: null })
    setPreviewAttempt((attempt) => attempt + 1)
  }
  function submit(idempotencyKey: string) {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: REASON_ID, message: missing }] }
    // SC-32: the decision follows the preview, never a selection whose effect the user has not seen.
    if (preview.data === null) return { items: [{ message: 'Wait for the preview of the effect before accepting.' }] }
    return {
      items: [],
      fieldIds: { reason: REASON_ID },
      send: async () => {
        const { data } = await api.post<{ decided: number }>('/v1/late-transactions/decisions', { ids, reason: reason.trim() }, { idempotencyKey })
        toast({ message: `${data.decided} late ${data.decided === 1 ? 'item' : 'items'} decided with the proposed handling.` })
        onDone()
      },
    }
  }
  const data = preview.data
  return (
    <FormDialog title="Accept proposed handling" size="lg" submitLabel={`Accept ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`} onClose={onClose} onSubmit={submit}>
      <p>Each item is handled as proposed in an open period; the committed period is never edited.</p>
      {preview.error !== null && (
        <Banner tone="danger" title="Preview not available" action={<Button size="sm" icon="refresh" onClick={retryPreview}>Try again</Button>}>
          {errorMessage(preview.error)} The items can be accepted once the preview shows their effect.
        </Banner>
      )}
      {data === null && preview.error === null && <LoadingState label="Calculating the effect of the selection" />}
      {data !== null && (
        <div className="p-space-sm rounded bg-surface-container-low flex flex-col gap-space-sm" data-testid="late-preview">
          <Facts items={[
            ['Items', data.count],
            // The preview sums amount_minor whatever the currency, so the total shows only for a one-currency selection.
            ['Amount', market === undefined ? 'Filter the queue to one market to see the total' : amountText(data.amount_minor, market)],
            ['Volume', volumesText(data.volumes)],
            ['Positions affected', data.affected_positions.length],
          ]} />
          {data.affected_positions.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label="Positions affected">
              {data.affected_positions.map((position) => <li key={position.id} className={`${MONO} px-1.5 py-0.5 rounded bg-surface-container-lowest`}>{position.position_ref}</li>)}
            </ul>
          )}
        </div>
      )}
      <TextAreaField id={REASON_ID} label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

/** One item raised as a restatement instead of the proposed adjustment. */
function RestatementDialog({ item, onClose, onDone }: { readonly item: LateItem; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: REASON_ID, message: missing }] }
    return {
      items: [],
      fieldIds: { reason: REASON_ID },
      send: async () => {
        await api.post('/v1/late-transactions/decisions', { ids: [item.id], handling: 'restatement', reason: reason.trim() }, { idempotencyKey })
        toast({ message: `Order ${item.order.source_order_id} raised for restatement.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Raise restatement instead" submitLabel="Raise restatement" submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>The item is decided for restatement of {periodText(item.original_period)} instead of an adjustment in an open period.</p>
      <TextAreaField id={REASON_ID} label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

/** sc_32 queue item diagnostic. */
function Diagnostic({ item, market, onRestate }: { readonly item: LateItem | null; readonly market: Market | undefined; readonly onRestate: (() => void) | null }) {
  return (
    <section className="bg-surface-container-lowest rounded shadow-sm overflow-hidden" aria-labelledby="diagnostic-title" data-testid="diagnostic">
      <div className="p-space-md bg-surface-container flex flex-wrap items-center justify-between gap-space-xs">
        <h2 id="diagnostic-title" className="font-section-heading text-section-heading text-on-surface flex items-center gap-space-xs"><Icon name="analytics" size={20} className="text-primary" />Item diagnostic</h2>
        {item !== null && <span className={`${MONO} px-2 py-0.5 rounded bg-surface-container-highest text-primary font-semibold break-all`}>{item.order.source_order_id}</span>}
      </div>
      <div className="p-space-md flex flex-col gap-space-md">
        {item === null ? <p className="font-body-sm text-body-sm text-secondary">Choose Diagnose on an item to see its original period and estimated effect.</p> : (
          <>
            <div className="flex flex-col gap-space-xs p-space-sm rounded bg-surface-container-low">
              <span className="font-caption text-caption text-secondary uppercase font-semibold">Original period</span>
              <Facts items={[
                ['Period', periodText(item.original_period)],
                ['Period state', <StatusBadge state={item.original_period.state} />],
                ['Origin', item.origin_type === 'order' ? 'The order' : 'An order event'],
                ['Queued', formatDateTime(item.created_at)],
              ]} />
            </div>
            <div className="flex flex-col gap-space-xs p-space-sm rounded bg-surface-container-low">
              <span className="font-caption text-caption text-secondary uppercase font-semibold">Effect estimate</span>
              <Facts items={[
                ['Amount', amountText(item.effect_estimate.amount_minor, market)],
                ['Volume', volumesText(item.effect_estimate.volumes)],
                ['Attributed to', item.effect_estimate.attributed_position_id === null ? 'Not attributed' : <PositionLink id={item.effect_estimate.attributed_position_id} />],
              ]} />
            </div>
            <div className="flex flex-col gap-space-xs">
              <Facts items={[
                ['Handling', HANDLING_LABELS[item.handling]],
                ['State', LATE_STATE_LABELS[item.state]],
                ...(item.decided_at === null ? [] : [['Decided', formatDateTime(item.decided_at)] as const]),
                ...(item.decision_reason === null ? [] : [['Reason', item.decision_reason] as const]),
              ]} />
              <Link className="font-caption text-caption text-primary hover:underline" href={`/orders/${item.order.id}`}>Open the order</Link>
            </div>
            {onRestate !== null && <Button icon="restart_alt" className="justify-center" onClick={onRestate}>Raise restatement instead</Button>}
          </>
        )}
      </div>
    </section>
  )
}

/** One state and market of the queue; mount it with them as key so paging restarts. meta.counts feeds the KPI cards. */
function Queue({ state, marketId, markets }: { readonly state: LateState; readonly marketId: string; readonly markets: readonly Market[] }) {
  const { readOnly } = useSession()
  const pages = useCursorPages()
  const resource = useResource<LateItem[]>('/v1/late-transactions', { state, market_id: marketId === '' ? undefined : marketId, cursor: pages.cursor })
  const nextCursor = typeof resource.meta.next_cursor === 'string' ? resource.meta.next_cursor : null
  const list = {
    rows: resource.data ?? [], loading: resource.loading, error: resource.error, reload: resource.reload,
    pagination: { hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) },
  }
  const marketOf = useItemMarket(list.rows, markets, marketId)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'accept' | 'restate' | null>(null)
  const pending = list.rows.filter((row) => row.state === 'pending')
  const chosenRows = pending.filter((row) => selected.has(row.id))
  const chosen = chosenRows.map((row) => row.id)
  const focused = list.rows.find((row) => row.id === focus) ?? null
  const counts = resource.meta.counts as { pending?: number; decided_30d?: number } | undefined
  const toggle = (id: string, on: boolean) => setSelected((current) => new Set([...current].filter((value) => value !== id).concat(on ? [id] : [])))
  const decided = () => {
    setDialog(null)
    setSelected(new Set())
    list.reload()
  }
  const canDecide = !readOnly
  // shortcut: meta.counts ignores the market filter (API lateCounts), so the cards say so; pass market_id there to filter them.
  const countScope = marketId === '' ? '' : ' (all markets in your scope)'
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md" data-testid="kpis">
        <KpiCard label="Pending late items" icon="schedule" value={counts?.pending === undefined ? null : String(counts.pending)} detail={`Credited in a committed period, not yet decided${countScope}`} />
        <KpiCard label="Decided in 30 days" icon="task_alt" value={counts?.decided_30d === undefined ? null : String(counts.decided_30d)} detail={`Adjusted or raised for restatement${countScope}`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        <div className="lg:col-span-8 flex flex-col gap-space-sm min-w-0">
          {canDecide && state === 'pending' && (
            <div className="bg-surface-container-lowest rounded p-space-sm shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm" role="group" aria-label="Selection">
              <div className="flex items-center gap-space-sm">
                <label className="flex items-center gap-space-xs px-2 py-1 rounded bg-surface-container-high font-data-mono-sm text-data-mono-sm font-semibold text-primary cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-primary" aria-label="Select all pending items on this page" checked={pending.length > 0 && chosen.length === pending.length} disabled={pending.length === 0}
                    onChange={(event) => setSelected(new Set(event.target.checked ? pending.map((row) => row.id) : []))} />
                  {chosen.length} / {pending.length} selected
                </label>
              </div>
              {chosen.length > 0
                ? <Button variant="primary" icon="verified_user" data-testid="primary-action" onClick={() => setDialog('accept')}>Accept proposed handling</Button>
                : <span className="font-caption text-caption text-secondary">Select pending items to decide them together.</span>}
            </div>
          )}
          <DataTable
            caption="Late transactions"
            columns={[
              {
                key: 'order', header: 'Order', cell: (row) => (
                  <div className="flex items-start gap-space-sm">
                    {canDecide && row.state === 'pending' && (
                      <input type="checkbox" className="mt-0.5 w-4 h-4 accent-primary" aria-label={`Select order ${row.order.source_order_id}`} checked={selected.has(row.id)} onChange={(event) => toggle(row.id, event.target.checked)} />
                    )}
                    <div className="flex flex-col min-w-0">
                      <Link className={`${MONO} font-semibold text-primary hover:underline break-all`} href={`/orders/${row.order.id}`}>{row.order.source_order_id}</Link>
                      <span className="font-caption text-caption text-secondary">{row.origin_type === 'order' ? 'Order' : 'Order event'}</span>
                    </div>
                  </div>
                ),
              },
              { key: 'period', header: 'Original period', cell: (row) => <div className="flex flex-col"><span className={MONO}>{periodText(row.original_period)}</span><StatusBadge state={row.original_period.state} /></div> },
              { key: 'effect', header: 'Effect estimate', align: 'end', cell: (row) => <div className="flex flex-col items-end"><span className={`${MONO} font-semibold`}>{amountText(row.effect_estimate.amount_minor, marketOf(row))}</span><span className="font-caption text-caption text-secondary">{volumesText(row.effect_estimate.volumes)}</span></div> },
              { key: 'handling', header: 'Handling', cell: (row) => HANDLING_LABELS[row.handling] },
              { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state === 'pending' ? 'held' : 'closed'} label={LATE_STATE_LABELS[row.state]} /> },
              { key: 'diagnose', header: 'Diagnose', cell: (row) => <Button size="sm" icon="manage_search" aria-pressed={row.id === focus} aria-label={`Diagnose ${row.order.source_order_id}`} onClick={() => setFocus(row.id)}>Diagnose</Button> },
            ]}
            rows={list.rows}
            rowKey={(row) => row.id}
            selectedKey={focus ?? undefined}
            loading={list.loading}
            error={tableError(list)}
            empty={{ title: state === 'pending' ? 'No late transactions are waiting' : 'No late transactions in this state' }}
            pagination={list.pagination}
          />
        </div>
        <div className="lg:col-span-4 min-w-0">
          <Diagnostic item={focused} market={focused === null ? undefined : marketOf(focused)} onRestate={canDecide && focused?.state === 'pending' ? () => setDialog('restate') : null} />
        </div>
      </div>
      {dialog === 'accept' && <AcceptDialog ids={chosen} market={selectionMarket(chosenRows, marketOf)} onClose={() => setDialog(null)} onDone={decided} />}
      {dialog === 'restate' && focused !== null && <RestatementDialog item={focused} onClose={() => setDialog(null)} onDone={decided} />}
    </>
  )
}

/** SC-32 Late-transaction queue (FR-ORD-005): items credited in committed periods, decided in bulk after a preview. */
export function LateQueuePage() {
  const { can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const markets = useResource<Market[]>(can('late.manage') ? MARKETS_PATH : null)
  if (!can('late.manage')) return <NotAvailable />
  const state = (STATES.find((option) => option.value === params.get('state'))?.value ?? 'pending') as LateState
  const marketId = params.get('market_id') ?? ''
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value === '') next.delete(key)
    else next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`)
  }
  return (
    <>
      <PageHeader title="Late transactions" summary="Orders and events credited in a period that is already committed. Committed periods are never edited: each item is adjusted in an open period or raised for restatement." />
      <div className="flex flex-wrap gap-space-sm items-end" role="group" aria-label="Filter late transactions">
        <Select label="State" value={state} options={STATES} onChange={(event) => update('state', event.target.value)} />
        <Select label="Market" value={marketId} options={[{ value: '', label: 'All markets' }, ...(markets.data ?? []).map((market) => ({ value: market.id, label: marketName(market) }))]} onChange={(event) => update('market_id', event.target.value)} />
      </div>
      <Queue key={`${state}|${marketId}`} state={state} marketId={marketId} markets={markets.data ?? []} />
    </>
  )
}
