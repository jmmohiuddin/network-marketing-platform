'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { RadioGroup } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { isApiError } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { bankBody, bankErrors, taxBody, type BankForm } from '../people/finance-dialogs'
import { CAPTION, MONO, PAGE_TITLE, Section, TILE } from './blocks'
import { errorText, formatMoney } from './format'
import type { Translate } from './i18n'
import { useReauth } from './reauth'
import { usePortal } from './shell'
import type { BankDetails, TaxProfile } from './types'
import { PortalFailure, PortalInput, PortalSelect } from './ui'

// SC-22 payment details and tax profile (FR-DIST-006, D-B5-12/13): masked values only; a change needs the password
// (or an authenticator code) first; new bank details wait the cooling-off period, a shared account goes to a review.
// The tax id field names the market pack's format (D-BM-07, "Format: <label>"). No tax-id unmask, W-9/1099 items or
// certification claims.

const EMPTY_BANK: BankForm = { scheme: 'iban', account_holder: '', iban: '', bic: '', account_number: '', bank_code: '', contact_email: '' }
type BankField = 'account_holder' | 'iban' | 'bic' | 'account_number' | 'bank_code'
const BANK_FIELDS: Readonly<Record<BankField, string>> = {
  account_holder: 'bank-holder', iban: 'bank-iban', bic: 'bank-bic', account_number: 'bank-account', bank_code: 'bank-code',
}
const isBankField = (name: string): name is BankField => name in BANK_FIELDS
const ENTITY_TYPES = ['individual', 'company', 'partnership', 'other'] as const

function entityText(value: string | null, t: Translate): string {
  if (value === null) return '—'
  const known = ENTITY_TYPES.find((type) => type === value)
  return known === undefined ? value : t(`entity.${known}`)
}

export function PaymentDetailsPage() {
  const { t } = usePortal().words
  const bank = useResource<BankDetails>('/v1/me/bank-details')
  const tax = useResource<TaxProfile>('/v1/me/tax-profile')
  const reauth = useReauth()
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('payment.title')}</h1>
      {bank.error !== null && <PortalFailure error={bank.error} onRetry={bank.reload} section />}
      {bank.data === null && bank.error === null && <LoadingState label={t('payment.loading_bank')} />}
      {bank.data !== null && <BankSection bank={bank.data} confirm={reauth.confirm} onChanged={bank.reload} />}
      {tax.error !== null && <PortalFailure error={tax.error} onRetry={tax.reload} section />}
      {tax.data === null && tax.error === null && <LoadingState label={t('payment.loading_tax')} />}
      {tax.data !== null && <TaxSection tax={tax.data} confirm={reauth.confirm} onChanged={tax.reload} />}
      {bank.data !== null && tax.data !== null && <History bank={bank.data} tax={tax.data} />}
      {reauth.dialog}
    </>
  )
}

type Confirm = () => Promise<boolean>

function BankSection({ bank, confirm, onChanged }: { readonly bank: BankDetails; readonly confirm: Confirm; readonly onChanged: () => void }) {
  const { words, readOnly } = usePortal()
  const { t } = words
  const [editing, setEditing] = useState(false)
  const current = bank.current
  const coolingOff = current !== null && new Date(current.cooling_off_until).getTime() > Date.now()
  const owed = bank.owed.filter((row) => BigInt(row.payable_minor) > 0n)
  const amounts = new Intl.ListFormat(words.locale, { type: 'conjunction' }).format(owed.map((row) => formatMoney(row.payable_minor, row.currency, row.minor_unit, words.locale)))
  return (
    <>
      {current !== null && coolingOff && (
        <Banner tone="warning" title={t('payment.cooling_off', { until: words.time(current.cooling_off_until) })}>
          {t('payment.cooling_off_text')}{owed.length === 0 ? '' : ` ${t('payment.waits', { count: owed.length, amounts })}`}
        </Banner>
      )}
      {bank.pending_review !== null && (
        <Banner tone="info" title={t('payment.review_title')}>{t('payment.review_text')}</Banner>
      )}
      <Section title={t('payment.account_title')} icon="account_balance" testId="card">
        {current === null
          ? <p className="font-body-lg text-body-lg text-on-surface-variant">{t('payment.no_bank')}</p>
          : (
            <dl className={`${TILE} flex flex-col gap-space-sm`}>
              <div className="flex items-center justify-between gap-space-sm flex-wrap">
                <dt className={CAPTION}>{t('payment.account')}</dt>
                <dd className="font-data-mono-md text-data-mono-md text-on-surface">{current.masked}</dd>
              </div>
              <div className="flex items-center justify-between gap-space-sm flex-wrap">
                <dt className={CAPTION}>{t('payment.format')}</dt>
                <dd className="font-body-lg text-body-lg text-on-surface">{current.scheme === 'iban' ? 'IBAN' : t('payment.local_account')}</dd>
              </div>
              <div className="flex items-center justify-between gap-space-sm flex-wrap">
                <dt className={CAPTION}>{t('payment.recorded')}</dt>
                <dd className={`${MONO} text-secondary`}>{words.time(current.created_at)}</dd>
              </div>
            </dl>
          )}
        {editing
          ? <BankChange confirm={confirm} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged() }} />
          : bank.pending_review === null && !readOnly && (
            <>
              <Button variant="primary" size="lg" icon="edit" onClick={() => setEditing(true)} data-testid="primary-action">{t('payment.change_bank')}</Button>
              <p className={CAPTION}>{t('payment.password_first')}</p>
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
  const { words } = usePortal()
  const { t } = words
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState<BankForm>(EMPTY_BANK)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [errors, setErrors] = useState<Readonly<Partial<Record<BankField, string>>>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  function set(field: keyof BankForm, value: string) {
    setForm((was) => ({ ...was, [field]: value }))
    setKey(crypto.randomUUID()) // other details are another action
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    const found = Object.keys(bankErrors(form)).filter(isBankField).map((field) => [field, t(`payment.invalid.${field}`)] as const)
    setErrors(Object.fromEntries(found))
    setRefusal(null)
    if (found.length > 0) return
    if (!(await confirm())) return
    setBusy(true)
    try {
      const answer = await api.put<{ state: string; until?: string }>('/v1/me/bank-details', bankBody(form), { idempotencyKey: key })
      // A review (202) shows as pending_review once the page reloads.
      if (answer.data.until !== undefined) toast({ message: t('payment.bank_saved', { until: words.time(answer.data.until) }) })
      onDone()
    } catch (error) {
      if (isApiError(error, 'BANK_DETAILS_INVALID')) {
        const path = (error.details as { path?: string } | null)?.path ?? ''
        setErrors({ [isBankField(path) ? path : 'account_holder']: t('payment.value_invalid') })
      } else {
        setRefusal(errorText(error, t))
      }
      setBusy(false)
    }
  }
  const field = (name: BankField, label: string, extra: { readonly optional?: boolean; readonly inputMode?: 'numeric'; readonly helper?: string } = {}) => (
    <PortalInput id={BANK_FIELDS[name]} label={label} autoComplete="off" value={form[name]} error={errors[name]} optional={extra.optional}
      inputMode={extra.inputMode} helper={extra.helper} onChange={(event) => set(name, event.target.value)} />
  )
  if (step === 1) {
    return (
      <div className="flex flex-col gap-space-md">
        <RadioGroup legend={t('payment.account_format')} name="bank-scheme" value={form.scheme} onChange={(value) => set('scheme', value === 'local' ? 'local' : 'iban')}
          options={[{ value: 'iban', label: 'IBAN', helper: t('payment.iban_helper') }, { value: 'local', label: t('payment.local_option') }]} />
        <div className="flex flex-col gap-space-xs">
          <Button variant="primary" size="lg" onClick={() => setStep(2)}>{t('common.continue')}</Button>
          <Button size="lg" onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </div>
    )
  }
  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-space-md">
      {field('account_holder', t('payment.holder'))}
      {form.scheme === 'iban'
        ? <>{field('iban', 'IBAN', { helper: t('payment.spaces_ignored') })}{field('bic', 'BIC', { optional: true })}</>
        : <>{field('account_number', t('payment.account_number'), { inputMode: 'numeric' })}{field('bank_code', t('payment.bank_code'), { inputMode: 'numeric' })}</>}
      {refusal !== null && <Banner tone="danger" title={t('payment.bank_not_saved')}>{refusal}</Banner>}
      <div className="flex flex-col gap-space-xs">
        <Button type="submit" variant="primary" size="lg" loading={busy}>{t('payment.save_bank')}</Button>
        <Button size="lg" onClick={() => setStep(1)}>{t('common.back')}</Button>
      </div>
    </form>
  )
}

function TaxSection({ tax, confirm, onChanged }: { readonly tax: TaxProfile; readonly confirm: Confirm; readonly onChanged: () => void }) {
  const { words, readOnly } = usePortal()
  const { t } = words
  const [editing, setEditing] = useState(false)
  const current = tax.current
  return (
    <Section title={t('payment.tax_title')} icon="description">
      {current === null
        ? <p className="font-body-lg text-body-lg text-on-surface-variant">{t('payment.no_tax')}</p>
        : (
          <dl className={`${TILE} flex flex-col gap-space-sm`}>
            <div className="flex items-center justify-between gap-space-sm flex-wrap"><dt className={CAPTION}>{t('payment.residency')}</dt><dd className="font-body-lg text-body-lg text-on-surface">{current.residency ?? '—'}</dd></div>
            <div className="flex items-center justify-between gap-space-sm flex-wrap"><dt className={CAPTION}>{t('payment.entity')}</dt><dd className="font-body-lg text-body-lg text-on-surface">{entityText(current.entity_type, t)}</dd></div>
            <div className="flex items-center justify-between gap-space-sm flex-wrap"><dt className={CAPTION}>{t('payment.tax_id')}</dt><dd className="font-data-mono-md text-data-mono-md text-on-surface">{current.tax_id_masked ?? t('payment.not_given')}</dd></div>
            <div className="flex items-center justify-between gap-space-sm flex-wrap"><dt className={CAPTION}>{t('payment.valid_from')}</dt><dd className={`${MONO} text-secondary`}>{words.time(current.valid_from)}</dd></div>
          </dl>
        )}
      {editing
        ? <TaxChange tax={tax} confirm={confirm} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged() }} />
        : !readOnly && <Button size="lg" icon="edit" onClick={() => setEditing(true)}>{current === null ? t('payment.add_tax') : t('payment.change_tax')}</Button>}
    </Section>
  )
}

function TaxChange({ tax, confirm, onCancel, onDone }: {
  readonly tax: TaxProfile
  readonly confirm: Confirm
  readonly onCancel: () => void
  readonly onDone: () => void
}) {
  const api = useApi()
  const toast = useToast()
  const { t } = usePortal().words
  const current = tax.current
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
    if (!/^[A-Z]{2}$/.test(residency)) found.residency = t('payment.residency_invalid')
    if (form.entity_type === '') found.entity_type = t('payment.entity_required')
    if (taxId !== '' && !/^[A-Z0-9-]{4,32}$/.test(taxId)) found.tax_id = t('errors.TAX_ID_CHARS')
    // A save without a change would still write a version and send the security notice.
    if (Object.keys(found).length === 0 && taxBody(form, current) === null) found.residency = t('payment.nothing_to_change')
    setErrors(found)
    setRefusal(null)
    if (Object.keys(found).length > 0) return
    if (!(await confirm())) return
    setBusy(true)
    try {
      await api.put('/v1/me/tax-profile', { residency, entity_type: form.entity_type, ...(taxId === '' ? {} : { tax_id: taxId }) }, { idempotencyKey: key })
      toast({ message: t('payment.tax_saved') })
      onDone()
    } catch (error) {
      if (isApiError(error, 'TAX_ID_FORMAT')) setErrors({ tax_id: errorText(error, t) })
      else setRefusal(errorText(error, t))
      setBusy(false)
    }
  }
  const taxIdHelp = [
    ...(tax.format === null ? [] : [t('payment.tax_id_format', { label: tax.format.label })]),
    ...(current?.tax_id_masked == null ? [] : [t('payment.keep_tax_id')]),
  ].join(' ')
  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-space-md">
      <PortalInput id="tax-residency" label={t('payment.residency')} helper={t('payment.residency_helper')} maxLength={2} autoCapitalize="characters" value={form.residency} error={errors.residency}
        onChange={(event) => set('residency', event.target.value)} />
      <PortalSelect id="tax-entity" label={t('payment.entity')} placeholder={t('common.choose')} value={form.entity_type}
        options={ENTITY_TYPES.map((value) => ({ value, label: t(`entity.${value}`) }))} error={errors.entity_type}
        onChange={(event) => set('entity_type', event.target.value)} />
      <PortalInput id="tax-id" label={t('payment.tax_id')} optional autoComplete="off" helper={taxIdHelp === '' ? undefined : taxIdHelp}
        value={form.tax_id} error={errors.tax_id} onChange={(event) => set('tax_id', event.target.value)} />
      {refusal !== null && <Banner tone="danger" title={t('payment.tax_not_saved')}>{refusal}</Banner>}
      <div className="flex flex-col gap-space-xs">
        <Button type="submit" variant="primary" size="lg" loading={busy}>{t('payment.save_tax')}</Button>
        <Button size="lg" onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </form>
  )
}

function History({ bank, tax }: { readonly bank: BankDetails; readonly tax: TaxProfile }) {
  const { words } = usePortal()
  const { t } = words
  if (bank.history.length === 0 && tax.history.length === 0) return null
  return (
    <Section title={t('payment.history')} icon="history">
      <ul className="flex flex-col gap-space-xs">
        {bank.history.map((row) => (
          <li key={`bank-${row.created_at}`} className={`${TILE} flex flex-col gap-0.5`}>
            <span className="font-body-lg text-body-lg text-on-surface break-words">{t('payment.history_account', { masked: row.masked })}</span>
            <span className={CAPTION}>
              {t(row.created_via === 'self' ? 'payment.entered_by_you' : 'payment.recorded_by_company', { at: words.time(row.created_at), replaced: words.time(row.superseded_at) })}
            </span>
          </li>
        ))}
        {tax.history.map((row) => (
          <li key={`tax-${row.id}`} className={`${TILE} flex flex-col gap-0.5`}>
            <span className="font-body-lg text-body-lg text-on-surface break-words">
              {t('payment.history_tax', { residency: row.residency ?? '—', entity: entityText(row.entity_type, t), tax_id: row.tax_id_masked ?? t('payment.no_tax_id') })}
            </span>
            <span className={CAPTION}>
              {row.valid_to === null ? t('payment.from', { from: words.time(row.valid_from) }) : t('payment.from_to', { from: words.time(row.valid_from), to: words.time(row.valid_to) })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
