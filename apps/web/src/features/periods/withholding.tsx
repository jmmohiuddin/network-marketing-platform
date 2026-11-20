'use client'

import { LoadingState } from '../../components/states'
import type { Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { TaxLines } from '../tax/lines-tab'
import type { TaxRules } from '../tax/types'

/** SC-12 Withholding lines of one run: the tax page's lines tab with the period and run chosen. */
export const withholdingLinesPath = (marketId: string, periodId: string, runId: string): string =>
  `/tax?${new URLSearchParams({ market: marketId, tab: 'lines', period: periodId, run: runId }).toString()}`

/**
 * SC-02 Withholding tab (PLAN B-MKT §5, BUG-131): per payee the statement's withholding row (rule, rate, basis note,
 * taxable and withheld) from GET /v1/tax/lines, with the market pack's rule titles.
 */
export function WithholdingTab({ market, runId }: { readonly market: Market; readonly runId: string }) {
  const rules = useResource<TaxRules>('/v1/tax/rules', { market_id: market.id })
  return (
    <section className="bg-surface-container-lowest p-space-md rounded-lg shadow-sm flex flex-col gap-space-sm" aria-labelledby="withholding-title">
      <h2 id="withholding-title" className="font-section-heading text-section-heading text-on-surface font-bold">Withholding by payee</h2>
      {rules.error !== null ? <LoadFailure error={rules.error} onRetry={rules.reload} section />
        : rules.data === null ? <LoadingState label="Loading the withholding rules" />
          : <TaxLines runId={runId} market={market} rules={rules.data.withholding} />}
    </section>
  )
}
