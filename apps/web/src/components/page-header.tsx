import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from './icon'

export interface Crumb {
  readonly label: string
  /** Absent for the current page (the last item). */
  readonly href?: string
}

/** sc_09 l.7 breadcrumbs; the last item is the current page, not a link. */
export function Breadcrumbs({ items }: { readonly items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-space-xs text-on-surface-variant font-caption text-caption">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-space-xs">
              {last || item.href === undefined
                ? <span aria-current={last ? 'page' : undefined} className={last ? 'text-on-surface font-semibold' : undefined}>{item.label}</span>
                : <Link href={item.href} className="hover:text-primary hover:underline transition-colors">{item.label}</Link>}
              {!last && <Icon name="chevron_right" size={14} />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export interface PageHeaderProps {
  /** Object or page name: the page's only h1. */
  readonly title: string
  /** A StatusBadge next to the title, when the page shows one object. */
  readonly state?: ReactNode
  /** The one-sentence summary under the title (required on dashboards, reviews and approvals). */
  readonly summary?: ReactNode
  /** At most one primary button, last; secondary buttons before it. */
  readonly actions?: ReactNode
  /** Small mono chip above the title: the period or object id. */
  readonly eyebrow?: ReactNode
  readonly breadcrumbs?: readonly Crumb[]
  /** The console-level title (sc_14, sc_39 draw the h1 in font-display) instead of the sc_01 title-lg. */
  readonly display?: boolean
}

/**
 * sc_01 "Top Command & Action Bar": the first element of every staff page. It bleeds to the edges of the shell's
 * content padding (-mx-space-lg -mt-space-md), so put it first in the page.
 */
export function PageHeader({ title, state, summary, actions, eyebrow, breadcrumbs, display = false }: PageHeaderProps) {
  return (
    <header className="-mx-space-lg -mt-space-md bg-surface-container-lowest px-space-lg py-space-md shadow-sm flex flex-col gap-space-sm">
      {breadcrumbs !== undefined && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
        <div className="flex flex-col min-w-0">
          {eyebrow !== undefined && (
            <div className="flex items-center gap-space-sm mb-space-xxs">
              <span className="font-data-mono-sm text-data-mono-sm px-space-xs py-0.5 rounded bg-surface-container text-primary font-semibold">{eyebrow}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-space-sm">
            <h1 className={`${display ? 'font-display-mobile text-display-mobile sm:font-display sm:text-display' : 'font-title-lg-mobile text-title-lg-mobile sm:font-title-lg sm:text-title-lg'} text-on-surface tracking-tight`}>{title}</h1>
            {state}
          </div>
          {summary !== undefined && <p className="font-body-md text-body-md text-secondary mt-0.5">{summary}</p>}
        </div>
        {actions !== undefined && <div className="flex flex-wrap items-center gap-space-xs">{actions}</div>}
      </div>
    </header>
  )
}
