'use client'

import { useState } from 'react'
import type { TablePagination } from '../../components/table'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage } from '../../lib/messages'
import { useResource, type Query } from '../../lib/use-resource'

export interface PagedList<T> {
  readonly rows: readonly T[]
  readonly loading: boolean
  readonly error: unknown
  readonly reload: () => void
  readonly pagination: TablePagination
}

/**
 * One page of a cursor-paged collection (meta.next_cursor) with Previous/Next. Changing filters must start again
 * at the first page: give the component that calls this a React key made from the filters.
 */
export function usePagedList<T>(path: string, query: Query = {}): PagedList<T> {
  const pages = useCursorPages()
  const resource = useResource<T[]>(path, { ...query, cursor: pages.cursor })
  const nextCursor = typeof resource.meta.next_cursor === 'string' ? resource.meta.next_cursor : null
  return {
    rows: resource.data ?? [],
    loading: resource.loading,
    error: resource.error,
    reload: resource.reload,
    pagination: {
      hasPrevious: pages.hasPrevious,
      hasNext: nextCursor !== null,
      onPrevious: pages.previous,
      onNext: () => {
        if (nextCursor !== null) pages.next(nextCursor)
      },
    },
  }
}

/** The Table error prop of a failed load. */
export function tableError(list: { readonly error: unknown; readonly reload: () => void }): { message: string; onRetry: () => void } | null {
  return list.error === null ? null : { message: errorMessage(list.error), onRetry: list.reload }
}

/**
 * One Idempotency-Key per mount, for a confirmation with no fields (its request cannot change between attempts).
 * Forms whose values can change take the key FormDialog gives them, which changes with the values.
 */
export function useIdempotencyKey(): string {
  const [key] = useState(() => crypto.randomUUID())
  return key
}
