import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'
import { isLocale, message, type Locale, type MessageParams } from '../../lib/locale.js'
import { formatMinor } from '../pay/index.js'
import { MAIL_CATALOGUES } from './mail-catalogue.js'

// D-B5-14 email templates, rendered from the row's params at send time in the row's locale (D-BM-11: notification.locale,
// texts in mail-catalogue.ts). Params hold ids, decimal strings of minor units, ISO instants, currency and masked values
// only; the recipient's address is read from the participant at send time, never stored in a row or a job.

export interface RenderedMail {
  readonly subject: string
  readonly text: string
}

const minor = z.string().regex(/^-?\d{1,19}$/)
const money = { amount_minor: minor, currency: z.string(), minor_unit: z.number().int().min(0).max(4) }
const iso = z.iso.datetime()
const reason = z.object({ reason: z.string(), until: iso.optional() })

/** What a template renders with: the locale's texts and formats, and the participant's market zone. */
interface Render {
  readonly t: (key: string, params?: MessageParams) => string
  readonly locale: Locale
  readonly timeZone: string
}

/** "Nov 21, 2026, 8:31 AM (Europe/Berlin)": the instant in a zone, in the locale's format. */
const zonedTime = (at: string, timeZone: string, locale: Locale): string =>
  `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(at))} (${timeZone})`
const marketDate = (at: Date, r: Render): string => new Intl.DateTimeFormat(r.locale, { dateStyle: 'medium', timeZone: r.timeZone }).format(at)
/** Minor units by string arithmetic (no float), with the locale's decimal separator. */
const amount = (p: { amount_minor: string; currency: string; minor_unit: number }, locale: Locale): string => {
  const separator = new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.'
  return `${formatMinor(p.amount_minor, p.minor_unit).replace('.', separator)} ${p.currency}`
}

const HELD_REASONS = new Set(['hold', 'no_bank_details', 'tax_profile_missing', 'returned_payment_open'])

/** Payout-hold reasons as the participant reads them: codes only, never a hold's staff-written text (D-B5-24). */
function heldBecause(item: z.infer<typeof reason>, r: Render): string {
  if (item.reason === 'bank_detail_cooling_off') {
    return item.until === undefined
      ? r.t('payout.held.reason.cooling_off')
      : r.t('payout.held.reason.cooling_off_until', { until: zonedTime(item.until, r.timeZone, r.locale) })
  }
  return r.t(`payout.held.reason.${HELD_REASONS.has(item.reason) ? item.reason : 'other'}`)
}

interface Template<P> {
  readonly params: z.ZodType<P>
  render(params: P, r: Render): string[]
}

const define = <P>(template: Template<P>): Template<unknown> => template as Template<unknown>

/** Template name -> its params and body lines; the subject is the catalogue's `<template>.subject`. */
const TEMPLATES: Readonly<Record<string, Template<unknown>>> = {
  'statement.ready': define({
    params: z.object({ starts_at: iso, ends_at: iso, net_minor: minor, currency: z.string(), minor_unit: z.number().int().min(0).max(4) }),
    render: (p, r) => [
      r.t('statement.ready.period', { from: marketDate(new Date(p.starts_at), r), to: marketDate(new Date(Date.parse(p.ends_at) - 1), r) }),
      r.t('statement.ready.net', { amount: amount({ amount_minor: p.net_minor, currency: p.currency, minor_unit: p.minor_unit }, r.locale) }),
    ],
  }),
  'payout.sent': define({
    params: z.object({ ...money, masked: z.string() }),
    render: (p, r) => [r.t('payout.sent.text', { amount: amount(p, r.locale), masked: p.masked })],
  }),
  'payout.held': define({
    params: z.object({ ...money, reasons: z.array(reason) }),
    render: (p, r) => [r.t('payout.held.intro', { amount: amount(p, r.locale) }), ...p.reasons.map((item) => `- ${heldBecause(item, r)}`)],
  }),
  'payout.returned': define({
    params: z.object({ ...money, masked: z.string() }),
    render: (p, r) => [r.t('payout.returned.text', { amount: amount(p, r.locale), masked: p.masked }), r.t('payout.returned.again')],
  }),
  'bank_detail.changed': define({
    params: z.object({ masked: z.string(), previous_masked: z.string().nullable(), cooling_off_until: iso }),
    render: (p, r) => [
      r.t('bank_detail.changed.text', { previous: p.previous_masked ?? r.t('bank_detail.changed.none'), masked: p.masked }),
      r.t('bank_detail.changed.starts', { until: zonedTime(p.cooling_off_until, r.timeZone, r.locale) }),
      r.t('bank_detail.changed.warning'),
    ],
  }),
  'tax_profile.changed': define({
    params: z.object({ valid_from: iso }),
    render: (p, r) => [r.t('tax_profile.changed.text', { at: zonedTime(p.valid_from, r.timeZone, r.locale) }), r.t('tax_profile.changed.warning')],
  }),
  'dispute.updated': define({ params: z.object({}), render: (_p, r) => [r.t('dispute.updated.text')] }),
  'privacy_request.updated': define({ params: z.object({}), render: (_p, r) => [r.t('privacy_request.updated.text')] }),
  'plan.change_scheduled': define({
    params: z.object({ effective_from: iso, time_zone: z.string() }),
    render: (p, r) => [r.t('plan.change_scheduled.text', { at: zonedTime(p.effective_from, p.time_zone, r.locale) })],
  }),
  'tax_form.available': define({
    params: z.object({ tax_year: z.number().int(), form_type: z.string(), form_id: z.uuid() }),
    render: (p, r) => [r.t('tax_form.available.text', { form_type: p.form_type, tax_year: p.tax_year })],
  }),
}

/** The templates DIST renders (tests check the catalogue covers each). */
export const TEMPLATE_NAMES: readonly string[] = Object.keys(TEMPLATES)

/**
 * The mail of one notification row in its locale; a locale without a catalogue renders in English and is logged
 * (MAIL_LOCALE_FALLBACK), a key missing in the locale falls back to English (MESSAGE_FALLBACK). Throws on an unknown
 * template or params that do not fit it.
 */
export function renderNotification(
  template: string, params: unknown, locale: string, timeZone: string, webUrl: string, log: FastifyBaseLogger,
): RenderedMail {
  const found = TEMPLATES[template]
  if (found === undefined) throw new Error(`no email template ${template}`)
  const parsed = found.params.parse(params)
  if (!isLocale(locale)) log.warn({ locale, template }, 'MAIL_LOCALE_FALLBACK')
  const target: Locale = isLocale(locale) ? locale : 'en'
  const t = (key: string, values: MessageParams = {}) => message(MAIL_CATALOGUES, key, values, target, 'en', log)
  const lines = found.render(parsed, { t, locale: target, timeZone })
  return { subject: t(`${template}.subject`), text: [...lines, '', t('footer', { url: `${webUrl}/portal` })].join('\r\n') }
}
