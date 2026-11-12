'use client'

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createApiClient, type ApiClient } from '../lib/api'
import { leavePage } from '../lib/leave-page'
import { leaveSupportSession, SUPPORT_SESSIONS_PATH, supportSessionFor } from '../lib/support-session'
import { StepUpModal } from './step-up-modal'

const ApiContext = createContext<ApiClient | null>(null)

/** The API client of the page (see lib/api.ts for its error handling). */
export function useApi(): ApiClient {
  const api = use(ApiContext)
  if (api === null) throw new Error('useApi is only available inside ApiProvider')
  return api
}

/**
 * Provides the API client: auth errors leave the page (leavePage), STEP_UP_REQUIRED opens StepUpModal.
 * Requests that need step-up at the same time share one dialog.
 */
export function ApiProvider({ children }: { readonly children: ReactNode }) {
  const [resolveStepUp, setResolveStepUp] = useState<((verified: boolean) => void) | null>(null)
  const pending = useRef<Promise<boolean> | null>(null)
  const api = useMemo(
    () => createApiClient({
      navigate: leavePage,
      currentPath: () => `${window.location.pathname}${window.location.search}`,
      stepUp: () => {
        pending.current ??= new Promise<boolean>((resolve) => setResolveStepUp(() => resolve))
        return pending.current
      },
      supportSession: () => supportSessionFor(window.location.pathname),
      supportSessionClosed: () => {
        leaveSupportSession()
        leavePage(`${SUPPORT_SESSIONS_PATH}?reason=session_closed`)
      },
    }),
    [],
  )
  const finish = useCallback((verified: boolean) => {
    resolveStepUp?.(verified)
    pending.current = null
    setResolveStepUp(null)
  }, [resolveStepUp])
  return (
    <ApiContext value={api}>
      {children}
      <StepUpModal open={resolveStepUp !== null} onDone={finish} />
    </ApiContext>
  )
}
