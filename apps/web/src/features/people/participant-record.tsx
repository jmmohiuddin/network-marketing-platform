'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button, LinkButton } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { TabPanel, Tabs } from '../../components/tabs'
import { formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure, useTabParam } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { MONO, NOTE, ROW_ACTIONS } from '../admin/ui'
import type { PositionView } from '../genealogy/types'
import { ACCOUNT_TYPES, parentOrigin, participantBadge, participantName, positionBadge, rangeText, servicingSource } from './format'
import { ServicerDialog, StatusDialog, statusChoices, TypeDialog, UnmaskDialog } from './record-dialogs'
import { PARTICIPANTS_PATH, type ContactField, type OwnedPosition, type ParticipantDetail, type ServicedCustomer, type ServicingEntry } from './types'
import { BalancesTab, BankingTab, HoldsTab, TaxTab } from './finance-tabs'
import { Facts, RecordCard } from './ui'
import { PortalAccess } from './portal-access'
import { Banner } from '../../components/banner'

const ID_PREFIX = 'participant'
const TABS = [
  { id: 'overview', label: 'Overview and identity' },
  { id: 'positions', label: 'Positions' },
  { id: 'types', label: 'Types history' },
  { id: 'servicing', label: 'Customer servicing' },
  { id: 'agreements', label: 'Agreements' },
  { id: 'cases', label: 'Cases' },
  { id: 'banking', label: 'Banking' },
  { id: 'tax', label: 'Tax' },
  { id: 'holds', label: 'Holds' },
  { id: 'balances', label: 'Balances' },
] as const

const CONTACT_FIELDS: readonly ContactField[] = ['email', 'phone', 'address']

const isCurrent = (from: string, to: string | null, now: number): boolean => Date.parse(from) <= now && (to === null || Date.parse(to) > now)

/** The type in force now, or null. */
export function currentType(detail: Pick<ParticipantDetail, 'types'>, now: number = Date.now()): ParticipantDetail['types'][number]['type'] | null {
  return detail.types.find((entry) => isCurrent(entry.valid_from, entry.valid_to, now))?.type ?? null
}

type Dialog =
  | { readonly kind: 'unmask' | 'type' | 'servicer' }
  | { readonly kind: 'status'; readonly position: OwnedPosition }

function Overview({ detail, onUnmask }: { readonly detail: ParticipantDetail; readonly onUnmask?: () => void }) {
  const masked = detail.contact_masked
  return (
    <RecordCard id="identity-title" testId="card" icon="fingerprint" title="Identity and contact (masked)"
      action={onUnmask === undefined ? undefined : <Button size="sm" icon="visibility" onClick={onUnmask}>Show contact</Button>}>
      <Facts items={[
        { label: 'Name', value: detail.display_name ?? 'Not recorded' },
        { label: 'External reference', value: <span className={MONO}>{detail.external_ref}</span> },
        { label: 'Account', value: ACCOUNT_TYPES[detail.account_type] },
        { label: 'Market', value: <span className={MONO}>{detail.market.code}</span> },
        { label: 'Enrolled', value: <span className={MONO}>{formatDateTime(detail.enrolled_at)}</span> },
        { label: 'Status', value: <StatusBadge {...participantBadge(detail.status)} /> },
        ...(detail.merged_into === null ? [] : [{ label: 'Merged into', value: <Link className="text-primary hover:underline" href={`/people/${detail.merged_into.id}`}>{detail.merged_into.external_ref}</Link> }]),
        { label: 'Email address', value: <span className={MONO}>{masked?.email ?? 'Not recorded'}</span> },
        { label: 'Phone', value: <span className={MONO}>{masked?.phone ?? 'Not recorded'}</span> },
        { label: 'Address', value: <span className={MONO}>{masked?.address ?? 'Not recorded'}</span> },
      ]} />
    </RecordCard>
  )
}

/** The position's sponsor now and how it came to be (W-B3-8: a re-parent names the plan rule). */
function SponsorNow({ positionId }: { readonly positionId: string }) {
  // shortcut: one GET /v1/positions/:id per row (a participant holds few positions); add parents to GET /v1/participants/:id if records grow.
  const position = useResource<PositionView>(`/v1/positions/${positionId}`)
  if (position.error !== null) return <span className={NOTE}>Could not be read</span>
  if (position.data === null) return <span className={NOTE}>Loading…</span>
  const sponsor = position.data.parents.sponsor
  if (sponsor === null) return <span className={NOTE}>None (top of the tree)</span>
  return (
    <span className="flex flex-col">
      <span className={MONO}>{sponsor.position_ref}</span>
      <span className={NOTE}>{parentOrigin(sponsor)}, since {formatDateTime(sponsor.valid_from)}</span>
    </span>
  )
}

function Positions({ detail, choicesOf, onStatus }: { readonly detail: ParticipantDetail; readonly choicesOf: (position: OwnedPosition) => readonly string[]; readonly onStatus?: (position: OwnedPosition) => void }) {
  const { can } = useSession()
  const columns: readonly DataTableColumn<OwnedPosition>[] = [
    {
      key: 'ref', header: 'Position', cell: (position) => can('genealogy.read')
        ? <Link className={`${MONO} text-primary hover:underline`} href={`/genealogy?root=${position.id}`}>{position.position_ref}</Link>
        : <span className={MONO}>{position.position_ref}</span>,
    },
    { key: 'market', header: 'Market', cell: (position) => <span className={MONO}>{position.market.code}</span> },
    { key: 'status', header: 'Status', cell: (position) => <StatusBadge {...positionBadge(position.status)} /> },
    { key: 'since', header: 'Status since', cell: (position) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(position.status_from)}</span> },
    { key: 'owned', header: 'Owned', cell: (position) => <span className={MONO}>{rangeText(position.owned_from, position.owned_to, formatDateTime)}</span> },
    ...(can('genealogy.read') ? [{ key: 'sponsor', header: 'Sponsor now', cell: (position: OwnedPosition) => <SponsorNow positionId={position.id} /> }] : []),
    {
      key: 'actions', header: 'Actions', align: 'end', cell: (position) => onStatus === undefined || position.owned_to !== null || choicesOf(position).length === 0
        ? null
        : <div className={ROW_ACTIONS}><Button size="sm" aria-label={`Change status of ${position.position_ref}`} onClick={() => onStatus(position)}>Change status</Button></div>,
    },
  ]
  return (
    <RecordCard id="positions-title" icon="account_tree" title="Positions owned">
      {detail.duplicate_hold && <p className={NOTE}>A duplicate review is open: a pending position cannot be activated until the case is decided.</p>}
      <DataTable bare caption="Positions owned" columns={columns} rows={detail.positions} rowKey={(position) => `${position.id}|${position.owned_from}`}
        empty={{ title: 'No position. Only types that can hold positions get one.' }} />
    </RecordCard>
  )
}

function Types({ detail, onChange }: { readonly detail: ParticipantDetail; readonly onChange?: () => void }) {
  const rows = [...detail.types].reverse()
  const columns: readonly DataTableColumn<ParticipantDetail['types'][number]>[] = [
    { key: 'type', header: 'Type', cell: (entry) => <div className="flex flex-col"><span className="font-semibold">{entry.type.name}</span><span className={`${MONO} text-secondary`}>{entry.type.code}</span></div> },
    { key: 'range', header: 'Valid', cell: (entry) => <span className={MONO}>{rangeText(entry.valid_from, entry.valid_to, formatDateTime)}</span> },
    { key: 'state', header: 'State', cell: (entry) => (isCurrent(entry.valid_from, entry.valid_to, Date.now()) ? <StatusBadge state="active" label="In force" /> : Date.parse(entry.valid_from) > Date.now() ? <StatusBadge state="scheduled" label="Scheduled" /> : <StatusBadge state="superseded" label="Ended" />) },
  ]
  return (
    <RecordCard id="types-title" icon="timeline" title="Effective-dated types"
      action={onChange === undefined ? undefined : <Button size="sm" icon="edit" onClick={onChange}>Change type</Button>}>
      <DataTable bare caption="Types history" columns={columns} rows={rows} rowKey={(entry) => `${entry.type.id}|${entry.valid_from}`} empty={{ title: 'No type recorded.' }} />
    </RecordCard>
  )
}

const CUSTOMER_COLUMNS: readonly DataTableColumn<ServicedCustomer>[] = [
  { key: 'customer', header: 'Customer', cell: (row) => <Link className="text-primary hover:underline" href={`/people/${row.participant.id}`}>{participantName(row.participant)}</Link> },
  { key: 'source', header: 'Source', cell: (row) => servicingSource(row.source) },
  { key: 'since', header: 'Since', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.valid_from)}</span> },
]

/** The customers one position services now (cursor pages, no invented totals). */
function PositionCustomers({ position }: { readonly position: OwnedPosition }) {
  const list = usePagedList<ServicedCustomer>(`/v1/positions/${position.id}/customers`)
  return (
    <div className="flex flex-col gap-space-xs">
      <h3 className="font-section-heading text-section-heading text-on-surface">Customers of <span className={MONO}>{position.position_ref}</span></h3>
      <DataTable bare caption={`Customers of ${position.position_ref}`} columns={CUSTOMER_COLUMNS} rows={list.rows} rowKey={(row) => row.participant.id}
        loading={list.loading} error={tableError(list)} pagination={list.pagination} empty={{ title: 'This position services no customer now.' }} />
    </div>
  )
}

const SERVICER_COLUMNS: readonly DataTableColumn<ServicingEntry>[] = [
  {
    key: 'servicer', header: 'Servicer', cell: (entry) => entry.position === null
      ? 'The company'
      // owner_name is the owner now: on an ended row it may not be who owned the position then (BUG-080).
      : <span><span className={MONO}>{entry.position.position_ref}</span>{entry.position.owner_name === null || entry.valid_to !== null ? '' : ` · ${entry.position.owner_name}`}</span>,
  },
  { key: 'source', header: 'Source', cell: (entry) => servicingSource(entry.source) },
  { key: 'range', header: 'Valid', cell: (entry) => <span className={MONO}>{rangeText(entry.valid_from, entry.valid_to, formatDateTime)}</span> },
]

function Servicing({ detail, onChange }: { readonly detail: ParticipantDetail; readonly onChange?: () => void }) {
  const history = useResource<readonly ServicingEntry[]>(`${PARTICIPANTS_PATH}/${detail.id}/servicing`)
  const owned = detail.positions.filter((position) => position.owned_to === null)
  return (
    <div className="flex flex-col gap-space-md">
      <RecordCard id="servicer-title" icon="support_agent" title="Who services this participant"
        action={onChange === undefined ? undefined : <Button size="sm" icon="swap_horiz" onClick={onChange}>Change servicer</Button>}>
        <DataTable bare caption="Servicer history" columns={SERVICER_COLUMNS} rows={history.data ?? []} rowKey={(entry) => entry.valid_from}
          loading={history.loading} error={tableError(history)} empty={{ title: 'No servicer recorded: servicing applies to end customers.' }} />
      </RecordCard>
      {owned.length > 0 && (
        <RecordCard id="customers-title" icon="people_alt" title="Customers serviced by these positions">
          {owned.map((position) => <PositionCustomers key={position.id} position={position} />)}
        </RecordCard>
      )}
    </div>
  )
}

function Agreements({ detail }: { readonly detail: ParticipantDetail }) {
  const columns: readonly DataTableColumn<ParticipantDetail['agreements'][number]>[] = [
    { key: 'version', header: 'Version', cell: (entry) => <span className="font-semibold">{entry.version.label}</span> },
    { key: 'accepted', header: 'Accepted', cell: (entry) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(entry.accepted_at)}</span> },
    { key: 'evidence', header: 'Evidence', cell: (entry) => (entry.evidence === null ? '—' : <span className={MONO}>{entry.evidence.channel} · {entry.evidence.reference}</span>) },
  ]
  return (
    <RecordCard id="agreements-title" icon="description" title="Agreement acceptances">
      <DataTable bare caption="Agreement acceptances" columns={columns} rows={detail.agreements} rowKey={(entry) => entry.version.id} empty={{ title: 'No agreement accepted.' }} />
    </RecordCard>
  )
}

/** Links to the case list, only for the case types the user can read (the list is "not available" otherwise). */
function Cases({ detail }: { readonly detail: ParticipantDetail }) {
  const { can, readOnly } = useSession()
  const caseLink = (type: 'participant' | 'position', id: string) => `/cases?subject_type=${type}&subject_id=${id}`
  const duplicates = can('case.duplicate.read')
  const genealogy = can('case.genealogy.read')
  return (
    <RecordCard id="cases-title" icon="gavel" title="Cases">
      <p className={NOTE}>Duplicate reviews are about the participant; genealogy changes, corrections and transfers are about a position.{!readOnly && can('case.genealogy.create') && ' Start a case from the page header.'}</p>
      {duplicates || genealogy
        ? (
          <ul className="flex flex-col gap-space-xs">
            {duplicates && <li><Link className="text-primary hover:underline" href={caseLink('participant', detail.id)}>Cases about {detail.external_ref}</Link></li>}
            {genealogy && detail.positions.map((position) => (
              <li key={`${position.id}|${position.owned_from}`}><Link className="text-primary hover:underline" href={caseLink('position', position.id)}>Cases about position {position.position_ref}</Link></li>
            ))}
          </ul>
        )
        : <p className={NOTE}>Cases are handled by support and compliance; your role cannot open them.</p>}
    </RecordCard>
  )
}

/**
 * SC-09 Participant record (FR-PAR-001/005/006, FR-CRM-001; PLAN B2 5): header with status and the duplicate-review
 * chip, then tabs in the URL (?tab=). Contact stays masked unless shown through the audited step-up dialog.
 */
export function ParticipantRecord({ participantId }: { readonly participantId: string }) {
  const { can, readOnly } = useSession()
  const record = useResource<ParticipantDetail>(`${PARTICIPANTS_PATH}/${participantId}`)
  // Balances only with ledger.read (GET /v1/payees/:id/balances).
  const tabs = TABS.filter((entry) => entry.id !== 'balances' || can('ledger.read'))
  const [tab, selectTab] = useTabParam(tabs)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  if (record.error !== null) return <LoadFailure error={record.error} onRetry={record.reload} />
  const detail = record.data
  if (detail === null) return <LoadingState label="Loading the participant" />
  const write = (permission: string) => !readOnly && can(permission)
  const erased = detail.pseudonymised_at != null
  const available = CONTACT_FIELDS.filter((field) => detail.contact_masked?.[field] !== undefined)
  const type = currentType(detail)
  const owned = detail.positions.filter((position) => position.owned_to === null)
  const firstPosition = owned[0]
  const choicesOf = (position: OwnedPosition) => statusChoices(position.status,
    { canManage: write('participant.manage'), canTerminate: write('participant.terminate'), duplicateHold: detail.duplicate_hold })
  const close = () => setDialog(null)
  const changed = () => {
    setDialog(null)
    record.reload()
  }
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'People', href: '/people' }, { label: detail.external_ref }]}
        title={detail.display_name ?? detail.external_ref}
        state={<span className="flex flex-wrap items-center gap-space-xs">
          <StatusBadge {...participantBadge(detail.status)} />
          {detail.duplicate_hold && <StatusBadge state="under_review" label="Duplicate review" />}
          {erased && <StatusBadge state="retired" label="Personal data erased" />}
        </span>}
        summary={`${detail.market.code} · ${type === null ? 'No type in force' : `${type.name} (${type.code})`} · enrolled ${formatDateTime(detail.enrolled_at)}`}
        actions={<>
          {can('genealogy.read') && firstPosition !== undefined && <LinkButton icon="account_tree" href={`/genealogy?root=${firstPosition.id}`}>Open in genealogy</LinkButton>}
          {detail.positions.length > 0 && <LinkButton icon="military_tech" href={`/people/${detail.id}/qualification`}>Qualification history</LinkButton>}
          {write('case.genealogy.create') && <LinkButton variant="primary" icon="rule" data-testid="primary-action" href={owned.length === 1 ? `/cases/genealogy/new?position=${owned[0]!.id}` : '/cases/genealogy/new'}>Start case</LinkButton>}
        </>}
      />
      <div>
        <Tabs label="Participant record" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={selectTab} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          {tab === 'overview' && (
            <div className="flex flex-col gap-space-md">
              {erased && (
                <Banner tone="info" title="Personal data erased">
                  Erased on {formatDateTime(detail.pseudonymised_at)} at the member’s request. Name, contact and identity document are cleared; positions, results and ledger postings are kept without the name.
                </Banner>
              )}
              <Overview detail={detail} onUnmask={write('participant.unmask') && available.length > 0 && !erased ? () => setDialog({ kind: 'unmask' }) : undefined} />
              <PortalAccess participantId={detail.id} erased={erased} />
            </div>
          )}
          {tab === 'positions' && <Positions detail={detail} choicesOf={choicesOf} onStatus={write('participant.manage') || write('participant.terminate') ? (position) => setDialog({ kind: 'status', position }) : undefined} />}
          {tab === 'types' && <Types detail={detail} onChange={write('participant.manage') && detail.status === 'active' ? () => setDialog({ kind: 'type' }) : undefined} />}
          {/* shortcut: "Change servicer" shows for participants without positions (end customers); the API refuses others with NOT_A_CUSTOMER. Upgrade when the record carries the type flags. */}
          {tab === 'servicing' && <Servicing detail={detail} onChange={write('servicing.manage') && detail.positions.length === 0 ? () => setDialog({ kind: 'servicer' }) : undefined} />}
          {tab === 'agreements' && <Agreements detail={detail} />}
          {tab === 'cases' && <Cases detail={detail} />}
          {tab === 'banking' && <BankingTab detail={detail} />}
          {tab === 'tax' && <TaxTab detail={detail} />}
          {tab === 'holds' && <HoldsTab detail={detail} />}
          {tab === 'balances' && <BalancesTab detail={detail} />}
        </TabPanel>
      </div>
      {dialog?.kind === 'unmask' && <UnmaskDialog participantId={detail.id} available={available} onClose={close} />}
      {dialog?.kind === 'status' && <StatusDialog position={dialog.position} choices={choicesOf(dialog.position)} onClose={close} onDone={changed} />}
      {dialog?.kind === 'type' && <TypeDialog participantId={detail.id} currentCode={type?.code ?? null} onClose={close} onDone={changed} />}
      {dialog?.kind === 'servicer' && <ServicerDialog customerId={detail.id} onClose={close} onDone={changed} />}
    </>
  )
}
