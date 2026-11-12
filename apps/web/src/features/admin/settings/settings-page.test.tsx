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

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/settings' }))

const KEYS = ['compliance.active_pv_minor', 'compliance.rank_thresholds_pv_minor', 'compliance.late_order_day', 'compliance.personal_share_flag', 'privacy.breach_contacts']
const LATEST = 3

function setting(key: string, value: unknown = null) {
  return () => json(200, { data: { key, value, version: value === null ? null : LATEST, effective_from: value === null ? null : '2026-11-01T00:00:00.000Z' }, meta: { latest_version: LATEST } })
}

function unsetRoutes(extra: Record<string, () => Response> = {}) {
  return fetchByRoute({ ...Object.fromEntries(KEYS.map((key) => [`GET /v1/settings/${key}`, setting(key)])), ...extra })
}

describe('SettingsPage', () => {
  it('ships no threshold values and explains what an unset threshold does', async () => {
    renderAs(adminMe(), <SettingsPage />, unsetRoutes())
    expect(await screen.findByText('Report R4 leaves out the active-earner figures.')).toBeTruthy()
    expect(screen.getAllByText('Not set')).toHaveLength(4)
    expect(screen.getByText('No thresholds are set for you')).toBeTruthy()
    expect(screen.getByText('No breach contact recorded')).toBeTruthy()
  })

  it('drops the unset-thresholds banner once every threshold is set (BUG-017)', async () => {
    renderAs(adminMe(), <SettingsPage />, fetchByRoute({
      'GET /v1/settings/compliance.active_pv_minor': setting('compliance.active_pv_minor', '5000'),
      'GET /v1/settings/compliance.rank_thresholds_pv_minor': setting('compliance.rank_thresholds_pv_minor', { leader: '10000' }),
      'GET /v1/settings/compliance.late_order_day': setting('compliance.late_order_day', 27),
      'GET /v1/settings/compliance.personal_share_flag': setting('compliance.personal_share_flag', { numerator: '1', denominator: '3' }),
      'GET /v1/settings/privacy.breach_contacts': setting('privacy.breach_contacts'),
    }))
    expect(await screen.findByText('Day 27 of the month')).toBeTruthy()
    expect(screen.queryByText('Not set')).toBeNull()
    expect(screen.queryByText(/thresholds? (are|is) not set|No thresholds are set/)).toBeNull()
  })

  it('opens an unset threshold empty and saves it with If-Match and a reason', async () => {
    const user = userEvent.setup()
    const fetchMock = unsetRoutes({
      'PUT /v1/settings/compliance.late_order_day': () => json(200, { data: { key: 'compliance.late_order_day', value: 25, version: 4 }, meta: {} }),
    })
    renderAs(adminMe(), <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Change late-order day' }))
    const day = screen.getByLabelText('Day of the month from which an order counts as late') as HTMLInputElement
    expect(day.value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Save change' }))
    const summary = screen.getByRole('alert').textContent
    expect(summary).toContain('Enter a day of the month from 1 to 31.')
    expect(summary).toContain('Enter the reason for this change.')
    await user.type(day, '25')
    await user.type(screen.getByLabelText('Reason for the change'), 'Agreed with counsel')
    await user.click(screen.getByRole('button', { name: 'Save change' }))
    expect(await screen.findByText('Late-order day saved. It applies from now on.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/settings/compliance.late_order_day')[0]!
    expect(bodyOf(init)).toEqual({ value: 25, reason: 'Agreed with counsel' })
    expect(headerOf(init, 'If-Match')).toBe(`"${LATEST}"`)
  })

  it('shows a concurrent change and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const fetchMock = unsetRoutes({
      'PUT /v1/settings/privacy.breach_contacts': () => apiError(412, 'PRECONDITION_FAILED', 'Settings changed since you loaded them. Reload and try again.'),
    })
    renderAs(adminMe(), <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Add contacts' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add contact' }))
    await user.type(within(dialog).getByLabelText('Name'), 'Dee Pio')
    await user.type(within(dialog).getByLabelText('Role'), 'Data protection officer')
    await user.type(within(dialog).getByLabelText('Email address'), 'dpo@acme.example')
    await user.type(within(dialog).getByLabelText('Phone number'), '+44 20 7946 0000')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Onboarding')
    await user.click(within(dialog).getByRole('button', { name: 'Save change' }))
    expect(await within(dialog).findByText('Settings changed since you loaded them. Reload and try again.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/settings/privacy.breach_contacts')[0]!
    expect(bodyOf(init)).toEqual({
      value: [{ name: 'Dee Pio', role: 'Data protection officer', email: 'dpo@acme.example', phone: '+44 20 7946 0000' }],
      reason: 'Onboarding',
    })
  })

  it('names each rank row’s fields and remove button by its number (BUG-021)', async () => {
    const user = userEvent.setup()
    renderAs(adminMe(), <SettingsPage />, unsetRoutes())
    await user.click(await screen.findByRole('button', { name: 'Change rank thresholds' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add rank' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add rank' }))
    for (const rank of [1, 2]) {
      expect(within(dialog).getAllByLabelText(`Rank ${rank} name`)).toHaveLength(1)
      expect(within(dialog).getAllByLabelText(`Rank ${rank} personal volume`)).toHaveLength(1)
      expect(within(dialog).getAllByRole('button', { name: `Remove rank ${rank}` })).toHaveLength(1)
    }
  })

  it('shows values in force', async () => {
    renderAs(adminMe(), <SettingsPage />, fetchByRoute({
      ...Object.fromEntries(KEYS.map((key) => [`GET /v1/settings/${key}`, setting(key)])),
      'GET /v1/settings/compliance.personal_share_flag': setting('compliance.personal_share_flag', { numerator: '1', denominator: '3' }),
    }))
    expect(await screen.findByText('More than 1 out of 3')).toBeTruthy()
    expect(screen.getAllByText('Not set')).toHaveLength(3)
    expect(screen.getByText('3 thresholds are not set')).toBeTruthy()
  })

  it('shows each breach contact as a card with role, name, email and phone', async () => {
    const contact = { name: 'Dee Pio', role: 'Data protection officer', email: 'dpo@acme.example', phone: '+44 20 7946 0000' }
    renderAs(adminMe(), <SettingsPage />, unsetRoutes({ 'GET /v1/settings/privacy.breach_contacts': setting('privacy.breach_contacts', [contact]) }))
    const list = await screen.findByRole('list', { name: 'Breach-notification contacts' })
    const card = within(list).getByRole('heading', { name: 'Dee Pio' }).closest('li')!
    expect(within(card).getByText('Data protection officer')).toBeTruthy()
    expect(within(card).getByText('dpo@acme.example')).toBeTruthy()
    expect(within(card).getByText('+44 20 7946 0000')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change contacts' })).toBeTruthy()
    expect(screen.queryByText('No breach contact recorded')).toBeNull()
  })
})

describe('setting checks', () => {
  it('takes volumes as whole minor units', () => {
    expect(minorUnitsError('5000', 'it')).toBeNull()
    expect(minorUnitsError('50.00', 'it')).toContain('whole number')
    expect(minorUnitsError('99999999999999999999', 'it')).toContain('whole number')
  })

  it('keeps the personal-use flag a proper fraction', () => {
    expect(shareErrors({ numerator: '1', denominator: '3' })).toEqual({ numerator: null, denominator: null })
    expect(shareErrors({ numerator: '4', denominator: '3' }).numerator).toBe('The first number cannot be larger than the second.')
    expect(shareErrors({ numerator: '0', denominator: '0' }).denominator).toBe('The second number must be greater than zero.')
  })

  it('needs unique rank names', () => {
    expect(checkRanks([{ name: 'leader', threshold: '10000' }]).value).toEqual({ leader: '10000' })
    expect(checkRanks([{ name: 'a', threshold: '1' }, { name: 'a', threshold: '2' }]).errors['rank-1-name']).toBe('Each rank name may appear once.')
    expect(checkRanks([]).errors['rank-add']).toBe('Add at least one rank.')
  })

  it('needs at least one complete breach contact', () => {
    expect(checkContacts([])).toEqual({ 'contact-add': 'Add at least one contact.' })
    expect(checkContacts([{ name: 'A', role: 'DPO', email: 'a@b.example', phone: 'call me' }])).toEqual({ 'contact-0-phone': 'Enter a phone number, for example +44 20 7946 0000.' })
  })
})
