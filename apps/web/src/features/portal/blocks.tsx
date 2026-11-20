// Portal building blocks from the sc_37/sc_18 markup that render on the server and in client islands alike (no hooks):
// class sets, section card, closed-account notice, a failure in catalogue words and the "Show more" link.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Banner } from '../../components/banner'
import { LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { isApiError } from '../../lib/api'
import { isNotAvailable } from '../../lib/messages'
import { errorText } from './format'
import type { Translate } from './i18n'

/** sc_37 section card. */
export const CARD = 'bg-surface-container-lowest rounded-xl p-space-md shadow-sm'
/** sc_37 inner tile. */
export const TILE = 'p-space-sm rounded-lg bg-surface-container-low'
export const SECTION_TITLE = 'font-section-heading text-section-heading text-on-surface'
export const PAGE_TITLE = 'font-title-lg-mobile text-title-lg-mobile text-on-surface tracking-tight'
export const CAPTION = 'font-caption text-caption text-on-surface-variant'
export const MONO = 'font-data-mono-sm text-data-mono-sm'
/** sc_37 uppercase list heading ("Statements", "Notices"). */
export const LIST_TITLE = 'px-space-xs text-caption font-caption uppercase tracking-wider text-secondary font-semibold'
/** sc_37 module link card (whole card is the link, ≥ 44 px). */
export const LINK_CARD = 'flex items-center justify-between gap-space-sm p-space-md rounded-xl bg-surface-container-lowest shadow-sm hover:bg-surface-container-low transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
/** Text link with a 44 px touch height. */
export const TEXT_LINK = 'inline-flex items-center gap-0.5 min-h-11 font-body-sm text-body-sm text-primary font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'

/** Items shown before "Show more" (PLAN B5 §5). */
export const SHOW_FIRST = 7

// The shared states' card look (components/states.tsx), with words from the catalogue.
const STATE_CARD = 'bg-surface-container-lowest rounded-xl shadow-sm p-16 flex flex-col items-center gap-space-sm text-center'

/** D-B5-06: team, customers, rank and new disputes are closed to a terminated participant. */
export function ClosedNotice({ t }: { readonly t: Translate }) {
  return <Banner tone="info" title={t('closed.title')}>{t('closed.text')}</Banner>
}

/**
 * A failed read: 404/403 "Not found or not available to you", a closed account, else the error by its code with an
 * optional retry control (a button in a client island, a link on a server page).
 */
export function Failure({ error, t, section = false, retry }: {
  readonly error: unknown
  readonly t: Translate
  readonly section?: boolean
  readonly retry?: ReactNode
}) {
  if (isApiError(error, 'PARTICIPANT_TERMINATED')) return <ClosedNotice t={t} />
  const Heading = section ? 'h2' : 'h1'
  if (isNotAvailable(error)) {
    return (
      <section className={STATE_CARD}>
        <span className="p-2 rounded bg-surface-container text-secondary flex items-center justify-center"><Icon name="search_off" size={24} /></span>
        <Heading className="font-section-heading text-section-heading text-on-surface">{t('failure.not_available')}</Heading>
        <p className="font-body-sm text-body-sm text-secondary">{t(section ? 'failure.not_available_section' : 'failure.not_available_page')}</p>
        <Link href="/portal" className={TEXT_LINK}>{t('failure.home')}</Link>
      </section>
    )
  }
  return (
    <div className={STATE_CARD} role="alert">
      <span className="p-2 rounded bg-error-container text-on-error-container flex items-center justify-center"><Icon name="error" size={24} /></span>
      <Heading className="font-section-heading text-section-heading text-on-surface">{t(section ? 'failure.section' : 'failure.page')}</Heading>
      <p className="font-body-sm text-body-sm text-secondary">{errorText(error, t)}</p>
      {retry}
    </div>
  )
}

/** A card with a section heading (h2) and optional trailing content. */
export function Section({ title, icon, aside, children, id, testId }: {
  readonly title: string
  readonly icon?: string
  readonly aside?: ReactNode
  readonly children: ReactNode
  readonly id?: string
  readonly testId?: string
}) {
  return (
    <section id={id} data-testid={testId} aria-labelledby={id === undefined ? undefined : `${id}-title`} className={`${CARD} flex flex-col gap-space-sm`}>
      <div className="flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon !== undefined && <Icon name={icon} size={18} className="text-primary" />}
          <h2 id={id === undefined ? undefined : `${id}-title`} className={SECTION_TITLE}>{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Server-page "Show more": a plain link asking for more rows (works without scripts). */
export function MoreLink({ href, label, t }: { readonly href: string; readonly label: string; readonly t: Translate }) {
  return (
    <LinkButton href={href} scroll={false} size="lg" aria-label={label}>{t('common.show_more')}</LinkButton>
  )
}

export const statementPath = (runId: string): string => `/portal/earnings/${runId}`
export const linePath = (runId: string, lineId: string): string => `${statementPath(runId)}/lines/${lineId}`
