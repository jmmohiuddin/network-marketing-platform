// Tenant A with one object of every type, made through the real API (TS-21, TS-36), plus an empty tenant B and a
// vendor user. Tenants, markets and signed-in users are written directly (provisioning has its own tests).
import { randomUUID } from 'node:crypto'
import { withSystem } from '@nmp/db'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { BASE_ROLES, type BaseRoleName } from '../../src/lib/permissions.js'
import { hashPassword } from '../../src/lib/passwords.js'
import type { ApiModule } from '../../src/lib/module.js'
import { uploadDocument } from '../../src/modules/aud/test-support.js'
import { simulationJob } from '../../src/modules/comp/simulations.js'
import {
  activePlan, calculate, commit, createWorld, evidenceDocument, inside, lateItem, member, order, orderEvent, ts10Plan, type World,
} from '../../src/modules/comp/test-support.js'
import { computeSnapshotJob } from '../../src/modules/cpl/index.js'
import { PROTOTYPE_SETTINGS } from '../../src/modules/cpl/test-fixtures.js'
import { rebuildNow } from '../../src/modules/gen/test-support.js'
import { ACCOUNT_TYPES } from '../../src/modules/led/ledger.js'
import { approvedMappingId, TINY_MAPPING, tinyFiles, upload } from '../../src/modules/imp/test-support.js'
import { defaultModules } from '../../src/modules/index.js'
import { apiKey, asKey, committedPeriod } from '../../src/modules/ord/test-support.js'
import { activeType, CUSTOMER, DISTRIBUTOR, enrolled } from '../../src/modules/par/test-support.js'
import { batchDispatchJob, sandboxAdapter } from '../../src/modules/pay/dispatch.js'
import { bankVersion, IBAN, setSettings, WEBHOOK_SECRET, webhook } from '../../src/modules/pay/test-support.js'
import { GOLDEN_EXPECTED, GOLDEN_INPUT, packRules, personal, putRule, revisionOf } from '../../src/modules/pln/test-support.js'
import { supportScopePermission } from '../../src/modules/support/index.js'
import {
  activePlanVersion, baseRoleId, call, createMarket, createPortalUser, createSignedInUser, createTenant, ownerRows, runQueuedJobs, type CallOptions, type TestTenant,
  type TestUser,
} from '../helpers/index.js'

/** seedTenants under full-suite load takes far longer than the default 10 s hook timeout (B1 OI-6). */
export const SEED_TIMEOUT_MS = 120_000
/** Every base role: together they hold the whole permission catalogue. */
export const ALL_ROLES: readonly BaseRoleName[] = BASE_ROLES.map((role) => role.name)
/** What a support session may be granted (support/sessions.ts): the catalogue without the tenant-own decisions. */
export const SUPPORT_SCOPE = supportScopePermission.options
export const PASSWORD = 'Isolation-Test-Pa55'
export const MARKET_CODE = 'TINY'
/** Every module of the product, CAS with the product's case types. */
export const SUITE_MODULES: readonly ApiModule[] = defaultModules
/** Tenant A's draft market (created through the API, launch pending). A valid region code, so tenant B may take it too. */
export const DRAFT_MARKET_CODE = 'DE'
export const PACK = 'isolation-pack'
export const RECORDABLE_ITEM = 'licence_evidence'
/** Tenant A's live market of participants and orders (enrolment names markets by ISO code). */
export const PEOPLE_MARKET_CODE = 'GB'
/** Tenant A's run market (PLAN B3 6): a live market with an active plan, committed runs and a restatement case. */
export const COMP_MARKET_CODE = 'NL'
/** The authoring draft of tenant A's plan (version 1 is active). */
export const DRAFT_VERSION = 2
/** A rule and a transition of the draft. */
export const RULE_KEY = 'pv'
export const STATE_ITEM = 'title.main'
const DISTRIBUTOR_TYPE = 'DIST'
const CUSTOMER_TYPE = 'CUST'
/** B2 settings without an approver (PLAN B2 2.1), values chosen by the suite. */
const B2_SETTINGS = {
  'participants.duplicate_matching': { signals: ['identity_ref'], min_matches: 1, hold_activation: false },
  'customers.reassignment_rule': { rule: 'sponsor', notice_days: 0 },
  'orders.crediting_event': 'paid',
  'orders.attribution_precedence': ['link', 'code', 'servicing'],
  'orders.new_buyer_type': CUSTOMER_TYPE,
}
/** B4 settings without an approver (D-B4-18). */
const B4_SETTINGS = { 'payouts.dormant_after_days': 30 }

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
  /** A genealogy_change case about the child position, with evidence. */
  readonly case: string
  readonly participantType: string
  readonly peopleMarket: string
  readonly peopleMarketCode: string
  /** A distributor with the root position, an agreement acceptance and a duplicate signal. */
  readonly participant: string
  readonly position: string
  readonly positionRef: string
  /** Sponsored and placed under the root position; matched the participant's signal (duplicate case). */
  readonly childPosition: string
  /** An end customer sponsored (and so serviced) by the root position. */
  readonly customer: string
  readonly agreementVersion: string
  readonly duplicateCase: string
  readonly order: string
  readonly heldEvent: string
  readonly lateTransaction: string
  readonly connector: string
  /** B3: the NL plan (version 1 active, version DRAFT_VERSION a draft with a rule, a transition and a golden dataset). */
  readonly plan: string
  readonly activeVersion: string
  readonly golden: string
  /** The draft's guardrail evaluation (starter kit volume, warned). */
  readonly guardrailDecision: string
  readonly compMarket: string
  readonly compCalendar: string
  /** The first committed period, its run, a result line and its payee position (with qualification state). */
  readonly period: string
  readonly run: string
  readonly resultLine: string
  readonly payee: string
  readonly simulation: string
  /** The restatement of the committed period (its case is submitted). */
  readonly restatement: string
  /** B4: the run market's sandbox payout provider, its approved and dispatched batch, an open exception (unknown reference). */
  readonly payoutProvider: string
  readonly payoutBatch: string
  readonly payoutException: string
  /** A payee of the batch with a bank-detail version and request, a tax profile and an active hold. */
  readonly payoutPayee: string
  readonly payoutHold: string
  /** B4 (D-B4-11): the invited user's declared relative, the root participant. */
  readonly relatedParty: string
  /** B4 LED: a ledger account and journal entry of the run market, and a journal export of the first committed period. */
  readonly ledgerAccount: string
  readonly journalEntry: string
  readonly journalExport: string
  /** B5: the payee of resultLine, with a portal account (Seeded.portal), a dispute of that line, an access request, a notification. */
  readonly portalParticipant: string
  readonly portalEmail: string
  readonly dispute: string
  readonly privacyRequest: string
  readonly notification: string
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
  /** The portal session of targets.portalParticipant (step-up fresh). */
  readonly portal: TestUser
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
  const values = { ...PROTOTYPE_SETTINGS, 'privacy.breach_contacts': [BREACH_CONTACT], ...B2_SETTINGS, ...B4_SETTINGS }
  let version = await latestSettingsVersion(owner.tenantId!)
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

/** An agreement version of the market: its document uploaded with class agreement, then published (agreement.publish). */
async function agreementVersion(app: FastifyInstance, owner: TestUser, market: string, acceptanceRequired: boolean): Promise<string> {
  const data = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(randomUUID())])
  const response = await uploadDocument(app, owner, { data, fileName: 'terms.pdf', fields: { class: 'agreement' } })
  const uploaded = expectStatus(response, 201, 'agreement')
  const version = await send(app, 201, 'agreement version', {
    method: 'POST', url: '/v1/agreement-versions', as: owner, idempotencyKey: true,
    body: { market_id: market, label: `Terms ${randomUUID().slice(0, 8)}`, document_id: uploaded.json().data.id, acceptance_required: acceptanceRequired },
  })
  return version.data.id as string
}

/**
 * A complete checklist (evidence, attestations, both providers; the agreement and plan items are automatic, D-B2-15,
 * PLAN B3 2.6) and a pending go-live request for the draft market.
 */
async function seedLaunch(app: FastifyInstance, owner: TestUser, market: string, w: World) {
  const entry = (item: string, body: Record<string, unknown>) => send(app, 201, `entry ${item}`, {
    method: 'POST', url: `/v1/markets/${market}/checklist/${item}/entries`, as: owner, body, idempotencyKey: true,
  })
  const evidence = await document(app, owner)
  await entry(RECORDABLE_ITEM, { document_id: evidence })
  await entry('tax_configuration', { document_id: await document(app, owner) })
  await agreementVersion(app, owner, market, true)
  await coverMarket(w, market)
  await entry('data_region', { note: 'Confirmed for the isolation suite' })
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

/** A genealogy_change case moving the child position's sponsor to another root, with one evidence document. */
async function seedCase(app: FastifyInstance, owner: TestUser, child: string, parent: string): Promise<string> {
  const opened = await send(app, 201, 'case', {
    method: 'POST', url: '/v1/cases', as: owner, idempotencyKey: true,
    body: {
      type: 'genealogy_change', subject_type: 'position', subject_id: child, reason_code: 'PARTICIPANT_REQUEST',
      payload: { kind: 'sponsor', proposed_parent_position_id: parent, effective_from: new Date().toISOString() },
    },
  })
  await send(app, 201, 'case evidence', {
    method: 'POST', url: `/v1/cases/${opened.data.id}/evidence`, as: owner, body: { document_id: await document(app, owner) }, idempotencyKey: true,
  })
  return opened.data.id as string
}

/**
 * PLAN B2 6: active types, a root distributor with an agreement acceptance, a sponsored and placed distributor whose
 * signal matches (a system duplicate case), an end customer serviced by the root, another root, and the path models.
 */
async function seedPeopleAndGenealogy(app: FastifyInstance, a: TestTenant, owner: TestUser, w: World) {
  const approver = await createSignedInUser({ tenantId: a.id, roles: ['Compliance officer'], stepUp: true })
  const peopleMarket = await createMarket(a.id, PEOPLE_MARKET_CODE)
  await coverMarket(w, peopleMarket, 2)
  const participantType = await activeType(app, owner, approver, DISTRIBUTOR_TYPE, DISTRIBUTOR)
  await activeType(app, owner, approver, CUSTOMER_TYPE, CUSTOMER)
  const agreement = await agreementVersion(app, owner, peopleMarket, false)
  const ref = () => `A-${randomUUID().slice(0, 8)}`
  const enrol = (typeCode: string, extra: Record<string, unknown>) => enrolled(app, owner, {
    external_ref: ref(), market: PEOPLE_MARKET_CODE, type_code: typeCode, account_type: 'individual', display_name: 'Canary participant',
    contact: { email: `canary-${randomUUID().slice(0, 8)}@a.example` }, ...extra,
  })
  const signals = { identity_ref: `canary-identity-${randomUUID()}` }
  const root = await enrol(DISTRIBUTOR_TYPE, { position_ref: ref(), signals })
  const rootRef = root.position!.position_ref
  const child = await enrol(DISTRIBUTOR_TYPE, {
    position_ref: ref(), sponsor: { position_ref: rootRef }, placement: { position_ref: rootRef, leg: '1' }, signals,
  })
  const otherRoot = await enrol(DISTRIBUTOR_TYPE, { position_ref: ref() })
  const customer = await enrol(CUSTOMER_TYPE, { sponsor: { position_ref: rootRef } })
  await send(app, 201, 'agreement acceptance', {
    method: 'POST', url: `/v1/participants/${root.participant.id}/agreement-acceptances`, as: owner, idempotencyKey: true,
    body: { agreement_version_id: agreement, accepted_at: new Date().toISOString() },
  })
  if (child.duplicate_case_id === null || customer.servicing === null) throw new Error('seed: no duplicate case or no servicing')
  const genealogyCase = await seedCase(app, owner, child.position!.id, otherRoot.position!.id)
  await rebuildNow()
  return {
    participantType, peopleMarket, peopleMarketCode: PEOPLE_MARKET_CODE, participant: root.participant.id, position: root.position!.id,
    positionRef: rootRef, childPosition: child.position!.id, customer: customer.participant.id, agreementVersion: agreement,
    duplicateCase: child.duplicate_case_id, case: genealogyCase,
  }
}

/**
 * PLAN B2 6: a volume row, a late order (credited into a committed period) with a refund event through an orders:write
 * key, a held order (SKU without volumes), and a connector.
 */
async function seedOrders(app: FastifyInstance, a: TestTenant, owner: TestUser, market: string) {
  await send(app, 201, 'product volumes', {
    method: 'POST', url: '/v1/product-volumes', as: owner, idempotencyKey: true,
    body: { market_id: market, sku: 'CANARY-SKU', item_class: 'product', volumes: { qv: '100' }, valid_from: '2020-01-01T00:00:00Z', reason },
  })
  await committedPeriod(a.id, market, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z')
  const token = await apiKey(app, owner, ['orders:write'])
  const order = (sku: string) => ({
    source_system: 'canary', source_order_id: `o-${randomUUID()}`, market: PEOPLE_MARKET_CODE, buyer: { external_ref: `buyer-${randomUUID()}` },
    ordered_at: '2025-01-15T00:00:00Z', paid_at: '2025-01-15T00:00:00Z', currency: 'GBP', amount_minor: '1000', tax_minor: '0',
    lines: [{ line_no: 1, sku, quantity: 1, amount_minor: '1000' }],
  })
  const ingest = async (url: string, body: Record<string, unknown>, status: number) =>
    expectStatus(await asKey(app, token, url, body), status, `POST ${url}`).json().data
  const late = order('CANARY-SKU')
  const created = await ingest('/v1/orders', late, 201)
  await ingest('/v1/order-events', {
    source_system: 'canary', source_event_id: `e-${randomUUID()}`, source_order_id: late.source_order_id, type: 'refund',
    occurred_at: new Date().toISOString(), refund_minor: '100', fee_minor: '0',
  }, 201)
  const held = await ingest('/v1/orders', order('UNMAPPED-SKU'), 202)
  const [lateTransaction] = await ownerRows<{ id: string }>('SELECT id FROM late_transaction WHERE order_id = $1', [created.order.id])
  const connector = await send(app, 201, 'connector', {
    method: 'POST', url: '/v1/connectors', as: owner, idempotencyKey: true,
    body: { provider: 'shopify', market_id: market, name: 'Canary shop', webhook_secret: `canary-secret-${randomUUID()}` },
  })
  if (lateTransaction === undefined) throw new Error('seed: the order in the committed period is not late')
  return {
    order: created.order.id as string, heldEvent: held.held.inbound_event_id as string, lateTransaction: lateTransaction.id,
    connector: connector.data.connector.id as string,
  }
}

/** A plan covering the market, active since 2000 (D-B3-05 crediting on payment, D-B3-06 placement width), owner pool. */
const coverMarket = (w: World, marketId: string, placementWidth?: number) => activePlanVersion(w.tenantId, marketId, {
  submitterId: w.analyst.id, approverId: w.compliance.id, creditingEvent: 'paid', ...(placementWidth === undefined ? {} : { placementWidth }),
})

/**
 * Before any settings write: the run market with guardrail pack rules, a calendar with two ended periods, the run
 * personas and a settings version from 2020 (runs read the settings in force at the period end).
 */
async function compWorld(tenantId: string): Promise<World> {
  const pack = `isolation-${randomUUID().slice(0, 8)}`
  await packRules(pack)
  return createWorld({ tenantId, past: 2, market: { code: COMP_MARKET_CODE, pack } })
}

/** A restatement case of the committed period, opened, evidenced and submitted (its sandbox makes the restatement). */
async function seedRestatement(app: FastifyInstance, w: World, periodId: string): Promise<string> {
  const as = w.compliance
  const opened = await send(app, 201, 'restatement case', {
    method: 'POST', url: '/v1/cases', as, idempotencyKey: true,
    body: { type: 'restatement', subject_type: 'period', subject_id: periodId, reason_code: 'INPUT_CORRECTION', payload: { note: 'isolation seed' } },
  })
  await send(app, 201, 'restatement evidence', {
    method: 'POST', url: `/v1/cases/${opened.data.id}/evidence`, as, idempotencyKey: true, body: { document_id: await evidenceDocument(as) },
  })
  const submitted = await send(app, 200, 'restatement submit', { method: 'POST', url: `/v1/cases/${opened.data.id}/submit`, as, body: {} })
  return submitted.data.effect_preview.restatement_id as string
}

/** The authoring draft of the plan: a rule (its starter-kit guardrail decision), a transition and a golden dataset. */
async function seedAuthoring(app: FastifyInstance, owner: TestUser, planId: string, calendarId: string) {
  const draft = await send(app, 201, 'plan version', { method: 'POST', url: `/v1/plans/${planId}/versions`, as: owner, body: {}, idempotencyKey: true })
  if (draft.data.version !== DRAFT_VERSION) throw new Error(`seed: the draft is version ${draft.data.version}`)
  const rule = expectStatus(await putRule(app, owner, planId, RULE_KEY, { kind: 'volume.personal', params: personal(RULE_KEY, []) }, DRAFT_VERSION), 200, 'rule')
  const [decision] = rule.json().data.guardrails.new_decisions as { id: string }[]
  const url = `/v1/plans/${planId}/versions/${DRAFT_VERSION}`
  await send(app, 200, 'transition', {
    method: 'PUT', url: `${url}/transitions/${STATE_ITEM}`, as: owner, body: { rule: 'carry' },
    headers: { 'if-match': `"${await revisionOf(app, owner, planId, DRAFT_VERSION)}"` },
  })
  const golden = await send(app, 201, 'golden dataset', {
    method: 'POST', url: `${url}/golden-datasets`, as: owner, idempotencyKey: true,
    body: { name: 'Canary golden', calendar_id: calendarId, covers: [], input: GOLDEN_INPUT, expected: GOLDEN_EXPECTED },
  })
  if (decision === undefined) throw new Error('seed: the rule raised no guardrail decision')
  return { golden: golden.data.id as string, guardrailDecision: decision.id }
}

/**
 * PLAN B3 6: an active plan on the run market, two committed runs (the second pays an adjustment origin for a refund of
 * the first period), a simulation with lines, a submitted restatement case and the plan's authoring draft.
 */
async function seedCompensation(app: FastifyInstance, w: World, owner: TestUser) {
  const first = w.periods[0]!
  const second = w.periods[1]!
  const sponsor = await member(w, 'NL-SPONSOR')
  const payee = await member(w, 'NL-PAYEE', sponsor)
  const plan = await activePlan(w, ts10Plan(), first.starts_at)
  await order(w, payee, inside(first), 30_000)
  const refunded = await order(w, payee, inside(first, 2), 50_000)
  const run = await calculate(app, w, first.id)
  await commit(app, w, run)
  await lateItem(w, { eventId: await orderEvent(w, refunded, inside(second)) }, first.id)
  await commit(app, w, await calculate(app, w, second.id))
  const simulation = await send(app, 202, 'simulation', {
    method: 'POST', url: '/v1/simulations', as: owner, body: { plan_version_id: plan.versionId, period_id: first.id }, idempotencyKey: true,
  })
  await runQueuedJobs(simulationJob)
  const [line] = await ownerRows<{ id: string }>('SELECT id FROM result_line WHERE run_id = $1 ORDER BY id LIMIT 1', [run])
  return {
    plan: plan.planId, activeVersion: plan.versionId, ...(await seedAuthoring(app, owner, plan.planId, w.calendarId)),
    compMarket: w.marketId, compCalendar: w.calendarId, period: first.id, run, resultLine: line!.id, payee: payee.positionId,
    simulation: simulation.data.id as string, restatement: await seedRestatement(app, w, first.id),
  }
}

/**
 * PLAN B4 6: payout settings of the run market (approved versions in force now: an API change request cannot be dated
 * before its approval), bank details for its payees, a sandbox payout provider, a batch prepared
 * and submitted by the owner, approved by a Finance approver and dispatched, an exception (an event for an unknown
 * reference), and on a paid payee a hold, a tax profile and a bank-detail request.
 */
async function seedPayouts(app: FastifyInstance, a: TestTenant, owner: TestUser, w: World) {
  const tenantId = a.id
  const finance = await createSignedInUser({ tenantId, roles: ['Finance approver'], stepUp: true })
  await setSettings({ tenant: a, admin: owner, finance }, {
    'payouts.market_policy': { [w.marketId]: { minimum_payout_minor: '1', tax_profile_required: false } },
    'payouts.bank_detail_cooling_off_hours': 0,
  })
  for (const { id } of await ownerRows<{ id: string }>('SELECT id FROM participant WHERE market_id = $1', [w.marketId])) await bankVersion(tenantId, id)
  const provider = await send(app, 201, 'payout provider', {
    method: 'POST', url: '/v1/provider-configs', as: owner, idempotencyKey: true,
    body: {
      market_id: w.marketId, kind: 'payout', provider: 'Sandbox payouts', approved_description: 'Approved for the run market', approved_at: '2026-10-01',
      approval_document_id: await document(app, owner), funds_holder: 'Sandbox bank',
    },
  })
  const providerId = provider.data.id as string
  await send(app, 200, 'adapter', {
    method: 'PUT', url: `/v1/provider-configs/${providerId}/adapter`, as: owner, body: { adapter: 'sandbox', webhook_secret: WEBHOOK_SECRET },
  })
  const batch = await send(app, 201, 'payout batch', {
    method: 'POST', url: '/v1/payout-batches', as: owner, body: { market_id: w.marketId, provider_config_id: providerId }, idempotencyKey: true,
  })
  const batchId = batch.data.id as string
  await send(app, 200, 'batch submit', { method: 'POST', url: `/v1/payout-batches/${batchId}/submit`, as: owner, body: {}, idempotencyKey: true })
  await send(app, 200, 'batch approve', { method: 'POST', url: `/v1/payout-batches/${batchId}/approve`, as: finance, body: {}, idempotencyKey: true })
  await runQueuedJobs(batchDispatchJob({ adapter: sandboxAdapter }))
  expectStatus(await webhook(app, providerId, { type: 'payout.settled', provider_ref: 'canary-unknown', amount_minor: '1', currency: 'EUR' }), 200, 'webhook')
  const [exception] = await ownerRows<{ id: string }>('SELECT id FROM payout_exception WHERE provider_config_id = $1', [providerId])
  const [line] = await ownerRows<{ participant_id: string }>('SELECT participant_id FROM payout_batch_line WHERE batch_id = $1 LIMIT 1', [batchId])
  if (exception === undefined || line === undefined) throw new Error('seed: the payout batch has no line or the webhook made no exception')
  const payee = line.participant_id
  const hold = await send(app, 201, 'hold', {
    method: 'POST', url: `/v1/payees/${payee}/holds`, as: owner, body: { market_id: w.marketId, reason }, idempotencyKey: true,
  })
  await send(app, 200, 'tax profile', {
    method: 'PUT', url: `/v1/participants/${payee}/tax-profile`, as: owner, body: { residency: 'NL', tax_id: 'NL123456789B01' }, idempotencyKey: true,
  })
  await send(app, 201, 'bank-detail request', {
    method: 'POST', url: `/v1/participants/${payee}/bank-detail-requests`, as: owner,
    body: { scheme: 'iban', account_holder: 'Canary Holder', iban: IBAN }, idempotencyKey: true,
  })
  return { payoutProvider: providerId, payoutBatch: batchId, payoutException: exception.id, payoutPayee: payee, payoutHold: hold.data.id as string }
}

/** PLAN B4 6 (LED): every account type of the run market mapped to a GL code, and the first period exported. */
async function seedLedger(app: FastifyInstance, owner: TestUser, marketId: string, periodId: string) {
  for (const type of ACCOUNT_TYPES) {
    await send(app, 200, `gl mapping ${type}`, { method: 'PUT', url: `/v1/ledger/gl-mappings/${marketId}/${type}`, as: owner, body: { gl_code: `GL-${type}` } })
  }
  const exported = await send(app, 201, 'journal export', {
    method: 'POST', url: '/v1/ledger/journal-exports', as: owner, body: { period_id: periodId }, idempotencyKey: true,
  })
  const [entry] = await ownerRows<{ id: string; account_id: string }>(
    'SELECT e.id, x.account_id FROM journal_entry e JOIN posting x ON x.entry_id = e.id WHERE e.market_id = $1 LIMIT 1', [marketId],
  )
  if (entry === undefined) throw new Error('seed: the run market has no journal entry')
  return { ledgerAccount: entry.account_id, journalEntry: entry.id, journalExport: exported.data.id as string }
}

async function latestSettingsVersion(tenantId: string): Promise<number> {
  const [row] = await ownerRows<{ version: number }>('SELECT max(version) AS version FROM tenant_setting_version WHERE tenant_id = $1', [tenantId])
  return row!.version
}

/** PLAN B5: a portal account for the line's payee, who disputes the line and asks for their data; the run's commit notified them. */
async function seedPortal(app: FastifyInstance, tenantId: string, lineId: string) {
  const [payee] = await ownerRows<{ id: string }>('SELECT payee_participant_id AS id FROM result_line WHERE id = $1', [lineId])
  const portal = await createPortalUser({ tenantId, participantId: payee!.id, stepUp: true })
  const dispute = await send(app, 201, 'dispute', {
    method: 'POST', url: '/v1/me/disputes', as: portal, body: { line_id: lineId, message: 'isolation' }, idempotencyKey: true,
  })
  const request = await send(app, 201, 'privacy request', {
    method: 'POST', url: '/v1/me/privacy-requests', as: portal, body: { type: 'access' }, idempotencyKey: true,
  })
  const [notification] = await ownerRows<{ id: string }>(
    `SELECT id FROM notification WHERE recipient_participant_id = $1 AND channel = 'in_app' ORDER BY id LIMIT 1`, [payee!.id])
  if (notification === undefined) throw new Error('seed: the committed run notified no portal participant')
  return {
    portal, portalParticipant: payee!.id, portalEmail: portal.email, dispute: dispute.data.case_id as string,
    privacyRequest: request.data.id as string, notification: notification.id,
  }
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
  const world = await compWorld(a.id)
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
  const launch = await seedLaunch(app, owner, structure.draftMarket, world)
  const integrations = await seedIntegrations(app, owner)
  const genealogy = await seedPeopleAndGenealogy(app, a, owner, world)
  const orders = await seedOrders(app, a, owner, genealogy.peopleMarket)
  const compensation = await seedCompensation(app, world, owner)
  const payouts = await seedPayouts(app, a, owner, world)
  const ledger = await seedLedger(app, owner, world.marketId, compensation.period)
  const related = await send(app, 201, 'related party', {
    method: 'POST', url: `/v1/users/${people.user}/related-participants`, as: owner, idempotencyKey: true,
    body: { participant_id: genealogy.participant, relation: 'relative' },
  })
  const freeDocument = await document(app, owner)
  const { portal, ...portalTargets } = await seedPortal(app, a.id, compensation.resultLine)
  const targets: Targets = {
    tenant: a.id, email: owner.email, ...people, ...imports, ...snapshot, export: exported.data.id as string, supportSession,
    market: MARKET_CODE, ...structure, changeRequest, ...launch, ...integrations, ...genealogy, ...orders, ...compensation, ...payouts, ...ledger,
    relatedParty: related.data.id as string, freeDocument, ...portalTargets,
    settingsVersion: await latestSettingsVersion(a.id), otherSlug: b.slug,
  }
  return { a, b, owner, consultant, vendor, portal, targets }
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
    case: id(), participantType: id(), peopleMarket: id(), peopleMarketCode: 'XQ', participant: id(), position: id(),
    positionRef: `phantom-${id()}`, childPosition: id(), customer: id(), agreementVersion: id(), duplicateCase: id(), order: id(),
    heldEvent: id(), lateTransaction: id(), connector: id(), plan: id(), activeVersion: id(), golden: id(), guardrailDecision: id(),
    compMarket: id(), compCalendar: id(), period: id(), run: id(), resultLine: id(), payee: id(), simulation: id(), restatement: id(),
    payoutProvider: id(), payoutBatch: id(), payoutException: id(), payoutPayee: id(), payoutHold: id(), relatedParty: id(),
    ledgerAccount: id(), journalEntry: id(), journalExport: id(), portalParticipant: id(), portalEmail: `nobody-${id()}@nowhere.example`,
    dispute: id(), privacyRequest: id(), notification: id(),
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
