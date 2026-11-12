import type { BonusKey, RunResult, Snapshot } from '../../src/engine/types.js'

export interface Line { pos: number; qv?: number; cv?: number; price?: number; customer?: boolean }

/** Small snapshot from [id, sponsor] pairs and lines; amounts in major units (2 dp) for readability. */
export function snap(tree: [number, number][], lines: Line[]): Snapshot {
  const minor = (x: number | undefined): bigint => BigInt(Math.round((x ?? 0) * 100))
  return {
    positionId: Int32Array.from(tree.map(([id]) => id)),
    sponsorId: Int32Array.from(tree.map(([, s]) => s)),
    linePositionId: Int32Array.from(lines.map((l) => l.pos)),
    lineCustomer: Uint8Array.from(lines.map((l) => (l.customer ? 1 : 0))),
    lineQv: BigInt64Array.from(lines.map((l) => minor(l.qv))),
    lineCv: BigInt64Array.from(lines.map((l) => minor(l.cv))),
    linePrice: BigInt64Array.from(lines.map((l) => minor(l.price))),
  }
}

/** Non-zero amounts of one bonus by position id, as 2-dp strings. */
export function byId(r: RunResult, b: BonusKey): Record<number, string> {
  const out: Record<number, string> = {}
  r.positionId.forEach((id, k) => {
    const a = r.amounts[b][k]!
    if (a !== 0n) out[id] = fmt(a)
  })
  return out
}

export function fmt(minor: bigint): string {
  const s = minor.toString().padStart(3, '0')
  return `${s.slice(0, -2)}.${s.slice(-2)}`
}

