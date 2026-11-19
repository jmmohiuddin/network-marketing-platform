import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { defineTenantJob, type JobContext } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { bankRequestContext } from '../../lib/bank-crypto.js'
import { open } from '../../lib/secret-box.js'
import { formatMinor } from './money.js'

// D-B4-25: payee notices. The job payload carries ids only; the worker reads the addresses and writes the mails into
// MAIL_DIR. No notification table (B5).

const payload = z.strictObject({
  template: z.enum(['bank_detail.changed', 'payout.returned']),
  participant_id: z.uuid(),
  ref_id: z.uuid(),
})
type Notice = z.infer<typeof payload>
type Recipient = 'contact_on_record' | 'request_contact'

interface Message {
  readonly subject: string
  readonly text: string
  readonly requestContact: string | null
}

/** The instant as the UI shows it, in the payee's market zone: "Nov 21, 2026, 8:31 AM (Europe/Berlin)". */
const marketTime = (at: Date, timeZone: string): string =>
  `${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(at)} (${timeZone})`

async function bankDetailChanged(tx: Tx, notice: Notice, secretKey: Buffer): Promise<Message> {
  const { rows } = await tx.query<{ masked: string; until: Date; time_zone: string; previous: string | null; request_id: string; contact: string | null }>(
    `SELECT v.masked, v.cooling_off_until AS until, m.time_zone, r.id AS request_id, r.contact_email_sealed AS contact,
            (SELECT p.masked FROM bank_detail_version p WHERE p.participant_id = v.participant_id AND p.superseded_at IS NOT NULL
               AND p.id <> v.id ORDER BY p.superseded_at DESC, p.id LIMIT 1) AS previous
     FROM bank_detail_version v JOIN bank_detail_request r ON r.id = v.request_id
       JOIN participant pa ON pa.id = v.participant_id JOIN market m ON m.id = pa.market_id WHERE v.id = $1`,
    [notice.ref_id],
  )
  const row = rows[0]!
  return {
    subject: 'Your payout bank details were changed',
    text: [
      `The bank account for your payouts changed from ${row.previous ?? 'none'} to ${row.masked}.`,
      `Payouts to the new account start after ${marketTime(row.until, row.time_zone)}.`,
      'If you did not ask for this change, contact us at once.',
    ].join('\r\n'),
    requestContact: row.contact === null ? null : open(secretKey, row.contact, bankRequestContext(row.request_id)),
  }
}

async function payoutReturned(tx: Tx, notice: Notice): Promise<Message> {
  const { rows } = await tx.query<{ amount: string; currency: string; digits: number; masked: string }>(
    `SELECT i.amount_minor::text AS amount, i.currency, m.minor_unit AS digits, v.masked
     FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id JOIN market m ON m.id = b.market_id
     JOIN bank_detail_version v ON v.id = i.bank_detail_version_id WHERE i.id = $1`,
    [notice.ref_id],
  )
  const row = rows[0]!
  return {
    subject: 'A payout to you was returned',
    text: [
      `Your bank returned a payout of ${formatMinor(row.amount, row.digits)} ${row.currency} to account ${row.masked}.`,
      'The amount stays owed to you and is paid again once the account is confirmed.',
    ].join('\r\n'),
    requestContact: null,
  }
}

async function deliver(tx: Tx, notice: Notice, ctx: JobContext): Promise<void> {
  const message = notice.template === 'bank_detail.changed' ? await bankDetailChanged(tx, notice, ctx.config.secretKey) : await payoutReturned(tx, notice)
  const { rows } = await tx.query<{ email: string | null }>(`SELECT contact ->> 'email' AS email FROM participant WHERE id = $1`, [notice.participant_id])
  const targets: [Recipient, string | null][] = [['contact_on_record', rows[0]?.email ?? null]]
  if (notice.template === 'bank_detail.changed') targets.push(['request_contact', message.requestContact])
  const addresses: string[] = []
  for (const [recipient, address] of targets) {
    const sent = address !== null && address !== ''
    await recordAudit(tx, {
      action: sent ? 'NOTICE.SENT' : 'NOTICE.UNDELIVERABLE', objectType: 'participant', objectId: notice.participant_id,
      after: { template: notice.template, participant_id: notice.participant_id, recipient },
    })
    if (sent) addresses.push(address)
  }
  // Mails last: a failure before this point rolls the audit back and the job runs again.
  for (const to of addresses) await sendMail(ctx.config.mailDir, { to, subject: message.subject, text: message.text })
}

export const noticeJob = defineTenantJob({ name: 'pay.notice.send', payload, run: deliver })
