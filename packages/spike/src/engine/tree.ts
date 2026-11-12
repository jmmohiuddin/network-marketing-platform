import type { Snapshot } from './types.js'

/** Canonical tree: positions indexed by ascending id, parent links, children (CSR) and a BFS order. */
export interface Tree {
  ids: Int32Array // ascending
  parent: Int32Array // index, -1 for roots
  childStart: Int32Array // children of k are childList[childStart[k] .. childStart[k + 1])
  childList: Int32Array
  bfs: Int32Array // parents before children; reverse it for bottom-up passes
  lineIndex: Int32Array // position index per snapshot line
}

function indexOf(ids: Int32Array, id: number): number {
  let lo = 0
  let hi = ids.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const v = ids[mid]!
    if (v === id) return mid
    if (v < id) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/** Input order never matters: everything is keyed by position id (determinism, SDD-07 §2). */
export function buildTree(s: Snapshot): Tree {
  const n = s.positionId.length
  if (s.sponsorId.length !== n) throw new Error('sponsorId must align with positionId')
  const ids = Int32Array.from(s.positionId).sort()
  for (let k = 0; k < n; k++) {
    if (ids[k]! <= 0) throw new Error(`position id must be > 0, got ${ids[k]}`)
    if (k > 0 && ids[k] === ids[k - 1]) throw new Error(`duplicate position id ${ids[k]}`)
  }
  const parent = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const sponsor = s.sponsorId[i]!
    if (sponsor === 0) continue
    const p = indexOf(ids, sponsor)
    if (p < 0) throw new Error(`position ${s.positionId[i]} has unknown sponsor ${sponsor}`)
    parent[indexOf(ids, s.positionId[i]!)] = p
  }
  const childStart = new Int32Array(n + 1)
  for (let k = 0; k < n; k++) if (parent[k]! >= 0) childStart[parent[k]! + 1]!++
  for (let k = 0; k < n; k++) childStart[k + 1]! += childStart[k]!
  const fill = childStart.slice(0, n)
  const childList = new Int32Array(childStart[n]!)
  for (let k = 0; k < n; k++) if (parent[k]! >= 0) childList[fill[parent[k]!]!++] = k

  const bfs = new Int32Array(n)
  let tail = 0
  for (let k = 0; k < n; k++) if (parent[k] === -1) bfs[tail++] = k
  for (let head = 0; head < tail; head++) {
    const k = bfs[head]!
    for (let c = childStart[k]!; c < childStart[k + 1]!; c++) bfs[tail++] = childList[c]!
  }
  if (tail !== n) throw new Error(`sponsor tree has a cycle: ${n - tail} positions unreachable from a root`)

  const lineCount = s.linePositionId.length
  const lineIndex = new Int32Array(lineCount)
  for (let l = 0; l < lineCount; l++) {
    const k = indexOf(ids, s.linePositionId[l]!)
    if (k < 0) throw new Error(`order line ${l} credits unknown position ${s.linePositionId[l]}`)
    lineIndex[l] = k
  }
  return { ids, parent, childStart, childList, bfs, lineIndex }
}
