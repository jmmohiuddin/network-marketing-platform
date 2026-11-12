import type { ReactNode } from 'react'
import { Button, LinkButton } from './button'
import { Icon } from './icon'

// No Stitch instance: the sc_01 card shell + one 24 px outline icon + a section-heading sentence + one action.
const CARD = 'bg-surface-container-lowest rounded-xl shadow-sm'
const BLOCK = 'p-16 flex flex-col items-center gap-space-sm text-center'
const ICON_TILE = 'p-2 rounded bg-surface-container text-secondary flex items-center justify-center'

export interface EmptyStateProps {
  /** One sentence: what will appear here, or that nothing matched. */
  readonly title: string
  readonly children?: ReactNode
  /** One action at most. */
  readonly action?: ReactNode
  /** Inside a container that is already a card (a table body). */
  readonly plain?: boolean
}

/** First use or no results: one outline icon, one sentence, one action. */
export function EmptyState({ title, children, action, plain = false }: EmptyStateProps) {
  return (
    <div className={plain ? BLOCK : `${CARD} ${BLOCK}`}>
      <span className={ICON_TILE}><Icon name="inbox" size={24} /></span>
      <p className="font-section-heading text-section-heading text-on-surface">{title}</p>
      {children !== undefined && <div className="font-body-sm text-body-sm text-secondary">{children}</div>}
      {action}
    </div>
  )
}

/** Skeleton block: the only allowed pulse (motion-safe). */
export function Skeleton({ className = 'h-3 w-full' }: { readonly className?: string }) {
  return <span aria-hidden="true" className={`block rounded bg-surface-container motion-safe:animate-pulse ${className}`} />
}

/** A whole section is loading; shows a sentence, announced politely. */
export function LoadingState({ label }: { readonly label: string }) {
  return (
    <div className={`${CARD} p-space-lg flex flex-col gap-space-sm`} role="status" aria-busy="true">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <p className="font-body-sm text-body-sm text-secondary">{label}</p>
    </div>
  )
}

export interface ErrorStateProps {
  /** What happened and what to do; includes the reference id for server failures (errorMessage). */
  readonly message: string
  readonly onRetry?: () => void
  /** Inside a page that has its own heading and primary action: an h2 and a secondary button. */
  readonly section?: boolean
}

/** Blocking error: the page or section could not be loaded. */
export function ErrorState({ message, onRetry, section = false }: ErrorStateProps) {
  const Heading = section ? 'h2' : 'h1'
  return (
    <div className={`${CARD} ${BLOCK}`} role="alert">
      <span className="p-2 rounded bg-error-container text-on-error-container flex items-center justify-center"><Icon name="error" size={24} /></span>
      <Heading className="font-section-heading text-section-heading text-on-surface">{section ? 'This section could not be loaded' : 'This page could not be loaded'}</Heading>
      <p className="font-body-sm text-body-sm text-secondary">{message}</p>
      {onRetry !== undefined && <Button variant={section ? 'secondary' : 'primary'} onClick={onRetry}>Try again</Button>}
    </div>
  )
}

/**
 * The 403 and 404 page: the same words for both, so a page never confirms that something exists outside the
 * user's scope. `plain` inside a container that is already a card (CardLayout).
 */
export function NotAvailable({ section = false, plain = false }: { readonly section?: boolean; readonly plain?: boolean }) {
  const Heading = section ? 'h2' : 'h1'
  return (
    <section className={plain ? 'flex flex-col items-center gap-space-sm text-center' : `${CARD} ${BLOCK}`}>
      <span className={ICON_TILE}><Icon name="search_off" size={24} /></span>
      <Heading className="font-section-heading text-section-heading text-on-surface">Not found or not available to you</Heading>
      <p className="font-body-sm text-body-sm text-secondary">{section ? 'This part of the page does not exist, or your account cannot open it.' : 'The page does not exist, or your account cannot open it.'}</p>
      <LinkButton href="/" variant={section ? 'secondary' : 'primary'}>Go to your home page</LinkButton>
    </section>
  )
}
