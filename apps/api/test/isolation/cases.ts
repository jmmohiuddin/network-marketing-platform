// TS-21 route cases: one per route buildApp registers (`METHOD /url`), keyed exactly as Fastify reports it. The
// isolation suite fails when a route has no case here, or a case has no route.
import { multipartBody, TINY_MAPPING, tinyFiles } from '../../src/modules/imp/test-support.js'
import { PROTOTYPE_SETTINGS } from '../../src/modules/cpl/test-fixtures.js'
import type { CallOptions } from '../helpers/index.js'
import { PASSWORD, SUPPORT_SCOPE, type Targets } from './seed.js'

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
  /** Status of the read inside tenant A's support session when not 200. */
  readonly inSession?: number
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
const vendor = (request: (t: Targets) => CaseRequest): RouteCase => ({ access: 'vendor', shape: 'object', request })

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
  'PUT /v1/settings/:key': own('tenant', 200, () => ({
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
}

/** The case of a route; Fastify's HEAD routes run their GET handler, so they take the GET case with method HEAD. */
export function caseOf(route: string): RouteCase | undefined {
  const found = ROUTE_CASES[route]
  if (found !== undefined || !route.startsWith('HEAD ')) return found
  const getCase = ROUTE_CASES[`GET ${route.slice('HEAD '.length)}`]
  return getCase === undefined ? undefined : { ...getCase, request: (t) => ({ ...getCase.request(t), method: 'HEAD' }) }
}
