import type { Tx } from '@nmp/db'

export interface MarketView {
  id: string
  code: string
  name: string
  currency: string
}

// Provisioning takes ISO 3166-1 alpha-2 market codes (ops routes); the market table has no name column (DATABASE.md).
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

/** The English name of a market's country or region; the code itself when it is not an ISO region code. */
export function marketName(code: string): string {
  try {
    return REGION_NAMES.of(code) ?? code
  } catch {
    return code // RangeError: not a well-formed region code (only rows written outside provisioning)
  }
}

/** The caller's tenant's markets (RLS), ordered by code. */
export async function listMarkets(tx: Tx): Promise<MarketView[]> {
  const { rows } = await tx.query<Omit<MarketView, 'name'>>('SELECT id, code, currency FROM market ORDER BY code')
  return rows.map((row) => ({ id: row.id, code: row.code, name: marketName(row.code), currency: row.currency }))
}
