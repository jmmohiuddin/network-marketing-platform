'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Banner } from '../../components/banner'
import { FOCUS_RING } from '../../components/button'
import { Icon } from '../../components/icon'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useResource } from '../../lib/use-resource'
import { dayText } from './format'
import { usePortal } from './shell'
import type { Customer, CustomerDetail } from './types'
import { CAPTION, CARD, ClosedNotice, LINK_CARD, MONO, PAGE_TITLE, PortalFailure, PortalSelect, Section, SHOW_FIRST, ShowMore, TILE, useShownList } from './ui'

// SC-21 my customers (FR-DIST-005, D-B5-11): the customers you service now (Current) or did (Past), repeat buyers
// (2 or more orders), by name or last order; contact only when the company shows it. No earnings per customer, no
// targets, growth figures, store links or exports.

type StateFilter = 'current' | 'past'

const CHIP = `shrink-0 min-h-11 px-3 rounded-full font-caption text-caption ${FOCUS_RING}`

export function CustomersPage() {
  const { profile } = usePortal()
  const [state, setState] = useState<StateFilter>('current')
  const [repeat, setRepeat] = useState(false)
  const [sort, setSort] = useState<'name' | 'last_order'>('name')
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>Customers</h1><ClosedNotice /></>
  const chip = (label: string, pressed: boolean, onClick: () => void) => (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`${CHIP} ${pressed ? 'bg-primary-container text-on-primary font-semibold' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}>{label}</button>
  )
  return (
    <>
      <h1 className={PAGE_TITLE}>Customers</h1>
      <div className="flex flex-col gap-space-xs">
        <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-space-xs">
          {chip('Current', state === 'current', () => setState('current'))}
          {chip('Past', state === 'past', () => setState('past'))}
          {chip('Repeat buyers', repeat, () => setRepeat(!repeat))}
        </div>
        <PortalSelect id="customer-sort" label="Sort by" value={sort} onChange={(event) => setSort(event.target.value === 'last_order' ? 'last_order' : 'name')}
          options={[{ value: 'name', label: 'Name' }, { value: 'last_order', label: 'Last order' }]} />
      </div>
      <CustomerList query={{ state, sort, repeat: repeat ? 'true' : undefined }} />
    </>
  )
}

function CustomerList({ query }: { readonly query: { readonly state: StateFilter; readonly sort: string; readonly repeat: string | undefined } }) {
  const { zone } = usePortal()
  const list = useShownList<Customer[]>('/v1/me/customers', query, SHOW_FIRST)
  if (list.first.error !== null) return <PortalFailure error={list.first.error} onRetry={list.first.reload} />
  if (list.rows === null) return <LoadingState label="Loading your customers" />
  if (list.rows.length === 0) {
    return <EmptyState title={query.state === 'past' ? 'No past customers' : 'No customers yet'}>Customers you service appear here.</EmptyState>
  }
  return (
    <>
      <ul className="flex flex-col gap-space-sm" data-testid="card">
        {list.rows.map((customer) => (
          <li key={`${customer.customer_id}-${customer.since}`}>
            <Link href={`/portal/customers/${customer.customer_id}`} className={`${LINK_CARD} flex-col items-stretch`}>
              <div className="flex items-start justify-between gap-space-sm">
                <div className="flex flex-col min-w-0">
                  <span className="font-section-heading text-section-heading text-on-surface">{customer.display_name ?? 'Name not shown'}</span>
                  <span className={`${MONO} text-outline`}>Serviced by {customer.serviced_by_position_ref}</span>
                </div>
                {customer.repeat && <StatusBadge state="active" label="Repeat buyer" />}
              </div>
              {customer.until !== null && (
                <div className="bg-surface-container-high/60 p-2.5 rounded-lg flex items-start gap-2">
                  <Icon name="assignment_ind" size={18} className="text-primary shrink-0 mt-0.5" />
                  <span className={CAPTION}><span className="font-semibold text-on-surface">Reassigned {dayText(customer.until, zone)}:</span> you no longer service this customer.</span>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-2">
                <div className={`${TILE} flex flex-col`}>
                  <dt className={CAPTION}>Last order</dt>
                  <dd className="font-body-lg text-body-lg text-on-surface">{customer.last_order_at === null ? 'No orders yet' : dayText(customer.last_order_at, zone)}</dd>
                </div>
                <div className={`${TILE} flex flex-col`}>
                  <dt className={CAPTION}>Orders</dt>
                  <dd className="font-body-lg text-body-lg text-on-surface">{customer.order_count}</dd>
                </div>
              </dl>
              <span className={CAPTION}>Since {dayText(customer.since, zone)}{customer.until === null ? '' : ` until ${dayText(customer.until, zone)}`}</span>
              {customer.contact_masked != null && <span className={`${MONO} text-on-surface-variant`}>{Object.values(customer.contact_masked).join(' · ')}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <ShowMore list={list} label="customers" />
    </>
  )
}

export function CustomerPage({ customerId }: { readonly customerId: string }) {
  const { profile, zone } = usePortal()
  const customer = useResource<CustomerDetail>(profile.terminated ? null : `/v1/me/customers/${customerId}`)
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>Customer</h1><ClosedNotice /></>
  if (customer.error !== null) return <PortalFailure error={customer.error} onRetry={customer.reload} />
  if (customer.data === null) return <LoadingState label="Loading the customer" />
  const data = customer.data
  const ended = data.servicing.filter((row) => row.until !== null)
  return (
    <>
      <div className={`${CARD} flex flex-col gap-1`}>
        <h1 className={PAGE_TITLE}>{data.display_name ?? 'Name not shown'}</h1>
        {data.contact_masked != null && <span className={`${MONO} text-on-surface-variant`}>{Object.values(data.contact_masked).join(' · ')}</span>}
      </div>
      {ended.length > 0 && (
        <Banner tone="info" title="Servicing changed">
          {ended.map((row) => `${row.position_ref} serviced this customer until ${dayText(row.until!, zone)}.`).join(' ')}
        </Banner>
      )}
      <Section title="Serviced by you" icon="assignment_ind">
        <ul className="flex flex-col gap-space-xs">
          {data.servicing.map((row) => (
            <li key={`${row.position_ref}-${row.since}`} className={`${TILE} flex flex-col`}>
              <span className={`${MONO} text-on-surface`}>{row.position_ref}</span>
              <span className={CAPTION}>Since {dayText(row.since, zone)}{row.until === null ? '' : ` until ${dayText(row.until, zone)}`} · {row.order_count === 1 ? '1 order' : `${row.order_count} orders`}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Last orders" icon="receipt_long">
        {data.last_orders.length === 0
          ? <p className={CAPTION}>No orders yet.</p>
          : (
            <ul className="flex flex-col gap-space-xs">
              {data.last_orders.map((order) => (
                <li key={order.source_order_id} className={`${TILE} flex items-center justify-between gap-space-sm flex-wrap`}>
                  <span className="font-body-lg text-body-lg text-on-surface">{dayText(order.ordered_at, zone)}</span>
                  <span className={`${MONO} text-on-surface-variant`}>Order {order.source_order_id}</span>
                </li>
              ))}
            </ul>
          )}
      </Section>
    </>
  )
}
