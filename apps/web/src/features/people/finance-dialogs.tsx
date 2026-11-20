'use client'

import { useEffect, useRef, useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Select, TextInput } from '../../components/form-field'
import { Modal } from '../../components/modal'
import { useToast } from '../../components/toast'
import { ApiError, isApiError } from '../../lib/api'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { emailError, requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { MONO } from '../admin/ui'
import { CaseForm } from '../cases/case-form'
import { caseTypeInfo } from '../cases/format'
import { inScope, marketScope } from '../markets/format'

// SC-09 money dialogs (PLAN B4 §2.3/2.4): bank-detail change request, tax profile edit and unmask, payout holds. Step-up
// codes are asked by ApiProvider (StepUpModal) when the API answers STEP_UP_REQUIRED.

export type Scheme = 'iban' | 'local'

export interface BankForm {
  readonly scheme: Scheme
  readonly account_holder: string
  readonly iban: string
  readonly bic: string
  readonly account_number: string
  readonly bank_code: string
  readonly contact_email: string
}

const BANK_IDS: Readonly<Record<keyof BankForm, string>> = {
  scheme: 'bank-scheme', account_holder: 'bank-holder', iban: 'bank-iban', bic: 'bank-bic', account_number: 'bank-account', bank_code: 'bank-code', contact_email: 'bank-contact',
}

/** ISO 13616 check: 15 to 34 letters and digits, country and check digits first, mod 97 = 1. */
export function ibanValid(value: string): boolean {
  const iban = value.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))
  let remainder = 0
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  return remainder === 1
}

/** Client checks of the bank details (the API checks again), by field. */
export function bankErrors(form: BankForm): Readonly<Partial<Record<keyof BankForm, string>>> {
  const errors: Partial<Record<keyof BankForm, string>> = {}
  if (form.account_holder.trim() === '') errors.account_holder = 'Enter the account holder.'
  if (form.scheme === 'iban') {
    if (!ibanValid(form.iban)) errors.iban = 'Enter a valid IBAN: its check digits do not match.'
    if (form.bic.trim() !== '' && !/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(form.bic.trim())) errors.bic = 'Enter a BIC of 8 or 11 letters and digits.'
  } else {
    if (!/^[A-Za-z0-9]{4,34}$/.test(form.account_number.trim())) errors.account_number = 'Enter 4 to 34 letters or digits.'
    if (!/^[A-Za-z0-9]{1,20}$/.test(form.bank_code.trim())) errors.bank_code = 'Enter 1 to 20 letters or digits.'
  }
  const email = form.contact_email.trim() === '' ? null : emailError(form.contact_email.trim())
  if (email !== null) errors.contact_email = email
  return errors
}

/** The POST body: only the fields of the chosen scheme (the API refuses others). */
export function bankBody(form: BankForm): Readonly<Record<string, string>> {
  const contact: Readonly<Record<string, string>> = form.contact_email.trim() === '' ? {} : { contact_email: form.contact_email.trim() }
  return form.scheme === 'iban'
    ? { scheme: 'iban', account_holder: form.account_holder.trim(), iban: form.iban.replace(/\s+/g, '').toUpperCase(), ...(form.bic.trim() === '' ? {} : { bic: form.bic.trim().toUpperCase() }), ...contact }
    : { scheme: 'local', account_holder: form.account_holder.trim(), account_number: form.account_number.trim(), bank_code: form.bank_code.trim(), ...contact }
}

/** BANK_DETAILS_INVALID {path} as an issue on that field, so the summary links to it. */
function bankRefusal(error: unknown): unknown {
  if (!isApiError(error, 'BANK_DETAILS_INVALID')) return error
  const path = ((error as ApiError).details as { path?: string } | null)?.path ?? ''
  return new ApiError(error.status, 'VALIDATION_FAILED', error.message, { issues: [{ path, message: 'is not valid' }] }, error.requestId)
}

interface Recorded {
  readonly request_id: string
  readonly masked: string
  readonly shared_with_count: number
}

/**
 * "Request bank-detail change" (D-B4-16, AC-17.2): the new details are recorded sealed (step-up), then a bank_detail case
 * with evidence is opened for a second person to approve. Only the masked account is ever shown back.
 */
export function BankDetailDialog({ participantId, onClose }: { readonly participantId: string; readonly onClose: () => void }) {
  const api = useApi()
  const [form, setForm] = useState<BankForm>({ scheme: 'iban', account_holder: '', iban: '', bic: '', account_number: '', bank_code: '', contact_email: '' })
  const [errors, setErrors] = useState<Readonly<Partial<Record<keyof BankForm, string>>>>({})
  const [recorded, setRecorded] = useState<Recorded | null>(null)
  const set = (field: keyof BankForm) => (value: string) => setForm((current) => ({ ...current, [field]: value }))
  if (recorded !== null) {
    const info = caseTypeInfo('bank_detail')!
    return (
      <Modal open onClose={onClose} title="Open the bank-detail case" size="lg" icon="account_balance" description={`New account ${recorded.masked} recorded.`}>
        <CaseForm idPrefix="bank-case" info={info} submitLabel="Open bank-detail case" fieldIds={{}}
          prepare={() => ({ items: [], subjectType: 'participant', subjectId: participantId, payload: { request_id: recorded.request_id } })}>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {recorded.shared_with_count === 0 ? 'No other payee uses this account.' : `${recorded.shared_with_count} other ${recorded.shared_with_count === 1 ? 'payee uses' : 'payees use'} this account.`}
            {' '}Attach the payee’s request as evidence. A second person approves the change; payouts to the new account wait for the cooling-off period.
          </p>
        </CaseForm>
      </Modal>
    )
  }
  function submit(idempotencyKey: string) {
    const found = bankErrors(form)
    setErrors(found)
    const items = (Object.entries(found) as [keyof BankForm, string][]).map(([field, message]) => ({ fieldId: BANK_IDS[field], message }))
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: Object.fromEntries(Object.entries(BANK_IDS)),
      send: async () => {
        try {
          setRecorded((await api.post<Recorded>(`/v1/participants/${participantId}/bank-detail-requests`, bankBody(form), { idempotencyKey })).data)
        } catch (error) {
          throw bankRefusal(error)
        }
      },
    }
  }
  const input = (field: keyof BankForm, label: string, helper?: string, optional = false) => (
    <TextInput id={BANK_IDS[field]} label={label} helper={helper} optional={optional} autoComplete="off" value={form[field]} error={errors[field]} onChange={(event) => set(field)(event.target.value)} />
  )
  return (
    <FormDialog title="Request bank-detail change" size="lg" submitLabel="Record new details" onClose={onClose} onSubmit={submit}>
      <p>The details are stored sealed and shown only masked. You will be asked for a code from your authenticator app.</p>
      <Select id={BANK_IDS.scheme} label="Account format" value={form.scheme} options={[{ value: 'iban', label: 'IBAN' }, { value: 'local', label: 'Local account number and bank code' }]}
        onChange={(event) => set('scheme')(event.target.value)} />
      {input('account_holder', 'Account holder')}
      {form.scheme === 'iban'
        ? <>{input('iban', 'IBAN', 'Spaces are ignored.')}{input('bic', 'BIC', undefined, true)}</>
        : <>{input('account_number', 'Account number')}{input('bank_code', 'Bank code')}</>}
      {input('contact_email', 'Contact email for the change notice', 'Gets the notice besides the contact on record.', true)}
    </FormDialog>
  )
}

const ENTITY_OPTIONS = [
  { value: 'individual', label: 'Individual' }, { value: 'company', label: 'Company' }, { value: 'partnership', label: 'Partnership' }, { value: 'other', label: 'Other' },
] as const

export const ENTITY_LABELS: Readonly<Record<string, string>> = Object.fromEntries(ENTITY_OPTIONS.map((option) => [option.value, option.label]))

const TAX_IDS = { residency: 'tax-residency', entity_type: 'tax-entity', tax_id: 'tax-id' } as const

/** The PUT body: changed fields only; null when nothing would change. */
export function taxBody(form: { readonly residency: string; readonly entity_type: string; readonly tax_id: string }, current: { readonly residency: string | null; readonly entity_type: string | null } | null): Readonly<Record<string, string>> | null {
  const residency = form.residency.trim().toUpperCase()
  const body = {
    ...(residency !== '' && residency !== current?.residency ? { residency } : {}),
    ...(form.entity_type !== '' && form.entity_type !== current?.entity_type ? { entity_type: form.entity_type } : {}),
    ...(form.tax_id.trim() === '' ? {} : { tax_id: form.tax_id.replace(/\s+/g, '').toUpperCase() }),
  }
  return Object.keys(body).length === 0 ? null : body
}

/** PUT tax profile (tax.manage, step-up): a new version from now on; the tax id is write-only and masked afterwards. */
/** D-BM-07: the market pack's tax-id format in force today (GET …/tax-profile `format`), null when the pack has none. */
export interface TaxIdFormat {
  readonly label: string
  readonly pattern: string
}

/** TAX_ID_FORMAT naming the pack's label ("This is not a valid FX tax id."). */
export const taxIdFormatText = (label: string): string => `This is not a valid ${label}.`

export function TaxDialog({ participantId, current, format, onClose, onDone }: {
  readonly participantId: string
  readonly current: { readonly residency: string | null; readonly entity_type: string | null } | null
  readonly format: TaxIdFormat | null
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const api = useApi()
  const toast = useToast()
  const [form, setForm] = useState({ residency: current?.residency ?? '', entity_type: current?.entity_type ?? '', tax_id: '' })
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  function submit(idempotencyKey: string) {
    const residency = form.residency.trim().toUpperCase()
    const taxId = form.tax_id.replace(/\s+/g, '').toUpperCase()
    const found = {
      [TAX_IDS.residency]: residency === '' || /^[A-Z]{2}$/.test(residency) ? null : 'Enter a two-letter country code, for example DE.',
      [TAX_IDS.tax_id]: taxId === '' ? null
        : !/^[A-Z0-9-]{4,32}$/.test(taxId) ? 'Enter 4 to 32 letters, digits or hyphens.'
          : format !== null && !new RegExp(format.pattern).test(taxId) ? taxIdFormatText(format.label) : null,
    }
    const body = taxBody(form, current)
    const items = [
      ...Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }])),
      ...(body === null && Object.values(found).every((message) => message === null) ? [{ fieldId: TAX_IDS.residency, message: 'Change at least one field.' }] : []),
    ]
    setErrors(found)
    if (items.length > 0 || body === null) return { items }
    return {
      items,
      fieldIds: TAX_IDS,
      send: async () => {
        try {
          await api.put(`/v1/participants/${participantId}/tax-profile`, body, { idempotencyKey })
        } catch (error) {
          if (!isApiError(error, 'TAX_ID_FORMAT')) throw error
          const label = (error.details as { label?: string } | null)?.label
          const message = label === undefined ? error.message : taxIdFormatText(label)
          throw new ApiError(error.status, 'VALIDATION_FAILED', message, { issues: [{ path: 'tax_id', message }] }, error.requestId)
        }
        toast({ message: 'Tax profile saved as a new version.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title="Edit tax profile" submitLabel="Save new version" onClose={onClose} onSubmit={submit}>
      <p>The change applies from now on; earlier versions stay as they were. You will be asked for a code from your authenticator app.</p>
      <TextInput id={TAX_IDS.residency} label="Tax residency" helper="Two-letter country code." maxLength={2} value={form.residency} error={errors[TAX_IDS.residency]} onChange={(event) => setForm({ ...form, residency: event.target.value })} />
      <Select id={TAX_IDS.entity_type} label="Entity type" placeholder="Choose" value={form.entity_type} options={ENTITY_OPTIONS} onChange={(event) => setForm({ ...form, entity_type: event.target.value })} />
      <TextInput id={TAX_IDS.tax_id} label="New tax id" optional autoComplete="off" helper={`${format === null ? '' : `Format: ${format.label}. `}Leave empty to keep the current tax id. It is shown masked after saving.`} value={form.tax_id} error={errors[TAX_IDS.tax_id]} onChange={(event) => setForm({ ...form, tax_id: event.target.value })} />
    </FormDialog>
  )
}

/** POST …/tax-profile/unmask (participant.unmask, step-up, audited): the tax id shows once, in this dialog only. */
export function TaxUnmaskDialog({ participantId, onClose }: { readonly participantId: string; readonly onClose: () => void }) {
  const api = useApi()
  const [taxId, setTaxId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = useRef<HTMLElement>(null)
  useEffect(() => {
    if (taxId !== null) shown.current?.focus()
  }, [taxId])
  async function reveal() {
    setBusy(true)
    setProblem(null)
    try {
      setTaxId((await api.post<{ tax_id: string }>(`/v1/participants/${participantId}/tax-profile/unmask`, {})).data.tax_id)
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const footer = taxId === null
    ? <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon="visibility" loading={busy} onClick={reveal}>Show tax id</Button></>
    : <Button variant="primary" onClick={onClose}>Hide and close</Button>
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title="Show tax id" icon="visibility" footer={footer}>
      <div aria-live="polite">
        {taxId === null
          ? (
            <>
              <p>Showing the tax id is recorded in the audit log. It is shown once, here; closing hides it. You will be asked for a code from your authenticator app.</p>
              {problem !== null && <Banner tone="danger">{problem}</Banner>}
            </>
          )
          : (
            <dl className="flex flex-col gap-0.5">
              <dt className="font-caption text-caption uppercase text-secondary font-semibold">Tax id</dt>
              <dd ref={shown} tabIndex={-1} data-autofocus className={`${MONO} text-on-surface break-all focus:outline-none`}>{taxId}</dd>
            </dl>
          )}
      </div>
    </Modal>
  )
}

const HOLD_REASON = 'hold-reason'
const HOLD_MARKET = 'hold-market'

/** Place a payout hold in one market (payout.hold) or release one, each with a reason. */
export function HoldDialog({ participantId, defaultMarketId, release, onClose, onDone }: {
  readonly participantId: string
  readonly defaultMarketId: string
  /** The hold to release; absent to place one. */
  readonly release?: { readonly id: string; readonly marketCode: string }
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const api = useApi()
  const toast = useToast()
  const { me } = useSession()
  const markets = useResource<Market[]>(release === undefined ? MARKETS_PATH : null)
  const holdScope = marketScope(me, 'payout.hold')
  // Only the markets the user's payout.hold roles cover: the API refuses a hold anywhere else.
  const holdable = (markets.data ?? []).filter((market) => inScope(holdScope, market.id))
  const [chosen, setChosen] = useState(defaultMarketId)
  const marketId = markets.data === null || holdable.some((market) => market.id === chosen) ? chosen : holdable[0]?.id ?? ''
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(idempotencyKey: string) {
    const missing = requiredError('the reason', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: HOLD_REASON, message: missing }] }
    return {
      items: [],
      fieldIds: { reason: HOLD_REASON, market_id: HOLD_MARKET },
      send: async () => {
        if (release === undefined) await api.post(`/v1/payees/${participantId}/holds`, { market_id: marketId, reason: reason.trim() }, { idempotencyKey })
        else await api.post(`/v1/payout-holds/${release.id}/release`, { reason: reason.trim() }, { idempotencyKey })
        toast({ message: release === undefined ? 'Payout hold placed.' : 'Payout hold released.' })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={release === undefined ? 'Place payout hold' : `Release payout hold (${release.marketCode})`} submitLabel={release === undefined ? 'Place hold' : 'Release hold'}
      submitVariant={release === undefined ? 'destructive-solid' : 'primary'} onClose={onClose} onSubmit={submit}>
      <p>{release === undefined ? 'While the hold is active the payee is left out of payout batches in that market. Earnings keep accruing.' : 'The payee can be included in the next payout batch of that market again.'}</p>
      {release === undefined && (
        <Select id={HOLD_MARKET} label="Market" value={marketId} options={holdable.map((market) => ({ value: market.id, label: marketName(market) }))} onChange={(event) => setChosen(event.target.value)} />
      )}
      <TextAreaField id={HOLD_REASON} label="Reason" maxLength={500} value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}
