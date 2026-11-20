// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { apiError, json, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { ChangePage, changeSteps } from './change-page'
import { filingErrors } from './filing-dialog'
import { FINANCE, MARKET, OFFICER, plan, PLAN_ID, PLANNER, version } from './test-fixtures'
import type { Governance, VersionView } from './types'
import { refusalLines } from './ui'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/plans', useSearchParams: () => new URLSearchParams('') }))

const VERSION_PATH = `/v1/plans/${PLAN_ID}/versions/1`
const RUN_ID = '00000000-0000-4000-8000-000000000301'

function governance(overrides: Partial<Governance> = {}): Governance {
  return {
    version: { id: 'v', version: 1, state: 'in_review', effective_from: null, notice_sent_at: null, notice_recipients: null },
    items: [
      { key: 'simulation', ok: true, reason: null, details: null },
      { key: 'goldens', ok: true, reason: null, details: null },
      { key: 'guardrails', ok: true, reason: null, details: { decisions: [] } },
      { key: 'transitions', ok: true, reason: null, details: { state_items: [] } },
      { key: 'filing', ok: false, reason: 'A market requires a recorded filing status for this version.', details: { market_ids: [MARKET.id] } },
      { key: 'notice', ok: true, reason: "Schedule on or after 2026-12-20 (30 days' notice).", details: null },
      { key: 'approvals', ok: false, reason: 'The version needs the compliance approval and the activation approval.', details: null },
    ],
    filings: [{ market: { id: MARKET.id, code: 'TM' }, required: true, current: null, history: [] }],
    notice: { days: 30, earliest_effective_from: '2026-12-20T10:00:00.000Z', sent_at: null, recipients: null },
    approvals: { compliance: null, activation: null },
    first_run_id: null,
    ...overrides,
  }
}

function routes(view: VersionView, gov: Governance, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/plans/${PLAN_ID}`]: () => ok(plan()),
    [`GET ${VERSION_PATH}`]: () => json(200, { data: view, meta: {} }),
    [`GET ${VERSION_PATH}/governance`]: () => ok(gov),
    'GET /v1/markets': () => ok([MARKET]),
    ...extra,
  })
}

const IN_REVIEW = version({ state: 'in_review', submitted_by: PLANNER.user.id, submitted_at: '2026-11-18T08:00:00.000Z', transitions: [{ state_item: 'title.main', rule: 'carry', map: [], reason: null }] })

describe('SC-44 plan change workflow', () => {
  it('derives the six stages from the governance view', () => {
    const steps = changeSteps(governance(), 'Europe/Berlin')
    expect(steps.map((s) => `${s.label}:${s.status}`)).toEqual([
      'Draft:done', 'Simulation:done', 'Compliance review:current', 'Filing:blocked', 'Notice:todo', 'Scheduled:todo',
    ])
    expect(steps[3]!.detail).toBe('Missing: TM')
    const scheduled = changeSteps(governance({
      version: { id: 'v', version: 1, state: 'scheduled', effective_from: '2026-12-31T23:00:00.000Z', notice_sent_at: '2026-11-20T10:00:00.000Z', notice_recipients: 12 },
      approvals: { compliance: { by: { id: OFFICER.user.id, display_name: 'Cleo Compliance' }, at: '2026-11-19T10:00:00.000Z' }, activation: null },
      notice: { days: 30, earliest_effective_from: null, sent_at: '2026-11-20T10:00:00.000Z', recipients: 12 },
    }), 'Europe/Berlin')
    expect(scheduled.map((s) => s.status)).toEqual(['done', 'done', 'done', 'todo', 'done', 'done'])
    // BUG-124: Jan 1, 2027 00:00 Europe/Berlin is its own day, not the UTC day before.
    expect(scheduled[5]!.detail).toBe('From Jan 1, 2027')
    expect(scheduled[2]!.detail).toBe('Approved Nov 19, 2026')
  })

  it('checks what each filing status must carry', () => {
    expect(filingErrors('', { reference: '', filedOn: '', note: '', hasEvidence: false })).toEqual({ status: 'Choose the filing status.' })
    expect(Object.keys(filingErrors('filed', { reference: '', filedOn: '', note: '', hasEvidence: false }))).toEqual(['reference', 'filed_on', 'document'])
    expect(Object.keys(filingErrors('not_required', { reference: '', filedOn: '', note: '', hasEvidence: true }))).toEqual(['note'])
    expect(filingErrors('acknowledged', { reference: 'R', filedOn: '2026-11-20', note: '', hasEvidence: true })).toEqual({})
  })

  it('names the markets of a FILING_STATUS_MISSING refusal', () => {
    const refusal = new ApiError(422, 'FILING_STATUS_MISSING', 'Record the filing status of every market that requires one first.', { market_ids: [MARKET.id] })
    expect(refusalLines(refusal, { market: () => 'DE' })).toEqual(['Record the filing status for DE first.'])
  })

  it('shows the checklist, filings, notice and transitions; a compliance officer records a filing with evidence', async () => {
    const fetchMock = routes(IN_REVIEW, governance(), {
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1_000_000, types: ['application/pdf'] }),
      'POST /v1/documents': () => ok({ id: 'doc-1', file_name: 'filing.pdf', mime: 'application/pdf', size_bytes: 3, sha256: 'ab' }, 201),
      [`POST ${VERSION_PATH}/filings`]: () => ok({ id: 'f1' }, 201),
    })
    renderAs(OFFICER, <ChangePage planId={PLAN_ID} version={1} />, fetchMock)
    const checks = await screen.findByRole('list', { name: 'Checks before scheduling' })
    expect(within(checks).getByText('Filing status per market')).toBeTruthy()
    expect(within(checks).getByText('Missing: TM')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Plan change stages' })).toBeTruthy()
    expect(screen.getByText('30 days')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the Transitions tab' }).getAttribute('href')).toBe('/plans/00000000-0000-4000-8000-0000000000a1/versions/1?tab=transitions')
    expect(screen.queryByRole('link', { name: 'Transition report' })).toBeNull()
    // Approve absent for an author is covered by GovernanceBar; the officer did not write it.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Record filing for TM' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText(/^Filed/))
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'DE-2026-17')
    await userEvent.type(within(dialog).getByLabelText('Date'), '2026-11-20')
    const file = new File(['%PDF'], 'filing.pdf', { type: 'application/pdf' })
    await userEvent.upload(await within(dialog).findByLabelText('Evidence'), file)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record filing' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', `${VERSION_PATH}/filings`)).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'POST', `${VERSION_PATH}/filings`)[0]!
    expect(bodyOf(init)).toEqual({ market_id: MARKET.id, status: 'filed', document_id: 'doc-1', reference: 'DE-2026-17', filed_on: '2026-11-20' })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
  })

  it('hides Approve from the version author and links the transition report of the first run', async () => {
    const view = version({ ...IN_REVIEW, created_by: OFFICER.user.id })
    renderAs(OFFICER, <ChangePage planId={PLAN_ID} version={1} />, routes(view, governance({ first_run_id: RUN_ID }), {
      [`GET /v1/runs/${RUN_ID}`]: () => ok({ id: RUN_ID, period_id: 'per-1' }),
    }))
    expect((await screen.findByRole('link', { name: 'Transition report' })).getAttribute('href')).toBe(`/periods/per-1/runs/${RUN_ID}/review?tab=changes`)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByText(/You wrote or submitted this version/)).toBeTruthy()
  })

  it('tells a user who cannot read the first run who opens its transition report', async () => {
    const view = version({ ...IN_REVIEW, created_by: OFFICER.user.id })
    renderAs(OFFICER, <ChangePage planId={PLAN_ID} version={1} />, routes(view, governance({ first_run_id: RUN_ID }), {
      [`GET /v1/runs/${RUN_ID}`]: () => apiError(403, 'FORBIDDEN', 'You do not have permission to do this.'),
    }))
    expect(await screen.findByText('A run reviewer can open the transition report of the first run under this version.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Transition report' })).toBeNull()
  })

  it('explains open items to the Finance approver before scheduling', async () => {
    const approved = version({ state: 'approved', submitted_by: PLANNER.user.id, approved_by: OFFICER.user.id })
    renderAs(FINANCE, <ChangePage planId={PLAN_ID} version={1} />, routes(approved, governance({ version: { ...governance().version, state: 'approved' } })))
    expect(await screen.findByRole('button', { name: 'Schedule' })).toBeTruthy()
    expect(screen.getByText(/Open before scheduling: filing status per market/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Record filing/ })).toBeNull()
  })
})
