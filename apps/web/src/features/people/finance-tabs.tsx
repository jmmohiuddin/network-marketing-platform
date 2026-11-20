'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { tableError } from '../admin/resource'
import { MONO, NOTE } from '../admin/ui'
import { ledgerPath } from '../ledger/format'
import { inScope, marketScope } from '../markets/format'
import type { PayeeBalance } from '../ledger/types'
import { marketMoney } from '../periods/format'
import { BankDetailDialog, ENTITY_LABELS, HoldDialog, TaxDialog, TaxUnmaskDialog, type TaxIdFormat } from './finance-dialogs'
import type { ParticipantDetail } from './types'
import { Facts, RecordCard } from './ui'

// SC-09 Banking, Tax, Holds and Balances tabs (PLAN B4 §5): masked values only; controls only with their permission.

interface BankVersion {
  readonly id: string
  readonly scheme: string
  readonly masked: string
  readonly created_via: string
  readonly cooling_off_until: string | null
  readonly in_cooling_off?: boolean
  readonly created_at: string
  readonly superseded_at?: string
}

interface TaxVersion {
  readonly id: string
  readonly residency: string | null
  readonly entity_type: string | null
  readonly tax_id_masked: string | null
  readonly valid_from: string
  readonly valid_to: string | null
}

interface Hold {
  readonly id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly reason: string
  readonly placed_by: { readonly id: string; readonly display_name: string | null }
  readonly placed_at: string
  readonly released_by: { readonly id: string; readonly display_name: string | null } | null
  readonly released_at: string | null
  readonly release_reason: string | null
}

const SCHEMES: Readonly<Record<string, string>> = { iban: 'IBAN', local: 'Local account' }
const VIA: Readonly<Record<string, string>> = { case: 'Approved bank-detail case', migration: 'Migrated record' }

function useWrite(): (permission: string) => boolean {
  const { can, readOnly } = useSession()
  return (permission) => !readOnly && can(permission)
}

export function BankingTab({ detail }: { readonly detail: ParticipantDetail }) {
  const write = useWrite()
  const details = useResource<{ readonly current: BankVersion | null; readonly history: readonly BankVersion[] }>(`/v1/participants/${detail.id}/bank-details`)
  const [requesting, setRequesting] = useState(false)
  const current = details.data?.current ?? null
  const columns: readonly DataTableColumn<BankVersion>[] = [
    { key: 'account', header: 'Account', cell: (row) => <span className={MONO}>{row.masked}</span> },
    { key: 'scheme', header: 'Format', cell: (row) => SCHEMES[row.scheme] ?? row.scheme },
    { key: 'via', header: 'Recorded through', cell: (row) => VIA[row.created_via] ?? row.created_via },
    { key: 'range', header: 'In use', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.created_at)} – {formatDateTime(row.superseded_at)}</span> },
  ]
  return (
    <div className="flex flex-col gap-space-md">
      <RecordCard id="banking-title" testId="banking" icon="account_balance" title="Payout account (masked)"
        action={write('case.bank_detail.create') ? <Button size="sm" icon="edit" onClick={() => setRequesting(true)}>Request bank-detail change</Button> : undefined}>
        {details.error !== null && <LoadFailure error={details.error} onRetry={details.reload} section />}
        {details.data === null && details.error === null && <LoadingState label="Loading the bank details" />}
        {details.data !== null && (current === null
          ? <p className={NOTE}>No payout account on record: the payee is left out of payout batches until one is approved.</p>
          : (
            <Facts items={[
              { label: 'Account', value: <span className={MONO}>{current.masked}</span> },
              { label: 'Format', value: SCHEMES[current.scheme] ?? current.scheme },
              { label: 'Recorded through', value: VIA[current.created_via] ?? current.created_via },
              { label: 'Since', value: <span className={MONO}>{formatDateTime(current.created_at)}</span> },
              {
                label: 'Payouts', value: current.in_cooling_off === true
                  ? <StatusBadge state="cooling_off" label={`Cooling off until ${formatDateTime(current.cooling_off_until)}`} />
                  : <StatusBadge state="active" label="Can be paid" />,
              },
            ]} />
          ))}
      </RecordCard>
      <RecordCard id="banking-history-title" icon="history" title="Earlier accounts">
        <DataTable bare caption="Earlier payout accounts" columns={columns} rows={details.data?.history ?? []} rowKey={(row) => row.id} loading={details.loading}
          error={tableError(details)} empty={{ title: 'No earlier account.' }} />
      </RecordCard>
      {requesting && <BankDetailDialog participantId={detail.id} onClose={() => setRequesting(false)} />}
    </div>
  )
}

export function TaxTab({ detail }: { readonly detail: ParticipantDetail }) {
  const write = useWrite()
  const profile = useResource<{ readonly current: TaxVersion | null; readonly history: readonly TaxVersion[]; readonly format: TaxIdFormat | null }>(`/v1/participants/${detail.id}/tax-profile`)
  const [dialog, setDialog] = useState<'edit' | 'unmask' | null>(null)
  const current = profile.data?.current ?? null
  const actions = (
    <span className="flex flex-wrap gap-space-xs">
      {current?.tax_id_masked != null && write('participant.unmask') && <Button size="sm" icon="visibility" onClick={() => setDialog('unmask')}>Show tax id</Button>}
      {write('tax.manage') && <Button size="sm" icon="edit" onClick={() => setDialog('edit')}>Edit tax profile</Button>}
    </span>
  )
  const columns: readonly DataTableColumn<TaxVersion>[] = [
    { key: 'id', header: 'Tax id', cell: (row) => <span className={MONO}>{row.tax_id_masked ?? 'None'}</span> },
    { key: 'residency', header: 'Residency', cell: (row) => row.residency ?? '—' },
    { key: 'entity', header: 'Entity type', cell: (row) => (row.entity_type === null ? '—' : ENTITY_LABELS[row.entity_type] ?? row.entity_type) },
    { key: 'valid', header: 'Valid', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.valid_from)} – {formatDateTime(row.valid_to)}</span> },
  ]
  return (
    <div className="flex flex-col gap-space-md">
      <RecordCard id="tax-title" testId="tax" icon="receipt" title="Tax profile (masked)" action={actions}>
        {profile.error !== null && <LoadFailure error={profile.error} onRetry={profile.reload} section />}
        {profile.data === null && profile.error === null && <LoadingState label="Loading the tax profile" />}
        {profile.data !== null && (current === null
          ? <p className={NOTE}>No tax profile recorded.</p>
          : (
            <Facts items={[
              { label: 'Tax id', value: <span className={MONO}>{current.tax_id_masked ?? 'Not recorded'}</span> },
              { label: 'Residency', value: current.residency ?? 'Not recorded' },
              { label: 'Entity type', value: current.entity_type === null ? 'Not recorded' : ENTITY_LABELS[current.entity_type] ?? current.entity_type },
              { label: 'Valid from', value: <span className={MONO}>{formatDateTime(current.valid_from)}</span> },
            ]} />
          ))}
      </RecordCard>
      <RecordCard id="tax-history-title" icon="history" title="Earlier versions">
        <DataTable bare caption="Earlier tax profile versions" columns={columns} rows={profile.data?.history ?? []} rowKey={(row) => row.id} loading={profile.loading}
          error={tableError(profile)} empty={{ title: 'No earlier version.' }} />
      </RecordCard>
      {dialog === 'edit' && <TaxDialog participantId={detail.id} current={current} format={profile.data?.format ?? null} onClose={() => setDialog(null)} onDone={() => {
        setDialog(null)
        profile.reload()
      }} />}
      {dialog === 'unmask' && <TaxUnmaskDialog participantId={detail.id} onClose={() => setDialog(null)} />}
    </div>
  )
}

export function HoldsTab({ detail }: { readonly detail: ParticipantDetail }) {
  const write = useWrite()
  const holds = useResource<readonly Hold[]>(`/v1/payees/${detail.id}/holds`)
  const [dialog, setDialog] = useState<{ readonly release?: Hold } | null>(null)
  const canHold = write('payout.hold')
  // Whoever prepares payouts in a market does not release its holds (the API answers 403 RELEASER_NOT_INDEPENDENT).
  const { me } = useSession()
  const prepares = marketScope(me, 'payout.prepare')
  const canRelease = (row: Hold) => canHold && row.released_at === null && !inScope(prepares, row.market.id)
  const columns: readonly DataTableColumn<Hold>[] = [
    { key: 'market', header: 'Market', cell: (row) => <span className={MONO}>{row.market.code}</span> },
    { key: 'state', header: 'State', cell: (row) => (row.released_at === null ? <StatusBadge state="held" label="Active" /> : <StatusBadge state="ended" label="Released" />) },
    { key: 'reason', header: 'Reason', cell: (row) => <span className="flex flex-col"><span>{row.reason}</span>{row.release_reason !== null && <span className={NOTE}>Released: {row.release_reason}</span>}</span> },
    {
      key: 'placed', header: 'Placed', cell: (row) => (
        <span className="flex flex-col"><span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.placed_at)}</span><span className={NOTE}>{row.placed_by.display_name ?? 'Another user'}</span></span>
      ),
    },
    {
      key: 'released', header: 'Released', cell: (row) => (row.released_at === null ? '—' : (
        <span className="flex flex-col"><span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.released_at)}</span><span className={NOTE}>{row.released_by?.display_name ?? 'Another user'}</span></span>
      )),
    },
    ...(canHold ? [{
      key: 'actions', header: 'Actions', align: 'end' as const,
      cell: (row: Hold) => (!canRelease(row) ? null : <Button size="sm" aria-label={`Release the hold in ${row.market.code}`} onClick={() => setDialog({ release: row })}>Release</Button>),
    }] : []),
  ]
  const done = () => {
    setDialog(null)
    holds.reload()
  }
  return (
    <RecordCard id="holds-title" testId="holds" icon="front_hand" title="Payout holds"
      action={canHold ? <Button size="sm" icon="add" onClick={() => setDialog({})}>Place hold</Button> : undefined}>
      <p className={NOTE}>An active hold leaves the payee out of payout batches in its market; earnings keep accruing.</p>
      <DataTable bare caption="Payout holds" columns={columns} rows={holds.data ?? []} rowKey={(row) => row.id} loading={holds.loading} error={tableError(holds)}
        empty={{ title: 'No payout hold.' }} stackOnPhone />
      {dialog !== null && (
        <HoldDialog participantId={detail.id} defaultMarketId={detail.market.id} release={dialog.release === undefined ? undefined : { id: dialog.release.id, marketCode: dialog.release.market.code }}
          onClose={() => setDialog(null)} onDone={done} />
      )}
    </RecordCard>
  )
}

export function BalancesTab({ detail }: { readonly detail: ParticipantDetail }) {
  const balances = useResource<readonly PayeeBalance[]>(`/v1/payees/${detail.id}/balances`)
  const markets = useResource<Market[]>(MARKETS_PATH)
  const money = (minor: string, row: PayeeBalance) => marketMoney(minor, markets.data?.find((market) => market.id === row.market.id))
  const columns: readonly DataTableColumn<PayeeBalance>[] = [
    { key: 'market', header: 'Market', cell: (row) => <Link className={`${MONO} text-primary hover:underline`} href={ledgerPath(row.market.id, 'accounts', { payee: detail.id })}>{row.market.code}</Link> },
    { key: 'payable', header: 'Payable', align: 'end', cell: (row) => <span className="whitespace-nowrap">{money(row.payable_minor, row)}</span> },
    { key: 'transit', header: 'In transit', align: 'end', cell: (row) => <span className="whitespace-nowrap">{money(row.in_transit_minor, row)}</span> },
    {
      key: 'receivable', header: 'Receivable', align: 'end', cell: (row) => (row.receivable_minor === '0'
        ? money(row.receivable_minor, row)
        : <Link className="text-primary hover:underline whitespace-nowrap" href={ledgerPath(row.market.id, 'accounts', { payee: detail.id, type: 'clawback_receivable' })}>{money(row.receivable_minor, row)}</Link>),
    },
  ]
  // 404: no posting of this payee in a market the user may read.
  const none = balances.error !== null && isNotAvailable(balances.error)
  return (
    <RecordCard id="balances-title" testId="balances" icon="account_balance" title="Balances by market">
      <p className={NOTE}>Payable is the earnings balance owed by the tenant; in transit is instructed and not settled; receivable is recovered from future earnings.</p>
      {none
        ? <p className={NOTE}>No balance in the markets you can see.</p>
        : <DataTable bare caption="Balances by market" columns={columns} rows={balances.data ?? []} rowKey={(row) => row.market.id} loading={balances.loading}
          error={tableError(balances)} empty={{ title: 'No balance.' }} stackOnPhone />}
    </RecordCard>
  )
}
