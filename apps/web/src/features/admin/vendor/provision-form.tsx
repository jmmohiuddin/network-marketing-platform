'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button, LinkButton } from '../../../components/button'
import { ErrorSummary, type SummaryItem } from '../../../components/error-summary'
import { SelectField, TextField } from '../../../components/form-field'
import { PageHeader } from '../../../components/page-header'
import { useToast } from '../../../components/toast'
import { isApiError } from '../../../lib/api'
import { emailError, requiredError } from '../../../lib/validation'
import { isUuid } from '../format'
import { summaryOf } from '../form-dialog'
import type { TenantDetail } from '../types'
import { ConsoleNav } from './console-nav'

// Mirrors ops/routes.ts createBody; the API validates again and its issues are shown per field.
const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const COUNTRY = /^[A-Z]{2}$/
const CURRENCY = /^[A-Z]{3}$/
const MINOR_UNIT = /^[0-4]$/
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const MAX_MARKETS = 50

const TENANT_FIELDS = ['legal_name', 'slug', 'region', 'isolation_tier', 'dpa_document_id', 'first_admin.email', 'first_admin.display_name'] as const
const MARKET_FIELDS = ['code', 'currency', 'minor_unit', 'time_zone', 'languages', 'market_pack'] as const
type TenantField = (typeof TENANT_FIELDS)[number]
type MarketField = (typeof MARKET_FIELDS)[number]
type TenantDraft = Record<TenantField, string>
type MarketDraft = Record<MarketField, string> & { readonly id: number }
type Errors = Readonly<Record<string, string>>

/** Field id of a request body path: "markets.0.code" -> "provision-markets-0-code". */
export const fieldIdOf = (path: string): string => `provision-${path.replace(/\./g, '-')}`

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const languagesOf = (text: string): string[] => text.split(',').map((tag) => tag.trim()).filter((tag) => tag !== '')

function tenantError(field: TenantField, value: string): string | null {
  const text = value.trim()
  switch (field) {
    case 'legal_name': return requiredError('the legal name', text)
    case 'slug': return SLUG.test(text) ? null : 'Use lower-case letters, digits and hyphens, starting and ending with a letter or digit.'
    case 'region': return requiredError('the data region', text)
    case 'isolation_tier': return text === '' ? 'Choose the isolation tier.' : null
    case 'dpa_document_id': return isUuid(text) ? null : 'Enter the ID of the signed data processing agreement.'
    case 'first_admin.email': return requiredError('the first admin’s email address', text) ?? emailError(text)
    case 'first_admin.display_name': return null
  }
}

function marketError(field: MarketField, value: string): string | null {
  const text = value.trim()
  switch (field) {
    case 'code': return COUNTRY.test(text) ? null : 'Enter a two-letter country code in capitals, for example DE.'
    case 'currency': return CURRENCY.test(text) ? null : 'Enter a three-letter currency code in capitals, for example EUR.'
    case 'minor_unit': return MINOR_UNIT.test(text) ? null : 'Enter the number of decimals of the currency, from 0 to 4.'
    case 'time_zone': return text !== '' && isTimeZone(text) ? null : 'Enter a time zone such as Europe/Berlin.'
    case 'languages': {
      const tags = languagesOf(text)
      return tags.length > 0 && tags.every((tag) => LANGUAGE.test(tag)) ? null : 'Enter language tags separated by commas, for example de, en.'
    }
    case 'market_pack': return requiredError('the market pack', text)
  }
}

/** Field errors keyed by body path. */
export function checkProvisioning(tenant: TenantDraft, markets: readonly Record<MarketField, string>[]): Errors {
  const tenantErrors = TENANT_FIELDS.flatMap((field) => {
    const error = tenantError(field, tenant[field])
    return error === null ? [] : [[field, error] as const]
  })
  const codes = markets.map((market) => market.code.trim())
  const marketErrors = markets.flatMap((market, index) => MARKET_FIELDS.flatMap((field) => {
    const duplicate = field === 'code' && codes.indexOf(codes[index] ?? '') !== index ? 'Each market may appear once.' : null
    const error = marketError(field, market[field]) ?? duplicate
    return error === null ? [] : [[`markets.${index}.${field}`, error] as const]
  }))
  const none = markets.length === 0 ? [['markets', 'Add at least one market.'] as const] : []
  return Object.fromEntries([...tenantErrors, ...marketErrors, ...none])
}

function bodyOf(tenant: TenantDraft, markets: readonly MarketDraft[]) {
  const name = tenant['first_admin.display_name'].trim()
  return {
    legal_name: tenant.legal_name.trim(),
    slug: tenant.slug.trim(),
    region: tenant.region.trim(),
    isolation_tier: tenant.isolation_tier,
    dpa_document_id: tenant.dpa_document_id.trim(),
    markets: markets.map((market) => ({
      code: market.code.trim(), currency: market.currency.trim(), minor_unit: Number(market.minor_unit.trim()),
      time_zone: market.time_zone.trim(), languages: languagesOf(market.languages), market_pack: market.market_pack.trim(),
    })),
    first_admin: { email: tenant['first_admin.email'].trim(), display_name: name === '' ? null : name },
  }
}

// Placement and slug refusals belong to one field each; REGION_UNAVAILABLE lists the regions on offer.
function refusalSummary(error: unknown, fieldIds: Readonly<Record<string, string>>): SummaryItem[] {
  if (isApiError(error, 'SLUG_TAKEN')) return [{ fieldId: fieldIdOf('slug'), message: error.message }]
  if (isApiError(error, 'TIER_NOT_AVAILABLE')) return [{ fieldId: fieldIdOf('isolation_tier'), message: error.message }]
  if (isApiError(error, 'REGION_UNAVAILABLE')) {
    const regions = (error.details as { regions?: unknown } | null)?.regions
    const offered = Array.isArray(regions) ? ` Available regions: ${regions.join(', ')}.` : ''
    return [{ fieldId: fieldIdOf('region'), message: `${error.message}${offered}` }]
  }
  return summaryOf(error, fieldIds)
}

const EMPTY_TENANT: TenantDraft = Object.fromEntries(TENANT_FIELDS.map((field) => [field, ''])) as TenantDraft
const emptyMarket = (id: number): MarketDraft => ({ id, code: '', currency: '', minor_unit: '', time_zone: '', languages: '', market_pack: '' })

const MARKET_LABELS: Readonly<Record<MarketField, { label: string; helper?: string }>> = {
  code: { label: 'Country code', helper: 'ISO 3166-1, for example DE' },
  currency: { label: 'Currency', helper: 'ISO 4217, for example EUR' },
  minor_unit: { label: 'Currency decimals', helper: '2 for EUR, 0 for JPY' },
  time_zone: { label: 'Time zone', helper: 'For example Europe/Berlin' },
  languages: { label: 'Languages', helper: 'Comma-separated, for example de, en' },
  market_pack: { label: 'Market pack' },
}

/**
 * SC-39 Provision tenant (FR-TEN-001, E-ADR-23): POST /v1/tenants with an Idempotency-Key. The tenant starts in
 * provisioning; a second vendor user approves it on the tenant's page before the first admin is invited.
 */
export function ProvisionTenantPage() {
  const api = useApi()
  const toast = useToast()
  const router = useRouter()
  // One Idempotency-Key per attempt at the same body: a retry reuses it, a corrected body gets a new one.
  const [attempt, setAttempt] = useState<{ readonly key: string; readonly body: string } | null>(null)
  const [tenant, setTenant] = useState<TenantDraft>(EMPTY_TENANT)
  const [markets, setMarkets] = useState<readonly MarketDraft[]>([emptyMarket(0)])
  const [nextId, setNextId] = useState(1)
  const [errors, setErrors] = useState<Errors>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)
  const fieldIds = Object.fromEntries([
    ...TENANT_FIELDS.map((field) => [field, fieldIdOf(field)]),
    ...markets.flatMap((_, index) => MARKET_FIELDS.map((field) => [`markets.${index}.${field}`, fieldIdOf(`markets.${index}.${field}`)])),
  ])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = checkProvisioning(tenant, markets)
    setErrors(found)
    const items = Object.entries(found).map(([path, message]) => ({ fieldId: fieldIdOf(path === 'markets' ? 'add-market' : path), message }))
    setSummary(items)
    if (items.length > 0) return
    const body = bodyOf(tenant, markets)
    const serialized = JSON.stringify(body)
    const idempotencyKey = attempt?.body === serialized ? attempt.key : crypto.randomUUID()
    setAttempt({ key: idempotencyKey, body: serialized })
    setBusy(true)
    try {
      const { data } = await api.post<TenantDetail>('/v1/tenants', body, { idempotencyKey })
      toast({ message: `${data.legal_name} created. Another vendor user must approve it before its first admin is invited.` })
      router.push(`/vendor/tenants/${data.id}`)
    } catch (error) {
      setSummary(refusalSummary(error, fieldIds))
      setBusy(false)
    }
  }
  const tenantField = (field: TenantField, label: string, extra: { helper?: string; optional?: boolean; type?: string } = {}) => (
    <TextField
      id={fieldIdOf(field)}
      label={label}
      helper={extra.helper}
      optional={extra.optional}
      type={extra.type ?? 'text'}
      value={tenant[field]}
      error={errors[field]}
      onChange={(event) => setTenant({ ...tenant, [field]: event.target.value })}
    />
  )
  const updateMarket = (id: number, field: MarketField, value: string) =>
    setMarkets((list) => list.map((market) => (market.id === id ? { ...market, [field]: value } : market)))
  return (
    <>
      <ConsoleNav />
      <PageHeader title="Provision tenant" summary="Creates the tenant in provisioning with its region, markets and first admin. A second vendor user approves it." />
      <form className="form" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} />
        <fieldset className="admin-fieldset">
          <legend>Tenant</legend>
          {tenantField('legal_name', 'Legal name')}
          {tenantField('slug', 'Slug', { helper: 'Lower-case letters, digits and hyphens; staff sign in with it.' })}
          {tenantField('region', 'Data region', { helper: 'Where all of the tenant’s data, backups and exports stay, for example eu. It cannot change after the first data load.' })}
          <SelectField
            id={fieldIdOf('isolation_tier')}
            label="Isolation tier"
            placeholder="Choose a tier"
            value={tenant.isolation_tier}
            error={errors.isolation_tier}
            options={[{ value: 'pooled', label: 'Pooled database (row-level isolation)' }, { value: 'dedicated', label: 'Dedicated database' }]}
            onChange={(event) => setTenant({ ...tenant, isolation_tier: event.target.value })}
          />
          {tenantField('dpa_document_id', 'Signed data processing agreement ID', { helper: 'Required before a tenant is created.' })}
        </fieldset>
        <fieldset className="admin-fieldset">
          <legend>Markets</legend>
          {markets.map((market, index) => (
            <div key={market.id} className="admin-group">
              <div className="admin-group-header">
                <h3 className="admin-card-title">Market {index + 1}</h3>
                {markets.length > 1 && (
                  <Button variant="tertiary" onClick={() => setMarkets((list) => list.filter((other) => other.id !== market.id))}>Remove market {index + 1}</Button>
                )}
              </div>
              <div className="admin-pair">
                {MARKET_FIELDS.map((field) => (
                  <TextField
                    key={field}
                    id={fieldIdOf(`markets.${index}.${field}`)}
                    label={MARKET_LABELS[field].label}
                    helper={MARKET_LABELS[field].helper}
                    inputMode={field === 'minor_unit' ? 'numeric' : undefined}
                    value={market[field]}
                    error={errors[`markets.${index}.${field}`]}
                    onChange={(event) => updateMarket(market.id, field, event.target.value)}
                  />
                ))}
              </div>
            </div>
          ))}
          {markets.length < MAX_MARKETS && (
            <div>
              <Button
                id={fieldIdOf('add-market')}
                onClick={() => {
                  setMarkets((list) => [...list, emptyMarket(nextId)])
                  setNextId((id) => id + 1)
                }}
              >
                Add market
              </Button>
            </div>
          )}
        </fieldset>
        <fieldset className="admin-fieldset">
          <legend>First admin</legend>
          {tenantField('first_admin.email', 'Email address', { type: 'email', helper: 'Invited only after the second vendor user approves.' })}
          {tenantField('first_admin.display_name', 'Name', { optional: true })}
        </fieldset>
        <div className="form-actions">
          <LinkButton href="/vendor">Cancel</LinkButton>
          <Button type="submit" variant="primary" loading={busy}>Create tenant</Button>
        </div>
      </form>
    </>
  )
}
