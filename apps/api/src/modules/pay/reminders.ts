import { eligibleApprovers, withSystem, type Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob, type JobContext } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { getSetting } from '../ten/index.js'

// D-B4-20: once per provider and review date, every active market.manage holder of the market is mailed when the
// review is due within payouts.provider_review_reminder_days (unset: no mail).

async function remind(tx: Tx, providerId: string, ctx: JobContext): Promise<void> {
  const days = await getSetting(tx, 'payouts.provider_review_reminder_days')
  if (days === null) return
  const { rows } = await tx.query<{ market_id: string; provider: string; due: string; code: string }>(
    `SELECT c.market_id, c.provider, to_char(c.review_due_on, 'YYYY-MM-DD') AS due, m.code
     FROM provider_config c JOIN market m ON m.id = c.market_id
     WHERE c.id = $1 AND c.state = 'recorded' AND c.review_due_on - current_date <= $2
       AND NOT EXISTS (SELECT 1 FROM audit.audit_event a WHERE a.action = 'PROVIDER.REVIEW_REMINDED' AND a.object_id = c.id
                         AND (a.after_ref::jsonb -> 'after' ->> 'review_due_on') = to_char(c.review_due_on, 'YYYY-MM-DD'))`,
    [providerId, days],
  )
  const provider = rows[0]
  if (provider === undefined) return
  const managers = await eligibleApprovers(tx, { permission: 'market.manage', marketId: provider.market_id, excludeUserIds: [] })
  await recordAudit(tx, {
    action: 'PROVIDER.REVIEW_REMINDED', objectType: 'provider_config', objectId: providerId,
    after: { review_due_on: provider.due, recipients: managers.length },
  })
  for (const manager of managers) {
    await sendMail(ctx.config.mailDir, {
      to: manager.email,
      subject: `Provider review due ${provider.due}: ${provider.provider} (${provider.code})`,
      text: `The eligibility record of ${provider.provider} for market ${provider.code} is due for review on ${provider.due}. Review it in Settings > Markets.`,
    })
  }
}

export const reviewReminderCron = defineSystemJob({
  name: 'pay.providers.review_reminders',
  cron: '0 6 * * *',
  async run(ctx) {
    const { rows } = await withSystem((tx) =>
      tx.query<{ tenant_id: string; provider_config_id: string }>('SELECT tenant_id, provider_config_id FROM pay_due_provider_reviews()'))
    for (const row of rows) {
      try {
        await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: ctx.jobId, supportSessionId: null },
          (tx) => remind(tx, row.provider_config_id, ctx))
      } catch (error) {
        ctx.log.error({ err: error, tenantId: row.tenant_id, providerConfigId: row.provider_config_id }, 'provider review reminder failed')
      }
    }
  },
})
