// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../components/api-provider'
import { ToastProvider } from '../../components/toast'
import { SessionContext } from '../../lib/session'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { conditionsText, percentText, taxYearOf, taxYearStartText, withholdingText } from './format'
import { runChoices } from './lines-tab'
import { TaxPage } from './tax-page'
import type { Generation, TaxRules, WithholdingRule, YearEnd } from './types'
import { yearEndSteps } from './year-end-tab'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/tax',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
const saved = vi.hoisted(() => ({ saveFile: vi.fn() }))
vi.mock('../data/transfer', async (original) => ({ ...(await original<typeof import('../data/transfer')>()), saveFile: saved.saveFile }))

const MARKET = { id: '00000000-0000-4000-8000-0000000000a7', code: 'AT', name: 'Austria', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture-tax', time_zone: 'Europe/Vienna', languages: ['de'], minor_unit: 2 }
const ROLE = { role_id: 'r1', name: 'Finance approver', market_ids: null, assignment_id: 'a1' }
const FINANCE = adminMe({ permissions: ['tax.read', 'tax.forms', 'period.read'], roles: [ROLE] })
const READER = adminMe({ permissions: ['tax.read'], roles: [{ ...ROLE, name: 'Compliance officer' }] })
const AT_A = '00000000-0000-4000-8000-0000000000c1'
const AT_B = '00000000-0000-4000-8000-0000000000c2'
const PERIOD = '00000000-0000-4000-8000-0000000000e1'
const RUN = '00000000-0000-4000-8000-0000000000f1'
const BASIS = { basis_status: 'counsel_confirmed' as const, basis: 'E2E FIXTURE', source_ref: 'fixture', reviewed_by: null, reviewed_at: null, effective_from: '2020-01-01', effective_to: null }

const WITHHOLDING: WithholdingRule = {
  id: 'e2e-tax-withholding@2020-01-01', title: 'E2E FIXTURE withholding', conditions: {}, rate: '0.020000', threshold_minor: '2350',
  threshold_basis: 'current_year_cumulative', missing_id_rate: '0.200000', rounding: 'half_up', in_force: true, ...BASIS,
}

const RULES: TaxRules = {
  market: { id: MARKET.id, code: 'AT', market_pack: 'e2e-fixture-tax' },
  withholding: [WITHHOLDING],
  year_end_forms: [{ id: 'e2e-tax-form@2020-01-01', form_type: 'FX-ANNUAL', title: 'E2E FIXTURE annual statement', min_gross_minor: '2000', in_force: true, ...BASIS }],
  tax_year: { id: 'e2e-tax-year@2020-01-01', start_month: 1, start_day: 1, ...BASIS },
  tax_id_format: { id: 'e2e-tax-id@2020-01-01', label: 'FX tax id', pattern: '^FX[0-9]{6}$', ...BASIS },
}

function yearEnd(overrides: Partial<YearEnd> = {}): YearEnd {
  return {
    bounds: { starts_on: '2025-01-01', ends_on: '2025-12-31' }, ended: true, open_period_ids: [],
    form_rule: { id: 'e2e-tax-form@2020-01-01', form_type: 'FX-ANNUAL', title: 'E2E FIXTURE annual statement', min_gross_minor: '2000' },
    reasons: [], totals: { withheld_minor: '480', ledger_withheld_minor: '480', equal: true, included: 2, held: 1 },
    payees: [
      { participant: { id: AT_A, external_ref: 'AT-A' }, gross_minor: '2300', taxable_minor: '2300', withheld_minor: '0', tax_id: 'present', included: true, latest_version: null },
      { participant: { id: AT_B, external_ref: 'AT-B' }, gross_minor: '2400', taxable_minor: '2400', withheld_minor: '480', tax_id: 'missing', included: true, latest_version: null },
    ],
    ...overrides,
  }
}

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}, data: YearEnd = yearEnd()) {
  return fetchByRoute({
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/tax/rules': () => ok(RULES),
    'GET /v1/tax/year-end': () => json(200, { data, meta: { next_cursor: null } }),
    'GET /v1/tax/year-end-generations': () => ok([]),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = `market=${MARKET.id}&year=2025`
  navigation.router.replace.mockReset()
  saved.saveFile.mockReset()
})

describe('SC-12 words', () => {
  it('shows rates as percent by string arithmetic', () => {
    expect(percentText('0.020000')).toBe('2 %')
    expect(percentText('0.205000')).toBe('20.5 %')
    expect(percentText('1.000000')).toBe('100 %')
    expect(percentText('0.000000')).toBe('0 %')
  })

  it('states a withholding rule in words, and no duty for rate NULL', () => {
    expect(withholdingText(WITHHOLDING, MARKET)).toBe('2 % above 23.50 per tax year (cumulative), 20 % without a tax id, half up')
    expect(withholdingText({ ...WITHHOLDING, rate: null, threshold_minor: null, threshold_basis: null, missing_id_rate: null, rounding: 'none' }, MARKET)).toBe('No withholding duty')
    expect(conditionsText({})).toBe('Applies to every payee')
    expect(conditionsText({ entity_types: ['individual'], residency: ['AT'] })).toBe('Applies to individuals; resident in AT')
  })

  it('names the tax year containing a date from the pack rule', () => {
    expect(taxYearOf('2026-11-20', { start_month: 4, start_day: 1 })).toBe(2026)
    expect(taxYearOf('2026-03-31', { start_month: 4, start_day: 1 })).toBe(2025)
    expect(taxYearOf('2026-03-31', null)).toBe(2026)
  })

  it('offers the committed and the latest run of a period once each', () => {
    expect(runChoices({ committed_run_id: RUN, latest_run: { id: RUN, state: 'committed', gross_minor: null, finished_at: null, true_up_runs: 0 } })).toEqual([{ value: RUN, label: 'Committed run' }])
    expect(runChoices({ committed_run_id: null, latest_run: null })).toEqual([])
  })
})

describe('SC-12 Tax configuration and year-end statements', () => {
  it('shows the KPIs, the steps, validation with the ledger check and the payees', async () => {
    renderAs(FINANCE, <TaxPage />, routes())
    const kpis = await screen.findByTestId('kpis')
    expect(within(kpis).getByText('Payees due a statement').parentElement?.textContent).toContain('1')
    expect(within(kpis).getByText('Equal')).toBeTruthy()
    expect(await screen.findByRole('list', { name: 'Year-end statement steps' })).toBeTruthy()
    expect(screen.getByTestId('ledger-check').textContent).toContain('= withholding payable')
    expect(screen.getByRole('link', { name: 'AT-B' }).getAttribute('href')).toBe(`/people/${AT_B}?tab=tax`)
    expect(screen.getByRole('button', { name: 'Generate statements' })).toBeTruthy()
  })

  it('generates with an Idempotency-Key and says what was generated and held', async () => {
    const fetchMock = routes({ 'POST /v1/tax/year-end-forms': () => ok({ generation_id: 'g1', generated: 1, unchanged: 0, held: [{ participant_id: AT_B, external_ref: 'AT-B' }] }, 201) })
    renderAs(FINANCE, <TaxPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Generate statements' }))
    expect(await screen.findByText(/1 statement generated, 0 unchanged, 1 held: missing tax id\. Held: AT-B\./)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/tax/year-end-forms')[0]!
    expect(bodyOf(init)).toEqual({ market_id: MARKET.id, tax_year: 2025 })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
  })

  it('blocks Validate on a ledger mismatch, never saying the ledger is equal', () => {
    const mismatch = yearEnd({ totals: { withheld_minor: '480', ledger_withheld_minor: '470', equal: false, included: 2, held: 1 } })
    const [, validate, generate] = yearEndSteps(mismatch, [], 2025)
    expect(validate).toEqual({ label: 'Validate', status: 'blocked', detail: 'Ledger mismatch' })
    expect(generate?.status).toBe('todo')
    expect(yearEndSteps(yearEnd(), [], 2025)[1]).toEqual({ label: 'Validate', status: 'done', detail: 'Year closed, ledger equal' })
  })

  it('sends a new Idempotency-Key for a second Generate after a success', async () => {
    const fetchMock = routes({ 'POST /v1/tax/year-end-forms': () => ok({ generation_id: 'g1', generated: 1, unchanged: 0, held: [] }, 201) })
    renderAs(FINANCE, <TaxPage />, fetchMock)
    const button = await screen.findByRole('button', { name: 'Generate statements' })
    await userEvent.click(button)
    await screen.findByText('Statements generated')
    await userEvent.click(screen.getByRole('button', { name: 'Generate statements' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/tax/year-end-forms')).toHaveLength(2))
    const [first, second] = callsTo(fetchMock, 'POST', '/v1/tax/year-end-forms').map(([, init]) => headerOf(init, 'Idempotency-Key'))
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
  })

  it('moves focus to the statement inspector after Inspect', async () => {
    navigation.router.replace.mockImplementation((url: string) => {
      navigation.search = url.slice(url.indexOf('?') + 1)
    })
    const fetchMock = routes({ 'GET /v1/tax/year-end-forms': () => json(200, { data: [], meta: { next_cursor: null } }) })
    const tree = () => <ToastProvider><ApiProvider><SessionContext value={FINANCE}><TaxPage /></SessionContext></ApiProvider></ToastProvider>
    const view = renderAs(FINANCE, <TaxPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect the statement of AT-A' }))
    expect(navigation.search).toContain(`payee=${AT_A}`)
    view.rerender(tree())
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('inspector-title'))
  })

  it('refuses generation with the periods to close first', async () => {
    const fetchMock = routes({
      'POST /v1/tax/year-end-forms': () => apiError(422, 'TAX_YEAR_NOT_CLOSED', 'not closed', { period_ids: [PERIOD] }),
      [`GET /v1/periods/${PERIOD}`]: () => ok({ id: PERIOD, calendar_id: 'cal1', starts_at: '2025-11-30T23:00:00.000Z', ends_at: '2025-12-31T23:00:00.000Z' }),
      'GET /v1/periods': () => json(200, { data: { calendars: [], periods: [] }, meta: {} }),
    })
    renderAs(FINANCE, <TaxPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Generate statements' }))
    expect(await screen.findByText('Close these periods first')).toBeTruthy()
  })

  it('exports for filing after step-up and names the rows and the full tax ids', async () => {
    const fetchMock = routes({
      'POST /v1/tax/year-end-forms/export': () => new Response('payee_ref,tax_id\r\nAT-A,FX123456\r\nAT-B,FX654321\r\n', { status: 200, headers: { 'content-type': 'text/csv' } }),
    })
    renderAs(FINANCE, <TaxPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Export for filing' }))
    const count = await screen.findByTestId('export-count')
    expect(count.textContent).toContain('2 rows')
    expect(count.textContent).toContain('The file contains full tax ids')
    expect(count.textContent).toContain('recorded in the audit log')
    await userEvent.click(screen.getByRole('button', { name: 'Save CSV file' }))
    expect(saved.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'tax-statements-2025.csv')
  })

  it('offers no Generate or Export to a tax.read holder', async () => {
    renderAs(READER, <TaxPage />, routes())
    await screen.findByRole('list', { name: 'Year-end statement steps' })
    expect(screen.queryByRole('button', { name: 'Generate statements' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export for filing' })).toBeNull()
  })

  it('inspects a payee statement and downloads it', async () => {
    navigation.search = `market=${MARKET.id}&year=2025&payee=${AT_A}`
    const form = {
      id: '00000000-0000-4000-8000-0000000000d1', participant: { id: AT_A, external_ref: 'AT-A' }, form_type: 'FX-ANNUAL', version: 1, versions: 1,
      tax_id_masked: '****3456', currency: 'EUR', created_at: '2026-01-05T10:00:00.000Z',
      totals: { gross_minor: '2300', taxable_minor: '2300', withheld_minor: '0', by_rule: [{ rule_id: WITHHOLDING.id, rate: '0.000000', taxable_minor: '2300', withheld_minor: '0' }] },
    }
    const fetchMock = routes({
      'GET /v1/tax/year-end-forms': () => json(200, { data: [form], meta: { next_cursor: null } }),
      [`GET /v1/tax/year-end-forms/${form.id}/download`]: () => new Response('label,value\r\n', { status: 200, headers: { 'content-type': 'text/csv' } }),
    })
    renderAs(FINANCE, <TaxPage />, fetchMock)
    const inspector = await screen.findByTestId('inspector')
    expect(await within(inspector).findByText(/Version 1 of 1/)).toBeTruthy()
    await userEvent.click(within(inspector).getByRole('button', { name: 'Download statement (CSV)' }))
    await vi.waitFor(() => expect(saved.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'FX-ANNUAL-2025-AT-A-v1.csv'))
  })

  it('shows the pack rules: rate sentence, threshold note, screening note, no duty and the no-rule text', async () => {
    navigation.search = `market=${MARKET.id}&year=2025&tab=rules`
    renderAs(FINANCE, <TaxPage />, routes())
    const rules = await screen.findByRole('list', { name: 'Withholding rules' })
    expect(within(rules).getByText('2 % above 23.50 per tax year (cumulative), 20 % without a tax id, half up')).toBeTruthy()
    expect(within(rules).getByText(/not counted towards the threshold/)).toBeTruthy()
    expect(screen.getByText('Tax-id format: FX tax id')).toBeTruthy()
    // BUG-137: the tax year's start in words, no regular expression, no ISO dates.
    expect(screen.getByText('Starts on January 1 each year; a tax year is named by the calendar year it starts in.')).toBeTruthy()
    expect(screen.queryByText('^FX[0-9]{6}$')).toBeNull()
    expect(screen.queryByText(/From 2020-01-01/)).toBeNull()
    expect(screen.getAllByText(/From Jan 1, 2020/).length).toBeGreaterThan(0)
  })

  it('states the tax year start month by name (BUG-137)', () => {
    expect(taxYearStartText({ start_month: 11, start_day: 1 })).toBe('Starts on November 1 each year; a tax year is named by the calendar year it starts in.')
  })

  it('says when the pack has no withholding rule and when a rule is screening', async () => {
    navigation.search = `market=${MARKET.id}&year=2025&tab=rules`
    const screening = { ...RULES, withholding: [], tax_year: { ...RULES.tax_year!, basis_status: 'screening' as const } }
    renderAs(FINANCE, <TaxPage />, routes({ 'GET /v1/tax/rules': () => ok(screening) }))
    expect(await screen.findByText(/has no withholding rule: nothing is withheld and every run flags it for review/)).toBeTruthy()
    expect(screen.getByText('Screening: needs a written risk acceptance at go-live.')).toBeTruthy()
  })

  it('lists a run’s withholding lines with rate, basis and totals', async () => {
    navigation.search = `market=${MARKET.id}&year=2025&tab=lines&period=${PERIOD}`
    const periods = {
      calendars: [{ id: 'cal1', name: 'AT monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Vienna', market: { id: MARKET.id, code: 'AT' }, plan: null }],
      periods: [{ id: PERIOD, calendar_id: 'cal1', starts_at: '2025-11-30T23:00:00.000Z', ends_at: '2025-12-31T23:00:00.000Z', committed_run_id: RUN, latest_run: { id: RUN, state: 'committed', gross_minor: '4700', finished_at: null } }],
    }
    const line = { id: 'l1', payee: { id: AT_B, external_ref: 'AT-B' }, rule_id: WITHHOLDING.id, rate: '0.200000', rate_basis: 'missing_id_rate', taxable_minor: '2400', withheld_minor: '480', tax_year: 2025, tax_date: '2025-12-31' }
    const fetchMock = routes({
      'GET /v1/periods': () => json(200, { data: periods, meta: {} }),
      'GET /v1/tax/lines': () => json(200, { data: [line], meta: { next_cursor: null, totals: { taxable_minor: '4700', withheld_minor: '480' }, run: { id: RUN, state: 'committed', period_id: PERIOD } } }),
    })
    renderAs(FINANCE, <TaxPage />, fetchMock)
    expect(await screen.findByText('No tax id: higher rate')).toBeTruthy()
    expect(screen.getByText('20 %')).toBeTruthy()
    expect(screen.getByTestId('line-totals').textContent).toContain('withheld')
    // BUG-137: the rule by its title and the tax date in words.
    expect(screen.getByText('E2E FIXTURE withholding')).toBeTruthy()
    expect(screen.queryByText(WITHHOLDING.id)).toBeNull()
    expect(screen.getByText('Dec 31, 2025')).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/tax/lines')[0]![0], 'http://x').searchParams.get('run_id')).toBe(RUN)
  })

  it('lists the payees held for a missing tax id with a link to their tax tab', async () => {
    navigation.search = `market=${MARKET.id}&year=2025&tab=missing`
    renderAs(FINANCE, <TaxPage />, routes())
    const link = await screen.findByRole('link', { name: 'AT-B' })
    expect(link.getAttribute('href')).toBe(`/people/${AT_B}?tab=tax`)
    expect(screen.queryByRole('link', { name: 'AT-A' })).toBeNull()
  })

  it('lists the generations of the tax year with the held payees linked to their tax tab', async () => {
    navigation.search = `market=${MARKET.id}&year=2025&tab=history`
    const generation: Generation = {
      id: 'g1', form_type: 'FX-ANNUAL', generated: 1, unchanged: 2, held: [{ participant_id: AT_B, external_ref: 'AT-B' }], withheld_total_minor: '480',
      created_by: { id: 'u1', display_name: 'Fina Finance' }, created_at: '2026-01-05T10:00:00.000Z',
    }
    renderAs(FINANCE, <TaxPage />, routes({ 'GET /v1/tax/year-end-generations': () => ok([generation]) }))
    expect((await screen.findByRole('link', { name: 'AT-B' })).getAttribute('href')).toBe(`/people/${AT_B}?tab=tax`)
    expect(screen.getByText('By Fina Finance')).toBeTruthy()
    expect(screen.getByText('FX-ANNUAL')).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText(/4\.80/)).toBeTruthy()
  })

  it('never shows refused or filing-claim wording (TS-53)', async () => {
    const view = renderAs(FINANCE, <TaxPage />, routes())
    await screen.findByRole('list', { name: 'Year-end statement steps' })
    expect(view.container.textContent).not.toMatch(/1099|Dual Sign-Off|Sealed|certified|filed with|wallet/i)
  })
})
