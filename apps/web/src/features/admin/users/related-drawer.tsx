'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { Drawer } from '../../../components/drawer'
import { ErrorSummary, type SummaryItem } from '../../../components/error-summary'
import { Select } from '../../../components/form-field'
import { StatusBadge } from '../../../components/status-badge'
import { LoadingState } from '../../../components/states'
import { useToast } from '../../../components/toast'
import { newIdempotencyKey } from '../../../lib/api'
import { errorMessage } from '../../../lib/messages'
import { useSession } from '../../../lib/session'
import { useResource } from '../../../lib/use-resource'
import { requiredError } from '../../../lib/validation'
import { ParticipantPicker } from '../../cases/pickers'
import type { ParticipantRow } from '../../cases/types'
import { formatDateTime } from '../format'
import { TextAreaField } from '../form-dialog'
import { LoadFailure } from '../page-states'
import type { UserView } from '../types'
import { MONO, NOTE } from '../ui'

/** GET /v1/users/:id/related-participants rows (D-B4-11). */
interface Declaration {
  readonly id: string
  readonly participant: { readonly id: string; readonly external_ref: string; readonly display_name: string | null }
  readonly relation: 'self' | 'relative'
  readonly declared_by: string
  readonly declared_at: string
  readonly withdrawn_at: string | null
}

const RELATIONS = [{ value: 'self', label: 'Their own account' }, { value: 'relative', label: 'A relative’s account' }] as const
const PARTICIPANT_ID = 'related-participant'
const RELATION_ID = 'related-relation'
const RELATION_LABELS: Readonly<Record<string, string>> = { self: 'Own account', relative: 'Relative' }

/** Inline withdraw form under one declaration (no dialog over the drawer). */
function Withdraw({ userId, declaration, onDone }: { readonly userId: string; readonly declaration: Declaration; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!open) return <Button size="sm" aria-label={`Withdraw the declaration of ${declaration.participant.external_ref}`} onClick={() => setOpen(true)}>Withdraw</Button>
  async function withdraw() {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return
    setBusy(true)
    try {
      await api.post(`/v1/users/${userId}/related-participants/${declaration.id}/withdraw`, { reason: reason.trim() })
      toast({ message: `Declaration of ${declaration.participant.external_ref} withdrawn.` })
      onDone()
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }
  const id = `withdraw-${declaration.id}`
  return (
    <div className="w-full flex flex-col gap-space-xs">
      <TextAreaField id={id} label="Reason for withdrawing" maxLength={500} value={reason} error={error} onChange={setReason} />
      <span className="flex gap-space-xs">
        <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="destructive" loading={busy} onClick={withdraw}>Withdraw declaration</Button>
      </span>
    </div>
  )
}

/** Declare a participant account as the user's own or a relative's (Idempotency-Key per identical body). */
function Declare({ userId, onDone }: { readonly userId: string; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [participant, setParticipant] = useState<ParticipantRow | null>(null)
  const [relation, setRelation] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<{ readonly key: string; readonly body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function declare() {
    const found = { participant: participant === null ? 'Choose the participant.' : null, relation: relation === '' ? 'Choose the relation.' : null }
    setErrors(found)
    setSummary([
      ...(found.participant === null ? [] : [{ fieldId: PARTICIPANT_ID, message: found.participant }]),
      ...(found.relation === null ? [] : [{ fieldId: RELATION_ID, message: found.relation }]),
    ])
    if (participant === null || relation === '') return
    const body = { participant_id: participant.id, relation }
    const text = JSON.stringify(body)
    const key = attempt !== null && attempt.body === text ? attempt.key : newIdempotencyKey()
    setAttempt({ key, body: text })
    setBusy(true)
    setProblem(null)
    try {
      await api.post(`/v1/users/${userId}/related-participants`, body, { idempotencyKey: key })
      toast({ message: `${participant.external_ref} declared related.` })
      onDone()
    } catch (failure) {
      setProblem(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex flex-col gap-space-sm pt-space-sm border-t border-surface-container" aria-labelledby="declare-title">
      <h3 id="declare-title" className="font-section-heading text-section-heading text-on-surface">Declare a related participant</h3>
      <ErrorSummary items={summary} />
      <ParticipantPicker id={PARTICIPANT_ID} label="Participant" chosen={participant} error={errors.participant} onChoose={setParticipant} />
      <Select id={RELATION_ID} label="Relation" placeholder="Choose" value={relation} options={RELATIONS} error={errors.relation} onChange={(event) => setRelation(event.target.value)} />
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      <Button className="self-start" variant="primary" icon="person_add" loading={busy} onClick={declare}>Declare</Button>
    </section>
  )
}

/**
 * SC-28 user drawer (D-B4-11, BR-ADJ-03): the participant accounts declared as the user's own or a relative's. The user
 * may not propose or approve adjustments for them.
 */
export function UserDrawer({ user, onClose }: { readonly user: UserView; readonly onClose: () => void }) {
  const { me, readOnly } = useSession()
  // The API refuses a withdrawal of the caller's own declarations (422 SOD_SELF_APPROVAL, PLAN §2.5).
  const own = user.id === me.user.id
  const declarations = useResource<readonly Declaration[]>(`/v1/users/${user.id}/related-participants`)
  return (
    <Drawer open onClose={onClose} title={user.display_name ?? user.email} description={user.email} icon="person">
      <section className="flex flex-col gap-space-sm" aria-labelledby="related-title" data-testid="related-participants">
        <h3 id="related-title" className="font-section-heading text-section-heading text-on-surface">Declared related participants</h3>
        <p className={NOTE}>This user cannot propose or approve manual adjustments for these accounts.</p>
        {declarations.error !== null && <LoadFailure error={declarations.error} onRetry={declarations.reload} section />}
        {declarations.data === null && declarations.error === null && <LoadingState label="Loading declarations" />}
        {declarations.data?.length === 0 && <p className={NOTE}>No related participant declared.</p>}
        {own && !readOnly && (declarations.data ?? []).some((declaration) => declaration.withdrawn_at === null) && <p className={NOTE}>Another user manager must withdraw your own declarations.</p>}
        <ul className="flex flex-col divide-y divide-surface-container">
          {(declarations.data ?? []).map((declaration) => (
            <li key={declaration.id} className="py-space-xs flex flex-wrap items-center justify-between gap-space-sm">
              <span className="flex flex-col min-w-0">
                <Link className="text-primary font-semibold hover:underline" href={`/people/${declaration.participant.id}`}>
                  {declaration.participant.external_ref}{declaration.participant.display_name === null ? '' : ` · ${declaration.participant.display_name}`}
                </Link>
                <span className={`${MONO} text-secondary`}>{RELATION_LABELS[declaration.relation]} · declared {formatDateTime(declaration.declared_at)}</span>
              </span>
              {declaration.withdrawn_at === null
                ? (readOnly || own ? <StatusBadge state="active" label="Declared" /> : <Withdraw userId={user.id} declaration={declaration} onDone={declarations.reload} />)
                : <StatusBadge state="ended" label={`Withdrawn ${formatDateTime(declaration.withdrawn_at)}`} />}
            </li>
          ))}
        </ul>
      </section>
      {!readOnly && <Declare key={declarations.data?.length ?? 0} userId={user.id} onDone={declarations.reload} />}
    </Drawer>
  )
}
