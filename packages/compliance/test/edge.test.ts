import { describe, expect, test } from 'vitest'
import { ComplianceInputError, computeReports, percent, type ComplianceConfigInput, type ComplianceFacts, type Ratio } from '../src/index.js'
import { roundedRatio } from '../src/percent.js'
import { interpolatedPercentile } from '../src/stats.js'
import { figure, FIXTURE_CONFIG, line, order, participant, period, value } from './helpers.js'

const PEOPLE = [participant('D1', 'distributor', '2024-12'), participant('D2', 'distributor', '2025-01', 'D1'), participant('C1', 'customer', '2025-01', 'D1')]
const JAN = '2025-01'
const EMPTY: ComplianceFacts = { participants: [], orders: [], payoutLines: [] }

describe('percent', () => {
  test('rounds half up to two places and returns a decimal string', () => {
    expect(percent(10000n, 16000n)).toBe('62.50')
    expect(percent(1n, 3n)).toBe('33.33')
    expect(percent(2n, 3n)).toBe('66.67')
    expect(percent(1n, 800n)).toBe('0.13')
    expect(percent(1n, 1n)).toBe('100.00')
    expect(percent(0n, 5n)).toBe('0.00')
  })

  test('is null when the denominator is zero', () => {
    expect(percent(0n, 0n)).toBeNull()
    expect(percent(5n, 0n)).toBeNull()
  })

  test('rounds ties away from zero for negative values and never prints -0.00', () => {
    expect(roundedRatio(-1n, 200n, 2)).toBe('-0.01')
    expect(roundedRatio(-1n, 100000n, 2)).toBe('0.00')
    expect(roundedRatio(-28605n, 1000n, 2)).toBe('-28.61')
  })
})

describe('percentiles', () => {
  test('interpolate linearly and exactly', () => {
    expect(interpolatedPercentile([0n, 2860n], 50)).toEqual({ numerator: 143000n, denominator: 100n })
    expect(interpolatedPercentile([10n, 20n, 30n, 40n, 50n], 90)).toEqual({ numerator: 4600n, denominator: 100n })
    expect(interpolatedPercentile([7n], 99)).toEqual({ numerator: 700n, denominator: 100n })
    expect(interpolatedPercentile([], 50)).toBeNull()
  })
})

describe('empty and zero-denominator input', () => {
  test('empty input gives no periods', () => {
    expect(computeReports({ participants: [], orders: [], payoutLines: [] }, {})).toMatchObject({ months: [], years: [], reports: [] })
  })

  test('a month with payouts but no orders has null R1 shares with a reason', () => {
    const reports = computeReports({ participants: PEOPLE, orders: [], payoutLines: [line('L1', JAN, 'D1', 'pool', null, 100n)] }, FIXTURE_CONFIG)
    expect(value(reports, 'R1', JAN, 'net_sales_cents')).toBe('0')
    expect(figure(reports, 'R1', JAN, 'customer_share_pct')).toMatchObject({ value: null, denominator: 0n })
    expect(figure(reports, 'R1', JAN, 'customer_share_pct').note).toContain('denominator is zero')
    expect(value(reports, 'R2', JAN, 'personal_use_share_pct')).toBeNull()
    expect(value(reports, 'R4', JAN, 'active_with_no_customer_order_pct')).toBeNull()
  })

  test('a month with only clawbacks has zero gross and no shares', () => {
    const reports = computeReports({ participants: PEOPLE, orders: [], payoutLines: [line('L1', JAN, 'D1', 'clawback', null, -50n)] }, {})
    expect(period(reports, 'R3', JAN).figures.map((f) => [f.key, f.value])).toEqual([['gross_cents', '0'], ['clawback_cents', '-50']])
  })

  test('R5 statistics are null with a note when nobody of an earning type is enrolled', () => {
    const reports = computeReports({ participants: [participant('C1', 'customer', '2025-01')], orders: [order('O1', 2, 'C1', 100n, 'customer')], payoutLines: [] }, {})
    expect(value(reports, 'R5', '2025', 'count')).toBe('0')
    for (const key of ['earned_more_than_zero_pct', 'mean', 'median', 'p75', 'p90', 'p99', 'max']) {
      expect(value(reports, 'R5', '2025', key), key).toBeNull()
      expect(figure(reports, 'R5', '2025', key).note, key).not.toBeNull()
    }
  })
})

describe('missing thresholds and data omit indicators instead of guessing', () => {
  const facts: ComplianceFacts = {
    participants: PEOPLE,
    orders: [order('O1', 3, 'C1', 10000n, 'customer'), order('O2', 28, 'D2', 6000n, 'personal')],
    payoutLines: [line('L1', JAN, 'D1', 'downline_volume', 'O2', 360n)],
  }
  const keys = (reports: ReturnType<typeof computeReports>, report: 'R2' | 'R4') => period(reports, report, JAN).figures.map((f) => f.key)

  test('no settings at all: R2 flag and every R4 indicator are omitted with reasons; the rest is computed', () => {
    const reports = computeReports(facts, {})
    expect(period(reports, 'R2', JAN).omitted.map((o) => o.key)).toEqual(['payees_above_flag', 'flag_threshold'])
    expect(keys(reports, 'R2')).not.toContain('payees_above_flag')
    expect(value(reports, 'R2', JAN, 'personal_use_share_pct')).toBe('100.00')
    expect(keys(reports, 'R4')).toEqual([])
    expect(period(reports, 'R4', JAN).omitted.map((o) => o.key)).toEqual([
      'active_distributors', 'active_with_no_customer_order_pct', 'late_threshold_crossing_orders', 'of_which_refunded_later',
    ])
    for (const o of [...period(reports, 'R2', JAN).omitted, ...period(reports, 'R4', JAN).omitted]) expect(o.reason).toContain('not set')
  })

  test('only the active threshold set: activity shown, late crossings omitted', () => {
    const reports = computeReports(facts, { activePvMinor: 5000n })
    expect(keys(reports, 'R4')).toEqual(['active_distributors', 'active_with_no_customer_order_pct'])
    expect(period(reports, 'R4', JAN).omitted.map((o) => o.key)).toEqual(['late_threshold_crossing_orders', 'of_which_refunded_later'])
  })

  test('null settings are unset, never a zero threshold (E-ADR-11)', () => {
    const reports = computeReports(facts, { activePvMinor: null, rankThresholdsPvMinor: null, lateOrderDay: null, personalShareFlag: null })
    expect(keys(reports, 'R4')).toEqual([])
    expect(period(reports, 'R4', JAN).omitted.map((o) => o.key)).toEqual([
      'active_distributors', 'active_with_no_customer_order_pct', 'late_threshold_crossing_orders', 'of_which_refunded_later',
    ])
    expect(period(reports, 'R2', JAN).omitted.map((o) => o.key)).toEqual(['payees_above_flag', 'flag_threshold'])
    expect(reports).toEqual(computeReports(facts, {}))
  })

  test('late day set but no rank thresholds: late crossings omitted', () => {
    const reports = computeReports(facts, { lateOrderDay: 27, rankThresholdsPvMinor: {} })
    expect(period(reports, 'R4', JAN).omitted.map((o) => o.reason)).toContain('No rank volume thresholds are set for this tenant; they have no default.')
  })

  test('an order without a day omits late crossings but keeps activity (C-13)', () => {
    const noDay = { ...facts, orders: [...facts.orders, order('O3', null, 'D2', 4000n, 'resale')] }
    const reports = computeReports(noDay, FIXTURE_CONFIG)
    expect(keys(reports, 'R4')).toEqual(['active_distributors', 'active_with_no_customer_order_pct'])
    expect(value(reports, 'R4', JAN, 'active_distributors')).toBe('1')
    expect(period(reports, 'R4', JAN).omitted[0]?.reason).toContain('1 order(s) in the month have no order day')
  })
})

describe('unattributable payout lines (C-12)', () => {
  const facts: ComplianceFacts = {
    participants: PEOPLE,
    orders: [order('O2', 5, 'D2', 6000n, 'personal')],
    payoutLines: [
      line('L1', JAN, 'D1', 'downline_volume', 'O2', 100n),
      line('L2', JAN, 'D1', 'downline_volume', null, 250n),
      line('L3', JAN, 'D1', 'downline_volume', 'MISSING', 50n),
      line('L4', JAN, 'D1', 'downline_volume', 'O2', -30n),
    ],
  }
  const reports = computeReports(facts, FIXTURE_CONFIG)

  test('are counted and summed, not crashed on, and excluded from rewarded volume', () => {
    expect(value(reports, 'R2', JAN, 'unattributable_lines')).toBe('2')
    expect(value(reports, 'R2', JAN, 'unattributable_amount_cents')).toBe('300')
    expect(figure(reports, 'R2', JAN, 'unattributable_lines').drill).toMatchObject({ entity: 'payout_line', numeratorIds: ['L2', 'L3'], denominatorCount: 3 })
    expect(value(reports, 'R2', JAN, 'rewarded_volume_cents')).toBe('6000')
    expect(value(reports, 'R2', JAN, 'personal_use_share_pct')).toBe('100.00')
    expect(period(reports, 'R2', JAN).notes[0]).toContain('2 multi-level payout line(s)')
  })

  test('their pay counts in the payee total but never as personal-use pay: 100 of 400 is not above one third', () => {
    expect(value(reports, 'R2', JAN, 'payees_with_multilevel_pay')).toBe('1')
    expect(value(reports, 'R2', JAN, 'payees_above_flag')).toBe('0')
  })
})

describe('refunds', () => {
  test('are netted into the order month for R1; R2 uses full volume', () => {
    const facts: ComplianceFacts = {
      participants: PEOPLE,
      orders: [
        order('O1', 3, 'C1', 10000n, 'customer', { refundedMinor: 2500n, refundMonth: '2025-03' }),
        order('O2', 5, 'D2', 6000n, 'personal', { refundedMinor: 6000n, refundMonth: JAN }),
        order('O3', 6, 'D2', 2500n, 'resale', { isStarterKit: true }),
      ],
      payoutLines: [line('L1', JAN, 'D1', 'downline_volume', 'O2', 360n)],
    }
    const reports = computeReports(facts, FIXTURE_CONFIG)
    expect(value(reports, 'R1', JAN, 'net_sales_cents')).toBe('10000')
    expect(value(reports, 'R1', JAN, 'customer_share_pct')).toBe('75.00')
    expect(value(reports, 'R1', JAN, 'customer_plus_declared_resale_pct')).toBe('100.00')
    expect(value(reports, 'R1', JAN, 'starter_kit_share_pct')).toBe('25.00')
    expect(value(reports, 'R2', JAN, 'rewarded_volume_cents')).toBe('6000')
    expect(reports.months).toEqual([JAN])
  })
})

describe('product resolutions', () => {
  test('can_earn, not the type list, decides R4 distributors and the R5 population (C-9b)', () => {
    const affiliate = { ...participant('A1', 'distributor', '2025-01'), typeCode: 'affiliate', canEarn: false }
    const facts: ComplianceFacts = {
      participants: [...PEOPLE, affiliate],
      orders: [order('O1', 5, 'A1', 9000n, 'unknown'), order('O2', 5, 'D2', 6000n, 'personal')],
      payoutLines: [line('L1', JAN, 'A1', 'other', null, 500n)],
    }
    const reports = computeReports(facts, FIXTURE_CONFIG)
    expect(figure(reports, 'R4', JAN, 'active_distributors').drill.numeratorIds).toEqual(['D2'])
    expect(figure(reports, 'R5', '2025', 'count').drill.numeratorIds).toEqual(['D1', 'D2'])
    expect(value(reports, 'R1', JAN, 'participant_orders_purpose_unknown_pct')).toBe('50.00')
  })

  test('source kind unknown is included in gross and reported as its own share (C-11)', () => {
    const reports = computeReports({
      participants: PEOPLE, orders: [],
      payoutLines: [line('L1', JAN, 'D1', 'unknown', null, 100n), line('L2', JAN, 'D1', 'pool', null, 300n)],
    }, {})
    expect(value(reports, 'R3', JAN, 'gross_cents')).toBe('400')
    expect(value(reports, 'R3', JAN, 'share_pct.unknown')).toBe('25.00')
    expect(period(reports, 'R3', JAN).notes[0]).toContain('source kind unknown')
  })

  test('R5 filters payout lines to the year and enrolment to the year end (C-16)', () => {
    const facts: ComplianceFacts = {
      participants: [...PEOPLE, participant('D3', 'distributor', '2026-01')],
      orders: [],
      payoutLines: [line('L1', '2025-12', 'D1', 'pool', null, 1000n), line('L2', '2026-01', 'D1', 'pool', null, 70000n), line('L3', '2026-01', 'D3', 'pool', null, -500n)],
    }
    const reports = computeReports(facts, {})
    expect(reports.years).toEqual(['2025', '2026'])
    expect(value(reports, 'R5', '2025', 'count')).toBe('2')
    expect(value(reports, 'R5', '2025', 'max')).toBe('10.00')
    expect(value(reports, 'R5', '2026', 'count')).toBe('3')
    expect(value(reports, 'R5', '2026', 'max')).toBe('700.00')
    expect(value(reports, 'R5', '2026', 'mean')).toBe('231.67')
    expect(value(reports, 'R5', '2026', 'bands.0 or less')).toBe('2')
    expect(value(reports, 'R5', '2026', 'bands.100.01-1,000')).toBe('1')
    const bandTotal = period(reports, 'R5', '2026').figures.filter((f) => f.key.startsWith('bands.')).reduce((n, f) => n + (f.numerator ?? 0n), 0n)
    expect(bandTotal).toBe(3n)
    expect(period(reports, 'R5', '2026').partial).toBe(true)
  })

  test('an order crossing two thresholds late counts twice; same-day orders accumulate in reference order', () => {
    const facts: ComplianceFacts = {
      participants: PEOPLE,
      orders: [order('O2', 28, 'D2', 6000n, 'personal'), order('O1', 28, 'D2', 4000n, 'personal'), order('O3', 27, 'D1', 12000n, 'personal')],
      payoutLines: [],
    }
    const reports = computeReports(facts, FIXTURE_CONFIG)
    expect(value(reports, 'R4', JAN, 'late_threshold_crossing_orders')).toBe('4')
    expect(figure(reports, 'R4', JAN, 'late_threshold_crossing_orders').drill).toMatchObject({ numeratorIds: ['O2', 'O3'], numeratorCount: 2 })
  })

  test('BUG-019: the population count counts the set the population text names', () => {
    const facts: ComplianceFacts = {
      participants: PEOPLE,
      orders: [
        order('O2', 28, 'D2', 6000n, 'personal'), order('O1', 28, 'D2', 4000n, 'personal'),
        order('O3', 27, 'D1', 12000n, 'personal'), order('O4', 2, 'D1', 100n, 'personal'), order('O5', 29, 'C1', 100n, 'customer'),
      ],
      payoutLines: [line('L1', JAN, 'D1', 'pool', null, 1000n), line('L2', JAN, 'D1', 'clawback', null, -200n)],
    }
    const reports = computeReports(facts, FIXTURE_CONFIG)
    const crossings = figure(reports, 'R4', JAN, 'of_which_refunded_later')
    const lateOrders = figure(reports, 'R4', JAN, 'late_threshold_crossing_orders')

    expect(period(reports, 'R3', JAN).figures.map((f) => f.populationCount)).toEqual(period(reports, 'R3', JAN).figures.map(() => 2))
    expect(figure(reports, 'R3', JAN, 'clawback_cents').populationCount).toBe(2)
    expect([crossings.denominator, crossings.populationCount]).toEqual([4n, 4])
    expect(crossings.population).toContain('once for each threshold it crosses')
    // Late own orders of earning-type participants: O1, O2, O3 (O4 is early, O5 is a customer's).
    expect([lateOrders.value, lateOrders.populationCount]).toEqual(['4', 3])
  })

  test('same-day orders supplied out of reference order cross in reference order, and the method says so', () => {
    const supplied = [order('O2', 28, 'D2', 4000n, 'personal'), order('O1', 28, 'D2', 2000n, 'personal', { refundedMinor: 2000n, refundMonth: JAN })]
    for (const orders of [supplied, [...supplied].reverse()]) {
      const reports = computeReports({ participants: PEOPLE, orders, payoutLines: [] }, FIXTURE_CONFIG)
      expect(figure(reports, 'R4', JAN, 'late_threshold_crossing_orders')).toMatchObject({ value: '1', drill: { numeratorIds: ['O2'] } })
      expect(value(reports, 'R4', JAN, 'of_which_refunded_later')).toBe('0')
      expect(figure(reports, 'R4', JAN, 'late_threshold_crossing_orders').method).toContain('orders of the same day in ascending order reference')
    }
  })
})

describe('drill-down ids and input validation', () => {
  test('ids are capped while counts describe the full set', () => {
    const orders = Array.from({ length: 5 }, (_, i) => order(`O${i}`, 1, 'C1', 100n, 'customer'))
    const reports = computeReports({ participants: PEOPLE, orders, payoutLines: [] }, {}, { drillIdCap: 2 })
    expect(figure(reports, 'R1', JAN, 'net_sales_cents').drill).toMatchObject({ numeratorIds: ['O0', 'O1'], numeratorCount: 5 })
  })

  test.each([
    ['an unknown buyer', { participants: PEOPLE, orders: [order('O1', 1, 'NOBODY', 1n, 'customer')], payoutLines: [] }, {}],
    ['a duplicate order reference', { participants: PEOPLE, orders: [order('O1', 1, 'C1', 1n, 'customer'), order('O1', 2, 'C1', 1n, 'customer')], payoutLines: [] }, {}],
    ['a malformed month', { participants: PEOPLE, orders: [], payoutLines: [line('L1', '2025-13', 'D1', 'pool', null, 1n)] }, {}],
    ['a day outside the month', { participants: PEOPLE, orders: [order('O1', 32, 'C1', 1n, 'customer')], payoutLines: [] }, {}],
    ['a negative active threshold', EMPTY, { activePvMinor: -1n }],
    ['a non-bigint active threshold', EMPTY, { activePvMinor: 5000 as unknown as bigint }],
    ['a negative rank threshold', EMPTY, { rankThresholdsPvMinor: { leader: -1n } }],
    ['a null rank threshold', EMPTY, { rankThresholdsPvMinor: { leader: null as unknown as bigint } }],
    ['rank thresholds that are not an object', EMPTY, { rankThresholdsPvMinor: 5000n as unknown as Record<string, bigint> }],
    ['a non-bigint flag fraction', EMPTY, { personalShareFlag: { numerator: 1, denominator: 3 } as unknown as Ratio }],
    ['a flag that is not a fraction', EMPTY, { personalShareFlag: 'a third' as unknown as Ratio }],
    ['a non-numeric late-order day', EMPTY, { lateOrderDay: '27' as unknown as number }],
    ['a config that is not an object', EMPTY, null as unknown as ComplianceConfigInput],
    ['a zero flag denominator', { participants: [], orders: [], payoutLines: [] }, { personalShareFlag: { numerator: 1n, denominator: 0n } }],
  ])('rejects %s', (_name, facts, config) => {
    expect(() => computeReports(facts, config)).toThrow(ComplianceInputError)
  })
})
