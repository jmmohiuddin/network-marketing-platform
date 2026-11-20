'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Breadcrumbs } from '../../components/page-header'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { ApiError } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { positionBadge } from '../people/format'
import { CAPTION, CARD, ClosedNotice, Failure, LINK_CARD, MONO, PAGE_TITLE, Section, TILE } from './blocks'
import type { L10n } from './format'
import type { Translate } from './i18n'
import { usePortal } from './shell'
import type { TeamNode, TeamPolicy, TeamSearch, TeamView } from './types'
import { PortalFailure, PortalInput, PortalSelect, ShowMore, useShownList } from './ui'

// SC-20 team view (FR-DIST-004, D-B5-10): the sponsor tree below one own position, named as far as the company's
// visibility policy allows; deeper levels as counts per level only. A node outside your team reads like an unknown one.
// Never volume rankings, head counts per leg, totals of the network or portraits.

/** Children per page (PLAN B5 §5 SC-20). */
const CHILDREN_PAGE = 25
const SEARCH_MIN = 2
const POSITION_STATES = ['pending', 'active', 'suspended', 'terminated'] as const

export function policyText(policy: TeamPolicy, t: Translate): string {
  return [
    t('team.policy_levels', { count: policy.named_depth }),
    policy.contact_for_personally_sponsored ? t('team.policy_contact') : t('team.policy_no_contact'),
    t('team.policy_deeper'),
  ].join(' ')
}

export function TeamPage() {
  const { profile, words: { t } } = usePortal()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const requested = params.get('position')
  const positionId = requested !== null && profile.positions.some((p) => p.id === requested) ? requested : profile.positions[0]?.id ?? ''
  const node = params.get('node')
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>{t('nav.team')}</h1><ClosedNotice t={t} /></>
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('nav.team')}</h1>
      {profile.positions.length > 1 && (
        <div className={CARD}>
          <PortalSelect id="team-position" label={t('rank.position')} value={positionId} onChange={(event) => router.push(`${pathname}?position=${event.target.value}`)}
            options={profile.positions.map((position) => ({ value: position.id, label: position.position_ref }))} />
        </div>
      )}
      <TeamSearchBox key={positionId} positionId={positionId} />
      {/* A node id goes into the API query only when it is a UUID; anything else reads as not found. */}
      {node !== null && !isUuid(node)
        ? <Failure error={new ApiError(404, 'NOT_FOUND', '')} t={t} />
        : <TeamTree key={`${positionId}-${node ?? ''}`} positionId={positionId} node={node} />}
    </>
  )
}

function TeamSearchBox({ positionId }: { readonly positionId: string }) {
  const { t } = usePortal().words
  const [text, setText] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const found = useResource<TeamSearch>(query === null ? null : '/v1/me/team', { position_id: positionId, q: query ?? undefined })
  function submit(event: FormEvent) {
    event.preventDefault()
    const q = text.trim()
    if (q.length < SEARCH_MIN) {
      setError(t('team.search_min', { count: SEARCH_MIN }))
      return
    }
    setError(null)
    setQuery(q)
  }
  return (
    <section aria-label={t('team.search_title')} className="flex flex-col gap-space-xs">
      <form role="search" noValidate onSubmit={submit} className="flex items-end gap-space-xs">
        <div className="flex-1 min-w-0">
          <PortalInput id="team-search" label={t('team.search_label')} type="search" value={text} error={error} onChange={(event) => setText(event.target.value)} />
        </div>
        <Button type="submit" size="lg" icon="search">{t('team.search')}</Button>
      </form>
      {found.error !== null && <PortalFailure error={found.error} onRetry={found.reload} section />}
      {found.loading && <LoadingState label={t('team.searching')} />}
      {found.data !== null && (found.data.matches.length === 0
        ? <p className={CAPTION} role="status">{t('team.no_match', { query: query ?? '' })}</p>
        : <ul aria-label={t('team.results')} className="flex flex-col gap-space-xs">{found.data.matches.map((match) => <li key={match.position_id}><NodeLink node={match} positionId={positionId} /></li>)}</ul>)}
    </section>
  )
}

function TeamTree({ positionId, node }: { readonly positionId: string; readonly node: string | null }) {
  const { words } = usePortal()
  const { t } = words
  const query = { position_id: positionId === '' ? undefined : positionId, node: node ?? undefined }
  const list = useShownList<TeamView, TeamNode>('/v1/me/team', query, CHILDREN_PAGE, (data) => data.children)
  if (list.first.error !== null) return <PortalFailure error={list.first.error} onRetry={list.first.reload} />
  if (list.data === null || list.rows === null) return <LoadingState label={t('team.loading')} />
  const view = list.data
  return (
    <>
      <div className={`${TILE} flex items-start gap-space-xs`}>
        <Icon name="verified_user" size={18} className="text-primary-container mt-0.5" />
        <p className="font-body-lg text-body-lg text-on-surface-variant">{policyText(view.policy, t)}</p>
      </div>
      {node !== null && (
        <Breadcrumbs touch label={t('common.breadcrumb')} items={[
          { label: t('team.you_ref', { ref: view.viewer.position_ref }), href: `/portal/team?position=${positionId}` },
          { label: view.node?.position_ref ?? t('rank.position') },
        ]} />
      )}
      {view.node !== null && (
        <section aria-label={t('rank.position')} data-testid="card" className={`${CARD} flex flex-col gap-1`}>
          <NodeFacts node={view.node} you={node === null} words={words} />
        </section>
      )}
      <Section title={node === null ? t('team.you_sponsor') : t('team.sponsored_by', { ref: view.node?.position_ref ?? t('team.this_position') })} icon="account_tree">
        {list.rows.length === 0
          ? <p className={CAPTION}>{t('team.nobody_below')}</p>
          : <ul className="flex flex-col gap-space-xs">{list.rows.map((child) => <li key={child.position_id}><NodeLink node={child} positionId={positionId} /></li>)}</ul>}
        <ShowMore list={list} label={t('team.more')} />
      </Section>
      {view.hidden_levels.length > 0 && (
        <Section title={t('team.deeper')} icon="layers">
          <ul className="flex flex-col gap-space-xs">
            {view.hidden_levels.map((level) => (
              <li key={level.depth} className={`${TILE} flex items-center justify-between gap-space-sm flex-wrap`}>
                <span className="font-body-lg text-body-lg text-on-surface">{t('team.level', { level: level.depth })}</span>
                <span className={`${MONO} text-on-surface`}>{t('team.people_totals', { count: level.count })}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

function NodeFacts({ node, you, words }: { readonly node: TeamNode; readonly you: boolean; readonly words: L10n }) {
  const { t } = words
  const contact = node.contact_masked == null ? [] : Object.values(node.contact_masked)
  const badge = positionBadge(node.status)
  const status = POSITION_STATES.find((state) => state === node.status)
  const name = node.display_name ?? t('common.name_not_shown')
  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-section-heading text-section-heading text-on-surface break-words">{you ? t('team.name_you', { name }) : name}</span>
        <span className={`${MONO} text-on-surface-variant px-1.5 py-0.5 rounded bg-surface-container-high`}>{node.position_ref}</span>
        <StatusBadge state={badge.state} label={status === undefined ? node.status : t(`team.status.${status}`)} />
      </div>
      <span className={CAPTION}>
        {[
          node.depth === 0 ? null : t('team.level', { level: node.depth }),
          node.enrolled_on == null ? null : t('team.enrolled', { at: words.date(node.enrolled_on) }),
        ].filter(Boolean).join(' · ')}
      </span>
      {contact.length > 0 && <span className={`${MONO} text-on-surface-variant break-all`}>{contact.join(' · ')}</span>}
    </>
  )
}

function NodeLink({ node, positionId }: { readonly node: TeamNode; readonly positionId: string }) {
  const { words } = usePortal()
  return (
    <Link href={`/portal/team?position=${positionId}&node=${node.position_id}`} className={LINK_CARD}
      aria-label={words.t('team.open', { name: node.display_name ?? node.position_ref, ref: node.position_ref })}>
      <div className="flex flex-col gap-0.5 min-w-0"><NodeFacts node={node} you={false} words={words} /></div>
      <Icon name="chevron_right" size={20} className="text-secondary shrink-0" />
    </Link>
  )
}
