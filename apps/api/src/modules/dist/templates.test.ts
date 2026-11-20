import fastify from 'fastify'
import { describe, expect, test, vi } from 'vitest'
import { SUPPORTED_LOCALES } from '../../lib/locale.js'
import { backoffMs } from './deliver.js'
import { MAIL_CATALOGUES } from './mail-catalogue.js'
import { renderNotification, TEMPLATE_NAMES } from './templates.js'

const WEB = 'https://portal.example.test'
const log = fastify({ logger: false }).log
const HELD = {
  batch_id: 'b', amount_minor: '5000', currency: 'EUR', minor_unit: 2,
  reasons: [{ reason: 'bank_detail_cooling_off', until: '2026-11-22T09:00:00.000Z' }, { reason: 'hold' }],
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe('notification templates', () => {
  test('payout.held lists reason codes as text, never a hold note, with the cooling-off end in the market zone', () => {
    const mail = renderNotification('payout.held', HELD, 'en', 'Europe/Berlin', WEB, log)
    expect(mail.subject).toBe('A payout to you is on hold')
    expect(mail.text).toContain('Your payable of 50.00 EUR was not paid')
    expect(mail.text).toContain('after Nov 22, 2026, 10:00 AM (Europe/Berlin)')
    expect(mail.text).toContain('- a payout hold is in place')
    expect(mail.text).toContain(`${WEB}/portal`)
  })

  test('plan.change_scheduled uses the zone in its params; zero-digit currencies have no decimals', () => {
    expect(renderNotification('plan.change_scheduled', { effective_from: '2027-01-01T00:00:00.000Z', time_zone: 'UTC' }, 'en', 'Europe/Berlin', WEB, log).text)
      .toContain('takes effect on Jan 1, 2027, 12:00 AM (UTC)')
    expect(renderNotification('payout.sent', { amount_minor: '1200', currency: 'JPY', minor_unit: 0, masked: '•••• 1234' }, 'en', 'Asia/Tokyo', WEB, log).text)
      .toContain('A payout of 1200 JPY to account •••• 1234')
  })

  test('an unknown template or params that do not fit it throw (the row is retried, then failed)', () => {
    expect(() => renderNotification('nope', {}, 'en', 'UTC', WEB, log)).toThrow()
    expect(() => renderNotification('payout.sent', { amount_minor: 'x' }, 'en', 'UTC', WEB, log)).toThrow()
    expect(() => renderNotification('tax_form.available', { tax_year: '2026', form_type: 'FX-1', form_id: 'x' }, 'en', 'UTC', WEB, log)).toThrow()
  })

  test('backoff: 1 min x 2^(attempts - 1), at most 1 h', () => {
    expect([1, 2, 3, 6, 7, 10].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000])
  })
})

describe('T-BM-32 localised e-mails (AC-DIST7-4)', () => {
  test('de: German texts, decimal comma and German dates in the market zone', () => {
    const mail = renderNotification('payout.held', HELD, 'de', 'Europe/Berlin', WEB, log)
    expect(mail.subject).toBe('Eine Auszahlung an Sie ist angehalten')
    expect(mail.text).toContain('Ihr fälliger Betrag von 50,00 EUR')
    expect(mail.text).toContain('22.11.2026, 10:00 (Europe/Berlin)')
    expect(mail.text).toContain(`Die Einzelheiten finden Sie in Ihrem Portal: ${WEB}/portal`)
    const statement = renderNotification('statement.ready', {
      starts_at: '2026-10-31T23:00:00.000Z', ends_at: '2026-11-30T23:00:00.000Z', net_minor: '-5200', currency: 'EUR', minor_unit: 2,
    }, 'de', 'Europe/Berlin', WEB, log)
    expect(statement.text).toContain('für 01.11.2026 bis 30.11.2026 ist bereit.\r\nNettobetrag: -52,00 EUR.')
  })

  test('tax_form.available renders its tax year and form type in en and de', () => {
    const params = { tax_year: 2026, form_type: 'FX-1', form_id: '7d1c4f7e-2b39-4b8a-9b0e-0e6b3f1b2c3d' }
    expect(renderNotification('tax_form.available', params, 'en', 'UTC', WEB, log)).toMatchObject({
      subject: 'Your year-end tax statement is available', text: expect.stringContaining('Your tax statement FX-1 for tax year 2026'),
    })
    expect(renderNotification('tax_form.available', params, 'de', 'UTC', WEB, log).text).toContain('Steuerübersicht FX-1 für das Steuerjahr 2026')
  })

  test('a locale without a catalogue renders in English and is logged', () => {
    const warn = vi.spyOn(log, 'warn')
    const mail = renderNotification('dispute.updated', {}, 'nl', 'UTC', WEB, log)
    expect(mail.subject).toBe('Your commission dispute was updated')
    expect(warn).toHaveBeenCalledWith({ locale: 'nl', template: 'dispute.updated' }, 'MAIL_LOCALE_FALLBACK')
    warn.mockRestore()
  })

  test('release check: every locale has every en key, the same placeholders and no empty value; every template has texts', () => {
    const en = MAIL_CATALOGUES.en
    for (const locale of SUPPORTED_LOCALES) {
      const catalogue = MAIL_CATALOGUES[locale]
      expect(Object.keys(catalogue).sort()).toEqual(Object.keys(en).sort())
      for (const [key, text] of Object.entries(en)) {
        expect(catalogue[key]!.trim(), `${locale} ${key}`).not.toBe('')
        expect(placeholders(catalogue[key]!), `${locale} ${key}`).toEqual(placeholders(text))
      }
    }
    for (const template of TEMPLATE_NAMES) expect(en[`${template}.subject`], template).toBeDefined()
  })
})
