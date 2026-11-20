import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { withTenant, withVendor, type TenantContext, type Tx } from '../src/index.js'
import { getOwnerPool } from '../src/testing.js'
import { asUser, insertAuditEvent, insertEvidence, insertMarket, insertOutboxEvent, insertRow, openSession } from './support.js'

const PERIOD = { period_from: '2026-01-01', period_to: '2026-01-31' }
const ONE_HOUR_MS = 3_600_000

export const inOneHour = (): Date => new Date(Date.now() + ONE_HOUR_MS)

export interface TenantSeed {
  marketId: string
  roleId: string
  approvalId: string
  settingsVersionId: string
  documentId: string
  mappingId: string
  batchId: string
  snapshotId: string
  brandId: string
  calendarId: string
  caseId: string
  endpointId: string
  outboxEventId: string
  serviceAccountId: string
  typeId: string
  participantId: string
  positionId: string
  planVersionId: string
  runId: string
  periodId: string
  journalEntryId: string
  bankDetailVersionId: string
  payoutBatchId: string
  instructionId: string
  portalUserId: string
  privacyRequestId: string
  migrationId: string
  /** The migration's cutover: the open period after periodId (a calculated period takes no migration). */
  migrationPeriodId: string
  parallelRunId: string
  dataExportId: string
}

/** A platform guardrail rule for the seeded evaluation; pack rules are written by migrations or the owner only. */
export const SEED_GUARDRAIL_RULE = 'seed-starter-kit@2026-01-01'

/**
 * Writes one row into every tenant-scoped table as nmp_app in the tenant's own context, so a denial
 * assertion always has a row it could have seen. secondUserId is another user of the same tenant.
 */
export async function seedTenantRows(ctx: TenantContext, secondUserId: string): Promise<TenantSeed> {
  const tenant_id = ctx.tenantId
  await getOwnerPool().query(
    `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status,
       source_ref, effective_from)
     VALUES ($1, 'seed', 'Seed rule', 'warned', '{"check": "starter_kit_volume"}', true, true, 'seed', 'screening', 'seed',
       '2026-01-01')
     ON CONFLICT (id) DO NOTHING`,
    [SEED_GUARDRAIL_RULE],
  )
  return withTenant(ctx, async (tx) => {
    const marketId = await insertMarket(tx, tenant_id)
    const roleId = await insertRow(tx, 'role', {
      tenant_id, name: 'Custom', permissions: ['import.manage'], is_base: false, mfa_required: false,
    })
    const approvalId = await asUser(tx, secondUserId, () => insertRow(tx, 'approval', {
      tenant_id, object_type: 'role_assignment', object_id: roleId, preparer_id: ctx.userId,
      approver_id: secondUserId, decision: 'approved', decided_at: new Date(),
    }))
    await insertRow(tx, 'role_assignment', {
      tenant_id, user_id: secondUserId, role_id: roleId, valid_from: new Date(), approval_id: approvalId,
    })
    await insertRow(tx, 'role_grant_request', {
      tenant_id, user_id: secondUserId, role_id: roleId, requested_by: ctx.userId, state: 'pending',
    })
    await insertRow(tx, 'user_invitation', {
      tenant_id, user_id: secondUserId, token_hash: randomBytes(32), expires_at: inOneHour(), created_by: ctx.userId,
    })
    const settingsVersionId = await insertRow(tx, 'tenant_setting_version', {
      tenant_id, version: 1, effective_from: new Date(), settings: {}, reason: 'seed', created_by: ctx.userId,
      approval_id: approvalId,
    })
    const documentId = await insertRow(tx, 'document', {
      tenant_id, class: 'evidence', storage_key: 'seed', sha256: randomBytes(32), mime: 'text/csv', size_bytes: 1,
      uploaded_by: ctx.userId, version: 1,
    })
    const mappingId = await insertRow(tx, 'import_mapping', { tenant_id, version: 1, mappings: {}, state: 'draft' })
    const batchId = await insertRow(tx, 'import_batch', {
      tenant_id, market_id: marketId, kind: 'overlay', ...PERIOD, state: 'mapped', mapping_id: mappingId,
      uploaded_by: ctx.userId,
    })
    await insertRow(tx, 'import_row_error', { tenant_id, batch_id: batchId, file: 'orders.csv', code: 'E1' })
    await insertRow(tx, 'cpl_fact_participant', {
      tenant_id, source: 'import', batch_id: batchId, participant_ref: 'p1', type_code: 'distributor',
      counts_as_end_customer: false, can_earn: true, enrolled_month: '2026-01-01', market_id: marketId,
    })
    await insertRow(tx, 'cpl_fact_order', {
      tenant_id, source: 'import', batch_id: batchId, order_ref: 'o1', order_date: '2026-01-05', buyer_ref: 'p1',
      amount_minor: 10000, volume_minor: 8000, purpose: 'customer', is_starter_kit: false, refunded_minor: 0,
    })
    await insertRow(tx, 'cpl_fact_payout_line', {
      tenant_id, source: 'import', batch_id: batchId, line_ref: 'l1', pay_month: '2026-01-01', payee_ref: 'p1',
      bonus_type: 'retail', source_kind: 'retail_sale', amount_minor: 500,
    })
    // Facts are written while the batch is mapped, as the load does (migration 0031).
    await tx.query(`UPDATE import_batch SET state = 'loaded' WHERE id = $1`, [batchId])
    const snapshotId = await insertRow(tx, 'compliance_report_snapshot', {
      tenant_id, market_id: marketId, ...PERIOD, method_version: 'm1', mapping_id: mappingId,
      settings_version_id: settingsVersionId, input_refs: {}, state: 'computing', created_by: ctx.userId,
      inputs_hash: randomBytes(32),
    })
    await insertRow(tx, 'compliance_figure', { tenant_id, snapshot_id: snapshotId, report: 'R1', key: 'k' })
    await insertRow(tx, 'export_job', {
      tenant_id, kind: 'audit', document_id: documentId, requested_by: ctx.userId, state: 'done', created_by_type: 'user',
    })
    await openSession(tx)
    await insertRow(tx, 'mfa_credential', { user_id: ctx.userId, type: 'totp', secret_encrypted: 'seed' })
    // The next two tables have no id column.
    await tx.query(`INSERT INTO password_credential (user_id, password_hash) VALUES ($1, 'seed')`, [ctx.userId])
    await tx.query(
      `INSERT INTO idempotency_key (tenant_id, key, route, request_hash) VALUES ($1, 'seed', 'POST /v1/imports', $2)`,
      [tenant_id, randomBytes(32)],
    )
    await insertAuditEvent(tx, tenant_id, 'TEST.SEED')
    const outboxEventId = await insertOutboxEvent(tx, tenant_id)
    const b1 = await seedB1Rows(tx, ctx, marketId, outboxEventId)
    const b2 = await seedB2Rows(tx, ctx, secondUserId, marketId, b1.brandId)
    const b3 = await seedB3Rows(tx, ctx, { marketId, calendarId: b1.calendarId, settingsVersionId, ...b2 })
    const b4 = await seedB4Rows(tx, ctx, secondUserId, { marketId, ...b2, ...b3 })
    const b5 = await seedB5Rows(tx, ctx, secondUserId, b2.participantId)
    const b6 = await seedB6Rows(tx, ctx, secondUserId, { marketId, roleId, ...b3 })
    return {
      marketId, roleId, approvalId, settingsVersionId, documentId, mappingId, batchId, snapshotId, outboxEventId, ...b1, ...b2,
      ...b3, ...b4, ...b5, ...b6,
    }
  })
}

/** One row in every B1 tenant table (PLAN B1 section 1), each document referenced once by its uploader. */
async function seedB1Rows(tx: Tx, ctx: TenantContext, marketId: string, outboxEventId: string) {
  const tenant_id = ctx.tenantId
  const evidence = () => insertEvidence(tx, tenant_id, ctx.userId)
  const brandId = await insertRow(tx, 'brand', { tenant_id, name: 'Seed brand' })
  const calendarId = await insertRow(tx, 'calendar', {
    tenant_id, market_id: marketId, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/London',
    first_period_start: '2026-01-01',
  })
  await insertRow(tx, 'period', {
    tenant_id, calendar_id: calendarId, starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-02-01T00:00:00Z',
  })
  await insertRow(tx, 'setting_change_request', {
    tenant_id, key: 'money.rounding_mode', value: JSON.stringify('half_even'), effective_from: inOneHour(),
    reason: 'seed', base_version: 1, state: 'pending', requested_by: ctx.userId,
  })
  await insertRow(tx, 'provider_config', {
    tenant_id, market_id: marketId, kind: 'payout', provider: 'Sandbox payouts', approved_description: 'seed',
    approval_document_id: await evidence(), approved_at: '2026-01-01', funds_holder: 'Provider', state: 'recorded',
    created_by: ctx.userId,
  })
  await insertRow(tx, 'market_checklist_entry', {
    tenant_id, market_id: marketId, item: 'licence_evidence', document_id: await evidence(), recorded_by: ctx.userId,
  })
  await insertRow(tx, 'market_go_live_request', {
    tenant_id, market_id: marketId, state: 'pending', requested_by: ctx.userId, checklist: {},
    risk_document_id: await evidence(),
  })
  const serviceAccountId = await insertRow(tx, 'service_account', {
    tenant_id, name: 'BI export', purpose: 'seed', state: 'active', created_by: ctx.userId,
  })
  await insertRow(tx, 'api_key', {
    tenant_id, service_account_id: serviceAccountId, name: 'seed', key_prefix: 'nmpk_abcdefg',
    key_hash: randomBytes(32).toString('hex'), scopes: ['compliance:read'], rate_tier: 'standard', created_by: ctx.userId,
  })
  const caseId = await insertRow(tx, 'case_file', {
    tenant_id, type: 'adjustment', subject_type: 'test_subject', subject_id: randomUUID(), reason_code: 'seed',
    state: 'open', payload: {}, market_id: marketId, opened_by: ctx.userId,
  })
  await insertRow(tx, 'case_event', { tenant_id, case_id: caseId, actor_id: ctx.userId, kind: 'opened' })
  await insertRow(tx, 'case_evidence', { tenant_id, case_id: caseId, document_id: await evidence(), added_by: ctx.userId })
  const endpointId = await insertRow(tx, 'webhook_endpoint', {
    tenant_id, url: 'https://hooks.example.test/nmp', secret_sealed: 'sealed', topics: ['audit'], state: 'active',
    created_by: ctx.userId,
  })
  await insertRow(tx, 'webhook_delivery', {
    tenant_id, endpoint_id: endpointId, outbox_event_id: outboxEventId, attempt: 1, outcome: 'scheduled',
    next_attempt_at: new Date(),
  })
  return { brandId, calendarId, caseId, endpointId, serviceAccountId }
}

const DAY_MS = 86_400_000

/**
 * One row in every B2 tenant table (PLAN B2 section 1), written through the shared SQL functions where one exists: a
 * type proposed by the acting user and approved by secondUserId, a distributor and a customer with positions, a sponsor
 * row, a read-model row, servicing, an agreement, a signal, an order with a line, an event and a late item.
 */
async function seedB2Rows(tx: Tx, ctx: TenantContext, secondUserId: string, marketId: string, brandId: string) {
  const tenant_id = ctx.tenantId
  const since = new Date(Date.now() - DAY_MS)
  const typeId = await insertRow(tx, 'participant_type', {
    tenant_id, code: 'SEED', name: 'Seed type', can_earn: true, counts_as_end_customer: true, can_sponsor: true,
    can_hold_positions: true, state: 'pending', reason: 'seed', requested_by: ctx.userId,
  })
  await asUser(tx, secondUserId, async () => {
    const approvalId = await insertRow(tx, 'approval', {
      tenant_id, object_type: 'participant_type', object_id: typeId, preparer_id: ctx.userId, approver_id: secondUserId,
      decision: 'approved', decided_at: new Date(),
    })
    await tx.query(
      `UPDATE participant_type SET state = 'active', decided_by = $2, decided_at = now(), approval_id = $3 WHERE id = $1`,
      [typeId, secondUserId, approvalId],
    )
  })
  const one = async <T>(sql: string, params: unknown[]): Promise<T> => Object.values((await tx.query(sql, params)).rows[0]!)[0] as T
  const customer = (ref: string) => one<string>('SELECT id FROM par_create_customer($1, $2, $3, $4)', [ref, marketId, typeId, since])
  const participantId = await customer('seed-distributor')
  const customerId = await customer('seed-customer')
  const position = (owner: string) =>
    one<string>(`SELECT gen_create_position($1, $2, $3, NULL, 'active', $4)`, [owner, marketId, brandId, since])
  const positionId = await position(participantId)
  await one(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, $3, 'enrolment', NULL, NULL)`, [
    await position(customerId), positionId, since,
  ])
  await tx.query(
    `INSERT INTO path_node (tenant_id, kind, model_version, position_id, path, depth, subtree_count)
     VALUES ($1, 'sponsor', 1, $2, 'seed', 0, 1)`,
    [tenant_id, positionId],
  )
  await one(`SELECT crm_set_servicer($1, $2, 'enrolment', $3, NULL, NULL)`, [customerId, positionId, since])
  await insertRow(tx, 'participant_signal', {
    tenant_id, participant_id: participantId, kind: 'identity_ref', digest: randomBytes(32),
  })
  const agreementDocumentId = await insertRow(tx, 'document', {
    tenant_id, class: 'agreement', storage_key: 'agreement', sha256: randomBytes(32), mime: 'application/pdf',
    size_bytes: 1, uploaded_by: ctx.userId, version: 1, file_name: 'agreement.pdf',
  })
  const versionId = await insertRow(tx, 'agreement_version', {
    tenant_id, market_id: marketId, label: 'v1', document_id: agreementDocumentId, acceptance_required: true,
    published_by: ctx.userId,
  })
  await insertRow(tx, 'agreement_acceptance', {
    tenant_id, participant_id: participantId, agreement_version_id: versionId, accepted_at: since,
  })
  await insertRow(tx, 'product_volume_map', {
    tenant_id, market_id: marketId, sku: 'SKU-1', item_class: 'product', volumes: { qv: '1000' }, valid_from: since,
    reason: 'seed', created_by: ctx.userId,
  })
  const inbound = (key: string) => insertRow(tx, 'inbound_event', {
    tenant_id, source: 'api:seed', idempotency_key: key, payload_hash: randomBytes(32), processed_at: new Date(),
    state: 'processed',
  })
  const orderId = await insertRow(tx, 'sales_order', {
    tenant_id, source_system: 'seed', source_order_id: 'o1', market_id: marketId, buyer_id: customerId,
    buyer_type_id: typeId, purpose: 'customer', purpose_missing: false, attributed_position_id: positionId,
    attribution_source: 'servicing', attribution_conflict: false, ordered_at: since, credited_at: since,
    amount_minor: 1000, tax_minor: 0, currency: 'GBP', payload_hash: randomBytes(32), inbound_event_id: await inbound('order:seed:o1'),
  })
  await insertRow(tx, 'order_line', {
    tenant_id, order_id: orderId, line_no: 1, sku: 'SKU-1', item_class: 'product', quantity: 2, amount_minor: 1000,
    volumes: { qv: '2000' },
  })
  await insertRow(tx, 'order_event', {
    tenant_id, order_id: orderId, source_system: 'seed', source_event_id: 'e1', type: 'return', occurred_at: new Date(),
    lines: JSON.stringify([{ line_no: 1, quantity: 1 }]), refund_minor: 500, fee_minor: 0,
    volume_effect: { total: { qv: '-1000' } }, inbound_event_id: await inbound('event:seed:e1'),
  })
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM period LIMIT 1')
  await insertRow(tx, 'late_transaction', {
    tenant_id, order_id: orderId, original_period_id: rows[0]!.id, handling: 'adjust', state: 'pending',
  })
  return { typeId, participantId, positionId }
}

/**
 * One row in every B3 tenant table (PLAN B3 section 1): a plan on the market and calendar with a draft version, a rule,
 * a transition, a golden dataset and a guardrail evaluation; a calculated run with its snapshot, a line, a state row and
 * a late origin; a completed simulation with a line; a restatement case with its restatement.
 */
async function seedB3Rows(
  tx: Tx, ctx: TenantContext,
  ids: { marketId: string; calendarId: string; settingsVersionId: string; positionId: string; participantId: string },
) {
  const tenant_id = ctx.tenantId
  const one = async (sql: string, params: unknown[]): Promise<string> => Object.values((await tx.query(sql, params)).rows[0]!)[0] as string
  const planId = await insertRow(tx, 'plan', { tenant_id, name: 'Seed plan', created_by: ctx.userId })
  await tx.query('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [tenant_id, planId, ids.marketId])
  await tx.query('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [tenant_id, planId, ids.calendarId])
  const planVersionId = await insertRow(tx, 'plan_version', {
    tenant_id, plan_id: planId, version: 1, engine_version: 'seed', compiled: {}, created_by: ctx.userId,
  })
  await insertRow(tx, 'plan_rule', {
    tenant_id, plan_version_id: planVersionId, rule_key: 'pv', kind: 'volume.personal', pass: '1', params: { unit: 'currency' },
    created_by: ctx.userId, updated_by: ctx.userId,
  })
  await insertRow(tx, 'plan_transition', { tenant_id, to_version_id: planVersionId, state_item: 'carry.*', rule: 'carry', created_by: ctx.userId })
  await insertRow(tx, 'guardrail_decision', {
    tenant_id, rule_id: SEED_GUARDRAIL_RULE, plan_version_id: planVersionId, kind: 'evaluation', outcome: 'warned',
    content_sha256: randomBytes(32), detail: { rule_keys: ['pv'] },
  })
  await insertRow(tx, 'golden_dataset', {
    tenant_id, plan_version_id: planVersionId, calendar_id: ids.calendarId, name: 'seed', input: {}, expected: { lines: [], total_minor: '0' },
    created_by: ctx.userId,
  })
  const periodId = await one('SELECT id FROM period WHERE calendar_id = $1 LIMIT 1', [ids.calendarId])
  const content = randomBytes(16)
  const snapshotId = await insertRow(tx, 'run_snapshot', {
    tenant_id, period_id: periodId, known_at: new Date(), content, content_sha256: createHash('sha256').update(content).digest(),
    row_counts: {}, order_ids: [], order_event_ids: [],
  })
  const runId = await insertRow(tx, 'run', {
    tenant_id, period_id: periodId, run_request_id: 'seed', plan_version_id: planVersionId, settings_version_id: ids.settingsVersionId,
    engine_version: 'seed', prepared_by: ctx.userId,
  })
  await tx.query(`UPDATE run SET state = 'running', snapshot_id = $2, started_at = now() WHERE id = $1`, [runId, snapshotId])
  const payee = { tenant_id, payee_position_id: ids.positionId, payee_participant_id: ids.participantId, rule_key: 'pv' }
  const line = { ...payee, bonus_type: 'pay.flat', source_kind: 'other', pass: 4, amount_minor: 100, currency: 'GBP', trace: {} }
  await insertRow(tx, 'result_line', { ...line, run_id: runId })
  await tx.query(
    `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor,
       withheld_minor, net_payable_minor) VALUES ($1, $2, $3, 100, 0, 0, 0, 100)`,
    [tenant_id, runId, ids.participantId],
  )
  await tx.query(
    `INSERT INTO qualification_state (tenant_id, run_id, position_id, paid_as_rank, highest_titles, grace_used, counters, carry,
       one_time_flags, banked, measures) VALUES ($1, $2, $3, '[]', '[]', '[]', '[]', '[]', '{}', '[]', '[]')`,
    [tenant_id, runId, ids.positionId],
  )
  await insertRow(tx, 'adjustment_origin', {
    tenant_id, origin_type: 'late_transaction', late_transaction_id: await one('SELECT id FROM late_transaction LIMIT 1', []),
    run_id: runId, payee_position_id: ids.positionId, rule_key: 'pv', source_kind: 'other', amount_minor: -50,
    original_period_id: periodId,
  })
  await tx.query(
    `UPDATE run SET state = 'calculated', totals = '{"gross_minor": "100"}', inputs_hash = 'seed', lines_hash = 'seed',
       outputs = '{}', finished_at = now() WHERE id = $1`,
    [runId],
  )
  const simulationId = await insertRow(tx, 'simulation', {
    tenant_id, plan_version_id: planVersionId, period_id: periodId, kind: 'simulation', requested_by: ctx.userId,
    content_hash: await one(`SELECT digest(compiled::text, 'sha256') FROM plan_version WHERE id = $1`, [planVersionId]),
  })
  await tx.query(`UPDATE simulation SET state = 'running', snapshot_id = $2 WHERE id = $1`, [simulationId, snapshotId])
  await insertRow(tx, 'sim_result_line', { ...line, simulation_id: simulationId })
  await tx.query(
    `UPDATE simulation SET state = 'completed', totals = '{}', comparison = '{}', finished_at = now() WHERE id = $1`,
    [simulationId],
  )
  const caseId = await insertRow(tx, 'case_file', {
    tenant_id, type: 'restatement', subject_type: 'period', subject_id: periodId, reason_code: 'INPUT_CORRECTION', state: 'open',
    payload: {}, market_id: ids.marketId, opened_by: ctx.userId,
  })
  await insertRow(tx, 'restatement', {
    tenant_id, period_id: periodId, case_id: caseId, simulation_id: simulationId, state: 'calculated', diff: {},
  })
  return { planVersionId, runId, periodId }
}

/**
 * One row in every B4 tenant table (PLAN B4 section 1), through the shared SQL where one exists: the seeded run committed
 * by secondUserId and posted, a GL mapping and export, a related-party declaration, a bank-detail request approved
 * through its case into a version, a sandbox provider with a batch (line, instruction posted as instructed), its
 * payment, an exception, a hold and a tax profile.
 */
async function seedB4Rows(
  tx: Tx, ctx: TenantContext, secondUserId: string,
  ids: { marketId: string; participantId: string; runId: string; periodId: string },
) {
  const tenant_id = ctx.tenantId
  const one = async (sql: string, params: unknown[]): Promise<string> => Object.values((await tx.query(sql, params)).rows[0]!)[0] as string
  const approve = (objectType: string, objectId: string) => asUser(tx, secondUserId, () => insertRow(tx, 'approval', {
    tenant_id, object_type: objectType, object_id: objectId, preparer_id: ctx.userId, approver_id: secondUserId,
    decision: 'approved', decided_at: new Date(),
  }))
  await tx.query(`UPDATE run SET review_opened_at = now(), review_opened_by = $2 WHERE id = $1`, [ids.runId, ctx.userId])
  const runApproval = await approve('run', ids.runId)
  await asUser(tx, secondUserId, async () => {
    await tx.query(`UPDATE run SET state = 'committed', approval_id = $2, committed_at = now() WHERE id = $1`, [ids.runId, runApproval])
    for (const state of ['calculating', 'calculated']) await tx.query('UPDATE period SET state = $2 WHERE id = $1', [ids.periodId, state])
    await tx.query(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [ids.periodId, ids.runId])
  })
  const journalEntryId = await one('SELECT led_post_run($1)', [ids.runId])
  await insertRow(tx, 'user_related_participant', {
    tenant_id, user_id: secondUserId, participant_id: ids.participantId, relation: 'relative', declared_by: ctx.userId,
  })
  await tx.query(
    `INSERT INTO gl_account_map (tenant_id, market_id, account_type, gl_code, updated_by) VALUES ($1, $2, 'payee_payable', '2100', $3)`,
    [tenant_id, ids.marketId, ctx.userId],
  )
  const exportJobId = await insertRow(tx, 'export_job', {
    tenant_id, kind: 'gl_journal', requested_by: ctx.userId, state: 'done', created_by_type: 'user',
  })
  const content = randomBytes(16)
  await insertRow(tx, 'journal_export', {
    tenant_id, market_id: ids.marketId, period_id: ids.periodId, export_job_id: exportJobId, content,
    content_sha256: createHash('sha256').update(content).digest(), line_count: 2, debit_total_minor: 100, credit_total_minor: 100,
  })
  const fingerprint = randomBytes(32)
  const requestId = await insertRow(tx, 'bank_detail_request', {
    tenant_id, participant_id: ids.participantId, scheme: 'iban', details_sealed: 'sealed', fingerprint,
    masked: '•••• 3000', created_by: ctx.userId,
  })
  const caseId = await insertRow(tx, 'case_file', {
    tenant_id, type: 'bank_detail', subject_type: 'participant', subject_id: ids.participantId, reason_code: 'PAYEE_REQUEST',
    state: 'open', payload: { request_id: requestId }, market_id: ids.marketId, opened_by: ctx.userId,
  })
  await tx.query(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now(), approvals_required = 1 WHERE id = $1`, [
    caseId, ctx.userId,
  ])
  const caseApproval = await approve('case', caseId)
  await tx.query(`UPDATE case_file SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [caseId, caseApproval])
  const bankDetailVersionId = await insertRow(tx, 'bank_detail_version', {
    tenant_id, participant_id: ids.participantId, scheme: 'iban', details_sealed: 'sealed', fingerprint,
    masked: '•••• 3000', created_via: 'case', request_id: requestId, case_id: caseId, cooling_off_until: new Date(),
  })
  const providerId = await one(`SELECT id FROM provider_config WHERE kind = 'payout'`, [])
  await tx.query(`UPDATE provider_config SET adapter = 'sandbox', webhook_secret_sealed = 'sealed' WHERE id = $1`, [providerId])
  const payoutBatchId = await insertRow(tx, 'payout_batch', {
    tenant_id, market_id: ids.marketId, provider_config_id: providerId, period_id: ids.periodId, total_minor: 100, currency: 'GBP',
    prepared_by: ctx.userId,
  })
  await tx.query(
    `INSERT INTO payout_batch_line (tenant_id, batch_id, participant_id, amount_minor, bank_detail_version_id) VALUES ($1, $2, $3, 100, $4)`,
    [tenant_id, payoutBatchId, ids.participantId, bankDetailVersionId],
  )
  await tx.query(`UPDATE payout_batch SET state = 'reviewed', submitted_by = $2, submitted_at = now() WHERE id = $1`, [payoutBatchId, ctx.userId])
  const batchApproval = await approve('payout_batch', payoutBatchId)
  await tx.query(`UPDATE payout_batch SET state = 'approved', approval_id = $2, approved_at = now() WHERE id = $1`, [payoutBatchId, batchApproval])
  const instructionId = randomUUID()
  await insertRow(tx, 'payout_instruction', {
    id: instructionId, tenant_id, batch_id: payoutBatchId, payee_participant_id: ids.participantId,
    bank_detail_version_id: bankDetailVersionId, amount_minor: 100, currency: 'GBP', idempotency_key: instructionId,
    signature: randomBytes(32), next_attempt_at: new Date(),
  })
  await tx.query(
    `SELECT ledger_post($1, $2, 'payout_instructed', 'payout_instruction', $3, $4, $5, $6)`,
    [ids.marketId, ids.periodId, instructionId, `instr:${instructionId}:instructed`, batchApproval, JSON.stringify([
      { type: 'payee_payable', payee_participant_id: ids.participantId, debit_minor: '100', credit_minor: '0' },
      { type: 'payout_in_transit', payee_participant_id: null, debit_minor: '0', credit_minor: '100' },
    ])],
  )
  await tx.query(`UPDATE payout_batch SET state = 'instructing' WHERE id = $1`, [payoutBatchId])
  await insertRow(tx, 'sandbox_provider_payment', {
    tenant_id, provider_config_id: providerId, idempotency_key: instructionId, amount_minor: 100, currency: 'GBP',
    provider_ref: `sbx_${instructionId}`,
  })
  await insertRow(tx, 'payout_exception', { tenant_id, provider_config_id: providerId, kind: 'unknown_reference', reference: 'sbx_unknown' })
  await insertRow(tx, 'payout_hold', {
    tenant_id, participant_id: ids.participantId, market_id: ids.marketId, reason: 'seed', placed_by: ctx.userId,
  })
  await insertRow(tx, 'tax_profile', {
    tenant_id, participant_id: ids.participantId, residency: 'GB', entity_type: 'individual', valid_from: new Date(),
    created_by: ctx.userId,
  })
  return { journalEntryId, bankDetailVersionId, payoutBatchId, instructionId }
}

/**
 * One row in every B5 tenant table (PLAN B5 section 1): the participant's portal account with a sign-in code, a notice
 * and an email preference, and an access request (system-opened privacy case submitted by the acting user, approved by
 * secondUserId) with its export.
 */
async function seedB5Rows(tx: Tx, ctx: TenantContext, secondUserId: string, participantId: string) {
  const tenant_id = ctx.tenantId
  const portalUserId = await insertRow(tx, 'user_account', {
    tenant_id, realm: 'portal', idp_subject: randomUUID(), email: `portal-${randomUUID()}@example.test`, state: 'active',
    participant_id: participantId,
  })
  await insertRow(tx, 'portal_sign_in_code', { tenant_id, user_id: portalUserId, code_hash: randomBytes(32), expires_at: inOneHour() })
  await tx.query(`SELECT notify_participant($1, 'tax_profile.changed', '{}')`, [participantId])
  await tx.query(`INSERT INTO notification_preference (tenant_id, participant_id, topic, email) VALUES ($1, $2, 'statement', false)`, [
    tenant_id, participantId,
  ])
  const privacyRequestId = randomUUID()
  const caseId = await insertRow(tx, 'case_file', {
    tenant_id, type: 'privacy', subject_type: 'privacy_request', subject_id: privacyRequestId, reason_code: 'RECEIVED_BY_STAFF',
    state: 'open', payload: { request_id: privacyRequestId }, opened_by_kind: 'system',
  })
  await insertRow(tx, 'privacy_request', { id: privacyRequestId, tenant_id, case_id: caseId, type: 'access', channel: 'staff' })
  await tx.query(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [caseId, ctx.userId])
  const approvalId = await asUser(tx, secondUserId, () => insertRow(tx, 'approval', {
    tenant_id, object_type: 'case', object_id: caseId, preparer_id: ctx.userId, approver_id: secondUserId, decision: 'approved',
    decided_at: new Date(),
  }))
  await tx.query(`UPDATE case_file SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [caseId, approvalId])
  await insertRow(tx, 'privacy_export', { tenant_id, request_id: privacyRequestId, content: randomBytes(16) })
  return { portalUserId, privacyRequestId }
}

/**
 * One row in every B6 tenant table (PLAN B6 section 1): a filing on a second plan's version in review, a completed full
 * export with one file, a saved view, and a migration of a migration batch applied by mig_apply_batch, with an opening
 * balance and state row, its opening posted (approved by secondUserId), and a parallel run compared by mig_compare.
 */
async function seedB6Rows(
  tx: Tx, ctx: TenantContext, secondUserId: string,
  ids: { marketId: string; roleId: string; periodId: string; planVersionId: string },
) {
  const tenant_id = ctx.tenantId
  const one = async (sql: string, params: unknown[]): Promise<string> => Object.values((await tx.query(sql, params)).rows[0]!)[0] as string
  const planId = await insertRow(tx, 'plan', { tenant_id, name: 'Seed plan B6', created_by: ctx.userId })
  await tx.query('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [tenant_id, planId, ids.marketId])
  const versionId = await insertRow(tx, 'plan_version', {
    tenant_id, plan_id: planId, version: 1, engine_version: 'seed', compiled: {}, created_by: ctx.userId,
  })
  await tx.query(
    `UPDATE plan_version SET state = 'in_review', crediting_event = 'paid', content_hash = digest(compiled::text, 'sha256'),
       submitted_by = $2, submitted_at = now() WHERE id = $1`,
    [versionId, ctx.userId],
  )
  await insertRow(tx, 'plan_version_filing', {
    tenant_id, plan_version_id: versionId, market_id: ids.marketId, status: 'filed', reference: 'SEED-1', filed_on: '2026-01-02',
    document_id: await insertEvidence(tx, tenant_id, ctx.userId),
  })
  const dataExportId = await insertRow(tx, 'data_export', { tenant_id, trigger: 'manual', model_version: 1, requested_by: ctx.userId })
  await tx.query(`UPDATE data_export SET state = 'running', snapshot_at = now() WHERE id = $1`, [dataExportId])
  await tx.query(
    `INSERT INTO data_export_file (tenant_id, export_id, table_name, row_count, content) VALUES ($1, $2, 'tenant', 1, $3)`,
    [tenant_id, dataExportId, randomBytes(16)],
  )
  const exportJobId = await insertRow(tx, 'export_job', {
    tenant_id, kind: 'full_data', requested_by: ctx.userId, state: 'done', created_by_type: 'user',
  })
  await tx.query(
    `UPDATE data_export SET state = 'completed', export_job_id = $2, manifest = '{}', signature = $3, finished_at = now() WHERE id = $1`,
    [dataExportId, exportJobId, randomBytes(64)],
  )
  await insertRow(tx, 'saved_view', {
    tenant_id, user_id: ctx.userId, list: 'orders', name: 'Seed view', filters: {}, columns: ['order_id'], sort: 'credited_at_desc',
    shared_role_id: ids.roleId,
  })
  const { migrationId, migrationPeriodId } = await seedMigration(tx, ctx, secondUserId, ids)
  const simulationId = await insertRow(tx, 'simulation', {
    tenant_id, plan_version_id: ids.planVersionId, period_id: migrationPeriodId, kind: 'parallel_run', requested_by: ctx.userId,
    content_hash: await one(`SELECT digest(compiled::text, 'sha256') FROM plan_version WHERE id = $1`, [ids.planVersionId]),
  })
  const parallelRunId = await insertRow(tx, 'parallel_run', {
    tenant_id, migration_id: migrationId, simulation_id: simulationId, bonus_map: {},
  })
  await tx.query(`UPDATE simulation SET state = 'running', snapshot_id = (SELECT id FROM run_snapshot LIMIT 1) WHERE id = $1`, [simulationId])
  await tx.query(
    `INSERT INTO sim_result_line (tenant_id, simulation_id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind,
       pass, amount_minor, currency, trace)
     SELECT tenant_id, $1, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass, amount_minor, currency, trace
     FROM result_line LIMIT 1`,
    [simulationId],
  )
  await tx.query(`UPDATE simulation SET state = 'completed', totals = '{}', comparison = '{}', finished_at = now() WHERE id = $1`, [simulationId])
  await tx.query('SELECT mig_compare($1)', [parallelRunId])
  return { migrationId, migrationPeriodId, parallelRunId, dataExportId }
}

/**
 * A migration batch (participant mig-a of type SEED with an order refunded in part, a payout line of the cutover month) applied
 * by mig_apply_batch, cutting over in the open period after periodId, an opening balance and state row, the opening submitted
 * by the acting user and posted with secondUserId's approval.
 */
async function seedMigration(
  tx: Tx, ctx: TenantContext, secondUserId: string, ids: { marketId: string; periodId: string },
): Promise<{ migrationId: string; migrationPeriodId: string }> {
  const tenant_id = ctx.tenantId
  const fact = { tenant_id, source: 'import' }
  const { rows: cutover } = await tx.query<{ id: string }>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
     SELECT tenant_id, calendar_id, ends_at, ends_at + interval '1 month' FROM period WHERE id = $1 RETURNING id`, [ids.periodId])
  const migrationPeriodId = cutover[0]!.id
  const mappingId = await insertRow(tx, 'import_mapping', { tenant_id, version: 2, kind: 'migration', mappings: {}, state: 'draft' })
  const batchId = await insertRow(tx, 'import_batch', {
    tenant_id, market_id: ids.marketId, kind: 'migration', period_from: '2026-01-01', period_to: '2026-02-28', state: 'mapped',
    mapping_id: mappingId, uploaded_by: ctx.userId,
  })
  await insertRow(tx, 'cpl_fact_participant', {
    ...fact, batch_id: batchId, participant_ref: 'mig-a', type_code: 'SEED', counts_as_end_customer: false, can_earn: true,
    enrolled_month: '2026-01-01', market_id: ids.marketId,
  })
  await insertRow(tx, 'cpl_fact_order', {
    ...fact, batch_id: batchId, order_ref: 'mo1', order_date: '2026-01-05', buyer_ref: 'mig-a', amount_minor: 10000,
    volume_minor: 8000, purpose: 'personal', is_starter_kit: false, refunded_minor: 1000, refund_month: '2026-01-01',
  })
  await insertRow(tx, 'cpl_fact_payout_line', {
    ...fact, batch_id: batchId, line_ref: 'ml1', pay_month: '2026-02-01', payee_ref: 'mig-a', bonus_type: 'retail',
    source_kind: 'retail_sale', amount_minor: 500,
  })
  await tx.query(`UPDATE import_batch SET state = 'loaded' WHERE id = $1`, [batchId])
  const migrationId = await insertRow(tx, 'migration', {
    tenant_id, market_id: ids.marketId, import_batch_id: batchId, cutover_period_id: migrationPeriodId, volume_key: 'qv',
  })
  await tx.query('SELECT mig_apply_batch($1)', [migrationId])
  const { rows } = await tx.query<{ participant_id: string; position_id: string }>(
    `SELECT o.participant_id, o.position_id FROM position_ownership o JOIN participant p ON p.id = o.participant_id
     WHERE p.external_ref = 'mig-a'`,
  )
  const { participant_id, position_id } = rows[0]!
  await tx.query('INSERT INTO migration_opening_balance (tenant_id, migration_id, participant_id, amount_minor) VALUES ($1, $2, $3, 250)', [
    tenant_id, migrationId, participant_id,
  ])
  await tx.query(
    `INSERT INTO migration_opening_state (tenant_id, migration_id, position_id, paid_as_rank, highest_titles, counters, carry, one_time_flags)
     VALUES ($1, $2, $3, '[]', '[]', '[]', '[]', '{}')`,
    [tenant_id, migrationId, position_id],
  )
  await tx.query(`UPDATE migration SET state = 'opening_submitted', opening_submitted_by = $2, opening_submitted_at = now() WHERE id = $1`, [
    migrationId, ctx.userId,
  ])
  const approvalId = await asUser(tx, secondUserId, () => insertRow(tx, 'approval', {
    tenant_id, object_type: 'migration', object_id: migrationId, preparer_id: ctx.userId, approver_id: secondUserId,
    decision: 'approved', decided_at: new Date(),
  }))
  const entry = await tx.query<{ id: string }>('SELECT led_post_migration_opening($1, $2) AS id', [migrationId, approvalId])
  await tx.query(`UPDATE migration SET state = 'opening_posted', opening_approval_id = $2, opening_entry_id = $3 WHERE id = $1`, [
    migrationId, approvalId, entry.rows[0]!.id,
  ])
  return { migrationId, migrationPeriodId }
}

export interface VendorSeed {
  baseRoleId: string
  vendorRoleId: string
  supportSessionId: string
}

/** Vendor-owned rows, and a support-session request for tenantId, written as nmp_app in the vendor realm. */
export function seedVendorRows(vendorUserId: string, tenantId: string): Promise<VendorSeed> {
  return withVendor({ userId: vendorUserId }, async (tx) => {
    const platformRole = { permissions: ['user.manage'], mfa_required: true, created_by: vendorUserId }
    const baseRoleId = await insertRow(tx, 'role', { ...platformRole, name: 'Tenant admin', is_base: true })
    const vendorRoleId = await insertRow(tx, 'role', { ...platformRole, name: 'Vendor ops', is_base: false })
    await openSession(tx)
    await tx.query(`INSERT INTO password_credential (user_id, password_hash) VALUES ($1, 'seed')`, [vendorUserId])
    await insertRow(tx, 'audit.vendor_event', {
      actor_type: 'vendor_user', actor_id: vendorUserId, action: 'SUPPORT.REQUEST',
    })
    const supportSessionId = await insertRow(tx, 'support_session', {
      tenant_id: tenantId, requester_id: vendorUserId, reason: 'ticket 1', scope: { modules: ['import'] },
      requested_minutes: 30, state: 'requested',
    })
    return { baseRoleId, vendorRoleId, supportSessionId }
  })
}
