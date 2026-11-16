import { createHash, randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { payModule, recordedProviders } from './index.js'

/** FIXTURE (owner pool): an evidence document uploaded by `userId`, as AUD's POST /v1/documents stores it. */
async function evidenceDocument(tenantId: string, userId: string, fileName = 'approval.pdf'): Promise<string> {
  const id = randomUUID()
  await ownerRows(
    `INSERT INTO document (id, tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, created_by, file_name)
     VALUES ($1, $2, 'evidence', $3, $4, 'application/pdf', 1024, $5, 1, $5, $6)`,
    [id, tenantId, `documents/${id}`, createHash('sha256').update(id).digest(), userId, fileName],
  )
  return id
}

let app: FastifyInstance
let acme: TestTenant
let gb: string
let in_: string
let admin: TestUser
let scopedAdmin: TestUser
let signer: TestUser
let reader: TestUser
let globexAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  in_ = await createMarket(acme.id, 'IN')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  scopedAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [in_] })
  signer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [gb] })
  reader = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  app = await buildTestApp({ modules: [payModule] })
})

afterAll(async () => {
  await app.close()
})

const body = (marketId: string, documentId: string, extra: Record<string, unknown> = {}) => ({
  market_id: marketId, kind: 'payout', provider: 'Sandbox Payouts Ltd', approved_description: 'E-money licence, payouts to local accounts',
  approval_document_id: documentId, approved_at: '2026-10-01', funds_holder: 'Sandbox Payouts Ltd (safeguarded account)', ...extra,
})
const record = (as: TestUser, payload: Record<string, unknown>) =>
  call(app, { method: 'POST', url: '/v1/provider-configs', as, body: payload, idempotencyKey: true })
const withdraw = (as: TestUser, id: string) =>
  call(app, { method: 'POST', url: `/v1/provider-configs/${id}/withdraw`, as, body: { reason: 'contract ended' } })

describe('POST /v1/provider-configs (D-B1-12)', () => {
  test('records an eligibility with the caller\'s evidence document; duplicates are 409; the facade lists it', async () => {
    const created = await record(admin, body(gb, await evidenceDocument(acme.id, admin.id, 'approval.pdf')))
    const duplicate = await record(admin, body(gb, await evidenceDocument(acme.id, admin.id)))
    const facade = await withTenant({ tenantId: acme.id, userId: admin.id }, (tx) => recordedProviders(tx, gb))

    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({
      market_id: gb, kind: 'payout', state: 'recorded', approved_at: '2026-10-01', approval_document: { file_name: 'approval.pdf' },
      created_by: { id: admin.id },
    })
    expect(duplicate.json().error.code).toBe('PROVIDER_ALREADY_RECORDED')
    expect(facade).toEqual([{ id: created.json().data.id, kind: 'payout', provider: 'Sandbox Payouts Ltd', approvedAt: '2026-10-01', fundsHolder: expect.any(String), createdBy: admin.id }])
    expect(await auditActions(acme.id)).toContain('PROVIDER.ELIGIBILITY_RECORDED')
  })

  test('someone else\'s document, an unknown or already referenced one is 422 DOCUMENT_NOT_FOUND (D-B1-04)', async () => {
    const othersDocument = await evidenceDocument(acme.id, scopedAdmin.id)
    const used = await evidenceDocument(acme.id, admin.id)
    await record(admin, body(gb, used, { kind: 'payment' }))

    const responses = await Promise.all([othersDocument, randomUUID(), used].map((documentId) =>
      record(admin, body(gb, documentId, { provider: `Other ${documentId}` }))))

    expect(responses.map((response) => response.json().error.code)).toEqual(Array(3).fill('DOCUMENT_NOT_FOUND'))
  })

  test('a future approval date, a market out of scope or another tenant\'s market are refused', async () => {
    const future = await record(admin, body(gb, await evidenceDocument(acme.id, admin.id), { approved_at: '2999-01-01', provider: 'F' }))
    const outOfScope = await record(scopedAdmin, body(gb, await evidenceDocument(acme.id, scopedAdmin.id), { provider: 'S' }))
    const foreign = await record(globexAdmin, body(gb, randomUUID(), { provider: 'G' }))

    expect(future.json().error.details.issues[0].path).toBe('approved_at')
    expect(outOfScope.json().error.details.issues[0].path).toBe('market_id')
    expect(foreign.json().error.details.issues[0].path).toBe('market_id')
    expect((await record(signer, body(gb, randomUUID()))).statusCode).toBe(403)
  })
})

describe('GET /v1/provider-configs and withdraw', () => {
  test('signers read the records of their markets; withdrawing twice is 409; another tenant sees nothing', async () => {
    const created = await record(scopedAdmin, body(in_, await evidenceDocument(acme.id, scopedAdmin.id), { provider: 'India Payouts' }))
    const id = created.json().data.id as string

    const signerList = await call(app, { method: 'GET', url: '/v1/provider-configs', as: signer })
    const filtered = await call(app, { method: 'GET', url: `/v1/provider-configs?market_id=${in_}&kind=payout`, as: admin })
    const foreignWithdraw = await withdraw(globexAdmin, id)
    const outOfScope = await withdraw(scopedAdmin, signerList.json().data[0].id)
    const withdrawn = await withdraw(scopedAdmin, id)
    const again = await withdraw(scopedAdmin, id)

    expect(signerList.json().data.every((row: { market_id: string }) => row.market_id === gb)).toBe(true)
    expect(filtered.json().data.map((row: { id: string }) => row.id)).toEqual([id])
    expect(foreignWithdraw.statusCode).toBe(404)
    expect(outOfScope.statusCode).toBe(404)
    expect(withdrawn.json().data).toMatchObject({ state: 'withdrawn', withdrawn_at: expect.any(String) })
    expect(again.json().error.code).toBe('PROVIDER_NOT_RECORDED')
    expect((await call(app, { method: 'GET', url: '/v1/provider-configs', as: globexAdmin })).json().data).toEqual([])
    expect((await call(app, { method: 'GET', url: '/v1/provider-configs', as: reader })).statusCode).toBe(403)
    expect(await auditActions(acme.id)).toContain('PROVIDER.ELIGIBILITY_WITHDRAWN')
  })
})
