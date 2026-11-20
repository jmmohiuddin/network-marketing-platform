'use client'

import { Checkbox, FieldError, Select, TextInput } from '../../../components/form-field'
import { MARKETS_PATH, type Market } from '../../../lib/markets'
import { useResource } from '../../../lib/use-resource'
import { minorToDecimal } from '../../orders/format'
import { FIELDSET, LEGEND, PAIR } from '../ui'
import {
  ATTRIBUTION_OPTIONS, CADENCE_OPTIONS, CLAWBACK_OPTIONS, CONTACT_VISIBLE_OPTIONS, CREDITING_OPTIONS, keyLabel, PURPOSE_OPTIONS, REASSIGNMENT_OPTIONS, RELATED_ACTION_OPTIONS, RESTOCKING_OPTIONS,
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
const COOLING_OFF_MAX_HOURS = 2160
const SHARED_MAX = 1000
const DAYS_MAX = 3650
const REMINDER_MAX_DAYS = 365
/** Whole minor units, as the API's bigint strings. */
const MINOR = /^(0|[1-9]\d{0,17})$/
const MIN_PREFIX = 'min_'
const TAX_PREFIX = 'tax_'
/** disputes.policy and privacy.policy: per market id the days to respond (D-B5-20). */
const DAYS_PREFIX = 'days_'
const RESPONSE_MAX_DAYS = 365
const ESCALATE_MAX_DAYS = 60
/** plan.filing_requirements: one checkbox per market (market_<id>). */
const MARKET_PREFIX = 'market_'
const HOUR_MAX = 23

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
    case 'payouts.market_policy':
      return Object.fromEntries(Object.entries(record).flatMap(([marketId, policy]) => {
        const entry = (policy ?? {}) as Readonly<Record<string, unknown>>
        return [[`${MIN_PREFIX}${marketId}`, text(entry.minimum_payout_minor)], [`${TAX_PREFIX}${marketId}`, yes(entry.tax_profile_required)]]
      }))
    case 'plan.filing_requirements':
      return Object.fromEntries((Array.isArray(record.market_ids) ? record.market_ids : []).map((id) => [`${MARKET_PREFIX}${String(id)}`, 'true']))
    case 'exports.full_schedule': return { cadence: text(record.cadence), hour: text(record.hour_utc) }
    case 'disputes.policy': return { window: text(record.window_days), ...marketDaysDraft(record.response_days) }
    case 'privacy.policy': return { escalate: text(record.escalate_before_days), ...marketDaysDraft(record.response_days) }
    case 'adjustments.policy':
      return { above: text(record.second_approver_above_minor), new_days: text(record.new_account_days), related: text(record.related_account_action) }
    case 'write_offs.policy':
      return { below: text(record.eligible_below_minor), after_days: text(record.eligible_after_days), above: text(record.second_approver_above_minor) }
    default: return { value: text(value) }
  }
}

function marketDaysDraft(record: unknown): Draft {
  return Object.fromEntries(Object.entries((record ?? {}) as Readonly<Record<string, unknown>>).map(([marketId, count]) => [`${DAYS_PREFIX}${marketId}`, text(count)]))
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

/** Whole minor units (a bigint string), or the error for the field; '' is allowed when optional. */
function minorField(draft: Draft, field: string, what: string, optional = false): { readonly value?: string; readonly error?: readonly [string, string] } {
  const raw = (draft[field] ?? '').trim()
  if (raw === '' && optional) return {}
  return MINOR.test(raw) ? { value: raw } : { error: [field, `Enter ${what} as a whole number of minor units.`] }
}

/** payouts.market_policy from the min_<market>/tax_<market> fields: markets without a minimum are left out. */
function marketPolicy(draft: Draft): Built {
  const markets = Object.keys(draft).filter((field) => field.startsWith(MIN_PREFIX) && (draft[field] ?? '').trim() !== '').map((field) => field.slice(MIN_PREFIX.length))
  const minimums = markets.map((id) => minorField(draft, `${MIN_PREFIX}${id}`, 'the minimum payout'))
  const taxOnly = Object.keys(draft).find((field) => field.startsWith(TAX_PREFIX) && draft[field] === 'true' && !markets.includes(field.slice(TAX_PREFIX.length)))
  const value = Object.fromEntries(markets.map((id, index) => [id, { minimum_payout_minor: minimums[index]!.value, tax_profile_required: draft[`${TAX_PREFIX}${id}`] === 'true' }]))
  return built(value, [
    ...minimums.map((minimum) => minimum.error),
    taxOnly === undefined ? undefined : [`${MIN_PREFIX}${taxOnly.slice(TAX_PREFIX.length)}`, 'Enter the minimum payout of this market too.'] as const,
    markets.length === 0 ? ['markets', 'Enter the minimum payout of at least one market.'] as const : undefined,
  ])
}

/** response_days from the days_<market> fields: markets left empty have no response time (DEC-14). */
function marketDays(draft: Draft): { readonly value: Readonly<Record<string, number | undefined>>; readonly errors: readonly (readonly [string, string] | undefined)[] } {
  const fields = Object.keys(draft).filter((field) => field.startsWith(DAYS_PREFIX) && (draft[field] ?? '').trim() !== '')
  const counts = fields.map((field) => whole(draft, field, 1, RESPONSE_MAX_DAYS, 'the days'))
  return { value: Object.fromEntries(fields.map((field, index) => [field.slice(DAYS_PREFIX.length), counts[index]!.number])), errors: counts.map((count) => count.error) }
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
    case 'payouts.market_policy': return marketPolicy(draft)
    case 'payouts.bank_detail_cooling_off_hours': {
      const hours = whole(draft, 'value', 0, COOLING_OFF_MAX_HOURS, 'the cooling-off hours')
      return built(hours.number, [hours.error])
    }
    case 'payouts.shared_account_threshold': {
      const payees = whole(draft, 'value', 1, SHARED_MAX, 'the number of payees')
      return built(payees.number, [payees.error])
    }
    case 'payouts.dormant_after_days': {
      const age = whole(draft, 'value', 1, DAYS_MAX, 'the days')
      return built(age.number, [age.error])
    }
    case 'payouts.provider_review_reminder_days': {
      const ahead = whole(draft, 'value', 1, REMINDER_MAX_DAYS, 'the days')
      return built(ahead.number, [ahead.error])
    }
    case 'adjustments.policy': {
      const above = minorField(draft, 'above', 'the second-approver threshold')
      const days = whole(draft, 'new_days', 0, DAYS_MAX, 'the new-account days')
      return built(
        { second_approver_above_minor: above.value, new_account_days: days.number, related_account_action: draft.related },
        [above.error, days.error, (draft.related ?? '') === '' ? ['related', 'Choose what happens for a related or new account.'] : undefined],
      )
    }
    case 'disputes.policy': {
      const open = (draft.window ?? '').trim() === '' ? { number: undefined, error: undefined } : whole(draft, 'window', 1, DAYS_MAX, 'the dispute window')
      const response = marketDays(draft)
      return built({ ...(open.number === undefined ? {} : { window_days: open.number }), response_days: response.value }, [open.error, ...response.errors])
    }
    case 'privacy.policy': {
      const escalate = whole(draft, 'escalate', 0, ESCALATE_MAX_DAYS, 'the days before the deadline')
      const response = marketDays(draft)
      return built({ response_days: response.value, escalate_before_days: escalate.number }, [...response.errors, escalate.error])
    }
    case 'portal.customer_contact_visible': return built(value === 'true', [choice(draft, key)])
    case 'plan.filing_requirements': {
      const ids = Object.keys(draft).filter((field) => field.startsWith(MARKET_PREFIX) && draft[field] === 'true').map((field) => field.slice(MARKET_PREFIX.length))
      return built({ market_ids: ids }, [ids.length === 0 ? ['markets', 'Choose at least one market.'] : undefined])
    }
    case 'exports.full_schedule': {
      const hour = whole(draft, 'hour', 0, HOUR_MAX, 'the hour (UTC)')
      const cadence = (draft.cadence ?? '') === '' ? ['cadence', 'Choose how often the export runs.'] as const : undefined
      return built({ cadence: draft.cadence, hour_utc: hour.number }, [cadence, hour.error])
    }
    case 'write_offs.policy': {
      const below = minorField(draft, 'below', 'the eligibility amount', true)
      const afterRaw = (draft.after_days ?? '').trim()
      const after = afterRaw === '' ? { number: undefined, error: undefined } : whole(draft, 'after_days', 1, DAYS_MAX, 'the eligibility age')
      const above = minorField(draft, 'above', 'the second-approver threshold')
      const none = below.value === undefined && below.error === undefined && afterRaw === '' ? ['below', 'Enter an eligibility amount, an eligibility age, or both.'] as const : undefined
      return built({
        ...(below.value === undefined ? {} : { eligible_below_minor: below.value }),
        ...(after.number === undefined ? {} : { eligible_after_days: after.number }),
        second_approver_above_minor: above.value,
      }, [below.error ?? none, after.error, above.error])
    }
    default: return built(value, [choice(draft, key)])
  }
}

const MINOR_HELP = 'Whole minor units of each market’s currency: 10000 is 100.00 in a currency with two decimals.'

/** payouts.market_policy: a minimum (minor units, shown in the currency) and the tax-profile flag per market. */
function MarketPolicyFields({ draft, errors, onChange }: Omit<PolicyFieldsProps, 'policyKey'>) {
  const markets = useResource<Market[]>(MARKETS_PATH)
  return (
    <fieldset className={FIELDSET} id={fieldId('markets')} tabIndex={-1}>
      <legend className={LEGEND}>Per market (leave the minimum empty to leave a market out)</legend>
      {markets.data === null && <p>Loading markets…</p>}
      {(markets.data ?? []).map((market) => {
        const minimum = (draft[`${MIN_PREFIX}${market.id}`] ?? '').trim()
        const shown = MINOR.test(minimum) ? ` = ${minorToDecimal(minimum, market.minor_unit)} ${market.currency}` : ''
        return (
          <div key={market.id} className={PAIR}>
            <TextInput id={fieldId(`${MIN_PREFIX}${market.id}`)} label={`Minimum payout ${market.code} (minor units)`} inputMode="numeric" optional
              helper={`Payables of at least this amount are paid${shown}.`} value={draft[`${MIN_PREFIX}${market.id}`] ?? ''} error={errors[`${MIN_PREFIX}${market.id}`]}
              onChange={(event) => onChange(`${MIN_PREFIX}${market.id}`, event.target.value)} />
            <Checkbox id={fieldId(`${TAX_PREFIX}${market.id}`)} label={`${market.code}: tax profile required`} checked={draft[`${TAX_PREFIX}${market.id}`] === 'true'}
              onChange={(event) => onChange(`${TAX_PREFIX}${market.id}`, event.target.checked ? 'true' : '')} />
          </div>
        )
      })}
      {errors.markets !== undefined && <FieldError message={errors.markets} />}
    </fieldset>
  )
}

/** disputes.policy / privacy.policy: the days to respond per market; an empty market has no response time. */
function MarketDaysFields({ draft, errors, onChange, legend }: Omit<PolicyFieldsProps, 'policyKey'> & { readonly legend: string }) {
  const markets = useResource<Market[]>(MARKETS_PATH)
  return (
    <fieldset className={FIELDSET}>
      <legend className={LEGEND}>{legend}</legend>
      {markets.data === null && <p>Loading markets…</p>}
      {(markets.data ?? []).map((market) => (
        <TextInput key={market.id} id={fieldId(`${DAYS_PREFIX}${market.id}`)} label={`${market.code} (days)`} inputMode="numeric" optional
          helper={`1 to ${RESPONSE_MAX_DAYS}. Leave empty for no response time in ${market.code}.`} value={draft[`${DAYS_PREFIX}${market.id}`] ?? ''}
          error={errors[`${DAYS_PREFIX}${market.id}`]} onChange={(event) => onChange(`${DAYS_PREFIX}${market.id}`, event.target.value)} />
      ))}
    </fieldset>
  )
}

export interface PolicyFieldsProps {
  readonly policyKey: PolicyKey
  readonly draft: Draft
  readonly errors: FieldErrors
  readonly onChange: (field: string, value: string) => void
}

/** plan.filing_requirements: the markets whose plan changes need a recorded filing. */
function FilingMarketsFields({ draft, errors, onChange }: Omit<PolicyFieldsProps, 'policyKey'>) {
  const markets = useResource<Market[]>(MARKETS_PATH)
  return (
    <fieldset className={FIELDSET} id={fieldId('markets')} tabIndex={-1}>
      <legend className={LEGEND}>Markets that require a filing before a plan version is scheduled</legend>
      {markets.data === null && <p>Loading markets…</p>}
      {(markets.data ?? []).map((market) => (
        <Checkbox key={market.id} id={fieldId(`${MARKET_PREFIX}${market.id}`)} label={`${market.name} (${market.code})`} checked={draft[`${MARKET_PREFIX}${market.id}`] === 'true'}
          onChange={(event) => onChange(`${MARKET_PREFIX}${market.id}`, event.target.checked ? 'true' : '')} />
      ))}
      {errors.markets !== undefined && <FieldError message={errors.markets} />}
    </fieldset>
  )
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
    case 'payouts.market_policy': return <MarketPolicyFields draft={draft} errors={errors} onChange={onChange} />
    case 'payouts.bank_detail_cooling_off_hours': return input('value', 'Cooling-off hours', `0 to ${COOLING_OFF_MAX_HOURS}. A new bank account is left out of payout batches for this long after its approval.`)
    case 'payouts.shared_account_threshold': return input('value', 'Payees sharing one account', `1 to ${SHARED_MAX}. A bank-detail change shared by this many payees is flagged to its approver.`)
    case 'payouts.dormant_after_days': return input('value', 'Days unpaid', `1 to ${DAYS_MAX}. Payables unpaid this long are listed as dormant.`)
    case 'payouts.provider_review_reminder_days': return input('value', 'Days before the review date', `1 to ${REMINDER_MAX_DAYS}. Market managers are reminded this long before a payout provider's review is due.`)
    case 'adjustments.policy':
      return (
        <>
          {input('above', 'Second approver above (minor units)', MINOR_HELP)}
          {input('new_days', 'New-account days', `0 to ${DAYS_MAX}. A payee enrolled within this many days counts as a new account.`)}
          {select('related', 'Related or new account', RELATED_ACTION_OPTIONS)}
        </>
      )
    case 'write_offs.policy':
      return (
        <>
          {input('below', 'Eligible below (minor units, optional)', MINOR_HELP)}
          {input('after_days', 'Eligible after days outstanding (optional)', `1 to ${DAYS_MAX}. At least one eligibility rule is needed.`)}
          {input('above', 'Second approver above (minor units)', MINOR_HELP)}
        </>
      )
    case 'disputes.policy':
      return (
        <>
          <TextInput id={fieldId('window')} label="Dispute window (days after a commit)" inputMode="numeric" optional value={draft.window ?? ''} error={errors.window}
            helper={`1 to ${DAYS_MAX}. A line can be disputed this long after its run is committed; leave empty for no window.`} onChange={(event) => onChange('window', event.target.value)} />
          <MarketDaysFields draft={draft} errors={errors} onChange={onChange} legend="Days to respond to a dispute, per market" />
        </>
      )
    case 'privacy.policy':
      return (
        <>
          <MarketDaysFields draft={draft} errors={errors} onChange={onChange} legend="Days to answer a privacy request, per market" />
          {input('escalate', 'Escalate days before the deadline', `0 to ${ESCALATE_MAX_DAYS}. Open requests this close to their deadline are escalated to the DPOs.`)}
        </>
      )
    case 'portal.customer_contact_visible': return select('value', 'Customers’ contact in the portal', CONTACT_VISIBLE_OPTIONS)
    case 'plan.filing_requirements': return <FilingMarketsFields draft={draft} errors={errors} onChange={onChange} />
    case 'exports.full_schedule':
      return (
        <div className={PAIR}>
          {select('cadence', 'How often', CADENCE_OPTIONS)}
          {input('hour', 'Hour (UTC)', `0 to ${HOUR_MAX}. The export starts at this hour or soon after.`)}
        </div>
      )
    case 'genealogy.visibility_policy':
      return (
        <>
          {input('named_depth', 'Levels shown by name', `1 to ${DEPTH_MAX}. Deeper levels are shown to distributors as counts per level only.`)}
          {check('contact', 'Show the masked contact of personally sponsored participants')}
        </>
      )
  }
}
