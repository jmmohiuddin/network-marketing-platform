'use client'

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createApiClient, type ApiClient } from '../lib/api'
import { leavePage } from '../lib/leave-page'
import { leaveSupportSession, SUPPORT_SESSIONS_PATH, supportSessionFor } from '../lib/support-session'
import { Button } from './button'
import { CodeForm } from './code-form'
import { Dialog } from './dialog'

const ApiContext = createContext<ApiClient | null>(null)

/** The API client of the page (see lib/api.ts for its error handling). */
export function useApi(): ApiClient {
  const api = use(ApiContext)
  if (api === null) throw new Error('useApi is only available inside ApiProvider')
  return api
}

export interface StepUpDialogProps {
  readonly open: boolean
  /** true: the code was verified; false: the user cancelled. */
  readonly onDone: (verified: boolean) => void
}

/** Asks for a fresh second factor before a sensitive action (SEC-20); the action is then retried once. */
export function StepUpDialog({ open, onDone }: StepUpDialogProps) {
  return (
    <Dialog open={open} onClose={() => onDone(false)} title="Confirm with your authenticator app" size="sm">
      <p>This action needs a fresh code from your authenticator app. Nothing has been changed yet.</p>
      <CodeForm
        idPrefix="step-up"
        endpoint="/v1/auth/sessions/current/step-up"
        submitLabel="Confirm and continue"
        onVerified={() => onDone(true)}
        secondaryAction={<Button onClick={() => onDone(false)}>Cancel</Button>}
      />
    </Dialog>
  )
}

/**
 * Provides the API client: auth errors leave the page (leavePage), STEP_UP_REQUIRED opens the step-up dialog.
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
      <StepUpDialog open={resolveStepUp !== null} onDone={finish} />
    </ApiContext>
  )
}
