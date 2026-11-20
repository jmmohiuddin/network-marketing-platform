import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { BASE_ROLES, isPrivileged, type BaseRoleName, type Permission } from '../../src/lib/permissions.js'
import type { SettingKey } from '../../src/modules/ten/settings.js'
import { multipartBody, TINY_MAPPING, tinyFiles } from '../../src/modules/imp/test-support.js'
import {
  baseRoleId, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, ownerRows, resetApiDb, type TestUser,
} from '../helpers/index.js'
import type { CaseRequest } from '../isolation/cases.js'
import { routesOf } from '../isolation/route-registry.js'
import { MARKET_CODE, PACK, SEED_TIMEOUT_MS, seedTenants, SUITE_MODULES, type Seeded } from '../isolation/seed.js'

// TS-36 (AC-36.1, AC-36.2, BR-SEC-05, E-SEC-02): every base role against every route buildApp() registers. A probe is
// side-effect free (an id that exists nowhere, or a body that fails validation), so "allowed" is any answer past the
// authorisation checks (404, 400, 428...) and "denied" is 403 PERMISSION_DENIED or REALM_FORBIDDEN. Expected outcomes
// come from the catalogue (BASE_ROLES) and the permission each route needs per SECURITY_IAM_TENANCY 4.3 and API.md.
vi.mock('fastify', async (original) => (await import('../isolation/route-registry.js')).collecting(await original()))

const uploadDir = await mkdtemp(join(tmpdir(), 'nmp-authz-'))
vi.stubEnv('UPLOAD_DIR', uploadDir)
const app = await buildTestApp({ modules: SUITE_MODULES, env: { API_RATE_LIMIT_PER_MINUTE: '100000', SIGN_IN_RATE_LIMIT_PER_MINUTE: '100000' } })
const routes = routesOf(app)

type Needs = (held: ReadonlySet<Permission>) => boolean

interface Probe {
  readonly needs: Needs
  readonly request: CaseRequest
  /** Ends the caller's session (sign-out): runs with a session of its own. */
  readonly fresh?: true
}

const all = (...permissions: Permission[]): Needs => (held) => permissions.every((permission) => held.has(permission))
const any = (...permissions: Permission[]): Needs => (held) => permissions.some((permission) => held.has(permission))
const everyone: Needs = () => true
/** Vendor realm only: no tenant role reaches it. */
const nobody: Needs = () => false

const NOWHERE = randomUUID()
const probe = (needs: Needs, method: CaseRequest['method'], url: string, body?: unknown): Probe =>
  ({ needs, request: { method, url, idempotencyKey: true, ...(body === undefined ? {} : { body }) } })
const read = (needs: Needs, url: string): Probe => ({ needs, request: { method: 'GET', url } })

// Settings: thresholds are read by whoever reads the reports; breach contacts only by settings managers (FR-PRV-004).
const SETTING_READERS: Readonly<Record<SettingKey, Needs>> = {
  'compliance.active_pv_minor': any('settings.manage', 'compliance.read'),
  'compliance.rank_thresholds_pv_minor': any('settings.manage', 'compliance.read'),
  'compliance.late_order_day': any('settings.manage', 'compliance.read'),
  'compliance.personal_share_flag': any('settings.manage', 'compliance.read'),
  'privacy.breach_contacts': all('settings.manage'),
  'money.rounding_mode': any('settings.manage', 'settings.approve'),
  'money.clawback_policy': any('settings.manage', 'settings.approve'),
  'plan.activation_notice_days': any('settings.manage', 'settings.approve'),
  // PLAN B2 section 2.1.
  'participants.duplicate_matching': any('settings.manage', 'case.duplicate.read'),
  'customers.reassignment_rule': any('settings.manage', 'servicing.manage'),
  'orders.crediting_event': any('settings.manage', 'order.read'),
  'orders.purpose_required': any('settings.manage', 'order.read'),
  'orders.attribution_precedence': any('settings.manage', 'order.read'),
  'orders.new_buyer_type': any('settings.manage', 'order.read'),
  'orders.restocking_fee_volume_effect': any('settings.manage', 'order.read'),
  'integrations.sync_health': any('settings.manage', 'integration.read'),
  'genealogy.visibility_policy': any('settings.manage', 'privacy.manage', 'genealogy.read'),
  'genealogy.placement_width': any('settings.manage', 'genealogy.read'),
  // PLAN B3 section 1.5.
  'runs.exception_thresholds': any('settings.manage', 'run.review'),
  // PLAN B4 D-B4-18.
  'payouts.market_policy': any('settings.manage', 'settings.approve', 'payout.prepare'),
  'payouts.bank_detail_cooling_off_hours': any('settings.manage', 'settings.approve', 'payout.prepare'),
  'payouts.shared_account_threshold': any('settings.manage', 'settings.approve', 'payout.prepare'),
  'payouts.dormant_after_days': any('settings.manage', 'settings.approve', 'payout.prepare'),
  'payouts.provider_review_reminder_days': any('settings.manage', 'settings.approve', 'payout.prepare'),
  'adjustments.policy': any('settings.manage', 'settings.approve', 'case.adjustment.create'),
  'write_offs.policy': any('settings.manage', 'settings.approve', 'case.write_off.create'),
  // PLAN B5 D-B5-20.
  'disputes.policy': any('settings.manage', 'settings.approve', 'case.dispute.read'),
  'privacy.policy': any('settings.manage', 'settings.approve', 'privacy.manage'),
  'portal.customer_contact_visible': any('settings.manage', 'settings.approve', 'privacy.manage'),
  // PLAN B6 D-B6-17.
  'plan.filing_requirements': any('settings.manage', 'plan.read'),
  'exports.full_schedule': any('settings.manage', 'export.full'),
}
const SETTING_KEYS = Object.keys(SETTING_READERS) as SettingKey[]
const MAPPING_READERS = any('import.manage', 'mapping.edit', 'mapping.approve')
// A key's approver reads and decides its change requests (PLAN B2 2.1: privacy.manage for the visibility policy).
// market.signoff: the approver of plan.filing_requirements reads the list it decides from (BUG-121).
const SETTINGS_HISTORY = any('settings.manage', 'settings.approve', 'privacy.manage', 'market.signoff')
const STRUCTURE_READERS = any('settings.manage', 'market.manage', 'market.signoff')
const LAUNCH_READERS = any('market.manage', 'market.signoff')
const SETTINGS_MANAGE = all('settings.manage')
const MARKET_MANAGE = all('market.manage')
const INTEGRATION = all('integration.manage')
// Evidence uploaders: launch preparers and signers, and the create permission of a registered case type; agreement
// publishers upload agreement documents (PLAN B2 2.2).
const UPLOADERS = any(
  'market.manage', 'market.signoff', 'case.genealogy.create', 'case.duplicate.create', 'restatement.request', 'agreement.publish',
  'case.adjustment.create', 'case.bank_detail.create', 'case.returned_payment.create', 'case.write_off.create',
  // PLAN B5: the dispute and privacy case types' create permissions; B-MKT the grievance's.
  'case.dispute.approve', 'privacy.manage', 'case.grievance.create',
)
const CASE_READERS = any(
  'case.genealogy.read', 'case.duplicate.read', 'case.restatement.read', 'case.adjustment.read', 'case.bank_detail.read', 'case.returned_payment.read',
  'case.write_off.read', 'case.dispute.read', 'privacy.manage', 'case.grievance.read',
)
const PARTICIPANT_READ = all('participant.read')
const PARTICIPANT_MANAGE = all('participant.manage')
const GENEALOGY_READ = all('genealogy.read')
const ORDER_READ = all('order.read')
const LATE = all('late.manage')
const TODAY = new Date().toISOString()
// A case id that exists nowhere has no type, so no permission can be checked: 404 for every role.
const caseProbe = (path: string, body?: unknown) => probe(everyone, 'POST', `/v1/cases/${NOWHERE}/${path}`, body)
const ROWS = `/v1/compliance/snapshots/${NOWHERE}/figures/R1.2025-01.customer_share_pct/rows`
const PLAN_READ = all('plan.read')
const PLAN_EDIT = all('plan.edit')
const VERSION = `/v1/plans/${NOWHERE}/versions/1`
const RUN = `/v1/runs/${NOWHERE}`
const PAYOUT_READ = all('payout.read')
const BATCH = `/v1/payout-batches/${NOWHERE}`
const LEDGER_READ = all('ledger.read')
const LEDGER_EXPORT = all('ledger.export')
const EXPORT_FULL = all('export.full')
const VIEW_USERS = any('order.read', 'ledger.read')
const MIGRATION_MANAGE = all('migration.manage')
const MIGRATION_SIGNOFF = all('migration.signoff')
const MIGRATION_READERS = any('migration.manage', 'migration.signoff')
const MIGRATION = `/v1/migrations/${NOWHERE}`
const TAX_READ = all('tax.read')
const TAX_FORMS = all('tax.forms')
const TAX_YEAR = `market_id=${NOWHERE}&tax_year=2025`
const DIFFERENCE = `${MIGRATION}/parallel-runs/${NOWHERE}/differences/${NOWHERE}`
// D-B6-09: a migration batch or mapping also needs migration.manage. The market exists nowhere (422) and the If-Match is stale
// (409): refused once past the permission checks, nothing is written.
const migrationForm = multipartBody({ market: 'NOWHERE', kind: 'migration', period_from: '2025-01', period_to: '2025-01' }, tinyFiles())
const MIGRATION_UPLOAD: Probe = {
  needs: all('import.manage', 'migration.manage'),
  request: { method: 'POST', url: '/v1/imports', body: migrationForm.payload, headers: { 'content-type': migrationForm.contentType }, idempotencyKey: true },
}
const MIGRATION_MAPPING: Probe = {
  needs: all('mapping.edit', 'migration.manage'),
  request: { method: 'PUT', url: '/v1/import-mappings', headers: { 'if-match': '"999999"' }, body: { kind: 'migration', mappings: TINY_MAPPING } },
}

const PROBES: Readonly<Record<string, readonly Probe[]>> = {
  'POST /v1/auth/sessions': [probe(everyone, 'POST', '/v1/auth/sessions', {})],
  'POST /v1/auth/vendor-sessions': [probe(everyone, 'POST', '/v1/auth/vendor-sessions', {})],
  'POST /v1/auth/invitations/accept': [probe(everyone, 'POST', '/v1/auth/invitations/accept', {})],
  'GET /v1/auth/firebase-config': [read(everyone, '/v1/auth/firebase-config')],
  'POST /v1/auth/firebase-sessions': [probe(everyone, 'POST', '/v1/auth/firebase-sessions', {})],
  'POST /v1/auth/vendor-firebase-sessions': [probe(everyone, 'POST', '/v1/auth/vendor-firebase-sessions', {})],
  'DELETE /v1/auth/sessions/current': [{ ...probe(everyone, 'DELETE', '/v1/auth/sessions/current'), fresh: true }],
  'POST /v1/auth/mfa/totp': [probe(everyone, 'POST', '/v1/auth/mfa/totp')],
  'POST /v1/auth/mfa/totp/confirm': [probe(everyone, 'POST', '/v1/auth/mfa/totp/confirm', {})],
  'POST /v1/auth/sessions/current/mfa': [probe(everyone, 'POST', '/v1/auth/sessions/current/mfa', {})],
  'POST /v1/auth/sessions/current/step-up': [probe(everyone, 'POST', '/v1/auth/sessions/current/step-up', {})],
  'GET /v1/me': [read(everyone, '/v1/me')],
  'GET /v1/users': [read(all('user.manage'), '/v1/users')],
  'GET /v1/users/:id': [read(all('user.manage'), `/v1/users/${NOWHERE}`)],
  'POST /v1/users': [probe(all('user.manage'), 'POST', '/v1/users', {})],
  'POST /v1/users/:id/invitation': [probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/invitation`)],
  'POST /v1/users/:id/deactivate': [probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/deactivate`)],
  'GET /v1/roles': [read(all('user.manage'), '/v1/roles')],
  'POST /v1/roles': [probe(all('user.manage'), 'POST', '/v1/roles', {})],
  'POST /v1/users/:id/role-assignments': [probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/role-assignments`, {})],
  'POST /v1/role-assignments/:id/revoke': [probe(all('user.manage'), 'POST', `/v1/role-assignments/${NOWHERE}/revoke`)],
  'GET /v1/role-grant-requests': [read(all('user.manage'), '/v1/role-grant-requests')],
  'POST /v1/role-grant-requests/:id/decision': [probe(all('user.manage'), 'POST', `/v1/role-grant-requests/${NOWHERE}/decision`, {})],
  'GET /v1/settings/:key': SETTING_KEYS.map((key) => read(SETTING_READERS[key], `/v1/settings/${key}`)),
  // No If-Match: 428 once past the permission and step-up checks.
  'PUT /v1/settings/:key': SETTING_KEYS.map((key) => probe(all('settings.manage'), 'PUT', `/v1/settings/${key}`, {})),
  'GET /v1/markets': [read(everyone, '/v1/markets')],
  'GET /v1/audit-events': [read(all('audit.read'), '/v1/audit-events')],
  'GET /v1/audit-chain/verification': [read(all('audit.read'), '/v1/audit-chain/verification')],
  'POST /v1/audit-exports': [probe(all('audit.read', 'export'), 'POST', '/v1/audit-exports', { unknown: true })],
  'GET /v1/audit-exports/:id/download': [read(all('audit.read', 'export'), `/v1/audit-exports/${NOWHERE}/download`)],
  'POST /v1/support-sessions': [probe(nobody, 'POST', '/v1/support-sessions', {})],
  'GET /v1/support-sessions/limits': [read(nobody, '/v1/support-sessions/limits')],
  'GET /v1/support-sessions': [read(all('vendor_access.decide'), '/v1/support-sessions')],
  'GET /v1/support-sessions/:id': [read(all('vendor_access.decide'), `/v1/support-sessions/${NOWHERE}`)],
  'POST /v1/support-sessions/:id/decision': [probe(all('vendor_access.decide'), 'POST', `/v1/support-sessions/${NOWHERE}/decision`, {})],
  'POST /v1/support-sessions/:id/end': [probe(all('vendor_access.decide'), 'POST', `/v1/support-sessions/${NOWHERE}/end`)],
  'GET /v1/support-sessions/:id/log': [read(all('vendor_access.decide'), `/v1/support-sessions/${NOWHERE}/log`)],
  'GET /v1/tenants/:id/breach-contacts': [read(nobody, `/v1/tenants/${NOWHERE}/breach-contacts`)],
  'GET /v1/tenants': [read(nobody, '/v1/tenants')],
  'GET /v1/tenants/:id': [read(nobody, `/v1/tenants/${NOWHERE}`)],
  'POST /v1/tenants': [probe(nobody, 'POST', '/v1/tenants', {})],
  'POST /v1/tenants/:id/approve': [probe(nobody, 'POST', `/v1/tenants/${NOWHERE}/approve`)],
  'POST /v1/tenants/:id/go-live': [probe(nobody, 'POST', `/v1/tenants/${NOWHERE}/go-live`)],
  'GET /v1/vendor-audit-events': [read(nobody, '/v1/vendor-audit-events')],
  'GET /v1/vendor-users': [read(nobody, '/v1/vendor-users')],
  'POST /v1/vendor-users': [probe(nobody, 'POST', '/v1/vendor-users', {})],
  'POST /v1/vendor-users/:id/invitation': [probe(nobody, 'POST', `/v1/vendor-users/${NOWHERE}/invitation`)],
  'POST /v1/vendor-users/:id/deactivate': [probe(nobody, 'POST', `/v1/vendor-users/${NOWHERE}/deactivate`)],
  'POST /v1/vendor-users/:id/approve': [probe(nobody, 'POST', `/v1/vendor-users/${NOWHERE}/approve`)],
  'POST /v1/vendor-users/:id/reject': [probe(nobody, 'POST', `/v1/vendor-users/${NOWHERE}/reject`)],
  'POST /v1/imports': [probe(all('import.manage'), 'POST', '/v1/imports', {}), MIGRATION_UPLOAD],
  'GET /v1/imports/limits': [read(all('import.manage'), '/v1/imports/limits')],
  'GET /v1/imports': [read(all('import.manage'), '/v1/imports')],
  'GET /v1/imports/:id': [read(all('import.manage'), `/v1/imports/${NOWHERE}`)],
  'GET /v1/imports/:id/errors': [read(all('import.manage'), `/v1/imports/${NOWHERE}/errors`)],
  'GET /v1/imports/:id/source-values': [read(MAPPING_READERS, `/v1/imports/${NOWHERE}/source-values`)],
  'POST /v1/imports/:id/mapping': [probe(all('import.manage'), 'POST', `/v1/imports/${NOWHERE}/mapping`, {})],
  'POST /v1/imports/:id/load': [probe(all('import.manage'), 'POST', `/v1/imports/${NOWHERE}/load`)],
  'GET /v1/import-mappings': [read(MAPPING_READERS, '/v1/import-mappings')],
  'GET /v1/import-mappings/:id': [read(MAPPING_READERS, `/v1/import-mappings/${NOWHERE}`)],
  'PUT /v1/import-mappings': [probe(all('mapping.edit'), 'PUT', '/v1/import-mappings', {}), MIGRATION_MAPPING],
  'POST /v1/import-mappings/:id/approve': [probe(all('mapping.approve'), 'POST', `/v1/import-mappings/${NOWHERE}/approve`)],
  'POST /v1/compliance/snapshots': [probe(all('snapshot.create'), 'POST', '/v1/compliance/snapshots', {})],
  'GET /v1/compliance/snapshots': [read(all('compliance.read'), '/v1/compliance/snapshots')],
  'GET /v1/compliance/snapshots/:id': [read(all('compliance.read'), `/v1/compliance/snapshots/${NOWHERE}`)],
  'GET /v1/compliance/snapshots/:id/figures/:figure/rows': [
    read(all('compliance.read'), ROWS),
    read(all('compliance.read', 'export'), `${ROWS}?export=true`),
  ],
  'GET /v1/settings': [read(SETTINGS_HISTORY, '/v1/settings')],
  'GET /v1/settings/versions': [read(SETTINGS_HISTORY, '/v1/settings/versions')],
  'GET /v1/settings/versions/:version': [read(SETTINGS_HISTORY, '/v1/settings/versions/2000000000')],
  'GET /v1/setting-change-requests': [read(SETTINGS_HISTORY, '/v1/setting-change-requests')],
  'POST /v1/setting-change-requests/:id/decision': [probe(any('settings.approve', 'privacy.manage', 'market.signoff'), 'POST', `/v1/setting-change-requests/${NOWHERE}/decision`, {})],
  'POST /v1/setting-change-requests/:id/withdraw': [probe(SETTINGS_MANAGE, 'POST', `/v1/setting-change-requests/${NOWHERE}/withdraw`, {})],
  'GET /v1/markets/:id': [read(STRUCTURE_READERS, `/v1/markets/${NOWHERE}`)],
  'POST /v1/markets': [probe(SETTINGS_MANAGE, 'POST', '/v1/markets', {})],
  'PATCH /v1/markets/:id': [probe(SETTINGS_MANAGE, 'PATCH', `/v1/markets/${NOWHERE}`, {})],
  'DELETE /v1/markets/:id': [probe(SETTINGS_MANAGE, 'DELETE', `/v1/markets/${NOWHERE}`, {})],
  'GET /v1/brands': [read(everyone, '/v1/brands')],
  'POST /v1/brands': [probe(SETTINGS_MANAGE, 'POST', '/v1/brands', {})],
  'PATCH /v1/brands/:id': [probe(SETTINGS_MANAGE, 'PATCH', `/v1/brands/${NOWHERE}`, {})],
  'DELETE /v1/brands/:id': [probe(SETTINGS_MANAGE, 'DELETE', `/v1/brands/${NOWHERE}`, {})],
  'GET /v1/calendars': [read(STRUCTURE_READERS, '/v1/calendars')],
  'POST /v1/calendars': [probe(SETTINGS_MANAGE, 'POST', '/v1/calendars', {})],
  'PATCH /v1/calendars/:id': [probe(SETTINGS_MANAGE, 'PATCH', `/v1/calendars/${NOWHERE}`, {})],
  'DELETE /v1/calendars/:id': [probe(SETTINGS_MANAGE, 'DELETE', `/v1/calendars/${NOWHERE}`, {})],
  'POST /v1/calendars/:id/periods': [probe(SETTINGS_MANAGE, 'POST', `/v1/calendars/${NOWHERE}/periods`, {})],
  'GET /v1/calendars/:id/periods': [read(STRUCTURE_READERS, `/v1/calendars/${NOWHERE}/periods`)],
  'GET /v1/markets/:id/checklist': [read(LAUNCH_READERS, `/v1/markets/${NOWHERE}/checklist`)],
  'POST /v1/markets/:id/checklist/:item/entries': [probe(MARKET_MANAGE, 'POST', `/v1/markets/${NOWHERE}/checklist/licence_evidence/entries`, {})],
  'POST /v1/markets/:id/go-live-requests': [probe(MARKET_MANAGE, 'POST', `/v1/markets/${NOWHERE}/go-live-requests`, {})],
  'GET /v1/markets/:id/go-live-requests': [read(LAUNCH_READERS, `/v1/markets/${NOWHERE}/go-live-requests`)],
  'POST /v1/market-go-live-requests/:id/withdraw': [probe(MARKET_MANAGE, 'POST', `/v1/market-go-live-requests/${NOWHERE}/withdraw`, {})],
  'POST /v1/market-go-live-requests/:id/decision': [probe(all('market.signoff'), 'POST', `/v1/market-go-live-requests/${NOWHERE}/decision`, {})],
  // PLAN B4 2.3: integration and payout readers see the provider records too.
  'GET /v1/provider-configs': [read(any('market.manage', 'market.signoff', 'integration.manage', 'integration.read', 'payout.read'), '/v1/provider-configs')],
  'POST /v1/provider-configs': [probe(MARKET_MANAGE, 'POST', '/v1/provider-configs', {})],
  'POST /v1/provider-configs/:id/withdraw': [probe(MARKET_MANAGE, 'POST', `/v1/provider-configs/${NOWHERE}/withdraw`, {})],
  'GET /v1/market-packs/:pack/rules': [read(any('market.manage', 'market.signoff', 'compliance.read'), `/v1/market-packs/${PACK}/rules`)],
  'GET /v1/api-keys/options': [read(INTEGRATION, '/v1/api-keys/options')],
  'GET /v1/service-accounts': [read(INTEGRATION, '/v1/service-accounts')],
  'POST /v1/service-accounts': [probe(INTEGRATION, 'POST', '/v1/service-accounts', {})],
  'POST /v1/service-accounts/:id/disable': [probe(INTEGRATION, 'POST', `/v1/service-accounts/${NOWHERE}/disable`, {})],
  'POST /v1/service-accounts/:id/keys': [probe(INTEGRATION, 'POST', `/v1/service-accounts/${NOWHERE}/keys`, {})],
  'POST /v1/api-keys/:id/rotate': [probe(INTEGRATION, 'POST', `/v1/api-keys/${NOWHERE}/rotate`, {})],
  'POST /v1/api-keys/:id/revoke': [probe(INTEGRATION, 'POST', `/v1/api-keys/${NOWHERE}/revoke`, {})],
  'GET /v1/openapi.json': [read(everyone, '/v1/openapi.json')],
  'GET /v1/webhook-topics': [read(INTEGRATION, '/v1/webhook-topics')],
  'GET /v1/webhook-endpoints': [read(INTEGRATION, '/v1/webhook-endpoints')],
  'POST /v1/webhook-endpoints': [probe(INTEGRATION, 'POST', '/v1/webhook-endpoints', {})],
  'GET /v1/webhook-endpoints/:id': [read(INTEGRATION, `/v1/webhook-endpoints/${NOWHERE}`)],
  'PATCH /v1/webhook-endpoints/:id': [probe(INTEGRATION, 'PATCH', `/v1/webhook-endpoints/${NOWHERE}`, {})],
  'POST /v1/webhook-endpoints/:id/rotate-secret': [probe(INTEGRATION, 'POST', `/v1/webhook-endpoints/${NOWHERE}/rotate-secret`, {})],
  'POST /v1/webhook-endpoints/:id/test': [probe(INTEGRATION, 'POST', `/v1/webhook-endpoints/${NOWHERE}/test`, {})],
  'GET /v1/webhook-endpoints/:id/deliveries': [read(INTEGRATION, `/v1/webhook-endpoints/${NOWHERE}/deliveries`)],
  'POST /v1/webhook-deliveries/:id/retry': [probe(INTEGRATION, 'POST', `/v1/webhook-deliveries/${NOWHERE}/retry`, {})],
  'GET /v1/documents/limits': [read(UPLOADERS, '/v1/documents/limits')],
  'POST /v1/documents': [probe(UPLOADERS, 'POST', '/v1/documents', {})],
  'GET /v1/documents/:id': [read(everyone, `/v1/documents/${NOWHERE}`)],
  'GET /v1/documents/:id/content': [read(everyone, `/v1/documents/${NOWHERE}/content`)],
  // The body is checked before the permission (cas/routes.ts): a valid one about a subject that exists nowhere.
  'POST /v1/cases': [
    probe(all('case.genealogy.create'), 'POST', '/v1/cases', {
      type: 'genealogy_change', subject_type: 'position', subject_id: NOWHERE, reason_code: 'PARTICIPANT_REQUEST',
      payload: { kind: 'sponsor', proposed_parent_position_id: NOWHERE, effective_from: TODAY },
    }),
    probe(all('case.duplicate.create'), 'POST', '/v1/cases', {
      type: 'duplicate', subject_type: 'participant', subject_id: NOWHERE, reason_code: 'STAFF_SUSPICION',
      payload: { matched_participant_id: NOWHERE, matched_kinds: [] },
    }),
    probe(all('restatement.request'), 'POST', '/v1/cases', {
      type: 'restatement', subject_type: 'period', subject_id: NOWHERE, reason_code: 'INPUT_CORRECTION', payload: { note: 'probe' },
    }),
    probe(all('case.bank_detail.create'), 'POST', '/v1/cases', {
      type: 'bank_detail', subject_type: 'participant', subject_id: NOWHERE, reason_code: 'PAYEE_REQUEST', payload: { request_id: NOWHERE },
    }),
    probe(all('case.grievance.create'), 'POST', '/v1/cases', {
      type: 'grievance', subject_type: 'participant', subject_id: NOWHERE, reason_code: 'payout', payload: { received_at: TODAY, channel: 'email' },
    }),
    // Only the system opens it (RETURNED_BY_BANK is a system reason): past the permission, 422.
    probe(all('case.returned_payment.create'), 'POST', '/v1/cases', {
      type: 'returned_payment', subject_type: 'payout_instruction', subject_id: NOWHERE, reason_code: 'RETURNED_BY_BANK', payload: { instruction_id: NOWHERE },
    }),
  ],
  'GET /v1/cases': [read(CASE_READERS, '/v1/cases')],
  'GET /v1/cases/:id': [read(everyone, `/v1/cases/${NOWHERE}`)],
  'POST /v1/cases/:id/evidence': [caseProbe('evidence', {})],
  'POST /v1/cases/:id/assign': [caseProbe('assign', {})],
  'POST /v1/cases/:id/submit': [caseProbe('submit', {})],
  'POST /v1/cases/:id/decision': [caseProbe('decision', {})],
  'POST /v1/cases/:id/withdraw': [caseProbe('withdraw', {})],
  'PATCH /v1/cases/:id': [probe(everyone, 'PATCH', `/v1/cases/${NOWHERE}`, {})],
  'GET /v1/cases/counts': [read(CASE_READERS, '/v1/cases/counts')],
  // PAR / CRM (PLAN B2 2.2, 2.3)
  'GET /v1/participant-types': [read(any('participant.read', 'settings.manage', 'participant_type.approve'), '/v1/participant-types')],
  'POST /v1/participant-types': [probe(SETTINGS_MANAGE, 'POST', '/v1/participant-types', {})],
  'POST /v1/participant-types/:id/decision': [probe(all('participant_type.approve'), 'POST', `/v1/participant-types/${NOWHERE}/decision`, {})],
  'POST /v1/participant-types/:id/withdraw': [probe(SETTINGS_MANAGE, 'POST', `/v1/participant-types/${NOWHERE}/withdraw`, {})],
  'GET /v1/participants': [read(PARTICIPANT_READ, '/v1/participants')],
  'POST /v1/participants': [probe(PARTICIPANT_MANAGE, 'POST', '/v1/participants', {})],
  'GET /v1/participants/:id': [read(PARTICIPANT_READ, `/v1/participants/${NOWHERE}`)],
  'POST /v1/participants/:id/unmask': [probe(all('participant.unmask'), 'POST', `/v1/participants/${NOWHERE}/unmask`, {})],
  'POST /v1/participants/:id/type': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/type`, {})],
  'POST /v1/participants/:id/contact-email': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/contact-email`, {})],
  'POST /v1/participants/:id/positions': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/positions`, {})],
  'POST /v1/participants/:id/agreement-acceptances': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/agreement-acceptances`, {})],
  'POST /v1/participants/:id/signals': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/signals`, {})],
  'GET /v1/agreement-versions': [read(any('participant.read', 'agreement.publish', 'market.manage', 'market.signoff'), '/v1/agreement-versions')],
  'POST /v1/agreement-versions': [probe(all('agreement.publish'), 'POST', '/v1/agreement-versions', {})],
  'PUT /v1/customers/:id/servicing': [probe(all('servicing.manage'), 'PUT', `/v1/customers/${NOWHERE}/servicing`, {})],
  'GET /v1/participants/:id/servicing': [read(PARTICIPANT_READ, `/v1/participants/${NOWHERE}/servicing`)],
  'GET /v1/positions/:id/customers': [read(PARTICIPANT_READ, `/v1/positions/${NOWHERE}/customers`)],
  // GEN (PLAN B2 2.5). The status body is checked before the permission: valid ones; terminating needs participant.terminate.
  'GET /v1/genealogy/tree': [read(GENEALOGY_READ, '/v1/genealogy/tree')],
  'GET /v1/genealogy/search': [read(GENEALOGY_READ, '/v1/genealogy/search?q=nowhere')],
  'GET /v1/positions/:id': [read(any('genealogy.read', 'participant.read'), `/v1/positions/${NOWHERE}`)],
  'POST /v1/positions/:id/status': [
    probe(any('participant.manage', 'participant.terminate'), 'POST', `/v1/positions/${NOWHERE}/status`, {
      status: 'suspended', effective_from: '2026-01-01T00:00:00Z', reason: 'probe',
    }),
    probe(all('participant.terminate'), 'POST', `/v1/positions/${NOWHERE}/status`, {
      status: 'terminated', effective_from: '2026-01-01T00:00:00Z', reason: 'probe',
    }),
  ],
  'GET /v1/positions/:id/downline': [read(GENEALOGY_READ, `/v1/positions/${NOWHERE}/downline?viewer=${NOWHERE}`)],
  // ORD (PLAN B2 2.6): ingestion takes API keys only, so every session is refused.
  'POST /v1/orders': [probe(nobody, 'POST', '/v1/orders', {})],
  'POST /v1/order-events': [probe(nobody, 'POST', '/v1/order-events', {})],
  'GET /v1/orders': [read(ORDER_READ, '/v1/orders')],
  'GET /v1/orders/summary': [read(ORDER_READ, '/v1/orders/summary')],
  'GET /v1/orders/:id': [read(ORDER_READ, `/v1/orders/${NOWHERE}`)],
  'GET /v1/inbound-events': [read(any('order.read', 'product.manage'), '/v1/inbound-events')],
  'POST /v1/inbound-events/:id/retry': [probe(all('product.manage'), 'POST', `/v1/inbound-events/${NOWHERE}/retry`, {})],
  'GET /v1/product-volumes': [read(any('order.read', 'product.manage'), '/v1/product-volumes')],
  'POST /v1/product-volumes': [probe(all('product.manage'), 'POST', '/v1/product-volumes', {})],
  'GET /v1/late-transactions': [read(LATE, '/v1/late-transactions')],
  'POST /v1/late-transactions/preview': [probe(LATE, 'POST', '/v1/late-transactions/preview', {})],
  'POST /v1/late-transactions/decisions': [probe(LATE, 'POST', '/v1/late-transactions/decisions', {})],
  // INT (PLAN B2 2.6): connectors need integration.manage for all markets; sync health integration.read or .manage.
  'GET /v1/connectors': [read(INTEGRATION, '/v1/connectors')],
  'POST /v1/connectors': [probe(INTEGRATION, 'POST', '/v1/connectors', {})],
  'POST /v1/connectors/:id/rotate-secret': [probe(INTEGRATION, 'POST', `/v1/connectors/${NOWHERE}/rotate-secret`, {})],
  'POST /v1/connectors/:id/withdraw': [probe(INTEGRATION, 'POST', `/v1/connectors/${NOWHERE}/withdraw`, {})],
  'POST /v1/connectors/:id/webhooks': [probe(everyone, 'POST', `/v1/connectors/${NOWHERE}/webhooks`, {})],
  'GET /v1/integrations/health': [read(any('integration.read', 'integration.manage'), '/v1/integrations/health')],
  // PLN (PLAN B3 2.1): draft writes without If-Match answer 428 once past the permission check.
  'GET /v1/plans': [read(PLAN_READ, '/v1/plans')],
  'POST /v1/plans': [probe(PLAN_EDIT, 'POST', '/v1/plans', {})],
  'GET /v1/plans/:id': [read(PLAN_READ, `/v1/plans/${NOWHERE}`)],
  'POST /v1/plans/:id/versions': [probe(PLAN_EDIT, 'POST', `/v1/plans/${NOWHERE}/versions`)],
  'GET /v1/plans/:id/versions/:v': [read(PLAN_READ, VERSION)],
  'PATCH /v1/plans/:id/versions/:v': [probe(PLAN_EDIT, 'PATCH', VERSION, {})],
  'GET /v1/plans/:id/versions/:v/diff': [read(PLAN_READ, `${VERSION}/diff?against=1`)],
  'PUT /v1/plans/:id/versions/:v/rules/:ruleKey': [probe(PLAN_EDIT, 'PUT', `${VERSION}/rules/pv`, {})],
  'DELETE /v1/plans/:id/versions/:v/rules/:ruleKey': [probe(PLAN_EDIT, 'DELETE', `${VERSION}/rules/pv`)],
  'PUT /v1/plans/:id/versions/:v/transitions/:stateItem': [probe(PLAN_EDIT, 'PUT', `${VERSION}/transitions/title.main`, {})],
  'DELETE /v1/plans/:id/versions/:v/transitions/:stateItem': [probe(PLAN_EDIT, 'DELETE', `${VERSION}/transitions/title.main`)],
  'POST /v1/plans/:id/versions/:v/submit': [probe(PLAN_EDIT, 'POST', `${VERSION}/submit`)],
  'POST /v1/plans/:id/versions/:v/decision': [probe(all('plan.approve'), 'POST', `${VERSION}/decision`, {})],
  'POST /v1/plans/:id/versions/:v/schedule': [probe(all('plan.activate'), 'POST', `${VERSION}/schedule`, {})],
  'POST /v1/plans/:id/versions/:v/guardrails/evaluate': [probe(PLAN_EDIT, 'POST', `${VERSION}/guardrails/evaluate`)],
  'POST /v1/plans/:id/versions/:v/guardrail-decisions/:decisionId/acknowledge': [
    probe(PLAN_EDIT, 'POST', `${VERSION}/guardrail-decisions/${NOWHERE}/acknowledge`),
  ],
  'GET /v1/plans/:id/versions/:v/golden-datasets': [read(PLAN_READ, `${VERSION}/golden-datasets`)],
  'GET /v1/plans/:id/versions/:v/golden-datasets/:goldenId': [read(PLAN_READ, `${VERSION}/golden-datasets/${NOWHERE}`)],
  'POST /v1/plans/:id/versions/:v/golden-datasets': [probe(PLAN_EDIT, 'POST', `${VERSION}/golden-datasets`, {})],
  'DELETE /v1/plans/:id/versions/:v/golden-datasets/:goldenId': [probe(PLAN_EDIT, 'DELETE', `${VERSION}/golden-datasets/${NOWHERE}`)],
  'POST /v1/plans/:id/versions/:v/golden-datasets/run': [probe(all('plan.simulate'), 'POST', `${VERSION}/golden-datasets/run`)],
  // CPL guardrail decisions (PLAN B3 2.2)
  'GET /v1/guardrail-decisions': [read(all('guardrail.read'), '/v1/guardrail-decisions')],
  'GET /v1/guardrail-decisions/:id': [read(all('guardrail.read'), `/v1/guardrail-decisions/${NOWHERE}`)],
  'POST /v1/guardrail-decisions/:id/override': [probe(all('override.approve'), 'POST', `/v1/guardrail-decisions/${NOWHERE}/override`, {})],
  // COMP (PLAN B3 2.3, 2.5)
  'GET /v1/periods': [read(all('period.read'), '/v1/periods')],
  'GET /v1/periods/:id': [read(all('period.read'), `/v1/periods/${NOWHERE}`)],
  'POST /v1/periods/:id/runs': [probe(all('run.execute'), 'POST', `/v1/periods/${NOWHERE}/runs`)],
  'GET /v1/runs/:id': [read(any('period.read', 'run.review'), RUN)],
  'GET /v1/runs/:id/review': [read(all('run.review'), `${RUN}/review`)],
  'GET /v1/runs/:id/transitions': [read(all('run.review'), `${RUN}/transitions`)],
  'GET /v1/runs/:id/lines': [read(all('run.review'), `${RUN}/lines`)],
  'POST /v1/runs/:id/request-commit': [probe(all('run.execute'), 'POST', `${RUN}/request-commit`)],
  'POST /v1/runs/:id/commit': [probe(all('run.commit'), 'POST', `${RUN}/commit`, {})],
  'POST /v1/runs/:id/replay': [probe(all('run.execute'), 'POST', `${RUN}/replay`)],
  'GET /v1/result-lines/:id/trace': [read(all('trace.read'), `/v1/result-lines/${NOWHERE}/trace`)],
  'GET /v1/positions/:id/qualification': [read(PARTICIPANT_READ, `/v1/positions/${NOWHERE}/qualification`)],
  'POST /v1/simulations': [probe(all('plan.simulate'), 'POST', '/v1/simulations', {})],
  'GET /v1/simulations': [read(any('plan.simulate', 'plan.read'), '/v1/simulations')],
  'GET /v1/simulations/:id': [read(any('plan.simulate', 'plan.read'), `/v1/simulations/${NOWHERE}`)],
  'GET /v1/simulations/:id/payees': [read(all('plan.simulate'), `/v1/simulations/${NOWHERE}/payees`)],
  'GET /v1/restatements/:id': [read(all('case.restatement.read'), `/v1/restatements/${NOWHERE}`)],
  'GET /v1/restatements/:id/lines': [read(all('case.restatement.read'), `/v1/restatements/${NOWHERE}/lines`)],
  // IAM related parties (D-B4-11): user.manage over all markets.
  'GET /v1/users/:id/related-participants': [read(all('user.manage'), `/v1/users/${NOWHERE}/related-participants`)],
  'POST /v1/users/:id/related-participants': [probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/related-participants`, {})],
  'POST /v1/users/:id/related-participants/:rid/withdraw': [
    probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/related-participants/${NOWHERE}/withdraw`, {}),
  ],
  // LED (PLAN B4 2.1): reads need ledger.read, GL mappings and journal exports ledger.export.
  'GET /v1/ledger/summary': [read(LEDGER_READ, `/v1/ledger/summary?market_id=${NOWHERE}`)],
  'GET /v1/ledger/accounts': [read(LEDGER_READ, '/v1/ledger/accounts')],
  'GET /v1/ledger/accounts/:id/postings': [read(LEDGER_READ, `/v1/ledger/accounts/${NOWHERE}/postings`)],
  'GET /v1/ledger/entries': [read(LEDGER_READ, '/v1/ledger/entries')],
  'GET /v1/ledger/entries/:id': [read(LEDGER_READ, `/v1/ledger/entries/${NOWHERE}`)],
  'GET /v1/payees/:id/balances': [read(LEDGER_READ, `/v1/payees/${NOWHERE}/balances`)],
  'GET /v1/ledger/receivables': [read(LEDGER_READ, '/v1/ledger/receivables')],
  'GET /v1/ledger/gl-mappings': [read(LEDGER_READ, `/v1/ledger/gl-mappings?market_id=${NOWHERE}`)],
  'PUT /v1/ledger/gl-mappings/:marketId/:accountType': [probe(LEDGER_EXPORT, 'PUT', `/v1/ledger/gl-mappings/${NOWHERE}/breakage`, {})],
  'POST /v1/ledger/journal-exports': [probe(LEDGER_EXPORT, 'POST', '/v1/ledger/journal-exports', {})],
  'GET /v1/ledger/journal-exports': [read(LEDGER_EXPORT, '/v1/ledger/journal-exports')],
  'GET /v1/ledger/journal-exports/:id/file': [read(LEDGER_EXPORT, `/v1/ledger/journal-exports/${NOWHERE}/file`)],
  // PAY / TAX (PLAN B4 2.3, D-B4-17)
  'PATCH /v1/provider-configs/:id': [probe(MARKET_MANAGE, 'PATCH', `/v1/provider-configs/${NOWHERE}`, {})],
  'PUT /v1/provider-configs/:id/adapter': [probe(INTEGRATION, 'PUT', `/v1/provider-configs/${NOWHERE}/adapter`, {})],
  'POST /v1/payout-batches': [probe(all('payout.prepare'), 'POST', '/v1/payout-batches', {})],
  'GET /v1/payout-batches': [read(PAYOUT_READ, '/v1/payout-batches')],
  'GET /v1/payout-batches/:id': [read(PAYOUT_READ, BATCH)],
  'GET /v1/payout-batches/:id/lines': [read(PAYOUT_READ, `${BATCH}/lines`)],
  'GET /v1/payout-batches/:id/instructions': [read(PAYOUT_READ, `${BATCH}/instructions`)],
  'POST /v1/payout-batches/:id/submit': [probe(all('payout.prepare'), 'POST', `${BATCH}/submit`)],
  'POST /v1/payout-batches/:id/approve': [probe(all('payout.approve'), 'POST', `${BATCH}/approve`)],
  'POST /v1/payout-batches/:id/retry-failed': [probe(all('payout.approve'), 'POST', `${BATCH}/retry-failed`)],
  'POST /v1/payout-batches/:id/cancel': [probe(any('payout.prepare', 'payout.approve'), 'POST', `${BATCH}/cancel`, {})],
  'POST /v1/payout-batches/:id/bank-file': [probe(all('payout.prepare'), 'POST', `${BATCH}/bank-file`)],
  // A JSON body: 415 once past the permission.
  'POST /v1/payout-providers/:id/settlement-reports': [probe(all('payout.reconcile'), 'POST', `/v1/payout-providers/${NOWHERE}/settlement-reports`, {})],
  'POST /v1/webhooks/providers/:providerConfigId': [probe(everyone, 'POST', `/v1/webhooks/providers/${NOWHERE}`, {})],
  'GET /v1/payout-reconciliation/summary': [read(PAYOUT_READ, '/v1/payout-reconciliation/summary')],
  'GET /v1/payout-reconciliation/items': [read(PAYOUT_READ, '/v1/payout-reconciliation/items')],
  'GET /v1/payout-exceptions': [read(PAYOUT_READ, '/v1/payout-exceptions')],
  'POST /v1/payout-exceptions/:id/resolve': [probe(all('payout.reconcile'), 'POST', `/v1/payout-exceptions/${NOWHERE}/resolve`, {})],
  'GET /v1/payees/:id/holds': [read(any('payout.read', 'participant.read'), `/v1/payees/${NOWHERE}/holds`)],
  'POST /v1/payees/:id/holds': [probe(all('payout.hold'), 'POST', `/v1/payees/${NOWHERE}/holds`, {})],
  'POST /v1/payout-holds/:id/release': [probe(all('payout.hold'), 'POST', `/v1/payout-holds/${NOWHERE}/release`, {})],
  'GET /v1/payouts/dormant': [read(any('payout.read', 'ledger.read'), '/v1/payouts/dormant')],
  'POST /v1/participants/:id/bank-detail-requests': [probe(all('case.bank_detail.create'), 'POST', `/v1/participants/${NOWHERE}/bank-detail-requests`, {})],
  'GET /v1/participants/:id/bank-details': [read(PARTICIPANT_READ, `/v1/participants/${NOWHERE}/bank-details`)],
  'GET /v1/participants/:id/tax-profile': [read(PARTICIPANT_READ, `/v1/participants/${NOWHERE}/tax-profile`)],
  'PUT /v1/participants/:id/tax-profile': [probe(all('tax.manage'), 'PUT', `/v1/participants/${NOWHERE}/tax-profile`, {})],
  'POST /v1/participants/:id/tax-profile/unmask': [probe(all('participant.unmask'), 'POST', `/v1/participants/${NOWHERE}/tax-profile/unmask`)],
  // IAM B5 (PLAN B5 2.1): portal sign-in is public; re-authentication and every /v1/me/** route take portal sessions only.
  'POST /v1/auth/portal-sessions': [probe(everyone, 'POST', '/v1/auth/portal-sessions', {})],
  'POST /v1/auth/portal-codes': [probe(everyone, 'POST', '/v1/auth/portal-codes', {})],
  'POST /v1/auth/portal-firebase-sessions': [probe(everyone, 'POST', '/v1/auth/portal-firebase-sessions', {})],
  'POST /v1/auth/sessions/current/reauth': [probe(nobody, 'POST', '/v1/auth/sessions/current/reauth', {})],
  'GET /v1/participants/:id/portal-account': [read(PARTICIPANT_READ, `/v1/participants/${NOWHERE}/portal-account`)],
  'POST /v1/participants/:id/portal-account': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/portal-account`)],
  'POST /v1/participants/:id/portal-account/invitation': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/portal-account/invitation`)],
  'POST /v1/participants/:id/portal-account/deactivate': [probe(PARTICIPANT_MANAGE, 'POST', `/v1/participants/${NOWHERE}/portal-account/deactivate`, {})],
  'GET /v1/me/statements': [read(nobody, '/v1/me/statements')],
  'GET /v1/me/statements/:runId': [read(nobody, `/v1/me/statements/${NOWHERE}`)],
  'GET /v1/me/statements/:runId/download': [read(nobody, `/v1/me/statements/${NOWHERE}/download`)],
  'GET /v1/me/statement-lines/:id/explanation': [read(nobody, `/v1/me/statement-lines/${NOWHERE}/explanation`)],
  'GET /v1/me/rank': [read(nobody, '/v1/me/rank')],
  'POST /v1/me/disputes': [probe(nobody, 'POST', '/v1/me/disputes', {})],
  'GET /v1/me/disputes': [read(nobody, '/v1/me/disputes')],
  'GET /v1/me/disputes/:id': [read(nobody, `/v1/me/disputes/${NOWHERE}`)],
  'GET /v1/me/team': [read(nobody, '/v1/me/team')],
  'GET /v1/me/customers': [read(nobody, '/v1/me/customers')],
  'GET /v1/me/customers/:id': [read(nobody, `/v1/me/customers/${NOWHERE}`)],
  'GET /v1/me/bank-details': [read(nobody, '/v1/me/bank-details')],
  'PUT /v1/me/bank-details': [probe(nobody, 'PUT', '/v1/me/bank-details', {})],
  'GET /v1/me/tax-profile': [read(nobody, '/v1/me/tax-profile')],
  'PUT /v1/me/tax-profile': [probe(nobody, 'PUT', '/v1/me/tax-profile', {})],
  'GET /v1/me/notifications': [read(nobody, '/v1/me/notifications')],
  'POST /v1/me/notifications/:id/read': [probe(nobody, 'POST', `/v1/me/notifications/${NOWHERE}/read`)],
  'POST /v1/me/notifications/read-all': [probe(nobody, 'POST', '/v1/me/notifications/read-all')],
  'GET /v1/me/notification-preferences': [read(nobody, '/v1/me/notification-preferences')],
  'PUT /v1/me/notification-preferences': [probe(nobody, 'PUT', '/v1/me/notification-preferences', {})],
  'POST /v1/me/privacy-requests': [probe(nobody, 'POST', '/v1/me/privacy-requests', {})],
  'GET /v1/me/privacy-requests': [read(nobody, '/v1/me/privacy-requests')],
  'GET /v1/me/privacy-requests/:id/export': [read(nobody, `/v1/me/privacy-requests/${NOWHERE}/export`)],
  // PRV B5 (PLAN B5 2.6): the public form answers anyone; staff privacy requests need privacy.manage.
  'POST /v1/public/privacy-requests': [probe(everyone, 'POST', '/v1/public/privacy-requests', {})],
  'GET /v1/privacy-requests': [read(all('privacy.manage'), '/v1/privacy-requests')],
  'GET /v1/privacy-requests/:id': [read(all('privacy.manage'), `/v1/privacy-requests/${NOWHERE}`)],
  'GET /v1/privacy-requests/:id/export': [read(all('privacy.manage'), `/v1/privacy-requests/${NOWHERE}/export`)],
  'POST /v1/privacy-requests': [probe(all('privacy.manage'), 'POST', '/v1/privacy-requests', {})],
  'POST /v1/privacy-requests/:id/verify': [probe(all('privacy.manage'), 'POST', `/v1/privacy-requests/${NOWHERE}/verify`, {})],
  'PUT /v1/privacy-requests/:id/corrections': [probe(all('privacy.manage'), 'PUT', `/v1/privacy-requests/${NOWHERE}/corrections`, {})],
  // PLN B6 (PLAN B6 2.1): filings need plan.approve (step-up).
  'GET /v1/plans/:id/versions/:v/governance': [read(PLAN_READ, `${VERSION}/governance`)],
  'POST /v1/plans/:id/versions/:v/filings': [probe(all('plan.approve'), 'POST', `${VERSION}/filings`, {})],
  // COMP / LED B6 (D-B6-04, D-B6-08). The CSV probes send an unknown sort: 400 once past the permission, no export recorded.
  'GET /v1/periods/:id/close-check': [read(all('period.read'), `/v1/periods/${NOWHERE}/close-check`)],
  'POST /v1/periods/:id/close': [probe(all('period.close'), 'POST', `/v1/periods/${NOWHERE}/close`, {})],
  'GET /v1/ledger/entries/export': [read(LEDGER_EXPORT, '/v1/ledger/entries/export?sort=unknown')],
  'GET /v1/orders/export': [read(ORDER_READ, '/v1/orders/export?sort=unknown')],
  // INT B6 (D-B6-06): export.full over every market; creating takes step-up.
  'GET /v1/exports/model': [read(EXPORT_FULL, '/v1/exports/model')],
  'GET /v1/exports/signing-key': [read(EXPORT_FULL, '/v1/exports/signing-key')],
  'POST /v1/exports': [probe(EXPORT_FULL, 'POST', '/v1/exports', { unknown: true })],
  'GET /v1/exports': [read(EXPORT_FULL, '/v1/exports')],
  'GET /v1/exports/:id': [read(EXPORT_FULL, `/v1/exports/${NOWHERE}`)],
  'GET /v1/exports/:id/files/:table': [read(EXPORT_FULL, `/v1/exports/${NOWHERE}/files/participant`)],
  // RPT B6 (PLAN B6 2.4): each dashboard its permission; saved views of a list need that list's read permission.
  'GET /v1/dashboards/executive': [read(all('dashboard.exec'), '/v1/dashboards/executive')],
  'GET /v1/dashboards/finance': [read(LEDGER_READ, `/v1/dashboards/finance?market_id=${NOWHERE}`)],
  'GET /v1/dashboards/compliance': [read(all('compliance.read'), '/v1/dashboards/compliance')],
  'GET /v1/saved-views': [read(ORDER_READ, '/v1/saved-views?list=orders'), read(LEDGER_READ, '/v1/saved-views?list=ledger_entries')],
  'POST /v1/saved-views': [probe(VIEW_USERS, 'POST', '/v1/saved-views', {})],
  'PUT /v1/saved-views/:id': [probe(VIEW_USERS, 'PUT', `/v1/saved-views/${NOWHERE}`, {})],
  'DELETE /v1/saved-views/:id': [probe(VIEW_USERS, 'DELETE', `/v1/saved-views/${NOWHERE}`)],
  // MIG B6 (PLAN B6 2.6): reads need either migration permission; decisions migration.signoff (step-up).
  'POST /v1/migrations': [probe(MIGRATION_MANAGE, 'POST', '/v1/migrations', {})],
  'GET /v1/migrations': [read(MIGRATION_READERS, '/v1/migrations')],
  'GET /v1/migrations/:id': [read(MIGRATION_READERS, MIGRATION)],
  'POST /v1/migrations/:id/apply': [probe(MIGRATION_MANAGE, 'POST', `${MIGRATION}/apply`)],
  'POST /v1/migrations/:id/cancel': [probe(MIGRATION_MANAGE, 'POST', `${MIGRATION}/cancel`, {})],
  'PUT /v1/migrations/:id/opening-balances': [probe(MIGRATION_MANAGE, 'PUT', `${MIGRATION}/opening-balances`, {})],
  'PUT /v1/migrations/:id/opening-state': [probe(MIGRATION_MANAGE, 'PUT', `${MIGRATION}/opening-state`, {})],
  'GET /v1/migrations/:id/opening': [read(MIGRATION_READERS, `${MIGRATION}/opening`)],
  'POST /v1/migrations/:id/opening/submit': [probe(MIGRATION_MANAGE, 'POST', `${MIGRATION}/opening/submit`)],
  'POST /v1/migrations/:id/opening/decision': [probe(MIGRATION_SIGNOFF, 'POST', `${MIGRATION}/opening/decision`, {})],
  'POST /v1/migrations/:id/parallel-runs': [probe(MIGRATION_MANAGE, 'POST', `${MIGRATION}/parallel-runs`, {})],
  'GET /v1/migrations/:id/parallel-runs': [read(MIGRATION_READERS, `${MIGRATION}/parallel-runs`)],
  'GET /v1/migrations/:id/parallel-runs/:runId': [read(MIGRATION_READERS, `${MIGRATION}/parallel-runs/${NOWHERE}`)],
  'GET /v1/migrations/:id/parallel-runs/:runId/differences': [read(MIGRATION_READERS, `${MIGRATION}/parallel-runs/${NOWHERE}/differences`)],
  'POST /v1/migrations/:id/parallel-runs/:runId/differences/:diffId/classify': [probe(MIGRATION_MANAGE, 'POST', `${DIFFERENCE}/classify`, {})],
  'POST /v1/migrations/:id/parallel-runs/:runId/differences/:diffId/accept': [probe(MIGRATION_SIGNOFF, 'POST', `${DIFFERENCE}/accept`, {})],
  'POST /v1/migrations/:id/sign-off': [probe(MIGRATION_SIGNOFF, 'POST', `${MIGRATION}/sign-off`, {})],
  // TAX B-MKT (PLAN B-MKT 2.1, section 3): reads need tax.read (a run's lines also run.review, BUG-131); generation and the filing export tax.forms (step-up).
  'GET /v1/tax/rules': [read(TAX_READ, `/v1/tax/rules?market_id=${NOWHERE}`)],
  'GET /v1/tax/lines': [read(any('tax.read', 'run.review'), `/v1/tax/lines?run_id=${NOWHERE}`)],
  'GET /v1/tax/year-end': [read(TAX_READ, `/v1/tax/year-end?${TAX_YEAR}`)],
  'GET /v1/tax/year-end-generations': [read(TAX_READ, `/v1/tax/year-end-generations?${TAX_YEAR}`)],
  'GET /v1/tax/year-end-forms': [read(TAX_READ, `/v1/tax/year-end-forms?${TAX_YEAR}`)],
  'GET /v1/tax/year-end-forms/:id/download': [read(TAX_READ, `/v1/tax/year-end-forms/${NOWHERE}/download`)],
  'POST /v1/tax/year-end-forms': [probe(TAX_FORMS, 'POST', '/v1/tax/year-end-forms', {})],
  'POST /v1/tax/year-end-forms/export': [probe(TAX_FORMS, 'POST', '/v1/tax/year-end-forms/export', {})],
  'GET /v1/me/tax-forms': [read(nobody, '/v1/me/tax-forms')],
  'GET /v1/me/tax-forms/:id/download': [read(nobody, `/v1/me/tax-forms/${NOWHERE}/download`)],
  // CPL B-MKT (PLAN B-MKT 2.3): the grievance register needs case.grievance.read, the delisted register register.read.
  // The export probes send an unknown filter: 400 once past the permission, no export recorded.
  'GET /v1/registers/grievances': [read(all('case.grievance.read'), '/v1/registers/grievances')],
  'GET /v1/registers/grievances/export': [read(all('case.grievance.read'), '/v1/registers/grievances/export?unknown=1')],
  'GET /v1/registers/delisted': [read(all('register.read'), `/v1/registers/delisted?market_id=${NOWHERE}`)],
  'GET /v1/registers/delisted/export': [read(all('register.read'), '/v1/registers/delisted/export?unknown=1')],
  // IAM B-MKT (PLAN B-MKT 2.5): portal sessions only.
  'PUT /v1/me/locale': [probe(nobody, 'PUT', '/v1/me/locale', {})],
}

/** Fastify's HEAD routes run their GET handler: they take the GET probes with method HEAD. */
function probesOf(route: string): readonly Probe[] | undefined {
  if (!route.startsWith('HEAD ')) return PROBES[route]
  return PROBES[`GET ${route.slice('HEAD '.length)}`]?.map((found) => ({ ...found, request: { ...found.request, method: 'HEAD' } }))
}

// API_KEY_REQUIRED: a key-only route refuses every session (PLAN B2 2.6).
const DENIALS = new Set(['PERMISSION_DENIED', 'REALM_FORBIDDEN', 'API_KEY_REQUIRED'])

function classify(response: LightMyRequestResponse, method: CaseRequest['method']): string {
  if (response.statusCode === 401 || response.statusCode >= 500) return `failed ${response.statusCode}`
  if (response.statusCode !== 403) return 'allowed'
  if (method === 'HEAD') return 'denied' // no body: the GET twin shows the code
  const code = (JSON.parse(response.body) as { error: { code: string } }).error.code
  return DENIALS.has(code) ? 'denied' : `403 ${code}`
}

const label = (found: Probe) => `${found.request.method} ${found.request.url}`

let seeded: Seeded
const users = new Map<BaseRoleName, TestUser>()

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  seeded = await seedTenants(app)
  for (const role of BASE_ROLES) users.set(role.name, await createSignedInUser({ tenantId: seeded.a.id, roles: [role.name], stepUp: true }))
}, SEED_TIMEOUT_MS)

afterAll(async () => {
  await app.close()
  vi.unstubAllEnvs()
  await rm(uploadDir, { recursive: true, force: true })
})

describe('TS-36 role matrix over every route', () => {
  test('every route buildApp() registers has a probe, and every probe a route', () => {
    expect(routes.filter((route) => probesOf(route) === undefined)).toEqual([])
    expect(Object.keys(PROBES).filter((route) => !routes.includes(route))).toEqual([])
  })

  test.each(BASE_ROLES.map((role) => [role.name, role] as const))('%s can do exactly what the catalogue grants', async (name, role) => {
    const held = new Set<Permission>(role.permissions)
    const outcomes: string[] = []
    const expected: string[] = []
    for (const found of routes.flatMap((route) => probesOf(route) ?? [])) {
      const as = found.fresh === true ? await createSignedInUser({ tenantId: seeded.a.id, roles: [name], stepUp: true }) : users.get(name)!
      const response = await call(app, { ...found.request, as })
      outcomes.push(`${label(found)}: ${classify(response, found.request.method)}`)
      expected.push(`${label(found)}: ${found.needs(held) ? 'allowed' : 'denied'}`)
    }

    expect(outcomes).toEqual(expected)
  })
})

describe('SEC-27 / BR-SEC-05: a Tenant admin grants each base role', () => {
  const cases = BASE_ROLES.map((role) => [role.name, role] as const)
  test.each(cases)('%s: at once only if not privileged and held, else a request for a second admin', async (name, role) => {
    const admin = users.get('Tenant admin')!
    const adminHolds = new Set(BASE_ROLES.find((candidate) => candidate.name === 'Tenant admin')!.permissions)
    const grantee = await createSignedInUser({ tenantId: seeded.a.id })
    const immediate = !isPrivileged(role.permissions) && role.permissions.every((permission) => adminHolds.has(permission))

    const response = await call(app, {
      method: 'POST', url: `/v1/users/${grantee.id}/role-assignments`, as: admin, body: { role_id: await baseRoleId(name) }, idempotencyKey: true,
    })
    const assigned = await ownerRows('SELECT id FROM role_assignment WHERE user_id = $1', [grantee.id])

    expect(response.statusCode).toBe(immediate ? 201 : 202)
    expect(assigned).toHaveLength(immediate ? 1 : 0)
  })
})

describe('AC-36.2 / E-SEC-02: a role scoped to another market sees nothing of this one', () => {
  let other: string
  let consultant: TestUser
  let officer: TestUser

  beforeAll(async () => {
    other = await createMarket(seeded.a.id, 'OTHER')
    consultant = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Implementation consultant'], marketIds: [other] })
    officer = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Compliance officer'], marketIds: [other], stepUp: true })
  })

  const status = async (as: TestUser, method: CaseRequest['method'], url: string, body?: unknown) =>
    (await call(app, { method, url, as, ...(body === undefined ? {} : { body }) })).statusCode

  test('imports: the batches of the market are neither listed nor reachable by id', async () => {
    const { batch, rejectedBatch, mapping } = seeded.targets
    const listed = (await call(app, { method: 'GET', url: '/v1/imports?limit=200', as: consultant })).json().data as { id: string }[]
    const ownersView = (await call(app, { method: 'GET', url: '/v1/imports?limit=200', as: seeded.owner })).json().data as { id: string }[]

    expect(ownersView.map((row) => row.id)).toContain(batch)
    expect(listed).toEqual([])
    expect(await status(consultant, 'GET', `/v1/imports/${batch}`)).toBe(404)
    expect(await status(consultant, 'GET', `/v1/imports/${rejectedBatch}/errors`)).toBe(404)
    expect(await status(consultant, 'GET', `/v1/imports/${batch}/source-values`)).toBe(404)
    expect(await status(consultant, 'POST', `/v1/imports/${batch}/mapping`, { mapping_id: mapping })).toBe(404)
    expect(await status(consultant, 'POST', `/v1/imports/${batch}/load`)).toBe(404)
  })

  test('imports: uploading for the market is answered as for a market that does not exist', async () => {
    const uploadFor = async (market: string) => {
      const { payload, contentType } = multipartBody({ market, period_from: '2025-01', period_to: '2025-01' }, tinyFiles())
      const headers = { 'content-type': contentType }
      const response = await call(app, { method: 'POST', url: '/v1/imports', as: consultant, body: payload, headers, idempotencyKey: true })
      return { status: response.statusCode, code: response.json().error?.code }
    }

    expect(await uploadFor(MARKET_CODE)).toEqual({ status: 422, code: 'MARKET_UNKNOWN' })
    expect(await uploadFor('NOWHERE')).toEqual({ status: 422, code: 'MARKET_UNKNOWN' })
  })

  test('compliance: the snapshot is neither listed nor reachable, and none can be requested for the market', async () => {
    const { snapshot, figure } = seeded.targets
    const listed = (await call(app, { method: 'GET', url: '/v1/compliance/snapshots?limit=200', as: officer })).json().data
    const request = (market: string) => call(app, {
      method: 'POST', url: '/v1/compliance/snapshots', as: officer, idempotencyKey: true,
      body: { market, period_from: '2025-01', period_to: '2025-01' },
    })
    const scoped = await request(MARKET_CODE)
    const unknown = await request('NOWHERE')

    expect(listed).toEqual([])
    expect(await status(officer, 'GET', `/v1/compliance/snapshots/${snapshot}`)).toBe(404)
    expect(await status(officer, 'GET', `/v1/compliance/snapshots/${snapshot}/figures/${encodeURIComponent(figure)}/rows`)).toBe(404)
    expect(scoped.statusCode).toBe(422)
    expect(scoped.json().error).toEqual({ ...unknown.json().error, request_id: scoped.json().error.request_id })
  })
})

// BUG-006 / BUG-007 (engineering/BUG_REGISTER.md, fixed): a market-scoped admin neither approves nor removes more
// than its own markets cover.
describe('a Tenant admin scoped to one market against all-markets admins', () => {
  let scopedAdmin: TestUser
  let scopedMarket: string

  beforeAll(async () => {
    scopedMarket = await createMarket(seeded.a.id, 'M2')
    scopedAdmin = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Tenant admin'], marketIds: [scopedMarket], stepUp: true })
  })

  const activeAssignments = (userId: string) =>
    ownerRows('SELECT id FROM role_assignment WHERE user_id = $1 AND (valid_to IS NULL OR valid_to > now())', [userId])
  const requestGrant = async (marketIds: string[] | null) => {
    const grantee = await createSignedInUser({ tenantId: seeded.a.id })
    const requested = await call(app, {
      method: 'POST', url: `/v1/users/${grantee.id}/role-assignments`, as: seeded.owner,
      body: { role_id: await baseRoleId('Tenant admin'), market_ids: marketIds }, idempotencyKey: true,
    })
    return { grantee, requestId: requested.json().data.request.id as string, status: requested.statusCode }
  }
  const approve = (requestId: string) => call(app, {
    method: 'POST', url: `/v1/role-grant-requests/${requestId}/decision`, as: scopedAdmin, body: { decision: 'approved' }, idempotencyKey: true,
  })

  test('cannot approve an all-markets privileged grant (BUG-006)', async () => {
    const { grantee, requestId, status } = await requestGrant(null)

    const decided = await approve(requestId)

    expect(status).toBe(202)
    expect(decided.statusCode).toBe(403)
    expect(decided.json().error.code).toBe('SCOPE_NOT_HELD')
    expect(await activeAssignments(grantee.id)).toEqual([])
  })

  test('approves a privileged grant within its own market (BUG-006 is not a blanket refusal)', async () => {
    const { grantee, requestId } = await requestGrant([scopedMarket])

    const decided = await approve(requestId)

    expect(decided.statusCode).toBe(200)
    expect(await activeAssignments(grantee.id)).toHaveLength(1)
  })

  test('cannot revoke an all-markets admin\'s assignment (BUG-007)', async () => {
    const admin = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Tenant admin'] })
    const [assignment] = await activeAssignments(admin.id)

    const response = await call(app, { method: 'POST', url: `/v1/role-assignments/${(assignment as { id: string }).id}/revoke`, as: scopedAdmin })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('SCOPE_NOT_HELD')
    expect(await activeAssignments(admin.id)).toHaveLength(1)
  })

  test('cannot deactivate an all-markets admin (BUG-007)', async () => {
    const admin = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Tenant admin'] })

    const response = await call(app, { method: 'POST', url: `/v1/users/${admin.id}/deactivate`, as: scopedAdmin })
    const [stored] = await ownerRows<{ state: string }>('SELECT state FROM user_account WHERE id = $1', [admin.id])

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('SCOPE_NOT_HELD')
    expect(stored).toEqual({ state: 'active' })
  })

  test('revokes and deactivates within its own market (BUG-007 is not a blanket refusal)', async () => {
    const local = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Compliance officer', 'Tenant admin'], marketIds: [scopedMarket] })
    const [first] = await activeAssignments(local.id)

    const revoked = await call(app, { method: 'POST', url: `/v1/role-assignments/${(first as { id: string }).id}/revoke`, as: scopedAdmin })
    const deactivated = await call(app, { method: 'POST', url: `/v1/users/${local.id}/deactivate`, as: scopedAdmin })

    expect([revoked.statusCode, deactivated.statusCode]).toEqual([200, 200])
    expect(deactivated.json().data.state).toBe('deactivated')
  })
})
