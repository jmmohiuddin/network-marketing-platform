// TS-21 route cases: one per route buildApp registers (`METHOD /url`), keyed exactly as Fastify reports it. The
// isolation suite fails when a route has no case here, or a case has no route.
import { documentBody } from '../../src/modules/aud/test-support.js'
import { FIXTURE_REASONS, FIXTURE_SUBJECT } from '../../src/modules/cas/test-support.js'
import { multipartBody, TINY_MAPPING, tinyFiles } from '../../src/modules/imp/test-support.js'
import { PROTOTYPE_SETTINGS } from '../../src/modules/cpl/test-fixtures.js'
import type { CallOptions } from '../helpers/index.js'
import { DRAFT_MARKET_CODE, PACK, PASSWORD, RECORDABLE_ITEM, SUPPORT_SCOPE, type Targets } from './seed.js'

/**
 * Who the route is for. public: no session (sign-in, invitation); self: the caller's own session or account;
 * tenant: tenant realm; vendor: vendor realm only; either: vendor users, or tenant users with vendor_access.decide.
 */
export type Access = 'public' | 'self' | 'tenant' | 'vendor' | 'either'

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
  // CAS B1 with the fixture case type (D-B1-13): tenant A's market is no subject in tenant B.
  'POST /v1/cases': named(422, 'SUBJECT_NOT_FOUND', (t) => json('POST', '/v1/cases', {
    type: 'adjustment', subject_type: FIXTURE_SUBJECT, subject_id: t.draftMarket, reason_code: FIXTURE_REASONS[0], payload: { amount_minor: '1' },
  }, true)),
  'GET /v1/cases': collection('tenant', () => get('/v1/cases?limit=200')),
  'GET /v1/cases/:id': object('tenant', (t) => get(`/v1/cases/${t.case}`)),
  'POST /v1/cases/:id/evidence': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/evidence`, { document_id: t.freeDocument }, true)),
  'POST /v1/cases/:id/assign': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/assign`, { user_id: null })),
  'POST /v1/cases/:id/submit': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/submit`, {})),
  'POST /v1/cases/:id/decision': object('tenant', (t) =>
    json('POST', `/v1/cases/${t.case}/decision`, { decision: 'approve', reason: 'isolation' }, true)),
  'POST /v1/cases/:id/withdraw': object('tenant', (t) => json('POST', `/v1/cases/${t.case}/withdraw`, withReason())),
}

/** The case of a route; Fastify's HEAD routes run their GET handler, so they take the GET case with method HEAD. */
export function caseOf(route: string): RouteCase | undefined {
  const found = ROUTE_CASES[route]
  if (found !== undefined || !route.startsWith('HEAD ')) return found
  const getCase = ROUTE_CASES[`GET ${route.slice('HEAD '.length)}`]
  return getCase === undefined ? undefined : { ...getCase, request: (t) => ({ ...getCase.request(t), method: 'HEAD' }) }
}
