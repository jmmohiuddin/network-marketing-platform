// B-MKT schema guards and SQL contracts (PLAN B-MKT section 1.4): pack rules (T-BM-20), withholding instructions (T-BM-01),
// tax lines, year-end totals and forms (T-BM-10), grievance deadlines and escalation (T-BM-22), the delisted register
// (T-BM-24), filing requirements from packs (T-BM-25), portal locale and notification locale (T-BM-34), TK-B6-18 indexes.
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '../src/testing.js'
import { IN_PACK, IN_PACK_RULES, IN_TAX_RULES } from './fixtures/in-2026-0.js'
import { seedTenantRows, type TenantSeed } from './seed.js'
import { closePoolsAfterAll, insertEvidence, insertRow, PERMISSION_DENIED, race } from './support.js'

const CHECK = { code: '23514' }
const EXCLUSION = { code: '23P01' }
const NOT_ALLOWED = { code: '42501' }
const INSERT_ONLY = /is not allowed/

let tenant: TestTenant
let a: TenantContext
let second: TenantContext
let seed: TenantSeed
let customerType: string

closePoolsAfterAll()

const owner = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await getOwnerPool().query(sql, params)).rows as T[]
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], ctx = a): Promise<T[]> =>
  (await withTenant(ctx, (tx) => tx.query(sql, params))).rows as T[]
const value = async <T>(sql: string, params: unknown[] = [], ctx = a): Promise<T> =>
  Object.values((await rows(sql, params, ctx))[0]!)[0] as T
const failure = (promise: Promise<unknown>) =>
  promise.then(() => null, (error: { code?: string; detail?: string }) => ({ code: error.code, detail: JSON.parse(error.detail ?? 'null') as unknown }))

/** A platform rule of a test pack (owner: pack rows are written by migrations or the owner only). */
function packRule(pack: string, key: string, kind: string, params: unknown, from = '2020-01-01', to: string | null = null) {
  return owner(
    `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from, effective_to)
     VALUES ($1 || '@' || $6, $2, $3, $1, $4, true, 'test basis', 'counsel_confirmed', 'test', $6::date, $5::date)`,
    [key, pack, kind, JSON.stringify(params), to, from],
  )
}

interface TaxRuleFields {
  kind?: string
  conditions?: unknown
  rate?: string | null
  threshold?: string | null
  basis?: string | null
  missingIdRate?: string | null
  rounding?: string
  from?: string
}

function taxRule(pack: string, key: string, f: TaxRuleFields = {}) {
  return owner(
    `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, threshold_minor, threshold_basis, missing_id_rate, rounding,
       mandatory, effective_from, basis, basis_status, source_ref)
     VALUES ($1 || '@' || $10, $2, $1, $3, $4, $5, $6, $7, $8, $9, true, $10::date, 'test basis', 'counsel_confirmed', 'test')`,
    [key, pack, f.kind ?? 'withholding', JSON.stringify(f.conditions ?? {}), f.rate ?? null, f.threshold ?? null, f.basis ?? null,
      f.missingIdRate ?? null, f.rounding ?? 'none', f.from ?? '2020-01-01'],
  )
}

/** A draft market of the pack with a monthly Berlin calendar of `months` periods from `firstMonth` (YYYY-MM-01). */
async function market(code: string, pack: string, firstMonth = '2025-01-01', months = 3, languages = ['de'], zone = 'Europe/Berlin') {
  return withTenant(a, async (tx) => {
    const marketId = await insertRow(tx, 'market', {
      tenant_id: tenant.id, code, currency: 'EUR', minor_unit: 2, time_zone: zone, languages, market_pack: pack, state: 'draft',
    })
    const calendarId = await insertRow(tx, 'calendar', {
      tenant_id: tenant.id, market_id: marketId, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: zone, first_period_start: firstMonth,
    })
    await tx.query(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
       SELECT $1, $2, d AT TIME ZONE $3, (d + interval '1 month') AT TIME ZONE $3
       FROM generate_series($4::timestamp, $4::timestamp + ($5 - 1) * interval '1 month', interval '1 month') AS d`,
      [tenant.id, calendarId, zone, firstMonth, months],
    )
    const { rows: periods } = await tx.query<{ id: string }>('SELECT id FROM period WHERE calendar_id = $1 ORDER BY starts_at', [calendarId])
    return { marketId, periods: periods.map((p) => p.id) }
  })
}

interface Profile {
  taxId?: boolean
  entity?: string
  residency?: string
  validFrom?: string
}

/** A participant of the market (owner) holding positions by type (or a customer type), with an optional tax profile. */
async function participant(marketId: string, ref: string, profile?: Profile, holds = true): Promise<string> {
  const [p] = await owner<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $2, '2020-01-01', $4, 'user') RETURNING id`,
    [tenant.id, ref, marketId, a.userId],
  )
  await owner(
    `INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by, created_by_type)
     VALUES ($1, $2, $3, '2020-01-01', $4, 'user')`,
    [tenant.id, p!.id, holds ? seed.typeId : customerType, a.userId],
  )
  if (profile !== undefined) await taxProfile(p!.id, profile)
  return p!.id
}

function taxProfile(participantId: string, profile: Profile) {
  return owner(
    `INSERT INTO tax_profile (tenant_id, participant_id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, '2020-01-01'), $8)`,
    [tenant.id, participantId, profile.residency ?? null, profile.entity ?? null, profile.taxId === true ? 'sealed' : null,
      profile.taxId === true ? '•••• 34' : null, profile.validFrom ?? null, a.userId],
  )
}

interface Settled {
  participantId: string
  gross: number
  withheld?: number
  line?: { ruleId: string; rate: string; basis: string }
}

/**
 * A committed run of the period (owner: approval, run, settlements, tax lines; the period committed), posted to the ledger
 * by nmp_app through ledger_post (expense, withholding and payables) unless post is false.
 */
async function committedRun(marketId: string, periodId: string, settled: Settled[], post = true): Promise<string> {
  const runId = randomUUID()
  const gross = settled.reduce((sum, s) => sum + s.gross, 0)
  const [approval] = await owner<{ id: string }>(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
     VALUES ($1, 'run', $2, $3, $4, 'approved', now(), $4) RETURNING id`,
    [tenant.id, runId, a.userId, second.userId],
  )
  await owner(
    `INSERT INTO run (id, tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, snapshot_id, engine_version, state,
       totals, inputs_hash, lines_hash, outputs, prepared_by, review_opened_at, review_opened_by, approval_id, finished_at, committed_at)
     VALUES ($1::uuid, $2, $3, $1::text, $4, $5, (SELECT snapshot_id FROM run WHERE id = $6), 'test', 'committed', jsonb_build_object('gross_minor', $7::text), 'x', 'x', '{}', $8, now(), $8, $9,
       now(), now())`,
    [runId, tenant.id, periodId, seed.planVersionId, seed.settingsVersionId, seed.runId, gross, a.userId, approval!.id],
  )
  for (const s of settled) {
    const withheld = s.withheld ?? 0
    await owner(
      `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor, withheld_minor,
         net_payable_minor) VALUES ($1, $2, $3, $4::bigint, 0, 0, $5::bigint, $4::bigint - $5::bigint)`,
      [tenant.id, runId, s.participantId, s.gross, withheld],
    )
    if (s.line !== undefined) {
      await owner(
        `INSERT INTO tax_line (tenant_id, run_id, payee_participant_id, rule_id, taxable_minor, withheld_minor, rate, rate_basis, tax_year, tax_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, tax_year_of($9, tax_date_of($10)), tax_date_of($10))`,
        [tenant.id, runId, s.participantId, s.line.ruleId, s.gross, withheld, s.line.rate, s.line.basis, marketId, periodId],
      )
    }
  }
  await owner(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [periodId, runId])
  if (post) {
    const withheld = settled.reduce((sum, s) => sum + (s.withheld ?? 0), 0)
    const lines = [
      { type: 'commission_expense', payee_participant_id: null, debit_minor: String(gross), credit_minor: '0' },
      ...(withheld > 0 ? [{ type: 'withholding_payable', payee_participant_id: null, debit_minor: '0', credit_minor: String(withheld) }] : []),
      ...settled.map((s) => ({ type: 'payee_payable', payee_participant_id: s.participantId, debit_minor: '0', credit_minor: String(s.gross - (s.withheld ?? 0)) })),
    ]
    await rows(`SELECT ledger_post($1, $2, 'run_committed', 'run', $3::uuid, 'run:' || $3::text, $4, $5)`,
      [marketId, periodId, runId, approval!.id, JSON.stringify(lines)])
  }
  return runId
}

/** A settings version in force now with key = value (owner), with the approved change request an approval key needs. */
async function setSetting(key: string, setting: unknown) {
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
    [tenant.id, key, JSON.stringify(setting), randomUUID(), a.userId, second.userId],
  )
}

const closePeriod = (periodId: string) => owner(
  `UPDATE period SET state = 'closed', closed_at = now(), closed_by = $2, close_note = 'closed for the test' WHERE id = $1`, [periodId, a.userId])

beforeAll(async () => {
  await resetTestDb()
  tenant = await createTenant({ slug: 'acme' })
  a = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  second = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  seed = await seedTenantRows(a, second.userId)
  const [type] = await owner<{ id: string }>(
    `INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state, reason,
       requested_by, decided_by, decided_at, approval_id)
     VALUES ($1, 'CUST', 'Customer', false, true, false, false, 'active', 'bmkt', $2, $3, now(), $4) RETURNING id`,
    [tenant.id, a.userId, second.userId, seed.approvalId],
  )
  customerType = type!.id
})

describe('market packs (section 1.1, T-BM-20)', () => {
  test('pack_rule takes each kind with exact params, one rule per kind in force, and joins market_pack_rules', async () => {
    await packRule('bm-pk', 'pk-grievance', 'grievance_register', { ack_hours: 48, resolution: { days: 30 }, escalation_lead_hours: 24 })
    await packRule('bm-pk', 'pk-delisted', 'delisted_register', { fields: ['external_ref', 'terminated_on'], window_days: 365 })
    await packRule('bm-pk', 'pk-filing', 'plan_filing', { authority: 'Test authority' })
    await packRule('bm-pk', 'pk-year', 'tax_year', { start_month: 4, start_day: 1 })
    await packRule('bm-pk', 'pk-format', 'tax_id_format', { pattern: '^FX[0-9]{6}$', label: 'FX tax id' })

    expect(await value('SELECT array_agg(kind ORDER BY kind) FROM market_pack_rules($1, $2)', ['bm-pk', '2026-01-01'])).toEqual([
      'delisted_register', 'grievance_register', 'plan_filing', 'tax_id_format', 'tax_year',
    ])
    await expect(packRule('bm-pk', 'pk-year-2', 'tax_year', { start_month: 1, start_day: 1 }, '2025-01-01')).rejects.toMatchObject(EXCLUSION)
    await expect(owner(
      `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
       VALUES ('pk-unversioned', 'bm-pk2', 'plan_filing', 't', '{"authority": "x"}', true, 'b', 'screening', 's', '2020-01-01')`,
    )).rejects.toMatchObject(CHECK)
  })

  test.each<[string, string, unknown]>([
    ['grievance extra key', 'grievance_register', { ack_hours: 48, resolution: { days: 30 }, other: 1 }],
    ['grievance ack 0', 'grievance_register', { ack_hours: 0, resolution: { days: 30 } }],
    ['grievance days and months', 'grievance_register', { ack_hours: 48, resolution: { days: 30, months: 1 } }],
    ['grievance months 13', 'grievance_register', { ack_hours: 48, resolution: { months: 13 } }],
    ['grievance fractional hours', 'grievance_register', { ack_hours: 1.5, resolution: { days: 1 } }],
    ['delisted no fields', 'delisted_register', { fields: [] }],
    ['delisted unknown field', 'delisted_register', { fields: ['email'] }],
    ['delisted duplicate field', 'delisted_register', { fields: ['external_ref', 'external_ref'] }],
    ['plan filing empty authority', 'plan_filing', { authority: '' }],
    ['tax year day 29', 'tax_year', { start_month: 2, start_day: 29 }],
    ['tax id format unanchored', 'tax_id_format', { pattern: '[A-Z]{5}', label: 'PAN' }],
    ['tax id format long label', 'tax_id_format', { pattern: '^[A-Z]$', label: 'x'.repeat(41) }],
    ['unknown params shape', 'tax_year', [4, 1]],
  ])('pack_rule params are refused: %s', async (_name, kind, params) => {
    await expect(packRule('bm-bad', `bad-${randomUUID().slice(0, 8)}`, kind, params)).rejects.toMatchObject(CHECK)
  })

  test.each<[string, TaxRuleFields]>([
    ['unknown kind', { kind: 'vat' }],
    ['rate above 1', { rate: '1.5', rounding: 'half_up' }],
    ['missing-id rate without rate', { missingIdRate: '0.2' }],
    ['threshold without basis', { rate: '0.02', rounding: 'half_up', threshold: '100' }],
    ['unknown threshold basis', { rate: '0.02', rounding: 'half_up', threshold: '100', basis: 'lifetime' }],
    ['threshold without rate', { threshold: '100', basis: 'current_year_cumulative' }],
    ['rate with rounding none', { rate: '0.02' }],
    ['condition extra key', { conditions: { country: ['DE'] } }],
    ['unknown entity type', { conditions: { entity_types: ['trust'] } }],
    ['bad residency', { conditions: { residency: ['deu'] } }],
    ['year-end form with a rate', { kind: 'year_end_form', rate: '0.02', conditions: { form_type: 'X', title: 'X' } }],
    ['year-end form bad type', { kind: 'year_end_form', conditions: { form_type: 'x y', title: 'X' } }],
    ['year-end form numeric minimum', { kind: 'year_end_form', conditions: { form_type: 'X', title: 'X', min_gross_minor: 2000 } }],
  ])('tax_rule values are refused: %s', async (_name, fields) => {
    await expect(taxRule('bm-bad-tax', `bad-${randomUUID().slice(0, 8)}`, fields)).rejects.toMatchObject(CHECK)
  })

  test('the B4 fixture rows stay valid; one year-end form per pack in force; pack and tax rows are immutable for everyone', async () => {
    await taxRule('bm-imm', 'imm-no-duty')
    await taxRule('bm-imm', 'imm-form', { kind: 'year_end_form', conditions: { form_type: 'BM-1', title: 'Statement', min_gross_minor: '0' } })
    await packRule('bm-imm', 'imm-year', 'tax_year', { start_month: 1, start_day: 1 })

    await expect(taxRule('bm-imm', 'imm-form-2', { kind: 'year_end_form', conditions: { form_type: 'BM-2', title: 'Other' }, from: '2024-01-01' }))
      .rejects.toMatchObject(EXCLUSION)
    for (const table of ['tax_rule', 'pack_rule']) {
      await expect(owner(`UPDATE ${table} SET title = 'changed' WHERE market_pack = 'bm-imm'`)).rejects.toThrow(INSERT_ONLY)
      await expect(owner(`DELETE FROM ${table} WHERE market_pack = 'bm-imm'`)).rejects.toThrow(INSERT_ONLY)
      await expect(rows(`UPDATE ${table} SET title = 'changed'`)).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  test('IN-2026.0 is a fixture only: no migration ships it; its rows pass every check and are all screening', async () => {
    expect(await owner(
      `SELECT (SELECT count(*) FROM tax_rule WHERE market_pack = $1) + (SELECT count(*) FROM pack_rule WHERE market_pack = $1)
            + (SELECT count(*) FROM guardrail_rule WHERE market_pack = $1) AS n`, [IN_PACK])).toEqual([{ n: '0' }])
    const client = await getOwnerPool().connect()
    try {
      await client.query('BEGIN')
      for (const r of IN_TAX_RULES) {
        await client.query(
          `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, threshold_minor, threshold_basis, missing_id_rate, rounding,
             mandatory, effective_from, basis, basis_status, source_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [r.id, r.market_pack, r.title, r.kind, r.conditions, r.rate, r.threshold_minor, r.threshold_basis, r.missing_id_rate, r.rounding,
            r.mandatory, r.effective_from, r.basis, r.basis_status, r.source_ref],
        )
      }
      for (const r of IN_PACK_RULES) {
        await client.query(
          `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [r.id, r.market_pack, r.kind, r.title, JSON.stringify(r.params), r.mandatory, r.basis, r.basis_status, r.source_ref, r.effective_from],
        )
      }
      const { rows: inForce } = await client.query('SELECT kind, basis_status, mandatory FROM market_pack_rules($1, $2) ORDER BY kind', [IN_PACK, '2026-04-01'])
      expect(inForce).toEqual(['grievance_register', 'tax', 'tax_id_format', 'tax_year'].map((kind) => ({ kind, basis_status: 'screening', mandatory: true })))
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  test('every tax_id_format pattern (database and IN fixture) compiles as a JS RegExp and matches its documented examples', async () => {
    const stored = await owner<{ pattern: string }>(`SELECT params ->> 'pattern' AS pattern FROM pack_rule WHERE kind = 'tax_id_format'`)
    const pan = IN_PACK_RULES.find((r) => r.kind === 'tax_id_format')!
    const panPattern = new RegExp(pan.params.pattern)
    const fx = new RegExp('^FX[0-9]{6}$')

    expect(stored.length).toBeGreaterThan(0)
    for (const { pattern } of stored) expect(() => new RegExp(pattern)).not.toThrow()
    expect(pan.examples.valid.every((example) => panPattern.test(example))).toBe(true)
    expect(pan.examples.invalid.some((example) => panPattern.test(example))).toBe(false)
    expect([fx.test('FX123456'), fx.test('FX12')]).toEqual([true, false])
  })

  test('tax_profile.prior_year_totals is gone (D-BM-03 known limit)', async () => {
    expect(await owner(`SELECT column_name FROM information_schema.columns WHERE table_name = 'tax_profile' AND column_name = 'prior_year_totals'`))
      .toEqual([])
  })
})

describe('withholding instructions (section 4.2, T-BM-01)', () => {
  const instructions = (periodId: string) => rows<Record<string, unknown>>(
    `SELECT x.external_ref, i.rule_id, i.rate::text AS rate, i.rounding, i.threshold_minor, i.prior_minor, i.rate_basis
     FROM tax_withholding_instructions($1) i JOIN participant x ON x.id = i.participant_id ORDER BY x.external_ref`, [periodId])

  test('current_year_cumulative: threshold and this year\'s gross so far; no tax id at the pay instant -> missing-id rate', async () => {
    await taxRule('bm-w-cum', 'cum', { rate: '0.020000', threshold: '2350', basis: 'current_year_cumulative', missingIdRate: '0.200000', rounding: 'half_up' })
    await packRule('bm-w-cum', 'cum-year', 'tax_year', { start_month: 1, start_day: 1 })
    const { marketId, periods: [jan, feb, mar] } = await market('BW', 'bm-w-cum')
    const [febEnd] = await owner<{ ends_at: Date }>('SELECT ends_at FROM period WHERE id = $1', [feb])
    const withId = await participant(marketId, 'BW-A', { taxId: true, entity: 'individual' })
    await participant(marketId, 'BW-B')
    await participant(marketId, 'BW-C', { taxId: true }, false)
    await participant(marketId, 'BW-D', { taxId: true, validFrom: febEnd!.ends_at.toISOString() })
    await committedRun(marketId, jan!, [{ participantId: withId, gross: 1000 }], false)
    const rule = 'cum@2020-01-01'

    expect(await instructions(feb!)).toEqual([
      { external_ref: 'BW-A', rule_id: rule, rate: '0.020000', rounding: 'half_up', threshold_minor: '2350', prior_minor: '1000', rate_basis: 'rate' },
      { external_ref: 'BW-B', rule_id: rule, rate: '0.200000', rounding: 'half_up', threshold_minor: '2350', prior_minor: '0', rate_basis: 'missing_id_rate' },
      { external_ref: 'BW-D', rule_id: rule, rate: '0.200000', rounding: 'half_up', threshold_minor: '2350', prior_minor: '0', rate_basis: 'missing_id_rate' },
    ])
    // A tax id given at the period end applies from the next period on, never retroactively.
    expect((await instructions(mar!)).find((i) => i.external_ref === 'BW-D')).toMatchObject({ rate: '0.020000', rate_basis: 'rate' })
    expect(await value('SELECT tax_date_of($1)::text', [feb!])).toBe('2025-02-28')
    expect(await value('SELECT tax_year_of($1, $2)', [marketId, '2025-02-28'])).toBe(2025)
  })

  test('prior_year_payer_total: at or below the threshold last tax year -> rate 0, below_threshold; above -> the rate', async () => {
    await taxRule('bm-w-prior', 'prior', { rate: '0.020000', threshold: '2350', basis: 'prior_year_payer_total', rounding: 'half_even' })
    await packRule('bm-w-prior', 'prior-year', 'tax_year', { start_month: 1, start_day: 1 })
    const { marketId, periods: [dec, jan] } = await market('BP', 'bm-w-prior', '2024-12-01', 2)
    const at = await participant(marketId, 'BP-E', { taxId: true })
    const above = await participant(marketId, 'BP-F', { taxId: true })
    await committedRun(marketId, dec!, [{ participantId: at, gross: 2350 }, { participantId: above, gross: 2351 }], false)

    expect(await instructions(jan!)).toEqual([
      { external_ref: 'BP-E', rule_id: 'prior@2020-01-01', rate: '0.000000', rounding: 'half_even', threshold_minor: null, prior_minor: '2350', rate_basis: 'below_threshold' },
      { external_ref: 'BP-F', rule_id: 'prior@2020-01-01', rate: '0.020000', rounding: 'half_even', threshold_minor: null, prior_minor: '2351', rate_basis: 'rate' },
    ])
  })

  test('conditions on entity type and residency; rate NULL -> no_duty; no matching rule -> no row', async () => {
    await taxRule('bm-w-cond', 'companies', { rate: '0.100000', rounding: 'half_even', conditions: { entity_types: ['company'], residency: ['DE'] } })
    await taxRule('bm-w-cond', 'individuals', { conditions: { entity_types: ['individual'] } })
    const { marketId, periods: [jan] } = await market('BC', 'bm-w-cond')
    await participant(marketId, 'BC-G', { taxId: true, entity: 'company', residency: 'DE' })
    await participant(marketId, 'BC-H', { entity: 'individual' })
    await participant(marketId, 'BC-I', { taxId: true, entity: 'company', residency: 'FR' })
    await participant(marketId, 'BC-J')

    expect(await instructions(jan!)).toEqual([
      { external_ref: 'BC-G', rule_id: 'companies@2020-01-01', rate: '0.100000', rounding: 'half_even', threshold_minor: null, prior_minor: null, rate_basis: 'rate' },
      { external_ref: 'BC-H', rule_id: 'individuals@2020-01-01', rate: '0.000000', rounding: 'none', threshold_minor: null, prior_minor: null, rate_basis: 'no_duty' },
    ])
    const { periods: [none] } = await market('BX', 'bm-w-none')
    expect(await instructions(none!)).toEqual([])
  })

  test('a tax year rule taking effect mid-year bounds that year; prior gross counts other periods paid by the tax date only', async () => {
    await taxRule('bm-w-mid', 'mid', { rate: '0.020000', threshold: '5000', basis: 'current_year_cumulative', rounding: 'half_up' })
    await packRule('bm-w-mid', 'mid-year', 'tax_year', { start_month: 1, start_day: 1 }, '2025-02-01')
    const { marketId, periods: [feb, mar, apr] } = await market('BM', 'bm-w-mid', '2025-02-01', 3)
    const payee = await participant(marketId, 'BM-A', { taxId: true })
    await committedRun(marketId, feb!, [{ participantId: payee, gross: 1000 }], false)
    await committedRun(marketId, apr!, [{ participantId: payee, gross: 500 }], false)
    const prior = async (periodId: string) => (await instructions(periodId))[0]!.prior_minor

    expect(await value('SELECT tax_year_of($1, $2)', [marketId, '2025-02-28'])).toBe(2025)
    expect(await rows('SELECT starts_on::text, ends_on::text FROM tax_year_bounds($1, 2025)', [marketId]))
      .toEqual([{ starts_on: '2025-01-01', ends_on: '2025-12-31' }])
    expect(await rows('SELECT * FROM tax_year_bounds($1, 2024)', [marketId])).toEqual([])
    // March: February counts, April (committed earlier than March, paid later) does not; February itself never counts itself.
    expect([await prior(mar!), await prior(feb!), await prior(apr!)]).toEqual(['1000', '0', '1000'])
  })

  test('two matching rules -> TX001 TAX_RULE_AMBIGUOUS; a threshold without a tax year -> TX001 TAX_YEAR_NOT_DEFINED', async () => {
    await taxRule('bm-w-amb', 'all', { rate: '0.010000', rounding: 'half_up' })
    await taxRule('bm-w-amb', 'people', { rate: '0.020000', rounding: 'half_up', conditions: { entity_types: ['individual'] } })
    const ambiguous = await market('BA', 'bm-w-amb')
    const person = await participant(ambiguous.marketId, 'BA-K', { entity: 'individual' })
    await participant(ambiguous.marketId, 'BA-L', { entity: 'company' })
    await taxRule('bm-w-noyear', 'noyear-cum', { rate: '0.020000', threshold: '100', basis: 'current_year_cumulative', rounding: 'half_up' })
    const noYear = await market('BN', 'bm-w-noyear')

    expect(await failure(rows('SELECT * FROM tax_withholding_instructions($1)', [ambiguous.periods[0]]))).toEqual({
      code: 'TX001', detail: { code: 'TAX_RULE_AMBIGUOUS', rule_ids: ['all@2020-01-01', 'people@2020-01-01'], participant_ids: [person] },
    })
    expect(await failure(rows('SELECT * FROM tax_withholding_instructions($1)', [noYear.periods[0]])))
      .toEqual({ code: 'TX001', detail: { code: 'TAX_YEAR_NOT_DEFINED' } })
  })
})

describe('tax lines (section 1.2, AC-TAX2-6)', () => {
  test('are written only while their run is running, never changed, consistent, and a portal session reads its own', async () => {
    const payee = await participant(seed.marketId, 'TL-1')
    const line = { tenant_id: tenant.id, run_id: seed.runId, payee_participant_id: payee, rule_id: 'seed-withholding@2026-01-01',
      taxable_minor: 10, withheld_minor: 0, rate: '0', rate_basis: 'no_duty', tax_year: 2026, tax_date: '2026-01-31' }
    const insert = (row: Record<string, unknown>) => getOwnerPool().query(
      `INSERT INTO tax_line (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row))

    await expect(withTenant(a, (tx) => insertRow(tx, 'tax_line', line))).rejects.toMatchObject(CHECK)
    await expect(insert({ ...line, run_id: randomUUID() })).rejects.toThrow()
    await expect(insert({ ...line, rate_basis: 'below_threshold', rate: '0.02' })).rejects.toMatchObject(CHECK)
    await expect(insert({ ...line, withheld_minor: 11, rate_basis: 'rate', rate: '1' })).rejects.toMatchObject(CHECK)
    await expect(rows('UPDATE tax_line SET withheld_minor = 0')).rejects.toThrow(PERMISSION_DENIED)
    await expect(owner('UPDATE tax_line SET withheld_minor = 0')).rejects.toThrow(INSERT_ONLY)
    const portal = { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId }
    const own = await rows<{ payee_participant_id: string }>('SELECT payee_participant_id FROM tax_line', [], portal)
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((r) => r.payee_participant_id === seed.participantId)).toBe(true)
    expect(await value('SELECT count(*)::int FROM tax_form_generation', [], portal)).toBe(0)
  })

  test('the payee\'s data export holds its tax lines and year-end forms (D-BM-13)', async () => {
    const exported = await value<{ tax_lines: unknown[]; tax_forms: unknown[] }>('SELECT prv_personal_data($1)', [seed.participantId])

    expect(exported.tax_lines.length).toBeGreaterThan(0)
    expect(exported.tax_forms).toEqual([expect.objectContaining({ tax_year: 2026, form_type: 'SEED', version: 1, payee_ref: 'seed-distributor' })])
  })
})

describe('year-end statements (section 4.2, T-BM-10)', () => {
  let marketId: string
  let jan: string
  let feb: string
  let mar: string
  const p = { one: '', two: '', three: '', four: '' }
  const generate = (year = 2025, ctx = a) => value<Record<string, unknown>>('SELECT tax_generate_forms($1, $2)', [marketId, year], ctx)
  const status = (year = 2025) => value<Record<string, unknown>>('SELECT tax_year_end_status($1, $2)', [marketId, year])
  const forms = () => rows<{ ref: string; version: number; totals: unknown; hashed: boolean; masked: string }>(
    `SELECT payee_ref AS ref, version, totals, totals_hash = digest(totals::text, 'sha256') AS hashed, tax_id_masked AS masked
     FROM tax_form WHERE market_id = $1 ORDER BY payee_ref, version`, [marketId])

  beforeAll(async () => {
    await taxRule('bm-y', 'wh', { rate: '0.020000', missingIdRate: '0.200000', rounding: 'half_up' })
    await taxRule('bm-y', 'form', { kind: 'year_end_form', conditions: { form_type: 'BM-ANNUAL', title: 'Annual statement', min_gross_minor: '2000' } })
    await packRule('bm-y', 'year', 'tax_year', { start_month: 1, start_day: 1 })
    const created = await market('BY', 'bm-y')
    marketId = created.marketId
    ;[jan, feb, mar] = created.periods as [string, string, string]
    p.one = await participant(marketId, 'BY-1', { taxId: true })
    p.two = await participant(marketId, 'BY-2', { taxId: true })
    p.three = await participant(marketId, 'BY-3')
    p.four = await participant(marketId, 'BY-4', { taxId: true })
    const rule = 'wh@2020-01-01'
    await committedRun(marketId, jan, [
      { participantId: p.one, gross: 24000, withheld: 480, line: { ruleId: rule, rate: '0.020000', basis: 'rate' } },
      { participantId: p.two, gross: 2300, line: { ruleId: rule, rate: '0', basis: 'below_threshold' } },
      { participantId: p.three, gross: 1000, withheld: 200, line: { ruleId: rule, rate: '0.200000', basis: 'missing_id_rate' } },
      { participantId: p.four, gross: 100, line: { ruleId: rule, rate: '0', basis: 'below_threshold' } },
    ])
  })

  test('totals per payee, inclusion by withheld or min_gross_minor, held without a tax id, ledger equality', async () => {
    const totals = await rows(
      `SELECT payee_ref, gross_minor, taxable_minor, withheld_minor, has_tax_id, included, latest_version, by_rule
       FROM tax_year_end_totals($1, 2025)`, [marketId])

    expect(totals).toEqual([
      { payee_ref: 'BY-1', gross_minor: '24000', taxable_minor: '24000', withheld_minor: '480', has_tax_id: true, included: true, latest_version: null,
        by_rule: [{ rule_id: 'wh@2020-01-01', rate: '0.020000', taxable_minor: '24000', withheld_minor: '480' }] },
      { payee_ref: 'BY-2', gross_minor: '2300', taxable_minor: '2300', withheld_minor: '0', has_tax_id: true, included: true, latest_version: null,
        by_rule: [{ rule_id: 'wh@2020-01-01', rate: '0.000000', taxable_minor: '2300', withheld_minor: '0' }] },
      { payee_ref: 'BY-3', gross_minor: '1000', taxable_minor: '1000', withheld_minor: '200', has_tax_id: false, included: true, latest_version: null,
        by_rule: [{ rule_id: 'wh@2020-01-01', rate: '0.200000', taxable_minor: '1000', withheld_minor: '200' }] },
      { payee_ref: 'BY-4', gross_minor: '100', taxable_minor: '100', withheld_minor: '0', has_tax_id: true, included: false, latest_version: null,
        by_rule: [{ rule_id: 'wh@2020-01-01', rate: '0.000000', taxable_minor: '100', withheld_minor: '0' }] },
    ])
    expect(await status()).toMatchObject({
      bounds: { starts_on: '2025-01-01', ends_on: '2025-12-31' }, ended: true, open_period_ids: [jan],
      form_rule: { id: 'form@2020-01-01', form_type: 'BM-ANNUAL', title: 'Annual statement', min_gross_minor: '2000' },
      reasons: ['TAX_YEAR_NOT_CLOSED'],
      totals: { withheld_minor: '680', ledger_withheld_minor: '680', equal: true, included: 3, held: 1 },
    })
  })

  test('refusals: committed periods and uncommitted runs, year not ended, no form, no tax year, busy, portal', async () => {
    const [calculated] = await owner<{ id: string }>(
      `INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, snapshot_id, engine_version, state, totals,
         inputs_hash, lines_hash, outputs, prepared_by, finished_at)
       VALUES ($1, $2, 'bm-calculated', $3, $4, (SELECT snapshot_id FROM run WHERE id = $5), 'test', 'calculated', '{}', 'x', 'x', '{}', $6, now()) RETURNING id`,
      [tenant.id, feb, seed.planVersionId, seed.settingsVersionId, seed.runId, a.userId])

    expect(await failure(generate())).toEqual({ code: 'TX001', detail: { code: 'TAX_YEAR_NOT_CLOSED', period_ids: [jan, feb] } })
    await owner(`UPDATE run SET state = 'discarded' WHERE id = $1`, [calculated!.id])
    expect(await failure(generate(2099))).toEqual({ code: 'TX001', detail: { code: 'TAX_YEAR_NOT_ENDED' } })
    await packRule('bm-y-noform', 'noform-year', 'tax_year', { start_month: 1, start_day: 1 })
    const noForm = await market('BYF', 'bm-y-noform')
    const noYear = await market('BYN', 'bm-y-noyear')
    expect(await failure(rows('SELECT tax_generate_forms($1, 2025)', [noForm.marketId]))).toEqual({ code: 'TX001', detail: { code: 'FORM_NOT_DEFINED' } })
    expect(await failure(rows('SELECT tax_generate_forms($1, 2025)', [noYear.marketId]))).toEqual({ code: 'TX001', detail: { code: 'TAX_YEAR_NOT_DEFINED' } })
    expect(await failure(generate(2025, { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId })))
      .toMatchObject(NOT_ALLOWED)
    const busy = await race(a,
      (tx) => tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('tax_forms:' || $1 || ':' || $2 || ':2025', 0))`, [tenant.id, marketId]),
      (tx) => tx.query('SELECT tax_generate_forms($1, 2025)', [marketId]))
    expect(busy).toEqual({ waited: false, outcome: { ok: false, code: 'TX002' } })
  })

  test('generation: version 1 per included payee with a tax id, held listed, unchanged on repeat, new versions only on change', async () => {
    await closePeriod(jan)

    expect(await generate()).toMatchObject({ generated: 2, unchanged: 0, held: [{ participant_id: p.three, payee_ref: 'BY-3' }] })
    expect(await forms()).toEqual([
      { ref: 'BY-1', version: 1, hashed: true, masked: '•••• 34', totals: {
        gross_minor: '24000', taxable_minor: '24000', withheld_minor: '480', period_ids: [jan],
        by_rule: [{ rule_id: 'wh@2020-01-01', rate: '0.020000', taxable_minor: '24000', withheld_minor: '480' }] } },
      { ref: 'BY-2', version: 1, hashed: true, masked: '•••• 34', totals: {
        gross_minor: '2300', taxable_minor: '2300', withheld_minor: '0', period_ids: [jan],
        by_rule: [{ rule_id: 'wh@2020-01-01', rate: '0.000000', taxable_minor: '2300', withheld_minor: '0' }] } },
    ])
    expect(await rows(`SELECT template, channel, locale, params ->> 'tax_year' AS year FROM notification WHERE recipient_participant_id = $1`, [p.one]))
      .toEqual([{ template: 'tax_form.available', channel: 'in_app', locale: 'de', year: '2025' }])
    expect(await generate()).toMatchObject({ generated: 0, unchanged: 2, held: [{ participant_id: p.three, payee_ref: 'BY-3' }] })

    await taxProfile(p.three, { taxId: true, validFrom: new Date(Date.now() - 1000).toISOString() })
    expect(await generate()).toMatchObject({ generated: 1, unchanged: 2, held: [] })
    await committedRun(marketId, mar, [{ participantId: p.one, gross: 1000, withheld: 20, line: { ruleId: 'wh@2020-01-01', rate: '0.020000', basis: 'rate' } }])
    await closePeriod(mar)
    expect(await generate()).toMatchObject({ generated: 1, unchanged: 2, held: [] })
    expect((await forms()).map((f) => [f.ref, f.version])).toEqual([['BY-1', 1], ['BY-1', 2], ['BY-2', 1], ['BY-3', 1]])
    expect(await rows('SELECT generated, unchanged, withheld_total_minor, ledger_withheld_minor FROM tax_form_generation WHERE market_id = $1 ORDER BY created_at', [marketId]))
      .toHaveLength(4)
    expect(await value('SELECT count(*)::int FROM tax_form', [], { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId }))
      .toBe(1) // the seed's own form only
  })

  test('forms and generations are written only by tax_generate_forms and never change', async () => {
    const [form] = await rows<{ generation_id: string }>('SELECT generation_id FROM tax_form WHERE market_id = $1 LIMIT 1', [marketId])

    await expect(withTenant(a, (tx) => insertRow(tx, 'tax_form', {
      tenant_id: tenant.id, generation_id: form!.generation_id, market_id: marketId, tax_year: 2025, form_type: 'BM-ANNUAL', participant_id: p.four,
      version: 1, payee_ref: 'BY-4', tax_id_masked: 'x', currency: 'EUR', totals: {},
    }))).rejects.toThrow(PERMISSION_DENIED)
    await expect(withTenant(a, (tx) => insertRow(tx, 'tax_form_generation', {
      tenant_id: tenant.id, market_id: marketId, tax_year: 2025, form_type: 'X', rule_id: 'form@2020-01-01', generated: 0, unchanged: 0,
      held: '[]', withheld_total_minor: 0, ledger_withheld_minor: 0,
    }))).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('UPDATE tax_form SET version = 9')).rejects.toThrow(PERMISSION_DENIED)
    // SECURITY DEFINER: only a market of the acting tenant.
    await expect(rows('SELECT tax_generate_forms($1, 2025)', [randomUUID()])).rejects.toMatchObject({ code: '22023' })
    await expect(owner('DELETE FROM tax_form_generation')).rejects.toThrow(INSERT_ONLY)
  })

  test('a ledger that differs from the withheld totals refuses the generation (23514) and writes nothing', async () => {
    await committedRun(marketId, feb, [{ participantId: p.four, gross: 100, withheld: 10, line: { ruleId: 'wh@2020-01-01', rate: '0.100000', basis: 'rate' } }], false)
    await closePeriod(feb)
    const before = await value<number>('SELECT count(*)::int FROM tax_form_generation')

    expect(await status()).toMatchObject({ totals: { withheld_minor: '710', ledger_withheld_minor: '700', equal: false } })
    expect(await failure(generate())).toMatchObject(CHECK)
    expect(await value('SELECT count(*)::int FROM tax_form_generation')).toBe(before)
  })
})

describe('grievances (section 1.3, T-BM-22 SQL part)', () => {
  let marketId: string
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)
  const grievance = (received: Date, state: 'open' | 'submitted' = 'open', market = marketId) => withTenant(a, async (tx) => {
    const id = await insertRow(tx, 'case_file', {
      tenant_id: tenant.id, type: 'grievance', subject_type: 'market', subject_id: market, reason_code: 'payout', state: 'open',
      payload: { received_at: received.toISOString(), channel: 'email' }, market_id: market, opened_by: a.userId,
    })
    if (state === 'submitted') {
      await tx.query(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [id, a.userId])
    }
    return id
  })
  const escalate = (caseId: string, deadline: string | null, ctx = a, actor: string | null = null) => rows(
    `INSERT INTO case_event (tenant_id, case_id, kind, actor_id, data) VALUES ($1, $2, 'escalated', $3, $4)`,
    [tenant.id, caseId, actor, deadline === null ? {} : { deadline }], ctx)

  beforeAll(async () => {
    await packRule('bm-g', 'grievance', 'grievance_register', { ack_hours: 48, resolution: { days: 30 }, escalation_lead_hours: 24 })
    marketId = (await market('BG', 'bm-g')).marketId
  })

  test('deadlines come from received_at and the pack rule in force then; no rule -> no row', async () => {
    const received = hoursAgo(72)
    const id = await grievance(received)
    const [deadlines] = await rows<{ rule_id: string; ack: Date; resolution: Date; lead_hours: number }>(
      'SELECT rule_id, ack_due_at AS ack, resolution_due_at AS resolution, lead_hours FROM cpl_grievance_deadlines($1)', [id])
    const [expected] = await owner<{ resolution: Date }>(
      `SELECT (($1::timestamptz AT TIME ZONE 'Europe/Berlin') + interval '30 days') AT TIME ZONE 'Europe/Berlin' AS resolution`, [received])

    expect(deadlines).toEqual({ rule_id: 'grievance@2020-01-01', ack: new Date(received.getTime() + 48 * 3_600_000), resolution: expected!.resolution, lead_hours: 24 })
    expect(await rows('SELECT * FROM cpl_grievance_deadlines($1)', [await grievance(hoursAgo(72), 'open', seed.marketId)])).toEqual([])
  })

  test('the system escalates once per deadline from due - lead: ack while open, resolution while submitted', async () => {
    const late = await grievance(hoursAgo(72))
    const recent = await grievance(hoursAgo(1))
    const overdue = await grievance(hoursAgo(40 * 24), 'submitted')
    const pending = await grievance(hoursAgo(10 * 24), 'submitted')
    const elsewhere = await grievance(hoursAgo(72), 'open', seed.marketId)

    await expect(escalate(late, 'resolution')).rejects.toMatchObject(NOT_ALLOWED)
    await escalate(late, 'ack')
    await expect(escalate(late, 'ack')).rejects.toMatchObject(NOT_ALLOWED)
    await expect(escalate(recent, 'ack')).rejects.toMatchObject(NOT_ALLOWED)
    await expect(escalate(overdue, 'ack')).rejects.toMatchObject(NOT_ALLOWED)
    await escalate(overdue, 'resolution')
    await expect(escalate(pending, 'resolution')).rejects.toMatchObject(NOT_ALLOWED)
    await expect(escalate(elsewhere, 'ack')).rejects.toMatchObject(NOT_ALLOWED)
    await expect(escalate(late, null)).rejects.toMatchObject(NOT_ALLOWED)
    const other = await grievance(hoursAgo(72))
    await expect(escalate(other, 'ack', a, a.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(escalate(other, 'ack', { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId }))
      .rejects.toMatchObject(NOT_ALLOWED)
  })

  test('received_at of a grievance is fixed; other payload fields still change', async () => {
    const id = await grievance(hoursAgo(5))
    const update = (payload: string) => rows(`UPDATE case_file SET payload = payload || $2::jsonb WHERE id = $1`, [id, payload])

    await expect(update(JSON.stringify({ received_at: hoursAgo(1).toISOString() }))).rejects.toMatchObject(NOT_ALLOWED)
    await update('{"channel": "letter"}')
  })

  test('dispute escalation is unchanged: only a submitted dispute past its due date (regression)', async () => {
    const [dispute] = await owner<{ id: string }>(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by)
       VALUES ($1, 'dispute', 'result_line', $2, 'X', 'open', '{}', $3, $4) RETURNING id`, [tenant.id, randomUUID(), seed.marketId, a.userId])
    const submit = (due: string) => owner(
      `UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = coalesce(submitted_at, now()), due_at = now() + $3::interval
       WHERE id = $1`, [dispute!.id, a.userId, due])

    await expect(escalate(dispute!.id, null)).rejects.toMatchObject(NOT_ALLOWED)
    await submit('1 day')
    await expect(escalate(dispute!.id, null)).rejects.toMatchObject(NOT_ALLOWED)
    await submit('-1 day')
    await escalate(dispute!.id, null)
  })

  test('cpl_grievances_to_escalate lists what the guard admits, by due instant, in the system realm only', async () => {
    const due = await grievance(hoursAgo(80))

    const listed = await withSystem((tx) => tx.query<{ tenant_id: string; case_id: string; deadline: string }>(
      'SELECT * FROM cpl_grievances_to_escalate(1000)')).then((r) => r.rows.filter((row) => row.tenant_id === tenant.id))
    expect(listed.find((row) => row.case_id === due)).toEqual({ tenant_id: tenant.id, case_id: due, deadline: 'ack' })
    expect(listed.every((row) => row.deadline === 'ack' || row.deadline === 'resolution')).toBe(true)
    await escalate(due, 'ack')
    const again = await withSystem((tx) => tx.query('SELECT case_id FROM cpl_grievances_to_escalate(1000)'))
    expect(again.rows.map((row) => row.case_id)).not.toContain(due)
    await expect(rows('SELECT * FROM cpl_grievances_to_escalate(10)')).rejects.toMatchObject(NOT_ALLOWED)
    await expect(withSystem((tx) => tx.query('SELECT * FROM cpl_grievances_to_escalate(0)'))).rejects.toMatchObject({ code: '22023' })
  })
})

describe('delisted sellers (section 1.3, T-BM-24 SQL part)', () => {
  test('participants whose owned positions are all terminated by the date, with the latest termination date in the market zone', async () => {
    const { marketId } = await market('BD', 'bm-d')
    const position = async (participantId: string, status: string, from: string) => {
      const [pos] = await owner<{ id: string }>(
        `INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'user') RETURNING id`, [tenant.id, `bd-${randomUUID().slice(0, 8)}`, marketId, status, from, a.userId])
      await owner(`INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
                   VALUES ($1, $2, $3, '2020-01-01', $4, 'user')`, [tenant.id, pos!.id, participantId, a.userId])
    }
    const gone = await participant(marketId, 'BD-X')
    await position(gone, 'terminated', '2026-01-05T10:00:00Z')
    await position(gone, 'terminated', '2026-03-10T23:30:00Z')
    const half = await participant(marketId, 'BD-Y')
    await position(half, 'terminated', '2026-01-05T10:00:00Z')
    await position(half, 'active', '2020-01-01T00:00:00Z')
    await participant(marketId, 'BD-Z')

    expect(await rows(`SELECT participant_id, external_ref, display_name, terminated_on::text FROM cpl_delisted($1, '2026-11-01')`, [marketId]))
      .toEqual([{ participant_id: gone, external_ref: 'BD-X', display_name: 'BD-X', terminated_on: '2026-03-11' }])
    expect(await rows(`SELECT * FROM cpl_delisted($1, '2026-03-10')`, [marketId])).toEqual([])
  })
})

describe('plan filing from packs (section 4.2, T-BM-25 SQL part)', () => {
  test('a pack plan_filing rule requires a filing even without the setting; setting and pack are listed per source', async () => {
    await packRule('bm-f', 'filing', 'plan_filing', { authority: 'Test authority' })
    const { marketId } = await market('BF', 'bm-f')
    const versionId = await withTenant(a, async (tx) => {
      const planId = await insertRow(tx, 'plan', { tenant_id: tenant.id, name: 'Plan BF', created_by: a.userId })
      await tx.query('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [tenant.id, planId, marketId])
      const id = await insertRow(tx, 'plan_version', { tenant_id: tenant.id, plan_id: planId, version: 1, engine_version: 'test', compiled: {}, created_by: a.userId })
      await tx.query(
        `UPDATE plan_version SET state = 'in_review', crediting_event = 'paid', content_hash = digest(compiled::text, 'sha256'),
           submitted_by = $2, submitted_at = now() WHERE id = $1`, [id, a.userId])
      return id
    })
    const required = () => rows('SELECT market_id, source, rule_id, authority FROM plan_filing_required($1)', [versionId])

    expect(await required()).toEqual([{ market_id: marketId, source: 'pack', rule_id: 'filing@2020-01-01', authority: 'Test authority' }])
    expect(await value('SELECT plan_filing_missing($1)', [versionId])).toEqual([marketId])
    await setSetting('plan.filing_requirements', { market_ids: [marketId] })
    expect(await required()).toEqual([
      { market_id: marketId, source: 'pack', rule_id: 'filing@2020-01-01', authority: 'Test authority' },
      { market_id: marketId, source: 'setting', rule_id: null, authority: null },
    ])
    expect(await value('SELECT plan_filing_missing($1)', [versionId])).toEqual([marketId])
    await withTenant(a, async (tx) => insertRow(tx, 'plan_version_filing', {
      tenant_id: tenant.id, plan_version_id: versionId, market_id: marketId, status: 'filed', reference: 'BF-1', filed_on: '2026-01-02',
      document_id: await insertEvidence(tx, tenant.id, a.userId),
    }))
    expect(await value('SELECT plan_filing_missing($1)', [versionId])).toEqual([])
  })
})

describe('locale (section 1.3, T-BM-34)', () => {
  test('portal_locale and the notification trigger: preference, else the market\'s first language subtag, else en', async () => {
    const locales: string[] = []
    for (const [code, languages] of [['LGB', ['en-GB']], ['LAT', ['de-AT']], ['LFI', ['fil']]] as const) {
      const { marketId } = await market(code, 'bm-l', '2025-01-01', 1, [...languages])
      const id = await participant(marketId, `${code}-1`)
      await rows(`SELECT notify_participant($1, 'tax_profile.changed', '{}')`, [id])
      locales.push(await value<string>('SELECT locale FROM notification WHERE recipient_participant_id = $1', [id]))
      expect(await value('SELECT portal_locale($1)', [id])).toBe(locales.at(-1))
    }
    expect(locales).toEqual(['en', 'de', 'en'])

    expect(await owner('SELECT locale FROM user_account WHERE id = $1', [seed.portalUserId])).toEqual([{ locale: null }])
    const portal = { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId }
    await rows(`UPDATE user_account SET locale = 'de' WHERE id = $1`, [seed.portalUserId], portal)
    expect(await value('SELECT portal_locale($1)', [seed.participantId], portal)).toBe('de')
    await rows(`SELECT notify_participant($1, 'tax_profile.changed', '{}')`, [seed.participantId])
    expect(await value(`SELECT locale FROM notification WHERE recipient_participant_id = $1 ORDER BY created_at DESC LIMIT 1`, [seed.participantId]))
      .toBe('de')
  })

  test('a user changes only its own locale, alone; staff accounts hold none; the value is a 2-letter code', async () => {
    const portal = { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId }

    await expect(rows(`UPDATE user_account SET locale = 'en' WHERE id = $1`, [seed.portalUserId])).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`UPDATE user_account SET locale = 'en', last_sign_in_at = now() WHERE id = $1`, [seed.portalUserId], portal))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`UPDATE user_account SET locale = 'deu' WHERE id = $1`, [seed.portalUserId], portal)).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE user_account SET locale = 'de' WHERE id = $1`, [a.userId])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE user_account SET locale = NULL WHERE id = $1`, [seed.portalUserId], portal)
    expect(await owner('SELECT locale FROM user_account WHERE id = $1', [seed.portalUserId])).toEqual([{ locale: null }])
  })
})

describe('indexes', () => {
  test('the B6 dashboard indexes (TK-B6-18) and the tax form reads by participant and by market year exist', async () => {
    const names = ['order_event_occurred_idx', 'sales_order_amount_idx', 'sales_order_market_credited_idx', 'tax_form_market_year_idx',
      'tax_form_participant_idx']
    expect(await owner<{ indexname: string }>('SELECT indexname FROM pg_indexes WHERE indexname = ANY ($1) ORDER BY 1', [names]))
      .toEqual(names.map((indexname) => ({ indexname })))
  })
})
