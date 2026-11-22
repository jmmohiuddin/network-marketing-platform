import { withSystem, type Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob, type JobContext } from '../../lib/jobs.js'
import { tryLockLedger } from './ledger.js'

// AC-FIN6-4 (D-V1A-03, PLAN V1-A 4.3): daily, the expiry notice once per lot expiry_notice_days before it expires
// (notify_credit_expiring: in-app, e-mail per preference through DIST), then Dr credit_liability / Cr breakage for the
// remainder of every due lot, once. An item that cannot run now (ledger busy, no committed period) is retried next day.

/** At most this many candidates per run and kind (the SQL limit; the rest are found the next day). */
const CANDIDATES_MAX = 1000

async function notify(tx: Tx, awardId: string, remainingMinor: string): Promise<void> {
  const { rows } = await tx.query<{ id: string | null }>('SELECT notify_credit_expiring($1, $2) AS id', [awardId, remainingMinor])
  if (rows[0]!.id === null) return
  await recordAudit(tx, { action: 'CREDIT.EXPIRY_NOTIFIED', objectType: 'credit_award', objectId: awardId, after: { remaining_minor: remainingMinor } })
}

/** Expires the holder's due lots of one type in one market; false when the market's ledger is being posted. */
async function expire(tx: Tx, item: { market_id: string; participant_id: string; credit_type_id: string }): Promise<boolean> {
  if (!(await tryLockLedger(tx, item.market_id))) return false
  const { rows: due } = await tx.query<{ award_id: string }>(
    'SELECT award_id FROM credit_lots($1, $2, $3) WHERE expires_at <= now() AND remaining_minor > 0',
    [item.participant_id, item.credit_type_id, item.market_id],
  )
  await tx.query('SELECT credit_expire_due($1, $2, $3)', [item.participant_id, item.credit_type_id, item.market_id])
  const { rows: expired } = await tx.query<{ award_id: string; amount_minor: string; entry_id: string }>(
    `SELECT award_id, amount_minor::text, entry_id FROM credit_lot_event WHERE kind = 'expired' AND award_id = ANY ($1)`,
    [due.map((lot) => lot.award_id)],
  )
  for (const lot of expired) {
    await recordAudit(tx, {
      action: 'CREDIT.EXPIRED', objectType: 'credit_award', objectId: lot.award_id, after: { amount_minor: lot.amount_minor, entry_id: lot.entry_id },
    })
  }
  return true
}

const asSystem = (tenantId: string, ctx: JobContext) =>
  <T>(fn: (tx: Tx) => Promise<T>) => runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: ctx.jobId, supportSessionId: null }, fn)

export const creditExpiryCron = defineSystemJob({
  name: 'led.credits.expire',
  cron: '0 1 * * *',
  async run(ctx) {
    const notices = await withSystem((tx) =>
      tx.query<{ tenant_id: string; award_id: string; remaining_minor: string }>('SELECT * FROM credits_to_notify($1)', [CANDIDATES_MAX]))
    for (const row of notices.rows) {
      try {
        await asSystem(row.tenant_id, ctx)((tx) => notify(tx, row.award_id, row.remaining_minor))
      } catch (error) {
        ctx.log.error({ err: error, tenantId: row.tenant_id, awardId: row.award_id }, 'credit expiry notice failed')
      }
    }
    const due = await withSystem((tx) =>
      tx.query<{ tenant_id: string; market_id: string; participant_id: string; credit_type_id: string }>('SELECT * FROM credits_to_expire($1)', [CANDIDATES_MAX]))
    for (const row of due.rows) {
      try {
        if (!(await asSystem(row.tenant_id, ctx)((tx) => expire(tx, row)))) ctx.log.warn({ ...row }, 'credit expiry skipped: ledger busy, retried tomorrow')
      } catch (error) {
        const { code, detail } = error as { code?: string; detail?: string }
        const noPeriod = code === '23514' && detail === 'no_committed_period'
        if (noPeriod) ctx.log.warn({ ...row }, 'credit expiry skipped: no committed period open, retried tomorrow')
        else ctx.log.error({ err: error, ...row }, 'credit expiry failed')
      }
    }
  },
})
