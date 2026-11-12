'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'
import { errorMessage } from '../lib/messages'
import { Banner } from './banner'
import { Button } from './button'

export type DialogSize = 'sm' | 'md' | 'lg'

export interface DialogProps {
  readonly open: boolean
  /** Escape, the close button and the backdrop's cancel all call this; the caller sets open to false. */
  readonly onClose: () => void
  /** States the action ("Approve support session"). */
  readonly title: string
  /** 400 / 560 / 720 px (full-screen sheet on phones). */
  readonly size?: DialogSize
  readonly children: ReactNode
  /** Buttons, right-aligned; at most one primary. */
  readonly footer?: ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Tab and Shift+Tab cycle inside the dialog (APG dialog pattern), also where the browser would leave it.
function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
  const first = items[0]
  const last = items.at(-1)
  if (first === undefined || last === undefined) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Modal dialog on the native <dialog> (top layer, page behind inert), with a focus trap, Escape to close and
 * focus returned to the opener. The first element marked data-autofocus gets focus; else the first control.
 * Never open a dialog from inside another dialog.
 */
export function Dialog({ open, onClose, title, size = 'md', children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!open || dialog === null) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      dialog.close()
      opener?.focus()
    }
  }, [open])
  if (!open) return null
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Tab') keepFocusInside(event)
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }
  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault() // the browser's own close request; the caller decides
    onClose()
  }
  return (
    <dialog ref={ref} className={`dialog dialog-${size}`} aria-labelledby={titleId} onKeyDown={onKeyDown} onCancel={onCancel}>
      <div className="dialog-header">
        <h2 id={titleId} className="dialog-title">{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" title="Close dialog" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer !== undefined && <div className="dialog-footer">{footer}</div>}
    </dialog>
  )
}

export interface ConfirmDialogProps {
  readonly open: boolean
  /** Action + object: "Deactivate user". Never "Are you sure?". */
  readonly title: string
  /** One sentence: what happens and what cannot be undone. */
  readonly consequence: ReactNode
  /** Names the action again: "Deactivate user". */
  readonly confirmLabel: string
  /** Irreversible action: solid danger confirm button (the only place it is solid). */
  readonly destructive?: boolean
  /** A rejected promise keeps the dialog open with the error; the caller closes it on success. */
  readonly onConfirm: () => Promise<void>
  readonly onCancel: () => void
}

/** Simple confirmation (UX-05 §6.5) for irreversible but contained actions. */
export function ConfirmDialog({ open, title, consequence, confirmLabel, destructive = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) setError(null)
  }, [open])
  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  const footer = (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button variant={destructive ? 'destructive-solid' : 'primary'} loading={busy} onClick={confirm}>{confirmLabel}</Button>
    </>
  )
  return (
    <Dialog open={open} onClose={busy ? () => undefined : onCancel} title={title} size="sm" footer={footer}>
      <p>{consequence}</p>
      {error !== null && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}
