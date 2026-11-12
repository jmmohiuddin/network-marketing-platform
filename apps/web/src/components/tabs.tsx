'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem {
  readonly id: string
  readonly label: string
}

export interface TabsProps {
  /** Names the tab list for assistive technology. */
  readonly label: string
  /** Prefix for tab and panel ids; pass the same value to TabPanel. */
  readonly idPrefix: string
  readonly tabs: readonly TabItem[]
  readonly selected: string
  /** Keep the selection in the URL (?tab=...), so links reproduce the view (UX-03 §6). */
  readonly onSelect: (id: string) => void
}

function targetIndex(key: string, index: number, count: number): number | null {
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Peer views of one object (never steps). APG tabs: arrow keys move and select, one tab stop. */
export function Tabs({ label, idPrefix, tabs, selected, onSelect }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = targetIndex(event.key, index, tabs.length)
    const tab = next === null ? undefined : tabs[next]
    if (next === null || tab === undefined) return
    event.preventDefault()
    refs.current[next]?.focus()
    onSelect(tab.id)
  }
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const isSelected = tab.id === selected
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={isSelected}
            // Only the selected tab's panel is rendered, so only that tab may point at it.
            aria-controls={isSelected ? `${idPrefix}-panel-${tab.id}` : undefined}
            tabIndex={isSelected ? 0 : -1}
            className="tab"
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelProps {
  readonly idPrefix: string
  readonly tabId: string
  readonly children: ReactNode
}

/** The selected tab's content. */
export function TabPanel({ idPrefix, tabId, children }: TabPanelProps) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${tabId}`} aria-labelledby={`${idPrefix}-tab-${tabId}`} tabIndex={0} className="tab-panel">
      {children}
    </div>
  )
}
