'use client'

import Link from 'next/link'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Select } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { ColumnChooser, ListExport, type ColumnOption } from '../views/list-tools'
import { SavedViewsBar, type SavedView } from '../views/saved-views'
import { useCursorPages } from '../../lib/cursor-pages'
import { formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid, shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { useRefLabel } from '../cases/refs'
import { marketAmount, marketMoney, periodText, reviewPath } from '../periods/format'
import { ACCOUNT_LABELS, accountLabel, eventLabel, ORIGIN_LABELS } from './format'
import type { LedgerTabProps, Money } from './ledger-page'
import type { AccountPosting, AccountType, EntryDetail, JournalEntry, LedgerAccount, PayeeRef, PeriodBounds } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const LINK = 'text-primary font-semibold hover:underline'
const ORIGIN_OPTIONS = [{ value: '', label: 'All origins' }, ...Object.entries(ORIGIN_LABELS).map(([value, label]) => ({ value, label }))]
const TYPE_OPTIONS = [{ value: '', label: 'All account types' }, ...Object.entries(ACCOUNT_LABELS).map(([value, label]) => ({ value, label }))]

/** PLAN B6 2.5 ledger-entry sorts and registry columns (the entry itself always shown, as the row's link). */
const SORT_OPTIONS = [{ value: 'posted_at_desc', label: 'Posted, newest first' }, { value: 'posted_at_asc', label: 'Posted, oldest first' }] as const
const COLUMN_OPTIONS: readonly ColumnOption[] = [
  { key: 'posted_at', label: 'Posted' }, { key: 'entry_id', label: 'Journal entry', required: true }, { key: 'market', label: 'Market' },
  { key: 'period', label: 'Period' }, { key: 'event_type', label: 'Event' }, { key: 'origin_type', label: 'Origin type' }, { key: 'origin_id', label: 'Origin' },
  { key: 'debit_total', label: 'Debits' }, { key: 'credit_total', label: 'Credits' }, { key: 'approval_id', label: 'Approved by' },
]
const DEFAULT_COLUMNS = ['entry_id', 'posted_at', 'event_type', 'origin_id', 'period', 'debit_total', 'approval_id']

/** The columns of ?columns= that the registry knows, with the entry first; the default set when none is valid. */
function columnsOf(param: string | null): readonly string[] {
  const chosen = COLUMN_OPTIONS.map((option) => option.key).filter((key) => (param ?? '').split(',').includes(key))
  if (chosen.length === 0) return DEFAULT_COLUMNS
  return ['entry_id', ...chosen.filter((key) => key !== 'entry_id')]
}

const amount = (minor: string, money: Money) => (minor === '0' ? '—' : marketAmount(minor, money))

/** Names an entry's period: from the market's periods (calendar zone), or its bounds in the viewer's zone without period.read. */
type PeriodLabel = (period: PeriodBounds) => string

function Payee({ payee }: { readonly payee: PayeeRef | null }) {
  if (payee === null) return <span className="font-caption text-caption text-secondary">Market account</span>
  return <Link className={LINK} href={`/people/${payee.id}`}>{payee.external_ref}{payee.display_name === null ? '' : ` · ${payee.display_name}`}</Link>
}

/** The object an entry came from: the run's review, the case, or the payout instruction's id. */
function Origin({ entry }: { readonly entry: { readonly origin_type: string; readonly origin_id: string; readonly period_id: string } }) {
  const { can } = useSession()
  const name = `${ORIGIN_LABELS[entry.origin_type] ?? entry.origin_type} ${shortId(entry.origin_id)}`
  if (entry.origin_type === 'run' && can('run.review')) return <Link className={`${MONO} ${LINK}`} href={reviewPath(entry.period_id, entry.origin_id)}>{name}</Link>
  if (entry.origin_type === 'case') return <Link className={`${MONO} ${LINK}`} href={`/cases/${entry.origin_id}`}>{name}</Link>
  return <span className={MONO}>{name}</span>
}

/** GET /v1/ledger/entries/:id: the entry, its approver and its postings (cursor pages of postings). */
function EntryDrawer({ entryId, money, periodLabel, onClose }: { readonly entryId: string; readonly money: Money; readonly periodLabel: PeriodLabel; readonly onClose: () => void }) {
  const pages = useCursorPages()
  const entry = useResource<EntryDetail>(`/v1/ledger/entries/${entryId}`, { cursor: pages.cursor })
  const nextCursor = typeof entry.meta.next_cursor === 'string' ? entry.meta.next_cursor : null
  const data = entry.data
  return (
    <Drawer open onClose={onClose} title={`Journal entry ${shortId(entryId)}`} icon="receipt_long" width="lg"
      description={data === null ? undefined : `${eventLabel(data.event_type)} · posted ${formatDateTime(data.posted_at)}`}>
      {entry.error !== null && <LoadFailure error={entry.error} onRetry={entry.reload} section />}
      {data === null && entry.error === null && <LoadingState label="Loading the entry" />}
      {data !== null && (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm" data-testid="entry-facts">
            <div><dt className="font-caption text-caption text-secondary uppercase">Origin</dt><dd><Origin entry={{ ...data, period_id: data.period.id }} /></dd></div>
            <div><dt className="font-caption text-caption text-secondary uppercase">Period</dt><dd>{periodLabel(data.period)}</dd></div>
            <div><dt className="font-caption text-caption text-secondary uppercase">Approved by</dt><dd>{data.approved_by?.display_name ?? (data.approved_by === null ? 'No approval (provider event)' : 'Another user')}</dd></div>
            <div><dt className="font-caption text-caption text-secondary uppercase">Idempotency key</dt><dd className={`${MONO} break-all`}>{data.idempotency_key}</dd></div>
          </dl>
          <DataTable
            bare
            density="compact"
            caption="Postings of the entry"
            columns={[
              { key: 'account', header: 'Account', cell: (row) => accountLabel(row.account.type) },
              { key: 'payee', header: 'Payee', cell: (row) => <Payee payee={row.payee} /> },
              { key: 'debit', header: `Debit (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{amount(row.debit_minor, money)}</span> },
              { key: 'credit', header: `Credit (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{amount(row.credit_minor, money)}</span> },
            ]}
            rows={data.postings}
            rowKey={(row) => row.id}
            loading={entry.loading}
            empty={{ title: 'No postings' }}
            pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }}
          />
        </>
      )}
    </Drawer>
  )
}

/**
 * Journal entries of the market filtered by period and origin (?period=&origin=), sorted (?sort=), with chosen columns
 * (?columns=), saved views (?view=) and the CSV export (ledger.export); ?entry= opens one.
 */
export function JournalTab({ marketId, money, periods, params, update, opening, entryId }: LedgerTabProps & { readonly entryId: string | null }) {
  const { can } = useSession()
  // A valid ?period= is always sent: a saved or shared view's period may be outside the loaded list (the newest 200, none
  // without period.read), and dropping it would list every period's entries under the view's name.
  const periodParam = params.get('period') ?? ''
  const period = isUuid(periodParam) ? periodParam : ''
  const chosen = period === '' ? undefined : { id: period, label: periods.find((choice) => choice.id === period)?.label ?? `Period ${shortId(period)}` }
  const periodOptions = [{ value: '', label: 'All periods' }, ...(chosen !== undefined && !periods.some((choice) => choice.id === period) ? [{ value: chosen.id, label: chosen.label }] : []),
    ...periods.map((choice) => ({ value: choice.id, label: choice.label }))]
  const origin = ORIGIN_OPTIONS.find((option) => option.value !== '' && option.value === params.get('origin'))?.value ?? ''
  const sort = SORT_OPTIONS.find((option) => option.value === params.get('sort'))?.value ?? SORT_OPTIONS[0].value
  const columns = columnsOf(params.get('columns'))
  const filters = { market_id: marketId, period_id: period || undefined, origin_type: origin || undefined }
  const query = { ...filters, sort }
  const periodLabel: PeriodLabel = (bounds) => periods.find((choice) => choice.id === bounds.id)?.label ?? periodText(bounds, undefined)
  const change = (changes: Readonly<Record<string, string | null>>) => update({ ...changes, view: null })
  const chips: FilterChip[] = [
    ...(chosen === undefined ? [] : [{ key: 'period', label: `Period: ${chosen.label}`, onRemove: () => change({ period: null }) }]),
    ...(origin === '' ? [] : [{ key: 'origin', label: `Origin: ${ORIGIN_LABELS[origin]}`, onRemove: () => change({ origin: null }) }]),
  ]
  const apply = (view: SavedView) => update({
    market: typeof view.filters.market_id === 'string' ? view.filters.market_id : marketId,
    period: typeof view.filters.period_id === 'string' ? view.filters.period_id : null,
    origin: typeof view.filters.origin_type === 'string' ? view.filters.origin_type : null,
    sort: view.sort, columns: view.columns.join(','), view: view.id, entry: null,
  })
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-space-sm">
        <SavedViewsBar list="ledger_entries" current={{ filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)), columns, sort }}
          activeId={params.get('view')} applyDefault={opening} onApply={apply} />
        <div className="flex flex-wrap items-end gap-space-xs">
          <div className="w-56"><Select label="Sort" value={sort} options={SORT_OPTIONS} onChange={(event) => change({ sort: event.target.value })} /></div>
          <ColumnChooser options={COLUMN_OPTIONS} selected={columns} onApply={(next) => change({ columns: next.join(',') })} />
          {can('ledger.export') && <ListExport label="Export CSV" path="/v1/ledger/entries/export" query={{ ...query, columns: columns.join(',') }} filename="ledger-entries.csv" />}
        </div>
      </div>
      <FiltersBar label="Filter journal entries" chips={chips} onClear={() => change({ period: null, origin: null })}>
        {periods.length > 0 && <Select label="Period" value={period} options={periodOptions} onChange={(event) => change({ period: event.target.value })} />}
        <Select label="Origin" value={origin} options={ORIGIN_OPTIONS} onChange={(event) => change({ origin: event.target.value })} />
        {!can('period.read') && <p className="font-caption text-caption text-secondary">Filtering by period needs read access to periods.</p>}
      </FiltersBar>
      <EntriesTable key={JSON.stringify(query)} query={query} columns={columns} money={money} periodLabel={periodLabel} onOpen={(id) => update({ entry: id })} />
      {entryId !== null && <EntryDrawer entryId={entryId} money={money} periodLabel={periodLabel} onClose={() => update({ entry: null })} />}
    </>
  )
}

function EntriesTable({ query, columns, money, periodLabel, onOpen }: {
  readonly query: Readonly<Record<string, string | undefined>>
  readonly columns: readonly string[]
  readonly money: Money
  readonly periodLabel: PeriodLabel
  readonly onOpen: (id: string) => void
}) {
  const list = usePagedList<JournalEntry>('/v1/ledger/entries', query)
  const cells: Readonly<Record<string, DataTableColumn<JournalEntry>>> = {
    entry_id: {
      key: 'entry_id', header: 'Journal entry', cell: (row) => (
        <button type="button" className={`${MONO} ${LINK} text-left`} aria-label={`Open journal entry ${shortId(row.id)}`} onClick={() => onOpen(row.id)}>{shortId(row.id)}</button>
      ),
    },
    posted_at: { key: 'posted_at', header: 'Posted', cell: (row) => <span className={`${MONO} text-secondary whitespace-nowrap`}>{formatDateTime(row.posted_at)}</span> },
    market: { key: 'market', header: 'Market', cell: (row) => row.market.code },
    period: { key: 'period', header: 'Period', cell: (row) => <span className="whitespace-nowrap">{periodLabel(row.period)}</span> },
    event_type: { key: 'event_type', header: 'Event', cell: (row) => eventLabel(row.event_type) },
    origin_type: { key: 'origin_type', header: 'Origin type', cell: (row) => ORIGIN_LABELS[row.origin_type] ?? row.origin_type },
    origin_id: { key: 'origin_id', header: 'Origin', cell: (row) => <Origin entry={{ ...row, period_id: row.period.id }} /> },
    debit_total: { key: 'debit_total', header: `Debits (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{marketAmount(row.debit_total_minor, money)}</span> },
    credit_total: { key: 'credit_total', header: `Credits (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{marketAmount(row.credit_total_minor, money)}</span> },
    approval_id: { key: 'approval_id', header: 'Approved by', cell: (row) => row.approved_by?.display_name ?? (row.approved_by === null ? '—' : 'Another user') },
  }
  return (
    <DataTable caption="Journal entries" columns={columns.flatMap((key) => cells[key] ?? [])} rows={list.rows} rowKey={(row) => row.id} loading={list.loading} error={tableError(list)}
      empty={{ title: 'No journal entry yet: entries are posted when a run is committed, a payout moves or a write-off is approved' }} pagination={list.pagination} stackOnPhone />
  )
}

/**
 * GET /v1/ledger/accounts/:id/postings, newest first, opened from the id alone (a shared ?account= link). Type, balance and
 * payee come from the account's row when it is on the loaded page of the Accounts table.
 * shortcut: no GET /v1/ledger/accounts/:id, so an account off the loaded page shows its postings under a generic title; add the read when one exists.
 */
function AccountDrawer({ accountId, account, money, onClose }: { readonly accountId: string; readonly account: LedgerAccount | undefined; readonly money: Money; readonly onClose: () => void }) {
  const list = usePagedList<AccountPosting>(`/v1/ledger/accounts/${accountId}/postings`)
  const name = account === undefined ? `Ledger account ${shortId(accountId)}` : accountLabel(account.type)
  return (
    <Drawer open onClose={onClose} title={name} icon="account_balance" width="lg"
      description={account === undefined ? undefined : `Balance ${marketMoney(account.balance_minor, money)}${account.gl_code === null ? '' : ` · GL ${account.gl_code}`}`}>
      {account?.payee != null && <p>Payee: <Payee payee={account.payee} /></p>}
      <DataTable
        bare
        density="compact"
        caption={`Postings of ${name}`}
        columns={[
          { key: 'posted', header: 'Posted', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.entry.posted_at)}</span> },
          { key: 'event', header: 'Entry', cell: (row) => <span className="flex flex-col"><span>{eventLabel(row.entry.event_type)}</span><Origin entry={row.entry} /></span> },
          { key: 'debit', header: `Debit (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{amount(row.debit_minor, money)}</span> },
          { key: 'credit', header: `Credit (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{amount(row.credit_minor, money)}</span> },
        ]}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: 'No postings on this account' }}
        pagination={list.pagination}
      />
    </Drawer>
  )
}

/** Accounts of the market with their summed balances (?type= and ?payee= filters); ?account= opens its postings. */
export function AccountsTab({ marketId, money, params, update, accountId }: LedgerTabProps & { readonly accountId: string | null }) {
  const type = TYPE_OPTIONS.find((option) => option.value !== '' && option.value === params.get('type'))?.value as AccountType | undefined
  const payeeParam = params.get('payee')
  const payee = payeeParam !== null && isUuid(payeeParam) ? payeeParam : undefined
  const query = { market_id: marketId, type, payee_participant_id: payee }
  const payeeName = useRefLabel('participant', payee ?? null)
  const chips: FilterChip[] = [
    ...(type === undefined ? [] : [{ key: 'type', label: `Type: ${ACCOUNT_LABELS[type]}`, onRemove: () => update({ type: null }) }]),
    ...(payee === undefined ? [] : [{ key: 'payee', label: `Payee: ${payeeName}`, onRemove: () => update({ payee: null }) }]),
  ]
  return (
    <>
      <FiltersBar label="Filter accounts" chips={chips} onClear={() => update({ type: null, payee: null })}>
        <Select label="Account type" value={type ?? ''} options={TYPE_OPTIONS} onChange={(event) => update({ type: event.target.value })} />
      </FiltersBar>
      <AccountsTable key={JSON.stringify(query)} query={query} money={money} accountId={accountId} update={update} />
    </>
  )
}

function AccountsTable({ query, money, accountId, update }: { readonly query: Readonly<Record<string, string | undefined>>; readonly money: Money; readonly accountId: string | null; readonly update: LedgerTabProps['update'] }) {
  const list = usePagedList<LedgerAccount>('/v1/ledger/accounts', query)
  const open = list.rows.find((row) => row.id === accountId)
  const columns: readonly DataTableColumn<LedgerAccount>[] = [
    {
      key: 'account', header: 'Account', cell: (row) => (
        <button type="button" className={`${LINK} text-left`} aria-label={`Open postings of ${accountLabel(row.type)}${row.payee === null ? '' : ` of ${row.payee.external_ref}`}`} onClick={() => update({ account: row.id })}>
          {accountLabel(row.type)}
        </button>
      ),
    },
    { key: 'payee', header: 'Payee', cell: (row) => <Payee payee={row.payee} /> },
    { key: 'gl', header: 'GL code', cell: (row) => <span className={MONO}>{row.gl_code ?? 'Not mapped'}</span> },
    { key: 'debit', header: `Debits (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{marketAmount(row.debit_minor, money)}</span> },
    { key: 'credit', header: `Credits (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{marketAmount(row.credit_minor, money)}</span> },
    { key: 'balance', header: `Balance (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap font-semibold">{marketAmount(row.balance_minor, money)}</span> },
  ]
  return (
    <>
      <DataTable caption="Ledger accounts" columns={columns} rows={list.rows} rowKey={(row) => row.id} loading={list.loading} error={tableError(list)} selectedKey={accountId ?? undefined}
        empty={{ title: 'No account yet: accounts open with their first posting' }} pagination={list.pagination} stackOnPhone />
      {accountId !== null && <AccountDrawer accountId={accountId} account={open} money={money} onClose={() => update({ account: null })} />}
    </>
  )
}
