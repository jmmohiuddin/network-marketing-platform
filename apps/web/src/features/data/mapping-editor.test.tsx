// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { json, ok, requestBody, requestHeaders } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { MappingEditor } from './mapping-editor'
import { callsOf, fetchRoutes, USER_ID, withSession } from './test-support'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const search = vi.hoisted(() => ({ value: 'batch=b1' }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/imports/mappings', useSearchParams: () => new URLSearchParams(search.value) }))

const DRAFT = {
  id: 'm3', version: 3, state: 'draft', notes: null, created_by: 'someone-else', created_at: '2026-11-01T10:00:00Z', approved_by: null,
  mappings: { participant_types: { distributor: { can_earn: true, counts_as_end_customer: false } }, purposes: { P: 'personal' }, source_kinds: {}, starter_kits: {} },
}
const VALUES = {
  batch_id: 'b1', state: 'validated',
  source_values: { participant_types: { distributor: 4, customer: 2 }, purposes: { P: 3, R: 1 }, source_kinds: { DL: 5 }, starter_kits: {} },
}

const routes = (draft: object = DRAFT) => [
  ['GET', /^\/v1\/import-mappings\?/, () => json(200, { data: [draft], meta: { next_cursor: null, latest_version: 3 } })],
  ['GET', /^\/v1\/import-mappings\/m3$/, () => ok(draft)],
  ['GET', /^\/v1\/imports\/b1\/source-values$/, () => ok(VALUES)],
] as const

describe('MappingEditor', () => {
  beforeEach(() => {
    search.value = 'batch=b1'
    router.replace.mockReset()
  })

  it('lists the batch codes with counts, explains unmapped ones and saves a new draft version with If-Match', async () => {
    const user = userEvent.setup()
    const created = { ...DRAFT, id: 'm4', version: 4, created_by: USER_ID }
    const fetchMock = fetchRoutes(...routes(), ['PUT', /^\/v1\/import-mappings$/, () => ok(created, 201)])
    renderWithProviders(withSession(<MappingEditor />, ['mapping.edit', 'import.manage']), fetchMock)
    expect(await screen.findByRole('heading', { name: 'Import mapping, version 3' })).toBeTruthy()
    const warning = screen.getByText('3 partner codes are not mapped').closest('.banner') as HTMLElement
    expect(warning.textContent).toContain('R, DL')
    expect(warning.textContent).toContain('customer')
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    await user.selectOptions(screen.getByLabelText('Can earn: customer'), 'no')
    await user.selectOptions(screen.getByLabelText('Counts as end customer: customer'), 'yes')
    await user.selectOptions(screen.getByLabelText('Source kind: DL'), 'downline_volume')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    const put = callsOf(fetchMock).findIndex((call) => call.startsWith('PUT'))
    expect(requestHeaders(fetchMock, put).get('If-Match')).toBe('"3"')
    expect(requestBody(fetchMock, put)).toEqual({
      mappings: {
        participant_types: { customer: { can_earn: false, counts_as_end_customer: true }, distributor: { can_earn: true, counts_as_end_customer: false } },
        purposes: { P: 'personal' },
        source_kinds: { DL: 'downline_volume' },
        starter_kits: {},
      },
    })
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/imports/mappings?version=m4&batch=b1'))
  })

  it('refuses a half-answered participant type before sending', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchRoutes(...routes())
    renderWithProviders(withSession(<MappingEditor />, ['mapping.edit']), fetchMock)
    await user.selectOptions(await screen.findByLabelText('Can earn: customer'), 'yes')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(screen.getByRole('alert').textContent).toContain('participant type "customer"')
    expect(callsOf(fetchMock).some((call) => call.startsWith('PUT'))).toBe(false)
  })

  it('lets another user approve the draft, read-only, after a reason', async () => {
    search.value = ''
    const user = userEvent.setup()
    const approved = { ...DRAFT, state: 'approved', approved_by: USER_ID }
    const fetchMock = fetchRoutes(...routes().slice(0, 2), ['POST', /^\/v1\/import-mappings\/m3\/approve$/, () => ok(approved)])
    renderWithProviders(withSession(<MappingEditor />, ['mapping.approve', 'compliance.read']), fetchMock)
    await screen.findByRole('heading', { name: 'Import mapping, version 3' })
    expect(screen.getAllByRole('table').every((table) => within(table).queryByRole('combobox') === null)).toBe(true)
    expect(screen.getByRole('cell', { name: 'Personal' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Approve version 3' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve mapping version 3' })
    await user.type(within(dialog).getByLabelText(/Reason/), 'Checked with finance')
    await user.click(within(dialog).getByRole('button', { name: 'Approve version 3' }))
    const post = callsOf(fetchMock).findIndex((call) => call.startsWith('POST'))
    expect(requestBody(fetchMock, post)).toEqual({ reason: 'Checked with finance' })
  })

  it('shows no approve button to the author of the draft', async () => {
    search.value = ''
    const fetchMock = fetchRoutes(...routes({ ...DRAFT, created_by: USER_ID }).slice(0, 2))
    renderWithProviders(withSession(<MappingEditor />, ['mapping.approve', 'mapping.edit']), fetchMock)
    expect(await screen.findByText('You saved this version, so another user with approval rights must approve it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  })
})

describe('MappingEditor on an approved version', () => {
  it('shows it read-only until the editor starts a new draft from it', async () => {
    search.value = ''
    const user = userEvent.setup()
    const approved = { ...DRAFT, state: 'approved', approved_by: 'someone' }
    renderWithProviders(withSession(<MappingEditor />, ['mapping.edit']), fetchRoutes(...routes(approved).slice(0, 2)))
    await user.click(await screen.findByRole('button', { name: 'Start a new draft from version 3' }))
    expect(screen.getByLabelText('Purpose: P')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy()
  })
})
