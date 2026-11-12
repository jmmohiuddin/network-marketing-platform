/** In-memory genealogy for runs (SDD-08 §5, TR-GEN-03): flat typed arrays, built once, no recursion. */

export interface Tree {
  n: number
  root: number
  parent: Int32Array // -1 for the root
  firstChild: Int32Array // -1 = leaf
  nextSibling: Int32Array // -1 = last child
  depth: Int32Array
  order: Int32Array // BFS: every parent before its children; reverse it for bottom-up passes
}

/** Children are linked in ascending index order. Throws unless parent[] describes exactly one tree. */
export function buildTree(parent: Int32Array): Tree {
  const n = parent.length
  const firstChild = new Int32Array(n).fill(-1)
  const nextSibling = new Int32Array(n).fill(-1)
  let root = -1
  for (let i = n - 1; i >= 0; i--) {
    const p = parent[i]!
    if (p < 0) {
      if (root >= 0) throw new Error(`two roots: ${root} and ${i}`)
      root = i
      continue
    }
    if (p >= n) throw new Error(`position ${i} has parent ${p} out of range`)
    nextSibling[i] = firstChild[p]!
    firstChild[p] = i
  }
  if (root < 0) throw new Error('no root')
  const depth = new Int32Array(n)
  const order = new Int32Array(n)
  order[0] = root
  let head = 0
  let tail = 1
  while (head < tail) {
    const u = order[head++]!
    for (let c = firstChild[u]!; c >= 0; c = nextSibling[c]!) {
      depth[c] = depth[u]! + 1
      order[tail++] = c
    }
  }
  if (tail !== n) throw new Error(`${n - tail} positions unreachable from the root (cycle or orphan)`)
  return { n, root, parent, firstChild, nextSibling, depth, order }
}

/** Group volume = own + all descendants, in one reverse pass (O(N)). Volumes are bigint minor units. */
export function rollUp(t: Tree, personal: BigInt64Array): BigInt64Array {
  const group = personal.slice()
  for (let k = t.n - 1; k > 0; k--) {
    const c = t.order[k]!
    group[t.parent[c]!]! += group[c]!
  }
  return group
}

export function subtreeSizes(t: Tree): Int32Array {
  const size = new Int32Array(t.n).fill(1)
  for (let k = t.n - 1; k > 0; k--) {
    const c = t.order[k]!
    size[t.parent[c]!]! += size[c]!
  }
  return size
}

/** Writes up to maxLevels ancestors of node (nearest first) into out; returns how many. */
export function upline(t: Tree, node: number, out: Int32Array, maxLevels = out.length): number {
  let k = 0
  for (let p = t.parent[node]!; p >= 0 && k < maxLevels; p = t.parent[p]!) out[k++] = p
  return k
}

export function isAncestor(t: Tree, ancestor: number, node: number): boolean {
  for (let p = t.parent[node]!; p >= 0; p = t.parent[p]!) if (p === ancestor) return true
  return false
}
