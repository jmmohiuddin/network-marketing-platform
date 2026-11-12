import { Fragment, type ReactNode } from 'react'
import { Icon } from '../../components/icon'

// Stitch building blocks shared by the imports and compliance screens (sc_10, sc_24, sc_25, sc_26, sc_46).

/** Secondary sentence under a heading or a control. */
export const NOTE = 'font-body-sm text-body-sm text-secondary'
/** Partner codes, ids, column lists. */
export const CODE = 'font-data-mono-sm text-data-mono-sm break-all'
/** A row of form controls above what they scope. */
export const CONTROLS = 'flex flex-wrap items-end gap-space-sm [&>*]:min-w-[12rem]'
/** Bulleted list inside a banner or panel. */
export const LIST = 'list-disc pl-space-md flex flex-col gap-space-xxs'
/** h2 of a section (sc_24/sc_46 section heading). */
export const SECTION_HEADING = 'font-section-heading text-section-heading text-on-surface'

export interface PanelProps {
  readonly title: string
  /** Material Symbols name shown before the title (sc_24 card heads). */
  readonly icon?: string
  /** Mono text or a badge on the right of the head. */
  readonly meta?: ReactNode
  readonly children: ReactNode
  /** Grid placement (`xl:col-span-7`). */
  readonly className?: string
  /** The page's first card carries the visual-harness test id. */
  readonly first?: boolean
}

/** sc_24 l.51 card: icon + section heading over a hairline, then the content. */
export function Panel({ title, icon, meta, children, className, first = false }: PanelProps) {
  return (
    <section aria-label={title} data-testid={first ? 'card' : undefined} className={`bg-surface-container-lowest rounded-lg shadow-sm p-space-md flex flex-col gap-space-sm${className === undefined ? '' : ` ${className}`}`}>
      <div className="flex items-center justify-between gap-space-sm pb-space-sm border-b border-surface-container">
        <div className="flex items-center gap-space-xs min-w-0">
          {icon !== undefined && <Icon name={icon} size={20} className="text-primary" />}
          <h2 className={SECTION_HEADING}>{title}</h2>
        </div>
        {meta !== undefined && <div className="font-data-mono-sm text-data-mono-sm text-secondary shrink-0">{meta}</div>}
      </div>
      {children}
    </section>
  )
}

export interface TableSectionProps {
  readonly title: string
  readonly summary?: ReactNode
  /** Filters on the right of the head. */
  readonly controls?: ReactNode
  /** The DataTable. */
  readonly children: ReactNode
  readonly first?: boolean
}

/** sc_24 l.235 "Staged Import Batches" card: title-md heading and filters over the table. */
export function TableSection({ title, summary, controls, children, first = false }: TableSectionProps) {
  return (
    <section aria-label={title} data-testid={first ? 'card' : undefined} className="w-full bg-surface-container-lowest rounded-lg shadow-sm overflow-hidden">
      <div className="p-space-md flex flex-col md:flex-row md:items-end justify-between gap-space-sm border-b border-surface-container">
        <div>
          <h2 className="font-title-md text-title-md text-on-surface font-semibold tracking-tight">{title}</h2>
          {summary !== undefined && <p className="font-caption text-caption text-secondary">{summary}</p>}
        </div>
        {controls !== undefined && <div className="flex flex-wrap items-end gap-space-xs">{controls}</div>}
      </div>
      {children}
    </section>
  )
}

export interface FactRowProps {
  readonly label: string
  readonly detail?: ReactNode
  /** Absent for a row that only names something. */
  readonly value?: ReactNode
  readonly icon?: string
}

/** sc_24 l.160 pre-flight diagnostic row / sc_46 l.270 coverage item: label left, mono value right. */
export function FactRow({ label, detail, value, icon }: FactRowProps) {
  return (
    <li className="p-space-sm bg-surface-container-low rounded flex items-center justify-between gap-space-sm">
      <div className="flex items-center gap-space-sm min-w-0">
        {icon !== undefined && <Icon name={icon} size={20} className="text-primary shrink-0" />}
        <div className="flex flex-col min-w-0">
          <span className="font-body-sm text-body-sm font-medium text-on-surface">{label}</span>
          {detail !== undefined && <span className="font-caption text-caption text-secondary">{detail}</span>}
        </div>
      </div>
      {value !== undefined && <span className="font-data-mono-md text-data-mono-md font-semibold text-on-surface text-right tabular-nums">{value}</span>}
    </li>
  )
}

/** A list of FactRows. */
export function FactRows({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <ul aria-label={label} className="flex flex-col gap-space-sm">{children}</ul>
}

/** Term and value pairs (the sc_10 figure card facts). */
export function Facts({ items, label }: { readonly items: readonly (readonly [string, ReactNode])[]; readonly label?: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-space-md gap-y-1 font-body-sm text-body-sm">
      {items.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="text-secondary">{term}</dt>
          <dd className="text-on-surface break-words tabular-nums">{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

/** sc_25 l.33 / sc_10 l.38 scope strip: mono facts in one tinted row. */
export function ScopeStrip({ items }: { readonly items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="bg-surface-container-low rounded-lg p-space-sm shadow-sm flex flex-wrap items-center gap-x-space-md gap-y-space-xs font-data-mono-sm text-data-mono-sm">
      {items.map(([term, value]) => (
        // Term and value wrap as a pair and long values break anywhere, so the strip never widens a phone page (BUG-037).
        <div key={term} className="flex flex-wrap items-baseline gap-x-space-xs min-w-0">
          <dt className="text-secondary">{term}:</dt>
          <dd className="font-semibold text-on-surface min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
