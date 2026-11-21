'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { FilterChips } from '../../components/filters-bar'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { countLabel, formatDateTime, formatDay } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { FormDialog } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { CHECK_GRID, FIELDSET, LEGEND, PAIR } from '../admin/ui'
import { useRefLabel } from '../cases/refs'
import { ParticipantPicker } from '../cases/pickers'
import { marketScope } from '../markets/format'
import { ITEM_CLASS_LABELS, ITEM_CLASSES } from '../orders/format'
import { marketAmount, marketMoney } from '../periods/format'
import { asFieldIssue, ledgerPath } from './format'
import type { LedgerTabProps } from './ledger-page'
import type { CreditBalance, CreditLot, CreditRedemption, CreditType } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const LINK = 'text-primary font-semibold hover:underline'
/** A bare section of the ledger tab panel, as the journal and receivables tabs (sc_33: no card inside the panel). */
const SECTION = 'flex flex-col gap-space-sm min-w-0'
const HEADING = 'font-section-heading text-section-heading text-on-surface font-bold'
const NOTE = 'font-body-sm text-body-sm text-secondary'
const CODE = /^[A-Z][A-Z0-9_]{1,31}$/
const DAYS = /^\d{1,4}$/
const MINOR = /^[1-9]\d{0,17}$/
const DAYS_MAX = 3650
const TYPES_PATH = '/v1/credit-types'

const typeName = (type: { readonly code: string; readonly name: string }) => `${type.name} (${type.code})`

function expiryText(type: CreditType): string {
  return type.expiry_days === null ? 'No expiry' : `${countLabel(type.expiry_days, 'day')} · notice ${countLabel(type.expiry_notice_days ?? 0, 'day')} before`
}

function scopeText(type: CreditType, markets: readonly Market[]): string {
  const scope = type.redemption_scope
  if (scope === null) return 'Any market and item'
  const codes = (scope.markets ?? []).map((id) => markets.find((market) => market.id === id)?.code ?? 'Unknown market')
  const classes = (scope.item_classes ?? []).map((value) => ITEM_CLASS_LABELS[value] ?? value)
  return [codes.length === 0 ? 'Any market' : codes.join(', '), classes.length === 0 ? 'any item' : classes.join(', ')].join(' · ')
}

interface TypeForm {
  readonly code: string
  readonly name: string
  readonly unit: string
  readonly expiry: string
  readonly notice: string
  readonly taxable: string
  readonly active: boolean
  readonly markets: readonly string[]
  readonly classes: readonly string[]
}

const formOf = (type: CreditType | null): TypeForm => ({
  code: type?.code ?? '',
  name: type?.name ?? '',
  unit: type?.unit_value_minor ?? '',
  expiry: type?.expiry_days === null || type === null ? '' : String(type.expiry_days),
  notice: type?.expiry_notice_days === null || type === null ? '' : String(type.expiry_notice_days),
  taxable: type === null ? '' : type.taxable ? 'yes' : 'no',
  active: type?.active ?? true,
  markets: type?.redemption_scope?.markets ?? [],
  classes: type?.redemption_scope?.item_classes ?? [],
})

/** Client checks of a credit type; the server refuses the same (D-V1A-03: no default but active). */
export function creditTypeIssues(form: TypeForm, creating: boolean): Record<string, string> {
  const issues: Record<string, string> = {}
  if (creating && !CODE.test(form.code)) issues['credit-code'] = 'Use 2 to 32 upper-case letters, digits or underscores, starting with a letter.'
  if (form.name.trim() === '') issues['credit-name'] = 'Enter the name.'
  if (form.unit !== '' && !MINOR.test(form.unit)) issues['credit-unit'] = 'Enter a whole number of minor units above 0, or leave it empty.'
  const days = (text: string) => DAYS.test(text) && Number(text) >= 1 && Number(text) <= DAYS_MAX
  if ((form.expiry === '') !== (form.notice === '')) {
    issues[form.expiry === '' ? 'credit-expiry' : 'credit-notice'] = 'Give the expiry and the notice together, or neither.'
  } else if (form.expiry !== '') {
    if (!days(form.expiry)) issues['credit-expiry'] = `Enter 1 to ${DAYS_MAX} days.`
    else if (!days(form.notice)) issues['credit-notice'] = `Enter 1 to ${DAYS_MAX} days.`
    else if (Number(form.notice) > Number(form.expiry)) issues['credit-notice'] = 'The notice cannot be longer than the expiry.'
  }
  if (form.taxable === '') issues['credit-taxable'] = 'Say whether the credits are taxable.'
  return issues
}

/** The terms as the API takes them; an empty scope means any market and item. */
function termsOf(form: TypeForm) {
  const scope = {
    ...(form.markets.length === 0 ? {} : { markets: form.markets }),
    ...(form.classes.length === 0 ? {} : { item_classes: form.classes }),
  }
  return {
    name: form.name.trim(),
    unit_value_minor: form.unit === '' ? null : form.unit,
    expiry_days: form.expiry === '' ? null : Number(form.expiry),
    expiry_notice_days: form.notice === '' ? null : Number(form.notice),
    redemption_scope: Object.keys(scope).length === 0 ? null : scope,
    taxable: form.taxable === 'yes',
  }
}

const FIELD_IDS = {
  code: 'credit-code', name: 'credit-name', unit_value_minor: 'credit-unit', expiry_days: 'credit-expiry', expiry_notice_days: 'credit-notice', taxable: 'credit-taxable',
}

/** POST /v1/credit-types (Idempotency-Key) or PATCH …/:id with expected_updated_at; both need a step-up (ApiProvider asks). */
function CreditTypeDialog({ type, markets, onClose, onSaved }: { readonly type: CreditType | null; readonly markets: readonly Market[]; readonly onClose: () => void; readonly onSaved: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [form, setForm] = useState<TypeForm>(() => formOf(type))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const set = <K extends keyof TypeForm>(key: K, value: TypeForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  const toggle = (key: 'markets' | 'classes', value: string, on: boolean) => set(key, on ? [...form[key], value] : form[key].filter((item) => item !== value))
  function submit(idempotencyKey: string) {
    const found = creditTypeIssues(form, type === null)
    setIssues(found)
    const items = Object.entries(found).map(([fieldId, message]) => ({ fieldId, message }))
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: FIELD_IDS,
      send: async () => {
        try {
          if (type === null) {
            await api.post<CreditType>(TYPES_PATH, { code: form.code, ...termsOf(form) }, { idempotencyKey })
          } else {
            await api.patch<CreditType>(`${TYPES_PATH}/${type.id}`, { expected_updated_at: type.updated_at, ...termsOf(form), active: form.active })
          }
        } catch (error) {
          throw asFieldIssue(error)
        }
        toast({ message: type === null ? `Credit type ${form.code} created.` : `Credit type ${type.code} saved.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={type === null ? 'Add credit type' : `Edit credit type ${type.code}`} size="lg" submitLabel={type === null ? 'Add credit type' : 'Save credit type'} onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>Credits are rewards settled in kind, never paid out in cash. A plan's pay rule names the type; each award keeps the terms in force when it is calculated.</p>
      <div className={PAIR}>
        <TextInput id="credit-code" label="Code" value={form.code} readOnly={type !== null} error={issues['credit-code']} maxLength={32}
          helper={type === null ? 'Upper-case letters, digits and underscores; it never changes.' : 'The code never changes.'} onChange={(event) => set('code', event.target.value.toUpperCase())} />
        <TextInput id="credit-name" label="Name" value={form.name} maxLength={100} error={issues['credit-name']} onChange={(event) => set('name', event.target.value)} />
        <TextInput id="credit-unit" label="Unit value (minor units)" optional inputMode="numeric" value={form.unit} error={issues['credit-unit']}
          helper="What one credit is worth for display, in minor units of each market's currency (100 = 1.00)." onChange={(event) => set('unit', event.target.value.trim())} />
        <Select id="credit-taxable" label="Taxable" placeholder="Choose" value={form.taxable} error={issues['credit-taxable']}
          options={[{ value: 'yes', label: 'Yes: the award counts as taxable income' }, { value: 'no', label: 'No' }]} onChange={(event) => set('taxable', event.target.value)} />
        <TextInput id="credit-expiry" label="Expires after (days)" optional inputMode="numeric" value={form.expiry} error={issues['credit-expiry']}
          helper="Counted from the run's commit. Leave both empty for credits that never expire." onChange={(event) => set('expiry', event.target.value.trim())} />
        <TextInput id="credit-notice" label="Notice before expiry (days)" optional inputMode="numeric" value={form.notice} error={issues['credit-notice']}
          helper="The holder is told this many days before the credits expire." onChange={(event) => set('notice', event.target.value.trim())} />
      </div>
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Redeemable in markets</legend>
        <p className={NOTE}>None chosen: any market.</p>
        <div className={CHECK_GRID}>
          {markets.map((market) => (
            <Checkbox key={market.id} label={market.code} checked={form.markets.includes(market.id)} onChange={(event) => toggle('markets', market.id, event.target.checked)} />
          ))}
        </div>
      </fieldset>
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Redeemable for item classes</legend>
        <p className={NOTE}>None chosen: any item.</p>
        <div className={CHECK_GRID}>
          {ITEM_CLASSES.map((value) => (
            <Checkbox key={value} label={ITEM_CLASS_LABELS[value] ?? value} checked={form.classes.includes(value)} onChange={(event) => toggle('classes', value, event.target.checked)} />
          ))}
        </div>
      </fieldset>
      {type !== null && <Checkbox label="Active: pay rules may name it" checked={form.active} onChange={(event) => set('active', event.target.checked)} />}
    </FormDialog>
  )
}

/** The tenant's credit types (GET /v1/credit-types); credit.manage over all markets adds and edits them. */
function CreditTypes() {
  const { me, can, readOnly } = useSession()
  const types = useResource<CreditType[]>(TYPES_PATH)
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [editing, setEditing] = useState<CreditType | 'new' | null>(null)
  const canManage = !readOnly && can('credit.manage') && marketScope(me, 'credit.manage') === 'all'
  const rows = types.data ?? []
  const marketList = markets.data ?? []
  const columns: readonly DataTableColumn<CreditType>[] = [
    { key: 'type', header: 'Credit type', cell: (row) => <span className="flex flex-col"><span className="font-semibold text-on-surface">{row.name}</span><span className={`${MONO} text-secondary`}>{row.code}</span></span> },
    { key: 'unit', header: 'Unit value (minor units)', align: 'end', cell: (row) => (row.unit_value_minor === null ? '—' : <span className={MONO}>{BigInt(row.unit_value_minor).toLocaleString()}</span>) },
    { key: 'expiry', header: 'Expiry', cell: expiryText },
    { key: 'scope', header: 'Redeemable', cell: (row) => scopeText(row, marketList) },
    { key: 'taxable', header: 'Taxable', cell: (row) => (row.taxable ? 'Yes' : 'No') },
    { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.active ? 'active' : 'inactive'} label={row.active ? 'Active' : 'Inactive'} /> },
    ...(canManage ? [{ key: 'edit', header: 'Actions', align: 'end' as const, cell: (row: CreditType) => <Button size="sm" icon="edit" aria-label={`Edit credit type ${row.code}`} onClick={() => setEditing(row)}>Edit</Button> }] : []),
  ]
  return (
    <section className={SECTION} aria-labelledby="credit-types-title" data-testid="credit-types">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id="credit-types-title" className={HEADING}>Credit types</h2>
        {canManage && <Button icon="add" onClick={() => setEditing('new')}>Add credit type</Button>}
      </div>
      {types.error !== null ? <LoadFailure error={types.error} onRetry={types.reload} section /> : (
        <>
          <p className={NOTE}>{types.data === null ? 'Loading the credit types' : `${countLabel(rows.length, 'credit type')}, ${rows.filter((row) => row.active).length} active. Types apply in every market; awards copy their terms when calculated.`}</p>
          <DataTable bare stackOnPhone caption="Credit types" columns={columns} rows={rows} rowKey={(row) => row.id} loading={types.loading} empty={{ title: 'No credit type yet' }} />
        </>
      )}
      {editing !== null && (
        <CreditTypeDialog type={editing === 'new' ? null : editing} markets={marketList} onClose={() => setEditing(null)} onSaved={() => {
          setEditing(null)
          types.reload()
        }} />
      )}
    </section>
  )
}

/** One holder's lots of one type (GET /v1/credits/lots): what remains, when it expires, notice and expiry. */
function LotsDrawer({ balance, money, onClose }: { readonly balance: CreditBalance; readonly money: LedgerTabProps['money']; readonly onClose: () => void }) {
  const lots = useResource<CreditLot[]>('/v1/credits/lots', { participant_id: balance.participant.id, credit_type_id: balance.credit_type.id, market_id: balance.market_id })
  const amount = (minor: string) => marketAmount(minor, money)
  return (
    <Drawer open onClose={onClose} title={`Credits of ${balance.participant.external_ref}`} description={typeName(balance.credit_type)} icon="redeem" width="lg">
      <div className="flex flex-col gap-space-md">
        <p className={NOTE}>Balance {marketMoney(balance.balance_minor, money)}; {marketMoney(balance.available_minor, money)} not yet expired. Redemptions take the lots that expire first.</p>
        {lots.error !== null ? <LoadFailure error={lots.error} onRetry={lots.reload} section /> : (
          <DataTable
            bare
            caption="Credit lots"
            columns={[
              { key: 'awarded', header: 'Awarded', cell: (row) => <span className={MONO}>{formatDateTime(row.committed_at)}</span> },
              { key: 'expires', header: 'Expires', cell: (row) => (row.expires_on === null ? 'Never' : formatDay(row.expires_on)) },
              { key: 'amount', header: `Awarded (${money.currency})`, align: 'end', cell: (row) => amount(row.amount_minor) },
              { key: 'remaining', header: `Remaining (${money.currency})`, align: 'end', cell: (row) => <span className="font-semibold">{amount(row.remaining_minor)}</span> },
              { key: 'events', header: 'Notice and expiry', cell: (row) => (
                <span className="flex flex-col font-caption text-caption text-secondary">
                  <span>{row.notified_at === null ? 'No notice sent' : `Notice sent ${formatDateTime(row.notified_at)}`}</span>
                  {row.expired_at !== null && <span>Expired {formatDateTime(row.expired_at)}</span>}
                </span>
              ) },
            ]}
            rows={lots.data ?? []}
            rowKey={(row) => row.award_id}
            loading={lots.loading}
            empty={{ title: 'No lot' }}
          />
        )}
      </div>
    </Drawer>
  )
}

const balanceKey = (row: CreditBalance) => `${row.participant.id}.${row.credit_type.id}`

/** Credits owed per holder and type in the market (meta.totals per currency), each opening its lots. */
function Balances({ marketId, money, payee, update, lotsKey }: Pick<LedgerTabProps, 'marketId' | 'money' | 'update'> & { readonly payee: string | undefined; readonly lotsKey: string | null }) {
  const list = usePagedList<CreditBalance>('/v1/credits/balances', { market_id: marketId, participant_id: payee })
  const totals = (list.meta.totals as readonly { currency: string; balance_minor: string; available_minor: string }[] | undefined) ?? []
  const total = totals.find((row) => row.currency === money.currency)
  const open = list.rows.find((row) => balanceKey(row) === lotsKey)
  const amount = (minor: string) => marketAmount(minor, money)
  return (
    <>
      <p className={NOTE}>
        {total === undefined
          ? (list.loading ? 'Loading the balances' : 'No credits are owed in this market.')
          : `Credits owed in this market${payee === undefined ? '' : ' to this payee'}: ${marketMoney(total.balance_minor, money)}, of which ${marketMoney(total.available_minor, money)} not yet expired.`}
      </p>
      <DataTable
        bare
        stackOnPhone
        caption="Credit balances"
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => <Link className={LINK} href={`/people/${row.participant.id}`}>{row.participant.external_ref}</Link> },
          { key: 'type', header: 'Credit type', cell: (row) => typeName(row.credit_type) },
          { key: 'balance', header: `Balance (${money.currency})`, align: 'end', cell: (row) => <span className="font-semibold">{amount(row.balance_minor)}</span> },
          { key: 'available', header: `Not yet expired (${money.currency})`, align: 'end', cell: (row) => amount(row.available_minor) },
          { key: 'next', header: 'Next expiry', cell: (row) => (row.next_expiry === null ? '—' : `${formatDay(row.next_expiry.on)} · ${marketMoney(row.next_expiry.amount_minor, money)}`) },
          { key: 'lots', header: 'Lots', align: 'end', cell: (row) => <Button size="sm" icon="list" aria-label={`Lots of ${row.participant.external_ref} in ${row.credit_type.code}`} onClick={() => update({ lots: balanceKey(row) })}>Lots</Button> },
        ]}
        rows={list.rows}
        rowKey={balanceKey}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: payee === undefined ? 'No credit balance in this market' : 'This payee holds no credits here' }}
        pagination={list.pagination}
      />
      {open !== undefined && <LotsDrawer balance={open} money={money} onClose={() => update({ lots: null })} />}
    </>
  )
}

/** Redemptions recorded by the store or fulfilment systems (POST /v1/credit-redemptions is API-key only). */
function Redemptions({ marketId, money, payee }: Pick<LedgerTabProps, 'marketId' | 'money'> & { readonly payee: string | undefined }) {
  const { can } = useSession()
  const list = usePagedList<CreditRedemption>('/v1/credits/redemptions', { market_id: marketId, participant_id: payee })
  return (
    <DataTable
      bare
      stackOnPhone
      caption="Credit redemptions"
      columns={[
        { key: 'occurred', header: 'Redeemed', cell: (row) => <span className={MONO}>{formatDateTime(row.occurred_at)}</span> },
        { key: 'payee', header: 'Payee', cell: (row) => <Link className={LINK} href={`/people/${row.participant.id}`}>{row.participant.external_ref}</Link> },
        { key: 'type', header: 'Credit type', cell: (row) => typeName(row.credit_type) },
        { key: 'amount', header: `Amount (${money.currency})`, align: 'end', cell: (row) => <span className="font-semibold">{marketAmount(row.amount_minor, money)}</span> },
        { key: 'item', header: 'Item class', cell: (row) => (row.item_class === null ? '—' : ITEM_CLASS_LABELS[row.item_class] ?? row.item_class) },
        { key: 'source', header: 'Source', cell: (row) => <span className={`${MONO} break-all`}>{row.source_system} · {row.source_redemption_id}</span> },
        { key: 'entry', header: 'Journal entry', cell: (row) => (row.entry_id === null || !can('ledger.read') ? '—' : <Link className={LINK} href={ledgerPath(marketId, undefined, { entry: row.entry_id })}>Open entry</Link>) },
      ]}
      rows={list.rows}
      rowKey={(row) => row.id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No redemption recorded' }}
      pagination={list.pagination}
    />
  )
}

/** The payee filter: the chosen payee as a chip (?payee=), otherwise a participant search. */
function PayeeFilter({ payee, update }: { readonly payee: string | undefined; readonly update: LedgerTabProps['update'] }) {
  const { can } = useSession()
  const name = useRefLabel('participant', payee ?? null)
  if (!can('participant.read')) return null
  if (payee !== undefined) {
    return <FilterChips chips={[{ key: 'payee', label: `Payee: ${name ?? 'Loading'}`, onRemove: () => update({ payee: null, lots: null }) }]} onClear={() => update({ payee: null, lots: null })} />
  }
  return <ParticipantPicker id="credit-payee" label="Payee" chosen={null} onChoose={(row) => row !== null && update({ payee: row.id, lots: null })} />
}

/**
 * SC-33 Credits tab (FR-FIN-006, D-V1A-03): credit types (create and edit with step-up), balances of the market with
 * a lots drawer (?lots=<payee>.<type>), and redemptions. Credits are non-cash obligations; nothing here buys or adds them.
 */
export function CreditsTab({ marketId, money, params, update }: LedgerTabProps) {
  const payeeParam = params.get('payee')
  const payee = payeeParam !== null && isUuid(payeeParam) ? payeeParam : undefined
  const lots = params.get('lots')
  const key = `${marketId}:${payee ?? ''}`
  return (
    <>
      <CreditTypes />
      <section className={SECTION} aria-labelledby="credit-balances-title">
        <h2 id="credit-balances-title" className={HEADING}>Balances</h2>
        <PayeeFilter payee={payee} update={update} />
        <Balances key={key} marketId={marketId} money={money} payee={payee} update={update} lotsKey={lots} />
      </section>
      <section className={SECTION} aria-labelledby="credit-redemptions-title">
        <h2 id="credit-redemptions-title" className={HEADING}>Redemptions</h2>
        <p className={NOTE}>Recorded by your store or fulfilment system through the API; each posts one journal entry.</p>
        <Redemptions key={key} marketId={marketId} money={money} payee={payee} />
      </section>
    </>
  )
}

