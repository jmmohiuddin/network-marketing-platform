'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { FileDropZone } from '../../components/file-drop-zone'
import { Select } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
import { countLabel, formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { isUuid, shortId } from '../admin/format'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import type { ProviderRecord } from '../markets/types'
import { useQueryParams } from '../people/url'
import { marketMoney } from '../periods/format'
import {
  accountText, batchPath, EVENT_LABELS, EXCEPTION_KIND_LABELS, INSTRUCTION_BADGES, INSTRUCTION_STATE_LABELS, INSTRUCTION_STATES, lastErrorText, payeeText,
} from './format'
import {
  EXCEPTIONS_PATH, ITEMS_PATH, PROVIDERS_PATH, SUMMARY_PATH, type ImportResult, type LedgerEntry, type PayoutException,
  type ProviderSummary, type ReconciliationItem,
} from './types'
import { LABEL, LINK, MONO, PayeeLink, RegisterCard, useMarkets } from './ui'

// PLAN B4 2.3: the API takes result files up to 5 MB.
const REPORT_MAX_BYTES = 5 * 1024 * 1024
const NOTE_MAX = 1000

type Markets = ReadonlyMap<string, Market>

function ProviderKpis({ provider, markets }: { readonly provider: ProviderSummary; readonly markets: Markets }) {
  const market = markets.get(provider.market_id)
  const money = (minor: string) => marketMoney(minor, market)
  return (
    <section aria-labelledby={`provider-${provider.id}`} className="flex flex-col gap-space-xs">
      <h2 id={`provider-${provider.id}`} className="font-section-heading text-section-heading text-on-surface">{provider.provider} · {market?.code ?? '—'}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md" data-testid="kpis">
        <KpiCard label="In transit" icon="sync_alt" value={money(provider.in_transit.amount_minor)} detail={countLabel(provider.in_transit.count, 'instruction')} />
        <KpiCard label="Settled" icon="check_circle" value={money(provider.settled.amount_minor)} detail={countLabel(provider.settled.count, 'instruction')} />
        <KpiCard label="Returned" icon="undo" value={money(provider.returned.amount_minor)} detail={`${countLabel(provider.returned.count, 'instruction')}, back in payable`} />
        <KpiCard label="Open exceptions" icon="report" value={provider.open_exceptions.toLocaleString()} detail={`${countLabel(provider.failed.count, 'failed instruction')}`} />
      </div>
    </section>
  )
}

type Chip = { readonly value: string | null; readonly label: string }

const INSTRUCTION_CHIPS: readonly Chip[] = [
  { value: null, label: 'All' },
  ...INSTRUCTION_STATES.filter((state) => state !== 'cancelled').map((state) => ({ value: state, label: INSTRUCTION_STATE_LABELS[state] })),
]
// Open exceptions first by default: the API pages them by id, so resolved ones would mix in at random.
const EXCEPTION_FILTERS = ['resolved', 'all'] as const
const EXCEPTION_CHIPS: readonly Chip[] = [{ value: null, label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }]

/** sc_30-style chips: one state at a time (the API filters by one state); the first chip clears the URL parameter. */
function StateChips({ label, chips, value, onChange }: { readonly label: string; readonly chips: readonly Chip[]; readonly value: string | null; readonly onChange: (value: string | null) => void }) {
  const chip = (selected: boolean) => `inline-flex items-center px-2 py-0.5 rounded font-caption text-caption focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? 'bg-primary text-on-primary font-semibold' : 'bg-surface-container-high text-on-surface hover:bg-surface-container'}`
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-space-xs px-space-md py-space-sm border-b border-surface-container">
      <span className="font-caption text-caption text-on-surface-variant uppercase font-semibold">State:</span>
      {chips.map((c) => (
        <button key={c.label} type="button" className={chip(value === c.value)} aria-pressed={value === c.value} onClick={() => onChange(c.value)}>{c.label}</button>
      ))}
    </div>
  )
}

/** One journal entry of the instruction with its postings (GET /v1/ledger/entries/:id). */
function EntryPostings({ entry, market }: { readonly entry: LedgerEntry; readonly market: Market | undefined }) {
  const detail = useResource<LedgerEntry>(`/v1/ledger/entries/${entry.id}`)
  return (
    <li className="bg-surface p-space-sm rounded flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-space-sm">
        <span className="font-body-sm text-body-sm font-semibold text-on-surface">{entry.event_type.replaceAll('_', ' ')}</span>
        <span className={`${MONO} text-secondary`}>{formatDateTime(entry.posted_at)}</span>
      </div>
      {detail.error !== null && <LoadFailure error={detail.error} onRetry={detail.reload} section />}
      {detail.data?.postings?.map((posting) => (
        <div key={posting.id} className="flex items-baseline justify-between gap-space-sm font-body-sm text-body-sm">
          <span>{posting.debit_minor !== '0' ? 'Debit' : 'Credit'}: {accountText(posting.account.type)}{posting.payee === null ? '' : ` (${payeeText(posting.payee)})`}</span>
          <span className={`${MONO} font-semibold whitespace-nowrap`}>{marketMoney(posting.debit_minor !== '0' ? posting.debit_minor : posting.credit_minor, market)}</span>
        </div>
      ))}
    </li>
  )
}

function Postings({ instructionId, market }: { readonly instructionId: string; readonly market: Market | undefined }) {
  const entries = useResource<readonly LedgerEntry[]>('/v1/ledger/entries', { origin_id: instructionId })
  if (entries.error !== null) return <LoadFailure error={entries.error} onRetry={entries.reload} section />
  if (entries.data === null) return <LoadingState label="Loading the postings" />
  if (entries.data.length === 0) return <p className="font-body-sm text-body-sm text-secondary">No posting yet.</p>
  return <ul className="flex flex-col gap-space-xs">{entries.data.map((entry) => <EntryPostings key={entry.id} entry={entry} market={market} />)}</ul>
}

/** sc_34 inspector: instruction facts, events, ledger postings (ledger.read) and the returned-payment case. */
function ItemInspector({ item, market, provider, onClose }: { readonly item: ReconciliationItem | undefined; readonly market: Market | undefined; readonly provider: string; readonly onClose: () => void }) {
  const { can } = useSession()
  return (
    <Drawer open onClose={onClose} title={item === undefined ? 'Payout instruction' : `Instruction ${shortId(item.id)}`} description={item === undefined ? undefined : payeeText(item.participant)} icon="receipt_long">
      {item === undefined ? <Banner tone="warning" title="Not among the loaded instructions">Choose it again from the table, with the filter it appears under.</Banner> : (
        <div className="flex flex-col gap-space-md">
          <section className="flex flex-col gap-space-xs" aria-labelledby="item-facts">
            <h3 id="item-facts" className={LABEL}>Instruction</h3>
            <dl className="bg-surface-container-low p-space-sm rounded flex flex-col gap-1 font-body-sm text-body-sm">
              <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Batch</dt><dd><Link className={`${LINK} ${MONO}`} href={batchPath(item.batch_id)}>{shortId(item.batch_id)}</Link></dd></div>
              <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Payee</dt><dd><PayeeLink payee={item.participant} /></dd></div>
              <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Provider</dt><dd>{provider}</dd></div>
              <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">State</dt><dd><StatusBadge state={INSTRUCTION_BADGES[item.state]} label={INSTRUCTION_STATE_LABELS[item.state]} /></dd></div>
              <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Provider reference</dt><dd className={`${MONO} break-all`}>{item.provider_ref ?? '—'}</dd></div>
              <div className="flex justify-between gap-space-sm"><dt className="text-on-surface-variant">Reason or last error</dt><dd className="text-right break-words">{lastErrorText(item.last_error)}</dd></div>
              <div className="flex justify-between gap-space-sm pt-1 border-t border-surface-container-high"><dt className="font-semibold">Amount</dt><dd className="font-data-mono-md text-data-mono-md font-semibold text-primary">{marketMoney(item.amount_minor, market)}</dd></div>
            </dl>
          </section>
          <section className="flex flex-col gap-space-xs" aria-labelledby="item-events">
            <h3 id="item-events" className={LABEL}>Events</h3>
            <ol className="flex flex-col divide-y divide-surface-container">
              {item.events.map((event) => (
                <li key={`${event.type}-${event.at}`} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-space-sm">
                  <span className="font-body-sm text-body-sm text-on-surface">{EVENT_LABELS[event.type] ?? event.type} <span className="text-secondary">({event.source === 'provider' ? 'provider' : 'platform'})</span></span>
                  <span className={`${MONO} text-secondary`}>{formatDateTime(event.at)}</span>
                </li>
              ))}
            </ol>
          </section>
          {can('ledger.read') && (
            <section className="flex flex-col gap-space-xs" aria-labelledby="item-postings">
              <h3 id="item-postings" className={LABEL}>Ledger postings</h3>
              <Postings instructionId={item.id} market={market} />
            </section>
          )}
          {item.returned_case_id !== null && (
            <section className="flex flex-col gap-space-xs" aria-labelledby="item-case">
              <h3 id="item-case" className={LABEL}>Returned payment</h3>
              <p className="font-body-sm text-body-sm">The amount is back in the payee&apos;s payable balance. <Link className={LINK} href={`/cases/${item.returned_case_id}`}>Open the returned-payment case</Link></p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  )
}

function ResolveDialog({ exception, onClose, onDone }: { readonly exception: PayoutException; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = requiredError('how the exception was resolved', note)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'resolve-note', message: missing }] }
    return {
      items: [],
      fieldIds: { note: 'resolve-note' },
      send: async () => {
        await api.post(`${EXCEPTIONS_PATH}/${exception.id}/resolve`, { note: note.trim() }, { idempotencyKey })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={`Resolve ${EXCEPTION_KIND_LABELS[exception.kind].toLowerCase()}`} submitLabel="Resolve exception" onClose={onClose} onSubmit={submit}>
      <p>Reference <span className={MONO}>{exception.reference}</span>. Resolving changes no money: it records what was done, in the audit log.</p>
      <TextAreaField id="resolve-note" label="Note" maxLength={NOTE_MAX} value={note} error={error} onChange={setNote} />
    </FormDialog>
  )
}

/** POST /v1/payout-providers/:id/settlement-reports with the bank's result CSV (bank-file providers, payout.reconcile). */
function ImportDialog({ providers, onClose, onDone }: { readonly providers: readonly ProviderRecord[]; readonly onClose: () => void; readonly onDone: (result: ImportResult) => void }) {
  const api = useApi()
  const [providerId, setProviderId] = useState(providers.length === 1 ? providers[0]!.id : '')
  const [file, setFile] = useState<{ readonly file: File; readonly key: string } | null>(null)
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function submit(idempotencyKey: string) {
    const found = { provider: providerId === '' ? 'Choose the provider the file comes from.' : null, file: file === null ? 'Choose the result file (.csv).' : null }
    setErrors(found)
    const items = [found.provider === null ? [] : [{ fieldId: 'import-provider', message: found.provider }], found.file === null ? [] : [{ fieldId: 'import-file', message: found.file }]].flat()
    if (items.length > 0 || file === null) return { items }
    return {
      items,
      send: async () => {
        // A dropped file fires no form change, so the file's own key is paired with FormDialog's (which renews when the provider changes).
        const { data } = await api.post<ImportResult>(`/v1/payout-providers/${providerId}/settlement-reports`, await file.file.text(), {
          contentType: 'text/csv', idempotencyKey: `${file.key}-${idempotencyKey}`,
        })
        onDone(data)
      },
    }
  }
  return (
    <FormDialog title="Import result file" submitLabel="Import file" onClose={onClose} onSubmit={submit}>
      <p>The bank&apos;s result file for a bank-file batch: one row per payment with <span className={MONO}>end_to_end_id,status,amount_minor,reason</span>. Importing the same file again changes nothing. Someone other than whoever prepared, submitted or downloaded the bank file of a batch imports its results.</p>
      <Select id="import-provider" label="Provider" placeholder="Choose a provider" value={providerId} error={errors.provider}
        options={providers.map((p) => ({ value: p.id, label: p.provider }))} onChange={(event) => setProviderId(event.target.value)} />
      <FileDropZone id="import-file" label="Result file" extensions={['.csv']} maxBytes={REPORT_MAX_BYTES} error={errors.file}
        onFiles={(files) => setFile(files[0] === undefined ? null : { file: files[0], key: newIdempotencyKey() })} />
    </FormDialog>
  )
}

/** SC-34 payout reconciliation (FR-PAY-004, D-B4-15): per-provider totals, instructions by state, exceptions, result files. */
export function ReconciliationPage() {
  const { can, readOnly } = useSession()
  const toast = useToast()
  const markets = useMarkets()
  const [params, setParams] = useQueryParams()
  const requested = params.get('state')
  const state = INSTRUCTION_STATES.find((s) => s === requested) ?? null
  const requestedExceptions = params.get('exceptions')
  const exceptionFilter = EXCEPTION_FILTERS.find((f) => f === requestedExceptions) ?? null
  const itemId = params.get('item')
  const summary = useResource<{ readonly providers: readonly ProviderSummary[] }>(SUMMARY_PATH)
  const providers = useResource<readonly ProviderRecord[]>(PROVIDERS_PATH, { kind: 'payout' })
  const items = usePagedList<ReconciliationItem>(ITEMS_PATH, state === null ? {} : { state })
  const exceptions = usePagedList<PayoutException>(EXCEPTIONS_PATH, exceptionFilter === 'all' ? {} : { state: exceptionFilter ?? 'open' })
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [resolving, setResolving] = useState<PayoutException | null>(null)
  if (isNotAvailable(summary.error)) return <LoadFailure error={summary.error} onRetry={summary.reload} />
  const canReconcile = !readOnly && can('payout.reconcile')
  const fileProviders = (providers.data ?? []).filter((p) => p.state === 'recorded' && p.adapter === 'bank_file_csv')
  const providerName = (id: string) => summary.data?.providers.find((p) => p.id === id)?.provider ?? (providers.data ?? []).find((p) => p.id === id)?.provider ?? '—'
  const marketOfProvider = (id: string) => markets.get(summary.data?.providers.find((p) => p.id === id)?.market_id ?? '')
  const inspect = (id: string) => setParams({ item: id })
  // shortcut: an exception's instruction can be inspected only when it is on the loaded page (no GET by id); add `id` to GET …/items to inspect any.
  const loaded = (id: string) => items.rows.some((i) => i.id === id)

  const itemColumns: DataTableColumn<ReconciliationItem>[] = [
    {
      key: 'id', header: 'Instruction', cell: (i) => (
        <div className="flex flex-col">
          <span className={`${MONO} text-primary font-semibold`}>{shortId(i.id)}</span>
          <span className="font-caption text-caption text-secondary whitespace-nowrap">{formatDateTime(i.events.at(-1)?.at)}</span>
        </div>
      ),
    },
    { key: 'payee', header: 'Payee', cell: (i) => <PayeeLink payee={i.participant} /> },
    { key: 'amount', header: 'Amount', align: 'end', cell: (i) => <span className="font-data-mono-md text-data-mono-md whitespace-nowrap">{marketMoney(i.amount_minor, markets.get(i.market_id))}</span> },
    { key: 'provider', header: 'Provider', cell: (i) => providerName(i.provider_config_id) },
    { key: 'reason', header: 'Return or error reason', cell: (i) => <span className="break-words">{lastErrorText(i.last_error)}</span> },
    { key: 'state', header: 'State', cell: (i) => <StatusBadge state={INSTRUCTION_BADGES[i.state]} label={INSTRUCTION_STATE_LABELS[i.state]} /> },
    { key: 'action', header: 'Action', align: 'end', cell: (i) => <Button size="sm" aria-label={`Inspect instruction ${shortId(i.id)}`} onClick={() => inspect(i.id)}>Inspect</Button> },
  ]
  const exceptionColumns: DataTableColumn<PayoutException>[] = [
    { key: 'kind', header: 'Exception', cell: (e) => <span className="font-semibold">{EXCEPTION_KIND_LABELS[e.kind]}</span> },
    { key: 'reference', header: 'Reference', cell: (e) => <span className={`${MONO} break-all`}>{e.reference}</span> },
    { key: 'amount', header: 'Amount', align: 'end', cell: (e) => <span className="font-data-mono-md text-data-mono-md whitespace-nowrap">{e.amount_minor === null ? '—' : marketMoney(e.amount_minor, marketOfProvider(e.provider_config_id))}</span> },
    { key: 'provider', header: 'Provider', cell: (e) => providerName(e.provider_config_id) },
    {
      key: 'state', header: 'State', cell: (e) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge state={e.state === 'open' ? 'unmatched' : 'closed'} label={e.state === 'open' ? 'Open' : 'Resolved'} />
          {e.resolved_by !== null && <span className="font-caption text-caption text-secondary">{e.resolved_by.display_name ?? 'A user'} · {formatDateTime(e.resolved_at)}: {e.resolution_note}</span>}
        </div>
      ),
    },
    { key: 'created', header: 'Recorded', cell: (e) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(e.created_at)}</span> },
    {
      key: 'action', header: 'Action', align: 'end', cell: (e) => (
        <div className="flex justify-end gap-space-xs">
          {e.instruction_id !== null && loaded(e.instruction_id) && <Button size="sm" aria-label={`Inspect instruction ${shortId(e.instruction_id)}`} onClick={() => inspect(e.instruction_id!)}>Inspect</Button>}
          {e.state === 'open' && canReconcile && <Button size="sm" variant="primary" aria-label={`Resolve exception ${e.reference}`} onClick={() => setResolving(e)}>Resolve</Button>}
        </div>
      ),
    },
  ]
  const selected = itemId !== null && isUuid(itemId) ? items.rows.find((i) => i.id === itemId) : undefined
  return (
    <>
      <PageHeader
        title="Payout reconciliation"
        breadcrumbs={[{ label: 'Payouts', href: '/payouts' }, { label: 'Reconciliation' }]}
        summary="Settlements and returns reported by each provider, matched to the instructions; anything that does not match is an exception to resolve."
        actions={canReconcile && fileProviders.length > 0 ? <Button variant="primary" icon="upload_file" data-testid="primary-action" onClick={() => setImporting(true)}>Import result file</Button> : undefined}
      />
      {imported !== null && (
        <Banner tone={imported.exceptions > 0 ? 'warning' : 'success'} title={`Result file imported: ${countLabel(imported.rows, 'row')}`}>
          {imported.settled} settled, {imported.returned} returned, {imported.failed} failed, {imported.unchanged} unchanged, {countLabel(imported.exceptions, 'exception')}.
        </Banner>
      )}
      {summary.error !== null && <LoadFailure error={summary.error} onRetry={summary.reload} section />}
      {summary.loading && <LoadingState label="Loading provider totals" />}
      {summary.data !== null && summary.data.providers.length === 0 && <EmptyState title="No payout provider is recorded yet." />}
      {summary.data?.providers.map((provider) => <ProviderKpis key={provider.id} provider={provider} markets={markets} />)}
      <RegisterCard title="Instructions" note="Each payment sent to a provider, with what the provider reported">
        <StateChips label="Filter instructions by state" chips={INSTRUCTION_CHIPS} value={state} onChange={(next) => setParams({ state: next, item: null })} />
        <DataTable
          key={state ?? 'all'} bare stackOnPhone caption="Payout instructions" columns={itemColumns} rows={items.rows} rowKey={(i) => i.id} loading={items.loading}
          error={tableError(items)} pagination={items.pagination} selectedKey={selected?.id}
          empty={{ title: state === null ? 'No instruction yet.' : `No ${INSTRUCTION_STATE_LABELS[state].toLowerCase()} instruction.`, action: state === null ? undefined : <Button size="sm" onClick={() => setParams({ state: null })}>Show all states</Button> }}
        />
      </RegisterCard>
      <RegisterCard title="Exceptions" note="Unknown references, amount mismatches and events for finished instructions">
        <StateChips label="Filter exceptions by state" chips={EXCEPTION_CHIPS} value={exceptionFilter} onChange={(next) => setParams({ exceptions: next })} />
        <DataTable
          key={exceptionFilter ?? 'open'} bare stackOnPhone caption="Payout exceptions" columns={exceptionColumns} rows={exceptions.rows} rowKey={(e) => e.id} loading={exceptions.loading}
          error={tableError(exceptions)} pagination={exceptions.pagination}
          empty={{ title: exceptionFilter === null ? 'No open exception.' : exceptionFilter === 'resolved' ? 'No resolved exception.' : 'No exception: every reported event matched an instruction.' }}
        />
      </RegisterCard>
      {itemId !== null && (
        <ItemInspector item={selected} market={selected === undefined ? undefined : markets.get(selected.market_id)}
          provider={selected === undefined ? '—' : providerName(selected.provider_config_id)} onClose={() => setParams({ item: null })} />
      )}
      {importing && (
        <ImportDialog
          providers={fileProviders} onClose={() => setImporting(false)}
          onDone={(result) => {
            setImporting(false)
            setImported(result) // its banner is the one notice (BUG-102)
            summary.reload()
            items.reload()
            exceptions.reload()
          }}
        />
      )}
      {resolving !== null && (
        <ResolveDialog
          exception={resolving} onClose={() => setResolving(null)}
          onDone={() => {
            setResolving(null)
            toast({ message: 'Exception resolved.' })
            exceptions.reload()
            summary.reload()
          }}
        />
      )}
    </>
  )
}
