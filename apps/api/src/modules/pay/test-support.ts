import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { LightMyRequestResponse } from 'fastify'
import { BankDetails, bankFingerprint, bankVersionContext, maskAccount } from '../../lib/bank-crypto.js'
import { seal } from '../../lib/secret-box.js'
import {
  call, createMarket, createSignedInUser, createTenant, ownerRows, TEST_SECRET_KEY, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'

// Test fixtures of PAY (owner pool unless named "via API"). Tests may not import another module's test-support.

export const SECRET_KEY = Buffer.from(TEST_SECRET_KEY, 'base64')
export const WEBHOOK_SECRET = 'sandbox-webhook-secret-0123456789'

export interface PayWorld {
  readonly tenant: TestTenant
  readonly market: string
  readonly period: string
  readonly admin: TestUser
  readonly officer: TestUser
  readonly finance: TestUser
  readonly finance2: TestUser
  readonly compliance: TestUser
  readonly support: TestUser
}

/** A tenant with live market GB (GBP, 2 digits) and a committed period, and the payout personas (step-up fresh). */
export async function payWorld(code = 'GB'): Promise<PayWorld> {
  const tenant = await createTenant()
  const market = await createMarket(tenant.id, code)
  const user = (roles: Parameters<typeof createSignedInUser>[0]['roles']) => createSignedInUser({ tenantId: tenant.id, roles, stepUp: true })
  return {
    tenant, market, period: await committedPeriod(tenant.id, market),
    admin: await user(['Tenant admin']), officer: await user(['Payout officer']), finance: await user(['Finance approver']),
    finance2: await user(['Finance approver']), compliance: await user(['Compliance officer']), support: await user(['Support agent']),
  }
}

export async function committedPeriod(tenantId: string, marketId: string, startsAt = '2026-09-01'): Promise<string> {
  const [period] = await ownerRows<{ id: string }>(
    `WITH c AS (INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
                VALUES ($1, $2, $3, 'monthly', 'UTC', $4::date) RETURNING id)
     INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state)
     SELECT $1, c.id, $4::date, $4::date + interval '1 month', 'committed' FROM c RETURNING id`,
    [tenantId, marketId, `fixture ${randomUUID().slice(0, 8)}`, startsAt],
  )
  return period!.id
}

export async function participant(tenantId: string, marketId: string, email: string | null = null): Promise<string> {
  const ref = `PAY-${randomUUID().slice(0, 8)}`
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $4, $5, '2025-01-01', '00000000-0000-0000-0000-000000000000', 'system') RETURNING id`,
    [tenantId, ref, marketId, `Payee ${ref}`, email === null ? null : { email }],
  )
  return row!.id
}

/** Runs one owner statement with the tenant context the ledger functions read. */
async function asTenant<T extends Record<string, unknown>>(tenantId: string, sql: string, params: unknown[]): Promise<T[]> {
  return ownerRows<T>(
    `WITH ctx AS MATERIALIZED (SELECT set_config('app.tenant_id', $1::text, true), set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true),
                                      set_config('app.actor_type', 'system', true))
     ${sql}`,
    [tenantId, ...params],
  )
}

/** FIXTURE: a committed run's entry (owner: no run row) crediting the payee's payable with `amount` minor units. */
export async function credit(world: PayWorld, payee: string, amount: string): Promise<void> {
  const origin = randomUUID()
  await asTenant(world.tenant.id,
    `, a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
             SELECT $1::text::uuid, 'run', $4, $6, $7, 'approved', now(), $7 FROM ctx RETURNING id)
     SELECT ledger_post($2, $3, 'run_committed', 'run', $4, 'run:' || $4::uuid::text, a.id, $5::jsonb) FROM a`,
    [world.market, world.period, origin, JSON.stringify([
      { type: 'commission_expense', payee_participant_id: null, debit_minor: amount, credit_minor: '0' },
      { type: 'payee_payable', payee_participant_id: payee, debit_minor: '0', credit_minor: amount },
    ]), world.admin.id, world.finance.id])
}

export async function balance(world: { tenant: TestTenant; market: string }, payee: string | null, type: string): Promise<string> {
  const [row] = await asTenant<{ amount: string }>(world.tenant.id, 'SELECT led_balance($2, $3, $4)::text AS amount FROM ctx', [world.market, payee, type])
  return row!.amount
}

export const IBAN = 'GB82WEST12345698765432'

/** FIXTURE: a current bank-detail version (created_via migration) sealed as PAY seals it. */
export async function bankVersion(tenantId: string, payee: string, options: { coolingOffUntil?: Date; iban?: string } = {}): Promise<string> {
  const details = BankDetails.parse({ scheme: 'iban', account_holder: 'Fixture Holder', iban: options.iban ?? IBAN })
  const id = randomUUID()
  await ownerRows('UPDATE bank_detail_version SET superseded_at = now() WHERE tenant_id = $1 AND participant_id = $2 AND superseded_at IS NULL', [tenantId, payee])
  await ownerRows(
    `INSERT INTO bank_detail_version (id, tenant_id, participant_id, scheme, details_sealed, fingerprint, masked, created_via, cooling_off_until)
     VALUES ($1, $2, $3, 'iban', $4, $5, $6, 'migration', $7)`,
    [id, tenantId, payee, seal(SECRET_KEY, JSON.stringify(details), bankVersionContext(id)), bankFingerprint(SECRET_KEY, tenantId, details),
      maskAccount(details), options.coolingOffUntil ?? new Date(Date.now() - 1000)],
  )
  return id
}

const MONEY_KEYS = ['payouts.market_policy', 'payouts.bank_detail_cooling_off_hours', 'adjustments.policy', 'write_offs.policy']

/** FIXTURE: settings versions in force now; a money key gets its own version with an approved change request. */
export async function setSettings(world: Pick<PayWorld, 'tenant' | 'admin' | 'finance'>, values: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    const money = MONEY_KEYS.includes(key)
    const requestId = randomUUID()
    await ownerRows(
      `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                  SELECT $1, 'setting_change_request', $4, $5, $6, 'approved', now(), $6 WHERE $7 RETURNING id),
            v AS (INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
                  SELECT $1, (SELECT coalesce(max(version), 0) + 1 FROM tenant_setting_version WHERE tenant_id = $1), $8,
                         coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1), '{}')
                           || jsonb_build_object($2::text, $3::jsonb),
                         'FIXTURE', $5, (SELECT id FROM a) RETURNING id)
       INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, decided_by, decided_at,
         approval_id, version_id)
       SELECT $4, $1, $2, $3::jsonb, $8, 'FIXTURE', 0, 'approved', $5, $6, now(), a.id, v.id FROM a, v`,
      [world.tenant.id, key, JSON.stringify(value), requestId, world.admin.id, world.finance.id, money, new Date()],
    )
  }
}

export async function evidenceDocument(tenantId: string, userId: string): Promise<string> {
  const id = randomUUID()
  await ownerRows(
    `INSERT INTO document (id, tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, created_by, file_name)
     VALUES ($1, $2, 'evidence', $3, $4, 'application/pdf', 1024, $5, 1, $5, 'evidence.pdf')`,
    [id, tenantId, `documents/${id}`, createHash('sha256').update(id).digest(), userId],
  )
  return id
}

/** Via API: a recorded payout provider of the market with the adapter configured. */
export async function provider(app: FastifyInstance, world: PayWorld, adapter: 'sandbox' | 'bank_file_csv', name = `Sandbox ${randomUUID().slice(0, 6)}`): Promise<string> {
  const created = await call(app, {
    method: 'POST', url: '/v1/provider-configs', as: world.admin, idempotencyKey: true,
    body: {
      market_id: world.market, kind: 'payout', provider: name, approved_description: 'Payouts licence (FIXTURE)',
      approval_document_id: await evidenceDocument(world.tenant.id, world.admin.id), approved_at: '2026-10-01', funds_holder: 'Provider (FIXTURE)',
    },
  })
  const id = created.json().data.id as string
  const configured = await call(app, {
    method: 'PUT', url: `/v1/provider-configs/${id}/adapter`, as: world.admin,
    body: adapter === 'sandbox' ? { adapter, webhook_secret: WEBHOOK_SECRET } : { adapter },
  })
  if (configured.statusCode !== 200) throw new Error(`adapter not configured: ${configured.body}`)
  return id
}

export const post = (app: FastifyInstance, as: TestUser, url: string, body: unknown = {}): Promise<LightMyRequestResponse> =>
  call(app, { method: 'POST', url, as, body, idempotencyKey: true })

/** Via API: prepares, submits and approves a batch; returns its id. */
export async function approvedBatch(app: FastifyInstance, world: PayWorld, providerId: string): Promise<string> {
  const prepared = await post(app, world.officer, '/v1/payout-batches', { market_id: world.market, provider_config_id: providerId })
  const id = prepared.json().data.id as string
  const submitted = await post(app, world.officer, `/v1/payout-batches/${id}/submit`)
  const approved = await post(app, world.finance, `/v1/payout-batches/${id}/approve`)
  if (submitted.statusCode !== 200 || approved.statusCode !== 200) throw new Error(`batch not approved: ${submitted.body} ${approved.body}`)
  return id
}

/** A signed sandbox webhook delivery: HMAC of `<event id>.<timestamp>.<body>`; `at` = Unix seconds (default now). */
export function webhook(app: FastifyInstance, providerId: string, body: unknown, options: { eventId?: string; secret?: string; at?: number } = {}): Promise<LightMyRequestResponse> {
  const raw = JSON.stringify(body)
  const eventId = options.eventId ?? randomUUID()
  const timestamp = String(options.at ?? Math.floor(Date.now() / 1000))
  return app.inject({
    method: 'POST', url: `/v1/webhooks/providers/${providerId}`, payload: raw,
    headers: {
      'content-type': 'application/json', 'x-sandbox-event-id': eventId, 'x-sandbox-timestamp': timestamp,
      'x-sandbox-signature': createHmac('sha256', options.secret ?? WEBHOOK_SECRET).update(`${eventId}.${timestamp}.${raw}`).digest('base64'),
    },
  })
}

/** FIXTURE: a user holding exactly `permissions` through a custom role (step-up fresh). */
export async function customRoleUser(tenantId: string, permissions: readonly string[]): Promise<TestUser> {
  const user = await createSignedInUser({ tenantId, stepUp: true })
  await ownerRows(
    `WITH r AS (INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, $2, $3, false, true) RETURNING id)
     INSERT INTO role_assignment (tenant_id, user_id, role_id, valid_from) SELECT $1, $4, r.id, now() FROM r`,
    [tenantId, `custom ${randomUUID().slice(0, 8)}`, permissions, user.id],
  )
  return user
}

/** FIXTURE: an old payable (owner insert: ledger rows are immutable, so the date is written once, at insert). */
export async function creditAt(world: PayWorld, payee: string, amount: string, postedAt: Date): Promise<void> {
  await credit(world, payee, '1') // creates the accounts
  await debitOne(world, payee)
  const origin = randomUUID()
  await asTenant(world.tenant.id,
    `, a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
             SELECT $1::text::uuid, 'run', $4, $6, $7, 'approved', now(), $7 FROM ctx RETURNING id),
       e AS (INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, posted_at)
             SELECT $1::text::uuid, $2, $3, 'run_committed', 'run', $4, 'run:' || $4::uuid::text, a.id, $8 FROM a RETURNING id)
     INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
     SELECT $1::text::uuid, e.id, l.id, CASE WHEN l.type = 'commission_expense' THEN $5::bigint ELSE 0 END,
            CASE WHEN l.type = 'payee_payable' THEN $5::bigint ELSE 0 END, l.currency
     FROM e, ledger_account l WHERE l.market_id = $2 AND ((l.type = 'commission_expense' AND l.payee_participant_id IS NULL)
       OR (l.type = 'payee_payable' AND l.payee_participant_id = $9))`,
    [world.market, world.period, origin, amount, world.admin.id, world.finance.id, postedAt, payee])
}

/** Takes the 1 minor unit creditAt used to open the accounts back out (an expense reversal: a negative run). */
async function debitOne(world: PayWorld, payee: string): Promise<void> {
  const origin = randomUUID()
  await asTenant(world.tenant.id,
    `, a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
             SELECT $1::text::uuid, 'run', $4, $6, $7, 'approved', now(), $7 FROM ctx RETURNING id)
     SELECT ledger_post($2, $3, 'run_committed', 'run', $4, 'run:' || $4::uuid::text, a.id, $5::jsonb) FROM a`,
    [world.market, world.period, origin, JSON.stringify([
      { type: 'payee_payable', payee_participant_id: payee, debit_minor: '1', credit_minor: '0' },
      { type: 'commission_expense', payee_participant_id: null, debit_minor: '0', credit_minor: '1' },
    ]), world.admin.id, world.finance.id])
}
