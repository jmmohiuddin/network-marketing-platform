'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react'
import { errorMessage } from '../lib/messages'
import { Banner } from './banner'
import { Button } from './button'
import { Icon } from './icon'

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

export interface ModalDialog {
  readonly ref: RefObject<HTMLDialogElement | null>
  readonly onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void
  readonly onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void
}

/** Focuses an element, making a heading or other non-control focusable by script only (tabindex -1). */
function focusElement(target: HTMLElement): void {
  if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus()
}

/**
 * Where focus goes when a dialog closes (BUG-028): the element matching the selector returnFocusTo when given (callers
 * whose action removes the opener's row pass the list heading), else the opener while it is still in the page, else
 * the page's <main> heading, so focus never falls back to the document body.
 */
function returnFocus(returnFocusTo: string | undefined, opener: HTMLElement | null): void {
  const requested = returnFocusTo === undefined ? null : document.querySelector<HTMLElement>(returnFocusTo)
  const target = requested ?? (opener?.isConnected === true ? opener : null) ?? document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main')
  if (target !== null) focusElement(target)
}

/**
 * Native <dialog> opened with showModal (top layer, page behind inert): focus trap, Escape calls onClose, focus
 * returns to the opener (or returnFocusTo, see returnFocus). The first element marked data-autofocus gets focus; else
 * the browser's first control. Shared by Modal and Drawer.
 */
export function useModalDialog(open: boolean, onClose: () => void, returnFocusTo?: string): ModalDialog {
  const ref = useRef<HTMLDialogElement>(null)
  const focusTarget = useRef(returnFocusTo)
  useLayoutEffect(() => {
    focusTarget.current = returnFocusTo
  })
  useEffect(() => {
    const dialog = ref.current
    if (!open || dialog === null) return
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      dialog.close()
      returnFocus(focusTarget.current, opener)
    }
  }, [open])
  return {
    ref,
    onKeyDown(event) {
      if (event.key === 'Tab') keepFocusInside(event)
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    },
    onCancel(event) {
      event.preventDefault() // the browser's own close request; the caller decides
      onClose()
    },
  }
}

export type ModalSize = 'sm' | 'md' | 'lg'

const WIDTH: Readonly<Record<ModalSize, string>> = { sm: 'sm:max-w-[400px]', md: 'sm:max-w-[560px]', lg: 'sm:max-w-[720px]' }
const TITLE: Readonly<Record<ModalSize, string>> = { sm: 'font-title-md text-title-md', md: 'font-title-md text-title-md', lg: 'font-title-lg text-title-lg' }

export interface ModalProps {
  readonly open: boolean
  /** Escape, the close button and the browser's cancel all call this; the caller sets open to false. */
  readonly onClose: () => void
  /** States the action ("Approve support session"). */
  readonly title: string
  /** 400 / 560 / 720 px (full-screen sheet on phones). */
  readonly size?: ModalSize
  /** Icon in the header tile (sc_02-modal). */
  readonly icon?: string
  /** One line under the title: the object the action is about. */
  readonly description?: ReactNode
  readonly children: ReactNode
  /** Buttons, right-aligned; at most one primary. */
  readonly footer?: ReactNode
  /** Selector of the element focused on close instead of the opener (the list heading when the action removes the row). */
  readonly returnFocusTo?: string
}

/**
 * Modal dialog (sc_02-modal l.53-262): scrim, 720/560/400 card, header with close, scrolling body, footer strip.
 * Never open a dialog from inside another dialog.
 */
export function Modal({ open, onClose, title, size = 'md', icon, description, children, footer, returnFocusTo }: ModalProps) {
  const dialog = useModalDialog(open, onClose, returnFocusTo)
  const titleId = useId()
  if (!open) return null
  return (
    <dialog
      ref={dialog.ref}
      aria-labelledby={titleId}
      aria-modal="true"
      onKeyDown={dialog.onKeyDown}
      onCancel={dialog.onCancel}
      className={`w-full max-w-none h-full max-h-none m-0 sm:m-auto sm:h-fit sm:max-h-[90vh] ${WIDTH[size]} p-0 bg-surface-container-lowest text-on-surface sm:rounded-xl shadow-2xl overflow-hidden backdrop:bg-[#0F172A]/70`}
    >
      <div className="flex flex-col h-full sm:h-auto">
        <div className="px-space-lg pt-space-lg pb-space-md flex items-start justify-between gap-space-md">
          <div className="flex items-start gap-space-md min-w-0">
            {icon !== undefined && (
              <span className="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
                <Icon name={icon} size={24} filled />
              </span>
            )}
            <div className="space-y-0.5 min-w-0">
              <h2 id={titleId} className={`${TITLE[size]} text-on-surface tracking-tight`}>{title}</h2>
              {description !== undefined && <p className="font-body-sm text-body-sm text-secondary">{description}</p>}
            </div>
          </div>
          <button type="button" className="p-1 rounded text-secondary hover:text-on-surface hover:bg-surface-container transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Close dialog" title="Close dialog" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className={`flex-1 px-space-lg pt-space-xs ${footer === undefined ? 'pb-space-lg' : 'pb-space-md'} space-y-space-md sm:max-h-[calc(90vh-140px)] overflow-y-auto font-body-md text-body-md`}>
          {children}
        </div>
        {footer !== undefined && (
          <div className="px-space-lg py-space-md bg-surface-container-low flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-space-sm">{footer}</div>
        )}
      </div>
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
  /**
   * Selector of the element focused after the action (not after Cancel): the list heading when the action removes
   * the opener's row (BUG-028), since the opener is gone once the list reloads.
   */
  readonly returnFocusTo?: string
}

/** Simple confirmation for irreversible but contained actions. */
export function ConfirmDialog({ open, title, consequence, confirmLabel, destructive = false, onConfirm, onCancel, returnFocusTo }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  useEffect(() => {
    if (!open) return
    setError(null)
    setCancelled(false)
  }, [open])
  function cancel() {
    setCancelled(true)
    onCancel()
  }
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
      <Button variant="secondary" onClick={cancel} disabled={busy}>Cancel</Button>
      <Button variant={destructive ? 'destructive-solid' : 'primary'} loading={busy} onClick={confirm}>{confirmLabel}</Button>
    </>
  )
  return (
    <Modal
      open={open} onClose={busy ? () => undefined : cancel} title={title} size="sm" icon={destructive ? 'warning' : undefined} footer={footer}
      returnFocusTo={cancelled ? undefined : returnFocusTo}
    >
      <p>{consequence}</p>
      {error !== null && <Banner tone="danger">{error}</Banner>}
    </Modal>
  )
}
