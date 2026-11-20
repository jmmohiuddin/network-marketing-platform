// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { apiError, json, noContent, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { capsInOrder, ordinalWrites } from './caps-page'
import { delta, money, versionNumber } from './format'
import { boundaryStarts, scheduleChoices } from './governance'
import { goldenFileContent } from './goldens-tab'
import { PlansList } from './plans-list'
import { CAL, decision, FINANCE, MARKET, NEXT_PERIOD, OFFICER, PERIOD, PERIODS, plan, PLAN_ID, PLANNER, READER, rule, SIM_ID, simulation, version, VERSION_SIMULATION } from './test-fixtures'
import type { VersionView } from './types'
import { refusalLines } from './ui'
import { VersionPage } from './version-page'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/plans',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const VERSION_PATH = `/v1/plans/${PLAN_ID}/versions/1`

function routes(view: VersionView, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/plans/${PLAN_ID}`]: () => ok(plan()),
    [`GET ${VERSION_PATH}`]: () => json(200, { data: view, meta: {} }, { etag: `"${view.revision}"` }),
    'GET /v1/periods': () => ok(PERIODS),
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/simulations': () => ok([]),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockReset()
  navigation.router.replace.mockReset()
})

describe('plan formatting', () => {
  it('formats money exactly with its sign and refuses impossible version routes', () => {
    const eur = { code: 'EUR', minorUnit: 2 }
    expect(money('123456', eur)).toBe('1,234.56 EUR')
    expect(delta('-300', eur)).toBe('−3.00 EUR')
    expect(delta('300', eur)).toBe('+3.00 EUR')
    expect(money('5', null)).toBe('5 minor units')
    expect(versionNumber(PLAN_ID, '2')).toBe(2)
    expect(versionNumber(PLAN_ID, '0')).toBeNull()
    expect(versionNumber('not-a-uuid', '1')).toBeNull()
  })

  it('offers only period starts shared by every plan calendar, oldest first', () => {
    const other = { ...PERIOD, id: 'x', calendar_id: 'other' }
    const periods = { ...PERIODS, periods: [NEXT_PERIOD, PERIOD, other] }
    expect(boundaryStarts([CAL.id], periods)).toEqual([PERIOD.starts_at, NEXT_PERIOD.starts_at])
    expect(boundaryStarts([CAL.id, 'other'], periods)).toEqual([PERIOD.starts_at])
  })

  it('offers future period starts first, then past ones newest first (those take effect at once)', () => {
    const now = Date.parse('2026-08-15T00:00:00.000Z')
    const starts = ['2026-07-01T00:00:00.000Z', PERIOD.starts_at, NEXT_PERIOD.starts_at, '2026-10-01T00:00:00.000Z']
    expect(scheduleChoices(starts, now)).toEqual([
      { value: NEXT_PERIOD.starts_at, past: false }, { value: '2026-10-01T00:00:00.000Z', past: false },
      { value: PERIOD.starts_at, past: true }, { value: '2026-07-01T00:00:00.000Z', past: true },
    ])
  })

  it('reads a golden file only when it is one JSON object', () => {
    expect(goldenFileContent('{"input": {}, "expected": {}}')).toEqual({ input: {}, expected: {} })
    for (const text of ['null', '"text"', '3', '[]', '{not json']) expect(goldenFileContent(text)).toBeNull()
  })

  it('reorders caps by writing only the ordinals that change', () => {
    const caps = capsInOrder([rule({ rule_key: 'b', kind: 'cap', ordinal: 1 }), rule({ rule_key: 'a', kind: 'cap', ordinal: 0 }), rule()])
    expect(caps.map((c) => c.rule_key)).toEqual(['a', 'b'])
    expect(ordinalWrites([caps[1]!, caps[0]!]).map((w) => [w.rule.rule_key, w.ordinal])).toEqual([['b', 0], ['a', 1]])
  })

  it('explains lifecycle refusals by what they name', () => {
    expect(refusalLines(new ApiError(422, 'EXTENSION_NOT_COVERED', 'm', { rule_keys: ['capped_pv'] }))).toEqual(['capped_pv has no golden case.'])
    expect(refusalLines(new ApiError(422, 'CREDITING_EVENT_CONFLICT', 'm', { market_id: MARKET.id, reason: 'other_plan' }), { market: () => 'TM' })[0]).toContain('Another plan covering TM')
    // BUG-092: outstanding guardrail reasons in words, not codes.
    expect(refusalLines(new ApiError(422, 'GUARDRAIL_OUTSTANDING', 'm', { decisions: [{ rule_id: 'kit@2026-01-01', reason: 'acknowledgement_required' }] }))).toEqual(['kit@2026-01-01: the warning needs an acknowledgement (Guardrails tab) or a compliance override.'])
    expect(refusalLines(new ApiError(422, 'GUARDRAIL_OUTSTANDING', 'm', { decisions: [{ rule_id: 'pool@2026-01-01', reason: 'compliance_review_required' }] }))).toEqual(['pool@2026-01-01: the block needs a compliance review: a Compliance officer override.'])
    expect(refusalLines(new ApiError(422, 'GOLDEN_FAILED', 'm', { datasets: [{ name: 'g1', mismatches: [{}], error: null }] }))).toEqual(['g1: 1 line differ.'])
  })
})

describe('PlansList (SC-04 list)', () => {
  const list = () => ok([{ ...plan(), versions: undefined }])

  it('lists plans with the version being authored and hides New plan without plan.edit', async () => {
    renderAs(READER, <PlansList />, fetchByRoute({ 'GET /v1/plans': list, 'GET /v1/markets': () => ok([MARKET]) }))
    const link = await screen.findByRole('link', { name: 'Test plan' })
    expect(link.getAttribute('href')).toBe(`/plans/${PLAN_ID}/versions/1`)
    expect(screen.getByText('Test monthly (TM)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New plan' })).toBeNull()
  })

  it('creates a plan with markets and free calendars, then opens version 1', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/plans': () => ok([]),
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/periods': () => ok({ ...PERIODS, calendars: [{ ...PERIODS.calendars[0]!, plan: null }] }),
      'POST /v1/plans': () => json(201, { data: { plan: { id: PLAN_ID }, version: {} }, meta: {} }),
    })
    renderAs(PLANNER, <PlansList />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'New plan' }))
    const dialog = screen.getByRole('dialog', { name: 'New plan' })
    await user.type(within(dialog).getByLabelText('Plan name'), 'Core plan')
    await user.click(within(dialog).getByLabelText('Testland (TM)'))
    await user.click(await within(dialog).findByLabelText('Test monthly (TM, monthly)'))
    await user.click(within(dialog).getByRole('button', { name: 'Create plan' }))
    await waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith(`/plans/${PLAN_ID}/versions/1`))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/plans')[0]!
    expect(bodyOf(init)).toEqual({ name: 'Core plan', market_ids: [MARKET.id], calendar_ids: [CAL.id] })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })
})

describe('VersionPage (SC-04)', () => {
  it('groups rules by pass with their plain-language rendering and validation errors', async () => {
    const view = version({ validation: { ok: false, errors: [{ rule_key: 'unilevel', code: 'UNKNOWN_REFERENCE', path: 'measure', message: 'unknown measure gv' }] } })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, routes(view))
    const bonuses = (await screen.findByRole('heading', { name: 'Bonuses' })).closest('section')!
    expect(within(bonuses).getByText('Pays 8 %, 5 % of pv on sponsor levels 1–2')).toBeTruthy()
    expect(within(bonuses).getByText('measure: unknown measure gv')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Personal volume' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByText(/projected|potential earnings/i)).toBeNull()
  })

  it('shows a submit refusal with the rules it names', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version(), { [`POST ${VERSION_PATH}/submit`]: () => apiError(422, 'EXTENSION_NOT_COVERED', 'Each extension rule needs a golden dataset that covers it.', { rule_keys: ['capped_pv'] }) })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText('capped_pv has no golden case.')).toBeTruthy()
    expect(headerOf(callsTo(fetchMock, 'POST', `${VERSION_PATH}/submit`)[0]![1], 'Idempotency-Key')).not.toBeNull()
  })

  it('saves draft fields with If-Match and reloads on a stale revision', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version(), { [`PATCH ${VERSION_PATH}`]: () => apiError(412, 'PRECONDITION_FAILED', 'stale') })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.selectOptions(await screen.findByLabelText('Crediting event'), 'fulfilled')
    await user.click(screen.getByRole('button', { name: 'Save draft fields' }))
    expect(await screen.findByText(/It has been loaded again/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PATCH', VERSION_PATH)[0]!
    expect(headerOf(init, 'If-Match')).toBe('"3"')
    expect(bodyOf(init)).toEqual({ crediting_event: 'fulfilled', placement_width: 2 })
    await waitFor(() => expect(callsTo(fetchMock, 'GET', VERSION_PATH).length).toBeGreaterThan(1))
  })

  it('refuses a blocked rule save with the guardrail id, title, explanation and basis status', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version(), {
      [`PUT ${VERSION_PATH}/rules/signup`]: () => apiError(422, 'GUARDRAIL_BLOCKED', 'A guardrail of this market blocks the rule, so it was not saved.', {
        decision_id: 'd1', rule_id: 'test-enrolment-only@2026-01-01', title: 'Enrolment-only pay', explanation: 'signup pays on enrolments only.', basis_status: 'screening',
      }),
    })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Add rule' }))
    const drawer = screen.getByRole('dialog', { name: 'Add rule' })
    await user.type(within(drawer).getByLabelText('Rule key'), 'signup')
    await user.selectOptions(within(drawer).getByLabelText('Kind'), 'pay.percent_of_measure')
    await user.selectOptions(within(drawer).getByLabelText('Reversal policy'), 'order_line')
    await user.click(within(drawer).getByRole('button', { name: 'Save rule' }))
    expect(await within(drawer).findByText('test-enrolment-only@2026-01-01 — Enrolment-only pay: signup pays on enrolments only.')).toBeTruthy()
    expect(within(drawer).getByText('Basis status: Screening.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/signup`)[0]!
    expect(headerOf(init, 'If-Match')).toBe('"3"')
    expect(bodyOf(init)).toMatchObject({ kind: 'pay.percent_of_measure', params: {}, reversal_policy: 'order_line', calendar_id: null, ordinal: 0 })
  })

  it('refuses to add a rule under the key of an existing rule (the PUT would replace it)', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version())
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Add rule' }))
    const drawer = screen.getByRole('dialog', { name: 'Add rule' })
    await user.type(within(drawer).getByLabelText('Rule key'), 'unilevel')
    await user.selectOptions(within(drawer).getByLabelText('Kind'), 'pay.flat')
    await user.click(within(drawer).getByRole('button', { name: 'Save rule' }))
    expect(within(drawer).getAllByText('A rule named unilevel already exists; edit it instead.').length).toBeGreaterThan(0)
    expect(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/unilevel`)).toHaveLength(0)
  })

  it('loads no period list with the page; the simulated total is the newest completed simulation of the version', async () => {
    const view = version({ simulations: [{ ...VERSION_SIMULATION, id: 'newer', state: 'running', finished_at: null }, VERSION_SIMULATION] })
    const fetchMock = routes(view, { [`GET /v1/simulations/${SIM_ID}`]: () => ok(simulation()) })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    const kpis = await screen.findByTestId('kpis')
    expect(await within(kpis).findByText('47.00 EUR')).toBeTruthy()
    expect(callsTo(fetchMock, 'GET', '/v1/periods')).toHaveLength(0)
    expect(callsTo(fetchMock, 'GET', '/v1/simulations')).toHaveLength(0)
  })

  it('lists the ended periods of each plan calendar for a new simulation', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version(), { 'GET /v1/periods': () => ok({ ...PERIODS, periods: [PERIOD] }) })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Run simulation' }))
    const dialog = screen.getByRole('dialog', { name: 'Run simulation' })
    expect(await within(dialog).findByLabelText('Period')).toBeTruthy()
    const [url] = callsTo(fetchMock, 'GET', '/v1/periods')[0]!
    const query = new URL(url, 'http://test').searchParams
    expect(query.get('calendar_id')).toBe(CAL.id)
    expect(Date.parse(query.get('to')!)).toBeLessThanOrEqual(Date.now())
    expect(query.get('limit')).toBeNull()
  })

  it('lets a plan editor acknowledge a warned guardrail decision', async () => {
    const user = userEvent.setup()
    navigation.search = 'tab=guardrails'
    const view = version({ guardrails: { decisions: [decision()], outstanding: [{ decision_id: decision().id, rule_id: decision().rule.id, outcome: 'warned', reason: 'needs acknowledgement' }] } })
    const ack = `POST ${VERSION_PATH}/guardrail-decisions/${decision().id}/acknowledge`
    const fetchMock = routes(view, { [ack]: () => json(201, { data: decision({ kind: 'acknowledgement' }), meta: {} }) })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: `Acknowledge ${decision().rule.id}` }))
    expect(await screen.findByText(`${decision().rule.id} acknowledged.`)).toBeTruthy()
  })

  it('offers no acknowledgement once the version left draft', async () => {
    navigation.search = 'tab=guardrails'
    const view = version({ state: 'in_review', submitted_by: OFFICER.user.id, submitted_at: '2026-11-17T09:00:00.000Z', guardrails: { decisions: [decision()], outstanding: [] } })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, routes(view))
    expect(await screen.findByText(decision().rule.id, { exact: false })).toBeTruthy()
    expect(screen.queryByRole('button', { name: `Acknowledge ${decision().rule.id}` })).toBeNull()
  })

  it('offers no acknowledgement for an opaque match of a blocking rule: it needs a compliance review (D-B4-21 b)', async () => {
    navigation.search = 'tab=guardrails'
    const opaque = decision({ detail: { ...decision().detail, opaque: true }, rule: { ...decision().rule, outcome: 'blocked' } })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, routes(version({ guardrails: { decisions: [opaque], outstanding: [] } })))
    expect(await screen.findByText('Needs a compliance review: a Compliance officer override')).toBeTruthy()
    expect(screen.queryByRole('button', { name: `Acknowledge ${opaque.rule.id}` })).toBeNull()
  })

  it('hides Approve from a plan editor without plan.approve and from the submitter', async () => {
    const view = version({ state: 'in_review', submitted_by: OFFICER.user.id, submitted_at: '2026-11-17T09:00:00.000Z' })
    const first = renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, routes(view))
    await screen.findByRole('heading', { name: 'Bonuses' })
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    first.unmount()
    renderAs(OFFICER, <VersionPage planId={PLAN_ID} version={1} />, routes(view))
    expect(await screen.findByText('You wrote or submitted this version, so a compliance officer who did not write it must decide it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('names the eligible approvers when an approval is refused for separation of duties', async () => {
    const user = userEvent.setup()
    const view = version({ state: 'in_review', submitted_by: PLANNER.user.id, submitted_at: '2026-11-17T09:00:00.000Z' })
    const fetchMock = routes(view, {
      [`POST ${VERSION_PATH}/decision`]: () => apiError(422, 'SOD_SELF_APPROVAL', 'You prepared or contributed to this, so someone else must decide it.', {
        reason_code: 'SOD-01', eligible_approvers: [{ user_id: 'u9', display_name: 'Gil Gold', email: 'gil@test.example' }], no_eligible_approver: false,
      }),
    })
    renderAs(OFFICER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve version 1' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Checked the simulation')
    await user.click(within(dialog).getByRole('button', { name: 'Approve version 1' }))
    expect(await within(dialog).findByText(/Who can decide it: Gil Gold \(gil@test\.example\)\./)).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `${VERSION_PATH}/decision`)[0]![1])).toEqual({ decision: 'approve', reason: 'Checked the simulation' })
  })

  it('schedules an approved version at a period start with a justification', async () => {
    const user = userEvent.setup()
    const view = version({ state: 'approved', submitted_by: PLANNER.user.id, approved_by: OFFICER.user.id, gates: { ...version().gates, simulation: true } })
    const fetchMock = routes(view, { [`POST ${VERSION_PATH}/schedule`]: () => ok({ ...view, state: 'active' }) })
    renderAs(FINANCE, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Schedule' }))
    const dialog = screen.getByRole('dialog', { name: 'Schedule version 1' })
    const effective = await within(dialog).findByLabelText('Effective from')
    expect(within(effective).getAllByRole('option', { name: /takes effect at once/ })).toHaveLength(2)
    await user.selectOptions(effective, PERIOD.starts_at)
    await user.type(within(dialog).getByLabelText('Justification'), 'Approved plan for the market')
    await user.click(within(dialog).getByRole('button', { name: 'Schedule version 1' }))
    expect(await screen.findByText('Version 1 is active.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `${VERSION_PATH}/schedule`)[0]![1])).toEqual({ effective_from: PERIOD.starts_at, justification: 'Approved plan for the market' })
  })

  it('deletes a rule with If-Match after confirmation', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version(), { [`DELETE ${VERSION_PATH}/rules/unilevel`]: () => noContent() })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Delete rule unilevel' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete rule unilevel' })).getByRole('button', { name: 'Delete rule' }))
    expect(await screen.findByText('Rule unilevel deleted.')).toBeTruthy()
    expect(headerOf(callsTo(fetchMock, 'DELETE', `${VERSION_PATH}/rules/unilevel`)[0]![1], 'If-Match')).toBe('"3"')
  })
})
