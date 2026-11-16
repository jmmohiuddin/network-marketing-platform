// Tenant A with one object of every type, made through the real API (TS-21, TS-36), plus an empty tenant B and a
// vendor user. Tenants, markets and signed-in users are written directly (provisioning has its own tests).
import { randomUUID } from 'node:crypto'
import { withSystem } from '@nmp/db'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { BASE_ROLES, type BaseRoleName } from '../../src/lib/permissions.js'
import { hashPassword } from '../../src/lib/passwords.js'
import type { ApiModule } from '../../src/lib/module.js'
import { uploadDocument } from '../../src/modules/aud/test-support.js'
import { fixtureCasModule, openFixtureCase } from '../../src/modules/cas/test-support.js'
import { computeSnapshotJob } from '../../src/modules/cpl/index.js'
import { PROTOTYPE_SETTINGS } from '../../src/modules/cpl/test-fixtures.js'
import { approvedMappingId, TINY_MAPPING, tinyFiles, upload } from '../../src/modules/imp/test-support.js'
import { defaultModules } from '../../src/modules/index.js'
import { supportScopePermission } from '../../src/modules/support/index.js'
import {
  baseRoleId, call, createMarket, createSignedInUser, createTenant, ownerRows, runQueuedJobs, type CallOptions, type TestTenant,
  type TestUser,
} from '../helpers/index.js'

/** Every base role: together they hold the whole permission catalogue. */
export const ALL_ROLES: readonly BaseRoleName[] = BASE_ROLES.map((role) => role.name)
/** What a support session may be granted (support/sessions.ts): the catalogue without the tenant-own decisions. */
export const SUPPORT_SCOPE = supportScopePermission.options
export const PASSWORD = 'Isolation-Test-Pa55'
export const MARKET_CODE = 'TINY'
/** Every module of the product plus CAS with its fixture type (D-B1-13: no production case type in B1). */
export const SUITE_MODULES: readonly ApiModule[] = [...defaultModules, fixtureCasModule()]
/** Tenant A's draft market (created through the API, launch pending). A valid region code, so tenant B may take it too. */
export const DRAFT_MARKET_CODE = 'DE'
export const PACK = 'isolation-pack'
export const RECORDABLE_ITEM = 'licence_evidence'

/** Tenant A's objects, by the names the route cases use. */
export interface Targets {
  readonly tenant: string
  readonly user: string
  /** The owner's email: it signs in to tenant A with PASSWORD. */
  readonly email: string
  readonly role: string
  readonly roleName: string
  readonly assignment: string
  readonly grantRequest: string
  readonly export: string
  readonly supportSession: string
  readonly batch: string
  readonly rejectedBatch: string
  readonly mapping: string
  readonly snapshot: string
  readonly figure: string
  readonly market: string
  readonly draftMarket: string
  readonly brand: string
  readonly brandName: string
  readonly calendar: string
  /** Tenant A's latest settings version number. */
  readonly settingsVersion: number
  readonly changeRequest: string
  readonly providerConfig: string
  readonly goLiveRequest: string
  readonly serviceAccount: string
  readonly serviceAccountName: string
  readonly apiKey: string
  readonly webhookEndpoint: string
  readonly webhookDelivery: string
  /** Referenced by a checklist entry: readable by tenant A's market managers. */
  readonly document: string
  /** Uploaded by the owner and referenced by nothing: free to reference. */
  readonly freeDocument: string
  readonly case: string
  /** Tenant B's slug: tenant A's credentials are tried against it. */
  readonly otherSlug: string
}

export interface Seeded {
  readonly a: TestTenant
  readonly b: TestTenant
  /** Holds every base role (all permissions), MFA verified, step-up fresh, password PASSWORD. */
  readonly owner: TestUser
  readonly consultant: TestUser
  /** Requested and holds tenant A's approved support session; work region eu, as tenant A. */
  readonly vendor: TestUser
  readonly targets: Targets
}

/** Tenant A's breach-notification contact (a canary: only tenant A's admins and vendor operations may read it). */
export const BREACH_CONTACT = { name: 'Canary Contact', role: 'DPO', email: 'canary.contact@a.example', phone: '+44 20 7946 0000' }

function expectStatus(response: LightMyRequestResponse, status: number, what: string): LightMyRequestResponse {
  if (response.statusCode !== status) throw new Error(`seed: ${what} returned ${response.statusCode}: ${response.body}`)
  return response
}

async function send(app: FastifyInstance, status: number, what: string, options: CallOptions) {
  return expectStatus(await call(app, options), status, what).json()
}

async function saveSettings(app: FastifyInstance, owner: TestUser): Promise<void> {
  const values = { ...PROTOTYPE_SETTINGS, 'privacy.breach_contacts': [BREACH_CONTACT] }
  let version = 0
  for (const [key, value] of Object.entries(values)) {
    const headers = { 'if-match': `"${version}"` }
    await send(app, 200, `PUT ${key}`, { method: 'PUT', url: `/v1/settings/${key}`, as: owner, body: { value, reason: 'isolation seed' }, headers })
    version += 1
  }
}

async function seedPeople(app: FastifyInstance, owner: TestUser) {
  const invited = await send(app, 201, 'invite', {
    method: 'POST', url: '/v1/users', as: owner, body: { email: `invitee-${randomUUID().slice(0, 8)}@a.example` }, idempotencyKey: true,
  })
  const role = await send(app, 201, 'role', {
    method: 'POST', url: '/v1/roles', as: owner, body: { name: `Canary role ${randomUUID().slice(0, 8)}`, permissions: ['compliance.read'] },
    idempotencyKey: true,
  })
  const grant = (roleId: string, status: number) => send(app, status, 'grant', {
    method: 'POST', url: `/v1/users/${invited.data.user.id}/role-assignments`, as: owner, body: { role_id: roleId }, idempotencyKey: true,
  })
  const assignment = await grant(role.data.id, 201)
  const request = await grant(await baseRoleId('Tenant admin'), 202)
  return {
    user: invited.data.user.id as string, role: role.data.id as string,
    roleName: role.data.name as string, assignment: assignment.data.assignment.id as string, grantRequest: request.data.request.id as string,
  }
}

async function seedImports(app: FastifyInstance, owner: TestUser, consultant: TestUser) {
  const mapping = await approvedMappingId(app, consultant, owner, TINY_MAPPING)
  const period = { market: MARKET_CODE, from: '2025-01', to: '2025-01' }
  const batch = expectStatus(await upload(app, consultant, { ...period, files: tinyFiles() }), 201, 'upload').json().data.id as string
  const forbidden = 'participant_id,type,enrolled_month,sponsor_id,email\nD1,dist,2025-01,,d1@a.example\n'
  const rejected = expectStatus(await upload(app, consultant, { ...period, files: tinyFiles({ participants: forbidden }) }), 201, 'upload')
  await send(app, 200, 'attach', { method: 'POST', url: `/v1/imports/${batch}/mapping`, as: consultant, body: { mapping_id: mapping } })
  await send(app, 200, 'load', { method: 'POST', url: `/v1/imports/${batch}/load`, as: consultant })
  return { mapping, batch, rejectedBatch: rejected.json().data.id as string }
}

async function seedSnapshot(app: FastifyInstance, owner: TestUser) {
  const body = { market: MARKET_CODE, period_from: '2025-01', period_to: '2025-01' }
  const created = await send(app, 202, 'snapshot', { method: 'POST', url: '/v1/compliance/snapshots', as: owner, body, idempotencyKey: true })
  await runQueuedJobs(computeSnapshotJob)
  const snapshot = await send(app, 200, 'read snapshot', { method: 'GET', url: `/v1/compliance/snapshots/${created.data.id}`, as: owner })
  const figures = (snapshot.data.results as { figures: { id: string; rows: string | null }[] }[]).flatMap((period) => period.figures)
  const figure = figures.find((candidate) => candidate.rows !== null)
  if (snapshot.data.state !== 'ready' || figure === undefined) throw new Error(`seed: snapshot not ready with figures: ${JSON.stringify(snapshot)}`)
  return { snapshot: created.data.id as string, figure: figure.id }
}

async function seedSupportSession(app: FastifyInstance, tenantId: string, owner: TestUser, vendor: TestUser): Promise<string> {
  const body = { tenant: tenantId, reason: 'Isolation suite', scope: { permissions: SUPPORT_SCOPE }, minutes: 60 }
  const filed = await send(app, 201, 'support request', { method: 'POST', url: '/v1/support-sessions', as: vendor, body, idempotencyKey: true })
  await send(app, 200, 'support decision', {
    method: 'POST', url: `/v1/support-sessions/${filed.data.id}/decision`, as: owner, body: { approved: true, minutes: 60 }, idempotencyKey: true,
  })
  return filed.data.id as string
}

const reason = 'isolation seed'

/** An evidence document of the owner through POST /v1/documents (distinct bytes: one upload per reference). */
async function document(app: FastifyInstance, owner: TestUser): Promise<string> {
  const data = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())])
  return expectStatus(await uploadDocument(app, owner, { data }), 201, 'document').json().data.id as string
}

async function seedStructure(app: FastifyInstance, owner: TestUser) {
  const create = (url: string, body: Record<string, unknown>) =>
    send(app, 201, `POST ${url}`, { method: 'POST', url, as: owner, body: { ...body, reason }, idempotencyKey: true })
  const market = await create('/v1/markets', {
    code: DRAFT_MARKET_CODE, currency: 'EUR', time_zone: 'Europe/Berlin', languages: ['de'], market_pack: PACK,
  })
  const brandName = `Canary brand ${randomUUID().slice(0, 8)}`
  const brand = await create('/v1/brands', { name: brandName })
  const calendar = await create('/v1/calendars', {
    market_id: market.data.id, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', first_period_start: '2026-01-01',
    periods_ahead: 3,
  })
  return { draftMarket: market.data.id as string, brand: brand.data.id as string, brandName, calendar: calendar.data.calendar.id as string }
}

async function seedChangeRequest(app: FastifyInstance, owner: TestUser): Promise<string> {
  const current = await call(app, { method: 'GET', url: '/v1/settings', as: owner })
  const created = await send(app, 202, 'money change request', {
    method: 'PUT', url: '/v1/settings/money.rounding_mode', as: owner, headers: { 'if-match': current.headers.etag as string },
    body: { value: 'half_even', reason, effective_from: '2099-01-01T00:00:00Z' },
  })
  return created.data.change_request.id as string
}

/** A complete checklist (evidence, attestations, both providers) and a pending go-live request for the draft market. */
async function seedLaunch(app: FastifyInstance, owner: TestUser, market: string) {
  const entry = (item: string, body: Record<string, unknown>) => send(app, 201, `entry ${item}`, {
    method: 'POST', url: `/v1/markets/${market}/checklist/${item}/entries`, as: owner, body, idempotencyKey: true,
  })
  const evidence = await document(app, owner)
  await entry(RECORDABLE_ITEM, { document_id: evidence })
  for (const item of ['tax_configuration', 'agreement_versions']) await entry(item, { document_id: await document(app, owner) })
  for (const item of ['data_region', 'plan_variant']) await entry(item, { note: 'Confirmed for the isolation suite' })
  const provider = async (kind: 'payout' | 'payment') => send(app, 201, `provider ${kind}`, {
    method: 'POST', url: '/v1/provider-configs', as: owner, idempotencyKey: true,
    body: {
      market_id: market, kind, provider: `Sandbox ${kind}`, approved_description: 'Approved for the market', approved_at: '2026-10-01',
      approval_document_id: await document(app, owner), funds_holder: 'Sandbox bank',
    },
  })
  const payout = await provider('payout')
  await provider('payment')
  const request = await send(app, 201, 'go-live request', {
    method: 'POST', url: `/v1/markets/${market}/go-live-requests`, as: owner, body: {}, idempotencyKey: true,
  })
  return { document: evidence, providerConfig: payout.data.id as string, goLiveRequest: request.data.id as string }
}

async function seedIntegrations(app: FastifyInstance, owner: TestUser) {
  const serviceAccountName = `Canary account ${randomUUID().slice(0, 8)}`
  const account = await send(app, 201, 'service account', {
    method: 'POST', url: '/v1/service-accounts', as: owner, body: { name: serviceAccountName, purpose: 'Isolation suite' }, idempotencyKey: true,
  })
  const key = await send(app, 201, 'api key', {
    method: 'POST', url: `/v1/service-accounts/${account.data.id}/keys`, as: owner, idempotencyKey: true,
    body: { name: 'Primary', scopes: ['compliance:read'], rate_tier: 'standard' },
  })
  const endpoint = await send(app, 201, 'webhook endpoint', {
    method: 'POST', url: '/v1/webhook-endpoints', as: owner, body: { url: 'https://hooks.example.com/isolation', topics: ['market.went_live'] },
    idempotencyKey: true,
  })
  const sent = await send(app, 202, 'webhook test', {
    method: 'POST', url: `/v1/webhook-endpoints/${endpoint.data.endpoint.id}/test`, as: owner, body: {}, idempotencyKey: true,
  })
  // The dispatcher's fan-out step only: the delivery stays scheduled, nothing is sent.
  await withSystem((tx) => tx.query('SELECT webhook_fan_out($1)', [sent.data.event_id]))
  const [delivery] = await ownerRows<{ id: string }>('SELECT id FROM webhook_delivery WHERE endpoint_id = $1', [endpoint.data.endpoint.id])
  return {
    serviceAccount: account.data.id as string, serviceAccountName, apiKey: key.data.key.id as string,
    webhookEndpoint: endpoint.data.endpoint.id as string, webhookDelivery: delivery!.id,
  }
}

/** A fixture-type case about the draft market with one evidence document. */
async function seedCase(app: FastifyInstance, owner: TestUser, market: string): Promise<string> {
  const opened = expectStatus(await openFixtureCase(app, owner, market), 201, 'case').json().data.id as string
  await send(app, 201, 'case evidence', {
    method: 'POST', url: `/v1/cases/${opened}/evidence`, as: owner, body: { document_id: await document(app, owner) }, idempotencyKey: true,
  })
  return opened
}

async function latestSettingsVersion(tenantId: string): Promise<number> {
  const [row] = await ownerRows<{ version: number }>('SELECT max(version) AS version FROM tenant_setting_version WHERE tenant_id = $1', [tenantId])
  return row!.version
}

/** Seeds tenant A through the API; the database must have been reset (resetApiDb) and the app built with every module. */
export async function seedTenants(app: FastifyInstance): Promise<Seeded> {
  const a = await createTenant()
  const b = await createTenant()
  const market = await createMarket(a.id, MARKET_CODE)
  const owner = await createSignedInUser({ tenantId: a.id, roles: ALL_ROLES, stepUp: true, passwordHash: await hashPassword(PASSWORD) })
  const consultant = await createSignedInUser({ tenantId: a.id, roles: ['Implementation consultant'] })
  const vendor = await createSignedInUser({ tenantId: null })
  await ownerRows(`UPDATE user_account SET work_region = 'eu' WHERE id = $1`, [vendor.id])
  await saveSettings(app, owner)
  const people = await seedPeople(app, owner)
  const imports = await seedImports(app, owner, consultant)
  const snapshot = await seedSnapshot(app, owner)
  const exported = await send(app, 201, 'audit export', {
    method: 'POST', url: '/v1/audit-exports', as: owner, body: { filters: {} }, idempotencyKey: true,
  })
  const supportSession = await seedSupportSession(app, a.id, owner, vendor)
  const structure = await seedStructure(app, owner)
  const changeRequest = await seedChangeRequest(app, owner)
  const launch = await seedLaunch(app, owner, structure.draftMarket)
  const integrations = await seedIntegrations(app, owner)
  const fixtureCase = await seedCase(app, owner, structure.draftMarket)
  const freeDocument = await document(app, owner)
  const targets: Targets = {
    tenant: a.id, email: owner.email, ...people, ...imports, ...snapshot, export: exported.data.id as string, supportSession,
    market: MARKET_CODE, ...structure, changeRequest, ...launch, ...integrations, case: fixtureCase, freeDocument,
    settingsVersion: await latestSettingsVersion(a.id), otherSlug: b.slug,
  }
  return { a, b, owner, consultant, vendor, targets }
}

/** The same targets with every id, email, name and market replaced by one that exists nowhere (existence probe). */
export function phantomOf(targets: Targets): Targets {
  const id = () => randomUUID()
  return {
    ...targets, tenant: id(), user: id(), email: `nobody-${id()}@nowhere.example`, role: id(), roleName: `Phantom ${id()}`,
    assignment: id(), grantRequest: id(), export: id(), supportSession: id(), batch: id(), rejectedBatch: id(), mapping: id(),
    snapshot: id(), market: 'PHANTOM', draftMarket: id(), brand: id(), brandName: `Phantom ${id()}`, calendar: id(),
    settingsVersion: 2_000_000_000, changeRequest: id(), providerConfig: id(), goLiveRequest: id(), serviceAccount: id(),
    serviceAccountName: `Phantom ${id()}`, apiKey: id(), webhookEndpoint: id(), webhookDelivery: id(), document: id(), freeDocument: id(),
    case: id(),
  }
}

/** Every id of every row the tenant owns (tables with tenant_id and id), the tenant's id, slug and user emails. */
export async function canariesOf(tenant: TestTenant): Promise<ReadonlyMap<string, readonly string[]>> {
  const tables = await ownerRows<{ name: string }>(
    `SELECT format('%I.%I', table_schema, table_name) AS name FROM information_schema.columns
     WHERE column_name = 'tenant_id' AND table_schema IN ('public', 'audit')
     INTERSECT
     SELECT format('%I.%I', table_schema, table_name) FROM information_schema.columns WHERE column_name = 'id'
     ORDER BY 1`,
  )
  const found = new Map<string, readonly string[]>([['tenant', [tenant.id, tenant.slug]]])
  for (const { name } of tables) {
    // Identifiers come from the catalogue, quoted by format('%I').
    const rows = await ownerRows<{ id: string }>(`SELECT id::text AS id FROM ${name} WHERE tenant_id = $1`, [tenant.id])
    found.set(name, rows.map((row) => row.id))
  }
  const emails = await ownerRows<{ email: string }>('SELECT email FROM user_account WHERE tenant_id = $1', [tenant.id])
  found.set('emails', emails.map((row) => row.email))
  return found
}

/** A digest of every row the tenant owns in the given schemas, per table, and of its tenant row. */
export async function fingerprintOf(tenantId: string, schemas: readonly string[]): Promise<Record<string, string>> {
  const tables = await ownerRows<{ name: string }>(
    `SELECT format('%I.%I', c.table_schema, c.table_name) AS name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_schema = ANY ($1::text[]) ORDER BY 1`,
    [schemas],
  )
  const digests: Record<string, string> = {}
  for (const { name } of [{ name: 'public.tenant' }, ...tables]) {
    const column = name === 'public.tenant' ? 'id' : 'tenant_id'
    const [row] = await ownerRows<{ digest: string }>(
      `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS digest FROM ${name} x WHERE ${column} = $1`,
      [tenantId],
    )
    digests[name] = row!.digest
  }
  return digests
}
