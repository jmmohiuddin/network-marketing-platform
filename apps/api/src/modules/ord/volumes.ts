import { Refusal } from './refusal.js'

/** Volumes by measure as decimal strings of integer minor units (D-B2-17), e.g. {qv: "1250"}. */
export type Volumes = Readonly<Record<string, string>>

const BIGINT_MAX = 9_223_372_036_854_775_807n

function checked(value: bigint): string {
  if (value > BIGINT_MAX || value < -BIGINT_MAX) {
    throw new Refusal(422, 'VOLUME_OUT_OF_RANGE', 'A volume is larger than the platform can store.')
  }
  return value.toString()
}

function mapVolumes(volumes: Volumes, fn: (value: bigint) => bigint): Volumes {
  return Object.fromEntries(Object.entries(volumes).map(([measure, value]) => [measure, checked(fn(BigInt(value)))]))
}

/** Per-unit volumes times a (signed) quantity, exact. */
export function times(perUnit: Volumes, quantity: number): Volumes {
  return mapVolumes(perUnit, (value) => value * BigInt(quantity))
}

/** A line's per-unit volumes: its volumes were per-unit times its quantity, so the division is exact. */
export function perUnit(lineVolumes: Volumes, quantity: number): Volumes {
  return mapVolumes(lineVolumes, (value) => value / BigInt(quantity))
}

/** Sum per measure of every volume set (measures missing from a set count as 0). */
export function sum(sets: readonly Volumes[]): Volumes {
  const totals = new Map<string, bigint>()
  for (const set of sets) {
    for (const [measure, value] of Object.entries(set)) totals.set(measure, (totals.get(measure) ?? 0n) + BigInt(value))
  }
  return Object.fromEntries([...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([measure, value]) => [measure, checked(value)]))
}

/** value × numerator / denominator, rounded half-up on the magnitude (half away from zero), integer math only. */
export function scaleHalfUp(value: bigint, numerator: bigint, denominator: bigint): bigint {
  const negative = value < 0n
  const magnitude = (negative ? -value : value) * numerator
  const rounded = (2n * magnitude + denominator) / (2n * denominator)
  return negative ? -rounded : rounded
}

/** Every measure scaled by numerator / denominator (D-B2-17 proportional restocking-fee effect). */
export function proportional(volumes: Volumes, numerator: bigint, denominator: bigint): Volumes {
  return mapVolumes(volumes, (value) => scaleHalfUp(value, numerator, denominator))
}
