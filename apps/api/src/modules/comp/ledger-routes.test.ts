import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { withTenant } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { iamModule } from '../iam/index.js'
import { ledCaseTypes, ledModule } from '../led/index.js'
import { compModule } from './index.js'
import {
  activePlan, calculate, commit, createWorld, inside, member, order, ownerUnchecked, ts10Plan, user, type Member, type World,
} from './test-support.js'

// LED routes (PLAN B4 section 2.1; T-B4-04, T-B4-09, T-B4-10, AC-15.1, AC-FIN2-1/2, AC-FIN5-1/2). They live beside the
// COMP fixtures because a commit is what writes the ledger (a module test may not import another module's fixtures).

let app: FastifyInstance
let w: World
let a: Member
let c: Member
let firstRun: string
let emptyRun: string
let entryId: string
let frId: string
let frScoped: TestUser
let planAdmin: TestUser
let admin: TestUser
let payoutOfficer: TestUser
let stranger: TestUser
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, ledModule, iamModule, createCasModule({ types: ledCaseTypes })] })
  w = await createWorld({ settings: { 'write_offs.policy': { eligible_below_minor: '2000', second_approver_above_minor: '100000' } } })
  c = await member(w, 'DE-C')
  a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 30_000)
  await order(w, a, inside(w.periods[0]!, 2), 50_000)
  firstRun = await calculate(app, w, w.periods[0]!.id)
  entryId = (await commit(app, w, firstRun)).journal_entry_id!
  emptyRun = await calculate(app, w, w.periods[1]!.id)
  await commit(app, w, emptyRun)
  // Fixture: C's 16.00 clawed back with nothing payable (as led_post_run books it), on the empty run of P1.
  const [{ approval_id: approvalId }] = await ownerRows<{ approval_id: string }>('SELECT approval_id FROM run WHERE id = $1', [emptyRun]) as [{ approval_id: string }]
  await withTenant({ tenantId: w.tenantId, userId: w.finance.id }, (tx) => tx.query(
    `SELECT ledger_post($1, $2, 'run_committed', 'run', $3, $4, $5, $6)`,
    [w.marketId, w.periods[1]!.id, emptyRun, `run:${emptyRun}`, approvalId, JSON.stringify([
      { type: 'clawback_receivable', payee_participant_id: c.participantId, debit_minor: '3000', credit_minor: '0' },
      { type: 'commission_expense', payee_participant_id: null, debit_minor: '0', credit_minor: '3000' },
    ])],
  ))
  const [fr] = await ownerRows<{ id: string }>(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, 'FR', 'EUR', 2, 'Europe/Paris', '{fr}', 'none', 'live') RETURNING id`, [w.tenantId])
  frId = fr!.id
  frScoped = await user(w.tenantId, ['Finance approver'], [frId])
  planAdmin = await user(w.tenantId, ['Plan administrator'])
  admin = await user(w.tenantId, ['Tenant admin'])
  payoutOfficer = await user(w.tenantId, ['Payout officer'])
  stranger = (await createWorld()).finance
}, 120_000)

afterAll(async () => {
  await app.close()
})

/** An FR market with a committed period and an FR clawback receivable of `amount` for the payee (owner fixture). */
async function frReceivable(x: World, payee: Member, amount: number): Promise<{ fr: string; periodId: string; accountId: string }> {
  const [market] = await ownerRows<{ id: string }>(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, 'FR', 'EUR', 2, 'Europe/Paris', '{fr}', 'none', 'live') RETURNING id`, [x.tenantId])
  const fr = market!.id
  // The FR market's committed period (the write-off's attribution period) and the FR receivable of the DE participant.
  const [period] = await ownerRows<{ id: string }>(
    `WITH c AS (INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
                VALUES ($1, $2, 'FR monthly', 'monthly', 'Europe/Paris', ($3::timestamptz AT TIME ZONE 'Europe/Paris')::date) RETURNING id)
     INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state) SELECT $1, c.id, $3, $4, 'committed' FROM c RETURNING id`,
    [x.tenantId, fr, x.periods[0]!.starts_at, x.periods[0]!.ends_at])
  await ownerUnchecked(
    `WITH r AS (INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency) VALUES ($1, $2, 'clawback_receivable', $4, 'EUR') RETURNING id),
          x AS (INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency) VALUES ($1, $2, 'commission_expense', NULL, 'EUR') RETURNING id),
          e AS (INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, created_by, created_by_type)
                SELECT $1, $2, $3, 'run_committed', 'run', g.id, 'run:' || g.id, gen_random_uuid(), $5, 'user' FROM (SELECT gen_random_uuid() AS id) g RETURNING id)
     INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
     SELECT $1, e.id, r.id, $6, 0, 'EUR' FROM e, r UNION ALL SELECT $1, e.id, x.id, 0, $6, 'EUR' FROM e, x`,
    [x.tenantId, fr, period!.id, payee.participantId, x.finance.id, amount])
  const [account] = await ownerRows<{ id: string }>(`SELECT id FROM ledger_account WHERE market_id = $1 AND type = 'clawback_receivable'`, [fr])
  return { fr, periodId: period!.id, accountId: account!.id }
}

const get = (url: string, as: TestUser = w.finance) => call(app, { method: 'GET', url, as })
const putMapping = (type: string, glCode: string, as: TestUser = w.finance, marketId = w.marketId) =>
  call(app, { method: 'PUT', url: `/v1/ledger/gl-mappings/${marketId}/${type}`, as, body: { gl_code: glCode } })
const exportPeriod = (periodId: string, as: TestUser = w.finance) =>
  call(app, { method: 'POST', url: '/v1/ledger/journal-exports', as, idempotencyKey: true, body: { period_id: periodId } })

describe('ledger reads (FR-FIN-001/002/003)', () => {
  test('T-B4-04 / AC-FIN2-2: summary by type balances; accounts with balances; postings and entries newest first; entry detail', async () => {
    const summary = (await get(`/v1/ledger/summary?market_id=${w.marketId}`)).json().data
    expect(summary).toMatchObject({ market: { id: w.marketId, code: 'DE', currency: 'EUR', minor_digits: 2 }, balanced: true, entry_count: 2 })
    expect(summary.by_type).toHaveLength(11) // B6: migration_clearing
    expect(summary.by_type.filter((t: { debit_minor: string; credit_minor: string }) => t.debit_minor !== '0' || t.credit_minor !== '0')).toEqual([
      { type: 'commission_expense', normal: 'debit', debit_minor: '9600', credit_minor: '3000', balance_minor: '6600' },
      { type: 'payee_payable', normal: 'credit', debit_minor: '0', credit_minor: '9600', balance_minor: '9600' },
      { type: 'clawback_receivable', normal: 'debit', debit_minor: '3000', credit_minor: '0', balance_minor: '3000' },
    ])

    const payables = (await get(`/v1/ledger/accounts?market_id=${w.marketId}&type=payee_payable&limit=1`)).json()
    expect(payables.data).toHaveLength(1)
    const second = (await get(`/v1/ledger/accounts?market_id=${w.marketId}&type=payee_payable&cursor=${payables.meta.next_cursor}`)).json().data
    const both = [...payables.data, ...second].map((x: { payee: { id: string }; balance_minor: string; gl_code: null }) => [x.payee.id, x.balance_minor, x.gl_code])
    expect(both.sort()).toEqual([[a.participantId, '8000', null], [c.participantId, '1600', null]].sort())
    const expense = (await get(`/v1/ledger/accounts?type=commission_expense`)).json().data[0]
    const postings = (await get(`/v1/ledger/accounts/${expense.id}/postings?limit=1`)).json()
    expect(postings.data[0]).toMatchObject({ credit_minor: '3000', entry: { origin_id: emptyRun, period_id: w.periods[1]!.id } })
    const older = (await get(`/v1/ledger/accounts/${expense.id}/postings?cursor=${postings.meta.next_cursor}`)).json()
    expect(older.data).toEqual([expect.objectContaining({ debit_minor: '9600', entry: expect.objectContaining({ id: entryId, approved_by: { id: w.finance.id, display_name: null } }) })])
    expect(older.meta.next_cursor).toBeNull()
    // A tampered time cursor is 400 INVALID_CURSOR, never a 500 from ::timestamptz.
    const tampered = Buffer.from(JSON.stringify({ at: 'x', id: randomUUID() })).toString('base64url')
    for (const url of [`/v1/ledger/accounts/${expense.id}/postings`, '/v1/ledger/entries', '/v1/ledger/journal-exports']) {
      expect((await get(`${url}?cursor=${tampered}`)).json().error.code).toBe('INVALID_CURSOR')
    }

    const entries = (await get(`/v1/ledger/entries?origin_type=run&origin_id=${firstRun}`)).json().data
    expect(entries).toEqual([expect.objectContaining({
      id: entryId, event_type: 'run_committed', idempotency_key: `run:${firstRun}`, period: expect.objectContaining({ id: w.periods[0]!.id }),
      debit_total_minor: '9600', posting_count: 3,
    })])
    const detail = (await get(`/v1/ledger/entries/${entryId}?limit=2`)).json()
    expect(detail.data.postings).toHaveLength(2)
    expect(detail.meta.next_cursor).not.toBeNull()
  })

  test('AC-FIN2-1 / T-B4-05: payee balances and receivables with ageing, eligibility and bucket totals', async () => {
    expect((await get(`/v1/payees/${c.participantId}/balances`)).json().data)
      .toEqual([{ market: { id: w.marketId, code: 'DE', currency: 'EUR' }, payable_minor: '1600', in_transit_minor: '0', receivable_minor: '3000' }])
    const receivables = (await get(`/v1/ledger/receivables?market_id=${w.marketId}`)).json()
    expect(receivables.data).toEqual([expect.objectContaining({
      participant: { id: c.participantId, external_ref: 'DE-C', display_name: 'DE-C' }, market: { id: w.marketId, code: 'DE' },
      balance_minor: '3000', age_days: 0, bucket: '0_30', write_off_eligible: false, open_write_off_case_id: null, account_id: expect.any(String),
    })])
    expect(receivables.meta.totals_by_bucket).toEqual([
      { bucket: '0_30', count: 1, amount_minor: '3000' }, { bucket: '31_60', count: 0, amount_minor: '0' },
      { bucket: '61_90', count: 0, amount_minor: '0' }, { bucket: 'over_90', count: 0, amount_minor: '0' },
    ])
    expect((await get(`/v1/payees/${c.participantId}/balances`, frScoped)).statusCode).toBe(404)
    expect((await get(`/v1/payees/${randomUUID()}/balances`)).statusCode).toBe(404)
  })
})

describe('T-B6-32 ledger entries sort and CSV export (D-B6-08)', () => {
  /** Every id of the list in `sort`, one entry per page. */
  async function pages(sort: string): Promise<string[]> {
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const page: { data: { id: string }[]; meta: { next_cursor: string | null } } = (await get(`/v1/ledger/entries?sort=${sort}&limit=1${cursor === null ? '' : `&cursor=${cursor}`}`)).json()
      ids.push(...page.data.map((e) => e.id))
      cursor = page.meta.next_cursor
    } while (cursor !== null)
    return ids
  }

  test('AC-RPT2-4: posted_at_desc (default) and posted_at_asc page by (posted_at, id); a cursor of the other sort is 422', async () => {
    const newestFirst = (await get('/v1/ledger/entries')).json().data.map((e: { id: string }) => e.id)

    expect(newestFirst).toHaveLength(2)
    expect(newestFirst[1]).toBe(entryId) // P0's commit was posted first
    expect(await pages('posted_at_desc')).toEqual(newestFirst)
    expect(await pages('posted_at_asc')).toEqual([...newestFirst].reverse())
    const ascCursor = (await get('/v1/ledger/entries?sort=posted_at_asc&limit=1')).json().meta.next_cursor
    expect((await get(`/v1/ledger/entries?sort=posted_at_desc&cursor=${ascCursor}`)).json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { path: 'cursor' } })
    expect((await get('/v1/ledger/entries?sort=amount_desc')).json().error.code).toBe('VALIDATION_FAILED')
  })

  test('AC-RPT2-5: the filter in its sort as CSV with the chosen columns, no-store, audited; every column by default', async () => {
    const response = await get(`/v1/ledger/entries/export?market_id=${w.marketId}&sort=posted_at_asc&columns=entry_id,event_type,debit_total`)
    const [audit] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'EXPORT.CREATED' ORDER BY seq DESC LIMIT 1`, [w.tenantId])

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
    const newest = (await get('/v1/ledger/entries?limit=1')).json().data[0].id
    expect(response.body).toBe(`entry_id,event_type,debit_total\r\n${entryId},run_committed,96.00\r\n${newest},run_committed,30.00\r\n`)
    expect(JSON.parse(audit!.after_ref).after).toEqual({
      kind: 'ledger_entries', row_count: 2, filters: { market_id: w.marketId, sort: 'posted_at_asc', columns: ['entry_id', 'event_type', 'debit_total'] },
    })
    const all = await get(`/v1/ledger/entries/export?origin_type=run&origin_id=${firstRun}`)
    expect(all.body.split('\r\n')[0]).toBe('posted_at,entry_id,market,period,event_type,origin_type,origin_id,debit_total,credit_total,approval_id')
    expect(all.body.split('\r\n')[1]).toContain(`,${entryId},DE,${w.periods[0]!.id},run_committed,run,${firstRun},96.00,96.00,`)
    expect((await get('/v1/ledger/entries/export?columns=entry_id,payee')).statusCode).toBe(400)
    expect((await get('/v1/ledger/entries/export?columns=entry_id,entry_id')).statusCode).toBe(400)
  })

  test('AC-RPT2-5: ledger.export required (a Commission analyst 403); above the cap 422 and EXPORT.REFUSED; other tenants and markets export nothing', async () => {
    const capped = await buildTestApp({ modules: [ledModule], env: { EXPORT_ROW_CAP: '1' } })
    try {
      const refused = await call(capped, { method: 'GET', url: '/v1/ledger/entries/export', as: w.finance })
      expect([refused.statusCode, refused.json().error.code, refused.json().error.details]).toEqual([422, 'EXPORT_ROW_CAP_EXCEEDED', { row_count: 2, row_cap: 1 }])
      expect(refused.headers['cache-control']).toBe('no-store')
    } finally {
      await capped.close()
    }
    expect(await auditActions(w.tenantId)).toContain('EXPORT.REFUSED')
    expect((await get('/v1/ledger/entries/export', w.analyst)).statusCode).toBe(403)
    for (const as of [stranger, frScoped]) expect((await get('/v1/ledger/entries/export', as)).body.trimEnd().split('\r\n'), 'header only').toHaveLength(1)
  })
})

describe('GL mappings and journal exports (FR-FIN-005, D-B4-19)', () => {
  test('T-B4-10 / AC-FIN5-1 / T-B4-09 / AC-15.1: mapping refusal, audited mapping, balanced CSV naming the run, identical re-download', async () => {
    expect((await exportPeriod(w.periods[2]!.id)).json().error.code).toBe('PERIOD_NOT_COMMITTED')
    const missing = await exportPeriod(w.periods[0]!.id)
    expect(missing.json().error).toMatchObject({ code: 'GL_MAPPING_MISSING', details: { account_types: ['commission_expense', 'payee_payable'] } })
    expect(await ownerRows(`SELECT 1 FROM export_job WHERE tenant_id = $1 AND kind = 'gl_journal'`, [w.tenantId])).toHaveLength(0)

    expect((await putMapping('commission_expense', '5000')).json().data).toMatchObject({ account_type: 'commission_expense', gl_code: '5000' })
    expect((await putMapping('commission_expense', '5100')).statusCode).toBe(200)
    expect((await putMapping('payee_payable', '2100')).statusCode).toBe(200)
    const invalid = await putMapping('payee_payable', 'bad code!')
    expect([invalid.statusCode, invalid.json().error.code]).toEqual([400, 'VALIDATION_FAILED']) // PLAN C-B4-22
    // A leading '-' would be written to the CSV as "'-AP.200" by the formula guard: refused.
    expect((await putMapping('payee_payable', '-AP.200')).json().error.code).toBe('VALIDATION_FAILED')
    expect((await auditActions(w.tenantId)).filter((x) => x === 'LEDGER.GL_MAPPING_SET')).toHaveLength(3)
    expect((await get(`/v1/ledger/gl-mappings?market_id=${w.marketId}`)).json().data.slice(0, 2)).toEqual([
      { account_type: 'commission_expense', gl_code: '5100', updated_by: { id: w.finance.id, display_name: null }, updated_at: expect.any(String) },
      { account_type: 'payee_payable', gl_code: '2100', updated_by: { id: w.finance.id, display_name: null }, updated_at: expect.any(String) },
    ])

    const created = await exportPeriod(w.periods[0]!.id)
    expect(created.statusCode, created.body).toBe(201)
    const view = created.json().data
    expect(view).toMatchObject({ market: { id: w.marketId, code: 'DE' }, period: { id: w.periods[0]!.id }, line_count: 2, debit_total_minor: '9600',
      credit_total_minor: '9600', created_by: { id: w.finance.id, type: 'user' } })
    const file = await get(`/v1/ledger/journal-exports/${view.id}/file`)
    expect(file.headers['content-type']).toContain('text/csv')
    expect(file.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="gl-DE-\\d{4}-\\d{2}-01-${view.id}\\.csv"$`))
    expect(file.body.split('\r\n')).toEqual([
      'export_id,period_start,period_end,market,currency,gl_code,account_type,origin_type,origin_id,debit,credit',
      expect.stringMatching(new RegExp(`^${view.id},[^,]+,[^,]+,DE,EUR,2100,payee_payable,run,${firstRun},0.00,96.00$`)),
      expect.stringMatching(new RegExp(`^${view.id},[^,]+,[^,]+,DE,EUR,5100,commission_expense,run,${firstRun},96.00,0.00$`)),
      '',
    ])
    const again = await get(`/v1/ledger/journal-exports/${view.id}/file`)
    expect(again.body).toBe(file.body)
    const [stored] = await ownerRows<{ content: Buffer; sha: string }>(`SELECT content, encode(content_sha256, 'hex') AS sha FROM journal_export WHERE id = $1`, [view.id])
    expect(createHash('sha256').update(stored!.content).digest('hex')).toBe(view.content_sha256)
    expect(gunzipSync(stored!.content).toString('utf8')).toBe(file.body)
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['EXPORT.CREATED', 'JOURNAL_EXPORT.CREATED', 'EXPORT.DOWNLOADED']))
    const list = (await get(`/v1/ledger/journal-exports?period_id=${w.periods[0]!.id}`)).json()
    expect(list).toEqual({ data: [view], meta: { next_cursor: null } })

    expect((await exportPeriod(w.periods[1]!.id)).json().error).toMatchObject({ code: 'GL_MAPPING_MISSING', details: { account_types: ['clawback_receivable'] } })
    await commit(app, w, await calculate(app, w, w.periods[2]!.id))
    expect((await exportPeriod(w.periods[2]!.id)).json().error.code).toBe('NOTHING_TO_EXPORT')
  })

  test('AC-FIN5-2: a Tenant admin mints a ledger:export key (a Finance approver cannot); the key downloads; a key without the scope is refused', async () => {
    const mint = async (as: TestUser, scopes: string[]) => {
      const account = await call(app, { method: 'POST', url: '/v1/service-accounts', as, body: { name: randomUUID(), purpose: 'GL' }, idempotencyKey: true })
      if (account.statusCode !== 201) return { statusCode: account.statusCode, token: null }
      const key = await call(app, {
        method: 'POST', url: `/v1/service-accounts/${account.json().data.id}/keys`, as, body: { name: 'GL', scopes, rate_tier: 'standard' }, idempotencyKey: true,
      })
      return { statusCode: key.statusCode, token: key.json().data?.token as string | null }
    }
    expect((await mint(w.finance, ['ledger:export'])).statusCode).toBe(403)
    const minted = await mint(admin, ['ledger:export'])
    expect(minted.statusCode).toBe(201)
    const [exported] = await ownerRows<{ id: string }>('SELECT id FROM journal_export WHERE tenant_id = $1 LIMIT 1', [w.tenantId])
    const asKey = (token: string) => app.inject({ method: 'GET', url: `/v1/ledger/journal-exports/${exported!.id}/file`, headers: { authorization: `Bearer ${token}` } })
    const download = await asKey(minted.token!)
    expect(download.statusCode).toBe(200)
    expect(download.body.startsWith('export_id,')).toBe(true)
    const other = await mint(admin, ['orders:write'])
    expect((await asKey(other.token!)).statusCode).toBe(403)

    // T-B4-10: the key creates an export; export_job names no requesting user, the service account is the creator.
    const created = await app.inject({
      method: 'POST', url: '/v1/ledger/journal-exports', payload: { period_id: w.periods[0]!.id },
      headers: { authorization: `Bearer ${minted.token!}`, 'idempotency-key': randomUUID() },
    })
    expect(created.statusCode, created.body).toBe(201)
    const view = created.json().data
    expect(view.created_by.type).toBe('service_account')
    expect(await ownerRows(
      'SELECT j.requested_by, j.created_by_type, j.created_by FROM export_job j JOIN journal_export e ON e.export_job_id = j.id WHERE e.id = $1', [view.id],
    )).toEqual([{ requested_by: null, created_by_type: 'service_account', created_by: view.created_by.id }])
  })
})

describe('write-off case (FR-FIN-004, D-B4-08, T-B4-07)', () => {
  const open = (accountId: string, amount: string, as: TestUser = w.analyst) => call(app, {
    method: 'POST', url: '/v1/cases', as, idempotencyKey: true,
    body: { type: 'write_off', subject_type: 'ledger_account', subject_id: accountId, reason_code: 'UNRECOVERABLE', payload: { amount_minor: amount, note: 'Gone' } },
  })

  test('AC-FIN4-1 / AC-FIN4-3: amount above the receivable, another account type, one open case per receivable, preview, market of the receivable', async () => {
    const [receivable] = await ownerRows<{ id: string }>(`SELECT id FROM ledger_account WHERE type = 'clawback_receivable' AND payee_participant_id = $1`, [c.participantId])
    const [payable] = await ownerRows<{ id: string }>(`SELECT id FROM ledger_account WHERE type = 'payee_payable' AND payee_participant_id = $1`, [c.participantId])
    expect((await open(receivable!.id, '3001')).json().error).toMatchObject({ code: 'AMOUNT_ABOVE_RECEIVABLE', details: { receivable_minor: '3000' } })
    expect((await open(payable!.id, '100')).json().error.code).toBe('VALIDATION_FAILED')
    // The case's market is the receivable account's: outside a creator's scope it is not opened. AC-FIN4-3 asks for
    // 403 SCOPE_NOT_HELD; CAS answers 422 SUBJECT_NOT_FOUND for any subject outside the create scope (open CAS-owner issue).
    const scopedAnalyst = await user(w.tenantId, ['Commission analyst'], [frId])
    expect((await open(receivable!.id, '100', scopedAnalyst)).json().error.code).toBe('SUBJECT_NOT_FOUND')
    const opened = await open(receivable!.id, '1000')
    expect(opened.statusCode, opened.body).toBe(201)
    const caseId = opened.json().data.id as string
    expect(opened.json().data.market_id).toBe(w.marketId)
    expect((await open(receivable!.id, '500')).json().error).toMatchObject({ code: 'WRITE_OFF_OPEN', details: { case_id: caseId } })
    const submitted = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.analyst, body: {} })
    expect(submitted.json().data.effect_preview).toMatchObject({
      market: { id: w.marketId, code: 'DE' }, payee: { id: c.participantId }, receivable_minor: '3000', amount_minor: '1000', after_minor: '2000', eligible: false,
      approvals_required: 2, reasons: ['not_eligible'], outstanding_since: expect.any(String),
    })
    // BUG-109: the stored preview names no one (erasure cannot clear it); the view carries the current name.
    const [stored] = await ownerRows<{ names: string; name: string | null }>(
      `SELECT jsonb_path_query_array(f.effect_preview, 'strict $.**.display_name')::text AS names, p.display_name AS name FROM case_file f, participant p WHERE f.id = $1 AND p.id = $2`, [caseId, c.participantId])
    expect(stored!.names).toBe('[null]')
    expect(submitted.json().data.effect_preview.payee).toEqual({ id: c.participantId, external_ref: expect.any(String), display_name: stored!.name })
    expect((await get('/v1/ledger/receivables')).json().data[0].open_write_off_case_id).toBe(caseId)
    // ledger.read without case.write_off.read: the receivable, not that a write-off is in progress.
    expect((await get('/v1/ledger/receivables', payoutOfficer)).json().data[0]).toMatchObject({ balance_minor: '3000', open_write_off_case_id: null })
    expect((await get(`/v1/cases/${caseId}`, frScoped)).statusCode).toBe(404)
    expect((await get(`/v1/cases/${caseId}`, stranger)).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/withdraw`, as: w.analyst, body: { reason: 'Recovered by netting' } })).statusCode).toBe(200)
  })

  test('D-B4-10: a not-eligible write-off takes two Finance approvals; the entry carries the final one; opening never waits on the ledger lock', async () => {
    const [receivable] = await ownerRows<{ id: string }>(`SELECT id FROM ledger_account WHERE type = 'clawback_receivable' AND payee_participant_id = $1`, [c.participantId])
    const holder = await getOwnerPool().connect()
    let caseId: string
    try {
      // A commit or payout dispatch posting in the market holds the ledger lock: the one-open-case check does not need it.
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('ledger:' || $1 || ':' || $2, 0))`, [w.tenantId, w.marketId])
      const opened = await open(receivable!.id, '1000')
      expect(opened.statusCode, opened.body).toBe(201)
      caseId = opened.json().data.id as string
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
    const submitted = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.analyst, body: {} })
    expect(submitted.json().data).toMatchObject({ approvals_required: 2, effect_preview: { reasons: ['not_eligible'] } })
    const approve = (as: TestUser) =>
      call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as, idempotencyKey: true, body: { decision: 'approve', reason: 'Unrecoverable' } })
    expect((await approve(w.finance)).json().data).toMatchObject({ state: 'submitted', first_approval: { approver: { id: w.finance.id } } })
    expect(await ownerRows('SELECT 1 FROM journal_entry WHERE origin_id = $1', [caseId])).toHaveLength(0)
    const final = await approve(w.finance2)
    expect(final.statusCode, final.body).toBe(200)
    const [decided] = await ownerRows<{ approval_id: string; first_approval_id: string }>('SELECT approval_id, first_approval_id FROM case_file WHERE id = $1', [caseId])
    expect(decided!.approval_id).not.toBe(decided!.first_approval_id)
    expect(await ownerRows('SELECT approval_id, event_type FROM journal_entry WHERE origin_id = $1', [caseId]))
      .toEqual([{ approval_id: decided!.approval_id, event_type: 'write_off' }])
    expect((await get(`/v1/payees/${c.participantId}/balances`)).json().data[0].receivable_minor).toBe('2000')
  })

  test('D-B4-11: a Finance approver declared related to the payee does not approve the write-off of their receivable', async () => {
    const [receivable] = await ownerRows<{ id: string }>(`SELECT id FROM ledger_account WHERE type = 'clawback_receivable' AND payee_participant_id = $1`, [c.participantId])
    await ownerRows(`INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, 'self', $4)`,
      [w.tenantId, w.finance.id, c.participantId, admin.id])
    const opened = await open(receivable!.id, '100')
    const caseId = opened.json().data.id as string
    const submitted = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.analyst, body: {} })
    expect(submitted.json().data).toMatchObject({ approvals_required: 1 })
    const approve = (as: TestUser) =>
      call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as, idempotencyKey: true, body: { decision: 'approve', reason: 'Unrecoverable' } })

    const refused = await approve(w.finance)
    expect(refused.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(refused.json().error.details.eligible_approvers.map((u: { user_id: string }) => u.user_id)).not.toContain(w.finance.id)
    expect((await get(`/v1/payees/${c.participantId}/balances`)).json().data[0].receivable_minor).toBe('2000')
    expect((await approve(w.finance2)).statusCode).toBe(200)
    expect((await get(`/v1/payees/${c.participantId}/balances`)).json().data[0].receivable_minor).toBe('1900')
  })

  test('AC-FIN4-3: a DE participant\'s FR receivable is an FR case: DE-only staff cannot open, see or decide it; FR-scoped staff do', async () => {
    const x = await createWorld({ settings: { 'write_offs.policy': { eligible_below_minor: '2000', second_approver_above_minor: '100000' } } })
    const payee = await member(x, 'DE-P')
    const { fr, periodId, accountId } = await frReceivable(x, payee, 1000)
    const [deAnalyst, frAnalyst, deFinance, frFinance] = await Promise.all([
      user(x.tenantId, ['Commission analyst'], [x.marketId]), user(x.tenantId, ['Commission analyst'], [fr]),
      user(x.tenantId, ['Finance approver'], [x.marketId]), user(x.tenantId, ['Finance approver'], [fr]),
    ])

    // AC-FIN4-3 asks for 403 SCOPE_NOT_HELD here; CAS answers 422 SUBJECT_NOT_FOUND (open CAS-owner issue).
    expect((await open(accountId, '1000', deAnalyst)).json().error.code).toBe('SUBJECT_NOT_FOUND')
    const opened = await open(accountId, '1000', frAnalyst)
    expect(opened.statusCode, opened.body).toBe(201)
    const caseId = opened.json().data.id as string
    expect(opened.json().data.market_id).toBe(fr)
    const submitted = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: frAnalyst, body: {} })
    expect(submitted.json().data).toMatchObject({ approvals_required: 1, effect_preview: { market: { id: fr, code: 'FR' }, receivable_minor: '1000' } })
    const decide = (as: TestUser) =>
      call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as, idempotencyKey: true, body: { decision: 'approve', reason: 'Below threshold' } })
    expect((await get(`/v1/cases/${caseId}`, deFinance)).statusCode).toBe(404)
    expect((await decide(deFinance)).statusCode).toBe(404)
    expect((await get(`/v1/cases/${caseId}`, frFinance)).statusCode).toBe(200)
    const decided = await decide(frFinance)
    expect(decided.statusCode, decided.body).toBe(200)
    expect(await ownerRows('SELECT market_id, period_id FROM journal_entry WHERE origin_id = $1', [caseId])).toEqual([{ market_id: fr, period_id: periodId }])
    expect((await get(`/v1/payees/${payee.participantId}/balances`, frFinance)).json().data)
      .toEqual([{ market: { id: fr, code: 'FR', currency: 'EUR' }, payable_minor: '0', in_transit_minor: '0', receivable_minor: '0' }])
  })

  test('SEC-B4-7 / D-B5-21: write-offs of one receivable since it became outstanding add up towards the threshold', async () => {
    const x = await createWorld({ settings: { 'write_offs.policy': { eligible_below_minor: '5000', second_approver_above_minor: '1500' } } })
    const { fr, accountId } = await frReceivable(x, await member(x, 'DE-S'), 3000)
    const [analyst, finance] = await Promise.all([user(x.tenantId, ['Commission analyst'], [fr]), user(x.tenantId, ['Finance approver'], [fr])])
    const proposeAndSubmit = async (amount: string) => {
      const opened = await open(accountId, amount, analyst)
      expect(opened.statusCode, opened.body).toBe(201)
      return (await call(app, { method: 'POST', url: `/v1/cases/${opened.json().data.id}/submit`, as: analyst, body: {} })).json().data
    }
    const first = await proposeAndSubmit('1000')
    expect(first).toMatchObject({ approvals_required: 1, effect_preview: { reasons: [] } })
    const approved = await call(app, { method: 'POST', url: `/v1/cases/${first.id}/decision`, as: finance, idempotencyKey: true, body: { decision: 'approve', reason: 'Small' } })
    expect(approved.statusCode, approved.body).toBe(200)
    // 10.00 approved + 10.00 now = 20.00 > 15.00: splitting never avoids the second approver.
    expect(await proposeAndSubmit('1000')).toMatchObject({ approvals_required: 2, effect_preview: { reasons: ['above_threshold'] } })
  })

  test('TK-B4-14 / D-B5-22: a proposer related to the payee cannot open or submit the write-off', async () => {
    const x = await createWorld({ settings: { 'write_offs.policy': { eligible_below_minor: '5000', second_approver_above_minor: '1500' } } })
    const payee = await member(x, 'DE-R')
    const { fr, accountId } = await frReceivable(x, payee, 3000)
    const [related, unrelated] = await Promise.all([user(x.tenantId, ['Commission analyst'], [fr]), user(x.tenantId, ['Commission analyst'], [fr])])
    await ownerRows(`INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, 'relative', $2)`,
      [x.tenantId, related.id, payee.participantId])
    expect((await open(accountId, '100', related)).json().error).toMatchObject({ code: 'WRITE_OFF_BLOCKED', details: { reason: 'related_party' } })
    const opened = await open(accountId, '100', unrelated)
    expect(opened.statusCode, opened.body).toBe(201)
    const submitted = await call(app, { method: 'POST', url: `/v1/cases/${opened.json().data.id}/submit`, as: related, body: {} })
    expect(submitted.json().error).toMatchObject({ code: 'WRITE_OFF_BLOCKED', details: { reason: 'related_party' } })
    expect((await call(app, { method: 'POST', url: `/v1/cases/${opened.json().data.id}/submit`, as: unrelated, body: {} })).statusCode).toBe(200)
  })

  test('AC-FIN4-1: without write_offs.policy the case is refused 422 SETTING_NOT_CONFIGURED', async () => {
    const bare = await createWorld()
    const fixture = await member(bare, 'DE-X')
    const [account] = await ownerRows<{ id: string }>(
      `INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency) VALUES ($1, $2, 'clawback_receivable', $3, 'EUR') RETURNING id`,
      [bare.tenantId, bare.marketId, fixture.participantId])
    const refused = await call(app, {
      method: 'POST', url: '/v1/cases', as: bare.analyst, idempotencyKey: true,
      body: { type: 'write_off', subject_type: 'ledger_account', subject_id: account!.id, reason_code: 'OTHER', payload: { amount_minor: '1', note: 'x' } },
    })
    expect(refused.json().error).toMatchObject({ code: 'SETTING_NOT_CONFIGURED', details: { key: 'write_offs.policy' } })
  })
})

describe('ledger route refusals', () => {
  test('missing permission 403, other tenant 404 or nothing, out-of-scope market', async () => {
    const reads = [
      `/v1/ledger/summary?market_id=${w.marketId}`, `/v1/ledger/accounts`, `/v1/ledger/entries`, `/v1/ledger/entries/${entryId}`,
      `/v1/payees/${a.participantId}/balances`, `/v1/ledger/receivables`, `/v1/ledger/gl-mappings?market_id=${w.marketId}`,
    ]
    const [account] = await ownerRows<{ id: string }>('SELECT id FROM ledger_account WHERE market_id = $1 LIMIT 1', [w.marketId])
    reads.push(`/v1/ledger/accounts/${account!.id}/postings`)
    for (const url of reads) expect((await get(url, planAdmin)).statusCode, url).toBe(403)
    for (const url of [`/v1/ledger/summary?market_id=${w.marketId}`, `/v1/ledger/entries/${entryId}`, `/v1/payees/${a.participantId}/balances`,
      `/v1/ledger/gl-mappings?market_id=${w.marketId}`, `/v1/ledger/accounts/${account!.id}/postings`]) {
      expect((await get(url, stranger)).statusCode, url).toBe(404)
      expect((await get(url, frScoped)).statusCode, url).toBe(404)
    }
    for (const url of ['/v1/ledger/accounts', '/v1/ledger/entries', '/v1/ledger/receivables', '/v1/ledger/journal-exports']) {
      expect((await get(url, stranger)).json().data, url).toEqual([])
      expect((await get(url, frScoped)).json().data, url).toEqual([])
    }
    expect((await putMapping('write_off', '6000', w.analyst)).statusCode).toBe(403)
    expect((await putMapping('write_off', '6000', stranger)).statusCode).toBe(404)
    expect((await putMapping('write_off', '6000', frScoped)).json().error.code).toBe('SCOPE_NOT_HELD')
    expect((await exportPeriod(w.periods[0]!.id, w.analyst)).statusCode).toBe(403)
    expect((await exportPeriod(w.periods[0]!.id, stranger)).statusCode).toBe(404)
    expect((await exportPeriod(w.periods[0]!.id, frScoped)).statusCode).toBe(404)
    expect((await get('/v1/ledger/journal-exports', w.analyst)).statusCode).toBe(403)
    const [exported] = await ownerRows<{ id: string }>('SELECT id FROM journal_export WHERE tenant_id = $1 LIMIT 1', [w.tenantId])
    expect((await get(`/v1/ledger/journal-exports/${exported!.id}/file`, stranger)).statusCode).toBe(404)
    expect((await get(`/v1/ledger/journal-exports/${exported!.id}/file`, w.analyst)).statusCode).toBe(403)
    expect((await get(`/v1/ledger/summary`)).json().error.code).toBe('VALIDATION_FAILED')
  })
})
