// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { CapsPage } from './caps-page'
import { SimulationPage } from './simulation-page'
import { MARKET, PERIODS, plan, PLAN_ID, PLANNER, READER, rule, SIM_ID, simulation, version, VERSION_SIMULATION } from './test-fixtures'
import type { SimulationDetail, VersionView } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/plans',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const VERSION_PATH = `/v1/plans/${PLAN_ID}/versions/1`
const PAYEE = { participant: { id: 'p1', external_ref: 'TM-A', display_name: 'Avery Test' }, baseline_minor: '5000', simulated_minor: '4700', delta_minor: '-300', by_rule: [{ rule_key: 'unilevel', baseline_minor: '5000', simulated_minor: '4700' }] }

function routes(detail: SimulationDetail, view: VersionView = version({ simulations: [VERSION_SIMULATION] }), extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/plans/${PLAN_ID}`]: () => ok(plan()),
    [`GET ${VERSION_PATH}`]: () => ok(view),
    'GET /v1/periods': () => ok(PERIODS),
    'GET /v1/markets': () => ok([MARKET]),
    [`GET /v1/simulations/${SIM_ID}`]: () => ok(detail),
    [`GET /v1/simulations/${SIM_ID}/payees`]: () => ok([PAYEE]),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
})

describe('SimulationPage (SC-42)', () => {
  it('labels the simulation staff only and shows simulated, baseline, change and payees changed', async () => {
    renderAs(PLANNER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, routes(simulation()))
    expect(await screen.findByText('Simulation — staff only, never shown to participants')).toBeTruthy()
    const kpis = screen.getByTestId('kpis')
    expect(within(kpis).getByText('47.00 EUR')).toBeTruthy()
    expect(within(kpis).getByText('50.00 EUR')).toBeTruthy()
    expect(within(kpis).getByText('−3.00 EUR')).toBeTruthy()
    expect(await screen.findByText('Avery Test')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
    expect(screen.getByTestId('primary-action').textContent).toContain('Run new simulation')
    expect(screen.queryByText(/projected|potential/i)).toBeNull()
  })

  it('shows the distribution buckets from the API and the cap effects', async () => {
    navigation.search = 'tab=distribution'
    const first = renderAs(PLANNER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, routes(simulation()))
    const buckets = (await screen.findByRole('heading', { name: 'Distribution of payee changes' })).closest('section')!
    expect(within(buckets).getByRole('img', { name: 'More than 10% lower: 1 payee' })).toBeTruthy()
    expect(within(buckets).getByRole('img', { name: 'Within 1%: 2 payees' })).toBeTruthy()
    first.unmount()
    navigation.search = 'tab=caps'
    renderAs(PLANNER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, routes(simulation()))
    const caps = (await screen.findByRole('heading', { name: 'Cap effects' })).closest('section')!
    expect(within(caps).getByText('ceiling')).toBeTruthy()
    expect(within(caps).getByText('47.00 EUR')).toBeTruthy()
  })

  it('without plan.simulate: no per-payee table, no CSV and no new simulation', async () => {
    renderAs(READER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, routes(simulation()))
    expect(await screen.findByText(/Per-payee results need the plan simulation permission/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run new simulation' })).toBeNull()
  })

  it('says a running simulation is calculating and a failed one why', async () => {
    const running = simulation({ totals: null, comparison: null, simulation: { ...simulation().simulation, state: 'running', finished_at: null } })
    const first = renderAs(PLANNER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, routes(running))
    expect(await screen.findByText(/The simulation is calculating/)).toBeTruthy()
    first.unmount()
    const failed = simulation({ totals: null, comparison: null, simulation: { ...simulation().simulation, state: 'failed', error: { code: 'PLAN_CHANGED', message: 'The draft changed after the simulation was requested.' } } })
    renderAs(PLANNER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, routes(failed))
    expect(await screen.findByText(/The draft changed after the simulation was requested/)).toBeTruthy()
  })

  it('shows a simulation of another version as not available, not under this version', async () => {
    renderAs(PLANNER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, routes(simulation({ simulation: { ...simulation().simulation, plan_version_id: '00000000-0000-4000-8000-0000000000b9' } })))
    expect(await screen.findByRole('heading', { name: 'Not found or not available to you' })).toBeTruthy()
    expect(screen.queryByText('Simulation — staff only, never shown to participants')).toBeNull()
  })

  it('saves the simulation as a golden case covering the chosen extension rules', async () => {
    const user = userEvent.setup()
    navigation.search = 'tab=goldens'
    const view = version({ simulations: [VERSION_SIMULATION], rules: [...version().rules, rule({ rule_key: 'capped_pv', kind: 'measure.derived', pass: '2', extension: true, rendering: 'min(pv, 500.00)' })] })
    const fetchMock = routes(simulation(), view, { [`POST ${VERSION_PATH}/golden-datasets`]: () => json(201, { data: { id: 'g1' }, meta: {} }) })
    renderAs(PLANNER, <SimulationPage planId={PLAN_ID} version={1} simulationId={SIM_ID} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Save as golden case' }))
    const dialog = screen.getByRole('dialog', { name: 'Save as golden case' })
    await user.type(within(dialog).getByLabelText('Name'), 'August baseline')
    await user.click(within(dialog).getByLabelText('capped_pv'))
    await user.click(within(dialog).getByRole('button', { name: 'Save golden case' }))
    expect(await screen.findByText('Golden case August baseline saved.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `${VERSION_PATH}/golden-datasets`)[0]![1])).toEqual({ name: 'August baseline', covers: ['capped_pv'], from_simulation_id: SIM_ID })
  })
})

describe('CapsPage (SC-05)', () => {
  const caps = [
    rule({ rule_key: 'first_cap', kind: 'cap', pass: '8', ordinal: 0, params: { scope: ['unilevel'], method: { type: 'proportional' } }, rendering: 'Caps unilevel at 10% of pv' }),
    rule({ rule_key: 'second_cap', kind: 'cap', pass: '8', ordinal: 1, params: { scope: ['unilevel'], method: { type: 'priority', reduce: ['unilevel'] } }, rendering: 'Caps unilevel at 5% of pv' }),
  ]

  it('moves a cap down with chained If-Match writes of the ordinals', async () => {
    const user = userEvent.setup()
    let revision = 3
    const put = () => {
      revision += 1
      return json(200, { data: { rule: {}, validation: { ok: true, errors: [] }, guardrails: { new_decisions: [] } }, meta: {} }, { etag: `"${revision}"` })
    }
    const fetchMock = routes(simulation(), version({ rules: [...version().rules, ...caps] }), {
      [`PUT ${VERSION_PATH}/rules/first_cap`]: put,
      [`PUT ${VERSION_PATH}/rules/second_cap`]: put,
    })
    renderAs(PLANNER, <CapsPage planId={PLAN_ID} version={1} />, fetchMock)
    const list = await screen.findByRole('list', { name: 'Caps in precedence order' })
    await user.click(within(list).getByRole('button', { name: 'Move first_cap down' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/first_cap`)).toHaveLength(1))
    const [, second] = callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/second_cap`)[0]!
    const [, first] = callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/first_cap`)[0]!
    expect(headerOf(second, 'If-Match')).toBe('"3"')
    expect(bodyOf(second)).toMatchObject({ kind: 'cap', ordinal: 0 })
    expect(headerOf(first, 'If-Match')).toBe('"4"')
    expect(bodyOf(first)).toMatchObject({ ordinal: 1 })
  })

  it('reads a weak ETag in the chain and says when only part of the new order was saved', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(simulation(), version({ rules: [...version().rules, ...caps] }), {
      [`PUT ${VERSION_PATH}/rules/second_cap`]: () => json(200, { data: { rule: {}, validation: { ok: true, errors: [] }, guardrails: { new_decisions: [] } }, meta: {} }, { etag: 'W/"4"' }),
      [`PUT ${VERSION_PATH}/rules/first_cap`]: () => apiError(422, 'GUARDRAIL_BLOCKED', 'A guardrail of this market blocks the rule, so it was not saved.', { rule_id: 'g', title: 't', explanation: 'e', basis_status: 'screening' }),
    })
    renderAs(PLANNER, <CapsPage planId={PLAN_ID} version={1} />, fetchMock)
    const list = await screen.findByRole('list', { name: 'Caps in precedence order' })
    await user.click(within(list).getByRole('button', { name: 'Move first_cap down' }))
    expect(await screen.findByText('The new order was saved only in part; check it and try again.')).toBeTruthy()
    expect(headerOf(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/first_cap`)[0]![1], 'If-Match')).toBe('"4"')
  })

  it('refuses a new cap or pool under the key of an existing rule', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(simulation(), version({ rules: [...version().rules, rule({ rule_key: 'rank', kind: 'ladder', pass: '3', params: { ranks: [{ key: 'R1' }] } })] }))
    renderAs(PLANNER, <CapsPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByTestId('primary-action'))
    const capForm = screen.getByRole('form', { name: 'New cap' })
    await user.type(within(capForm).getByLabelText('Cap key'), 'unilevel')
    await user.click(within(capForm).getByRole('button', { name: 'Save cap' }))
    expect(within(capForm).getAllByText('A rule named unilevel already exists; edit it instead.').length).toBeGreaterThan(0)
    await user.click(within(capForm).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add pool' }))
    const poolForm = screen.getByRole('form', { name: 'New pool' })
    expect(within(poolForm).getByLabelText(/Shares for R1/)).toBeTruthy()
    await user.type(within(poolForm).getByLabelText('Pool key'), 'pv')
    await user.click(within(poolForm).getByRole('button', { name: 'Save pool' }))
    expect(within(poolForm).getAllByText('A rule named pv already exists; edit it instead.').length).toBeGreaterThan(0)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0)
  })

  it('drops a deleted bonus from a saved cap scope and says so; error links focus their group and field', async () => {
    const user = userEvent.setup()
    const stale = rule({ rule_key: 'old_cap', kind: 'cap', pass: '8', params: { scope: ['gone', 'unilevel'], base: { kind: 'order_structure', first: 'pv', second: '', secondShareAbove: { num: 1, den: 2 }, firstMultiplier: '2' }, rate: '0.10', method: { type: 'proportional' } }, rendering: 'Caps' })
    renderAs(PLANNER, <CapsPage planId={PLAN_ID} version={1} />, routes(simulation(), version({ rules: [...version().rules, stale] })))
    await user.click(await screen.findByRole('button', { name: 'Edit cap old_cap' }))
    const form = screen.getByRole('form', { name: 'Cap old_cap' })
    expect(within(form).getByText(/gone no longer exists and was removed from the scope/)).toBeTruthy()
    await user.click(within(form).getByLabelText('unilevel'))
    await user.click(within(form).getByRole('button', { name: 'Save cap' }))
    expect((within(form).getByLabelText('Second measure') as HTMLSelectElement).getAttribute('aria-invalid')).toBe('true')
    await user.click(within(form).getByRole('link', { name: 'Choose at least one bonus the cap limits.' }))
    expect(document.activeElement?.id).toBe('cap-scope')
  })

  it('sends no request for a ?preview= that is not an id', async () => {
    navigation.search = `preview=${encodeURIComponent('../simulations/x/payees?format=csv')}`
    const fetchMock = routes(simulation())
    renderAs(PLANNER, <CapsPage planId={PLAN_ID} version={1} />, fetchMock)
    await screen.findByRole('heading', { name: 'Caps in precedence order' })
    expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('simulations'))).toEqual([])
  })

  it('saves a priority cap with its ordered priority list and breakage residue', async () => {
    const user = userEvent.setup()
    const view = version({ rules: [...version().rules, rule({ rule_key: 'pool_bonus', kind: 'pay.matching', pass: '5', rendering: 'Matching on unilevel' })] })
    const fetchMock = routes(simulation(), view, { [`PUT ${VERSION_PATH}/rules/ceiling`]: () => ok({ rule: {}, validation: { ok: true, errors: [] }, guardrails: { new_decisions: [] } }) })
    renderAs(PLANNER, <CapsPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByTestId('primary-action'))
    const form = screen.getByRole('form', { name: 'New cap' })
    expect(within(form).getByText(/Breakage — removed amounts are not earned/)).toBeTruthy()
    await user.type(within(form).getByLabelText('Cap key'), 'ceiling')
    await user.type(within(form).getByLabelText('Rate'), '0.10')
    await user.click(within(form).getByLabelText('unilevel'))
    await user.click(within(form).getByLabelText('pool_bonus'))
    await user.selectOptions(within(form).getByLabelText('Base measure'), 'pv')
    await user.click(within(form).getByLabelText(/^Priority/))
    await user.click(within(form).getByRole('button', { name: 'Move pool_bonus up' }))
    await user.click(within(form).getByRole('button', { name: 'Save cap' }))
    expect(await screen.findByText('Cap ceiling saved.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/ceiling`)[0]![1])).toEqual({
      kind: 'cap', ordinal: 0, reversal_policy: null, calendar_id: null,
      params: { scope: ['pool_bonus', 'unilevel'], base: { kind: 'measure', measure: 'pv' }, rate: '0.10', method: { type: 'priority', reduce: ['pool_bonus', 'unilevel'] }, residue: 'breakage' },
    })
  })

  it('hides every write control from a reader', async () => {
    renderAs(READER, <CapsPage planId={PLAN_ID} version={1} />, routes(simulation(), version({ rules: [...version().rules, ...caps] })))
    await screen.findByRole('list', { name: 'Caps in precedence order' })
    expect(screen.queryByRole('button', { name: /Move .* down/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add cap' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview on period' })).toBeNull()
  })
})
