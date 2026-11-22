// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { migrationSteps, stateText } from './format'
import { MigrationPage } from './migration-page'
import { cutoverChoices, MigrationsList, monthIn, periodWindow } from './migrations-list'
import { unmappedTypes } from './parallel-run'
import type { Difference, Migration, ParallelRun } from './types'

const navigation = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router, usePathname: () => '/imports/migration', useSearchParams: () => new URLSearchParams('') }))

const ID = '00000000-0000-4000-8000-00000000a001'
const CONSULTANT = adminMe({ user: { id: '00000000-0000-4000-8000-000000000201', email: 'c@x.example', display_name: 'Cora Consultant' }, permissions: ['migration.manage', 'import.manage', 'plan.read', 'period.read'] })
const FINANCE = adminMe({ user: { id: '00000000-0000-4000-8000-000000000202', email: 'f@x.example', display_name: 'Fay Finance' }, permissions: ['migration.signoff', 'ledger.read'] })
const MARKET = { id: 'm-at', code: 'AT', name: 'Austria', currency: 'EUR', state: 'draft', market_pack: 'e2e-fixture', time_zone: 'Europe/Vienna', languages: ['de'], minor_unit: 2 }
const CUTOVER = { id: 'per-c', starts_at: '2026-09-30T22:00:00.000Z', ends_at: '2026-10-31T23:00:00.000Z', state: 'open' }
const PATH = `/v1/migrations/${ID}`

function migration(overrides: Partial<Migration> = {}): Migration {
  return {
    id: ID, market: { id: MARKET.id, code: 'AT', currency: 'EUR' },
    batch: { id: 'batch-1', period_from: '2026-08', period_to: '2026-10', row_counts: { participants: 3, orders: 4, payout_lines: 4 } },
    cutover_period: CUTOVER, volume_key: 'pv', state: 'draft', applied_counts: null, applied_at: null,
    opening: { balances: { count: 0, total_minor: '0' }, state_rows: 0, submitted_by: null, submitted_at: null, approval: null, journal_entry_id: null },
    latest_parallel_run: null, signoff: null, legacy_bonus_types: ['retail', 'unilevel'], created_by: CONSULTANT.user.id, created_at: '2026-11-20T08:00:00.000Z', ...overrides,
  }
}

const APPLIED = { participants: 3, positions: 3, relationships: 2, servicing: 0, orders: 4, refund_events: 0 }
const RUN: ParallelRun = {
  id: 'run-1', state: 'compared', bonus_map: { unilevel: 'unilevel' }, legacy_total_minor: '5201', platform_total_minor: '4700', error: null,
  requested_at: '2026-11-20T09:00:00.000Z', compared_at: '2026-11-20T09:01:00.000Z',
  summary: { payees: 3, zero: 1, by_class: { rule: 0, data: 0, rounding: 0, unclassified: 2 }, accepted: 0, unexplained: 2 }, bonus_detail_missing: true,
}
const diff = (id: string, ref: string, overrides: Partial<Difference> = {}): Difference => ({
  id, participant: { id: `p-${ref}`, external_ref: ref, display_name: null }, payee_ref: ref, rule_key: 'unilevel', legacy_bonus_types: ['unilevel'], bonus_detail: true,
  legacy_minor: '2401', platform_minor: '2400', delta_minor: '-1', class: null, class_note: null, classified_by: null, accepted_at: null, ...overrides,
})
const DIFFS = [
  diff('d-a', 'AT-A', { legacy_minor: '2300', platform_minor: '2300', delta_minor: '0' }),
  diff('d-b', 'AT-B'),
  diff('d-c', 'AT-C', { rule_key: null, legacy_bonus_types: ['retail'], bonus_detail: false, legacy_minor: '500', platform_minor: '0', delta_minor: '-500', class: 'rule', class_note: 'legacy retail bonus outside the plan', classified_by: CONSULTANT.user.id }),
]

function routes(view: Migration, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET ${PATH}`]: () => ok(view),
    'GET /v1/markets': () => ok([MARKET]),
    [`GET ${PATH}/opening`]: () => json(200, { data: [], meta: { next_cursor: null } }),
    [`GET ${PATH}/parallel-runs`]: () => ok([RUN]),
    [`GET ${PATH}/parallel-runs/run-1/differences`]: (query) => json(200, { data: query.get('filter') === 'unexplained' ? DIFFS.slice(1) : DIFFS, meta: { next_cursor: null } }),
    'GET /v1/plans': () => ok([{ id: 'plan-at', name: 'AT core', brand: null, markets: [{ id: MARKET.id, code: 'AT' }], calendars: [], current_version: { id: 'v1', version: 1, state: 'active', effective_from: CUTOVER.starts_at }, authoring_version: null }]),
    'GET /v1/plans/plan-at/versions/1': () => ok({ rules: [{ rule_key: 'pv', kind: 'volume.personal' }, { rule_key: 'unilevel', kind: 'pay.percent_by_level' }] }),
    ...extra,
  })
}

describe('migration format', () => {
  it('derives the five steps and words staged state', () => {
    expect(migrationSteps(migration()).map((s) => s.status)).toEqual(['done', 'current', 'todo', 'todo', 'todo'])
    const comparing = migration({ state: 'opening_posted', latest_parallel_run: { id: 'run-1', state: 'compared', unexplained: 2 } })
    expect(migrationSteps(comparing).map((s) => s.status)).toEqual(['done', 'done', 'done', 'current', 'todo'])
    expect(migrationSteps(comparing)[3]!.detail).toBe('2 unexplained differences')
    expect(stateText({ paid_as: [], titles: [{ ladder: 'main', rank: 'R1' }], counters: [{ key: 'streak', value: 3 }], carry: [], one_time_flags: ['fast'], banked: [] }))
      .toBe('title.main R1, counter.streak 3, one_time.fast')
  })

  it('offers cutover periods of the batch market within the batch months', () => {
    expect(monthIn('2026-09-30T22:00:00.000Z', 'Europe/Vienna')).toBe('2026-10')
    const list = {
      calendars: [{ id: 'cal-at', name: 'AT monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Vienna', market: { id: MARKET.id, code: 'AT' }, plan: null, provisional_for: null, provisional_calendars: [] }],
      periods: [
        { ...CUTOVER, calendar_id: 'cal-at', cut_off_passed: true, state: 'open' as const, committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 }, closed_at: null, closed_by: null },
        { ...CUTOVER, id: 'per-next', starts_at: '2026-10-31T23:00:00.000Z', ends_at: '2026-11-30T23:00:00.000Z', calendar_id: 'cal-at', cut_off_passed: false, state: 'open' as const, committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 }, closed_at: null, closed_by: null },
      ],
    }
    expect(cutoverChoices({ market: 'AT', period_from: '2026-08', period_to: '2026-10' }, MARKET, list).map((c) => c.value)).toEqual(['per-c'])
    expect(cutoverChoices({ market: 'DE', period_from: '2026-08', period_to: '2026-10' }, MARKET, list)).toEqual([])
    expect(cutoverChoices({ market: 'AT', period_from: '2026-08', period_to: '2026-10' }, undefined, list)).toEqual([])
  })

  it('works out the cutover month in the market zone, as the server checks it, not the calendar cut-off zone', () => {
    // Midnight 1 August in Vienna is still July in UTC: the server (market zone) accepts it as a month of the batch.
    const list = {
      calendars: [{ id: 'cal-utc', name: 'AT monthly UTC cut-off', cadence: 'monthly', cutoff_time_zone: 'UTC', market: { id: MARKET.id, code: 'AT' }, plan: null, provisional_for: null, provisional_calendars: [] }],
      periods: [{ ...CUTOVER, id: 'per-aug', starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z', calendar_id: 'cal-utc', cut_off_passed: true, state: 'open' as const, committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 }, closed_at: null, closed_by: null }],
    }
    expect(cutoverChoices({ market: 'AT', period_from: '2026-08', period_to: '2026-10' }, MARKET, list).map((c) => c.value)).toEqual(['per-aug'])
    expect(cutoverChoices({ market: 'AT', period_from: '2026-06', period_to: '2026-07' }, MARKET, list)).toEqual([])
  })

  it('bounds the period request around the batch months with a day of zone slack', () => {
    expect(periodWindow({ period_from: '2026-08', period_to: '2026-12' })).toEqual({ from: '2026-07-31T00:00:00.000Z', to: '2027-02-02T00:00:00.000Z' })
  })

  it('lists the batch\'s legacy bonus types the bonus map left unmapped', () => {
    expect(unmappedTypes(migration({ legacy_bonus_types: ['', 'FAST_START', 'retail', 'unilevel'] }), RUN)).toEqual(['', 'FAST_START', 'retail'])
  })
})

describe('SC-16 migrations list', () => {
  it('lists migrations and creates one from a loaded migration batch', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/migrations': () => json(200, { data: [migration()], meta: { next_cursor: null } }),
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/imports': (query) => (query.get('kind') === 'migration' && query.get('state') === 'loaded'
        ? ok([{ id: 'batch-1', kind: 'migration', market: 'AT', period_from: '2026-08', period_to: '2026-10' }]) : ok([])),
      'GET /v1/periods': () => ok({
        calendars: [{ id: 'cal-at', name: 'AT monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Vienna', market: { id: MARKET.id, code: 'AT' }, plan: null, provisional_for: null, provisional_calendars: [] }],
        periods: [{ ...CUTOVER, calendar_id: 'cal-at', cut_off_passed: true, committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 }, closed_at: null, closed_by: null }],
      }),
      'POST /v1/migrations': () => ok(migration(), 201),
    })
    renderAs(CONSULTANT, <MigrationsList />, fetchMock)
    expect(await screen.findByRole('link', { name: 'Open migration AT' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'New migration' }))
    const dialog = await screen.findByRole('dialog')
    const batchOption = await within(dialog).findByRole('option', { name: 'AT · 2026-08 to 2026-10' })
    expect(callsTo(fetchMock, 'GET', '/v1/periods')).toHaveLength(0) // no period list before a batch is chosen
    await userEvent.selectOptions(within(dialog).getByLabelText('Migration batch'), batchOption)
    await userEvent.selectOptions(within(dialog).getByLabelText('Cutover period'), await within(dialog).findByRole('option', { name: /AT monthly/ }))
    await userEvent.type(within(dialog).getByLabelText('Volume key'), 'pv')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create migration' }))
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith(`/imports/migration/${ID}`))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/migrations')[0]![1])).toEqual({ import_batch_id: 'batch-1', cutover_period_id: 'per-c', volume_key: 'pv' })
    const periodsUrl = new URL(callsTo(fetchMock, 'GET', '/v1/periods')[0]![0], 'http://x')
    expect(periodsUrl.searchParams.get('from')).toBe('2026-07-31T00:00:00.000Z')
    expect(periodsUrl.searchParams.get('to')).toBe('2026-12-02T00:00:00.000Z')
  })
})

describe('SC-16 migration detail', () => {
  it('applies a draft after confirmation and lists the refusal findings', async () => {
    const fetchMock = routes(migration(), {
      [`POST ${PATH}/apply`]: () => apiError(422, 'MIGRATION_INVALID', 'The batch cannot be applied; nothing was written.', { findings: [{ code: 'TYPE_UNKNOWN', ref: 'FXDIST', detail: 'no active participant type FXDIST' }] }),
    })
    renderAs(CONSULTANT, <MigrationPage migrationId={ID} />, fetchMock)
    expect(await screen.findByText(/Apply cannot be undone/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel migration' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Apply migration' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply migration' }))
    expect(await screen.findByText(/no active participant type FXDIST/)).toBeTruthy()
    expect(headerOf(callsTo(fetchMock, 'POST', `${PATH}/apply`)[0]![1], 'Idempotency-Key')).toBeTruthy()
  })

  it('stages opening balances with the control total in minor units and shows a mismatch with both totals', async () => {
    let mismatch = true
    const fetchMock = routes(migration({ state: 'applied', applied_counts: APPLIED, applied_at: '2026-11-20T08:30:00.000Z' }), {
      [`PUT ${PATH}/opening-balances`]: () => (mismatch
        ? apiError(422, 'CONTROL_TOTAL_MISMATCH', 'The amounts do not sum to the control total.', { control_total_minor: '900', total_minor: '950' })
        : ok({ count: 2, total_minor: '950' })),
    })
    renderAs(CONSULTANT, <MigrationPage migrationId={ID} />, fetchMock)
    const applied = await screen.findByRole('list', { name: 'Applied rows' })
    expect(applied.textContent).toContain('Sponsor relationships')
    await userEvent.upload(screen.getByLabelText('Balances'), new File(['payee_id,amount_minor\nAT-A,1250\nAT-C,-300\n'], 'opening_balances.csv', { type: 'text/csv' }))
    await userEvent.type(screen.getByLabelText('Control total'), '9.00')
    await userEvent.click(screen.getByRole('button', { name: 'Upload balances' }))
    expect(await screen.findByText(/The amounts sum to 9.50 EUR, not the control total 9.00 EUR/)).toBeTruthy()
    const [url, init] = callsTo(fetchMock, 'PUT', `${PATH}/opening-balances`)[0]!
    expect(url).toContain('control_total_minor=900')
    expect(headerOf(init, 'Content-Type')).toBe('text/csv')
    mismatch = false
    await userEvent.clear(screen.getByLabelText('Control total'))
    await userEvent.type(screen.getByLabelText('Control total'), '9.50')
    await userEvent.click(screen.getByRole('button', { name: 'Upload balances' }))
    expect(await screen.findByText('2 balances staged, total 9.50 EUR.')).toBeTruthy()
  })

  it('lets a Finance approver who did not submit decide the opening', async () => {
    const fetchMock = routes(migration({
      state: 'opening_submitted', applied_counts: APPLIED,
      opening: { balances: { count: 2, total_minor: '950' }, state_rows: 1, submitted_by: CONSULTANT.user.id, submitted_at: '2026-11-20T08:40:00.000Z', approval: null, journal_entry_id: null },
    }), { [`POST ${PATH}/opening/decision`]: () => ok({ state: 'opening_posted', journal_entry_id: 'je-1' }) })
    renderAs(FINANCE, <MigrationPage migrationId={ID} />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Matches the legacy ledger')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and post' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', `${PATH}/opening/decision`)).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'POST', `${PATH}/opening/decision`)[0]![1])).toEqual({ decision: 'approve', reason: 'Matches the legacy ledger' })
  })

  it('shows the comparison with the payee-level banner, filters, classifies, and keeps sign-off disabled with the unexplained count', async () => {
    const view = migration({
      state: 'opening_posted', applied_counts: APPLIED, latest_parallel_run: { id: 'run-1', state: 'compared', unexplained: 2 },
      opening: { balances: { count: 2, total_minor: '950' }, state_rows: 1, submitted_by: CONSULTANT.user.id, submitted_at: null, approval: { id: 'ap', by: FINANCE.user, at: '2026-11-20T08:50:00.000Z' }, journal_entry_id: 'je-1' },
    })
    const fetchMock = routes(view, { [`POST ${PATH}/parallel-runs/run-1/differences/d-b/classify`]: () => ok({ ...DIFFS[1], class: 'rounding' }) })
    renderAs(CONSULTANT, <MigrationPage migrationId={ID} />, fetchMock)
    const kpis = await screen.findByTestId('kpis')
    expect(kpis.textContent).toContain('52.01 EUR')
    expect(kpis.textContent).toContain('47.00 EUR')
    expect(screen.getByText('Legacy file lacks bonus detail')).toBeTruthy()
    expect(await screen.findByText(/Not mapped: retail\. Check the map for a misspelt type/)).toBeTruthy()
    expect(screen.getByTestId('differences-summary').textContent).toBe('3 payees compared: 2 differences unexplained, 0 accepted, 1 row without a difference.')
    expect(await screen.findByText('Payee level')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Approval' })).getByText('2 unexplained differences')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign off' })).toBeNull() // the creator never signs off
    expect((screen.getByLabelText('Plan rule for unilevel') as HTMLSelectElement).value).toBe('unilevel')
    expect((screen.getByLabelText('Plan rule for retail') as HTMLSelectElement).value).toBe('') // the batch's type, to be mapped

    await userEvent.click(screen.getByRole('button', { name: 'Unexplained' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'GET', `${PATH}/parallel-runs/run-1/differences`).some(([url]) => url.includes('filter=unexplained'))).toBe(true))

    await userEvent.click(await screen.findByRole('button', { name: 'Classify AT-B unilevel' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText(/^Rounding/))
    await userEvent.type(within(dialog).getByLabelText('Note'), 'legacy rounds up')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Classify' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', `${PATH}/parallel-runs/run-1/differences/d-b/classify`)).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'POST', `${PATH}/parallel-runs/run-1/differences/d-b/classify`)[0]![1])).toEqual({ class: 'rounding', note: 'legacy rounds up' })
  })

  it('sends a retried Run comparison with the same Idempotency-Key until the map changes', async () => {
    const view = migration({ state: 'opening_posted', latest_parallel_run: { id: 'run-1', state: 'compared', unexplained: 2 } })
    const fetchMock = routes(view, { [`POST ${PATH}/parallel-runs`]: () => apiError(409, 'MIGRATION_STATE', 'The service is unavailable.') })
    renderAs(CONSULTANT, <MigrationPage migrationId={ID} />, fetchMock)
    await screen.findByLabelText('Plan rule for retail')
    await userEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    await screen.findByText(/The service is unavailable/)
    await userEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', `${PATH}/parallel-runs`)).toHaveLength(2))
    await userEvent.selectOptions(screen.getByLabelText('Plan rule for retail'), 'unilevel')
    await userEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', `${PATH}/parallel-runs`)).toHaveLength(3))
    const keys = callsTo(fetchMock, 'POST', `${PATH}/parallel-runs`).map(([, init]) => headerOf(init, 'Idempotency-Key'))
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
    expect(bodyOf(callsTo(fetchMock, 'POST', `${PATH}/parallel-runs`)[2]![1])).toEqual({ bonus_map: { retail: 'unilevel', unilevel: 'unilevel' } })
  })

  it('offers the batch\'s legacy bonus types before the first comparison (BUG-125)', async () => {
    const view = migration({ state: 'opening_posted', applied_counts: APPLIED })
    renderAs(CONSULTANT, <MigrationPage migrationId={ID} />, routes(view, { [`GET ${PATH}/parallel-runs`]: () => ok([]) }))
    expect((await screen.findByLabelText('Plan rule for retail') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Plan rule for unilevel') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByRole('textbox', { name: /Legacy bonus type/ })).toBeNull()
    expect(screen.getByText('No comparison has run yet.')).toBeTruthy()
  })

  it('names the eligible approvers when the opening decision is refused for separation of duties', async () => {
    const fetchMock = routes(migration({
      state: 'opening_submitted', applied_counts: APPLIED,
      opening: { balances: { count: 2, total_minor: '950' }, state_rows: 1, submitted_by: CONSULTANT.user.id, submitted_at: '2026-11-20T08:40:00.000Z', approval: null, journal_entry_id: null },
    }), { [`POST ${PATH}/opening/decision`]: () => apiError(422, 'SOD_SELF_APPROVAL', 'You staged these files.', { eligible_approvers: [{ user_id: 'u9', display_name: 'Gil Gold', email: 'gil@acme.example' }] }) })
    renderAs(FINANCE, <MigrationPage migrationId={ID} />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Matches the legacy ledger')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and post' }))
    expect(await within(dialog).findByText(/Who can decide it: Gil Gold/)).toBeTruthy()
  })

  it('says the market could not be loaded instead of blaming the control total', async () => {
    const fetchMock = routes(migration({ state: 'applied', applied_counts: APPLIED, applied_at: '2026-11-20T08:30:00.000Z' }), {
      'GET /v1/markets': () => apiError(409, 'MIGRATION_STATE', 'The service is unavailable.'),
    })
    renderAs(CONSULTANT, <MigrationPage migrationId={ID} />, fetchMock)
    await userEvent.upload(await screen.findByLabelText('Balances'), new File(['payee_id,amount_minor\nAT-A,950\n'], 'opening_balances.csv', { type: 'text/csv' }))
    await userEvent.type(screen.getByLabelText('Control total'), '9.50')
    await userEvent.click(screen.getByRole('button', { name: 'Upload balances' }))
    expect(await screen.findByText('The market could not be loaded; reload the page.')).toBeTruthy()
    expect(callsTo(fetchMock, 'PUT', `${PATH}/opening-balances`)).toHaveLength(0)
  })

  it('offers Accept to a Finance approver for a difference another user classified, and a disabled Sign off', async () => {
    const view = migration({ state: 'opening_posted', latest_parallel_run: { id: 'run-1', state: 'compared', unexplained: 2 } })
    renderAs(FINANCE, <MigrationPage migrationId={ID} />, routes(view))
    expect(await screen.findByRole('button', { name: 'Accept AT-C payee level' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept AT-B unilevel' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Sign off' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull()
  })
})
