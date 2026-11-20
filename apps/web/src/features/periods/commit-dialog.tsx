'use client'

import { useId, useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { Checkbox } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { Modal } from '../../components/modal'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { summaryOf } from '../admin/form-dialog'
import { withApprovers } from '../admin/settings/labels'
import { exceptionText, marketMoney, supersededText } from './format'
import type { RunDetail, RunReview } from './types'

const TILE = 'bg-surface-container-lowest p-space-sm rounded shadow-sm min-w-0'
const TILE_LABEL = 'font-caption text-caption text-secondary block'
const TILE_VALUE = 'font-data-mono-md text-data-mono-md text-on-surface font-bold block pt-1 break-words'

interface CommitDialogProps {
  readonly run: RunDetail
  readonly review: RunReview
  readonly period: string
  readonly market: Market | undefined
  /** The run's withholding total (tax.read holders, BUG-131); null when not known. */
  readonly withheld: string | null
  readonly acknowledged: ReadonlySet<string>
  readonly onAcknowledge: (id: string, on: boolean) => void
  readonly onClose: () => void
  readonly onDone: () => void
}

/**
 * sc_02 commit dialog (FR-COMP-006, API-20): totals, one acknowledgement per blocking exception, then POST commit.
 * The API asks for a fresh second factor (TOTP step-up, handled by ApiProvider) and refuses the preparer (SoD, with
 * the people who can commit named). One Idempotency-Key per identical body.
 */
export function CommitDialog({ run, review, period, market, withheld, acknowledged, onAcknowledge, onClose, onDone }: CommitDialogProps) {
  const api = useApi()
  const toast = useToast()
  const formId = useId()
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState<{ readonly key: string; readonly body: string } | null>(null)
  const blocking = review.exceptions.filter((exception) => exception.blocking)
  const totals = review.totals.current
  const adjustments = review.adjustments.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n).toString()
  const gross = marketMoney(totals.gross_minor, market)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const missing = blocking.filter((exception) => !acknowledged.has(exception.id))
    if (missing.length > 0) {
      setSummary(missing.map((exception) => ({ fieldId: `ack-${exception.id}`, message: `Acknowledge: ${exceptionText(exception)}` })))
      return
    }
    const body = { acknowledged_exceptions: blocking.map((exception) => exception.id) }
    const text = JSON.stringify(body)
    const key = attempt !== null && attempt.body === text ? attempt.key : newIdempotencyKey()
    setAttempt({ key, body: text })
    setSummary([])
    setBusy(true)
    try {
      await api.post(`/v1/runs/${run.id}/commit`, body, { idempotencyKey: key })
      toast({ message: `Run committed: ${period} is now committed.` })
      onDone()
    } catch (error) {
      setSummary(summaryOf(withApprovers(supersededText(error), 'Finance approver')))
      setBusy(false)
    }
  }

  const footer = (
    <>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" form={formId} variant="primary" icon="enhanced_encryption" loading={busy}>Commit run {gross}</Button>
    </>
  )
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title="Commit run" size="lg" icon="gavel" description={`${period} · run prepared by ${run.prepared_by.display_name ?? 'another user'}`} footer={footer}>
      <form id={formId} className="flex flex-col gap-space-md" noValidate onSubmit={submit}>
        <ErrorSummary items={summary} />
        <div className="p-space-md rounded-lg bg-tertiary-fixed/25 flex items-start gap-space-md">
          <Icon name="verified_user" size={20} filled className="text-tertiary mt-0.5 shrink-0" />
          <p className="font-body-sm text-body-sm text-on-surface">
            Prepared by <strong className="font-semibold">{run.prepared_by.display_name ?? 'another user'}</strong> on {formatDateTime(run.finished_at)}. You did not prepare or request this run, so you may commit it.
          </p>
        </div>
        <section className="bg-surface-container-low rounded-lg p-space-md flex flex-col gap-space-sm" aria-labelledby={`${formId}-totals`}>
          <h3 id={`${formId}-totals`} className="font-caption text-caption text-secondary uppercase font-semibold tracking-wide">Run totals</h3>
          <dl className={`grid grid-cols-2 ${withheld === null ? 'md:grid-cols-4' : 'md:grid-cols-5'} gap-space-sm`}>
            <div className={TILE}><dt className={TILE_LABEL}>Gross</dt><dd className={TILE_VALUE}>{gross}</dd></div>
            <div className={TILE}><dt className={TILE_LABEL}>Lines</dt><dd className={TILE_VALUE}>{totals.line_count.toLocaleString()}</dd></div>
            <div className={TILE}><dt className={TILE_LABEL}>Payees</dt><dd className={TILE_VALUE}>{totals.payee_count.toLocaleString()}</dd></div>
            <div className={TILE}><dt className={TILE_LABEL}>Adjustments</dt><dd className={TILE_VALUE}>{marketMoney(adjustments, market)}</dd></div>
            {withheld !== null && <div className={TILE}><dt className={TILE_LABEL}>Withheld</dt><dd className={TILE_VALUE}>{marketMoney(withheld, market)}</dd></div>}
          </dl>
        </section>
        <fieldset className="flex flex-col gap-space-xs min-w-0">
          <legend className="font-caption text-caption uppercase tracking-wider font-semibold text-secondary mb-space-xs">
            Blocking exceptions ({blocking.filter((exception) => acknowledged.has(exception.id)).length} of {blocking.length} acknowledged)
          </legend>
          {blocking.length === 0 ? <p className="font-body-sm text-body-sm text-secondary">No exception blocks this commit.</p> : blocking.map((exception) => (
            <Checkbox key={exception.id} id={`ack-${exception.id}`} className="p-space-sm rounded bg-surface-container-lowest shadow-sm" label={exceptionText(exception)}
              checked={acknowledged.has(exception.id)} onChange={(event) => onAcknowledge(exception.id, event.target.checked)} />
          ))}
        </fieldset>
        <div className="p-space-md rounded-lg bg-error-container/30 flex items-start gap-space-md">
          <Icon name="warning" size={24} className="text-error shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Committing locks the results of <strong className="text-on-surface font-semibold">{period}</strong>: they are never edited afterwards, and corrections go through a restatement. Committing posts one journal entry for this run’s payables and receivables. You are asked for a code from your authenticator app if your last verification is not recent.
          </p>
        </div>
      </form>
    </Modal>
  )
}
