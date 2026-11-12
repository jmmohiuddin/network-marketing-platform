import { Fragment, type ReactNode } from 'react'

export interface FigureFact {
  readonly term: string
  readonly detail: ReactNode
}

export interface FigureCardProps {
  readonly title: string
  /** Report code chip ("R1"). */
  readonly code?: string
  /** Names the card for assistive technology when the title alone is ambiguous (market, period). */
  readonly context?: string
  /** The figure's number as the API states it, formatted; a null figure passes its reason in `note`. */
  readonly value: string
  /** Unit words beside the number ("minor units"), smaller, so the number stays on one line (sc_10 "Net Sales Ratio"). */
  readonly valueLabel?: string
  /** A StatusBadge (outdated, partial). Never a verdict such as "compliant". */
  readonly state?: ReactNode
  readonly note?: ReactNode
  /** Population, numerator, denominator, method, method version. */
  readonly facts?: readonly FigureFact[]
  /** Sparkline and change since the previous period. */
  readonly trend?: ReactNode
  /** The link to the rows behind the figure. */
  readonly action?: ReactNode
  /** The page's first card carries the visual-harness test id. */
  readonly first?: boolean
}

/** sc_10 l.88 R1 card: header strip, large mono value, method facts. Value in text colour (no pass/fail styling). */
export function FigureCard({ title, code, context, value, valueLabel, state, note, facts = [], trend, action, first = false }: FigureCardProps) {
  return (
    <article data-testid={first ? 'card' : undefined} className="rounded bg-surface-container-lowest border border-outline-variant shadow-sm overflow-hidden" aria-label={context === undefined ? title : `${context}: ${title}`}>
      <div className="bg-surface-container-low px-space-md py-space-sm border-b border-outline-variant flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs min-w-0">
          {code !== undefined && <span className="px-2 py-0.5 rounded bg-primary text-on-primary font-data-mono-sm text-data-mono-sm font-bold">{code}</span>}
          <h3 className="font-section-heading text-section-heading text-on-surface">{title}</h3>
        </div>
        {state}
      </div>
      <div className="p-space-md flex flex-col gap-space-sm">
        {context !== undefined && <p className="font-caption text-caption text-secondary">{context}</p>}
        <div className="flex flex-wrap items-baseline gap-x-space-sm gap-y-space-xs">
          <span className="font-data-mono-lg text-[36px] font-bold text-on-surface leading-none tabular-nums break-all">{value}</span>
          {valueLabel !== undefined && ' '}
          {valueLabel !== undefined && <span className="font-body-sm text-body-sm text-secondary font-medium">{valueLabel}</span>}
        </div>
        {trend}
        {note !== undefined && <p className="font-body-sm text-body-sm text-on-surface-variant">{note}</p>}
        {facts.length > 0 && (
          <dl className="pt-3 border-t border-outline-variant grid grid-cols-[auto_1fr] gap-x-space-md gap-y-1 font-body-sm text-body-sm">
            {facts.map((fact) => (
              <Fragment key={fact.term}>
                <dt className="text-secondary">{fact.term}</dt>
                <dd className="text-on-surface">{fact.detail}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        {action}
      </div>
    </article>
  )
}
