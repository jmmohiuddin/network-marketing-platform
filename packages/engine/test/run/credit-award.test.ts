// D-V1A-03 / AC-FIN6-2 (engine part, T-V1A-11): a pay rule with an award leaves cash settlement as creditAwards.
import { describe, expect, test } from 'vitest'
import { validateRule, renderRule } from '../../src/plan.js'
import { run } from '../../src/run.js'
import type { BonusRule, RunInput } from '../../src/types.js'
import { loadFixture, type RunFixture } from '../fixtures/load.js'

const base = loadFixture<RunFixture>('g-e2e-01.json').cases[0]!.input
const flat = (award?: BonusRule['award']): BonusRule => ({
  key: 'loyalty', kind: 'pay.flat', sourceKind: 'other', reversalPolicy: 'restatement', eligibleIf: null, amountMinor: 700n, ...(award === undefined ? {} : { award }),
})
const withBonus = (b: BonusRule): RunInput => ({ ...base, plan: { ...base.plan, bonuses: [...base.plan.bonuses, b] } })

describe('T-V1A-11 credit awards in the engine', () => {
  test('award lines leave lines, gross, settlement and totals; the cash part equals the run without the rule', () => {
    const plain = run(base)
    const cash = run(withBonus(flat()))
    const credits = run(withBonus(flat({ creditType: 'PRODUCT_CREDIT' })))
    const payees = cash.lines.filter((l) => l.ruleKey === 'loyalty').map((l) => l.payeePositionId)
    expect(payees.length).toBeGreaterThan(0)
    expect(credits.lines).toEqual(plain.lines)
    expect(credits.payees).toEqual(plain.payees)
    expect(credits.taxLines).toEqual(plain.taxLines)
    expect(credits.controlTotals).toEqual(plain.controlTotals)
    expect(credits.creditAwards.map((a) => [a.payeePositionId, a.ruleKey, a.creditType, a.amountMinor, a.currency])).toEqual(
      payees.map((p) => [p, 'loyalty', 'PRODUCT_CREDIT', 700n, base.snapshot.market.currency]))
    expect(credits.creditAwards.every((a) => a.trace.rule === 'loyalty')).toBe(true)
    // The awards are part of the result: the hash differs from the plain run, and is stable.
    expect(credits.resultHash).not.toBe(plain.resultHash)
    expect(run(withBonus(flat({ creditType: 'PRODUCT_CREDIT' }))).resultHash).toBe(credits.resultHash)
  })

  test('a plan without awards hashes as before (no award field written) and has no credit awards', () => {
    const out = run(withBonus(flat()))
    expect(out.creditAwards).toEqual([])
    expect(run(withBonus(flat({ creditType: 'PRODUCT_CREDIT' }))).inputsHash).not.toBe(out.inputsHash)
  })

  test('validation: award is optional on pay rules, needs a credit type code, and renders', () => {
    const params = { sourceKind: 'other', eligibleIf: null, amountMinor: '700' }
    expect(validateRule('pay.flat', params)).toEqual([])
    expect(validateRule('pay.flat', { ...params, award: { creditType: 'PRODUCT_CREDIT' } })).toEqual([])
    expect(validateRule('pay.flat', { ...params, award: { creditType: 'lower' } }).map((i) => i.path)).toEqual(['award.creditType'])
    expect(validateRule('pay.flat', { ...params, award: null }).map((i) => i.code)).toEqual(['FIELD_INVALID'])
    expect(validateRule('cap', { award: { creditType: 'X1' } }).some((i) => i.path === 'award' && i.code === 'FIELD_UNKNOWN')).toBe(true)
    const rule = { ruleKey: 'loyalty', kind: 'pay.flat', reversalPolicy: 'restatement' as const, calendarId: null, ordinal: 0 }
    expect(renderRule({ ...rule, params: { ...params, award: { creditType: 'PRODUCT_CREDIT' } } })).toMatch(/paid in credits PRODUCT_CREDIT, not in cash$/)
    expect(renderRule({ ...rule, params })).not.toMatch(/credits/)
  })
})
