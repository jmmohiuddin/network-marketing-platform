'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Checkbox, RadioGroup } from '../../components/form-field'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { saveFile } from '../data/transfer'
import { deferralText, PRIVACY_STATE, PRIVACY_TYPE, timeText } from './format'
import { useReauth } from './reauth'
import { usePortal } from './shell'
import type { PrivacyRequest, PrivacyType } from './types'
import { CAPTION, PAGE_TITLE, PortalFailure, PortalTextarea, Section, TILE } from './ui'

// My data (FR-PRV-001/002, UI_UX §4.4): ask for a copy, a portable file, a correction or erasure; follow each
// request's state, due date and what defers an erasure; download the export once done. Erasure needs the password
// first and says what is erased and what the company keeps and why (D-B5-18).

const DETAILS_MAX = 2000
const EXPORT_TYPES: ReadonlySet<PrivacyType> = new Set(['access', 'portability'])

const TYPE_HELP: Readonly<Record<PrivacyType, string>> = {
  access: 'A copy of the personal data the company holds about you.',
  portability: 'The same data as a machine-readable file you can take elsewhere.',
  correction: 'Tell the company what is wrong; it corrects your record after checking.',
  erasure: 'Your name, contact and identity data are removed; your account is closed.',
}

export function MyDataPage() {
  const requests = useResource<PrivacyRequest[]>('/v1/me/privacy-requests')
  return (
    <>
      <h1 className={PAGE_TITLE}>My data</h1>
      <NewRequest onCreated={requests.reload} />
      <Section title="Your requests" icon="shield_person">
        {requests.error !== null && <PortalFailure error={requests.error} onRetry={requests.reload} section />}
        {requests.data === null && requests.error === null && <LoadingState label="Loading your requests" />}
        {requests.data !== null && requests.data.length === 0 && <EmptyState plain title="No requests yet" />}
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
  const { zone } = usePortal()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = PRIVACY_STATE[request.state]
  async function download() {
    setBusy(true)
    setError(null)
    try {
      const answer = await api.get<Blob>(`/v1/me/privacy-requests/${request.id}/export`, { responseType: 'blob', headers: { Accept: 'application/json' } })
      saveFile(answer.data, `my-data-${request.id.slice(0, 8)}.json`)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className={`${TILE} flex flex-col gap-1`}>
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <span className="font-body-lg text-body-lg font-medium text-on-surface">{PRIVACY_TYPE[request.type]}</span>
        <StatusBadge state={state.state} label={state.label} />
      </div>
      <span className={CAPTION}>
        {request.closed_at !== null ? `Closed ${timeText(request.closed_at, zone)}` : request.due_at === null ? 'The answer date is set once your request is checked.' : `Answer due by ${timeText(request.due_at, zone)}`}
      </span>
      {(request.deferred_reasons ?? []).length > 0 && (
        <div className="flex flex-col">
          <span className="font-body-lg text-body-lg text-on-surface">Erasure waits because:</span>
          <ul className="list-disc pl-6 font-body-lg text-body-lg text-on-surface-variant">
            {request.deferred_reasons!.map((reason) => <li key={reason.reason}>{deferralText(reason.reason)}</li>)}
          </ul>
        </div>
      )}
      {request.retention_basis !== null && <p className={CAPTION}>Kept by the company because: {request.retention_basis}</p>}
      {request.state === 'fulfilled' && EXPORT_TYPES.has(request.type) && (
        <Button size="lg" icon="download" loading={busy} onClick={download}>Download your data</Button>
      )}
      {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
    </li>
  )
}

function NewRequest({ onCreated }: { readonly onCreated: () => void }) {
  const api = useApi()
  const toast = useToast()
  const reauth = useReauth()
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
    if (type === '') found.type = 'Choose what you are asking for.'
    if (type === 'correction' && text === '') found.details = 'Say what should be corrected.'
    if (type === 'erasure' && !understood) found.understood = 'Confirm that you have read what is erased and what is kept.'
    setErrors(found)
    setRefusal(null)
    if (Object.keys(found).length > 0 || type === '') return
    if (type === 'erasure' && !(await reauth.confirm())) return
    setBusy(true)
    try {
      await api.post('/v1/me/privacy-requests', { type, ...(text === '' ? {} : { details: text }) }, { idempotencyKey: key })
      toast({ message: 'Your request was sent. You get a notice when it is answered.' })
      setType('')
      setDetails('')
      setUnderstood(false)
      renew()
      onCreated()
    } catch (error) {
      setRefusal(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Make a request" icon="add">
      <form noValidate onSubmit={submit} className="flex flex-col gap-space-md">
        <RadioGroup legend="What are you asking for?" name="privacy-type" value={type} error={errors.type}
          onChange={(value) => { setType(value as PrivacyType); renew() }}
          options={(Object.keys(PRIVACY_TYPE) as PrivacyType[]).map((value) => ({ value, label: PRIVACY_TYPE[value], helper: TYPE_HELP[value] }))} />
        {type !== '' && type !== 'erasure' && (
          <PortalTextarea id="privacy-details" label="Details" optional={type !== 'correction'} rows={4} maxLength={DETAILS_MAX} value={details} error={errors.details}
            helper={type === 'correction' ? 'Which data is wrong and what it should be.' : undefined} onChange={(event) => { setDetails(event.target.value); renew() }} />
        )}
        {type === 'erasure' && (
          <div className="flex flex-col gap-space-sm">
            <Banner tone="warning" title="What erasure does">
              <p>Erased: your name, contact details and identity document link, your tax id, your bank account details, your portal account and sign-in history, and any queued emails.</p>
              <p className="mt-1">Kept, because the law and the company’s accounts need them: your statements and their lines, ledger postings and payouts (amounts only, with the account shown as “erased”), your tax residency and entity type, a fingerprint of your bank account used to detect shared accounts, and the record of this request.</p>
              <p className="mt-1">Erasure waits while money is owed to you, a payout is on its way or on hold, or a case about your earnings is open. You will be asked for your password before the request is sent.</p>
            </Banner>
            <Checkbox id="privacy-understood" label="I have read what is erased and what is kept." checked={understood} error={errors.understood}
              onChange={(event) => { setUnderstood(event.target.checked); renew() }} />
          </div>
        )}
        {refusal !== null && <Banner tone="danger" title="The request was not sent">{refusal}</Banner>}
        <Button type="submit" variant="primary" size="lg" loading={busy} data-testid="primary-action">Send request</Button>
      </form>
      {reauth.dialog}
    </Section>
  )
}
