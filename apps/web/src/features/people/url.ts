'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * The page's query parameters and a setter that merges a patch into them (null or '' removes a key), so filters, tabs
 * and the explorer's position live in the URL (UI_UX §4.7).
 */
export function useQueryParams(): readonly [URLSearchParams, (patch: Readonly<Record<string, string | null>>) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const update = (patch: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  return [new URLSearchParams(params), update] as const
}
