import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import type { CaseRecord, CaseTypeDefinition } from '../cas/index.js'
import { getSetting, type SettingValue } from '../ten/index.js'
import { tryLockLedger } from './ledger.js'

// D-B4-08: write-off of a payee's clawback receivable as case type 'write_off'. The subject is the receivable account,
// so the case's market is the receivable's. Posting #7 happens only at approval, under the ledger lock.

type Policy = SettingValue<'write_offs.policy'>

const payload = z.strictObject({
  amount_minor: z.string().regex(/^[1-9]\d{0,17}$/, 'a positive amount in minor units'),
  note: z.string().trim().min(1).max(2000),
})
type Payload = z.infer<typeof payload>

/** Eligible = at or below the amount threshold, or outstanding at least the configured days (MONEY C-8). */
export function writeOffEligible(policy: Policy, receivableMinor: bigint, ageDays: number): boolean {
  return (policy.eligible_below_minor !== undefined && receivableMinor <= BigInt(policy.eligible_below_minor))
    || (policy.eligible_after_days !== undefined && ageDays >= policy.eligible_after_days)
}

async function policyOf(tx: Tx): Promise<Policy> {
  const policy = await getSetting(tx, 'write_offs.policy')
  if (policy === null) {
    throw new ApiError(422, 'SETTING_NOT_CONFIGURED', 'Set the write-off policy before writing off receivables.', { key: 'write_offs.policy' })
  }
  return policy
}

interface Receivable {
  readonly marketId: string
  readonly participantId: string
  readonly amountMinor: bigint
  readonly outstandingSince: Date | null
  readonly ageDays: number
}

/** The receivable account's current balance and age; 422 VALIDATION_FAILED for any other account type. */
async function receivableOf(tx: Tx, accountId: string): Promise<Receivable> {
  const { rows } = await tx.query<{ market_id: string; participant_id: string; type: string; amount_minor: string | null
    outstanding_since: Date | null; age_days: number | null }>(
    `SELECT a.market_id, a.payee_participant_id AS participant_id, a.type, r.amount_minor::text, r.outstanding_since,
            floor(extract(epoch FROM now() - r.outstanding_since) / 86400)::int AS age_days
     FROM ledger_account a LEFT JOIN LATERAL (SELECT * FROM led_receivables(a.market_id) x WHERE x.participant_id = a.payee_participant_id) r ON true
     WHERE a.id = $1`,
    [accountId],
  )
  const row = rows[0]
  if (row === undefined || row.type !== 'clawback_receivable') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'A write-off names a clawback receivable account.', { issues: [{ path: 'subject_id', message: 'not a receivable account' }] })
  }
  return {
    marketId: row.market_id, participantId: row.participant_id, amountMinor: BigInt(row.amount_minor ?? '0'),
    outstandingSince: row.outstanding_since, ageDays: row.age_days ?? 0,
  }
}

async function validateCreate(tx: Tx, subject: { readonly id: string }, p: Payload, _scope: readonly string[] | null, stored?: CaseRecord<Payload>) {
  await policyOf(tx)
  const receivable = await receivableOf(tx, subject.id)
  // Serialises the one-open-case check per receivable (not the market's ledger lock, which commits and PAY hold while
  // posting); CAS validates before it audits, so this lock is never awaited while holding the audit lock.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('write_off:' || app_tenant_id() || ':' || $1, 0))`, [subject.id])
  if (BigInt(p.amount_minor) > receivable.amountMinor) {
    throw new ApiError(422, 'AMOUNT_ABOVE_RECEIVABLE', 'The amount is above the outstanding receivable.', { receivable_minor: receivable.amountMinor.toString() })
  }
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM case_file WHERE type = 'write_off' AND subject_id = $1 AND state IN ('open', 'submitted') AND id IS DISTINCT FROM $2 LIMIT 1`,
    [subject.id, stored?.id ?? null],
  )
  if (rows[0] !== undefined) throw new ApiError(409, 'WRITE_OFF_OPEN', 'This receivable already has a write-off in progress.', { case_id: rows[0].id })
}

/** Why two approvals are needed (empty: one). */
function escalations(policy: Policy, receivable: Receivable, amountMinor: bigint): string[] {
  return [
    ...(writeOffEligible(policy, receivable.amountMinor, receivable.ageDays) ? [] : ['not_eligible']),
    ...(amountMinor > BigInt(policy.second_approver_above_minor) ? ['above_threshold'] : []),
  ]
}

async function assess(tx: Tx, c: CaseRecord<Payload>) {
  const policy = await policyOf(tx)
  const receivable = await receivableOf(tx, c.subject_id)
  const reasons = escalations(policy, receivable, BigInt(c.payload.amount_minor))
  return { receivable, reasons, eligible: writeOffEligible(policy, receivable.amountMinor, receivable.ageDays), approvals: reasons.length > 0 ? 2 as const : 1 as const }
}

async function effectPreview(tx: Tx, c: CaseRecord<Payload>) {
  const { receivable, reasons, eligible, approvals } = await assess(tx, c)
  const { rows } = await tx.query<{ id: string; code: string }>('SELECT id, code FROM market WHERE id = $1', [receivable.marketId])
  // Whose receivable it is: the case subject is only the account id (BUG-103).
  const { rows: payee } = await tx.query<{ id: string; external_ref: string; display_name: string | null }>(
    'SELECT id, external_ref, display_name FROM participant WHERE id = $1', [receivable.participantId])
  return {
    market: rows[0], payee: payee[0], receivable_minor: receivable.amountMinor.toString(), amount_minor: c.payload.amount_minor,
    after_minor: (receivable.amountMinor - BigInt(c.payload.amount_minor)).toString(), outstanding_since: receivable.outstandingSince,
    eligible, approvals_required: approvals, reasons,
  }
}

/**
 * Approved: under the ledger lock (409 LEDGER_BUSY while another posting holds it), the amount still within the
 * receivable (else 409, decision rolled back), then Dr write_off / Cr receivable.
 */
async function onDecision(tx: Tx, c: CaseRecord<Payload>, decision: 'approved' | 'rejected'): Promise<void> {
  if (decision !== 'approved') return
  const { rows: account } = await tx.query<{ market_id: string; participant_id: string }>(
    'SELECT market_id, payee_participant_id AS participant_id FROM ledger_account WHERE id = $1', [c.subject_id])
  const { market_id: marketId, participant_id: participantId } = account[0]!
  if (!(await tryLockLedger(tx, marketId))) {
    throw new ApiError(409, 'LEDGER_BUSY', 'The ledger of this market is being posted: decide the case again in a moment.')
  }
  const { rows: balance } = await tx.query<{ amount: string }>(`SELECT led_balance($1, $2, 'clawback_receivable')::text AS amount`, [marketId, participantId])
  if (BigInt(c.payload.amount_minor) > BigInt(balance[0]!.amount)) {
    throw new ApiError(409, 'RECEIVABLE_CHANGED', 'The receivable changed since the case was submitted: open a new write-off.', { receivable_minor: balance[0]!.amount })
  }
  const lines = [
    { type: 'write_off', payee_participant_id: null, debit_minor: c.payload.amount_minor, credit_minor: '0' },
    { type: 'clawback_receivable', payee_participant_id: participantId, debit_minor: '0', credit_minor: c.payload.amount_minor },
  ]
  const { rows: entry } = await tx.query<{ id: string }>(
    `SELECT ledger_post($1, led_attribution_period($1), 'write_off', 'case', $2, $3, $4, $5) AS id`,
    [marketId, c.id, `writeoff:${c.id}`, c.approval_id, JSON.stringify(lines)],
  )
  await recordAudit(tx, {
    action: 'LEDGER.WRITE_OFF_POSTED', objectType: 'journal_entry', objectId: entry[0]!.id,
    after: { case_id: c.id, participant_id: participantId, market_id: marketId, amount_minor: c.payload.amount_minor },
  })
}

/** Users declared related to the receivable's payee (D-B4-11: an approver's own or relative's account) never approve it. */
async function excludedApprovers(tx: Tx, c: CaseRecord<Payload>): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    'SELECT staff_related_users(payee_participant_id) AS id FROM ledger_account WHERE id = $1', [c.subject_id])
  return rows.map((row) => row.id)
}

export const WRITE_OFF_CASE_TYPE: CaseTypeDefinition<Payload> = {
  type: 'write_off',
  subjectTypes: ['ledger_account'],
  reasonCodes: ['UNRECOVERABLE', 'NO_FUTURE_EARNINGS', 'BELOW_THRESHOLD', 'OTHER'],
  evidenceRequired: false,
  permissions: { read: 'case.write_off.read', create: 'case.write_off.create', decide: 'case.write_off.approve' },
  payload,
  async resolveSubject(tx, _type, id) {
    const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM ledger_account WHERE id = $1', [id])
    return rows[0] === undefined ? null : { marketId: rows[0].market_id }
  },
  validateCreate,
  effectPreview,
  approvalsRequired: async (tx, c) => (await assess(tx, c)).approvals,
  excludedApprovers,
  onDecision,
}
