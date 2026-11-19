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
const MARKET = { id: M, code: 'DE', name: 'Germany', currency: 'EUR', state: 'live' as const, market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const B5 = ['disputes.policy', 'privacy.policy', 'portal.customer_contact_visible']

function routes(values: Record<string, unknown> = {}, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/settings': () => json(200, {
      data: { version: 3, effective_from: '2026-11-01T00:00:00.000Z', values: Object.fromEntries(B5.map((key) => [key, { value: values[key] ?? null, value_since: null }])) },
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

describe('B5 setting values (D-B5-20)', () => {
  it('builds each value from the form with no defaults: empty markets and an empty window are left out', () => {
    expect(policyValue('disputes.policy', { window: '', [`days_${M}`]: '10' }).value).toEqual({ response_days: { [M]: 10 } })
    expect(policyValue('disputes.policy', { window: '60' }).value).toEqual({ window_days: 60, response_days: {} })
    expect(policyValue('disputes.policy', { window: '0', [`days_${M}`]: '366' }).errors).toEqual({
      window: 'Enter the dispute window as a whole number from 1 to 3650.', [`days_${M}`]: 'Enter the days as a whole number from 1 to 365.',
    })
    expect(policyValue('privacy.policy', { [`days_${M}`]: '30', escalate: '5' }).value).toEqual({ response_days: { [M]: 30 }, escalate_before_days: 5 })
    expect(policyValue('privacy.policy', { [`days_${M}`]: '30' }).errors.escalate).toMatch(/0 to 60/)
    expect(policyValue('portal.customer_contact_visible', { value: 'false' }).value).toBe(false)
    expect(policyValue('portal.customer_contact_visible', {}).errors.value).toBeTruthy()
    expect(draftOf('privacy.policy', { response_days: { [M]: 30 }, escalate_before_days: 5 })).toEqual({ escalate: '5', [`days_${M}`]: '30' })
  })

  it('names who approves and words the values per market', () => {
    expect(approvalOf('privacy.policy')?.role).toBe('DPO')
    expect(approvalOf('portal.customer_contact_visible')?.role).toBe('DPO')
    expect(approvalOf('disputes.policy')).toBeNull()
    expect(valueText('disputes.policy', { window_days: 60, response_days: { [M]: 10 } }, [MARKET])).toBe('Disputes open for 60 days after a commit; response time DE: 10 days')
    expect(valueText('disputes.policy', { response_days: {} })).toBe('No dispute window; response time no market')
    expect(valueText('privacy.policy', { response_days: { [M]: 30 }, escalate_before_days: 5 }, [MARKET])).toBe('Answer within DE: 30 days; escalate 5 days before the deadline')
    expect(valueText('portal.customer_contact_visible', false)).toBe('Hidden')
  })
})

describe('SC-29 disputes, privacy requests and the portal', () => {
  it('shows each key with what holds while unset', async () => {
    renderAs(ADMIN, <SettingsPage />, routes({ 'disputes.policy': { window_days: 60, response_days: { [M]: 10 } } }))
    const card = await screen.findByTestId('portal-policies')
    expect(await within(card).findByText('Disputes open for 60 days after a commit; response time DE: 10 days')).toBeTruthy()
    expect(within(card).getByText(/Privacy requests get no deadline and are never escalated/)).toBeTruthy()
    expect(within(card).getByText('Distributors do not see their customers’ contact details.')).toBeTruthy()
  })

  it('sends a privacy deadline change for the DPO’s approval through the version dialog', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({}, {
      'PUT /v1/settings/privacy.policy': () => json(202, { data: { change_request: { id: 'cr1' } }, meta: { latest_version: 3 } }),
    })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Change privacy request deadlines' }))
    const dialog = screen.getByRole('dialog', { name: 'Save new version with effective date' })
    expect(within(dialog).getByText('Needs DPO approval')).toBeTruthy()
    await user.type(await within(dialog).findByLabelText(/^DE \(days\)/), '30')
    await user.type(within(dialog).getByLabelText(/^Escalate days before the deadline/), '5')
    await user.type(within(dialog).getByLabelText('Effective from'), '2099-12-01T00:00')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Statutory deadline')
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByText(/Privacy request deadlines change sent/)).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/settings/privacy.policy')[0]![1])).toMatchObject({ value: { response_days: { [M]: 30 }, escalate_before_days: 5 } })
  })
})
