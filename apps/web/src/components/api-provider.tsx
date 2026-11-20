'use client'

import { createContext, lazy, Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createApiClient, type ApiClient } from '../lib/api'
import { leavePage } from '../lib/leave-page'
import { realmOf, returnTarget } from '../lib/navigation'
import { leaveSupportSession, SUPPORT_SESSIONS_PATH, supportSessionFor } from '../lib/support-session'
import type { StepUpWords } from './step-up-modal'

// Loaded at the first step-up only: the dialogs (TOTP enrolment, QR code) are ~15 KB gzip every page would carry (BUG-132).
const StepUpModal = lazy(() => import('./step-up-modal').then((module) => ({ default: module.StepUpModal })))
const PasswordStepUpModal = lazy(() => import('./step-up-modal').then((module) => ({ default: module.PasswordStepUpModal })))

const ApiContext = createContext<ApiClient | null>(null)

/** The API client of the page (see lib/api.ts for its error handling). */
export function useApi(): ApiClient {
  const api = use(ApiContext)
  if (api === null) throw new Error('useApi is only available inside ApiProvider')
  return api
}

/** What step-up set aside: the open dialogs it hid and the control that started the action. */
interface SetAside {
  readonly dialogs: readonly HTMLDialogElement[]
  readonly focus: HTMLElement | null
}

/** Hides every open dialog (an action dialog, a drawer), so the step-up prompt is the only dialog[open] (BUG-045). */
function setAside(): SetAside {
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
  const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  for (const dialog of dialogs) dialog.close()
  return { dialogs, focus }
}

/** Shows the hidden dialogs again (those still in the page). */
function restore(aside: SetAside): void {
  for (const dialog of aside.dialogs) {
    if (dialog.isConnected && !dialog.open) dialog.showModal()
  }
}

/**
 * Provides the API client: auth errors leave the page (leavePage), STEP_UP_REQUIRED opens StepUpModal (on a portal page
 * the password re-authentication, D-B5-04: it works for every portal session, with or without an authenticator app).
 * Requests that need step-up at the same time share one dialog. Step-up never stacks: an open action dialog is hidden
 * while the code is asked for, shown again afterwards, and focus goes back to the control that started the action
 * (the action's primary button) while the action is retried with the same Idempotency-Key.
 */
export interface ApiProviderProps {
  readonly children: ReactNode
  /** The portal re-authentication's words in the page's language (the root layout, from the portal catalogue). */
  readonly portalStepUpWords?: StepUpWords
}

export function ApiProvider({ children, portalStepUpWords }: ApiProviderProps) {
  const [resolveStepUp, setResolveStepUp] = useState<((verified: boolean) => void) | null>(null)
  const [portal, setPortal] = useState(false)
  // Mounted from the first step-up on, so later prompts open and close the same dialog (its focus return included).
  const [asked, setAsked] = useState(false)
  const pending = useRef<Promise<boolean> | null>(null)
  const aside = useRef<SetAside | null>(null)
  const closed = useRef<SetAside | null>(null)
  const api = useMemo(
    () => createApiClient({
      navigate: leavePage,
      currentPath: () => `${window.location.pathname}${window.location.search}`,
      stepUp: () => {
        if (pending.current === null) {
          aside.current = setAside()
          // An auth page (portal TOTP enrolment, /signin/enrol?next=/portal/…) asks as the realm it returns to.
          setPortal(realmOf(returnTarget(`${window.location.pathname}${window.location.search}`)) === 'portal')
          setAsked(true)
          pending.current = new Promise<boolean>((resolve) => setResolveStepUp(() => resolve))
        }
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
    closed.current = aside.current
    aside.current = null
    resolveStepUp?.(verified)
    pending.current = null
    setResolveStepUp(null)
  }, [resolveStepUp])
  // Once the step-up dialog has closed (its own focus return ran first): the hidden dialogs come back, and focus goes
  // to the action's control, or, when the action's answer already replaced it, to the restored dialog's
  // data-autofocus element (BUG-073), so focus never stays on the page body behind an open dialog.
  useEffect(() => {
    const done = closed.current
    if (resolveStepUp !== null || done === null) return
    closed.current = null
    restore(done)
    const target = done.focus?.isConnected === true ? done.focus : done.dialogs.find((dialog) => dialog.open)?.querySelector<HTMLElement>('[data-autofocus]')
    target?.focus()
  }, [resolveStepUp])
  return (
    <ApiContext value={api}>
      {children}
      {asked && (
        <Suspense fallback={null}>
          {portal ? <PasswordStepUpModal open={resolveStepUp !== null} onDone={finish} words={portalStepUpWords} /> : <StepUpModal open={resolveStepUp !== null} onDone={finish} />}
        </Suspense>
      )}
    </ApiContext>
  )
}
