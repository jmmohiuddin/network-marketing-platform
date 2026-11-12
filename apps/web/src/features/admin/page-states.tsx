'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ErrorState, NotAvailable } from '../../components/states'
import type { TabItem } from '../../components/tabs'
import { errorMessage, isNotAvailable } from '../../lib/messages'

/**
 * A page or section that failed to load: "Not found or not available to you" for 403/404, else the error with
 * Retry. section: inside a page with its own h1 and primary action (h2, secondary button).
 */
export function LoadFailure({ error, onRetry, section = false }: { readonly error: unknown; readonly onRetry: () => void; readonly section?: boolean }) {
  return isNotAvailable(error) ? <NotAvailable section={section} /> : <ErrorState message={errorMessage(error)} onRetry={onRetry} section={section} />
}

/** The selected tab, kept in the URL as ?tab= (UI-04 Tabs); the first tab when absent or unknown. */
export function useTabParam(tabs: readonly TabItem[]): readonly [string, (id: string) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const requested = params.get('tab')
  const selected = tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? ''
  return [selected, (id: string) => router.replace(`${pathname}?tab=${encodeURIComponent(id)}`)] as const
}
