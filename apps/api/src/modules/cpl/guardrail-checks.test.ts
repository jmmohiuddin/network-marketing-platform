// T-B3-29: platform guardrail predicate catalogue (D-B3-17, BR-GRD-01/03), incl. AC-CPL7-4 both cases and AC-CPL7-1.
import { describe, expect, test } from 'vitest'
import { evaluatePredicate, type GuardrailRuleRow } from './guardrail-checks.js'

const row = (rule_key: string, kind: string, params: Record<string, unknown>, depends_on: string[] = []): GuardrailRuleRow => ({ rule_key, kind, params, depends_on })
const pv = (exclude: string[] = ['starter_kit']) => row('pv', 'volume.personal', { unit: 'currency', source: { from: 'volume', name: 'pv' }, items: { excludeItemClasses: exclude, categories: null }, orders: 'all' })
const bonus = (rule_key: string, measure: string, depends_on: string[]) => row(rule_key, 'pay.percent_of_measure', { sourceKind: 'enrolment_order', eligibleIf: null, measure, byRank: { ladder: 'main', rates: [] } }, depends_on)
const ENROLMENT = { check: 'enrolment_only_pay' }

describe('enrolment_only_pay (TS-27, AC-CPL7-4)', () => {
  test('count.enrolled with atLeastMinor 0 feeding a bonus matches, with its dependency closure', () => {
    const rules = [pv(), row('enrolled', 'count.enrolled', { measure: 'pv', atLeastMinor: '0' }, ['pv']), bonus('signup', 'enrolled', ['enrolled'])]
    expect(evaluatePredicate(ENROLMENT, rules)).toEqual([{ ruleKeys: ['enrolled', 'pv', 'signup'], opaque: false, explanation: expect.stringContaining('signup') }])
  })

  test('count.enrolled with a positive pv threshold is triggered by purchases: no match', () => {
    const rules = [pv(), row('enrolled', 'count.enrolled', { measure: 'pv', atLeastMinor: '10000' }, ['pv']), bonus('signup', 'enrolled', ['enrolled'])]
    expect(evaluatePredicate(ENROLMENT, rules)).toEqual([])
  })

  test('a group sum of an enrolment-only count matches; a flat bonus on an enrolment-only rank matches', () => {
    const rules = [
      pv(), row('enrolled', 'count.enrolled', { measure: 'pv', atLeastMinor: '0' }, ['pv']),
      row('team_enrolled', 'volume.group', { of: 'enrolled', tree: 'sponsor', includeSelf: true }, ['enrolled']),
      bonus('team', 'team_enrolled', ['team_enrolled']),
      row('main', 'ladder', { ranks: [{ key: 'R1', requires: [{ kind: 'measure', measure: 'enrolled', atLeastMinor: '3', window: { type: 'period' }, maxPerLegShare: null }], maintenance: null }] }, ['enrolled']),
      row('recruiter', 'pay.flat', { sourceKind: 'other', eligibleIf: { ladder: 'main', rank: 'R1' }, amountMinor: '1000' }, ['main']),
    ]
    expect(evaluatePredicate(ENROLMENT, rules).map((m) => (m.ruleKeys.includes('recruiter') ? 'recruiter' : m.ruleKeys.includes('team') ? 'team' : null))).toEqual(['recruiter', 'team'])
  })

  test('AC-CPL7-1: a derived measure feeding a bonus is opaque', () => {
    const rules = [pv(), row('capped', 'measure.derived', { expr: { op: 'min', args: [{ measure: 'pv' }, { const: '50000' }] } }, ['pv']), bonus('derived_pay', 'capped', ['capped'])]
    expect(evaluatePredicate(ENROLMENT, rules)).toEqual([expect.objectContaining({ ruleKeys: ['capped', 'derived_pay', 'pv'], opaque: true })])
  })

  test('BR-GRD-01: a derived measure that only wraps an enrolment-only count is not opaque', () => {
    const enrolled = row('enrolled', 'count.enrolled', { measure: 'pv', atLeastMinor: '0' }, ['pv'])
    const wrap = row('wrap', 'measure.derived', { expr: { op: 'add', args: [{ measure: 'enrolled' }, { const: '0' }] } }, ['enrolled'])
    expect(evaluatePredicate(ENROLMENT, [pv(), enrolled, wrap, bonus('wrapped', 'wrap', ['wrap'])])).toEqual([expect.objectContaining({ ruleKeys: ['enrolled', 'pv', 'wrap', 'wrapped'], opaque: false })])
    const mixed = row('wrap', 'measure.derived', { expr: { op: 'add', args: [{ measure: 'enrolled' }, { measure: 'pv' }] } }, ['enrolled', 'pv'])
    expect(evaluatePredicate(ENROLMENT, [pv(), enrolled, mixed, bonus('wrapped', 'wrap', ['wrap'])])).toEqual([expect.objectContaining({ opaque: true })])
  })

  test('ladders that require each other\'s ranks (an invalid plan) end the walk instead of overflowing the stack', () => {
    const a = row('a', 'ladder', { ranks: [{ key: 'A1', requires: [{ kind: 'rank', rank: { ladder: 'b', rank: 'B1' } }], maintenance: null }] }, ['b'])
    const b = row('b', 'ladder', { ranks: [{ key: 'B1', requires: [{ kind: 'rank', rank: { ladder: 'a', rank: 'A1' } }], maintenance: null }] }, ['a'])
    const flat = row('flat', 'pay.flat', { sourceKind: 'other', eligibleIf: { ladder: 'a', rank: 'A1' }, amountMinor: '1000' }, ['a'])
    expect(evaluatePredicate(ENROLMENT, [pv(), a, b, flat])).toEqual([])
  })
})

describe('starter_kit_volume (TS-26) and unknown checks', () => {
  test('a personal measure that does not exclude starter kits matches', () => {
    expect(evaluatePredicate({ check: 'starter_kit_volume' }, [pv([])])).toEqual([{ ruleKeys: ['pv'], opaque: false, explanation: expect.stringContaining('starter_kit') }])
    expect(evaluatePredicate({ check: 'starter_kit_volume' }, [pv()])).toEqual([])
  })

  test('an unknown check, or no check, is opaque and needs compliance review', () => {
    expect(evaluatePredicate({ check: 'fees' }, [pv()])).toEqual([{ ruleKeys: [], opaque: true, explanation: expect.any(String) }])
    expect(evaluatePredicate({}, [])).toHaveLength(1)
  })
})
