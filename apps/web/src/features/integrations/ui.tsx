'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Checkbox, LABEL_CLASS } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { Modal } from '../../components/modal'

// sc_13 connector card surface (l.174), exactly as in Stitch.
export const CARD = 'bg-surface-container-lowest p-space-md rounded-lg shadow-sm space-y-space-sm hover:shadow-md transition-shadow'
export const SECTION_HEADING = 'font-section-heading text-section-heading text-on-surface'

/** sc_13 connector header tile (l.177). */
export function IconTile({ name }: { readonly name: string }) {
  return (
    <span className="w-10 h-10 rounded bg-surface-container-low flex items-center justify-center text-primary shrink-0">
      <Icon name={name} size={24} />
    </span>
  )
}

/**
 * After an action whose dialog returns focus to a button that the action then removes (Revoke, Disable), focus the
 * section heading instead, which stays while the list reloads (BUG-028 rule). Call the returned function on success.
 */
export function useFocusAfterAction(): (selector: string) => void {
  const pending = useRef<string | null>(null)
  useEffect(() => {
    const selector = pending.current
    if (selector === null) return
    pending.current = null
    const target = document.querySelector<HTMLElement>(selector)
    if (target === null) return
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1
    target.focus()
  })
  return (selector) => {
    pending.current = selector
  }
}

export interface OneTimeSecretDialogProps {
  readonly title: string
  /** What the value is: "API key", "Signing secret". */
  readonly label: string
  /** Absent when the response was a replay (token_shown / secret_shown false): it was shown once already. */
  readonly value: string | undefined
  /** What to do when the value was not stored. */
  readonly lostHint: string
  readonly children?: ReactNode
  readonly onClose: () => void
}

/** The label for use mid-sentence: "Signing secret" becomes "signing secret", "API key" stays. */
export function nounOf(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label
}

/**
 * The credential exactly as the API checks it: no spaces are inserted (SecretText groups for typing, which would break a
 * token or a signing secret copied by hand). Copy gets initial focus, so a stray Enter copies instead of closing.
 */
function CredentialText({ label, value }: { readonly label: string; readonly value: string }) {
  const labelId = useId()
  const noun = nounOf(label)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }
  return (
    <div className="flex flex-col gap-space-xs" data-testid="one-time-secret">
      <span id={labelId} className={LABEL_CLASS}>{label}</span>
      <div className="flex flex-wrap items-center gap-space-sm">
        <code className="px-space-sm py-space-xs rounded bg-surface-container-low font-data-mono-md text-data-mono-md text-on-surface select-all break-all" aria-labelledby={labelId}>{value}</code>
        <Button icon="content_copy" data-autofocus onClick={copy}>Copy {noun}</Button>
      </div>
      <p className="font-caption text-caption text-secondary" role="status">
        {status === 'copied' && `The ${noun} was copied.`}
        {status === 'failed' && `The ${noun} could not be copied. Select it and copy it.`}
      </p>
    </div>
  )
}

/**
 * A credential shown exactly once (D-B1-06): only its hash or sealed form is stored, so closing this dialog loses it
 * for good. Done, Escape and the close button ask for the "stored it" confirmation first. A replayed request never
 * carries the value again, so nothing is left to lose.
 */
export function OneTimeSecretDialog({ title, label, value, lostHint, children, onClose }: OneTimeSecretDialogProps) {
  const storedId = useId()
  const noun = nounOf(label)
  const [stored, setStored] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  function close() {
    if (value === undefined || stored) {
      onClose()
      return
    }
    setUnconfirmed(true)
    document.getElementById(storedId)?.focus()
  }
  return (
    <Modal open onClose={close} title={title} icon="key" footer={<Button variant="primary" onClick={close}>Done</Button>}>
      {children}
      {value === undefined
        ? <Banner tone="warning" title={`The ${noun} cannot be shown again`}>It was shown in an earlier answer to this same request. {lostHint}</Banner>
        : (
          <>
            <Banner tone="warning" title={`Copy the ${noun} now`}>This is the only time it is shown. Store it in your secret manager before you close this dialog. {lostHint}</Banner>
            <CredentialText label={label} value={value} />
            <Checkbox
              id={storedId} label={`I have stored the ${noun}`} checked={stored}
              error={unconfirmed && !stored ? `Confirm that you stored the ${noun}; it cannot be shown again after you close this dialog.` : undefined}
              onChange={(event) => setStored(event.target.checked)}
            />
          </>
        )}
    </Modal>
  )
}
