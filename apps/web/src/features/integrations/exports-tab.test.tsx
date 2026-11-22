// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { IntegrationsPage } from './integrations-page'
import type { FullExport, FullExportDetail } from './types'

const navigation = vi.hoisted(() => ({ search: 'tab=exports', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/settings/integrations',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
const saved = vi.hoisted(() => ({ saveFile: vi.fn() }))
vi.mock('../data/transfer', () => ({ saveFile: saved.saveFile }))

const X = '00000000-0000-4000-8000-0000000000e1'
const DATA_ROLE = { assignment_id: 'a1', role_id: 'r1', name: 'Data officer', market_ids: null }
const ADMIN = adminMe({ permissions: ['integration.manage', 'export.full', 'settings.manage'], roles: [DATA_ROLE] })
const DONE: FullExport = {
  id: X, trigger: 'manual', state: 'completed', model_version: 1, snapshot_at: '2026-11-20T02:00:00.000Z', table_count: 2, total_rows: 15,
  created_at: '2026-11-20T01:59:00.000Z', finished_at: '2026-11-20T02:01:00.000Z', requested_by: { id: 'u1', type: 'user' }, error: null,
}
const DETAIL: FullExportDetail = {
  ...DONE,
  manifest: {
    snapshot_at: DONE.snapshot_at!, generated_at: DONE.finished_at!,
    tables: [{ name: 'participant', file: 'participant.jsonl.gz', rows: 12, bytes: 3456, sha256: 'ab'.repeat(32) }, { name: 'sales_order', file: 'sales_order.jsonl.gz', rows: 3, bytes: 789, sha256: 'cd'.repeat(32) }],
  },
  signature: 'c2lnbmF0dXJl',
}
const SIGNING = { algorithm: 'Ed25519', public_key: 'MCowBQYDK2VwAyEApublickey', key_id: '0123456789abcdef' }
const MODEL = {
  version: 1, tables: [{ name: 'participant', schema: 'public', columns: [{ name: 'id', type: 'uuid' }, { name: 'external_ref', type: 'text' }] }],
  excluded_tables: [{ name: 'session', reason: 'Sign-in sessions.' }], excluded_columns: [{ table: 'user_account', column: 'password_hash', reason: 'Credential.' }],
}

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/service-accounts': () => ok([]),
    'GET /v1/webhook-endpoints': () => ok([]),
    'GET /v1/connectors': () => ok([]),
    'GET /v1/provider-configs': () => ok([]),
    'GET /v1/exports': () => ok([DONE]),
    'GET /v1/exports/signing-key': () => ok(SIGNING),
    'GET /v1/settings/exports.full_schedule': () => json(200, { data: { key: 'exports.full_schedule', value: null }, meta: { latest_version: 4 } }),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = 'tab=exports'
  navigation.router.replace.mockReset()
  saved.saveFile.mockReset()
})

describe('SC-13 Exports tab (FR-INT-003)', () => {
  it('shows Manual only, the exports with their rows, the retention and the erasure notice', async () => {
    renderAs(ADMIN, <IntegrationsPage />, routes())
    const schedule = await screen.findByTestId('export-schedule')
    expect(await within(schedule).findByText('Manual only')).toBeTruthy()
    const table = await screen.findByRole('table', { name: 'Full data exports' })
    expect(table.textContent).toContain('Completed')
    expect(table.textContent).toContain('15')
    expect(screen.getByText(/The 7 latest completed exports keep their files/)).toBeTruthy()
    expect(screen.getByText(/Downloaded files are your copy: erasure in the platform cannot reach them/)).toBeTruthy()
  })

  it('runs an export now with an Idempotency-Key and words EXPORT_RUNNING', async () => {
    const fetchMock = routes({ 'POST /v1/exports': () => apiError(409, 'EXPORT_RUNNING') })
    renderAs(ADMIN, <IntegrationsPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Run export now' }))
    expect(await screen.findByText('An export is already running. Wait for it to finish.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/exports')[0]!
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
  })

  it('keeps Run export now for a read-only tenant: the final full export of offboarding (D-V1A-07)', async () => {
    renderAs(adminMe({ ...ADMIN, tenant: { ...ADMIN.tenant!, read_only: true } }), <IntegrationsPage />, routes())
    expect(await screen.findByRole('button', { name: 'Run export now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change schedule' })).toBeNull()
  })

  it('shows the export id with a copy button in the drawer, for the vendor archive step (SC-39)', async () => {
    navigation.search = `tab=exports&export=${X}`
    renderAs(ADMIN, <IntegrationsPage />, routes({ [`GET /v1/exports/${X}`]: () => ok(DETAIL) }))
    const id = await within(await screen.findByRole('dialog', { name: 'Full data export' })).findByTestId('export-id')
    expect(id.textContent).toContain(X)
    expect(within(id).getByRole('button', { name: 'Copy export id' })).toBeTruthy()
  })

  it('opens ?export= with the manifest, per-file downloads, the signature, key id and public key', async () => {
    navigation.search = `tab=exports&export=${X}`
    const gzip = new Response(new Uint8Array([31, 139]), { status: 200, headers: { 'content-type': 'application/gzip' } })
    const fetchMock = routes({ [`GET /v1/exports/${X}`]: () => ok(DETAIL), [`GET /v1/exports/${X}/files/participant`]: () => gzip })
    renderAs(ADMIN, <IntegrationsPage />, fetchMock)
    const drawer = await screen.findByRole('dialog', { name: 'Full data export' })
    const manifest = await within(drawer).findByRole('table', { name: 'Manifest of the export' })
    expect(manifest.textContent).toContain('participant')
    expect(manifest.textContent).toContain('3,456')
    expect(manifest.textContent).toContain('ab'.repeat(32))
    expect(within(drawer).getByTestId('signature').textContent).toBe('c2lnbmF0dXJl')
    expect(within(drawer).getByTestId('public-key').textContent).toContain('0123456789abcdef')
    expect(within(drawer).getByText('MCowBQYDK2VwAyEApublickey')).toBeTruthy()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Download participant.jsonl.gz' }))
    await vi.waitFor(() => expect(saved.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'participant.jsonl.gz'))
  })

  it('saves the signed manifest bytes (every key, sorted, no spaces) and shows a signing-key failure with Try again', async () => {
    navigation.search = `tab=exports&export=${X}`
    const signed = { ...DETAIL, manifest: { model_version: 1, tenant_id: 't1', export_id: X, ...DETAIL.manifest!, excluded_tables: [], excluded_columns: [] } }
    renderAs(ADMIN, <IntegrationsPage />, routes({ [`GET /v1/exports/${X}`]: () => ok(signed), 'GET /v1/exports/signing-key': () => apiError(500, 'INTERNAL', 'Something went wrong.') }))
    const drawer = await screen.findByRole('dialog', { name: 'Full data export' })
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Download manifest (JSON)' }))
    const [blob, name] = saved.saveFile.mock.calls[0]! as [Blob, string]
    expect(name).toBe(`manifest-${X}.json`)
    const text = await blob.text()
    expect(text.startsWith('{"excluded_columns":[],"excluded_tables":[],"export_id":')).toBe(true)
    expect(text).not.toContain(' ')
    expect(JSON.parse(text)).toEqual(signed.manifest)
    expect(within(drawer).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(within(drawer).queryByTestId('public-key')).toBeNull()
  })

  it('lists the data model with the tables and columns left out and why', async () => {
    renderAs(ADMIN, <IntegrationsPage />, routes({ 'GET /v1/exports/model': () => ok(MODEL) }))
    await userEvent.click(await screen.findByRole('button', { name: 'Show the data model' }))
    const model = await screen.findByTestId('data-model')
    expect(within(model).getByRole('table', { name: 'Exported tables' }).textContent).toContain('id, external_ref')
    expect(within(model).getByRole('table', { name: 'Tables left out' }).textContent).toContain('Sign-in sessions.')
    expect(within(model).getByRole('table', { name: 'Columns left out' }).textContent).toContain('user_account.password_hash')
  })

  it('changes the schedule through the settings dialog against the version read', async () => {
    const fetchMock = routes({ 'PUT /v1/settings/exports.full_schedule': () => ok({ version: 5 }) })
    renderAs(ADMIN, <IntegrationsPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Change schedule' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('How often'), 'daily')
    await userEvent.type(within(dialog).getByLabelText('Hour (UTC)'), '2')
    await userEvent.type(within(dialog).getByLabelText('Reason for the change'), 'Nightly copy')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new version' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', '/v1/settings/exports.full_schedule')).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/settings/exports.full_schedule')[0]!
    expect(JSON.parse(String(init.body))).toMatchObject({ value: { cadence: 'daily', hour_utc: 2 } })
    expect(headerOf(init, 'If-Match')).toBe('"4"')
  })

  it('offers no Exports tab without export.full, or with export.full for some markets only', async () => {
    renderAs(adminMe({ permissions: ['integration.manage'] }), <IntegrationsPage />, routes())
    await screen.findAllByRole('tab')
    expect(screen.queryByRole('tab', { name: /Exports/ })).toBeNull()
    navigation.search = ''
    renderAs(adminMe({ permissions: ['integration.manage', 'export.full'], roles: [{ ...DATA_ROLE, market_ids: ['m1'] }] }), <IntegrationsPage />, routes())
    await screen.findAllByRole('tab', { name: /Public API keys/ })
    expect(screen.queryByRole('tab', { name: /Exports/ })).toBeNull()
  })

  it('offers the Exports tab to an all-market export.full holder without integration.manage', async () => {
    renderAs(adminMe({ permissions: ['integration.read', 'export.full'], roles: [DATA_ROLE] }), <IntegrationsPage />, routes())
    expect(await screen.findByTestId('export-schedule')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Exports/ }).getAttribute('aria-selected')).toBe('true')
  })
})
