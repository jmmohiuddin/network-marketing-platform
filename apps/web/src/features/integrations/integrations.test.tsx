// @vitest-environment jsdom
import '../../test/dom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { ToastProvider } from '../../components/toast'
import { ApiProvider } from '../../components/api-provider'
import { deliveryErrorText, failingEndpointCount, isNetwork, lagLabel, parseNetworks, retryableIds, usableKeyCount } from './format'
import { secretError } from './connectors-tab'
import { IntegrationsPage } from './integrations-page'
import { graceError } from './key-dialogs'
import type { ApiKey, Connector, ServiceAccount, SyncSource, WebhookDelivery, WebhookEndpoint } from './types'
import { nounOf } from './ui'
import type { ProviderRecord } from '../markets/types'
import { adapterSecretError } from './payout-providers-tab'
import { EditEndpointDialog, endpointChange } from './webhook-dialogs'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/settings/integrations',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const ME = adminMe({ permissions: ['integration.manage'] })
const CREATED = '2026-11-10T10:00:00.000Z'
const TOKEN = 'nmpk_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'

function key(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'k1', service_account_id: 'sa1', name: 'BI server', key_prefix: 'nmpk_abcdefg', scopes: ['compliance:read'], rate_tier: 'standard',
    ip_allow: null, expires_at: null, revoked_at: null, last_used_at: null, rotated_from_id: null, created_at: CREATED, status: 'active', ...overrides,
  }
}

function account(overrides: Partial<ServiceAccount> = {}): ServiceAccount {
  return {
    id: 'sa1', name: 'BI export', purpose: 'Nightly compliance export', state: 'active', disabled_at: null, created_at: CREATED,
    created_by: { id: 'u1', display_name: 'Ada Admin' }, keys: [key(), key({ id: 'k2', key_prefix: 'nmpk_zzzzzzz', status: 'revoked', revoked_at: CREATED })], ...overrides,
  }
}

function endpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'e1', url: 'https://hooks.example.com/nmp', description: 'Data warehouse', topics: ['compliance.snapshot.ready'], state: 'active',
    secret_rotation_ends_at: null, created_at: CREATED, created_by: { id: 'u1', display_name: 'Ada Admin' }, updated_at: CREATED,
    last_delivery: { outcome: 'failed', attempted_at: CREATED }, ...overrides,
  }
}

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'c1', provider: 'shopify', name: 'NL store', market: { id: 'm1', code: 'NL' }, state: 'recorded',
    webhook_url: 'https://app.example/v1/connectors/c1/webhooks', last_ok_at: null, created_at: CREATED,
    created_by: { id: 'u1', display_name: 'Ada Admin' }, withdrawn_at: null, ...overrides,
  }
}

function source(overrides: Partial<SyncSource> = {}): SyncSource {
  return {
    source: 'connector:c1', kind: 'connector', connector_id: 'c1', provider: 'shopify', name: 'NL store', market: { id: 'm1', code: 'NL' },
    state: 'healthy', last_success_at: CREATED, lag_seconds: 125, errors_24h: 0, held: 1, held_overdue: 0, last_error: null, ...overrides,
  }
}

function payoutProvider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: 'p1', market_id: 'm1', kind: 'payout', provider: 'Sandbox payouts', approved_description: 'Payouts to DE', approval_document: null, approved_at: '2026-11-01',
    funds_holder: 'Sandbox bank', state: 'recorded', adapter: 'sandbox', webhook_configured: true, review_due_on: '2020-01-31',
    created_by: { id: 'u1', display_name: 'Ada Admin' }, created_at: CREATED, withdrawn_at: null, ...overrides,
  }
}

const DELIVERY: WebhookDelivery = {
  id: 'd1', event: { id: 'ev1', type: 'webhook.test', occurred_at: CREATED }, attempt: 1, outcome: 'failed', status: null, error: 'DNS_FAILED',
  attempted_at: CREATED, next_attempt_at: '2026-11-10T10:02:00.000Z', duration_ms: 12,
}

const OPTIONS = {
  scopes: [{ scope: 'compliance:read', description: 'Read compliance snapshots', personal_data: false }],
  rate_tiers: [{ tier: 'standard', requests_per_minute: 60 }, { tier: 'high', requests_per_minute: 600 }],
  max_grace_minutes: 1440,
}

const TOPICS = [{ topic: 'compliance.snapshot.ready', description: 'A snapshot is ready.', payload_fields: ['snapshot_id', 'market_id'] }]

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/service-accounts': () => ok([account()]),
    'GET /v1/webhook-endpoints': () => ok([endpoint()]),
    'GET /v1/api-keys/options': () => ok(OPTIONS),
    'GET /v1/webhook-topics': () => ok(TOPICS),
    'GET /v1/connectors': () => ok([connector()]),
    'GET /v1/provider-configs': () => ok([payoutProvider()]),
    'GET /v1/markets': () => ok([{ id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'de', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }]),
    ...extra,
  })
}

describe('IntegrationsPage: public API keys', () => {
  beforeEach(() => {
    navigation.search = ''
  })

  it('lists service accounts with their keys and counts real values only', async () => {
    renderAs(ME, <IntegrationsPage />, routes())
    const card = await screen.findByTestId('service-account')
    expect(within(card).getByRole('heading', { name: 'BI export' })).toBeTruthy()
    expect(within(card).getByText('Nightly compliance export')).toBeTruthy()
    const active = within(card).getByText('nmpk_abcdefg…').closest('tr')!
    expect(within(active).getByText('Active')).toBeTruthy()
    expect(within(active).getByText('Any address')).toBeTruthy()
    expect(within(active).getByRole('button', { name: 'Rotate key nmpk_abcdefg' })).toBeTruthy()
    const revoked = within(card).getByText('nmpk_zzzzzzz…').closest('tr')!
    expect(within(revoked).getByText('Revoked')).toBeTruthy()
    expect(within(revoked).queryByRole('button')).toBeNull()
    const kpis = screen.getByTestId('kpis')
    expect(within(kpis).getByText('Usable API keys').parentElement?.textContent).toContain('1')
    expect(within(kpis).getByText('Endpoints failing').parentElement?.textContent).toContain('1')
    expect(screen.getByRole('tab', { name: 'Public API keys 1' })).toBeTruthy()
    // Must-not-implement items of SC-13 (PLAN B1 5, B2 5).
    expect(screen.queryByText(/Backfill|Hyperwallet|Wells Fargo|quota|Re-sync|Sync history/i)).toBeNull()
  })

  it('creates a service account with its purpose and an Idempotency-Key', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/service-accounts': () => ok(account({ id: 'sa2', keys: [] }), 201) })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Create service account' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create service account' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter the purpose.')
    await user.type(screen.getByLabelText('Name'), 'BI export')
    await user.type(screen.getByLabelText('Purpose'), 'Nightly compliance export')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create service account' }))
    expect(await screen.findByText('Service account BI export was created. Create a key for it next.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/service-accounts')[0]!
    expect(bodyOf(init)).toEqual({ name: 'BI export', purpose: 'Nightly compliance export' })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('creates a key with scopes, tier, allow-list and shows the token once with copy', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const fetchMock = routes({ 'POST /v1/service-accounts/sa1/keys': () => ok({ key: key({ id: 'k3' }), token: TOKEN, token_shown: true }, 201) })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Create key for BI export' }))
    const dialog = screen.getByRole('dialog', { name: 'Create API key for BI export' })
    await user.type(within(dialog).getByLabelText('Key name'), 'BI server')
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Choose at least one scope.')
    await user.click(await within(dialog).findByLabelText('Read compliance snapshots (compliance:read)'))
    await user.click(within(dialog).getByLabelText(/^High/))
    await user.type(within(dialog).getByLabelText(/IP allow-list/), '203.0.113.0/24\n198.51.100.7')
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }))
    const shown = await screen.findByRole('dialog', { name: 'API key created' })
    expect(within(shown).getByText(/This is the only time it is shown/)).toBeTruthy()
    expect(within(shown).getByText(/Its scopes: compliance:read\./)).toBeTruthy() // no "reads" for a write scope (BUG-077)
    // Copy has focus, so a stray Enter copies; the selectable text is the token exactly, with no spaces inserted.
    expect(document.activeElement).toBe(within(shown).getByRole('button', { name: 'Copy API key' }))
    expect(within(shown).getByTestId('one-time-secret').querySelector('code')?.textContent).toBe(TOKEN)
    await user.keyboard('{Enter}')
    expect(writeText).toHaveBeenCalledWith(TOKEN)
    expect(within(shown).getByText('The API key was copied.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/service-accounts/sa1/keys')[0]!
    expect(bodyOf(init)).toEqual({ name: 'BI server', scopes: ['compliance:read'], rate_tier: 'high', ip_allow: ['203.0.113.0/24', '198.51.100.7'] })
    // Done and Escape ask for the confirmation first: the token is never shown again.
    await user.keyboard('{Escape}')
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('dialog', { name: 'API key created' })).toBeTruthy()
    const stored = within(shown).getByLabelText('I have stored the API key')
    expect(document.activeElement).toBe(stored)
    expect(within(shown).getByText(/Confirm that you stored the API key/)).toBeTruthy()
    await user.click(stored)
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(TOKEN)).toBeNull()
    expect(document.body.textContent).not.toContain('nmpk_abcdefghijklmn')
  })

  it('says a replayed key creation cannot show the token again', async () => {
    const user = userEvent.setup()
    renderAs(ME, <IntegrationsPage />, routes({ 'POST /v1/service-accounts/sa1/keys': () => ok({ key: key({ id: 'k3' }), token_shown: false }, 201) }))
    await user.click(await screen.findByRole('button', { name: 'Create key for BI export' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Key name'), 'BI server')
    await user.click(await within(dialog).findByLabelText('Read compliance snapshots (compliance:read)'))
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }))
    const shown = await screen.findByRole('dialog', { name: 'API key created' })
    expect(within(shown).getByText('The API key cannot be shown again')).toBeTruthy()
    expect(within(shown).queryByRole('button', { name: 'Copy API key' })).toBeNull()
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names each bad IP allow-list entry at the field and links per-entry API errors to it', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({
      'POST /v1/service-accounts/sa1/keys': () => apiError(422, 'VALIDATION_FAILED', 'Check the fields.', { issues: [{ path: 'ip_allow.1', message: 'has host bits set; use 10.1.0.0/16' }] }),
    })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Create key for BI export' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Key name'), 'BI server')
    await user.click(await within(dialog).findByLabelText('Read compliance snapshots (compliance:read)'))
    const networks = within(dialog).getByLabelText(/IP allow-list/)
    await user.type(networks, '10.0.0.0/8\nnot-an-ip\n10.0.0.0/33')
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }))
    const message = 'Not an IP address or network (CIDR, for example 203.0.113.0/24): not-an-ip, 10.0.0.0/33.'
    expect(document.getElementById(networks.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toBe(message)
    expect(callsTo(fetchMock, 'POST', '/v1/service-accounts/sa1/keys')).toHaveLength(0)
    await user.clear(networks)
    await user.type(networks, '10.0.0.0/8\n10.1.2.3/16')
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }))
    const link = await within(dialog).findByRole('link', { name: 'has host bits set; use 10.1.0.0/16' })
    expect(link.getAttribute('href')).toBe('#key-networks')
  })

  it('asks for step-up in one dialog only and retries the key creation with the same Idempotency-Key', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const fetchMock = routes({
      'POST /v1/service-accounts/sa1/keys': () => (++attempts === 1 ? apiError(403, 'STEP_UP_REQUIRED') : ok({ key: key({ id: 'k3' }), token: TOKEN, token_shown: true }, 201)),
      'POST /v1/auth/sessions/current/step-up': () => ok({ assurance: 'aal2' }),
    })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Create key for BI export' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Key name'), 'BI server')
    await user.click(await within(dialog).findByLabelText('Read compliance snapshots (compliance:read)'))
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByRole('dialog', { name: 'API key created' })).toBeTruthy()
    const [first, second] = callsTo(fetchMock, 'POST', '/v1/service-accounts/sa1/keys')
    expect(headerOf(second![1], 'Idempotency-Key')).toBe(headerOf(first![1], 'Idempotency-Key'))
  })

  it('rotates a key with a grace period and shows the new token once', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/api-keys/k1/rotate': () => ok({ key: key({ id: 'k4', rotated_from_id: 'k1' }), rotated_from: { id: 'k1' }, token: TOKEN, token_shown: true }, 201) })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Rotate key nmpk_abcdefg' }))
    const grace = await screen.findByLabelText('Grace period in minutes')
    await user.clear(grace)
    await user.type(grace, '2000')
    await user.click(screen.getByRole('button', { name: 'Rotate key' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter at most 1440 minutes (24 h).')
    await user.clear(grace)
    await user.type(grace, '30')
    await user.click(screen.getByRole('button', { name: 'Rotate key' }))
    expect(await screen.findByRole('dialog', { name: 'Key rotated' })).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/api-keys/k1/rotate')[0]![1])).toEqual({ grace_minutes: 30 })
  })

  it('revokes a key with a reason and then focuses the section heading', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/api-keys/k1/revoke': () => ok({ id: 'k1', revoked_at: CREATED }) })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Revoke key nmpk_abcdefg' }))
    await user.click(screen.getByRole('button', { name: 'Revoke key' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter the reason.')
    await user.type(screen.getByLabelText('Reason'), 'Server retired')
    await user.click(screen.getByRole('button', { name: 'Revoke key' }))
    expect(await screen.findByText('Key nmpk_abcdefg was revoked.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/api-keys/k1/revoke')[0]![1])).toEqual({ reason: 'Server retired' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Service accounts and keys' }))
  })

  it('shows nothing to change inside a support session', async () => {
    renderAs({ ...ME, support_session: { id: 's1', tenant_slug: 'acme', ends_at: '2099-01-01T00:00:00.000Z', scope: { permissions: [] } } }, <IntegrationsPage />, routes())
    await screen.findByTestId('service-account')
    expect(screen.queryByRole('button', { name: /Create|Rotate|Revoke|Disable/ })).toBeNull()
  })

  it('says the page is not available without integration.manage', async () => {
    renderAs(ME, <IntegrationsPage />, routes({ 'GET /v1/service-accounts': () => apiError(403, 'PERMISSION_DENIED') }))
    expect(await screen.findByText(/not available to you/)).toBeTruthy()
  })
})

describe('IntegrationsPage: webhook subscriptions', () => {
  beforeEach(() => {
    navigation.search = 'tab=webhooks'
  })

  it('refuses a blocked URL with its reason at the field, then shows the signing secret once', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const fetchMock = routes({
      'POST /v1/webhook-endpoints': () => (++attempts === 1
        ? apiError(422, 'WEBHOOK_URL_NOT_ALLOWED', 'The address is a loopback address.', { reason: 'ADDRESS_BLOCKED' })
        : ok({ endpoint: endpoint({ id: 'e2' }), secret: 'whsec_c2VjcmV0', secret_shown: true }, 201)),
    })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Add webhook endpoint' }))
    const dialog = screen.getByRole('dialog', { name: 'Add webhook endpoint' })
    await user.type(within(dialog).getByLabelText('Endpoint URL'), 'http://hooks.example.com')
    await user.click(await within(dialog).findByLabelText('compliance.snapshot.ready'))
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }))
    expect(within(dialog).getAllByText('Enter an address that starts with https://.').length).toBeGreaterThan(0)
    await user.clear(within(dialog).getByLabelText('Endpoint URL'))
    await user.type(within(dialog).getByLabelText('Endpoint URL'), 'https://127.0.0.1/hook')
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }))
    const url = within(dialog).getByLabelText('Endpoint URL')
    await vi.waitFor(() => expect(document.getElementById(url.getAttribute('aria-describedby')!)?.textContent).toBe('The address is a loopback address.'))
    await user.clear(url)
    await user.type(url, 'https://hooks.example.com/nmp')
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }))
    const shown = await screen.findByRole('dialog', { name: 'Webhook endpoint added' })
    expect(within(shown).getByTestId('one-time-secret')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/webhook-endpoints')[1]![1])).toEqual({ url: 'https://hooks.example.com/nmp', topics: ['compliance.snapshot.ready'] })
  })

  it('sends a test event and shows deliveries with the error in plain words, then retries one now', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({
      'POST /v1/webhook-endpoints/e1/test': () => ok({ event_id: 'ev1' }, 202),
      'GET /v1/webhook-endpoints/e1/deliveries': () => ok([{ ...DELIVERY, id: 'd2', attempt: 2, outcome: 'scheduled', status: null, error: null, attempted_at: null }, DELIVERY]),
      'POST /v1/webhook-deliveries/d2/retry': () => ok({ ...DELIVERY, id: 'd2', attempt: 2, outcome: 'scheduled' }),
    })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Send test to https://hooks.example.com/nmp' }))
    expect(await screen.findByText(/A test event is queued/)).toBeTruthy()
    const deliveries = await screen.findByTestId('deliveries')
    const row = (await within(deliveries).findByText('The host name could not be found.')).closest('tr')!
    expect(within(row).getByText('Failed')).toBeTruthy()
    expect(within(row).getByText('webhook.test')).toBeTruthy()
    // The failed attempt has a later one; Retry now acts on the latest attempt of the event.
    expect(within(row).queryByRole('button', { name: /Retry/ })).toBeNull()
    await user.click(within(deliveries).getByRole('button', { name: 'Retry now: webhook.test attempt 2' }))
    expect(await screen.findByText('The delivery is scheduled to run now.')).toBeTruthy()
    // Focus lands on the deliveries heading, never <body> (BUG-057).
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('Deliveries to https://hooks.example.com/nmp'))
    expect(headerOf(callsTo(fetchMock, 'POST', '/v1/webhook-deliveries/d2/retry')[0]![1], 'Idempotency-Key')).not.toBeNull()
    expect(headerOf(callsTo(fetchMock, 'POST', '/v1/webhook-endpoints/e1/test')[0]![1], 'Idempotency-Key')).not.toBeNull()
  })

  it('loads the deliveries again after Send test and on Refresh, with the endpoints', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({
      'POST /v1/webhook-endpoints/e1/test': () => ok({ event_id: 'ev1' }, 202),
      'GET /v1/webhook-endpoints/e1/deliveries': () => ok([DELIVERY]),
    })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Deliveries to https://hooks.example.com/nmp' }))
    await within(await screen.findByTestId('deliveries')).findByText('The host name could not be found.')
    const counts = () => [callsTo(fetchMock, 'GET', '/v1/webhook-endpoints/e1/deliveries').length, callsTo(fetchMock, 'GET', '/v1/webhook-endpoints').length]
    expect(counts()).toEqual([1, 1])
    await user.click(screen.getByRole('button', { name: 'Send test to https://hooks.example.com/nmp' }))
    await vi.waitFor(() => expect(counts()).toEqual([2, 2]))
    await user.click(await screen.findByRole('button', { name: 'Refresh deliveries to https://hooks.example.com/nmp' }))
    await vi.waitFor(() => expect(counts()).toEqual([3, 3]))
    expect(await within(screen.getByTestId('deliveries')).findByText('The host name could not be found.')).toBeTruthy()
  })

  it('offers Retry now only on the latest attempt of an active endpoint', () => {
    const delivered = { ...DELIVERY, id: 'd2', attempt: 2, outcome: 'delivered' as const }
    const dead = { ...DELIVERY, id: 'd3', event: { ...DELIVERY.event, id: 'ev2' }, attempt: 9, outcome: 'dead' as const }
    expect([...retryableIds([delivered, DELIVERY, dead])]).toEqual(['d3'])
    expect([...retryableIds([DELIVERY])]).toEqual([])
  })

  it('shows no Retry now for a disabled endpoint', async () => {
    const user = userEvent.setup()
    renderAs(ME, <IntegrationsPage />, routes({
      'GET /v1/webhook-endpoints': () => ok([endpoint({ state: 'disabled' })]),
      'GET /v1/webhook-endpoints/e1/deliveries': () => ok([{ ...DELIVERY, outcome: 'dead' }]),
    }))
    await user.click(await screen.findByRole('button', { name: 'Deliveries to https://hooks.example.com/nmp' }))
    await within(await screen.findByTestId('deliveries')).findByText('The host name could not be found.')
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
  })

  it('shows a refused Send test and Retry now as danger banners, not toasts', async () => {
    const user = userEvent.setup()
    renderAs(ME, <IntegrationsPage />, routes({
      'POST /v1/webhook-endpoints/e1/test': () => apiError(409, 'ENDPOINT_DISABLED', 'The endpoint is disabled.'),
      'GET /v1/webhook-endpoints/e1/deliveries': () => ok([{ ...DELIVERY, outcome: 'dead' }]),
      'POST /v1/webhook-deliveries/d1/retry': () => apiError(409, 'DELIVERY_NOT_RETRYABLE', 'The delivery is delivered; it cannot be retried.'),
    }))
    await user.click(await screen.findByRole('button', { name: 'Send test to https://hooks.example.com/nmp' }))
    const sent = await screen.findByRole('alert')
    expect(sent.textContent).toContain('The test event to https://hooks.example.com/nmp was not sent')
    expect(sent.textContent).toContain('The endpoint is disabled.')
    await user.click(screen.getByRole('button', { name: 'Deliveries to https://hooks.example.com/nmp' }))
    await user.click(await within(await screen.findByTestId('deliveries')).findByRole('button', { name: 'Retry now: webhook.test attempt 1' }))
    const retried = await within(screen.getByTestId('deliveries')).findByRole('alert')
    expect(retried.textContent).toContain('Attempt 1 of webhook.test was not retried')
    expect(retried.textContent).toContain('The delivery is delivered; it cannot be retried.')
  })

  it('disables an endpoint from Edit with a PATCH of the state only', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'PATCH /v1/webhook-endpoints/e1': () => ok(endpoint({ state: 'disabled' })) })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Edit https://hooks.example.com/nmp' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit webhook endpoint' })
    await user.click(within(dialog).getByLabelText(/^Disabled/))
    await user.click(within(dialog).getByRole('button', { name: 'Save endpoint' }))
    expect(await screen.findByText('The endpoint was saved.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PATCH', '/v1/webhook-endpoints/e1')[0]!
    expect(bodyOf(init)).toEqual({ state: 'disabled' })
    expect(headerOf(init, 'X-Requested-With')).toBe('fetch')
  })

  it('rotates the signing secret with a grace period', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/webhook-endpoints/e1/rotate-secret': () => ok({ endpoint: endpoint(), secret: 'whsec_bmV3', secret_shown: true }) })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Rotate secret of https://hooks.example.com/nmp' }))
    const grace = await screen.findByLabelText('Grace period in minutes')
    await user.clear(grace)
    await user.type(grace, '60')
    await user.click(screen.getByRole('button', { name: 'Rotate secret' }))
    const shown = await screen.findByRole('dialog', { name: 'Signing secret rotated' })
    expect(within(shown).getByRole('button', { name: 'Copy signing secret' })).toBeTruthy()
    expect(within(shown).getByTestId('one-time-secret').querySelector('code')?.textContent).toBe('whsec_bmV3')
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/webhook-endpoints/e1/rotate-secret')[0]![1])).toEqual({ grace_minutes: 60 })
  })
})

describe('EditEndpointDialog', () => {
  it('sends only what changed, including disabling the endpoint', async () => {
    const user = userEvent.setup()
    const send = vi.fn(async () => undefined)
    const onSaved = vi.fn()
    vi.stubGlobal('fetch', fetchByRoute({ 'GET /v1/webhook-topics': () => ok([...TOPICS, { topic: 'market.went_live', description: 'A market is live.', payload_fields: ['market_id', 'code'] }]) }))
    render(<ToastProvider><ApiProvider><EditEndpointDialog endpoint={endpoint()} send={send} onClose={vi.fn()} onSaved={onSaved} /></ApiProvider></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Save endpoint' }))
    expect(screen.getByRole('alert').textContent).toContain('Nothing was changed.')
    await user.click(await screen.findByLabelText('market.went_live'))
    await user.click(screen.getByLabelText(/^Disabled/))
    await user.click(screen.getByRole('button', { name: 'Save endpoint' }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({ topics: ['compliance.snapshot.ready', 'market.went_live'], state: 'disabled' })
  })
})

describe('IntegrationsPage: storefront connectors and sync health (PLAN B2 5)', () => {
  beforeEach(() => {
    navigation.search = ''
  })

  it('shows a connector card with its webhook URL to copy, and no secret', async () => {
    navigation.search = 'tab=connectors'
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderAs(ME, <IntegrationsPage />, routes())
    const card = await screen.findByTestId('connector')
    expect(within(card).getByRole('heading', { name: 'NL store' })).toBeTruthy()
    expect(within(card).getByText('Receiving')).toBeTruthy()
    expect(within(card).getByText('None yet')).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: 'Copy webhook URL' }))
    expect(writeText).toHaveBeenCalledWith('https://app.example/v1/connectors/c1/webhooks')
    expect(within(card).getByText('The webhook URL was copied.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add connector' }).dataset.testid).toBe('primary-action')
    expect(screen.queryByText(/Re-sync|Backfill|Sync history|Hyperwallet/i)).toBeNull()
  })

  it('adds a connector with a write-only secret, market id and an Idempotency-Key', async () => {
    navigation.search = 'tab=connectors'
    const user = userEvent.setup()
    const fetchMock = routes({
      'GET /v1/markets': () => ok([{ id: 'm1', code: 'NL', name: 'Netherlands', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Amsterdam', languages: ['nl'], minor_unit: 2 }]),
      'POST /v1/connectors': () => ok({ connector: connector(), webhook_url: connector().webhook_url }, 201),
    })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Add connector' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add connector' })
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    await user.type(within(dialog).getByLabelText('Name'), 'NL store')
    await user.type(within(dialog).getByLabelText('Webhook signing secret'), 'short')
    await user.click(within(dialog).getByRole('button', { name: 'Add connector' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Use 16 to 200 characters.')
    expect(within(dialog).getByLabelText('Webhook signing secret').getAttribute('type')).toBe('password')
    await user.type(within(dialog).getByLabelText('Webhook signing secret'), '-long-enough-secret')
    await user.click(within(dialog).getByLabelText('WooCommerce'))
    await user.click(within(dialog).getByRole('button', { name: 'Add connector' }))
    expect(await screen.findByText(/NL store was added/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/connectors')[0]!
    expect(bodyOf(init)).toEqual({ provider: 'woocommerce', market_id: 'm1', name: 'NL store', webhook_secret: 'short-long-enough-secret' })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('withdraws a connector with a reason; a withdrawn one has no actions and no URL', async () => {
    navigation.search = 'tab=connectors'
    const user = userEvent.setup()
    const fetchMock = routes({
      'GET /v1/connectors': () => ok([connector(), connector({ id: 'c2', name: 'Old store', state: 'withdrawn', withdrawn_at: CREATED })]),
      'POST /v1/connectors/c1/withdraw': () => ok(connector({ state: 'withdrawn' })),
    })
    renderAs(ME, <IntegrationsPage />, fetchMock)
    const [, old] = await screen.findAllByTestId('connector')
    expect(within(old!).queryByRole('button')).toBeNull()
    expect(within(old!).getByText('Withdrawn')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Withdraw NL store' }))
    await user.type(screen.getByLabelText('Reason'), 'Store closed')
    await user.click(screen.getByRole('button', { name: 'Withdraw connector' }))
    expect(await screen.findByText('NL store was withdrawn.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/connectors/c1/withdraw')[0]![1])).toEqual({ reason: 'Store closed' })
  })

  it('counts sync states from the server and says when thresholds are unset', async () => {
    navigation.search = 'tab=health'
    renderAs(ME, <IntegrationsPage />, routes({
      'GET /v1/integrations/health': () => ok({
        sources: [source(), source({ source: 'api:erp', kind: 'api', connector_id: undefined, provider: undefined, market: undefined, name: 'erp', state: 'failing', last_error: { code: 'ORDER_CONFLICT', at: CREATED } })],
        thresholds: null,
      }),
    }))
    const kpis = await screen.findByTestId('health-kpis')
    expect(within(kpis).getByText('Healthy').parentElement?.textContent).toContain('1')
    expect(within(kpis).getByText('Failing').parentElement?.textContent).toContain('1')
    expect(screen.getByText('Sync thresholds are not set')).toBeTruthy()
    const row = screen.getByText('erp').closest('tr')!
    expect(within(row).getByText('Order API')).toBeTruthy()
    expect(within(row).getByText(/^Already received with a different body/)).toBeTruthy() // words, not the API code (BUG-075)
    expect(screen.queryByRole('button', { name: /Add|Create/ })).toBeNull()
  })

  it('integration.read alone shows sync health and payout providers, without asking for keys or connectors', async () => {
    const fetchMock = routes({ 'GET /v1/integrations/health': () => ok({ sources: [source()], thresholds: { behind_after_minutes: 60, failing_after_minutes: 240 } }) })
    renderAs(adminMe({ permissions: ['integration.read'] }), <IntegrationsPage />, fetchMock)
    expect(await screen.findByText('NL store')).toBeTruthy()
    expect(screen.getByText(/Behind after 1 h without an accepted event; failing after 4 h/)).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\s*\d+$/, ''))).toEqual(['Sync health', 'Payout providers'])
    expect(callsTo(fetchMock, 'GET', '/v1/service-accounts')).toHaveLength(0)
    expect(callsTo(fetchMock, 'GET', '/v1/connectors')).toHaveLength(0)
  })

  it('integration.read alone sees the payout provider cards without Configure', async () => {
    navigation.search = 'tab=payout-providers'
    renderAs(adminMe({ permissions: ['integration.read'] }), <IntegrationsPage />, routes())
    const [card] = await screen.findAllByTestId('payout-provider')
    expect(within(card!).getByText('Sandbox')).toBeTruthy()
    expect(within(card!).getByRole('button', { name: 'Copy webhook URL' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Configure/ })).toBeNull()
  })
})

describe('IntegrationsPage: payout providers (PLAN B4 5 SC-13)', () => {
  const ALL_MARKETS = adminMe({ permissions: ['integration.manage'], roles: [{ assignment_id: 'a1', role_id: 'r1', name: 'Integration lead', market_ids: null }] })

  beforeEach(() => {
    navigation.search = 'tab=payout-providers'
  })

  it('shows each payout provider with its adapter, review chip and webhook URL to copy, and no real provider', async () => {
    renderAs(ALL_MARKETS, <IntegrationsPage />, routes({ 'GET /v1/provider-configs': () => ok([payoutProvider(), payoutProvider({ id: 'p2', provider: 'Bank file', adapter: null, webhook_configured: false, review_due_on: null })]) }))
    const [sandbox, bank] = await screen.findAllByTestId('payout-provider')
    expect(within(sandbox!).getByText('Review overdue')).toBeTruthy()
    expect(within(sandbox!).getByText('DE')).toBeTruthy()
    expect(within(sandbox!).getByText('Sandbox')).toBeTruthy()
    expect(within(sandbox!).getByText(`${window.location.origin}/v1/webhooks/providers/p1`)).toBeTruthy()
    expect(within(sandbox!).getByRole('button', { name: 'Copy webhook URL' })).toBeTruthy()
    expect(within(bank!).getByText('Not configured')).toBeTruthy()
    expect(within(bank!).queryByRole('button', { name: 'Copy webhook URL' })).toBeNull()
    expect(screen.getAllByText(/Only sandbox adapters exist in this build/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Wells Fargo|Hyperwallet|Re-authenticate|wallet/i)).toBeNull()
  })

  it('configures a sandbox adapter with a write-only secret after step-up', async () => {
    const user = userEvent.setup()
    let calls = 0
    const fetchMock = routes({
      'PUT /v1/provider-configs/p1/adapter': () => {
        calls += 1
        return calls === 1 ? apiError(403, 'STEP_UP_REQUIRED') : ok(payoutProvider())
      },
      'POST /v1/auth/sessions/current/step-up': () => ok({ assurance: 'aal2' }),
    })
    renderAs(ALL_MARKETS, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Configure Sandbox payouts' }))
    const dialog = screen.getByRole('dialog', { name: 'Configure Sandbox payouts' })
    expect(within(dialog).getByText(/Only sandbox adapters exist in this build/)).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Webhook secret'), 'short')
    await user.click(within(dialog).getByRole('button', { name: 'Save adapter' }))
    expect(within(dialog).getAllByText('Use 24 to 128 characters.').length).toBeGreaterThan(0)
    await user.clear(within(dialog).getByLabelText('Webhook secret'))
    await user.type(within(dialog).getByLabelText('Webhook secret'), 'x'.repeat(32))
    await user.click(within(dialog).getByRole('button', { name: 'Save adapter' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Sandbox payouts now pays through the sandbox adapter.')).toBeTruthy()
    const puts = callsTo(fetchMock, 'PUT', '/v1/provider-configs/p1/adapter')
    expect(puts).toHaveLength(2)
    expect(bodyOf(puts[1]![1])).toEqual({ adapter: 'sandbox', webhook_secret: 'x'.repeat(32) })
  })

  it('sends no secret for a bank file adapter and hides Configure from market-scoped or read-only users', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'PUT /v1/provider-configs/p1/adapter': () => ok(payoutProvider({ adapter: 'bank_file_csv' })) })
    const view = renderAs(ALL_MARKETS, <IntegrationsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Configure Sandbox payouts' }))
    const dialog = screen.getByRole('dialog', { name: 'Configure Sandbox payouts' })
    await user.click(within(dialog).getByRole('radio', { name: /Bank file \(CSV\)/ }))
    expect(within(dialog).queryByLabelText('Webhook secret')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Save adapter' }))
    expect(await screen.findByText('Sandbox payouts now pays through the bank file (csv) adapter.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/provider-configs/p1/adapter')[0]![1])).toEqual({ adapter: 'bank_file_csv' })
    view.unmount()
    renderAs(adminMe({ permissions: ['integration.manage'], roles: [{ assignment_id: 'a1', role_id: 'r1', name: 'Integration lead', market_ids: ['m1'] }] }), <IntegrationsPage />, routes())
    await screen.findByTestId('payout-provider')
    expect(screen.queryByRole('button', { name: 'Configure Sandbox payouts' })).toBeNull()
  })

  it('checks the sandbox secret length the API enforces', () => {
    expect(adapterSecretError('')).toContain('Enter the webhook secret')
    expect(adapterSecretError('x'.repeat(23))).toBe('Use 24 to 128 characters.')
    expect(adapterSecretError('x'.repeat(24))).toBeNull()
    expect(adapterSecretError('x'.repeat(129))).toBe('Use 24 to 128 characters.')
  })
})

describe('integration helpers', () => {
  it('checks connector secrets and words the sync lag', () => {
    expect(secretError('')).toMatch(/Enter the signing secret/)
    expect(secretError('x'.repeat(16))).toBeNull()
    expect(secretError('x'.repeat(201))).toBe('Use 16 to 200 characters.')
    expect([lagLabel(null), lagLabel(45), lagLabel(7500)]).toEqual(['No accepted event yet', '45 s', '2 h 5 min'])
  })

  it('counts usable keys of active accounts and failing endpoints', () => {
    expect(usableKeyCount([account(), account({ id: 'sa2', state: 'disabled' })])).toBe(1)
    expect(failingEndpointCount([endpoint(), endpoint({ last_delivery: null }), endpoint({ last_delivery: { outcome: 'dead', attempted_at: CREATED } })])).toBe(2)
  })

  it('reads the IP allow-list by line or comma and words delivery errors', () => {
    expect(parseNetworks(' 10.0.0.0/8,\n 2001:db8::/32 \n\n')).toEqual(['10.0.0.0/8', '2001:db8::/32'])
    expect(['10.0.0.0/8', '198.51.100.7', '2001:db8::/32', '::ffff:192.0.2.1', '::1/128'].every(isNetwork)).toBe(true)
    expect(['not-an-ip', '10.0.0.0/33', '01.2.3.4', '256.1.1.1', '1.2.3', 'fe80::1%eth0', '2001:db8::/129', '1::2::3', '10.0.0.0/8/8', '::1]@x.com/['].some(isNetwork)).toBe(false)
    expect([nounOf('Signing secret'), nounOf('API key')]).toEqual(['signing secret', 'API key'])
    expect(deliveryErrorText('REDIRECT_REFUSED')).toBe('The endpoint answered with a redirect, which is never followed.')
    expect(deliveryErrorText('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(deliveryErrorText(null)).toBe('—')
  })

  it('checks grace minutes and builds the PATCH body from changes only', () => {
    expect(graceError('0', 1440)).toBeNull()
    expect(graceError('1.5', 1440)).toBe('Enter the grace period in minutes as a whole number.')
    expect(endpointChange(endpoint(), { url: 'https://hooks.example.com/nmp', topics: new Set(['compliance.snapshot.ready']), description: '' }, 'active')).toEqual({ description: null })
  })
})
