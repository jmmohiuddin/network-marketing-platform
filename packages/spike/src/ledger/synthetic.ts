import type { PayeeResult } from './run-commit.js'

/** mulberry32: small deterministic PRNG so every benchmark and test run sees identical data for a seed. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic UUID-shaped id for synthetic entity n of a namespace (0..255). */
export function syntheticId(namespace: number, n: number): string {
  const hex = n.toString(16).padStart(12, '0')
  return `00000000-0000-4000-80${namespace.toString(16).padStart(2, '0')}-${hex}`
}

export interface SyntheticRun {
  payees: number; batchSize: number; seed: number
  /** Labelled fixture, not a product value (I-14). */
  withholdingBasisPoints: bigint
  /** Gross per payee drawn uniformly from 1..maxGrossMinor. */
  maxGrossMinor: number
}

const BASIS = 10_000n

/** Withholding rounded half-up once per payout line (I-10). */
export function withholding(grossMinor: bigint, basisPoints: bigint): bigint {
  return (grossMinor * basisPoints * 2n + BASIS) / (2n * BASIS)
}

/** Lazily yields batches so a 1M-line run never sits in memory at once. */
export function* syntheticBatches(s: SyntheticRun): Generator<PayeeResult[]> {
  const rnd = prng(s.seed)
  for (let start = 0; start < s.payees; start += s.batchSize) {
    const batch: PayeeResult[] = []
    for (let i = start; i < Math.min(start + s.batchSize, s.payees); i++) {
      const gross = BigInt(1 + Math.floor(rnd() * s.maxGrossMinor))
      batch.push({ payeeId: syntheticId(1, i), grossMinor: gross, withholdingMinor: withholding(gross, s.withholdingBasisPoints) })
    }
    yield batch
  }
}
