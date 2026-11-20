import { Banner } from '../../components/banner'
import { LinkButton } from '../../components/button'
import { EmptyState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { ApiError } from '../../lib/api'
import { CAPTION, CARD, ClosedNotice, Failure, MONO, MoreLink, PAGE_TITLE, Section, SHOW_FIRST, TILE } from './blocks'
import { keyLabel, paidAsText, rankText, requirementText, type L10n } from './format'
import { portalSession, serverList, settle, shownCount } from './i18n/server'
import type { PortalProfile, RankPeriod, RankRequirement, RankStatus } from './types'

// SC-19 rank status, server-rendered (FR-DIST-003, D-B5-09, D-BM-12): paid-as rank and titles per committed period of
// one own position, what the current rank requires (measured value against the requirement, met / not met / —, texts in
// the effective locale from the API), one "Not final" row for a calculated open period, and a scheduled plan change.
// The position switch and "Show more" are links (both work without scripts). Never money, streaks, next
// ranks or named legs.

export interface RankQuery {
  readonly position_id?: string | string[]
  readonly shown?: string | string[]
}

export async function RankPage({ query }: { readonly query: RankQuery }) {
  const session = await portalSession()
  if (session instanceof ApiError) return null
  const { profile, words } = session
  const { t } = words
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>{t('nav.rank')}</h1><ClosedNotice t={t} /></>
  const asked = Array.isArray(query.position_id) ? query.position_id[0] : query.position_id
  const positionId = profile.positions.find((position) => position.id === asked)?.id ?? profile.positions[0]?.id
  const shown = shownCount(query.shown, SHOW_FIRST)
  const list = await settle(serverList<RankStatus, RankPeriod>('/v1/me/rank', { position_id: positionId }, shown, (data) => data.periods))
  const href = (count: number) => `/portal/rank?${new URLSearchParams({ ...(positionId === undefined ? {} : { position_id: positionId }), shown: String(count) })}`
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('nav.rank')}</h1>
      {profile.positions.length > 1 && <PositionSwitch profile={profile} positionId={positionId} words={words} />}
      {list instanceof ApiError
        ? <Failure error={list} t={t} retry={<LinkButton href={href(shown)}>{t('common.try_again')}</LinkButton>} />
        : <RankView status={list.data} rows={list.rows} more={list.more ? href(shown + SHOW_FIRST) : null} profile={profile} words={words} />}
    </>
  )
}

/** One link per own position (works without scripts); the shown one is current. */
function PositionSwitch({ profile, positionId, words }: { readonly profile: PortalProfile; readonly positionId: string | undefined; readonly words: L10n }) {
  return (
    <nav aria-label={words.t('rank.position')} className={`${CARD} flex flex-wrap items-center gap-space-xs`}>
      {profile.positions.map((position) => (
        <LinkButton key={position.id} href={`/portal/rank?position_id=${position.id}`} size="lg" variant={position.id === positionId ? 'primary' : 'secondary'}
          aria-current={position.id === positionId ? 'page' : undefined}>
          {position.position_ref}
        </LinkButton>
      ))}
    </nav>
  )
}

function RankView({ status, rows, more, profile, words }: {
  readonly status: RankStatus
  readonly rows: readonly RankPeriod[]
  readonly more: string | null
  readonly profile: PortalProfile
  readonly words: L10n
}) {
  const { t } = words
  const volume = (minor: string) => words.volume(minor, profile.market.minor_unit)
  const newest = rows.find((row) => row.final)
  return (
    <>
      {status.transition_notice !== null && (
        <Banner tone="info" title={t('notice.plan.change_scheduled.title')}>{t('notice.plan.change_scheduled.text', { at: words.time(status.transition_notice.effective_from) })}</Banner>
      )}
      {newest === undefined && rows.length === 0
        ? <EmptyState title={t('rank.no_period')}>{t('rank.no_period_text')}</EmptyState>
        : (
          <section aria-labelledby="rank-title" data-testid="card" className="bg-primary text-on-primary rounded-xl p-space-md shadow-md flex flex-col gap-space-sm">
            <span className="text-caption font-caption tracking-wider uppercase">
              {status.position.position_ref}{newest === undefined ? '' : ` · ${words.period(newest.period.starts_at, newest.period.ends_at)}`}
            </span>
            <div className="flex flex-col">
              <h2 id="rank-title" className="text-caption font-caption">{t('rank.paid_as')}</h2>
              <span className="text-display-mobile font-display-mobile font-bold tracking-tight break-words">{newest === undefined ? t('rank.no_period') : rankText(newest.paid_as, t)}</span>
            </div>
            {newest !== undefined && (
              <dl className="grid grid-cols-2 gap-space-xs pt-space-xs border-t border-on-primary/10">
                <div className="flex flex-col min-w-0">
                  <dt className="text-caption font-caption">{t('rank.highest_title')}</dt>
                  <dd className="text-body-lg font-body-lg font-semibold break-words">{rankText(newest.titles, t)}</dd>
                </div>
                <div className="flex flex-col min-w-0">
                  <dt className="text-caption font-caption">{t('rank.grace_used')}</dt>
                  <dd className="text-body-lg font-body-lg font-semibold break-words">{graceText(newest, words)}</dd>
                </div>
              </dl>
            )}
          </section>
        )}
      {status.requirements.map((requirement) => <Requirements key={`${requirement.ladder}-${requirement.rank}`} requirement={requirement} volume={volume} words={words} />)}
      {rows.length > 0 && (
        <Section title={t('rank.history')} icon="history">
          <ul className="flex flex-col gap-space-xs">
            {rows.map((row) => (
              <li key={`${row.period.id}-${row.final}`} className={`${TILE} flex flex-col gap-1`}>
                <div className="flex items-center justify-between gap-space-sm flex-wrap">
                  <span className="font-body-lg text-body-lg font-medium text-on-surface">{words.period(row.period.starts_at, row.period.ends_at)}</span>
                  {row.final ? <StatusBadge state="committed" label={t('rank.final')} /> : <StatusBadge state="calculated" label={t('rank.not_final')} />}
                </div>
                <span className="font-body-lg text-body-lg text-on-surface">{paidAsText(row.paid_as, t)}</span>
                {row.measures.length > 0 && <span className={`${MONO} text-on-surface-variant break-words`}>{row.measures.map((m) => `${keyLabel(m.measure, t)} ${volume(m.value)}`).join(' · ')}</span>}
              </li>
            ))}
          </ul>
          {more !== null && <MoreLink href={more} label={t('rank.more_periods')} t={t} />}
        </Section>
      )}
    </>
  )
}

function graceText(row: RankPeriod, words: L10n): string {
  const used = (row.grace_used ?? []).filter((g) => g.periods > 0)
  return used.length === 0 ? words.t('rank.grace_none') : used.map((g) => `${keyLabel(g.ladder, words.t)}: ${g.periods}`).join(' · ')
}

function Requirements({ requirement, volume, words }: { readonly requirement: RankRequirement; readonly volume: (minor: string) => string; readonly words: L10n }) {
  const { t } = words
  const grace = requirement.grace
  const held = requirement.status === 'held'
    ? t('rank.held')
    : grace === undefined ? t('rank.held_by_grace') : t('rank.held_by_grace_of', { used: grace.used, of: grace.of })
  return (
    <Section title={t('rank.requires', { rank: requirement.rank })} icon="fact_check"
      aside={<StatusBadge state={requirement.status === 'held' ? 'active' : 'grace'} label={held} />}>
      <ul className="flex flex-col gap-space-xs">
        {requirement.items.map((item, index) => (
          <li key={index} className={`${TILE} flex flex-col gap-1`}>
            <div className="flex items-center justify-between gap-space-sm flex-wrap">
              <span className="font-body-lg text-body-lg font-semibold text-on-surface min-w-0 break-words">{requirementText(item, t)}</span>
              <StatusBadge state={item.met === true ? 'active' : item.met === false ? 'blocked' : 'open'} label={item.met === true ? t('rank.met') : item.met === false ? t('rank.not_met') : '—'} />
            </div>
            {item.kind === 'measure' && item.required !== undefined && (
              <span className={CAPTION}>{t('rank.measured', { measured: item.measured == null ? '—' : volume(item.measured), required: volume(item.required) })}</span>
            )}
            {item.kind === 'legs' && item.required !== undefined && <span className={CAPTION}>{t('rank.legs_required', { required: item.required })}</span>}
          </li>
        ))}
      </ul>
    </Section>
  )
}
