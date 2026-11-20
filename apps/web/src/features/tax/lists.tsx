'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { DataTable } from '../../components/data-table'
import { countLabel, formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { tableError } from '../admin/resource'
import { MONO, NOTE } from '../admin/ui'
import { marketMoney } from '../periods/format'
import type { TaxTabProps } from './tax-page'
import type { Generation, YearEnd, YearEndPayee } from './types'

/** The API's page size limit. */
const PAGE_SIZE = 50
/** shortcut: reads at most 20 pages (1,000 payees) of the preview; add a server filter for held payees when a market has more. */
const MAX_PAGES = 20

const taxLink = (participant: { readonly id: string; readonly external_ref: string }) => (
  <Link className={`${MONO} text-primary font-semibold hover:underline`} href={`/people/${participant.id}?tab=tax`}>{participant.external_ref}</Link>
)

interface Held {
  readonly rows: readonly YearEndPayee[]
  readonly error: unknown
  readonly loading: boolean
  readonly truncated: boolean
}

/** The included payees without a tax id: the year-end preview read page by page (the API has no filter for them). */
function useHeldPayees(marketId: string, taxYear: number, round: number): Held {
  const api = useApi()
  const [held, setHeld] = useState<Held>({ rows: [], error: null, loading: true, truncated: false })
  useEffect(() => {
    const controller = new AbortController()
    async function read() {
      let rows: readonly YearEndPayee[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await api.get<YearEnd>('/v1/tax/year-end', { query: { market_id: marketId, tax_year: taxYear, cursor, limit: PAGE_SIZE }, signal: controller.signal })
        rows = [...rows, ...answer.data.payees.filter((payee) => payee.included && payee.tax_id === 'missing')]
        cursor = typeof answer.meta.next_cursor === 'string' ? answer.meta.next_cursor : undefined
        if (cursor === undefined) return { rows, truncated: false }
      }
      return { rows, truncated: true }
    }
    setHeld({ rows: [], error: null, loading: true, truncated: false })
    read().then(
      (result) => setHeld({ ...result, error: null, loading: false }),
      (error: unknown) => {
        if (!controller.signal.aborted) setHeld({ rows: [], error, loading: false, truncated: false })
      },
    )
    return () => controller.abort()
  }, [api, marketId, taxYear, round])
  return held
}

/** SC-12 Missing tax ids: included payees held for a missing tax id, each linking to its tax profile (SC-09). */
export function MissingTab({ market, taxYear }: TaxTabProps) {
  const [round, setRound] = useState(0)
  const held = useHeldPayees(market.id, taxYear, round)
  return (
    <div className="flex flex-col gap-space-md">
      <p className={NOTE}>
        {held.loading ? 'Reading the payees of the tax year.' : `${countLabel(held.rows.length, 'payee')} of tax year ${taxYear} without a tax id: no statement until one is recorded on the participant's Tax tab.`}
      </p>
      {held.truncated && <Banner tone="warning" title="Not every payee was read">Only the first {MAX_PAGES * PAGE_SIZE} payees of the tax year were checked.</Banner>}
      <DataTable
        caption={`Payees of tax year ${taxYear} without a tax id`}
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => taxLink(row.participant) },
          { key: 'gross', header: `Gross (${market.currency})`, align: 'end', cell: (row) => <span className={MONO}>{marketMoney(row.gross_minor, market)}</span> },
          { key: 'withheld', header: `Withheld (${market.currency})`, align: 'end', cell: (row) => <span className={MONO}>{marketMoney(row.withheld_minor, market)}</span> },
        ]}
        rows={held.rows}
        rowKey={(row) => row.participant.id}
        loading={held.loading}
        error={held.error === null ? null : { message: errorMessage(held.error), onRetry: () => setRound((value) => value + 1) }}
        empty={{ title: 'Every included payee has a tax id.' }}
        stackOnPhone
      />
    </div>
  )
}

/** SC-12 History: the generations of the tax year, newest first (GET /v1/tax/year-end-generations). */
export function HistoryTab({ market, taxYear }: TaxTabProps) {
  const generations = useResource<Generation[]>('/v1/tax/year-end-generations', { market_id: market.id, tax_year: taxYear })
  return (
    <div className="flex flex-col gap-space-md">
      <p className={NOTE}>Each generation keeps earlier statement versions; payees whose totals did not change are counted as unchanged.</p>
      <DataTable
        caption={`Statement generations of tax year ${taxYear}`}
        columns={[
          { key: 'at', header: 'Generated', cell: (row) => <span className="flex flex-col"><span>{formatDateTime(row.created_at)}</span><span className="font-caption text-caption text-secondary">By {row.created_by.display_name ?? 'another user'}</span></span> },
          { key: 'form', header: 'Statement', cell: (row) => <span className={MONO}>{row.form_type}</span> },
          { key: 'generated', header: 'New versions', align: 'end', cell: (row) => String(row.generated) },
          { key: 'unchanged', header: 'Unchanged', align: 'end', cell: (row) => String(row.unchanged) },
          { key: 'held', header: 'Held: missing tax id', cell: (row) => (row.held.length === 0 ? '—' : <span className="flex flex-wrap gap-x-space-xs">{row.held.map((held) => <span key={held.participant_id}>{taxLink({ id: held.participant_id, external_ref: held.external_ref })}</span>)}</span>) },
          { key: 'withheld', header: `Withheld (${market.currency})`, align: 'end', cell: (row) => <span className={MONO}>{marketMoney(row.withheld_total_minor, market)}</span> },
        ]}
        rows={generations.data ?? []}
        rowKey={(row) => row.id}
        loading={generations.loading}
        error={tableError(generations)}
        empty={{ title: 'No statements were generated for this tax year yet.' }}
        stackOnPhone
      />
    </div>
  )
}
