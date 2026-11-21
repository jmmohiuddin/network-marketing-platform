// @vitest-environment jsdom
import '../../test/dom'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '../../lib/format'
import { POLL_INTERVAL_MS } from '../../lib/use-resource'
import { apiError, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { ParticipantRecord } from './participant-record'
import type { PortalAccount } from './portal-access'
import type { ParticipantDetail } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/people/p1',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const SUPPORT = adminMe({ permissions: ['participant.read', 'participant.manage'] })
const READER = adminMe({ permissions: ['participant.read'] })
const AT = '2026-11-17T09:00:00.000Z'
const PATH = '/v1/participants/p1/portal-account'

function detail(overrides: Partial<ParticipantDetail> = {}): ParticipantDetail {
  return {
    id: 'p1', external_ref: 'DE-A', account_type: 'individual', account_holders_count: 0, market: { id: 'm1', code: 'DE' }, display_name: 'Ann Example',
    contact_masked: { email: 'a•••@e•••.test' }, status: 'active', merged_into: null, enrolled_at: AT, pseudonymised_at: null,
    types: [], agreements: [], positions: [], duplicate_hold: false, ...overrides,
  }
}

const account = (overrides: Partial<PortalAccount> = {}): PortalAccount => ({
  state: 'none', email_masked: null, invited_at: null, last_sign_in_at: null, mfa_enrolled: false, ...overrides,
})

function routes(record: ParticipantDetail, portal: () => Response, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({ 'GET /v1/participants/p1': () => ok(record), [`GET ${PATH}`]: portal, ...extra })
}

beforeEach(() => {
  navigation.search = ''
})

describe('SC-09 Portal access (D-B5-05)', () => {
  it('invites a member with an Idempotency-Key, shows the invited state and the sent time once the mail job wrote it (BUG-113)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let state = account()
    const fetchMock = routes(detail(), () => ok(state), {
      [`POST ${PATH}`]: () => {
        // The invitation row is written by the mail job after the 201.
        state = account({ state: 'invited', email_masked: 'a•••@e•••.test', invited_at: null })
        return ok({ state: 'invited' }, 201)
      },
    })
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, fetchMock)
    const card = await screen.findByTestId('portal-access')
    expect(await within(card).findByText('No portal account')).toBeTruthy()
    await userEvent.click(within(card).getByRole('button', { name: 'Invite to the portal' }))
    expect(await screen.findByText('Invitation sent to the member’s contact email.')).toBeTruthy()
    expect(await within(card).findByText('Invited')).toBeTruthy()
    expect(within(card).getByText('Being sent')).toBeTruthy()
    state = { ...state, invited_at: AT }
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(await within(card).findByText(formatDateTime(AT))).toBeTruthy()
    vi.useRealTimers()
    expect(headerOf(callsTo(fetchMock, 'POST', PATH)[0]![1], 'Idempotency-Key')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Re-send invitation' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Deactivate' })).toBeTruthy()
  })

  it('says why a member cannot be invited, and that another member uses the email', async () => {
    let answer = () => apiError(422, 'PORTAL_NOT_ELIGIBLE', 'This member cannot have a portal account.', { reason: 'not_can_earn' })
    const fetchMock = routes(detail(), () => ok(account()), { [`POST ${PATH}`]: () => answer() })
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, fetchMock)
    const card = await screen.findByTestId('portal-access')
    await userEvent.click(await within(card).findByRole('button', { name: 'Invite to the portal' }))
    expect(await within(card).findByText('This member cannot have a portal account: their type is not an earning type.')).toBeTruthy()
    answer = () => apiError(409, 'PORTAL_EMAIL_IN_USE', "Another member's portal account uses this email.")
    await userEvent.click(within(card).getByRole('button', { name: 'Invite to the portal' }))
    expect(await within(card).findByText("Another member's portal account uses this email.")).toBeTruthy()
  })

  it('deactivates an active account with a reason', async () => {
    const fetchMock = routes(detail(), () => ok(account({ state: 'active', email_masked: 'a•••@e•••.test', last_sign_in_at: AT })), {
      [`POST ${PATH}/deactivate`]: () => ok(account({ state: 'deactivated' })),
    })
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, fetchMock)
    const card = await screen.findByTestId('portal-access')
    expect(await within(card).findByText('a•••@e•••.test')).toBeTruthy()
    await userEvent.click(within(card).getByRole('button', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate the portal account' })
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Left the business')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate account' }))
    expect(await screen.findByText('Portal account deactivated. Its sessions have ended.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `${PATH}/deactivate`)[0]![1])).toEqual({ reason: 'Left the business' })
  })

  it('shows the state without actions to a reader', async () => {
    renderAs(READER, <ParticipantRecord participantId="p1" />, routes(detail(), () => ok(account({ state: 'invited', invited_at: AT }))))
    const card = await screen.findByTestId('portal-access')
    expect(await within(card).findByText('Invited')).toBeTruthy()
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('heads an erased participant "Erased participant <ref>" without contact, unmask or invitation', async () => {
    const erased = detail({ display_name: 'Erased participant DE-A', contact_masked: null, pseudonymised_at: AT })
    renderAs(adminMe({ permissions: ['participant.read', 'participant.manage', 'participant.unmask'] }), <ParticipantRecord participantId="p1" />,
      routes(erased, () => ok(account({ state: 'deactivated' }))))
    expect(await screen.findByRole('heading', { level: 1, name: 'Erased participant DE-A' })).toBeTruthy()
    expect(screen.getAllByText('Personal data erased').length).toBe(2) // header chip and banner
    expect(screen.queryByRole('button', { name: 'Show contact' })).toBeNull()
    const card = await screen.findByTestId('portal-access')
    expect(await within(card).findByText('Deactivated')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: /Invite/ })).toBeNull()
  })
})
