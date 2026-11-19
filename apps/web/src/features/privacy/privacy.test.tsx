// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, fetchReturning, json, ok, requestBody, requestHeaders } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { deadlineOf } from './format'
import { PrivacyRequestPage } from './privacy-detail'
import { PrivacyRequestsPage } from './privacy-list'
import { PublicRequestForm } from './public-request-form'
import type { PrivacyRequestDetail, PrivacyRequestRow } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/privacy',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const DPO = adminMe({ permissions: ['privacy.manage', 'participant.read'] })
const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const DAY = 86_400_000
const NOW = Date.parse('2026-11-19T12:00:00.000Z')
const ID = 'abcdef12-0000-4000-8000-000000000001'
const CASE_ID = '00000000-0000-4000-8000-00000000ca5e'
const SUBJECT = '00000000-0000-4000-8000-0000000000c1'

function row(overrides: Partial<PrivacyRequestRow> = {}): PrivacyRequestRow {
  return {
    id: ID, case_id: CASE_ID, type: 'access', channel: 'public_form', state: 'received', subject: null, verified: false,
    received_at: '2026-11-18T09:00:00.000Z', due_at: null, escalated_at: null, deadline_configured: false, ...overrides,
  }
}

function detail(overrides: Partial<PrivacyRequestDetail> = {}): PrivacyRequestDetail {
  return {
    ...row(), verification_method: null, verification_note: null, verified_at: null, retention_basis: null, outcome: null, closed_at: null,
    case_state: 'open', market_id: null, export: null, requester: { full_name: 'Bea Example', email: 'de-b@example.test' }, corrections: null, blockers: null,
    ...overrides,
  }
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockReset()
  navigation.router.replace.mockReset()
})

describe('deadline indicator (C-B5-4)', () => {
  it('says when there is no deadline, how many days are left, and when it is overdue', () => {
    expect(deadlineOf(row(), NOW, 5).text).toBe('Set when the identity is verified')
    expect(deadlineOf(row({ verified: true }), NOW, 5).text).toBe('No deadline configured')
    expect(deadlineOf(row({ verified: true, due_at: new Date(NOW + 20 * DAY).toISOString() }), NOW, 5)).toEqual({ text: '20 days left', tone: 'neutral' })
    expect(deadlineOf(row({ verified: true, due_at: new Date(NOW + 3 * DAY).toISOString() }), NOW, 5)).toEqual({ text: '3 days left', tone: 'warning' })
    expect(deadlineOf(row({ verified: true, due_at: new Date(NOW - 2 * DAY).toISOString() }), NOW, 5)).toEqual({ text: 'Overdue by 2 days', tone: 'danger' })
    expect(deadlineOf(row({ state: 'fulfilled', verified: true }), NOW, 5).text).toBe('Closed')
  })
})

describe('SC-15 privacy requests list', () => {
  const listRoutes = (extra: Record<string, (query: URLSearchParams) => Response> = {}) => fetchByRoute({
    'GET /v1/privacy-requests': (query) => json(200, {
      data: query.get('state') === 'in_progress'
        ? [row({ id: 'r2', state: 'in_progress', verified: true, subject: { id: SUBJECT, external_ref: 'DE-B' }, due_at: '2020-01-01T00:00:00.000Z' })]
        : [row()],
      meta: { next_cursor: null },
    }),
    'GET /v1/settings/privacy.policy': () => ok({ key: 'privacy.policy', value: { response_days: { m1: 30 }, escalate_before_days: 5 } }),
    ...extra,
  })

  it('shows the KPIs, the deadline indicators and the filters in the URL', async () => {
    renderAs(DPO, <PrivacyRequestsPage />, listRoutes())
    const kpis = await screen.findByTestId('kpis')
    expect(await within(kpis).findByText('Due within 5 days')).toBeTruthy()
    expect(within(within(kpis).getByText('Open requests').closest('div')!.parentElement!.parentElement!).getByText('2')).toBeTruthy()
    expect(await screen.findAllByText('Set when the identity is verified')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Access' }).getAttribute('href')).toBe(`/privacy/${ID}`)
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'erasure')
    expect(navigation.router.replace).toHaveBeenCalledWith('/privacy?type=erasure')
  })

  it('is not available without privacy.manage', () => {
    renderAs(adminMe({ permissions: ['participant.read'] }), <PrivacyRequestsPage />, listRoutes())
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })

  it('records a request received by staff and opens it', async () => {
    const fetchMock = listRoutes({ 'POST /v1/privacy-requests': () => ok(detail({ id: 'new-1' }), 201) })
    renderAs(DPO, <PrivacyRequestsPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Record a request' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record a privacy request' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Request type'), 'correction')
    await userEvent.type(within(dialog).getByLabelText('Received via'), 'Letter')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record request' }))
    expect(await within(dialog).findAllByText('Enter what should be corrected.')).toBeTruthy()
    await userEvent.type(within(dialog).getByLabelText(/^Details/), 'New phone number')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record request' }))
    expect(await screen.findByText('Request recorded. Verify the requester’s identity next.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/privacy-requests')[0]!
    expect(bodyOf(init)).toEqual({ type: 'correction', details: 'New phone number', received_via: 'Letter' })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
    expect(navigation.router.push).toHaveBeenCalledWith('/privacy/new-1')
  })
})

describe('SC-15 privacy request detail', () => {
  const detailRoutes = (request: PrivacyRequestDetail, extra: Record<string, (query: URLSearchParams) => Response> = {}) => fetchByRoute({
    [`GET /v1/privacy-requests/${ID}`]: () => ok(request),
    [`GET /v1/cases/${CASE_ID}`]: () => ok({ id: CASE_ID, type: 'privacy', state: request.case_state, effect_preview: null, payload: { request_id: ID } }),
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/settings/privacy.policy': () => ok({ key: 'privacy.policy', value: null }),
    [`GET /v1/participants/${SUBJECT}`]: () => ok({ id: SUBJECT, external_ref: 'DE-B', display_name: 'Bea Example' }),
    ...extra,
  })

  it('shows the unsealed requester and verifies the identity with a member and a method', async () => {
    const fetchMock = detailRoutes(detail(), {
      'GET /v1/participants': () => ok([{ id: SUBJECT, external_ref: 'DE-B', display_name: 'Bea Example', market: { id: 'm1', code: 'DE' }, current_type: null, status: 'active' }]),
      [`POST /v1/privacy-requests/${ID}/verify`]: () => ok(detail({ verified: true, verified_at: '2026-11-19T09:00:00.000Z' })),
    })
    renderAs(DPO, <PrivacyRequestPage requestId={ID} />, fetchMock)
    expect(await screen.findByRole('heading', { level: 1, name: 'Access request ABCDEF12' })).toBeTruthy()
    expect(screen.getByText('de-b@example.test')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the case to submit' }).getAttribute('href')).toBe(`/cases/${CASE_ID}`)
    await userEvent.click(screen.getByRole('button', { name: 'Verify identity' }))
    const dialog = await screen.findByRole('dialog', { name: 'Verify the requester’s identity' })
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Email matches the member’s contact email/ }))
    await userEvent.type(within(dialog).getByLabelText('Member the request is about'), 'DE-B')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Search member the request is about' }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Choose DE-B · Bea Example' }))
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Email matches')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record verification' }))
    expect(await screen.findByText('Identity verified. The deadline now runs for the member’s market.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `/v1/privacy-requests/${ID}/verify`)[0]![1])).toEqual({ method: 'contact_match', subject_participant_id: SUBJECT, note: 'Email matches' })
  })

  it('offers no email match for an erasure: it proves no control of the mailbox', async () => {
    renderAs(DPO, <PrivacyRequestPage requestId={ID} />, detailRoutes(detail({ type: 'erasure' })))
    await userEvent.click(await screen.findByRole('button', { name: 'Verify identity' }))
    const dialog = await screen.findByRole('dialog', { name: 'Verify the requester’s identity' })
    expect(within(dialog).queryByRole('radio', { name: /^Email matches/ })).toBeNull()
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2)
  })

  it('says "No deadline configured for DE", lists erasure blockers, and downloads the export', async () => {
    const request = detail({
      type: 'erasure', verified: true, verified_at: '2026-11-19T09:00:00.000Z', verification_method: 'other', subject: { id: SUBJECT, external_ref: 'DE-B' },
      market_id: 'm1', blockers: [{ reason: 'open_payable', market_id: 'm1', amount_minor: '500' }],
      export: { id: 'e1', created_at: '2026-11-19T10:00:00.000Z', sha256: 'ab'.repeat(32), bytes: 2048 },
    })
    const fetchMock = detailRoutes(request, { [`GET /v1/privacy-requests/${ID}/export`]: () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) })
    const createObjectURL = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    renderAs(DPO, <PrivacyRequestPage requestId={ID} />, fetchMock)
    expect(await screen.findByText('No deadline configured for DE')).toBeTruthy()
    expect(await screen.findByText(/is still owed to the member in DE\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Download export' }))
    expect(callsTo(fetchMock, 'GET', `/v1/privacy-requests/${ID}/export`)).toHaveLength(1)
    expect(createObjectURL).toHaveBeenCalled()
  })

  it('shows the erasure blockers only once the case is read without a preview (no flicker into the stored preview)', async () => {
    const request = detail({ type: 'erasure', case_state: 'submitted', blockers: [] })
    let reads = 0
    const fetchMock = detailRoutes(request, {
      [`GET /v1/cases/${CASE_ID}`]: () => (++reads === 1 ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again later.') : ok({
        id: CASE_ID, type: 'privacy', state: 'submitted', payload: { request_id: ID },
        effect_preview: { request_id: ID, type: 'erasure', subject: { id: SUBJECT, external_ref: 'DE-B' }, cleared: ['participant.contact'], retained: ['journal_entry'], blockers: [] },
      })),
    })
    renderAs(DPO, <PrivacyRequestPage requestId={ID} />, fetchMock)
    expect(await screen.findByText('This section could not be loaded')).toBeTruthy()
    expect(screen.queryByText(/listed in the case’s effect preview when the case is submitted/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('erasure-preview')).toBeTruthy()
    expect(screen.queryByText(/listed in the case’s effect preview when the case is submitted/)).toBeNull()
  })

  it('saves corrected values for a correction request (only the fields filled in)', async () => {
    const fetchMock = detailRoutes(detail({ type: 'correction' }), {
      [`PUT /v1/privacy-requests/${ID}/corrections`]: () => ok({ fields: ['contact.phone'] }),
    })
    renderAs(DPO, <PrivacyRequestPage requestId={ID} />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Enter corrected values' }))
    const dialog = await screen.findByRole('dialog', { name: 'Corrected values' })
    await userEvent.type(within(dialog).getByLabelText(/^Phone/), '+49 30 1234')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save corrected values' }))
    expect(await screen.findByText('Corrected values saved. They apply when the case is approved.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', `/v1/privacy-requests/${ID}/corrections`)[0]![1])).toEqual({ contact: { phone: '+49 30 1234' } })
  })

  it('reads a non-UUID id as not available without asking the API', () => {
    const fetchMock = fetchByRoute({})
    renderAs(DPO, <PrivacyRequestPage requestId="../users" />, fetchMock)
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SC-41 public privacy request form', () => {
  it('sends the request with an Idempotency-Key and shows the reference only', async () => {
    navigation.search = 'tenant=acme'
    const fetchMock = fetchReturning(ok({ reference: 'ABCDEF12' }, 202))
    renderWithProviders(<PublicRequestForm />, fetchMock)
    expect(screen.queryByLabelText('Company')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: /^Access/ }))
    await userEvent.type(screen.getByLabelText('Full name'), 'Bea Example')
    await userEvent.type(screen.getByLabelText(/^Email address/), 'de-b@example.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect((await screen.findByTestId('request-reference')).textContent).toContain('Request reference: ABCDEF12')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/public/privacy-requests')
    expect(requestBody(fetchMock)).toEqual({ tenant: 'acme', type: 'access', full_name: 'Bea Example', email: 'de-b@example.test' })
    expect(requestHeaders(fetchMock).get('Idempotency-Key')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/DPO|perjury/)
  })

  it('asks for the company without ?tenant=, needs details for a correction, and shows refusals', async () => {
    renderWithProviders(<PublicRequestForm />, fetchReturning(apiError(404, 'TENANT_NOT_FOUND', 'No company uses this name.')))
    await userEvent.click(screen.getByRole('radio', { name: /^Correction/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(screen.getAllByText('Enter the company name.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Enter what should be corrected.').length).toBeGreaterThan(0)
    await userEvent.type(screen.getByLabelText('Company'), 'nobody')
    await userEvent.type(screen.getByLabelText('Full name'), 'Bea Example')
    await userEvent.type(screen.getByLabelText(/^Email address/), 'de-b@example.test')
    await userEvent.type(screen.getByLabelText(/^Details/), 'My phone is wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('No company uses this name.')).toBeTruthy()
  })
})
