// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { moneyText } from '../orders/format'
import { RunReviewPage } from './review-page'
import type { RunDetail, RunReview } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/periods/per-m2/runs/run-m2/review',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const CALENDAR = { id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: 'm1', code: 'DE' }, plan: { id: 'pl1', name: 'DE core' } }
const ANALYST = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000a1', email: 'ann@acme.example', display_name: 'Ann Analyst' },
  permissions: ['period.read', 'run.execute', 'run.review', 'trace.read'],
})
const FINANCE = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000f1', email: 'fay@acme.example', display_name: 'Fay Finance' },
  permissions: ['period.read', 'run.review', 'run.commit', 'trace.read'],
})

const RUN: RunDetail = {
  id: 'run-m2', period_id: 'per-m2', state: 'calculated', progress: null, totals: { gross_minor: '4700', line_count: 3, payee_count: 2 }, error: null,
  inputs_hash: 'in1', lines_hash: 'li1', engine_version: '0.2.0', prepared_by: { id: ANALYST.user.id, display_name: 'Ann Analyst' }, review_opened_at: null,
  commit_requested_at: null, commit_requested_by: null, finished_at: '2026-10-02T10:00:00.000Z', committed_at: null,
  plan_version: { id: 'v1', plan: { id: 'pl1', name: 'DE core' }, version: 1 }, snapshot: { known_at: '2026-10-02T09:59:00.000Z', row_counts: { orders: 5, order_events: 1 } },
}
const REVIEW: RunReview = {
  comparison: null,
  totals: { current: { gross_minor: '4700', line_count: 3, payee_count: 2 }, previous: null },
  variance: [{ rule_key: 'unilevel', kind: 'percent_by_level', pass: 4, previous_minor: '0', current_minor: '4700', delta_minor: '4700' }],
  movers: [{ participant: { id: 'par-b', external_ref: 'DE-B', display_name: null }, previous_minor: '0', current_minor: '2400', delta_minor: '2400' }],
  exceptions: [
    { id: 'large_line:l1', kind: 'large_line', blocking: true, message: 'Line amount 2400 (minor units) exceeds the large-line threshold 1000.', ref: 'l1' },
    { id: 'warning:NO_WITHHOLDING_RULE', kind: 'warning', blocking: false, message: '2 × No withholding rule', ref: 'NO_WITHHOLDING_RULE' },
  ],
  changes: { plan_version_changed: false, previous_plan_version: null, settings_version_changed: false, inputs: { current: { orders: 5 }, previous: null }, transition_changes: 0, cap_applications: [] },
  adjustments: [{ origin_type: 'clawback', count: 2, amount_minor: '-2600' }],
}
const LINE_ID = '00000000-0000-4000-8000-00000000011e'
const LINE = { id: LINE_ID, payee_position_id: 'pos-b', payee_participant_id: 'par-b', rule_key: 'unilevel', bonus_type: 'percent_by_level', source_kind: 'volume', pass: 4, amount_minor: '2400', currency: 'EUR', origin_type: null, origin_id: null, original_period_id: null }
const TRACE = { rule: 'unilevel', kind: 'percent_by_level', pass: 4, planVersionId: 'v1', engineVersion: '0.2.0', rankEvaluated: [{ ladder: 'main', rank: 'R1' }], sources: [{ positionId: 'pos-c', level: 1, measure: 'pv', rate: '0.08', orders: [{ orderId: 'ord-c' }] }], omitted: { count: 0 }, steps: [{ step: 'rounding', mode: 'half_up' }] }

function routes(run: RunDetail, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/runs/run-m2': () => ok(run),
    'GET /v1/periods/per-m2': () => ok({ id: 'per-m2', calendar_id: 'cal1', market_id: 'm1', starts_at: '2026-09-01T00:00:00.000Z', ends_at: '2026-10-01T00:00:00.000Z', state: 'calculated' }),
    'GET /v1/periods': () => json(200, { data: { calendars: [CALENDAR], periods: [] }, meta: { next_cursor: null } }),
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/runs/run-m2/review': () => ok(REVIEW),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.replace.mockReset()
})

describe('RunReviewPage (SC-02)', () => {
  it('shows KPIs and the variance, and never says "post"', async () => {
    renderAs(FINANCE, <RunReviewPage periodId="per-m2" runId="run-m2" />, routes(RUN))
    const kpis = await screen.findByTestId('kpis')
    expect(kpis.textContent).toContain(moneyText('4700', 'EUR', 2))
    expect(kpis.textContent).toContain(`-${moneyText('2600', 'EUR', 2)}`)
    expect(screen.getByRole('table', { name: 'Variance by bonus' }).textContent).toContain('unilevel')
    expect(document.body.textContent).not.toMatch(/\bpost\b/i)
  })

  it('lets finance commit after acknowledging every blocking exception, with an Idempotency-Key', async () => {
    let committed = false
    const fetchMock = routes(RUN, {
      'GET /v1/runs/run-m2': () => ok(committed ? { ...RUN, state: 'committed', committed_at: '2026-10-03T10:00:00.000Z' } : RUN),
      'POST /v1/runs/run-m2/commit': () => {
        committed = true
        return ok({ run_id: 'run-m2', state: 'committed', period_id: 'per-m2', totals: RUN.totals })
      },
    })
    renderAs(FINANCE, <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchMock)
    expect(screen.queryByRole('button', { name: 'Request commit' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Commit run' }))
    const dialog = await screen.findByRole('dialog', { name: 'Commit run' })
    expect(dialog.textContent).toContain(moneyText('4700', 'EUR', 2))
    await userEvent.click(within(dialog).getByRole('button', { name: /^Commit run/ }))
    expect(await within(dialog).findByText(/^Acknowledge: Line amount 2400/)).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/runs/run-m2/commit')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Line amount 2400/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: /^Commit run/ }))
    expect(await screen.findByText(/Run committed/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/runs/run-m2/commit')[0]!
    expect(bodyOf(init)).toEqual({ acknowledged_exceptions: ['large_line:l1'] })
    expect(headerOf(init, 'idempotency-key')).not.toBeNull()
  })

  it('renders a separation-of-duties refusal with the people who can commit', async () => {
    const fetchMock = routes(RUN, {
      'POST /v1/runs/run-m2/commit': () => apiError(422, 'SOD_SELF_APPROVAL', 'You cannot approve your own work.', { eligible_approvers: [{ user_id: 'u9', display_name: 'Gil Gold', email: 'gil@acme.example' }] }),
    })
    renderAs(FINANCE, <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Commit run' }))
    const dialog = await screen.findByRole('dialog', { name: 'Commit run' })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Line amount 2400/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: /^Commit run/ }))
    expect(await within(dialog).findByText(/Who can decide it: Gil Gold \(gil@acme.example\)/)).toBeTruthy()
  })

  it('gives the preparer Request commit (not Commit), then names who may commit', async () => {
    const preparer = adminMe({ ...ANALYST, permissions: [...ANALYST.permissions, 'run.commit'] })
    const fetchMock = routes(RUN, {
      'POST /v1/runs/run-m2/request-commit': () => ok({ commit_requested_at: '2026-10-02T11:00:00.000Z', eligible_approvers: [{ user_id: FINANCE.user.id, display_name: 'Fay Finance', email: 'fay@acme.example' }] }),
    })
    renderAs(preparer, <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchMock)
    const request = await screen.findByRole('button', { name: 'Request commit' })
    expect(request.getAttribute('data-testid')).toBe('primary-action')
    expect(screen.queryByRole('button', { name: 'Commit run' })).toBeNull()
    expect(screen.getByText('You prepared or requested this run, so someone else must commit it.')).toBeTruthy()
    await userEvent.click(request)
    expect(await screen.findByText('Waiting for: Fay Finance (fay@acme.example)')).toBeTruthy()
    expect(headerOf(callsTo(fetchMock, 'POST', '/v1/runs/run-m2/request-commit')[0]![1], 'idempotency-key')).not.toBeNull()
  })

  it('opens a line trace from the URL and expands it by replay', async () => {
    navigation.search = `tab=lines&line=${LINE_ID}`
    const fetchMock = routes(RUN, {
      'GET /v1/runs/run-m2/lines': () => ok([LINE]),
      'GET /v1/participants/par-b': () => ok({ id: 'par-b', external_ref: 'DE-B', display_name: null }),
      'GET /v1/positions/pos-b': () => ok({ id: 'pos-b', position_ref: 'P-B', owner: null }),
      [`GET /v1/result-lines/${LINE_ID}/trace`]: (query) => ok({
        line: LINE, trace: TRACE, expressions: [],
        explanation: query.get('expand') === 'true' ? { lines: ['unilevel: 8% of 300.00 = 24.00'], reconciles: true } : null,
      }),
    })
    renderAs(ANALYST, <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchMock)
    const drawer = await screen.findByRole('dialog', { name: 'Calculation trace' })
    expect(await within(drawer).findByText('main: R1')).toBeTruthy()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Expand by replay' }))
    expect(await within(drawer).findByText('unilevel: 8% of 300.00 = 24.00')).toBeTruthy()
    expect(within(drawer).getByText('Reconciles')).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', `/v1/result-lines/${LINE_ID}/trace`).at(-1)![0], 'http://x').searchParams.get('expand')).toBe('true')
  })

  it('ignores a ?line= that is not a UUID, or when the user may not read traces, and sends no trace request', async () => {
    for (const [me, search] of [[ANALYST, 'tab=lines&line=..%2Fruns%2Fother%2Freview%23'], [adminMe({ ...ANALYST, permissions: ['period.read', 'run.review'] }), `tab=lines&line=${LINE_ID}`]] as const) {
      navigation.search = search
      const fetchMock = routes(RUN, { 'GET /v1/runs/run-m2/lines': () => ok([LINE]), 'GET /v1/participants/par-b': () => ok({ id: 'par-b', external_ref: 'DE-B', display_name: null }) })
      const { unmount } = renderAs(me, <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchMock)
      expect(await screen.findByRole('table', { name: 'Result lines' })).toBeTruthy()
      expect(screen.queryByRole('dialog', { name: 'Calculation trace' })).toBeNull()
      expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('result-lines') || url.includes('other'))).toEqual([])
      unmount()
    }
  })

  it('gives a commit holder who did not prepare the run only Commit run, not Request commit', async () => {
    const both = adminMe({ ...FINANCE, permissions: [...FINANCE.permissions, 'run.execute'] })
    renderAs(both, <RunReviewPage periodId="per-m2" runId="run-m2" />, routes(RUN))
    expect((await screen.findByRole('button', { name: 'Commit run' })).getAttribute('data-testid')).toBe('primary-action')
    expect(screen.queryByRole('button', { name: 'Request commit' })).toBeNull()
  })

  it('shows a retryable failure when the calendar cannot be read', async () => {
    let calendarReads = 0
    const fetchMock = routes(RUN, {
      'GET /v1/periods': () => (++calendarReads === 1 ? apiError(500, 'INTERNAL', 'Boom') : json(200, { data: { calendars: [CALENDAR], periods: [] }, meta: { next_cursor: null } })),
    })
    renderAs(FINANCE, <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('kpis')).toBeTruthy()
  })

  it('exports the lines as CSV for a run.review holder', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const fetchMock = routes(RUN, {
      'GET /v1/runs/run-m2/lines': () => new Response('id\nl1\n', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="run-m2-lines.csv"' } }),
    })
    renderAs(ANALYST, <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Export lines CSV' }))
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/runs/run-m2/lines')[0]![0], 'http://x').searchParams.get('format')).toBe('csv')
  })

  it('shows a failed run with its error and no review', async () => {
    renderAs(ANALYST, <RunReviewPage periodId="per-m2" runId="run-m2" />, routes({ ...RUN, state: 'failed', totals: null, error: { code: 'INVARIANT', message: 'Lines do not sum to the total.' } }))
    expect(await screen.findByText(/Lines do not sum to the total/)).toBeTruthy()
    expect(screen.queryByTestId('kpis')).toBeNull()
    expect(screen.getByRole('button', { name: 'Re-run' })).toBeTruthy()
  })

  it('is not available without run.review', () => {
    renderAs(adminMe({ permissions: ['period.read'] }), <RunReviewPage periodId="per-m2" runId="run-m2" />, fetchByRoute({}))
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })
})
