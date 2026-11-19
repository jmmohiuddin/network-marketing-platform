'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { MeterBar } from '../../components/charts'
import { Icon } from '../../components/icon'
import { PageHeader } from '../../components/page-header'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { ApiError, isApiError, newIdempotencyKey } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { GateInspector } from './gate-inspector'
import { GateTable } from './gate-table'
import { ProviderDialog, ReviewDateDialog, WithdrawProviderDialog } from './provider-dialogs'
import { DecisionDialog, RequestHistory, SignOffBar } from './sign-off'
import type { Checklist, ChecklistItem, DocumentLimits, GoLiveRequest, ProviderRecord } from './types'

type Open =
  | { readonly kind: 'provider'; readonly providerKind: 'payout' | 'payment' }
  | { readonly kind: 'withdraw-provider'; readonly record: ProviderRecord }
  | { readonly kind: 'review-provider'; readonly record: ProviderRecord }
  | { readonly kind: 'decision'; readonly decision: 'approve' | 'reject' | 'withdraw' }

interface StripCardProps {
  readonly label: string
  readonly icon: string
  readonly value: string
  readonly detail: string
  /** The first card of the page carries the visual harness's card test id. */
  readonly first?: boolean
  readonly children?: ReactNode
}

/** sc_17 summary strip card (bordered, rounded-sm; not the sc_01 KpiCard). */
function StripCard({ label, icon, value, detail, first = false, children }: StripCardProps) {
  return (
    <div data-testid={first ? 'card' : undefined} className="p-space-sm bg-surface-container-lowest border border-outline-variant rounded-sm flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="font-caption text-caption text-secondary uppercase font-semibold">{label}</span>
        <Icon name={icon} size={18} className="text-primary" />
      </div>
      <span className="mt-2 font-data-mono-lg text-data-mono-lg text-on-surface tabular-nums">{value}</span>
      <span className="mt-1 font-caption text-caption text-on-surface-variant">{detail}</span>
      {children !== undefined && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

/** CHECKLIST_INCOMPLETE details.missing as summary items linked to each item's row. */
export function missingItems(error: unknown): SummaryItem[] {
  if (!(error instanceof ApiError)) return [{ message: errorMessage(error) }]
  const missing = (error.details as { missing?: { item: string; title: string; reason: string }[] } | null)?.missing
  if (error.code !== 'CHECKLIST_INCOMPLETE' || missing === undefined) return [{ message: errorMessage(error) }]
  return missing.map((item) => ({ fieldId: `gate-${item.item}`, message: `${item.title}: ${item.reason}` }))
}

/** ?item= (inspected item) and ?filter= (category) in the URL (UI_UX §4.7). */
function useParam(name: string): readonly [string | null, (value: string) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  return [params.get(name), (value: string) => {
    const next = new URLSearchParams(params.toString())
    next.set(name, value)
    router.replace(`${pathname}?${next.toString()}`)
  }] as const
}

/** What the market's state means for enrolments and orders (BUG-059: the header changes once it is live). */
export function stateSentence(code: string, state: Checklist['market']['state']): string {
  if (state === 'live') return `${code} is live: enrolments and orders for it are accepted.`
  if (state === 'suspended') return `${code} is suspended.`
  return `Enrolments and orders for ${code} are accepted only once it is live.`
}

/** Titles of the mandatory pack rules still at screening: signing off accepts their risk in writing (FR-CPL-012). */
export function screeningRules(checklist: Checklist): string[] {
  return checklist.items
    .filter((item) => item.status === 'needs_risk_acceptance')
    .flatMap((item) => item.detail?.rules ?? [])
    .filter((rule) => rule.mandatory && rule.basis_status === 'screening')
    .map((rule) => rule.title)
}

/**
 * Why the user cannot record the item now, or null when they can. Provider approvals stay open on a live market:
 * its payouts need one recorded there (BUG-099, PLAN B4 W-B4-0), and the API takes them until a go-live request waits.
 */
function lockedReason(checklist: Checklist, canPrepare: boolean, item: ChecklistItem): string | null {
  if (!canPrepare) return 'Only users who prepare market launches record entries.'
  if (checklist.market.state !== 'draft' && item.kind !== 'provider') return 'The market is live: its checklist is closed.'
  if (checklist.pending_request !== null) return 'Entries are locked while a go-live request waits for sign-off. Withdraw it to change them.'
  return null
}

/** SC-17 Market launch checklist (FR-TEN-004, FR-CPL-012; Stitch sc_17 in the sc_01 shell). */
export function ChecklistPage({ marketId }: { readonly marketId: string }) {
  const api = useApi()
  const toast = useToast()
  const { can, readOnly } = useSession()
  const checklist = useResource<Checklist>(`/v1/markets/${marketId}/checklist`)
  const history = useResource<readonly GoLiveRequest[]>(`/v1/markets/${marketId}/go-live-requests`)
  const providers = useResource<readonly ProviderRecord[]>('/v1/provider-configs', { market_id: marketId })
  const canPrepare = can('market.manage') && !readOnly
  const limits = useResource<DocumentLimits>(canPrepare ? '/v1/documents/limits' : null)
  const [itemParam, inspect] = useParam('item')
  const [filter, setFilter] = useParam('filter')
  const [open, setOpen] = useState<Open | null>(null)
  const [requestKey, setRequestKey] = useState(newIdempotencyKey)
  const [requesting, setRequesting] = useState(false)
  const [problems, setProblems] = useState<readonly SummaryItem[]>([])
  if (checklist.error !== null) return <LoadFailure error={checklist.error} onRetry={checklist.reload} />
  const data = checklist.data
  if (data === null) return <LoadingState label="Loading the launch checklist" />
  const reload = () => {
    setOpen(null)
    // A refusal lists the checklist as it was when go-live was requested; once anything is recorded the banner's live list replaces it (BUG-053).
    setProblems([])
    checklist.reload()
    history.reload()
    providers.reload()
  }
  async function requestGoLive() {
    setRequesting(true)
    try {
      await api.post(`/v1/markets/${marketId}/go-live-requests`, {}, { idempotencyKey: requestKey })
      setRequestKey(newIdempotencyKey())
      setProblems([])
      toast({ message: `Go-live of ${data!.market.code} requested. A Compliance officer signs it off.` })
      reload()
    } catch (error) {
      // The summary links to each missing item's row: every row must be shown for its link to land.
      if (isApiError(error, 'CHECKLIST_INCOMPLETE') && filter !== null && filter !== 'all') setFilter('all')
      setProblems(missingItems(error))
    } finally {
      setRequesting(false)
    }
  }
  const { market, summary, pending_request: pending } = data
  const selected = data.items.find((item) => item.item === itemParam) ?? data.items.find((item) => item.status !== 'complete') ?? data.items[0]!
  const missing = data.items.filter((item) => item.status === 'missing')
  const canRequest = canPrepare && market.state === 'draft' && pending === null
  return (
    <div className={pending === null ? 'flex flex-col gap-space-md' : 'flex flex-col gap-space-md pb-24'}>
      <PageHeader
        title={`Launch checklist: ${market.name} (${market.code})`}
        state={<StatusBadge state={market.state} />}
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Markets', href: '/settings/markets' }, { label: market.code }]}
        summary={`Market pack ${market.market_pack}. ${stateSentence(market.code, market.state)}`}
        actions={canRequest ? <Button variant="primary" icon="verified_user" data-testid="primary-action" loading={requesting} onClick={requestGoLive}>Request go-live</Button> : undefined}
      />
      <ErrorSummary items={problems} title="Go-live cannot be requested yet" />
      {market.state === 'draft' && missing.length > 0 && (
        <Banner tone="danger" title={`${market.code} is not live: ${missing.length === 1 ? '1 item is' : `${missing.length} items are`} missing`}>
          Missing: {missing.map((item) => item.title).join(', ')}.
        </Banner>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-sm">
        <StripCard first label="Complete" icon="task_alt" value={`${summary.complete} of ${data.items.length}`} detail="Mandatory items">
          <MeterBar percent={(summary.complete / data.items.length) * 100} label={`${summary.complete} of ${data.items.length} items complete`} />
        </StripCard>
        <StripCard label="Missing" icon="block" value={String(summary.missing)} detail="Block a go-live request" />
        <StripCard label="Needs risk acceptance" icon="gavel" value={String(summary.needs_risk_acceptance)} detail="Signed off only with a written statement" />
        <StripCard label="Market state" icon="public" value={market.state === 'live' ? 'Live' : market.state === 'draft' ? 'Draft' : 'Suspended'} detail={pending === null ? 'No request waiting' : 'Go-live waiting for sign-off'} />
      </div>
      <div className="grid grid-cols-1 min-[1440px]:grid-cols-12 gap-space-md items-start">
        <GateTable items={data.items} filter={filter ?? 'all'} onFilter={setFilter} selected={selected.item} onInspect={inspect} providers={providers.data} />
        <GateInspector
          marketId={marketId}
          item={selected}
          locked={lockedReason(data, canPrepare, selected)}
          limits={limits}
          providers={providers}
          onRecorded={reload}
          onRecordProvider={(providerKind) => setOpen({ kind: 'provider', providerKind })}
          onWithdrawProvider={(record) => setOpen({ kind: 'withdraw-provider', record })}
          onSetProviderReview={canPrepare ? (record) => setOpen({ kind: 'review-provider', record }) : null}
        />
      </div>
      <RequestHistory requests={history} />
      {pending !== null && <SignOffBar checklist={data} request={pending} onDecide={(decision) => setOpen({ kind: 'decision', decision })} />}
      {open?.kind === 'provider' && limits.data !== null && <ProviderDialog marketId={marketId} kind={open.providerKind} limits={limits.data} onClose={() => setOpen(null)} onSaved={reload} />}
      {open?.kind === 'withdraw-provider' && <WithdrawProviderDialog record={open.record} onClose={() => setOpen(null)} onSaved={reload} />}
      {open?.kind === 'review-provider' && <ReviewDateDialog record={open.record} onClose={() => setOpen(null)} onSaved={reload} />}
      {open?.kind === 'decision' && pending !== null && (
        <DecisionDialog request={pending} decision={open.decision} marketCode={market.code} riskRules={screeningRules(data)} onClose={() => setOpen(null)} onDone={reload} />
      )}
    </div>
  )
}
