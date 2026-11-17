import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import type { CaseRecord, CaseType } from '../cas/index.js'
import { getSetting } from '../ten/index.js'
import { PERMISSIONS, positionRef, resolvePositionSubject, type GenCaseType } from './case-support.js'
import { instant, notBeforeToday, toInstant } from './dates.js'
import { dryRun, withSqlErrors } from './errors.js'
import { KINDS, type Kind } from './read-model.js'

const relationshipFields = {
  kind: z.enum(KINDS),
  proposed_parent_position_id: z.uuid(),
  leg: z.string().regex(/^[1-9][0-9]?$/).optional(),
}
const legOnPlacement = (payload: { kind: Kind; leg?: string | undefined }): boolean =>
  payload.leg === undefined || payload.kind === 'placement'
const LEG_ISSUE = { message: 'A leg applies to placement only.', path: ['leg'] }

export const changePayload = z.strictObject({ ...relationshipFields, effective_from: notBeforeToday }).refine(legOnPlacement, LEG_ISSUE)
export const correctionPayload = z.strictObject({ ...relationshipFields, valid_from: instant }).refine(legOnPlacement, LEG_ISSUE)
export type ChangePayload = z.infer<typeof changePayload>
export type CorrectionPayload = z.infer<typeof correctionPayload>
type RelationshipPayload = ChangePayload | CorrectionPayload

const IMPACT_NOTE = 'Payout impact is calculated once runs exist (B3).'

/** One relationship write through G2 (PLAN B2 4.2). */
interface Move {
  readonly kind: Kind
  readonly child: string
  readonly parent: string
  readonly leg: string | null
  /** valid_from as timestamptz text. */
  readonly at: string
  readonly eventType: 'change' | 'correction'
}

/**
 * PLAN B2 2.4: a change applies at greatest(effective_from, now()) (so "today" is after a row opened earlier today); a
 * correction keeps its valid_from.
 */
async function moveOf(tx: Tx, child: string, payload: RelationshipPayload): Promise<Move> {
  const base = { kind: payload.kind, child, parent: payload.proposed_parent_position_id, leg: payload.leg ?? null }
  if ('valid_from' in payload) return { ...base, at: toInstant(payload.valid_from), eventType: 'correction' }
  const { rows } = await tx.query<{ at: string }>('SELECT greatest($1::timestamptz, now())::text AS at', [toInstant(payload.effective_from)])
  return { ...base, at: rows[0]!.at, eventType: 'change' }
}

const apply = (tx: Tx, move: Move, caseId: string) =>
  tx.query<{ id: string }>('SELECT gen_apply_relationship($1, $2, $3, $4, $5, $6, $7, NULL) AS id', [
    move.kind, move.child, move.parent, move.leg, move.at, move.eventType, caseId,
  ])

/** D-B2-20: legs need the placement width setting and stay within it. */
async function assertLeg(tx: Tx, leg: string | null): Promise<void> {
  if (leg === null) return
  const width = await getSetting(tx, 'genealogy.placement_width')
  if (width === null) throw new ApiError(422, 'PLACEMENT_NOT_CONFIGURED', 'Set the placement width before choosing legs.')
  if (Number(leg) > width) throw new ApiError(422, 'LEG_OUT_OF_RANGE', `Choose a leg from 1 to ${width}.`, { width })
}

/** A correction is dated now or earlier, or exactly at the start of a pending change it cancels (E-GEN-04). */
async function assertCorrectionDate(tx: Tx, move: Move): Promise<void> {
  if (move.eventType !== 'correction') return
  const { rows } = await tx.query<{ ok: boolean }>(
    `SELECT $3::timestamptz <= now() OR EXISTS (SELECT 1 FROM relationship r WHERE r.kind = $1 AND r.child_position_id = $2
       AND r.superseded_at IS NULL AND r.valid_from = $3::timestamptz) AS ok`,
    [move.kind, move.child, move.at],
  )
  if (rows[0]?.ok !== true) {
    throw new ApiError(422, 'VALID_FROM_IN_FUTURE', 'Date a correction today or earlier, or at the start of the pending change it cancels.')
  }
}

/** The relationship row of the kind valid at the move's date, as the system of record knows it now. */
async function parentAt(tx: Tx, move: Move) {
  const { rows } = await tx.query(
    `SELECT r.parent_position_id AS position_id, p.position_ref, r.leg FROM relationship r JOIN position p ON p.id = r.parent_position_id
     WHERE r.kind = $1 AND r.child_position_id = $2 AND r.superseded_at IS NULL
       AND r.valid_from <= $3::timestamptz AND (r.valid_to IS NULL OR r.valid_to > $3::timestamptz)`,
    [move.kind, move.child, move.at],
  )
  return rows[0] ?? null
}

// The G2 CHECK needs a case id for change/correction rows: a case being opened has none yet, so the dry-run opens a
// scratch case inside the savepoint it rolls back.
async function scratchCase(tx: Tx, type: CaseType, reasonCode: string, positionId: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by)
     SELECT app_tenant_id(), $1, 'position', p.id, $2, 'open', 'null'::jsonb, p.market_id, app_user_id() FROM position p
     WHERE p.id = $3 RETURNING id`,
    [type, reasonCode, positionId],
  )
  return rows[0]!.id
}

async function committedPeriods(tx: Tx, move: Move) {
  const { rows } = await tx.query(
    `SELECT c.period_id, c.starts_at, c.ends_at, c.state FROM position p,
       committed_periods_overlapping(p.market_id, $2::timestamptz, now()) c
     WHERE p.id = $1 ORDER BY c.starts_at, c.period_id`,
    [move.child, move.at],
  )
  return rows
}

interface Spec<P extends RelationshipPayload> {
  readonly type: CaseType
  readonly reasonCodes: readonly string[]
  readonly payload: z.ZodType<P>
  readonly audit: string
}

function relationshipCaseType<P extends RelationshipPayload>(spec: Spec<P>): GenCaseType<P> {
  const prepare = async (tx: Tx, child: string, payload: P): Promise<Move> => {
    const move = await moveOf(tx, child, payload)
    await assertLeg(tx, move.leg)
    await assertCorrectionDate(tx, move)
    return move
  }
  return {
    type: spec.type, subjectTypes: ['position'], reasonCodes: spec.reasonCodes, evidenceRequired: true, permissions: PERMISSIONS,
    payload: spec.payload, resolveSubject: resolvePositionSubject,
    // The proposed parent is not scoped to the filer's markets: sponsor chains cross markets (D-B2-21).
    async validateCreate(tx, subject, payload) {
      const move = await prepare(tx, subject.id, payload)
      const refusal = await dryRun(tx, async () => apply(tx, move, await scratchCase(tx, spec.type, spec.reasonCodes[0]!, subject.id)))
      if (refusal !== null) throw refusal
    },
    async effectPreview(tx, c) {
      const move = await prepare(tx, c.subject_id, c.payload)
      const refusal = await dryRun(tx, () => apply(tx, move, c.id))
      if (refusal?.code === 'GEN_CYCLE') throw refusal // D-B2-05: a cycle is refused at submit, never stored
      const preview = {
        current_parent: await parentAt(tx, move), proposed_parent: await positionRef(tx, move.parent),
        structural_check: refusal === null ? { ok: true } : { ok: false, code: refusal.code },
      }
      if (move.eventType === 'change') return { ...preview, affected_committed_periods: [] }
      const periods = await committedPeriods(tx, move)
      return { ...preview, affected_committed_periods: periods, affects_committed_periods: periods.length > 0, estimated_payout_impact: null, impact_note: IMPACT_NOTE }
    },
    async onDecision(tx, c, decision) {
      if (decision !== 'approved') return
      // The leg width and the correction date are checked again: settings and pending rows may have changed since submit.
      await applyApproved(tx, c, await prepare(tx, c.subject_id, c.payload), spec.audit)
    },
  }
}

/** The approved case's write; any refusal rolls the decision back and the case stays submitted (AC-GEN4-2). */
async function applyApproved(tx: Tx, c: CaseRecord, move: Move, action: string): Promise<void> {
  const { rows } = await withSqlErrors(() => apply(tx, move, c.id))
  await recordAudit(tx, {
    action, objectType: 'position', objectId: move.child,
    after: { kind: move.kind, relationship_id: rows[0]!.id, parent_position_id: move.parent, leg: move.leg, valid_from: move.at, case_id: c.id },
  })
}

export const genealogyChangeType = relationshipCaseType<ChangePayload>({
  type: 'genealogy_change', reasonCodes: ['PARTICIPANT_REQUEST', 'ENROLMENT_ERROR', 'COMPANY_DECISION'], payload: changePayload,
  audit: 'GENEALOGY.CHANGED',
})

export const genealogyCorrectionType = relationshipCaseType<CorrectionPayload>({
  type: 'genealogy_correction', reasonCodes: ['DATA_ENTRY_ERROR', 'MIGRATION_ERROR', 'DISPUTE_RESOLUTION'],
  payload: correctionPayload, audit: 'GENEALOGY.CORRECTED',
})
