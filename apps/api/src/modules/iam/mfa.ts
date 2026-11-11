import { withSystem, type Tx } from '@nmp/db'
import type { Config } from '../../config.js'
import { auditInRealm } from '../../lib/audit.js'
import type { AuthContext } from '../../lib/auth.js'
import { ApiError } from '../../lib/errors.js'
import { open, seal } from '../../lib/secret-box.js'
import { rotateSessionToken, type IssuedSession } from '../../lib/session.js'
import { generateTotpSecret, matchTotp, totpUri } from '../../lib/totp.js'
import { recordSuccess, reserveAttempt } from './attempts.js'

export type FactorPurpose = 'enrolment' | 'sign_in' | 'step_up'

const AUDIT_ACTION: Readonly<Record<FactorPurpose, string>> = {
  enrolment: 'MFA.ENROLLED',
  sign_in: 'AUTH.MFA_VERIFIED',
  step_up: 'AUTH.STEP_UP',
}

interface Credential {
  id: string
  secret_encrypted: string
  confirmed_at: Date | null
  last_used_step: string | null
}

async function findCredential(tx: Tx, userId: string): Promise<Credential | undefined> {
  const { rows } = await tx.query<Credential>(
    `SELECT id, secret_encrypted, confirmed_at, last_used_step FROM mfa_credential WHERE user_id = $1 AND type = 'totp'`,
    [userId],
  )
  return rows[0]
}

export interface TotpEnrolment {
  readonly secret: string
  readonly otpauth_uri: string
}

/** Starts (or restarts) TOTP enrolment; the secret is stored sealed and returned only in this response. */
export async function startTotpEnrolment(tx: Tx, config: Config, auth: AuthContext): Promise<TotpEnrolment> {
  const existing = await findCredential(tx, auth.userId)
  if (existing?.confirmed_at != null) {
    throw new ApiError(409, 'MFA_ALREADY_ENROLLED', 'A second factor is already enrolled.')
  }
  const { rows } = await tx.query<{ email: string }>('SELECT email FROM user_account WHERE id = $1', [auth.userId])
  const secret = generateTotpSecret()
  await tx.query(
    `INSERT INTO mfa_credential (user_id, type, secret_encrypted) VALUES ($1, 'totp', $2)
     ON CONFLICT (user_id, type) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, last_used_step = NULL`,
    [auth.userId, seal(config.secretKey, secret, auth.userId)],
  )
  await auditInRealm(tx, auth.realm, { action: 'MFA.ENROLMENT_STARTED', objectType: 'user_account', objectId: auth.userId })
  return { secret, otpauth_uri: totpUri(rows[0]!.email, secret) }
}

function credentialFor(purpose: FactorPurpose, credential: Credential | undefined): Credential {
  const confirmed = credential?.confirmed_at != null
  if (purpose === 'enrolment' && (credential === undefined || confirmed)) {
    throw new ApiError(409, 'MFA_ENROLMENT_NOT_STARTED', 'Start enrolment first, or the factor is already enrolled.')
  }
  if (purpose !== 'enrolment' && !confirmed) {
    throw new ApiError(403, 'MFA_ENROLMENT_REQUIRED', 'Enrol a second factor to continue.')
  }
  return credential!
}

// Accepts the step only if it is newer than the last one used: a concurrent replay updates no row.
async function consumeStep(tx: Tx, credentialId: string, step: bigint): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE mfa_credential SET last_used_step = $2, confirmed_at = coalesce(confirmed_at, now())
     WHERE id = $1 AND (last_used_step IS NULL OR last_used_step < $2)`,
    [credentialId, step.toString()],
  )
  return rowCount === 1
}

/** null: wrong or replayed code. session: the rotated token when the session was elevated to AAL2 (not on step-up). */
export type FactorResult = { readonly session: IssuedSession | null } | null

/**
 * Checks a TOTP code for enrolment confirmation, sign-in verification or step-up. On success the session
 * becomes AAL2 with a fresh step_up_at (FR-IAM-002) and, when this elevates it, gets a new token; every
 * outcome is audited in the same transaction. A wrong or replayed code returns null (the caller answers 422).
 */
export async function verifyFactor(
  tx: Tx, config: Config, auth: AuthContext, code: string, purpose: FactorPurpose,
): Promise<FactorResult> {
  const credential = credentialFor(purpose, await findCredential(tx, auth.userId))
  const secret = open(config.secretKey, credential.secret_encrypted, auth.userId)
  const lastUsed = credential.last_used_step === null ? null : BigInt(credential.last_used_step)
  const step = matchTotp(secret, code, lastUsed)
  const subject = { objectType: 'user_account', objectId: auth.userId }
  if (step === null || !(await consumeStep(tx, credential.id, step))) {
    await auditInRealm(tx, auth.realm, { ...subject, action: 'AUTH.MFA_FAILED', after: { purpose, reason: 'invalid_code' } })
    return null
  }
  if (purpose === 'enrolment') await tx.query('UPDATE user_account SET mfa_enrolled = true WHERE id = $1', [auth.userId])
  await tx.query(
    `UPDATE session SET assurance_level = 'aal2', mfa_verified_at = coalesce(mfa_verified_at, now()), step_up_at = now()
     WHERE id = $1`,
    [auth.sessionId],
  )
  const session = purpose === 'step_up' ? null : await rotateSessionToken(tx, auth.sessionId)
  await auditInRealm(tx, auth.realm, { ...subject, action: AUDIT_ACTION[purpose] })
  return { session }
}

const factorKey = (userId: string): string => `mfa:${userId}`

/**
 * Limited retries for codes (FR-IAM-002): the sign-in lockout values, counted per user. Reserves the attempt
 * before the code is checked (attempts.ts); false when the user's codes are locked.
 */
export async function reserveFactorAttempt(config: Config, userId: string, ip: string): Promise<boolean> {
  return (await withSystem((tx) => reserveAttempt(tx, config, factorKey(userId), ip))) !== null
}

export function recordFactorSuccess(userId: string, ip: string): Promise<void> {
  return recordSuccess(factorKey(userId), ip)
}

/** A code refused unchecked because the user's codes are locked; audited like a wrong code. */
export async function auditFactorLocked(tx: Tx, auth: AuthContext, purpose: FactorPurpose): Promise<void> {
  await auditInRealm(tx, auth.realm, {
    action: 'AUTH.MFA_FAILED', objectType: 'user_account', objectId: auth.userId, after: { purpose, reason: 'locked' },
  })
}
