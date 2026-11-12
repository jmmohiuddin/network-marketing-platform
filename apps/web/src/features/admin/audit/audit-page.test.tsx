// @vitest-environment jsdom
import '../../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, renderAs } from '../test-support'
import type { AuditEvent } from '../types'
import { checkDraft, filtersFrom } from './audit-filters'
import { AuditPage } from './audit-page'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/settings/audit',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const EVENT: AuditEvent = {
  id: 'e1', seq: '12', occurred_at: '2026-11-12T08:00:00.000Z', actor_type: 'user', actor_id: '00000000-0000-4000-8000-000000000001',
  support_session_id: null, action: 'USER.INVITED', object_type: 'user_account', object_id: '00000000-0000-4000-8000-000000000009',
  before: null, after: { state: 'invited' }, reason: null, request_id: 'req-9', hash: 'ab12',
}

describe('AuditPage', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.router.replace.mockClear()
  })

  it('searches with the filters from the URL and opens an event', async () => {
    navigation.search = 'action=USER.INVITED'
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({ 'GET /v1/audit-events': () => ok([EVENT]) })
    renderAs(adminMe(), <AuditPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Open event 12, USER.INVITED' }))
    expect(screen.getByRole('dialog', { name: 'Audit event 12' }).textContent).toContain('"state": "invited"')
    expect(callsTo(fetchMock, 'GET', '/v1/audit-events')[0]?.[0]).toContain('action=USER.INVITED')
  })

  it('applies filters through the URL and refuses a malformed id', async () => {
    const user = userEvent.setup()
    renderAs(adminMe(), <AuditPage />, fetchByRoute({ 'GET /v1/audit-events': () => ok([]) }))
    expect(await screen.findByText('No events recorded yet.')).toBeTruthy()
    await user.type(screen.getByLabelText(/Object ID/), '42')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter a full ID')
    await user.clear(screen.getByLabelText(/Object ID/))
    await user.type(screen.getByLabelText(/^Action/), 'ROLE.GRANTED')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(navigation.router.replace).toHaveBeenCalledWith('/settings/audit?action=ROLE.GRANTED')
  })

  it('explains an export above the row cap', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/audit-events': () => ok([EVENT]),
      'POST /v1/audit-exports': () => apiError(422, 'EXPORT_ROW_CAP_EXCEEDED', 'Too large', { row_count: 60000, row_cap: 50000 }),
    })
    renderAs(adminMe(), <AuditPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Export events' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Export events' }))
    const refusal = await screen.findByText(/Nothing was exported/)
    expect(refusal.textContent).toMatch(/60.000 rows; the limit is 50.000 rows/)
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/audit-exports')[0]![1])).toEqual({ filters: {} })
  })

  it('offers the CSV of an export within the cap', async () => {
    const user = userEvent.setup()
    renderAs(adminMe(), <AuditPage />, fetchByRoute({
      'GET /v1/audit-events': () => ok([EVENT]),
      'POST /v1/audit-exports': () => ok({ id: 'x1', row_count: '1', download: '/v1/audit-exports/x1/download' }, 201),
    }))
    await user.click(await screen.findByRole('button', { name: 'Export events' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Export events' }))
    expect((await screen.findByRole('link', { name: 'Download CSV' })).getAttribute('href')).toBe('/v1/audit-exports/x1/download')
  })

  it('hides the export without the export permission', async () => {
    renderAs(adminMe({ permissions: ['audit.read'] }), <AuditPage />, fetchByRoute({ 'GET /v1/audit-events': () => ok([]) }))
    await screen.findByText('No events recorded yet.')
    expect(screen.queryByRole('button', { name: 'Export events' })).toBeNull()
  })

  it('reports a broken chain', async () => {
    const user = userEvent.setup()
    renderAs(adminMe(), <AuditPage />, fetchByRoute({
      'GET /v1/audit-events': () => ok([EVENT]),
      'GET /v1/audit-chain/verification': () => ok({ intact: false, first_broken_seq: '7', events: '12', verified_at: '2026-11-12T09:00:00.000Z' }),
    }))
    await user.click(await screen.findByRole('button', { name: 'Verify audit chain' }))
    expect((await screen.findByText('The audit chain is broken')).closest('[role="alert"]')?.textContent).toContain('breaks at event 7')
  })
})

describe('audit filters', () => {
  it('reads only known filters from the URL', () => {
    expect(filtersFrom(new URLSearchParams('action=A&tab=x&object_type='))).toEqual({ action: 'A' })
  })

  it('needs the end after the start', () => {
    const draft = { actor_id: '', action: '', object_type: '', object_id: '', from: '2026-11-12T10:00', to: '2026-11-12T09:00' }
    expect(checkDraft(draft).errors.to).toBe('The end must be after the start.')
  })
})
