// Test fixtures for the IMP module's tests (multipart uploads, the synthetic dataset, a matching mapping).
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { call, ownerRows, type Caller } from '../../../test/helpers/index.js'
import type { Mappings } from './mappings.js'
import { IMPORT_FILES, type ImportFile } from './vocabulary.js'

const SYNTHETIC_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)), '../../../../../engineering/reference/phase_a/prototype/data_synthetic',
)

export type CsvFiles = Record<ImportFile, Buffer | string>

/** The prototype's synthetic export (synth.py seed 20261111): 1,466 participants, 4,775 orders, 7,442 lines. */
export function syntheticFiles(): Record<ImportFile, Buffer> {
  return Object.fromEntries(IMPORT_FILES.map((file) => [file, readFileSync(join(SYNTHETIC_DIR, `${file}.csv`))])) as Record<ImportFile, Buffer>
}

/** The prototype config as a mapping: customer and preferred_customer are end customers, distributor earns. */
export const SYNTHETIC_MAPPING: Mappings = {
  participant_types: {
    customer: { counts_as_end_customer: true, can_earn: false },
    preferred_customer: { counts_as_end_customer: true, can_earn: false },
    distributor: { counts_as_end_customer: false, can_earn: true },
  },
  purposes: { customer: 'customer', personal: 'personal', resale: 'resale', enrolment: 'enrolment', unknown: 'unknown' },
  source_kinds: {
    retail_sale: 'retail_sale', downline_volume: 'downline_volume', enrolment_order: 'enrolment_order', pool: 'pool',
    clawback: 'clawback',
  },
  starter_kits: {},
}

export const ORDERS_HEADER = 'order_id,month,day,buyer_id,amount_cents,volume_cents,purpose,is_starter_kit,refunded_cents,refund_month'
export const LINES_HEADER = 'line_id,month,payee_id,bonus_type,source_kind,source_order_id,amount_cents'

/** A two-participant export for 2025-01 that passes validation (partner codes 'dist' and 'cust'). */
export function tinyFiles(overrides: Partial<CsvFiles> = {}): CsvFiles {
  return {
    participants: 'participant_id,type,enrolled_month,sponsor_id\nD1,dist,2025-01,\nC1,cust,2025-01,D1\n',
    orders: `${ORDERS_HEADER}\nO1,2025-01,5,C1,10000,9000,cust_order,0,0,\nO2,2025-01,28,D1,4000,4000,own,1,4000,2025-02\n`,
    payout_lines: `${LINES_HEADER}\nL1,2025-01,D1,retail,retail,O1,2500\nL2,2025-01,D1,pool,leader_pool,,700\n`,
    ...overrides,
  }
}

export const TINY_MAPPING: Mappings = {
  participant_types: { dist: { counts_as_end_customer: false, can_earn: true }, cust: { counts_as_end_customer: true, can_earn: false } },
  purposes: { cust_order: 'customer' },
  source_kinds: { retail: 'retail_sale' },
  starter_kits: {},
}

export function multipartBody(fields: Record<string, string>, files: Partial<CsvFiles>, type = 'text/csv') {
  const boundary = `nmp-${randomUUID()}`
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  for (const [name, data] of Object.entries(files)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.csv"\r\nContent-Type: ${type}\r\n\r\n`))
    chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data ?? ''), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

export interface UploadOptions {
  readonly market?: string
  readonly from?: string
  readonly to?: string
  readonly files?: Partial<CsvFiles>
  readonly fields?: Record<string, string>
  readonly idempotencyKey?: string
  readonly type?: string
}

/** POST /v1/imports as a browser would send it (defaults: market DEMO, 2025-01..2025-12, synthetic files). */
export function upload(app: FastifyInstance, as: Caller, options: UploadOptions = {}): Promise<LightMyRequestResponse> {
  const fields = options.fields ?? { market: options.market ?? 'DEMO', period_from: options.from ?? '2025-01', period_to: options.to ?? '2025-12' }
  const { payload, contentType } = multipartBody(fields, options.files ?? syntheticFiles(), options.type)
  return call(app, {
    method: 'POST', url: '/v1/imports', as, body: payload, headers: { 'content-type': contentType },
    idempotencyKey: options.idempotencyKey ?? true,
  })
}

/** AC-53.1 precondition of a load: a settings version with one breach-notification contact. */
export async function recordBreachContact(tenantId: string, userId: string): Promise<void> {
  const contacts = [{ name: 'Dana Protect', role: 'DPO', email: 'dpo@acme.example', phone: '+44 20 7946 0000' }]
  await ownerRows(
    `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
     VALUES ($1, 1, now() - interval '1 minute', $2, 'test', $3)`,
    [tenantId, { 'privacy.breach_contacts': contacts }, userId],
  )
}

/** Creates and approves a mapping version (author and approver must differ) and returns its id. */
export async function approvedMappingId(app: FastifyInstance, author: Caller, approver: Caller, mappings: Mappings): Promise<string> {
  const latest = (await call(app, { method: 'GET', url: '/v1/import-mappings', as: author })).headers.etag as string
  const created = await call(app, { method: 'PUT', url: '/v1/import-mappings', as: author, body: { mappings }, headers: { 'if-match': latest } })
  const id = created.json().data.id as string
  const approved = await call(app, { method: 'POST', url: `/v1/import-mappings/${id}/approve`, as: approver })
  if (approved.statusCode !== 200) throw new Error(`approval failed: ${approved.body}`)
  return id
}
