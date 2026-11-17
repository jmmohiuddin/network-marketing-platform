import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { z } from 'zod'
import { createCasModule, type CaseTypeDefinition } from '../cas/index.js'
import { contentDisposition, sanitiseFileName } from './evidence-file.js'
import { audModule } from './index.js'
import { uploadDocument } from './test-support.js'

// PLAN B1 section 2.8, D-B1-04: evidence documents, uploaded once and read through the objects that reference them.
const PDF = Buffer.from('%PDF-1.7\n%test evidence\n')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

// TEST FIXTURE ONLY (D-B1-13): a registered case type, so its create permission (import.manage) may upload evidence and
// its read permission (compliance.read) reads case evidence. Cases of it are inserted through the owner pool.
const caseType: CaseTypeDefinition = {
  type: 'adjustment', subjectTypes: [], reasonCodes: [], evidenceRequired: false, payload: z.unknown(),
  permissions: { read: 'compliance.read', create: 'import.manage', decide: 'mapping.approve' },
  resolveSubject: async () => null,
}

let app: FastifyInstance
let uploadDir: string
let acme: TestTenant
let gb: string
let admin: TestUser
let admin2: TestUser
let adminMy: TestUser
let compliance: TestUser
let analyst: TestUser
let analystMy: TestUser
let consultant: TestUser
let support: TestUser
let globexAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  uploadDir = await mkdtemp(join(tmpdir(), 'nmp-aud-'))
  process.env.UPLOAD_DIR = uploadDir
  acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  const my = await createMarket(acme.id, 'MY')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  admin2 = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  adminMy = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [my] })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  analystMy = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [my] })
  consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  app = await buildTestApp({ modules: [createCasModule({ types: [caseType] }), audModule] })
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const upload = async (as: TestUser, options: Parameters<typeof uploadDocument>[2] = {}) => {
  const response = await uploadDocument(app, as, options)
  expect(response.statusCode).toBe(201)
  return response.json().data.id as string
}

describe('GET /v1/documents/limits', () => {
  test('evidence uploaders see the size limit and the accepted types', async () => {
    for (const uploader of [admin, compliance, consultant]) {
      const response = await get(uploader, '/v1/documents/limits')
      expect(response.statusCode).toBe(200)
      expect(response.json().data).toEqual({ max_file_bytes: 10_485_760, types: ['application/pdf', 'image/png', 'image/jpeg'] })
    }
    expect((await get(analyst, '/v1/documents/limits')).statusCode).toBe(403)
    expect((await get(support, '/v1/documents/limits')).statusCode).toBe(403)
  })
})

describe('POST /v1/documents', () => {
  test('stores the file once (0600) with its digest, sanitised name and audit; a replay stores nothing', async () => {
    const key = randomUUID()
    const first = await uploadDocument(app, admin, { data: PDF, fileName: '..\\..\\Lic‮ence 2025.pdf', idempotencyKey: key })
    const replay = await uploadDocument(app, admin, { data: PDF, fileName: '..\\..\\Lic‮ence 2025.pdf', idempotencyKey: key })
    const document = first.json().data

    expect(first.statusCode).toBe(201)
    expect(document).toMatchObject({
      file_name: 'Licence 2025.pdf', mime: 'application/pdf', size_bytes: PDF.length,
      sha256: createHash('sha256').update(PDF).digest('hex'), uploaded_by: admin.id,
    })
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.json().data.id).toBe(document.id)
    expect(await ownerRows('SELECT class, storage_key, version FROM document WHERE tenant_id = $1 AND uploaded_by = $2', [acme.id, admin.id]))
      .toEqual([{ class: 'evidence', storage_key: `documents/${document.id}`, version: 1 }])
    const file = await stat(join(uploadDir, acme.id, 'documents', document.id))
    expect(file.mode & 0o777).toBe(0o600)
    expect(file.size).toBe(PDF.length)
    expect(await auditActions(acme.id)).toContain('DOCUMENT.UPLOADED')
  })

  test('the type comes from the content, never from the client', async () => {
    const jpeg = await uploadDocument(app, compliance, { data: JPEG, fileName: 'photo.pdf' })
    const text = await uploadDocument(app, compliance, { data: Buffer.from('not a picture'), fileName: 'evil.png' })

    expect(jpeg.json().data.mime).toBe('image/jpeg')
    expect(text.statusCode).toBe(415)
    expect(text.json().error.code).toBe('FILE_TYPE_NOT_ALLOWED')
  })

  test('a form sent with no file chosen (empty name, no bytes) is a missing file', async () => {
    const empty = await uploadDocument(app, compliance, { data: Buffer.alloc(0), fileName: '' })

    expect(empty.statusCode).toBe(400)
    expect(empty.json().error.code).toBe('FILE_MISSING')
  })

  test('refuses a missing file, another class, a non-multipart body and an oversized file', async () => {
    const small = await buildTestApp({ modules: [audModule], env: { EVIDENCE_MAX_FILE_BYTES: '16' } })
    try {
      const tooLarge = await uploadDocument(small, admin, { data: Buffer.concat([PDF, Buffer.alloc(32)]) })
      expect(tooLarge.statusCode).toBe(413)
      expect(tooLarge.json().error).toMatchObject({ code: 'FILE_TOO_LARGE', details: { max_bytes: 16 } })
    } finally {
      await small.close()
    }
    const boundary = 'nmp-empty'
    const noFile = await call(app, {
      method: 'POST', url: '/v1/documents', as: admin, idempotencyKey: true, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="class"\r\n\r\nevidence\r\n--${boundary}--\r\n`),
    })
    const wrongClass = await uploadDocument(app, admin, { fields: { class: 'tax_form' } })
    const json = await call(app, { method: 'POST', url: '/v1/documents', as: admin, idempotencyKey: true, body: { class: 'evidence' } })

    expect(noFile.statusCode).toBe(400)
    expect(noFile.json().error.code).toBe('FILE_MISSING')
    expect(wrongClass.statusCode).toBe(400)
    expect(json.statusCode).toBe(415)
  })

  test('class agreement: only agreement.publish holders upload; the version that references it lets its readers download (PLAN B2 2.2)', async () => {
    const byAdmin = await uploadDocument(app, admin, { data: PDF, fields: { class: 'agreement' } })
    const uploaded = await uploadDocument(app, compliance, { data: PDF, fileName: 'terms.pdf', fields: { class: 'agreement' } })
    const id = uploaded.json().data.id as string
    const before = await call(app, { method: 'GET', url: `/v1/documents/${id}`, as: support })
    await ownerRows(
      `INSERT INTO agreement_version (tenant_id, market_id, label, document_id, acceptance_required, published_by)
       VALUES ($1, $2, 'v-doc', $3, true, $4)`,
      [acme.id, gb, id, compliance.id],
    )
    const asSupport = await call(app, { method: 'GET', url: `/v1/documents/${id}/content`, as: support })
    const asAnalyst = await call(app, { method: 'GET', url: `/v1/documents/${id}`, as: analyst })
    const asOtherMarket = await call(app, { method: 'GET', url: `/v1/documents/${id}`, as: adminMy })

    expect(byAdmin.statusCode).toBe(403)
    expect(uploaded.statusCode).toBe(201)
    expect((await ownerRows('SELECT class FROM document WHERE id = $1', [id]))[0]).toEqual({ class: 'agreement' })
    expect(before.statusCode).toBe(404)
    expect(asSupport.statusCode).toBe(200)
    expect(asSupport.rawPayload.equals(PDF)).toBe(true)
    expect(asAnalyst.statusCode).toBe(200)
    expect(asOtherMarket.statusCode).toBe(404)
  })

  test('needs market.manage, market.signoff or a registered case type\'s create permission', async () => {
    expect((await uploadDocument(app, analyst)).statusCode).toBe(403)
    expect((await uploadDocument(app, support)).statusCode).toBe(403)
    expect((await uploadDocument(app, consultant)).statusCode).toBe(201)
    // An app without CAS has no case types, although another app in this process mounted one.
    const withoutCases = await buildTestApp({ modules: [audModule] })
    try {
      expect((await uploadDocument(withoutCases, admin)).statusCode).toBe(201)
      expect((await uploadDocument(withoutCases, consultant)).statusCode).toBe(403)
    } finally {
      await withoutCases.close()
    }
  })
})

describe('reading documents', () => {
  test('the uploader downloads the exact bytes as an attachment, audited; nobody else reads an unreferenced document', async () => {
    const id = await upload(admin, { data: PDF, fileName: 'Bank letter €.pdf' })
    const metadata = await get(admin, `/v1/documents/${id}`)
    const content = await get(admin, `/v1/documents/${id}/content`)

    expect(metadata.json().data).toMatchObject({ id, file_name: 'Bank letter €.pdf', mime: 'application/pdf' })
    expect(content.statusCode).toBe(200)
    expect(content.rawPayload.equals(PDF)).toBe(true)
    expect(content.headers['content-type']).toBe('application/pdf')
    expect(content.headers['x-content-type-options']).toBe('nosniff')
    expect(content.headers['content-disposition']).toBe(`attachment; filename="Bank letter _.pdf"; filename*=UTF-8''Bank%20letter%20%E2%82%AC.pdf`)
    expect(await ownerRows("SELECT actor_id FROM audit.audit_event WHERE action = 'DOCUMENT.DOWNLOADED' AND object_id = $1", [id]))
      .toEqual([{ actor_id: admin.id }])
    for (const reader of [admin2, compliance, globexAdmin]) {
      expect((await get(reader, `/v1/documents/${id}`)).statusCode).toBe(404)
      expect((await get(reader, `/v1/documents/${id}/content`)).statusCode).toBe(404)
    }
    expect((await get(admin, `/v1/documents/${randomUUID()}`)).statusCode).toBe(404)
  })

  test('case evidence is readable by readers of the case, within their market scope', async () => {
    const id = await upload(admin)
    const [opened] = await ownerRows<{ id: string }>(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by)
       VALUES ($1, 'adjustment', 'fixture', $2, 'fixture', 'open', '{}', $2, $3) RETURNING id`, [acme.id, gb, admin.id])
    await ownerRows('INSERT INTO case_evidence (tenant_id, case_id, document_id, added_by) VALUES ($1, $2, $3, $4)', [acme.id, opened!.id, id, admin.id])

    expect((await get(analyst, `/v1/documents/${id}/content`)).statusCode).toBe(200)
    for (const reader of [analystMy, support, globexAdmin]) {
      expect((await get(reader, `/v1/documents/${id}`)).statusCode).toBe(404)
    }
    const withoutCases = await buildTestApp({ modules: [audModule] })
    try {
      expect((await call(withoutCases, { method: 'GET', url: `/v1/documents/${id}/content`, as: analyst })).statusCode).toBe(404)
    } finally {
      await withoutCases.close()
    }
  })

  test('market documents are readable with market.manage or market.signoff over the market', async () => {
    const id = await upload(compliance)
    await ownerRows(
      `INSERT INTO market_checklist_entry (tenant_id, market_id, item, document_id, recorded_by) VALUES ($1, $2, 'licence_evidence', $3, $4)`,
      [acme.id, gb, id, compliance.id],
    )

    expect((await get(admin, `/v1/documents/${id}`)).statusCode).toBe(200)
    for (const reader of [adminMy, analyst, globexAdmin]) {
      expect((await get(reader, `/v1/documents/${id}`)).statusCode).toBe(404)
    }
  })

  test('a tenant-wide provider record\'s document is readable only by unscoped market readers, as PAY lists it', async () => {
    const id = await upload(admin)
    await ownerRows(
      `INSERT INTO provider_config (tenant_id, market_id, kind, provider, approved_description, approval_document_id, approved_at,
         funds_holder, state, created_by)
       VALUES ($1, NULL, 'payout', 'sandbox', 'Licensed payout institution', $2, current_date, 'Sandbox bank', 'recorded', $3)`,
      [acme.id, id, admin.id],
    )

    expect((await get(admin2, `/v1/documents/${id}`)).statusCode).toBe(200)
    expect((await get(adminMy, `/v1/documents/${id}`)).statusCode).toBe(404)
  })
})

describe('file names and headers', () => {
  test('sanitising keeps the last segment without control or format characters, and never returns an empty name', () => {
    expect(sanitiseFileName('a/b\\c\u0000d‎.png')).toBe('cd.png')
    expect(sanitiseFileName('   ')).toBe('document')
    expect(sanitiseFileName(undefined)).toBe('document')
    expect([...sanitiseFileName('x'.repeat(300))]).toHaveLength(200)
    expect(contentDisposition(`it's (1)*.pdf`)).toBe(`attachment; filename="it's (1)*.pdf"; filename*=UTF-8''it%27s%20%281%29%2A.pdf`)
  })
})
