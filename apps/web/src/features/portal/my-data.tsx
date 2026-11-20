'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Checkbox, RadioGroup } from '../../components/form-field'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { useResource } from '../../lib/use-resource'
import { saveFile } from '../data/transfer'
import { CAPTION, PAGE_TITLE, Section, TILE } from './blocks'
import { deferralText, errorText, privacyBadge, PRIVACY_TYPES } from './format'
import { useReauth } from './reauth'
import { usePortal } from './shell'
import type { PrivacyRequest, PrivacyType } from './types'
import { PortalFailure, PortalTextarea } from './ui'

// My data (FR-PRV-001/002, UI_UX §4.4): ask for a copy, a portable file, a correction or erasure; follow each
// request's state, due date and what defers an erasure; download the export once done. Erasure needs the password
// first and says what is erased and what the company keeps and why (D-B5-18).

const DETAILS_MAX = 2000
const EXPORT_TYPES: ReadonlySet<PrivacyType> = new Set(['access', 'portability'])

export function MyDataPage() {
  const { t } = usePortal().words
  const requests = useResource<PrivacyRequest[]>('/v1/me/privacy-requests')
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('my_data.title')}</h1>
      <NewRequest onCreated={requests.reload} />
      <Section title={t('my_data.requests')} icon="shield_person">
        {requests.error !== null && <PortalFailure error={requests.error} onRetry={requests.reload} section />}
        {requests.data === null && requests.error === null && <LoadingState label={t('my_data.loading')} />}
        {requests.data !== null && requests.data.length === 0 && <EmptyState plain title={t('my_data.empty')} />}
        {requests.data !== null && requests.data.length > 0 && (
          <ul className="flex flex-col gap-space-xs" data-testid="card">
            {requests.data.map((request) => <RequestItem key={request.id} request={request} />)}
          </ul>
        )}
      </Section>
    </>
  )
}

function RequestItem({ request }: { readonly request: PrivacyRequest }) {
  const api = useApi()
  const { words } = usePortal()
  const { t } = words
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = privacyBadge(request.state, t)
  async function download() {
    setBusy(true)
    setError(null)
    try {
      const answer = await api.get<Blob>(`/v1/me/privacy-requests/${request.id}/export`, { responseType: 'blob', headers: { Accept: 'application/json' } })
      saveFile(answer.data, `my-data-${request.id.slice(0, 8)}.json`)
    } catch (failure) {
      setError(errorText(failure, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className={`${TILE} flex flex-col gap-1`}>
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <span className="font-body-lg text-body-lg font-medium text-on-surface">{t(`privacy.type.${request.type}`)}</span>
        <StatusBadge state={state.state} label={state.label} />
      </div>
      <span className={CAPTION}>
        {request.closed_at !== null ? t('my_data.closed', { at: words.time(request.closed_at) }) : request.due_at === null ? t('my_data.no_due') : t('earnings.answer_due', { at: words.time(request.due_at) })}
      </span>
      {(request.deferred_reasons ?? []).length > 0 && (
        <div className="flex flex-col">
          <span className="font-body-lg text-body-lg text-on-surface">{t('my_data.waits_because')}</span>
          <ul className="list-disc pl-6 font-body-lg text-body-lg text-on-surface-variant">
            {request.deferred_reasons!.map((reason) => <li key={reason.reason}>{deferralText(reason.reason, t)}</li>)}
          </ul>
        </div>
      )}
      {request.retention_basis !== null && <p className={CAPTION}>{t('my_data.kept_because', { basis: request.retention_basis })}</p>}
      {request.state === 'fulfilled' && EXPORT_TYPES.has(request.type) && (
        <Button size="lg" icon="download" loading={busy} onClick={download}>{t('my_data.download')}</Button>
      )}
      {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
    </li>
  )
}

function NewRequest({ onCreated }: { readonly onCreated: () => void }) {
  const api = useApi()
  const toast = useToast()
  const reauth = useReauth()
  const { t } = usePortal().words
  const [type, setType] = useState<PrivacyType | ''>('')
  const [details, setDetails] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  function renew() {
    setKey(crypto.randomUUID())
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = details.trim()
    const found: Record<string, string> = {}
    if (type === '') found.type = t('my_data.type_required')
    if (type === 'correction' && text === '') found.details = t('my_data.details_required')
    if (type === 'erasure' && !understood) found.understood = t('my_data.understood_required')
    setErrors(found)
    setRefusal(null)
    if (Object.keys(found).length > 0 || type === '') return
    if (type === 'erasure' && !(await reauth.confirm())) return
    setBusy(true)
    try {
      await api.post('/v1/me/privacy-requests', { type, ...(text === '' ? {} : { details: text }) }, { idempotencyKey: key })
      toast({ message: t('my_data.sent') })
      setType('')
      setDetails('')
      setUnderstood(false)
      renew()
      onCreated()
    } catch (error) {
      setRefusal(errorText(error, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('my_data.make_request')} icon="add">
      <form noValidate onSubmit={submit} className="flex flex-col gap-space-md">
        <RadioGroup legend={t('my_data.asking_for')} name="privacy-type" value={type} error={errors.type}
          onChange={(value) => { setType(value as PrivacyType); renew() }}
          options={PRIVACY_TYPES.map((value) => ({ value, label: t(`privacy.type.${value}`), helper: t(`privacy.help.${value}`) }))} />
        {type !== '' && type !== 'erasure' && (
          <PortalTextarea id="privacy-details" label={t('my_data.details')} optional={type !== 'correction'} rows={4} maxLength={DETAILS_MAX} value={details} error={errors.details}
            helper={type === 'correction' ? t('my_data.details_helper') : undefined} onChange={(event) => { setDetails(event.target.value); renew() }} />
        )}
        {type === 'erasure' && (
          <div className="flex flex-col gap-space-sm">
            <Banner tone="warning" title={t('my_data.erasure_title')}>
              <p>{t('my_data.erasure_erased')}</p>
              <p className="mt-1">{t('my_data.erasure_kept')}</p>
              <p className="mt-1">{t('my_data.erasure_waits')}</p>
            </Banner>
            <Checkbox id="privacy-understood" label={t('my_data.understood')} checked={understood} error={errors.understood}
              onChange={(event) => { setUnderstood(event.target.checked); renew() }} />
          </div>
        )}
        {refusal !== null && <Banner tone="danger" title={t('my_data.not_sent')}>{refusal}</Banner>}
        <Button type="submit" variant="primary" size="lg" loading={busy} data-testid="primary-action">{t('my_data.send')}</Button>
      </form>
      {reauth.dialog}
    </Section>
  )
}
