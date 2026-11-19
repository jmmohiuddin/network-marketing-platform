// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { json, ok } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, renderAs } from '../test-support'
import { approvalOf, valueText } from './labels'
import { draftOf, policyValue } from './policy-fields'
import { SettingsPage } from './settings-page'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings', useSearchParams: () => router.params }))

const ADMIN = adminMe({ permissions: ['settings.manage'] })
const M = '00000000-0000-4000-8000-0000000000d1'
const MARKET = { id: M, code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const B4 = [
  'payouts.market_policy', 'payouts.bank_detail_cooling_off_hours', 'payouts.shared_account_threshold', 'payouts.dormant_after_days',
  'payouts.provider_review_reminder_days', 'adjustments.policy', 'write_offs.policy', 'money.clawback_policy',
]

function routes(values: Record<string, unknown> = {}, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/settings': () => json(200, {
      data: { version: 3, effective_from: '2026-11-01T00:00:00.000Z', values: Object.fromEntries(B4.map((key) => [key, { value: values[key] ?? null, value_since: null }])) },
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

describe('B4 setting values (D-B4-18)', () => {
  it('builds each value from the form, refusing what the API refuses, with no defaults', () => {
    expect(policyValue('payouts.market_policy', { [`min_${M}`]: '1000', [`tax_${M}`]: '' }).value).toEqual({ [M]: { minimum_payout_minor: '1000', tax_profile_required: false } })
    expect(policyValue('payouts.market_policy', {}).errors).toEqual({ markets: 'Enter the minimum payout of at least one market.' })
    expect(policyValue('payouts.market_policy', { [`tax_${M}`]: 'true' }).errors[`min_${M}`]).toBe('Enter the minimum payout of this market too.')
    expect(policyValue('payouts.bank_detail_cooling_off_hours', { value: '72' }).value).toBe(72)
    expect(policyValue('payouts.bank_detail_cooling_off_hours', { value: '2161' }).errors.value).toMatch(/0 to 2160/)
    expect(policyValue('adjustments.policy', { above: '10000', new_days: '0', related: 'block' }).value)
      .toEqual({ second_approver_above_minor: '10000', new_account_days: 0, related_account_action: 'block' })
    expect(policyValue('adjustments.policy', { above: '1.5', new_days: '0', related: '' }).errors).toEqual({
      above: 'Enter the second-approver threshold as a whole number of minor units.', related: 'Choose what happens for a related or new account.',
    })
    expect(policyValue('write_offs.policy', { below: '1000', after_days: '', above: '500' }).value).toEqual({ eligible_below_minor: '1000', second_approver_above_minor: '500' })
    expect(policyValue('write_offs.policy', { below: '', after_days: '', above: '500' }).errors.below).toMatch(/eligibility amount, an eligibility age, or both/)
    expect(draftOf('write_offs.policy', { eligible_after_days: 90, second_approver_above_minor: '500' })).toEqual({ below: '', after_days: '90', above: '500' })
  })

  it('names who approves and words the values', () => {
    expect(approvalOf('write_offs.policy')?.role).toBe('Finance approver')
    expect(approvalOf('payouts.shared_account_threshold')).toBeNull()
    expect(valueText('adjustments.policy', { second_approver_above_minor: '10000', new_account_days: 0, related_account_action: 'block' }))
      .toBe(`Second approver above ${(10000).toLocaleString()} minor units; new accounts: 0 days; related accounts: block the adjustment`)
    expect(valueText('write_offs.policy', { eligible_below_minor: '1000', second_approver_above_minor: '500' }))
      .toBe(`Eligible below ${(1000).toLocaleString()} minor units; second approver above 500 minor units`)
  })
})

describe('SC-29 payouts, adjustments and write-offs', () => {
  it('shows a card per key with what holds while unset, and the clawback default as retired', async () => {
    renderAs(ADMIN, <SettingsPage />, routes({ 'payouts.market_policy': { [M]: { minimum_payout_minor: '1000', tax_profile_required: false } } }))
    const card = await screen.findByTestId('payout-policies')
    expect(within(card).getByText('Write-offs are refused until set.')).toBeTruthy()
    expect(await within(card).findByText('DE: 10.00 EUR minimum, tax profile not required')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Change adjustment policy' })).toBeTruthy()
    expect(screen.getAllByText('Retired: set per bonus on the plan version.').length).toBeGreaterThan(0)
  })

  it('sends a write-off policy change for Finance approval through the version dialog', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({}, {
      'PUT /v1/settings/write_offs.policy': () => json(202, { data: { change_request: { id: 'cr1' } }, meta: { latest_version: 3 } }),
    })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Change write-off policy' }))
    const dialog = screen.getByRole('dialog', { name: 'Save new version with effective date' })
    expect(within(dialog).getByText('Needs Finance approval')).toBeTruthy()
    expect((within(dialog).getByLabelText('Setting') as HTMLSelectElement).textContent).not.toContain('Clawback default')
    await user.type(within(dialog).getByLabelText(/Eligible below/), '1000')
    await user.type(within(dialog).getByLabelText(/^Second approver above/), '500')
    await user.type(within(dialog).getByLabelText('Effective from'), '2099-12-01T00:00')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Policy')
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByText('Write-off policy change sent. Waiting for Finance approval.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/settings/write_offs.policy')[0]![1])).toMatchObject({ value: { eligible_below_minor: '1000', second_approver_above_minor: '500' } })
  })

  it('BUG-106: shows the minimum and tax flag of a pending market policy in the queue and the Approve dialog', async () => {
    const user = userEvent.setup()
    const finance = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000f2', email: 'fay@acme.example', display_name: 'Fay Finance' }, permissions: ['settings.approve'] })
    const request = {
      id: '0f000000-0000-4000-8000-000000000002', key: 'payouts.market_policy', value: { [M]: { minimum_payout_minor: '1000', tax_profile_required: false } },
      effective_from: '2099-12-01T00:00:00.000Z', reason: 'Launch DE payouts', base_version: 3, state: 'pending', requested_by: { id: 'someone-else', display_name: 'Ada Admin' },
      requested_at: '2026-11-17T09:00:00.000Z', decided_by: null, decided_at: null, decision_reason: null, version: null,
      eligible_approvers: [{ user_id: finance.user.id, display_name: 'Fay Finance', email: 'fay@acme.example' }], no_eligible_approver: false,
    }
    renderAs(finance, <SettingsPage />, routes({}, { 'GET /v1/setting-change-requests': () => ok([request]) }))
    const card = await screen.findByRole('article', { name: /Minimum payout and tax profile per market/ })
    expect(await within(card).findByText('DE: 10.00 EUR minimum, tax profile not required')).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog', { name: /^Approve minimum payout and tax profile per market change/ })
    expect(await within(dialog).findByText(/^DE: 10\.00 EUR minimum, tax profile not required from /)).toBeTruthy()
    expect(valueText('payouts.market_policy', request.value)).toBe(`Market: ${(1000).toLocaleString()} minor units minimum, tax profile not required`)
  })
})
