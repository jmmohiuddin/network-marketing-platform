import { randomBytes } from 'node:crypto'
import { authenticator } from 'otplib'
import { describe, expect, test } from 'vitest'
import { hashPassword, verifyPassword } from './passwords.js'
import { open, seal } from './secret-box.js'
import { generateTotpSecret, matchTotp } from './totp.js'

const STEP_MS = 30_000

describe('secret box (AES-256-GCM)', () => {
  const key = randomBytes(32)

  test('round-trips, and every seal of the same value differs', () => {
    const first = seal(key, 'JBSWY3DPEHPK3PXP', 'user-1')

    expect(open(key, first, 'user-1')).toBe('JBSWY3DPEHPK3PXP')
    expect(seal(key, 'JBSWY3DPEHPK3PXP', 'user-1')).not.toBe(first)
  })

  test('refuses another context, another key and a tampered value', () => {
    const sealed = seal(key, 'secret', 'user-1')
    const [version, iv, tag, body] = sealed.split('.') as [string, string, string, string]
    const flipped = `${version}.${iv}.${tag}.${Buffer.from(Buffer.from(body, 'base64url').map((byte) => byte ^ 1)).toString('base64url')}`

    expect(() => open(key, sealed, 'user-2')).toThrow()
    expect(() => open(randomBytes(32), sealed, 'user-1')).toThrow()
    expect(() => open(key, flipped, 'user-1')).toThrow()
    expect(() => open(key, 'garbage', 'user-1')).toThrow('unknown format')
  })
})

describe('TOTP', () => {
  const secret = generateTotpSecret()
  const now = Date.UTC(2026, 10, 12, 12, 0, 10)
  const codeAt = (ms: number) => authenticator.clone({ epoch: ms }).generate(secret)
  const step = BigInt(Math.floor(now / STEP_MS))

  test('a 160-bit seed; the current code and one step of drift either way are accepted', () => {
    expect(secret).toHaveLength(32)
    expect(matchTotp(secret, codeAt(now), null, now)).toBe(step)
    expect(matchTotp(secret, codeAt(now - STEP_MS), null, now)).toBe(step - 1n)
    expect(matchTotp(secret, codeAt(now + STEP_MS), null, now)).toBe(step + 1n)
    expect(matchTotp(secret, codeAt(now - 3 * STEP_MS), null, now)).toBeNull()
  })

  test('a step at or before last_used_step is refused (replay)', () => {
    expect(matchTotp(secret, codeAt(now), step, now)).toBeNull()
    expect(matchTotp(secret, codeAt(now - STEP_MS), step, now)).toBeNull()
    expect(matchTotp(secret, codeAt(now + STEP_MS), step, now)).toBe(step + 1n)
  })

  test('anything but six digits is refused without checking', () => {
    expect(matchTotp(secret, '12345', null, now)).toBeNull()
    expect(matchTotp(secret, 'abcdef', null, now)).toBeNull()
  })
})

describe('passwords (argon2id)', () => {
  test('verifies the right password only; an unknown account never matches', async () => {
    const stored = await hashPassword('correct horse battery staple')

    expect(stored).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true)
    expect(await verifyPassword(stored, 'wrong')).toBe(false)
    expect(await verifyPassword(null, 'correct horse battery staple')).toBe(false)
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false)
  })
})
