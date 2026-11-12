import type { ReactNode } from 'react'
import { LABEL_CLASS } from '../../components/form-field'
import { Icon } from '../../components/icon'

// Stitch classes shared by the admin and vendor console screens (sc_14, sc_28, sc_29, sc_30, sc_39).

/** Secondary explanatory text. */
export const NOTE = 'font-body-sm text-body-sm text-secondary'
/** Ids, hashes, codes. */
export const MONO = 'font-data-mono-sm text-data-mono-sm'
/** A form laid out in one column. */
export const FORM = 'flex flex-col gap-space-md'
/** Buttons at the end of a form or card. */
export const ACTIONS = 'flex flex-wrap items-center justify-end gap-space-sm'
/** Buttons in a table row. */
export const ROW_ACTIONS = 'flex flex-wrap items-center justify-end gap-space-xs'
/** Two fields side by side from sm. */
export const PAIR = 'grid grid-cols-1 sm:grid-cols-2 gap-space-md'
/** A repeated group of fields (sc_29 policy row surface). */
export const GROUP = 'flex flex-col gap-space-md p-space-md rounded bg-surface-container-low'
/** Checkbox lists. */
export const CHECK_GRID = 'grid grid-cols-1 sm:grid-cols-2 gap-space-sm'
export const FIELDSET = 'flex flex-col gap-space-sm min-w-0'
export const LEGEND = `${LABEL_CLASS} mb-space-xs`
/** sc_29 section card. */
export const SECTION_CARD = 'bg-surface-container-lowest rounded p-space-lg shadow-sm flex flex-col gap-space-md'
/** sc_14 / sc_39 metadata grid (label over value). */
export const META_GRID = 'grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md rounded bg-surface-container-low'
export const META_LABEL = 'font-caption text-caption text-on-surface-variant uppercase font-semibold'
export const META_VALUE = 'font-body-md text-body-md text-on-surface font-semibold break-words'
/** sc_28 role chip. */
export const CHIP = 'inline-flex items-center px-space-xs py-0.5 rounded text-[11px] font-caption font-semibold uppercase tracking-wider bg-surface-container text-on-surface'
/** sc_30 raw payload block. */
export const CODE_BLOCK = 'max-h-64 overflow-auto p-space-sm rounded bg-surface-container-low font-data-mono-sm text-data-mono-sm text-on-surface whitespace-pre-wrap break-all'

export interface NoticeCardProps {
  readonly icon: string
  readonly title: string
  /** h2 where the screen's section headings are section-heading size (sc_28, sc_30, sc_39); p elsewhere. */
  readonly heading?: 'h2' | 'p'
  readonly children: ReactNode
}

/**
 * sc_28 / sc_14 statutory notice card: left accent bar, icon tile, title, explanation. The first card of the page, so
 * it carries the visual harness's card test id. Only product rules go here, never certification claims.
 */
export function NoticeCard({ icon, title, heading = 'p', children }: NoticeCardProps) {
  const Title = heading
  return (
    <div data-testid="card" className="rounded bg-surface-container-lowest p-space-md shadow-sm relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
      <div className="flex items-start gap-space-md pl-space-xs">
        <div className="w-8 h-8 rounded bg-surface-container flex items-center justify-center shrink-0 text-primary">
          <Icon name={icon} size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <Title className="font-section-heading text-section-heading text-on-surface">{title}</Title>
          <div className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Label/value pairs (sc_14 requester grid look). */
export function MetaGrid({ items }: { readonly items: readonly { readonly label: string; readonly value: ReactNode }[] }) {
  return (
    <dl className={META_GRID}>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 min-w-0">
          <dt className={META_LABEL}>{item.label}</dt>
          <dd className={META_VALUE}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** sc_14 section heading: numbered tile + title-lg h2, optional note on the right. */
export function NumberedHeading({ id, number, title, aside }: { readonly id: string; readonly number: number; readonly title: string; readonly aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-space-sm">
      <div className="flex items-center gap-space-sm">
        <span aria-hidden="true" className="flex items-center justify-center w-6 h-6 rounded bg-primary text-on-primary font-caption text-caption font-bold">{number}</span>
        <h2 id={id} className="font-title-lg text-title-lg text-on-surface tracking-tight">{title}</h2>
      </div>
      {aside !== undefined && <span className="font-caption text-caption text-on-surface-variant font-medium">{aside}</span>}
    </div>
  )
}

/** sc_29 section card header: icon + title-md h2, description below. */
export function SectionTitle({ id, icon, title, action }: { readonly id: string; readonly icon: string; readonly title: string; readonly action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-space-sm">
      <div className="flex items-center gap-space-xs">
        <Icon name={icon} size={20} className="text-primary" />
        <h2 id={id} className="font-title-md text-title-md text-on-surface font-semibold">{title}</h2>
      </div>
      {action}
    </div>
  )
}
