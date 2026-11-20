'use client'

import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { LoadingState } from '../../components/states'
import { isApiError } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { CAPTION, CARD, ClosedNotice, linePath, PAGE_TITLE } from './blocks'
import { errorText, formatMoney, keyLabel, type L10n } from './format'
import { usePortal } from './shell'
import type { Explanation, Statement } from './types'
import { PortalFailure, PortalTextarea } from './ui'

// FR-CAS-003 "Dispute this line" (POST /v1/me/disputes, Idempotency-Key): the message goes with the line's trace to the
// company; refusals (already open, window closed) are explained in words.

const MESSAGE_MAX = 2000

interface Opened {
  readonly case_id: string
  readonly due_at: string | null
}

export function DisputePage({ runId, lineId }: { readonly runId: string; readonly lineId: string }) {
  const { profile, words: { t } } = usePortal()
  const statement = useResource<Statement>(profile.terminated ? null : `/v1/me/statements/${runId}`)
  const explanation = useResource<Explanation>(profile.terminated ? null : `/v1/me/statement-lines/${lineId}/explanation`)
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>{t('dispute.title')}</h1><ClosedNotice t={t} /></>
  const failed = statement.error ?? explanation.error
  if (failed !== null) return <PortalFailure error={failed} onRetry={() => { statement.reload(); explanation.reload() }} />
  if (statement.data === null || explanation.data === null) return <LoadingState label={t('dispute.loading')} />
  return <DisputeForm runId={runId} lineId={lineId} statement={statement.data} line={explanation.data} />
}

function DisputeForm({ runId, lineId, statement, line }: { readonly runId: string; readonly lineId: string; readonly statement: Statement; readonly line: Explanation }) {
  const api = useApi()
  const { words } = usePortal()
  const { t } = words
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
      setFieldError(t('dispute.message_required'))
      return
    }
    setFieldError(null)
    setRefusal(null)
    setBusy(true)
    try {
      setOpened((await api.post<Opened>('/v1/me/disputes', { line_id: lineId, message: text }, { idempotencyKey: key })).data)
    } catch (error) {
      setRefusal(refusalText(error, words))
    } finally {
      setBusy(false)
    }
  }
  const back = linePath(runId, lineId)
  if (opened !== null) {
    return (
      <>
        <h1 className={PAGE_TITLE}>{t('dispute.opened')}</h1>
        <Banner tone="success" title={t('dispute.sent')}>
          {opened.due_at === null ? t('dispute.no_response_time') : t('dispute.answers_by', { at: words.time(opened.due_at) })}
        </Banner>
        <LinkButton href={back} size="lg" variant="primary">{t('dispute.back')}</LinkButton>
      </>
    )
  }
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('dispute.title')}</h1>
      <section aria-label={t('dispute.the_line')} className={`${CARD} flex flex-col gap-1`}>
        <span className="font-body-lg text-body-lg font-medium text-on-surface">{keyLabel(line.rule.key, t)}</span>
        <span className="font-data-mono-md text-data-mono-md text-on-surface">{formatMoney(line.amount_minor, line.currency, statement.market.minor_unit, words.locale)}</span>
        <span className={CAPTION}>{words.period(statement.period.starts_at, statement.period.ends_at)}</span>
      </section>
      <form noValidate onSubmit={submit} className={`${CARD} flex flex-col gap-space-md`}>
        <p className="font-body-lg text-body-lg text-on-surface-variant">{t('dispute.intro')}</p>
        <PortalTextarea id="dispute-message" label={t('dispute.message')} rows={5} maxLength={MESSAGE_MAX} value={message} error={fieldError}
          helper={t('dispute.message_max', { count: MESSAGE_MAX })} onChange={(event) => change(event.target.value)} />
        {refusal !== null && <Banner tone="danger" title={t('dispute.not_opened')}>{refusal}</Banner>}
        <Button type="submit" variant="primary" size="lg" loading={busy} data-testid="primary-action">{t('dispute.send')}</Button>
      </form>
    </>
  )
}

function refusalText(error: unknown, words: L10n): string {
  if (isApiError(error, 'DISPUTE_WINDOW_CLOSED')) {
    const closed = (error.details as { closed_at?: unknown } | null)?.closed_at
    if (typeof closed === 'string') return words.t('dispute.window_closed', { at: words.time(closed) })
  }
  return errorText(error, words.t)
}
