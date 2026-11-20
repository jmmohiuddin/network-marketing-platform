import { describe, expect, it } from 'vitest'
import { errorText, formatDecimal, formatDecimalMoney, formatMoney, isoDay, keyLabel, l10n, noticeView, paidAsText, payoutState, percentText, rateText, requirementText, withholdingLabel, withholdingNote } from './format'
import { ApiError } from '../../lib/api'
import { translator } from './i18n'

const en = translator('en')
const NBSP = ' '

describe('portal words (BUG-112, BUG-114, BUG-119)', () => {
  it('says no payout is due for a statement whose net is zero or less, and keeps the state otherwise', () => {
    expect(payoutState('none', '0', en).label).toBe('No payout due')
    expect(payoutState('none', '-500', en).label).toBe('No payout due')
    expect(payoutState('none', null, en).label).toBe('No payout due')
    expect(payoutState('none', '2300', en).label).toBe('Not paid out yet')
    expect(payoutState('settled', '0', en).label).toBe('Paid')
    expect(payoutState('settled', '0', translator('de')).label).toBe('Ausgezahlt')
  })

  it('shows rates as exact percentages and keeps other words', () => {
    expect(rateText('0.08')).toBe('rate 8 %')
    expect(rateText('0.125')).toBe('rate 12.5 %')
    expect(rateText('1')).toBe('rate 100 %')
    expect(rateText('0.0005')).toBe('rate 0.05 %')
    expect(rateText('-0.05')).toBe('rate -5 %')
    expect(rateText('rates vary')).toBe('rates vary')
    expect(percentText('0.020000', 'en')).toBe(`2${NBSP}%`)
    expect(percentText('0.125000', 'de')).toBe(`12,5${NBSP}%`)
    expect(percentText('unterschiedlich', 'de')).toBe('unterschiedlich')
  })

  it('names rule, ladder and measure keys in words of the locale', () => {
    expect(keyLabel('unilevel', en)).toBe('Unilevel')
    expect(keyLabel('capped_pv', en)).toBe('Capped personal volume')
    expect(keyLabel('gv', en)).toBe('Group volume')
    expect(keyLabel('gv', translator('de'))).toBe('Gruppenvolumen')
    // BUG-138: no half-translated "Capped persönliches Volumen".
    expect(keyLabel('capped_pv', translator('de'))).toBe('Gedeckeltes persönliches Volumen')
    expect(requirementText({ kind: 'measure', measure: 'pv', text: 'pv at least 100.00 over 3 periods' }, en)).toBe('Personal volume at least 100.00 over 3 periods')
    expect(requirementText({ kind: 'measure', measure: 'pv', text: 'pv mindestens 100,00' }, translator('de'))).toBe('Persönliches Volumen mindestens 100,00')
    expect(requirementText({ kind: 'rank', text: 'Holds main R1 or higher' }, en)).toBe('Holds main R1 or higher')
  })

  it('never says "Paid as No rank"', () => {
    expect(paidAsText([{ ladder: 'main', rank: null }], en)).toBe('No paid-as rank')
    expect(paidAsText([{ ladder: 'main', rank: 'Silver' }], en)).toBe('Paid as Silver')
    expect(paidAsText([{ ladder: 'main', rank: 'Silver' }, { ladder: 'leadership', rank: 'Gold' }], en)).toBe('Paid as Main: Silver · Leadership: Gold')
  })

  it('takes days in the market zone per locale, and calendar dates as given', () => {
    expect(isoDay('2026-07-31T22:00:00.000Z', 'Europe/Berlin')).toBe('2026-08-01')
    const de = l10n('de', 'Europe/Berlin', translator('de'))
    expect(de.day('2026-11-20T23:30:00.000Z')).toBe('21.11.2026')
    expect(de.date('2026-08-01')).toBe('01.08.2026')
    expect(l10n('en', 'Europe/Berlin', translator('en')).day('2026-11-20T23:30:00.000Z')).toBe('Nov 21, 2026')
    expect(de.period('2026-07-31T22:00:00.000Z', '2026-08-31T22:00:00.000Z')).toBe('01.08.2026 – 31.08.2026')
  })

  it('words first bank details without "changed from none"', () => {
    const words = l10n('en', 'Europe/Berlin', translator('en'))
    const notice = (params: Record<string, unknown>) => noticeView({ id: 'n1', template: 'bank_detail.changed', topic: 'security', mandatory: true, params, read_at: null, created_at: '2026-11-19T10:00:00Z' }, words)
    expect(notice({ masked: '•••• 6199' }).text).toMatch(/^Your payout account is now •••• 6199\./)
    expect(notice({ masked: '•••• 6199', previous_masked: '•••• 1111' }).text).toMatch(/^Your payout account changed from •••• 1111 to •••• 6199\./)
  })

  it('words the year-end tax statement notice from the de catalogue and links to the tax statements', () => {
    const view = noticeView({ id: 'n2', template: 'tax_form.available', topic: 'statement', mandatory: false, params: { tax_year: 2026, form_type: 'FX-1', form_id: 'f' }, read_at: null, created_at: '2027-01-10T10:00:00Z' }, l10n('de', 'Europe/Vienna', translator('de')))
    expect(view).toMatchObject({
      title: 'Steuerübersicht verfügbar', text: 'Ihre Steuerübersicht FX-1 für das Steuerjahr 2026 steht zum Herunterladen bereit.',
      href: '/portal/more/tax-statements', linkLabel: 'Steuerübersichten öffnen',
    })
  })
})

describe('money and numbers per locale (no float)', () => {
  it('formats minor units exactly with the locale separators and currency position', () => {
    expect(formatMoney('5200', 'EUR', 2, 'de')).toBe(`52,00${NBSP}€`)
    expect(formatMoney('5200', 'EUR', 2, 'en')).toBe('€52.00')
    expect(formatMoney('123456789012345678901', 'EUR', 2, 'de')).toBe(`1.234.567.890.123.456.789,01${NBSP}€`)
    expect(formatMoney('-5', 'EUR', 2, 'de')).toBe(`-0,05${NBSP}€`)
    expect(formatMoney('-0', 'EUR', 2, 'en')).toBe('€0.00')
    expect(formatMoney('1000', 'EUR', 2, 'en', true)).toBe('+€10.00')
    expect(formatMoney('0', 'EUR', 2, 'en', true)).toBe('€0.00')
    // BUG-138: explanation amounts (decimal strings) in the same style as every other amount.
    expect(formatDecimalMoney('8.00', 'EUR', 'de')).toBe(`8,00${NBSP}€`)
    expect(formatDecimalMoney('1234.004', 'EUR', 'en')).toBe('€1,234.004')
    expect(formatDecimalMoney('-0.5', 'EUR', 'en')).toBe('-€0.5')
    expect(formatDecimalMoney('rates vary', 'EUR', 'en')).toBe('rates vary')
    expect(formatMoney('1234', 'JPY', 0, 'de')).toBe(`1.234${NBSP}¥`)
    expect(formatDecimal('1234.5', 'de')).toBe('1.234,5')
    expect(formatDecimal('-0.03', 'en')).toBe('-0.03')
  })
})

describe('statement withholding row (B-MKT §2.2)', () => {
  it('shows the rate from the 6-dp string and the basis note', () => {
    const words = l10n('de', 'Europe/Berlin', translator('de'))
    expect(withholdingLabel({ rate: '0.020000', rate_basis: 'rate' }, words)).toBe(`Einbehaltene Steuer (2${NBSP}%)`)
    // BUG-138: no duty shows no rate at all, never "(0 %)".
    expect(withholdingLabel({ rate: '0.000000', rate_basis: 'no_duty' }, words)).toBe('Einbehaltene Steuer')
    expect(withholdingLabel(null, l10n('en', 'UTC', translator('en')))).toBe('Withheld')
    expect(withholdingNote('no_duty', words.t)).toBe('Keine Steuerabzugspflicht')
    expect(withholdingNote('missing_id_rate', en)).toBe('No tax id: higher rate')
    expect(withholdingNote('below_threshold', en)).toBe('Below threshold')
    expect(withholdingNote('rate', en)).toBeNull()
  })
})

describe('errors by code (never the API message)', () => {
  it('words known codes, the tax-id format with its label, server failures with the reference, else a generic sentence', () => {
    expect(errorText(new ApiError(422, 'TAX_ID_FORMAT', 'API words', { label: 'PAN' }), en)).toBe('This is not a valid PAN.')
    expect(errorText(new ApiError(422, 'LOCALE_NOT_OFFERED', 'API words'), translator('de'))).toBe('Diese Sprache wird in Ihrem Markt nicht angeboten.')
    expect(errorText(new ApiError(500, 'INTERNAL', 'API words', null, 'req-1'), en)).toBe('Something went wrong. Try again later. Reference: req-1')
    expect(errorText(new ApiError(409, 'SOMETHING_NEW', 'API words'), en)).toBe('Something went wrong. Try again.')
    expect(errorText(new Error('x'), en)).toBe('Something went wrong. Try again.')
  })
})
