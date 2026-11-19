import type { Tx } from '@nmp/db'
import { ApiError } from '../../lib/errors.js'
import { getSetting } from '../ten/index.js'

// D-B4-12 selection: every payee with a payable in the market, with every exclusion reason that applies.

export interface Reason {
  readonly reason: string
  readonly detail: Record<string, unknown>
}

export interface Candidate {
  readonly participant_id: string
  readonly payable_minor: string
  readonly version_id: string | null
  readonly reasons: Reason[]
}

export interface Exclusion {
  readonly participant_id: string
  readonly reasons: Reason[]
}

export interface MarketPolicy {
  readonly minimumMinor: string
  readonly taxProfileRequired: boolean
}

export const notConfigured = (key: string): ApiError =>
  new ApiError(422, 'SETTING_NOT_CONFIGURED', `The setting ${key} is not configured.`, { key })

/** payouts.market_policy for the market and the cooling-off setting: both needed before a batch is prepared (DEC-14). */
export async function marketPolicy(tx: Tx, marketId: string): Promise<MarketPolicy> {
  const policy = (await getSetting(tx, 'payouts.market_policy'))?.[marketId]
  if (policy === undefined) throw notConfigured('payouts.market_policy')
  if ((await getSetting(tx, 'payouts.bank_detail_cooling_off_hours')) === null) throw notConfigured('payouts.bank_detail_cooling_off_hours')
  return { minimumMinor: policy.minimum_payout_minor, taxProfileRequired: policy.tax_profile_required }
}

// Instants inside jsonb as the API serialises every other instant: UTC, milliseconds, Z (BUG-104).
const instant = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
const reason = (name: string, detail: string) => `jsonb_build_object('reason', '${name}', 'detail', ${detail})`

// $1 market, $2 minimum, $3 tax profile required, $4 only these payees (NULL = every payee with a payable > 0).
const CANDIDATES = `
  WITH payees AS (
    SELECT a.payee_participant_id AS participant_id, led_balance($1, a.payee_participant_id, 'payee_payable') AS payable
    FROM ledger_account a
    WHERE a.market_id = $1 AND a.type = 'payee_payable' AND ($4::uuid[] IS NULL OR a.payee_participant_id = ANY ($4))
  )
  SELECT p.participant_id, p.payable::text AS payable_minor, v.id AS version_id,
    (CASE WHEN p.payable <= 0 THEN jsonb_build_array(${reason('nothing_payable', `'{}'::jsonb`)}) ELSE '[]' END)
    || (CASE WHEN p.payable > 0 AND p.payable < $2::text::bigint
             THEN jsonb_build_array(${reason('below_minimum', `jsonb_build_object('minimum_minor', $2::text)`)}) ELSE '[]' END)
    || (CASE WHEN v.id IS NULL THEN jsonb_build_array(${reason('no_bank_details', `'{}'::jsonb`)})
             WHEN v.cooling_off_until > now()
             THEN jsonb_build_array(${reason('bank_detail_cooling_off', `jsonb_build_object('until', ${instant('v.cooling_off_until')})`)})
             ELSE '[]' END)
    || coalesce((SELECT jsonb_agg(${reason('duplicate_case', `jsonb_build_object('case_id', c.id)`)} ORDER BY c.id)
                 FROM case_file c WHERE c.type = 'duplicate' AND c.state IN ('open', 'submitted')
                   AND c.subject_type = 'participant' AND c.subject_id = p.participant_id), '[]')
    || (CASE WHEN $3::boolean AND NOT EXISTS (
               SELECT 1 FROM tax_profile t WHERE t.participant_id = p.participant_id AND t.valid_from <= now()
                 AND (t.valid_to IS NULL OR t.valid_to > now()))
             THEN jsonb_build_array(${reason('tax_profile_missing', `'{}'::jsonb`)}) ELSE '[]' END)
    || coalesce((SELECT jsonb_agg(${reason('hold', `jsonb_build_object('hold_id', h.id, 'reason', h.reason, 'placed_at', ${instant('h.placed_at')})`)} ORDER BY h.placed_at, h.id)
                 FROM payout_hold h WHERE h.participant_id = p.participant_id AND h.market_id = $1 AND h.released_at IS NULL), '[]')
    || coalesce((SELECT jsonb_agg(${reason('returned_payment_open', `jsonb_build_object('case_id', c.id)`)} ORDER BY c.id)
                 FROM case_file c JOIN payout_instruction i ON i.id = c.subject_id JOIN payout_batch rb ON rb.id = i.batch_id
                 WHERE c.type = 'returned_payment' AND c.state IN ('open', 'submitted') AND rb.market_id = $1
                   AND i.payee_participant_id = p.participant_id), '[]')
    || coalesce((SELECT jsonb_agg(${reason('in_open_batch', `jsonb_build_object('batch_id', b.id)`)} ORDER BY b.id)
                 FROM payout_batch b WHERE b.market_id = $1 AND EXISTS (
                   SELECT 1 FROM payout_instruction i WHERE i.batch_id = b.id AND i.payee_participant_id = p.participant_id
                     AND i.state IN ('pending', 'instructed', 'accepted'))), '[]') AS reasons
  FROM payees p
  LEFT JOIN bank_detail_version v ON v.participant_id = p.participant_id AND v.superseded_at IS NULL
  WHERE $4::uuid[] IS NOT NULL OR p.payable > 0
  ORDER BY p.participant_id`

/** The payees of the market (or only `payees`) with their payable, current bank-detail version and exclusion reasons. */
export async function candidates(tx: Tx, marketId: string, policy: MarketPolicy, payees: readonly string[] | null = null): Promise<Candidate[]> {
  const { rows } = await tx.query<Candidate>(CANDIDATES, [marketId, policy.minimumMinor, policy.taxProfileRequired, payees])
  return rows
}

export interface Line {
  readonly participant_id: string
  readonly amount_minor: string
  readonly bank_detail_version_id: string
}

export function split(rows: readonly Candidate[]): { lines: Line[]; exclusions: Exclusion[] } {
  const lines = rows.filter((row) => row.reasons.length === 0)
    .map((row) => ({ participant_id: row.participant_id, amount_minor: row.payable_minor, bank_detail_version_id: row.version_id! }))
  const exclusions = rows.filter((row) => row.reasons.length > 0).map((row) => ({ participant_id: row.participant_id, reasons: row.reasons }))
  return { lines, exclusions }
}
