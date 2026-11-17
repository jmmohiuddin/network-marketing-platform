import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { getSetting, inScope } from '../ten/index.js'
import type { PlacementInput, PositionBody } from './schemas.js'
import { inSavepoint, pgCode, sqlCall, translateSqlError } from './sql-errors.js'

export type PositionStatus = 'pending' | 'active' | 'suspended' | 'terminated'

export interface PositionView {
  readonly id: string
  readonly position_ref: string
  readonly status: PositionStatus
}

export interface PlacementView {
  readonly parent_position_id: string
  readonly leg: string | null
  readonly auto: boolean
}

/**
 * AC-PAR2-1: the sponsor position exists, is active, and its owner's type at `at` can sponsor. FOR SHARE: a concurrent
 * status change (G5 locks the position FOR UPDATE) waits for this enrolment, or this enrolment sees its result.
 */
export async function resolveSponsor(tx: Tx, positionRef: string, at: Date, scope: readonly string[] | null): Promise<string> {
  const { rows } = await tx.query<{ id: string; market_id: string; status: PositionStatus; can_sponsor: boolean | null }>(
    `SELECT p.id, p.market_id, p.status, t.can_sponsor FROM position p
     LEFT JOIN LATERAL par_type_at(gen_owner_at(p.id, $2), $2) t ON true
     WHERE p.position_ref = $1 FOR SHARE OF p`,
    [positionRef, at],
  )
  const sponsor = rows[0]
  if (sponsor === undefined) throw new ApiError(422, 'SPONSOR_NOT_FOUND', 'No position has this sponsor reference.')
  // Cross-market sponsorship is allowed, but a market-scoped caller learns nothing about a position outside its markets.
  if (!inScope(scope, sponsor.market_id) && (sponsor.status !== 'active' || sponsor.can_sponsor !== true)) {
    throw new ApiError(422, 'SPONSOR_NOT_ELIGIBLE', 'This position cannot sponsor.')
  }
  if (sponsor.status !== 'active') {
    throw new ApiError(422, 'SPONSOR_INACTIVE', 'The sponsor position is not active.', { status: sponsor.status })
  }
  if (sponsor.can_sponsor !== true) throw new ApiError(422, 'SPONSOR_NOT_ELIGIBLE', 'The sponsor\'s participant type cannot sponsor.')
  return sponsor.id
}

async function positionIdByRef(tx: Tx, positionRef: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM position WHERE position_ref = $1', [positionRef])
  if (rows[0] === undefined) throw new ApiError(422, 'PARENT_NOT_ELIGIBLE', 'No position has this placement reference.')
  return rows[0].id
}

async function placementWidth(tx: Tx): Promise<number> {
  const width = await getSetting(tx, 'genealogy.placement_width')
  if (width === null) {
    throw new ApiError(422, 'PLACEMENT_NOT_CONFIGURED', 'Set genealogy.placement_width before placing by leg or automatically.')
  }
  return width
}

const applyPlacement = (tx: Tx, child: string, parent: string, leg: string | null, at: Date) =>
  sqlCall(() => tx.query(
    `SELECT gen_apply_relationship('placement', $1, $2, $3, $4, 'enrolment', NULL, NULL)`, [child, parent, leg, at],
  ))

/** D-B2-20: breadth-first under the parent, smallest free leg (G3, under the placement lock). */
async function autoPlace(tx: Tx, child: string, parent: string, width: number, at: Date): Promise<{ parent: string; leg: string }> {
  const { rows } = await sqlCall(() => tx.query<{ parent_position_id: string; leg: string }>(
    'SELECT parent_position_id, leg FROM gen_auto_place($1, $2)', [parent, width],
  ))
  if (rows[0] === undefined) throw new ApiError(409, 'GEN_SLOT_TAKEN', 'No free placement leg under this parent.')
  await applyPlacement(tx, child, rows[0].parent_position_id, rows[0].leg, at)
  return { parent: rows[0].parent_position_id, leg: rows[0].leg }
}

interface Assigned {
  readonly parent: string
  readonly leg: string | null
  readonly auto: boolean
}

/** A requested leg; taken (GN003) falls back to the auto rule (D-B2-20), serialised by the placement lock (AC-42.1). */
async function placeOnLeg(tx: Tx, child: string, parent: string, leg: string, width: number, at: Date): Promise<Assigned> {
  try {
    await inSavepoint(tx, () => tx.query(
      `SELECT gen_apply_relationship('placement', $1, $2, $3, $4, 'enrolment', NULL, NULL)`, [child, parent, leg, at],
    ))
    return { parent, leg, auto: false }
  } catch (error) {
    if (pgCode(error) !== 'GN003') throw translateSqlError(error)
    return { ...(await autoPlace(tx, child, parent, width, at)), auto: true }
  }
}

/** Under a parent without leg (unilevel), on a requested leg, or by the auto rule (FR-GEN-005). */
async function assign(tx: Tx, child: string, parent: string, input: PlacementInput, at: Date): Promise<Assigned> {
  const requestedLeg = 'leg' in input ? input.leg ?? null : null
  if (!('auto' in input) && requestedLeg === null) {
    await applyPlacement(tx, child, parent, null, at)
    return { parent, leg: null, auto: false }
  }
  const width = await placementWidth(tx)
  if (requestedLeg === null) return { ...(await autoPlace(tx, child, parent, width, at)), auto: true }
  if (Number(requestedLeg) > width) throw new ApiError(422, 'LEG_OUT_OF_RANGE', `Legs run from 1 to ${width}.`, { width })
  return placeOnLeg(tx, child, parent, requestedLeg, width, at)
}

/** Places the new position; GENEALOGY.PLACED records the request, the result and the tie-break rule. */
async function place(tx: Tx, positionId: string, input: PlacementInput, at: Date): Promise<PlacementView> {
  const parent = await positionIdByRef(tx, input.position_ref)
  const assigned = await assign(tx, positionId, parent, input, at)
  await recordAudit(tx, {
    action: 'GENEALOGY.PLACED', objectType: 'position', objectId: positionId,
    after: {
      requested: { parent_position_id: parent, leg: 'leg' in input ? input.leg ?? null : null, auto: 'auto' in input },
      assigned: { parent_position_id: assigned.parent, leg: assigned.leg },
      rule: assigned.auto ? 'bfs_smallest_leg' : null, enrolled_at: at, position_id: positionId,
    },
  })
  return { parent_position_id: assigned.parent, leg: assigned.leg, auto: assigned.auto }
}

export interface NewPosition {
  readonly participantId: string
  readonly marketId: string
  readonly at: Date
  readonly status: 'pending' | 'active'
  readonly input: PositionBody
  /** Resolved by resolveSponsor. */
  readonly sponsorId: string | null
}

/** G1 + sponsor (G2 enrolment) + placement: a position of the participant with its first relationships, audited. */
export async function createPosition(tx: Tx, p: NewPosition): Promise<{ position: PositionView; placement: PlacementView | null }> {
  if (p.input.brand_id !== undefined) {
    const { rowCount } = await tx.query('SELECT 1 FROM brand WHERE id = $1', [p.input.brand_id])
    if (rowCount !== 1) throw new ApiError(422, 'BRAND_NOT_FOUND', 'The brand does not exist.')
  }
  const { rows: created } = await sqlCall(() => tx.query<{ id: string }>(
    'SELECT gen_create_position($1, $2, $3, $4, $5, $6) AS id',
    [p.participantId, p.marketId, p.input.brand_id ?? null, p.input.position_ref ?? null, p.status, p.at],
  ))
  const { rows } = await tx.query<PositionView>('SELECT id, position_ref, status FROM position WHERE id = $1', [created[0]!.id])
  const position = rows[0]!
  if (p.sponsorId !== null) {
    await sqlCall(() => tx.query(
      `SELECT gen_apply_relationship('sponsor', $1, $2, NULL, $3, 'enrolment', NULL, NULL)`, [position.id, p.sponsorId, p.at],
    ))
  }
  const placement = p.input.placement === undefined ? null : await place(tx, position.id, p.input.placement, p.at)
  await recordAudit(tx, {
    action: 'POSITION.CREATED', objectType: 'position', objectId: position.id,
    after: { participant_id: p.participantId, market_id: p.marketId, status: position.status, sponsor_position_id: p.sponsorId, valid_from: p.at },
  })
  return { position, placement }
}
