import { describe, expect, test } from 'vitest'
import { backoffMs } from './deliver.js'
import { renderNotification } from './templates.js'

const WEB = 'https://portal.example.test'

describe('notification templates', () => {
  test('payout.held lists reason codes as text, never a hold note, with the cooling-off end in the market zone', () => {
    const mail = renderNotification('payout.held', {
      batch_id: 'b', amount_minor: '5000', currency: 'EUR', minor_unit: 2,
      reasons: [{ reason: 'bank_detail_cooling_off', until: '2026-11-22T09:00:00.000Z' }, { reason: 'hold' }],
    }, 'Europe/Berlin', WEB)
    expect(mail.subject).toBe('A payout to you is on hold')
    expect(mail.text).toContain('Your payable of 50.00 EUR was not paid')
    expect(mail.text).toContain('after Nov 22, 2026, 10:00 AM (Europe/Berlin)')
    expect(mail.text).toContain('- a payout hold is in place')
    expect(mail.text).toContain(`${WEB}/portal`)
  })

  test('plan.change_scheduled uses the zone in its params; zero-digit currencies have no decimals', () => {
    expect(renderNotification('plan.change_scheduled', { effective_from: '2027-01-01T00:00:00.000Z', time_zone: 'UTC' }, 'Europe/Berlin', WEB).text)
      .toContain('takes effect on Jan 1, 2027, 12:00 AM (UTC)')
    expect(renderNotification('payout.sent', { amount_minor: '1200', currency: 'JPY', minor_unit: 0, masked: '•••• 1234' }, 'Asia/Tokyo', WEB).text)
      .toContain('A payout of 1200 JPY to account •••• 1234')
  })

  test('an unknown template or params that do not fit it throw (the row is retried, then failed)', () => {
    expect(() => renderNotification('nope', {}, 'UTC', WEB)).toThrow()
    expect(() => renderNotification('payout.sent', { amount_minor: 'x' }, 'UTC', WEB)).toThrow()
  })

  test('backoff: 1 min x 2^(attempts - 1), at most 1 h', () => {
    expect([1, 2, 3, 6, 7, 10].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000])
  })
})
