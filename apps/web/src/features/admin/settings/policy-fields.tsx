'use client'

import { Checkbox, FieldError, Select, TextInput } from '../../../components/form-field'
import { useResource } from '../../../lib/use-resource'
import { FIELDSET, LEGEND, PAIR } from '../ui'
import {
  ATTRIBUTION_OPTIONS, CLAWBACK_OPTIONS, CREDITING_OPTIONS, keyLabel, PURPOSE_OPTIONS, REASSIGNMENT_OPTIONS, RESTOCKING_OPTIONS,
  ROUNDING_OPTIONS, SIGNAL_OPTIONS, type PolicyKey,
} from './labels'
import { PARTICIPANT_TYPES_PATH, type ParticipantType } from './types'

/** The form text of one policy value, by field name (checkboxes are 'true' or ''). */
export type Draft = Readonly<Record<string, string>>
/** Field name -> message. */
export type FieldErrors = Readonly<Record<string, string>>

/** The element id of a policy field (summary links point at it). */
export const fieldId = (field: string): string => `version-${field}`

const NOTICE_MAX_DAYS = 365
const REASSIGNMENT_MAX_DAYS = 90
const BEHIND_MAX_MINUTES = 10_080
const FAILING_MAX_MINUTES = 20_160
const DEPTH_MAX = 20
const WIDTH_MIN = 2
const WIDTH_MAX = 20
const TYPE_CODE = /^[A-Z][A-Z0-9_]{0,31}$/
const WHOLE = /^\d{1,6}$/
const PRECEDENCE_FIELDS = ['first', 'second', 'third'] as const

const yes = (flag: unknown): string => (flag === true ? 'true' : '')
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value))

/** The form text of the value in force, so a change starts from it ({} while unset). */
export function draftOf(key: PolicyKey, value: unknown): Draft {
  if (value === null || value === undefined) return {}
  const record = (typeof value === 'object' ? value : {}) as Readonly<Record<string, unknown>>
  switch (key) {
    case 'money.clawback_policy': return { value: text(record.default) }
    case 'participants.duplicate_matching': {
      const signals = Array.isArray(record.signals) ? record.signals : []
      return { ...Object.fromEntries(signals.map((signal) => [`signal_${String(signal)}`, 'true'])), min_matches: text(record.min_matches), hold_activation: yes(record.hold_activation) }
    }
    case 'customers.reassignment_rule': return { rule: text(record.rule), notice_days: text(record.notice_days) }
    case 'orders.attribution_precedence': return Object.fromEntries((value as readonly unknown[]).map((entry, index) => [PRECEDENCE_FIELDS[index], text(entry)]))
    case 'integrations.sync_health': return { behind: text(record.behind_after_minutes), failing: text(record.failing_after_minutes) }
    case 'genealogy.visibility_policy': return { named_depth: text(record.named_depth), contact: yes(record.contact_for_personally_sponsored) }
    default: return { value: text(value) }
  }
}

interface Built {
  readonly value?: unknown
  readonly errors: FieldErrors
}

/** A whole number from min to max, or the error for the field. */
function whole(draft: Draft, field: string, min: number, max: number, what: string): { readonly number?: number; readonly error?: readonly [string, string] } {
  const raw = (draft[field] ?? '').trim()
  const number = Number(raw)
  return WHOLE.test(raw) && number >= min && number <= max ? { number } : { error: [field, `Enter ${what} as a whole number from ${min} to ${max}.`] }
}

function built(value: unknown, errors: readonly (readonly [string, string] | undefined)[]): Built {
  const found = Object.fromEntries(errors.filter((error) => error !== undefined))
  return Object.keys(found).length > 0 ? { errors: found } : { value, errors: {} }
}

function choice(draft: Draft, key: PolicyKey): readonly [string, string] | undefined {
  return (draft.value ?? '') === '' ? ['value', `Choose the ${keyLabel(key).toLowerCase()}.`] : undefined
}

/** The value to PUT for a key from its form text, or the errors by field (the API validates again). */
export function policyValue(key: PolicyKey, draft: Draft): Built {
  const value = draft.value ?? ''
  switch (key) {
    case 'plan.activation_notice_days': {
      const days = whole(draft, 'value', 0, NOTICE_MAX_DAYS, 'the days of notice')
      return built(days.number, [days.error])
    }
    case 'money.clawback_policy': return built({ default: value }, [choice(draft, key)])
    case 'participants.duplicate_matching': {
      const signals = SIGNAL_OPTIONS.map((option) => option.value).filter((signal) => draft[`signal_${signal}`] === 'true')
      const min = whole(draft, 'min_matches', 1, Math.max(signals.length, 1), 'the matches needed')
      return built(
        { signals, min_matches: min.number, hold_activation: draft.hold_activation === 'true' },
        [signals.length === 0 ? ['signals', 'Choose at least one signal.'] : undefined, min.error],
      )
    }
    case 'customers.reassignment_rule': {
      const notice = whole(draft, 'notice_days', 0, REASSIGNMENT_MAX_DAYS, 'the days of notice')
      return built(
        { rule: draft.rule, notice_days: notice.number },
        [(draft.rule ?? '') === '' ? ['rule', 'Choose where the customers go.'] : undefined, notice.error],
      )
    }
    case 'orders.purpose_required': return built(value === 'true', [choice(draft, key)])
    case 'orders.attribution_precedence': {
      const order = PRECEDENCE_FIELDS.map((field) => draft[field] ?? '').filter((entry) => entry !== '')
      return built(order, [
        (draft.first ?? '') === '' ? ['first', 'Choose the source that counts first.'] : undefined,
        new Set(order).size === order.length ? undefined : ['second', 'Choose each source once.'],
      ])
    }
    case 'orders.new_buyer_type':
      return built(value, [TYPE_CODE.test(value) ? undefined : ['value', 'Choose the type new buyers get.']])
    case 'integrations.sync_health': {
      const behind = whole(draft, 'behind', 1, BEHIND_MAX_MINUTES, 'the behind lag')
      const failing = whole(draft, 'failing', 2, FAILING_MAX_MINUTES, 'the failing lag')
      const order = behind.number !== undefined && failing.number !== undefined && failing.number <= behind.number
        ? ['failing', 'The failing lag must be longer than the behind lag.'] as const
        : undefined
      return built({ behind_after_minutes: behind.number, failing_after_minutes: failing.number }, [behind.error, failing.error ?? order])
    }
    case 'genealogy.placement_width': {
      const width = whole(draft, 'value', WIDTH_MIN, WIDTH_MAX, 'the legs per position')
      return built(width.number, [width.error])
    }
    case 'genealogy.visibility_policy': {
      const depth = whole(draft, 'named_depth', 1, DEPTH_MAX, 'the named levels')
      return built({ named_depth: depth.number, contact_for_personally_sponsored: draft.contact === 'true' }, [depth.error])
    }
    default: return built(value, [choice(draft, key)])
  }
}

export interface PolicyFieldsProps {
  readonly policyKey: PolicyKey
  readonly draft: Draft
  readonly errors: FieldErrors
  readonly onChange: (field: string, value: string) => void
}

/** Active types whose members count as end customers: the choices for new buyers (BUYER_TYPE_INVALID otherwise). */
function BuyerTypeField({ draft, errors, onChange }: Omit<PolicyFieldsProps, 'policyKey'>) {
  const types = useResource<readonly ParticipantType[]>(PARTICIPANT_TYPES_PATH, { state: 'active' })
  const options = (types.data ?? []).filter((type) => type.counts_as_end_customer).map((type) => ({ value: type.code, label: `${type.name} (${type.code})` }))
  const helper = types.data !== null && options.length === 0 ? 'No active type counts as an end customer yet. Propose one under Participant types.' : 'Buyers the orders name who are not enrolled are created with this type.'
  return (
    <Select id={fieldId('value')} label="Type of new buyers" placeholder={types.loading ? 'Loading types' : 'Choose a type'} options={options}
      helper={helper} value={draft.value ?? ''} error={errors.value} onChange={(event) => onChange('value', event.target.value)} />
  )
}

/** The fields of one policy value (sc_29 "Draft" modal body). */
export function PolicyFields({ policyKey, draft, errors, onChange }: PolicyFieldsProps) {
  const input = (field: string, label: string, helper?: string) => (
    <TextInput id={fieldId(field)} label={label} helper={helper} inputMode="numeric" value={draft[field] ?? ''} error={errors[field]} onChange={(event) => onChange(field, event.target.value)} />
  )
  const select = (field: string, label: string, options: readonly { readonly value: string; readonly label: string }[], optional = false) => (
    <Select id={fieldId(field)} label={label} optional={optional} placeholder={optional ? undefined : 'Choose'} options={optional ? [{ value: '', label: 'None' }, ...options] : options}
      value={draft[field] ?? ''} error={errors[field]} onChange={(event) => onChange(field, event.target.value)} />
  )
  const check = (field: string, label: string, helper?: string) => (
    <Checkbox key={field} id={fieldId(field)} label={label} helper={helper} checked={draft[field] === 'true'} onChange={(event) => onChange(field, event.target.checked ? 'true' : '')} />
  )
  switch (policyKey) {
    case 'money.rounding_mode': return select('value', 'Rounding mode', ROUNDING_OPTIONS)
    case 'money.clawback_policy': return select('value', 'Clawback default', CLAWBACK_OPTIONS)
    case 'plan.activation_notice_days': return input('value', 'Days of notice', `0 to ${NOTICE_MAX_DAYS} days before a plan version activates.`)
    case 'participants.duplicate_matching':
      return (
        <>
          <fieldset className={FIELDSET} id={fieldId('signals')} tabIndex={-1}>
            <legend className={LEGEND}>Signals compared</legend>
            {SIGNAL_OPTIONS.map((option) => check(`signal_${option.value}`, option.label))}
            {errors.signals !== undefined && <FieldError message={errors.signals} />}
          </fieldset>
          {input('min_matches', 'Matches needed', 'How many of the chosen signals another participant must share.')}
          {check('hold_activation', 'Hold activation while a duplicate case is open', 'The new position stays pending until the case is decided.')}
        </>
      )
    case 'customers.reassignment_rule':
      return (
        <div className={PAIR}>
          {select('rule', 'Customers go', REASSIGNMENT_OPTIONS)}
          {input('notice_days', 'Days of notice', `0 to ${REASSIGNMENT_MAX_DAYS} days after the termination.`)}
        </div>
      )
    case 'orders.crediting_event': return select('value', 'Orders are credited', CREDITING_OPTIONS)
    case 'orders.purpose_required': return select('value', 'Order purpose', PURPOSE_OPTIONS)
    case 'orders.attribution_precedence':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-md">
          {select('first', 'Counts first', ATTRIBUTION_OPTIONS)}
          {select('second', 'Then', ATTRIBUTION_OPTIONS, true)}
          {select('third', 'Then', ATTRIBUTION_OPTIONS, true)}
        </div>
      )
    case 'orders.new_buyer_type': return <BuyerTypeField draft={draft} errors={errors} onChange={onChange} />
    case 'orders.restocking_fee_volume_effect': return select('value', 'Volume effect of a restocking fee', RESTOCKING_OPTIONS)
    case 'integrations.sync_health':
      return (
        <div className={PAIR}>
          {input('behind', 'Behind after (minutes)', `1 to ${BEHIND_MAX_MINUTES} minutes without an accepted event.`)}
          {input('failing', 'Failing after (minutes)', `Longer than the behind lag, at most ${FAILING_MAX_MINUTES}.`)}
        </div>
      )
    case 'genealogy.placement_width': return input('value', 'Legs per position', `${WIDTH_MIN} to ${WIDTH_MAX}.`)
    case 'genealogy.visibility_policy':
      return (
        <>
          {input('named_depth', 'Levels shown by name', `1 to ${DEPTH_MAX}. Deeper levels are shown to distributors as counts per level only.`)}
          {check('contact', 'Show the masked contact of personally sponsored participants')}
        </>
      )
  }
}
