import type { Tx } from '@nmp/db'
import type { CaseTypeDefinition } from '../cas/index.js'

/** A genealogy case type: every one dry-runs its structural write at create and PATCH (PLAN B2 2.4 `validateCreate`). */
export type GenCaseType<P> = CaseTypeDefinition<P> & Required<Pick<CaseTypeDefinition<P>, 'validateCreate'>>

/** Every genealogy case is about a position; its market scopes the case. */
export async function resolvePositionSubject(tx: Tx, _subjectType: string, subjectId: string): Promise<{ marketId: string | null } | null> {
  const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM position WHERE id = $1', [subjectId])
  return rows[0] === undefined ? null : { marketId: rows[0].market_id }
}

export const PERMISSIONS = { read: 'case.genealogy.read', create: 'case.genealogy.create', decide: 'case.genealogy.approve' } as const

export interface PositionRef {
  readonly position_id: string
  readonly position_ref: string
}

export async function positionRef(tx: Tx, id: string): Promise<PositionRef | null> {
  const { rows } = await tx.query<PositionRef>('SELECT id AS position_id, position_ref FROM position WHERE id = $1', [id])
  return rows[0] ?? null
}
