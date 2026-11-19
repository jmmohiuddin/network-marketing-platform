'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Breadcrumbs } from '../../components/page-header'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { positionBadge } from '../people/format'
import { dateText } from './format'
import { usePortal } from './shell'
import type { TeamNode, TeamPolicy, TeamSearch, TeamView } from './types'
import { CAPTION, CARD, ClosedNotice, LINK_CARD, MONO, PAGE_TITLE, PortalFailure, PortalInput, PortalSelect, Section, ShowMore, TILE, useShownList } from './ui'

// SC-20 team view (FR-DIST-004, D-B5-10): the sponsor tree below one own position, named as far as the company's
// visibility policy allows; deeper levels as counts per level only. A node outside your team reads like an unknown one.
// Never volume rankings, head counts per leg, totals of the network or portraits.

/** Children per page (PLAN B5 §5 SC-20). */
const CHILDREN_PAGE = 25
const SEARCH_MIN = 2

export function policyText(policy: TeamPolicy): string {
  const levels = policy.named_depth === 1 ? '1 level' : `${policy.named_depth} levels`
  const contact = policy.contact_for_personally_sponsored ? 'You see the masked contact of people you sponsor personally.' : 'Contacts are not shown.'
  return `You see names up to ${levels} below you. ${contact} Deeper levels show only how many people they hold.`
}

export function TeamPage() {
  const { profile } = usePortal()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const requested = params.get('position')
  const positionId = requested !== null && profile.positions.some((p) => p.id === requested) ? requested : profile.positions[0]?.id ?? ''
  const node = params.get('node')
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>Team</h1><ClosedNotice /></>
  return (
    <>
      <h1 className={PAGE_TITLE}>Team</h1>
      {profile.positions.length > 1 && (
        <div className={CARD}>
          <PortalSelect id="team-position" label="Position" value={positionId} onChange={(event) => router.push(`${pathname}?position=${event.target.value}`)}
            options={profile.positions.map((position) => ({ value: position.id, label: position.position_ref }))} />
        </div>
      )}
      <TeamSearchBox key={positionId} positionId={positionId} />
      {/* A node id goes into the API query only when it is a UUID; anything else reads as not found. */}
      {node !== null && !isUuid(node)
        ? <NotAvailable />
        : <TeamTree key={`${positionId}-${node ?? ''}`} positionId={positionId} node={node} />}
    </>
  )
}

function TeamSearchBox({ positionId }: { readonly positionId: string }) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const found = useResource<TeamSearch>(query === null ? null : '/v1/me/team', { position_id: positionId, q: query ?? undefined })
  function submit(event: FormEvent) {
    event.preventDefault()
    const q = text.trim()
    if (q.length < SEARCH_MIN) {
      setError(`Enter at least ${SEARCH_MIN} characters of a name or a position reference.`)
      return
    }
    setError(null)
    setQuery(q)
  }
  return (
    <section aria-label="Search your team" className="flex flex-col gap-space-xs">
      <form role="search" noValidate onSubmit={submit} className="flex items-end gap-space-xs">
        <div className="flex-1 min-w-0">
          <PortalInput id="team-search" label="Search by name or position reference" type="search" value={text} error={error} onChange={(event) => setText(event.target.value)} />
        </div>
        <Button type="submit" size="lg" icon="search">Search</Button>
      </form>
      {found.error !== null && <PortalFailure error={found.error} onRetry={found.reload} section />}
      {found.loading && <LoadingState label="Searching your team" />}
      {found.data !== null && (found.data.matches.length === 0
        ? <p className={CAPTION} role="status">Nobody within your named levels matches “{query}”.</p>
        : <ul aria-label="Search results" className="flex flex-col gap-space-xs">{found.data.matches.map((match) => <li key={match.position_id}><NodeLink node={match} positionId={positionId} /></li>)}</ul>)}
    </section>
  )
}

function TeamTree({ positionId, node }: { readonly positionId: string; readonly node: string | null }) {
  const query = { position_id: positionId === '' ? undefined : positionId, node: node ?? undefined }
  const list = useShownList<TeamView, TeamNode>('/v1/me/team', query, CHILDREN_PAGE, (data) => data.children)
  if (list.first.error !== null) return <PortalFailure error={list.first.error} onRetry={list.first.reload} />
  if (list.data === null || list.rows === null) return <LoadingState label="Loading your team" />
  const view = list.data
  return (
    <>
      <div className={`${TILE} flex items-start gap-space-xs`}>
        <Icon name="verified_user" size={18} className="text-primary-container mt-0.5" />
        <p className="font-body-lg text-body-lg text-on-surface-variant">{policyText(view.policy)}</p>
      </div>
      {node !== null && (
        <Breadcrumbs touch items={[
          { label: `You (${view.viewer.position_ref})`, href: `/portal/team?position=${positionId}` },
          { label: view.node?.position_ref ?? 'Position' },
        ]} />
      )}
      {view.node !== null && (
        <section aria-label="Position" data-testid="card" className={`${CARD} flex flex-col gap-1`}>
          <NodeFacts node={view.node} you={node === null} />
        </section>
      )}
      <Section title={node === null ? 'People you sponsor' : `Sponsored by ${view.node?.position_ref ?? 'this position'}`} icon="account_tree">
        {list.rows.length === 0
          ? <p className={CAPTION}>No named person below this position.</p>
          : <ul className="flex flex-col gap-space-xs">{list.rows.map((child) => <li key={child.position_id}><NodeLink node={child} positionId={positionId} /></li>)}</ul>}
        <ShowMore list={list} label="people" />
      </Section>
      {view.hidden_levels.length > 0 && (
        <Section title="Deeper levels" icon="layers">
          <ul className="flex flex-col gap-space-xs">
            {view.hidden_levels.map((level) => (
              <li key={level.depth} className={`${TILE} flex items-center justify-between gap-space-sm`}>
                <span className="font-body-lg text-body-lg text-on-surface">Level {level.depth}</span>
                <span className={`${MONO} text-on-surface`}>{level.count === 1 ? '1 person' : `${level.count} people`} (totals only)</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

function NodeFacts({ node, you }: { readonly node: TeamNode; readonly you: boolean }) {
  const contact = node.contact_masked == null ? [] : Object.values(node.contact_masked)
  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-section-heading text-section-heading text-on-surface">{node.display_name ?? 'Name not shown'}{you ? ' (you)' : ''}</span>
        <span className={`${MONO} text-on-surface-variant px-1.5 py-0.5 rounded bg-surface-container-high`}>{node.position_ref}</span>
        <StatusBadge {...positionBadge(node.status)} />
      </div>
      <span className={CAPTION}>
        {[node.depth === 0 ? null : `Level ${node.depth}`, node.enrolled_on == null ? null : `enrolled ${dateText(node.enrolled_on)}`].filter(Boolean).join(' · ')}
      </span>
      {contact.length > 0 && <span className={`${MONO} text-on-surface-variant`}>{contact.join(' · ')}</span>}
    </>
  )
}

function NodeLink({ node, positionId }: { readonly node: TeamNode; readonly positionId: string }) {
  return (
    <Link href={`/portal/team?position=${positionId}&node=${node.position_id}`} className={LINK_CARD} aria-label={`Open ${node.display_name ?? node.position_ref} (${node.position_ref})`}>
      <div className="flex flex-col gap-0.5 min-w-0"><NodeFacts node={node} you={false} /></div>
      <Icon name="chevron_right" size={20} className="text-secondary shrink-0" />
    </Link>
  )
}
