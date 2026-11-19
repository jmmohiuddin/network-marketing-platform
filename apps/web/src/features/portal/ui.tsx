'use client'

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { FormField, TEXTAREA_CLASS, TOUCH_INPUT_CLASS, type FieldLabelProps } from '../../components/form-field'
import { ErrorState, NotAvailable } from '../../components/states'
import { isApiError } from '../../lib/api'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useResource, type Query, type Resource } from '../../lib/use-resource'

// Portal building blocks from the sc_37/sc_18 markup: cards, tiles, 16 px fields with 44 px targets (guidelines §6.9).

/** sc_37 section card. */
export const CARD = 'bg-surface-container-lowest rounded-xl p-space-md shadow-sm'
/** sc_37 inner tile. */
export const TILE = 'p-space-sm rounded-lg bg-surface-container-low'
export const SECTION_TITLE = 'font-section-heading text-section-heading text-on-surface'
export const PAGE_TITLE = 'font-title-lg-mobile text-title-lg-mobile text-on-surface tracking-tight'
export const CAPTION = 'font-caption text-caption text-on-surface-variant'
export const MONO = 'font-data-mono-sm text-data-mono-sm'
/** sc_37 module link card (whole card is the link, ≥ 44 px). */
export const LINK_CARD = 'flex items-center justify-between gap-space-sm p-space-md rounded-xl bg-surface-container-lowest shadow-sm hover:bg-surface-container-low transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
/** Text link with a 44 px touch height. */
export const TEXT_LINK = 'inline-flex items-center gap-0.5 min-h-11 font-body-sm text-body-sm text-primary font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'

/** Items shown before "Show more" (PLAN B5 §5). */
export const SHOW_FIRST = 7

// 16 px text so phones do not zoom into the field, 44 px tall (guidelines: portal inputs 40/44 px, 16 px).
const PORTAL_TEXTAREA = TEXTAREA_CLASS.replace('font-body-sm text-body-sm', 'font-body-lg text-body-lg')

export type PortalInputProps = FieldLabelProps & Omit<ComponentProps<'input'>, 'id' | 'className'>

export function PortalInput({ label, helper, error, optional, id, ...input }: PortalInputProps) {
  return (
    <FormField label={label} helper={helper} error={error} optional={optional} id={id}>
      {(control) => <input {...input} {...control} className={TOUCH_INPUT_CLASS} />}
    </FormField>
  )
}

export type PortalTextareaProps = FieldLabelProps & Omit<ComponentProps<'textarea'>, 'id' | 'className'>

export function PortalTextarea({ label, helper, error, optional, id, ...textarea }: PortalTextareaProps) {
  return (
    <FormField label={label} helper={helper} error={error} optional={optional} id={id}>
      {(control) => <textarea {...textarea} {...control} className={PORTAL_TEXTAREA} />}
    </FormField>
  )
}

export type PortalSelectProps = FieldLabelProps & Omit<ComponentProps<'select'>, 'id' | 'className'> & {
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly placeholder?: string
}

export function PortalSelect({ label, helper, error, optional, id, options, placeholder, ...select }: PortalSelectProps) {
  return (
    <FormField label={label} helper={helper} error={error} optional={optional} id={id}>
      {(control) => (
        <select {...select} {...control} className={`${TOUCH_INPUT_CLASS} cursor-pointer`}>
          {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </FormField>
  )
}

/** D-B5-06: team, customers, rank and new disputes are closed to a terminated participant. */
export function ClosedNotice() {
  return <Banner tone="info" title="Your account is closed">You can still read your statements, notifications and payment details.</Banner>
}

/** A failed read: 404/403 "Not found or not available to you", a closed account, else the error with Try again. */
export function PortalFailure({ error, onRetry, section = false }: { readonly error: unknown; readonly onRetry: () => void; readonly section?: boolean }) {
  if (isApiError(error, 'PARTICIPANT_TERMINATED')) return <ClosedNotice />
  if (isNotAvailable(error)) return <NotAvailable section={section} />
  return <ErrorState message={errorMessage(error)} onRetry={onRetry} section={section} />
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

export interface ShownList<R> {
  readonly first: Resource<unknown>
  /** First page plus every page added by Show more; null until the first page is in. */
  readonly rows: readonly R[] | null
  readonly hasMore: boolean
  readonly busy: boolean
  readonly moreError: unknown
  readonly showMore: () => void
}

const cursorOf = (meta: Readonly<Record<string, unknown>>): string | null => (typeof meta.next_cursor === 'string' ? meta.next_cursor : null)

/**
 * A cursor-paged list shown `limit` rows at a time with "Show more" (appends the next page). `rowsOf` picks the rows
 * from an answer whose data is not the list itself. Path or query changes start over.
 */
export function useShownList<D, R = D extends readonly (infer E)[] ? E : never>(
  path: string | null, query: Query, limit: number, rowsOf: (data: D) => readonly R[] = (data) => data as unknown as readonly R[],
): ShownList<R> & { readonly data: D | null } {
  const api = useApi()
  const first = useResource<D>(path, { ...query, limit })
  const key = `${path}?${JSON.stringify(query ?? {})}`
  const [more, setMore] = useState<{ readonly key: string; readonly rows: readonly R[]; readonly next: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [moreError, setMoreError] = useState<unknown>(null)
  useEffect(() => {
    setMore(null)
    setMoreError(null)
  }, [key, first.data])
  const added = more?.key === key ? more : null
  const next = added === null ? cursorOf(first.meta) : added.next
  async function showMore() {
    if (path === null || next === null) return
    setBusy(true)
    setMoreError(null)
    try {
      const answer = await api.get<D>(path, { query: { ...query, limit, cursor: next } })
      setMore({ key, rows: [...(added?.rows ?? []), ...rowsOf(answer.data)], next: cursorOf(answer.meta) })
    } catch (error) {
      setMoreError(error)
    } finally {
      setBusy(false)
    }
  }
  return {
    first, data: first.data, busy, moreError, showMore,
    rows: first.data === null ? null : [...rowsOf(first.data), ...(added?.rows ?? [])],
    hasMore: next !== null,
  }
}

/** The Show more control under a list, with its own error line. */
export function ShowMore({ list, label }: { readonly list: Pick<ShownList<unknown>, 'hasMore' | 'busy' | 'moreError' | 'showMore'>; readonly label: string }) {
  if (!list.hasMore && list.moreError === null) return null
  return (
    <div className="flex flex-col items-stretch gap-space-xs">
      {list.moreError !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{errorMessage(list.moreError)}</p>}
      {list.hasMore && <Button size="lg" loading={list.busy} onClick={list.showMore} aria-label={`Show more ${label}`}>Show more</Button>}
    </div>
  )
}

const WIDE = '(min-width: 1024px)'

/** Whether the viewport is 1024 px or wider (line explanation as a side panel); null until read, false without matchMedia. */
export function useWideScreen(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setWide(false)
      return
    }
    const query = window.matchMedia(WIDE)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}
