// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '../../lib/format'
import { ok } from '../../test/fetch'
import { adminMe, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { currencyDigits, holdText, moneyText, rateText } from './format'
import { OrdersPage } from './orders-page'
import type { OrderDetail } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MARKET = { id: 'm1', code: 'BE', name: 'Belgium', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture', time_zone: 'Europe/Brussels', languages: ['en'], minor_unit: 2 }
const ANALYST = adminMe({ permissions: ['order.read', 'product.manage'] })
const AT = '2026-11-18T09:00:00.000Z'
const CHARGEBACK_AT = '2026-11-10T09:00:00.000Z'
const EVENT = { lines: null, equal_value: false, volume_effect: {}, late: false, original: null, dispute_of_event_id: null }

/** W-V1-A-1/4: a CHF order converted at 1.0412, with a subscription and its record-only events. */
const ORDER: OrderDetail = {
  id: 'o1', source_system: 'shop', source_order_id: 'O-BE-C-1', market: { id: 'm1', code: 'BE' },
  buyer: { id: 'c', external_ref: 'BE-C', display_name: null }, buyer_type: { code: 'DIST' }, purpose: 'personal', purpose_missing: false,
  attributed_position: null, attribution_source: null, attribution_conflict: false, credited_at: AT, period_id: null,
  amount_minor: '12494', tax_minor: '0', currency: 'EUR', volumes: {}, ordered_at: AT, subscription_ref: 'SUB-1',
  original: { currency: 'CHF', amount_minor: '12000', tax_minor: '0', rate: '1.0412000000', rate_valid_from: '2026-11-01T00:00:00.000Z', rate_id: 'r1' },
  lines: [{ line_no: 1, sku: 'SKU-1', item_class: 'product', quantity: 1, amount_minor: '12494', volumes: {} }],
  events: [
    { ...EVENT, id: 'e1', type: 'refund', occurred_at: AT, refund_minor: '6247', fee_minor: '0', original: { refund_minor: '6000', fee_minor: '0', currency: 'CHF' } },
    { ...EVENT, id: 'e2', type: 'renewal_failed', occurred_at: AT, refund_minor: '0', fee_minor: '0' },
    { ...EVENT, id: 'e3', type: 'subscription_cancelled', occurred_at: AT, refund_minor: '0', fee_minor: '0' },
    { ...EVENT, id: 'e0', type: 'chargeback', occurred_at: CHARGEBACK_AT, refund_minor: '12494', fee_minor: '0' },
    { ...EVENT, id: 'e4', type: 'dispute_lost', occurred_at: AT, refund_minor: '0', fee_minor: '0', dispute_of_event_id: 'e0' },
  ],
  late_transactions: [], source: { inbound_event_id: 'i1', received_at: AT, source: 'api:shop' },
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.replace.mockReset()
})

describe('V1-A order words', () => {
  it('names hold reasons with their reference, FX pairs as pairs, and currency decimals from ISO 4217', () => {
    expect(holdText('FX_RATE_STALE', 'USD:EUR')).toBe('Exchange rate older than the allowed age: USD → EUR')
    expect(holdText('SUBSCRIPTION_NOT_FOUND', 'SUB-404')).toBe('No order with this subscription yet: SUB-404')
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('CHF')).toBe(2)
    expect(rateText('1.0412000000')).toBe('1.0412')
    expect(rateText('2.0000000000')).toBe('2')
  })
})

describe('SC-31 V1-A (subscriptions, conversions, disputes)', () => {
  it('shows the subscription, the original amount, rate and rate date, and the record-only events', async () => {
    navigation.search = 'order=o1'
    renderAs(ANALYST, <OrdersPage />, fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/orders/summary': () => ok({ orders: 1, held: 0, late_pending: 0, purpose_missing: 0, attribution_conflict: 0 }),
      'GET /v1/orders': () => ok([{ ...ORDER, events: 4, late: false }]),
      'GET /v1/orders/o1': () => ok(ORDER),
      'GET /v1/saved-views': () => ok([]),
    }))
    const inspector = await screen.findByTestId('inspector')
    expect(await within(inspector).findByText('SUB-1')).toBeTruthy()
    const conversion = within(inspector).getByTestId('conversion')
    expect(conversion.textContent).toContain(`${moneyText('12000', 'CHF', 2)} · tax`)
    expect(conversion.textContent).toContain('1 CHF = 1.0412 EUR')
    expect(conversion.textContent).toContain(moneyText('12494', 'EUR', 2))
    expect(within(inspector).getByText(/sent as 60\.00 CHF/)).toBeTruthy()
    expect(within(inspector).getByText('Subscription renewal failed')).toBeTruthy()
    expect(within(inspector).getByText('Subscription cancelled')).toBeTruthy()
    expect(within(inspector).getByText('Dispute lost (chargeback stands)')).toBeTruthy()
    expect(within(inspector).getByText(`Closes the chargeback of ${formatDateTime(CHARGEBACK_AT)}`)).toBeTruthy()
    expect(within(inspector).getAllByText('Recorded for the history: no volume or pay effect.')).toHaveLength(3)
  })

  it('searches orders by order or subscription reference (q)', async () => {
    renderAs(ANALYST, <OrdersPage />, fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/orders/summary': () => ok({ orders: 0, held: 0, late_pending: 0, purpose_missing: 0, attribution_conflict: 0 }),
      'GET /v1/orders': () => ok([]),
      'GET /v1/saved-views': () => ok([]),
    }))
    await userEvent.type(await screen.findByLabelText('Order or subscription reference'), 'SUB-1')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(navigation.router.replace).toHaveBeenLastCalledWith('/orders?q=SUB-1', { scroll: false })
  })

  it('sends q to the order list from the URL', async () => {
    navigation.search = 'q=SUB-1'
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/orders/summary': () => ok({ orders: 0, held: 0, late_pending: 0, purpose_missing: 0, attribution_conflict: 0 }),
      'GET /v1/orders': () => ok([]),
      'GET /v1/saved-views': () => ok([]),
    })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    expect(await screen.findByText('Order or subscription: SUB-1')).toBeTruthy()
    const [url] = callsTo(fetchMock, 'GET', '/v1/orders')[0]!
    expect(new URL(url, 'http://x').searchParams.get('q')).toBe('SUB-1')
  })

  it('lists the V1-A hold reasons in the exception queue', async () => {
    navigation.search = 'tab=exceptions'
    const held = (id: string, reason: string, ref: string) => ({ id, source: 'api:shop', idempotency_key: `k-${id}`, received_at: AT, state: 'held', hold_reason: reason, hold_ref: ref, attempts: 1, result: null })
    renderAs(ANALYST, <OrdersPage />, fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/inbound-events': () => ok([held('i1', 'SUBSCRIPTION_NOT_FOUND', 'SUB-404'), held('i2', 'FX_RATE_MISSING', 'USD:EUR')]),
    }))
    expect(await screen.findByText('No order with this subscription yet: SUB-404')).toBeTruthy()
    expect(screen.getByText('No exchange rate for the pair yet: USD → EUR')).toBeTruthy()
  })
})
