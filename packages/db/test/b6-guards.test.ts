// B6 schema guards and SQL contracts (PLAN B6 section 1.8): plan governance, period close, full exports, saved views,
// migration (kind separation, apply, opening, comparison, sign-off), the B6 erasure change and TK-B5-18.
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '../src/testing.js'
import { seedTenantRows, type TenantSeed } from './seed.js'
import { asUser, closePoolsAfterAll, insertEvidence, insertRow, PERMISSION_DENIED, race } from './support.js'

const CHECK = { code: '23514' }
const NOT_ALLOWED = { code: '42501' }
const UNIQUE = { code: '23505' }

let tenant: TestTenant
let a: TenantContext // staff, prepares
let second: TenantContext // staff, approves
let seed: TenantSeed

closePoolsAfterAll()

const owner = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await getOwnerPool().query(sql, params)).rows as T[]
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], ctx = a): Promise<T[]> =>
  (await withTenant(ctx, (tx) => tx.query(sql, params))).rows as T[]
const value = async <T>(sql: string, params: unknown[] = [], ctx = a): Promise<T> =>
  Object.values((await rows(sql, params, ctx))[0]!)[0] as T
const approve = (objectType: string, objectId: string, approver = second, preparer = approver === a ? second.userId : a.userId) =>
  withTenant(approver, (tx) => insertRow(tx, 'approval', {
    tenant_id: tenant.id, object_type: objectType, object_id: objectId, preparer_id: preparer, approver_id: approver.userId,
    decision: 'approved', decided_at: new Date(),
  }))

/** A settings version in force now with key = value (owner); a key needing an approval with its approved change request. */
async function setSetting(key: string, value: unknown) {
  await owner(
    `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                SELECT $1, 'setting_change_request', $4, $5, $6, 'approved', now(), $6 WHERE $2 = ANY (approval_setting_keys()) RETURNING id),
          v AS (INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
                SELECT $1, (SELECT max(version) + 1 FROM tenant_setting_version WHERE tenant_id = $1), now(),
                       (SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1)
                         || jsonb_build_object($2::text, $3::jsonb), 'FIXTURE', $5, (SELECT id FROM a) RETURNING id, effective_from)
     INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, decided_by,
       decided_at, approval_id, version_id)
     SELECT $4, $1, $2, $3::jsonb, v.effective_from, 'FIXTURE', 0, 'approved', $5, $6, now(), a.id, v.id FROM a, v`,
    [tenant.id, key, JSON.stringify(value), randomUUID(), a.userId, second.userId],
  )
}

/** A draft market with a monthly calendar and one period per start (each to the next start, the last one month long). */
async function marketWithPeriods(
  code: string, zone: string, starts: string[], firstDay = starts[0]!.slice(0, 10),
): Promise<{ marketId: string; periods: string[] }> {
  return withTenant(a, async (tx) => {
    const marketId = await insertRow(tx, 'market', {
      tenant_id: tenant.id, code, currency: 'EUR', minor_unit: 2, time_zone: zone, languages: ['de'], market_pack: 'b6-1', state: 'draft',
    })
    const calendarId = await insertRow(tx, 'calendar', {
      tenant_id: tenant.id, market_id: marketId, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: zone, first_period_start: firstDay,
    })
    const ends = [...starts.slice(1), new Date(new Date(starts.at(-1)!).getTime() + 31 * 86_400_000).toISOString()]
    const periods: string[] = []
    for (const [index, start] of starts.entries()) {
      periods.push(await insertRow(tx, 'period', { tenant_id: tenant.id, calendar_id: calendarId, starts_at: start, ends_at: ends[index] }))
    }
    return { marketId, periods }
  })
}

interface Facts {
  participants: { ref: string; type: string; month: string; servicing?: string }[]
  orders?: { ref: string; date: string; buyer: string; amount: number; volume: number; purpose: string; refunded?: number; refundMonth?: string }[]
  lines?: { ref: string; month: string; payee: string; bonus: string; amount: number }[]
}

/** A loaded migration batch of the market with a migration mapping of its own, its facts written while it is mapped. */
async function migrationBatch(marketId: string, facts: Facts): Promise<string> {
  return withTenant(a, async (tx) => {
    const fact = { tenant_id: tenant.id, source: 'import' }
    const { rows: mapping } = await tx.query<{ id: string }>(
      `INSERT INTO import_mapping (tenant_id, version, kind, mappings, state)
       SELECT $1, max(version) + 1, 'migration', '{}', 'draft' FROM import_mapping RETURNING id`, [tenant.id])
    const batchId = await insertRow(tx, 'import_batch', {
      tenant_id: tenant.id, market_id: marketId, kind: 'migration', period_from: '2026-01-01', period_to: '2026-03-31', state: 'mapped',
      mapping_id: mapping[0]!.id, uploaded_by: a.userId,
    })
    for (const p of facts.participants) {
      await insertRow(tx, 'cpl_fact_participant', {
        ...fact, batch_id: batchId, participant_ref: p.ref, type_code: p.type, counts_as_end_customer: false, can_earn: true,
        enrolled_month: p.month, servicing_ref: p.servicing ?? null, market_id: marketId,
      })
    }
    for (const o of facts.orders ?? []) {
      await insertRow(tx, 'cpl_fact_order', {
        ...fact, batch_id: batchId, order_ref: o.ref, order_date: o.date, buyer_ref: o.buyer, amount_minor: o.amount, volume_minor: o.volume,
        purpose: o.purpose, is_starter_kit: false, refunded_minor: o.refunded ?? 0, refund_month: o.refundMonth ?? null,
      })
    }
    for (const l of facts.lines ?? []) {
      await insertRow(tx, 'cpl_fact_payout_line', {
        ...fact, batch_id: batchId, line_ref: l.ref, pay_month: l.month, payee_ref: l.payee, bonus_type: l.bonus,
        source_kind: 'other', amount_minor: l.amount,
      })
    }
    await tx.query(`UPDATE import_batch SET state = 'loaded' WHERE id = $1`, [batchId])
    return batchId
  })
}

const newMigration = (marketId: string, batchId: string, cutover: string) => withTenant(a, (tx) => insertRow(tx, 'migration', {
  tenant_id: tenant.id, market_id: marketId, import_batch_id: batchId, cutover_period_id: cutover, volume_key: 'qv',
}))

/** mig_apply_batch's refusal: SQLSTATE MG001 with the findings in DETAIL. */
async function applyFindings(migrationId: string): Promise<unknown> {
  const error = await rows('SELECT mig_apply_batch($1)', [migrationId]).then(() => null, (e: { code?: string; detail?: string }) => e)
  expect(error).toMatchObject({ code: 'MG001' })
  return JSON.parse(error!.detail!)
}

beforeAll(async () => {
  await resetTestDb()
  tenant = await createTenant({ slug: 'acme' })
  a = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  second = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  seed = await seedTenantRows(a, second.userId)
  // An active end-customer type that holds no positions (owner: the seed's SEED type both holds and is serviced).
  await owner(
    `INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state, reason,
       requested_by, decided_by, decided_at, approval_id)
     VALUES ($1, 'CUST', 'Customer', false, true, false, false, 'active', 'b6', $2, $3, now(), $4)`,
    [tenant.id, a.userId, second.userId, seed.approvalId],
  )
})

describe('plan governance (section 1.1)', () => {
  test('a filing is insert-only, for a plan market of a version in review or approved, with its evidence', async () => {
    const [version] = await rows<{ id: string; plan_id: string }>(
      `SELECT v.id, v.plan_id FROM plan_version v JOIN plan p ON p.id = v.plan_id WHERE p.name = 'Seed plan B6'`)
    const filing = (row: Record<string, unknown>, ctx = a) => withTenant(ctx, async (tx) => insertRow(tx, 'plan_version_filing', {
      tenant_id: tenant.id, plan_version_id: version!.id, market_id: seed.marketId, document_id: await insertEvidence(tx, tenant.id, ctx.userId),
      ...row,
    }))
    const other = await marketWithPeriods('FI', 'UTC', ['2026-01-01T00:00:00Z'])

    await expect(filing({ status: 'filed' })).rejects.toMatchObject(CHECK) // reference and date missing
    await expect(filing({ status: 'not_required' })).rejects.toMatchObject(CHECK) // note missing
    await expect(filing({ status: 'acknowledged', reference: 'A-1', filed_on: '2026-01-03', market_id: other.marketId }))
      .rejects.toMatchObject(CHECK) // not a market of the plan
    await expect(filing({ status: 'filed', reference: 'S-1', filed_on: '2026-01-02', plan_version_id: seed.planVersionId }))
      .rejects.toMatchObject(CHECK) // a draft version
    await filing({ status: 'not_required', note: 'Counsel: no filing for this change' })
    await expect(rows(`UPDATE plan_version_filing SET note = 'x' WHERE plan_version_id = $1`, [version!.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(owner(`DELETE FROM plan_version_filing WHERE plan_version_id = $1`, [version!.id])).rejects.toThrow(/not allowed/)
  })

  test('plan_filing_missing lists the required plan markets without a filing; none while the setting is unset', async () => {
    const plan = await withTenant(a, async (tx) => {
      const planId = await insertRow(tx, 'plan', { tenant_id: tenant.id, name: `Unfiled ${randomUUID()}`, created_by: a.userId })
      await tx.query('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [tenant.id, planId, seed.marketId])
      return insertRow(tx, 'plan_version', { tenant_id: tenant.id, plan_id: planId, version: 1, engine_version: 'seed', created_by: a.userId })
    })
    const [filed] = await rows<{ id: string }>(`SELECT v.id FROM plan_version v JOIN plan p ON p.id = v.plan_id WHERE p.name = 'Seed plan B6'`)

    expect(await value('SELECT plan_filing_missing($1)', [plan])).toEqual([])
    await setSetting('plan.filing_requirements', { market_ids: [seed.marketId] })
    expect(await value('SELECT plan_filing_missing($1)', [plan])).toEqual([seed.marketId])
    expect(await value('SELECT plan_filing_missing($1)', [filed!.id])).toEqual([])
  })

  test('the notice is recorded once, in the transaction that schedules the version', async () => {
    const schedulable = async () => {
      const [version] = await owner<{ id: string }>(
        `WITH p AS (INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id),
              m AS (INSERT INTO plan_market (tenant_id, plan_id, market_id) SELECT $1, id, $4 FROM p)
         INSERT INTO plan_version (tenant_id, plan_id, version, state, engine_version, crediting_event, compiled, content_hash, submitted_by,
           submitted_at, approval_id, created_by)
         SELECT $1, id, 1, 'approved', 'seed', 'paid', '{}', digest('{}', 'sha256'), $3, now(), $5, $3 FROM p RETURNING id`,
        [tenant.id, `Noticed ${randomUUID()}`, a.userId, seed.marketId, seed.approvalId],
      )
      return version!.id
    }
    const schedule = `UPDATE plan_version SET state = 'scheduled', activation_approval_id = $2, effective_from = now() + interval '1 day',
                        justification = 'go' WHERE id = $1`
    const notice = `UPDATE plan_version SET notice_sent_at = now(), notice_recipients = 3 WHERE id = $1`
    const inOneTransaction = async (statements: string[], id: string) => {
      const client = await getOwnerPool().connect()
      try {
        await client.query('BEGIN')
        for (const sql of statements) await client.query(sql, sql === schedule ? [id, seed.approvalId] : sql.includes('$1') ? [id] : [])
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
    const [scheduledHere, inSavepoint, later] = [await schedulable(), await schedulable(), await schedulable()]
    await inOneTransaction([schedule, notice], scheduledHere)
    // The schedule route: decideAcrossMarkets' savepoint, then the notice after notify_plan_change, after activation.
    await inOneTransaction(['SAVEPOINT plan_sod_decision', schedule, 'RELEASE SAVEPOINT plan_sod_decision',
      `UPDATE plan_version SET state = 'active', activated_at = now() WHERE id = $1`, notice], inSavepoint)
    await owner(schedule, [later, seed.approvalId])

    await expect(owner(notice, [later])).rejects.toMatchObject(CHECK) // another transaction
    await expect(owner(notice, [scheduledHere])).rejects.toMatchObject(CHECK) // once
    expect(await owner('SELECT state, notice_recipients FROM plan_version WHERE id = $1', [inSavepoint]))
      .toEqual([{ state: 'active', notice_recipients: 3 }])
    await expect(owner(`UPDATE plan_version SET notice_sent_at = now() WHERE id = $1`, [seed.planVersionId])).rejects.toMatchObject(CHECK)
  })

  test('crediting event and width: the version in force, else the earliest version, else NULL (D-B6-05)', async () => {
    const { marketId } = await marketWithPeriods('CE', 'UTC', ['2026-01-01T00:00:00Z'])
    const none = await marketWithPeriods('NO', 'UTC', ['2026-01-01T00:00:00Z'])
    const version = async (from: string, event: string, width: number) => owner(
      `WITH p AS (INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id),
            m AS (INSERT INTO plan_market (tenant_id, plan_id, market_id) SELECT $1, id, $4 FROM p)
       INSERT INTO plan_version (tenant_id, plan_id, version, state, engine_version, crediting_event, placement_width, compiled, content_hash,
         submitted_by, submitted_at, approval_id, activation_approval_id, effective_from, justification, created_by)
       SELECT $1, id, 1, 'scheduled', 'seed', $5, $6, '{}', digest('{}', 'sha256'), $3, now(), $7, $7, $8, 'go', $3 FROM p`,
      [tenant.id, `Timed ${randomUUID()}`, a.userId, marketId, event, width, seed.approvalId, from],
    )
    await version('2030-01-01T00:00:00Z', 'fulfilled', 4)
    await version('2031-01-01T00:00:00Z', 'paid', 5)

    expect(await value(`SELECT plan_crediting_event($1, '2026-06-01')`, [marketId])).toBe('fulfilled')
    expect(await value(`SELECT plan_crediting_event($1, '2031-06-01')`, [marketId])).toBe('paid')
    expect(await value('SELECT placement_width_for($1)', [marketId])).toBe(4)
    expect(await value(`SELECT plan_crediting_event($1, now())`, [none.marketId])).toBeNull()
    expect(await value('SELECT placement_width_for($1)', [none.marketId])).toBeNull()
  })
})

describe('period close (section 1.2)', () => {
  test('blockers of each kind, ordered by kind then id; the guard refuses a close while any is left', async () => {
    const [instruction] = await rows<{ provider_config_id: string }>(
      `SELECT b.provider_config_id FROM payout_batch b WHERE b.id = $1`, [seed.payoutBatchId])
    const [exception] = await owner<{ id: string }>(
      `INSERT INTO payout_exception (tenant_id, provider_config_id, kind, instruction_id, reference) VALUES ($1, $2, 'amount_mismatch', $3, 'r')
       RETURNING id`, [tenant.id, instruction!.provider_config_id, seed.instructionId])
    const [returned] = await owner<{ id: string }>(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by_kind)
       VALUES ($1, 'returned_payment', 'payout_instruction', $2, 'RETURNED_BY_BANK', 'open', '{}', $3, 'system') RETURNING id`,
      [tenant.id, seed.instructionId, seed.marketId])
    const [restatement] = await owner<{ id: string }>(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by, submitted_by, submitted_at)
       VALUES ($1, 'restatement', 'period', $2, 'INPUT_CORRECTION', 'submitted', '{}', $3, $4, $4, now()) RETURNING id`,
      [tenant.id, seed.periodId, seed.marketId, a.userId])
    const [late] = await rows<{ id: string }>('SELECT id FROM late_transaction WHERE original_period_id = $1', [seed.periodId])

    expect(await value('SELECT period_close_blockers($1)', [seed.periodId])).toEqual([
      { kind: 'late_item_pending', late_id: late!.id },
      { kind: 'payout_batch_open', batch_id: seed.payoutBatchId },
      { kind: 'payout_exception', exception_id: exception!.id },
      { kind: 'payout_in_transit', instruction_id: seed.instructionId },
      { kind: 'restatement_open', case_id: restatement!.id },
      { kind: 'returned_payment_case', case_id: returned!.id },
    ])
    await owner(`UPDATE period SET state = 'paid' WHERE id = $1`, [seed.periodId])
    await expect(rows(`UPDATE period SET state = 'closed', closed_at = now(), closed_by = $2, close_note = 'n' WHERE id = $1`,
      [seed.periodId, a.userId])).rejects.toMatchObject(CHECK)
    await owner(`UPDATE period SET state = 'committed' WHERE id = $1`, [seed.periodId])
  })

  test('period_close stores the export carrying every entry; closed is terminal, takes no posting and no attribution', async () => {
    const { marketId, periods } = await marketWithPeriods('FR', 'UTC', ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'])
    const [first, latest] = periods as [string, string]
    // An entry in the later period (owner: no run behind it) and its journal export.
    const runId = randomUUID()
    const client = await getOwnerPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [tenant.id, a.userId])
      await client.query(`SELECT ledger_post($1, $2, 'run_committed', 'run', $3, $4, $5, $6)`, [marketId, latest, runId, `run:${runId}`,
        seed.approvalId, JSON.stringify([
          { type: 'commission_expense', payee_participant_id: null, debit_minor: '700', credit_minor: '0' },
          { type: 'payee_payable', payee_participant_id: seed.participantId, debit_minor: '0', credit_minor: '700' },
        ])])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    const exportOf = async (debit: number) => {
      const [job] = await owner<{ id: string }>(
        `INSERT INTO export_job (tenant_id, kind, requested_by, state, created_by_type) VALUES ($1, 'gl_journal', $2, 'done', 'user') RETURNING id`,
        [tenant.id, a.userId])
      const [made] = await owner<{ id: string }>(
        `INSERT INTO journal_export (tenant_id, market_id, period_id, export_job_id, content, content_sha256, line_count, debit_total_minor,
           credit_total_minor, created_by) VALUES ($1, $2, $3, $4, '\\x00', digest('\\x00'::bytea, 'sha256'), 2, $5, $5, $6) RETURNING id`,
        [tenant.id, marketId, latest, job!.id, debit, a.userId])
      return made!.id
    }
    const [partial, complete] = [await exportOf(500), await exportOf(700)]
    await owner(`UPDATE period SET state = 'paid' WHERE id = ANY ($1)`, [periods])
    const closeDirectly = (period: string, journalExport: string | null) => rows(
      `UPDATE period SET state = 'closed', closed_at = now(), closed_by = $2, close_note = 'n', close_journal_export_id = $3 WHERE id = $1`,
      [period, a.userId, journalExport])

    await expect(closeDirectly(first, complete)).rejects.toMatchObject(CHECK) // another period's export
    await expect(closeDirectly(latest, null)).rejects.toMatchObject(CHECK) // entries without an export
    await expect(rows('SELECT period_close($1, $2, $3)', [first, 'n', null], second)).resolves.toBeDefined()
    await expect(rows('SELECT period_close($1, $2, $3)', [latest, 'n', null])).rejects.toMatchObject(CHECK) // has entries
    await expect(rows('SELECT period_close($1, $2, $3)', [latest, 'n', partial])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE period SET close_note = 'x' WHERE id = $1`, [latest])).rejects.toMatchObject(CHECK) // not a close
    await expect(rows(`UPDATE period SET state = 'closed', closed_at = now(), closed_by = $2, close_note = 'n' WHERE id = $1`,
      [latest, second.userId])).rejects.toMatchObject(NOT_ALLOWED) // closed by someone else
    expect(await value('SELECT led_attribution_period($1)', [marketId])).toBe(latest)
    await rows('SELECT period_close($1, $2, $3)', [latest, 'Reconciled', complete])

    expect(await rows('SELECT state, closed_by, close_note, close_journal_export_id FROM period WHERE id = ANY ($1) ORDER BY starts_at', [periods]))
      .toEqual([
        { state: 'closed', closed_by: second.userId, close_note: 'n', close_journal_export_id: null },
        { state: 'closed', closed_by: a.userId, close_note: 'Reconciled', close_journal_export_id: complete },
      ])
    expect(await value('SELECT led_attribution_period($1)', [marketId])).toBeNull() // closed periods are skipped
    await expect(rows(`UPDATE period SET state = 'paid' WHERE id = $1`, [first])).rejects.toMatchObject(CHECK)
    await expect(rows('SELECT period_close($1, $2, $3)', [first, 'n', null])).rejects.toMatchObject({ ...CHECK, detail: 'closed' })
    const writeOff = randomUUID()
    await expect(rows(`SELECT ledger_post($1, $2, 'write_off', 'case', $3, $4, $5, $6)`, [marketId, first, writeOff, `writeoff:${writeOff}`,
      seed.approvalId, JSON.stringify([
        { type: 'write_off', payee_participant_id: null, debit_minor: '1', credit_minor: '0' },
        { type: 'clawback_receivable', payee_participant_id: seed.participantId, debit_minor: '0', credit_minor: '1' },
      ])])).rejects.toMatchObject({ ...CHECK, detail: 'period_closed' })
    await expect(rows(`INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id)
                       VALUES ($1, $2, $3, 'write_off', 'case', $4, $5, $6)`, [tenant.id, marketId, first, writeOff, `direct:${writeOff}`, seed.approvalId]))
      .rejects.toMatchObject({ ...CHECK, detail: 'period_closed' }) // not through ledger_post either
  })
})

describe('full data export (section 1.3)', () => {
  test('one export runs at a time; files are written while it runs and deleted once it expired', async () => {
    const queued = await withTenant(a, (tx) => insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'manual', model_version: 1 }))
    const file = (exportId: string) => rows(
      `INSERT INTO data_export_file (tenant_id, export_id, table_name, row_count, content) VALUES ($1, $2, 'plan', 0, '\\x01')`,
      [tenant.id, exportId])

    await expect(withTenant(a, (tx) => insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'schedule', model_version: 1 })))
      .rejects.toMatchObject(UNIQUE)
    await expect(withTenant(a, (tx) => insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'manual', model_version: 1, state: 'running' })))
      .rejects.toMatchObject(CHECK)
    await expect(file(queued)).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE data_export SET state = 'completed' WHERE id = $1`, [queued])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE data_export SET state = 'running', snapshot_at = now() WHERE id = $1`, [queued])
    await file(queued)
    expect(await rows(`SELECT byte_size::int, encode(content_sha256, 'hex') AS sha FROM data_export_file WHERE export_id = $1`, [queued]))
      .toEqual([{ byte_size: 1, sha: '4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a' }])
    await expect(rows(`DELETE FROM data_export_file WHERE export_id = $1`, [queued])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE data_export SET state = 'failed', finished_at = now() WHERE id = $1`, [queued])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE data_export SET state = 'failed', error = '{"code": "X"}', finished_at = now() WHERE id = $1`, [queued])
    await expect(rows(`UPDATE data_export SET state = 'running' WHERE id = $1`, [queued])).rejects.toMatchObject(CHECK)
    await rows(`DELETE FROM data_export_file WHERE export_id = $1`, [queued]) // a failed export's files
    await rows(`UPDATE data_export SET state = 'expired' WHERE id = $1`, [seed.dataExportId])
    await expect(rows(`UPDATE data_export SET manifest = '{"x": 1}' WHERE id = $1`, [seed.dataExportId])).rejects.toMatchObject(CHECK)
    await rows(`DELETE FROM data_export_file WHERE export_id = $1`, [seed.dataExportId])
    expect(await value('SELECT count(*)::int FROM data_export_file WHERE export_id = $1', [seed.dataExportId])).toBe(0)
  })

  test('the schedule window of each cadence, and the tenants due in the system realm only', async () => {
    const window = (schedule: unknown, at: string) => value<Date | null>('SELECT int_full_export_window($1, $2)', [schedule, at])

    expect(await window({ cadence: 'daily', hour_utc: 10 }, '2026-11-20T09:00:00Z')).toEqual(new Date('2026-11-19T10:00:00Z'))
    expect(await window({ cadence: 'daily', hour_utc: 10 }, '2026-11-20T10:00:00Z')).toEqual(new Date('2026-11-20T10:00:00Z'))
    expect(await window({ cadence: 'weekly', hour_utc: 3 }, '2026-11-20T09:00:00Z')).toEqual(new Date('2026-11-16T03:00:00Z'))
    expect(await window({ cadence: 'monthly', hour_utc: 2 }, '2026-11-01T01:00:00Z')).toEqual(new Date('2026-10-01T02:00:00Z'))
    expect(await window({ cadence: 'daily', hour_utc: 24 }, '2026-11-20T09:00:00Z')).toBeNull()
    expect(await window(null, '2026-11-20T09:00:00Z')).toBeNull()

    const due = async () => (await withSystem((tx) => tx.query<{ tenant_id: string }>('SELECT tenant_id FROM int_due_full_exports()')))
      .rows.map((row) => row.tenant_id)
    expect(await due()).not.toContain(tenant.id)
    await setSetting('exports.full_schedule', { cadence: 'daily', hour_utc: 0 })
    expect(await due()).toContain(tenant.id)
    await expect(rows('SELECT * FROM int_due_full_exports()')).rejects.toMatchObject(NOT_ALLOWED)
    const scheduled = await withTenant(a, (tx) => insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'schedule', model_version: 1 }))
    expect(await due()).not.toContain(tenant.id)
    await rows(`UPDATE data_export SET state = 'failed', error = '{"code": "X"}', finished_at = now() WHERE id = $1`, [scheduled])
  })
})

describe('full data export and erasure (D-B6-13)', () => {
  test('an erasure never waits for a running generation, whose completion then fails with 40001 and rolls its files back', async () => {
    const exportId = await withTenant(a, async (tx) => {
      const id = await insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'manual', model_version: 1 })
      await tx.query(`UPDATE data_export SET state = 'running', snapshot_at = now() WHERE id = $1`, [id])
      return id
    })

    const generation = withTenant(a, async (tx) => {
      await tx.query(`INSERT INTO data_export_file (tenant_id, export_id, table_name, row_count, content) VALUES ($1, $2, 'plan', 0, '\\x01')`,
        [tenant.id, exportId])
      await withTenant(a, async (erasure) => {
        await erasure.query(`SET LOCAL lock_timeout = '2s'`)
        await erasure.query(`UPDATE data_export SET state = 'failed', error = '{"code": "ERASED_DURING_EXPORT"}', finished_at = now() WHERE id = $1`,
          [exportId])
      })
      await tx.query(`UPDATE data_export SET state = 'completed' WHERE id = $1`, [exportId])
    }, { isolation: 'repeatable read' })

    await expect(generation).rejects.toMatchObject({ code: '40001' })
    expect(await value('SELECT state FROM data_export WHERE id = $1', [exportId])).toBe('failed')
    expect(await value('SELECT count(*)::int FROM data_export_file WHERE export_id = $1', [exportId])).toBe(0)
  })
})

describe('saved views (section 1.4)', () => {
  test('owner-only writes, a role of the tenant or a base role, one default and at most 50 per user and list', async () => {
    const other = await createTenant()
    const [foreignRole] = await owner<{ id: string }>(
      `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, 'Foreign', '{}', false, false) RETURNING id`, [other.id])
    const [baseRole] = await owner<{ id: string }>(
      `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES (NULL, 'Base B6', '{}', true, false) RETURNING id`)
    const view = (name: string, extra: Record<string, unknown> = {}, ctx = a) => withTenant(ctx, (tx) => insertRow(tx, 'saved_view', {
      tenant_id: tenant.id, user_id: a.userId, list: 'ledger_entries', name, filters: {}, columns: ['posted_at'], sort: 'posted_at_desc', ...extra,
    }))

    await expect(view('foreign', { shared_role_id: foreignRole!.id })).rejects.toMatchObject(CHECK)
    const shared = await view('base', { shared_role_id: baseRole!.id, is_default: true })
    await expect(view('second default', { is_default: true })).rejects.toMatchObject(UNIQUE)
    await expect(view('not mine', {}, second)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`UPDATE saved_view SET name = 'x' WHERE id = $1`, [shared], second)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`DELETE FROM saved_view WHERE id = $1`, [shared], second)).rejects.toMatchObject(NOT_ALLOWED)
    for (let n = 2; n <= 50; n += 1) await view(`view ${n}`)
    await expect(view('view 51')).rejects.toMatchObject(CHECK)
    await rows(`UPDATE saved_view SET name = 'renamed', updated_at = now() WHERE id = $1`, [shared])
  })
})

describe('migration kinds (section 1.6, D-B6-09)', () => {
  test('a migration batch or mapping never outdates a ready snapshot; an overlay mapping version does', async () => {
    const [snapshot] = await owner<{ id: string }>(
      `INSERT INTO compliance_report_snapshot (tenant_id, market_id, period_from, period_to, method_version, mapping_id, settings_version_id,
         input_refs, state, created_by, inputs_hash)
       VALUES ($1, $2, '2026-01-01', '2026-01-31', 'm1', $3::uuid, $4, jsonb_build_object('batch_ids', cpl_loaded_batch_ids($1, $2, '2026-01-01', '2026-01-31'),
         'mapping_ids', jsonb_build_array($3::text)), 'ready', $5, '\\x00') RETURNING id`,
      [tenant.id, seed.marketId, seed.mappingId, seed.settingsVersionId, a.userId])
    const state = () => value<string>('SELECT state FROM compliance_report_snapshot WHERE id = $1', [snapshot!.id])

    expect(await value(`SELECT cpl_loaded_batch_ids($1, $2, '2026-01-01', '2026-01-31')`, [tenant.id, seed.marketId])).toEqual([seed.batchId])
    await migrationBatch(seed.marketId, { participants: [{ ref: 'kind-a', type: 'SEED', month: '2026-01-01' }] })
    const [migrationMapping] = await rows<{ id: string }>(`SELECT id FROM import_mapping WHERE kind = 'migration' ORDER BY version DESC LIMIT 1`)
    await expect(rows(`UPDATE import_mapping SET kind = 'overlay' WHERE id = $1`, [migrationMapping!.id])).rejects.toThrow(/keeps its kind/)
    await rows(`UPDATE import_mapping SET state = 'approved', approved_by = $2 WHERE id = $1`, [migrationMapping!.id, a.userId])
    expect(await state()).toBe('ready')
    await expect(withTenant(a, (tx) => insertRow(tx, 'import_batch', {
      tenant_id: tenant.id, market_id: seed.marketId, kind: 'overlay', period_from: '2026-01-01', period_to: '2026-01-31', state: 'mapped',
      mapping_id: migrationMapping!.id, uploaded_by: a.userId,
    }))).rejects.toMatchObject(CHECK)
    await rows(`INSERT INTO import_mapping (tenant_id, version, mappings, state) SELECT $1, max(version) + 1, '{}', 'draft' FROM import_mapping`,
      [tenant.id])
    expect(await state()).toBe('outdated')
  })
})

describe('migration apply (section 1.6, T-B6-41)', () => {
  const C_MONTH = '2026-03-01'
  let at: { marketId: string; periods: string[] }
  let migrationId: string

  beforeAll(async () => {
    at = await marketWithPeriods('AT', 'Europe/Vienna', [
      '2025-12-31T23:00:00Z', '2026-01-31T23:00:00Z', '2026-02-28T23:00:00Z', '2026-03-31T22:00:00Z',
    ], '2026-01-01')
  })

  test('every refusal is one finding and nothing is written; a draft cancels and frees its market', async () => {
    const before = await value<number>('SELECT count(*)::int FROM participant')
    const refused = await newMigration(at.marketId, await migrationBatch(at.marketId, {
      participants: [
        { ref: 'x-unknown', type: 'NOPE', month: '2026-01-01' }, { ref: 'seed-distributor', type: 'SEED', month: '2026-01-01' },
        { ref: 'x-cust', type: 'CUST', month: '2026-01-01' }, { ref: 'x-cust2', type: 'CUST', month: '2026-01-01', servicing: 'x-cust' },
        { ref: 'x-orphan', type: 'SEED', month: '2026-01-01', servicing: 'nobody' },
      ],
      orders: [{ ref: 'xo1', date: '2026-01-05', buyer: 'nobody', amount: 100, volume: 100, purpose: 'personal' }],
    }), at.periods[2]!)

    expect(await applyFindings(refused)).toEqual([
      { code: 'BUYER_UNKNOWN', ref: 'xo1', detail: 'nobody' },
      { code: 'PARTICIPANT_EXISTS', ref: 'seed-distributor', detail: null },
      { code: 'REFERENCE_UNKNOWN', ref: 'x-orphan', detail: 'nobody' },
      { code: 'SERVICER_WITHOUT_POSITION', ref: 'x-cust2', detail: 'x-cust' },
      { code: 'TYPE_UNKNOWN', ref: 'x-unknown', detail: 'NOPE' },
    ])
    await rows(`UPDATE migration SET state = 'cancelled' WHERE id = $1`, [refused])

    const broken = await newMigration(at.marketId, await migrationBatch(at.marketId, {
      participants: [{ ref: 'ok-1', type: 'SEED', month: '2026-01-01' }, { ref: 'bad ref', type: 'SEED', month: '2026-01-01' }],
    }), at.periods[2]!)
    expect(await applyFindings(broken)).toEqual([{ code: 'WRITE_REFUSED', ref: 'bad ref', detail: expect.stringMatching(/^23514: /) }])
    expect(await value('SELECT count(*)::int FROM participant')).toBe(before)
    expect(await value('SELECT state FROM migration WHERE id = $1', [broken])).toBe('draft')
    await rows(`UPDATE migration SET state = 'cancelled' WHERE id = $1`, [broken])
  })

  test('a migration cuts over in an open period without a run: none snapshotted C before it, and its opening posts into C', async () => {
    const batchId = await migrationBatch(at.marketId, { participants: [{ ref: 'cut-1', type: 'SEED', month: '2026-01-01' }] })
    await owner(`UPDATE period SET state = 'calculated' WHERE id = $1`, [at.periods[3]])

    await expect(newMigration(at.marketId, batchId, at.periods[3]!)).rejects.toMatchObject(CHECK)
    await owner(`UPDATE period SET state = 'open' WHERE id = $1`, [at.periods[3]])
  })

  test('apply writes participants, positions, sponsors, servicing, orders and refunds once; applied never cancels', async () => {
    const batchId = await migrationBatch(at.marketId, {
      participants: [
        { ref: 'AT-A', type: 'SEED', month: '2026-01-01' }, { ref: 'AT-B', type: 'SEED', month: '2026-01-01', servicing: 'AT-A' },
        { ref: 'AT-C', type: 'SEED', month: '2026-01-01', servicing: 'AT-B' }, { ref: 'CU-1', type: 'CUST', month: '2026-02-01', servicing: 'AT-A' },
      ],
      orders: [
        { ref: 'AT-O0', date: '2026-02-10', buyer: 'AT-A', amount: 10000, volume: 10000, purpose: 'personal' },
        { ref: 'AT-O1', date: '2026-03-05', buyer: 'CU-1', amount: 10000, volume: 8001, purpose: 'customer', refunded: 5000, refundMonth: C_MONTH },
      ],
      lines: [
        { ref: 'L1', month: C_MONTH, payee: 'AT-A', bonus: 'unilevel', amount: 800 }, { ref: 'L2', month: C_MONTH, payee: 'AT-A', bonus: 'unilevel', amount: 1500 },
        { ref: 'L3', month: C_MONTH, payee: 'AT-B', bonus: 'unilevel', amount: 2401 }, { ref: 'L4', month: C_MONTH, payee: 'AT-C', bonus: 'retail', amount: 500 },
        { ref: 'L5', month: C_MONTH, payee: 'ghost', bonus: 'retail', amount: 700 },
      ],
    })
    await expect(newMigration(at.marketId, seed.batchId, at.periods[2]!)).rejects.toMatchObject(CHECK) // an overlay batch
    migrationId = await newMigration(at.marketId, batchId, at.periods[2]!)
    await expect(newMigration(at.marketId, batchId, at.periods[2]!)).rejects.toMatchObject(UNIQUE)

    expect(await value('SELECT mig_apply_batch($1)', [migrationId])).toEqual({
      participants: 4, positions: 3, relationships: 2, servicing: 1, orders: 2, refund_events: 1,
    })
    await expect(rows('SELECT mig_apply_batch($1)', [migrationId])).rejects.toMatchObject({ ...CHECK, detail: 'applied' })
    await expect(rows(`UPDATE migration SET state = 'cancelled' WHERE id = $1`, [migrationId])).rejects.toMatchObject(CHECK)
    expect(await rows(`SELECT external_ref, enrolled_at FROM participant WHERE external_ref IN ('AT-A', 'CU-1') ORDER BY 1`)).toEqual([
      { external_ref: 'AT-A', enrolled_at: new Date('2025-12-31T23:00:00Z') }, { external_ref: 'CU-1', enrolled_at: new Date('2026-01-31T23:00:00Z') },
    ])
    expect(await rows(
      `SELECT c.external_ref AS child, s.external_ref AS sponsor, r.event_type FROM relationship r
       JOIN position_ownership co ON co.position_id = r.child_position_id JOIN participant c ON c.id = co.participant_id
       JOIN position_ownership so ON so.position_id = r.parent_position_id JOIN participant s ON s.id = so.participant_id
       WHERE c.market_id = $1 ORDER BY 1`, [at.marketId])).toEqual([
      { child: 'AT-B', sponsor: 'AT-A', event_type: 'migration' }, { child: 'AT-C', sponsor: 'AT-B', event_type: 'migration' },
    ])
    expect(await rows(
      `SELECT s.source, p.external_ref AS servicer FROM customer_servicing s JOIN participant c ON c.id = s.customer_id
       JOIN position_ownership o ON o.position_id = s.servicing_position_id JOIN participant p ON p.id = o.participant_id
       WHERE c.external_ref = 'CU-1'`)).toEqual([{ source: 'migration', servicer: 'AT-A' }])
    expect(await rows(
      `SELECT o.source_system, o.purpose, o.attribution_source, o.credited_at, o.period_id, l.sku, l.volumes, e.volume_effect -> 'total' AS refunded,
              e.occurred_at, i.source AS inbound
       FROM sales_order o JOIN order_line l ON l.order_id = o.id JOIN order_event e ON e.order_id = o.id
       JOIN inbound_event i ON i.id = o.inbound_event_id WHERE o.source_order_id = 'AT-O1'`)).toEqual([{
      source_system: `migration:${migrationId}`, purpose: 'customer', attribution_source: 'servicing', credited_at: new Date('2026-03-04T23:00:00Z'),
      period_id: at.periods[2], sku: 'MIGRATED', volumes: { qv: '8001' }, refunded: { qv: '-4001' }, occurred_at: new Date('2026-03-04T23:00:00Z'),
      inbound: `migration:${migrationId}`,
    }])
    expect(await value('SELECT mig_period_blocker($1)', [at.periods[2]])).toEqual({ migration_id: migrationId, state: 'applied' })
    expect(await value('SELECT mig_period_blocker($1)', [at.periods[1]])).toBeNull()
    expect(await value('SELECT mig_market_ready($1)', [at.marketId])).toBe(false)
  })

  test('the opening posts once, by payee, with an approval by someone other than its submitter, and is then frozen', async () => {
    const id = (ref: string) => value<string>('SELECT id FROM participant WHERE external_ref = $1', [ref])
    const [atA, atC] = [await id('AT-A'), await id('AT-C')]
    const position = await value<string>('SELECT position_id FROM position_ownership WHERE participant_id = $1', [atA])
    const otherMarket = await value<string>('SELECT id FROM participant WHERE external_ref = $1', ['seed-distributor'])
    await rows(`INSERT INTO migration_opening_balance (tenant_id, migration_id, participant_id, amount_minor) VALUES ($1, $2, $3, 1250), ($1, $2, $4, -300)`,
      [tenant.id, migrationId, atA, atC])
    await expect(rows(`INSERT INTO migration_opening_balance (tenant_id, migration_id, participant_id, amount_minor) VALUES ($1, $2, $3, 1)`,
      [tenant.id, migrationId, otherMarket])).rejects.toMatchObject(CHECK)
    await rows(
      `INSERT INTO migration_opening_state (tenant_id, migration_id, position_id, paid_as_rank, highest_titles, counters, carry, one_time_flags, banked)
       VALUES ($1, $2, $3, '[]', '[{"ladder": "main", "rank": "R1"}]', '[]', '[]', '{}', '[{"key": "b", "amountMinor": "5"}]')`,
      [tenant.id, migrationId, position])
    await expect(rows(`UPDATE migration SET state = 'opening_submitted', opening_submitted_by = $2, opening_submitted_at = now() WHERE id = $1`,
      [migrationId, second.userId])).rejects.toMatchObject(NOT_ALLOWED)
    await rows(`UPDATE migration SET state = 'opening_submitted', opening_submitted_by = $2, opening_submitted_at = now() WHERE id = $1`,
      [migrationId, a.userId])
    await expect(rows(`DELETE FROM migration_opening_balance WHERE migration_id = $1`, [migrationId])).rejects.toMatchObject(CHECK)
    const bySubmitter = await approve('migration', migrationId, a)
    await expect(rows('SELECT led_post_migration_opening($1, $2)', [migrationId, bySubmitter])).rejects.toMatchObject(NOT_ALLOWED)
    const approval = await approve('migration', migrationId)
    const entry = await value<string>('SELECT led_post_migration_opening($1, $2)', [migrationId, approval])
    await expect(rows(`UPDATE migration SET state = 'opening_posted', opening_approval_id = $2, opening_entry_id = $3 WHERE id = $1`,
      [migrationId, bySubmitter, entry])).rejects.toMatchObject(NOT_ALLOWED)
    await rows(`UPDATE migration SET state = 'opening_posted', opening_approval_id = $2, opening_entry_id = $3 WHERE id = $1`,
      [migrationId, approval, entry])

    expect(await value('SELECT led_post_migration_opening($1, $2)', [migrationId, approval])).toBe(entry) // posted once
    expect(await rows('SELECT event_type, origin_type, idempotency_key, period_id FROM journal_entry WHERE id = $1', [entry])).toEqual([{
      event_type: 'migration_opening', origin_type: 'migration', idempotency_key: `migration:${migrationId}:opening`, period_id: at.periods[2],
    }])
    expect(await value(`SELECT led_balance($1, $2, 'payee_payable')`, [at.marketId, atA])).toBe('1250')
    expect(await value(`SELECT led_balance($1, $2, 'clawback_receivable')`, [at.marketId, atC])).toBe('300')
    await expect(rows(`INSERT INTO migration_opening_balance (tenant_id, migration_id, participant_id, amount_minor) VALUES ($1, $2, $3, 1)`,
      [tenant.id, migrationId, await id('AT-B')])).rejects.toMatchObject(CHECK)
    expect(await rows('SELECT position_id, banked FROM mig_opening_state_for($1)', [at.periods[2]])).toEqual([
      { position_id: position, banked: [{ key: 'b', amountMinor: '5' }] },
    ])
    await rows(`INSERT INTO gl_account_map (tenant_id, market_id, account_type, gl_code, updated_by) VALUES ($1, $2, 'migration_clearing', '1990', $3)`,
      [tenant.id, at.marketId, a.userId])
  })

  test('the comparison: per payee and mapped rule, one payee-level row for unmapped bonuses, a legacy payee without participant', async () => {
    const simulation = (tx: Tx) => tx.query<{ id: string }>(
      `INSERT INTO simulation (tenant_id, plan_version_id, period_id, kind, content_hash, requested_by)
       SELECT tenant_id, id, $2, 'parallel_run', digest(compiled::text, 'sha256'), $3 FROM plan_version WHERE id = $1 RETURNING id`,
      [seed.planVersionId, at.periods[2], a.userId]).then((result) => result.rows[0]!.id)
    await expect(withTenant(a, simulation)).rejects.toMatchObject(CHECK) // committed without its parallel run
    const runId = await withTenant(a, async (tx) => {
      const simulationId = await simulation(tx)
      const runId = await insertRow(tx, 'parallel_run', {
        tenant_id: tenant.id, migration_id: migrationId, simulation_id: simulationId, bonus_map: { unilevel: 'unilevel' },
      })
      await tx.query(`UPDATE simulation SET state = 'running', snapshot_id = (SELECT id FROM run_snapshot LIMIT 1) WHERE id = $1`, [simulationId])
      await tx.query(
        `INSERT INTO sim_result_line (tenant_id, simulation_id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass,
           amount_minor, currency, trace)
         SELECT $1, $2, o.position_id, p.id, 'unilevel', 'pay.unilevel', 'downline_volume', 4, x.amount, 'EUR', '{}'
         FROM (VALUES ('AT-A', 2300), ('AT-B', 2400)) AS x (ref, amount)
         JOIN participant p ON p.external_ref = x.ref JOIN position_ownership o ON o.participant_id = p.id`,
        [tenant.id, simulationId])
      await tx.query(`UPDATE simulation SET state = 'completed', totals = '{}', comparison = '{}', finished_at = now() WHERE id = $1`, [simulationId])
      return runId
    })
    await expect(rows(`UPDATE parallel_run SET state = 'compared' WHERE id = $1`, [runId])).rejects.toMatchObject(CHECK)
    await expect(rows('SELECT * FROM mig_due_comparisons(10)')).rejects.toMatchObject(NOT_ALLOWED)
    expect((await withSystem((tx) => tx.query('SELECT * FROM mig_due_comparisons(10)'))).rows)
      .toContainEqual({ tenant_id: tenant.id, parallel_run_id: runId })

    const summary = { state: 'compared', differences: 4, legacy_total_minor: '5901', platform_total_minor: '4700', error: null }
    expect(await value('SELECT mig_compare($1)', [runId])).toEqual(summary)
    expect(await value('SELECT mig_compare($1)', [runId])).toEqual(summary) // idempotent
    expect(await rows(
      `SELECT payee_ref, participant_id IS NOT NULL AS known, rule_key, legacy_bonus_types, bonus_detail, legacy_minor, platform_minor, delta_minor
       FROM parallel_run_difference WHERE parallel_run_id = $1 ORDER BY payee_ref`, [runId])).toEqual([
      { payee_ref: 'AT-A', known: true, rule_key: 'unilevel', legacy_bonus_types: ['unilevel'], bonus_detail: true, legacy_minor: '2300', platform_minor: '2300', delta_minor: '0' },
      { payee_ref: 'AT-B', known: true, rule_key: 'unilevel', legacy_bonus_types: ['unilevel'], bonus_detail: true, legacy_minor: '2401', platform_minor: '2400', delta_minor: '-1' },
      { payee_ref: 'AT-C', known: true, rule_key: null, legacy_bonus_types: ['retail'], bonus_detail: false, legacy_minor: '500', platform_minor: '0', delta_minor: '-500' },
      { payee_ref: 'ghost', known: false, rule_key: null, legacy_bonus_types: ['retail'], bonus_detail: false, legacy_minor: '700', platform_minor: '0', delta_minor: '-700' },
    ])
    const zero = await value<string>(`SELECT id FROM parallel_run_difference WHERE parallel_run_id = $1 AND payee_ref = 'AT-A'`, [runId])
    await expect(rows(`UPDATE parallel_run_difference SET class = 'data', class_note = 'n', classified_by = $2, classified_at = now() WHERE id = $1`,
      [zero, a.userId])).rejects.toMatchObject(CHECK) // nothing to explain

    // A newer request supersedes; a failed simulation fails its run with the simulation's code.
    await rows(`UPDATE parallel_run SET state = 'superseded' WHERE id = $1`, [runId])
    await expect(rows(`UPDATE parallel_run_difference SET class = 'data', class_note = 'n', classified_by = $2, classified_at = now()
                       WHERE parallel_run_id = $1 AND payee_ref = 'AT-B'`, [runId, a.userId])).rejects.toMatchObject(CHECK)
    const failed = await withTenant(a, async (tx) => {
      const id = await simulation(tx)
      const run = await insertRow(tx, 'parallel_run', { tenant_id: tenant.id, migration_id: migrationId, simulation_id: id, bonus_map: {} })
      await tx.query(`UPDATE simulation SET state = 'failed', error = '{"code": "ENGINE_ERROR"}', finished_at = now() WHERE id = $1`, [id])
      return run
    })
    expect(await value('SELECT mig_compare($1)', [failed])).toMatchObject({ state: 'failed', differences: 0, error: { code: 'ENGINE_ERROR' } })
  })
})

describe('sign-off (section 1.6, D-B6-11)', () => {
  test('needs every non-zero difference accepted by a non-classifier, then a sign-off by neither creator nor classifier', async () => {
    const differences = await rows<{ id: string; delta_minor: string }>(
      'SELECT id, delta_minor FROM parallel_run_difference WHERE parallel_run_id = $1 ORDER BY payee_ref', [seed.parallelRunId])
    const signOff = (approval: string) => rows(
      `UPDATE migration SET state = 'signed_off', signoff_approval_id = $2, signed_off_at = now() WHERE id = $1`, [seed.migrationId, approval])
    const accept = (id: string, approval: string, ctx = second) => rows(
      `UPDATE parallel_run_difference SET acceptance_approval_id = $2, accepted_at = now() WHERE id = $1`, [id, approval], ctx)

    expect(differences.map((d) => d.delta_minor)).toEqual(['-500', '100'])
    expect(await value('SELECT mig_period_blocker($1)', [seed.migrationPeriodId])).toEqual({ migration_id: seed.migrationId, state: 'opening_posted' })
    await expect(signOff(await approve('migration', seed.migrationId))).rejects.toMatchObject(CHECK) // unexplained
    for (const d of differences) {
      await rows(`UPDATE parallel_run_difference SET class = 'data', class_note = 'Legacy data', classified_by = $2, classified_at = now() WHERE id = $1`,
        [d.id, a.userId])
    }
    await expect(rows(`UPDATE parallel_run_difference SET class = 'rule', class_note = 'x', classified_by = $2, classified_at = now() WHERE id = $1`,
      [differences[0]!.id, second.userId])).rejects.toMatchObject(NOT_ALLOWED) // classified as someone else
    await expect(accept(differences[0]!.id, await approve('parallel_run_difference', differences[0]!.id, a), a)).rejects.toMatchObject(NOT_ALLOWED)
    for (const d of differences) await accept(d.id, await approve('parallel_run_difference', d.id))
    await expect(rows(`UPDATE parallel_run_difference SET class_note = 'later' WHERE id = $1`, [differences[0]!.id])).rejects.toMatchObject(CHECK)

    await expect(signOff(await approve('migration', seed.migrationId, a))).rejects.toMatchObject(NOT_ALLOWED) // creator and classifier
    await signOff(await approve('migration', seed.migrationId))
    expect(await value('SELECT mig_period_blocker($1)', [seed.migrationPeriodId])).toBeNull()
    expect(await value('SELECT mig_market_ready($1)', [seed.marketId])).toBe(true)
  })
})

describe('B6 tables in a portal session (D-B6-13)', () => {
  test('are hidden', async () => {
    const portal = { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId }
    for (const table of ['data_export', 'data_export_file', 'saved_view', 'migration_opening_balance', 'migration_opening_state', 'parallel_run_difference']) {
      expect(await value(`SELECT count(*)::int FROM ${table}`, [], portal)).toBe(0)
    }
  })
})

describe('erasure (TK-B5-18, D-B6-13)', () => {
  test('opening an adjustment holds the erasure lock of the position owner shared, so the erasure waits', async () => {
    const result = await race(a,
      (tx) => insertRow(tx, 'case_file', {
        tenant_id: tenant.id, type: 'adjustment', subject_type: 'position', subject_id: seed.positionId, reason_code: 'OTHER', state: 'open',
        payload: {}, market_id: seed.marketId, opened_by: a.userId,
      }),
      (tx) => tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('erase:' || $1 || ':' || $2, 0))`, [tenant.id, seed.participantId]))

    expect(result).toEqual({ waited: true, outcome: { ok: true } })
  })

  test('expires completed full exports (files deleted) and fails unfinished ones', async () => {
    const [subject] = await owner<{ id: string }>(
      `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
       VALUES ($1, 'erase-me', 'individual', $2, now(), $3, 'system') RETURNING id`, [tenant.id, seed.marketId, a.userId])
    const completed = await withTenant(a, async (tx) => {
      const id = await insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'manual', model_version: 1 })
      await tx.query(`UPDATE data_export SET state = 'running', snapshot_at = now() WHERE id = $1`, [id])
      await tx.query(`INSERT INTO data_export_file (tenant_id, export_id, table_name, row_count, content) VALUES ($1, $2, 'plan', 0, '\\x01')`,
        [tenant.id, id])
      const job = await insertRow(tx, 'export_job', { tenant_id: tenant.id, kind: 'full_data', requested_by: a.userId, state: 'done', created_by_type: 'user' })
      await tx.query(`UPDATE data_export SET state = 'completed', export_job_id = $2, manifest = '{}', signature = $3, finished_at = now() WHERE id = $1`,
        [id, job, randomBytes(64)])
      return id
    })
    const failed = await withTenant(a, async (tx) => {
      const id = await insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'manual', model_version: 1 })
      await tx.query(`UPDATE data_export SET state = 'running', snapshot_at = now() WHERE id = $1`, [id])
      await tx.query(`INSERT INTO data_export_file (tenant_id, export_id, table_name, row_count, content) VALUES ($1, $2, 'plan', 0, '\\x01')`,
        [tenant.id, id])
      return id
    })
    await rows(`UPDATE data_export SET state = 'failed', error = '{"code": "X"}', finished_at = now() WHERE id = $1`, [failed])
    const queued = await withTenant(a, (tx) => insertRow(tx, 'data_export', { tenant_id: tenant.id, trigger: 'manual', model_version: 1 }))
    const requestId = randomUUID()
    const [opened] = await owner<{ id: string }>(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, opened_by_kind)
       VALUES ($1, 'privacy', 'privacy_request', $2, 'RECEIVED_BY_STAFF', 'open', $3, 'system') RETURNING id`,
      [tenant.id, requestId, { request_id: requestId, participant_id: subject!.id }])
    await owner(
      `INSERT INTO privacy_request (id, tenant_id, case_id, type, channel, subject_participant_id, verified_at, verified_by, verification_method, created_by)
       VALUES ($1, $2, $3, 'erasure', 'staff', $4, now(), $5, 'contact_match', $5)`, [requestId, tenant.id, opened!.id, subject!.id, a.userId])
    await withTenant(a, async (tx) => {
      await tx.query(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [opened!.id, a.userId])
      const approvalId = await asUser(tx, second.userId, () => insertRow(tx, 'approval', {
        tenant_id: tenant.id, object_type: 'case', object_id: opened!.id, preparer_id: a.userId, approver_id: second.userId, decision: 'approved',
        decided_at: new Date(),
      }))
      await tx.query(`UPDATE case_file SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [opened!.id, approvalId])
    })

    const erased = await value<{ cleared: string[]; exports: unknown[] }>('SELECT prv_erase_participant($1)', [requestId])

    expect(erased.cleared).toContain('data_export_file.content')
    // Returned for the caller's EXPORT.EXPIRED / EXPORT.FAILED audit events (the already failed export is not among them).
    expect(erased.exports).toEqual(expect.arrayContaining([{ id: completed, state: 'expired' }, { id: queued, state: 'failed' }]))
    expect(erased.exports).not.toContainEqual(expect.objectContaining({ id: failed }))
    expect(await rows('SELECT id, state, error FROM data_export WHERE id = ANY ($1) ORDER BY state', [[completed, queued]])).toEqual([
      { id: completed, state: 'expired', error: null }, { id: queued, state: 'failed', error: { code: 'ERASED_DURING_EXPORT' } },
    ])
    expect(await value('SELECT count(*)::int FROM data_export_file WHERE export_id = ANY ($1)', [[completed, failed]])).toBe(0)
  })
})
