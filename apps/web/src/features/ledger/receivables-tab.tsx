'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { Select } from '../../components/form-field'
import { Modal } from '../../components/modal'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { isApiError, newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { requiredError } from '../../lib/validation'
import { shortId } from '../admin/format'
import { TextAreaField } from '../admin/form-dialog'
import { tableError, usePagedList } from '../admin/resource'
import { NOTE_MAX } from '../cases/case-form'
import { caseTypeInfo, reasonLabel } from '../cases/format'
import type { CaseRecord } from '../cases/types'
import { marketAmount, marketMoney } from '../periods/format'
import { BUCKET_LABELS, sumMinor } from './format'
import type { LedgerTabProps, Money } from './ledger-page'
import type { BucketTotal, Receivable } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const REASON_ID = 'write-off-reason'
const NOTE_ID = 'write-off-note'

const payeeName = (row: Receivable) => `${row.participant.external_ref}${row.participant.display_name === null ? '' : ` · ${row.participant.display_name}`}`

function EligibleChip({ eligible }: { readonly eligible: boolean | null }) {
  if (eligible === null) return <span className="font-caption text-caption text-secondary">Policy not set</span>
  return eligible ? <StatusBadge state="ready" label="Eligible" /> : <StatusBadge state="held" label="Needs two approvals" />
}

/** A retried submit whose earlier answer was lost: the case already left 'open' through a submit (CASE_STATE_CONFLICT). */
const SUBMITTED_STATES = new Set(['submitted', 'approved', 'rejected'])
function wasSubmitted(error: unknown): boolean {
  return isApiError(error, 'CASE_STATE_CONFLICT') && SUBMITTED_STATES.has(String((error.details as { state?: unknown } | null)?.state))
}

/** One payee's progress: the case once opened, then submitted or the refusal. */
interface Outcome {
  readonly caseId?: string
  readonly submitted?: boolean
  readonly error?: string
}

/**
 * "Propose write-off" (D-B4-08): a preview of the payees and total, then one write_off case per payee for its whole
 * receivable, each opened (POST /v1/cases, a key per identical body) and submitted. A retry skips what already
 * succeeded: a case opened before a failed submit is only submitted again.
 */
function WriteOffDialog({ rows, money, onClose, onDone }: { readonly rows: readonly Receivable[]; readonly money: Money; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const info = caseTypeInfo('write_off')!
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  // State, not derived: ErrorSummary takes focus whenever its items change.
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, Outcome>>>({})
  const [keys] = useState(() => new Map<string, string>())
  const [busy, setBusy] = useState(false)
  const total = sumMinor(rows.map((row) => row.balance_minor))

  async function propose(row: Receivable, previous: Outcome | undefined): Promise<Outcome> {
    let caseId = previous?.caseId
    try {
      if (caseId === undefined) {
        const body = { type: 'write_off', subject_type: 'ledger_account', subject_id: row.account_id, reason_code: reason, payload: { amount_minor: row.balance_minor, note: note.trim() } }
        const text = JSON.stringify(body)
        const key = keys.get(text) ?? newIdempotencyKey()
        keys.set(text, key)
        caseId = (await api.post<CaseRecord>('/v1/cases', body, { idempotencyKey: key })).data.id
      }
      await api.post(`/v1/cases/${caseId}/submit`, {})
      return { caseId, submitted: true }
    } catch (error) {
      if (wasSubmitted(error)) return { caseId, submitted: true }
      return { caseId, error: errorMessage(error) }
    }
  }

  async function submit() {
    const found = { [REASON_ID]: reason === '' ? 'Choose a reason.' : null, [NOTE_ID]: requiredError('the note', note) }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    setSummary(items)
    if (items.length > 0) return
    setBusy(true)
    let next = outcomes
    for (const row of rows) {
      if (next[row.account_id]?.submitted === true) continue
      next = { ...next, [row.account_id]: await propose(row, next[row.account_id]) }
      setOutcomes(next)
    }
    setBusy(false)
    if (rows.every((row) => next[row.account_id]?.submitted === true)) {
      toast({ message: `${rows.length === 1 ? 'One write-off case' : `${rows.length} write-off cases`} submitted for a decision.` })
      onDone()
    }
  }
  const started = Object.keys(outcomes).length > 0
  const footer = (
    <>
      <Button onClick={started ? onDone : onClose} disabled={busy}>{started ? 'Close' : 'Cancel'}</Button>
      <Button variant="primary" icon="send" loading={busy} onClick={submit}>{started ? 'Try the failed ones again' : `Open and submit ${rows.length === 1 ? 'one case' : `${rows.length} cases`}`}</Button>
    </>
  )
  return (
    <Modal open onClose={busy ? () => undefined : started ? onDone : onClose} title="Propose write-off" icon="remove_moderator" size="lg" footer={footer}
      description="One write-off case per payee for the whole receivable; each is decided by a Finance approver.">
      <div className="flex flex-col gap-space-md">
        <ErrorSummary items={summary} />
        <dl className="grid grid-cols-2 gap-space-sm p-space-sm rounded bg-surface-container-low" data-testid="write-off-preview">
          <div><dt className="font-caption text-caption text-secondary uppercase">Payees</dt><dd className={`${MONO} font-semibold`}>{rows.length}</dd></div>
          <div><dt className="font-caption text-caption text-secondary uppercase">Total</dt><dd className={`${MONO} font-semibold`}>{marketMoney(total, money)}</dd></div>
        </dl>
        <ul className="flex flex-col divide-y divide-surface-container" aria-label="Payees to write off">
          {rows.map((row) => {
            const outcome = outcomes[row.account_id]
            return (
              <li key={row.account_id} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-space-sm">
                <span className="font-body-sm text-body-sm">{payeeName(row)}</span>
                <span className={`${MONO} whitespace-nowrap`}>{marketMoney(row.balance_minor, money)}</span>
                {outcome?.submitted === true && <span className="w-full font-caption text-caption text-tertiary">Submitted: <Link className="text-primary hover:underline" href={`/cases/${outcome.caseId}`}>case {shortId(outcome.caseId!)}</Link></span>}
                {outcome?.error !== undefined && <span className="w-full font-caption text-caption text-error" role="alert">{outcome.caseId === undefined ? 'Not opened' : `Case ${shortId(outcome.caseId)} opened, not submitted`}: {outcome.error}</span>}
              </li>
            )
          })}
        </ul>
        <fieldset className="flex flex-col gap-space-md min-w-0" disabled={busy || started}>
          <Select id={REASON_ID} label="Reason" placeholder="Choose a reason" value={reason} error={errors[REASON_ID]}
            options={(info.reasonCodes ?? []).map((code) => ({ value: code, label: reasonLabel(code) }))} onChange={(event) => setReason(event.target.value)} />
          <TextAreaField id={NOTE_ID} label="Note" helper="Why these receivables cannot be recovered; kept with each case." maxLength={NOTE_MAX} value={note} error={errors[NOTE_ID]} onChange={setNote} />
        </fieldset>
      </div>
    </Modal>
  )
}

/** Receivables of the market by age, with write-off eligibility; selected rows are proposed for write-off. */
export function ReceivablesTab({ marketId, money, onChanged }: LedgerTabProps & { readonly onChanged: () => void }) {
  const { can, readOnly } = useSession()
  const list = usePagedList<Receivable>('/v1/ledger/receivables', { market_id: marketId })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [proposing, setProposing] = useState(false)
  const canPropose = !readOnly && can('case.write_off.create')
  const totals = (list.meta.totals_by_bucket ?? []) as readonly BucketTotal[]
  const policyUnset = list.rows.some((row) => row.write_off_eligible === null)
  const selectable = (row: Receivable) => canPropose && row.open_write_off_case_id === null && row.write_off_eligible !== null
  const chosen = list.rows.filter((row) => selected.has(row.account_id) && selectable(row))
  const toggle = (id: string, on: boolean) => setSelected((current) => new Set([...current].filter((value) => value !== id).concat(on ? [id] : [])))
  const columns: readonly DataTableColumn<Receivable>[] = [
    {
      key: 'payee', header: 'Payee', cell: (row) => (
        <span className="flex items-start gap-space-sm">
          {selectable(row) && <input type="checkbox" className="mt-0.5 w-4 h-4 accent-primary" aria-label={`Select ${row.participant.external_ref}`} checked={selected.has(row.account_id)} onChange={(event) => toggle(row.account_id, event.target.checked)} />}
          <Link className="text-primary font-semibold hover:underline" href={`/people/${row.participant.id}?tab=balances`}>{payeeName(row)}</Link>
        </span>
      ),
    },
    { key: 'balance', header: `Receivable (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap font-semibold">{marketAmount(row.balance_minor, money)}</span> },
    { key: 'since', header: 'Outstanding since', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.outstanding_since)}</span> },
    { key: 'age', header: 'Age', cell: (row) => <span className="flex flex-col"><span>{row.age_days === 1 ? '1 day' : `${row.age_days} days`}</span><span className="font-caption text-caption text-secondary">{BUCKET_LABELS[row.bucket]}</span></span> },
    { key: 'eligible', header: 'Write-off', cell: (row) => <EligibleChip eligible={row.write_off_eligible} /> },
    { key: 'case', header: 'Open case', cell: (row) => (row.open_write_off_case_id === null ? '—' : <Link className={`${MONO} text-primary hover:underline`} href={`/cases/${row.open_write_off_case_id}`}>{shortId(row.open_write_off_case_id)}</Link>) },
  ]
  return (
    <>
      <ul className="grid grid-cols-2 xl:grid-cols-4 gap-space-sm" aria-label="Receivables by age">
        {totals.map((total) => (
          <li key={total.bucket} className="p-space-sm rounded bg-surface-container-low flex flex-col">
            <span className="font-caption text-caption text-secondary uppercase">{BUCKET_LABELS[total.bucket]} · {total.count}</span>
            <span className={`${MONO} font-semibold`}>{marketMoney(total.amount_minor, money)}</span>
          </li>
        ))}
      </ul>
      {policyUnset && <Banner tone="info" title="No write-off policy is set">Eligibility is not shown and write-offs cannot be proposed until a write-off policy is approved on Settings.</Banner>}
      {canPropose && (
        <div className="flex flex-wrap items-center justify-between gap-space-sm" role="group" aria-label="Selection">
          <span className="font-caption text-caption text-secondary">{chosen.length === 0 ? 'Select receivables to propose their write-off.' : `${chosen.length} selected`}</span>
          {chosen.length > 0 && <Button variant="primary" icon="remove_moderator" data-testid="primary-action" onClick={() => setProposing(true)}>Propose write-off</Button>}
        </div>
      )}
      <DataTable caption="Receivables" columns={columns} rows={list.rows} rowKey={(row) => row.account_id} loading={list.loading} error={tableError(list)}
        empty={{ title: 'No receivable: no clawback is waiting to be recovered in this market' }} pagination={list.pagination} stackOnPhone />
      {proposing && (
        <WriteOffDialog rows={chosen} money={money} onClose={() => setProposing(false)} onDone={() => {
          setProposing(false)
          setSelected(new Set())
          list.reload()
          onChanged()
        }} />
      )}
    </>
  )
}
