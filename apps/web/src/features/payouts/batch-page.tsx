'use client'

import { useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { ApprovalBar } from '../../components/approval-bar'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { ConfirmDialog, Modal } from '../../components/modal'
import { PageHeader } from '../../components/page-header'
import { LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { TabPanel, Tabs } from '../../components/tabs'
import { useToast } from '../../components/toast'
import { isApiError, newIdempotencyKey } from '../../lib/api'
import { countLabel, formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid, shortId } from '../admin/format'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { LoadFailure, useTabParam } from '../admin/page-states'
import { useIdempotencyKey } from '../admin/resource'
import { approverNames, noApproverText, withApprovers } from '../admin/settings/labels'
import { saveFile } from '../data/transfer'
import { marketMoney } from '../periods/format'
import { useKeptData } from '../plans/ui'
import { requiredError } from '../../lib/validation'
import { DormantTab, ExclusionsTab, IncludedTab, InstructionsTab } from './batch-tabs'
import { adapterText, BATCH_BADGES, batchPeriod, BATCH_STATE_LABELS, INSTRUCTION_STATE_LABELS, INSTRUCTION_STATES, payeeText } from './format'
import { BATCHES_PATH, type Batch, type Exclusion, type RetryResult } from './types'
import { CARD, LABEL, ReasonList, useMarkets } from './ui'

const ID_PREFIX = 'batch'
const APPROVER_ROLE = 'Finance approver'
const FILENAME = /filename="([^"]+)"/

type BatchDialog = 'approve' | 'cancel' | 'retry'

const name = (person: { readonly display_name: string | null } | null): string => person?.display_name ?? 'a user without a name'
const instructionTotal = (batch: Batch): number => Object.values(batch.instruction_counts).reduce((sum, n) => sum + (n ?? 0), 0)

/** Polls while the sandbox is still taking the approved instructions (accepted within a minute, D-B4-14). */
const dispatching = (batch: Batch): boolean => batch.state === 'approved' || (batch.state === 'instructing' && batch.provider.adapter === 'sandbox' && (batch.instruction_counts.pending ?? 0) > 0)

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-space-sm">
      <dt className="font-caption text-caption text-secondary">{label}</dt>
      <dd className="font-body-sm text-body-sm text-on-surface text-right break-words">{children}</dd>
    </div>
  )
}

/** sc_03 "Disbursement Inspector": totals strip, instruction counts and separation of duties. */
function BatchInspector({ batch, market, involved }: { readonly batch: Batch; readonly market: Market | undefined; readonly involved: boolean }) {
  const counts = INSTRUCTION_STATES.filter((state) => (batch.instruction_counts[state] ?? 0) > 0)
  return (
    <aside aria-labelledby="inspector-title" className={`${CARD} shadow-md overflow-hidden flex flex-col`}>
      <div className="p-space-md bg-surface-container text-on-surface flex items-center justify-between gap-space-sm">
        <h2 id="inspector-title" className="flex items-center gap-space-xs font-section-heading text-section-heading font-bold">
          <Icon name="fact_check" size={20} className="text-primary" />Batch inspector
        </h2>
        <StatusBadge state={BATCH_BADGES[batch.state]} label={BATCH_STATE_LABELS[batch.state]} />
      </div>
      <div className="p-space-md bg-surface-container-low flex flex-wrap items-baseline justify-between gap-space-sm">
        <div>
          <span className={LABEL}>Batch total</span>
          <div className="font-data-mono-lg text-data-mono-lg text-primary font-bold tracking-tight">{marketMoney(batch.total_minor, market)}</div>
        </div>
        <div className="text-right">
          <span className={LABEL}>Payees</span>
          <div className="font-data-mono-md text-data-mono-md text-on-surface font-bold">{batch.line_count.toLocaleString()} included · {batch.exclusions.length.toLocaleString()} excluded</div>
        </div>
      </div>
      <dl className="p-space-md flex flex-col gap-space-xs border-t border-surface-container">
        <Fact label="Provider">{batch.provider.provider} ({adapterText(batch.provider.adapter)})</Fact>
        <Fact label="Period">{batchPeriod(batch, market)}</Fact>
        <Fact label="Prepared">{name(batch.prepared_by)} · {formatDateTime(batch.created_at)}</Fact>
        {batch.submitted_by !== null && <Fact label="Submitted">{name(batch.submitted_by)} · {formatDateTime(batch.submitted_at)}</Fact>}
        {batch.approved_by !== null && <Fact label="Approved">{name(batch.approved_by)} · {formatDateTime(batch.approved_at)}</Fact>}
        {batch.cancelled_at !== null && <Fact label="Cancelled">{formatDateTime(batch.cancelled_at)}{batch.cancel_reason === null ? '' : `: ${batch.cancel_reason}`}</Fact>}
        {counts.length > 0 && (
          <Fact label="Instructions">{counts.map((state) => `${batch.instruction_counts[state]} ${INSTRUCTION_STATE_LABELS[state].toLowerCase()}`).join(' · ')}</Fact>
        )}
      </dl>
      {batch.state === 'reviewed' && (
        <div className="p-space-md border-t border-surface-container">
          <div className="p-space-sm rounded bg-amber-50 text-amber-900 border-l-4 border-amber-600 text-body-sm">
            <p className="flex items-center gap-1 font-bold font-section-heading"><Icon name="gavel" size={18} />Separation of duties</p>
            <p className="font-caption text-caption mt-1">The person who prepared or submitted this batch cannot approve it. Approval asks for a code from the approver&apos;s authenticator app.</p>
            {batch.eligible_approvers !== undefined && batch.eligible_approvers !== null && (
              <p className="font-caption text-caption mt-1">{batch.eligible_approvers.length === 0 ? noApproverText(APPROVER_ROLE) : `Can approve: ${approverNames(batch.eligible_approvers)}`}</p>
            )}
            {involved && <p className="font-caption text-caption mt-1 font-semibold">You prepared or submitted this batch, so someone else must approve it.</p>}
          </div>
        </div>
      )}
    </aside>
  )
}

/** sc_02-modal anatomy: totals strip, the "you did not prepare this" statement, step-up, a button naming amount and object. */
function ApproveDialog({ batch, market, onClose, onDone }: { readonly batch: Batch; readonly market: Market | undefined; readonly onClose: () => void; readonly onDone: (error?: unknown) => void }) {
  const api = useApi()
  const key = useIdempotencyKey()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = marketMoney(batch.total_minor, market)
  async function approve() {
    setBusy(true)
    setError(null)
    try {
      await api.post(`${BATCHES_PATH}/${batch.id}/approve`, undefined, { idempotencyKey: key })
      onDone()
    } catch (failure) {
      if (isApiError(failure, 'BATCH_RECALCULATED')) {
        onDone(failure)
        return
      }
      setError(errorMessage(withApprovers(failure, APPROVER_ROLE)))
      setBusy(false)
    }
  }
  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" icon="verified_user" loading={busy} onClick={approve}>Approve {total}</Button>
    </>
  )
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={`Approve batch ${shortId(batch.id)}`} size="lg" icon="encrypted" footer={footer}>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm bg-surface-container-low p-space-sm rounded">
        <div><dt className={LABEL}>Total</dt><dd className="font-data-mono-md text-data-mono-md font-bold text-on-surface">{total}</dd></div>
        <div><dt className={LABEL}>Payees paid</dt><dd className="font-data-mono-md text-data-mono-md font-bold text-on-surface">{batch.line_count.toLocaleString()}</dd></div>
        <div><dt className={LABEL}>Excluded</dt><dd className="font-data-mono-md text-data-mono-md font-bold text-on-surface">{batch.exclusions.length.toLocaleString()}</dd></div>
      </dl>
      <p>You did not prepare or submit this batch. Approving writes one signed instruction per payee to {batch.provider.provider} and moves {total} from payable to in transit. Payables are checked again first: if one changed, the batch returns to draft instead.</p>
      {batch.provider.adapter === 'sandbox' && <p>Sandbox provider — no real money moves.</p>}
      <p>You will be asked for a code from your authenticator app.</p>
      {error !== null && <Banner tone="danger" title="The batch was not approved">{error}</Banner>}
    </Modal>
  )
}

function CancelDialog({ batch, onClose, onDone }: { readonly batch: Batch; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = requiredError('why the batch is cancelled', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'cancel-reason', message: missing }] }
    return {
      items: [],
      fieldIds: { reason: 'cancel-reason' },
      send: async () => {
        await api.post(`${BATCHES_PATH}/${batch.id}/cancel`, { reason: reason.trim() }, { idempotencyKey })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={`Cancel batch ${shortId(batch.id)}`} submitLabel="Cancel batch" submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>Nothing is paid; every payee keeps their payable balance for the next batch. The batch stays on file as cancelled.</p>
      <TextAreaField id="cancel-reason" label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

/** The answer of retry-failed (or its 409 NOTHING_TO_RETRY): re-sent payees and the skipped ones with their reasons. */
function RetryOutcome({ sent, skipped, market }: { readonly sent: number; readonly skipped: readonly Exclusion[]; readonly market: Market | undefined }) {
  return (
    <Banner tone={sent === 0 ? 'warning' : 'success'} title={sent === 0 ? 'No failed payee can be paid again now' : `${countLabel(sent, 'instruction')} sent again`}>
      {skipped.length > 0 && (
        <ul className="flex flex-col gap-space-xs mt-space-xs">
          {skipped.map((row) => (
            <li key={row.participant.id}><span className="font-semibold">{payeeText(row.participant)}</span> was skipped: <ReasonList reasons={row.reasons} market={market} /></li>
          ))}
        </ul>
      )}
    </Banner>
  )
}

/** SC-03 batch detail (FR-PAY-001..003, D-B4-12..14): tabs, inspector and the approval bar. */
export function BatchPage({ batchId }: { readonly batchId: string }) {
  const valid = isUuid(batchId)
  const batch = useKeptData(useResource<Batch>(valid ? `${BATCHES_PATH}/${batchId}` : null, undefined, dispatching))
  const markets = useMarkets()
  if (!valid) return <NotAvailable />
  if (batch.error !== null) return <LoadFailure error={batch.error} onRetry={batch.reload} />
  if (batch.data === null) return <LoadingState label="Loading the batch" />
  return <BatchView batch={batch.data} market={markets.get(batch.data.market.id)} reload={batch.reload} />
}

function BatchView({ batch, market, reload }: { readonly batch: Batch; readonly market: Market | undefined; readonly reload: () => void }) {
  const api = useApi()
  const toast = useToast()
  const { me, can, readOnly } = useSession()
  const [dialog, setDialog] = useState<BatchDialog | null>(null)
  const [problem, setProblem] = useState<{ readonly title: string; readonly message: string; readonly tone: 'warning' | 'danger' } | null>(null)
  const [retry, setRetry] = useState<{ readonly sent: number; readonly skipped: readonly Exclusion[] } | null>(null)
  const [busy, setBusy] = useState<'submit' | 'file' | null>(null)
  const tabs = [
    { id: 'included', label: 'Included', count: batch.line_count },
    { id: 'exclusions', label: 'Exclusions and holds', count: batch.exclusions.length },
    { id: 'instructions', label: 'Instructions', count: instructionTotal(batch) },
    { id: 'dormant', label: 'Dormant balances' },
  ]
  const [tab, selectTab] = useTabParam(tabs)
  const involved = me.user.id === batch.prepared_by.id || me.user.id === batch.submitted_by?.id
  const open = batch.state === 'draft' || batch.state === 'reviewed'
  const withdrawn = batch.provider.state === 'withdrawn'
  const write = (permission: string) => !readOnly && can(permission)
  const canSubmit = batch.state === 'draft' && write('payout.prepare') && !withdrawn
  const canApprove = batch.state === 'reviewed' && write('payout.approve') && !involved && !withdrawn
  const canCancel = open && (write('payout.prepare') || write('payout.approve'))
  const canRetry = batch.state === 'failed' && write('payout.approve') && !involved && !withdrawn
  const canFile = (batch.state === 'instructing' || batch.state === 'partially_settled') && batch.provider.adapter === 'bank_file_csv' && write('payout.prepare')
  const total = marketMoney(batch.total_minor, market)

  function recalculated(error: unknown) {
    setProblem({ title: 'The batch was recalculated', message: errorMessage(error), tone: 'warning' })
    reload()
  }
  async function submit() {
    setBusy('submit')
    setProblem(null)
    try {
      await api.post(`${BATCHES_PATH}/${batch.id}/submit`, undefined, { idempotencyKey: newIdempotencyKey() })
      toast({ message: 'Batch submitted. A Finance approver approves it.' })
      reload()
    } catch (error) {
      if (isApiError(error, 'BATCH_RECALCULATED')) recalculated(error)
      else setProblem({ title: 'The batch was not submitted', message: errorMessage(error), tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }
  async function retryFailed() {
    try {
      const { data } = await api.post<RetryResult>(`${BATCHES_PATH}/${batch.id}/retry-failed`, undefined, { idempotencyKey: newIdempotencyKey() })
      setRetry({ sent: data.reinstructed.length, skipped: data.skipped })
    } catch (error) {
      if (!isApiError(error, 'NOTHING_TO_RETRY')) throw withApprovers(error, APPROVER_ROLE)
      setRetry({ sent: 0, skipped: (error.details as Pick<RetryResult, 'skipped'> | null)?.skipped ?? [] })
    }
    setDialog(null)
    reload()
  }
  async function bankFile() {
    setBusy('file')
    setProblem(null)
    try {
      const { data, headers } = await api.post<Blob>(`${BATCHES_PATH}/${batch.id}/bank-file`, undefined, { responseType: 'blob', headers: { Accept: 'text/csv' } })
      saveFile(data, FILENAME.exec(headers.get('content-disposition') ?? '')?.[1] ?? `payouts-${batch.id}.csv`)
      toast({ message: 'Bank file downloaded. Upload it to the bank; it is not stored here.' })
      reload()
    } catch (error) {
      setProblem({ title: 'The bank file was not generated', message: errorMessage(error), tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const actions = (
    <>
      {canCancel && <Button variant="destructive" icon="cancel" onClick={() => setDialog('cancel')}>Cancel batch</Button>}
      {canFile && <Button icon="file_download" loading={busy === 'file'} onClick={bankFile}>Generate bank file</Button>}
      {canRetry && <Button icon="replay" onClick={() => setDialog('retry')}>Retry failed lines</Button>}
      {canSubmit && <Button variant="primary" icon="send" loading={busy === 'submit'} onClick={submit}>Submit for approval</Button>}
      {canApprove && <Button variant="primary" icon="verified_user" onClick={() => setDialog('approve')}>Approve {total}</Button>}
    </>
  )
  const hasActions = canCancel || canFile || canRetry || canSubmit || canApprove
  const showBar = hasActions || batch.state === 'reviewed'
  const approvers = batch.eligible_approvers ?? null
  return (
    <div className={`flex flex-col gap-space-md${showBar ? ' pb-24' : ''}`}>
      <PageHeader
        title={`Payout batch ${shortId(batch.id)}`}
        breadcrumbs={[{ label: 'Payouts', href: '/payouts' }, { label: `Batch ${shortId(batch.id)}` }]}
        state={<StatusBadge state={BATCH_BADGES[batch.state]} label={BATCH_STATE_LABELS[batch.state]} />}
        summary={`${batch.market.code} · ${batch.provider.provider} · ${batchPeriod(batch, market)}`}
      />
      {batch.provider.adapter === 'sandbox' && (
        <Banner tone="info" title="Sandbox provider — no real money moves">Instructions go to the in-process sandbox; settlements and returns arrive as signed sandbox events.</Banner>
      )}
      {withdrawn && open && <Banner tone="warning" title="The provider approval was withdrawn">This batch can only be cancelled.</Banner>}
      {problem !== null && <Banner tone={problem.tone} title={problem.title}>{problem.message}</Banner>}
      {retry !== null && <RetryOutcome sent={retry.sent} skipped={retry.skipped} market={market} />}
      {/* Split from 1440, not sc_03's xl: the tab tables overflow a 7/12 column at 1280 (as SC-17). */}
      <div className="grid grid-cols-1 min-[1440px]:grid-cols-12 gap-space-md items-start">
        <section aria-label="Batch contents" className={`min-[1440px]:col-span-7 ${CARD} overflow-hidden min-w-0`} data-testid="card">
          <div className="px-space-md pt-space-sm">
            <Tabs label="Batch contents" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={selectTab} />
          </div>
          <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
            {tab === 'included' && <IncludedTab key={`${batch.state}-${batch.total_minor}`} batch={batch} market={market} />}
            {tab === 'exclusions' && <ExclusionsTab exclusions={batch.exclusions} market={market} />}
            {tab === 'instructions' && <InstructionsTab key={JSON.stringify(batch.instruction_counts)} batch={batch} market={market} />}
            {tab === 'dormant' && <DormantTab marketId={batch.market.id} market={market} />}
          </TabPanel>
        </section>
        <div className="min-[1440px]:col-span-5 min-w-0">
          <BatchInspector batch={batch} market={market} involved={involved && can('payout.approve')} />
        </div>
      </div>
      {showBar && (
        <ApprovalBar
          preparedBy={`Prepared by ${name(batch.prepared_by)}`}
          preparedAt={formatDateTime(batch.created_at)}
          blockedReason={batch.state === 'reviewed' && involved && can('payout.approve') && !readOnly ? 'You prepared or submitted this batch, so someone else must approve it.' : undefined}
          approvers={batch.state !== 'reviewed' || approvers === null ? undefined : approvers.length === 0 ? noApproverText(APPROVER_ROLE) : `Can approve: ${approverNames(approvers)}`}
          actions={hasActions ? actions : undefined}
        />
      )}
      {dialog === 'approve' && (
        <ApproveDialog
          batch={batch} market={market} onClose={() => setDialog(null)}
          onDone={(error) => {
            setDialog(null)
            if (error !== undefined) {
              recalculated(error)
              return
            }
            toast({ message: `Batch approved: ${countLabel(batch.line_count, 'instruction')} written.` })
            reload()
          }}
        />
      )}
      {dialog === 'cancel' && (
        <CancelDialog
          batch={batch} onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            toast({ message: 'Batch cancelled. Payables are unchanged.' })
            reload()
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === 'retry'} title="Retry failed lines" confirmLabel="Retry failed lines" onCancel={() => setDialog(null)} onConfirm={retryFailed}
        consequence={`Each failed payee is checked against every exclusion again and paid to their current bank details, at most what is payable now. You will be asked for a code from your authenticator app.`}
      />
    </div>
  )
}
