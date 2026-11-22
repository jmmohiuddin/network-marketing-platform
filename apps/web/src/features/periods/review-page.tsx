'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { ApprovalBar } from '../../components/approval-bar'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { LoadingState, NotAvailable } from '../../components/states'
import { TabPanel, Tabs } from '../../components/tabs'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure, useTabParam } from '../admin/page-states'
import { useIdempotencyKey } from '../admin/resource'
import { approverNames, noApproverText } from '../admin/settings/labels'
import { downloadCsv, saveFile } from '../data/transfer'
import { CommitDialog } from './commit-dialog'
import { WithholdingTab, withholdingLinesPath } from './withholding'
import { ledgerPath } from '../ledger/format'
import { hasResults, isFinished, isRunning, marketMoney, periodText, reviewPath, RUN_STATE_LABELS, signedMoney } from './format'
import { LinesTable } from './lines-tab'
import { AdjustmentsTab, ChangesTab, ExceptionsTab, MoversTab, VarianceTab } from './review-tabs'
import { CreditAwardsTab, TrueUpTab } from './true-up-tab'
import { useRunRequest } from './run-request'
import type { CommitRequest, PeriodDetail, PeriodList, RunDetail, RunReview } from './types'

const ID_PREFIX = 'review'
const FINANCE = 'Finance approver'

/** SC-02 Run review (FR-COMP-005/006): KPIs, review tabs, and the approval bar that requests or commits the run. */
export function RunReviewPage({ periodId, runId }: { readonly periodId: string; readonly runId: string }) {
  const { can } = useSession()
  if (!can('run.review')) return <NotAvailable />
  return <ReviewView periodId={periodId} runId={runId} />
}

function ReviewView({ periodId, runId }: { readonly periodId: string; readonly runId: string }) {
  const run = useResource<RunDetail>(`/v1/runs/${runId}`, undefined, (data) => isRunning(data.state))
  const period = useResource<PeriodDetail>(`/v1/periods/${periodId}`)
  const calendars = useResource<PeriodList>(period.data === null ? null : '/v1/periods', { calendar_id: period.data?.calendar_id, limit: 1 })
  const markets = useResource<Market[]>(MARKETS_PATH)
  const review = useResource<RunReview>(run.data !== null && hasResults(run.data.state) ? `/v1/runs/${runId}/review` : null)
  const failure = run.error ?? period.error ?? calendars.error ?? review.error
  if (failure !== null) return <LoadFailure error={failure} onRetry={() => [run, period, calendars, review].forEach((resource) => resource.reload())} />
  if (run.data === null || period.data === null || calendars.data === null) return <LoadingState label="Loading the run" />
  if (run.data.period_id !== periodId) return <NotAvailable />
  const calendar = calendars.data.calendars.find((candidate) => candidate.id === period.data!.calendar_id)
  const zone = calendar?.cutoff_time_zone
  const label = periodText(period.data, zone)
  const market = markets.data?.find((candidate) => candidate.id === period.data!.market_id)
  return <Review run={run.data} period={period.data} label={label} zone={zone} market={market} review={review.data} reload={() => [run, period, review].forEach((resource) => resource.reload())} />
}

interface ReviewProps {
  readonly run: RunDetail
  readonly period: PeriodDetail
  readonly label: string
  /** The calendar's cut-off zone, for period names. */
  readonly zone: string | undefined
  readonly market: Market | undefined
  readonly review: RunReview | null
  readonly reload: () => void
}

function Review({ run, period, label, zone, market, review, reload }: ReviewProps) {
  const api = useApi()
  const toast = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const { me, can, readOnly } = useSession()
  const runs = useRunRequest()
  const requestKey = useIdempotencyKey()
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set())
  const [request, setRequest] = useState<CommitRequest | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<'request' | 'export' | null>(null)
  const [committing, setCommitting] = useState(false)
  // PLAN B-MKT §5 SC-02 / BUG-131: the API lets tax.read and run.review read the run's tax lines (KPI); the tab and /tax need tax.read.
  const lineReader = (can('tax.read') || can('run.review')) && review !== null
  const taxReader = can('tax.read') && review !== null
  const taxLines = useResource<unknown[]>(lineReader ? '/v1/tax/lines' : null, { run_id: run.id, limit: 1 })
  // SC-02 advance banner: the final period's latest run review once it has results, else the final calendar.
  const finalPeriodId = run.provisional?.final_period_id ?? null
  const finalPeriod = useResource<PeriodDetail>(finalPeriodId === null ? null : `/v1/periods/${finalPeriodId}`)
  const finalRun = finalPeriod.data?.runs[0]
  const withheld = (taxLines.meta.totals as { readonly withheld_minor: string } | undefined)?.withheld_minor ?? null
  const tabs = [
    { id: 'variance', label: 'Variance' },
    { id: 'movers', label: 'Top movers', ...(review === null ? {} : { count: review.movers.length }) },
    { id: 'exceptions', label: 'Exceptions', ...(review === null ? {} : { count: review.exceptions.length }) },
    { id: 'lines', label: 'Lines' },
    { id: 'changes', label: 'What changed' },
    { id: 'adjustments', label: 'Adjustments', ...(review === null ? {} : { count: review.adjustments.reduce((sum, row) => sum + row.count, 0) }) },
    ...(taxReader && market !== undefined ? [{ id: 'withholding', label: 'Withholding' }] : []),
    ...(run.true_up === null ? [] : [{ id: 'true-up', label: 'True-up' }]),
    ...(BigInt(run.credit_awards_minor) > 0n ? [{ id: 'credit-awards', label: 'Credit awards' }] : []),
  ]
  const [tab, selectTab] = useTabParam(tabs)
  const write = (permission: string) => !readOnly && can(permission)
  const calculated = run.state === 'calculated'
  const involved = run.prepared_by.id === me.user.id || run.commit_requested_by === me.user.id
  // who may commit commits directly: requesting would make them the requester, whom the API refuses as committer
  const mayCommit = write('run.commit') && !involved
  const acknowledge = (id: string, on: boolean) => setAcknowledged((current) => new Set([...current].filter((value) => value !== id).concat(on ? [id] : [])))
  const ruleKeys = review?.variance.map((row) => row.rule_key) ?? []

  async function requestCommit() {
    setBusy('request')
    setProblem(null)
    try {
      const { data } = await api.post<CommitRequest>(`/v1/runs/${run.id}/request-commit`, {}, { idempotencyKey: requestKey })
      setRequest(data)
      toast({ message: 'Commit requested. Someone who may commit runs decides it.' })
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }
  async function exportLines() {
    setBusy('export')
    setProblem(null)
    try {
      const { blob, filename } = await downloadCsv(`/v1/runs/${run.id}/lines`, { format: 'csv' })
      saveFile(blob, filename)
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }
  async function rerun() {
    const id = await runs.start(period.id)
    if (id !== null) router.push(reviewPath(period.id, id))
  }

  const totals = review?.totals
  const previousGross = totals?.previous?.gross_minor
  const adjustments = review?.adjustments ?? []
  const syncStale = review?.exceptions.some((exception) => exception.id === 'sync_stale') ?? false
  // The request's answer names who may commit; after a reload only the time is known (GET /v1/runs carries no approvers).
  const commitState = request !== null
    ? (request.eligible_approvers.length === 0 ? noApproverText(FINANCE) : `Waiting for: ${approverNames(request.eligible_approvers)}`)
    : run.commit_requested_at === null ? undefined : `Commit requested ${formatDateTime(run.commit_requested_at)}`
  return (
    <div className={`flex flex-col gap-space-md${calculated ? ' pb-24' : ''}`}>
      <PageHeader
        title={`Run review — ${label}`}
        breadcrumbs={[{ label: 'Periods and runs', href: `/periods?calendar=${period.calendar_id}` }, { label: `Run ${shortId(run.id)}` }]}
        state={<StatusBadge state={run.state} label={RUN_STATE_LABELS[run.state]} />}
        summary={`${run.plan_version.plan.name} v${run.plan_version.version} · prepared by ${run.prepared_by.display_name ?? 'another user'} · ${formatDateTime(run.finished_at)}`}
        actions={<>
          {!readOnly && review !== null && <Button icon="download" loading={busy === 'export'} onClick={exportLines}>Export lines CSV</Button>}
          {(calculated || run.state === 'failed') && !isFinished(period.state) && write('run.execute') && <Button icon="restart_alt" loading={runs.busy === period.id} onClick={rerun}>Re-run</Button>}
        </>}
      />
      {run.state === 'failed' && <Banner tone="danger" title="The run failed">{run.error?.message ?? 'The calculation did not finish.'} {run.error === null ? '' : `(${run.error.code})`} Re-run the period after fixing the cause.</Banner>}
      {isRunning(run.state) && <Banner tone="info" title="Calculating">{run.progress ?? 'Waiting for a worker'}. This page updates when the run finishes.</Banner>}
      {run.state === 'discarded' && <Banner tone="warning" title="Superseded">A newer run of this period replaced this one; its results stay for reference.</Banner>}
      {run.state === 'committed' && (
        <Banner tone="success" title="Committed"
          action={run.journal_entry_id != null && can('ledger.read') ? <LinkButton icon="receipt_long" href={ledgerPath(period.market_id, undefined, { entry: run.journal_entry_id })}>Open the journal entry</LinkButton> : undefined}>
          Committed {formatDateTime(run.committed_at)}. The results of this period are fixed; corrections go through a restatement.{run.journal_entry_id === null ? ' No journal entry was posted for this run: either no payee had a non-zero amount, or the run was committed before the ledger existed.' : ''}
        </Banner>
      )}
      {run.provisional !== null && (
        <Banner tone="info" title="Advance run"
          action={finalPeriodId !== null && finalRun !== undefined && hasResults(finalRun.state)
            ? <LinkButton icon="fact_check" href={reviewPath(finalPeriodId, finalRun.id)}>Open the final period&apos;s review</LinkButton>
            : <LinkButton icon="calendar_month" href={`/periods?calendar=${run.provisional.final_calendar_id}`}>Open the final calendar</LinkButton>}>
          This period pays advances. The final period containing it calculates the full amount and deducts what this run pays; its True-up tab shows the difference per payee.
        </Banner>
      )}
      {syncStale && <Banner tone="warning" title="Order sync is not current">Orders may be missing from this run. Acknowledge it in Exceptions before committing, or re-run once the sync recovers.</Banner>}
      {runs.error !== null && <Banner tone="danger" title="The re-run was refused">{errorMessage(runs.error)}</Banner>}
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      {review === null ? (hasResults(run.state) && <LoadingState label="Loading the review" />) : (
        <>
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${lineReader ? 'xl:grid-cols-5' : 'xl:grid-cols-4'} gap-space-md`} data-testid="kpis">
            <KpiCard label="Gross" icon="payments" value={marketMoney(totals!.current.gross_minor, market)}
              delta={previousGross === undefined ? undefined : `${signedMoney((BigInt(totals!.current.gross_minor) - BigInt(previousGross)).toString(), market)} vs previous`}
              detail={previousGross === undefined ? 'No committed previous period' : undefined} />
            <KpiCard label="Lines" icon="reorder" value={totals!.current.line_count.toLocaleString()} detail={totals!.previous === null ? undefined : `${totals!.previous.line_count.toLocaleString()} previously`} />
            <KpiCard label="Payees" icon="groups" value={totals!.current.payee_count.toLocaleString()} detail={totals!.previous === null ? undefined : `${totals!.previous.payee_count.toLocaleString()} previously`} />
            <KpiCard label="Adjustments" icon="rule" value={marketMoney(adjustments.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n).toString(), market)}
              detail={`${adjustments.reduce((sum, row) => sum + row.count, 0)} lines from late items, clawbacks, restatements and manual adjustments`} />
            {lineReader && (
              <KpiCard label="Withheld" icon="gavel" value={withheld === null ? null : marketMoney(withheld, market)}
                detail={taxLines.error !== null ? 'The withholding total could not be loaded.'
                  : !taxReader ? 'Withheld from this run' : <Link className="text-primary font-semibold hover:underline" href={withholdingLinesPath(period.market_id, period.id, run.id)}>Withholding lines</Link>} />
            )}
          </div>
          <div>
            <Tabs label="Run review" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={selectTab} />
            <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
              {tab === 'variance' && <VarianceTab review={review} market={market} zone={zone} />}
              {tab === 'movers' && <MoversTab review={review} market={market} zone={zone} onLines={(id) => router.replace(`${pathname}?tab=lines&payee=${id}`)} />}
              {tab === 'exceptions' && <ExceptionsTab review={review} acknowledged={acknowledged} onAcknowledge={calculated && write('run.commit') ? acknowledge : null} />}
              {tab === 'lines' && <LinesTable runId={run.id} market={market} ruleKeys={ruleKeys} />}
              {tab === 'changes' && <ChangesTab review={review} runId={run.id} version={run.plan_version.version} />}
              {tab === 'adjustments' && <AdjustmentsTab review={review} market={market} runId={run.id} ruleKeys={ruleKeys} />}
              {tab === 'withholding' && market !== undefined && <WithholdingTab market={market} runId={run.id} />}
              {tab === 'true-up' && <TrueUpTab runId={run.id} market={market} zone={zone} />}
              {tab === 'credit-awards' && <CreditAwardsTab runId={run.id} market={market} />}
            </TabPanel>
          </div>
        </>
      )}
      {calculated && (
        <ApprovalBar
          preparedBy={`Prepared by ${run.prepared_by.id === me.user.id ? 'you' : run.prepared_by.display_name ?? 'another user'}`}
          preparedAt={formatDateTime(run.finished_at)}
          blockedReason={can('run.commit') && involved ? 'You prepared or requested this run, so someone else must commit it.' : undefined}
          approvers={commitState}
          actions={<>
            {run.commit_requested_at === null && request === null && write('run.execute') && !mayCommit && (
              <Button variant="primary" icon="send" loading={busy === 'request'} data-testid="primary-action" onClick={requestCommit}>Request commit</Button>
            )}
            {mayCommit && review !== null && (
              <Button variant="primary" icon="verified" data-testid="primary-action" onClick={() => setCommitting(true)}>Commit run</Button>
            )}
          </>}
        />
      )}
      {committing && review !== null && (
        <CommitDialog run={run} review={review} period={label} market={market} withheld={withheld} acknowledged={acknowledged} onAcknowledge={acknowledge}
          onClose={() => setCommitting(false)} onDone={() => {
            setCommitting(false)
            reload()
          }} />
      )}
    </div>
  )
}
