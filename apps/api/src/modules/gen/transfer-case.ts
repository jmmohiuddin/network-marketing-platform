import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { assertPositionsLimit } from '../par/index.js'
import { inScope } from '../ten/index.js'
import { PERMISSIONS, resolvePositionSubject, type GenCaseType } from './case-support.js'
import { notBeforeToday, toInstant } from './dates.js'
import { dryRun, withSqlErrors } from './errors.js'

export const transferPayload = z.strictObject({ to_participant_id: z.uuid(), effective_from: notBeforeToday })
export type TransferPayload = z.infer<typeof transferPayload>

/** AC-GEN1-2: the owner changes at greatest(effective_from, now()); the tree is unchanged. */
async function transferAt(tx: Tx, payload: TransferPayload): Promise<string> {
  const { rows } = await tx.query<{ at: string }>('SELECT greatest($1::timestamptz, now())::text AS at', [toInstant(payload.effective_from)])
  return rows[0]!.at
}

const transfer = (tx: Tx, position: string, to: string, at: string, caseId: string | null) =>
  tx.query<{ id: string }>('SELECT gen_transfer_ownership($1, $2, $3, $4) AS id', [position, to, at, caseId])

/** D-B3-07: the position counts toward the new owner's positions limit in its market unless it is terminated. */
async function assertLimit(tx: Tx, position: string, to: string): Promise<void> {
  const { rows } = await tx.query<{ market_id: string; live: boolean }>(
    `SELECT market_id, status <> 'terminated' AS live FROM position WHERE id = $1`, [position])
  await assertPositionsLimit(tx, to, rows[0]!.market_id, rows[0]!.live ? 1 : 0)
}

interface OwnerRef {
  readonly participant_id: string
  readonly external_ref: string
}

async function participantRef(tx: Tx, id: string | null): Promise<OwnerRef | null> {
  if (id === null) return null
  const { rows } = await tx.query<OwnerRef>('SELECT participant_id, external_ref FROM par_display(ARRAY[$1::uuid])', [id])
  return rows[0] ?? null
}

async function ownerAt(tx: Tx, position: string, at: string): Promise<string | null> {
  const { rows } = await tx.query<{ owner: string | null }>('SELECT gen_owner_at($1, $2::timestamptz) AS owner', [position, at])
  return rows[0]?.owner ?? null
}

export const transferType: GenCaseType<TransferPayload> = {
  type: 'transfer',
  subjectTypes: ['position'],
  reasonCodes: ['SUCCESSION', 'SALE', 'DIVORCE', 'CORPORATE_RESTRUCTURE'],
  evidenceRequired: true,
  permissions: PERMISSIONS,
  payload: transferPayload,
  resolveSubject: resolvePositionSubject,
  // The new owner must be in the filer's create markets, like PAR's duplicate target: out of scope reads as unknown.
  async validateCreate(tx, subject, payload, scope) {
    const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM par_display(ARRAY[$1::uuid])', [payload.to_participant_id])
    if (rows[0] === undefined || !inScope(scope, rows[0].market_id)) {
      throw new ApiError(422, 'PARTICIPANT_NOT_FOUND', 'The new owner is not a participant of this tenant.')
    }
    await assertLimit(tx, subject.id, payload.to_participant_id)
    const at = await transferAt(tx, payload)
    const refusal = await dryRun(tx, () => transfer(tx, subject.id, payload.to_participant_id, at, null))
    if (refusal !== null) throw refusal
  },
  async effectPreview(tx, c) {
    const at = await transferAt(tx, c.payload)
    const { rows } = await tx.query<{ can_hold: boolean | null }>(
      'SELECT (SELECT t.can_hold_positions FROM par_type_at($1, $2::timestamptz) t) AS can_hold',
      [c.payload.to_participant_id, at],
    )
    return {
      from_owner: await participantRef(tx, await ownerAt(tx, c.subject_id, at)),
      to_owner: await participantRef(tx, c.payload.to_participant_id),
      to_type_can_hold_positions: rows[0]?.can_hold === true,
    }
  },
  async onDecision(tx, c, decision) {
    if (decision !== 'approved') return
    const at = await transferAt(tx, c.payload)
    const from = await ownerAt(tx, c.subject_id, at)
    await assertLimit(tx, c.subject_id, c.payload.to_participant_id)
    const { rows } = await withSqlErrors(() => transfer(tx, c.subject_id, c.payload.to_participant_id, at, c.id))
    await recordAudit(tx, {
      action: 'POSITION.OWNERSHIP_TRANSFERRED', objectType: 'position', objectId: c.subject_id,
      after: { ownership_id: rows[0]!.id, from_participant_id: from, to_participant_id: c.payload.to_participant_id, valid_from: at, case_id: c.id },
    })
  },
}
