// Fixtures of the plan screens' tests (imported by *.test.tsx only): neutral data in the API's shapes.
import { adminMe } from '../admin/test-support'
import type { Me } from '../../lib/me'
import type { Decision, PeriodsView, PlanDetail, Rule, SimulationDetail, VersionSimulation, VersionView } from './types'

export const PLAN_ID = '00000000-0000-4000-8000-0000000000a1'
export const VERSION_ID = '00000000-0000-4000-8000-0000000000b1'
export const SIM_ID = '00000000-0000-4000-8000-0000000000c1'
export const CAL = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Test monthly', cadence: 'monthly', market_code: 'TM' }
export const MARKET = { id: '00000000-0000-4000-8000-0000000000e1', code: 'TM', name: 'Testland', currency: 'EUR', state: 'live', market_pack: 'test-pack', time_zone: 'UTC', languages: ['en'], minor_unit: 2 }
export const PERIOD = { id: '00000000-0000-4000-8000-0000000000f1', calendar_id: CAL.id, starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z', cut_off_passed: true, state: 'open' }
export const NEXT_PERIOD = { ...PERIOD, id: '00000000-0000-4000-8000-0000000000f2', starts_at: '2026-09-01T00:00:00.000Z', ends_at: '2026-10-01T00:00:00.000Z' }

const person = (id: string, name: string, permissions: string[]): Me => adminMe({ user: { id, email: `${name.split(' ')[0]!.toLowerCase()}@test.example`, display_name: name }, permissions })
export const PLANNER = person('00000000-0000-4000-8000-000000000101', 'Pat Planner', ['plan.read', 'plan.edit', 'plan.simulate', 'period.read', 'guardrail.read'])
export const OFFICER = person('00000000-0000-4000-8000-000000000102', 'Cleo Compliance', ['plan.read', 'plan.approve', 'period.read', 'guardrail.read', 'override.approve', 'restatement.request'])
export const FINANCE = person('00000000-0000-4000-8000-000000000103', 'Fin Approver', ['plan.read', 'plan.activate', 'period.read'])
export const READER = person('00000000-0000-4000-8000-000000000104', 'Rey Reader', ['plan.read', 'period.read'])

export function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    rule_key: 'pv', kind: 'volume.personal', pass: '1', params: { unit: 'currency' }, depends_on: [], reversal_policy: null, calendar_id: null,
    credit_type_code: null, ordinal: 0, extension: false, rendering: 'Personal volume of all orders, excluding no item class', ...overrides,
  }
}

export function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: '00000000-0000-4000-8000-000000000201', kind: 'evaluation', outcome: 'warned',
    detail: { rule_keys: ['pv'], explanation: 'pv counts starter kit volume.', opaque: false }, decided_at: '2026-11-17T09:00:00.000Z',
    refers_to_decision_id: null, plan_version_id: VERSION_ID,
    rule: { id: 'test-starter-kit@2026-01-01', title: 'Starter kit volume', outcome: 'warned', overridable: true, mandatory: false, basis: 'Test basis text', basis_status: 'screening', source_ref: null, market_pack: 'test-pack' },
    plan: { id: PLAN_ID, name: 'Test plan' }, version: { id: VERSION_ID, version: 1, state: 'draft' },
    decided_by: { id: PLANNER.user.id, display_name: 'Pat Planner' }, acknowledgement: null, override: null, ...overrides,
  }
}

export function version(overrides: Partial<VersionView> = {}): VersionView {
  return {
    id: VERSION_ID, plan_id: PLAN_ID, version: 1, state: 'draft', revision: 3, effective_from: null, justification: null, engine_version: '0.2.0',
    crediting_event: 'paid', placement_width: 2, content_hash: 'aa', based_on_version_id: null, submitted_by: null, submitted_at: null,
    approved_by: null, activated_by: null, activated_at: null, retired_at: null, created_by: PLANNER.user.id, created_at: '2026-11-17T08:00:00.000Z',
    rules: [rule(), rule({ rule_key: 'unilevel', kind: 'pay.percent_by_level', pass: '4', reversal_policy: 'order_line', rendering: 'Pays 8 %, 5 % of pv on sponsor levels 1–2' })],
    transitions: [], validation: { ok: true, errors: [] }, guardrails: { decisions: [], outstanding: [] }, goldens: [], simulations: [],
    gates: { validation: true, crediting_event: true, goldens: true, coverage: true, guardrails: true, simulation: false, transitions: true },
    uncovered_extension_rules: [], missing_transitions: [], ...overrides,
  }
}

export function plan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return {
    id: PLAN_ID, name: 'Test plan', brand: null, markets: [{ id: MARKET.id, code: 'TM' }], calendars: [CAL], current_version: null,
    authoring_version: { id: VERSION_ID, version: 1, state: 'draft' },
    versions: [{ id: VERSION_ID, version: 1, state: 'draft', effective_from: null, submitted_by: null, approved_by: null, activated_by: null, created_at: '2026-11-17T08:00:00.000Z' }],
    ...overrides,
  }
}

export const PERIODS: PeriodsView = {
  calendars: [{ id: CAL.id, name: CAL.name, cadence: 'monthly', cutoff_time_zone: 'UTC', market: { id: MARKET.id, code: 'TM' }, plan: { id: PLAN_ID, name: 'Test plan' } }],
  periods: [NEXT_PERIOD, PERIOD],
}

/** SIM_ID as GET …/versions/1 lists it (with its period). */
export const VERSION_SIMULATION: VersionSimulation = {
  id: SIM_ID, state: 'completed', finished_at: '2026-11-17T10:01:00.000Z',
  period: { id: PERIOD.id, calendar_id: CAL.id, starts_at: PERIOD.starts_at, ends_at: PERIOD.ends_at },
}

export function simulation(overrides: Partial<SimulationDetail> = {}): SimulationDetail {
  return {
    simulation: {
      id: SIM_ID, plan_version_id: VERSION_ID, period_id: PERIOD.id, kind: 'simulation', state: 'completed', baseline_run_id: 'r1', content_hash: 'aa',
      error: null, requested_by: PLANNER.user.id, requested_at: '2026-11-17T10:00:00.000Z', finished_at: '2026-11-17T10:01:00.000Z',
    },
    totals: { simulated_minor: '4700', baseline_minor: '5000', delta_minor: '-300' },
    comparison: {
      by_rule: [{ rule_key: 'unilevel', baseline_minor: '5000', simulated_minor: '4700', delta_minor: '-300' }],
      distribution: [{ bucket: '<-10%', payees: 1 }, { bucket: '-10..-1%', payees: 0 }, { bucket: '-1..+1%', payees: 2 }, { bucket: '+1..+10%', payees: 0 }, { bucket: '>+10%', payees: 0 }, { bucket: 'new', payees: 0 }, { bucket: 'gone', payees: 0 }],
      cap_effects: [{ cap_key: 'ceiling', method: 'proportional', base_minor: '100000', cap_minor: '4700', proposed_minor: '5000', bound: true, affected: [{ payee_position_id: 'pos-1', rule_key: 'unilevel', before_minor: '5000', after_minor: '4700' }] }],
      guardrail_flags: [], payees_changed: 1, reconciles: true,
    },
    warnings: [],
    ...overrides,
  }
}
