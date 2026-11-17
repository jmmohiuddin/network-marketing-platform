// TS-21 route cases: one per route buildApp registers (`METHOD /url`), keyed exactly as Fastify reports it. The
// isolation suite fails when a route has no case here, or a case has no route.
import { documentBody } from '../../src/modules/aud/test-support.js'
import { multipartBody, TINY_MAPPING, tinyFiles } from '../../src/modules/imp/test-support.js'
import { PROTOTYPE_SETTINGS } from '../../src/modules/cpl/test-fixtures.js'
import { GOLDEN_EXPECTED, GOLDEN_INPUT, personal } from '../../src/modules/pln/test-support.js'
import type { CallOptions } from '../helpers/index.js'
import { DRAFT_MARKET_CODE, DRAFT_VERSION, PACK, PASSWORD, RECORDABLE_ITEM, RULE_KEY, STATE_ITEM, SUPPORT_SCOPE, type Targets } from './seed.js'

/**
 * Who the route is for. public: no session (sign-in, invitation); self: the caller's own session or account;
 * tenant: tenant realm; vendor: vendor realm only; either: vendor users, or tenant users with vendor_access.decide;
 * key: API keys only, every session is refused (PLAN B2 2.6).
 */
export type Access = 'public' | 'self' | 'tenant' | 'vendor' | 'either' | 'key'

/**
 * What a tenant-B caller reaches with tenant A's targets. object: an A object by id (404, as an unknown id);
 * collection: a list or a per-tenant singleton (200, only B's rows); own: B's own account or new object (status `own`).
 */
export type Shape = 'object' | 'collection' | 'own'

export type CaseRequest = Omit<CallOptions, 'as'>

export interface RouteCase {
  readonly access: Access
  readonly shape: Shape
  /** Tenant B's status for shape own. */
  readonly own?: number
  /** Tenant B's refusal for shape object when not 404 NOT_FOUND: an A id in the body, answered as an unknown one. */
  readonly refusedAs?: readonly [number, string]
  /** Status of the read inside tenant A's support session when not 200 (403: a permission no session may hold). */
  readonly inSession?: number
  /** Status without a session of a public route that answers anyone (holds no tenant data); default: refused (>= 400). */
  readonly anonymous?: number
  /**
   * The vendor log (E-ADR-22): it repeats the path params and query that vendor users sent in refused requests, which
   * may be tenant ids they named themselves; nothing else of a tenant may show.
   */
  readonly echoesRefusedRequests?: boolean
  /**
   * The path id is a capability authenticated by a signature over the body (connector webhooks, PLAN B2 2.6): a known id
   * without a valid signature is this answer, an unknown one 404. Ids are random UUIDs, so this tells nothing to a caller
   * without the id.
   */
  readonly unsignedAnswer?: readonly [number, string]
  readonly request: (t: Targets) => CaseRequest
}

const json = (method: CaseRequest['method'], url: string, body?: unknown, idempotencyKey?: true): CaseRequest =>
  ({ method, url, ...(body === undefined ? {} : { body }), ...(idempotencyKey === undefined ? {} : { idempotencyKey }) })

const get = (url: string): CaseRequest => json('GET', url)
const code = { code: '000000' }

function uploadRequest(t: Targets): CaseRequest {
  const fields = { market: t.market, period_from: '2025-01', period_to: '2025-01' }
  const { payload, contentType } = multipartBody(fields, tinyFiles())
  return { method: 'POST', url: '/v1/imports', body: payload, headers: { 'content-type': contentType }, idempotencyKey: true }
}

const object = (access: Access, request: (t: Targets) => CaseRequest): RouteCase => ({ access, shape: 'object', request })
const collection = (access: Access, request: (t: Targets) => CaseRequest): RouteCase => ({ access, shape: 'collection', request })
const own = (access: Access, status: number, request: (t: Targets) => CaseRequest): RouteCase => ({ access, shape: 'own', own: status, request })
/** An A object named in the body: refused as an unknown one, and identical to a phantom's answer. */
const named = (status: number, code: string, request: (t: Targets) => CaseRequest): RouteCase =>
  ({ access: 'tenant', shape: 'object', refusedAs: [status, code], request })
const vendor = (request: (t: Targets) => CaseRequest): RouteCase => ({ access: 'vendor', shape: 'object', request })

const withReason = (body: Record<string, unknown> = {}) => ({ ...body, reason: 'isolation' })
/** integration.manage is a tenant-own decision no support session may hold (support/sessions.ts). */
const integrationRead = (shape: Shape, request: (t: Targets) => CaseRequest): RouteCase => ({ access: 'tenant', shape, inSession: 403, request })

function documentRequest(): CaseRequest {
  const { payload, contentType } = documentBody()
  return { method: 'POST', url: '/v1/documents', body: payload, headers: { 'content-type': contentType }, idempotencyKey: true }
}

/** Today, as the genealogy case payloads take it (effective_from >= start of today UTC). */
const today = () => new Date().toISOString()
const genealogyCase = (t: Targets) => ({
  type: 'genealogy_change', subject_type: 'position', subject_id: t.childPosition, reason_code: 'PARTICIPANT_REQUEST',
  payload: { kind: 'sponsor', proposed_parent_position_id: t.position, effective_from: today() },
})
const enrolment = (t: Targets) => ({ external_ref: 'B-isolation', market: t.peopleMarketCode, type_code: 'DIST', account_type: 'individual' })
const order = (t: Targets) => ({
  source_system: 'canary', source_order_id: `o-${t.order}`, market: t.peopleMarketCode, buyer: { external_ref: 'buyer' },
  ordered_at: '2025-01-15T00:00:00Z', paid_at: '2025-01-15T00:00:00Z', currency: 'GBP', amount_minor: '1000', tax_minor: '0',
  lines: [{ line_no: 1, sku: 'CANARY-SKU', quantity: 1, amount_minor: '1000' }],
})
const keyOnly = (request: (t: Targets) => CaseRequest): RouteCase =>
  ({ access: 'key', shape: 'object', refusedAs: [403, 'API_KEY_REQUIRED'], request })
const PAST = '2026-01-01T00:00:00Z'

/** Draft writes need If-Match (428 without it), so the case sends one: tenant B then meets the unknown plan. */
const draftWrite = (method: CaseRequest['method'], url: string, body?: unknown): CaseRequest =>
  ({ ...json(method, url, body), headers: { 'if-match': '"1"' } })
const draft = (t: Targets) => `/v1/plans/${t.plan}/versions/${DRAFT_VERSION}`

const rows = (t: Targets) => `/v1/compliance/snapshots/${t.snapshot}/figures/${encodeURIComponent(t.figure)}/rows`

export const ROUTE_CASES: Readonly<Record<string, RouteCase>> = {
  // IAM: sign-in with tenant A's credentials at tenant B / in the vendor realm; a token that opens nothing.
  'POST /v1/auth/sessions': object('public', (t) => json('POST', '/v1/auth/sessions', { tenant: t.otherSlug, email: t.email, password: PASSWORD })),
  'POST /v1/auth/vendor-sessions': object('public', (t) => json('POST', '/v1/auth/vendor-sessions', { email: t.email, password: PASSWORD })),
  'POST /v1/auth/invitations/accept': object('public', (t) => json('POST', '/v1/auth/invitations/accept', { token: t.user, password: PASSWORD })),
  'DELETE /v1/auth/sessions/current': own('self', 204, () => json('DELETE', '/v1/auth/sessions/current')),
  'POST /v1/auth/mfa/totp': own('self', 409, () => json('POST', '/v1/auth/mfa/totp')),
  'POST /v1/auth/mfa/totp/confirm': own('self', 409, () => json('POST', '/v1/auth/mfa/totp/confirm', code)),
  'POST /v1/auth/sessions/current/mfa': own('self', 422, () => json('POST', '/v1/auth/sessions/current/mfa', code)),
  'POST /v1/auth/sessions/current/step-up': own('self', 422, () => json('POST', '/v1/auth/sessions/current/step-up', code)),
  'GET /v1/me': own('self', 200, () => get('/v1/me')),
  'GET /v1/users': collection('tenant', () => get('/v1/users?limit=200')),
  'GET /v1/users/:id': object('tenant', (t) => get(`/v1/users/${t.user}`)),
  // An email that exists in tenant A must not be "taken" in tenant B (that would reveal it).
  'POST /v1/users': own('tenant', 201, (t) => json('POST', '/v1/users', { email: t.email }, true)),
  'POST /v1/users/:id/invitation': object('tenant', (t) => json('POST', `/v1/users/${t.user}/invitation`, undefined, true)),
  'POST /v1/users/:id/deactivate': object('tenant', (t) => json('POST', `/v1/users/${t.user}/deactivate`)),
  'GET /v1/roles': collection('tenant', () => get('/v1/roles')),
  'POST /v1/roles': own('tenant', 201, (t) => json('POST', '/v1/roles', { name: t.roleName, permissions: ['compliance.read'] }, true)),
  'POST /v1/users/:id/role-assignments': object('tenant', (t) =>
    json('POST', `/v1/users/${t.user}/role-assignments`, { role_id: t.role }, true)),
  'POST /v1/role-assignments/:id/revoke': object('tenant', (t) => json('POST', `/v1/role-assignments/${t.assignment}/revoke`)),
  'GET /v1/role-grant-requests': collection('tenant', () => get('/v1/role-grant-requests?limit=200')),
  'POST /v1/role-grant-requests/:id/decision': object('tenant', (t) =>
    json('POST', `/v1/role-grant-requests/${t.grantRequest}/decision`, { decision: 'approved' }, true)),
  // TEN: per-tenant values; tenant B reads and writes its own.
  'GET /v1/settings/:key': collection('tenant', () => get('/v1/settings/privacy.breach_contacts')),
  // Tenant B's own structure writes (POST /v1/brands, /v1/markets: sorted earlier) moved B's counter past 0, so the
  // stale If-Match is B's own conflict; tenant A's counter is never consulted.
  'PUT /v1/settings/:key': own('tenant', 412, () => ({
    method: 'PUT', url: '/v1/settings/compliance.late_order_day', headers: { 'if-match': '"0"' },
    body: { value: PROTOTYPE_SETTINGS['compliance.late_order_day'], reason: 'isolation' },
  })),
  'GET /v1/markets': collection('tenant', () => get('/v1/markets')),
  // AUD
  'GET /v1/audit-events': collection('tenant', () => get('/v1/audit-events?limit=200')),
  'GET /v1/audit-chain/verification': collection('tenant', () => get('/v1/audit-chain/verification')),
  'POST /v1/audit-exports': own('tenant', 201, () => json('POST', '/v1/audit-exports', { filters: {} }, true)),
  // Only the requester downloads an export (aud/audit-export.ts), so the vendor in session gets 404 too.
  'GET /v1/audit-exports/:id/download': { ...object('tenant', (t) => get(`/v1/audit-exports/${t.export}/download`)), inSession: 404 },
  // Support sessions
  'POST /v1/support-sessions': vendor((t) => json('POST', '/v1/support-sessions', {
    tenant: t.tenant, reason: 'isolation', scope: { permissions: SUPPORT_SCOPE }, minutes: 30,
  }, true)),
  'GET /v1/support-sessions/limits': vendor(() => get('/v1/support-sessions/limits')),
  'GET /v1/support-sessions': collection('either', () => get('/v1/support-sessions?limit=200')),
  'GET /v1/support-sessions/:id': object('either', (t) => get(`/v1/support-sessions/${t.supportSession}`)),
  'POST /v1/support-sessions/:id/decision': object('tenant', (t) =>
    json('POST', `/v1/support-sessions/${t.supportSession}/decision`, { approved: true, minutes: 30 }, true)),
  'POST /v1/support-sessions/:id/end': object('either', (t) => json('POST', `/v1/support-sessions/${t.supportSession}/end`)),
  'GET /v1/support-sessions/:id/log': object('tenant', (t) => get(`/v1/support-sessions/${t.supportSession}/log`)),
  // Vendor console and provisioning (vendor realm only)
  'GET /v1/tenants/:id/breach-contacts': vendor((t) => get(`/v1/tenants/${t.tenant}/breach-contacts`)),
  'GET /v1/tenants': vendor(() => get('/v1/tenants')),
  'GET /v1/tenants/:id': vendor((t) => get(`/v1/tenants/${t.tenant}`)),
  'POST /v1/tenants': vendor(() => json('POST', '/v1/tenants', {}, true)),
  'POST /v1/tenants/:id/approve': vendor((t) => json('POST', `/v1/tenants/${t.tenant}/approve`, undefined, true)),
  'POST /v1/tenants/:id/go-live': vendor((t) => json('POST', `/v1/tenants/${t.tenant}/go-live`)),
  'GET /v1/vendor-audit-events': { ...vendor(() => get('/v1/vendor-audit-events?limit=200')), echoesRefusedRequests: true },
  // Vendor users (BUG-011): tenant A's user id names no vendor user.
  'GET /v1/vendor-users': vendor(() => get('/v1/vendor-users?limit=200')),
  'POST /v1/vendor-users': vendor((t) => json('POST', '/v1/vendor-users', { email: t.email }, true)),
  'POST /v1/vendor-users/:id/invitation': vendor((t) => json('POST', `/v1/vendor-users/${t.user}/invitation`)),
  'POST /v1/vendor-users/:id/deactivate': vendor((t) => json('POST', `/v1/vendor-users/${t.user}/deactivate`)),
  'POST /v1/vendor-users/:id/approve': vendor((t) => json('POST', `/v1/vendor-users/${t.user}/approve`, undefined, true)),
  'POST /v1/vendor-users/:id/reject': vendor((t) => json('POST', `/v1/vendor-users/${t.user}/reject`, undefined, true)),
  // IMP: tenant A's market code means nothing in tenant B.
  'POST /v1/imports': own('tenant', 422, uploadRequest),
  'GET /v1/imports/limits': collection('tenant', () => get('/v1/imports/limits')),
  'GET /v1/imports': collection('tenant', () => get('/v1/imports?limit=200')),
  'GET /v1/imports/:id': object('tenant', (t) => get(`/v1/imports/${t.batch}`)),
  'GET /v1/imports/:id/errors': object('tenant', (t) => get(`/v1/imports/${t.rejectedBatch}/errors`)),
  'GET /v1/imports/:id/source-values': object('tenant', (t) => get(`/v1/imports/${t.batch}/source-values`)),
  'POST /v1/imports/:id/mapping': object('tenant', (t) => json('POST', `/v1/imports/${t.batch}/mapping`, { mapping_id: t.mapping })),
  'POST /v1/imports/:id/load': object('tenant', (t) => json('POST', `/v1/imports/${t.batch}/load`)),
  'GET /v1/import-mappings': collection('tenant', () => get('/v1/import-mappings?limit=200')),
  'GET /v1/import-mappings/:id': object('tenant', (t) => get(`/v1/import-mappings/${t.mapping}`)),
  'PUT /v1/import-mappings': own('tenant', 201, () => ({
    method: 'PUT', url: '/v1/import-mappings', headers: { 'if-match': '"0"' }, body: { mappings: TINY_MAPPING },
  })),
  'POST /v1/import-mappings/:id/approve': object('tenant', (t) => json('POST', `/v1/import-mappings/${t.mapping}/approve`)),
  // CPL
  'POST /v1/compliance/snapshots': own('tenant', 422, (t) =>
    json('POST', '/v1/compliance/snapshots', { market: t.market, period_from: '2025-01', period_to: '2025-01' }, true)),
  'GET /v1/compliance/snapshots': collection('tenant', () => get('/v1/compliance/snapshots?limit=200')),
  'GET /v1/compliance/snapshots/:id': object('tenant', (t) => get(`/v1/compliance/snapshots/${t.snapshot}`)),
  'GET /v1/compliance/snapshots/:id/figures/:figure/rows': object('tenant', (t) => get(rows(t))),
  // TEN B1: settings history and money change requests (FR-TEN-003)
  'GET /v1/settings': collection('tenant', () => get('/v1/settings')),
  'GET /v1/settings/versions': collection('tenant', () => get('/v1/settings/versions?limit=200')),
  'GET /v1/settings/versions/:version': object('tenant', (t) => get(`/v1/settings/versions/${t.settingsVersion}`)),
  'GET /v1/setting-change-requests': collection('tenant', () => get('/v1/setting-change-requests?state=all&limit=200')),
  'POST /v1/setting-change-requests/:id/decision': object('tenant', (t) =>
    json('POST', `/v1/setting-change-requests/${t.changeRequest}/decision`, { decision: 'approve', reason: 'isolation' }, true)),
  'POST /v1/setting-change-requests/:id/withdraw': object('tenant', (t) =>
    json('POST', `/v1/setting-change-requests/${t.changeRequest}/withdraw`, withReason())),
  // TEN B1: markets, brands, calendars (FR-TEN-002). Tenant A's market code and brand name are free in tenant B.
  'GET /v1/markets/:id': object('tenant', (t) => get(`/v1/markets/${t.draftMarket}`)),
  'POST /v1/markets': own('tenant', 201, () => json('POST', '/v1/markets', withReason({
    code: DRAFT_MARKET_CODE, currency: 'EUR', time_zone: 'Europe/Berlin', languages: ['de'], market_pack: PACK,
  }), true)),
  'PATCH /v1/markets/:id': object('tenant', (t) => json('PATCH', `/v1/markets/${t.draftMarket}`, withReason({ languages: ['de', 'en'] }))),
  'DELETE /v1/markets/:id': object('tenant', (t) => json('DELETE', `/v1/markets/${t.draftMarket}`, withReason())),
  'GET /v1/brands': collection('tenant', () => get('/v1/brands')),
  'POST /v1/brands': own('tenant', 201, (t) => json('POST', '/v1/brands', withReason({ name: t.brandName }), true)),
  'PATCH /v1/brands/:id': object('tenant', (t) => json('PATCH', `/v1/brands/${t.brand}`, withReason({ name: 'Renamed in isolation' }))),
  'DELETE /v1/brands/:id': object('tenant', (t) => json('DELETE', `/v1/brands/${t.brand}`, withReason())),
  'GET /v1/calendars': collection('tenant', () => get('/v1/calendars')),
  'POST /v1/calendars': named(422, 'VALIDATION_FAILED', (t) => json('POST', '/v1/calendars', withReason({
    market_id: t.draftMarket, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', first_period_start: '2026-01-01',
    periods_ahead: 3,
  }), true)),
  'PATCH /v1/calendars/:id': object('tenant', (t) => json('PATCH', `/v1/calendars/${t.calendar}`, withReason({ name: 'Renamed in isolation' }))),
  'DELETE /v1/calendars/:id': object('tenant', (t) => json('DELETE', `/v1/calendars/${t.calendar}`, withReason())),
  'POST /v1/calendars/:id/periods': object('tenant', (t) =>
    json('POST', `/v1/calendars/${t.calendar}/periods`, withReason({ through: '2026-12-31' }), true)),
  'GET /v1/calendars/:id/periods': object('tenant', (t) => get(`/v1/calendars/${t.calendar}/periods`)),
  // TEN + PAY B1: launch checklist, go-live and provider eligibility (FR-TEN-004)
  'GET /v1/markets/:id/checklist': object('tenant', (t) => get(`/v1/markets/${t.draftMarket}/checklist`)),
  'POST /v1/markets/:id/checklist/:item/entries': object('tenant', (t) =>
    json('POST', `/v1/markets/${t.draftMarket}/checklist/${RECORDABLE_ITEM}/entries`, { document_id: t.freeDocument }, true)),
  'POST /v1/markets/:id/go-live-requests': object('tenant', (t) => json('POST', `/v1/markets/${t.draftMarket}/go-live-requests`, {}, true)),
  'GET /v1/markets/:id/go-live-requests': object('tenant', (t) => get(`/v1/markets/${t.draftMarket}/go-live-requests`)),
  'POST /v1/market-go-live-requests/:id/withdraw': object('tenant', (t) =>
    json('POST', `/v1/market-go-live-requests/${t.goLiveRequest}/withdraw`, withReason())),
  'POST /v1/market-go-live-requests/:id/decision': object('tenant', (t) =>
    json('POST', `/v1/market-go-live-requests/${t.goLiveRequest}/decision`, { decision: 'approve', reason: 'isolation' }, true)),
  'GET /v1/provider-configs': collection('tenant', () => get('/v1/provider-configs')),
  'POST /v1/provider-configs': named(422, 'VALIDATION_FAILED', (t) => json('POST', '/v1/provider-configs', {
    market_id: t.draftMarket, kind: 'payout', provider: 'Sandbox payout', approved_description: 'Approved', approved_at: '2026-10-01',
    approval_document_id: t.freeDocument, funds_holder: 'Sandbox bank',
  }, true)),
  'POST /v1/provider-configs/:id/withdraw': object('tenant', (t) => json('POST', `/v1/provider-configs/${t.providerConfig}/withdraw`, withReason())),
  // CPL B1: market-pack rules are platform data, the same for every tenant.
  'GET /v1/market-packs/:pack/rules': collection('tenant', () => get(`/v1/market-packs/${PACK}/rules`)),
  // IAM B1: service accounts and API keys (FR-IAM-006)
  'GET /v1/api-keys/options': integrationRead('collection', () => get('/v1/api-keys/options')),
  'GET /v1/service-accounts': integrationRead('collection', () => get('/v1/service-accounts?limit=200')),
  'POST /v1/service-accounts': own('tenant', 201, (t) =>
    json('POST', '/v1/service-accounts', { name: t.serviceAccountName, purpose: 'Isolation suite' }, true)),
  'POST /v1/service-accounts/:id/disable': object('tenant', (t) => json('POST', `/v1/service-accounts/${t.serviceAccount}/disable`, withReason())),
  'POST /v1/service-accounts/:id/keys': object('tenant', (t) => json('POST', `/v1/service-accounts/${t.serviceAccount}/keys`, {
    name: 'Isolation', scopes: ['compliance:read'], rate_tier: 'standard',
  }, true)),
  'POST /v1/api-keys/:id/rotate': object('tenant', (t) => json('POST', `/v1/api-keys/${t.apiKey}/rotate`, { grace_minutes: 0 }, true)),
  'POST /v1/api-keys/:id/revoke': object('tenant', (t) => json('POST', `/v1/api-keys/${t.apiKey}/revoke`, withReason())),
  // INT B1: OpenAPI document and webhooks (FR-INT-001)
  'GET /v1/openapi.json': { ...object('public', () => get('/v1/openapi.json')), anonymous: 200 },
  'GET /v1/webhook-topics': integrationRead('collection', () => get('/v1/webhook-topics')),
  'GET /v1/webhook-endpoints': integrationRead('collection', () => get('/v1/webhook-endpoints?limit=200')),
  'POST /v1/webhook-endpoints': own('tenant', 201, () =>
    json('POST', '/v1/webhook-endpoints', { url: 'https://hooks.example.com/isolation', topics: ['market.went_live'] }, true)),
  'GET /v1/webhook-endpoints/:id': integrationRead('object', (t) => get(`/v1/webhook-endpoints/${t.webhookEndpoint}`)),
  'PATCH /v1/webhook-endpoints/:id': object('tenant', (t) => json('PATCH', `/v1/webhook-endpoints/${t.webhookEndpoint}`, { state: 'disabled' })),
  'POST /v1/webhook-endpoints/:id/rotate-secret': object('tenant', (t) =>
    json('POST', `/v1/webhook-endpoints/${t.webhookEndpoint}/rotate-secret`, { grace_minutes: 0 }, true)),
  'POST /v1/webhook-endpoints/:id/test': object('tenant', (t) => json('POST', `/v1/webhook-endpoints/${t.webhookEndpoint}/test`, {}, true)),
  'GET /v1/webhook-endpoints/:id/deliveries': integrationRead('object', (t) => get(`/v1/webhook-endpoints/${t.webhookEndpoint}/deliveries`)),
  'POST /v1/webhook-deliveries/:id/retry': object('tenant', (t) => json('POST', `/v1/webhook-deliveries/${t.webhookDelivery}/retry`, {}, true)),
  // AUD B1: evidence documents (D-B1-04)
  'GET /v1/documents/limits': collection('tenant', () => get('/v1/documents/limits')),
  'POST /v1/documents': own('tenant', 201, documentRequest),
  'GET /v1/documents/:id': object('tenant', (t) => get(`/v1/documents/${t.document}`)),
  'GET /v1/documents/:id/content': object('tenant', (t) => get(`/v1/documents/${t.document}/content`)),
  // CAS with the product's case types: tenant A's position is no subject in tenant B.
  'POST /v1/cases': named(422, 'SUBJECT_NOT_FOUND', (t) => json('POST', '/v1/cases', genealogyCase(t), true)),
  'GET /v1/cases': collection('tenant', () => get('/v1/cases?limit=200')),
  'GET /v1/cases/:id': object('tenant', (t) => get(`/v1/cases/${t.case}`)),
  'POST /v1/cases/:id/evidence': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/evidence`, { document_id: t.freeDocument }, true)),
  'POST /v1/cases/:id/assign': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/assign`, { user_id: null })),
  'POST /v1/cases/:id/submit': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/submit`, {})),
  'POST /v1/cases/:id/decision': object('tenant', (t) =>
    json('POST', `/v1/cases/${t.case}/decision`, { decision: 'approve', reason: 'isolation' }, true)),
  'POST /v1/cases/:id/withdraw': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/withdraw`, withReason())),
  // CAS B2
  'PATCH /v1/cases/:id': object('tenant', (t) => json('PATCH', `/v1/cases/${t.duplicateCase}`, { payload: {
    matched_participant_id: t.participant, matched_kinds: ['identity_ref'], proposed_outcome: 'allow',
  } })),
  'GET /v1/cases/counts': collection('tenant', () => get('/v1/cases/counts')),
  // PAR B2: tenant A's type code and market code are free in tenant B; its market id names nothing there.
  'GET /v1/participant-types': collection('tenant', () => get('/v1/participant-types')),
  'POST /v1/participant-types': own('tenant', 201, () => json('POST', '/v1/participant-types', {
    code: 'DIST', name: 'Distributor', can_earn: true, counts_as_end_customer: false, can_sponsor: true, can_hold_positions: true, reason: 'isolation',
  }, true)),
  'POST /v1/participant-types/:id/decision': object('tenant', (t) =>
    json('POST', `/v1/participant-types/${t.participantType}/decision`, { decision: 'approve', reason: 'isolation' }, true)),
  'POST /v1/participant-types/:id/withdraw': object('tenant', (t) => json('POST', `/v1/participant-types/${t.participantType}/withdraw`, withReason())),
  'GET /v1/participants': collection('tenant', () => get('/v1/participants?limit=200')),
  'POST /v1/participants': named(422, 'MARKET_UNKNOWN', (t) => json('POST', '/v1/participants', enrolment(t), true)),
  'GET /v1/participants/:id': object('tenant', (t) => get(`/v1/participants/${t.participant}`)),
  // participant.unmask is a tenant-own decision: a support session never holds it.
  'POST /v1/participants/:id/unmask': object('tenant', (t) => json('POST', `/v1/participants/${t.participant}/unmask`, { fields: ['email'] })),
  'POST /v1/participants/:id/type': object('tenant', (t) =>
    json('POST', `/v1/participants/${t.participant}/type`, withReason({ type_code: 'DIST', valid_from: '2099-01-01T00:00:00Z' }), true)),
  'POST /v1/participants/:id/positions': object('tenant', (t) => json('POST', `/v1/participants/${t.participant}/positions`, {}, true)),
  'POST /v1/participants/:id/agreement-acceptances': object('tenant', (t) => json('POST', `/v1/participants/${t.participant}/agreement-acceptances`, {
    agreement_version_id: t.agreementVersion, accepted_at: PAST,
  }, true)),
  'POST /v1/participants/:id/signals': object('tenant', (t) =>
    json('POST', `/v1/participants/${t.participant}/signals`, { device_id: 'isolation-device' }, true)),
  'GET /v1/agreement-versions': collection('tenant', () => get('/v1/agreement-versions')),
  'POST /v1/agreement-versions': named(422, 'MARKET_UNKNOWN', (t) => json('POST', '/v1/agreement-versions', {
    market_id: t.peopleMarket, label: 'Isolation terms', document_id: t.freeDocument, acceptance_required: true,
  }, true)),
  // CRM B2
  'PUT /v1/customers/:id/servicing': object('tenant', (t) => json('PUT', `/v1/customers/${t.customer}/servicing`, withReason({
    position_ref: t.positionRef, valid_from: '2099-01-01T00:00:00Z',
  }), true)),
  'GET /v1/participants/:id/servicing': object('tenant', (t) => get(`/v1/participants/${t.customer}/servicing`)),
  'GET /v1/positions/:id/customers': object('tenant', (t) => get(`/v1/positions/${t.position}/customers`)),
  // GEN B2
  'GET /v1/genealogy/tree': collection('tenant', () => get('/v1/genealogy/tree')),
  'GET /v1/genealogy/search': collection('tenant', (t) => get(`/v1/genealogy/search?q=${encodeURIComponent(t.positionRef)}`)),
  'GET /v1/positions/:id': object('tenant', (t) => get(`/v1/positions/${t.position}`)),
  'POST /v1/positions/:id/status': object('tenant', (t) =>
    json('POST', `/v1/positions/${t.position}/status`, withReason({ status: 'suspended', effective_from: PAST }), true)),
  'GET /v1/positions/:id/downline': object('tenant', (t) => get(`/v1/positions/${t.childPosition}/downline?viewer=${t.position}`)),
  // ORD B2: ingestion takes API keys only; tenant A's market and late items are refused as unknown ones.
  'POST /v1/orders': keyOnly((t) => json('POST', '/v1/orders', order(t), true)),
  'POST /v1/order-events': keyOnly((t) => json('POST', '/v1/order-events', {
    source_system: 'canary', source_event_id: `e-${t.order}`, source_order_id: `o-${t.order}`, type: 'refund', occurred_at: PAST,
    refund_minor: '1', fee_minor: '0',
  }, true)),
  'GET /v1/orders': collection('tenant', () => get('/v1/orders?limit=200')),
  'GET /v1/orders/summary': collection('tenant', () => get('/v1/orders/summary')),
  'GET /v1/orders/:id': object('tenant', (t) => get(`/v1/orders/${t.order}`)),
  'GET /v1/inbound-events': collection('tenant', () => get('/v1/inbound-events?limit=200')),
  'POST /v1/inbound-events/:id/retry': object('tenant', (t) => json('POST', `/v1/inbound-events/${t.heldEvent}/retry`, {})),
  'GET /v1/product-volumes': collection('tenant', () => get('/v1/product-volumes?limit=200')),
  'POST /v1/product-volumes': named(422, 'VALIDATION_FAILED', (t) => json('POST', '/v1/product-volumes', withReason({
    market_id: t.peopleMarket, sku: 'CANARY-SKU', item_class: 'product', volumes: { qv: '1' }, valid_from: '2099-01-01T00:00:00Z',
  }), true)),
  // late.manage only writes: no support session holds it.
  'GET /v1/late-transactions': { ...collection('tenant', () => get('/v1/late-transactions?limit=200')), inSession: 403 },
  'POST /v1/late-transactions/preview': named(422, 'LATE_SELECTION_INVALID', (t) =>
    json('POST', '/v1/late-transactions/preview', { ids: [t.lateTransaction] })),
  'POST /v1/late-transactions/decisions': named(422, 'LATE_SELECTION_INVALID', (t) =>
    json('POST', '/v1/late-transactions/decisions', withReason({ ids: [t.lateTransaction], handling: 'adjust' }), true)),
  // INT B2: connectors are integration credentials (integration.manage); the webhook is signed, not signed in.
  'GET /v1/connectors': integrationRead('collection', () => get('/v1/connectors')),
  'POST /v1/connectors': named(422, 'VALIDATION_FAILED', (t) => json('POST', '/v1/connectors', {
    provider: 'shopify', market_id: t.peopleMarket, name: 'Isolation shop', webhook_secret: 'isolation-secret-0123456789',
  }, true)),
  'POST /v1/connectors/:id/rotate-secret': object('tenant', (t) =>
    json('POST', `/v1/connectors/${t.connector}/rotate-secret`, { webhook_secret: 'isolation-secret-0123456789' })),
  'POST /v1/connectors/:id/withdraw': object('tenant', (t) => json('POST', `/v1/connectors/${t.connector}/withdraw`, withReason())),
  'POST /v1/connectors/:id/webhooks': {
    ...object('public', (t) => json('POST', `/v1/connectors/${t.connector}/webhooks`, { id: 1 })), unsignedAnswer: [401, 'SIGNATURE_INVALID'],
  },
  'GET /v1/integrations/health': collection('tenant', () => get('/v1/integrations/health')),
  // PLN B3 (PLAN B3 2.1): tenant A's markets and calendars name nothing in tenant B.
  'GET /v1/plans': collection('tenant', () => get('/v1/plans?limit=200')),
  'POST /v1/plans': named(422, 'MARKET_UNKNOWN', (t) =>
    json('POST', '/v1/plans', { name: 'Isolation plan', market_ids: [t.compMarket], calendar_ids: [t.compCalendar] }, true)),
  'GET /v1/plans/:id': object('tenant', (t) => get(`/v1/plans/${t.plan}`)),
  'POST /v1/plans/:id/versions': object('tenant', (t) => json('POST', `/v1/plans/${t.plan}/versions`, {}, true)),
  'GET /v1/plans/:id/versions/:v': object('tenant', (t) => get(draft(t))),
  'PATCH /v1/plans/:id/versions/:v': object('tenant', (t) => draftWrite('PATCH', draft(t), { justification: 'isolation' })),
  'GET /v1/plans/:id/versions/:v/diff': object('tenant', (t) => get(`${draft(t)}/diff?against=1`)),
  'PUT /v1/plans/:id/versions/:v/rules/:ruleKey': object('tenant', (t) =>
    draftWrite('PUT', `${draft(t)}/rules/${RULE_KEY}`, { kind: 'volume.personal', params: personal(RULE_KEY) })),
  'DELETE /v1/plans/:id/versions/:v/rules/:ruleKey': object('tenant', (t) => draftWrite('DELETE', `${draft(t)}/rules/${RULE_KEY}`)),
  'PUT /v1/plans/:id/versions/:v/transitions/:stateItem': object('tenant', (t) =>
    draftWrite('PUT', `${draft(t)}/transitions/${STATE_ITEM}`, { rule: 'carry' })),
  'DELETE /v1/plans/:id/versions/:v/transitions/:stateItem': object('tenant', (t) => draftWrite('DELETE', `${draft(t)}/transitions/${STATE_ITEM}`)),
  'POST /v1/plans/:id/versions/:v/submit': object('tenant', (t) => json('POST', `${draft(t)}/submit`, {}, true)),
  'POST /v1/plans/:id/versions/:v/decision': object('tenant', (t) =>
    json('POST', `${draft(t)}/decision`, { decision: 'approve', reason: 'isolation' }, true)),
  'POST /v1/plans/:id/versions/:v/schedule': object('tenant', (t) =>
    json('POST', `${draft(t)}/schedule`, { effective_from: '2099-01-01T00:00:00Z', justification: 'isolation' }, true)),
  'POST /v1/plans/:id/versions/:v/guardrails/evaluate': object('tenant', (t) => json('POST', `${draft(t)}/guardrails/evaluate`, {}, true)),
  'POST /v1/plans/:id/versions/:v/guardrail-decisions/:decisionId/acknowledge': object('tenant', (t) =>
    json('POST', `${draft(t)}/guardrail-decisions/${t.guardrailDecision}/acknowledge`, {}, true)),
  'GET /v1/plans/:id/versions/:v/golden-datasets': object('tenant', (t) => get(`${draft(t)}/golden-datasets`)),
  'GET /v1/plans/:id/versions/:v/golden-datasets/:goldenId': object('tenant', (t) => get(`${draft(t)}/golden-datasets/${t.golden}`)),
  'POST /v1/plans/:id/versions/:v/golden-datasets': object('tenant', (t) => json('POST', `${draft(t)}/golden-datasets`, {
    name: 'Isolation golden', calendar_id: t.compCalendar, covers: [], input: GOLDEN_INPUT, expected: GOLDEN_EXPECTED,
  }, true)),
  'DELETE /v1/plans/:id/versions/:v/golden-datasets/:goldenId': object('tenant', (t) => json('DELETE', `${draft(t)}/golden-datasets/${t.golden}`)),
  'POST /v1/plans/:id/versions/:v/golden-datasets/run': object('tenant', (t) => json('POST', `${draft(t)}/golden-datasets/run`, {}, true)),
  // CPL B3 (PLAN B3 2.2)
  'GET /v1/guardrail-decisions': collection('tenant', () => get('/v1/guardrail-decisions?limit=200')),
  'GET /v1/guardrail-decisions/:id': object('tenant', (t) => get(`/v1/guardrail-decisions/${t.guardrailDecision}`)),
  'POST /v1/guardrail-decisions/:id/override': object('tenant', (t) => json('POST', `/v1/guardrail-decisions/${t.guardrailDecision}/override`, {
    justification: 'Isolation suite override justification',
  }, true)),
  // COMP B3 (PLAN B3 2.3, 2.5)
  'GET /v1/periods': collection('tenant', () => get('/v1/periods?limit=200')),
  'GET /v1/periods/:id': object('tenant', (t) => get(`/v1/periods/${t.period}`)),
  'POST /v1/periods/:id/runs': object('tenant', (t) => ({ ...json('POST', `/v1/periods/${t.period}/runs`), headers: { 'run-request-id': 'isolation' } })),
  'GET /v1/runs/:id': object('tenant', (t) => get(`/v1/runs/${t.run}`)),
  'GET /v1/runs/:id/review': object('tenant', (t) => get(`/v1/runs/${t.run}/review`)),
  'GET /v1/runs/:id/transitions': object('tenant', (t) => get(`/v1/runs/${t.run}/transitions`)),
  'GET /v1/runs/:id/lines': object('tenant', (t) => get(`/v1/runs/${t.run}/lines`)),
  'POST /v1/runs/:id/request-commit': object('tenant', (t) => json('POST', `/v1/runs/${t.run}/request-commit`, {}, true)),
  'POST /v1/runs/:id/commit': object('tenant', (t) => json('POST', `/v1/runs/${t.run}/commit`, { acknowledged_exceptions: [] }, true)),
  'POST /v1/runs/:id/replay': object('tenant', (t) => json('POST', `/v1/runs/${t.run}/replay`)),
  'GET /v1/result-lines/:id/trace': object('tenant', (t) => get(`/v1/result-lines/${t.resultLine}/trace`)),
  'GET /v1/positions/:id/qualification': object('tenant', (t) => get(`/v1/positions/${t.payee}/qualification`)),
  // An A plan version or period in the body is answered as an unknown one (404).
  'POST /v1/simulations': object('tenant', (t) => json('POST', '/v1/simulations', { plan_version_id: t.activeVersion, period_id: t.period }, true)),
  'GET /v1/simulations': collection('tenant', () => get('/v1/simulations?limit=200')),
  'GET /v1/simulations/:id': object('tenant', (t) => get(`/v1/simulations/${t.simulation}`)),
  // plan.simulate is excluded from support sessions (PLAN B3 2.7).
  'GET /v1/simulations/:id/payees': { ...object('tenant', (t) => get(`/v1/simulations/${t.simulation}/payees`)), inSession: 403 },
  'GET /v1/restatements/:id': object('tenant', (t) => get(`/v1/restatements/${t.restatement}`)),
  'GET /v1/restatements/:id/lines': object('tenant', (t) => get(`/v1/restatements/${t.restatement}/lines`)),
}

/** The case of a route; Fastify's HEAD routes run their GET handler, so they take the GET case with method HEAD. */
export function caseOf(route: string): RouteCase | undefined {
  const found = ROUTE_CASES[route]
  if (found !== undefined || !route.startsWith('HEAD ')) return found
  const getCase = ROUTE_CASES[`GET ${route.slice('HEAD '.length)}`]
  return getCase === undefined ? undefined : { ...getCase, request: (t) => ({ ...getCase.request(t), method: 'HEAD' }) }
}
