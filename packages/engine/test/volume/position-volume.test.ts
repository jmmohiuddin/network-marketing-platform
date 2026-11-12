// Pass 2 (positionVolumePass), golden volumes (G-E2E-01, TS-10) and pointsFactor (BR-MNY-05, TS-23).
import { describe, expect, test } from 'vitest'
import { pointsFactor } from '../../src/primitives/volume.js'
import type { MeasureRule } from '../../src/types.js'
import { loadFixture, type RunFixture } from '../fixtures/load.js'
import { base, byPosition, inputWith, line, order, personal, volumesOf } from './context.js'

describe('golden volumes', () => {
  test('G-E2E-01: PV and GV per position; market total of net sales 1,250.00', () => {
    const { input, expected } = loadFixture<RunFixture>('g-e2e-01.json').cases[0]!
    const { ctx, volumes } = volumesOf(input)
    for (const p of expected.positions!) {
      for (const m of p.measures) expect(byPosition(ctx, volumes, m.measure)[p.positionId], `${p.positionId} ${m.measure}`).toBe(m.valueMinor)
    }
    expect(volumes.marketTotal.get('sales')).toBe(125000n)
    expect([...volumes.byMeasure.keys()]).toEqual(['pv', 'retail_base', 'sales', 'gv'])
  })

  test('TS-10: the refund of O2 (500.00) in the restated case takes A from PV/GV 800 to 300', () => {
    const cases = loadFixture<RunFixture>('ts10-refund.json').cases
    const gvOfA = (name: string) => {
      const { ctx, volumes } = volumesOf(cases.find((c) => c.name === name)!.input)
      return [byPosition(ctx, volumes, 'pv').A, byPosition(ctx, volumes, 'gv').A]
    }
    expect(gvOfA('paid')).toEqual([80000n, 80000n])
    expect(gvOfA('restated')).toEqual([30000n, 30000n])
  })
})

describe('positionVolumePass: per-position measures', () => {
  // G-E2E-01 PV: A 100, B 600, C 100, D 450 (sponsor tree A -> B, A -> C, B -> D)
  const pv = personal('pv')
  const measuresOf = (...more: MeasureRule[]) => volumesOf(inputWith({ measures: [pv, ...more] }))
  const values = (...more: MeasureRule[]) => {
    const { ctx, volumes } = measuresOf(...more)
    return byPosition(ctx, volumes, more[more.length - 1]!.key)
  }

  test('volume.group with and without self', () => {
    expect(values({ kind: 'volume.group', key: 'gv', of: 'pv', tree: 'sponsor', includeSelf: true })).toEqual({ A: 125000n, B: 105000n, C: 10000n, D: 45000n })
    expect(values({ kind: 'volume.group', key: 'dv', of: 'pv', tree: 'sponsor', includeSelf: false })).toEqual({ A: 115000n, B: 45000n, C: 0n, D: 0n })
    expect(values({ kind: 'volume.group', key: 'pg', of: 'pv', tree: 'placement', includeSelf: true })).toEqual({ A: 10000n, B: 60000n, C: 10000n, D: 45000n }) // no placement rows
  })

  test('volume.enrolled_group: self plus personally sponsored only (not deeper)', () => {
    expect(values({ kind: 'volume.enrolled_group', key: 'eg', of: 'pv', includeSelf: true })).toEqual({ A: 80000n, B: 105000n, C: 10000n, D: 45000n })
    expect(values({ kind: 'volume.enrolled_group', key: 'eg', of: 'pv', includeSelf: false })).toEqual({ A: 70000n, B: 45000n, C: 0n, D: 0n })
  })

  test('count.enrolled: personally sponsored positions reaching the threshold', () => {
    expect(values({ kind: 'count.enrolled', key: 'n', measure: 'pv', atLeastMinor: 45000n })).toEqual({ A: 1n, B: 1n, C: 0n, D: 0n })
  })

  test('count.customers: distinct end customers whose credited orders reach the minimum', () => {
    const measures = [personal('cust', { orders: 'customer' }), { kind: 'count.customers', key: 'n', measure: 'cust', minPerCustomerMinor: 10000n } as const]
    const k1 = { buyerParticipantId: 'K1', buyerTypeCode: 'customer', purpose: 'customer' } as const
    const orders = [
      order('o1', 'B', [line('1', { amountMinor: 6000n })], k1), order('o2', 'B', [line('1', { amountMinor: 4000n })], k1), // K1 at B: 100.00 over two orders
      order('o3', 'B', [line('1', { amountMinor: 9999n })], { ...k1, buyerParticipantId: 'K2' }), // below the minimum
      order('o4', 'D', [line('1')], k1),
      order('o5', 'C', [line('1')]), // not an end customer
    ]
    const { ctx, volumes } = volumesOf(inputWith({ measures, orders }))
    expect(byPosition(ctx, volumes, 'n')).toEqual({ A: 0n, B: 1n, C: 0n, D: 1n })
  })

  test('market total includes lines credited to the company', () => {
    const { volumes } = volumesOf(inputWith({ measures: [pv], orders: [order('o1', null, [line('1')]), order('o2', 'A', [line('1', { amountMinor: 5n })])] }))
    expect(volumes.marketTotal).toEqual(new Map([['pv', 10005n]]))
  })

  test('a measure defined before what it reads, a duplicate key, or count.customers on a derived measure fails', () => {
    const gv = { kind: 'volume.group', key: 'gv', of: 'pv', tree: 'sponsor', includeSelf: true } as const
    expect(() => volumesOf(inputWith({ measures: [gv, pv] }))).toThrow('not defined before it')
    expect(() => volumesOf(inputWith({ measures: [pv, pv] }))).toThrow('duplicate measure key')
    expect(() => measuresOf(gv, { kind: 'count.customers', key: 'n', measure: 'gv', minPerCustomerMinor: 1n })).toThrow('volume.personal')
  })
})

describe('pointsFactor (BR-MNY-05, TS-23)', () => {
  const plan = {
    ...base.plan,
    pointsToCurrency: [
      { marketId: 'MKT', effectiveFromUs: 200n, factor: '1.25' },
      { marketId: 'MKT', effectiveFromUs: 100n, factor: '1' },
      { marketId: 'OTHER', effectiveFromUs: 150n, factor: '9' },
    ],
  }

  test('each period uses the factor effective at its instant, for its market', () => {
    expect(pointsFactor(plan, 'MKT', 199n)).toBe(1_000000n)
    expect(pointsFactor(plan, 'MKT', 200n)).toBe(1_250000n)
    expect(pointsFactor(plan, 'OTHER', 999n)).toBe(9_000000n)
  })

  test('no shipped default: nothing effective fails; two factors on one date fail', () => {
    expect(() => pointsFactor(plan, 'MKT', 99n)).toThrow('no points-to-currency factor')
    expect(() => pointsFactor(plan, 'NONE', 999n)).toThrow('INVALID_INPUT')
    const dup = { ...plan, pointsToCurrency: [...plan.pointsToCurrency, { marketId: 'MKT', effectiveFromUs: 200n, factor: '2' }] }
    expect(() => pointsFactor(dup, 'MKT', 300n)).toThrow('share an effective date')
  })
})
