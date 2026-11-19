import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { defineTenantJob } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'

// shortcut: fixed code lifetime and check count (E-ADR-10 class), not tenant settings; make them settings when a tenant
// asks for other values.
export const SIGN_IN_CODE_TTL_MINUTES = 10
// shortcut: see SIGN_IN_CODE_TTL_MINUTES. The portal_sign_in_code.attempts CHECK (0..5) pins the same maximum.
export const SIGN_IN_CODE_MAX_ATTEMPTS = 5
// shortcut: see SIGN_IN_CODE_TTL_MINUTES. Per account: no new code while one is younger than the cooldown, at most the
// cap a day, so a stranger who knows the address can neither flood the mailbox nor keep revoking the member's code.
export const SIGN_IN_CODE_COOLDOWN_SECONDS = 60
export const SIGN_IN_CODES_PER_DAY = 20
const CODE_SPACE = 1_000_000 // six digits

/** sha256(code id ‖ code): the only form stored, bound to its row so a hash copied to another row never matches. */
function codeHash(id: string, code: string): Buffer {
  return createHash('sha256').update(`${id}${code}`, 'utf8').digest()
}

/**
 * Checks a code against the account's newest open code (unused, unexpired, fewer than SIGN_IN_CODE_MAX_ATTEMPTS checks).
 * Every check counts, right or wrong, under the row lock; a right code is used at once. The caller's transaction commits
 * the count of a wrong code too (it returns false, it does not throw).
 */
export async function useSignInCode(tx: Tx, userId: string, code: string): Promise<boolean> {
  const { rows } = await tx.query<{ id: string; code_hash: Buffer }>(
    `UPDATE portal_sign_in_code SET attempts = attempts + 1
     WHERE id = (SELECT id FROM portal_sign_in_code
                 WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
                 ORDER BY created_at DESC LIMIT 1 FOR UPDATE)
     RETURNING id, code_hash`,
    [userId, SIGN_IN_CODE_MAX_ATTEMPTS],
  )
  const row = rows[0]
  if (row === undefined || !timingSafeEqual(row.code_hash, codeHash(row.id, code))) return false
  await tx.query('UPDATE portal_sign_in_code SET used_at = now() WHERE id = $1', [row.id])
  return true
}

interface CodeRecipient {
  email: string
  tenant_name: string
}

// An active portal account of an active, not pseudonymised participant (the request may be older than a deactivation).
async function recipientOf(tx: Tx, userId: string): Promise<CodeRecipient | undefined> {
  const { rows } = await tx.query<CodeRecipient>(
    `SELECT u.email, t.legal_name AS tenant_name FROM user_account u
     JOIN tenant t ON t.id = u.tenant_id
     JOIN participant p ON p.tenant_id = u.tenant_id AND p.id = u.participant_id
     WHERE u.id = $1 AND u.realm = 'portal' AND u.state = 'active' AND p.status = 'active' AND p.pseudonymised_at IS NULL`,
    [userId],
  )
  return rows[0]
}

// The cooldown and the daily cap; the lock makes concurrent requests for one account check one after the other.
async function mayIssue(tx: Tx, userId: string): Promise<boolean> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('sign-in-code:' || $1, 0))`, [userId])
  const { rows } = await tx.query<{ recent: number; today: number }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - make_interval(secs => $2))::int AS recent,
            count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS today
     FROM portal_sign_in_code WHERE user_id = $1`,
    [userId, SIGN_IN_CODE_COOLDOWN_SECONDS],
  )
  return rows[0]!.recent === 0 && rows[0]!.today < SIGN_IN_CODES_PER_DAY
}

/**
 * D-B5-03 (b): a new six-digit sign-in code for a portal account, mailed to the account's email. Earlier unused codes stop
 * working (used_at set, rows kept for the personal-data export); only the hash is stored. Nothing happens within the
 * cooldown or past the daily cap. The mail is the last step: if it fails, the code rolls back with it and the queue retries.
 */
export const sendSignInCodeJob = defineTenantJob({
  name: 'iam.send-sign-in-code',
  payload: z.strictObject({ user_id: z.uuid() }),
  async run(tx, payload, ctx) {
    const recipient = await recipientOf(tx, payload.user_id)
    if (recipient === undefined || !(await mayIssue(tx, payload.user_id))) return
    await tx.query('UPDATE portal_sign_in_code SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [payload.user_id])
    const id = randomUUID()
    const code = randomInt(CODE_SPACE).toString().padStart(6, '0')
    await tx.query(
      `INSERT INTO portal_sign_in_code (id, tenant_id, user_id, code_hash, expires_at)
       VALUES ($1, app_tenant_id(), $2, $3, now() + make_interval(mins => $4))`,
      [id, payload.user_id, codeHash(id, code), SIGN_IN_CODE_TTL_MINUTES],
    )
    await recordAudit(tx, { action: 'AUTH.SIGN_IN_CODE_SENT', objectType: 'portal_sign_in_code', objectId: id, after: { user_id: payload.user_id } })
    await sendMail(ctx.config.mailDir, {
      to: recipient.email,
      subject: `Your sign-in code for ${recipient.tenant_name}`,
      text: [
        `Your sign-in code is ${code}.`,
        '',
        `It works once, for ${SIGN_IN_CODE_TTL_MINUTES} minutes. If you did not ask to sign in, ignore this email.`,
      ].join('\n'),
    })
  },
})
