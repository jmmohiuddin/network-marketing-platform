'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { ApiError } from '../../lib/api'
import { Select, TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { countLabel } from '../../lib/format'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { PAIR } from '../admin/ui'
import { explained, REASON_ID, summaryItems } from './structure-dialogs'
import type { Market } from '../../lib/markets'
import type { Calendar } from './types'

const PERIODS_AHEAD_MAX = 120
const DATE = /^\d{4}-\d{2}-\d{2}$/
const WHOLE = /^\d{1,3}$/

export interface CalendarFields {
  readonly market_id: string
  readonly name: string
  readonly cadence: string
  readonly cutoff_time_zone: string
  readonly first_period_start: string
  readonly periods_ahead: string
  /** '' = a final calendar; else the final calendar this one pays advances for (D-V1A-02). */
  readonly provisional_for: string
}

/** Client checks of a new calendar; periods_ahead has no default (the user states the horizon). */
export function calendarErrors(fields: CalendarFields): Record<string, string | null> {
  const ahead = Number(fields.periods_ahead.trim())
  const start = fields.first_period_start
  return {
    'calendar-market': fields.market_id === '' ? 'Choose the market.' : null,
    'calendar-name': requiredError('the calendar name', fields.name),
    'calendar-cadence': fields.cadence === '' ? 'Choose monthly or weekly.' : null,
    'calendar-zone': requiredError('the cut-off time zone, for example Europe/Paris', fields.cutoff_time_zone),
    'calendar-start': !DATE.test(start) ? 'Enter the first period’s start date.'
      : fields.cadence === 'monthly' && !start.endsWith('-01') ? 'A monthly calendar starts on the first day of a month.' : null,
    'calendar-ahead': WHOLE.test(fields.periods_ahead.trim()) && ahead >= 1 && ahead <= PERIODS_AHEAD_MAX ? null : `Enter how many periods to generate, from 1 to ${PERIODS_AHEAD_MAX}.`,
  }
}

const CADENCES = [{ value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }]

/** POST /v1/calendars: the market, cadence, cut-off zone and first start never change afterwards. */
export function CalendarDialog({ markets, calendars, onClose, onSaved }: {
  readonly markets: readonly Market[]
  /** Existing calendars: the final ones of the chosen market can take advances. */
  readonly calendars: readonly Calendar[]
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const api = useApi()
  const toast = useToast()
  const [fields, setFields] = useState<CalendarFields>({ market_id: '', name: '', cadence: '', cutoff_time_zone: '', first_period_start: '', periods_ahead: '', provisional_for: '' })
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const set = (field: keyof CalendarFields) => (event: { target: { value: string } }) => setFields({ ...fields, [field]: event.target.value })
  const finals = calendars.filter((calendar) => calendar.market.id === fields.market_id && calendar.provisional_for === null)
  function submit(idempotencyKey: string) {
    const found = { ...calendarErrors(fields), [REASON_ID]: requiredError('the reason for this change', reason) }
    setErrors(found)
    const items = summaryItems(found)
    if (items.length > 0) return { items }
    const body = {
      market_id: fields.market_id, name: fields.name.trim(), cadence: fields.cadence, cutoff_time_zone: fields.cutoff_time_zone.trim(),
      first_period_start: fields.first_period_start, periods_ahead: Number(fields.periods_ahead.trim()), reason: reason.trim(),
      ...(fields.provisional_for === '' ? {} : { provisional_for_calendar_id: fields.provisional_for }),
    }
    return {
      items,
      fieldIds: { market_id: 'calendar-market', name: 'calendar-name', cadence: 'calendar-cadence', cutoff_time_zone: 'calendar-zone', first_period_start: 'calendar-start', periods_ahead: 'calendar-ahead', provisional_for_calendar_id: 'calendar-provisional', reason: REASON_ID },
      send: async () => {
        const saved = await explained(() => api.post<{ calendar: Calendar; generated: number }>('/v1/calendars', body, { idempotencyKey }).catch((error: unknown) => {
          throw provisionalRefusal(error)
        }))
        toast({ message: `Calendar ${saved.data.calendar.name} created with ${countLabel(saved.data.generated, 'period')}.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title="Add calendar" size="lg" submitLabel="Add calendar" onClose={onClose} onSubmit={submit}>
      <div className={PAIR}>
        <Select id="calendar-market" label="Market" placeholder="Choose" options={markets.map((market) => ({ value: market.id, label: market.code }))} value={fields.market_id} error={errors['calendar-market']} onChange={(event) => setFields({ ...fields, market_id: event.target.value, provisional_for: '' })} />
        <TextInput id="calendar-name" label="Name" maxLength={100} value={fields.name} error={errors['calendar-name']} onChange={set('name')} />
        <Select id="calendar-cadence" label="Cadence" placeholder="Choose" options={CADENCES} value={fields.cadence} error={errors['calendar-cadence']} onChange={set('cadence')} />
        <TextInput id="calendar-zone" label="Cut-off time zone" helper="IANA name: periods start at local midnight there." value={fields.cutoff_time_zone} error={errors['calendar-zone']} onChange={set('cutoff_time_zone')} />
        <TextInput id="calendar-start" type="date" label="First period starts" helper="Monthly calendars start on the 1st; weekly periods start on this weekday." value={fields.first_period_start} error={errors['calendar-start']} onChange={set('first_period_start')} />
        <TextInput id="calendar-ahead" label="Periods to generate" helper={`1 to ${PERIODS_AHEAD_MAX}, counted ahead of today.`} inputMode="numeric" value={fields.periods_ahead} error={errors['calendar-ahead']} onChange={set('periods_ahead')} />
        <Select id="calendar-provisional" label="Provisional for" value={fields.provisional_for} disabled={fields.market_id === ''}
          helper="Pays advances that the chosen final calendar trues up. Its periods are cut at the final calendar's period ends; this never changes later."
          options={[{ value: '', label: 'None: a final calendar' }, ...finals.map((calendar) => ({ value: calendar.id, label: calendar.name }))]} onChange={set('provisional_for')} />
      </div>
      <TextAreaField id={REASON_ID} label="Reason for the change" helper="Kept with the new settings version." value={reason} error={errors[REASON_ID]} onChange={setReason} />
    </FormDialog>
  )
}

const TARGET_REASONS: Readonly<Record<string, string>> = {
  other_market: 'The final calendar belongs to another market.',
  target_provisional: 'The chosen calendar pays advances itself; choose a final calendar.',
  periods_not_nested: 'The first period starts before the final calendar\u2019s first period, so its periods would not fall inside final periods.',
}

/** 422 PROVISIONAL_TARGET_INVALID {reason} in words, on the Provisional for field. */
function provisionalRefusal(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.code !== 'PROVISIONAL_TARGET_INVALID') return error
  const reason = (error.details as { reason?: string } | null)?.reason
  const message = (reason === undefined ? undefined : TARGET_REASONS[reason]) ?? error.message
  return new ApiError(422, 'VALIDATION_FAILED', message, { issues: [{ path: 'provisional_for_calendar_id', message }] }, error.requestId)
}

/** PATCH /v1/calendars/:id: only the name changes (timing is immutable, D-B1-11). */
export function RenameCalendarDialog({ calendar, onClose, onSaved }: { readonly calendar: Calendar; readonly onClose: () => void; readonly onSaved: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [name, setName] = useState(calendar.name)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  function submit() {
    const found = { 'calendar-rename': requiredError('the calendar name', name), [REASON_ID]: requiredError('the reason for this change', reason) }
    setErrors(found)
    const items = summaryItems(found)
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: { name: 'calendar-rename', reason: REASON_ID },
      send: async () => {
        await explained(() => api.patch(`/v1/calendars/${calendar.id}`, { name: name.trim(), reason: reason.trim() }))
        toast({ message: `Calendar renamed to ${name.trim()}.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={`Rename calendar ${calendar.name}`} submitLabel="Rename calendar" onClose={onClose} onSubmit={submit}>
      <p>Only the name can change. The market, cadence, cut-off time zone and first period stay as they are.</p>
      <TextInput id="calendar-rename" label="Name" maxLength={100} value={name} error={errors['calendar-rename']} onChange={(event) => setName(event.target.value)} data-autofocus />
      <TextAreaField id={REASON_ID} label="Reason for the change" value={reason} error={errors[REASON_ID]} onChange={setReason} />
    </FormDialog>
  )
}

/** POST /v1/calendars/:id/periods: periods starting on or before a date (existing periods are kept). */
export function ExtendDialog({ calendar, onClose, onSaved }: { readonly calendar: Calendar; readonly onClose: () => void; readonly onSaved: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [through, setThrough] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  function submit(idempotencyKey: string) {
    const found = { 'calendar-through': DATE.test(through) ? null : 'Enter the date up to which periods start.', [REASON_ID]: requiredError('the reason for this change', reason) }
    setErrors(found)
    const items = summaryItems(found)
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: { through: 'calendar-through', reason: REASON_ID },
      send: async () => {
        const result = await explained(() => api.post<{ generated: number }>(`/v1/calendars/${calendar.id}/periods`, { through, reason: reason.trim() }, { idempotencyKey }))
        toast({ message: `${countLabel(result.data.generated, 'period')} added to ${calendar.name}.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={`Extend calendar ${calendar.name}`} submitLabel="Generate periods" onClose={onClose} onSubmit={submit}>
      <TextInput id="calendar-through" type="date" label="Generate periods starting up to" helper={`A local date in ${calendar.cutoff_time_zone}.`} value={through} error={errors['calendar-through']} onChange={(event) => setThrough(event.target.value)} data-autofocus />
      <TextAreaField id={REASON_ID} label="Reason for the change" value={reason} error={errors[REASON_ID]} onChange={setReason} />
    </FormDialog>
  )
}
