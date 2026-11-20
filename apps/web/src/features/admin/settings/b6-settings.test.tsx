// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { json, ok } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../test-support'
import { approvalOf, valueText } from './labels'
import { draftOf, policyValue } from './policy-fields'
import { SettingsPage } from './settings-page'
import type { ChangeRequest } from './types'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings', useSearchParams: () => router.params }))

const ADMIN = adminMe({ permissions: ['settings.manage'] })
const M = '00000000-0000-4000-8000-0000000000d1'
const MARKET = { id: M, code: 'DE', name: 'Germany', currency: 'EUR', state: 'live' as const, market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const KEYS = ['plan.filing_requirements', 'exports.full_schedule', 'orders.crediting_event']

function routes(values: Record<string, unknown> = {}, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/settings': () => json(200, {
      data: { version: 3, effective_from: '2026-11-01T00:00:00.000Z', values: Object.fromEntries(KEYS.map((key) => [key, { value: values[key] ?? null, value_since: null }])) },
      meta: { latest_version: 3 },
    }),
    'GET /v1/setting-change-requests': () => ok([]),
    'GET /v1/settings/versions': () => ok([]),
    'GET /v1/participant-types': () => ok([]),
    'GET /v1/agreement-versions': () => ok([]),
    'GET /v1/markets': () => ok([MARKET]),
    ...extra,
  })
}

describe('B6 setting values (D-B6-17)', () => {
  it('builds and words the filing markets and the export schedule, with no defaults', () => {
    expect(policyValue('plan.filing_requirements', { [`market_${M}`]: 'true' }).value).toEqual({ market_ids: [M] })
    expect(policyValue('plan.filing_requirements', {}).errors).toEqual({ markets: 'Choose at least one market.' })
    expect(policyValue('exports.full_schedule', { cadence: 'daily', hour: '2' }).value).toEqual({ cadence: 'daily', hour_utc: 2 })
    expect(policyValue('exports.full_schedule', { cadence: '', hour: '24' }).errors).toEqual({
      cadence: 'Choose how often the export runs.', hour: 'Enter the hour (UTC) as a whole number from 0 to 23.',
    })
    expect(draftOf('exports.full_schedule', { cadence: 'weekly', hour_utc: 3 })).toEqual({ cadence: 'weekly', hour: '3' })
    expect(draftOf('plan.filing_requirements', { market_ids: [M] })).toEqual({ [`market_${M}`]: 'true' })
    expect(valueText('exports.full_schedule', { cadence: 'daily', hour_utc: 2 })).toBe('Daily at 02:00 UTC')
    expect(valueText('plan.filing_requirements', { market_ids: [M] }, [MARKET])).toBe('A filing is recorded before scheduling in DE')
    expect(approvalOf('plan.filing_requirements')?.permission).toBe('market.signoff')
    expect(approvalOf('exports.full_schedule')).toBeNull()
  })
})

describe('SC-29 plan filings and data exports', () => {
  it('states what holds while each key is unset and shows the crediting event retired, read-only', async () => {
    renderAs(ADMIN, <SettingsPage />, routes({ 'orders.crediting_event': 'paid' }))
    const card = await screen.findByTestId('filing-export-policies')
    expect(within(card).getByText('No market requires a filing: plan versions are scheduled without one.')).toBeTruthy()
    expect(within(card).getByText('Manual exports only: run one from Integrations, Exports.')).toBeTruthy()
    const crediting = screen.getByRole('heading', { name: 'Crediting event' }).closest('li')!
    expect(crediting.textContent).toContain('Retired: the crediting event is set on each plan version.')
    expect(crediting.textContent).toContain('Retired (last value: When paid)')
    expect(within(crediting).queryByRole('button')).toBeNull()
  })

  it('sends a filing requirement as a change request for a market sign-off holder', async () => {
    const fetchMock = routes({}, { 'PUT /v1/settings/plan.filing_requirements': () => ok({ change_request: { id: 'cr1' } }, 202) })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    const card = await screen.findByTestId('filing-export-policies')
    await userEvent.click(within(within(card).getByRole('heading', { name: 'Plan filing requirements' }).closest('li')!).getByRole('button'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Needs market sign-off approval')
    await userEvent.click(await within(dialog).findByLabelText('Germany (DE)'))
    await userEvent.type(within(dialog).getByLabelText('Effective from'), '2099-01-01T00:00')
    await userEvent.type(within(dialog).getByLabelText('Reason for the change'), 'Filing duty in DE')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', '/v1/settings/plan.filing_requirements')).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/settings/plan.filing_requirements')[0]!
    expect(bodyOf(init)).toMatchObject({ value: { market_ids: [M] }, reason: 'Filing duty in DE' })
    expect(headerOf(init, 'If-Match')).toBe('"3"')
  })
})

describe('BUG-121 a market sign-off holder decides a filing requirement', () => {
  it('shows a Compliance officer the pending request with Approve', async () => {
    const officer = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000c7', email: 'cora@acme.example', display_name: 'Cora Compliance' }, permissions: ['market.signoff', 'plan.read'] })
    const request: ChangeRequest = {
      id: '0f000000-0000-4000-8000-0000000000b6', key: 'plan.filing_requirements', value: { market_ids: [M] },
      effective_from: '2099-01-01T00:00:00.000Z', reason: 'Filing duty in DE', base_version: 3, state: 'pending',
      requested_by: { id: ADMIN.user.id, display_name: 'Ada Admin' }, requested_at: '2026-11-20T09:00:00.000Z', decided_by: null, decided_at: null,
      decision_reason: null, version: null, eligible_approvers: [{ user_id: officer.user.id, display_name: 'Cora Compliance', email: 'cora@acme.example' }], no_eligible_approver: false,
    }
    renderAs(officer, <SettingsPage />, routes({}, { 'GET /v1/setting-change-requests': () => ok([request]) }))
    const card = (await screen.findByText('Waiting for market sign-off approval')).closest('li')!
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save new version with effective date' })).toBeNull()
  })
})
