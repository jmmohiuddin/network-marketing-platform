import { authenticator } from 'otplib'

const STEP_SECONDS = 30
const SECRET_BYTES = 20 // 160-bit seed (RFC 4226 recommendation)
const ISSUER = 'NMP'

// Accepts the current code and the one before or after it (clock drift).
const verifier = authenticator.clone({ window: 1, step: STEP_SECONDS })

export function generateTotpSecret(): string {
  return authenticator.generateSecret(SECRET_BYTES)
}

/** otpauth:// URI for authenticator apps; the label is the account email. */
export function totpUri(accountLabel: string, secret: string): string {
  return verifier.keyuri(accountLabel, ISSUER, secret)
}

/**
 * The time step of a valid code, or null. A code is accepted once: callers store the returned step as
 * mfa_credential.last_used_step and pass it back here (TOTP replay prevention).
 */
export function matchTotp(secret: string, code: string, lastUsedStep: bigint | null, nowMs = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null
  // One clock reading for both the check and the step, so a step boundary cannot fall between them.
  const delta = verifier.clone({ epoch: nowMs }).checkDelta(code, secret)
  if (delta === null) return null
  const step = BigInt(Math.floor(nowMs / 1000 / STEP_SECONDS) + delta)
  if (lastUsedStep !== null && step <= lastUsedStep) return null
  return step
}
