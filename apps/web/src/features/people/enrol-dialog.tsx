'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import type { SummaryItem } from '../../components/error-summary'
import { Checkbox, RadioGroup, Select, TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import type { Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { formatDateTime } from '../../lib/format'
import { emailError } from '../../lib/validation'
import { fromLocalInput } from '../admin/format'
import { FormDialog } from '../admin/form-dialog'
import { FIELDSET, LEGEND, NOTE, PAIR } from '../admin/ui'
import { AGREEMENT_VERSIONS_PATH, type AgreementVersion, type ParticipantType } from '../admin/settings/types'
import { SIGNAL_OPTIONS } from '../admin/settings/labels'
import { ACCOUNT_TYPES, LEG_OPTIONS } from './format'
import { PARTICIPANTS_PATH, type Enrolment } from './types'

const EXTERNAL_REF = /^[\x21-\x7e]{1,100}$/
const POSITION_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const PHONE = /^\+?[0-9 ()-]{5,40}$/
const POSITION_REF_ERROR = 'Use letters, digits, dot, dash or underscore (at most 64), starting with a letter or digit.'

/** The form text of an enrolment (PLAN B2 2.2.1). */
export interface EnrolForm {
  readonly external_ref: string
  readonly market: string
  readonly type_code: string
  readonly account_type: keyof typeof ACCOUNT_TYPES
  readonly display_name: string
  readonly email: string
  readonly phone: string
  readonly address: string
  readonly enrolled_at: string
  readonly position_ref: string
  readonly sponsor: string
  readonly placement: string
  /** '' = no leg, 'auto' = first free leg breadth-first, '1'..'<width>'. */
  readonly leg: string
  readonly accepted: boolean
  readonly accepted_at: string
  readonly evidence_channel: string
  readonly evidence_reference: string
  readonly signals: Readonly<Record<string, string>>
}

export const FIELD_IDS: Readonly<Record<string, string>> = {
  external_ref: 'enrol-ref', market: 'enrol-market', type_code: 'enrol-type', display_name: 'enrol-name', 'contact.email': 'enrol-email',
  'contact.phone': 'enrol-phone', 'contact.address': 'enrol-address', enrolled_at: 'enrol-at', position_ref: 'enrol-position',
  'sponsor.position_ref': 'enrol-sponsor', 'placement.position_ref': 'enrol-placement', 'placement.leg': 'enrol-leg',
  agreement: 'enrol-accepted', 'agreement.accepted_at': 'enrol-accepted-at', 'agreement.evidence.channel': 'enrol-evidence-channel',
  'agreement.evidence.reference': 'enrol-evidence-reference',
}

const optional = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim())
const inFuture = (local: string): boolean => local !== '' && (fromLocalInput(local) ?? '') > new Date().toISOString()
const EVIDENCE_ERROR = 'Enter both the evidence channel and reference, or neither.'

/** Client checks of the enrolment form, by body path (the API checks again). */
export function enrolErrors(form: EnrolForm, agreement: AgreementVersion | null): Readonly<Record<string, string>> {
  const channel = optional(form.evidence_channel)
  const reference = optional(form.evidence_reference)
  const found: Record<string, string | null> = {
    external_ref: EXTERNAL_REF.test(form.external_ref) ? null : 'Enter the reference from your source system: 1 to 100 characters without spaces.',
    market: form.market === '' ? 'Choose the market.' : null,
    type_code: form.type_code === '' ? 'Choose the participant type.' : null,
    'contact.email': form.email.trim() === '' ? null : emailError(form.email),
    'contact.phone': form.phone.trim() === '' || PHONE.test(form.phone.trim()) ? null : 'Enter a phone number of digits, spaces, brackets or dashes.',
    enrolled_at: inFuture(form.enrolled_at) ? 'Enrolment cannot be in the future.' : null,
    position_ref: form.position_ref.trim() === '' || POSITION_REF.test(form.position_ref.trim()) ? null : POSITION_REF_ERROR,
    'sponsor.position_ref': form.sponsor.trim() === '' || POSITION_REF.test(form.sponsor.trim()) ? null : POSITION_REF_ERROR,
    'placement.position_ref': form.placement.trim() === ''
      ? (form.leg === '' ? null : 'Enter the position to place under.')
      : (POSITION_REF.test(form.placement.trim()) ? null : POSITION_REF_ERROR),
    agreement: agreement?.acceptance_required === true && !form.accepted
      ? `Enrolment in ${agreement.market.code} needs the participant’s acceptance of ${agreement.label}.`
      : null,
    'agreement.accepted_at': !form.accepted || form.accepted_at === '' ? null
      : inFuture(form.accepted_at) ? 'Acceptance cannot be in the future.'
        : agreement !== null && (fromLocalInput(form.accepted_at) ?? '') < agreement.published_at
          ? `Acceptance cannot be before ${agreement.label} was published (${formatDateTime(agreement.published_at)}).` : null,
    'agreement.evidence.channel': form.accepted && channel === undefined && reference !== undefined ? EVIDENCE_ERROR : null,
    'agreement.evidence.reference': form.accepted && reference === undefined && channel !== undefined ? EVIDENCE_ERROR : null,
  }
  return Object.fromEntries(Object.entries(found).filter((entry): entry is [string, string] => entry[1] !== null))
}

/**
 * The POST /v1/participants body of a checked form; empty optional fields are left out. An empty acceptance time is
 * `openedAt` (the instant the dialog opened, to the second: a minute-precision "now" could fall before a version
 * published that minute, and a retry with the same Idempotency-Key must send the same body).
 */
export function enrolBody(form: EnrolForm, agreement: AgreementVersion | null, openedAt: string): Record<string, unknown> {
  // Undefined fields drop out of the JSON body.
  const contact = { email: optional(form.email), phone: optional(form.phone), address: optional(form.address) }
  const signals = Object.fromEntries(Object.entries(form.signals).flatMap(([kind, value]) => (optional(value) === undefined ? [] : [[kind, value.trim()]])))
  const placement = optional(form.placement)
  const evidence = optional(form.evidence_channel) !== undefined && optional(form.evidence_reference) !== undefined
    ? { channel: form.evidence_channel.trim(), reference: form.evidence_reference.trim() }
    : undefined
  return {
    external_ref: form.external_ref,
    market: form.market,
    type_code: form.type_code,
    account_type: form.account_type,
    ...(optional(form.display_name) === undefined ? {} : { display_name: form.display_name.trim() }),
    ...(Object.values(contact).some((value) => value !== undefined) ? { contact } : {}),
    ...(form.enrolled_at === '' ? {} : { enrolled_at: fromLocalInput(form.enrolled_at) }),
    ...(optional(form.position_ref) === undefined ? {} : { position_ref: form.position_ref.trim() }),
    ...(optional(form.sponsor) === undefined ? {} : { sponsor: { position_ref: form.sponsor.trim() } }),
    ...(placement === undefined ? {} : { placement: form.leg === 'auto' ? { auto: true, position_ref: placement } : { position_ref: placement, ...(form.leg === '' ? {} : { leg: form.leg }) } }),
    ...(agreement !== null && form.accepted
      ? { agreement: { version_id: agreement.id, accepted_at: fromLocalInput(form.accepted_at) ?? openedAt, ...(evidence === undefined ? {} : { evidence }) } }
      : {}),
    ...(Object.keys(signals).length === 0 ? {} : { signals }),
  }
}

export interface EnrolDialogProps {
  readonly markets: readonly Market[]
  readonly types: readonly ParticipantType[]
  readonly onClose: () => void
  readonly onEnrolled: (participantId: string) => void
}

/**
 * "Enrol participant" (API-12, PLAN B2 2.2.1): identity, market and type, optional sponsor and placement (a leg or
 * automatic placement within the width of the market's plan version), the market's current agreement when it needs acceptance, and optional
 * duplicate-check signals (hashed by the API on arrival).
 */
export function EnrolDialog({ markets, types, onClose, onEnrolled }: EnrolDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [openedAt] = useState(() => new Date().toISOString())
  const [form, setForm] = useState<EnrolForm>(() => ({
    external_ref: '', market: '', type_code: '', account_type: 'individual', display_name: '', email: '', phone: '', address: '', enrolled_at: '',
    position_ref: '', sponsor: '', placement: '', leg: '', accepted: false, accepted_at: '',
    evidence_channel: '', evidence_reference: '', signals: {},
  }))
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const live = markets.filter((market) => market.state === 'live')
  const marketId = live.find((market) => market.code === form.market)?.id ?? null
  const versions = useResource<readonly AgreementVersion[]>(marketId === null ? null : AGREEMENT_VERSIONS_PATH, { market_id: marketId ?? undefined })
  const agreement = versions.data?.find((version) => version.current) ?? null
  const set = <K extends keyof EnrolForm>(field: K, value: EnrolForm[K]) => setForm((current) => ({ ...current, [field]: value }))
  const text = (field: keyof EnrolForm, path: string, label: string, extra: { readonly helper?: string; readonly type?: string; readonly optional?: boolean } = {}) => (
    <TextInput id={FIELD_IDS[path]} label={label} helper={extra.helper} type={extra.type} optional={extra.optional}
      value={form[field] as string} error={errors[path]} onChange={(event) => set(field, event.target.value as never)} />
  )
  function submit(idempotencyKey: string) {
    const found = enrolErrors(form, agreement)
    setErrors(found)
    const items: SummaryItem[] = Object.entries(found).map(([path, message]) => ({ fieldId: FIELD_IDS[path], message }))
    if (items.length > 0) return { items }
    const body = enrolBody(form, agreement, openedAt)
    return {
      items,
      fieldIds: FIELD_IDS,
      send: async () => {
        const { data } = await api.post<Enrolment>(PARTICIPANTS_PATH, body, { idempotencyKey })
        toast({
          message: data.duplicate_case_id === null
            ? `${data.participant.external_ref} was enrolled.`
            : `${data.participant.external_ref} was enrolled. A duplicate review case was opened${data.position?.status === 'pending' ? ' and the position stays pending until it is decided' : ''}.`,
        })
        onEnrolled(data.participant.id)
      },
    }
  }
  return (
    <FormDialog title="Enrol participant" size="lg" submitLabel="Enrol participant" onClose={onClose} onSubmit={submit}>
      <div className={PAIR}>
        {text('external_ref', 'external_ref', 'External reference', { helper: 'The participant’s id in your source system.' })}
        {text('display_name', 'display_name', 'Name', { optional: true })}
        <Select id={FIELD_IDS.market} label="Market" placeholder="Choose a live market" value={form.market} error={errors.market}
          options={live.map((market) => ({ value: market.code, label: market.code }))} helper={live.length === 0 ? 'No market is live yet: enrolment opens once one is.' : undefined}
          onChange={(event) => setForm((current) => ({ ...current, market: event.target.value, accepted: false }))} />
        <Select id={FIELD_IDS.type_code} label="Participant type" placeholder="Choose an active type" value={form.type_code} error={errors.type_code}
          options={types.filter((type) => type.state === 'active').map((type) => ({ value: type.code, label: `${type.name} (${type.code})` }))} onChange={(event) => set('type_code', event.target.value)} />
      </div>
      <RadioGroup legend="Account" name="enrol-account" value={form.account_type} onChange={(value) => set('account_type', value as EnrolForm['account_type'])}
        options={Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label }))} />
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Contact (optional, shown masked)</legend>
        <div className={PAIR}>
          {text('email', 'contact.email', 'Email address', { type: 'email', optional: true })}
          {text('phone', 'contact.phone', 'Phone', { type: 'tel', optional: true })}
        </div>
        {text('address', 'contact.address', 'Address', { optional: true })}
      </fieldset>
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Position and genealogy</legend>
        <div className={PAIR}>
          {text('position_ref', 'position_ref', 'Position reference', { optional: true, helper: 'Generated when empty. Only types that can hold positions get one.' })}
          {text('sponsor', 'sponsor.position_ref', 'Sponsor position', { optional: true, helper: 'Empty: the position starts a sponsor tree of its own.' })}
          {text('placement', 'placement.position_ref', 'Place under position', { optional: true })}
          <Select id={FIELD_IDS['placement.leg']} label="Leg" value={form.leg} error={errors['placement.leg']} onChange={(event) => set('leg', event.target.value)}
            helper="No leg places the position under that one without a leg. Legs run up to the width on the market’s plan version; a leg beyond it is refused."
            options={[{ value: '', label: 'No leg' }, { value: 'auto', label: 'Automatic: first free leg, breadth-first' }, ...LEG_OPTIONS]} />
        </div>
        {text('enrolled_at', 'enrolled_at', 'Enrolled at', { type: 'datetime-local', optional: true, helper: 'Your local time. Empty: now. Never inside a committed period.' })}
      </fieldset>
      {agreement !== null && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>Agreement {agreement.label}</legend>
          <Checkbox id={FIELD_IDS.agreement} label={`The participant accepted ${agreement.label}`} checked={form.accepted} error={errors.agreement}
            helper={agreement.acceptance_required ? `Required for enrolment in ${agreement.market.code}.` : 'Optional in this market.'} onChange={(event) => set('accepted', event.target.checked)} />
          {form.accepted && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-md">
              {text('accepted_at', 'agreement.accepted_at', 'Accepted at', { type: 'datetime-local', optional: true, helper: 'Your local time. Empty: now.' })}
              <TextInput id={FIELD_IDS['agreement.evidence.channel']} label="Evidence channel" optional maxLength={50} helper="For example web or paper." value={form.evidence_channel}
                error={errors['agreement.evidence.channel']} onChange={(event) => set('evidence_channel', event.target.value)} />
              <TextInput id={FIELD_IDS['agreement.evidence.reference']} label="Evidence reference" optional maxLength={200} value={form.evidence_reference}
                error={errors['agreement.evidence.reference']} onChange={(event) => set('evidence_reference', event.target.value)} />
            </div>
          )}
        </fieldset>
      )}
      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Duplicate-check signals (optional)</legend>
        <p className={NOTE}>Compared with other participants as hashes only; the values are never stored.</p>
        <div className={PAIR}>
          {SIGNAL_OPTIONS.map((option) => (
            <TextInput key={option.value} label={option.label} maxLength={500} optional value={form.signals[option.value] ?? ''}
              onChange={(event) => set('signals', { ...form.signals, [option.value]: event.target.value })} />
          ))}
        </div>
      </fieldset>
      {versions.error !== null && <Banner tone="warning" title="The market’s agreement could not be read">Enrolling may be refused if the market needs an acceptance. Close and try again.</Banner>}
    </FormDialog>
  )
}
