'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { TextInput } from '../../../components/form-field'
import { StatusBadge } from '../../../components/status-badge'
import { Stepper, type Step } from '../../../components/stepper'
import { useToast } from '../../../components/toast'
import { formatDateTime, formatDay } from '../../../lib/format'
import { requiredError } from '../../../lib/validation'
import { FormDialog, TextAreaField } from '../form-dialog'
import { blockerText, OFFBOARDING_STATE_BADGES, type OffboardingState } from '../offboarding'
import type { TenantDetail, VendorOffboarding } from '../types'
import { NOTE, ROW_ACTIONS, SECTION_CARD, SectionTitle } from '../ui'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REASON_MAX = 500
/** States after which the record is finished: a new offboarding may be requested. */
const CLOSED: readonly OffboardingState[] = ['purged', 'cancelled', 'restored']
const ORDER: readonly OffboardingState[] = ['requested', 'confirmed', 'archived', 'purge_requested', 'purge_approved', 'purged']

type Move = 'archive' | 'restore' | 'purge-request' | 'purge-approve' | 'cancel'

const MOVES: Readonly<Record<Move, { readonly title: string; readonly submit: string; readonly done: string; readonly text: string; readonly destructive?: true }>> = {
  archive: {
    title: 'Archive the tenant', submit: 'Archive tenant', done: 'Tenant archived. Its users can sign in and read; nothing integrates with it any more.',
    text: 'Name the completed full export the tenant made after it confirmed the offboarding. Archiving re-checks the blocking items; the export is kept while the archive lasts.',
    destructive: true,
  },
  restore: { title: 'Restore the tenant', submit: 'Restore tenant', done: 'Tenant restored to its previous state; changes are allowed again.', text: 'The tenant returns to the state it had before the offboarding, and its data can be changed again.' },
  'purge-request': {
    title: 'Request the purge', submit: 'Request purge', done: 'Purge requested. Another vendor user must approve it.',
    text: 'Possible only once the retention period has passed, with no legal hold and no open privacy request. A second vendor user, not you, approves it.',
    destructive: true,
  },
  'purge-approve': {
    title: 'Approve the purge', submit: 'Approve purge', done: 'Purge approved. The operator runs the purge from the command line.',
    text: 'Every row of the tenant is then deleted by the operator’s purge command; the tenant record and this offboarding stay as your record. The person who requested the purge cannot approve it.',
    destructive: true,
  },
  cancel: { title: 'Cancel the offboarding', submit: 'Cancel offboarding', done: 'Offboarding cancelled.', text: 'The request ends; a confirmed tenant can be changed again.' },
}

/** POST /v1/tenants/:id/offboarding (step-up, Idempotency-Key): the tenant's admins are told by mail and confirm on SC-29. */
function RequestDialog({ tenant, onClose, onDone }: { readonly tenant: TenantDetail; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: 'offboarding-reason', message: missing }] }
    return {
      items: [],
      fieldIds: { reason: 'offboarding-reason' },
      send: async () => {
        await api.post(`/v1/tenants/${tenant.id}/offboarding`, { reason: reason.trim() }, { idempotencyKey })
        toast({ message: `Offboarding of ${tenant.legal_name} requested. Its Tenant admins confirm it under Settings.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Request offboarding" submitLabel="Request offboarding" onClose={onClose} onSubmit={submit}>
      <p>{tenant.legal_name}’s Tenant admins get an e-mail, review the open items and confirm or cancel. Nothing changes for the tenant before they confirm.</p>
      <TextAreaField id="offboarding-reason" label="Reason" helper="Shown to the tenant’s admins." maxLength={REASON_MAX} value={reason} error={error} onChange={setReason} />
      <p className={NOTE}>You will be asked for a code from your authenticator app.</p>
    </FormDialog>
  )
}

/** One vendor step (archive needs the export id; every step but cancel asks for a step-up code). */
function MoveDialog({ tenant, move, onClose, onDone }: { readonly tenant: TenantDetail; readonly move: Move; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [exportId, setExportId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const words = MOVES[move]
  function submit() {
    const problem = move === 'archive' && !UUID.test(exportId.trim()) ? 'Enter the export id the tenant gives you (36 characters).' : null
    setError(problem)
    if (problem !== null) return { items: [{ fieldId: 'offboarding-export', message: problem }] }
    return {
      items: [],
      fieldIds: { export_id: 'offboarding-export' },
      send: async () => {
        await api.post(`/v1/tenants/${tenant.id}/offboarding/${move}`, move === 'archive' ? { export_id: exportId.trim() } : {})
        toast({ message: words.done })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={words.title} submitLabel={words.submit} submitVariant={words.destructive ? 'destructive-solid' : 'primary'} onClose={onClose} onSubmit={submit}>
      <p>{words.text}</p>
      {move === 'archive' && (
        // shortcut: no vendor-realm route lists a tenant's exports, so the id is typed; offer a picker of completed exports made after the confirmation once the API lists them.
        <TextInput id="offboarding-export" label="Full export id" autoComplete="off" helper="The tenant’s admin copies it under Integrations, Exports, in the export’s details."
          value={exportId} error={error} onChange={(event) => setExportId(event.target.value)} />
      )}
      {move !== 'cancel' && <p className={NOTE}>You will be asked for a code from your authenticator app.</p>}
    </FormDialog>
  )
}

/** The state timeline: each step done, current or to come, with the dates the API gives. */
function timeline(record: VendorOffboarding): readonly Step[] {
  const reached = ORDER.indexOf(record.state)
  const dates: Partial<Record<OffboardingState, string | null>> = { requested: record.requested_at, confirmed: record.confirmed_at, archived: record.archived_at }
  return ORDER.map((state, index) => {
    const at = dates[state]
    return {
      label: OFFBOARDING_STATE_BADGES[state].label,
      status: reached < 0 ? 'todo' : index < reached ? 'done' : index === reached ? 'current' : 'todo',
      detail: at === undefined || at === null ? undefined : formatDateTime(at),
    }
  })
}

/**
 * SC-39 Offboarding panel (FR-TEN-005, D-V1A-07): state timeline, blocker counts (never ids), request, cancel, archive
 * with the tenant's final export, restore, purge request and its independent approval (E-ADR-31) with retain_until.
 */
export function OffboardingPanel({ tenant, onChanged }: { readonly tenant: TenantDetail; readonly onChanged: () => void }) {
  const [dialog, setDialog] = useState<Move | 'request' | null>(null)
  const record = tenant.offboarding
  const open = record !== null && !CLOSED.includes(record.state)
  const counted = record?.blockers.filter((blocker) => blocker.count > 0) ?? []
  const done = () => {
    setDialog(null)
    onChanged()
  }
  const moves: readonly Move[] = !open ? [] : {
    requested: ['cancel'], confirmed: ['archive', 'cancel'], archived: ['purge-request', 'restore'], purge_requested: ['purge-approve', 'restore'],
    purge_approved: [], purged: [], cancelled: [], restored: [],
  }[record.state] as readonly Move[]
  const canRequest = !open && (tenant.state === 'live' || tenant.state === 'implementation')
  return (
    <section className={SECTION_CARD} aria-labelledby="offboarding-title" data-testid="offboarding">
      <SectionTitle id="offboarding-title" icon="inventory_2" title="Offboarding"
        action={record === null ? undefined : <StatusBadge {...OFFBOARDING_STATE_BADGES[record.state]} />} />
      {record === null || !open
        ? <p className={NOTE}>{record === null ? 'No offboarding has been requested.' : `The last offboarding ended: ${OFFBOARDING_STATE_BADGES[record.state].label.toLowerCase()}.`} The tenant’s admins confirm a request before anything changes for them.</p>
        : <Stepper label="Offboarding steps" steps={timeline(record)} />}
      {open && record.retain_until !== null && (
        <p className={NOTE}>Archive kept until {formatDay(record.retain_until)}: a purge can be requested from then on, without a legal hold or open privacy request.</p>
      )}
      {open && record.state === 'purge_approved' && <p className={NOTE}>The operator now runs the purge command; it is never started from this console.</p>}
      {open && (
        counted.length === 0
          ? <p className={NOTE}>No open items in the tenant.</p>
          : (
            <ul className="flex flex-col gap-space-xs" aria-label="Open items in the tenant (counts)">
              {counted.map((blocker) => (
                <li key={blocker.kind} className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface">
                  <StatusBadge state={blocker.blocking ? 'blocked' : 'held'} label={blocker.blocking ? 'Blocks' : 'Warning'} />{blockerText(blocker)}
                </li>
              ))}
            </ul>
          )
      )}
      {(canRequest || moves.length > 0) && (
        <div className={`${ROW_ACTIONS} justify-start`}>
          {canRequest && <Button icon="inventory_2" onClick={() => setDialog('request')}>Request offboarding</Button>}
          {moves.map((move) => (
            <Button key={move} variant={MOVES[move].destructive ? 'destructive' : 'secondary'} onClick={() => setDialog(move)}>{MOVES[move].submit}</Button>
          ))}
        </div>
      )}
      {dialog === 'request' && <RequestDialog tenant={tenant} onClose={() => setDialog(null)} onDone={done} />}
      {dialog !== null && dialog !== 'request' && <MoveDialog tenant={tenant} move={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </section>
  )
}
