import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const VERSION = 'v1'

/**
 * Encrypts a small secret (a TOTP seed) with AES-256-GCM under SECRET_ENCRYPTION_KEY.
 * context (for example the user id) is bound as associated data, so a ciphertext copied to another row
 * does not decrypt. Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */
export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) =>
    typeof part === 'string' ? part : part.toString('base64url'),
  ).join('.')
}

/** Reverses seal; throws if the value was tampered with, sealed under another key or for another context. */
export function open(key: Buffer, sealed: string, context: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.')
  if (version !== VERSION || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error('sealed value has an unknown format')
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
