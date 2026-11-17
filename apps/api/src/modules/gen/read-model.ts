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

// The model holds the structure of built_at (the build's now()). It is crossed when a row of the kind started or ended
// after the build and by now (a future-dated row took effect although nothing was written, TS-61), or when a position
// was created after the build (gen_create_position does not mark the model stale; an unsponsored one is a root).
// shortcut: scans the kind's relationship rows and position.created_at per read (no index); store the next boundary as
// path_model.valid_until at build and mark stale on position insert (DB migration) when large tenants need it.
const STATE_SQL = `
  SELECT m.version::text AS version, m.stale_since,
    m.stale_since IS NULL AND (EXISTS (SELECT 1 FROM relationship r WHERE r.kind = m.kind AND r.superseded_at IS NULL
      AND ((r.valid_from > m.built_at AND r.valid_from <= now()) OR (r.valid_to > m.built_at AND r.valid_to <= now())))
      OR EXISTS (SELECT 1 FROM position p WHERE p.created_at > m.built_at)) AS crossed
  FROM path_model m WHERE m.kind = $1`

/**
 * The path read model of one kind (D-B2-07). A model whose structure changed by date since its build is marked stale
 * here, so the rebuild job picks it up; only while it still holds that build (BR-GEN-12: never serve it meanwhile).
 */
export async function modelState(tx: Tx, kind: Kind): Promise<ModelState> {
  const { rows } = await tx.query<{ version: string; stale_since: Date | null; crossed: boolean }>(STATE_SQL, [kind])
  const row = rows[0]
  if (row === undefined) return { version: '0', staleSince: null, current: false }
  if (row.crossed) {
    // Not audited: stale_since is a derived cache flag (the next build's GENEALOGY.REBUILT records its effect).
    const { rows: marked } = await tx.query<{ stale_since: Date }>(
      'UPDATE path_model SET stale_since = now() WHERE kind = $1 AND version = $2 AND stale_since IS NULL RETURNING stale_since',
      [kind, row.version],
    )
    // Not marked: a write or a rebuild changed the row meanwhile; this read still must not use the version it saw.
    return { version: row.version, staleSince: marked[0]?.stale_since ?? row.stale_since, current: false }
  }
  return { version: row.version, staleSince: row.stale_since, current: row.stale_since === null && row.version !== '0' }
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
