// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, renderAs } from '../test-support'
import { approvalOf, valueText } from './labels'
import { policyValue } from './policy-fields'
import { SettingsPage } from './settings-page'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings', useSearchParams: () => router.params }))

const ADMIN = adminMe({ permissions: ['settings.manage', 'tenant.offboard'] })
const FINANCE = adminMe({ permissions: ['settings.approve', 'fx.approve'] })
const REQUESTED = {
  id: 'o1', state: 'requested', reason: 'Contract ended', requested_at: '2026-11-20T09:00:00.000Z', confirmed_at: null, retention_basis: null,
  retention_months: null, retain_until: null, archived_at: null, export_id: null,
}

function routes(offboarding: unknown, extra: Record<string, () => Response> = {}, keys: readonly string[] = []) {
  return fetchByRoute({
    'GET /v1/settings': () => json(200, {
      data: { version: 3, effective_from: '2026-11-01T00:00:00.000Z', values: Object.fromEntries(keys.map((key) => [key, { value: null, value_since: null }])) },
      meta: { latest_version: 3 },
    }),
    'GET /v1/offboarding': () => ok(offboarding),
    'GET /v1/setting-change-requests': () => ok([]),
    'GET /v1/settings/versions': () => ok([]),
    'GET /v1/participant-types': () => ok([]),
    'GET /v1/agreement-versions': () => ok([]),
    ...extra,
  })
}

describe('SC-29 offboarding card (D-V1A-07)', () => {
  it('lists blockers with links and keeps Confirm disabled while one blocks', async () => {
    renderAs(ADMIN, <SettingsPage />, routes({
      offboarding: REQUESTED,
      blockers: [
        { kind: 'run_open', blocking: true, count: 0, ids: [] },
        { kind: 'case_open', blocking: true, count: 2, ids: ['c1', 'c2'] },
        { kind: 'credits_outstanding', blocking: false, count: 1, ids: ['a1'] },
      ],
    }))
    const card = await screen.findByTestId('offboarding')
    expect(within(card).getByText(/Your vendor asked to offboard/)).toBeTruthy()
    expect(within(card).getByText('2 open cases')).toBeTruthy()
    expect(within(card).queryByText(/calculation run/)).toBeNull()
    expect(within(card).getAllByRole('link', { name: 'Open' })[0]!.getAttribute('href')).toBe('/cases')
    expect((within(card).getByRole('button', { name: 'Confirm offboarding' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('confirms with basis, months and every warning acknowledged', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ offboarding: REQUESTED, blockers: [{ kind: 'credits_outstanding', blocking: false, count: 3, ids: [] }] },
      { 'POST /v1/offboarding/confirm': () => ok({ ...REQUESTED, state: 'confirmed' }) })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Confirm offboarding' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirm the offboarding' })
    await user.type(within(dialog).getByLabelText('Retention basis'), 'Commercial code: 10 years')
    await user.type(within(dialog).getByLabelText('Keep the archive for (months)'), '12')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm offboarding' }))
    expect(await within(dialog).findAllByText('Acknowledge every open obligation listed.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/offboarding/confirm')).toHaveLength(0)
    await user.click(within(dialog).getByLabelText('I acknowledge: 3 members holding unexpired non-cash rewards.'))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm offboarding' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/offboarding/confirm')).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/offboarding/confirm')[0]![1])).toEqual({
      retention_basis: 'Commercial code: 10 years', retention_months: 12, acknowledged_warnings: ['credits_outstanding'],
    })
  })

  it('keeps Cancel and the export link while confirmed and read-only; shows the refusal', async () => {
    const user = userEvent.setup()
    const confirmed = { ...REQUESTED, state: 'confirmed', confirmed_at: '2026-11-21T09:00:00.000Z', retention_basis: 'Law', retention_months: 12 }
    const readOnly = adminMe({ ...ADMIN, tenant: { ...ADMIN.tenant!, read_only: true } })
    renderAs(readOnly, <SettingsPage />, routes({ offboarding: confirmed, blockers: [] },
      { 'POST /v1/offboarding/cancel': () => apiError(409, 'OFFBOARDING_STATE', 'The offboarding is archived; this step is not possible.') }))
    const card = await screen.findByTestId('offboarding')
    expect(within(card).getByRole('link', { name: 'Run the final full export' }).getAttribute('href')).toBe('/settings/integrations?tab=exports')
    await user.click(within(card).getByRole('button', { name: 'Cancel offboarding' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel the offboarding' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel offboarding' }))
    expect(await within(dialog).findByText(/this step is not possible/)).toBeTruthy()
    // Read-only: no other write control on the page.
    expect(screen.queryByRole('button', { name: 'Save new version with effective date' })).toBeNull()
  })

  it('is not shown without tenant.offboard', async () => {
    renderAs(adminMe({ permissions: ['settings.manage'] }), <SettingsPage />, routes(null))
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.queryByTestId('offboarding')).toBeNull()
  })
})

describe('SC-29 exchange-rate age limit (D-V1A-10)', () => {
  it('is registry-driven, unset by default, approved by Finance and validated 1..366', async () => {
    expect(approvalOf('fx.max_rate_age_days')?.permission).toBe('settings.approve')
    expect(policyValue('fx.max_rate_age_days', { value: '45' }).value).toBe(45)
    expect(policyValue('fx.max_rate_age_days', { value: '367' }).errors).toEqual({ value: 'Enter the days as a whole number from 1 to 366.' })
    expect(valueText('fx.max_rate_age_days', 45)).toBe('A rate older than 45 days at the order\'s time holds the order')
    renderAs(FINANCE, <SettingsPage />, routes(null, {}, ['fx.max_rate_age_days']))
    const card = await screen.findByTestId('fx-policy')
    expect(within(card).getByText('Orders in another currency are refused until set.')).toBeTruthy()
  })
})
