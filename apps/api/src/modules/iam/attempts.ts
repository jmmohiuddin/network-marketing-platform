import { withSystem, type Tx } from '@nmp/db'
import type { Config } from '../../config.js'

/**
 * Lockout counter for passwords (AC-35.2) and second-factor codes (FR-IAM-002), kept in login_attempt per
 * opaque account key. A failure is reserved before the slow check (argon2, TOTP), under a per-key advisory
 * lock, so concurrent attempts are counted one after another and at most lockoutMaxFailures checks run per
 * window. Returns the failures counted including this one, or null when the key is locked (nothing recorded:
 * attempts while locked are not counted). login_attempt is system-realm state with no tenant, so it cannot share
 * the audit event's transaction (unknown accounts have no tenant log at all).
 */
export async function reserveAttempt(tx: Tx, config: Config, accountKey: string, ip: string): Promise<number | null> {
  const since = new Date(Date.now() - config.lockoutWindowMinutes * 60_000)
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`login_attempt:${accountKey}`])
  const { rows } = await tx.query<{ n: number }>('SELECT auth_count_recent_failures($1, $2) AS n', [accountKey, since])
  const failures = rows[0]!.n
  if (failures >= config.lockoutMaxFailures) return null
  await tx.query('SELECT auth_record_login_attempt($1, $2, false)', [accountKey, ip])
  return failures + 1
}

/** A success resets the counter: failures before it, this request's reservation included, stop counting. */
export async function recordSuccess(accountKey: string, ip: string): Promise<void> {
  await withSystem((tx) => tx.query('SELECT auth_record_login_attempt($1, $2, true)', [accountKey, ip]))
}
