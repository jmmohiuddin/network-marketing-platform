// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { ChecklistPage, screeningRules, stateSentence } from './checklist-page'
import { basisText, recordsOf } from './gate-table'
import type { Checklist, ChecklistItem, GoLiveRequest, ProviderRecord } from './types'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/markets/m1', useSearchParams: () => router.params }))

const MARKET = 'm1'
const ADMIN = adminMe({ permissions: ['market.manage', 'settings.manage'] })
const OFFICER = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000c1', email: 'cora@acme.example', display_name: 'Cora Compliance' }, permissions: ['market.signoff'] })
const CORA = { user_id: OFFICER.user.id, display_name: 'Cora Compliance', email: 'cora@acme.example' }
const SCREENING_RULE = {
  kind: 'guardrail', id: 'e2e-enrolment-only-bonus@2026-01-01', title: 'Fixture enrolment rule', mandatory: true, basis: 'Fixture basis',
  basis_status: 'screening' as const, source_ref: 'Fixture source', reviewed_by: null, reviewed_at: null, effective_from: '2026-01-01', effective_to: null,
}

function item(overrides: Partial<ChecklistItem> & Pick<ChecklistItem, 'item' | 'title' | 'kind' | 'category'>): ChecklistItem {
  return { mandatory: true, status: 'missing', entry: null, detail: null, ...overrides }
}

const ITEMS: ChecklistItem[] = [
  item({ item: 'licence_evidence', title: 'Licence or registration evidence', kind: 'evidence', category: 'regulatory' }),
  item({ item: 'payout_provider', title: 'Payout provider eligibility', kind: 'provider', category: 'payment', detail: { providers: [] } }),
  item({
    item: 'tax_configuration', title: 'Tax configuration reference', kind: 'evidence', category: 'tax', status: 'complete', detail: { rules: [] },
    entry: { id: 'e1', document: { id: 'd1', file_name: 'tax.pdf', mime: 'application/pdf', size_bytes: 10, sha256: 'ab'.repeat(32) }, note: null, recorded_by: { id: 'u1', display_name: 'Ada Admin' }, recorded_at: '2026-11-16T10:00:00.000Z' },
  }),
  item({ item: 'pack_rules', title: 'Market-pack rules basis', kind: 'automatic', category: 'regulatory', status: 'needs_risk_acceptance', detail: { rules: [SCREENING_RULE] } }),
]

function checklist(overrides: Partial<Checklist> = {}): Checklist {
  return {
    market: { id: MARKET, code: 'FR', name: 'France', state: 'draft', market_pack: 'e2e-fixture' },
    items: ITEMS,
    summary: { complete: 1, missing: 2, needs_risk_acceptance: 1 },
    pending_request: null,
    eligible_signers: [CORA],
    ...overrides,
  }
}

const PENDING: GoLiveRequest = {
  id: 'r1', market_id: MARKET, state: 'pending', requested_by: { id: ADMIN.user.id, display_name: 'Ada Admin' }, requested_at: '2026-11-17T08:00:00.000Z',
  decided_by: null, decided_at: null, decision_reason: null, risk_acceptance: null,
}

function routes(data: Checklist, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/markets/${MARKET}/checklist`]: () => json(200, { data, meta: {} }),
    [`GET /v1/markets/${MARKET}/go-live-requests`]: () => json(200, { data: data.pending_request === null ? [] : [data.pending_request], meta: {} }),
    'GET /v1/provider-configs': () => json(200, { data: [], meta: {} }),
    'GET /v1/documents/limits': () => json(200, { data: { max_file_bytes: 10485760, types: ['application/pdf', 'image/png', 'image/jpeg'] }, meta: {} }),
    ...extra,
  })
}

const PROVIDER: ProviderRecord = {
  id: 'p1', market_id: MARKET, kind: 'payout', provider: 'Sandbox Payouts Ltd', approved_description: 'Payouts to FR', approval_document: null,
  approved_at: '2026-11-01', funds_holder: 'Sandbox bank', state: 'recorded', created_by: { id: 'u1', display_name: 'Ada Admin' }, created_at: '2026-11-16T09:00:00.000Z', withdrawn_at: null,
}

const PDF = () => new File(['%PDF-1.7'], 'licence.pdf', { type: 'application/pdf' })

describe('ChecklistPage', () => {
  it('names the missing items, sums the checklist and filters it by category', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams()
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist()))
    expect(await screen.findByText('Missing: Licence or registration evidence, Payout provider eligibility.')).toBeTruthy()
    expect(screen.getByTestId('card').textContent).toContain('1 of 4')
    const table = screen.getByRole('table', { name: 'Launch checklist items' })
    expect(within(table).getByText('tax.pdf')).toBeTruthy()
    expect(within(table).getByText('ab'.repeat(32))).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Payment and payout (1)' }))
    expect(router.replace).toHaveBeenLastCalledWith('/settings/markets/m1?filter=payment')
  })

  it('lists every missing item when go-live is refused', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams()
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist(), {
      [`POST /v1/markets/${MARKET}/go-live-requests`]: () => apiError(422, 'CHECKLIST_INCOMPLETE', 'The launch checklist is incomplete.', {
        missing: [{ item: 'payout_provider', title: 'Payout provider eligibility', reason: 'No recorded provider approval for this market.' }],
      }),
    }))
    await user.click(await screen.findByTestId('primary-action'))
    const link = await screen.findByRole('link', { name: 'Payout provider eligibility: No recorded provider approval for this market.' })
    expect(link.getAttribute('href')).toBe('#gate-payout_provider')
    expect(link.closest('[role=alert]')?.textContent).toContain('Go-live cannot be requested yet')
  })

  it('drops the refusal once an item is recorded: the live banner then says what is still missing (BUG-053)', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams('item=licence_evidence')
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist(), {
      [`POST /v1/markets/${MARKET}/go-live-requests`]: () => apiError(422, 'CHECKLIST_INCOMPLETE', 'The launch checklist is incomplete.', {
        missing: [{ item: 'licence_evidence', title: 'Licence or registration evidence', reason: 'No evidence document is recorded.' }],
      }),
      'POST /v1/documents': () => json(201, { data: { id: 'doc1', file_name: 'licence.pdf', mime: 'application/pdf', size_bytes: 8, sha256: 'cd'.repeat(32) }, meta: {} }),
      [`POST /v1/markets/${MARKET}/checklist/licence_evidence/entries`]: () => json(201, { data: ITEMS[0], meta: {} }),
    }))
    await user.click(await screen.findByTestId('primary-action'))
    expect(await screen.findByText('Go-live cannot be requested yet')).toBeTruthy()
    await user.upload(screen.getByLabelText('Evidence for licence or registration evidence'), PDF())
    await user.click(screen.getByRole('button', { name: 'Attach evidence file' }))
    expect(await screen.findByText('Licence or registration evidence: licence.pdf recorded.')).toBeTruthy()
    expect(screen.queryByText('Go-live cannot be requested yet')).toBeNull()
  })

  it('opens an item in the inspector from its title and fits the table in four columns (BUG-052)', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams()
    router.replace.mockClear()
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist()))
    const table = await screen.findByRole('table', { name: 'Launch checklist items' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Item', 'Basis or detail', 'Evidence and record', 'Status'])
    const title = within(table).getByRole('button', { name: 'Tax configuration reference' })
    expect(title.id).toBe('gate-tax_configuration')
    await user.click(title)
    expect(router.replace).toHaveBeenLastCalledWith('/settings/markets/m1?item=tax_configuration')
    expect(within(table).getByText('Recorded by Ada Admin', { exact: false })).toBeTruthy()
  })

  it('says who recorded each provider approval in the gate table (BUG-058)', async () => {
    router.params = new URLSearchParams()
    const items = ITEMS.map((entry) => (entry.item === 'payout_provider'
      ? { ...entry, status: 'complete' as const, detail: { providers: [{ id: 'p1', provider: 'Sandbox Payouts Ltd' }] } }
      : entry))
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist({ items }), {
      'GET /v1/provider-configs': () => json(200, { data: [PROVIDER], meta: {} }),
    }))
    const table = await screen.findByRole('table', { name: 'Launch checklist items' })
    const row = within(table).getByRole('button', { name: 'Payout provider eligibility' }).closest('tr')!
    expect(await within(row).findByText(/^Recorded by Ada Admin, /)).toBeTruthy()
  })

  it('shows every item again when go-live is refused under a category filter, so each summary link lands', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams('filter=tax')
    router.replace.mockClear()
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist(), {
      [`POST /v1/markets/${MARKET}/go-live-requests`]: () => apiError(422, 'CHECKLIST_INCOMPLETE', 'The launch checklist is incomplete.', {
        missing: [{ item: 'licence_evidence', title: 'Licence or registration evidence', reason: 'No evidence recorded.' }],
      }),
    }))
    await user.click(await screen.findByTestId('primary-action'))
    expect(await screen.findByRole('link', { name: 'Licence or registration evidence: No evidence recorded.' })).toBeTruthy()
    expect(router.replace).toHaveBeenLastCalledWith('/settings/markets/m1?filter=all')
  })

  it('says when provider approvals fail to load and offers no recording until they load', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams('item=payout_provider')
    let fail = true
    const fetchMock = routes(checklist(), {
      'GET /v1/provider-configs': () => (fail ? apiError(500, 'INTERNAL', 'Boom.') : json(200, { data: [], meta: {} })),
    })
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, fetchMock)
    const inspector = await screen.findByRole('complementary', { name: 'Payout provider eligibility' })
    await within(inspector).findByRole('button', { name: 'Try again' })
    expect(within(inspector).queryByText('No provider approval is recorded for this market.')).toBeNull()
    expect(within(inspector).queryByRole('button', { name: 'Record provider approval' })).toBeNull()
    fail = false
    await user.click(within(inspector).getByRole('button', { name: 'Try again' }))
    expect(await within(inspector).findByText('No provider approval is recorded for this market.')).toBeTruthy()
    expect(within(inspector).getByRole('button', { name: 'Record provider approval' })).toBeTruthy()
  })

  it('offers no evidence upload when the allowed file types fail to load', async () => {
    router.params = new URLSearchParams('item=licence_evidence')
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist(), {
      'GET /v1/documents/limits': () => apiError(500, 'INTERNAL', 'Boom.'),
    }))
    const inspector = await screen.findByRole('complementary', { name: 'Licence or registration evidence' })
    expect(await within(inspector).findByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(within(inspector).queryByRole('button', { name: 'Attach evidence file' })).toBeNull()
  })

  it('downloads evidence with the support-session header in a support session', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams('item=tax_configuration')
    window.sessionStorage.setItem('nmp-support-session-id', 's1')
    const saved = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    URL.createObjectURL = vi.fn(() => 'blob:tax')
    URL.revokeObjectURL = vi.fn()
    const me = adminMe({ permissions: ['market.manage'], support_session: { id: 's1', tenant_slug: 'acme', ends_at: '2026-11-17T12:00:00.000Z', scope: { permissions: ['market.manage'] } } })
    const fetchMock = routes(checklist(), { 'GET /v1/documents/d1/content': () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }) })
    try {
      renderAs(me, <ChecklistPage marketId={MARKET} />, fetchMock)
      const table = await screen.findByRole('table', { name: 'Launch checklist items' })
      expect(within(table).queryByRole('link', { name: 'tax.pdf' })).toBeNull()
      await user.click(within(table).getByRole('button', { name: 'tax.pdf' }))
      await vi.waitFor(() => expect(saved).toHaveBeenCalled())
      expect(headerOf(callsTo(fetchMock, 'GET', '/v1/documents/d1/content')[0]![1], 'X-Support-Session')).toBe('s1')
    } finally {
      window.sessionStorage.clear()
      saved.mockRestore()
    }
  })

  it('uploads evidence once, then records it as the item’s entry', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams('item=licence_evidence')
    const fetchMock = routes(checklist(), {
      'POST /v1/documents': () => json(201, { data: { id: 'doc1', file_name: 'licence.pdf', mime: 'application/pdf', size_bytes: 8, sha256: 'cd'.repeat(32) }, meta: {} }),
      [`POST /v1/markets/${MARKET}/checklist/licence_evidence/entries`]: () => json(201, { data: ITEMS[0], meta: {} }),
    })
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, fetchMock)
    await user.upload(await screen.findByLabelText('Evidence for licence or registration evidence'), PDF())
    await user.click(screen.getByRole('button', { name: 'Attach evidence file' }))
    expect(await screen.findByText('Licence or registration evidence: licence.pdf recorded.')).toBeTruthy()
    const [, upload] = callsTo(fetchMock, 'POST', '/v1/documents')[0]!
    const form = upload.body as FormData
    expect(form.get('class')).toBe('evidence')
    expect((form.get('file') as File).name).toBe('licence.pdf')
    expect(headerOf(upload, 'Idempotency-Key')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `/v1/markets/${MARKET}/checklist/licence_evidence/entries`)[0]![1])).toEqual({ document_id: 'doc1' })
  })

  it('records a payout provider approval with its document', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams('item=payout_provider')
    const fetchMock = routes(checklist(), {
      'POST /v1/documents': () => json(201, { data: { id: 'doc2', file_name: 'approval.pdf', mime: 'application/pdf', size_bytes: 8, sha256: 'ef'.repeat(32) }, meta: {} }),
      'POST /v1/provider-configs': () => json(201, { data: { id: 'p1' }, meta: {} }),
    })
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Record provider approval' }))
    const dialog = screen.getByRole('dialog', { name: 'Record payout provider approval' })
    await user.type(within(dialog).getByLabelText('Provider'), 'Sandbox Payouts')
    await user.type(within(dialog).getByLabelText('Approved on'), '2026-11-01')
    await user.type(within(dialog).getByLabelText('Funds holder'), 'Sandbox bank')
    await user.type(within(dialog).getByLabelText('What the approval covers'), 'Payouts to FR participants')
    await user.upload(within(dialog).getByLabelText('Approval document'), PDF())
    await user.click(within(dialog).getByRole('button', { name: 'Record approval' }))
    expect(await screen.findByText('Sandbox Payouts recorded as an approved payout provider.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/provider-configs')[0]![1])).toEqual({
      market_id: MARKET, kind: 'payout', provider: 'Sandbox Payouts', approved_description: 'Payouts to FR participants',
      approval_document_id: 'doc2', approved_at: '2026-11-01', funds_holder: 'Sandbox bank',
    })
  })

  it('signs off with a risk acceptance statement after step-up, keeping the Idempotency-Key', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams()
    let calls = 0
    const fetchMock = routes(checklist({ pending_request: PENDING }), {
      'POST /v1/market-go-live-requests/r1/decision': () => {
        calls += 1
        return calls === 1 ? apiError(403, 'STEP_UP_REQUIRED') : json(200, { data: { request: { ...PENDING, state: 'approved' } }, meta: {} })
      },
      'POST /v1/auth/sessions/current/step-up': () => json(200, { data: { assurance: 'aal2' }, meta: {} }),
    })
    renderAs(OFFICER, <ChecklistPage marketId={MARKET} />, fetchMock)
    expect(screen.queryByTestId('primary-action')).toBeNull()
    const bar = await screen.findByRole('region', { name: 'Approval' })
    expect(within(bar).getByText('Can sign off: Cora Compliance (cora@acme.example)')).toBeTruthy()
    await user.click(within(bar).getByRole('button', { name: 'Sign off' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign off go-live of FR' })
    // The dialog names the rule whose risk is accepted (BUG-059).
    expect(within(dialog).getByText(/Mandatory market-pack rules still at screening status: Fixture enrolment rule\./)).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Reason'), 'Checklist reviewed')
    await user.click(within(dialog).getByRole('button', { name: 'Sign off' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Enter your risk acceptance statement.')
    await user.type(within(dialog).getByLabelText('Risk acceptance statement'), 'We accept the screening-status rule.')
    await user.click(within(dialog).getByRole('button', { name: 'Sign off' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('FR is live.')).toBeTruthy()
    const decisions = callsTo(fetchMock, 'POST', '/v1/market-go-live-requests/r1/decision')
    expect(headerOf(decisions[0]![1], 'Idempotency-Key')).toBe(headerOf(decisions[1]![1], 'Idempotency-Key'))
    expect(bodyOf(decisions[1]![1])).toEqual({ decision: 'approve', reason: 'Checklist reviewed', risk_acceptance: { statement: 'We accept the screening-status rule.' } })
  })

  it('shows the separation-of-duties refusal with the eligible signers', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams()
    renderAs(OFFICER, <ChecklistPage marketId={MARKET} />, routes(checklist({ pending_request: PENDING, summary: { complete: 4, missing: 0, needs_risk_acceptance: 0 } }), {
      'POST /v1/market-go-live-requests/r1/decision': () => apiError(422, 'SOD_SELF_APPROVAL', 'You prepared or contributed to this, so someone else must decide it.', {
        reason_code: 'SOD-01', eligible_approvers: [{ user_id: 'u7', display_name: 'Ole Officer', email: 'ole@acme.example' }], no_eligible_approver: false,
      }),
    }))
    await user.click(within(await screen.findByRole('region', { name: 'Approval' })).getByRole('button', { name: 'Reject' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Not ready')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(await within(dialog).findByText(/Who can decide it: Ole Officer \(ole@acme\.example\)\./)).toBeTruthy()
  })

  it('offers no sign-off to a contributor and names who can sign', async () => {
    router.params = new URLSearchParams()
    renderAs(OFFICER, <ChecklistPage marketId={MARKET} />, routes(checklist({ pending_request: PENDING, eligible_signers: [] })))
    const bar = await screen.findByRole('region', { name: 'Approval' })
    expect(within(bar).getByText('You prepared or contributed to this checklist, so another Compliance officer must sign off.')).toBeTruthy()
    expect(within(bar).getByText('No one can approve this yet: a Tenant admin must assign Compliance officer to another user.')).toBeTruthy()
    expect(within(bar).queryByRole('button', { name: 'Sign off' })).toBeNull()
  })

  it('locks entries while a request waits and hides writes in a support session', async () => {
    router.params = new URLSearchParams('item=licence_evidence')
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist({ pending_request: PENDING })))
    expect(await screen.findByText(/Entries are locked while a go-live request waits for sign-off/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Attach evidence file' })).toBeNull()
  })

  it('shows nothing writable in a read-only support session', async () => {
    router.params = new URLSearchParams('item=licence_evidence')
    const me = adminMe({ permissions: ['market.manage'], support_session: { id: 's1', tenant_slug: 'acme', ends_at: '2026-11-17T12:00:00.000Z', scope: { permissions: ['market.manage'] } } })
    renderAs(me, <ChecklistPage marketId={MARKET} />, routes(checklist()))
    await screen.findByRole('table', { name: 'Launch checklist items' })
    expect(screen.queryByTestId('primary-action')).toBeNull()
    expect(screen.queryByRole('button', { name: /Attach evidence file|Record/ })).toBeNull()
  })

  it('says not available for a market outside the user’s scope', async () => {
    router.params = new URLSearchParams()
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, fetchByRoute({
      [`GET /v1/markets/${MARKET}/checklist`]: () => apiError(404, 'NOT_FOUND', 'Not found.'),
      [`GET /v1/markets/${MARKET}/go-live-requests`]: () => apiError(404, 'NOT_FOUND', 'Not found.'),
      'GET /v1/provider-configs': () => json(200, { data: [], meta: {} }),
      'GET /v1/documents/limits': () => json(200, { data: { max_file_bytes: 1, types: [] }, meta: {} }),
    }))
    expect(await screen.findByText(/Not found or not available to you/)).toBeTruthy()
  })
})

describe('ChecklistPage: B2 agreement item and rule lines', () => {
  const AGREEMENT = item({
    item: 'agreement_versions', title: 'Participant agreement versions', kind: 'automatic', category: 'regulatory', status: 'complete',
    detail: { version: { id: 'v1', label: 'NL v1', published_at: '2026-11-17T09:00:00.000Z' } },
  })

  it('shows the current agreement version on the automatic item (D-B2-15)', async () => {
    router.params = new URLSearchParams('item=agreement_versions')
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist({ items: [...ITEMS, AGREEMENT] })))
    const inspector = await screen.findByRole('complementary', { name: 'Participant agreement versions' })
    expect(within(inspector).getByText(/Current version NL v1, published/)).toBeTruthy()
    expect(within(inspector).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings#agreements-title')
    expect(within(inspector).queryByRole('button')).toBeNull()
    expect(within(screen.getByRole('table', { name: 'Launch checklist items' })).getByText('Version NL v1')).toBeTruthy()
  })

  it('BUG-060: only the rule id may break anywhere, never the word "mandatory"', async () => {
    router.params = new URLSearchParams('item=pack_rules')
    renderAs(ADMIN, <ChecklistPage marketId={MARKET} />, routes(checklist()))
    const rules = await screen.findByRole('list', { name: 'Market-pack rules' })
    expect(within(rules).getByText(SCREENING_RULE.id).className).toContain('break-all')
    const label = within(rules).getByText('· mandatory')
    expect(label.className).toContain('whitespace-nowrap')
    expect(label.className).not.toContain('break-all')
    expect(label.parentElement?.className).not.toContain('break-all')
  })
})

describe('checklist helpers', () => {
  it('says what the market state means for enrolments and orders (BUG-059)', () => {
    expect(stateSentence('FR', 'draft')).toBe('Enrolments and orders for FR are accepted only once it is live.')
    expect(stateSentence('FR', 'live')).toBe('FR is live: enrolments and orders for it are accepted.')
  })

  it('lists the mandatory screening rules whose risk a sign-off accepts', () => {
    expect(screeningRules(checklist())).toEqual(['Fixture enrolment rule'])
    expect(screeningRules(checklist({ items: ITEMS.slice(0, 3) }))).toEqual([])
  })

  it('names who recorded an entry or a provider approval', () => {
    expect(recordsOf(ITEMS[2]!, null)).toEqual([{ by: 'Ada Admin', at: '2026-11-16T10:00:00.000Z' }])
    const provider = { ...ITEMS[1]!, detail: { providers: [{ id: 'p1', provider: 'Sandbox Payouts Ltd' }] } }
    expect(recordsOf(provider, [PROVIDER, { ...PROVIDER, id: 'p2' }])).toEqual([{ by: 'Ada Admin', at: '2026-11-16T09:00:00.000Z' }])
    expect(recordsOf(provider, null)).toEqual([])
  })
})

describe('basisText', () => {
  it('summarises rules, providers and contacts', () => {
    expect(basisText(ITEMS[3]!)).toBe('1 rule, 1 mandatory at screening')
    expect(basisText(ITEMS[1]!)).toBe('No approval recorded')
    expect(basisText(item({ item: 'breach_contacts', title: 'B', kind: 'automatic', category: 'data', detail: { contacts: 2 } }))).toBe('2 contacts')
    expect(basisText(item({ item: 'agreement_versions', title: 'A', kind: 'automatic', category: 'regulatory', detail: { version: null } }))).toBe('No version published')
  })
})
