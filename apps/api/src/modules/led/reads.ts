import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'
import { getSetting } from '../ten/index.js'
import { ACCOUNT_TYPES, balanceOf, marketInScope, normalSide } from './ledger.js'
import { writeOffEligible } from './write-off.js'

// API-23/24 ledger reads (PLAN B4 section 2.1). Balances are summed per request (D-B4-03); scope is the object's
// market, a payee's balances by each account's market (D-B4-23).

type Scope = readonly string[] | null

const IN_SCOPE = (column: string, n: number): string => `($${n}::uuid[] IS NULL OR ${column} = ANY ($${n}))`

/** Time-ordered cursors carry the timestamp as PostgreSQL text: exact to the microsecond. */
export interface TimeCursor {
  readonly at: string
  readonly id: string
}

const person = (id: string | null, name: string | null) => (id === null ? null : { id, display_name: name })

/** GET /v1/ledger/summary: totals by account type, balance check and entry count of one market. */
export async function ledgerSummary(tx: Tx, marketId: string, scope: Scope) {
  const market = await marketInScope(tx, marketId, scope)
  const { rows } = await tx.query<{ type: string; debit_minor: string; credit_minor: string }>(
    `WITH s AS (SELECT a.type, sum(x.debit_minor) AS d, sum(x.credit_minor) AS c
                FROM ledger_account a JOIN posting x ON x.account_id = a.id WHERE a.market_id = $1 GROUP BY a.type)
     SELECT t.type, coalesce(s.d, 0)::text AS debit_minor, coalesce(s.c, 0)::text AS credit_minor
     FROM unnest($2::text[]) WITH ORDINALITY AS t (type, n) LEFT JOIN s USING (type) ORDER BY t.n`,
    [marketId, ACCOUNT_TYPES],
  )
  const { rows: count } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM journal_entry WHERE market_id = $1', [marketId])
  const debit = rows.reduce((sum, row) => sum + BigInt(row.debit_minor), 0n)
  const credit = rows.reduce((sum, row) => sum + BigInt(row.credit_minor), 0n)
  return {
    market,
    by_type: rows.map((row) => ({ ...row, normal: normalSide(row.type), balance_minor: balanceOf(row.type, row.debit_minor, row.credit_minor) })),
    balanced: debit === credit,
    entry_count: count[0]!.n,
  }
}

export interface AccountFilter {
  readonly market_id?: string | undefined
  readonly type?: string | undefined
  readonly payee_participant_id?: string | undefined
}

const ACCOUNT_SELECT = `
  SELECT a.id, a.market_id, m.code AS market_code, a.type, p.id AS payee_id, p.external_ref AS payee_ref, p.display_name AS payee_name,
         a.currency, coalesce(t.d, 0)::text AS debit_minor, coalesce(t.c, 0)::text AS credit_minor, g.gl_code
  FROM ledger_account a JOIN market m ON m.id = a.market_id
  LEFT JOIN participant p ON p.id = a.payee_participant_id
  LEFT JOIN gl_account_map g ON g.market_id = a.market_id AND g.account_type = a.type
  LEFT JOIN LATERAL (SELECT sum(x.debit_minor) AS d, sum(x.credit_minor) AS c FROM posting x WHERE x.account_id = a.id) t ON true`

interface AccountRow {
  id: string
  market_id: string
  market_code: string
  type: string
  payee_id: string | null
  payee_ref: string | null
  payee_name: string | null
  currency: string
  debit_minor: string
  credit_minor: string
  gl_code: string | null
}

const accountView = (a: AccountRow) => ({
  id: a.id, market: { id: a.market_id, code: a.market_code }, type: a.type,
  payee: a.payee_id === null ? null : { id: a.payee_id, external_ref: a.payee_ref, display_name: a.payee_name },
  currency: a.currency, debit_minor: a.debit_minor, credit_minor: a.credit_minor, balance_minor: balanceOf(a.type, a.debit_minor, a.credit_minor),
  gl_code: a.gl_code,
})

/** GET /v1/ledger/accounts (cursor = account id). */
export async function listAccounts(tx: Tx, scope: Scope, filter: AccountFilter, afterId: string | undefined, limit: number) {
  const { rows } = await tx.query<AccountRow>(
    `${ACCOUNT_SELECT}
     WHERE ${IN_SCOPE('a.market_id', 1)} AND ($2::uuid IS NULL OR a.market_id = $2) AND ($3::text IS NULL OR a.type = $3)
       AND ($4::uuid IS NULL OR a.payee_participant_id = $4) AND ($5::uuid IS NULL OR a.id > $5)
     ORDER BY a.id LIMIT $6`,
    [scope, filter.market_id ?? null, filter.type ?? null, filter.payee_participant_id ?? null, afterId ?? null, limit + 1],
  )
  return rows.map(accountView)
}

const ENTRY_SELECT = `
  SELECT e.id, e.market_id, e.event_type, e.origin_type, e.origin_id, e.idempotency_key, e.period_id, p.starts_at, p.ends_at, e.posted_at,
         e.posted_at::text AS at, e.approval_id, au.id AS approver_id, au.display_name AS approver_name
  FROM journal_entry e JOIN period p ON p.id = e.period_id
  LEFT JOIN approval ap ON ap.id = e.approval_id LEFT JOIN user_account au ON au.id = ap.approver_id`

interface EntryRow {
  id: string
  market_id: string
  event_type: string
  origin_type: string
  origin_id: string
  idempotency_key: string
  period_id: string
  starts_at: Date
  ends_at: Date
  posted_at: Date
  at: string
  approval_id: string | null
  approver_id: string | null
  approver_name: string | null
}

const entryView = (e: EntryRow) => ({
  id: e.id, event_type: e.event_type, origin_type: e.origin_type, origin_id: e.origin_id, idempotency_key: e.idempotency_key,
  period: { id: e.period_id, starts_at: e.starts_at, ends_at: e.ends_at }, posted_at: e.posted_at,
  approved_by: person(e.approver_id, e.approver_name),
})

/** GET /v1/ledger/accounts/:id/postings, newest first. */
export async function accountPostings(tx: Tx, accountId: string, scope: Scope, after: TimeCursor | undefined, limit: number) {
  const { rows: account } = await tx.query<{ market_id: string }>('SELECT market_id FROM ledger_account WHERE id = $1', [accountId])
  if (account[0] === undefined || (scope !== null && !scope.includes(account[0].market_id))) throw notFound()
  const { rows } = await tx.query<EntryRow & { posting_id: string; debit_minor: string; credit_minor: string }>(
    `SELECT x.id AS posting_id, x.debit_minor::text, x.credit_minor::text, q.*
     FROM posting x JOIN LATERAL (${ENTRY_SELECT} WHERE e.id = x.entry_id) q ON true
     WHERE x.account_id = $1 AND ($2::timestamptz IS NULL OR (q.posted_at, x.id) < ($2, $3::uuid))
     ORDER BY q.posted_at DESC, x.id DESC LIMIT $4`,
    [accountId, after?.at ?? null, after?.id ?? null, limit + 1],
  )
  return rows.map((row) => {
    const { period, ...entry } = entryView(row)
    return {
      id: row.posting_id, debit_minor: row.debit_minor, credit_minor: row.credit_minor, at: row.at,
      entry: { id: entry.id, event_type: entry.event_type, origin_type: entry.origin_type, origin_id: entry.origin_id, period_id: period.id,
        posted_at: entry.posted_at, approved_by: entry.approved_by },
    }
  })
}

export interface EntryFilter {
  readonly market_id?: string | undefined
  readonly period_id?: string | undefined
  readonly origin_type?: string | undefined
  readonly origin_id?: string | undefined
}

/** D-B6-08 list sorts; the cursor carries the sort value (posted_at text) and the id. */
export const ENTRY_SORTS = ['posted_at_desc', 'posted_at_asc'] as const
export type EntrySort = (typeof ENTRY_SORTS)[number]

const ENTRY_FILTER = `${IN_SCOPE('e.market_id', 1)} AND ($2::uuid IS NULL OR e.market_id = $2) AND ($3::uuid IS NULL OR e.period_id = $3)
  AND ($4::text IS NULL OR e.origin_type = $4) AND ($5::uuid IS NULL OR e.origin_id = $5)`
const filterParams = (scope: Scope, filter: EntryFilter) =>
  [scope, filter.market_id ?? null, filter.period_id ?? null, filter.origin_type ?? null, filter.origin_id ?? null]

/** GET /v1/ledger/entries (and its export: every row when `limit` is null), in `sort` order. */
export async function listEntries(tx: Tx, scope: Scope, filter: EntryFilter, sort: EntrySort, after: TimeCursor | undefined, limit: number | null) {
  const [dir, past] = sort === 'posted_at_desc' ? ['DESC', '<'] : ['ASC', '>']
  const { rows } = await tx.query<EntryRow & { market_code: string; minor_digits: number; debit_total_minor: string; credit_total_minor: string; posting_count: number }>(
    `SELECT q.*, m.code AS market_code, m.minor_unit::int AS minor_digits, t.d::text AS debit_total_minor, t.c::text AS credit_total_minor,
            t.n AS posting_count
     FROM (${ENTRY_SELECT}
           WHERE ${ENTRY_FILTER} AND ($6::timestamptz IS NULL OR (e.posted_at, e.id) ${past} ($6, $7::uuid))
           ORDER BY e.posted_at ${dir}, e.id ${dir} LIMIT $8) q
     JOIN market m ON m.id = q.market_id
     CROSS JOIN LATERAL (SELECT sum(x.debit_minor) AS d, sum(x.credit_minor) AS c, count(*)::int AS n FROM posting x WHERE x.entry_id = q.id) t
     ORDER BY q.posted_at ${dir}, q.id ${dir}`,
    [...filterParams(scope, filter), after?.at ?? null, after?.id ?? null, limit === null ? null : limit + 1],
  )
  return rows.map((row) => ({
    ...entryView(row), at: row.at, market: { id: row.market_id, code: row.market_code, minor_digits: row.minor_digits }, approval_id: row.approval_id,
    debit_total_minor: row.debit_total_minor, credit_total_minor: row.credit_total_minor, posting_count: row.posting_count,
  }))
}

/** Entries matching the filter (the export's row count, checked against the cap before anything is read). */
export async function countEntries(tx: Tx, scope: Scope, filter: EntryFilter): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM journal_entry e WHERE ${ENTRY_FILTER}`, filterParams(scope, filter))
  return rows[0]!.n
}

/** GET /v1/ledger/entries/:id: the entry and one page of its postings (cursor = posting id). */
export async function entryDetail(tx: Tx, id: string, scope: Scope, afterId: string | undefined, limit: number) {
  const { rows } = await tx.query<EntryRow>(`${ENTRY_SELECT} WHERE e.id = $1`, [id])
  const entry = rows[0]
  if (entry === undefined || (scope !== null && !scope.includes(entry.market_id))) throw notFound()
  const { rows: postings } = await tx.query<{ id: string; account_id: string; type: string; payee_id: string | null; payee_ref: string | null
    payee_name: string | null; debit_minor: string; credit_minor: string }>(
    `SELECT x.id, a.id AS account_id, a.type, p.id AS payee_id, p.external_ref AS payee_ref, p.display_name AS payee_name,
            x.debit_minor::text, x.credit_minor::text
     FROM posting x JOIN ledger_account a ON a.id = x.account_id LEFT JOIN participant p ON p.id = a.payee_participant_id
     WHERE x.entry_id = $1 AND ($2::uuid IS NULL OR x.id > $2) ORDER BY x.id LIMIT $3`,
    [id, afterId ?? null, limit + 1],
  )
  const page = postings.slice(0, limit).map((x) => ({
    id: x.id, account: { id: x.account_id, type: x.type },
    payee: x.payee_id === null ? null : { id: x.payee_id, external_ref: x.payee_ref, display_name: x.payee_name },
    debit_minor: x.debit_minor, credit_minor: x.credit_minor,
  }))
  return { entry: { ...entryView(entry), postings: page }, nextAfter: postings.length > limit ? page.at(-1)!.id : null }
}

/** GET /v1/payees/:id/balances: payable, in transit and receivable per market in scope; 404 when none is visible. */
export async function payeeBalances(tx: Tx, participantId: string, scope: Scope) {
  const { rows } = await tx.query(
    `WITH acc AS (
       SELECT a.market_id, sum(CASE WHEN a.type = 'payee_payable' THEN x.credit_minor - x.debit_minor ELSE 0 END) AS payable,
              sum(CASE WHEN a.type = 'clawback_receivable' THEN x.debit_minor - x.credit_minor ELSE 0 END) AS receivable
       FROM ledger_account a JOIN posting x ON x.account_id = a.id WHERE a.payee_participant_id = $1 GROUP BY a.market_id
     ), transit AS (
       SELECT b.market_id, sum(i.amount_minor) AS amount FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id
       WHERE i.payee_participant_id = $1 AND i.state IN ('pending', 'instructed', 'accepted') GROUP BY b.market_id
     ), k AS (SELECT market_id FROM acc UNION SELECT market_id FROM transit)
     SELECT jsonb_build_object('id', m.id, 'code', m.code, 'currency', m.currency) AS market, coalesce(acc.payable, 0)::text AS payable_minor,
            coalesce(transit.amount, 0)::text AS in_transit_minor, coalesce(acc.receivable, 0)::text AS receivable_minor
     FROM k JOIN market m ON m.id = k.market_id LEFT JOIN acc USING (market_id) LEFT JOIN transit USING (market_id)
     WHERE ${IN_SCOPE('m.id', 2)} ORDER BY m.code`,
    [participantId, scope],
  )
  if (rows.length === 0) throw notFound()
  return rows
}

const BUCKETS = ['0_30', '31_60', '61_90', 'over_90'] as const

// Every positive receivable of the markets in scope (led_receivables), aged in whole days.
const RECEIVABLES = `
  WITH r AS (
    SELECT m.id AS market_id, m.code AS market_code, r.participant_id, r.amount_minor, r.outstanding_since,
           floor(extract(epoch FROM now() - r.outstanding_since) / 86400)::int AS age_days
    FROM market m CROSS JOIN LATERAL led_receivables(m.id) r
    WHERE ${IN_SCOPE('m.id', 1)} AND ($2::uuid IS NULL OR m.id = $2)
  ), b AS (
    SELECT r.*, CASE WHEN age_days <= 30 THEN '0_30' WHEN age_days <= 60 THEN '31_60' WHEN age_days <= 90 THEN '61_90' ELSE 'over_90' END AS bucket
    FROM r
  )`

export interface ReceivableCursor {
  readonly market_id: string
  readonly participant_id: string
}

/**
 * GET /v1/ledger/receivables with ageing buckets, write-off eligibility (null while write_offs.policy is unset) and the
 * open write-off case, shown only in the markets of `caseScope` (the caller's case.write_off.read).
 */
export async function listReceivables(
  tx: Tx, scope: Scope, caseScope: Scope, marketId: string | undefined, after: ReceivableCursor | undefined, limit: number,
) {
  const { rows } = await tx.query<{
    market_id: string; market_code: string; participant_id: string; external_ref: string; display_name: string | null; account_id: string
    amount_minor: string; outstanding_since: Date; age_days: number; bucket: string; open_case_id: string | null
  }>(
    `${RECEIVABLES}
     SELECT b.market_id, b.market_code, b.participant_id, p.external_ref, p.display_name, a.id AS account_id, b.amount_minor::text,
            b.outstanding_since, b.age_days, b.bucket,
            CASE WHEN ${IN_SCOPE('b.market_id', 6)} THEN (SELECT c.id FROM case_file c
              WHERE c.type = 'write_off' AND c.subject_id = a.id AND c.state IN ('open', 'submitted') LIMIT 1) END AS open_case_id
     FROM b JOIN participant p ON p.id = b.participant_id
     JOIN ledger_account a ON a.market_id = b.market_id AND a.type = 'clawback_receivable' AND a.payee_participant_id = b.participant_id
       AND a.credit_type_id IS NULL
     WHERE ($3::uuid IS NULL OR (b.market_id, b.participant_id) > ($3, $4::uuid))
     ORDER BY b.market_id, b.participant_id LIMIT $5`,
    [scope, marketId ?? null, after?.market_id ?? null, after?.participant_id ?? null, limit + 1, caseScope],
  )
  const { rows: totals } = await tx.query<{ bucket: string; count: number; amount_minor: string }>(
    `${RECEIVABLES} SELECT bucket, count(*)::int AS count, sum(amount_minor)::text AS amount_minor FROM b GROUP BY bucket`,
    [scope, marketId ?? null],
  )
  const policy = await getSetting(tx, 'write_offs.policy')
  return {
    rows: rows.map((r) => ({
      participant: { id: r.participant_id, external_ref: r.external_ref, display_name: r.display_name },
      market: { id: r.market_id, code: r.market_code }, account_id: r.account_id, balance_minor: r.amount_minor,
      outstanding_since: r.outstanding_since, age_days: r.age_days, bucket: r.bucket,
      write_off_eligible: policy === null ? null : writeOffEligible(policy, BigInt(r.amount_minor), r.age_days),
      open_write_off_case_id: r.open_case_id,
    })),
    totalsByBucket: BUCKETS.map((bucket) => {
      const total = totals.find((t) => t.bucket === bucket)
      return { bucket, count: total?.count ?? 0, amount_minor: total?.amount_minor ?? '0' }
    }),
  }
}

/** GET /v1/ledger/gl-mappings: the market's GL code per account type, all ten types. */
export async function glMappings(tx: Tx, marketId: string, scope: Scope) {
  await marketInScope(tx, marketId, scope)
  const { rows } = await tx.query<{ account_type: string; gl_code: string | null; user_id: string | null; user_name: string | null; updated_at: Date | null }>(
    `SELECT t.type AS account_type, g.gl_code, u.id AS user_id, u.display_name AS user_name, g.updated_at
     FROM unnest($2::text[]) WITH ORDINALITY AS t (type, n)
     LEFT JOIN gl_account_map g ON g.market_id = $1 AND g.account_type = t.type LEFT JOIN user_account u ON u.id = g.updated_by
     ORDER BY t.n`,
    [marketId, ACCOUNT_TYPES],
  )
  return rows.map((r) => ({ account_type: r.account_type, gl_code: r.gl_code, updated_by: person(r.user_id, r.user_name), updated_at: r.updated_at }))
}
