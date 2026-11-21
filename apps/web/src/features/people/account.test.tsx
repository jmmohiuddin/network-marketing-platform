// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { ParticipantRecord } from './participant-record'
import type { ParticipantDetail } from './types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/people/p1',
  useSearchParams: () => new URLSearchParams(),
}))

const AT = '2026-11-17T09:00:00.000Z'
const MANAGER = adminMe({ permissions: ['participant.read', 'participant.manage', 'participant.unmask', 'legal_hold.manage'] })

function detail(overrides: Partial<ParticipantDetail> = {}): ParticipantDetail {
  return {
    id: 'p1', external_ref: 'BE-A', account_type: 'individual', account_holders_count: 0, market: { id: 'm1', code: 'BE' }, display_name: 'Ann Advance',
    contact_masked: null, status: 'active', merged_into: null, enrolled_at: AT, types: [], agreements: [], positions: [], duplicate_hold: false, ...overrides,
  }
}

const routes = (data: ParticipantDetail, holds: unknown[] = [], extra: Record<string, () => Response> = {}) => fetchByRoute({
  'GET /v1/participants/p1': () => ok(data),
  'GET /v1/legal-holds': () => ok(holds),
  'GET /v1/participants/p1/portal-account': () => ok({ state: 'none' }),
  ...extra,
})

describe('SC-09 account section and legal-hold chip (D-V1A-06, D-V1A-08)', () => {
  it('saves a joint account with its holders; names never appear on the page', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(detail(), [], { 'PUT /v1/participants/p1/account': () => ok({ account_type: 'joint', account_holders_count: 1 }) })
    renderAs(MANAGER, <ParticipantRecord participantId="p1" />, fetchMock)
    const card = await screen.findByTestId('account')
    expect(within(card).getByText('Individual')).toBeTruthy()
    expect(within(card).getByText('None recorded')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Show holders' })).toBeNull()

    await user.click(within(card).getByRole('button', { name: 'Edit account' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit account' })
    await user.selectOptions(within(dialog).getByLabelText('Account type'), 'joint')
    await user.click(within(dialog).getByRole('button', { name: 'Save account' }))
    expect(await within(dialog).findAllByText('Add at least one joint holder.')).toBeTruthy()
    expect(callsTo(fetchMock, 'PUT', '/v1/participants/p1/account')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Add name' }))
    await user.type(within(dialog).getByLabelText('Name 1'), ' Bob Advance ')
    await user.click(within(dialog).getByRole('button', { name: 'Save account' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', '/v1/participants/p1/account')).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/participants/p1/account')[0]![1])).toEqual({ account_type: 'joint', holders: [{ name: 'Bob Advance', role: 'joint_holder' }] })
  })

  it('shows holder names only through the audited unmask and the hold chip links to SC-15', async () => {
    const user = userEvent.setup()
    const fetchMock = routes(detail({ account_type: 'entity', account_holders_count: 2 }), [{ id: 'h1' }], {
      'POST /v1/participants/p1/unmask': () => ok({ contact: {}, account_holders: [{ name: 'Cara Signer', role: 'authorised_signatory' }, { name: 'Dan Joint', role: 'joint_holder' }] }),
    })
    renderAs(MANAGER, <ParticipantRecord participantId="p1" />, fetchMock)
    const card = await screen.findByTestId('account')
    expect(within(card).getByText('Business')).toBeTruthy()
    expect(within(card).getByText('2 names recorded (masked)')).toBeTruthy()
    expect((await screen.findByTestId('legal-hold-chip')).getAttribute('href')).toBe('/privacy?tab=holds')
    expect(screen.queryByText('Cara Signer')).toBeNull()

    await user.click(within(card).getByRole('button', { name: 'Show holders' }))
    const dialog = screen.getByRole('dialog', { name: 'Show account holders' })
    await user.click(within(dialog).getByRole('button', { name: 'Show holders' }))
    expect(await within(dialog).findByText('Cara Signer')).toBeTruthy()
    expect(within(dialog).getByText('Authorised signatory')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/participants/p1/unmask')[0]![1])).toEqual({ fields: ['account_holders'] })
  })

  it('hides account edits for a read-only tenant', async () => {
    renderAs(adminMe({ ...MANAGER, tenant: { ...MANAGER.tenant!, read_only: true } }), <ParticipantRecord participantId="p1" />, routes(detail({ account_type: 'joint', account_holders_count: 1 })))
    const card = await screen.findByTestId('account')
    expect(within(card).queryByRole('button', { name: 'Edit account' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Show holders' })).toBeNull()
  })
})
