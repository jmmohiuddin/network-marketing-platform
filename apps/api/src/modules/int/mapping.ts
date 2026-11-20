import { z } from 'zod'

// Shared pieces of the connector payload mappings (PLAN B2 2.6). A mapping turns a signed store payload into the
// normalised order or event ORD ingests, an ignored topic, or a refusal persisted under the payload's natural key.

export type Mapped =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'order' | 'event'; readonly input: Record<string, unknown> }
  | { readonly kind: 'rejected'; readonly key: string; readonly code: string; readonly message: string }

export interface MappingContext {
  readonly connectorId: string
  readonly marketCode: string
  readonly minorUnit: number
  /** The plan version's crediting event at the order's time; null = no plan covers the market (ORD then refuses CREDITING_EVENT_NOT_CONFIGURED). */
  readonly creditingEvent: 'paid' | 'fulfilled' | null
}

/** A refusal found while mapping; the caller persists it as a rejected inbound event. */
export class MappingRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export const storeId = z.union([z.number().int(), z.string().min(1).max(100)]).transform(String)
export const money = z.string().max(40)

/**
 * A store's decimal string in minor units of the market, exactly (no floating point). Digits beyond the minor unit must
 * be zeros, else AMOUNT_PRECISION.
 */
export function toMinor(value: string, minorUnit: number): bigint {
  const match = /^(-?)(\d{1,19})(?:\.(\d{1,20}))?$/.exec(value.trim())
  if (match === null) throw new MappingRefusal('PAYLOAD_INVALID', 'An amount is not a decimal number.')
  const [, sign, whole, fraction = ''] = match
  if (/[^0]/.test(fraction.slice(minorUnit))) {
    throw new MappingRefusal('AMOUNT_PRECISION', 'An amount has more decimals than the market currency.')
  }
  const minor = BigInt(whole! + fraction.slice(0, minorUnit).padEnd(minorUnit, '0'))
  return sign === '-' ? -minor : minor
}

/** A line amount after discounts; never negative. */
export function lineAmount(value: bigint): string {
  if (value < 0n) throw new MappingRefusal('AMOUNT_INVALID', 'A line amount after discounts is negative.')
  return value.toString()
}

const POSITION_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

type Hint = { kind: 'link' | 'code'; position_ref: string }

/** Every attribution hint the store order carries; orders.attribution_precedence picks one at ingestion. */
export function hints(link: unknown, code: unknown): Hint[] | undefined {
  const given: [Hint['kind'], unknown][] = [['link', link], ['code', code]]
  const found = given.flatMap(([kind, ref]) => (typeof ref === 'string' && POSITION_REF.test(ref) ? [{ kind, position_ref: ref }] : []))
  return found.length === 0 ? undefined : found
}

/** Store timestamps without a zone (WooCommerce *_gmt) are UTC. */
export function utc(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return /(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
}

/** The order is credited (its configured crediting time is present); without a plan, ingestion refuses it. */
export function credited(input: { paid_at?: string | undefined; fulfilled_at?: string | undefined }, ctx: MappingContext): boolean {
  if (ctx.creditingEvent === null) return true
  return (ctx.creditingEvent === 'paid' ? input.paid_at : input.fulfilled_at) !== undefined
}

/** Runs a mapping; a MappingRefusal becomes a rejection under the payload's natural key. */
export function refusing(key: string, map: () => Mapped): Mapped {
  try {
    return map()
  } catch (error) {
    if (!(error instanceof MappingRefusal)) throw error
    return { kind: 'rejected', key, code: error.code, message: error.message }
  }
}
