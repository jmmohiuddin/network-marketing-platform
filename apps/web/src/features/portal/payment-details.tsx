'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { RadioGroup } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { isApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { moneyText } from '../orders/format'
import { bankBody, bankErrors, ENTITY_LABELS, taxBody, type BankForm } from '../people/finance-dialogs'
import { timeText } from './format'
import { useReauth } from './reauth'
import { usePortal } from './shell'
import type { BankDetails, TaxProfile } from './types'
import { CAPTION, MONO, PAGE_TITLE, PortalFailure, PortalInput, PortalSelect, Section, TILE } from './ui'

// SC-22 payment details and tax profile (FR-DIST-006, D-B5-12/13): masked values only; a change needs the password
// (or an authenticator code) first; new bank details wait the cooling-off period, a shared account goes to a review.
// No tax-id unmask, W-9/1099 items or certification claims.

const EMPTY_BANK: BankForm = { scheme: 'iban', account_holder: '', iban: '', bic: '', account_number: '', bank_code: '', contact_email: '' }
const BANK_FIELDS: Readonly<Record<string, string>> = {
  account_holder: 'bank-holder', iban: 'bank-iban', bic: 'bank-bic', account_number: 'bank-account', bank_code: 'bank-code',
}
const ENTITY_OPTIONS = Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }))

export function PaymentDetailsPage() {
  const bank = useResource<BankDetails>('/v1/me/bank-details')
  const tax = useResource<TaxProfile>('/v1/me/tax-profile')
  const reauth = useReauth()
  return (
    <>
      <h1 className={PAGE_TITLE}>Payment details and tax profile</h1>
      {bank.error !== null && <PortalFailure error={bank.error} onRetry={bank.reload} section />}
      {bank.data === null && bank.error === null && <LoadingState label="Loading your bank details" />}
      {bank.data !== null && <BankSection bank={bank.data} confirm={reauth.confirm} onChanged={bank.reload} />}
      {tax.error !== null && <PortalFailure error={tax.error} onRetry={tax.reload} section />}
      {tax.data === null && tax.error === null && <LoadingState label="Loading your tax profile" />}
      {tax.data !== null && <TaxSection tax={tax.data} confirm={reauth.confirm} onChanged={tax.reload} />}
      {bank.data !== null && tax.data !== null && <History bank={bank.data} tax={tax.data} />}
      {reauth.dialog}
    </>
  )
}

type Confirm = () => Promise<boolean>

function BankSection({ bank, confirm, onChanged }: { readonly bank: BankDetails; readonly confirm: Confirm; readonly onChanged: () => void }) {
  const { zone } = usePortal()
  const [editing, setEditing] = useState(false)
  const current = bank.current
  const coolingOff = current !== null && new Date(current.cooling_off_until).getTime() > Date.now()
  const owed = bank.owed.filter((row) => BigInt(row.payable_minor) > 0n)
  return (
    <>
      {current !== null && coolingOff && (
        <Banner tone="warning" title={`Cooling off until ${timeText(current.cooling_off_until, zone)}`}>
          Payouts prepared before then skip you.{owed.length === 0 ? '' : ` ${owed.map((row) => moneyText(row.payable_minor, row.currency, row.minor_unit)).join(' and ')} ${owed.length === 1 ? 'waits' : 'wait'}.`}
        </Banner>
      )}
      {bank.pending_review !== null && (
        <Banner tone="info" title="A change to your bank details is being reviewed">
          The company reviews it before it applies. You get a notice with the outcome; until then you cannot enter other details.
        </Banner>
      )}
      <Section title="Payout account" icon="account_balance" testId="card">
        {current === null
          ? <p className="font-body-lg text-body-lg text-on-surface-variant">No bank details on file. Payouts wait until you add them.</p>
          : (
            <dl className={`${TILE} flex flex-col gap-space-sm`}>
              <div className="flex items-center justify-between gap-space-sm">
                <dt className={CAPTION}>Account</dt>
                <dd className="font-data-mono-md text-data-mono-md text-on-surface">{current.masked}</dd>
              </div>
              <div className="flex items-center justify-between gap-space-sm">
                <dt className={CAPTION}>Format</dt>
                <dd className="font-body-lg text-body-lg text-on-surface">{current.scheme === 'iban' ? 'IBAN' : 'Local account number'}</dd>
              </div>
              <div className="flex items-center justify-between gap-space-sm">
                <dt className={CAPTION}>Recorded</dt>
                <dd className={`${MONO} text-secondary`}>{timeText(current.created_at, zone)}</dd>
              </div>
            </dl>
          )}
        {editing
          ? <BankChange confirm={confirm} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged() }} />
          : bank.pending_review === null && (
            <>
              <Button variant="primary" size="lg" icon="edit" onClick={() => setEditing(true)} data-testid="primary-action">Change bank details</Button>
              <p className={CAPTION}>You will be asked for your password before the change is saved.</p>
            </>
          )}
      </Section>
    </>
  )
}

/** Step 1: account format; step 2: the details. Saved after re-authentication (PUT /v1/me/bank-details). */
function BankChange({ confirm, onCancel, onDone }: { readonly confirm: Confirm; readonly onCancel: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const { zone } = usePortal()
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState<BankForm>(EMPTY_BANK)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  function set(field: keyof BankForm, value: string) {
    setForm((was) => ({ ...was, [field]: value }))
    setKey(crypto.randomUUID()) // other details are another action
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    const found = bankErrors(form)
    setErrors(found)
    setRefusal(null)
    if (Object.keys(found).length > 0) return
    if (!(await confirm())) return
    setBusy(true)
    try {
      const answer = await api.put<{ state: string; until?: string }>('/v1/me/bank-details', bankBody(form), { idempotencyKey: key })
      // A review (202) shows as pending_review once the page reloads.
      if (answer.data.until !== undefined) toast({ message: `New bank details saved. Payouts to them start after ${timeText(answer.data.until, zone)}.` })
      onDone()
    } catch (error) {
      if (isApiError(error, 'BANK_DETAILS_INVALID')) {
        const path = (error.details as { path?: string } | null)?.path ?? ''
        setErrors({ [path in BANK_FIELDS ? path : 'account_holder']: 'This value is not valid. Check it and try again.' })
      } else {
        setRefusal(errorMessage(error))
      }
      setBusy(false)
    }
  }
  const field = (name: keyof BankForm, label: string, extra: { readonly optional?: boolean; readonly inputMode?: 'numeric'; readonly helper?: string } = {}) => (
    <PortalInput id={BANK_FIELDS[name]} label={label} autoComplete="off" value={form[name]} error={errors[name]} optional={extra.optional}
      inputMode={extra.inputMode} helper={extra.helper} onChange={(event) => set(name, event.target.value)} />
  )
  if (step === 1) {
    return (
      <div className="flex flex-col gap-space-md">
        <RadioGroup legend="Account format" name="bank-scheme" value={form.scheme} onChange={(value) => set('scheme', value === 'local' ? 'local' : 'iban')}
          options={[{ value: 'iban', label: 'IBAN', helper: 'International bank account number' }, { value: 'local', label: 'Local account number and bank code' }]} />
        <div className="flex flex-col gap-space-xs">
          <Button variant="primary" size="lg" onClick={() => setStep(2)}>Continue</Button>
          <Button size="lg" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    )
  }
  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-space-md">
      {field('account_holder', 'Account holder')}
      {form.scheme === 'iban'
        ? <>{field('iban', 'IBAN', { helper: 'Spaces are ignored.' })}{field('bic', 'BIC', { optional: true })}</>
        : <>{field('account_number', 'Account number', { inputMode: 'numeric' })}{field('bank_code', 'Bank code', { inputMode: 'numeric' })}</>}
      {refusal !== null && <Banner tone="danger" title="The bank details were not saved">{refusal}</Banner>}
      <div className="flex flex-col gap-space-xs">
        <Button type="submit" variant="primary" size="lg" loading={busy}>Save bank details</Button>
        <Button size="lg" onClick={() => setStep(1)}>Back</Button>
      </div>
    </form>
  )
}

function TaxSection({ tax, confirm, onChanged }: { readonly tax: TaxProfile; readonly confirm: Confirm; readonly onChanged: () => void }) {
  const { zone } = usePortal()
  const [editing, setEditing] = useState(false)
  const current = tax.current
  return (
    <Section title="Tax profile" icon="description">
      {current === null
        ? <p className="font-body-lg text-body-lg text-on-surface-variant">No tax profile on file.</p>
        : (
          <dl className={`${TILE} flex flex-col gap-space-sm`}>
            <div className="flex items-center justify-between gap-space-sm"><dt className={CAPTION}>Tax residency</dt><dd className="font-body-lg text-body-lg text-on-surface">{current.residency ?? '—'}</dd></div>
            <div className="flex items-center justify-between gap-space-sm"><dt className={CAPTION}>Entity type</dt><dd className="font-body-lg text-body-lg text-on-surface">{current.entity_type === null ? '—' : ENTITY_LABELS[current.entity_type] ?? current.entity_type}</dd></div>
            <div className="flex items-center justify-between gap-space-sm"><dt className={CAPTION}>Tax id</dt><dd className="font-data-mono-md text-data-mono-md text-on-surface">{current.tax_id_masked ?? 'Not given'}</dd></div>
            <div className="flex items-center justify-between gap-space-sm"><dt className={CAPTION}>Valid from</dt><dd className={`${MONO} text-secondary`}>{timeText(current.valid_from, zone)}</dd></div>
          </dl>
        )}
      {editing
        ? <TaxChange current={current} confirm={confirm} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged() }} />
        : <Button size="lg" icon="edit" onClick={() => setEditing(true)}>{current === null ? 'Add tax profile' : 'Change tax profile'}</Button>}
    </Section>
  )
}

function TaxChange({ current, confirm, onCancel, onDone }: {
  readonly current: TaxProfile['current']
  readonly confirm: Confirm
  readonly onCancel: () => void
  readonly onDone: () => void
}) {
  const api = useApi()
  const toast = useToast()
  const [form, setForm] = useState({ residency: current?.residency ?? '', entity_type: current?.entity_type ?? '', tax_id: '' })
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  function set(field: keyof typeof form, value: string) {
    setForm((was) => ({ ...was, [field]: value }))
    setKey(crypto.randomUUID())
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    const residency = form.residency.trim().toUpperCase()
    const taxId = form.tax_id.replace(/\s+/g, '').toUpperCase()
    const found: Record<string, string> = {}
    if (!/^[A-Z]{2}$/.test(residency)) found.residency = 'Enter a two-letter country code, for example DE.'
    if (form.entity_type === '') found.entity_type = 'Choose the entity type.'
    if (taxId !== '' && !/^[A-Z0-9-]{4,32}$/.test(taxId)) found.tax_id = 'Enter 4 to 32 letters, digits or hyphens.'
    // A save without a change would still write a version and send the security notice.
    if (Object.keys(found).length === 0 && taxBody(form, current) === null) found.residency = 'Nothing to change. Change at least one field.'
    setErrors(found)
    setRefusal(null)
    if (Object.keys(found).length > 0) return
    if (!(await confirm())) return
    setBusy(true)
    try {
      await api.put('/v1/me/tax-profile', { residency, entity_type: form.entity_type, ...(taxId === '' ? {} : { tax_id: taxId }) }, { idempotencyKey: key })
      toast({ message: 'Tax profile saved. It applies from now on.' })
      onDone()
    } catch (error) {
      if (isApiError(error, 'TAX_ID_FORMAT')) setErrors({ tax_id: errorMessage(error) })
      else setRefusal(errorMessage(error))
      setBusy(false)
    }
  }
  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-space-md">
      <PortalInput id="tax-residency" label="Tax residency" helper="Two-letter country code." maxLength={2} autoCapitalize="characters" value={form.residency} error={errors.residency}
        onChange={(event) => set('residency', event.target.value)} />
      <PortalSelect id="tax-entity" label="Entity type" placeholder="Choose" value={form.entity_type} options={ENTITY_OPTIONS} error={errors.entity_type}
        onChange={(event) => set('entity_type', event.target.value)} />
      <PortalInput id="tax-id" label="Tax id" optional autoComplete="off" helper={current?.tax_id_masked == null ? undefined : 'Leave empty to keep your current tax id.'}
        value={form.tax_id} error={errors.tax_id} onChange={(event) => set('tax_id', event.target.value)} />
      {refusal !== null && <Banner tone="danger" title="The tax profile was not saved">{refusal}</Banner>}
      <div className="flex flex-col gap-space-xs">
        <Button type="submit" variant="primary" size="lg" loading={busy}>Save tax profile</Button>
        <Button size="lg" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function History({ bank, tax }: { readonly bank: BankDetails; readonly tax: TaxProfile }) {
  const { zone } = usePortal()
  if (bank.history.length === 0 && tax.history.length === 0) return null
  return (
    <Section title="Earlier versions" icon="history">
      <ul className="flex flex-col gap-space-xs">
        {bank.history.map((row) => (
          <li key={`bank-${row.created_at}`} className={`${TILE} flex flex-col gap-0.5`}>
            <span className="font-body-lg text-body-lg text-on-surface">Account {row.masked}</span>
            <span className={CAPTION}>{row.created_via === 'self' ? 'Entered by you' : 'Recorded by the company'} on {timeText(row.created_at, zone)} · replaced {timeText(row.superseded_at, zone)}</span>
          </li>
        ))}
        {tax.history.map((row) => (
          <li key={`tax-${row.id}`} className={`${TILE} flex flex-col gap-0.5`}>
            <span className="font-body-lg text-body-lg text-on-surface">Tax profile {row.residency ?? '—'} · {row.entity_type === null ? '—' : ENTITY_LABELS[row.entity_type] ?? row.entity_type} · {row.tax_id_masked ?? 'no tax id'}</span>
            <span className={CAPTION}>From {timeText(row.valid_from, zone)}{row.valid_to === null ? '' : ` to ${timeText(row.valid_to, zone)}`}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
