'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { TextInput } from '../../components/form-field'
import type { SummaryItem } from '../../components/error-summary'
import { useToast } from '../../components/toast'
import { requiredError } from '../../lib/validation'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { PAIR } from '../admin/ui'
import { explainRefusal } from './format'
import type { Market } from '../../lib/markets'
import type { Brand } from './types'

export const REASON_ID = 'structure-reason'
const MAX_LANGUAGES = 10
const CODE = /^[A-Z]{2}$/
const CURRENCY = /^[A-Z]{3}$/

/** Field id -> message, for the error summary. */
export function summaryItems(errors: Readonly<Record<string, string | null>>): SummaryItem[] {
  return Object.entries(errors).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
}

/** Sends, turning structure refusals into sentences that name what blocks them. */
export async function explained<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send()
  } catch (error) {
    throw explainRefusal(error)
  }
}

export interface MarketFields {
  readonly code: string
  readonly currency: string
  readonly time_zone: string
  readonly languages: string
  readonly market_pack: string
}

/** Client checks of a market form (the API validates ISO codes, zones and languages again). */
export function marketErrors(fields: MarketFields, creating: boolean): Record<string, string | null> {
  const languages = fields.languages.split(',').map((language) => language.trim()).filter((language) => language !== '')
  return {
    'market-code': creating ? (CODE.test(fields.code.trim().toUpperCase()) ? null : 'Enter the two-letter country code, for example FR.') : null,
    'market-currency': CURRENCY.test(fields.currency.trim().toUpperCase()) ? null : 'Enter the three-letter currency code, for example EUR.',
    'market-zone': requiredError('the time zone, for example Europe/Paris', fields.time_zone),
    'market-languages': languages.length === 0 ? 'Enter at least one language, for example fr.'
      : languages.length > MAX_LANGUAGES ? `Enter at most ${MAX_LANGUAGES} languages.` : null,
    'market-pack': requiredError('the market pack', fields.market_pack),
  }
}

function marketBody(fields: MarketFields) {
  return {
    code: fields.code.trim().toUpperCase(),
    currency: fields.currency.trim().toUpperCase(),
    time_zone: fields.time_zone.trim(),
    languages: fields.languages.split(',').map((language) => language.trim()).filter((language) => language !== ''),
    market_pack: fields.market_pack.trim(),
  }
}

const FIELD_IDS = { code: 'market-code', currency: 'market-currency', time_zone: 'market-zone', languages: 'market-languages', market_pack: 'market-pack', reason: REASON_ID }

export interface MarketDialogProps {
  /** null creates a market (draft); a market edits its zone, languages and, while draft, pack and currency. */
  readonly market: Market | null
  readonly onClose: () => void
  readonly onSaved: () => void
}

/** FR-TEN-002 market create (POST, Idempotency-Key) or edit (PATCH, changed fields only); each with a reason. */
export function MarketDialog({ market, onClose, onSaved }: MarketDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [fields, setFields] = useState<MarketFields>({
    code: market?.code ?? '', currency: market?.currency ?? '', time_zone: market?.time_zone ?? '',
    languages: market?.languages.join(', ') ?? '', market_pack: market?.market_pack ?? '',
  })
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const draft = market === null || market.state === 'draft'
  const set = (field: keyof MarketFields) => (event: { target: { value: string } }) => setFields({ ...fields, [field]: event.target.value })
  function submit(idempotencyKey: string) {
    const found = { ...marketErrors(fields, market === null), [REASON_ID]: requiredError('the reason for this change', reason) }
    const body = marketBody(fields)
    const changed = market === null ? body : Object.fromEntries(Object.entries(body).filter(([field, value]) =>
      field !== 'code' && JSON.stringify(value) !== JSON.stringify(market[field as keyof Market])))
    setErrors(found)
    const unchanged = market !== null && Object.keys(changed).length === 0
    const items = [...summaryItems(found), ...(unchanged ? [{ message: 'Change at least one field before saving.' }] : [])]
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: FIELD_IDS,
      send: async () => {
        const saved = await explained(() => (market === null
          ? api.post<Market>('/v1/markets', { ...body, reason: reason.trim() }, { idempotencyKey })
          : api.patch<Market>(`/v1/markets/${market.id}`, { ...changed, reason: reason.trim() })).then((result) => result.data))
        toast({ message: market === null ? `Market ${saved.code} created as a draft.` : `Market ${saved.code} saved.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={market === null ? 'Add market' : `Edit market ${market.code}`} size="lg" submitLabel={market === null ? 'Add market' : 'Save market'} onClose={onClose} onSubmit={submit}>
      <div className={PAIR}>
        {market === null && <TextInput id="market-code" label="Country code" helper="ISO 3166-1 alpha-2." maxLength={2} value={fields.code} error={errors['market-code']} onChange={set('code')} data-autofocus />}
        <TextInput id="market-currency" label="Currency" helper={draft ? 'ISO 4217, for example EUR.' : 'Changes only while the market is a draft.'} maxLength={3} readOnly={!draft} value={fields.currency} error={errors['market-currency']} onChange={set('currency')} />
        <TextInput id="market-zone" label="Time zone" helper="IANA name, for example Europe/Paris." value={fields.time_zone} error={errors['market-zone']} onChange={set('time_zone')} />
        <TextInput id="market-languages" label="Languages" helper="BCP 47 tags separated by commas, for example fr, en." value={fields.languages} error={errors['market-languages']} onChange={set('languages')} />
        <TextInput id="market-pack" label="Market pack" helper={draft ? 'The rules pack the market applies.' : 'Changes only while the market is a draft.'} maxLength={64} readOnly={!draft} value={fields.market_pack} error={errors['market-pack']} onChange={set('market_pack')} />
      </div>
      <TextAreaField id={REASON_ID} label="Reason for the change" helper="Kept with the new settings version." value={reason} error={errors[REASON_ID]} onChange={setReason} />
    </FormDialog>
  )
}

export interface BrandDialogProps {
  readonly brand: Brand | null
  readonly onClose: () => void
  readonly onSaved: () => void
}

/** FR-TEN-002 brand create (POST) or rename (PATCH), each with a reason. */
export function BrandDialog({ brand, onClose, onSaved }: BrandDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [name, setName] = useState(brand?.name ?? '')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  function submit(idempotencyKey: string) {
    const found = { 'brand-name': requiredError('the brand name', name), [REASON_ID]: requiredError('the reason for this change', reason) }
    setErrors(found)
    const items = summaryItems(found)
    if (items.length > 0) return { items }
    const body = { name: name.trim(), reason: reason.trim() }
    return {
      items,
      fieldIds: { name: 'brand-name', reason: REASON_ID },
      send: async () => {
        await explained(() => (brand === null ? api.post('/v1/brands', body, { idempotencyKey }) : api.patch(`/v1/brands/${brand.id}`, body)))
        toast({ message: brand === null ? `Brand ${body.name} added.` : `Brand renamed to ${body.name}.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={brand === null ? 'Add brand' : `Rename brand ${brand.name}`} submitLabel={brand === null ? 'Add brand' : 'Rename brand'} onClose={onClose} onSubmit={submit}>
      <TextInput id="brand-name" label="Brand name" maxLength={100} value={name} error={errors['brand-name']} onChange={(event) => setName(event.target.value)} data-autofocus />
      <TextAreaField id={REASON_ID} label="Reason for the change" helper="Kept with the new settings version." value={reason} error={errors[REASON_ID]} onChange={setReason} />
    </FormDialog>
  )
}

export interface DeleteDialogProps {
  /** "Delete market FR". */
  readonly title: string
  readonly consequence: string
  readonly path: string
  readonly done: string
  readonly onClose: () => void
  readonly onDeleted: () => void
}

/** DELETE with a reason (every structure delete appends a settings version); refusals name what blocks it. */
export function DeleteDialog({ title, consequence, path, done, onClose, onDeleted }: DeleteDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const missing = requiredError('the reason for deleting it', reason)
    setError(missing)
    if (missing !== null) return { items: [{ fieldId: REASON_ID, message: missing }] }
    return {
      items: [],
      fieldIds: { reason: REASON_ID },
      send: async () => {
        await explained(() => api.delete(path, { body: { reason: reason.trim() } }))
        toast({ message: done })
        onDeleted()
      },
    }
  }
  return (
    <FormDialog title={title} submitLabel={title} submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>{consequence}</p>
      <TextAreaField id={REASON_ID} label="Reason" value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}
