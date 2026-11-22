// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { MARKET, PERIODS, plan, PLAN_ID, PLANNER, READER, rule, version } from './test-fixtures'
import type { VersionView } from './types'
import { VersionPage } from './version-page'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/plans',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const VERSION_PATH = `/v1/plans/${PLAN_ID}/versions/1`
const TYPES = [
  { id: 't1', code: 'PRODUCT_CREDIT', name: 'Product credit', unit_value_minor: '100', expiry_days: 30, expiry_notice_days: 7, redemption_scope: null, taxable: false, active: true, updated_at: '2026-11-01T10:00:00.000Z' },
]
const LOYALTY = rule({ rule_key: 'loyalty', kind: 'pay.percent_of_measure', pass: '4', reversal_policy: 'order_line', credit_type_code: 'PRODUCT_CREDIT', rendering: 'Pays 5 % of pv' })

function routes(view: VersionView, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/plans/${PLAN_ID}`]: () => ok(plan()),
    [`GET ${VERSION_PATH}`]: () => json(200, { data: view, meta: {} }, { etag: `"${view.revision}"` }),
    'GET /v1/periods': () => ok(PERIODS),
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/simulations': () => ok([]),
    'GET /v1/credit-types': () => ok(TYPES),
    [`PUT ${VERSION_PATH}/rules/unilevel`]: () => ok({ guardrails: { new_decisions: [] } }),
    [`PUT ${VERSION_PATH}/rules/loyalty`]: () => ok({ guardrails: { new_decisions: [] } }),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
})

describe('SC-04 Pay in credits (D-V1A-03)', () => {
  it('offers the active credit types to a plan.edit holder without credit.read and sends credit_type_code', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version())
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Edit rule unilevel' }))
    const drawer = screen.getByRole('dialog', { name: /Edit rule unilevel/ })
    const select = within(drawer).getByLabelText('Pay in credits')
    await vi.waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['No: pay in cash', 'Product credit (PRODUCT_CREDIT)']))
    const [typesUrl] = callsTo(fetchMock, 'GET', '/v1/credit-types')[0]!
    expect(new URL(typesUrl, 'http://x').searchParams.get('active')).toBe('true')
    await user.selectOptions(select, 'PRODUCT_CREDIT')
    await user.click(within(drawer).getByRole('button', { name: 'Save rule' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/unilevel`)).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/unilevel`)[0]![1])).toMatchObject({ kind: 'pay.percent_by_level', credit_type_code: 'PRODUCT_CREDIT' })
  })

  it('keeps a stored credit type when the credit types cannot be loaded, and asks for none on other kinds', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(version({ rules: [...version().rules, LOYALTY] }), { 'GET /v1/credit-types': () => apiError(500, 'INTERNAL') })
    renderAs(PLANNER, <VersionPage planId={PLAN_ID} version={1} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Edit rule pv' }))
    expect(within(screen.getByRole('dialog', { name: /Edit rule pv/ })).queryByLabelText('Pay in credits')).toBeNull()
    await user.click(within(screen.getByRole('dialog', { name: /Edit rule pv/ })).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Edit rule loyalty' }))
    const drawer = screen.getByRole('dialog', { name: /Edit rule loyalty/ })
    expect((within(drawer).getByLabelText('Pay in credits') as HTMLSelectElement).value).toBe('PRODUCT_CREDIT')
    expect(await within(drawer).findByText('The credit types could not be loaded; the rule keeps the one it has.')).toBeTruthy()
    await user.click(within(drawer).getByRole('button', { name: 'Save rule' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/loyalty`)).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'PUT', `${VERSION_PATH}/rules/loyalty`)[0]![1])).toMatchObject({ credit_type_code: 'PRODUCT_CREDIT' })
  })

  it('shows the credit type read-only on an approved version', async () => {
    renderAs(READER, <VersionPage planId={PLAN_ID} version={1} />, routes(version({ state: 'approved', rules: [...version().rules, LOYALTY] })))
    expect(await screen.findByText('Paid in credits: PRODUCT_CREDIT')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit rule loyalty' })).toBeNull()
  })
})
