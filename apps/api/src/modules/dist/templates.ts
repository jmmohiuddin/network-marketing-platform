import { z } from 'zod'
import { formatMinor } from '../pay/index.js'

// D-B5-14 English email templates (the only locale, C-B5-8), rendered from the row's params at send time. Params hold
// ids, decimal strings of minor units, ISO instants, currency and masked values only; the recipient's address is read
// from the participant at send time, never stored in a row or a job.

export interface RenderedMail {
  readonly subject: string
  readonly text: string
}

const minor = z.string().regex(/^-?\d{1,19}$/)
const money = { amount_minor: minor, currency: z.string(), minor_unit: z.number().int().min(0).max(4) }
const iso = z.iso.datetime()
const reason = z.object({ reason: z.string(), until: iso.optional() })

/** "Nov 21, 2026, 8:31 AM (Europe/Berlin)": the instant in the participant's market zone. */
const marketTime = (at: string, timeZone: string): string =>
  `${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(at))} (${timeZone})`
const marketDate = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(at)
const amount = (p: { amount_minor: string; currency: string; minor_unit: number }): string =>
  `${formatMinor(p.amount_minor, p.minor_unit)} ${p.currency}`

/** Payout-hold reasons as the participant reads them: codes only, never a hold's staff-written text (D-B5-24). */
function heldBecause(r: z.infer<typeof reason>, timeZone: string): string {
  switch (r.reason) {
    case 'bank_detail_cooling_off':
      return r.until === undefined ? 'your new bank details are in their waiting period' : `your new bank details can be used after ${marketTime(r.until, timeZone)}`
    case 'hold':
      return 'a payout hold is in place'
    case 'no_bank_details':
      return 'we have no usable bank details for you'
    case 'tax_profile_missing':
      return 'your tax profile is missing'
    case 'returned_payment_open':
      return 'a returned payment is being reviewed'
    default:
      return 'your payout needs a review'
  }
}

interface Template<P> {
  readonly params: z.ZodType<P>
  render(params: P, timeZone: string): RenderedMail
}

const define = <P>(template: Template<P>): Template<unknown> => template as Template<unknown>

const TEMPLATES: Readonly<Record<string, Template<unknown>>> = {
  'statement.ready': define({
    params: z.object({ starts_at: iso, ends_at: iso, net_minor: minor, currency: z.string(), minor_unit: z.number().int().min(0).max(4) }),
    render: (p, zone) => ({
      subject: 'Your commission statement is ready',
      text: `Your commission statement for ${marketDate(new Date(p.starts_at), zone)} to ${marketDate(new Date(Date.parse(p.ends_at) - 1), zone)} is ready.\r\n`
        + `Net amount: ${amount({ amount_minor: p.net_minor, currency: p.currency, minor_unit: p.minor_unit })}.`,
    }),
  }),
  'payout.sent': define({
    params: z.object({ ...money, masked: z.string() }),
    render: (p) => ({ subject: 'A payout to you was sent', text: `A payout of ${amount(p)} to account ${p.masked} was sent to your bank.` }),
  }),
  'payout.held': define({
    params: z.object({ ...money, reasons: z.array(reason) }),
    render: (p, zone) => ({
      subject: 'A payout to you is on hold',
      text: [`Your payable of ${amount(p)} was not paid in this payout run because:`, ...p.reasons.map((r) => `- ${heldBecause(r, zone)}`)].join('\r\n'),
    }),
  }),
  'payout.returned': define({
    params: z.object({ ...money, masked: z.string() }),
    render: (p) => ({
      subject: 'A payout to you was returned',
      text: `Your bank returned a payout of ${amount(p)} to account ${p.masked}.\r\nThe amount stays owed to you and is paid again once the account is confirmed.`,
    }),
  }),
  'bank_detail.changed': define({
    params: z.object({ masked: z.string(), previous_masked: z.string().nullable(), cooling_off_until: iso }),
    render: (p, zone) => ({
      subject: 'Your payout bank details were changed',
      text: [
        `The bank account for your payouts changed from ${p.previous_masked ?? 'none'} to ${p.masked}.`,
        `Payouts to the new account start after ${marketTime(p.cooling_off_until, zone)}.`,
        'If you did not ask for this change, contact us at once.',
      ].join('\r\n'),
    }),
  }),
  'tax_profile.changed': define({
    params: z.object({ valid_from: iso }),
    render: (p, zone) => ({
      subject: 'Your tax profile was changed',
      text: `Your tax profile was changed on ${marketTime(p.valid_from, zone)}.\r\nIf you did not make this change, contact us at once.`,
    }),
  }),
  'dispute.updated': define({
    params: z.object({}),
    render: () => ({ subject: 'Your commission dispute was updated', text: 'There is an update on your commission dispute.' }),
  }),
  'privacy_request.updated': define({
    params: z.object({}),
    render: () => ({ subject: 'Your privacy request was updated', text: 'There is an update on your privacy request.' }),
  }),
  'plan.change_scheduled': define({
    params: z.object({ effective_from: iso, time_zone: z.string() }),
    render: (p) => ({
      subject: 'A compensation plan change is scheduled',
      text: `A new version of the compensation plan takes effect on ${marketTime(p.effective_from, p.time_zone)}.`,
    }),
  }),
}

/** The mail of one notification row; throws on an unknown template or params that do not fit it. */
export function renderNotification(template: string, params: unknown, timeZone: string, webUrl: string): RenderedMail {
  const found = TEMPLATES[template]
  if (found === undefined) throw new Error(`no email template ${template}`)
  const mail = found.render(found.params.parse(params), timeZone)
  return { subject: mail.subject, text: `${mail.text}\r\n\r\nSee the details in your portal: ${webUrl}/portal` }
}
