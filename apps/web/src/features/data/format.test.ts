import { describe, expect, it } from 'vitest'
import { changeLabel, compareDecimal, figureLabel, figureValue, humanize, integer, parseFigureId, periodRange } from './format'

describe('data formatting', () => {
  it('names periods, columns and figures for readers', () => {
    expect(periodRange('2025-01', '2025-01')).toBe('2025-01')
    expect(periodRange('2025-01', '2025-03')).toBe('2025-01 to 2025-03')
    expect(humanize('payout_lines')).toBe('Payout lines')
    expect(humanize('amount_minor')).toBe('Amount (minor units)')
    expect(figureLabel('customer_share_pct')).toBe('Customer share of net sales')
    expect(figureLabel('share_pct.retail_sale')).toBe('Share of payouts from retail sale')
    expect(figureLabel('bands.0 or less')).toBe('Participants with earnings 0 or less')
    expect(figureLabel('new_key')).toBe('New key')
  })

  it('states values with their unit and never invents one', () => {
    expect(figureValue({ unit: 'percent', value: '62.50' })).toBe('62.50 %')
    expect(figureValue({ unit: 'currency', value: '14.30' })).toBe('14.30 currency units')
    // BUG-018: R5 values are grouped like every other number.
    expect(figureValue({ unit: 'currency', value: '1630.95' })).toBe('1,630.95 currency units')
    expect(figureValue({ unit: 'currency', value: '-2306.38' })).toBe('-2,306.38 currency units')
    expect(figureValue({ unit: 'ratio', value: 'n/a' })).toBe('n/a')
    expect(figureValue({ unit: 'minor', value: '16000' })).toBe(`${integer('16000')} minor units`)
    expect(figureValue({ unit: 'percent', value: null })).toBe('Not stated')
    expect(integer('90071992547409930')).toBe(90071992547409930n.toLocaleString())
  })

  it('splits figure ids whose key holds dots', () => {
    expect(parseFigureId('R5.2025.bands.0.01-100')).toEqual({ report: 'R5', period: '2025', key: 'bands.0.01-100' })
    expect(parseFigureId('R1.2025-01.customer_share_pct')).toEqual({ report: 'R1', period: '2025-01', key: 'customer_share_pct' })
    expect(parseFigureId('bad')).toBeNull()
  })

  it('states the change between two periods exactly, without floating point', () => {
    expect(changeLabel('percent', '60.00', '62.5')).toBe('\u22122.50 points')
    expect(changeLabel('percent', '0.30', '0.1')).toBe('+0.20 points')
    expect(changeLabel('minor', '9007199254740993', '1')).toBe(`+${integer('9007199254740992')} minor units`)
    expect(changeLabel('count', '4', '4')).toBe('No change')
    expect(changeLabel('currency', '-1.20', '0.80')).toBe('\u22122.00 currency units')
    expect(changeLabel('percent', null, '1')).toBe('Not comparable')
    expect(changeLabel('ratio', '1e3', '1')).toBe('Not comparable')
  })

  it('orders decimal strings exactly', () => {
    expect(compareDecimal('58.00', '62.5')).toBe(-1)
    expect(compareDecimal('-0.5', '-0.50')).toBe(0)
    expect(compareDecimal('10', '9.99')).toBe(1)
    expect(compareDecimal('x', '1')).toBeNull()
  })
})
