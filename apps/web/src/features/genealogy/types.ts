// Response shapes of the genealogy routes (PLAN B2 2.5; apps/api/src/modules/gen: tree-routes.ts, nodes.ts, positions.ts, downline.ts).

export const TREE_PATH = '/v1/genealogy/tree'
export const SEARCH_PATH = '/v1/genealogy/search'

export type TreeKind = 'sponsor' | 'placement'

/** API-14 node: owner, status and leg as of the date asked; subtree_count only from the read model. */
export interface TreeNode {
  readonly position_id: string
  readonly position_ref: string
  readonly owner: { readonly participant_id: string; readonly external_ref: string; readonly display_name: string | null } | null
  readonly status: string | null
  readonly market_code: string
  readonly leg: string | null
  readonly children_count: number
  readonly subtree_count: number | null
}

export interface TreePage {
  readonly focus: TreeNode | null
  /** Root first. */
  readonly breadcrumbs: readonly TreeNode[]
  readonly breadcrumbs_truncated: boolean
  readonly children: readonly TreeNode[]
}

/** meta.read_model of the tree and search answers (D-B2-07). */
export interface ReadModel {
  readonly source: 'read_model' | 'system_of_record'
  readonly state: 'current' | 'stale'
  readonly stale_since: string | null
  readonly version: string | number | null
}

interface ParentRef {
  readonly position_id: string
  readonly position_ref: string
  readonly valid_from: string
}

/** GET /v1/positions/:id. */
export interface PositionView {
  readonly id: string
  readonly position_ref: string
  readonly market: { readonly id: string; readonly code: string }
  readonly status: string
  readonly status_from: string
  readonly owner: { readonly participant_id: string; readonly external_ref: string; readonly display_name: string | null } | null
  readonly ownership: readonly {
    readonly participant: { readonly id: string; readonly external_ref: string; readonly display_name: string | null }
    readonly valid_from: string
    readonly valid_to: string | null
    readonly case_id: string | null
  }[]
  readonly status_history: readonly {
    readonly from_status: string | null
    readonly to_status: string
    readonly effective_from: string
    readonly reason: string | null
    readonly case_id: string | null
    readonly recorded_at: string
  }[]
  readonly parents: { readonly sponsor: ParentRef | null; readonly placement: (ParentRef & { readonly leg: string | null }) | null }
}

/** API-13 node as the viewer may see it (FR-GEN-006 field matrix): deeper fields only for nearer levels. */
export interface DownlineNode {
  readonly position_id: string
  readonly depth: number
  readonly display_name: string | null
  readonly position_ref: string
  readonly status: string
  readonly enrolled_on?: string | null
  readonly external_ref?: string | null
  readonly market_code?: string
  readonly contact_masked?: Readonly<Record<string, string>> | null
}

export interface Downline {
  readonly node: DownlineNode | null
  readonly children: readonly DownlineNode[]
  readonly aggregates: readonly { readonly depth: number; readonly count: number }[]
  readonly policy: { readonly version_id: string | null; readonly named_depth: number; readonly contact_for_personally_sponsored: boolean; readonly default: boolean }
}
