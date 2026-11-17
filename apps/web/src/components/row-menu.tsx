'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { FOCUS_RING } from './button'
import { Icon } from './icon'

export interface RowMenuItem {
  readonly label: string
  /** Accessible name naming the row ("Replay Oct 1, 2026 – Oct 31, 2026"); starts with the label. */
  readonly ariaLabel: string
  readonly icon: string
  readonly onSelect: () => void
}

const ITEM_HEIGHT = 32
const GAP = 4

/** Where the menu sits: under the trigger, or above it when the viewport has no room below. */
type Place = { readonly right: number } & ({ readonly top: number } | { readonly bottom: number })

/**
 * sc_01 l.~296 "More actions" (`more_vert`): a row's further actions in a menu laid over the page (portal, fixed),
 * so a table's sideways scroll box never clips it. Arrow keys, Home and End move; Escape closes and refocuses.
 */
export function RowMenu({ label, items, busy = false }: { readonly label: string; readonly items: readonly RowMenuItem[]; readonly busy?: boolean }) {
  const [place, setPlace] = useState<Place | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (place === null) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setPlace(null)
    }
    // A fixed menu would drift from its row: close on scroll or resize.
    const dismiss = () => setPlace(null)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [place])

  function toggle() {
    if (busy) return
    if (place !== null || trigger.current === null) return setPlace(null)
    const box = trigger.current.getBoundingClientRect()
    const right = window.innerWidth - box.right
    const room = box.bottom + GAP + items.length * ITEM_HEIGHT + 2 * GAP <= window.innerHeight
    setPlace(room ? { right, top: box.bottom + GAP } : { right, bottom: window.innerHeight - box.top + GAP })
  }

  function close() {
    setPlace(null)
    trigger.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const index = entries.indexOf(document.activeElement as HTMLElement)
    const next: Readonly<Record<string, number>> = { ArrowDown: (index + 1) % entries.length, ArrowUp: (index - 1 + entries.length) % entries.length, Home: 0, End: entries.length - 1 }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      setPlace(null)
    } else if (next[event.key] !== undefined) {
      event.preventDefault()
      entries[next[event.key]!]?.focus()
    }
  }

  return (
    <>
      <button ref={trigger} type="button" title="More actions" aria-label={label} aria-haspopup="menu" aria-expanded={place !== null} aria-controls={place === null ? undefined : id} aria-busy={busy || undefined}
        className={`relative h-7 w-7 shrink-0 text-secondary hover:text-on-surface hover:bg-surface-container rounded inline-flex items-center justify-center ${FOCUS_RING}`} onClick={toggle}>
        <Icon name={busy ? 'sync' : 'more_vert'} size={16} className={busy ? 'motion-safe:animate-spin' : undefined} />
      </button>
      {place !== null && createPortal(
        <div ref={menu} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown} style={place}
          className="fixed z-50 min-w-48 py-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" tabIndex={-1} aria-label={item.ariaLabel}
              className="w-full h-8 px-3 flex items-center gap-space-sm text-left font-body-sm text-body-sm text-on-surface whitespace-nowrap hover:bg-surface-container focus-visible:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              onClick={() => { close(); item.onSelect() }}>
              <Icon name={item.icon} size={16} className="text-secondary" />
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
