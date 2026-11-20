'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { ErrorState, LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { ledgerPath } from '../ledger/format'
import { accountText, batchPath } from '../payouts/format'
import { PERIOD_STATE_LABELS } from './format'
import type { CloseCheck } from './types'

const NOTE_MAX = 1000
const NOTE_ID = 'close-note'
const LINK = 'text-primary font-semibold hover:underline'
const SHORT_ID = 8

/** D-B6-04 blocker kinds: a heading, and where each listed object is resolved. */
const KINDS: Readonly<Record<string, { readonly title: string; readonly href: (id: string, marketId: string) => string; readonly link: string }>> = {
  late_item_pending: { title: 'Late transactions not decided', href: (_id, marketId) => `/periods/late?state=pending&market_id=${marketId}`, link: 'Open the late-transaction queue' },
  payout_batch_open: { title: 'Payout batches not finished', href: (id) => batchPath(id), link: 'Open the payout batch' },
  payout_exception: { title: 'Payout exceptions not resolved', href: () => '/payouts/reconciliation?exceptions=open', link: 'Open payout reconciliation' },
  payout_in_transit: { title: 'Payouts still in transit', href: (id) => `/payouts/reconciliation?item=${id}`, link: 'Open the payout instruction' },
  restatement_open: { title: 'Restatement cases not decided', href: (id) => `/cases/${id}`, link: 'Open the case' },
  returned_payment_case: { title: 'Returned-payment cases not decided', href: (id) => `/cases/${id}`, link: 'Open the case' },
}

export interface ClosePeriod {
  readonly id: string
  readonly label: string
  readonly marketId: string
}

/** The close-check blockers grouped by kind, each with a link to where it is resolved, and the GL mapping gaps. */
function CheckList({ check, marketId }: { readonly check: CloseCheck; readonly marketId: string }) {
  const kinds = [...new Set(check.blockers.map((b) => b.kind))]
  return (
    <>
      {kinds.map((kind) => {
        const info = KINDS[kind]
        const items = check.blockers.filter((b) => b.kind === kind)
        return (
          <section key={kind} aria-label={info?.title ?? kind} className="flex flex-col gap-1">
            <h3 className="font-body-sm text-body-sm font-semibold text-on-surface">{info?.title ?? kind} ({items.length})</h3>
            <ul className="flex flex-col gap-0.5 font-body-sm text-body-sm">
              {items.map((item) => (
                <li key={item.id}>
                  {info === undefined ? item.id : <Link className={LINK} href={info.href(item.id, marketId)}>{`${info.link} ${item.id.slice(0, SHORT_ID)}`}</Link>}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {check.gl_unmapped.length > 0 && (
        <section aria-label="GL accounts not mapped" className="flex flex-col gap-1">
          <h3 className="font-body-sm text-body-sm font-semibold text-on-surface">GL accounts not mapped ({check.gl_unmapped.length})</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            The journal export made at close needs a GL account for {check.gl_unmapped.map(accountText).join(', ')}.{' '}
            <Link className={LINK} href={ledgerPath(marketId, 'mapping')}>Open the GL mapping</Link>
          </p>
        </section>
      )}
    </>
  )
}

/**
 * SC-01 Close period (D-B6-04, period.close, step-up): the close-check blockers by kind with links, GL mapping gaps,
 * a note; closing makes the period's GL journal export in the same transaction. Mount only while open.
 */
export function CloseDialog({ period, onClose, onClosed }: { readonly period: ClosePeriod; readonly onClose: () => void; readonly onClosed: () => void }) {
  const api = useApi()
  const toast = useToast()
  const check = useResource<CloseCheck>(`/v1/periods/${period.id}/close-check`)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = note.trim() === '' ? 'Enter a note on why the period can be closed.' : null
    setNoteError(missing)
    if (missing !== null) return { items: [{ fieldId: NOTE_ID, message: missing }] }
    if (check.error !== null) return { items: [{ message: 'The close check could not be loaded; try again.' }] }
    if (check.data === null) return { items: [{ message: 'Wait for the close check to finish.' }] }
    if (!check.data.closable) return { items: [{ message: 'Resolve every listed item before closing the period.' }] }
    return {
      items: [],
      fieldIds: { note: NOTE_ID },
      send: async () => {
        try {
          await api.post(`/v1/periods/${period.id}/close`, { note: note.trim() }, { idempotencyKey })
        } catch (error) {
          // A blocker that appeared since the check: show the current list.
          if (error instanceof ApiError && (error.code === 'PERIOD_CLOSE_BLOCKED' || error.code === 'GL_MAPPING_MISSING')) check.reload()
          throw error
        }
        toast({ message: `${period.label} is closed.`, tone: 'success' })
        onClosed()
      },
    }
  }
  const data = check.data
  return (
    <FormDialog title={`Close ${period.label}`} submitLabel="Close period" size="lg" onClose={onClose} onSubmit={submit}>
      <p>Closing is final: nothing posts into a closed period. The period&apos;s GL journal export is made at close. You may be asked for a code from your authenticator app.</p>
      {check.loading && <LoadingState label="Checking what stops the close" />}
      {check.error !== null && <ErrorState section message={`The close check could not be loaded. ${errorMessage(check.error)}`} onRetry={check.reload} />}
      {data !== null && data.state !== 'paid' && <Banner tone="warning">Only a paid period can be closed; this one is {PERIOD_STATE_LABELS[data.state].toLowerCase()}.</Banner>}
      {data !== null && data.state === 'paid' && data.closable && <Banner tone="success">Nothing stops the close.</Banner>}
      {data !== null && (data.blockers.length > 0 || data.gl_unmapped.length > 0) && (
        <div className="flex flex-col gap-space-sm" data-testid="close-blockers">
          <Banner tone="danger" title="Resolve these first">Each item below stops the close until it is resolved.</Banner>
          <CheckList check={data} marketId={period.marketId} />
        </div>
      )}
      <TextAreaField id={NOTE_ID} label="Note" value={note} error={noteError} maxLength={NOTE_MAX} onChange={setNote} />
    </FormDialog>
  )
}
