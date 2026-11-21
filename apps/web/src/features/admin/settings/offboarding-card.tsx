'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { Checkbox, TextInput } from '../../../components/form-field'
import { LoadingState } from '../../../components/states'
import { StatusBadge } from '../../../components/status-badge'
import { useToast } from '../../../components/toast'
import { formatDateTime, formatDay } from '../../../lib/format'
import { useSession } from '../../../lib/session'
import { useResource } from '../../../lib/use-resource'
import { requiredError } from '../../../lib/validation'
import { FormDialog, TextAreaField } from '../form-dialog'
import { blockerHref, blockerText, OFFBOARDING_STATE_BADGES, type OffboardingBlocker, type OffboardingState } from '../offboarding'
import { LoadFailure } from '../page-states'
import { FIELDSET, LEGEND, NOTE, SECTION_CARD, SectionTitle } from '../ui'

const OFFBOARDING_PATH = '/v1/offboarding'
/** D-V1A-10 OFFBOARDING_RETENTION_MONTHS_MAX. */
const RETENTION_MONTHS_MAX = 240
const BASIS_MAX = 2000
const IDS = { retention_basis: 'offboarding-basis', retention_months: 'offboarding-months', acknowledged_warnings: 'offboarding-warnings' } as const

/** GET /v1/offboarding (tenant.offboard). */
interface OffboardingView {
  readonly offboarding: {
    readonly id: string
    readonly state: OffboardingState
    readonly reason: string
    readonly requested_at: string
    readonly confirmed_at: string | null
    readonly retention_basis: string | null
    readonly retention_months: number | null
    readonly retain_until: string | null
    readonly archived_at: string | null
    readonly export_id: string | null
  } | null
  readonly blockers: readonly OffboardingBlocker[]
}

/** POST /v1/offboarding/confirm (step-up through ApiProvider): from now on the account is read-only. */
function ConfirmDialog({ warnings, onClose, onDone }: { readonly warnings: readonly OffboardingBlocker[]; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [basis, setBasis] = useState('')
  const [months, setMonths] = useState('')
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function submit() {
    const count = Number(months)
    const found = {
      [IDS.retention_basis]: requiredError('the retention basis', basis),
      [IDS.retention_months]: Number.isInteger(count) && count >= 1 && count <= RETENTION_MONTHS_MAX ? null : `Enter whole months from 1 to ${RETENTION_MONTHS_MAX}.`,
      [IDS.acknowledged_warnings]: warnings.every((warning) => acknowledged.has(warning.kind)) ? null : 'Acknowledge every open obligation listed.',
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    const body = { retention_basis: basis.trim(), retention_months: count, acknowledged_warnings: warnings.map((warning) => warning.kind) }
    return {
      items,
      fieldIds: IDS,
      send: async () => {
        await api.post(`${OFFBOARDING_PATH}/confirm`, body)
        toast({ message: 'Offboarding confirmed. The account is read-only; run the final full export next.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Confirm the offboarding" submitLabel="Confirm offboarding" submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>From now on everyone can read and export, nobody can change data. Your vendor archives the account with a full export made after this confirmation; the data is then kept for the months below and deleted only after that.</p>
      <TextAreaField id={IDS.retention_basis} label="Retention basis" helper="The law or contract that sets how long the archive is kept." maxLength={BASIS_MAX} value={basis} error={errors[IDS.retention_basis]} onChange={setBasis} />
      <TextInput id={IDS.retention_months} label="Keep the archive for (months)" inputMode="numeric" helper={`1 to ${RETENTION_MONTHS_MAX}. No default: state the period your obligations require.`}
        value={months} error={errors[IDS.retention_months]} onChange={(event) => setMonths(event.target.value)} />
      {warnings.length > 0 && (
        <fieldset id={IDS.acknowledged_warnings} tabIndex={-1} className={FIELDSET}>
          <legend className={LEGEND}>Open obligations that stay with you</legend>
          {warnings.map((warning) => (
            <Checkbox key={warning.kind} label={`I acknowledge: ${blockerText(warning)}.`} checked={acknowledged.has(warning.kind)}
              onChange={(event) => setAcknowledged((current) => new Set([...current].filter((kind) => kind !== warning.kind).concat(event.target.checked ? [warning.kind] : [])))} />
          ))}
          {errors[IDS.acknowledged_warnings] != null && <Banner tone="danger">{errors[IDS.acknowledged_warnings]}</Banner>}
        </fieldset>
      )}
      <p className={NOTE}>You will be asked for a code from your authenticator app.</p>
    </FormDialog>
  )
}

/** POST /v1/offboarding/cancel (step-up): allowed while read-only, so a confirmed offboarding can still be called off. */
function CancelDialog({ onClose, onDone }: { readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  function submit() {
    return {
      items: [],
      send: async () => {
        await api.post(`${OFFBOARDING_PATH}/cancel`, {})
        toast({ message: 'Offboarding cancelled. The account works as before.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Cancel the offboarding" submitLabel="Cancel offboarding" onClose={onClose} onSubmit={submit}>
      <p>The vendor’s request ends and the account can be changed again. The vendor must request a new offboarding to start over. You will be asked for a code from your authenticator app.</p>
    </FormDialog>
  )
}

function BlockerList({ blockers }: { readonly blockers: readonly OffboardingBlocker[] }) {
  return (
    <ul className="flex flex-col gap-space-xs" aria-label="Open items">
      {blockers.map((blocker) => {
        const href = blockerHref(blocker.kind)
        return (
          <li key={blocker.kind} className="flex flex-wrap items-center justify-between gap-space-sm py-space-xs border-b border-outline-variant/40">
            <span className="flex items-center gap-space-xs">
              <StatusBadge state={blocker.blocking ? 'blocked' : 'held'} label={blocker.blocking ? 'Blocks' : 'Warning'} />
              <span className="font-body-sm text-body-sm text-on-surface">{blockerText(blocker)}</span>
            </span>
            {href !== null && <Link className="font-body-sm text-body-sm text-primary font-semibold hover:underline" href={href}>Open</Link>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * SC-29 Offboarding (FR-TEN-005, D-V1A-07; Tenant admin with tenant.offboard): the vendor's request, the items that
 * block it (with links) and the obligations to acknowledge, confirmation with retention basis and months, cancel.
 */
export function OffboardingCard() {
  const { can, supportReadOnly } = useSession()
  const view = useResource<OffboardingView>(can('tenant.offboard') ? OFFBOARDING_PATH : null)
  const [dialog, setDialog] = useState<'confirm' | 'cancel' | null>(null)
  if (!can('tenant.offboard')) return null
  // Confirm and cancel are allowed while the tenant is read-only (they lead out of it); a support session reads only.
  const writable = !supportReadOnly
  const done = () => {
    setDialog(null)
    view.reload()
  }
  const record = view.data?.offboarding ?? null
  const open = (view.data?.blockers ?? []).filter((blocker) => blocker.count > 0)
  const blocking = open.filter((blocker) => blocker.blocking)
  const warnings = open.filter((blocker) => !blocker.blocking)
  return (
    <section className={SECTION_CARD} aria-labelledby="offboarding-title" data-testid="offboarding">
      <SectionTitle id="offboarding-title" icon="inventory_2" title="Offboarding"
        action={record === null ? undefined : <StatusBadge {...OFFBOARDING_STATE_BADGES[record.state]} />} />
      {view.error !== null && <LoadFailure error={view.error} onRetry={view.reload} section />}
      {view.error === null && view.data === null && <LoadingState label="Loading the offboarding" />}
      {view.data !== null && record === null && (
        <p className={NOTE}>No offboarding is open. Your vendor starts one when the account is to be archived; you then review and confirm it here.</p>
      )}
      {record !== null && record.state === 'requested' && (
        <>
          <Banner tone="warning" title="Your vendor asked to offboard and archive this account">
            Requested {formatDateTime(record.requested_at)}. Reason: {record.reason}. Once you confirm, the account becomes read-only: everyone can read and export, nobody can change data.
          </Banner>
          <p className={NOTE}>
            {blocking.length === 0
              ? `Nothing blocks the confirmation.${warnings.length === 0 ? '' : ' Acknowledge the obligations listed when you confirm.'}`
              : 'Settle each blocking item before confirming; the counts update when you come back.'}
          </p>
          {open.length > 0 && <BlockerList blockers={open} />}
          {writable && (
            <div className="flex flex-wrap gap-space-sm">
              <Button variant="destructive-solid" icon="inventory_2" disabled={blocking.length > 0} onClick={() => setDialog('confirm')}>Confirm offboarding</Button>
              <Button onClick={() => setDialog('cancel')}>Cancel offboarding</Button>
            </div>
          )}
        </>
      )}
      {record !== null && record.state === 'confirmed' && (
        <>
          <Banner tone="info" title="Confirmed: the account is read-only">
            Confirmed {formatDateTime(record.confirmed_at)}; the archive is kept for {record.retention_months} months ({record.retention_basis}). Run the final full export now; your vendor archives the account with it.
          </Banner>
          <div className="flex flex-wrap gap-space-sm">
            <Link className="font-body-sm text-body-sm text-primary font-semibold hover:underline self-center" href="/settings/integrations?tab=exports">Run the final full export</Link>
            {writable && <Button onClick={() => setDialog('cancel')}>Cancel offboarding</Button>}
          </div>
        </>
      )}
      {record !== null && (record.state === 'archived' || record.state === 'purge_requested' || record.state === 'purge_approved') && (
        <p className={NOTE}>
          Archived {formatDateTime(record.archived_at)} with export <span className="font-data-mono-sm text-data-mono-sm">{record.export_id?.slice(0, 8)}</span>.
          {record.retain_until === null ? '' : ` Kept until ${formatDay(record.retain_until)}; deleted only after that and only by two vendor operators.`} Only your vendor can restore the account.
        </p>
      )}
      {dialog === 'confirm' && <ConfirmDialog warnings={warnings} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'cancel' && <CancelDialog onClose={() => setDialog(null)} onDone={done} />}
    </section>
  )
}
