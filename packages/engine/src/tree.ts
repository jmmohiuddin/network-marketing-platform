// In-memory tree per run (SDD-08 §5, ADR-04 kept by E-ADR-32): flat typed arrays, built once from the
// bitemporal relationship rows, then O(N) passes. Copied from the spike (packages/spike/src/engine/tree.ts)
// and hardened: string ids, as-of filtering, both tree kinds share one position index, overflow guard.
import { EngineError } from './errors.js'
import { assertInt64 } from './money.js'
import type { PositionId, Relationship, TreeKind } from './types.js'

/** Index k is the same position in every tree of a run: positions sorted ascending by compareId. */
export interface Tree {
  readonly kind: TreeKind
  readonly ids: readonly PositionId[]
  readonly index: ReadonlyMap<PositionId, number>
  readonly parent: Int32Array // -1 = root
  readonly leg: readonly (string | null)[] // leg under the parent (placement)
  readonly childStart: Int32Array // children of k: childList[childStart[k] .. childStart[k + 1]), ascending index
  readonly childList: Int32Array
  readonly depth: Int32Array
  readonly bfs: Int32Array // parents before children; walk it backwards for bottom-up passes
}

/** "Tree as of D, as known at T" (FR-GEN-003). */
export interface AsOf { readonly validAtUs: bigint; readonly knownAtUs: bigint }

/** Code-unit order: the engine's one ordering of ids (never localeCompare). */
export function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * A run evaluates the tree at the last instant inside its period [start, end): end - 1 µs, so a change
 * effective at the next period's start does not apply (ENGINE_GENEALOGY C4).
 */
export function evaluationInstant(period: { readonly endsAtUs: bigint }): bigint {
  return period.endsAtUs - 1n
}

function isCurrent(r: Relationship, at: AsOf): boolean {
  return r.validFromUs <= at.validAtUs && (r.validToUs === null || at.validAtUs < r.validToUs) && r.recordedAtUs <= at.knownAtUs && (r.supersededAtUs === null || at.knownAtUs < r.supersededAtUs)
}

/** Sorted, duplicate-free position ids: the shared index of every tree in a run. */
export function positionOrder(positionIds: readonly PositionId[]): PositionId[] {
  const ids = [...positionIds].sort(compareId)
  ids.forEach((id, k) => {
    if (id.length === 0) throw new EngineError('INVALID_INPUT', 'position id must be non-empty')
    if (k > 0 && id === ids[k - 1]) throw new EngineError('INVALID_INPUT', 'duplicate position id', { positionId: id })
  })
  return ids
}

export function buildTree(ids: readonly PositionId[], relationships: readonly Relationship[], kind: TreeKind, at: AsOf): Tree {
  const n = ids.length
  const index = new Map<PositionId, number>()
  ids.forEach((id, k) => {
    if (k > 0 && compareId(ids[k - 1]!, id) >= 0) throw new EngineError('INVALID_INPUT', 'ids must come from positionOrder', { positionId: id })
    index.set(id, k)
  })
  const indexOf = (id: PositionId, role: string): number => {
    const k = index.get(id)
    if (k === undefined) throw new EngineError('TREE', `${kind} relationship names an unknown ${role}`, { positionId: id })
    return k
  }
  const parent = new Int32Array(n).fill(-1)
  const leg: (string | null)[] = new Array<string | null>(n).fill(null)
  for (const r of relationships) {
    if (r.kind !== kind || !isCurrent(r, at)) continue
    const child = indexOf(r.childPositionId, 'child')
    const p = indexOf(r.parentPositionId, 'parent')
    if (parent[child] !== -1) throw new EngineError('TREE', `position has two ${kind} parents at the evaluation instant`, { positionId: r.childPositionId })
    parent[child] = p
    leg[child] = r.leg
  }

  const childStart = new Int32Array(n + 1)
  for (let k = 0; k < n; k++) if (parent[k]! >= 0) childStart[parent[k]! + 1]!++
  for (let k = 0; k < n; k++) childStart[k + 1]! += childStart[k]!
  const fill = childStart.slice(0, n)
  const childList = new Int32Array(childStart[n]!)
  for (let k = 0; k < n; k++) if (parent[k]! >= 0) childList[fill[parent[k]!]!++] = k

  const bfs = new Int32Array(n)
  const depth = new Int32Array(n)
  let tail = 0
  for (let k = 0; k < n; k++) if (parent[k] === -1) bfs[tail++] = k
  for (let head = 0; head < tail; head++) {
    const k = bfs[head]!
    for (let c = childStart[k]!; c < childStart[k + 1]!; c++) {
      const child = childList[c]!
      depth[child] = depth[k]! + 1
      bfs[tail++] = child
    }
  }
  if (tail !== n) throw new EngineError('TREE', `${kind} tree has a cycle`, { unreachable: String(n - tail) })
  return { kind, ids, index, parent, leg, childStart, childList, depth, bfs }
}

/**
 * One reverse BFS pass (O(N)): out[k] = own[k] + sum of out[child] over children for which passUp(child)
 * holds (default: all, i.e. group volume). Generation volume passes `child is not a leader`.
 */
export function rollUp(tree: Tree, own: BigInt64Array, passUp: (k: number) => boolean = () => true): BigInt64Array {
  let magnitude = 0n
  for (const v of own) magnitude += v < 0n ? -v : v
  assertInt64(magnitude, 'sum of rolled-up values') // BigInt64Array would wrap silently past 2^63
  const out = own.slice()
  for (let i = tree.bfs.length - 1; i >= 0; i--) {
    const k = tree.bfs[i]!
    const p = tree.parent[k]!
    if (p >= 0 && passUp(k)) out[p]! += out[k]!
  }
  return out
}

/** Nearest ancestor satisfying `keep` (-1 = none), top-down, so compressed upline walks are O(levels). */
export function nearestAncestor(tree: Tree, keep: (k: number) => boolean): Int32Array {
  const out = new Int32Array(tree.ids.length)
  for (const k of tree.bfs) {
    const p = tree.parent[k]!
    out[k] = p < 0 ? -1 : keep(p) ? p : out[p]!
  }
  return out
}
