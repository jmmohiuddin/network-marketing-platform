'use client'

import { DataTable, type DataTableColumn } from '../../components/data-table'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { tableError, usePagedList } from '../admin/resource'
import { marketMoney } from '../periods/format'
import { INSTRUCTION_BADGES, INSTRUCTION_STATE_LABELS, lastErrorText, unconfiguredSetting } from './format'
import { BATCHES_PATH, DORMANT_PATH, type Batch, type BatchLine, type DormantBalance, type Exclusion, type Instruction } from './types'
import { MONO, PayeeLink, ReasonList } from './ui'

const amount = (minor: string, market: Market | undefined) => <span className="font-data-mono-md text-data-mono-md font-semibold whitespace-nowrap">{marketMoney(minor, market)}</span>

/** GET …/lines: the payees paid, at their full payable, to the bank-detail version pinned at preparation. */
export function IncludedTab({ batch, market }: { readonly batch: Batch; readonly market: Market | undefined }) {
  const list = usePagedList<BatchLine>(`${BATCHES_PATH}/${batch.id}/lines`)
  const columns: DataTableColumn<BatchLine>[] = [
    { key: 'payee', header: 'Payee', cell: (line) => <PayeeLink payee={line.participant} /> },
    { key: 'amount', header: 'Amount', align: 'end', cell: (line) => amount(line.amount_minor, market) },
    { key: 'account', header: 'Bank account', cell: (line) => <span className={MONO}>{line.bank_detail.masked}</span> },
  ]
  return (
    <DataTable bare stackOnPhone caption="Included payees" columns={columns} rows={list.rows} rowKey={(line) => line.participant.id} loading={list.loading}
      error={tableError(list)} pagination={list.pagination} empty={{ title: 'No payee is included: every payee with a payable balance is excluded.' }} />
  )
}

/** D-B4-12 exclusions with every reason in words; the payees keep their payable for a later batch. */
export function ExclusionsTab({ exclusions, market }: { readonly exclusions: readonly Exclusion[]; readonly market: Market | undefined }) {
  const columns: DataTableColumn<Exclusion>[] = [
    { key: 'payee', header: 'Payee', cell: (row) => <PayeeLink payee={row.participant} /> },
    { key: 'reasons', header: 'Why excluded', cell: (row) => <ReasonList reasons={row.reasons} market={market} /> },
  ]
  return <DataTable bare stackOnPhone caption="Excluded payees and holds" columns={columns} rows={exclusions} rowKey={(row) => row.participant.id} empty={{ title: 'No payee is excluded from this batch.' }} />
}

/** GET …/instructions: one signed instruction per line once approved, with its dispatch state. */
export function InstructionsTab({ batch, market }: { readonly batch: Batch; readonly market: Market | undefined }) {
  const list = usePagedList<Instruction>(`${BATCHES_PATH}/${batch.id}/instructions`)
  const columns: DataTableColumn<Instruction>[] = [
    { key: 'payee', header: 'Payee', cell: (i) => <PayeeLink payee={i.participant} /> },
    { key: 'amount', header: 'Amount', align: 'end', cell: (i) => amount(i.amount_minor, market) },
    { key: 'state', header: 'State', cell: (i) => <StatusBadge state={INSTRUCTION_BADGES[i.state]} label={INSTRUCTION_STATE_LABELS[i.state]} /> },
    { key: 'attempts', header: 'Attempts', align: 'end', cell: (i) => <span className={MONO}>{i.attempts}</span> },
    {
      key: 'error', header: 'Last error', cell: (i) => (
        <div className="flex flex-col">
          <span className="break-words">{lastErrorText(i.last_error)}</span>
          {i.next_attempt_at !== null && <span className="font-caption text-caption text-secondary">Next attempt {formatDateTime(i.next_attempt_at)}</span>}
        </div>
      ),
    },
    { key: 'ref', header: 'Provider reference', cell: (i) => <span className={`${MONO} break-all`}>{i.provider_ref ?? '—'}</span> },
    { key: 'updated', header: 'Updated', cell: (i) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(i.updated_at)}</span> },
  ]
  return (
    <DataTable bare stackOnPhone caption="Payout instructions" columns={columns} rows={list.rows} rowKey={(i) => i.id} loading={list.loading}
      error={tableError(list)} pagination={list.pagination} empty={{ title: 'No instruction yet: instructions are written when the batch is approved.' }} />
  )
}

/** GET /v1/payouts/dormant for the batch's market: payables older than the dormant setting with nothing settled since. */
export function DormantTab({ marketId, market }: { readonly marketId: string; readonly market: Market | undefined }) {
  const list = usePagedList<DormantBalance>(DORMANT_PATH, { market_id: marketId })
  const columns: DataTableColumn<DormantBalance>[] = [
    { key: 'payee', header: 'Payee', cell: (row) => <PayeeLink payee={row.participant} /> },
    { key: 'payable', header: 'Payable', align: 'end', cell: (row) => amount(row.payable_minor, market) },
    { key: 'since', header: 'Payable since', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.payable_since)}</span> },
    { key: 'settled', header: 'Last settled payment', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{row.last_settled_at === null ? 'Never' : formatDateTime(row.last_settled_at)}</span> },
  ]
  // An unset dormant setting is no failure a retry fixes: it is worded as the table's empty state, with no Try again.
  const unset = unconfiguredSetting(list.error)
  return (
    <DataTable bare stackOnPhone caption="Dormant balances" columns={columns} rows={list.rows} rowKey={(row) => row.participant.id} loading={list.loading}
      error={unset === null ? tableError(list) : null} pagination={list.pagination} empty={{ title: unset ?? 'No dormant balance in this market.' }} />
  )
}
