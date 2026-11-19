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
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { noticeView, timeText } from './format'
import { PortalSignOut } from './more'
import { usePortal } from './shell'
import type { Notice, Preference } from './types'
import { CAPTION, CARD, MONO, PAGE_TITLE, PortalFailure, Section, SHOW_FIRST, ShowMore, TEXT_LINK, useShownList } from './ui'

// SC-38 notifications and profile (FR-DIST-008, D-B5-14): Inbox (in-app notices, mark read / all read), Channels
// (email per optional topic; security, privacy and plan changes always sent), Profile (identity, two-step sign-in,
// sign out). No language list, SMS or PDF downloads.

type View = 'inbox' | 'channels' | 'profile'

const TOPIC_LABELS: Readonly<Record<string, { readonly label: string; readonly description: string }>> = {
  statement: { label: 'Statements', description: 'When a new statement is ready.' },
  payout: { label: 'Payouts', description: 'When a payout is sent, held or returned.' },
  dispute: { label: 'Disputes', description: 'When the company answers a dispute.' },
  security: { label: 'Security', description: 'Changes to your bank details or tax profile.' },
  privacy: { label: 'Privacy requests', description: 'Updates on your data requests.' },
  plan_change: { label: 'Plan changes', description: 'When a new compensation plan version is scheduled.' },
}

export function NotificationsPage() {
  const [view, setView] = useState<View>('inbox')
  return (
    <>
      <h1 className={PAGE_TITLE}>Notifications and profile</h1>
      <SegmentedControl touch label="Show" value={view} onChange={(value) => setView(value as View)}
        options={[{ value: 'inbox', label: 'Inbox' }, { value: 'channels', label: 'Channels' }, { value: 'profile', label: 'Profile' }]} />
      {view === 'inbox' && <Inbox />}
      {view === 'channels' && <Channels />}
      {view === 'profile' && <Profile />}
    </>
  )
}

function Inbox() {
  const api = useApi()
  const { zone, unread, refreshUnread } = usePortal()
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
      refreshUnread()
    } catch (failure) {
      setError(errorMessage(failure))
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
  if (list.rows === null) return <LoadingState label="Loading your notifications" />
  if (list.rows.length === 0) return <EmptyState title="No notifications yet">Statements, payouts and account changes are announced here.</EmptyState>
  const isRead = (notice: Notice) => allRead || notice.read_at !== null || read.has(notice.id)
  return (
    <section aria-label="Inbox" className="flex flex-col gap-space-sm">
      <div className="flex items-center justify-between gap-space-sm">
        <span className={CAPTION} role="status">{unread === null ? '' : unread === 0 || allRead ? 'All read' : `${unread} unread`}</span>
        <Button size="lg" variant="tertiary" loading={busy} disabled={allRead || unread === 0} onClick={markAll}>Mark all read</Button>
      </div>
      {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
      <ul className="flex flex-col gap-space-sm" data-testid="card">
        {list.rows.map((notice) => {
          const notView = noticeView(notice, zone)
          const done = isRead(notice)
          return (
            <li key={notice.id} className={`${CARD} flex flex-col gap-space-xs ${done ? '' : 'border-l-4 border-l-primary'}`}>
              <div className="flex items-center justify-between gap-space-xs flex-wrap">
                <span className="flex items-center gap-space-xs">
                  <StatusBadge state={notView.badge} label={notView.kind} />
                  <span className={CAPTION}>{timeText(notice.created_at, zone)}</span>
                </span>
                <span className={`${MONO} ${done ? 'text-outline' : 'text-primary font-semibold'}`}>{done ? 'Read' : 'Unread'}</span>
              </div>
              <h2 className="font-section-heading text-section-heading text-on-surface">{notView.title}</h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant">{notView.text}</p>
              <div className="flex items-center justify-between gap-space-sm flex-wrap">
                {notView.href !== null && notView.linkLabel !== null && (
                  <Link href={notView.href} className={TEXT_LINK}>{notView.linkLabel} <Icon name="chevron_right" size={16} /></Link>
                )}
                {!done && <Button size="lg" variant="tertiary" disabled={busy} onClick={() => markOne(notice.id)} aria-label={`Mark read: ${notView.title}`}>Mark read</Button>}
              </div>
            </li>
          )
        })}
      </ul>
      <ShowMore list={list} label="notifications" />
    </section>
  )
}

function Channels() {
  const api = useApi()
  const preferences = useResource<Preference[]>('/v1/me/notification-preferences')
  const [saved, setSaved] = useState<readonly Preference[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (preferences.error !== null) return <PortalFailure error={preferences.error} onRetry={preferences.reload} section />
  const rows = saved ?? preferences.data
  if (rows === null) return <LoadingState label="Loading your channels" />
  async function change(topic: string, email: boolean) {
    setError(null)
    try {
      setSaved((await api.put<Preference[]>('/v1/me/notification-preferences', { topic, email })).data)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }
  const words = (topic: string) => TOPIC_LABELS[topic] ?? { label: topic, description: '' }
  return (
    <>
      <Section title="Email" icon="mail">
        <p className="font-body-lg text-body-lg text-on-surface-variant">Your inbox here always shows every notice. Choose which ones also come by email.</p>
        {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
        <div className="flex flex-col gap-space-xs">
          {rows.filter((row) => !row.mandatory).map((row) => (
            <Switch key={row.topic} label={words(row.topic).label} description={words(row.topic).description} checked={row.email === true}
              onChange={(checked) => void change(row.topic, checked)} />
          ))}
        </div>
      </Section>
      <Section title="Always sent" icon="lock">
        <div className="flex flex-col gap-space-xs">
          {rows.filter((row) => row.mandatory).map((row) => (
            <Switch key={row.topic} label={words(row.topic).label} checked onChange={() => undefined} locked={`${words(row.topic).description} Always sent by email and in the inbox.`} />
          ))}
        </div>
      </Section>
    </>
  )
}

function Profile() {
  const { me, profile } = usePortal()
  const name = profile.display_name ?? me.user.display_name
  return (
    <>
      <section aria-label="Profile" className={`${CARD} flex items-center gap-space-sm`}>
        <span aria-hidden="true" className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-primary-container font-semibold text-title-md font-title-md shrink-0">
          {initials(name, me.user.email)}
        </span>
        <div className="flex flex-col min-w-0">
          <h2 className="font-section-heading text-section-heading text-on-surface">{name ?? me.user.email}</h2>
          <span className="font-body-lg text-body-lg text-on-surface-variant break-all">{me.user.email}</span>
          {profile.external_ref !== null && <span className={`${MONO} text-on-surface-variant`}>Member reference {profile.external_ref}</span>}
        </div>
      </section>
      <Section title="Two-step sign-in" icon="key">
        {me.mfa.enrolled
          ? <p className="font-body-lg text-body-lg text-on-surface-variant">On: you confirm sign-ins and changes with your authenticator app.</p>
          : (
            <>
              <p className="font-body-lg text-body-lg text-on-surface-variant">Off. Add an authenticator app to protect your account.</p>
              <Link href="/signin/enrol?next=/portal/more" className={TEXT_LINK}>Turn on two-step sign-in <Icon name="chevron_right" size={16} /></Link>
            </>
          )}
      </Section>
      <PortalSignOut />
    </>
  )
}
