'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { ApprovalBar } from '../../components/approval-bar'
import { Button } from '../../components/button'
import { Select } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { useToast } from '../../components/toast'
import { newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { FormDialog, REASON_MAX_LENGTH, TextAreaField } from '../admin/form-dialog'
import { inSentence, personName } from '../cases/format'
import { effectiveText, GATE_LABELS, PLANS_PATH, versionApi, versionPage } from './format'
import type { DraftScope } from './rules-tab'
import type { GateName, PeriodsView, VersionView } from './types'
import { explainedError, NOTE, useCalendarPeriods, type RefusalNames } from './ui'

const COMPLIANCE = 'Compliance officer'
const FINANCE = 'Finance approver'
const JUSTIFICATION_MAX = 2000
const REASON_ID = 'decision-reason'
const EFFECTIVE_ID = 'schedule-effective'
const JUSTIFICATION_ID = 'schedule-justification'

/** Period starts shared by every plan calendar, oldest first: the only instants a version may take effect at. */
export function boundaryStarts(calendarIds: readonly string[], periods: PeriodsView | null): string[] {
  if (periods === null || calendarIds.length === 0) return []
  const startsOf = (id: string) => new Set(periods.periods.filter((p) => p.calendar_id === id).map((p) => Date.parse(p.starts_at)))
  const [first, ...rest] = calendarIds.map(startsOf)
  return [...first!].filter((t) => rest.every((set) => set.has(t))).sort((a, b) => a - b).map((t) => new Date(t).toISOString())
}

/** Approve or reject a version in review (plan.approve, step-up; SoD against the submitter and rule authors). */
function DecisionDialog({ scope, decision, onClose }: { readonly scope: DraftScope; readonly decision: 'approve' | 'reject'; readonly onClose: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const label = decision === 'approve' ? `Approve version ${scope.version.version}` : `Reject version ${scope.version.version}`
  function submit(idempotencyKey: string) {
    const missing = reason.trim() === '' ? 'Enter the reason for your decision.' : null
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: REASON_ID, message: missing }] }
    return {
      items: [],
      fieldIds: { reason: REASON_ID },
      send: async () => {
        try {
          await api.post(`${versionApi(scope.plan.id, scope.version.version)}/decision`, { decision, reason: reason.trim() }, { idempotencyKey })
        } catch (failure) {
          throw explainedError(failure, {}, COMPLIANCE)
        }
        toast({ message: decision === 'approve' ? `Version ${scope.version.version} approved.` : `Version ${scope.version.version} returned to draft.` })
        onClose()
        scope.reload()
      },
    }
  }
  return (
    <FormDialog title={label} submitLabel={label} submitVariant={decision === 'approve' ? 'primary' : 'destructive-solid'} onClose={onClose} onSubmit={submit}>
      <p>
        {decision === 'approve' ? 'Approving lets a Finance approver schedule this version.' : 'Rejecting returns the version to draft so it can be changed.'}
        {' '}You may be asked for a code from your authenticator app.
      </p>
      <TextAreaField id={REASON_ID} label="Reason" value={reason} error={error} maxLength={REASON_MAX_LENGTH} onChange={setReason} />
    </FormDialog>
  )
}

// The newest 200 periods of a calendar hold every generated future period (periods_ahead is at most 120) and the recent past.
const SCHEDULE_PERIODS = { limit: 200 }

/** Shared starts to offer: future ones first (soonest first), then past ones (newest first), which take effect at once. */
export function scheduleChoices(starts: readonly string[], now: number): { readonly value: string; readonly past: boolean }[] {
  const future = starts.filter((iso) => Date.parse(iso) > now)
  const past = starts.filter((iso) => Date.parse(iso) <= now).reverse()
  return [...future.map((value) => ({ value, past: false })), ...past.map((value) => ({ value, past: true }))]
}

/** Schedule an approved version (plan.activate, step-up): effective at a shared period start, with a justification. */
function ScheduleDialog({ scope, names, onClose }: { readonly scope: DraftScope; readonly names: RefusalNames; readonly onClose: () => void }) {
  const api = useApi()
  const toast = useToast()
  const periods = useCalendarPeriods(scope.plan.calendars.map((c) => c.id), SCHEDULE_PERIODS)
  const [now] = useState(() => Date.now())
  const choices = scheduleChoices(boundaryStarts(scope.plan.calendars.map((c) => c.id), periods.data), now)
  const zone = periods.data?.calendars.find((c) => c.id === scope.plan.calendars[0]?.id)?.cutoff_time_zone
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone })
  const [effective, setEffective] = useState('')
  const [justification, setJustification] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function submit(idempotencyKey: string) {
    const found = {
      [EFFECTIVE_ID]: effective === '' ? 'Choose the period start the version takes effect at.' : null,
      [JUSTIFICATION_ID]: justification.trim() === '' ? 'Enter the justification for this change.' : null,
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    return {
      items: [],
      fieldIds: { effective_from: EFFECTIVE_ID, justification: JUSTIFICATION_ID },
      send: async () => {
        try {
          await api.post(`${versionApi(scope.plan.id, scope.version.version)}/schedule`, { effective_from: effective, justification: justification.trim() }, { idempotencyKey })
        } catch (failure) {
          throw explainedError(failure, names, FINANCE)
        }
        toast({ message: Date.parse(effective) <= Date.now() ? `Version ${scope.version.version} is active.` : `Version ${scope.version.version} is scheduled.` })
        onClose()
        scope.reload()
      },
    }
  }
  return (
    <FormDialog title={`Schedule version ${scope.version.version}`} submitLabel={`Schedule version ${scope.version.version}`} onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>A version takes effect at the start of a period of every plan calendar. A time that has passed activates it at once; you may be asked for a code from your authenticator app.</p>
      {periods.error !== null && <p role="alert" className="font-caption text-caption text-error" id={EFFECTIVE_ID}>The periods could not be loaded. {errorMessage(periods.error)}</p>}
      {periods.loading && <p role="status" className={NOTE}>Loading the period starts…</p>}
      {periods.data !== null && (choices.length === 0
        ? <p className={NOTE} id={EFFECTIVE_ID}>No period start is shared by every plan calendar in the periods you can see.</p>
        : <Select id={EFFECTIVE_ID} label="Effective from" value={effective} placeholder="Choose a period start" error={errors[EFFECTIVE_ID]}
            helper={zone === undefined ? undefined : `Times in ${zone}, the first calendar's cut-off zone.`}
            options={choices.map((c) => ({ value: c.value, label: `${format.format(new Date(c.value))}${c.past ? ' (takes effect at once)' : ''}` }))} onChange={(event) => setEffective(event.target.value)} />)}
      <TextAreaField id={JUSTIFICATION_ID} label="Justification" value={justification} error={errors[JUSTIFICATION_ID]} maxLength={JUSTIFICATION_MAX} onChange={setJustification} />
    </FormDialog>
  )
}

/** The checklist of D-B3-04 gates. */
function Gates({ gates }: { readonly gates: VersionView['gates'] }) {
  return (
    <ul aria-label="Checks before submission and scheduling" className="flex flex-wrap items-center gap-x-space-md gap-y-1">
      {(Object.keys(GATE_LABELS) as GateName[]).map((gate) => (
        <li key={gate} className="flex items-center gap-1">
          <Icon name={gates[gate] ? 'check_circle' : 'cancel'} size={16} className={gates[gate] ? 'text-tertiary' : 'text-error'} />
          <span className={gates[gate] ? 'text-on-surface' : 'text-secondary'}>{GATE_LABELS[gate]}</span>
          <span className="sr-only">{gates[gate] ? '(met)' : '(not met)'}</span>
        </li>
      ))}
    </ul>
  )
}

export interface GovernanceProps {
  readonly scope: DraftScope
  readonly names: RefusalNames
  readonly markets: readonly Market[] | null
  /** A refused submit or new version, shown on the page under the header. */
  readonly onRefused: (error: unknown) => void
  /** SC-44: why scheduling would be refused now (open governance items); shown, the server still decides. */
  readonly scheduleNote?: string
}

/** sc_04 sticky governance bar: who acted, the gate checklist, and the next lifecycle action the user may take. */
export function GovernanceBar({ scope, names, markets, onRefused, scheduleNote }: GovernanceProps) {
  const api = useApi()
  const router = useRouter()
  const toast = useToast()
  const { me, can, readOnly } = useSession()
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'schedule' | null>(null)
  const [busy, setBusy] = useState(false)
  const { version, plan } = scope
  const myId = me.user.id
  const who = (id: string | null) => inSentence(personName(id, myId))
  async function act(run: () => Promise<void>) {
    setBusy(true)
    onRefused(null)
    try {
      await run()
    } catch (error) {
      onRefused(error)
    } finally {
      setBusy(false)
    }
  }
  const submit = () => act(async () => {
    // A new key per click: a refused submit is stored with its key, so a corrected draft must not reuse it.
    await api.post(`${versionApi(plan.id, version.version)}/submit`, undefined, { idempotencyKey: newIdempotencyKey() })
    toast({ message: `Version ${version.version} submitted for review.` })
    scope.reload()
  })
  const newVersion = () => act(async () => {
    const { data } = await api.post<{ version: number }>(`${PLANS_PATH}/${plan.id}/versions`, {}, { idempotencyKey: newIdempotencyKey() })
    router.push(versionPage(plan.id, data.version))
  })
  const writable = !readOnly
  let preparedBy = `Draft created by ${who(version.created_by)}`
  let preparedAt: string | undefined = formatDateTime(version.created_at)
  let blockedReason: string | undefined
  let actions = null
  switch (version.state) {
    case 'draft':
      if (scope.canEdit) actions = <Button variant="primary" icon="send" loading={busy} onClick={submit}>Submit for review</Button>
      break
    case 'in_review':
      preparedBy = `Submitted by ${who(version.submitted_by)}`
      preparedAt = formatDateTime(version.submitted_at)
      if (writable && can('plan.approve')) {
        // Authors never decide their own version (SoD): no Approve for the submitter or the version's creator.
        if (version.submitted_by === myId || version.created_by === myId) blockedReason = 'You wrote or submitted this version, so a compliance officer who did not write it must decide it.'
        else actions = (
          <>
            <Button variant="destructive" onClick={() => setDialog('reject')}>Reject</Button>
            <Button variant="primary" icon="verified_user" onClick={() => setDialog('approve')}>Approve</Button>
          </>
        )
      }
      break
    case 'approved':
      preparedBy = `Approved by ${who(version.approved_by)}`
      preparedAt = undefined
      if (writable && can('plan.activate')) {
        if (version.submitted_by === myId || version.approved_by === myId) blockedReason = 'You submitted or approved this version, so a second approver must schedule it.'
        else {
          blockedReason = scheduleNote
          actions = <Button variant="primary" icon="event" onClick={() => setDialog('schedule')}>Schedule</Button>
        }
      }
      break
    default:
      preparedBy = version.state === 'scheduled' ? `Scheduled by ${who(version.activated_by)}` : `Activated by ${who(version.activated_by)}`
      preparedAt = version.state === 'scheduled' ? `from ${version.effective_from === null ? '—' : effectiveText(version.effective_from, plan.calendars, markets)}` : formatDateTime(version.activated_at)
      if (writable && can('plan.edit') && plan.authoring_version === null) actions = <Button variant="primary" icon="add" loading={busy} onClick={newVersion}>New version</Button>
  }
  return (
    <>
      <ApprovalBar preparedBy={preparedBy} preparedAt={preparedAt} blockedReason={blockedReason} approvers={<Gates gates={version.gates} />} actions={actions} />
      {(dialog === 'approve' || dialog === 'reject') && <DecisionDialog scope={scope} decision={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'schedule' && <ScheduleDialog scope={scope} names={names} onClose={() => setDialog(null)} />}
    </>
  )
}
