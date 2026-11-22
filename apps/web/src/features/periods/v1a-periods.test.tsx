// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, fetchByRoute, renderAs } from '../admin/test-support'
import { calendarBadge, canCalculate } from './format'
import { PeriodsPage } from './periods-page'
import { RunReviewPage } from './review-page'
import type { Calendar, PeriodRow, RunDetail, RunReview, TrueUp } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() }, pathname: '/periods' }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MONTHLY_ID = '00000000-0000-4000-8000-00000000ca11'
const WEEKLY_ID = '00000000-0000-4000-8000-00000000ca12'
const MARKET = { id: 'm1', code: 'BE', name: 'Belgium', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture', time_zone: 'Europe/Brussels', languages: ['en'], minor_unit: 2 }
const BASE = { cadence: 'monthly', cutoff_time_zone: 'Europe/Brussels', market: { id: 'm1', code: 'BE' }, plan: { id: 'pl1', name: 'BE advances' } }
const MONTHLY: Calendar = { ...BASE, id: MONTHLY_ID, name: 'BE monthly', provisional_for: null, provisional_calendars: [{ id: WEEKLY_ID, name: 'BE weekly advances' }] }
const WEEKLY: Calendar = { ...BASE, id: WEEKLY_ID, name: 'BE weekly advances', cadence: 'weekly', provisional_for: { id: MONTHLY_ID, name: 'BE monthly' }, provisional_calendars: [] }
const ANALYST = adminMe({ permissions: ['period.read', 'run.execute', 'run.review'] })
const OPEN_ADVANCES = { code: 'PROVISIONAL_RUN_OPEN', message: 'Commit or discard the runs of the provisional periods inside this period first.', details: { period_ids: ['w4'] } }

const OCTOBER: PeriodRow = {
  id: 'oct', calendar_id: MONTHLY_ID, starts_at: '2026-09-30T22:00:00.000Z', ends_at: '2026-10-31T23:00:00.000Z', cut_off_passed: true, state: 'calculated',
  committed_run_id: null, latest_run: { id: 'run-oct', state: 'calculated', gross_minor: '1240', finished_at: '2026-11-02T10:00:00.000Z', true_up_runs: 2 }, blockers: [],
  late: { pending: 0, decided: 0 }, closed_at: null, closed_by: null,
}
const RUN: RunDetail = {
  id: 'run-oct', period_id: 'oct', state: 'calculated', progress: null, totals: { gross_minor: '1240', line_count: 4, payee_count: 2 }, error: null,
  inputs_hash: 'i', lines_hash: 'l', engine_version: '0.2.0', prepared_by: { id: 'u9', display_name: 'Ann Analyst' }, review_opened_at: null,
  commit_requested_at: null, commit_requested_by: null, finished_at: '2026-11-02T10:00:00.000Z', committed_at: null,
  plan_version: { id: 'v1', plan: { id: 'pl1', name: 'BE advances' }, version: 1 }, provisional: null,
  true_up: { provisional_run_ids: ['run-w1', 'run-w3'], offsets_minor: '-1800' }, credit_awards_minor: '1900', snapshot: null,
}
const REVIEW: RunReview = {
  comparison: null, totals: { current: { gross_minor: '1240', line_count: 4, payee_count: 2 }, previous: null }, variance: [], movers: [], exceptions: [],
  changes: { plan_version_changed: false, previous_plan_version: null, settings_version_changed: false, inputs: { current: null, previous: null }, transition_changes: 0, cap_applications: [] },
  adjustments: [{ origin_type: 'provisional', count: 2, amount_minor: '-1800' }],
}
const TRUE_UP: TrueUp = {
  final_period: { id: 'oct', starts_at: OCTOBER.starts_at, ends_at: OCTOBER.ends_at },
  provisional_runs: [
    { run_id: 'run-w1', period_id: 'w1', starts_at: '2026-10-04T22:00:00.000Z', ends_at: '2026-10-11T22:00:00.000Z', committed_at: '2026-10-13T10:00:00.000Z', gross_minor: '1000' },
    { run_id: 'run-w3', period_id: 'w3', starts_at: '2026-10-18T22:00:00.000Z', ends_at: '2026-10-25T23:00:00.000Z', committed_at: '2026-10-27T10:00:00.000Z', gross_minor: '800' },
  ],
  payees: [
    { participant: { id: 'pa', external_ref: 'BE-A' }, final_minor: '1440', provisional_minor: '1800', true_up_minor: '-360' },
    { participant: { id: 'pb', external_ref: 'BE-B' }, final_minor: '1600', provisional_minor: '0', true_up_minor: '1600' },
  ],
  totals: { final_minor: '3040', provisional_minor: '1800', true_up_minor: '1240' },
}

beforeEach(() => {
  navigation.search = ''
  navigation.pathname = '/periods'
  navigation.router.replace.mockReset()
})

describe('provisional words (D-V1A-02)', () => {
  it('badges provisional and final calendars and keeps Calculate for a refusal a commit can clear', () => {
    expect(calendarBadge(WEEKLY)).toBe('Provisional → BE monthly')
    expect(calendarBadge(MONTHLY)).toBe('Final for: BE weekly advances')
    expect(calendarBadge({ provisional_for: null, provisional_calendars: [] })).toBeNull()
    expect(canCalculate({ state: 'open', blockers: [OPEN_ADVANCES] })).toBe(true)
    expect(canCalculate({ state: 'open', blockers: [{ code: 'FINAL_PERIOD_COMMITTED', message: 'm', details: {} }] })).toBe(false)
  })
})

describe('SC-01 provisional calendars', () => {
  it('shows the calendar badges, the true-up note of a final period and a refusal in words', async () => {
    navigation.search = `calendar=${MONTHLY_ID}`
    const open = { ...OCTOBER, id: 'nov', starts_at: '2026-10-31T23:00:00.000Z', ends_at: '2026-11-30T23:00:00.000Z', state: 'open' as const, latest_run: null, blockers: [OPEN_ADVANCES] }
    renderAs(ANALYST, <PeriodsPage />, fetchByRoute({
      'GET /v1/periods': () => json(200, { data: { calendars: [MONTHLY, WEEKLY], periods: [open, OCTOBER] }, meta: { next_cursor: null } }),
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/periods/oct': () => ok({ ...OCTOBER, market_id: 'm1', runs: [], plan_version: null, sync: { state: 'healthy', last_sync_at: null, sources: [] }, late: { pending: 0, decided: 0, consumed: 0 }, restatements: [] }),
      'GET /v1/runs/run-oct': () => ok(RUN),
      'POST /v1/periods/nov/runs': () => apiError(409, 'PROVISIONAL_RUN_OPEN', OPEN_ADVANCES.message, OPEN_ADVANCES.details),
    }))
    expect(await screen.findByRole('tab', { name: 'BE monthly (BE) · Final for: BE weekly advances' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'BE weekly advances (BE) · Provisional → BE monthly' })).toBeTruthy()
    expect(await screen.findByText('Trues up 2 provisional runs')).toBeTruthy()
    const table = screen.getByRole('table', { name: /Periods of/ })
    expect(within(table).getByText('Advance runs inside not committed')).toBeTruthy()
    await userEvent.click(within(table).getByRole('button', { name: /^Calculate / }))
    expect(await screen.findByText('The calculation was refused: Advance runs inside not committed')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/PROVISIONAL_RUN_OPEN/)
  })
})

describe('SC-02 provisional and final runs', () => {
  const routes = (run: RunDetail, extra: Record<string, (query: URLSearchParams) => Response> = {}) => fetchByRoute({
    [`GET /v1/runs/${run.id}`]: () => ok(run),
    [`GET /v1/periods/${run.period_id}`]: () => ok({ id: run.period_id, calendar_id: run.provisional === null ? MONTHLY_ID : WEEKLY_ID, market_id: 'm1', starts_at: OCTOBER.starts_at, ends_at: OCTOBER.ends_at, state: 'calculated' }),
    'GET /v1/periods': () => json(200, { data: { calendars: [MONTHLY, WEEKLY], periods: [] }, meta: { next_cursor: null } }),
    'GET /v1/markets': () => ok([MARKET]),
    [`GET /v1/runs/${run.id}/review`]: () => ok(REVIEW),
    'GET /v1/tax/lines': () => json(200, { data: [], meta: { next_cursor: null, totals: { taxable_minor: '0', withheld_minor: '0' } } }),
    ...extra,
  })

  it('shows the True-up tab with its sentence, three figures and the payees', async () => {
    navigation.search = 'tab=true-up'
    renderAs(ANALYST, <RunReviewPage periodId="oct" runId="run-oct" />, routes(RUN, { 'GET /v1/runs/run-oct/true-up': () => json(200, { data: TRUE_UP, meta: { next_cursor: null } }) }))
    expect(await screen.findByText(/This final run trues up 2 provisional runs/)).toBeTruthy()
    const kpis = screen.getByTestId('true-up-kpis')
    expect(kpis.textContent).toContain('Final30.40 EUR')
    expect(kpis.textContent).toContain('Advances paid18.00 EUR')
    expect(kpis.textContent).toContain('True-up+12.40 EUR')
    const table = screen.getByRole('table', { name: 'True-up by payee' })
    expect(within(table).getByText('-3.60')).toBeTruthy()
    expect(within(table).getAllByText('16.00')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /Credit awards/ })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/estimated next payout|projected/i)
  })

  it('lists the credit awards of the run with totals per type', async () => {
    navigation.search = 'tab=credit-awards'
    const award = { id: 'aw1', participant: { id: 'pa', external_ref: 'BE-A' }, position_ref: 'P-A', rule_key: 'loyalty_credit', credit_type: { code: 'PRODUCT_CREDIT', name: 'Product credit' }, amount_minor: '900', expiry_days: 30, taxable: false }
    renderAs(ANALYST, <RunReviewPage periodId="oct" runId="run-oct" />, routes(RUN, {
      'GET /v1/runs/run-oct/credit-awards': () => json(200, { data: [award], meta: { next_cursor: null, totals: [{ credit_type: award.credit_type, amount_minor: '1900' }] } }),
    }))
    expect(await screen.findByText('Awarded as credits, not paid in cash: 19.00 EUR in Product credit. The expiry counts from the commit.')).toBeTruthy()
    expect(screen.getByText('30 days after commit')).toBeTruthy()
  })

  it('marks an advance run and links its final calendar; no true-up or credit tab without them', async () => {
    const advance: RunDetail = { ...RUN, id: 'run-w1', period_id: 'w1', provisional: { final_period_id: 'oct', final_calendar_id: MONTHLY_ID }, true_up: null, credit_awards_minor: '0' }
    navigation.pathname = '/periods/w1/runs/run-w1/review'
    renderAs(ANALYST, <RunReviewPage periodId="w1" runId="run-w1" />, routes(advance, {
      'GET /v1/periods/oct': () => ok({ id: 'oct', calendar_id: MONTHLY_ID, market_id: 'm1', starts_at: OCTOBER.starts_at, ends_at: OCTOBER.ends_at, state: 'open', runs: [] }),
    }))
    expect(await screen.findByText('Advance run')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the final calendar' }).getAttribute('href')).toBe(`/periods?calendar=${MONTHLY_ID}`)
    expect(screen.queryByRole('tab', { name: /True-up/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Credit awards/ })).toBeNull()
  })

  it('links an advance run to the review of its final period once that period has results', async () => {
    const advance: RunDetail = { ...RUN, id: 'run-w1', period_id: 'w1', provisional: { final_period_id: 'oct', final_calendar_id: MONTHLY_ID }, true_up: null, credit_awards_minor: '0' }
    const finalRun = { id: 'run-oct', state: 'calculated', prepared_by: { id: 'u9', display_name: 'Ann Analyst' }, started_at: null, finished_at: null, gross_minor: '1240' }
    renderAs(ANALYST, <RunReviewPage periodId="w1" runId="run-w1" />, routes(advance, {
      'GET /v1/periods/oct': () => ok({ id: 'oct', calendar_id: MONTHLY_ID, market_id: 'm1', starts_at: OCTOBER.starts_at, ends_at: OCTOBER.ends_at, state: 'calculated', runs: [finalRun] }),
    }))
    expect((await screen.findByRole('link', { name: "Open the final period's review" })).getAttribute('href')).toBe('/periods/oct/runs/run-oct/review')
    expect(screen.queryByRole('link', { name: 'Open the final calendar' })).toBeNull()
  })
})
