// Plan documents as rule rows (PLAN B3 D-B3-02): T-B3-05 per-kind parameter validation, T-B3-06 dependency / cycle /
// scope / cap validation, T-B3-07 rendering per kind, TS-01/07/08 entered as rule rows (AC-44.1, AC-11.1/11.2).
import { describe, expect, test } from 'vitest'
import { toRaw } from '../src/money.js'
import { compilePlan, renderRule, RULE_KINDS, ruleDependencies, rulePass, validatePlan, validateRule, type PlanRuleInput } from '../src/plan.js'
import { allocateCap, capAmountMinor } from '../src/primitives/caps.js'
import { run } from '../src/run.js'
import type { CapRule } from '../src/types.js'
import { loadFixture, type RunFixture } from './fixtures/load.js'

const R1 = { ladder: 'main', rank: 'R1' }
const R2 = { ladder: 'main', rank: 'R2' }
const row = (ruleKey: string, kind: string, params: unknown, extra: Partial<PlanRuleInput> = {}): PlanRuleInput => ({
  ruleKey, kind, params, reversalPolicy: kind.startsWith('pay.') ? 'restatement' : null, calendarId: null, ordinal: 0, ...extra,
})
const personal = (name: string, orders: string, from: unknown = { from: 'volume', name }) => ({ unit: 'currency', source: from, items: { excludeItemClasses: [], categories: null }, orders })
const bonus = (sourceKind: string, fields: object, eligibleIf: unknown = null) => ({ sourceKind, eligibleIf, ...fields })

/** One valid row of every kind (a plan the engine runs on the TS-01 snapshot). */
const SAMPLE: readonly PlanRuleInput[] = [
  row('cv', 'volume.personal', personal('cv', 'all')),
  row('retail_base', 'volume.personal', personal('cv', 'customer', { from: 'amount' })),
  row('gv', 'volume.group', { of: 'cv', tree: 'sponsor', includeSelf: true }),
  row('egv', 'volume.enrolled_group', { of: 'cv', includeSelf: false }),
  row('customers', 'count.customers', { measure: 'retail_base', minPerCustomerMinor: '1000' }),
  row('enrolled', 'count.enrolled', { measure: 'cv', atLeastMinor: '0' }),
  row('capped', 'measure.derived', { expr: { op: 'min', args: [{ measure: 'cv' }, { const: '50000' }] } }),
  row('main', 'ladder', { ranks: [
    { key: 'R1', requires: [{ kind: 'measure', measure: 'cv', atLeastMinor: '10000', window: { type: 'period' }, maxPerLegShare: null }], maintenance: null },
    { key: 'R2', requires: [{ kind: 'legs', tree: 'sponsor', count: 1, rank: R1 }, { kind: 'expression', expr: { op: 'gte', args: [{ measure: 'capped' }, { const: '10000' }] } }], maintenance: { gracePeriods: 1 } },
  ] }),
  row('lead', 'ladder', { ranks: [{ key: 'L1', requires: [{ kind: 'rank', rank: R2 }], maintenance: null }] }),
  row('retail', 'pay.retail_margin', bonus('retail_sale', { rate: '0.25', measure: 'retail_base' }), { reversalPolicy: 'order_line' }),
  row('unilevel', 'pay.percent_by_level', bonus('downline_volume', { tree: 'sponsor', measure: 'cv', levels: ['0.08', '0.05'], compression: 'dynamic' }, R1), { reversalPolicy: 'order_line' }),
  row('gens', 'pay.generations', bonus('downline_volume', { tree: 'sponsor', measure: 'cv', leader: R2, rates: ['0.02'] })),
  row('rank_bonus', 'pay.percent_of_measure', bonus('other', { measure: 'cv', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.01' }] } })),
  row('diff', 'pay.differential', bonus('downline_volume', { tree: 'sponsor', measure: 'cv', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.01' }, { rank: 'R2', rate: '0.02' }] } })),
  row('over', 'pay.override', bonus('downline_volume', { tree: 'placement', measure: 'cv', rate: '0.01', levels: 3 }), { reversalPolicy: 'order_line' }),
  row('match', 'pay.matching', bonus('match', { tree: 'sponsor', of: ['unilevel'], rates: ['0.1'] })),
  row('fast', 'pay.fast_start', bonus('enrolment_order', { tree: 'sponsor', measure: 'cv', buyerEnrolledWithinUs: '2592000000000', tiers: [{ rate: '0.2', perOrderCapMinor: '5000' }] }), { reversalPolicy: 'order_line' }),
  row('flat', 'pay.flat', bonus('other', { amountMinor: '1000' }, R2)),
  row('once', 'pay.one_time', bonus('other', { amountMinor: '5000', onceKey: 'welcome' }, R2)),
  row('pool', 'pay.pool', bonus('pool', { baseMeasure: 'cv', rate: '0.01', allocation: { type: 'shares', ladder: 'main', shares: [{ rank: 'R2', shares: 1 }] } })),
  row('per_period', 'limit.max_per_period', { scope: ['unilevel'], maxMinor: '1000000' }),
  row('personal_share', 'limit.max_share_from_purpose', { scope: ['unilevel'], purpose: 'personal', maxShare: '0.5' }),
  row('cap', 'cap', { scope: ['unilevel', 'match'], base: { kind: 'measure', measure: 'cv' }, rate: '0.4', method: { type: 'priority', reduce: ['match', 'unilevel'] }, residue: 'breakage' }),
  row('carry_cv', 'carry', { measure: 'cv', capMinor: null, keepIf: R1, expiresAfterPeriods: 3 }),
  row('streak', 'counter', { incrementIf: R1 }),
  row('points', 'points_factor', { marketId: 'MKT', effectiveFromUs: '0', factor: '1' }),
  row('roll_up', 'customer_roll_up', { measures: ['retail_base'], shares: [{ level: 0, share: '0.5' }, { level: 1, share: '0.5' }] }),
  row('reparent', 'genealogy.reparent_on_termination', { tree: 'sponsor' }),
  row('window', 'genealogy.change_window', { tree: 'sponsor', withinDaysOfEnrolment: 30 }),
  row('positions', 'genealogy.positions_limit', { max: 3 }),
]
const CALENDARS = { calendarIds: ['cal-1', 'cal-2'] }
const codes = (rules: readonly PlanRuleInput[]): string[] => validatePlan(rules, CALENDARS).errors.map((e) => `${e.ruleKey}:${e.code}`)
const replace = (key: string, next: PlanRuleInput): PlanRuleInput[] => SAMPLE.map((r) => (r.ruleKey === key ? next : r))

describe('T-B3-05 per-kind parameter validation', () => {
  test('the sample has one valid row of every kind', () => {
    expect([...new Set(SAMPLE.map((r) => r.kind))].sort()).toEqual([...RULE_KINDS].sort())
    for (const r of SAMPLE) expect(validateRule(r.kind, r.params), r.ruleKey).toEqual([])
  })

  test.each(RULE_KINDS)('%s: every parameter is required', (kind) => {
    const issues = validateRule(kind, {})
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((i) => i.code === 'FIELD_REQUIRED')).toBe(true)
  })

  test('unknown fields, wrong types, unknown kinds', () => {
    expect(validateRule('pay.flat', { sourceKind: 'other', eligibleIf: null, amountMinor: 1000 })).toEqual([{ path: 'amountMinor', code: 'FIELD_INVALID', message: expect.any(String) }])
    expect(validateRule('genealogy.positions_limit', { max: 3, extra: true })).toEqual([{ path: 'extra', code: 'FIELD_UNKNOWN', message: expect.any(String) }])
    expect(validateRule('pay.wallet', {})).toEqual([{ path: 'kind', code: 'UNKNOWN_KIND', message: expect.any(String) }])
    expect(validateRule('pay.percent_by_level', bonus('downline_volume', { tree: 'up', measure: 'cv', levels: [], compression: 'none' })).map((i) => i.path)).toEqual(['tree', 'levels'])
  })

  test('profile requirements and product categories are refused (D-B3-18)', () => {
    const ladder = { ranks: [{ key: 'R1', requires: [{ kind: 'profile', fact: 'region', equals: 'north' }], maintenance: null }] }
    expect(validateRule('ladder', ladder).map((i) => i.code)).toEqual(['PROFILE_FACTS_UNAVAILABLE'])
    const pv = { ...personal('pv', 'all'), items: { excludeItemClasses: [], categories: ['food'] } }
    expect(validateRule('volume.personal', pv).map((i) => [i.path, i.code])).toEqual([['items.categories', 'CATEGORIES_UNAVAILABLE']])
  })

  test('expressions are checked inside their rule (AC-PLN3-1)', () => {
    const bad = { expr: { op: 'add', args: [{ measure: 'cv' }, { op: 'gt', args: [{ measure: 'cv' }, { const: '1' }] }] } }
    expect(validateRule('measure.derived', bad).map((i) => [i.path, i.code])).toEqual([['expr.args[1]', 'EXPRESSION_TYPE']])
  })

  test('rule passes', () => {
    expect(['volume.personal', 'measure.derived', 'ladder', 'pay.flat', 'pay.matching', 'pay.pool', 'limit.max_per_period', 'cap', 'points_factor', 'genealogy.change_window'].map((k) => rulePass(k as never)))
      .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '10', 'structure'])
  })
})

describe('T-B3-06 whole-plan validation', () => {
  test('the sample plan is valid and its dependencies are the rule keys it names', () => {
    expect(validatePlan(SAMPLE, CALENDARS)).toEqual({ ok: true, errors: [] })
    expect(ruleDependencies(SAMPLE.find((r) => r.ruleKey === 'cap')!)).toEqual(['cv', 'match', 'unilevel'])
    expect(ruleDependencies(SAMPLE.find((r) => r.ruleKey === 'main')!)).toEqual(['capped', 'cv'])
  })

  test('AC-PLN2-1: unknown measure, rank and bonus references', () => {
    const rules = replace('unilevel', row('unilevel', 'pay.percent_by_level', bonus('downline_volume', { tree: 'sponsor', measure: 'nope', levels: ['0.08'], compression: 'none' }, { ladder: 'main', rank: 'R9' }), { reversalPolicy: 'order_line' }))
    expect(codes(rules)).toEqual(['unilevel:UNKNOWN_REFERENCE', 'unilevel:UNKNOWN_REFERENCE'])
    expect(codes([...SAMPLE, row('m2', 'pay.matching', bonus('match', { tree: 'sponsor', of: ['ghost'], rates: ['0.1'] }))])).toEqual(['m2:UNKNOWN_REFERENCE'])
  })

  test('AC-PLN2-1: a cycle among derived measures', () => {
    const a = row('a', 'measure.derived', { expr: { op: 'add', args: [{ measure: 'b' }, { const: '1' }] } })
    const b = row('b', 'measure.derived', { expr: { op: 'add', args: [{ measure: 'a' }, { const: '1' }] } })
    expect(codes([...SAMPLE, a, b])).toEqual(['a:CYCLIC_DEPENDENCY', 'b:CYCLIC_DEPENDENCY'])
  })

  test('a prior-period state read is not a cycle (E-ADR-42)', () => {
    const k = row('k', 'carry', { measure: 'self_read', capMinor: null, keepIf: null, expiresAfterPeriods: null })
    const read = row('self_read', 'measure.derived', { expr: { op: 'add', args: [{ state: 'carry.k' }, { measure: 'cv' }] } })
    expect(codes([...SAMPLE, k, read])).toEqual([])
    expect(codes([...SAMPLE, read])).toEqual(['self_read:UNKNOWN_REFERENCE'])
  })

  test('AC-PLN2-3: calendar scope closure', () => {
    const scoped = replace('capped', { ...SAMPLE.find((r) => r.ruleKey === 'capped')!, calendarId: 'cal-1' })
    expect(codes(scoped)).toEqual(['main:CALENDAR_SCOPE_CONFLICT']) // the unscoped ladder reads a cal-1 measure
    const both = scoped.map((r) => (r.ruleKey === 'main' || r.ruleKey === 'lead' ? { ...r, calendarId: 'cal-1' } : r))
    expect(codes(both).filter((c) => c.startsWith('main:') || c.startsWith('lead:'))).toEqual([])
    const other = both.map((r) => (r.ruleKey === 'lead' ? { ...r, calendarId: 'cal-2' } : r))
    expect(codes(other)).toContain('lead:CALENDAR_SCOPE_CONFLICT')
    expect(codes(replace('cv', { ...SAMPLE[0]!, calendarId: 'cal-9' }))).toContain('cv:UNKNOWN_CALENDAR')
  })

  test('AC-PLN4-1: priority list, cap precedence and cap scope', () => {
    const cap = SAMPLE.find((r) => r.ruleKey === 'cap')!
    const params = cap.params as Record<string, unknown>
    expect(codes(replace('cap', { ...cap, params: { ...params, method: { type: 'priority', reduce: ['match'] } } }))).toEqual(['cap:PRIORITY_INCOMPLETE'])
    expect(codes(replace('cap', { ...cap, params: { ...params, scope: ['unilevel', 'ghost'], method: { type: 'proportional' } } }))).toEqual(['cap:UNKNOWN_REFERENCE'])
    const second = row('cap_two', 'cap', { ...params, scope: ['match'], method: { type: 'proportional' } })
    expect(codes([...SAMPLE, second])).toEqual(['cap_two:CAP_PRECEDENCE_MISSING'])
    expect(codes([...SAMPLE, { ...second, ordinal: 1 }])).toEqual([])
  })

  test('every bonus names its reversal policy; order_line pays on order-line measures', () => {
    expect(codes(replace('flat', { ...SAMPLE.find((r) => r.ruleKey === 'flat')!, reversalPolicy: null }))).toEqual(['flat:REVERSAL_POLICY_MISSING'])
    expect(codes(replace('cv', { ...SAMPLE[0]!, reversalPolicy: 'order_line' }))).toEqual(['cv:REVERSAL_POLICY_NOT_APPLICABLE'])
    const enrolledPay = row('signup', 'pay.percent_of_measure', bonus('enrolment_order', { measure: 'enrolled', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.1' }] } }), { reversalPolicy: 'order_line' })
    expect(codes([...SAMPLE, enrolledPay])).toEqual(['signup:MEASURE_NOT_PAYABLE', 'signup:ORDER_LINE_MEASURE_INVALID'])
  })

  test('FR-PLN-002: plan shapes the engine refuses at run time are refused on save', () => {
    const ladder = row('ranked', 'ladder', { ranks: [{ key: 'X', requires: [], maintenance: null }, { key: 'X', requires: [], maintenance: null }] })
    expect(validateRule(ladder.kind, ladder.params).map((i) => [i.path, i.code])).toEqual([['ranks[1].key', 'RANK_REPEATED']])
    const pool = SAMPLE.find((r) => r.ruleKey === 'pool')!
    const parts = { ...(pool.params as object), allocation: { type: 'rank_order', ladder: 'main', parts: [{ rank: 'R2', share: '0.9' }, { rank: 'R2', share: '0.9' }] } }
    expect(validateRule(pool.kind, parts).map((i) => [i.path, i.code])).toEqual([['allocation.parts[1].rank', 'RANK_REPEATED'], ['allocation.parts', 'SHARES_EXCEED_ONE']])
    const diff = SAMPLE.find((r) => r.ruleKey === 'diff')!
    const byRank = { ...(diff.params as object), byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.01' }, { rank: 'R1', rate: '0.02' }] } }
    expect(validateRule(diff.kind, byRank).map((i) => i.code)).toEqual(['RANK_REPEATED'])
    expect(validateRule('customer_roll_up', { measures: ['retail_base'], shares: [{ level: 0, share: '0.5' }, { level: 0, share: '0.4' }] }).map((i) => i.code)).toEqual(['LEVEL_REPEATED', 'SHARES_NOT_ONE'])
    const cap = SAMPLE.find((r) => r.ruleKey === 'cap')!
    const perPerson = { ...(cap.params as object), base: { kind: 'order_structure', first: 'cv', second: 'cv', secondShareAbove: { num: 1, den: 2 }, firstMultiplier: '1' }, method: { type: 'per_person' } }
    expect(validateRule('cap', perPerson).map((i) => i.code)).toEqual(['CAP_BASE_INVALID'])
    const legWindow = { ranks: [{ key: 'X', requires: [{ kind: 'measure', measure: 'gv', atLeastMinor: '1', window: { type: 'rolling', periods: 2 }, maxPerLegShare: '0.5' }], maintenance: null }] }
    expect(validateRule('ladder', legWindow).map((i) => i.code)).toEqual(['LEG_RULE_INVALID'])

    const bad = [
      row('signup', 'pay.percent_of_measure', bonus('enrolment_order', { measure: 'enrolled', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.1' }] } })),
      row('match_pool', 'pay.matching', bonus('match', { tree: 'sponsor', of: ['pool'], rates: ['0.1'] })),
      row('per_order', 'ladder', { ranks: [{ key: 'X', requires: [{ kind: 'measure', measure: 'gv', atLeastMinor: '1', window: { type: 'per_order' }, maxPerLegShare: null }], maintenance: null }] }),
      row('legs_on_cv', 'ladder', { ranks: [{ key: 'X', requires: [{ kind: 'measure', measure: 'cv', atLeastMinor: '1', window: { type: 'period' }, maxPerLegShare: '0.5' }], maintenance: null }] }),
      row('two_trees', 'ladder', { ranks: [
        { key: 'X', requires: [], maintenance: null },
        { key: 'Y', requires: [{ kind: 'legs', tree: 'sponsor', count: 1, rank: { ladder: 'two_trees', rank: 'X' } }, { kind: 'legs', tree: 'placement', count: 1, rank: { ladder: 'two_trees', rank: 'X' } }], maintenance: null },
      ] }),
      row('points_twin', 'points_factor', { marketId: 'MKT', effectiveFromUs: '0', factor: '2' }),
    ]
    expect(codes([...SAMPLE, ...bad])).toEqual([
      'legs_on_cv:LEG_RULE_INVALID', 'match_pool:MATCHING_NOT_INDIVIDUAL', 'per_order:MEASURE_NOT_PERSONAL', 'points_twin:POINTS_FACTOR_DUPLICATE', 'signup:MEASURE_NOT_PAYABLE', 'two_trees:LEG_RULE_INVALID',
    ])
    const scoped = replace('points', { ...SAMPLE.find((r) => r.ruleKey === 'points')!, calendarId: 'cal-1' })
    expect(codes([...scoped, { ...bad[5]!, calendarId: 'cal-2' }])).toEqual([]) // never in one compiled calendar
  })

  test('a derived measure is payable in the one unit of the volume measures it reads', () => {
    const pointsPv = row('pts', 'volume.personal', { ...personal('pts', 'all'), unit: 'points' })
    const mixed = row('mixed', 'measure.derived', { expr: { op: 'add', args: [{ measure: 'cv' }, { measure: 'pts' }] } })
    const pay = (measure: string) => row(`pay_${measure}`, 'pay.retail_margin', bonus('other', { rate: '0.1', measure }))
    expect(codes([...SAMPLE, pointsPv, mixed, pay('mixed'), pay('capped')])).toEqual(['pay_mixed:MEASURE_NOT_PAYABLE'])
    const counts = row('per_head', 'measure.derived', { expr: { op: 'mul', args: [{ measure: 'enrolled' }, { const: '2' }] } })
    expect(codes([...SAMPLE, counts, pay('per_head')])).toEqual(['pay_per_head:MEASURE_NOT_PAYABLE'])
  })

  test('a tree-walking bonus, a pool and a cap read volume.personal measures', () => {
    const gens = SAMPLE.find((r) => r.ruleKey === 'gens')!
    expect(codes(replace('gens', { ...gens, params: { ...(gens.params as object), measure: 'gv' } }))).toEqual(['gens:MEASURE_NOT_PERSONAL'])
  })

  test('structural rules: one per kind, never calendar-scoped', () => {
    expect(codes([...SAMPLE, row('reparent_two', 'genealogy.reparent_on_termination', { tree: 'placement' })])).toEqual(['reparent_two:DUPLICATE_RULE_KIND'])
    expect(codes(replace('window', { ...SAMPLE.find((r) => r.ruleKey === 'window')!, calendarId: 'cal-1' }))).toEqual(['window:STRUCTURAL_RULE_SCOPED'])
  })
})

describe('compilation', () => {
  test('one PlanVersion per calendar that the engine runs; structural rules are left out', () => {
    const scoped = SAMPLE.map((r) => (r.ruleKey === 'flat' ? { ...r, calendarId: 'cal-2' } : r))
    const compiled = compilePlan(scoped, [{ stateItem: 'title.*', rule: 'carry', map: [], reason: null }], { planVersionId: 'v1', version: 1 }, ['cal-1', 'cal-2'])
    expect(Object.keys(compiled)).toEqual(['cal-1', 'cal-2'])
    const one = compiled['cal-1']!
    expect(one.bonuses.map((b) => b.key)).not.toContain('flat')
    expect(compiled['cal-2']!.bonuses.map((b) => b.key)).toContain('flat')
    expect(one.measures.map((m) => m.key)).toEqual(['cv', 'capped', 'egv', 'enrolled', 'gv', 'retail_base', 'customers'])
    expect(one.ladders.map((l) => l.key)).toEqual(['main', 'lead'])
    expect([one.contentHash, one.effectiveFromUs, one.calendars]).toEqual(['', 0n, ['cal-1']])
    const input = loadFixture<RunFixture>('ts01-unilevel.json').cases[0]!.input
    const out = run({ ...input, plan: { ...one, contentHash: 'h', effectiveFromUs: input.snapshot.period.startsAtUs } })
    expect(out.lines.length).toBeGreaterThan(0)
  })

  test('FR-PLN-003 / AC-CPL7-1: a bonus pays on a measure.derived rule (restatement)', () => {
    const input = loadFixture<RunFixture>('ts01-unilevel.json').cases[0]!.input
    const rows = [
      row('cv', 'volume.personal', personal('cv', 'all')),
      row('capped', 'measure.derived', { expr: { op: 'min', args: [{ measure: 'cv' }, { const: '300000' }] } }),
      row('capped_pay', 'pay.retail_margin', bonus('other', { rate: '0.1', measure: 'capped' })),
      row('personal_share', 'limit.max_share_from_purpose', { scope: ['capped_pay'], purpose: 'personal', maxShare: '1' }),
    ]
    expect(validatePlan(rows, { calendarIds: ['c'] })).toEqual({ ok: true, errors: [] })
    const plan = compilePlan(rows, [], { planVersionId: input.plan.planVersionId, version: 1 }, ['c'])['c']!
    const out = run({ ...input, plan: { ...plan, contentHash: 'h', effectiveFromUs: input.snapshot.period.startsAtUs } })
    const paid = Object.fromEntries(out.lines.filter((l) => l.ruleKey === 'capped_pay').map((l) => [l.payeePositionId, l.amountMinor]))
    expect(paid).toEqual({ L1: 10000n, L2: 25000n, L3: 30000n, L4: 30000n, L5: 30000n })
  })

  test('an invalid plan does not compile', () => {
    expect(() => compilePlan([row('x', 'volume.group', { of: 'nope', tree: 'sponsor', includeSelf: true })], [], { planVersionId: 'v', version: 1 }, ['c'])).toThrow('the plan is not valid')
  })

  test('TS-01 (AC-44.1) entered as rule rows reproduces the fixture plan and 925.00', () => {
    const [c] = loadFixture<RunFixture>('ts01-unilevel.json').cases
    const rows = [
      row('cv', 'volume.personal', personal('cv', 'all')),
      row('unilevel', 'pay.percent_by_level', bonus('downline_volume', { tree: 'sponsor', measure: 'cv', levels: ['0.08', '0.05', '0.04', '0.04', '0.04'], compression: 'none' }), { reversalPolicy: 'order_line' }),
    ]
    const plan = compilePlan(rows, [], { planVersionId: c!.input.plan.planVersionId, version: 1 }, ['monthly'])['monthly']!
    const filled = { ...plan, contentHash: c!.input.plan.contentHash, effectiveFromUs: c!.input.plan.effectiveFromUs }
    expect(filled).toEqual(c!.input.plan)
    const out = run({ ...c!.input, plan: filled })
    expect(out.lines.find((l) => l.payeePositionId === 'P0')!.amountMinor).toBe(92500n)
  })

  describe('TS-07 / TS-08 caps entered as rule rows (AC-11.1, AC-11.2)', () => {
    interface Line { readonly payeePositionId: string; readonly ruleKey: string; readonly amountMinor: bigint }
    interface CapCase { readonly name: string; readonly lines: readonly Line[]; readonly baseMinor: bigint; readonly rate: string; readonly expected: { readonly capMinor: bigint; readonly lines: readonly Line[] } }
    const { cases } = loadFixture<{ cases: CapCase[] }>('caps.json')
    const compiledCap = (c: CapCase, method: unknown): CapRule => {
      const scope = [...new Set(c.lines.map((l) => l.ruleKey))]
      const rows = [
        row('sales', 'volume.personal', personal('sales', 'all', { from: 'amount' })),
        ...scope.map((k) => row(k, 'pay.flat', bonus('other', { amountMinor: '1' }))),
        row('company_cap', 'cap', { scope, base: { kind: 'measure', measure: 'sales' }, rate: c.rate, method, residue: 'breakage' }),
      ]
      return compilePlan(rows, [], { planVersionId: 'v', version: 1 }, ['c'])['c']!.caps[0]!
    }
    const allocate = (c: CapCase, cap: CapRule): bigint[] | null => {
      const keys = [...new Set(c.lines.map((l) => l.ruleKey))]
      const priority = cap.method.type === 'priority' ? cap.method.reduce.map((k) => keys.indexOf(k)) : []
      return allocateCap(capAmountMinor(toRaw(c.baseMinor), cap.rate, 'half_up'), c.lines.map((l) => toRaw(l.amountMinor)), c.lines.map((l) => keys.indexOf(l.ruleKey)), priority, 'half_up')
    }

    test('TS-07 proportional: scaled lines sum exactly to 8,328.12', () => {
      const c = cases.find((x) => x.name === 'ts07-proportional')!
      const out = allocate(c, compiledCap(c, { type: 'proportional' }))!
      expect(out).toEqual(c.expected.lines.map((l) => l.amountMinor))
      expect(out.reduce((a, v) => a + v, 0n)).toBe(832812n)
    })

    test('TS-08 priority (reduce leadership, then team: the list covers the scope) and proportional', () => {
      const priority = cases.find((x) => x.name === 'ts08-priority')!
      expect(allocate(priority, compiledCap(priority, { type: 'priority', reduce: ['leadership', 'team'] }))).toEqual(priority.expected.lines.map((l) => l.amountMinor))
      const proportional = cases.find((x) => x.name === 'ts08-proportional')!
      expect(allocate(proportional, compiledCap(proportional, { type: 'proportional' }))).toEqual(proportional.expected.lines.map((l) => l.amountMinor))
    })
  })
})

describe('T-B3-07 plain-language rendering', () => {
  test('AC-PLN2-2: the unilevel example', () => {
    const r = SAMPLE.find((x) => x.ruleKey === 'unilevel')!
    expect(renderRule(r)).toBe('Pays 8 %, 5 % of cv on sponsor levels 1–2; compression dynamic; reversal: order line; paid to holders of main ≥ R1')
  })

  test('every kind renders', () => {
    expect(Object.fromEntries(SAMPLE.map((r) => [r.kind === r.ruleKey ? r.kind : `${r.kind} ${r.ruleKey}`, renderRule(r)]))).toMatchSnapshot()
  })

  test('BUG-090: with the market minor digits, volumes and amounts print as units', () => {
    expect(Object.fromEntries(SAMPLE.map((r) => [r.kind === r.ruleKey ? r.kind : `${r.kind} ${r.ruleKey}`, renderRule(r, { minorDigits: 2 })]))).toMatchSnapshot()
    expect(renderRule(row('flat', 'pay.flat', bonus('other', { amountMinor: '12345' }, R2)), { minorDigits: 2 })).toMatch(/^Pays 123\.45 each period/)
    expect(renderRule(row('flat', 'pay.flat', bonus('other', { amountMinor: '12345' }, R2)), { minorDigits: 0 })).toMatch(/^Pays 12345 each period/)
    expect(renderRule(row('flat', 'pay.flat', bonus('other', { amountMinor: '12345' }, R2)))).toMatch(/^Pays 12345 minor units each period/)
  })

  test('invalid params and calendar scope', () => {
    expect(renderRule(row('x', 'pay.flat', {}))).toBe('pay.flat: invalid parameters (see the validation errors)')
    expect(renderRule({ ...SAMPLE[0]!, calendarId: 'cal-1' })).toMatch(/\(one calendar only\)$/)
  })
})
