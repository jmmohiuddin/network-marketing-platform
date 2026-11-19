import { describe, expect, it } from 'vitest'
import { dateText, isoDay, keyLabel, noticeView, paidAsText, payoutState, rateText, requirementText } from './format'

describe('portal words (BUG-112, BUG-114, BUG-119)', () => {
  it('says no payout is due for a statement whose net is zero or less, and keeps the state otherwise', () => {
    expect(payoutState('none', '0').label).toBe('No payout due')
    expect(payoutState('none', '-500').label).toBe('No payout due')
    expect(payoutState('none', null).label).toBe('No payout due')
    expect(payoutState('none', '2300').label).toBe('Not paid out yet')
    expect(payoutState('settled', '0').label).toBe('Paid')
  })

  it('shows rates as exact percentages and keeps other words', () => {
    expect(rateText('0.08')).toBe('rate 8 %')
    expect(rateText('0.125')).toBe('rate 12.5 %')
    expect(rateText('1')).toBe('rate 100 %')
    expect(rateText('0.0005')).toBe('rate 0.05 %')
    expect(rateText('-0.05')).toBe('rate -5 %')
    expect(rateText('rates vary')).toBe('rates vary')
  })

  it('names rule, ladder and measure keys in words', () => {
    expect(keyLabel('unilevel')).toBe('Unilevel')
    expect(keyLabel('capped_pv')).toBe('Capped personal volume')
    expect(keyLabel('gv')).toBe('Group volume')
    expect(requirementText({ kind: 'measure', measure: 'pv', text: 'pv at least 100.00 over 3 periods' })).toBe('Personal volume at least 100.00 over 3 periods')
    expect(requirementText({ kind: 'rank', text: 'Holds main R1 or higher' })).toBe('Holds main R1 or higher')
  })

  it('never says "Paid as No rank"', () => {
    expect(paidAsText([{ ladder: 'main', rank: null }])).toBe('No paid-as rank')
    expect(paidAsText([{ ladder: 'main', rank: 'Silver' }])).toBe('Paid as Silver')
    expect(paidAsText([{ ladder: 'main', rank: 'Silver' }, { ladder: 'leadership', rank: 'Gold' }])).toBe('Paid as Main: Silver · Leadership: Gold')
  })

  it('takes days in the market zone, and calendar dates as given', () => {
    expect(isoDay('2026-07-31T22:00:00.000Z', 'Europe/Berlin')).toBe('2026-08-01')
    expect(dateText('2026-08-01')).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(2026, 7, 1)))
  })

  it('words first bank details without "changed from none"', () => {
    const notice = (params: Record<string, unknown>) => noticeView({ id: 'n1', template: 'bank_detail.changed', topic: 'security', mandatory: true, params, read_at: null, created_at: '2026-11-19T10:00:00Z' }, 'Europe/Berlin')
    expect(notice({ masked: '•••• 6199' }).text).toMatch(/^Your payout account is now •••• 6199\./)
    expect(notice({ masked: '•••• 6199', previous_masked: '•••• 1111' }).text).toMatch(/^Your payout account changed from •••• 1111 to •••• 6199\./)
  })
})
