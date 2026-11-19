'use client'

import { MARKETS_PATH, type Market } from '../../../lib/markets'
import { useResource } from '../../../lib/use-resource'
import { valueText } from './labels'

/** A setting value in words; the per-market payout policy is named with each market's code and currency (BUG-106). */
export function PolicyValue({ name, value }: { readonly name: string; readonly value: unknown }) {
  const markets = useResource<readonly Market[]>(name === 'payouts.market_policy' ? MARKETS_PATH : null)
  return <>{valueText(name, value, markets.data ?? undefined)}</>
}
