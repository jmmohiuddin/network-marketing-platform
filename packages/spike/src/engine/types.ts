// Spike engine input/output shapes. Columnar typed arrays: a 2M-position snapshot as objects would
// cost several GB of heap; a real snapshot loader (spike item 8) would fill arrays like these.

/** Tree + order lines for one period, in any order. Volumes and prices in minor units. */
export interface Snapshot {
  positionId: Int32Array // unique, > 0
  sponsorId: Int32Array // aligned with positionId; 0 = root
  linePositionId: Int32Array // position credited with the line (buyer, or servicing position for customer orders)
  lineCustomer: Uint8Array // 1 = serviced customer's order (retail base), 0 = own order
  lineQv: BigInt64Array // qualifying volume -> PV
  lineCv: BigInt64Array // commissionable volume -> CV
  linePrice: BigInt64Array // net sale value -> retail base and net sales
}

export type BonusKey = 'retail' | 'unilevel' | 'rank_bonus' | 'generation' | 'matching'
/** Fixed bonus order: pass order, and the order of lines per payee in the hash. */
export const BONUSES: readonly BonusKey[] = ['retail', 'unilevel', 'rank_bonus', 'generation', 'matching']

/** Rank index = position in Plan.ranks + 1; 0 = unranked. A rank holds when every stated requirement holds. */
export interface RankRule {
  key: string
  pvGte?: bigint
  gvGte?: bigint
  maxLegPct?: string // leg rule: each direct leg counts toward gvGte at most this share of gvGte
  legs?: { rank: number; count: number } // at least `count` direct legs holding a position of rank >= `rank`
}

export interface Plan {
  ranks: RankRule[]
  retail?: { rate: string }
  unilevel?: { measure: 'pv' | 'cv'; rates: string[]; compression: 'dynamic' | 'none'; requiresRank: number }
  rankBonus?: { byRank: string[] } // rate on GV, indexed by paid-as rank (index 0 = unranked)
  generation?: { leaderRank: number; rates: string[] } // rate on generation volume, per generation of leaders
  matching?: { of: BonusKey[]; rates: string[] } // rate per sponsor generation on the named bonuses (pre-cap)
  perPayeeCap?: Partial<Record<BonusKey, bigint>> // per-participant constraint, minor units (pass 7)
  companyCap?: { scope: BonusKey[]; rate: string; priority?: BonusKey[] } // base = net sales; no priority = proportional
}

export interface RunResult {
  positionId: Int32Array // ascending
  pv: BigInt64Array
  gv: BigInt64Array
  rank: Uint8Array
  amounts: Record<BonusKey, BigInt64Array> // final minor units per position, aligned with positionId
  netSalesMinor: bigint
  capMinor: bigint | null // set when the company cap bound
  totalMinor: bigint
  lineCount: number
  linesHash: string // sha256 of (id, bonus, amount) for non-zero lines, id asc then bonus order
  summaryHash: string // sha256 of (id, pv, gv, rank) for every position
  timingsMs: Record<string, number>
}
