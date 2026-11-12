import type { ReactNode } from 'react'

export interface PageHeaderProps {
  /** Object or page name. */
  readonly title: string
  /** A StatusChip next to the title, when the page shows one object. */
  readonly state?: ReactNode
  /** The one-sentence summary under the title (required on dashboards, reviews and approvals). */
  readonly summary?: ReactNode
  /** At most one primary button, right-aligned; secondary buttons before it. */
  readonly actions?: ReactNode
}

/** Title row + summary sentence: the top of every staff page (UI-01 §7, T1). */
export function PageHeader({ title, state, summary, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-row">
        <div className="page-title">
          <h1>{title}</h1>
          {state}
        </div>
        {actions !== undefined && <div className="page-actions">{actions}</div>}
      </div>
      {summary !== undefined && <p className="page-summary">{summary}</p>}
    </header>
  )
}
