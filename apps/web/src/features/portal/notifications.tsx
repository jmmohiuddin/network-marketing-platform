'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { SegmentedControl } from '../../components/segmented-control'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { Switch } from '../../components/switch'
import { initials } from '../../components/avatar'
import { useResource } from '../../lib/use-resource'
import { CAPTION, CARD, MONO, PAGE_TITLE, Section, SHOW_FIRST, TEXT_LINK } from './blocks'
import { errorText, noticeView } from './format'
import { usePortal } from './shell'
import type { Notice, Preference } from './types'
import { PortalFailure, PortalSignOut, ShowMore, useShownList } from './ui'

// SC-38 notifications and profile (FR-DIST-008, D-B5-14): Inbox (in-app notices, mark read / all read), Channels
// (email per optional topic; security, privacy and plan changes always sent), Profile (identity, two-step sign-in,
// sign out). The language list has its own page (More › Language); no SMS or PDF downloads.

type View = 'inbox' | 'channels' | 'profile'

const TOPICS = ['statement', 'payout', 'dispute', 'security', 'privacy', 'plan_change'] as const

export function NotificationsPage() {
  const { t } = usePortal().words
  const [view, setView] = useState<View>('inbox')
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('notifications.title')}</h1>
      <SegmentedControl touch label={t('customers.show')} value={view} onChange={(value) => setView(value as View)}
        options={[{ value: 'inbox', label: t('notifications.inbox') }, { value: 'channels', label: t('notifications.channels') }, { value: 'profile', label: t('notifications.profile') }]} />
      {view === 'inbox' && <Inbox />}
      {view === 'channels' && <Channels />}
      {view === 'profile' && <Profile />}
    </>
  )
}

function Inbox() {
  const api = useApi()
  const { words, unread, refresh } = usePortal()
  const { t } = words
  const list = useShownList<Notice[]>('/v1/me/notifications', {}, SHOW_FIRST)
  const [read, setRead] = useState<ReadonlySet<string>>(new Set())
  const [allRead, setAllRead] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      refresh()
    } catch (failure) {
      setError(errorText(failure, t))
    } finally {
      setBusy(false)
    }
  }
  const markAll = () => act(async () => {
    await api.post('/v1/me/notifications/read-all')
    setAllRead(true)
  })
  const markOne = (id: string) => act(async () => {
    await api.post(`/v1/me/notifications/${id}/read`)
    setRead((was) => new Set([...was, id]))
  })
  if (list.first.error !== null) return <PortalFailure error={list.first.error} onRetry={list.first.reload} section />
  if (list.rows === null) return <LoadingState label={t('notifications.loading')} />
  if (list.rows.length === 0) return <EmptyState title={t('notifications.empty')}>{t('notifications.empty_text')}</EmptyState>
  const isRead = (notice: Notice) => allRead || notice.read_at !== null || read.has(notice.id)
  return (
    <section aria-label={t('notifications.inbox')} className="flex flex-col gap-space-sm">
      <div className="flex items-center justify-between gap-space-sm">
        <span className={CAPTION} role="status">{unread === null ? '' : unread === 0 || allRead ? t('notifications.all_read') : t('notifications.unread', { count: unread })}</span>
        <Button size="lg" variant="tertiary" loading={busy} disabled={allRead || unread === 0} onClick={markAll}>{t('notifications.mark_all')}</Button>
      </div>
      {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
      <ul className="flex flex-col gap-space-sm" data-testid="card">
        {list.rows.map((notice) => {
          const notView = noticeView(notice, words)
          const done = isRead(notice)
          return (
            <li key={notice.id} className={`${CARD} flex flex-col gap-space-xs ${done ? '' : 'border-l-4 border-l-primary'}`}>
              <div className="flex items-center justify-between gap-space-xs flex-wrap">
                <span className="flex items-center gap-space-xs">
                  <StatusBadge state={notView.badge} label={notView.kind} />
                  <span className={CAPTION}>{words.time(notice.created_at)}</span>
                </span>
                <span className={`${MONO} ${done ? 'text-outline' : 'text-primary font-semibold'}`}>{done ? t('notifications.read') : t('notifications.not_read')}</span>
              </div>
              <h2 className="font-section-heading text-section-heading text-on-surface">{notView.title}</h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant">{notView.text}</p>
              <div className="flex items-center justify-between gap-space-sm flex-wrap">
                {notView.href !== null && notView.linkLabel !== null && (
                  <Link href={notView.href} className={TEXT_LINK}>{notView.linkLabel} <Icon name="chevron_right" size={16} /></Link>
                )}
                {!done && <Button size="lg" variant="tertiary" disabled={busy} onClick={() => markOne(notice.id)} aria-label={t('notifications.mark_read_of', { title: notView.title })}>{t('notifications.mark_read')}</Button>}
              </div>
            </li>
          )
        })}
      </ul>
      <ShowMore list={list} label={t('notifications.more')} />
    </section>
  )
}

function Channels() {
  const api = useApi()
  const { t } = usePortal().words
  const preferences = useResource<Preference[]>('/v1/me/notification-preferences')
  const [saved, setSaved] = useState<readonly Preference[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (preferences.error !== null) return <PortalFailure error={preferences.error} onRetry={preferences.reload} section />
  const rows = saved ?? preferences.data
  if (rows === null) return <LoadingState label={t('notifications.loading_channels')} />
  async function change(topic: string, email: boolean) {
    setError(null)
    try {
      setSaved((await api.put<Preference[]>('/v1/me/notification-preferences', { topic, email })).data)
    } catch (failure) {
      setError(errorText(failure, t))
    }
  }
  const words = (topic: string) => {
    const known = TOPICS.find((name) => name === topic)
    return known === undefined ? { label: topic, description: '' } : { label: t(`topic.${known}`), description: t(`topic.${known}.text`) }
  }
  const onOff = { on: t('common.on'), off: t('common.off') }
  return (
    <>
      <Section title={t('notifications.email')} icon="mail">
        <p className="font-body-lg text-body-lg text-on-surface-variant">{t('notifications.email_text')}</p>
        {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
        <div className="flex flex-col gap-space-xs">
          {rows.filter((row) => !row.mandatory).map((row) => (
            <Switch key={row.topic} label={words(row.topic).label} description={words(row.topic).description} checked={row.email === true}
              stateLabels={onOff} onChange={(checked) => void change(row.topic, checked)} />
          ))}
        </div>
      </Section>
      <Section title={t('notifications.always_sent')} icon="lock">
        <div className="flex flex-col gap-space-xs">
          {rows.filter((row) => row.mandatory).map((row) => (
            <Switch key={row.topic} label={words(row.topic).label} checked stateLabels={onOff} onChange={() => undefined} locked={`${words(row.topic).description} ${t('notifications.always_sent_text')}`} />
          ))}
        </div>
      </Section>
    </>
  )
}

function Profile() {
  const { me, profile, words: { t } } = usePortal()
  const name = profile.display_name ?? me.user.display_name
  return (
    <>
      <section aria-label={t('notifications.profile')} className={`${CARD} flex items-center gap-space-sm`}>
        <span aria-hidden="true" className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-primary-container font-semibold text-title-md font-title-md shrink-0">
          {initials(name, me.user.email)}
        </span>
        <div className="flex flex-col min-w-0">
          <h2 className="font-section-heading text-section-heading text-on-surface">{name ?? me.user.email}</h2>
          <span className="font-body-lg text-body-lg text-on-surface-variant break-all">{me.user.email}</span>
          {profile.external_ref !== null && <span className={`${MONO} text-on-surface-variant`}>{t('notifications.member_ref', { ref: profile.external_ref })}</span>}
        </div>
      </section>
      <Section title={t('notifications.two_step')} icon="key">
        {me.mfa.enrolled
          ? <p className="font-body-lg text-body-lg text-on-surface-variant">{t('notifications.two_step_on')}</p>
          : (
            <>
              <p className="font-body-lg text-body-lg text-on-surface-variant">{t('notifications.two_step_off')}</p>
              <Link href="/signin/enrol?next=/portal/more" className={TEXT_LINK}>{t('notifications.two_step_turn_on')} <Icon name="chevron_right" size={16} /></Link>
            </>
          )}
      </Section>
      <PortalSignOut />
    </>
  )
}
