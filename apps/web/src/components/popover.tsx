'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { FOCUS_RING } from './button'
import { Icon } from './icon'

/**
 * UI_UX Popover (the (i) definition of a figure): a click toggles it, keyboard focus opens it (the Enter that follows
 * keeps it open, the next one toggles); Escape closes it and
 * returns focus to its button, a pointer down outside or focus leaving closes it (a click does not focus a button in
 * Safari or Firefox on macOS, so blur alone cannot). The button is described by the panel, so a screen reader reads
 * the text on focus. Shown in the flow under the button, so a card's overflow never clips it and it never widens the page.
 */
export function Popover({ label, text, children }: {
  /** Accessible name of the button ("Definition of Net sales"). */
  readonly label: string
  /** Visible button text. */
  readonly text: string
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pointer = useRef(false)
  // Opened by keyboard focus: the Enter/Space click that follows keeps it open instead of toggling it shut (BUG-123).
  const focusOpened = useRef(false)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      focusOpened.current = false
      button.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.current?.contains(event.target)) return
      setOpen(false)
      focusOpened.current = false
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])
  return (
    <div ref={wrapper} className="flex flex-col gap-space-xxs">
      <button ref={button} type="button" aria-expanded={open} aria-controls={id} aria-describedby={id} aria-label={label} title={label}
        className={`self-start inline-flex items-center gap-1 rounded font-caption text-caption text-secondary hover:text-primary ${FOCUS_RING}`}
        onPointerDown={() => { pointer.current = true }}
        onFocus={() => {
          if (!pointer.current) {
            setOpen(true)
            focusOpened.current = true
          }
          pointer.current = false
        }}
        onBlur={() => {
          setOpen(false)
          focusOpened.current = false
        }}
        onClick={() => {
          if (focusOpened.current) focusOpened.current = false
          else setOpen((current) => !current)
        }}>
        <Icon name="info" size={14} />
        {text}
      </button>
      <div id={id} role="note" hidden={!open} className="p-space-sm rounded bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">
        {children}
      </div>
    </div>
  )
}
