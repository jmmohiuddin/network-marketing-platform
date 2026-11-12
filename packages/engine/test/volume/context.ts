// Test helper: RunContext the way run.ts builds it (tree at period end - 1 µs), plus input builders over the
// G-E2E-01 fixture so each test states only what it changes.
import { lineVolumePass, positionVolumePass } from '../../src/primitives/volume.js'
import type { LineVolumes, PositionVolumes, RunContext } from '../../src/pipeline.js'
import { buildTree, evaluationInstant, positionOrder } from '../../src/tree.js'
import type { MeasureRule, Order, OrderEvent, OrderLine, PlanVersion, RunInput, RunSettings } from '../../src/types.js'
import { loadFixture, type RunFixture } from '../fixtures/load.js'

export function contextOf(input: RunInput): RunContext {
  const s = input.snapshot
  const ids = positionOrder(s.positions.map((p) => p.positionId))
  const evaluation = { validAtUs: evaluationInstant(s.period), knownAtUs: s.knownAtUs }
  const byId = new Map(s.positions.map((p) => [p.positionId, p]))
  const positions = ids.map((id) => byId.get(id)!)
  return {
    input,
    options: { fullTraceFor: [] },
    evaluation,
    trees: { sponsor: buildTree(ids, s.relationships, 'sponsor', evaluation), placement: buildTree(ids, s.relationships, 'placement', evaluation) },
    positions,
    ownerOf: positions.map((p) => p.ownerParticipantId),
    participants: new Map(s.participants.map((p) => [p.participantId, p])),
    participantTypes: new Map(s.participantTypes.map((t) => [t.code, t])),
    earner: new Uint8Array(ids.length).fill(1),
  }
}

export function volumesOf(input: RunInput): { ctx: RunContext; lineVolumes: LineVolumes; volumes: PositionVolumes } {
  const ctx = contextOf(input)
  const lineVolumes = lineVolumePass(ctx, { transition: { prior: [], report: [] } })
  const volumes = positionVolumePass(ctx, { transition: { prior: [], report: [] }, lineVolumes })
  return { ctx, lineVolumes, volumes }
}

/** Position id -> value of `measure`. */
export function byPosition(ctx: RunContext, volumes: PositionVolumes, measure: string): Record<string, bigint> {
  const values = volumes.byMeasure.get(measure)!
  return Object.fromEntries(ctx.trees.sponsor.ids.map((id, k) => [id, values[k]!]))
}

/** Tree A -> B, A -> C, B -> D; customers K1, K2 (G-E2E-01). */
export const base: RunInput = loadFixture<RunFixture>('g-e2e-01.json').cases[0]!.input

export function personal(key: string, over: Partial<Extract<MeasureRule, { kind: 'volume.personal' }>> = {}): MeasureRule {
  return { kind: 'volume.personal', key, unit: 'currency', source: { from: 'amount' }, items: { excludeItemClasses: [], categories: null }, orders: 'all', ...over }
}

export function line(lineId: string, over: Partial<OrderLine> = {}): OrderLine {
  return { lineId, productId: 'SKU', itemClass: 'product', category: 'general', quantity: 1, amountMinor: 10000n, taxMinor: 0n, volumes: [], ...over }
}

export function order(orderId: string, creditPositionId: string | null, lines: readonly OrderLine[], over: Partial<Order> = {}): Order {
  return { orderId, buyerParticipantId: 'pA', buyerTypeCode: 'distributor', purpose: 'personal', creditPositionId, creditedAtUs: base.snapshot.period.startsAtUs, lines, ...over }
}

export function event(eventId: string, orderId: string, lineId: string, type: OrderEvent['type'], quantity: number, over: Partial<OrderEvent> = {}): OrderEvent {
  return { eventId, orderId, lineId, type, quantity, refundMinor: 0n, restockingFeeMinor: 0n, atUs: base.snapshot.period.startsAtUs + 1n, ...over }
}

export function inputWith(over: { measures?: readonly MeasureRule[]; orders?: readonly Order[]; events?: readonly OrderEvent[]; plan?: Partial<PlanVersion>; settings?: Partial<RunSettings> }): RunInput {
  return {
    plan: { ...base.plan, ...(over.measures ? { measures: over.measures } : {}), ...over.plan },
    settings: { ...base.settings, ...over.settings },
    snapshot: { ...base.snapshot, ...(over.orders ? { orders: over.orders } : {}), orderEvents: over.events ?? [] },
  }
}
