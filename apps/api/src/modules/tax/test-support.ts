// TEST FIXTURES ONLY: labelled tax pack rules (not real market rules, DEC-14), markets, payees with sealed tax ids, and
// committed runs with their settlements, tax lines and run_committed ledger postings, written by the owner as COMP, LED
// and migrations would have written them (pack rows are immutable platform data, so every pack gets a fresh name).
import { randomBytes, randomUUID } from 'node:crypto'
import { ownerReplica, ownerRows, TEST_SECRET_KEY } from '../../../test/helpers/index.js'
import { seal } from '../../lib/secret-box.js'
import { sealContext } from './access.js'

const SYSTEM = '00000000-0000-0000-0000-000000000000'
const ZONE = 'Europe/Vienna'

export const FIXTURE_FORM = { form_type: 'FX-ANNUAL', title: 'FIXTURE annual statement', min_gross_minor: '2000' }
export const FIXTURE_FORMAT = { pattern: '^FX[0-9]{6}$', label: 'FX tax id' }

export interface TaxPack {
  readonly pack: string
  readonly withholdingId: string
  readonly formId: string | null
}

/** A fixture pack: tax year from 1 January, a 2 % withholding rule, optionally the year-end form and the tax-id format. */
export async function taxPack(options: { form?: boolean; taxYear?: boolean; format?: boolean } = {}): Promise<TaxPack> {
  const key = `taxfx-${randomBytes(4).toString('hex')}`
  const withholdingId = `${key}-wh@2020-01-01`
  const formId = options.form === false ? null : `${key}-form@2020-01-01`
  const basis = `'FIXTURE basis, not a real tax rule', 'counsel_confirmed', 'FIXTURE'`
  await ownerRows(
    `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, threshold_minor, threshold_basis, missing_id_rate, rounding,
       mandatory, effective_from, basis, basis_status, source_ref)
     VALUES ($1, $2, 'FIXTURE withholding', 'withholding', '{}', 0.020000, 2350, 'current_year_cumulative', 0.200000, 'half_up', true,
       '2020-01-01', ${basis})`,
    [withholdingId, key],
  )
  if (formId !== null) {
    await ownerRows(
      `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rounding, mandatory, effective_from, basis, basis_status, source_ref)
       VALUES ($1, $2, 'FIXTURE year-end form', 'year_end_form', $3, 'none', true, '2020-01-01', ${basis})`,
      [formId, key, FIXTURE_FORM],
    )
  }
  const packRule = (rule: string, kind: string, params: unknown) => ownerRows(
    `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
     VALUES ($1, $2, $3, $4, $5, true, ${basis}, '2020-01-01')`,
    [`${key}-${rule}@2020-01-01`, key, kind, `FIXTURE ${kind}`, params],
  )
  if (options.taxYear !== false) await packRule('year', 'tax_year', { start_month: 1, start_day: 1 })
  if (options.format === true) await packRule('format', 'tax_id_format', FIXTURE_FORMAT)
  return { pack: key, withholdingId, formId }
}

export interface TaxMarket {
  readonly marketId: string
  readonly calendarId: string
}

/** A live market of the pack (EUR, Vienna, German) with a monthly calendar. */
export async function taxMarket(tenantId: string, pack: string, code: string): Promise<TaxMarket> {
  const [market] = await ownerRows<{ id: string }>(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, $2, 'EUR', 2, $3, '{de-AT}', $4, 'live') RETURNING id`,
    [tenantId, code, ZONE, pack],
  )
  const [calendar] = await ownerRows<{ id: string }>(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, 'Monthly', 'monthly', $3, '2020-01-01') RETURNING id`,
    [tenantId, market!.id, ZONE],
  )
  return { marketId: market!.id, calendarId: calendar!.id }
}

/** A participant of the market; with a tax id, a profile version from 2020 holding it sealed (as TAX stores it). */
export async function payee(tenantId: string, marketId: string, ref: string, taxId?: string): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $2, $4, '2020-01-01', $5, 'system') RETURNING id`,
    [tenantId, ref, marketId, { email: `${ref.toLowerCase()}@example.test` }, SYSTEM],
  )
  if (taxId !== undefined) await taxProfile(tenantId, row!.id, taxId, '2020-01-01')
  return row!.id
}

/** A tax-profile version from `from` holding the sealed tax id; the open version before it is closed then. */
export async function taxProfile(tenantId: string, participantId: string, taxId: string, from: string): Promise<void> {
  const id = randomUUID()
  await ownerReplica('UPDATE tax_profile SET valid_to = $2 WHERE participant_id = $1 AND valid_to IS NULL', [participantId, from])
  await ownerReplica(
    `INSERT INTO tax_profile (id, tenant_id, participant_id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, created_by)
     VALUES ($1, $2, $3, 'AT', 'individual', $4, $5, $6, $7)`,
    [id, tenantId, participantId, seal(Buffer.from(TEST_SECRET_KEY, 'base64'), taxId, sealContext(id)), `•••• ${taxId.slice(-4)}`, from, SYSTEM],
  )
}

export interface Paid {
  readonly participantId: string
  readonly gross: number
  readonly withheld: number
}

/**
 * The month's (YYYY-MM, Vienna) period in `state` with a committed run paying `paid` (2 % lines, or below threshold when
 * nothing is withheld), posted to the market's withholding_payable account (`ledgerWithheld`, default Σ withheld).
 */
export async function committedRun(
  tenantId: string, market: TaxMarket, ruleId: string, month: string, paid: readonly Paid[],
  options: { state?: 'closed' | 'committed'; ledgerWithheld?: number } = {},
): Promise<{ runId: string; periodId: string }> {
  const state = options.state ?? 'closed'
  const [period] = await ownerReplica<{ id: string }>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state, closed_at, closed_by, close_note)
     VALUES ($1, $2, ($3 || '-01')::timestamp AT TIME ZONE $4, (($3 || '-01')::date + interval '1 month') AT TIME ZONE $4, $5,
             CASE WHEN $5 = 'closed' THEN now() END, CASE WHEN $5 = 'closed' THEN $6::uuid END, CASE WHEN $5 = 'closed' THEN 'FIXTURE' END)
     RETURNING id`,
    [tenantId, market.calendarId, month, ZONE, state, SYSTEM],
  )
  const gross = paid.reduce((sum, p) => sum + p.gross, 0)
  const [run] = await ownerReplica<{ id: string }>(
    `INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, snapshot_id, engine_version, state, totals,
       inputs_hash, lines_hash, outputs, finished_at, approval_id, review_opened_at, review_opened_by, committed_at, prepared_by)
     VALUES ($1, $2, gen_random_uuid()::text, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '0.2.0', 'committed',
             jsonb_build_object('gross_minor', $3::text), 'x', 'x', '{}', now(), gen_random_uuid(), now(), $4, now(), $4) RETURNING id`,
    [tenantId, period!.id, gross, SYSTEM],
  )
  const runId = run!.id
  await ownerReplica('UPDATE period SET committed_run_id = $2 WHERE id = $1', [period!.id, runId])
  for (const p of paid) {
    await ownerReplica(
      `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor, withheld_minor, net_payable_minor)
       VALUES ($1, $2, $3, $4::bigint, 0, 0, $5::bigint, $4::bigint - $5::bigint)`,
      [tenantId, runId, p.participantId, p.gross, p.withheld],
    )
    await ownerReplica(
      `INSERT INTO tax_line (tenant_id, run_id, payee_participant_id, rule_id, taxable_minor, withheld_minor, rate, rate_basis, tax_year, tax_date)
       VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, CASE WHEN $6::bigint > 0 THEN 0.020000 ELSE 0 END,
               CASE WHEN $6::bigint > 0 THEN 'rate' ELSE 'below_threshold' END, extract(year FROM ($7::text || '-01')::date)::int,
               (($7::text || '-01')::date + interval '1 month' - interval '1 day')::date)`,
      [tenantId, runId, p.participantId, ruleId, p.gross, p.withheld, month],
    )
  }
  const ledgerWithheld = options.ledgerWithheld ?? paid.reduce((sum, p) => sum + p.withheld, 0)
  const [entry] = await ownerReplica<{ id: string }>(
    `INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, created_by, created_by_type)
     VALUES ($1, $2, $3, 'run_committed', 'run', $4::uuid, 'run:' || $4::uuid::text, gen_random_uuid(), $5, 'system') RETURNING id`,
    [tenantId, market.marketId, period!.id, runId, SYSTEM],
  )
  if (ledgerWithheld > 0) {
    const [account] = await ownerReplica<{ id: string }>(
      `INSERT INTO ledger_account (tenant_id, market_id, type, currency) VALUES ($1, $2, 'withholding_payable', 'EUR')
       ON CONFLICT ON CONSTRAINT ledger_account_key DO UPDATE SET currency = EXCLUDED.currency RETURNING id`,
      [tenantId, market.marketId],
    )
    await ownerReplica(
      `INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency) VALUES ($1, $2, $3, 0, $4, 'EUR')`,
      [tenantId, entry!.id, account!.id, ledgerWithheld],
    )
  }
  return { runId, periodId: period!.id }
}
