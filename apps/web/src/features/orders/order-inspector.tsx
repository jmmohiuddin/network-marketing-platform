'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { LoadingState } from '../../components/states'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { CONNECTORS_PATH, type Connector } from '../integrations/types'
import { ITEM_CLASS_LABELS, ATTRIBUTION_LABELS, currencyDigits, EVENT_LABELS, HANDLING_LABELS, LATE_STATE_LABELS, moneyText, PURPOSE_LABELS, rateText, RECORD_ONLY_EVENTS, sourceText, volumesText } from './format'
import type { OrderDetail } from './types'

const BLOCK = 'bg-surface-container-low p-space-sm rounded-lg flex flex-col gap-2'
const HEAD = 'font-caption text-caption font-semibold uppercase tracking-wider text-secondary'
const MONO = 'font-data-mono-sm text-data-mono-sm'

/** Minor unit per market id (GET /v1/markets), for exact money text. */
export function useMinorUnits(): ReadonlyMap<string, number> {
  const markets = useResource<Market[]>(MARKETS_PATH)
  return new Map((markets.data ?? []).map((market) => [market.id, market.minor_unit]))
}

/** Connector names by id for order sources; only integration.manage may read connectors, others see the provider. */
export function useConnectorNames(): ReadonlyMap<string, string> {
  const { can } = useSession()
  const connectors = useResource<Connector[]>(can('integration.manage') ? CONNECTORS_PATH : null)
  return new Map((connectors.data ?? []).map((connector) => [connector.id, connector.name]))
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex justify-between gap-space-sm">
      <dt className="text-secondary font-caption text-caption shrink-0">{label}</dt>
      <dd className="font-body-sm text-body-sm text-on-surface text-right min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Inspector({ order, minorUnit }: { readonly order: OrderDetail; readonly minorUnit: number | undefined }) {
  const money = (minor: string) => moneyText(minor, order.currency, minorUnit)
  const original = (minor: string, currency: string) => moneyText(minor, currency, currencyDigits(currency))
  const units = order.lines.reduce((total, line) => total + line.quantity, 0)
  return (
    <div className="flex flex-col gap-space-md">
      <div className={BLOCK} data-testid="attribution">
        <div className="flex items-center justify-between">
          <h3 className={HEAD}>Buyer and attribution</h3>
          <Icon name={order.attribution_conflict ? 'warning' : 'verified'} size={16} className={order.attribution_conflict ? 'text-amber-700' : 'text-tertiary'} />
        </div>
        <dl className="bg-surface-container-lowest p-2 rounded flex flex-col gap-1">
          <Row label="Buyer"><Link className="text-primary hover:underline" href={`/people/${order.buyer.id}`}>{order.buyer.display_name ?? order.buyer.external_ref}</Link></Row>
          <Row label="Buyer type at order"><span className={`${MONO} text-primary font-semibold`}>{order.buyer_type.code}</span></Row>
          <Row label="Purpose">{PURPOSE_LABELS[order.purpose]}{order.purpose_missing && ' (missing in the source)'}</Row>
          <Row label="Attributed to">{order.attributed_position === null ? 'Not attributed' : <span className={MONO}>{order.attributed_position.position_ref}</span>}</Row>
          <Row label="Attribution source">{order.attribution_source === null ? '—' : ATTRIBUTION_LABELS[order.attribution_source]}</Row>
          {order.subscription_ref !== null && <Row label="Subscription"><span className={`${MONO} break-all`}>{order.subscription_ref}</span></Row>}
        </dl>
        {order.attribution_conflict && (
          <p className="font-caption text-caption text-amber-900 flex items-start gap-1">
            <Icon name="warning" size={14} className="mt-0.5 shrink-0" />The order's hint named a different position than the buyer's servicer.
          </p>
        )}
      </div>

      {order.original !== null && (
        <div className={BLOCK} data-testid="conversion">
          <h3 className={HEAD}>Currency conversion</h3>
          <dl className="bg-surface-container-lowest p-2 rounded flex flex-col gap-1">
            <Row label="Sent as"><span className={MONO}>{original(order.original.amount_minor, order.original.currency)} · tax {original(order.original.tax_minor, order.original.currency)}</span></Row>
            <Row label="Rate"><span className={MONO}>1 {order.original.currency} = {rateText(order.original.rate)} {order.currency}</span></Row>
            <Row label="Rate valid from">{formatDateTime(order.original.rate_valid_from)}</Row>
            <Row label="Credited as"><span className={`${MONO} font-semibold`}>{money(order.amount_minor)} · tax {money(order.tax_minor)}</span></Row>
          </dl>
          <p className="font-caption text-caption text-secondary">Converted once, when received, at the rate in force at the order time; refunds use the same rate.</p>
        </div>
      )}

      <div className={BLOCK}>
        <div className="flex items-center justify-between gap-space-sm">
          <h3 className={HEAD}>Line volumes</h3>
          <span className={`${MONO} text-on-surface font-bold`}>{order.lines.length} SKUs ({units} units)</span>
        </div>
        <ul className="flex flex-col gap-1">
          {order.lines.map((line) => (
            <li key={line.line_no} className="bg-surface-container-lowest p-2 rounded flex items-start justify-between gap-space-sm">
              <div className="min-w-0">
                <span className={`${MONO} font-bold text-on-surface break-all`}>{line.sku}</span>
                <div className="font-caption text-caption text-secondary">Line {line.line_no} · {ITEM_CLASS_LABELS[line.item_class] ?? line.item_class} · qty {line.quantity}</div>
              </div>
              <div className="text-right">
                <span className={`${MONO} font-bold text-on-surface`}>{money(line.amount_minor)}</span>
                <div className={`${MONO} text-[11px] text-tertiary font-bold`}>{volumesText(line.volumes, minorUnit)}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="bg-surface-container-high p-2 rounded flex flex-wrap items-center justify-between gap-space-xs">
          <span className="font-caption text-caption font-semibold uppercase text-secondary">Total</span>
          <span className={`${MONO} font-bold text-on-surface`}>{money(order.amount_minor)} · tax {money(order.tax_minor)}</span>
          <span className={`${MONO} font-bold text-tertiary`}>{volumesText(order.volumes, minorUnit)}</span>
        </div>
      </div>

      <div className={BLOCK}>
        <h3 className={HEAD}>Events</h3>
        {order.events.length === 0 ? <p className="font-caption text-caption text-secondary">No refund, return, chargeback or subscription event.</p> : (
          <ol className="flex flex-col gap-1">
            {order.events.map((event) => (
              <li key={event.id} className="bg-surface-container-lowest p-2 rounded flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center justify-between gap-space-xs">
                  <span className="font-body-sm text-body-sm font-semibold text-on-surface">{EVENT_LABELS[event.type] ?? event.type}{event.equal_value && ' (equal value)'}</span>
                  {event.late && <StatusBadge state="held" label="Late" />}
                </div>
                <span className={`${MONO} text-secondary`}>{formatDateTime(event.occurred_at)}</span>
                {event.dispute_of_event_id !== null && (
                  <span className="font-caption text-caption text-on-surface-variant">
                    Closes the chargeback of {formatDateTime(order.events.find((other) => other.id === event.dispute_of_event_id)?.occurred_at)}
                  </span>
                )}
                {RECORD_ONLY_EVENTS.has(event.type) ? (
                  <span className="font-caption text-caption text-on-surface-variant">Recorded for the history: no volume or pay effect.</span>
                ) : (
                  <>
                    <span className="font-caption text-caption text-on-surface-variant">
                      Refund {money(event.refund_minor)} · fee {money(event.fee_minor)}
                      {event.original !== null && ` (sent as ${original(event.original.refund_minor, event.original.currency)} · fee ${original(event.original.fee_minor, event.original.currency)})`}
                      {event.lines !== null && ` · lines ${event.lines.map((line) => `${line.line_no}×${line.quantity}`).join(', ')}`}
                    </span>
                    <span className={`${MONO} text-[11px] text-tertiary`}>Volume effect: {event.volume_effect.total === undefined ? 'none' : volumesText(event.volume_effect.total, minorUnit)}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {order.late_transactions.length > 0 && (
        <div className={BLOCK} data-testid="late-items">
          <h3 className={HEAD}>Late items</h3>
          <ul className="flex flex-col gap-1">
            {order.late_transactions.map((item) => (
              <li key={item.id} className="bg-surface-container-lowest p-2 rounded flex flex-wrap items-center justify-between gap-space-xs">
                <span className="font-caption text-caption text-on-surface">{item.origin_type === 'order' ? 'Order' : 'Event'} · {HANDLING_LABELS[item.handling]}</span>
                <StatusBadge state={item.state === 'pending' ? 'held' : 'closed'} label={LATE_STATE_LABELS[item.state]} />
              </li>
            ))}
          </ul>
          <Link className="font-caption text-caption text-primary hover:underline" href="/periods/late">Open the late-transaction queue</Link>
        </div>
      )}

      <div className={BLOCK}>
        <h3 className={HEAD}>Received</h3>
        <dl className="bg-surface-container-lowest p-2 rounded flex flex-col gap-1">
          <Row label="Source"><span className={`${MONO} break-all`}>{order.source.source}</span></Row>
          <Row label="Received">{formatDateTime(order.source.received_at)}</Row>
          <Row label="Ordered">{formatDateTime(order.ordered_at)}</Row>
          <Row label="Credited">{formatDateTime(order.credited_at)}</Row>
        </dl>
      </div>

      {order.attributed_position !== null && (
        <LinkButton icon="account_tree" className="justify-center" href={`/genealogy?root=${order.attributed_position.id}`}>Open in genealogy</LinkButton>
      )}
    </div>
  )
}

/** sc_31 order inspector (GET /v1/orders/:id): the order as fixed at ingestion, its events and late items. */
export function OrderInspector({ orderId }: { readonly orderId: string }) {
  const order = useResource<OrderDetail>(`/v1/orders/${orderId}`)
  const minorUnits = useMinorUnits()
  const connectorNames = useConnectorNames()
  return (
    <section className="bg-surface-container-lowest rounded-lg shadow-sm flex flex-col gap-space-md p-space-md" aria-labelledby="inspector-title" data-testid="inspector">
      <div className="flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name="manage_search" size={20} className="text-primary" />
          <div className="min-w-0">
            <h2 id="inspector-title" className="font-section-heading text-section-heading text-on-surface font-bold">Order inspector</h2>
            {order.data !== null && <div className={`${MONO} text-primary font-bold break-all`}>{order.data.source_order_id} · {sourceText(order.data.source_system, connectorNames)}</div>}
          </div>
        </div>
        <StatusBadge state="committed" label="Fixed fact" />
      </div>
      {order.error !== null && <LoadFailure error={order.error} onRetry={order.reload} section />}
      {order.data === null && order.error === null && <LoadingState label="Loading the order" />}
      {order.data !== null && <Inspector order={order.data} minorUnit={minorUnits.get(order.data.market.id)} />}
    </section>
  )
}

/** /orders/[id]: one order on its own page (links from the late queue and the participant record). */
export function OrderPage({ orderId }: { readonly orderId: string }) {
  return (
    <>
      <PageHeader title="Order" breadcrumbs={[{ label: 'Orders', href: '/orders' }, { label: 'Order' }]} summary="Orders are fixed facts: corrections arrive as refunds, returns or chargebacks." />
      <div className="max-w-3xl w-full">
        <OrderInspector orderId={orderId} />
      </div>
    </>
  )
}
