'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Banner } from '../../components/banner'
import { FOCUS_RING } from '../../components/button'
import { Icon } from '../../components/icon'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useResource } from '../../lib/use-resource'
import { CAPTION, CARD, ClosedNotice, LINK_CARD, MONO, PAGE_TITLE, Section, SHOW_FIRST, TILE } from './blocks'
import type { L10n } from './format'
import { usePortal } from './shell'
import type { Customer, CustomerDetail } from './types'
import { PortalFailure, PortalSelect, ShowMore, useShownList } from './ui'

// SC-21 my customers (FR-DIST-005, D-B5-11): the customers you service now (Current) or did (Past), repeat buyers
// (2 or more orders), by name or last order; contact only when the company shows it. No earnings per customer, no
// targets, growth figures, store links or exports.

type StateFilter = 'current' | 'past'

const CHIP = `shrink-0 min-h-11 px-3 rounded-full font-caption text-caption ${FOCUS_RING}`

export function CustomersPage() {
  const { profile, words: { t } } = usePortal()
  const [state, setState] = useState<StateFilter>('current')
  const [repeat, setRepeat] = useState(false)
  const [sort, setSort] = useState<'name' | 'last_order'>('name')
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>{t('nav.customers')}</h1><ClosedNotice t={t} /></>
  const chip = (label: string, pressed: boolean, onClick: () => void) => (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`${CHIP} ${pressed ? 'bg-primary-container text-on-primary font-semibold' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}>{label}</button>
  )
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('nav.customers')}</h1>
      <div className="flex flex-col gap-space-xs">
        <div role="group" aria-label={t('customers.show')} className="flex flex-wrap items-center gap-space-xs">
          {chip(t('customers.current'), state === 'current', () => setState('current'))}
          {chip(t('customers.past'), state === 'past', () => setState('past'))}
          {chip(t('customers.repeat_buyers'), repeat, () => setRepeat(!repeat))}
        </div>
        <PortalSelect id="customer-sort" label={t('customers.sort_by')} value={sort} onChange={(event) => setSort(event.target.value === 'last_order' ? 'last_order' : 'name')}
          options={[{ value: 'name', label: t('customers.sort_name') }, { value: 'last_order', label: t('customers.last_order') }]} />
      </div>
      <CustomerList query={{ state, sort, repeat: repeat ? 'true' : undefined }} />
    </>
  )
}

function CustomerList({ query }: { readonly query: { readonly state: StateFilter; readonly sort: string; readonly repeat: string | undefined } }) {
  const { words } = usePortal()
  const { t } = words
  const list = useShownList<Customer[]>('/v1/me/customers', query, SHOW_FIRST)
  if (list.first.error !== null) return <PortalFailure error={list.first.error} onRetry={list.first.reload} />
  if (list.rows === null) return <LoadingState label={t('customers.loading')} />
  if (list.rows.length === 0) {
    return <EmptyState title={query.state === 'past' ? t('customers.no_past') : t('customers.none')}>{t('customers.empty_text')}</EmptyState>
  }
  return (
    <>
      <ul className="flex flex-col gap-space-sm" data-testid="card">
        {list.rows.map((customer) => (
          <li key={`${customer.customer_id}-${customer.since}`}>
            <Link href={`/portal/customers/${customer.customer_id}`} className={`${LINK_CARD} flex-col items-stretch`}>
              <div className="flex items-start justify-between gap-space-sm flex-wrap">
                <div className="flex flex-col min-w-0">
                  <span className="font-section-heading text-section-heading text-on-surface break-words">{customer.display_name ?? t('common.name_not_shown')}</span>
                  <span className={`${MONO} text-outline`}>{t('customers.serviced_by', { ref: customer.serviced_by_position_ref })}</span>
                </div>
                {customer.repeat && <StatusBadge state="active" label={t('customers.repeat_buyer')} />}
              </div>
              {customer.until !== null && (
                <div className="bg-surface-container-high/60 p-2.5 rounded-lg flex items-start gap-2">
                  <Icon name="assignment_ind" size={18} className="text-primary shrink-0 mt-0.5" />
                  <span className={CAPTION}><span className="font-semibold text-on-surface">{t('customers.reassigned', { at: words.day(customer.until) })}</span> {t('customers.no_longer')}</span>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-2">
                <div className={`${TILE} flex flex-col min-w-0`}>
                  <dt className={CAPTION}>{t('customers.last_order')}</dt>
                  <dd className="font-body-lg text-body-lg text-on-surface">{customer.last_order_at === null ? t('customers.no_orders') : words.day(customer.last_order_at)}</dd>
                </div>
                <div className={`${TILE} flex flex-col min-w-0`}>
                  <dt className={CAPTION}>{t('customers.orders')}</dt>
                  <dd className="font-body-lg text-body-lg text-on-surface">{new Intl.NumberFormat(words.locale).format(customer.order_count)}</dd>
                </div>
              </dl>
              <span className={CAPTION}>{servicedText(customer.since, customer.until, words)}</span>
              {customer.contact_masked != null && <span className={`${MONO} text-on-surface-variant break-all`}>{Object.values(customer.contact_masked).join(' · ')}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <ShowMore list={list} label={t('customers.more')} />
    </>
  )
}

function servicedText(since: string, until: string | null, words: L10n): string {
  return until === null ? words.t('customers.since', { from: words.day(since) }) : words.t('customers.since_until', { from: words.day(since), to: words.day(until) })
}

export function CustomerPage({ customerId }: { readonly customerId: string }) {
  const { profile, words } = usePortal()
  const { t } = words
  const customer = useResource<CustomerDetail>(profile.terminated ? null : `/v1/me/customers/${customerId}`)
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>{t('customers.customer')}</h1><ClosedNotice t={t} /></>
  if (customer.error !== null) return <PortalFailure error={customer.error} onRetry={customer.reload} />
  if (customer.data === null) return <LoadingState label={t('customers.loading_customer')} />
  const data = customer.data
  const ended = data.servicing.filter((row) => row.until !== null)
  return (
    <>
      <div className={`${CARD} flex flex-col gap-1`}>
        <h1 className={`${PAGE_TITLE} break-words`}>{data.display_name ?? t('common.name_not_shown')}</h1>
        {data.contact_masked != null && <span className={`${MONO} text-on-surface-variant break-all`}>{Object.values(data.contact_masked).join(' · ')}</span>}
      </div>
      {ended.length > 0 && (
        <Banner tone="info" title={t('customers.servicing_changed')}>
          {ended.map((row) => t('customers.serviced_until', { ref: row.position_ref, at: words.day(row.until!) })).join(' ')}
        </Banner>
      )}
      <Section title={t('customers.serviced_by_you')} icon="assignment_ind">
        <ul className="flex flex-col gap-space-xs">
          {data.servicing.map((row) => (
            <li key={`${row.position_ref}-${row.since}`} className={`${TILE} flex flex-col`}>
              <span className={`${MONO} text-on-surface`}>{row.position_ref}</span>
              <span className={CAPTION}>{servicedText(row.since, row.until, words)} · {t('customers.order_count', { count: row.order_count })}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t('customers.last_orders')} icon="receipt_long">
        {data.last_orders.length === 0
          ? <p className={CAPTION}>{t('customers.no_orders')}</p>
          : (
            <ul className="flex flex-col gap-space-xs">
              {data.last_orders.map((order) => (
                <li key={order.source_order_id} className={`${TILE} flex items-center justify-between gap-space-sm flex-wrap`}>
                  <span className="font-body-lg text-body-lg text-on-surface">{words.day(order.ordered_at)}</span>
                  <span className={`${MONO} text-on-surface-variant break-all`}>{t('customers.order', { id: order.source_order_id })}</span>
                </li>
              ))}
            </ul>
          )}
      </Section>
    </>
  )
}
