import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { envelope } from '../../lib/http.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { attribute, attributionPrecedence, servicingFromFirstOrder, type Attribution } from './attribution.js'
import { recordLate } from './late.js'
import { assertOrderFacts, creditedAt, liveMarket, purposeOf, resolveBuyer, type Buyer, type Purpose } from './order-checks.js'
import { conversionAt, convertMinor, type Conversion } from './fx.js'
import type { AttemptRefs, Outcome } from './outcome.js'
import { Refusal } from './refusal.js'
import type { OrderInput } from './schemas.js'
import { orderFacts } from './views.js'
import { sum, times, type Volumes } from './volumes.js'

interface PricedLine {
  readonly line_no: number
  readonly sku: string
  readonly item_class: string
  readonly quantity: number
  /** In the market currency (converted when the order is in another currency). */
  readonly amount_minor: string
  /** The amount as sent, when converted (D-V1A-04). */
  readonly original_amount_minor: string | null
  readonly volumes: Volumes
  readonly source_line_id: string | null
}

/** Lines with their per-unit map row in force at the crediting time (BR-VOL-01); null lists the SKUs without one. */
async function priceLines(tx: Tx, marketId: string, input: OrderInput, at: string): Promise<PricedLine[] | { missing: string[] }> {
  const skus = [...new Set(input.lines.map((line) => line.sku))]
  const { rows } = await tx.query<{ sku: string; item_class: string; volumes: Volumes }>(
    `SELECT sku, item_class, volumes FROM product_volume_map
     WHERE market_id = $1 AND sku = ANY ($2) AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)`,
    [marketId, skus, at],
  )
  const maps = new Map(rows.map((row) => [row.sku, row]))
  const missing = skus.filter((sku) => !maps.has(sku)).sort()
  if (missing.length > 0) return { missing }
  return input.lines.map((line) => {
    const map = maps.get(line.sku)!
    return {
      ...line, original_amount_minor: null, item_class: map.item_class, volumes: times(map.volumes, line.quantity),
      source_line_id: line.source_line_id ?? null,
    }
  })
}

/** The order must not exist already under another source (the natural key is checked per source first). */
async function assertNotIngested(tx: Tx, input: OrderInput): Promise<void> {
  const { rowCount } = await tx.query(
    'SELECT 1 FROM sales_order WHERE source_system = $1 AND source_order_id = $2', [input.source_system, input.source_order_id],
  )
  if (rowCount !== 0) throw new Refusal(409, 'ORDER_CONFLICT', 'This order was already ingested with a different body.')
}

/** The buyer's id; a buyer this order creates (P2) is audited PARTICIPANT.ENROLLED here, its TS caller (PLAN 4.2). */
async function buyerIdOf(tx: Tx, buyer: Buyer, input: OrderInput, marketId: string, at: string): Promise<string> {
  if (buyer.id !== null) return buyer.id
  const { rows } = await tx.query<{ id: string }>(
    'SELECT id FROM par_create_customer($1, $2, $3, $4)', [input.buyer.external_ref, marketId, buyer.type.type_id, at],
  )
  const id = rows[0]!.id
  // created_at defaults to now(), this transaction's start: a buyer a concurrent order created first is not ours to audit.
  // shortcut: two transactions starting in the same microsecond would both audit it, upgrade with a created flag from P2.
  const created = await tx.query('SELECT 1 FROM participant WHERE id = $1 AND created_at = now()', [id])
  if (created.rowCount !== 0) {
    await recordAudit(tx, {
      action: 'PARTICIPANT.ENROLLED', objectType: 'participant', objectId: id,
      after: { participant_id: id, type_id: buyer.type.type_id, market_id: marketId, enrolled_at: at, source: 'order' },
    })
  }
  return id
}

interface OrderFacts {
  readonly refs: AttemptRefs
  readonly input: OrderInput
  readonly marketId: string
  readonly buyerId: string
  readonly buyer: Buyer
  readonly purpose: Purpose
  readonly attribution: Attribution
  readonly creditedAt: string
  readonly lines: readonly PricedLine[]
  readonly currency: string
  /** Σ lines and the tax in the market currency. */
  readonly amountMinor: string
  readonly taxMinor: string
  readonly conversion: Conversion | null
}

async function insertOrder(tx: Tx, f: OrderFacts): Promise<void> {
  const converted = f.conversion !== null
  await tx.query(
    `INSERT INTO sales_order (id, tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose,
       purpose_missing, attributed_position_id, attribution_source, attribution_conflict, ordered_at, credited_at, period_id,
       amount_minor, tax_minor, currency, payload_hash, inbound_event_id, subscription_ref, original_currency, original_amount_minor,
       original_tax_minor, fx_rate_id)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, market_period_at($4, $13), $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23)`,
    [f.refs.targetId, f.input.source_system, f.input.source_order_id, f.marketId, f.buyerId, f.buyer.type.type_id,
      f.purpose.purpose, f.purpose.missing, f.attribution.positionId, f.attribution.source, f.attribution.conflict,
      f.input.ordered_at, f.creditedAt, f.amountMinor, f.taxMinor, f.currency, f.refs.hash, f.refs.inboundId, f.input.subscription_ref ?? null,
      converted ? f.input.currency : null, converted ? f.input.amount_minor : null, converted ? f.input.tax_minor : null, f.conversion?.rateId ?? null],
  )
  await tx.query(
    `INSERT INTO order_line (tenant_id, order_id, line_no, sku, item_class, quantity, amount_minor, original_amount_minor, volumes, source_line_id)
     SELECT app_tenant_id(), $1, l.line_no, l.sku, l.item_class, l.quantity, l.amount_minor::bigint, l.original_amount_minor::bigint, l.volumes,
            l.source_line_id
     FROM jsonb_to_recordset($2) AS l (line_no int, sku text, item_class text, quantity int, amount_minor text, original_amount_minor text,
                                       volumes jsonb, source_line_id text)`,
    [f.refs.targetId, JSON.stringify(f.lines)],
  )
}

/** D-V1A-04: each line and the tax converted once (rounded per amount); the order total is the sum of the converted lines. */
function converted(lines: readonly PricedLine[], conversion: Conversion | null, input: OrderInput) {
  if (conversion === null) return { lines, amountMinor: input.amount_minor, taxMinor: input.tax_minor }
  const convertedLines = lines.map((line) => ({
    ...line, amount_minor: convertMinor(BigInt(line.amount_minor), conversion).toString(), original_amount_minor: line.amount_minor,
  }))
  return {
    lines: convertedLines,
    amountMinor: convertedLines.reduce((total, line) => total + BigInt(line.amount_minor), 0n).toString(),
    taxMinor: convertMinor(BigInt(input.tax_minor), conversion).toString(),
  }
}

/** The facts of a valid order whose SKUs are all mapped, or held UNKNOWN_SKU (nothing written). */
async function orderFactsOf(tx: Tx, input: OrderInput, refs: AttemptRefs, toleranceSeconds: number): Promise<OrderFacts | Outcome> {
  const market = await liveMarket(tx, input.market)
  assertOrderFacts(input, toleranceSeconds)
  const conversion = input.currency === market.currency ? null : await conversionAt(tx, input.currency, market.currency, input.ordered_at)
  if (conversion !== null && 'held' in conversion) return { state: 'held', reason: conversion.held, ref: conversion.ref }
  const at = await creditedAt(tx, input)
  const precedence = await attributionPrecedence(tx)
  await assertNotIngested(tx, input)
  const buyer = await resolveBuyer(tx, input, at)
  const purpose = await purposeOf(tx, input, buyer.type)
  const priced = await priceLines(tx, market.id, input, at)
  if ('missing' in priced) return { state: 'held', reason: 'UNKNOWN_SKU', ref: priced.missing.join(','), skus: priced.missing }
  const buyerId = await buyerIdOf(tx, buyer, input, market.id, at)
  const attribution = await attribute(tx, buyerId, buyer.type, input.attribution, precedence, at)
  return {
    refs, input, marketId: market.id, buyerId, buyer, purpose, attribution, creditedAt: at, currency: market.currency, conversion,
    ...converted(priced, conversion, input),
  }
}

/**
 * FR-ORD-001/003: one order with its facts fixed at ingestion (buyer type, purpose, attribution, line volumes), first-order
 * servicing, late items for committed periods, audit and outbox order.ingested.
 */
export async function processOrder(tx: Tx, input: OrderInput, refs: AttemptRefs, toleranceSeconds: number): Promise<Outcome> {
  const facts = await orderFactsOf(tx, input, refs, toleranceSeconds)
  if ('state' in facts) return facts
  await insertOrder(tx, facts)
  await servicingFromFirstOrder(tx, facts.buyerId, facts.buyer.type, facts.attribution.positionId, facts.creditedAt)
  const volumes = sum(facts.lines.map((line) => line.volumes))
  const late = await recordLate(tx, { orderId: refs.targetId }, facts.marketId, facts.creditedAt, {
    volumes, amount_minor: facts.amountMinor, attributed_position_id: facts.attribution.positionId,
  })
  await recordAudit(tx, {
    action: 'ORDER.INGESTED', objectType: 'sales_order', objectId: refs.targetId,
    after: {
      inbound_event_id: refs.inboundId, market_id: facts.marketId, source_system: input.source_system, buyer_id: facts.buyerId,
      attributed_position_id: facts.attribution.positionId, attribution_source: facts.attribution.source,
      fx_rate_id: facts.conversion?.rateId ?? null, late_transaction_ids: late.map((item) => item.id),
    },
  })
  await enqueueOutbox(tx, {
    type: 'order.ingested', payload: { order_id: refs.targetId, market_id: facts.marketId, source_system: input.source_system }, key: refs.targetId,
  })
  const body = envelope({ order: await orderFacts(tx, refs.targetId), late: late.length > 0, late_transactions: late })
  return { state: 'processed', result: { order_id: refs.targetId }, body }
}
