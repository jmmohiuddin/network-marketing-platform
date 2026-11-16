// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../test-support'
import { checkContacts } from './breach-contacts-dialog'
import { minorUnitsError } from './setting-dialog'
import { SettingsPage } from './settings-page'
import { checkRanks, shareErrors } from './threshold-dialogs'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings', useSearchParams: () => router.params }))

const THRESHOLDS = ['compliance.active_pv_minor', 'compliance.rank_thresholds_pv_minor', 'compliance.late_order_day', 'compliance.personal_share_flag']
const LATEST = 3
const SINCE = { version: 2, effective_from: '2026-10-01T00:00:00.000Z' }

type Values = Record<string, unknown>

function settingsView(values: Values, keys: readonly string[] = [...THRESHOLDS, 'privacy.breach_contacts', 'money.rounding_mode', 'money.clawback_policy', 'plan.activation_notice_days']) {
  return () => json(200, {
    data: {
      version: LATEST,
      effective_from: '2026-11-01T00:00:00.000Z',
      values: Object.fromEntries(keys.map((key) => {
        const value = values[key] ?? null
        return [key, { value, value_since: value === null ? null : SINCE }]
      })),
    },
    meta: { latest_version: LATEST },
  })
}

const empty = () => json(200, { data: [], meta: {} })

function routes(values: Values = {}, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/settings': settingsView(values),
    'GET /v1/setting-change-requests': empty,
    'GET /v1/settings/versions': empty,
    ...extra,
  })
}

describe('SettingsPage thresholds and contacts', () => {
  it('ships no threshold values and explains what an unset threshold does', async () => {
    renderAs(adminMe(), <SettingsPage />, routes())
    expect(await screen.findByText('Report R4 leaves out the active-earner figures.')).toBeTruthy()
    expect(screen.getByText('No thresholds are set for you')).toBeTruthy()
    expect(screen.getByText('No breach contact recorded')).toBeTruthy()
  })

  it('drops the unset-thresholds banner once every threshold is set (BUG-017)', async () => {
    renderAs(adminMe(), <SettingsPage />, routes({
      'compliance.active_pv_minor': '5000',
      'compliance.rank_thresholds_pv_minor': { leader: '10000' },
      'compliance.late_order_day': 27,
      'compliance.personal_share_flag': { numerator: '1', denominator: '3' },
    }))
    expect(await screen.findByText('Day 27 of the month')).toBeTruthy()
    expect(screen.queryByText(/thresholds? (are|is) not set|No thresholds are set/)).toBeNull()
  })

  it('shows "in force since" from value_since, not the latest version (BUG-025)', async () => {
    renderAs(adminMe(), <SettingsPage />, routes({ 'compliance.late_order_day': 27 }))
    const row = (await screen.findByRole('heading', { name: 'Late-order day' })).closest('li')!
    expect(within(row).getByText(/In force since .* \(version 2\)\./)).toBeTruthy()
    expect(within(row).queryByText(/version 3/)).toBeNull()
  })

  it('opens an unset threshold empty and saves it with If-Match and a reason', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({}, {
      'PUT /v1/settings/compliance.late_order_day': () => json(200, { data: { key: 'compliance.late_order_day', value: 25, version: 4 }, meta: {} }),
    })
    renderAs(adminMe(), <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Change late-order day' }))
    const day = screen.getByLabelText('Day of the month from which an order counts as late') as HTMLInputElement
    expect(day.value).toBe('')
    await user.type(day, '25')
    await user.type(screen.getByLabelText('Reason for the change'), 'Agreed with counsel')
    await user.click(screen.getByRole('button', { name: 'Save change' }))
    expect(await screen.findByText('Late-order day saved. It applies from now on.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/settings/compliance.late_order_day')[0]!
    expect(bodyOf(init)).toEqual({ value: 25, reason: 'Agreed with counsel' })
    expect(headerOf(init, 'If-Match')).toBe(`"${LATEST}"`)
  })

  it('says a code may be asked for when saving breach contacts (BUG-046) and keeps the dialog open on 412', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({}, {
      'PUT /v1/settings/privacy.breach_contacts': () => apiError(412, 'PRECONDITION_FAILED', 'Settings changed since you loaded them. Reload and try again.'),
    })
    renderAs(adminMe(), <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Add contacts' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('You may be asked for a code from your authenticator app.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Add contact' }))
    await user.type(within(dialog).getByLabelText('Name'), 'Dee Pio')
    await user.type(within(dialog).getByLabelText('Role'), 'Data protection officer')
    await user.type(within(dialog).getByLabelText('Email address'), 'dpo@acme.example')
    await user.type(within(dialog).getByLabelText('Phone number'), '+44 20 7946 0000')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Onboarding')
    await user.click(within(dialog).getByRole('button', { name: 'Save change' }))
    expect(await within(dialog).findByText('Settings changed since you loaded them. Reload and try again.')).toBeTruthy()
  })

  it('shows each breach contact as a card', async () => {
    const contact = { name: 'Dee Pio', role: 'Data protection officer', email: 'dpo@acme.example', phone: '+44 20 7946 0000' }
    renderAs(adminMe(), <SettingsPage />, routes({ 'privacy.breach_contacts': [contact] }))
    const list = await screen.findByRole('list', { name: 'Breach-notification contacts' })
    expect(within(list).getByRole('heading', { name: 'Dee Pio' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change contacts' })).toBeTruthy()
  })

  it('shows a Finance approver only the keys the API returns, without change controls', async () => {
    renderAs(adminMe({ permissions: ['settings.approve'] }), <SettingsPage />, fetchByRoute({
      'GET /v1/settings': settingsView({}, ['money.rounding_mode', 'money.clawback_policy', 'plan.activation_notice_days']),
      'GET /v1/setting-change-requests': empty,
      'GET /v1/settings/versions': empty,
    }))
    expect(await screen.findByRole('heading', { name: 'Rounding mode' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Compliance thresholds' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Breach-notification contacts' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Change|Save new version/ })).toBeNull()
  })

  it('hides every write control in a read-only support session', async () => {
    const me = adminMe({ support_session: { id: 's1', tenant_slug: 'acme', ends_at: '2026-11-17T12:00:00.000Z', scope: { permissions: ['settings.manage'] } } })
    renderAs(me, <SettingsPage />, routes())
    expect(await screen.findByRole('heading', { name: 'Rounding mode' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Change|Add contacts|Save new version/ })).toBeNull()
  })
})

describe('setting checks', () => {
  it('takes volumes as whole minor units', () => {
    expect(minorUnitsError('5000', 'it')).toBeNull()
    expect(minorUnitsError('50.00', 'it')).toContain('whole number')
  })

  it('keeps the personal-use flag a proper fraction', () => {
    expect(shareErrors({ numerator: '4', denominator: '3' }).numerator).toBe('The first number cannot be larger than the second.')
  })

  it('needs unique rank names', () => {
    expect(checkRanks([{ name: 'a', threshold: '1' }, { name: 'a', threshold: '2' }]).errors['rank-1-name']).toBe('Each rank name may appear once.')
  })

  it('needs at least one complete breach contact', () => {
    expect(checkContacts([])).toEqual({ 'contact-add': 'Add at least one contact.' })
  })
})
