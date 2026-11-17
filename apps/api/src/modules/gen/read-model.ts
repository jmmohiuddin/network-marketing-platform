import type { Tx } from '@nmp/db'

export const KINDS = ['sponsor', 'placement'] as const
export type Kind = (typeof KINDS)[number]

/**
 * FR-GEN-003 bitemporal predicate (ENGINE_GENEALOGY 2.4) on relationship alias `r`: valid at `d`, known at `t` (SQL
 * expressions, e.g. a bound parameter or now()).
 */
export const validKnownAt = (r: string, d: string, t: string): string =>
  `${r}.valid_from <= ${d} AND (${r}.valid_to IS NULL OR ${r}.valid_to > ${d})
   AND ${r}.recorded_at <= ${t} AND (${r}.superseded_at IS NULL OR ${r}.superseded_at > ${t})`

/** Valid now and known now: what the path read model holds. */
export const CURRENT = (r: string): string => validKnownAt(r, 'now()', 'now()')

export interface ModelState {
  /** path_model.version as text (bigint); '0' before the first build. */
  readonly version: string
  readonly staleSince: Date | null
  /** Built at least once and not stale: reads may use it. */
  readonly current: boolean
}

// The model holds the structure of built_at (the build's now()). Writes mark it stale (relationship and position
// triggers); a row of the kind that starts or ends after the build expires it at path_model.valid_until (set by the
// rebuild from gen_path_valid_until, OI-3), which gen_stale_models also lists for the rebuild job (TS-61).
const STATE_SQL = `
  SELECT m.version::text AS version, coalesce(m.stale_since, m.valid_until) AS stale_since,
    m.stale_since IS NULL AND (m.valid_until IS NULL OR m.valid_until > now()) AS fresh
  FROM path_model m WHERE m.kind = $1`

/** The path read model of one kind (D-B2-07); an expired model is stale until rebuilt (BR-GEN-12: never serve it). */
export async function modelState(tx: Tx, kind: Kind): Promise<ModelState> {
  const { rows } = await tx.query<{ version: string; stale_since: Date | null; fresh: boolean }>(STATE_SQL, [kind])
  const row = rows[0]
  if (row === undefined) return { version: '0', staleSince: null, current: false }
  return { version: row.version, staleSince: row.fresh ? null : row.stale_since, current: row.fresh && row.version !== '0' }
}

/** meta.read_model of the genealogy reads (PLAN B2 2.5). */
export function readModelMeta(state: ModelState, usedModel: boolean) {
  return {
    source: usedModel ? 'read_model' : 'system_of_record',
    state: state.current ? 'current' : 'stale',
    stale_since: state.staleSince,
    version: state.version,
  }
}

/** The model version to read for this position, or null when the system of record must answer. */
export async function modelVersionFor(tx: Tx, kind: Kind, state: ModelState, positionId: string | null): Promise<string | null> {
  if (!state.current) return null
  if (positionId === null) return state.version
  // A position whose creating transaction committed after the build read the positions is not a node: answer from the
  // system of record.
  const { rowCount } = await tx.query(
    'SELECT 1 FROM path_node WHERE kind = $1 AND model_version = $2 AND position_id = $3',
    [kind, state.version, positionId],
  )
  return rowCount === 1 ? state.version : null
}
