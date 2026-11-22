import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  call, createMarket, createSignedInUser, createTenant, ownerReplica, ownerRows, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'

// Test fixtures of LED credits and FX (owner pool unless named "via API"). Tests may not import another module's
// test-support, so the few shapes PAY's fixtures share are repeated here.

export interface LedWorld {
  readonly tenant: TestTenant
  /** GB, GBP, Europe/London, with a committed period (the attribution period of redemptions and expiries). */
  readonly market: string
  readonly finance: TestUser
  readonly finance2: TestUser
  readonly analyst: TestUser
  readonly support: TestUser
  /** Tenant admin and Finance approver: mints keys with credits:write. */
  readonly minter: TestUser
}

export async function ledWorld(): Promise<LedWorld> {
  const tenant = await createTenant()
  const market = await createMarket(tenant.id, 'GB')
  await ownerRows(
    `WITH c AS (INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
                VALUES ($1, $2, $3, 'monthly', 'UTC', '2026-09-01') RETURNING id)
     INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state) SELECT $1, c.id, '2026-09-01', '2026-10-01', 'committed' FROM c`,
    [tenant.id, market, `fixture ${randomUUID().slice(0, 8)}`],
  )
  const user = (roles: Parameters<typeof createSignedInUser>[0]['roles']) => createSignedInUser({ tenantId: tenant.id, roles, stepUp: true })
  return {
    tenant, market, finance: await user(['Finance approver']), finance2: await user(['Finance approver']), analyst: await user(['Commission analyst']),
    support: await user(['Support agent']), minter: await user(['Tenant admin', 'Finance approver']),
  }
}

export async function participant(tenantId: string, marketId: string): Promise<{ id: string; ref: string }> {
  const ref = `LED-${randomUUID().slice(0, 8)}`
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $2, '2025-01-01', '00000000-0000-0000-0000-000000000000', 'system') RETURNING id`,
    [tenantId, ref, marketId],
  )
  return { id: row!.id, ref }
}

/** FIXTURE: a credit type (owner insert, created by `userId`). */
export async function creditType(
  tenantId: string, userId: string, code: string, terms: { expiry?: [number, number]; scope?: Record<string, unknown> } = {},
): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO credit_type (tenant_id, code, name, expiry_days, expiry_notice_days, redemption_scope, taxable, created_by, updated_by)
     VALUES ($1, $2, $2, $3, $4, $5, false, $6, $6) RETURNING id`,
    [tenantId, code, terms.expiry?.[0] ?? null, terms.expiry?.[1] ?? null, terms.scope ?? null, userId],
  )
  return row!.id
}

/**
 * FIXTURE: a credit award of a run committed at `committedAt` (owner, triggers off for the run and the award: no plan,
 * period or position behind them) and the run entry's Dr commission_expense / Cr credit_liability for it.
 */
export async function award(w: LedWorld, payee: string, typeId: string, amount: string, committedAt: Date, market = w.market): Promise<string> {
  const runId = randomUUID()
  await ownerReplica(
    `INSERT INTO run (id, tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, snapshot_id, engine_version, state, totals,
       inputs_hash, lines_hash, outputs, prepared_by, review_opened_at, review_opened_by, approval_id, finished_at, committed_at)
     VALUES ($1, $2, gen_random_uuid(), 'fixture', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'fixture', 'committed', '{}',
             'x', 'x', '{}', $3, $4, $3, gen_random_uuid(), $4, $4)`,
    [runId, w.tenant.id, w.finance.id, committedAt],
  )
  const [row] = await ownerReplica<{ id: string }>(
    `INSERT INTO credit_award (tenant_id, run_id, market_id, payee_participant_id, payee_position_id, rule_key, credit_type_id, amount_minor,
       currency, expiry_days, expiry_notice_days, taxable, unit_value_minor, trace)
     SELECT $1, $2, $3, $4, gen_random_uuid(), 'loyalty_credit', t.id, $6, m.currency, t.expiry_days, t.expiry_notice_days, t.taxable,
            t.unit_value_minor, '{}'
     FROM credit_type t, market m WHERE t.id = $5 AND m.id = $3 RETURNING id`,
    [w.tenant.id, runId, market, payee, typeId, amount],
  )
  const [period] = await ownerRows<{ id: string }>(
    'SELECT p.id FROM period p JOIN calendar c ON c.id = p.calendar_id WHERE c.market_id = $1 ORDER BY p.starts_at LIMIT 1', [market],
  )
  await ownerRows(
    `WITH ctx AS MATERIALIZED (SELECT set_config('app.tenant_id', $1::text, true), set_config('app.user_id', $6::uuid::text, true),
                                      set_config('app.actor_type', 'system', true)),
          a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                SELECT $1::text::uuid, 'run', $4, $6::uuid, $7::uuid, 'approved', now(), $7::uuid FROM ctx RETURNING id)
     SELECT ledger_post($2, $3, 'run_committed', 'run', $4, 'run:' || $4::uuid::text, a.id, $5::jsonb) FROM a`,
    [w.tenant.id, market, period!.id, runId, JSON.stringify([
      { type: 'commission_expense', debit_minor: amount, credit_minor: '0' },
      { type: 'credit_liability', payee_participant_id: payee, credit_type_id: typeId, debit_minor: '0', credit_minor: amount },
    ]), w.finance.id, w.finance2.id],
  )
  return row!.id
}

/** The holder's credit_liability balance (credit − debit) and Σ lot remainders, which must agree (AC-FIN6-5). */
export async function liability(tenantId: string, payee: string, typeId: string, market: string): Promise<{ balance: string; lots: string }> {
  const [row] = await ownerRows<{ balance: string; lots: string }>(
    `SELECT (SELECT coalesce(sum(x.credit_minor - x.debit_minor), 0) FROM ledger_account a JOIN posting x ON x.account_id = a.id
             WHERE a.tenant_id = $1 AND a.type = 'credit_liability' AND a.payee_participant_id = $2 AND a.credit_type_id = $3 AND a.market_id = $4)::text AS balance,
            (SELECT coalesce(sum(l.remaining_minor), 0) FROM credit_lots($2, $3, $4) l)::text AS lots`,
    [tenantId, payee, typeId, market],
  )
  return row!
}

/** A key of a new service account with the scopes, minted through the API (via API). */
export async function apiKey(app: FastifyInstance, minter: TestUser, scopes: readonly string[]): Promise<string> {
  const account = await call(app, { method: 'POST', url: '/v1/service-accounts', as: minter, body: { name: randomUUID(), purpose: 'store' }, idempotencyKey: true })
  const key = await call(app, {
    method: 'POST', url: `/v1/service-accounts/${account.json().data.id}/keys`, as: minter,
    body: { name: 'credits', scopes, rate_tier: 'high' }, idempotencyKey: true,
  })
  if (key.statusCode !== 201) throw new Error(`key not minted: ${key.body}`)
  return key.json().data.token as string
}

/** POST with a bearer key (no session, no CSRF header). */
export function asKey(app: FastifyInstance, token: string, url: string, body: unknown, idempotencyKey: string = randomUUID()) {
  return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey }, payload: body as object })
}
