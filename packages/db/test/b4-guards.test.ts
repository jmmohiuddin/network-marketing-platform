// Behaviour of the B4 tables, guards and shared SQL (PLAN B4 sections 1 and 4.2; migrations 0400-0406) as the runtime role
// nmp_app. Test ids: TS-38 / AC-14.2 (posting builder), TS-39 / AC-14.3 (immutability), T-B4-01 (ledger_post), T-B4-02
// (commit posting cases), T-B4-03 (control, residue), T-B4-06 (receivables gate), T-B4-19 (Paid), AC-FIN3-1, TS-11
// (DB part), D-B4-09/10/12..17/21 guards.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertEvidence, insertMarket, insertRow, PERMISSION_DENIED } from './support.js'

const CHECK = { code: '23514' }
const NOT_ALLOWED = { code: '42501' }
const UNIQUE = { code: '23505' }

// a prepares and opens, b approves, c is a second approver.
let a: TenantContext
let b: TenantContext
let c: TenantContext
let marketId: string
let periods: string[] // monthly, 2025
let settingsVersionId: string
let planVersionId: string
let providerId: string
const payees: { participant: string; position: string }[] = []

closePoolsAfterAll()

const as = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant(ctx, fn)
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], ctx = a): Promise<T[]> =>
  (await as(ctx, (tx) => tx.query(sql, params))).rows as T[]
const value = async <T>(sql: string, params: unknown[] = [], ctx = a): Promise<T> =>
  Object.values((await rows(sql, params, ctx))[0]!)[0] as T
const approval = (ctx: TenantContext, objectType: string, objectId: string, preparer = a.userId) =>
  as(ctx, (tx) => insertRow(tx, 'approval', {
    tenant_id: ctx.tenantId, object_type: objectType, object_id: objectId, preparer_id: preparer, approver_id: ctx.userId,
    decision: 'approved', decided_at: new Date(),
  }))
const balance = (participant: string | null, type: string) =>
  value<string>('SELECT led_balance($1, $2, $3)', [marketId, participant, type])
const line = (type: string, payee: string | null, debit: string, credit: string) =>
  ({ type, payee_participant_id: payee, debit_minor: debit, credit_minor: credit })

interface Settled { payee: number; gross: number; before?: number; netted?: number; withheld?: number }

/**
 * A run of the period, calculated with these settlements (and one result line per payee for its gross, plus extra lines),
 * committed by b; origins its lines carry are consumed in the commit transaction.
 */
async function committedRun(period: number, settled: Settled[], extra: { residue?: string; lines?: object[] } = {}): Promise<string> {
  const periodId = periods[period]!
  const content = randomBytes(8)
  const runId = await as(a, async (tx) => {
    const snapshotId = await insertRow(tx, 'run_snapshot', {
      tenant_id: a.tenantId, period_id: periodId, known_at: new Date(), content, content_sha256: createHash('sha256').update(content).digest(),
      row_counts: {}, order_ids: [], order_event_ids: [],
    })
    const id = await insertRow(tx, 'run', {
      tenant_id: a.tenantId, period_id: periodId, run_request_id: randomUUID(), plan_version_id: planVersionId,
      settings_version_id: settingsVersionId, engine_version: '0.2.0', prepared_by: a.userId,
    })
    await tx.query(`UPDATE run SET state = 'running', snapshot_id = $2 WHERE id = $1`, [id, snapshotId])
    await tx.query(`UPDATE period SET state = 'calculating' WHERE id = $1`, [periodId])
    let gross = 0
    for (const s of settled) {
      const netted = s.netted ?? (s.gross < 0 ? s.gross : 0)
      const withheld = s.withheld ?? 0
      gross += s.gross
      await tx.query(
        `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor,
           withheld_minor, net_payable_minor) VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [id, payees[s.payee]!.participant, s.gross, s.before ?? 0, netted, withheld, s.gross - netted - withheld],
      )
      await insertRow(tx, 'result_line', resultLine(id, s.payee, s.gross))
    }
    for (const extraLine of extra.lines ?? []) await insertRow(tx, 'result_line', { ...resultLine(id, 0, 0), ...extraLine })
    const lines = (await tx.query<{ n: string }>('SELECT coalesce(sum(amount_minor), 0) AS n FROM result_line WHERE run_id = $1', [id])).rows[0]!.n
    await tx.query(
      `UPDATE run SET state = 'calculated', totals = jsonb_build_object('gross_minor', $2::text, 'residue_minor', $3::text),
         inputs_hash = 'i', lines_hash = 'l', outputs = '{}', finished_at = now() WHERE id = $1`,
      [id, lines, extra.residue ?? '0'],
    )
    await tx.query('UPDATE run SET review_opened_at = now(), review_opened_by = $2 WHERE id = $1', [id, a.userId])
    await tx.query(`UPDATE period SET state = 'calculated' WHERE id = $1`, [periodId])
    expect(Number(lines)).toBe(gross + (extra.lines ?? []).reduce((sum, l) => sum + Number((l as { amount_minor: number }).amount_minor), 0))
    return id
  })
  const approvalId = await approval(b, 'run', runId)
  await as(b, async (tx) => {
    await tx.query(`UPDATE run SET state = 'committed', approval_id = $2, committed_at = now() WHERE id = $1`, [runId, approvalId])
    await tx.query(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [periodId, runId])
    await tx.query(
      `UPDATE adjustment_origin SET consumed_run_id = $1
       WHERE id IN (SELECT origin_id FROM result_line WHERE run_id = $1 AND origin_id IS NOT NULL)`, [runId])
  })
  return runId
}

const resultLine = (runId: string, payee: number, amount: number) => ({
  tenant_id: a.tenantId, run_id: runId, payee_position_id: payees[payee]!.position, payee_participant_id: payees[payee]!.participant,
  rule_key: 'pv', bonus_type: 'pay.flat', source_kind: 'other', pass: 4, amount_minor: amount, currency: 'GBP', trace: {},
})

const postRun = (runId: string) => value<string | null>('SELECT led_post_run($1)', [runId])
const postings = (entryId: string) => rows<{ type: string; payee: string | null; debit_minor: string; credit_minor: string }>(
  `SELECT a.type, a.payee_participant_id AS payee, x.debit_minor, x.credit_minor FROM posting x JOIN ledger_account a ON a.id = x.account_id
   WHERE x.entry_id = $1 ORDER BY a.type, x.debit_minor`, [entryId])

/** A case of the type opened and submitted by a (approvals pinned), ready for a decision. */
async function submittedCase(type: string, subjectType: string, subjectId: string, payload: object, approvalsRequired = 1): Promise<string> {
  const caseId = await as(a, (tx) => insertRow(tx, 'case_file', {
    tenant_id: a.tenantId, type, subject_type: subjectType, subject_id: subjectId, reason_code: 'OTHER', state: 'open', payload,
    market_id: marketId, opened_by: a.userId,
  }))
  await rows(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now(), approvals_required = $3 WHERE id = $1`,
    [caseId, a.userId, approvalsRequired])
  return caseId
}

async function approveCase(caseId: string, ctx = b): Promise<string> {
  const approvalId = await approval(ctx, 'case', caseId)
  await rows(`UPDATE case_file SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [caseId, approvalId], ctx)
  return approvalId
}

/** The participant's current bank-detail version, through an approved bank_detail case of a's request (as requested). */
async function bankVersion(payee: number, versionFingerprint?: Buffer): Promise<string> {
  const participant = payees[payee]!.participant
  const fingerprint = randomBytes(32)
  const requestId = await as(a, (tx) => insertRow(tx, 'bank_detail_request', {
    tenant_id: a.tenantId, participant_id: participant, scheme: 'iban', details_sealed: 'sealed', fingerprint,
    masked: '•••• 3000', created_by: a.userId,
  }))
  const caseId = await submittedCase('bank_detail', 'participant', participant, { request_id: requestId })
  await approveCase(caseId)
  return as(b, async (tx) => {
    await tx.query('UPDATE bank_detail_version SET superseded_at = now() WHERE participant_id = $1 AND superseded_at IS NULL', [participant])
    return insertRow(tx, 'bank_detail_version', {
      tenant_id: a.tenantId, participant_id: participant, scheme: 'iban', details_sealed: 'sealed', fingerprint: versionFingerprint ?? fingerprint,
      masked: '•••• 3000', created_via: 'case', request_id: requestId, case_id: caseId, cooling_off_until: new Date(),
    })
  })
}

beforeAll(async () => {
  await resetTestDb()
  const tenantId = (await createTenant()).id
  const user = async () => ({ tenantId, userId: (await createUser({ tenantId })).id })
  ;[a, b, c] = [await user(), await user(), await user()]
  ;({ marketId, periods, settingsVersionId, planVersionId, providerId } = await as(a, async (tx) => {
    const market = await insertMarket(tx, tenantId)
    const calendar = await insertRow(tx, 'calendar', {
      tenant_id: tenantId, market_id: market, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: 'UTC', first_period_start: '2025-01-01',
    })
    const ids: string[] = []
    for (let month = 0; month < 12; month++) {
      const start = new Date(Date.UTC(2025, month, 1))
      ids.push(await insertRow(tx, 'period', {
        tenant_id: tenantId, calendar_id: calendar, starts_at: start, ends_at: new Date(Date.UTC(2025, month + 1, 1)),
      }))
    }
    const settings = await insertRow(tx, 'tenant_setting_version', {
      tenant_id: tenantId, version: 1, effective_from: '2024-01-01', settings: {}, reason: 'test', created_by: a.userId,
    })
    const plan = await insertRow(tx, 'plan', { tenant_id: tenantId, name: 'Plan', created_by: a.userId })
    const version = await insertRow(tx, 'plan_version', {
      tenant_id: tenantId, plan_id: plan, version: 1, engine_version: '0.2.0', compiled: {}, created_by: a.userId,
    })
    const provider = await insertRow(tx, 'provider_config', {
      tenant_id: tenantId, market_id: market, kind: 'payout', provider: 'Sandbox payouts', approved_description: 'test',
      approval_document_id: await insertEvidence(tx, tenantId, a.userId), approved_at: '2025-01-01', funds_holder: 'Provider',
      state: 'recorded', created_by: a.userId,
    })
    return { marketId: market, periods: ids, settingsVersionId: settings, planVersionId: version, providerId: provider }
  }))
  const typeId = await as(a, (tx) => insertRow(tx, 'participant_type', {
    tenant_id: tenantId, code: 'DIST', name: 'Distributor', can_earn: true, counts_as_end_customer: true, can_sponsor: true,
    can_hold_positions: true, state: 'pending', reason: 'test', requested_by: a.userId,
  }))
  const typeApproval = await approval(b, 'participant_type', typeId)
  await rows(`UPDATE participant_type SET state = 'active', decided_by = $2, decided_at = now(), approval_id = $3 WHERE id = $1`,
    [typeId, b.userId, typeApproval], b)
  for (const ref of ['p-1', 'p-2', 'p-3']) {
    const participant = await value<string>(`SELECT id FROM par_create_customer($1, $2, $3, '2024-12-01')`, [ref, marketId, typeId])
    const position = await value<string>(`SELECT gen_create_position($1, $2, NULL, NULL, 'active', '2024-12-01')`, [participant, marketId])
    payees.push({ participant, position })
  }
})

describe('ledger_post (T-B4-01, BR-LED-01)', () => {
  test('posts one balanced entry, creates accounts on first use and returns the entry again for its key', async () => {
    const runId = await committedRun(0, [{ payee: 0, gross: 123456, withheld: 2469 }])
    const entryId = await postRun(runId)

    expect(entryId).not.toBeNull()
    // TS-38 / AC-14.2: expense 1,234.56 = payable 1,209.87 + withholding 24.69.
    expect(await postings(entryId!)).toEqual([
      { type: 'commission_expense', payee: null, debit_minor: '123456', credit_minor: '0' },
      { type: 'payee_payable', payee: payees[0]!.participant, debit_minor: '0', credit_minor: '120987' },
      { type: 'withholding_payable', payee: null, debit_minor: '0', credit_minor: '2469' },
    ])
    expect(await postRun(runId)).toBe(entryId)
    expect(await value('SELECT count(*)::int FROM journal_entry WHERE origin_id = $1', [runId])).toBe(1)
    expect(await value('SELECT currency FROM ledger_account WHERE type = $1', ['commission_expense'])).toBe('GBP')
    // A second key reuse naming another origin is refused.
    await expect(value(`SELECT ledger_post($1, $2, 'run_committed', 'run', $3, $4, NULL, '[]')`,
      [marketId, periods[0], randomUUID(), `run:${runId}`])).rejects.toMatchObject(UNIQUE)
  })

  test('refuses unbalanced, two-sided, negative or numeric lines and a missing approval', async () => {
    const runId = await value<string>('SELECT committed_run_id FROM period WHERE id = $1', [periods[0]])
    const approvalId = await value<string>('SELECT approval_id FROM run WHERE id = $1', [runId])
    const post = (lines: object[], approval: string | null = approvalId) => value(
      `SELECT ledger_post($1, $2, 'run_committed', 'run', $3, $4, $5, $6)`,
      [marketId, periods[0], runId, `test:${randomUUID()}`, approval, JSON.stringify(lines)])
    const expense = line('commission_expense', null, '100', '0')

    await expect(post([expense, line('payee_payable', payees[0]!.participant, '0', '99')])).rejects.toMatchObject(CHECK)
    await expect(post([line('commission_expense', null, '100', '100'), line('payee_payable', payees[0]!.participant, '0', '0')]))
      .rejects.toMatchObject(CHECK)
    await expect(post([expense, line('payee_payable', payees[0]!.participant, '0', '-100')])).rejects.toMatchObject(CHECK)
    await expect(post([expense, { ...line('payee_payable', payees[0]!.participant, '0', '0'), credit_minor: 100 }])).rejects.toMatchObject(CHECK)
    await expect(post([expense, line('payee_payable', null, '0', '100')])).rejects.toMatchObject(CHECK) // payee-level account
    await expect(post([expense, line('payee_payable', payees[0]!.participant, '0', '100')], null)).rejects.toMatchObject(NOT_ALLOWED) // not the run's approval
    // One entry per origin and event: the key names them, so a posted run cannot be posted again under another key.
    await expect(value(`SELECT ledger_post($1, $2, 'run_committed', 'run', $3, 'run:again', $4, $5)`,
      [marketId, periods[0], runId, approvalId, JSON.stringify([expense, line('payee_payable', payees[0]!.participant, '0', '100')])]))
      .rejects.toMatchObject(CHECK)
    expect(await value('SELECT count(*)::int FROM journal_entry WHERE origin_id = $1', [runId])).toBe(1)
  })

  test('a market keeps its currency once its ledger uses it (C-14)', async () => {
    await expect(rows(`UPDATE market SET currency = 'EUR' WHERE id = $1`, [marketId])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE market SET currency = 'GBP' WHERE id = $1`, [marketId]) // unchanged: allowed
  })

  test('posts only for an existing origin of its market and period, with its approval (no human posting route)', async () => {
    const lines = JSON.stringify([line('write_off', null, '5', '0'), line('clawback_receivable', payees[0]!.participant, '0', '5')])

    await expect(value(`SELECT ledger_post($1, $2, 'write_off', 'case', $3, $4, $5, $6)`,
      [marketId, periods[0], randomUUID(), `writeoff:${randomUUID()}`, await approval(b, 'case', randomUUID()), lines]))
      .rejects.toMatchObject(NOT_ALLOWED)
  })

  test('an entry gets all its postings in one statement and at least two; nothing joins it later', async () => {
    const entryId = await value<string>('SELECT id FROM journal_entry LIMIT 1')
    const account = await value<string>(`SELECT id FROM ledger_account WHERE type = 'commission_expense'`)
    const add = (debit: number, credit: number) => rows(
      `INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
       VALUES (app_tenant_id(), $1, $2, $3, $4, 'GBP'), (app_tenant_id(), $1, $2, $4, $3, 'GBP')`, [entryId, account, debit, credit])

    await expect(add(5, 0)).rejects.toMatchObject(CHECK) // balanced pair, but the entry already has postings
    await expect(rows(
      `INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency) VALUES (app_tenant_id(), $1, $2, 5, 0, 'EUR')`,
      [entryId, account])).rejects.toMatchObject(CHECK) // not the account's currency
    const runId = await committedRun(10, [])
    const approvalId = await value<string>('SELECT approval_id FROM run WHERE id = $1', [runId])
    await expect(rows(
      `INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id)
       VALUES (app_tenant_id(), $1, $2, 'run_committed', 'run', $3, $5, $4)`, [marketId, periods[10], runId, approvalId, `run:${runId}`]))
      .rejects.toMatchObject(CHECK) // no postings by COMMIT
  })

  test('journal entries and postings never change (TS-39, AC-14.3)', async () => {
    const entryId = await value<string>('SELECT id FROM journal_entry LIMIT 1')

    await expect(rows('UPDATE journal_entry SET idempotency_key = $2 WHERE id = $1', [entryId, 'x'])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('DELETE FROM posting WHERE entry_id = $1', [entryId])).rejects.toThrow(PERMISSION_DENIED)
    for (const sql of ['UPDATE journal_entry SET posted_at = now() WHERE id = $1', 'DELETE FROM posting WHERE entry_id = $1']) {
      await expect(getOwnerPool().query(sql, [entryId])).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/^LEDGER_IMMUTABLE/) })
    }
  })
})

describe('led_post_run (T-B4-02, T-B4-03, T-B4-06, AC-FIN3-1, AC-20.3)', () => {
  test('a clawback reduces the outstanding payable first, then books a receivable; later earnings net it', async () => {
    const [p] = [payees[1]!.participant]
    await postRun(await committedRun(1, [{ payee: 1, gross: 2300 }]))
    expect(await balance(p, 'payee_payable')).toBe('2300')

    await postRun(await committedRun(2, [{ payee: 1, gross: -1000 }])) // AC-FIN3-1
    expect([await balance(p, 'payee_payable'), await balance(p, 'clawback_receivable')]).toEqual(['1300', '0'])

    await postRun(await committedRun(3, [{ payee: 1, gross: -2000 }]))
    expect([await balance(p, 'payee_payable'), await balance(p, 'clawback_receivable')]).toEqual(['0', '700'])
    expect(await rows('SELECT participant_id, amount_minor FROM led_receivable_balances($1)', [marketId]))
      .toEqual([{ participant_id: p, amount_minor: '700' }])

    // The engine nets 500 of new earnings against the 700 receivable (snapshot value).
    await postRun(await committedRun(4, [{ payee: 1, gross: 500, before: 700, netted: 500 }]))
    expect([await balance(p, 'payee_payable'), await balance(p, 'clawback_receivable')]).toEqual(['0', '200'])
    const [receivable] = await rows<{ participant_id: string; amount_minor: string; outstanding_since: Date }>(
      'SELECT * FROM led_receivables($1)', [marketId])
    const firstPositive = await value<Date>(
      `SELECT e.posted_at FROM journal_entry e WHERE e.origin_id = (SELECT committed_run_id FROM period WHERE id = $1)`, [periods[3]])
    expect(receivable).toEqual({ participant_id: p, amount_minor: '200', outstanding_since: firstPositive })
    expect(await value('SELECT led_attribution_period($1)', [marketId])).toBe(periods[4]) // the latest commit
  })

  test('refuses a run whose receivables moved since calculation (LD001), a residue and a control mismatch', async () => {
    const stale = await committedRun(5, [{ payee: 1, gross: 100, before: 999, netted: 100 }])
    await expect(postRun(stale)).rejects.toMatchObject({ code: 'LD001', detail: JSON.stringify([payees[1]!.participant]) })

    await expect(postRun(await committedRun(6, [{ payee: 2, gross: 100 }], { residue: '1' }))).rejects.toMatchObject(CHECK)

    const tampered = await committedRun(7, [{ payee: 2, gross: 100 }])
    await getOwnerPool().query(
      `INSERT INTO result_line (tenant_id, run_id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass,
         amount_minor, currency, trace) VALUES ($1, $2, $3, $4, 'pv', 'pay.flat', 'other', 4, 1, 'GBP', '{}')`,
      [a.tenantId, tampered, payees[2]!.position, payees[2]!.participant])
    await expect(postRun(tampered)).rejects.toMatchObject(CHECK)
    expect(await value('SELECT count(*)::int FROM journal_entry WHERE origin_id = ANY ($1)', [[stale, tampered]])).toBe(0)
  })

  test('a run with nothing to post has no entry (E-PER-08), and a run that is not committed is not posted', async () => {
    expect(await postRun(await value<string>('SELECT committed_run_id FROM period WHERE id = $1', [periods[10]]))).toBeNull()
    await expect(postRun(randomUUID())).rejects.toMatchObject(CHECK)
  })
})

describe('manual adjustments and second approvals (D-B4-09, D-B4-10)', () => {
  test("an approved adjustment becomes one manual origin of an open period, paid by that period's run", async () => {
    const payload = (period: number) => ({ period_id: periods[period], amount_minor: '500', note: 'goodwill' })
    const origin = (caseId: string, period: number) => as(a, (tx) => insertRow(tx, 'adjustment_origin', {
      tenant_id: a.tenantId, origin_type: 'manual', case_id: caseId, payee_position_id: payees[2]!.position, rule_key: 'manual_adjustment',
      source_kind: 'other', amount_minor: 500, original_period_id: periods[period],
    }))
    const open = await submittedCase('adjustment', 'position', payees[2]!.position, payload(8))
    await expect(origin(open, 8)).rejects.toMatchObject(CHECK) // not approved yet
    await approveCase(open)
    await expect(origin(open, 9)).rejects.toMatchObject(CHECK) // not the payload's period
    const originId = await origin(open, 8)
    await expect(origin(open, 8)).rejects.toMatchObject(UNIQUE)

    const committed = await submittedCase('adjustment', 'position', payees[2]!.position, payload(0))
    await approveCase(committed)
    await expect(origin(committed, 0)).rejects.toMatchObject(CHECK) // period committed

    const manualLine = { origin_type: 'manual', origin_id: originId, payee_position_id: payees[2]!.position,
      payee_participant_id: payees[2]!.participant, rule_key: 'manual_adjustment', amount_minor: 500, original_period_id: periods[8] }
    await expect(committedRun(9, [], { lines: [manualLine] })).rejects.toMatchObject(CHECK) // another period's run
    await committedRun(8, [], { lines: [manualLine] })
    expect(await value('SELECT consumed_run_id FROM adjustment_origin WHERE id = $1', [originId]))
      .toBe(await value('SELECT committed_run_id FROM period WHERE id = $1', [periods[8]]))
  })

  test('posted_at (0409) is the posting instant under the ledger lock, not the transaction start (receivable streak order)', async () => {
    const runId = await committedRun(9, [{ payee: 2, gross: 100 }])
    const afterStart = await as(a, async (tx) => {
      await tx.query('SELECT pg_sleep(0.05)') // a commit waiting on the run, periods or ledger lock
      const entry = (await tx.query<{ id: string }>('SELECT led_post_run($1) AS id', [runId])).rows[0]!.id
      return (await tx.query<{ later: boolean }>('SELECT posted_at > now() AS later FROM journal_entry WHERE id = $1', [entry])).rows[0]!.later
    })
    expect(afterStart).toBe(true)
  })

  test('two approvals: pinned at submit, the first by an eligible approver, the second by someone else', async () => {
    const caseId = await submittedCase('write_off', 'ledger_account', randomUUID(), { amount_minor: '5', note: 'n' }, 2)
    await expect(rows('UPDATE case_file SET approvals_required = 1 WHERE id = $1', [caseId], b)).rejects.toMatchObject(CHECK)
    await expect(approveCase(caseId)).rejects.toMatchObject(NOT_ALLOWED) // no first approval yet
    const first = await approval(b, 'case', caseId)
    await rows(`UPDATE case_file SET first_approval_id = $2 WHERE id = $1`, [caseId, first], b)
    await rows(`INSERT INTO case_event (tenant_id, case_id, actor_id, kind) VALUES (app_tenant_id(), $1, $2, 'first_approved')`,
      [caseId, b.userId], b)
    await expect(rows(`UPDATE case_file SET first_approval_id = $2 WHERE id = $1`, [caseId, await approval(c, 'case', caseId)], c))
      .rejects.toMatchObject(NOT_ALLOWED) // set once
    await expect(approveCase(caseId, b)).rejects.toMatchObject(NOT_ALLOWED) // the first approver again
    await approveCase(caseId, c)
    expect(await value('SELECT state FROM case_file WHERE id = $1', [caseId])).toBe('approved')
  })

  test('the opener cannot give the first approval; only a two-approval case records one', async () => {
    const twice = await submittedCase('adjustment', 'position', payees[0]!.position, {}, 2)
    const own = await approval(a, 'case', twice, b.userId)
    await expect(rows('UPDATE case_file SET first_approval_id = $2 WHERE id = $1', [twice, own])).rejects.toMatchObject(NOT_ALLOWED)

    const once = await submittedCase('adjustment', 'position', payees[0]!.position, {})
    await expect(rows('UPDATE case_file SET first_approval_id = $2 WHERE id = $1', [once, await approval(b, 'case', once)], b))
      .rejects.toMatchObject(NOT_ALLOWED)
  })

  test('the system opens returned-payment and duplicate cases only; related-party declarations are withdrawn once', async () => {
    const system = (type: string) => as(a, (tx) => tx.query(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by_kind)
       VALUES (app_tenant_id(), $1, 'payout_instruction', gen_random_uuid(), 'RETURNED_BY_BANK', 'open', '{}', $2, 'system')`,
      [type, marketId]))
    await system('returned_payment')
    await expect(system('adjustment')).rejects.toMatchObject(NOT_ALLOWED)

    const declared = await as(a, (tx) => insertRow(tx, 'user_related_participant', {
      tenant_id: a.tenantId, user_id: c.userId, participant_id: payees[0]!.participant, relation: 'self', declared_by: a.userId,
    }))
    expect(await rows('SELECT staff_related_users($1) AS u', [payees[0]!.participant])).toEqual([{ u: c.userId }])
    const withdraw = () => rows(
      `UPDATE user_related_participant SET withdrawn_at = now(), withdrawn_by = $2, withdraw_reason = 'left' WHERE id = $1`, [declared, a.userId])
    await withdraw()
    await expect(withdraw()).rejects.toMatchObject(CHECK)
    expect(await rows('SELECT staff_related_users($1) AS u', [payees[0]!.participant])).toEqual([])
  })
})

describe('payouts (D-B4-12..16, D-B4-24)', () => {
  test('a batch moves draft -> reviewed -> approved -> instructing with SoD and totals; the period is paid when its instructions end', async () => {
    await expect(bankVersion(0, randomBytes(32))).rejects.toMatchObject(NOT_ALLOWED) // not the requested account
    const versionId = await bankVersion(0)
    await expect(as(a, (tx) => insertRow(tx, 'bank_detail_version', {
      tenant_id: a.tenantId, participant_id: payees[0]!.participant, scheme: 'iban', details_sealed: 's', fingerprint: randomBytes(32),
      masked: 'm', created_via: 'migration', cooling_off_until: new Date(),
    }))).rejects.toMatchObject(NOT_ALLOWED) // runtime role: only through a case
    await rows(`UPDATE provider_config SET adapter = 'sandbox', webhook_secret_sealed = 's', review_due_on = '2026-01-01' WHERE id = $1`, [providerId])
    const batch = (period = 0) => as(a, (tx) => insertRow(tx, 'payout_batch', {
      tenant_id: a.tenantId, market_id: marketId, provider_config_id: providerId, period_id: periods[period], currency: 'GBP', prepared_by: a.userId,
    }))
    await expect(batch(11)).rejects.toMatchObject(CHECK) // period not committed
    const batchId = await batch()
    await expect(batch()).rejects.toMatchObject(UNIQUE) // one open batch per market
    await expect(rows(`UPDATE payout_batch SET state = 'reviewed', submitted_by = $2, submitted_at = now() WHERE id = $1`, [batchId, a.userId]))
      .rejects.toMatchObject(CHECK) // empty
    await rows(`INSERT INTO payout_batch_line (tenant_id, batch_id, participant_id, amount_minor, bank_detail_version_id)
                VALUES (app_tenant_id(), $1, $2, 120987, $3)`, [batchId, payees[0]!.participant, versionId])
    await rows(`UPDATE payout_batch SET total_minor = 120987, state = 'reviewed', submitted_by = $2, submitted_at = now() WHERE id = $1`,
      [batchId, a.userId])
    await expect(rows('DELETE FROM payout_batch_line WHERE batch_id = $1', [batchId])).rejects.toMatchObject(CHECK) // not a draft
    const approve = async (ctx: TenantContext) => {
      const id = await approval(ctx, 'payout_batch', batchId)
      await rows(`UPDATE payout_batch SET state = 'approved', approval_id = $2, approved_at = now() WHERE id = $1`, [batchId, id], ctx)
      return id
    }
    const byPreparer = await approval(a, 'payout_batch', batchId, b.userId)
    await expect(rows(`UPDATE payout_batch SET state = 'approved', approval_id = $2, approved_at = now() WHERE id = $1`, [batchId, byPreparer]))
      .rejects.toMatchObject(NOT_ALLOWED) // SoD: the preparer approves
    const approvalId = await approve(b)
    const instructionId = randomUUID()
    const instruct = (amount: number) => as(b, async (tx) => {
      await insertRow(tx, 'payout_instruction', {
        id: instructionId, tenant_id: a.tenantId, batch_id: batchId, payee_participant_id: payees[0]!.participant,
        bank_detail_version_id: versionId, amount_minor: amount, currency: 'GBP', idempotency_key: instructionId, signature: randomBytes(32),
      })
      await tx.query(`SELECT ledger_post($1, $2, 'payout_instructed', 'payout_instruction', $3, $4, $5, $6)`, [
        marketId, periods[0], instructionId, `instr:${instructionId}:instructed`, approvalId,
        JSON.stringify([line('payee_payable', payees[0]!.participant, String(amount), '0'), line('payout_in_transit', null, '0', String(amount))])])
      await tx.query(`UPDATE payout_batch SET state = 'instructing' WHERE id = $1`, [batchId])
    })
    await expect(instruct(100)).rejects.toMatchObject(CHECK) // not the line's amount
    await instruct(120987)
    expect([await balance(payees[0]!.participant, 'payee_payable'), await balance(null, 'payout_in_transit')]).toEqual(['0', '120987'])

    await expect(rows('UPDATE payout_instruction SET amount_minor = 1 WHERE id = $1', [instructionId])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE payout_batch SET state = 'settled' WHERE id = $1`, [batchId])).rejects.toMatchObject(CHECK)
    expect(await value('SELECT period_mark_paid($1)', [periods[0]])).toBe(false)
    await rows(`UPDATE payout_instruction SET state = 'accepted', provider_ref = 'sbx_1', accepted_at = now() WHERE id = $1`, [instructionId])
    await rows(`UPDATE payout_instruction SET state = 'settled', terminal_at = now() WHERE id = $1`, [instructionId])
    await expect(rows(`UPDATE payout_instruction SET last_error = 'x' WHERE id = $1`, [instructionId])).rejects.toMatchObject(CHECK) // terminal
    await rows(`UPDATE payout_batch SET state = 'settled' WHERE id = $1`, [batchId])
    expect(await value('SELECT period_mark_paid($1)', [periods[0]])).toBe(true)
    expect(await value('SELECT state FROM period WHERE id = $1', [periods[0]])).toBe('paid')
    await expect(rows(`UPDATE period SET state = 'paid' WHERE id = $1`, [periods[1]])).rejects.toMatchObject(CHECK) // no batch
  })

  test('instructions are the approved lines on current details; a failed one is retried once, up to its amount; a retried batch settles', async () => {
    const [p0, p1] = [payees[0]!.participant, payees[1]!.participant]
    const v0 = await value<string>('SELECT id FROM bank_detail_version WHERE participant_id = $1 AND superseded_at IS NULL', [p0])
    const v1 = await bankVersion(1)
    const batchId = await as(a, (tx) => insertRow(tx, 'payout_batch', {
      tenant_id: a.tenantId, market_id: marketId, provider_config_id: providerId, period_id: periods[1], currency: 'GBP', prepared_by: a.userId,
    }))
    await rows(`INSERT INTO payout_batch_line (tenant_id, batch_id, participant_id, amount_minor, bank_detail_version_id)
                VALUES (app_tenant_id(), $1, $2, 300, $3), (app_tenant_id(), $1, $4, 200, $5)`, [batchId, p0, v0, p1, v1])
    await rows(`UPDATE payout_batch SET total_minor = 500, state = 'reviewed', submitted_by = $2, submitted_at = now() WHERE id = $1`,
      [batchId, a.userId])
    await expect(rows('UPDATE payout_batch SET total_minor = 50000 WHERE id = $1', [batchId])).rejects.toMatchObject(CHECK) // submitted
    const approvalId = await approval(b, 'payout_batch', batchId)
    await rows(`UPDATE payout_batch SET state = 'approved', approval_id = $2, approved_at = now() WHERE id = $1`, [batchId, approvalId], b)

    const instruction = (tx: Tx, payee: string, version: string, amount: number, retryOf: string | null = null) => {
      const id = randomUUID()
      return insertRow(tx, 'payout_instruction', {
        id, tenant_id: a.tenantId, batch_id: batchId, payee_participant_id: payee, bank_detail_version_id: version, amount_minor: amount,
        currency: 'GBP', idempotency_key: id, signature: randomBytes(32), retry_of: retryOf,
      })
    }
    const instructing = (tx: Tx) => tx.query(`UPDATE payout_batch SET state = 'instructing' WHERE id = $1`, [batchId])
    await expect(as(b, (tx) => instruction(tx, p0, v0, 50000))).rejects.toMatchObject(CHECK) // not the line's amount
    await expect(as(b, (tx) => instruction(tx, payees[2]!.participant, v0, 300))).rejects.toMatchObject(CHECK) // no line for the payee
    await expect(as(b, async (tx) => { await instruction(tx, p0, v0, 300); await instruction(tx, p0, v0, 300) })).rejects.toMatchObject(UNIQUE)
    await expect(as(b, async (tx) => { await instruction(tx, p0, v0, 300); await instructing(tx) })).rejects.toMatchObject(CHECK) // a line missing
    const [x0, x1] = await as(b, async (tx) => {
      const ids: [string, string] = [await instruction(tx, p0, v0, 300), await instruction(tx, p1, v1, 200)]
      await instructing(tx)
      return ids
    })

    await rows(`UPDATE payout_instruction SET state = 'accepted', provider_ref = 'sbx_x0', accepted_at = now() WHERE id = $1`, [x0])
    await rows(`UPDATE payout_instruction SET state = 'settled', terminal_at = now() WHERE id = $1`, [x0])
    await rows(`UPDATE payout_instruction SET state = 'failed', terminal_at = now() WHERE id = $1`, [x1])
    await rows(`UPDATE payout_batch SET state = 'failed' WHERE id = $1`, [batchId])

    // One entry per instruction and event, in the instruction's state, with the lines of its posting rule (PLAN 4.3).
    const post = (event: string, id: string, key: string, debitType: string, creditType: string, amount: string) => value(
      `SELECT ledger_post($1, $2, $3, 'payout_instruction', $4, $5, NULL, $6)`, [marketId, periods[1], event, id, key, JSON.stringify([
        line(debitType, debitType === 'payee_payable' ? p0 : null, amount, '0'), line(creditType, creditType === 'payee_payable' ? p0 : null, '0', amount)])])
    await expect(post('payout_returned', x0, `instr:${x0}:returned`, 'payout_in_transit', 'payee_payable', '300')).rejects.toMatchObject(NOT_ALLOWED) // settled
    await expect(post('payout_settled', x0, 'whatever', 'payout_in_transit', 'settled_clearing', '300')).rejects.toMatchObject(CHECK) // key
    await expect(post('payout_settled', x0, `instr:${x0}:settled`, 'payout_in_transit', 'settled_clearing', '1')).rejects.toMatchObject(CHECK) // amount
    await expect(post('payout_settled', x0, `instr:${x0}:settled`, 'payout_in_transit', 'payee_payable', '300')).rejects.toMatchObject(CHECK) // accounts
    await post('payout_settled', x0, `instr:${x0}:settled`, 'payout_in_transit', 'settled_clearing', '300')

    const v1b = await bankVersion(1) // p1's account changes: the retry pays the current one
    await expect(as(b, (tx) => instruction(tx, p1, v1b, 200))).rejects.toMatchObject(CHECK) // not a retry
    await expect(as(b, (tx) => instruction(tx, p0, v0, 300, x0))).rejects.toMatchObject(CHECK) // x0 did not fail
    await expect(as(b, (tx) => instruction(tx, p1, v1, 200, x1))).rejects.toMatchObject(CHECK) // superseded details
    await expect(as(b, (tx) => instruction(tx, p1, v1b, 201, x1))).rejects.toMatchObject(CHECK) // above the failed amount
    await expect(as(b, async (tx) => { await instruction(tx, p1, v1b, 100, x1); await instruction(tx, p1, v1b, 100, x1) }))
      .rejects.toMatchObject(UNIQUE) // one retry per failed instruction
    const y1 = await as(b, async (tx) => {
      const id = await instruction(tx, p1, v1b, 200, x1)
      await instructing(tx)
      return id
    })
    await rows(`UPDATE payout_instruction SET state = 'accepted', provider_ref = 'sbx_y1', accepted_at = now() WHERE id = $1`, [y1])
    await rows(`UPDATE payout_instruction SET state = 'settled', terminal_at = now() WHERE id = $1`, [y1])
    await rows(`UPDATE payout_batch SET state = 'settled' WHERE id = $1`, [batchId]) // x1 failed, but its retry settled
  })

  test('the system realm lists due sandbox instructions and provider reviews; the tenant realm cannot', async () => {
    await expect(rows('SELECT * FROM pay_due_instructions(10)')).rejects.toMatchObject(NOT_ALLOWED)
    const reviews = await withSystem((tx) => tx.query('SELECT provider_config_id FROM pay_due_provider_reviews()'))
    expect(reviews.rows).toContainEqual({ provider_config_id: providerId })
    const webhook = await withSystem((tx) => tx.query('SELECT tenant_id, adapter FROM pay_provider_for_webhook($1)', [providerId]))
    expect(webhook.rows).toEqual([{ tenant_id: a.tenantId, adapter: 'sandbox' }])
    await expect(withSystem((tx) => tx.query('SELECT * FROM pay_due_instructions(0)'))).rejects.toMatchObject({ code: '22023' })
  })

  test('provider adapter and review date change while recorded; holds and exceptions close once', async () => {
    await expect(rows(`UPDATE provider_config SET adapter = 'razorpayx' WHERE id = $1`, [providerId])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1`, [providerId, a.userId])
    await expect(rows(`UPDATE provider_config SET review_due_on = '2027-01-01' WHERE id = $1`, [providerId])).rejects.toMatchObject(CHECK)

    const hold = await as(a, (tx) => insertRow(tx, 'payout_hold', {
      tenant_id: a.tenantId, participant_id: payees[2]!.participant, market_id: marketId, reason: 'review', placed_by: a.userId,
    }))
    const releaseAs = (ctx: TenantContext) =>
      rows(`UPDATE payout_hold SET released_by = $2, released_at = now(), release_reason = 'ok' WHERE id = $1`, [hold, ctx.userId], ctx)
    // A user who prepares payouts in the hold's market never lifts it (FR-PAY-007 SoD, 0412).
    await getOwnerPool().query(
      `WITH r AS (INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required)
                  VALUES ($1, 'Preparer', '{payout.prepare,payout.hold}', false, false) RETURNING id)
       INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from) SELECT $1, $2, r.id, ARRAY[$3::uuid], now() - interval '1 day' FROM r`,
      [c.tenantId, c.userId, marketId])
    await expect(releaseAs(c)).rejects.toMatchObject(NOT_ALLOWED)
    await releaseAs(a)
    await expect(releaseAs(a)).rejects.toMatchObject(CHECK)

    const exception = await as(a, (tx) => insertRow(tx, 'payout_exception', {
      tenant_id: a.tenantId, provider_config_id: providerId, kind: 'unknown_reference', reference: 'sbx_x',
    }))
    const resolve = () => rows(
      `UPDATE payout_exception SET state = 'resolved', resolved_by = $2, resolved_at = now(), resolution_note = 'checked' WHERE id = $1`,
      [exception, a.userId])
    await resolve()
    await expect(resolve()).rejects.toMatchObject(CHECK)
  })

  test('tax profile versions never overlap and close once (D-B4-17); provider webhook sources are accepted', async () => {
    const version = (from: string, to: string | null = null) => as(a, (tx) => insertRow(tx, 'tax_profile', {
      tenant_id: a.tenantId, participant_id: payees[1]!.participant, residency: 'GB', tax_id_sealed: 's', tax_id_masked: '•••• 1234',
      valid_from: from, valid_to: to, created_by: a.userId,
    }))
    const first = await version('2025-01-01')
    await expect(version('2025-06-01')).rejects.toMatchObject({ code: '23P01' })
    await expect(rows(`UPDATE tax_profile SET valid_to = '2025-06-01' WHERE id = $1`, [first])).rejects.toMatchObject(CHECK) // retroactive
    await rows(`UPDATE tax_profile SET valid_to = '2099-01-01' WHERE id = $1`, [first])
    await version('2099-01-01')
    await expect(rows(`UPDATE tax_profile SET valid_to = '2099-07-01' WHERE id = $1`, [first])).rejects.toMatchObject(CHECK)

    await as(a, (tx) => insertRow(tx, 'inbound_event', {
      tenant_id: a.tenantId, source: `provider:${providerId}`, idempotency_key: 'evt-1', payload_hash: randomBytes(32),
      processed_at: new Date(), state: 'processed',
    }))
  })
})

describe('opaque guardrail evaluations (D-B4-21 b)', () => {
  test('a blocked opaque evaluation of a non-overridable rule needs a compliance override, and gets one', async () => {
    const rule = 'b4-opaque@2026-01-01'
    await getOwnerPool().query(
      `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status, source_ref,
         effective_from) VALUES ($1, 'test', 'Opaque', 'blocked', '{"check": "enrolment_only_pay"}', false, true, 't', 'screening', 't', '2026-01-01')`,
      [rule])
    await rows(`INSERT INTO plan_rule (tenant_id, plan_version_id, rule_key, kind, pass, params, created_by, updated_by)
                VALUES (app_tenant_id(), $1, 'pv', 'volume.personal', '1', '{}', $2, $2)`, [planVersionId, a.userId])
    const evaluation = await value<string>(
      `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail)
       VALUES (app_tenant_id(), $1, $2, 'evaluation', 'blocked', guardrail_rules_hash($2, ARRAY['pv']), '{"rule_keys": ["pv"], "opaque": true}')
       RETURNING id`, [rule, planVersionId])
    expect(await rows('SELECT reason FROM guardrail_outstanding($1)', [planVersionId])).toEqual([{ reason: 'compliance_review_required' }])
    await rows(
      `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail, refers_to_decision_id,
         justification, approval_id)
       SELECT tenant_id, rule_id, plan_version_id, 'override', outcome, content_sha256, detail, id, 'A compliance review of twenty', $2
       FROM guardrail_decision WHERE id = $1`, [evaluation, await approval(b, 'guardrail_decision', evaluation)], b)
    expect(await rows('SELECT reason FROM guardrail_outstanding($1)', [planVersionId])).toEqual([])
  })
})
