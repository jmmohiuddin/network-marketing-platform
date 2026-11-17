// Test helpers for PAR and CRM tests: types through the API (propose + approve), settings through the owner pool (labelled
// fixtures: no plan or compliance value is shipped, DEC-14), enrolments and API keys through the API.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { expect } from 'vitest'
import { call, ownerRows, type Caller } from '../../../test/helpers/index.js'

export interface TypeFlags {
  readonly can_earn: boolean
  readonly counts_as_end_customer: boolean
  readonly can_sponsor: boolean
  readonly can_hold_positions: boolean
}

export const DISTRIBUTOR: TypeFlags = { can_earn: true, counts_as_end_customer: false, can_sponsor: true, can_hold_positions: true }
export const CUSTOMER: TypeFlags = { can_earn: false, counts_as_end_customer: true, can_sponsor: false, can_hold_positions: false }

/** An active participant type: proposed by `admin` (settings.manage), approved by `approver` (step-up). */
export async function activeType(app: FastifyInstance, admin: Caller, approver: Caller, code: string, flags: TypeFlags): Promise<string> {
  const proposed = await call(app, {
    method: 'POST', url: '/v1/participant-types', as: admin, idempotencyKey: true, body: { code, name: code, ...flags, reason: 'fixture type' },
  })
  expect(proposed.statusCode).toBe(201)
  const id = proposed.json().data.id as string
  const approved = await call(app, {
    method: 'POST', url: `/v1/participant-types/${id}/decision`, as: approver, idempotencyKey: true, body: { decision: 'approve', reason: 'ok' },
  })
  expect(approved.statusCode).toBe(200)
  return id
}

/** FIXTURE: a settings version in force from now with these keys replaced (bypasses the settings API and its approvals). */
export async function setSettings(tenantId: string, userId: string, values: Record<string, unknown>): Promise<void> {
  await ownerRows(
    `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, clock_timestamp(),
            coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1), '{}') || $2::jsonb,
            'FIXTURE', $3
     FROM tenant_setting_version WHERE tenant_id = $1`,
    [tenantId, JSON.stringify(values), userId],
  )
}

export interface EnrolOptions {
  readonly as?: Caller
  readonly token?: string
  readonly idempotencyKey?: string
}

/** POST /v1/participants as a session or with an API key (Bearer). */
export function enrolRequest(app: FastifyInstance, body: Record<string, unknown>, options: EnrolOptions): Promise<LightMyRequestResponse> {
  if (options.token !== undefined) {
    return app.inject({
      method: 'POST', url: '/v1/participants', payload: body,
      headers: { authorization: `Bearer ${options.token}`, 'idempotency-key': options.idempotencyKey ?? randomUUID() },
    })
  }
  return call(app, { method: 'POST', url: '/v1/participants', as: options.as!, body, idempotencyKey: options.idempotencyKey ?? true })
}

/** An enrolment body with a fresh external reference. */
export const enrolment = (typeCode: string, extra: Record<string, unknown> = {}, market = 'GB'): Record<string, unknown> => ({
  external_ref: `EXT-${randomUUID().slice(0, 13)}`, market, type_code: typeCode, account_type: 'individual', ...extra,
})

/** Enrols and returns the response data (201 asserted). */
export async function enrolled(app: FastifyInstance, as: Caller, body: Record<string, unknown>) {
  const response = await enrolRequest(app, body, { as })
  expect(response.statusCode, response.body).toBe(201)
  return response.json().data as {
    participant: { id: string; external_ref: string }
    position: { id: string; position_ref: string; status: string } | null
    placement: { parent_position_id: string; leg: string | null; auto: boolean } | null
    servicing: { position_id: string } | null
    duplicate_case_id: string | null
  }
}

/** An API key of a new service account with the scopes (admin: integration.manage for all markets). */
export async function apiKey(app: FastifyInstance, admin: Caller, scopes: readonly string[]): Promise<string> {
  const account = await call(app, { method: 'POST', url: '/v1/service-accounts', as: admin, body: { name: randomUUID(), purpose: 'CRM sync' }, idempotencyKey: true })
  const key = await call(app, {
    method: 'POST', url: `/v1/service-accounts/${account.json().data.id}/keys`, as: admin,
    body: { name: 'sync', scopes, rate_tier: 'standard' }, idempotencyKey: true,
  })
  expect(key.statusCode, key.body).toBe(201)
  return key.json().data.token as string
}

/** A request with an API key. */
export function keyCall(
  app: FastifyInstance, token: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method, url, headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

/** FIXTURE: an agreement document uploaded by `userId` (as POST /v1/documents with class agreement stores it). */
export async function agreementDocument(tenantId: string, userId: string): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO document (tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, created_by, file_name)
     VALUES ($1, 'agreement', 'documents/fixture', sha256(gen_random_uuid()::text::bytea), 'application/pdf', 1, $2, 1, $2, 'terms.pdf')
     RETURNING id`,
    [tenantId, userId],
  )
  return row!.id
}

/** Publishes an agreement version of the market through the API (publisher: agreement.publish). */
export async function publishAgreement(
  app: FastifyInstance, publisher: Caller & { id: string; tenantId: string | null }, marketId: string, label: string, acceptanceRequired = true,
): Promise<string> {
  const response = await call(app, {
    method: 'POST', url: '/v1/agreement-versions', as: publisher, idempotencyKey: true,
    body: { market_id: marketId, label, document_id: await agreementDocument(publisher.tenantId!, publisher.id), acceptance_required: acceptanceRequired },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json().data.id as string
}

/** FIXTURE: a committed period [startsAt, endsAt) of a new calendar of the market (B3 runs commit periods). */
export async function committedPeriod(tenantId: string, marketId: string, startsAt: Date, endsAt: Date): Promise<void> {
  const [calendar] = await ownerRows<{ id: string }>(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, $3, 'weekly', 'UTC', $4::date) RETURNING id`,
    [tenantId, marketId, `fixture ${randomUUID().slice(0, 8)}`, startsAt.toISOString().slice(0, 10)],
  )
  await ownerRows(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state) VALUES ($1, $2, $3, $4, 'committed')`,
    [tenantId, calendar!.id, startsAt, endsAt],
  )
}

