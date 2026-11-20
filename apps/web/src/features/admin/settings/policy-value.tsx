'use client'

import { MARKETS_PATH, type Market } from '../../../lib/markets'
import { useResource } from '../../../lib/use-resource'
import { valueText } from './labels'

// Values keyed by market id: named with each market's code (and currency) once the markets are read.
const PER_MARKET_KEYS: readonly string[] = ['payouts.market_policy', 'disputes.policy', 'privacy.policy', 'plan.filing_requirements']

/** A setting value in words; per-market values are named with each market's code and currency (BUG-106). */
export function PolicyValue({ name, value }: { readonly name: string; readonly value: unknown }) {
  const markets = useResource<readonly Market[]>(PER_MARKET_KEYS.includes(name) ? MARKETS_PATH : null)
  return <>{valueText(name, value, markets.data ?? undefined)}</>
}
