'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { LoadingState } from '../../components/states'
import { isApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { moneyText } from '../orders/format'
import { periodName } from '../periods/format'
import { keyLabel, timeText } from './format'
import { usePortal } from './shell'
import { linePath } from './statement'
import type { Explanation, Statement } from './types'
import { CAPTION, CARD, ClosedNotice, PAGE_TITLE, PortalFailure, PortalTextarea } from './ui'

// FR-CAS-003 "Dispute this line" (POST /v1/me/disputes, Idempotency-Key): the message goes with the line's trace to the
// company; refusals (already open, window closed) are explained in words.

const MESSAGE_MAX = 2000

interface Opened {
  readonly case_id: string
  readonly due_at: string | null
}

export function DisputePage({ runId, lineId }: { readonly runId: string; readonly lineId: string }) {
  const { profile } = usePortal()
  const statement = useResource<Statement>(profile.terminated ? null : `/v1/me/statements/${runId}`)
  const explanation = useResource<Explanation>(profile.terminated ? null : `/v1/me/statement-lines/${lineId}/explanation`)
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>Dispute this line</h1><ClosedNotice /></>
  const failed = statement.error ?? explanation.error
  if (failed !== null) return <PortalFailure error={failed} onRetry={() => { statement.reload(); explanation.reload() }} />
  if (statement.data === null || explanation.data === null) return <LoadingState label="Loading the line" />
  return <DisputeForm runId={runId} lineId={lineId} statement={statement.data} line={explanation.data} />
}

function DisputeForm({ runId, lineId, statement, line }: { readonly runId: string; readonly lineId: string; readonly statement: Statement; readonly line: Explanation }) {
  const api = useApi()
  const { zone } = usePortal()
  const [message, setMessage] = useState('')
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<Opened | null>(null)
  function change(value: string) {
    setMessage(value)
    setKey(crypto.randomUUID()) // another message is another action
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim()
    if (text === '') {
      setFieldError('Say what you think is wrong with this line.')
      return
    }
    setFieldError(null)
    setRefusal(null)
    setBusy(true)
    try {
      setOpened((await api.post<Opened>('/v1/me/disputes', { line_id: lineId, message: text }, { idempotencyKey: key })).data)
    } catch (error) {
      setRefusal(refusalText(error, zone))
    } finally {
      setBusy(false)
    }
  }
  const back = linePath(runId, lineId)
  if (opened !== null) {
    return (
      <>
        <h1 className={PAGE_TITLE}>Dispute opened</h1>
        <Banner tone="success" title="Your dispute was sent to the company">
          {opened.due_at === null ? 'The company has not set a response time; you will get a notice when it answers.' : `The company answers by ${timeText(opened.due_at, zone)}. You will get a notice.`}
        </Banner>
        <LinkButton href={back} size="lg" variant="primary">Back to the line</LinkButton>
      </>
    )
  }
  return (
    <>
      <h1 className={PAGE_TITLE}>Dispute this line</h1>
      <section aria-label="The line" className={`${CARD} flex flex-col gap-1`}>
        <span className="font-body-lg text-body-lg font-medium text-on-surface">{keyLabel(line.rule.key)}</span>
        <span className="font-data-mono-md text-data-mono-md text-on-surface">{moneyText(line.amount_minor, line.currency, statement.market.minor_unit)}</span>
        <span className={CAPTION}>{periodName(statement.period.starts_at, statement.period.ends_at, zone)}</span>
      </section>
      <form noValidate onSubmit={submit} className={`${CARD} flex flex-col gap-space-md`}>
        <p className="font-body-lg text-body-lg text-on-surface-variant">The company receives your message with the calculation of this line and answers with an explanation.</p>
        <PortalTextarea id="dispute-message" label="What is wrong with this line?" rows={5} maxLength={MESSAGE_MAX} value={message} error={fieldError}
          helper={`Up to ${MESSAGE_MAX} characters.`} onChange={(event) => change(event.target.value)} />
        {refusal !== null && <Banner tone="danger" title="The dispute was not opened">{refusal}</Banner>}
        <Button type="submit" variant="primary" size="lg" loading={busy} data-testid="primary-action">Send dispute</Button>
      </form>
    </>
  )
}

function refusalText(error: unknown, zone: string): string {
  if (isApiError(error, 'DISPUTE_WINDOW_CLOSED')) {
    const closed = (error.details as { closed_at?: unknown } | null)?.closed_at
    return typeof closed === 'string' ? `Disputes of this statement closed on ${timeText(closed, zone)}.` : errorMessage(error)
  }
  if (isApiError(error, 'DISPUTE_OPEN')) return 'This line already has a dispute in progress. You will get a notice when the company answers.'
  return errorMessage(error)
}
