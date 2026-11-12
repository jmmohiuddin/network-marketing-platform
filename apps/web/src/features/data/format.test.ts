import { describe, expect, it } from 'vitest'
import { figureLabel, figureValue, humanize, integer, parseFigureId, periodRange } from './format'

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
    expect(figureValue({ unit: 'minor', value: '16000' })).toBe(`${integer('16000')} minor units`)
    expect(figureValue({ unit: 'percent', value: null })).toBe('Not stated')
    expect(integer('90071992547409930')).toBe(90071992547409930n.toLocaleString())
  })

  it('splits figure ids whose key holds dots', () => {
    expect(parseFigureId('R5.2025.bands.0.01-100')).toEqual({ report: 'R5', period: '2025', key: 'bands.0.01-100' })
    expect(parseFigureId('R1.2025-01.customer_share_pct')).toEqual({ report: 'R1', period: '2025-01', key: 'customer_share_pct' })
    expect(parseFigureId('bad')).toBeNull()
  })
})
