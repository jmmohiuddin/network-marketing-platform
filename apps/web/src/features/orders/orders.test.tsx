// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { minorToDecimal, moneyText, volumesText } from './format'
import { LateQueuePage } from './late-queue-page'
import { OrdersPage } from './orders-page'
import type { LateItem, OrderDetail } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MARKET = { id: 'm1', code: 'NL', name: 'Netherlands', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture', time_zone: 'Europe/Amsterdam', languages: ['nl'], minor_unit: 2 }
const ANALYST = adminMe({ permissions: ['order.read', 'late.manage', 'product.manage'] })
const CREDITED = '2026-11-17T09:00:00.000Z'

const ORDER: OrderDetail = {
  id: 'o1', source_system: 'shop', source_order_id: 'ORD-1', market: { id: 'm1', code: 'NL' },
  buyer: { id: 'k', external_ref: 'K-1', display_name: 'Kim Customer' }, buyer_type: { code: 'RETAIL' }, purpose: 'customer', purpose_missing: false,
  attributed_position: { id: 'pos-c', position_ref: 'P-C' }, attribution_source: 'link', attribution_conflict: true, credited_at: CREDITED, period_id: null,
  amount_minor: '123456', tax_minor: '0', currency: 'EUR', volumes: { pv: '140' }, ordered_at: CREDITED,
  lines: [{ line_no: 1, sku: 'SKU-1', item_class: 'product', quantity: 2, amount_minor: '123456', volumes: { pv: '140' } }],
  events: [{ id: 'e1', type: 'return', occurred_at: CREDITED, lines: [{ line_no: 1, quantity: 1 }], refund_minor: '61728', fee_minor: '0', equal_value: false, volume_effect: { total: { pv: '-70' } }, late: false }],
  late_transactions: [], source: { inbound_event_id: 'i1', received_at: CREDITED, source: 'api:shop' },
}

describe('order format', () => {
  it('formats minor units exactly, without floating point', () => {
    expect(minorToDecimal('123456', 2)).toBe('1234.56')
    expect(minorToDecimal('-5', 2)).toBe('-0.05')
    expect(minorToDecimal('9007199254740993', 2)).toBe('90071992547409.93')
    expect(minorToDecimal('42', 0)).toBe('42')
    expect(moneyText('123456', 'EUR', 2)).toBe(`${(1234).toLocaleString()}.56 EUR`)
    expect(moneyText('7', 'EUR', undefined)).toBe('7 EUR minor units')
    expect(volumesText({ pv: '140', cv: '-20' })).toBe('-20 cv · 140 pv')
    expect(volumesText({})).toBe('—')
  })
})

describe('OrdersPage (SC-31)', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.router.replace.mockReset()
  })

  it('shows summary KPIs, the orders table and the inspector of the selected order', async () => {
    navigation.search = 'order=o1&purpose=customer'
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/orders/summary': () => ok({ orders: 12, held: 2, late_pending: 1, purpose_missing: 3, attribution_conflict: 4 }),
      'GET /v1/orders': () => ok([{ ...ORDER, events: 1, late: true }]),
      'GET /v1/orders/o1': () => ok(ORDER),
    })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    const kpis = await screen.findByTestId('kpis')
    expect((await within(kpis).findByText('12')).textContent).toBe('12')
    expect(kpis.textContent).toContain('Attribution conflicts4')
    const inspector = await screen.findByTestId('inspector')
    expect(await within(inspector).findByText('RETAIL')).toBeTruthy()
    expect(within(inspector).getByText(/different position than the buyer's servicer/)).toBeTruthy()
    expect(within(inspector).getByText('Volume effect: -70 pv')).toBeTruthy()
    expect(within(inspector).getByRole('link', { name: 'Open in genealogy' }).getAttribute('href')).toBe('/genealogy?root=pos-c')
    expect(screen.getByRole('link', { name: 'ORD-1' }).getAttribute('href')).toBe('/orders?order=o1&purpose=customer')
    const [url] = callsTo(fetchMock, 'GET', '/v1/orders')[0]!
    expect(new URL(url, 'http://x').searchParams.get('purpose')).toBe('customer')
  })

  it('retries a held inbound event for product.manage', async () => {
    navigation.search = 'tab=exceptions'
    const held = { id: 'i9', source: 'api:shop', idempotency_key: 'order:shop:ORD-9', received_at: CREDITED, state: 'held', hold_reason: 'UNKNOWN_SKU', hold_ref: 'SKU-9', attempts: 1, result: null }
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/inbound-events': () => ok([held]),
      'POST /v1/inbound-events/i9/retry': () => ok({ state: 'processed', result: { order_id: 'o9' } }),
    })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    expect(await screen.findByText('Unknown SKU (no volumes yet): SKU-9')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Retry order:shop:ORD-9' }))
    expect(await screen.findByText('Processed: the order or event is recorded.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/inbound-events/i9/retry')).toHaveLength(1)
  })

  it('sets product volumes with exact strings and an Idempotency-Key', async () => {
    navigation.search = 'tab=volumes'
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/product-volumes': () => ok([]),
      'POST /v1/product-volumes': () => ok({ id: 'v1' }, 201),
    })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Set volumes' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set volumes' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    await userEvent.type(within(dialog).getByLabelText('SKU'), 'SKU-1')
    await userEvent.type(within(dialog).getByLabelText('Measure 1'), 'PV')
    await userEvent.type(within(dialog).getByLabelText('Per unit 1'), '70')
    await userEvent.type(within(dialog).getByLabelText('Valid from (your time)'), '2026-01-01T00:00')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Launch catalogue')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save volumes' }))
    expect(await within(dialog).findAllByText('Use lower-case letters, digits and _ (start with a letter).')).toHaveLength(2)
    await userEvent.clear(within(dialog).getByLabelText('Measure 1'))
    await userEvent.type(within(dialog).getByLabelText('Measure 1'), 'pv')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save volumes' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/product-volumes')).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/product-volumes')[0]!
    expect(bodyOf(init)).toMatchObject({ market_id: 'm1', sku: 'SKU-1', item_class: 'product', volumes: { pv: '70' }, reason: 'Launch catalogue' })
    expect(headerOf(init, 'idempotency-key')).not.toBeNull()
  })

  it('refuses a negative per-unit volume before sending (the API takes non-negative minor units)', async () => {
    navigation.search = 'tab=volumes'
    const fetchMock = fetchByRoute({ 'GET /v1/markets': () => ok([MARKET]), 'GET /v1/product-volumes': () => ok([]) })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Set volumes' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set volumes' })
    await userEvent.type(within(dialog).getByLabelText('Per unit 1'), '-5')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save volumes' }))
    expect(await within(dialog).findAllByText('Enter whole minor units, for example 140.')).toHaveLength(2)
    expect(callsTo(fetchMock, 'POST', '/v1/product-volumes')).toHaveLength(0)
  })

  it('shows the exception queue as not available to a market-scoped reader (SCOPE_NOT_HELD), with no retry', async () => {
    navigation.search = 'tab=exceptions'
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/inbound-events': () => apiError(403, 'SCOPE_NOT_HELD', 'This needs all-markets scope.'),
    })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    expect(await screen.findByText(/Not found or not available/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('is not available without order.read or product.manage', () => {
    renderAs(adminMe({ permissions: ['late.manage'] }), <OrdersPage />, fetchByRoute({}))
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })
})

describe('LateQueuePage (SC-32)', () => {
  const item = (id: string, ref: string): LateItem => ({
    id, origin_type: 'order', origin_id: `o-${id}`, order: { id: `o-${id}`, source_order_id: ref },
    original_period: { id: 'per1', starts_at: '2026-09-01T00:00:00.000Z', ends_at: '2026-10-01T00:00:00.000Z', state: 'committed' },
    effect_estimate: { volumes: { pv: '70' }, amount_minor: '5000', attributed_position_id: null }, handling: 'adjust', state: 'pending',
    decided_at: null, decision_reason: null, created_at: CREDITED,
  })

  beforeEach(() => {
    navigation.search = ''
  })

  it('previews the selection and accepts the proposed handling with one Idempotency-Key', async () => {
    let decided = false
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/late-transactions': () => json(200, { data: decided ? [] : [item('l1', 'ORD-1'), item('l2', 'ORD-2')], meta: { next_cursor: null, counts: { pending: decided ? 0 : 2, decided_30d: decided ? 2 : 0 } } }),
      'POST /v1/late-transactions/preview': () => ok({ count: 2, volumes: { pv: '140' }, amount_minor: '10000', affected_positions: [{ id: 'pos-c', position_ref: 'P-C' }] }),
      'POST /v1/late-transactions/decisions': () => {
        decided = true
        return ok({ decided: 2 })
      },
    })
    renderAs(ANALYST, <LateQueuePage />, fetchMock)
    const kpis = await screen.findByTestId('kpis')
    await vi.waitFor(() => expect(kpis.textContent).toContain('Pending late items2'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select order ORD-1' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select order ORD-2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Accept proposed handling' }))
    const dialog = await screen.findByRole('dialog', { name: 'Accept proposed handling' })
    const preview = await within(dialog).findByTestId('late-preview')
    expect(preview.textContent).toContain(`${(10000n).toLocaleString()} minor units`)
    expect(preview.textContent).toContain('140 pv')
    expect(within(preview).getByText('P-C')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/late-transactions/preview')[0]![1])).toEqual({ ids: ['l1', 'l2'] })
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Adjust in November')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept 2 items' }))
    expect(await screen.findByText('No late transactions are waiting')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/late-transactions/decisions')[0]!
    expect(bodyOf(init)).toEqual({ ids: ['l1', 'l2'], reason: 'Adjust in November' })
    expect(headerOf(init, 'idempotency-key')).not.toBeNull()
  })

  it('never decides without a preview: a failed preview blocks Accept until Try again succeeds', async () => {
    let previews = 0
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/late-transactions': () => json(200, { data: [item('l1', 'ORD-1'), item('l2', 'ORD-2')], meta: { next_cursor: null, counts: { pending: 2, decided_30d: 0 } } }),
      'POST /v1/late-transactions/preview': () => {
        previews += 1
        return previews === 1 ? apiError(422, 'VALIDATION_FAILED', 'The preview could not be calculated.')
          : ok({ count: 2, volumes: { pv: '140' }, amount_minor: '10000', affected_positions: [] })
      },
      'POST /v1/late-transactions/decisions': () => ok({ decided: 2 }),
    })
    renderAs(ANALYST, <LateQueuePage />, fetchMock)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select all pending items on this page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Accept proposed handling' }))
    const dialog = await screen.findByRole('dialog', { name: 'Accept proposed handling' })
    expect(await within(dialog).findByText('Preview not available')).toBeTruthy()
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Adjust in November')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept 2 items' }))
    expect(await within(dialog).findByText('Wait for the preview of the effect before accepting.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/late-transactions/decisions')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await within(dialog).findByTestId('late-preview')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept 2 items' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/late-transactions/decisions')).toHaveLength(1))
  })

  it('says the KPI counts cover all markets in scope when a market is chosen', async () => {
    navigation.search = 'market_id=m1'
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/late-transactions': () => json(200, { data: [], meta: { next_cursor: null, counts: { pending: 3, decided_30d: 0 } } }),
    })
    renderAs(ANALYST, <LateQueuePage />, fetchMock)
    const kpis = await screen.findByTestId('kpis')
    await vi.waitFor(() => expect(kpis.textContent).toContain('not yet decided (all markets in your scope)'))
  })

  it('raises one item as a restatement from its diagnostic, and shows a refusal', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/late-transactions': () => json(200, { data: [item('l1', 'ORD-1')], meta: { next_cursor: null, counts: { pending: 1, decided_30d: 0 } } }),
      'POST /v1/late-transactions/decisions': () => apiError(409, 'LATE_NOT_PENDING', 'Some selected items were already decided.'),
    })
    renderAs(ANALYST, <LateQueuePage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Diagnose ORD-1' }))
    const diagnostic = screen.getByTestId('diagnostic')
    expect(diagnostic.textContent).toContain(`${(5000n).toLocaleString()} minor units`)
    await userEvent.click(within(diagnostic).getByRole('button', { name: 'Raise restatement instead' }))
    const dialog = await screen.findByRole('dialog', { name: 'Raise restatement instead' })
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Material change')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Raise restatement' }))
    expect(await within(dialog).findByText('Some selected items were already decided.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/late-transactions/decisions')[0]![1])).toEqual({ ids: ['l1'], handling: 'restatement', reason: 'Material change' })
  })

  it('is not available without late.manage', () => {
    renderAs(adminMe({ permissions: ['order.read'] }), <LateQueuePage />, fetchByRoute({}))
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })
})
