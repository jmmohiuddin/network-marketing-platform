import { randomBytes } from 'node:crypto'
import { Algorithm, hash, verify } from '@node-rs/argon2'
import { z } from 'zod'

// argon2id with the library defaults (19 MiB, t=2, p=1), the OWASP minimum for argon2id.
const OPTIONS = { algorithm: Algorithm.Argon2id } as const

/** Length-based policy (SEC-23). shortcut: no breached-password list check yet; add one before production. */
export const passwordSchema = z.string().min(12, 'must be at least 12 characters').max(256)

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS)
}

let dummyHash: Promise<string> | undefined

/**
 * Verifies a password; with no stored hash (unknown user, no credential) it still runs one verification
 * against a throwaway hash, so the response time does not reveal whether the account exists.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64'))
  const target = storedHash ?? (await dummyHash)
  try {
    const matches = await verify(target, password)
    return storedHash !== null && matches
  } catch {
    return false // malformed stored hash: treat as a wrong password
  }
}
