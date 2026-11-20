import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { ApiError } from '../../lib/errors.js'
import type { CaseRecord, CaseTypeDefinition } from '../cas/index.js'

// FR-CPL-013 (D-BM-08): a grievance is case type 'grievance' about a participant (the complainant is on record) or a
// market (no personal data is stored: codes and the tenant's own ticket reference only). Open = received, submit =
// acknowledged, approve = resolved upheld, reject = resolved not upheld. Deadlines come from the market pack's
// grievance_register rule in force on the received date (SQL cpl_grievance_deadlines, the one definition).

export const GRIEVANCE_RECEIVED_MAX_AGE_DAYS = 366
const DAY_MS = 86_400_000
export const GRIEVANCE_CATEGORIES = ['payout', 'product', 'conduct', 'data', 'other'] as const
export const GRIEVANCE_CHANNELS = ['email', 'phone', 'letter', 'portal', 'in_person', 'other'] as const

const payload = z.strictObject({
  // Canonical ISO form, so an unchanged instant compares equal however the client wrote it.
  received_at: z.iso.datetime().transform((value) => new Date(value).toISOString()),
  channel: z.enum(GRIEVANCE_CHANNELS),
  external_ref: z.string().regex(/^[\x20-\x7e]{1,100}$/, 'must be 1 to 100 printable ASCII characters').optional(),
})
type Payload = z.infer<typeof payload>

const registerNotEnabled = () =>
  new ApiError(422, 'REGISTER_NOT_ENABLED', 'The market pack keeps no grievance register for this received date.')

const receivedAtInvalid = (message: string) => new ApiError(422, 'VALIDATION_FAILED', message, { field: 'received_at' })

/** The subject's market in the caller's tenant (RLS), or null when the subject does not exist. */
async function subjectMarket(tx: Tx, subjectType: string, subjectId: string): Promise<string | null> {
  const sql = subjectType === 'market' ? 'SELECT id AS market_id FROM market WHERE id = $1' : 'SELECT market_id FROM participant WHERE id = $1'
  const { rows } = await tx.query<{ market_id: string }>(sql, [subjectId])
  return rows[0]?.market_id ?? null
}

async function deadlines(tx: Tx, caseId: string) {
  const { rows } = await tx.query<{ rule_id: string; ack_due_at: string; resolution_due_at: string; resolution_due: Date }>(
    `SELECT rule_id, json_instant(ack_due_at) AS ack_due_at, json_instant(resolution_due_at) AS resolution_due_at,
            resolution_due_at AS resolution_due
     FROM cpl_grievance_deadlines($1)`,
    [caseId],
  )
  // A grievance is only recorded under a rule in force; its market's pack (locked once a grievance exists, ten
  // updateMarket), the pack's rules and received_at never change; should that drift anyway, the caller gets a refusal, not a 500.
  if (rows[0] === undefined) throw registerNotEnabled()
  return rows[0]
}

export const GRIEVANCE_CASE_TYPE: CaseTypeDefinition<Payload> = {
  type: 'grievance',
  subjectTypes: ['participant', 'market'],
  reasonCodes: GRIEVANCE_CATEGORIES,
  evidenceRequired: false,
  // D-BM-13: a complainant not on record has no data-subject or erasure path, so their letter is not stored.
  evidenceAllowed: (c) => c.subject_type !== 'market',
  permissions: { read: 'case.grievance.read', create: 'case.grievance.create', decide: 'case.grievance.approve' },
  payload,
  async resolveSubject(tx, subjectType, subjectId) {
    const marketId = await subjectMarket(tx, subjectType, subjectId)
    return marketId === null ? null : { marketId }
  },
  // received_at is fixed at creation (the deadlines hang on it); at create it lies within the last 366 days and the
  // subject market's pack has a grievance_register rule in force on that date (market zone). A draft market in
  // implementation keeps one too (BUG-130); its pack then no longer changes (ten updateMarket).
  async validateCreate(tx, subject, value, _scope, stored) {
    if (stored !== undefined) {
      if (value.received_at !== stored.payload.received_at) throw receivedAtInvalid('The received date of a grievance cannot change.')
      return
    }
    const received = Date.parse(value.received_at)
    const now = Date.now()
    if (received > now || received < now - GRIEVANCE_RECEIVED_MAX_AGE_DAYS * DAY_MS) {
      throw receivedAtInvalid(`The received date must be in the last ${GRIEVANCE_RECEIVED_MAX_AGE_DAYS} days.`)
    }
    const marketId = await subjectMarket(tx, subject.type, subject.id)
    // Held until commit: a concurrent pack change waits, then sees this grievance and is refused.
    await tx.query('SELECT 1 FROM market WHERE id = $1 FOR SHARE', [marketId])
    const { rows } = await tx.query<{ rule_id: string | null }>(
      `SELECT (market_pack_rule(m.id, 'grievance_register', ($2::timestamptz AT TIME ZONE m.time_zone)::date)).id AS rule_id
       FROM market m WHERE m.id = $1`,
      [marketId, value.received_at],
    )
    if (rows[0]?.rule_id == null) throw registerNotEnabled()
  },
  async effectPreview(tx, c: CaseRecord<Payload>) {
    const { rule_id, ack_due_at, resolution_due_at } = await deadlines(tx, c.id)
    return { ack_due_at, resolution_due_at, rule_id }
  },
  // Submit = acknowledged: the case is then due at the resolution deadline (CAS overdue counts use it).
  async dueAt(tx, c) {
    return (await deadlines(tx, c.id)).resolution_due
  },
  // Staff related to the complainant never decide their grievance (as for disputes and privacy cases).
  async excludedApprovers(tx, c) {
    if (c.subject_type !== 'participant') return []
    const { rows } = await tx.query<{ id: string }>('SELECT staff_related_users($1) AS id', [c.subject_id])
    return rows.map((row) => row.id)
  },
}
