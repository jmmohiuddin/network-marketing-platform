import { Inbox, SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, LinkButton } from './button'

export interface EmptyStateProps {
  /** One sentence: what will appear here, or that nothing matched. */
  readonly title: string
  readonly children?: ReactNode
  /** One action at most. */
  readonly action?: ReactNode
}

/** First use or no results: one line icon, one sentence, one action (UI-04 Empty state). */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Inbox size={24} aria-hidden="true" />
      <p className="empty-state-title">{title}</p>
      {children}
      {action}
    </div>
  )
}

/** A whole section is loading; shows a sentence, announced politely. */
export function LoadingState({ label }: { readonly label: string }) {
  return (
    <div className="state-block" role="status" aria-busy="true">
      <span className="skeleton skeleton-line" aria-hidden="true" />
      <p>{label}</p>
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

/** Blocking error: the page or section could not be loaded (UX-05 §6.6). */
export function ErrorState({ message, onRetry, section = false }: ErrorStateProps) {
  const Heading = section ? 'h2' : 'h1'
  return (
    <div className="state-block" role="alert">
      <Heading className="state-title">{section ? 'This section could not be loaded' : 'This page could not be loaded'}</Heading>
      <p>{message}</p>
      {onRetry !== undefined && <Button variant={section ? 'secondary' : 'primary'} onClick={onRetry}>Try again</Button>}
    </div>
  )
}

/**
 * The 403 and 404 page: the same words for both, so a page never confirms that something exists outside the
 * user's scope (UX-03 §6, UX-05 §8).
 */
export function NotAvailable({ section = false }: { readonly section?: boolean }) {
  const Heading = section ? 'h2' : 'h1'
  return (
    <section className="state-block">
      <SearchX size={24} aria-hidden="true" />
      <Heading className="state-title">Not found or not available to you</Heading>
      <p>{section ? 'This part of the page does not exist, or your account cannot open it.' : 'The page does not exist, or your account cannot open it.'}</p>
      <LinkButton href="/" variant={section ? 'secondary' : 'primary'}>Go to your home page</LinkButton>
    </section>
  )
}
