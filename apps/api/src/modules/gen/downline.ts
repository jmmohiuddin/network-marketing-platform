import type { Tx } from '@nmp/db'
import { maskContact, type Contact } from '../../lib/contact.js'
import { getEffectiveSettings } from '../ten/index.js'
import { CURRENT } from './read-model.js'

/** FR-GEN-006 "safe default applies otherwise" (D-B2-08): the platform default while the tenant has no policy. */
const SAFE_DEFAULT = { named_depth: 1, contact_for_personally_sponsored: false } as const

export interface Policy {
  readonly version_id: string | null
  readonly named_depth: number
  readonly contact_for_personally_sponsored: boolean
  readonly default: boolean
}

/** The visibility policy in force and the settings version it comes from (logged with every downline read). */
export async function policyInForce(tx: Tx): Promise<Policy> {
  const settings = await getEffectiveSettings(tx)
  const value = settings?.values['genealogy.visibility_policy']
  if (settings === null || value === undefined) return { version_id: null, ...SAFE_DEFAULT, default: true }
  return { version_id: settings.versionId, ...value, default: false }
}

/**
 * Levels from the viewer down to the target in the sponsor tree valid and known now (0 = the viewer itself), or null
 * when the target is not in the viewer's downline. The read model answers when both are nodes of its current version;
 * otherwise a walk up `relationship` bounded by GENEALOGY_FALLBACK_MAX_DEPTH, which denies when the bound is reached
 * (BR-GEN-12: a stale model never widens access).
 */
export async function levelsBelow(tx: Tx, modelVersion: string | null, viewer: string, target: string, maxDepth: number): Promise<number | null> {
  if (modelVersion !== null) {
    const { rows } = await tx.query<{ levels: number; below: boolean }>(
      `SELECT t.depth - v.depth AS levels, v.path @> t.path AS below FROM path_node v, path_node t
       WHERE v.kind = 'sponsor' AND v.model_version = $1 AND v.position_id = $2
         AND t.kind = 'sponsor' AND t.model_version = $1 AND t.position_id = $3`,
      [modelVersion, viewer, target],
    )
    if (rows[0] !== undefined) return rows[0].below ? rows[0].levels : null
  }
  const { rows } = await tx.query<{ levels: number | null }>(
    `WITH RECURSIVE up (id, lvl) AS (
       SELECT p.id, 0 FROM position p WHERE p.id = $2
       UNION ALL
       SELECT r.parent_position_id, up.lvl + 1 FROM up
       JOIN relationship r ON r.kind = 'sponsor' AND r.child_position_id = up.id AND ${CURRENT('r')}
       WHERE up.id <> $1::uuid AND up.lvl < $3)
     SELECT min(lvl) FILTER (WHERE id = $1) AS levels FROM up`,
    [viewer, target, maxDepth],
  )
  return rows[0]?.levels ?? null
}

export interface LevelCount {
  readonly depth: number
  readonly count: number
}

/**
 * Positions per level of the target's subtree from `fromLevel` levels below it (0 = the target itself), as levels below
 * the viewer: the aggregates shown beyond the named depth (AC-05.1).
 * shortcut: counts scan the hidden part of the subtree per request; cache them per (model_version, position) when
 * large downlines need it.
 */
export async function hiddenLevels(
  tx: Tx, modelVersion: string | null, target: string, fromLevel: number, targetLevels: number, maxDepth: number,
): Promise<LevelCount[]> {
  const { rows } = modelVersion === null
    ? await tx.query<{ lvl: number; count: number }>(
      `WITH RECURSIVE down (id, lvl) AS (
         SELECT $1::uuid, 0
         UNION ALL
         SELECT r.child_position_id, down.lvl + 1 FROM down
         JOIN relationship r ON r.kind = 'sponsor' AND r.parent_position_id = down.id AND ${CURRENT('r')}
         WHERE down.lvl < $3)
       SELECT lvl, count(*)::int AS count FROM down WHERE lvl >= $2 GROUP BY lvl ORDER BY lvl`,
      [target, fromLevel, maxDepth],
    )
    : await tx.query<{ lvl: number; count: number }>(
      `WITH a AS (SELECT path, depth FROM path_node WHERE kind = 'sponsor' AND model_version = $1 AND position_id = $2)
       SELECT n.depth - a.depth AS lvl, count(*)::int AS count FROM path_node n, a
       WHERE n.kind = 'sponsor' AND n.model_version = $1 AND ltree_prefix(n.path, 128) <@ ltree_prefix(a.path, 128)
         AND n.depth >= a.depth + $3 AND n.path <@ a.path
       GROUP BY 1 ORDER BY 1`,
      [modelVersion, target, fromLevel],
    )
  return rows.map((row) => ({ depth: targetLevels + row.lvl, count: row.count }))
}

interface DownlineRow {
  position_id: string
  position_ref: string
  status: string
  market_code: string
  enrolled_on: string | null
  external_ref: string | null
  display_name: string | null
  contact: Contact | null
}

// shortcut: contact is read from participant directly (no PAR SQL contract returns it); use a par_* function when PAR
// adds one.
const DOWNLINE_SQL = `
  SELECT p.id AS position_id, p.position_ref, p.status, m.code AS market_code,
    (SELECT to_char(h.effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM position_status_history h
     WHERE h.position_id = p.id AND h.from_status IS NULL ORDER BY h.effective_from LIMIT 1) AS enrolled_on,
    d.external_ref, d.display_name, pa.contact
  FROM unnest($1::uuid[]) WITH ORDINALITY AS u (id, ord)
  JOIN position p ON p.id = u.id
  JOIN market m ON m.tenant_id = p.tenant_id AND m.id = p.market_id
  LEFT JOIN position_ownership o ON o.position_id = p.id AND o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now())
  LEFT JOIN LATERAL par_display(ARRAY[o.participant_id]) d ON true
  LEFT JOIN participant pa ON pa.tenant_id = o.tenant_id AND pa.id = o.participant_id
  ORDER BY u.ord`

/** The FR-GEN-006 field matrix for a position `levels` below the viewer; null beyond the named depth. */
function visibleFields(row: DownlineRow, levels: number, policy: Policy): Record<string, unknown> | null {
  if (levels > policy.named_depth) return null
  const named = { position_id: row.position_id, depth: levels, display_name: row.display_name, position_ref: row.position_ref, status: row.status }
  if (levels >= 2) return named
  const personal = { ...named, enrolled_on: row.enrolled_on }
  if (levels === 1) return policy.contact_for_personally_sponsored ? { ...personal, contact_masked: maskContact(row.contact) } : personal
  return { ...personal, external_ref: row.external_ref, market_code: row.market_code, contact_masked: maskContact(row.contact) }
}

/** The positions as the viewer may see them, `levels` below it, in the order given. */
export async function downlineNodes(tx: Tx, ids: readonly string[], levels: number, policy: Policy) {
  if (ids.length === 0 || levels > policy.named_depth) return []
  const { rows } = await tx.query<DownlineRow>(DOWNLINE_SQL, [ids])
  return rows.flatMap((row) => visibleFields(row, levels, policy) ?? [])
}
