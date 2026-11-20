'use client'

import { useEffect, useState, type ComponentProps } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { FormField, TEXTAREA_CLASS, TOUCH_INPUT_CLASS, type FieldLabelProps } from '../../components/form-field'
import { useSignOut } from '../../components/sign-out-button'
import { useResource, type Query, type Resource } from '../../lib/use-resource'
import { Failure } from './blocks'
import { errorText } from './format'
import { usePortal } from './shell'

// Client islands of the portal: 16 px fields with 44 px targets (guidelines §6.9), failures with Try again, paged
// lists with Show more, the wide-screen query and native download links.

// 16 px text so phones do not zoom into the field, 44 px tall (guidelines: portal inputs 40/44 px, 16 px).
const PORTAL_TEXTAREA = TEXTAREA_CLASS.replace('font-body-sm text-body-sm', 'font-body-lg text-body-lg')

/** The field label with the catalogue's "(optional)" (FormField's own marker is English). */
function useLabel(label: string, optional: boolean | undefined): string {
  const { words } = usePortal()
  return optional === true ? `${label} ${words.t('common.optional')}` : label
}

export type PortalInputProps = FieldLabelProps & Omit<ComponentProps<'input'>, 'id' | 'className'>

export function PortalInput({ label, helper, error, optional, id, ...input }: PortalInputProps) {
  return (
    <FormField label={useLabel(label, optional)} helper={helper} error={error} id={id}>
      {(control) => <input {...input} {...control} className={TOUCH_INPUT_CLASS} />}
    </FormField>
  )
}

export type PortalTextareaProps = FieldLabelProps & Omit<ComponentProps<'textarea'>, 'id' | 'className'>

export function PortalTextarea({ label, helper, error, optional, id, ...textarea }: PortalTextareaProps) {
  return (
    <FormField label={useLabel(label, optional)} helper={helper} error={error} id={id}>
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
    <FormField label={useLabel(label, optional)} helper={helper} error={error} id={id}>
      {(control) => (
        <select {...select} {...control} className={`${TOUCH_INPUT_CLASS} cursor-pointer`}>
          {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </FormField>
  )
}

/** A failed read in a client island, with Try again. */
export function PortalFailure({ error, onRetry, section = false }: { readonly error: unknown; readonly onRetry: () => void; readonly section?: boolean }) {
  const { t } = usePortal().words
  return <Failure error={error} t={t} section={section} retry={<Button variant={section ? 'secondary' : 'primary'} onClick={onRetry}>{t('common.try_again')}</Button>} />
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

/** The Show more control under a list, with its own error line; `label` names what is shown ("Show more customers"). */
export function ShowMore({ list, label }: { readonly list: Pick<ShownList<unknown>, 'hasMore' | 'busy' | 'moreError' | 'showMore'>; readonly label: string }) {
  const { t } = usePortal().words
  if (!list.hasMore && list.moreError === null) return null
  return (
    <div className="flex flex-col items-stretch gap-space-xs">
      {list.moreError !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{errorText(list.moreError, t)}</p>}
      {list.hasMore && <Button size="lg" loading={list.busy} onClick={list.showMore} aria-label={label}>{t('common.show_more')}</Button>}
    </div>
  )
}

/** sc_38 sign-out: ends the session and opens the portal sign-in of this company (the hook's own message is English). */
export function PortalSignOut() {
  const { me, words } = usePortal()
  const { busy, error, signOut } = useSignOut('portal', me.tenant?.slug ?? null)
  return (
    <div className="flex flex-col gap-space-xs">
      <Button size="lg" variant="destructive" icon="logout" loading={busy} onClick={signOut}>{words.t('more.sign_out')}</Button>
      {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{words.t('more.sign_out_failed')}</p>}
    </div>
  )
}
