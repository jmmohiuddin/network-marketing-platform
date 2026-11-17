import type { Tx } from '@nmp/db'
import type { View } from './nodes.js'
import { validKnownAt } from './read-model.js'

/** Nearest ancestors shown as breadcrumbs (FR-GEN-007). */
export const BREADCRUMB_LIMIT = 50
/** Search results (PLAN B2 2.5). */
export const SEARCH_LIMIT = 20

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A position by id or by reference; null when the tenant has none. */
export async function resolvePosition(tx: Tx, idOrRef: string): Promise<string | null> {
  // A reference may itself look like a UUID (position_ref CHECK allows it): the id wins, then the reference.
  const { rows } = UUID.test(idOrRef)
    ? await tx.query<{ id: string }>(
      `SELECT id FROM position WHERE id = $1::text::uuid OR position_ref = $1::text
       ORDER BY (id = $1::text::uuid) DESC LIMIT 1`, [idOrRef])
    : await tx.query<{ id: string }>('SELECT id FROM position WHERE position_ref = $1', [idOrRef])
  return rows[0]?.id ?? null
}

/** Children are listed by position reference, then id: the cursor is the last pair shown. */
export type ChildCursor = readonly [string, string]

export interface ChildPage {
  readonly ids: readonly string[]
  readonly last: ChildCursor | null
  readonly more: boolean
}

const D = 'coalesce($3::timestamptz, now())'
const T = 'coalesce($4::timestamptz, now())'

// Every variant binds kind, parent, D, T, cursor (2), limit and model version in that order; unused ones are cast so
// their types are known.
const AFTER = '($5::text IS NULL OR (p.position_ref, p.id) > ($5::text, $6::uuid))'
const PAGE = 'ORDER BY p.position_ref, p.id LIMIT $7'

// One level only (AC-GEN7-1): children come by parent (indexed), never by scanning the subtree.
function childrenSql(view: View, parent: string | null): string {
  if (view.modelVersion !== null) {
    return `SELECT p.id, p.position_ref FROM path_node n JOIN position p ON p.id = n.position_id
      WHERE n.kind = $1 AND n.model_version = $8::bigint AND $3::timestamptz IS NULL AND $4::timestamptz IS NULL
        AND n.parent_position_id ${parent === null ? 'IS NULL AND $2::uuid IS NULL' : '= $2::uuid'} AND ${AFTER} ${PAGE}`
  }
  if (parent !== null) {
    return `SELECT p.id, p.position_ref FROM relationship r JOIN position p ON p.id = r.child_position_id
      WHERE r.kind = $1 AND r.parent_position_id = $2::uuid AND $8::bigint IS NULL AND ${validKnownAt('r', D, T)}
        AND ${AFTER} ${PAGE}`
  }
  // shortcut: top-level positions of the system of record scan position; add a roots index on the history if as-of
  // views of very large tenants need it.
  return `SELECT p.id, p.position_ref FROM position p
    WHERE p.created_at <= ${T} AND $2::uuid IS NULL AND $8::bigint IS NULL
      AND EXISTS (SELECT 1 FROM position_ownership o WHERE o.position_id = p.id AND o.valid_from <= ${D})
      AND NOT EXISTS (SELECT 1 FROM relationship r WHERE r.kind = $1 AND r.child_position_id = p.id AND ${validKnownAt('r', D, T)})
      AND ${AFTER} ${PAGE}`
}

/** One page of the direct children of `parent` (null = the top-level positions). */
export async function childrenPage(
  tx: Tx, view: View, parent: string | null, after: ChildCursor | undefined, limit: number,
): Promise<ChildPage> {
  const { rows } = await tx.query<{ id: string; position_ref: string }>(childrenSql(view, parent), [
    view.kind, parent, view.asOf, view.knownAt, after?.[0] ?? null, after?.[1] ?? null, limit + 1, view.modelVersion,
  ])
  const shown = rows.slice(0, limit)
  const last = shown.at(-1)
  return { ids: shown.map((row) => row.id), last: last === undefined ? null : [last.position_ref, last.id], more: rows.length > limit }
}

export interface Breadcrumbs {
  /** Root first, at most BREADCRUMB_LIMIT nearest ancestors. */
  readonly ids: readonly string[]
  readonly truncated: boolean
}

/** Read model: the ancestors by the labels of the node's path (E-ADR-32, no GiST needed). */
async function modelAncestors(tx: Tx, view: View, positionId: string): Promise<Breadcrumbs> {
  const { rows } = await tx.query<{ position_id: string; truncated: boolean }>(
    `WITH f AS (SELECT path, depth FROM path_node
                WHERE kind = $1 AND model_version = $2 AND position_id = $3 AND depth > 0)
     SELECT n.position_id, f.depth > $4 AS truncated
     FROM f JOIN position p ON p.label = ANY (string_to_array(ltree2text(
       subpath(f.path, greatest(f.depth - $4, 0), least(f.depth, $4))), '.'))
     JOIN path_node n ON n.kind = $1 AND n.model_version = $2 AND n.position_id = p.id
     ORDER BY n.depth`,
    [view.kind, view.modelVersion, positionId, BREADCRUMB_LIMIT],
  )
  return { ids: rows.map((row) => row.position_id), truncated: rows[0]?.truncated ?? false }
}

/** System of record: walk up at most BREADCRUMB_LIMIT + 1 levels with the bitemporal predicate. */
async function recordAncestors(tx: Tx, view: View, positionId: string): Promise<Breadcrumbs> {
  const { rows } = await tx.query<{ id: string; lvl: number }>(
    `WITH RECURSIVE up (id, lvl) AS (
       SELECT $2::uuid, 0
       UNION ALL
       SELECT r.parent_position_id, up.lvl + 1 FROM up
       JOIN relationship r ON r.kind = $1 AND r.child_position_id = up.id AND ${validKnownAt('r', D, T)}
       WHERE up.lvl <= $5)
     SELECT id, lvl FROM up WHERE lvl > 0 ORDER BY lvl DESC`,
    [view.kind, positionId, view.asOf, view.knownAt, BREADCRUMB_LIMIT],
  )
  const kept = rows.filter((row) => row.lvl <= BREADCRUMB_LIMIT)
  return { ids: kept.map((row) => row.id), truncated: kept.length < rows.length }
}

export function breadcrumbs(tx: Tx, view: View, positionId: string): Promise<Breadcrumbs> {
  return view.modelVersion === null ? recordAncestors(tx, view, positionId) : modelAncestors(tx, view, positionId)
}

const likePrefix = (q: string): string => `${q.replace(/[\\%_]/g, '\\$&')}%`

/**
 * FR-GEN-007 search: position references starting with q, then the positions held now by participants found by
 * par_search (exact external reference, else name similarity), at most SEARCH_LIMIT, without repeats.
 */
export async function searchPositions(tx: Tx, q: string): Promise<string[]> {
  const byRef = await tx.query<{ id: string }>(
    `SELECT id FROM position WHERE upper(position_ref) LIKE upper($1) ESCAPE '\\' ORDER BY position_ref, id LIMIT $2`,
    [likePrefix(q), SEARCH_LIMIT],
  )
  const byOwner = await tx.query<{ id: string }>(
    `SELECT g.position_id AS id
     FROM par_search($1, $2) WITH ORDINALITY AS s (participant_id, external_ref, display_name, ord)
     CROSS JOIN LATERAL gen_positions_of(s.participant_id, now()) g
     ORDER BY s.ord, g.owned_from, g.position_id LIMIT $2`,
    [q, SEARCH_LIMIT],
  )
  const ids = [...byRef.rows, ...byOwner.rows].map((row) => row.id)
  return [...new Set(ids)].slice(0, SEARCH_LIMIT)
}
