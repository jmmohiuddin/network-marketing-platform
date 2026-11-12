// Pass 1 (lineVolumePass): line sources, item rules, order filter, period order events, customer roll-up split.
import { describe, expect, test } from 'vitest'
import { base, event, inputWith, line, order, personal, volumesOf } from './context.js'

const A = 0, B = 1, D = 3 // position indexes of the G-E2E-01 tree (A -> B, A -> C, B -> D)
const run = (over: Parameters<typeof inputWith>[0]) => volumesOf(inputWith(over)).lineVolumes
/** [orderId, lineId, positionIndex, ...values] per credited row. */
const rows = (over: Parameters<typeof inputWith>[0]) => run(over).lines.map((l) => [l.orderId, l.lineId, l.positionIndex, ...l.values])

describe('lineVolumePass: measures per order line', () => {
  test('G-E2E-01: one row per order line, sorted by order id, customer flag from the buyer type', () => {
    const out = volumesOf(base).lineVolumes
    expect(out.measureKeys).toEqual(['pv', 'retail_base', 'sales'])
    expect(out.lines.map((l) => [l.orderId, l.positionIndex, l.customer, ...l.values])).toEqual([
      ['o-A', A, false, 10000n, 0n, 10000n],
      ['o-B', B, false, 20000n, 0n, 20000n],
      ['o-C', 2, false, 10000n, 0n, 10000n],
      ['o-D', D, false, 30000n, 0n, 30000n],
      ['o-K1', B, true, 40000n, 40000n, 40000n],
      ['o-K2', D, true, 15000n, 15000n, 15000n],
    ])
    expect(out.warnings).toEqual([])
  })

  test('sources: named volume per unit x quantity (missing name = 0), amount, amount less tax', () => {
    const measures = [personal('qv', { source: { from: 'volume', name: 'qv' } }), personal('cv', { source: { from: 'volume', name: 'cv' } }), personal('amt'), personal('net', { source: { from: 'amount_ex_tax' } })]
    const orders = [order('o1', 'A', [line('1', { quantity: 3, amountMinor: 11000n, taxMinor: 1000n, volumes: [{ name: 'qv', perUnitMinor: 1500n }] })])]
    expect(rows({ measures, orders })).toEqual([['o1', '1', A, 4500n, 0n, 11000n, 10000n]])
  })

  test('item rules: excluded item classes and category crediting are per measure', () => {
    const measures = [personal('all'), personal('noKit', { items: { excludeItemClasses: ['starter_kit'], categories: null } }), personal('wellness', { items: { excludeItemClasses: [], categories: ['wellness'] } })]
    const orders = [order('o1', 'A', [line('1', { itemClass: 'starter_kit', category: 'wellness' }), line('2', { amountMinor: 500n })])]
    expect(rows({ measures, orders })).toEqual([['o1', '1', A, 10000n, 0n, 10000n], ['o1', '2', A, 500n, 500n, 0n]])
  })

  test('order filter: own = buyer type not an end customer, customer = end-customer orders, all', () => {
    const measures = [personal('own', { orders: 'own' }), personal('cust', { orders: 'customer' }), personal('all')]
    const orders = [order('o1', 'B', [line('1')]), order('o2', 'B', [line('1', { amountMinor: 300n })], { buyerParticipantId: 'K1', buyerTypeCode: 'customer', purpose: 'customer' })]
    expect(rows({ measures, orders })).toEqual([['o1', '1', B, 10000n, 0n, 10000n], ['o2', '1', B, 0n, 300n, 300n]])
  })

  test('company-credited orders keep position index -1', () => {
    expect(rows({ measures: [personal('pv')], orders: [order('o1', null, [line('1')])] })).toEqual([['o1', '1', -1, 10000n]])
  })

  test('unknown buyer type, unknown credit position, duplicate order or line id, bad quantity fail the run', () => {
    const measures = [personal('pv')]
    expect(() => run({ measures, orders: [order('o1', 'A', [line('1')], { buyerTypeCode: 'nope' })] })).toThrow('INVALID_INPUT')
    expect(() => run({ measures, orders: [order('o1', 'Z', [line('1')])] })).toThrow('INVALID_INPUT')
    expect(() => run({ measures, orders: [order('o1', 'A', [line('1')]), order('o1', 'B', [line('1')])] })).toThrow('duplicate order id')
    expect(() => run({ measures, orders: [order('o1', 'A', [line('1'), line('1')])] })).toThrow('duplicate line id')
    expect(() => run({ measures, orders: [order('o1', 'A', [line('1', { quantity: 0 })])] })).toThrow('INVALID_INPUT')
  })

  test('deterministic: shuffled orders, lines and events give the same output', () => {
    const measures = [personal('pv')]
    const orders = [order('o2', 'C', [line('b'), line('a')]), order('o1', 'A', [line('1', { quantity: 2 })])]
    const events = [event('e2', 'o1', '1', 'return', 1, { atUs: 9n }), event('e1', 'o2', 'a', 'refund', 1, { atUs: 9n })]
    const one = run({ measures, orders, events })
    const two = run({ measures, orders: [...orders].reverse().map((o) => ({ ...o, lines: [...o.lines].reverse() })), events: [...events].reverse() })
    expect(two).toEqual(one)
    expect(one.lines.map((l) => [l.orderId, l.lineId])).toEqual([['o1', '1'], ['o2', 'b']])
  })
})

describe('lineVolumePass: order events of the period (BR-RET-01..03, BR-VOL-03, BR-REV-06)', () => {
  const measures = [personal('pv')]
  const twoLines = [order('o1', 'A', [line('1'), line('2', { amountMinor: 20000n })])]

  test('TS-47: a return reverses only that line; an equal-value exchange reverses nothing', () => {
    expect(rows({ measures, orders: twoLines, events: [event('e1', 'o1', '1', 'return', 1)] })).toEqual([['o1', '2', A, 20000n]])
    expect(rows({ measures, orders: twoLines, events: [event('e1', 'o1', '2', 'exchange', 1)] })).toEqual([['o1', '1', A, 10000n], ['o1', '2', A, 20000n]])
  })

  test('refund, return, chargeback and cancelled reverse pro rata to quantity, rounded once per line', () => {
    const orders = [order('o1', 'A', [line('1', { quantity: 3, amountMinor: 1000n })])]
    for (const type of ['refund', 'return', 'chargeback', 'cancelled'] as const) {
      expect(rows({ measures, orders, events: [event('e1', 'o1', '1', type, 1)] }), type).toEqual([['o1', '1', A, 667n]]) // 1000 - 333.33
    }
    const thirds = [1, 2, 3].map((i) => event(`e${i}`, 'o1', '1', 'return', 1))
    expect(rows({ measures, orders, events: thirds })).toEqual([]) // 3 x 1/3 reverses exactly the whole line
  })

  test('TS-65: restocking fee keeps its share of volume only when the setting is on', () => {
    const orders = [order('o1', 'A', [line('1', { quantity: 2 })])]
    const events = [event('e1', 'o1', '1', 'return', 1, { refundMinor: 4000n, restockingFeeMinor: 1000n })]
    expect(rows({ measures, orders, events, settings: { restockingFeeAffectsVolume: false } })).toEqual([['o1', '1', A, 5000n]])
    expect(rows({ measures, orders, events, settings: { restockingFeeAffectsVolume: true } })).toEqual([['o1', '1', A, 6000n]]) // 5000 x 4000/5000 reversed
  })

  test('chargeback reversed credits the volume back; events apply in time order whatever their input order', () => {
    const orders = [order('o1', 'A', [line('1', { quantity: 2 })])]
    const events = [event('e2', 'o1', '1', 'chargeback_reversed', 1, { atUs: 20n }), event('e1', 'o1', '1', 'chargeback', 2, { atUs: 10n })]
    expect(rows({ measures, orders, events })).toEqual([['o1', '1', A, 5000n]])
  })

  test('over-reversal, chargeback reversed without a chargeback, a fee on a chargeback and orphan events fail', () => {
    const orders = [order('o1', 'A', [line('1', { quantity: 2 })])]
    const fails = (events: Parameters<typeof inputWith>[0]['events']) => () => run({ measures, orders, events })
    expect(fails([event('e1', 'o1', '1', 'return', 1), event('e2', 'o1', '1', 'refund', 2)])).toThrow('exceeds purchased')
    expect(fails([event('e1', 'o1', '1', 'chargeback_reversed', 1)])).toThrow('exceeds the quantity charged back')
    expect(fails([event('e1', 'o1', '1', 'chargeback', 1, { restockingFeeMinor: 1n })])).toThrow('no restocking fee')
    expect(fails([event('e1', 'o1', '9', 'return', 1)])).toThrow('not in this period')
    expect(fails([event('e1', 'o1', '1', 'return', 0)])).toThrow('positive integer quantity')
  })
})

describe('lineVolumePass: customer roll-up split up the servicing chain (BR-ATT-04, TS-65)', () => {
  const measures = [personal('pv'), personal('rolled')]
  const rollUp70 = { customerRollUp: { measures: ['rolled'], shares: [{ level: 1, share: '0.3' }, { level: 0, share: '0.7' }] } }
  const customerOrder = (credit: string | null, amountMinor: bigint) => order('o1', credit, [line('1', { amountMinor })], { buyerParticipantId: 'K2', buyerTypeCode: 'customer', purpose: 'customer' })

  test('70/30: level 0 = servicing position, level 1 = its sponsor; measures not listed stay whole', () => {
    expect(rows({ measures, plan: rollUp70, orders: [customerOrder('D', 100000n)] })).toEqual([['o1', '1', B, 0n, 30000n], ['o1', '1', D, 100000n, 70000n]])
  })

  test('largest remainder keeps the sum exact; levels past the root go to the company', () => {
    expect(rows({ measures, plan: rollUp70, orders: [customerOrder('A', 101n)] })).toEqual([['o1', '1', -1, 0n, 30n], ['o1', '1', A, 101n, 71n]])
    expect(rows({ measures, plan: rollUp70, orders: [customerOrder(null, 100n)] })).toEqual([['o1', '1', -1, 100n, 100n]])
  })

  test("participants' own orders are not split", () => {
    expect(rows({ measures, plan: rollUp70, orders: [order('o1', 'D', [line('1')])] })).toEqual([['o1', '1', D, 10000n, 10000n]])
  })

  test('shares must sum to 1 over distinct levels and name volume.personal measures', () => {
    const orders = [customerOrder('D', 100n)]
    expect(() => run({ measures, orders, plan: { customerRollUp: { measures: ['rolled'], shares: [{ level: 0, share: '0.7' }] } } })).toThrow('summing to 1')
    expect(() => run({ measures, orders, plan: { customerRollUp: { measures: ['rolled'], shares: [{ level: 0, share: '0.5' }, { level: 0, share: '0.5' }] } } })).toThrow('distinct levels')
    expect(() => run({ measures, orders, plan: { customerRollUp: { measures: ['gv'], shares: [{ level: 0, share: '1' }] } } })).toThrow('not volume.personal')
  })
})
