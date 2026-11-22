import type { Tx } from '@nmp/db'
import { getMarket, getSetting, type MarketView } from '../ten/index.js'
import { Refusal } from './refusal.js'
import type { OrderInput } from './schemas.js'

// FR-ORD-001 / FR-ORD-003 checks of an order before anything is written. Every failure is a Refusal (persisted).

/** The live market named by code (unknown codes are refused like a market that is not live). */
export async function liveMarket(tx: Tx, code: string): Promise<MarketView> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM market WHERE code = $1', [code])
  const market = rows[0] === undefined ? null : await getMarket(tx, rows[0].id)
  if (market?.state !== 'live') {
    throw new Refusal(422, 'MARKET_NOT_LIVE', 'This market is not live yet: complete its launch checklist first.', {
      market: code, state: market?.state ?? null,
    })
  }
  return market
}

/** Line numbers, totals (in the order's own currency) and timestamps (no later than now + the configured tolerance). */
export function assertOrderFacts(input: OrderInput, toleranceSeconds: number): void {
  if (new Set(input.lines.map((line) => line.line_no)).size !== input.lines.length) {
    throw new Refusal(422, 'LINE_NUMBERS_INVALID', 'Each line number may appear once.')
  }
  const total = input.lines.reduce((sum, line) => sum + BigInt(line.amount_minor), 0n)
  if (total !== BigInt(input.amount_minor)) {
    throw new Refusal(422, 'TOTALS_MISMATCH', 'amount_minor must equal the sum of the line amounts.', { lines_total_minor: total.toString() })
  }
  assertNotFuture([input.ordered_at, input.paid_at, input.fulfilled_at], toleranceSeconds)
}

export function assertNotFuture(instants: readonly (string | undefined)[], toleranceSeconds: number): void {
  const latest = Date.now() + toleranceSeconds * 1000
  if (instants.some((value) => value !== undefined && Date.parse(value) > latest)) {
    throw new Refusal(422, 'TIMESTAMP_IN_FUTURE', 'A timestamp lies in the future.')
  }
}

/**
 * D-B6-05: the crediting event of the market's plan version in force at `orderedAt` (before the first version: the
 * earliest one's); null when no plan version covers the market.
 */
export async function creditingEvent(tx: Tx, marketCode: string, orderedAt: string): Promise<'paid' | 'fulfilled' | null> {
  const { rows } = await tx.query<{ event: 'paid' | 'fulfilled' | null }>(
    'SELECT plan_crediting_event(id, $2) AS event FROM market WHERE code = $1', [marketCode, orderedAt],
  )
  return rows[0]?.event ?? null
}

/** The crediting event's time (no event configured: refused); null when the payload does not carry it yet. */
export async function creditingTimeOf(tx: Tx, input: OrderInput): Promise<string | null> {
  const event = await creditingEvent(tx, input.market, input.ordered_at)
  if (event === null) {
    throw new Refusal(422, 'CREDITING_EVENT_NOT_CONFIGURED', 'Schedule a plan version for this market before sending orders.')
  }
  return (event === 'paid' ? input.paid_at : input.fulfilled_at) ?? null
}

/** D-B2-12: credited_at = the time of the configured crediting event. */
export async function creditedAt(tx: Tx, input: OrderInput): Promise<string> {
  const time = await creditingTimeOf(tx, input)
  if (time === null) {
    throw new Refusal(422, 'CREDITING_EVENT_MISSING', 'The order does not carry the time of the configured crediting event yet.')
  }
  return time
}

export interface BuyerType {
  readonly type_id: string
  readonly code: string
  readonly counts_as_end_customer: boolean
  readonly can_hold_positions: boolean
}

export interface Buyer {
  /** null: the buyer is created as a customer of `type` when the order is accepted. */
  readonly id: string | null
  readonly type: BuyerType
}

const TYPE_AT = 'SELECT type_id, code, counts_as_end_customer, can_hold_positions FROM par_type_at($1, $2)'

/** The buyer by external reference, or the configured new-buyer type for an unknown one (FR-ORD-001). */
export async function resolveBuyer(tx: Tx, input: OrderInput, at: string): Promise<Buyer> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM participant WHERE external_ref = $1', [input.buyer.external_ref])
  if (rows[0] !== undefined) {
    const type = await tx.query<BuyerType>(TYPE_AT, [rows[0].id, at])
    if (type.rows[0] === undefined) {
      throw new Refusal(422, 'BUYER_TYPE_MISSING', 'The buyer has no participant type at the crediting time.')
    }
    return { id: rows[0].id, type: type.rows[0] }
  }
  const code = input.buyer.auto_create ? await getSetting(tx, 'orders.new_buyer_type') : null
  if (code === null) throw new Refusal(422, 'BUYER_NOT_FOUND', 'No participant has this external reference.')
  const type = await tx.query<BuyerType>(
    `SELECT id AS type_id, code, counts_as_end_customer, can_hold_positions FROM participant_type
     WHERE code = $1 AND state = 'active' AND counts_as_end_customer`,
    [code],
  )
  if (type.rows[0] === undefined) {
    throw new Refusal(422, 'BUYER_TYPE_INVALID', 'orders.new_buyer_type is not an active end-customer type.', { type_code: code })
  }
  return { id: null, type: type.rows[0] }
}

export interface Purpose {
  readonly purpose: 'resale' | 'personal' | 'unspecified' | 'customer'
  readonly missing: boolean
}

/** FR-ORD-003: end customers buy as customers; others give resale/personal or are flagged when it is required. */
export async function purposeOf(tx: Tx, input: OrderInput, type: BuyerType): Promise<Purpose> {
  if (type.counts_as_end_customer) {
    if (input.purpose !== undefined) {
      throw new Refusal(422, 'PURPOSE_INVALID', 'An end customer\'s order has the purpose customer; do not send resale or personal.')
    }
    return { purpose: 'customer', missing: false }
  }
  if (input.purpose !== undefined) return { purpose: input.purpose, missing: false }
  return { purpose: 'unspecified', missing: (await getSetting(tx, 'orders.purpose_required')) === true }
}
