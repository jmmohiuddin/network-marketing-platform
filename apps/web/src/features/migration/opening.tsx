'use client'

import { useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { FileDropZone } from '../../components/file-drop-zone'
import { TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { ApiError, newIdempotencyKey } from '../../lib/api'
import { countLabel, formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { tableError, usePagedList } from '../admin/resource'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { withApprovers } from '../admin/settings/labels'
import { inSentence, personName } from '../cases/format'
import { Panel, NOTE } from '../data/ui'
import { decimalToMinor, ledgerPath } from '../ledger/format'
import { minorToDecimal } from '../orders/format'
import { marketMoney, signedMoney } from '../periods/format'
import { MIGRATIONS_PATH, stateText } from './format'
import { Findings } from './findings'
import type { Finding, Migration, OpeningRow } from './types'

type MoneyMarket = Pick<Market, 'currency' | 'minor_unit'> | undefined

/** A problem found before sending (no file, no market, no control total), shown as written. */
class InputProblem extends Error {}

/** A refused opening upload: both totals, the file's findings, or the server's sentence. */
function refusalOf(error: unknown, market: MoneyMarket): { readonly message: string; readonly findings: readonly Finding[] } {
  if (error instanceof InputProblem) return { message: error.message, findings: [] }
  if (!(error instanceof ApiError)) return { message: errorMessage(error), findings: [] }
  const details = (error.details ?? {}) as { control_total_minor?: string; total_minor?: string; findings?: readonly Finding[] }
  if (error.code === 'CONTROL_TOTAL_MISMATCH') {
    return { message: `The amounts sum to ${marketMoney(details.total_minor, market)}, not the control total ${marketMoney(details.control_total_minor, market)}. Nothing was staged.`, findings: [] }
  }
  return { message: errorMessage(error), findings: details.findings ?? [] }
}

/** One CSV upload (PUT text/csv) that replaces the staged rows of its kind. */
function CsvUpload({ id, label, columns, market, onSend, extra }: {
  readonly id: string
  readonly market: MoneyMarket
  readonly label: string
  readonly columns: string
  readonly onSend: (text: string) => Promise<string>
  readonly extra?: (busy: boolean) => ReactNode
}) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<unknown>(null)
  const [done, setDone] = useState<string | null>(null)
  async function send() {
    if (file === null) return setProblem(new InputProblem(`Choose the ${label.toLowerCase()} file.`))
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      setDone(await onSend(await file.text()))
    } catch (error) {
      setProblem(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-space-sm p-space-sm rounded-lg bg-surface-container-low">
      <FileDropZone id={id} label={label} extensions={['.csv']} disabled={busy} onFiles={(files) => setFile(files[0] ?? null)} />
      <p className={NOTE}>Columns: <span className="font-data-mono-sm text-data-mono-sm">{columns}</span></p>
      {extra?.(busy)}
      <div className="flex justify-end"><Button icon="upload_file" loading={busy} onClick={send}>Upload {label.toLowerCase()}</Button></div>
      {done !== null && <p role="status" className="font-body-sm text-body-sm text-on-surface">{done}</p>}
      {problem !== null && <Problem error={problem} market={market} />}
    </div>
  )
}

function Problem({ error, market }: { readonly error: unknown; readonly market: MoneyMarket }) {
  const { message, findings } = refusalOf(error, market)
  return (
    <Banner tone="danger" title="Not staged">
      <p>{message}</p>
      {findings.length > 0 && <Findings findings={findings} />}
    </Banner>
  )
}

/** Approve or reject the submitted opening (migration.signoff, step-up, not the submitter). Mount only while open. */
function DecisionDialog({ migration, decision, onClose, onDecided }: { readonly migration: Migration; readonly decision: 'approve' | 'reject'; readonly onClose: () => void; readonly onDecided: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const approve = decision === 'approve'
  function submit(idempotencyKey: string) {
    const missing = reason.trim() === '' ? 'Enter the reason for your decision.' : null
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'opening-reason', message: missing }] }
    return {
      items: [], fieldIds: { reason: 'opening-reason' },
      send: async () => {
        try {
          await api.post(`${MIGRATIONS_PATH}/${migration.id}/opening/decision`, { decision, reason: reason.trim() }, { idempotencyKey })
        } catch (failure) {
          throw withApprovers(failure, 'Finance approver')
        }
        toast({ message: approve ? 'Opening approved and posted.' : 'Opening returned for changes.', tone: 'success' })
        onDecided()
      },
    }
  }
  return (
    <FormDialog title={approve ? 'Approve the opening' : 'Reject the opening'} submitLabel={approve ? 'Approve and post' : 'Reject'} submitVariant={approve ? 'primary' : 'destructive-solid'} onClose={onClose} onSubmit={submit}>
      <p>{approve
        ? `Posts one journal entry with ${countLabel(migration.opening.balances.count, 'opening balance')} into the cutover period and freezes the opening state. It is posted once and cannot be undone.`
        : 'Returns the opening to the consultant, who uploads corrected files and submits again.'} You may be asked for a code from your authenticator app.</p>
      <TextAreaField id="opening-reason" label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}

/** SC-16 Opening step (D-B6-10): two CSV uploads, the staged rows, Submit, and the Finance decision. */
export function OpeningStep({ migration, market, onChanged }: { readonly migration: Migration; readonly market: Market | undefined; readonly onChanged: () => void }) {
  const api = useApi()
  const { me, can, readOnly } = useSession()
  const rows = usePagedList<OpeningRow>(`${MIGRATIONS_PATH}/${migration.id}/opening`)
  const [controlTotal, setControlTotal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)
  // One key per submission: kept across retries, renewed once it succeeded (a rejected opening is submitted again).
  const [submitKey, setSubmitKey] = useState(newIdempotencyKey)
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null)
  const { opening, state } = migration
  const staging = state === 'applied' && can('migration.manage') && !readOnly
  const mayDecide = state === 'opening_submitted' && can('migration.signoff') && !readOnly && opening.submitted_by !== me.user.id
  const changed = () => {
    rows.reload()
    onChanged()
  }
  async function sendBalances(text: string): Promise<string> {
    if (market === undefined) throw new InputProblem('The market could not be loaded; reload the page.')
    const minor = decimalToMinor(controlTotal.trim(), market.minor_unit)
    if (minor === null) throw new InputProblem(`Enter the control total as an amount in ${migration.market.currency}, for example ${minorToDecimal('950', market.minor_unit)}.`)
    const { data } = await api.put<{ count: number; total_minor: string }>(`${MIGRATIONS_PATH}/${migration.id}/opening-balances`, text, { contentType: 'text/csv', query: { control_total_minor: minor } })
    changed()
    return `${countLabel(data.count, 'balance')} staged, total ${marketMoney(data.total_minor, market)}.`
  }
  async function sendState(text: string): Promise<string> {
    const { data } = await api.put<{ positions: number; items: number }>(`${MIGRATIONS_PATH}/${migration.id}/opening-state`, text, { contentType: 'text/csv' })
    changed()
    return `${countLabel(data.items, 'state item')} of ${countLabel(data.positions, 'position')} staged.`
  }
  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api.post(`${MIGRATIONS_PATH}/${migration.id}/opening/submit`, undefined, { idempotencyKey: submitKey })
      setSubmitKey(newIdempotencyKey())
      onChanged()
    } catch (error) {
      setSubmitError(error)
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Panel title="Opening balances and state" icon="account_balance">
      <p className={NOTE}>As of the start of the cutover period. Positive amounts are owed to the payee, negative amounts by the payee. Uploading again replaces the staged rows.</p>
      {staging && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-sm">
          <CsvUpload id="opening-balances" label="Balances" columns="payee_id, amount_minor" market={market} onSend={sendBalances}
            extra={(busy) => <TextInput label="Control total" inputMode="decimal" value={controlTotal} disabled={busy}
              helper={`The sum of the amounts in ${migration.market.currency} units, while the file's amount_minor is in minor units; a different sum is refused.`} onChange={(event) => setControlTotal(event.target.value)} />} />
          <CsvUpload id="opening-state" label="State" columns="participant_id, item, value" market={market} onSend={sendState} />
        </div>
      )}
      <p className="font-body-sm text-body-sm text-on-surface">
        Staged: {countLabel(opening.balances.count, 'balance')} (total {marketMoney(opening.balances.total_minor, market)}), {countLabel(opening.state_rows, 'position state')}.
      </p>
      <DataTable
        bare
        stackOnPhone
        density="compact"
        caption="Staged opening rows by payee"
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm font-semibold">{row.participant.external_ref}</span> },
          { key: 'balance', header: `Opening balance (${migration.market.currency})`, align: 'end', cell: (row) => (row.amount_minor === null ? '—' : signedMoney(row.amount_minor, market)) },
          { key: 'state', header: 'State items', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm">{stateText(row.state)}</span> },
        ]}
        rows={rows.rows}
        rowKey={(row) => row.participant.external_ref}
        loading={rows.loading}
        error={tableError(rows)}
        empty={{ title: 'Nothing staged yet.' }}
        pagination={rows.pagination}
      />
      {staging && (
        <div className="flex flex-wrap items-center justify-end gap-space-sm">
          <span className={NOTE}>A Finance approver other than you approves the submitted opening.</span>
          <Button variant="primary" icon="send" loading={submitting} disabled={opening.balances.count + opening.state_rows === 0} onClick={submit}>Submit opening</Button>
        </div>
      )}
      {submitError !== null && <Banner tone="danger">{errorMessage(submitError)}</Banner>}
      {state === 'opening_submitted' && (
        <div className="flex flex-wrap items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low">
          <span className="font-body-sm text-body-sm text-on-surface">
            Submitted {opening.submitted_at === null ? '' : formatDateTime(opening.submitted_at)} by {inSentence(personName(opening.submitted_by, me.user.id))}.
            {!mayDecide && ' Waiting for a Finance approver who did not submit it.'}
          </span>
          {mayDecide && (
            <span className="flex gap-space-xs">
              <Button variant="destructive" onClick={() => setDeciding('reject')}>Reject</Button>
              <Button variant="primary" icon="verified_user" onClick={() => setDeciding('approve')}>Approve</Button>
            </span>
          )}
        </div>
      )}
      {opening.approval !== null && (
        <Banner tone="success" title="Opening posted"
          action={opening.journal_entry_id !== null && can('ledger.read') ? <LinkButton size="sm" href={ledgerPath(migration.market.id, 'journal', { entry: opening.journal_entry_id })}>Open the journal entry</LinkButton> : undefined}>
          Approved by {opening.approval.by.display_name ?? 'another user'} on {formatDateTime(opening.approval.at)}.
        </Banner>
      )}
      {deciding !== null && <DecisionDialog migration={migration} decision={deciding} onClose={() => setDeciding(null)} onDecided={() => { setDeciding(null); changed() }} />}
    </Panel>
  )
}
