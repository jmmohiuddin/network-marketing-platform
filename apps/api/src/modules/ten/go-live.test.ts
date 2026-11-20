import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  activePlanVersion, auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { payModule } from '../pay/index.js'
import { assertMarketLive, tenModule } from './index.js'
import { evidenceDocument, fixturePackRule, publishedAgreement } from './test-support.js'

const PACK = 'fixture-screening-pack'
const CONTACTS = [{ name: 'Dana Protect', role: 'DPO', email: 'dpo@acme.example', phone: '+44 20 7946 0000' }]

let app: FastifyInstance
let acme: TestTenant
let market: string
let admin: TestUser
let adminSigner: TestUser
let compliance: TestUser
let staleCompliance: TestUser
let scopedCompliance: TestUser
let admin2: TestUser
let reader: TestUser
let globexAdmin: TestUser
let requestId: string
let paymentProvider: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant({ region: 'eu' })
  const globex = await createTenant()
  const other = await createMarket(acme.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  adminSigner = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Compliance officer'], stepUp: true })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  staleCompliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  scopedCompliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [other], stepUp: true })
  admin2 = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  reader = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin', 'Compliance officer'], stepUp: true })
  await fixturePackRule(PACK, { basisStatus: 'screening', mandatory: true, key: 'fixture-enrolment-only-bonus' })
  await fixturePackRule(PACK, { basisStatus: 'screening', mandatory: false, key: 'fixture-optional' })
  app = await buildTestApp({ modules: [tenModule, payModule] })
  const created = await call(app, {
    method: 'POST', url: '/v1/markets', as: admin, idempotencyKey: true,
    body: { code: 'FR', currency: 'EUR', time_zone: 'Europe/Paris', languages: ['fr'], market_pack: PACK, reason: 'launch' },
  })
  market = created.json().data.id
})

afterAll(async () => {
  await app.close()
})

type Item = { item: string; status: string; entry: unknown; detail: unknown }
const checklist = (as: TestUser = admin, id = market) => call(app, { method: 'GET', url: `/v1/markets/${id}/checklist`, as })
const entry = (as: TestUser, item: string, body: Record<string, unknown>, id = market) =>
  call(app, { method: 'POST', url: `/v1/markets/${id}/checklist/${item}/entries`, as, body, idempotencyKey: true })
const requestGoLive = (as: TestUser = admin, id = market) =>
  call(app, { method: 'POST', url: `/v1/markets/${id}/go-live-requests`, as, body: {}, idempotencyKey: true })
const decide = (as: TestUser, id: string, body: Record<string, unknown>) =>
  call(app, { method: 'POST', url: `/v1/market-go-live-requests/${id}/decision`, as, body: { reason: 'checked', ...body }, idempotencyKey: true })
const recordProvider = async (kind: 'payout' | 'payment', id = market, as: TestUser = admin, provider = `Sandbox ${kind}`) => call(app, {
  method: 'POST', url: '/v1/provider-configs', as, idempotencyKey: true,
  body: {
    market_id: id, kind, provider, approved_description: 'Approved for the market', approved_at: '2026-10-01',
    approval_document_id: await evidenceDocument(acme.id, as.id), funds_holder: 'Sandbox bank',
  },
})
const withdrawProvider = (id: string, as: TestUser = admin) =>
  call(app, { method: 'POST', url: `/v1/provider-configs/${id}/withdraw`, as, body: { reason: 'contract ended' } })
/** Withdraws a provider record behind the API (owner connection), as an out-of-band change would. */
const withdrawOutOfBand = (id: string, by: TestUser) => ownerRows(
  `UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1`, [id, by.id])
const statuses = (items: Item[]) => Object.fromEntries(items.map((item) => [item.item, item.status]))
async function recordBreachContacts(): Promise<void> {
  const etag = (await call(app, { method: 'GET', url: '/v1/settings', as: admin })).headers.etag as string
  const saved = await call(app, { method: 'PUT', url: '/v1/settings/privacy.breach_contacts', as: admin, headers: { 'if-match': etag }, body: { value: CONTACTS, reason: 'DPO' } })
  if (saved.statusCode !== 200) throw new Error(saved.body)
}

describe('checklist and go-live request (AC-38.1, AC-53.1, T-B1-09)', () => {
  test('a new draft market: every item but the pack rules is missing (a draft plan version does not count, T-B3-35)', async () => {
    await ownerRows(
      `WITH plan_row AS (INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, 'FR draft', $3) RETURNING id),
            covered AS (INSERT INTO plan_market (tenant_id, plan_id, market_id) SELECT $1, id, $2 FROM plan_row)
       INSERT INTO plan_version (tenant_id, plan_id, version, engine_version, created_by) SELECT $1, id, 1, 'fixture', $3 FROM plan_row`,
      [acme.id, market, admin.id])
    const view = await checklist()
    const refused = await requestGoLive()

    expect(view.json().data.market).toMatchObject({ id: market, code: 'FR', state: 'draft', market_pack: PACK })
    expect(statuses(view.json().data.items)).toEqual({
      licence_evidence: 'missing', payout_provider: 'missing', payment_provider: 'missing', tax_configuration: 'missing',
      agreement_versions: 'missing', data_region: 'missing', plan_variant: 'missing', breach_contacts: 'missing',
      pack_rules: 'needs_risk_acceptance', migration_parallel_run: 'complete',
    })
    expect(view.json().data.summary).toEqual({ complete: 1, missing: 8, needs_risk_acceptance: 1 })
    expect(view.json().data.items.find((i: Item) => i.item === 'data_region').detail).toEqual({ region: 'eu' })
    expect(view.json().data.items.find((i: Item) => i.item === 'pack_rules').detail.rules).toEqual([
      expect.objectContaining({ id: 'fixture-enrolment-only-bonus@2026-01-01', basis_status: 'screening', mandatory: true, source_ref: expect.any(String) }),
      expect.objectContaining({ id: 'fixture-optional@2026-01-01', mandatory: false }),
    ])
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('CHECKLIST_INCOMPLETE')
    expect(refused.json().error.details.missing).toEqual(expect.arrayContaining([
      { item: 'payout_provider', title: 'Payout provider eligibility', reason: expect.any(String) },
      { item: 'breach_contacts', title: 'Breach notification contacts', reason: expect.any(String) },
    ]))
    expect(refused.json().error.details.missing).toHaveLength(8)
  })

  test('entries: provider and automatic items are not recordable; evidence needs a document, attestation a note', async () => {
    const results = await Promise.all([
      entry(admin, 'payout_provider', { note: 'x' }), entry(admin, 'breach_contacts', { note: 'x' }),
      entry(admin, 'agreement_versions', { document_id: await evidenceDocument(acme.id, admin.id) }), entry(admin, 'plan_variant', { note: 'x' }),
      entry(admin, 'licence_evidence', { note: 'x' }), entry(admin, 'data_region', { document_id: await evidenceDocument(acme.id, admin.id) }),
      entry(admin, 'licence_evidence', { document_id: await evidenceDocument(acme.id, adminSigner.id) }),
      entry(admin, 'no_such_item', { note: 'x' }),
    ])

    expect(results.map((r) => r.statusCode === 404 ? 'NOT_FOUND' : r.json().error.code)).toEqual([
      'ITEM_NOT_RECORDABLE', 'ITEM_NOT_RECORDABLE', 'ITEM_NOT_RECORDABLE', 'ITEM_NOT_RECORDABLE', 'EVIDENCE_REQUIRED', 'NOTE_REQUIRED', 'DOCUMENT_NOT_FOUND', 'NOT_FOUND',
    ])
    expect((await entry(compliance, 'data_region', { note: 'x' })).statusCode).toBe(403)
  })

  test('a complete checklist (screening rules aside) opens one pending request; entries and a second request wait (AC-TEN4-1)', async () => {
    const licence = await entry(adminSigner, 'licence_evidence', { document_id: await evidenceDocument(acme.id, adminSigner.id, 'licence.pdf') })
    await entry(admin, 'tax_configuration', { document_id: await evidenceDocument(acme.id, admin.id) })
    const agreement = await publishedAgreement(acme.id, market, admin.id)
    await entry(admin, 'data_region', { note: 'EU region confirmed' })
    const planVersion = await activePlanVersion(acme.id, market, { submitterId: admin.id, approverId: compliance.id, creditingEvent: 'paid' })
    await recordProvider('payout')
    paymentProvider = (await recordProvider('payment')).json().data.id
    await recordBreachContacts()

    const view = await checklist(compliance)
    const created = await requestGoLive()
    requestId = created.json().data.id
    const blockedEntry = await entry(admin, 'data_region', { note: 'region B' })
    const second = await requestGoLive()

    expect(licence.json().data).toMatchObject({ item: 'licence_evidence', status: 'complete', entry: { document: { file_name: 'licence.pdf', mime: 'application/pdf', size_bytes: 1024 }, recorded_by: { id: adminSigner.id } } })
    expect(view.json().data.summary).toEqual({ complete: 9, missing: 0, needs_risk_acceptance: 1 })
    // T-B2-14: the agreement item is automatic, complete with the market's published version.
    expect(view.json().data.items.find((i: Item) => i.item === 'agreement_versions')).toMatchObject({
      kind: 'automatic', status: 'complete', entry: null, detail: { version: { id: agreement, label: 'v1' } },
    })
    // T-B3-35: the plan item is automatic, complete with the active version of a plan covering the market.
    expect(view.json().data.items.find((i: Item) => i.item === 'plan_variant')).toMatchObject({
      kind: 'automatic', status: 'complete', entry: null, detail: { version: { version_id: planVersion, version: 1, state: 'active' } },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({ market_id: market, state: 'pending', requested_by: { id: admin.id } })
    expect(created.json().data.checklist.items).toHaveLength(10)
    expect(blockedEntry.json().error.code).toBe('GO_LIVE_PENDING')
    expect(second.json().error.code).toBe('GO_LIVE_PENDING')
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['MARKET.CHECKLIST_RECORDED', 'MARKET.GO_LIVE_REQUESTED']))
  })
})

describe('sign-off (AC-TEN4-2/3, AC-CPL12-1, TS-42 go-live part, TS-50)', () => {
  test('eligible signers exclude the requester and every contributor; a contributor is refused SOD-01 and it is audited', async () => {
    const view = await checklist(compliance)
    const refused = await decide(adminSigner, requestId, { decision: 'approve', risk_acceptance: { statement: 'We accept the risk.' } })

    expect(view.json().data.eligible_signers.map((u: { user_id: string }) => u.user_id).sort()).toEqual([compliance.id, staleCompliance.id].sort())
    expect(view.json().data.pending_request.id).toBe(requestId)
    expect(refused.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
    expect(refused.json().error.details.eligible_approvers.map((u: { user_id: string }) => u.user_id)).not.toContain(adminSigner.id)
    expect(await auditActions(acme.id)).toContain('APPROVAL.REFUSED')
  })

  test('step-up, the permission and the market scope are required; another tenant sees 404', async () => {
    expect((await decide(staleCompliance, requestId, { decision: 'approve' })).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await decide(admin2, requestId, { decision: 'approve' })).statusCode).toBe(403)
    expect((await decide(scopedCompliance, requestId, { decision: 'approve' })).statusCode).toBe(404)
    expect((await decide(globexAdmin, requestId, { decision: 'approve' })).statusCode).toBe(404)
    expect((await checklist(globexAdmin)).statusCode).toBe(404)
    expect((await checklist(reader)).statusCode).toBe(403)
  })

  test('mandatory rules at screening need a written risk acceptance (422 RISK_ACCEPTANCE_REQUIRED listing them)', async () => {
    const refused = await decide(compliance, requestId, { decision: 'approve' })

    expect(refused.json().error).toMatchObject({
      code: 'RISK_ACCEPTANCE_REQUIRED',
      details: { rules: [{ id: 'fixture-enrolment-only-bonus@2026-01-01', title: 'FIXTURE rule', basis_status: 'screening' }] },
    })
  })

  test('while a request is pending, provider records and the pack or currency wait (409 GO_LIVE_PENDING)', async () => {
    const recorded = await recordProvider('payment', market, admin, 'Sandbox payment 2')
    const withdrawn = await withdrawProvider(paymentProvider)
    const pack = await call(app, { method: 'PATCH', url: `/v1/markets/${market}`, as: admin, body: { market_pack: 'fixture-empty-pack', reason: 'x' } })
    const currency = await call(app, { method: 'PATCH', url: `/v1/markets/${market}`, as: admin, body: { currency: 'EUR', reason: 'x' } })
    const zone = await call(app, { method: 'PATCH', url: `/v1/markets/${market}`, as: admin, body: { time_zone: 'Europe/Paris', reason: 'x' } })

    expect([recorded, withdrawn, pack, currency].map((r) => [r.statusCode, r.json().error.code])).toEqual(Array(4).fill([409, 'GO_LIVE_PENDING']))
    expect(zone.statusCode).toBe(200)
  })

  test('the checklist is re-evaluated at sign-off: a provider withdrawn behind the API makes it incomplete; the request stays pending', async () => {
    await withdrawOutOfBand(paymentProvider, admin)

    const refused = await decide(compliance, requestId, { decision: 'approve', risk_acceptance: { statement: 'Accepted' } })
    const [row] = await ownerRows<{ state: string }>('SELECT state FROM market_go_live_request WHERE id = $1', [requestId])

    expect(refused.json().error.code).toBe('CHECKLIST_INCOMPLETE')
    expect(refused.json().error.details.missing.map((m: { item: string }) => m.item)).toEqual(['payment_provider'])
    expect(row!.state).toBe('pending')
  })

  test('T-B1-13: a compliance officer signs off with a risk acceptance and its document: the market is live', async () => {
    await call(app, { method: 'POST', url: `/v1/market-go-live-requests/${requestId}/withdraw`, as: admin, body: { reason: 'provider replaced' } })
    await recordProvider('payment')
    requestId = (await requestGoLive()).json().data.id
    const riskDocument = await evidenceDocument(acme.id, compliance.id, 'risk-acceptance.pdf')

    const approved = await decide(compliance, requestId, {
      decision: 'approve', risk_acceptance: { statement: 'The board accepts the screening-basis risk.', document_id: riskDocument },
    })
    const [event] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'MARKET.WENT_LIVE'`, [acme.id])
    const outbox = await ownerRows<{ payload: unknown }>(`SELECT payload FROM outbox_event WHERE tenant_id = $1 AND topic = 'market.went_live'`, [acme.id])
    const [version] = await ownerRows<{ settings: { structure: { markets: { id: string; state: string }[] } } }>(
      'SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1', [acme.id])
    const history = await call(app, { method: 'GET', url: `/v1/markets/${market}/go-live-requests`, as: compliance })

    expect(approved.statusCode).toBe(200)
    expect(approved.json().data.market).toMatchObject({ id: market, state: 'live' })
    expect(approved.json().data.request).toMatchObject({
      state: 'approved', decided_by: { id: compliance.id }, risk_document_id: riskDocument,
      risk_acceptance: { statement: 'The board accepts the screening-basis risk.', accepted_rules: [{ id: 'fixture-enrolment-only-bonus@2026-01-01', basis_status: 'screening' }] },
    })
    expect(JSON.parse(event!.after_ref).after).toMatchObject({ state: 'live', approver: compliance.id, accepted_rules: [{ basis_status: 'screening' }] })
    expect(outbox).toEqual([{ payload: { market_id: market, code: 'FR' } }])
    expect(version!.settings.structure.markets.find((m) => m.id === market)!.state).toBe('live')
    expect(history.json().data[0]).toMatchObject({ id: requestId, state: 'approved' })
    await expect(withTenant({ tenantId: acme.id, userId: admin.id }, (tx) => assertMarketLive(tx, market))).resolves.toBeUndefined()
    expect((await entry(admin, 'data_region', { note: 'late' })).json().error.code).toBe('MARKET_NOT_DRAFT')
    expect((await decide(compliance, requestId, { decision: 'approve' })).json().error.code).toBe('GO_LIVE_NOT_PENDING')
  })
})

describe('withdraw and reject', () => {
  test('only the requester withdraws (decided_by NULL); a rejected request leaves the market draft', async () => {
    const created = await call(app, {
      method: 'POST', url: '/v1/markets', as: admin, idempotencyKey: true,
      body: { code: 'BE', currency: 'EUR', time_zone: 'Europe/Brussels', languages: ['nl', 'fr'], market_pack: 'fixture-empty-pack', reason: 'launch' },
    })
    const be = created.json().data.id as string
    for (const item of ['licence_evidence', 'tax_configuration']) await entry(admin, item, { document_id: await evidenceDocument(acme.id, admin.id) }, be)
    await publishedAgreement(acme.id, be, admin.id)
    await entry(admin, 'data_region', { note: 'confirmed' }, be)
    await activePlanVersion(acme.id, be, { submitterId: admin.id, approverId: compliance.id, creditingEvent: 'paid' })
    await recordProvider('payout', be)
    await recordProvider('payment', be)

    const first = (await requestGoLive(admin, be)).json().data.id as string
    const foreign = await call(app, { method: 'POST', url: `/v1/market-go-live-requests/${first}/withdraw`, as: admin2, body: { reason: 'x' } })
    const withdrawn = await call(app, { method: 'POST', url: `/v1/market-go-live-requests/${first}/withdraw`, as: admin, body: { reason: 'not yet' } })
    const second = (await requestGoLive(admin, be)).json().data.id as string
    const rejected = await decide(compliance, second, { decision: 'reject' })

    expect(foreign.statusCode).toBe(404)
    expect(withdrawn.json().data).toMatchObject({ state: 'withdrawn', decided_by: null, decision_reason: 'not yet' })
    expect(rejected.json().data).toMatchObject({ request: { state: 'rejected', decided_by: { id: compliance.id } }, market: { state: 'draft' } })
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['MARKET.GO_LIVE_WITHDRAWN', 'MARKET.GO_LIVE_REJECTED']))
    expect((await call(app, { method: 'GET', url: `/v1/markets/${be}/go-live-requests`, as: globexAdmin })).statusCode).toBe(404)
  })
})

describe('SoD over the request snapshot (AC-TEN4-2, BR-SEC-06)', () => {
  test('a provider recorder counted by the request stays barred: no withdrawal while pending, still barred once it is gone', async () => {
    const created = await call(app, {
      method: 'POST', url: '/v1/markets', as: admin, idempotencyKey: true,
      body: { code: 'NL', currency: 'EUR', time_zone: 'Europe/Amsterdam', languages: ['nl'], market_pack: 'fixture-empty-pack', reason: 'launch' },
    })
    const nl = created.json().data.id as string
    for (const item of ['licence_evidence', 'tax_configuration']) await entry(admin, item, { document_id: await evidenceDocument(acme.id, admin.id) }, nl)
    await publishedAgreement(acme.id, nl, admin.id)
    await entry(admin, 'data_region', { note: 'confirmed' }, nl)
    await activePlanVersion(acme.id, nl, { submitterId: admin.id, approverId: compliance.id, creditingEvent: 'paid' })
    const signerProvider = (await recordProvider('payout', nl, adminSigner, 'Signer payout')).json().data.id as string
    await recordProvider('payout', nl)
    await recordProvider('payment', nl)
    const request = (await requestGoLive(admin, nl)).json().data.id as string

    const withdrawn = await withdrawProvider(signerProvider, adminSigner)
    await withdrawOutOfBand(signerProvider, adminSigner)
    const view = await checklist(compliance, nl)
    const refused = await decide(adminSigner, request, { decision: 'approve' })

    expect(withdrawn.json().error.code).toBe('GO_LIVE_PENDING')
    expect(view.json().data.summary.missing).toBe(0)
    expect(view.json().data.eligible_signers.map((u: { user_id: string }) => u.user_id)).not.toContain(adminSigner.id)
    expect(refused.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
  })
})

describe('market state guard (AC-TEN4-4, T-B1-11)', () => {
  test('the runtime role cannot set a market live without an approved request, nor insert a live market', async () => {
    const draft = (await call(app, { method: 'GET', url: '/v1/markets', as: admin })).json().data.find((m: { code: string }) => m.code === 'BE').id
    const ctx = { tenantId: acme.id, userId: admin.id }

    await expect(withTenant(ctx, (tx) => tx.query(`UPDATE market SET state = 'live' WHERE id = $1`, [draft]))).rejects.toMatchObject({ code: '42501' })
    await expect(withTenant(ctx, (tx) => tx.query(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES (app_tenant_id(), 'LU', 'EUR', 2, 'Europe/Luxembourg', '{fr}', 'none', 'live')`))).rejects.toMatchObject({ code: '42501' })
  })
})

describe('T-B6-47 checklist item migration_parallel_run (AC-MIG2-4)', () => {
  /** FIXTURE (MIG and IMP write these): a draft market with a loaded migration batch and a migration in `state`. */
  async function marketWithMigration(code: string, state: 'draft' | 'applied'): Promise<{ id: string; migration: string }> {
    const [row] = await ownerRows<{ id: string; migration: string }>(
      `WITH k AS (INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
                  VALUES ($1, $2, 'EUR', 2, 'Europe/Vienna', '{de}', $3, 'draft') RETURNING id),
            c AS (INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
                  SELECT $1, k.id, $2 || ' monthly', 'monthly', 'Europe/Vienna', '2026-01-01' FROM k RETURNING id, market_id),
            p AS (INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
                  SELECT $1, c.id, '2025-12-31T23:00:00Z', '2026-01-31T23:00:00Z' FROM c RETURNING id),
            b AS (INSERT INTO import_batch (tenant_id, market_id, kind, period_from, period_to, state, uploaded_by)
                  SELECT $1, k.id, 'migration', '2026-01-01', '2026-01-31', 'loaded', $4 FROM k RETURNING id)
       INSERT INTO migration (tenant_id, market_id, import_batch_id, cutover_period_id, volume_key, state, applied_counts, applied_at, created_by)
       SELECT $1, k.id, b.id, p.id, 'pv', $5, CASE WHEN $5 = 'applied' THEN '{}'::jsonb END, CASE WHEN $5 = 'applied' THEN now() END, $4
       FROM k, b, p RETURNING market_id AS id, id AS migration`,
      [acme.id, code, PACK, admin.id, state],
    )
    return row!
  }
  const item = async (id: string) => (await checklist(admin, id)).json().data.items.find((i: Item) => i.item === 'migration_parallel_run')

  test('an applied migration leaves the item missing with its reason; a migration cancelled as a draft does not count', async () => {
    const applied = await marketWithMigration('AT', 'applied')
    const cancelled = await marketWithMigration('CH', 'draft')
    const pending = await item(cancelled.id)
    await ownerRows("UPDATE migration SET state = 'cancelled' WHERE id = $1", [cancelled.migration])

    expect(await item(applied.id)).toMatchObject({ kind: 'automatic', category: 'data', status: 'missing', entry: null })
    expect((await requestGoLive(admin, applied.id)).json().error.details.missing).toEqual(expect.arrayContaining([
      { item: 'migration_parallel_run', title: 'Migration parallel run', reason: "The migration's parallel run is not signed off." },
    ]))
    expect(pending.status).toBe('missing')
    expect((await item(cancelled.id)).status).toBe('complete')
  })
})
