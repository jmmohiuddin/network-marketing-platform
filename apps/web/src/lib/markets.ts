export type MarketState = 'draft' | 'live' | 'suspended'

/** GET /v1/markets: the markets of the signed-in user's tenant, ordered by code. */
export interface Market {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly currency: string
  readonly state: MarketState
  readonly market_pack: string
  readonly time_zone: string
  readonly languages: readonly string[]
  readonly minor_unit: number
}

/** The market a snapshot or batch names. */
export type MarketRef = Pick<Market, 'id' | 'code' | 'name'>

export const MARKETS_PATH = '/v1/markets'

/** "Germany (DE)"; a code with no country name (the API then names it by its code) shows once: "DEMO". */
export function marketName(market: Pick<Market, 'code' | 'name'>): string {
  return market.name === market.code ? market.code : `${market.name} (${market.code})`
}
