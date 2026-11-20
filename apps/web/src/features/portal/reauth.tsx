'use client'

import { useState, type ReactNode } from 'react'
import { PasswordStepUpModal, StepUpModal } from '../../components/step-up-modal'
import { stepUpWords } from './format'
import { usePortal } from './shell'

// D-B5-04 re-authentication before a sensitive change (bank details, tax profile, erasure): the account password
// (POST /v1/auth/sessions/current/reauth) or, for a user with an authenticator app, a fresh TOTP code (StepUpModal).
// The change is sent right after, inside the 10-minute step-up window.

export interface Reauth {
  /** Resolves true once re-authenticated, false when the user cancels. */
  readonly confirm: () => Promise<boolean>
  /** Render it once in the page. */
  readonly dialog: ReactNode
}

export function useReauth(): Reauth {
  const { me, words: { t } } = usePortal()
  const [resolve, setResolve] = useState<((done: boolean) => void) | null>(null)
  function finish(done: boolean) {
    resolve?.(done)
    setResolve(null)
  }
  const confirm = () => new Promise<boolean>((settle) => setResolve(() => settle))
  const open = resolve !== null
  const words = stepUpWords(t)
  const dialog = me.mfa.enrolled ? <StepUpModal open={open} onDone={finish} words={words} /> : <PasswordStepUpModal open={open} onDone={finish} words={words} />
  return { confirm, dialog }
}
