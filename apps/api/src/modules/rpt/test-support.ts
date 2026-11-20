// TEST FIXTURES ONLY: committed periods, runs, orders, ledger postings, payouts, cases and guardrail decisions written
// by the owner with triggers off (session_replication_role replica), as the owning modules would have written them.
import { randomUUID } from 'node:crypto'
import { getOwnerPool } from '@nmp/db/testing'

const SYSTEM = '00000000-0000-0000-0000-000000000000'

/** Owner statement with triggers (and so foreign-key checks) off; CHECK constraints still apply. */
export async function ownerReplica<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    const { rows } = await client.query<T>(sql, params)
    await client.query('COMMIT')
    return rows
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const id = async (sql: string, params: unknown[]): Promise<string> => (await ownerReplica<{ id: string }>(sql, params))[0]!.id

export async function calendar(tenantId: string, marketId: string, name: string): Promise<string> {
  return id(`INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
             VALUES ($1, $2, $3, 'monthly', 'Europe/London', '2025-01-01') RETURNING id`, [tenantId, marketId, name])
}

/** A monthly period from `month` (YYYY-MM, London) in `state`. */
export async function period(tenantId: string, calendarId: string, month: string, state = 'open'): Promise<string> {
  return id(`INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state)
             VALUES ($1, $2, ($3 || '-01')::timestamp AT TIME ZONE 'Europe/London', (($3 || '-01')::date + interval '1 month') AT TIME ZONE 'Europe/London', $4)
             RETURNING id`, [tenantId, calendarId, month, state])
}

/** The period's committed run with `gross` and one settlement per payee gross; returns the run id. */
export async function committedRun(tenantId: string, periodId: string, gross: string, payeeGross: readonly string[]): Promise<string> {
  const runId = await id(
    `INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, snapshot_id, engine_version, state, totals,
       inputs_hash, lines_hash, outputs, finished_at, approval_id, review_opened_at, review_opened_by, committed_at, prepared_by)
     VALUES ($1, $2, gen_random_uuid()::text, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '0.2.0', 'committed',
             jsonb_build_object('gross_minor', $3::text), 'x', 'x', '{}', now(), gen_random_uuid(), now(), $4, now(), $4) RETURNING id`,
    [tenantId, periodId, gross, SYSTEM])
  await ownerReplica('UPDATE period SET committed_run_id = $2 WHERE id = $1', [periodId, runId])
  for (const amount of payeeGross) {
    await ownerReplica(
      `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor, withheld_minor, net_payable_minor)
       VALUES ($1, $2, gen_random_uuid(), $3, 0, 0, 0, $3)`, [tenantId, runId, amount])
  }
  return runId
}

/** An order of the market credited at `at` (source system `source`). */
export async function order(tenantId: string, marketId: string, at: string, amount: number, source = 'shop'): Promise<string> {
  return id(
    `INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
       attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency, payload_hash, inbound_event_id, created_by, created_by_type)
     VALUES ($1, $5, gen_random_uuid()::text, $2, gen_random_uuid(), gen_random_uuid(), 'customer', false, false, $3, $3, $4, 0, 'GBP',
             sha256(gen_random_uuid()::text::bytea), gen_random_uuid(), $6, 'system') RETURNING id`,
    [tenantId, marketId, at, amount, source, SYSTEM])
}

export async function orderEvent(tenantId: string, orderId: string, type: string, at: string, refund: number): Promise<void> {
  await ownerReplica(
    `INSERT INTO order_event (tenant_id, order_id, source_system, source_event_id, type, occurred_at, lines, refund_minor, fee_minor, volume_effect,
       reverses_event_id, inbound_event_id, created_by, created_by_type)
     VALUES ($1, $2, 'shop', gen_random_uuid()::text, $3, $4, '[]', $5, 0, '{}', CASE WHEN $3 = 'chargeback_reversed' THEN gen_random_uuid() END,
             gen_random_uuid(), $6, 'system')`,
    [tenantId, orderId, type, at, refund, SYSTEM])
}

/** A compliance snapshot of the market over [from, to] (month dates) with an R1 customer_share_pct figure for `month`. */
export async function snapshot(
  tenantId: string, marketId: string, range: { from: string; to: string }, state: string, figure: { month: string; value: string | null } | null,
): Promise<string> {
  const snapshotId = await id(
    `INSERT INTO compliance_report_snapshot (tenant_id, market_id, period_from, period_to, method_version, input_refs, state, created_by, inputs_hash, failure_reason)
     VALUES ($1, $2, $3, $4, '1', '{}', $5, $6, sha256('x'), CASE WHEN $5 = 'failed' THEN 'fixture' END) RETURNING id`,
    [tenantId, marketId, range.from, range.to, state, SYSTEM])
  if (figure !== null) {
    await ownerReplica(
      `INSERT INTO compliance_figure (tenant_id, snapshot_id, report, period, period_kind, key, unit, value_num)
       VALUES ($1, $2, 'R1', $3, 'month', 'customer_share_pct', 'percent', $4)`, [tenantId, snapshotId, figure.month, figure.value])
  }
  return snapshotId
}

/** A posting of `debit`/`credit` on a new account of `type` in the market. */
export async function posting(tenantId: string, marketId: string, type: string, debit: number, credit: number): Promise<void> {
  const payee = ['payee_payable', 'clawback_receivable'].includes(type) ? randomUUID() : null
  const accountId = await id(
    `INSERT INTO ledger_account (tenant_id, market_id, type, currency, payee_participant_id) VALUES ($1, $2, $3, 'GBP', $4) RETURNING id`,
    [tenantId, marketId, type, payee])
  await ownerReplica(
    `INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency) VALUES ($1, gen_random_uuid(), $2, $3, $4, 'GBP')`,
    [tenantId, accountId, debit, credit])
}

export async function payoutBatch(tenantId: string, marketId: string): Promise<string> {
  return id(`INSERT INTO payout_batch (tenant_id, market_id, provider_config_id, period_id, currency, prepared_by)
             VALUES ($1, $2, gen_random_uuid(), gen_random_uuid(), 'GBP', $3) RETURNING id`, [tenantId, marketId, SYSTEM])
}

export async function instruction(tenantId: string, batchId: string, state: string, amount: number, retryOf: string | null = null): Promise<string> {
  const instructionId = randomUUID()
  return id(
    `INSERT INTO payout_instruction (id, tenant_id, batch_id, payee_participant_id, bank_detail_version_id, amount_minor, currency, idempotency_key,
       signature, state, terminal_at, retry_of)
     VALUES ($1, $2, $3, gen_random_uuid(), gen_random_uuid(), $4, 'GBP', $7, sha256('x'), $5,
             CASE WHEN $5 IN ('settled', 'returned', 'failed', 'cancelled') THEN now() END, $6) RETURNING id`,
    [instructionId, tenantId, batchId, amount, state, retryOf, instructionId])
}

export async function caseFile(tenantId: string, marketId: string | null, type: string, state: 'open' | 'submitted', dueAt: string | null = null): Promise<void> {
  await ownerReplica(
    `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, due_at, submitted_by, submitted_at,
       opened_by_kind, opened_by, approvals_required)
     VALUES ($1, $2, 'participant', gen_random_uuid(), 'FIXTURE', $3, '{}', $4, $5, CASE WHEN $3 = 'submitted' THEN $6::uuid END,
             CASE WHEN $3 = 'submitted' THEN now() END, CASE WHEN $2 = 'privacy' THEN 'system' ELSE 'user' END,
             CASE WHEN $2 <> 'privacy' THEN $6::uuid END, CASE WHEN $2 IN ('adjustment', 'write_off') AND $3 = 'submitted' THEN 1 END)`,
    [tenantId, type, state, marketId, dueAt, SYSTEM])
}

/** A plan on the market whose version (in `state`) has one outstanding warned guardrail evaluation. */
export async function warnedVersion(tenantId: string, marketIds: string | readonly string[], state: string): Promise<void> {
  const ruleId = `rpt-fixture-${randomUUID().slice(0, 8)}@2026-01-01`
  await ownerReplica(
    `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status, source_ref, effective_from)
     VALUES ($1, 'none', 'Fixture', 'warned', '{}', true, false, 'Test basis', 'screening', 'Test fixture', '2026-01-01')`, [ruleId])
  const planId = await id('INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id', [tenantId, `plan-${ruleId}`, SYSTEM])
  await ownerReplica('INSERT INTO plan_market (tenant_id, plan_id, market_id) SELECT $1, $2, unnest($3::uuid[])', [tenantId, planId, [marketIds].flat()])
  const versionId = await id(
    `INSERT INTO plan_version (tenant_id, plan_id, version, state, engine_version, created_by, approval_id, activated_at, retired_at, effective_from,
       activation_approval_id, justification, compiled, content_hash, crediting_event, submitted_by, submitted_at)
     VALUES ($1, $2, 1, $3, '0.2.0', $4, gen_random_uuid(), now(), CASE WHEN $3 = 'retired' THEN now() END, now(), gen_random_uuid(), 'fixture',
             '{}', digest('{}'::jsonb::text, 'sha256'), 'paid', $4, now()) RETURNING id`, [tenantId, planId, state, SYSTEM])
  await ownerReplica(
    `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail, decided_by)
     VALUES ($1, $2, $3, 'evaluation', 'warned', guardrail_rules_hash($3, '{}'), '{"rule_keys": []}', $4)`, [tenantId, ruleId, versionId, SYSTEM])
}
