import { describe, expect, test } from 'vitest'
import { computeReports, type ComplianceFacts } from '../src/index.js'
import { figure, FIXTURE_CONFIG, line, order, participant, period, value } from './helpers.js'

/** TS-31: the hand-checked fixture of three participants, three orders and four payout lines (MVP_A_SPEC 6.1). */
const facts: ComplianceFacts = {
  participants: [
    participant('D1', 'distributor', '2024-12'),
    participant('D2', 'distributor', '2025-01', 'D1'),
    participant('C1', 'customer', '2025-01', 'D1'),
  ],
  orders: [
    order('O1', 3, 'C1', 10000n, 'customer'),
    order('O2', 5, 'D2', 6000n, 'personal'),
    order('O3', 28, 'D2', 4000n, 'resale', { refundedMinor: 4000n, refundMonth: '2025-02' }),
  ],
  payoutLines: [
    line('L1', '2025-01', 'D1', 'retail_sale', 'O1', 2500n),
    line('L2', '2025-01', 'D1', 'downline_volume', 'O2', 360n),
    line('L3', '2025-01', 'D1', 'downline_volume', 'O3', 240n),
    line('L4', '2025-02', 'D1', 'clawback', 'O3', -240n),
  ],
}
const reports = computeReports(facts, FIXTURE_CONFIG)
const JAN = '2025-01'

describe('TS-31 hand-checked fixture', () => {
  test('R1: net sales 160.00, customer share 62.50%, with declared resale 62.50%', () => {
    expect(value(reports, 'R1', JAN, 'net_sales_cents')).toBe('16000')
    expect(value(reports, 'R1', JAN, 'customer_share_pct')).toBe('62.50')
    expect(value(reports, 'R1', JAN, 'customer_plus_declared_resale_pct')).toBe('62.50')
    expect(figure(reports, 'R1', JAN, 'customer_share_pct')).toMatchObject({ numerator: 10000n, denominator: 16000n })
  })

  test('R1: only buyer types flagged as end customer are in the numerator (AC-21.1)', () => {
    expect(figure(reports, 'R1', JAN, 'customer_share_pct').drill).toMatchObject({
      entity: 'order', numeratorIds: ['O1'], denominatorIds: ['O1', 'O2', 'O3'],
    })
  })

  test('R2: personal-use share 60.00%, one payee above the one-third flag', () => {
    expect(value(reports, 'R2', JAN, 'rewarded_volume_cents')).toBe('10000')
    expect(value(reports, 'R2', JAN, 'personal_use_share_pct')).toBe('60.00')
    expect(value(reports, 'R2', JAN, 'payees_above_flag')).toBe('1')
    expect(figure(reports, 'R2', JAN, 'payees_above_flag').drill.numeratorIds).toEqual(['D1'])
    expect(value(reports, 'R2', JAN, 'flag_threshold')).toBe('0.3333')
  })

  test('R3: retail 80.65%, downline 19.35%, year clawbacks -2.40', () => {
    expect(value(reports, 'R3', JAN, 'share_pct.retail_sale')).toBe('80.65')
    expect(value(reports, 'R3', JAN, 'share_pct.downline_volume')).toBe('19.35')
    expect(value(reports, 'R3', '2025', 'clawback_cents')).toBe('-240')
    expect(value(reports, 'R3', '2025', 'gross_cents')).toBe('3100')
  })

  test('R4: one active, 100% with no customer order, one late crossing of which one refunded', () => {
    expect(value(reports, 'R4', JAN, 'active_distributors')).toBe('1')
    expect(figure(reports, 'R4', JAN, 'active_distributors').drill.numeratorIds).toEqual(['D2'])
    expect(value(reports, 'R4', JAN, 'active_with_no_customer_order_pct')).toBe('100.00')
    expect(value(reports, 'R4', JAN, 'late_threshold_crossing_orders')).toBe('1')
    expect(figure(reports, 'R4', JAN, 'late_threshold_crossing_orders').drill.numeratorIds).toEqual(['O3'])
    expect(value(reports, 'R4', JAN, 'of_which_refunded_later')).toBe('1')
  })

  test('R5: population 2, 50.00% above zero, median 14.30, one in the zero band', () => {
    expect(value(reports, 'R5', '2025', 'count')).toBe('2')
    expect(value(reports, 'R5', '2025', 'earned_more_than_zero_pct')).toBe('50.00')
    expect(value(reports, 'R5', '2025', 'median')).toBe('14.30')
    expect(value(reports, 'R5', '2025', 'max')).toBe('28.60')
    expect(value(reports, 'R5', '2025', 'bands.0 or less')).toBe('1')
    expect(figure(reports, 'R5', '2025', 'bands.0 or less').drill.numeratorIds).toEqual(['D2'])
  })

  test('R5 and the R3 year are labelled partial: two months of payout data', () => {
    expect(period(reports, 'R5', '2025').partial).toBe(true)
    expect(period(reports, 'R3', '2025').partial).toBe(true)
    expect(period(reports, 'R5', '2025').notes.join(' ')).toContain('Not publishable')
  })
})
