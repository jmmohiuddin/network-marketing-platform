// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../test-support'
import { decisionRefusal, EFFECTIVE_PASSED } from './change-requests'
import { SettingsPage } from './settings-page'
import { policyValue } from './policy-fields'
import { effectiveError } from './version-dialog'
import { structureLines, versionState } from './versions-section'
import type { ChangeRequest, VersionSummary } from './types'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings', useSearchParams: () => router.params }))

const ADMIN = adminMe()
const FINANCE = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000f2', email: 'fay@acme.example', display_name: 'Fay Finance' },
  permissions: ['settings.approve'],
})
const FAY = { user_id: FINANCE.user.id, display_name: 'Fay Finance', email: 'fay@acme.example' }

function settings(values: Record<string, unknown> = {}) {
  const keys = ['money.rounding_mode', 'money.clawback_policy', 'plan.activation_notice_days']
  return () => json(200, {
    data: { version: 5, effective_from: '2026-11-01T00:00:00.000Z', values: Object.fromEntries(keys.map((key) => [key, { value: values[key] ?? null, value_since: null }])) },
    meta: { latest_version: 7 },
  })
}

const REQUEST: ChangeRequest = {
  id: '0f000000-0000-4000-8000-000000000001', key: 'money.rounding_mode', value: 'half_even', effective_from: '2026-12-01T00:00:00.000Z',
  reason: 'Align with the bank', base_version: 7, state: 'pending', requested_by: { id: ADMIN.user.id, display_name: 'Ada Admin' },
  requested_at: '2026-11-17T09:00:00.000Z', decided_by: null, decided_at: null, decision_reason: null, version: null,
  eligible_approvers: [FAY], no_eligible_approver: false,
}

const VERSION: VersionSummary = {
  id: 'v8', version: 8, effective_from: '2026-12-01T00:00:00.000Z', reason: 'Align with the bank', created_at: '2026-11-17T10:00:00.000Z',
  created_by: { id: ADMIN.user.id, display_name: 'Ada Admin' }, approval: { approver: { id: FAY.user_id, display_name: 'Fay Finance' }, decided_at: '2026-11-17T10:00:00.000Z' },
  superseded_by_version: null, changed: [{ key: 'money.rounding_mode' }],
}

function routes(requests: readonly ChangeRequest[], extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/settings': settings(),
    'GET /v1/setting-change-requests': () => json(200, { data: requests, meta: {} }),
    'GET /v1/settings/versions': () => json(200, { data: [VERSION], meta: {} }),
    ...extra,
  })
}

describe('money policies', () => {
  it('states the platform rounding rule and shows the clawback default as retired', async () => {
    renderAs(ADMIN, <SettingsPage />, routes([]))
    const rounding = (await screen.findByRole('heading', { name: 'Rounding mode' })).closest('li')!
    expect(within(rounding).getByText('Platform rule')).toBeTruthy()
    expect(within(rounding).getByText(/platform rule BR-MNY-02 applies, rounding half up/)).toBeTruthy()
    const clawback = screen.getByRole('heading', { name: 'Clawback default' }).closest('li')!
    expect(within(clawback).getAllByText('Retired: set per bonus on the plan version.').length).toBeGreaterThan(0)
    // D-B4-06: retired, so never offered for change.
    expect(screen.queryByRole('button', { name: 'Change clawback default' })).toBeNull()
  })

  it('sends a money change with its effective date; the 202 change request waits for Finance', async () => {
    const user = userEvent.setup()
    const fetchMock = routes([], {
      'PUT /v1/settings/money.rounding_mode': () => json(202, { data: { change_request: REQUEST }, meta: { latest_version: 7 } }),
    })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    await user.click(await screen.findByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Save new version with effective date' })
    expect(within(dialog).getByText('Needs Finance approval')).toBeTruthy()
    await user.selectOptions(within(dialog).getByLabelText('Rounding mode'), 'half_even')
    await user.type(within(dialog).getByLabelText('Effective from'), '2026-12-01T00:00')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Align with the bank')
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByText('Rounding mode change sent. Waiting for Finance approval.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/settings/money.rounding_mode')[0]!
    expect(bodyOf(init)).toEqual({ value: 'half_even', reason: 'Align with the bank', effective_from: new Date('2026-12-01T00:00').toISOString() })
    expect(headerOf(init, 'If-Match')).toBe('"7"')
    expect(callsTo(fetchMock, 'GET', '/v1/setting-change-requests').length).toBeGreaterThan(1)
  })

  it('refuses a past date on the field itself, without sending it (BUG-055)', async () => {
    const user = userEvent.setup()
    const fetchMock = routes([])
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Change rounding mode' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Rounding mode'), 'half_even')
    await user.type(within(dialog).getByLabelText('Effective from'), '2020-01-01T00:00')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Policy')
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    const field = within(dialog).getByLabelText('Effective from')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(within(dialog).getByRole('link', { name: /cannot take effect in the past/ }).getAttribute('href')).toBe('#version-effective')
    expect(callsTo(fetchMock, 'PUT', '/v1/settings/money.rounding_mode')).toHaveLength(0)
  })

  it('shows the server’s refusal of the date on the Effective from field, not as a raw message (BUG-055)', async () => {
    const user = userEvent.setup()
    renderAs(ADMIN, <SettingsPage />, routes([], {
      'PUT /v1/settings/money.rounding_mode': () => apiError(422, 'SETTING_EFFECTIVE_FROM_INVALID', 'effective_from cannot be in the past.'),
    }))
    await user.click(await screen.findByRole('button', { name: 'Change rounding mode' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Rounding mode'), 'half_even')
    await user.type(within(dialog).getByLabelText('Effective from'), '2099-01-01T00:00')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Policy')
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    const link = await within(dialog).findByRole('link', { name: /cannot take effect in the past/ })
    expect(link.getAttribute('href')).toBe('#version-effective')
    expect(within(dialog).getByLabelText('Effective from').getAttribute('aria-invalid')).toBe('true')
    expect(within(dialog).queryByText('effective_from cannot be in the past.')).toBeNull()
  })
})

describe('change requests', () => {
  it('lists who can approve and lets the requester withdraw, never approve', async () => {
    renderAs(ADMIN, <SettingsPage />, routes([REQUEST]))
    const card = await screen.findByRole('article', { name: /Rounding mode/ })
    expect(within(card).getByText('Fay Finance (fay@acme.example)')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('approves after step-up with the same Idempotency-Key', async () => {
    const user = userEvent.setup()
    let calls = 0
    const fetchMock = routes([REQUEST], {
      [`POST /v1/setting-change-requests/${REQUEST.id}/decision`]: () => {
        calls += 1
        return calls === 1 ? apiError(403, 'STEP_UP_REQUIRED') : json(200, { data: { change_request: { ...REQUEST, state: 'approved' }, version: 8 }, meta: {} })
      },
      'POST /v1/auth/sessions/current/step-up': () => json(200, { data: { assurance: 'aal2' }, meta: {} }),
    })
    renderAs(FINANCE, <SettingsPage />, fetchMock)
    const card = await screen.findByRole('article', { name: /Rounding mode/ })
    await user.click(within(card).getByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve rounding mode change' })
    expect(within(dialog).getByText(/You may be asked for a code from your authenticator app\./)).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Reason'), 'Checked with treasury')
    await user.click(within(dialog).getByRole('button', { name: 'Approve rounding mode change' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Rounding mode change approved.')).toBeTruthy()
    const decisions = callsTo(fetchMock, 'POST', `/v1/setting-change-requests/${REQUEST.id}/decision`)
    expect(decisions).toHaveLength(2)
    expect(headerOf(decisions[0]![1], 'Idempotency-Key')).toBe(headerOf(decisions[1]![1], 'Idempotency-Key'))
    expect(bodyOf(decisions[1]![1])).toEqual({ decision: 'approve', reason: 'Checked with treasury' })
  })

  it('shows a separation-of-duties refusal with the eligible approvers', async () => {
    const user = userEvent.setup()
    const other = { ...REQUEST, requested_by: { id: 'someone-else', display_name: 'Sam Else' } }
    renderAs(FINANCE, <SettingsPage />, routes([other], {
      [`POST /v1/setting-change-requests/${REQUEST.id}/decision`]: () => apiError(422, 'SOD_SELF_APPROVAL', 'You prepared or contributed to this, so someone else must decide it.', {
        reason_code: 'SOD-01', eligible_approvers: [{ user_id: 'u9', display_name: 'Gil Gold', email: 'gil@acme.example' }], no_eligible_approver: false,
      }),
    }))
    await user.click(within(await screen.findByRole('article', { name: /Rounding mode/ })).getByRole('button', { name: 'Reject' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'No')
    await user.click(within(dialog).getByRole('button', { name: 'Reject rounding mode change' }))
    expect(await within(dialog).findByText(/Who can decide it: Gil Gold \(gil@acme\.example\)\./)).toBeTruthy()
  })

  it('names the missing approver role and offers no approval when nobody can approve', async () => {
    renderAs(FINANCE, <SettingsPage />, routes([{ ...REQUEST, requested_by: { id: 'x', display_name: 'X' }, eligible_approvers: [], no_eligible_approver: true }]))
    const card = await screen.findByRole('article', { name: /Rounding mode/ })
    expect(within(card).getByText('No one can approve this yet: a Tenant admin must assign Finance approver to another user.')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('BUG-083: hides Approve once the effective time has passed and says to withdraw and request again', async () => {
    const passed = { ...REQUEST, requested_by: { id: 'x', display_name: 'X' }, effective_from: '2026-01-01T00:00:00.000Z' }
    renderAs(FINANCE, <SettingsPage />, routes([passed]))
    const card = await screen.findByRole('article', { name: /Rounding mode/ })
    expect(within(card).getByText(EFFECTIVE_PASSED)).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeTruthy()
  })

  it('BUG-083: a decision refused with SETTING_EFFECTIVE_FROM_INVALID shows the same sentence', async () => {
    const user = userEvent.setup()
    const other = { ...REQUEST, requested_by: { id: 'x', display_name: 'X' }, effective_from: new Date(Date.now() + 60 * 60_000).toISOString() }
    renderAs(FINANCE, <SettingsPage />, routes([other], {
      [`POST /v1/setting-change-requests/${REQUEST.id}/decision`]: () => apiError(422, 'SETTING_EFFECTIVE_FROM_INVALID', 'effective_from cannot be in the past.'),
    }))
    await user.click(within(await screen.findByRole('article', { name: /Rounding mode/ })).getByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Checked')
    await user.click(within(dialog).getByRole('button', { name: 'Approve rounding mode change' }))
    expect(await within(dialog).findByText(EFFECTIVE_PASSED)).toBeTruthy()
    expect(decisionRefusal(new Error('other'))).toBeInstanceOf(Error)
  })
})

describe('versions', () => {
  it('lists versions with author and approver and opens the diff drawer from the URL', async () => {
    const user = userEvent.setup()
    router.params = new URLSearchParams('version=8')
    const policy: VersionSummary = {
      ...VERSION, id: 'v9', version: 9, changed: [{ key: 'genealogy.visibility_policy' }],
      approval: { approver: { id: 'dpo', display_name: 'Dee Protection' }, decided_at: VERSION.created_at },
    }
    renderAs(ADMIN, <SettingsPage />, routes([], {
      'GET /v1/settings/versions': () => json(200, { data: [policy, VERSION], meta: {} }),
      'GET /v1/settings/versions/8': () => json(200, { data: { ...VERSION, changes: [{ key: 'money.rounding_mode', before: 'half_up', after: 'half_even' }] }, meta: {} }),
    }))
    const table = await screen.findByRole('table', { name: 'Settings versions' })
    expect((await within(table).findAllByText('Scheduled')).length).toBe(2)
    // The approver is named with the role the change needed, not "Finance approver" for every version (BUG-074).
    expect(within(table).getByRole('columnheader', { name: 'Approver' })).toBeTruthy()
    expect(within(table).getByText('Fay Finance (Finance approver)')).toBeTruthy()
    expect(within(table).getByText('Dee Protection (DPO)')).toBeTruthy()
    const drawer = await screen.findByRole('dialog', { name: 'Version 8' })
    expect(await within(drawer).findByText('Half up')).toBeTruthy()
    expect(within(drawer).getByText('Half even')).toBeTruthy()
    expect(within(drawer).getByText(/^Fay Finance \(Finance approver\), /)).toBeTruthy()
    await user.click(within(table).getByRole('button', { name: 'View diff of version 8' }))
    expect(router.replace).toHaveBeenLastCalledWith('/settings?version=8')
    router.params = new URLSearchParams()
  })
})

describe('helpers', () => {
  it('builds policy values and needs a date for money keys only', () => {
    expect(policyValue('money.clawback_policy', { value: 'restatement' })).toEqual({ value: { default: 'restatement' }, errors: {} })
    expect(policyValue('plan.activation_notice_days', { value: '400' }).errors.value).toContain('0 to 365')
    expect(effectiveError('money.rounding_mode', '').error).toBe('Enter the date and time the change takes effect.')
    expect(effectiveError('plan.activation_notice_days', '')).toEqual({ iso: null, error: null })
    const now = Date.parse('2026-11-17T12:00:00.000Z')
    expect(effectiveError('money.rounding_mode', '2026-11-01T00:00', now).error).toContain('cannot take effect in the past')
    expect(effectiveError('money.rounding_mode', '2027-01-01T00:00', now).error).toBeNull()
  })

  it('names a version’s state and structure changes', () => {
    expect(versionState({ ...VERSION, superseded_by_version: 9 }, 5, 0).label).toBe('Superseded by version 9')
    expect(versionState(VERSION, 8, 0).label).toBe('In force')
    const part = { added: [], removed: [], changed: [] }
    expect(structureLines({ markets: { ...part, added: [{ id: 'm', code: 'FR' }] }, brands: part, calendars: { ...part, removed: [{ id: 'c', name: 'FR monthly' }] } }))
      .toEqual(['Markets added: FR', 'Calendars removed: FR monthly'])
  })
})
