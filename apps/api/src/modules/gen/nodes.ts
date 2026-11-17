import type { Tx } from '@nmp/db'
import { validKnownAt, type Kind } from './read-model.js'

/** What a genealogy read shows: one tree kind, valid at asOf, known at knownAt (instants as text; null = now). */
export interface View {
  readonly kind: Kind
  readonly asOf: string | null
  readonly knownAt: string | null
  /** The read-model version counts come from; null = the system of record (no subtree counts). */
  readonly modelVersion: string | null
}

export interface Owner {
  readonly participant_id: string
  readonly external_ref: string
  readonly display_name: string | null
}

/** A tree node of API-14 (PLAN B2 2.5). */
export interface TreeNode {
  readonly position_id: string
  readonly position_ref: string
  readonly owner: Owner | null
  readonly status: string | null
  readonly market_code: string
  readonly leg: string | null
  readonly children_count: number
  readonly subtree_count: number | null
}

const D = 'coalesce($3::timestamptz, now())'
const T = 'coalesce($4::timestamptz, now())'

// Status, owner and leg as of D (known at T); counts from the read model when one is given, else from relationship.
const NODES_SQL = `
  SELECT p.id AS position_id, p.position_ref, m.code AS market_code,
    (SELECT h.to_status FROM position_status_history h
     WHERE h.position_id = p.id AND h.effective_from <= ${D} AND h.recorded_at <= ${T}
     ORDER BY h.effective_from DESC, h.recorded_at DESC, h.id DESC LIMIT 1) AS status,
    CASE WHEN o.participant_id IS NOT NULL THEN jsonb_build_object('participant_id', o.participant_id,
      'external_ref', d.external_ref, 'display_name', d.display_name) END AS owner, r.leg,
    CASE WHEN $5::bigint IS NULL
      THEN (SELECT count(*) FROM relationship c WHERE c.kind = $2 AND c.parent_position_id = p.id AND ${validKnownAt('c', D, T)})
      ELSE (SELECT count(*) FROM path_node c WHERE c.kind = $2 AND c.model_version = $5 AND c.parent_position_id = p.id)
    END::int AS children_count,
    (SELECT n.subtree_count FROM path_node n WHERE n.kind = $2 AND n.model_version = $5 AND n.position_id = p.id) AS subtree_count
  FROM unnest($1::uuid[]) WITH ORDINALITY AS u (id, ord)
  JOIN position p ON p.id = u.id
  JOIN market m ON m.tenant_id = p.tenant_id AND m.id = p.market_id
  LEFT JOIN position_ownership o ON o.position_id = p.id AND o.valid_from <= ${D} AND (o.valid_to IS NULL OR o.valid_to > ${D})
  LEFT JOIN LATERAL par_display(ARRAY[o.participant_id]) d ON true
  LEFT JOIN relationship r ON r.kind = $2 AND r.child_position_id = p.id AND ${validKnownAt('r', D, T)}
  ORDER BY u.ord`

/** The nodes of the positions, in the order given (unknown ids are left out). */
export async function loadNodes(tx: Tx, ids: readonly string[], view: View): Promise<TreeNode[]> {
  if (ids.length === 0) return []
  const { rows } = await tx.query<TreeNode>(NODES_SQL, [ids, view.kind, view.asOf, view.knownAt, view.modelVersion])
  return rows
}
