import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

// D-B4-13: an instruction's signed facts, HMAC-SHA256 under a per-tenant key derived from SECRET_ENCRYPTION_KEY.
// shortcut: key derived from SECRET_ENCRYPTION_KEY, a per-tenant KMS key at hosted deployment.
const INFO = 'payout-instruction-signing'
const KEY_BYTES = 32

export interface SignedFacts {
  readonly tenantId: string
  readonly instructionId: string
  readonly payeeId: string
  readonly bankDetailVersionId: string
  readonly amountMinor: string
  readonly currency: string
  readonly idempotencyKey: string
}

function tenantKey(secretKey: Buffer, tenantId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secretKey, tenantId, INFO, KEY_BYTES))
}

export function signInstruction(secretKey: Buffer, facts: SignedFacts): Buffer {
  const canonical = JSON.stringify([
    facts.tenantId, facts.instructionId, facts.payeeId, facts.bankDetailVersionId, facts.amountMinor, facts.currency,
    facts.idempotencyKey,
  ])
  return createHmac('sha256', tenantKey(secretKey, facts.tenantId)).update(canonical).digest()
}

export function signatureValid(secretKey: Buffer, facts: SignedFacts, signature: Buffer): boolean {
  const expected = signInstruction(secretKey, facts)
  return signature.length === expected.length && timingSafeEqual(signature, expected)
}
