'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { countLabel, formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { tableError } from '../admin/resource'
import { MONO, NOTE, ROW_ACTIONS, SECTION_CARD, SectionTitle } from '../admin/ui'
import { ParticipantPicker } from '../cases/pickers'
import type { ParticipantRow } from '../cases/types'
import { LEGAL_HOLDS_PATH, type LegalHold } from './types'

const MANAGE = 'legal_hold.manage'
const IDS = { participant_id: 'hold-participant', reason: 'hold-reason' } as const

/** POST /v1/legal-holds (step-up through ApiProvider): retention skips the member, erasure is deferred, tenant purge blocked. */
function PlaceHoldDialog({ onClose, onDone }: { readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [member, setMember] = useState<ParticipantRow | null>(null)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function submit(idempotencyKey: string) {
    const found = { [IDS.participant_id]: member === null ? 'Choose the member.' : null, [IDS.reason]: requiredError('the reason', reason) }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0 || member === null) return { items }
    return {
      items,
      fieldIds: IDS,
      send: async () => {
        await api.post(LEGAL_HOLDS_PATH, { participant_id: member.id, reason: reason.trim() }, { idempotencyKey })
        toast({ message: `Legal hold placed on ${member.external_ref}.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Place a legal hold" submitLabel="Place hold" onClose={onClose} onSubmit={submit}>
      <p>While the hold is active, retention skips the member, an erasure is deferred and the account cannot be purged. Someone other than you releases it.</p>
      <ParticipantPicker id={IDS.participant_id} label="Member" chosen={member} onChoose={setMember} error={errors[IDS.participant_id]} />
      <TextAreaField id={IDS.reason} label="Reason" helper="Shown to privacy and compliance staff; the audit log keeps only the ids." value={reason} error={errors[IDS.reason]} onChange={setReason} />
      <p className={NOTE}>You may be asked for a code from your authenticator app.</p>
    </FormDialog>
  )
}

/** POST …/release (step-up): the placer is refused with SOD_SELF_APPROVAL, shown in this dialog. */
function ReleaseDialog({ hold, onClose, onDone }: { readonly hold: LegalHold; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  function submit() {
    return {
      items: [],
      send: async () => {
        await api.post(`${LEGAL_HOLDS_PATH}/${hold.id}/release`, {})
        toast({ message: `Legal hold on ${hold.participant.external_ref} released.` })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={`Release the hold on ${hold.participant.external_ref}`} submitLabel="Release hold" submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>Placed {formatDateTime(hold.placed_at)} by {hold.placed_by.display_name ?? 'another user'}. Reason: {hold.reason}</p>
      <p className={NOTE}>Once released, retention and erasure apply to the member again. The person who placed the hold cannot release it. You may be asked for a code from your authenticator app.</p>
    </FormDialog>
  )
}

/** SC-15 Legal holds tab (D-V1A-08): active and released holds; place and release with legal_hold.manage. */
export function LegalHoldsTab() {
  const { me, can, readOnly } = useSession()
  const holds = useResource<LegalHold[]>(LEGAL_HOLDS_PATH)
  const [placing, setPlacing] = useState(false)
  const [releasing, setReleasing] = useState<LegalHold | null>(null)
  const manage = !readOnly && can(MANAGE)
  const done = () => {
    setPlacing(false)
    setReleasing(null)
    holds.reload()
  }
  const rows = holds.data ?? []
  const active = rows.filter((hold) => hold.released_at === null).length
  const columns: readonly DataTableColumn<LegalHold>[] = [
    { key: 'member', header: 'Member', cell: (hold) => <Link className={`${MONO} text-primary hover:underline`} href={`/people/${hold.participant.id}`}>{hold.participant.external_ref}</Link> },
    { key: 'reason', header: 'Reason', cell: (hold) => <span className="break-words">{hold.reason}</span> },
    {
      key: 'placed', header: 'Placed', cell: (hold) => (
        <div className="flex flex-col"><span>{hold.placed_by.id === me.user.id ? 'You' : hold.placed_by.display_name ?? 'Another user'}</span><span className={`${MONO} text-secondary whitespace-nowrap`}>{formatDateTime(hold.placed_at)}</span></div>
      ),
    },
    {
      key: 'state', header: 'State', cell: (hold) => hold.released_at === null
        ? <StatusBadge state="held" label="Active" />
        : <div className="flex flex-col gap-1"><StatusBadge state="ended" label="Released" /><span className={NOTE}>by {hold.released_by?.display_name ?? 'another user'}, {formatDateTime(hold.released_at)}</span></div>,
    },
    {
      key: 'actions', header: 'Actions', align: 'end', cell: (hold) => manage && hold.released_at === null
        ? <div className={ROW_ACTIONS}><Button size="sm" variant="destructive" aria-label={`Release the hold on ${hold.participant.external_ref}`} onClick={() => setReleasing(hold)}>Release</Button></div>
        : null,
    },
  ]
  return (
    <section className={SECTION_CARD} aria-labelledby="holds-title">
      <SectionTitle id="holds-title" icon="gavel" title="Legal holds"
        action={manage ? <Button variant="primary" icon="add_circle" data-testid="hold-place" onClick={() => setPlacing(true)}>Place hold</Button> : undefined} />
      <p className={NOTE}>
        {holds.data === null
          ? 'Members kept from retention, erasure and purge while a claim or investigation is open.'
          : `${countLabel(active, 'active hold')}. A held member is skipped by retention, an erasure waits and the account cannot be purged.`}
      </p>
      <DataTable bare caption="Legal holds" columns={columns} rows={rows} rowKey={(hold) => hold.id} loading={holds.loading}
        error={tableError(holds)} empty={{ title: 'No legal hold' }} stackOnPhone />
      {placing && <PlaceHoldDialog onClose={() => setPlacing(false)} onDone={done} />}
      {releasing !== null && <ReleaseDialog hold={releasing} onClose={() => setReleasing(null)} onDone={done} />}
    </section>
  )
}
