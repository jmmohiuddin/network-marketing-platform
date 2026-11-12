'use client'

import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../components/api-provider'
import type { RequestOptions } from './api'

/** How often a page asks again while something it shows is still being computed. */
export const POLL_INTERVAL_MS = 3000

export interface Resource<T> {
  /** The answer for the current path and query; null while loading or after an error. */
  readonly data: T | null
  readonly meta: Readonly<Record<string, unknown>>
  readonly error: unknown
  readonly loading: boolean
  /** Loads again from scratch (Retry, or after a change made on the page). */
  readonly reload: () => void
}

interface Answer<T> {
  readonly key: string
  readonly data: T | null
  readonly meta: Readonly<Record<string, unknown>>
  readonly error: unknown
}

/**
 * GET path?query, again whenever path or query change; nothing while path is null. An answer counts only for the
 * request it answers (a slow earlier answer never replaces a newer one; an aborted request is ignored). While
 * pollWhile(data) holds, it asks again every POLL_INTERVAL_MS and keeps showing the last answer meanwhile.
 */
export type Query = RequestOptions['query']

export function useResource<T>(path: string | null, query?: Query, pollWhile?: (data: T) => boolean): Resource<T> {
  const api = useApi()
  const key = path === null ? null : `${path}?${JSON.stringify(query ?? {})}`
  const [answer, setAnswer] = useState<Answer<T> | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (path === null || key === null) return
    const controller = new AbortController()
    api.get<T>(path, { query, signal: controller.signal }).then(
      ({ data, meta }) => setAnswer({ key, data, meta, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setAnswer({ key, data: null, meta: {}, error })
      },
    )
    return () => controller.abort()
  }, [api, key, round]) // key stands for path and query

  const current = key !== null && answer?.key === key ? answer : null
  const polling = current?.data != null && pollWhile !== undefined && pollWhile(current.data)
  useEffect(() => {
    if (!polling) return
    const timer = setTimeout(() => setRound((value) => value + 1), POLL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [polling, current])

  const reload = useCallback(() => {
    setAnswer(null)
    setRound((value) => value + 1)
  }, [])

  return {
    data: current?.data ?? null,
    meta: current?.meta ?? {},
    error: current?.error ?? null,
    loading: key !== null && current === null,
    reload,
  }
}
