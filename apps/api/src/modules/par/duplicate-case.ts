import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import type { CaseRecord, CaseTypeDefinition } from '../cas/index.js'
import { inScope } from '../ten/index.js'
import { assertPositionsLimit, type PositionStatus } from './positions.js'
import { SIGNAL_KINDS } from './schemas.js'
import { sqlCall } from './sql-errors.js'

// FR-PAR-003, D-B2-10: the investigator proposes the outcome (PATCH /v1/cases/:id), a Compliance officer approves it.
const OUTCOMES = ['merge', 'allow', 'terminate'] as const
const payload = z.strictObject({
  matched_participant_id: z.uuid(),
  matched_kinds: z.array(z.enum(SIGNAL_KINDS)).max(SIGNAL_KINDS.length),
  proposed_outcome: z.enum(OUTCOMES).optional(),
})
type DuplicatePayload = z.infer<typeof payload>
type DuplicateCase = CaseRecord<DuplicatePayload>

interface OwnedPosition {
  position_id: string
  position_ref: string
  status: PositionStatus
  market_id: string
}

/** The positions the subject owns now. */
async function ownedPositions(tx: Tx, participantId: string): Promise<OwnedPosition[]> {
  const { rows } = await tx.query<OwnedPosition>(
    'SELECT position_id, position_ref, status, market_id FROM gen_positions_of($1, now()) ORDER BY position_id', [participantId],
  )
  return rows
}

async function setStatus(tx: Tx, c: DuplicateCase, position: OwnedPosition, status: 'active' | 'terminated', reason: string) {
  const { rows } = await sqlCall(() => tx.query<{ moved: number }>(
    'SELECT gen_set_position_status($1, $2, now(), $3, $4) AS moved', [position.position_id, status, reason, c.id],
  ))
  await recordAudit(tx, {
    action: 'POSITION.STATUS_CHANGED', objectType: 'position', objectId: position.position_id,
    before: { status: position.status }, after: { status, case_id: c.id, customers_reassigned: rows[0]!.moved }, reason,
  })
}

/**
 * Every position moves to the matched participant from now (G4); the subject becomes merged into it. The target stays
 * active meanwhile (FOR SHARE): merging into a merged participant would build a chain.
 */
async function merge(tx: Tx, c: DuplicateCase, positions: OwnedPosition[]): Promise<void> {
  const target = c.payload.matched_participant_id
  const { rowCount } = await tx.query(`SELECT 1 FROM participant WHERE id = $1 AND status = 'active' FOR SHARE`, [target])
  if (rowCount !== 1) throw new ApiError(409, 'MATCHED_PARTICIPANT_INVALID', 'The matched participant is no longer active.')
  const live = positions.filter((p) => p.status !== 'terminated')
  for (const market of new Set(live.map((p) => p.market_id))) {
    await assertPositionsLimit(tx, target, market, live.filter((p) => p.market_id === market).length)
  }
  for (const position of positions) {
    await sqlCall(() => tx.query('SELECT gen_transfer_ownership($1, $2, now(), $3)', [position.position_id, target, c.id]))
    await recordAudit(tx, {
      action: 'POSITION.OWNERSHIP_TRANSFERRED', objectType: 'position', objectId: position.position_id,
      after: { from_participant_id: c.subject_id, to_participant_id: target, case_id: c.id },
    })
  }
  await tx.query(`UPDATE participant SET status = 'merged', merged_into_id = $2 WHERE id = $1`, [c.subject_id, target])
  await recordAudit(tx, {
    action: 'PARTICIPANT.MERGED', objectType: 'participant', objectId: c.subject_id,
    after: { merged_into_id: target, position_ids: positions.map((p) => p.position_id), case_id: c.id },
  })
}

/** Other duplicate reviews of the subject still open or submitted (a subject matching two participants has two). */
async function otherOpenReviews(tx: Tx, c: DuplicateCase): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM case_file WHERE type = 'duplicate' AND state IN ('open', 'submitted') AND subject_type = 'participant'
       AND subject_id = $1 AND id <> $2 ORDER BY id`,
    [c.subject_id, c.id],
  )
  return rows.map((row) => row.id)
}

/** An allow approved for the subject while this review was open (this one included: onDecision runs after the decision). */
async function allowApproved(tx: Tx, c: DuplicateCase): Promise<boolean> {
  const { rowCount } = await tx.query(
    `SELECT 1 FROM case_file WHERE type = 'duplicate' AND state = 'approved' AND subject_type = 'participant'
       AND subject_id = $1 AND payload ->> 'proposed_outcome' = 'allow' AND decided_at >= $2`,
    [c.subject_id, c.created_at],
  )
  return rowCount !== 0
}

/**
 * D-B2-10 outcomes; a SQL refusal (e.g. 409 OWNERSHIP_CONFLICT) rolls the decision back (AC-PAR3-2). The hold (G5) is
 * released once an allow stands and no other review of the subject is open: an allow approved meanwhile is recorded as
 * deferred, and the last review decided (approved with allow, or rejected) releases it.
 */
async function execute(tx: Tx, c: DuplicateCase, decision: 'approved' | 'rejected'): Promise<void> {
  const positions = await ownedPositions(tx, c.subject_id)
  const outcome = decision === 'approved' ? c.payload.proposed_outcome : undefined
  if (outcome === 'merge') return merge(tx, c, positions)
  if (outcome === 'terminate') {
    for (const position of positions.filter((p) => p.status !== 'terminated')) {
      await setStatus(tx, c, position, 'terminated', 'Duplicate review: terminated')
    }
    return
  }
  if (!(await allowApproved(tx, c))) return
  const open = await otherOpenReviews(tx, c)
  if (open.length > 0) {
    if (outcome === 'allow') {
      await recordAudit(tx, {
        action: 'PARTICIPANT.HOLD_RELEASE_DEFERRED', objectType: 'participant', objectId: c.subject_id,
        after: { case_id: c.id, open_case_ids: open },
      })
    }
    return
  }
  for (const position of positions.filter((p) => p.status === 'pending')) {
    await setStatus(tx, c, position, 'active', 'Duplicate review: allowed')
  }
}

const sameKinds = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join() === [...b].sort().join()

export const DUPLICATE_CASE_TYPE: CaseTypeDefinition<DuplicatePayload> = {
  type: 'duplicate',
  subjectTypes: ['participant'],
  reasonCodes: ['SIGNAL_MATCH', 'STAFF_SUSPICION'],
  systemReasonCodes: ['SIGNAL_MATCH'],
  evidenceRequired: false,
  permissions: { read: 'case.duplicate.read', create: 'case.duplicate.create', decide: 'case.duplicate.approve' },
  payload,
  // Matching is tenant-wide: a review naming a participant of another market is read only by holders over both markets,
  // so a market-scoped caller cannot learn who holds an identity signal elsewhere.
  relatedMarketSql: `(SELECT p.market_id FROM participant p WHERE p.id = (c.payload ->> 'matched_participant_id')::uuid)`,
  async resolveSubject(tx, _subjectType, subjectId) {
    const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE id = $1', [subjectId])
    return rows[0] === undefined ? null : { marketId: rows[0].market_id }
  },
  // The matched participant is the merge target: another active participant in the caller's markets. A system case keeps
  // the match the system recorded; an unchanged id was checked when it was set (merge re-checks it is active).
  async validateCreate(tx, subject, value, scope, stored) {
    if (stored?.opened_by_kind === 'system') {
      if (value.matched_participant_id !== stored.payload.matched_participant_id || !sameKinds(value.matched_kinds, stored.payload.matched_kinds)) {
        throw new ApiError(422, 'SYSTEM_MATCH_FIXED', 'The system recorded this match: only the proposed outcome can change.')
      }
      return
    }
    if (value.matched_participant_id === stored?.payload.matched_participant_id) return
    const { rows } = await tx.query<{ market_id: string }>(
      `SELECT market_id FROM participant WHERE id = $1 AND id <> $2 AND status = 'active'`, [value.matched_participant_id, subject.id],
    )
    if (rows[0] === undefined || !inScope(scope, rows[0].market_id)) {
      throw new ApiError(422, 'MATCHED_PARTICIPANT_INVALID', 'The matched participant must be another active participant.')
    }
  },
  // Submitting needs the proposed outcome; the preview shows what approval will do.
  async effectPreview(tx, c) {
    if (c.payload.proposed_outcome === undefined) {
      throw new ApiError(422, 'OUTCOME_REQUIRED', 'Propose an outcome (merge, allow or terminate) before submitting.')
    }
    const positions = await ownedPositions(tx, c.subject_id)
    const { rows } = await tx.query<{ participant_id: string; external_ref: string }>(
      'SELECT id AS participant_id, external_ref FROM participant WHERE id = $1', [c.payload.matched_participant_id],
    )
    return {
      outcome: c.payload.proposed_outcome,
      matched_participant: rows[0] ?? null,
      positions: positions.map((p) => ({ id: p.position_id, position_ref: p.position_ref, status: p.status })),
      hold_active: positions.some((p) => p.status === 'pending'),
    }
  },
  onDecision: execute,
}
