import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { bankRequestContext } from '../../lib/bank-crypto.js'
import { defineTenantJob, type JobContext } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { open } from '../../lib/secret-box.js'
import { renderNotification } from '../dist/index.js'

// D-B4-25 as reduced by D-B5-14: the notice to the contact on record and the returned-payment notice are notification
// rows (notify_participant); this job keeps only the mail to the contact a staff bank-detail request named. The payload
// carries ids only; the worker unseals the address and writes the mail into MAIL_DIR, in the participant's language
// (BUG-135: the notification template and portal_locale, as for the contact on record).

const payload = z.strictObject({
  template: z.literal('bank_detail.changed'),
  participant_id: z.uuid(),
  ref_id: z.uuid(),
})
type Notice = z.infer<typeof payload>

async function deliver(tx: Tx, notice: Notice, ctx: JobContext): Promise<void> {
  const { rows } = await tx.query<{
    masked: string; until: Date; time_zone: string; previous: string | null; request_id: string; contact: string | null; locale: string
    on_record: string | null
  }>(
    `SELECT v.masked, v.cooling_off_until AS until, m.time_zone, r.id AS request_id, r.contact_email_sealed AS contact,
            portal_locale(v.participant_id) AS locale, pa.contact ->> 'email' AS on_record,
            (SELECT p.masked FROM bank_detail_version p WHERE p.participant_id = v.participant_id AND p.superseded_at IS NOT NULL
               AND p.id <> v.id ORDER BY p.superseded_at DESC, p.id LIMIT 1) AS previous
     FROM bank_detail_version v JOIN bank_detail_request r ON r.id = v.request_id
       JOIN participant pa ON pa.id = v.participant_id JOIN market m ON m.id = pa.market_id WHERE v.id = $1`,
    [notice.ref_id],
  )
  const row = rows[0]!
  const address = row.contact === null ? null : open(ctx.config.secretKey, row.contact, bankRequestContext(row.request_id))
  // BUG-141: the account notice (notify_participant) already mails the contact on record; the same address gets one mail.
  if (address !== null && address.toLowerCase() === row.on_record?.toLowerCase()) {
    await recordAudit(tx, {
      action: 'NOTICE.SKIPPED', objectType: 'participant', objectId: notice.participant_id,
      after: { template: notice.template, participant_id: notice.participant_id, recipient: 'request_contact', reason: 'same_as_contact_on_record' },
    })
    return
  }
  await recordAudit(tx, {
    action: address === null ? 'NOTICE.UNDELIVERABLE' : 'NOTICE.SENT', objectType: 'participant', objectId: notice.participant_id,
    after: { template: notice.template, participant_id: notice.participant_id, recipient: 'request_contact' },
  })
  if (address === null) return
  // The mail last: a failure before this point rolls the audit back and the job runs again.
  const params = { masked: row.masked, previous_masked: row.previous, cooling_off_until: row.until.toISOString() }
  await sendMail(ctx.config.mailDir, {
    to: address, ...renderNotification(notice.template, params, row.locale, row.time_zone, ctx.config.webUrl, ctx.log),
  })
}

export const noticeJob = defineTenantJob({ name: 'pay.notice.send', payload, run: deliver })
