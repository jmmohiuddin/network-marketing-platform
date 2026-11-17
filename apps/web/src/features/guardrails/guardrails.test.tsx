// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { decision, MARKET, OFFICER, PLANNER } from '../plans/test-fixtures'
import type { Decision } from '../plans/types'
import { GuardrailsPage, overridable } from './guardrails-page'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/compliance/guardrails',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const BLOCKED = decision({ id: '00000000-0000-4000-8000-000000000202', outcome: 'blocked', rule: { ...decision().rule, id: 'test-enrolment-only@2026-01-01', title: 'Enrolment-only pay', overridable: false }, detail: { rule_keys: ['signup'], explanation: 'signup pays on enrolments only.', opaque: false } })
const COUNTS = { blocked: 1, warned: 1, reported: 0, overridden: 0 }

function routes(list: readonly Decision[], extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/guardrail-decisions': () => json(200, { data: list, meta: { next_cursor: null, counts: COUNTS } }),
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/plans': () => ok([]),
    'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
    ...Object.fromEntries(list.map((d) => [`GET /v1/guardrail-decisions/${d.id}`, () => ok({ ...d, decisions: [] })])),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.replace.mockReset()
})

describe('GuardrailsPage (SC-11)', () => {
  it('shows the counts, the decisions and filters kept in the URL', async () => {
    const user = userEvent.setup()
    const fetchMock = routes([decision(), BLOCKED])
    renderAs(OFFICER, <GuardrailsPage />, fetchMock)
    const kpis = await screen.findByTestId('kpis')
    expect(within(kpis).getAllByText('1')).toHaveLength(2)
    expect(await screen.findByText('test-enrolment-only@2026-01-01')).toBeTruthy()
    expect(screen.getByText('Blocked; change the rule')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Outcome'), 'blocked')
    expect(navigation.router.replace).toHaveBeenCalledWith('/compliance/guardrails?outcome=blocked')
  })

  it('sends the URL filters to the API and offers to clear them', async () => {
    navigation.search = 'outcome=warned&pack=test-pack'
    const fetchMock = routes([decision()])
    renderAs(OFFICER, <GuardrailsPage />, fetchMock)
    expect(await screen.findByRole('button', { name: 'Remove filter: Outcome: Warned' })).toBeTruthy()
    const [url] = callsTo(fetchMock, 'GET', '/v1/guardrail-decisions')[0]!
    expect(url).toContain('outcome=warned')
    expect(url).toContain('market_pack=test-pack')
  })

  it('sends no request for a ?decision= that is not an id (no path traversal into other endpoints)', async () => {
    navigation.search = `decision=${encodeURIComponent('../simulations/00000000-0000-4000-8000-0000000000c1/payees?format=csv')}`
    const fetchMock = routes([decision()])
    renderAs(OFFICER, <GuardrailsPage />, fetchMock)
    expect(await screen.findByText(decision().rule.id)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/v1/guardrail-decisions/') || url.includes('simulations'))).toEqual([])
  })

  it('approves an override of an overridable decision with a justification (step-up through the API client)', async () => {
    const user = userEvent.setup()
    navigation.search = `decision=${decision().id}`
    const fetchMock = routes([decision()], { [`POST /v1/guardrail-decisions/${decision().id}/override`]: () => json(201, { data: decision({ kind: 'override' }), meta: {} }) })
    renderAs(OFFICER, <GuardrailsPage />, fetchMock)
    const drawer = await screen.findByRole('dialog', { name: `${decision().rule.id}: Starter kit volume` })
    expect(within(drawer).getByText('Test basis text')).toBeTruthy()
    await user.type(within(drawer).getByLabelText('Justification'), 'Starter kits here are sold at cost to customers.')
    await user.click(within(drawer).getByRole('button', { name: 'Approve override' }))
    expect(await screen.findByText(`Override of ${decision().rule.id} approved.`)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', `/v1/guardrail-decisions/${decision().id}/override`)[0]!
    expect(bodyOf(init)).toEqual({ justification: 'Starter kits here are sold at cost to customers.' })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('refuses a short justification and names eligible approvers on a separation-of-duties refusal', async () => {
    const user = userEvent.setup()
    navigation.search = `decision=${decision().id}`
    renderAs(OFFICER, <GuardrailsPage />, routes([decision()], {
      [`POST /v1/guardrail-decisions/${decision().id}/override`]: () => apiError(422, 'SOD_SELF_APPROVAL', 'You prepared or contributed to this, so someone else must decide it.', {
        eligible_approvers: [{ user_id: 'u7', display_name: 'Odo Officer', email: 'odo@test.example' }], no_eligible_approver: false,
      }),
    }))
    const drawer = await screen.findByRole('dialog')
    await user.type(within(drawer).getByLabelText('Justification'), 'Too short')
    await user.click(within(drawer).getByRole('button', { name: 'Approve override' }))
    expect(within(drawer).getByText(/Write at least 20 characters/)).toBeTruthy()
    await user.type(within(drawer).getByLabelText('Justification'), ' but now long enough to send')
    await user.click(within(drawer).getByRole('button', { name: 'Approve override' }))
    expect(await within(drawer).findByText(/Who can decide it: Odo Officer \(odo@test\.example\)\./)).toBeTruthy()
  })

  it('offers no override on a non-overridable decision or to users without override.approve', async () => {
    navigation.search = `decision=${BLOCKED.id}`
    const first = renderAs(OFFICER, <GuardrailsPage />, routes([BLOCKED]))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText(/Cannot be overridden/)).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'Approve override' })).toBeNull()
    first.unmount()
    navigation.search = `decision=${decision().id}`
    renderAs(PLANNER, <GuardrailsPage />, routes([decision()]))
    await screen.findByText('Test basis text')
    expect(screen.queryByRole('button', { name: 'Approve override' })).toBeNull()
    expect(overridable(decision({ override: { id: 'o', justification: 'j', approved_by: { id: 'x', display_name: 'X' }, evidence_document_id: null, decided_at: '2026-11-17T09:00:00.000Z' } }))).toBe(false)
    expect(overridable(decision({ outcome: 'reported' }))).toBe(false)
  })
})
