'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { FOCUS_RING } from './button'

export interface TabItem {
  readonly id: string
  readonly label: string
  /** Count suffix from the response meta ("Pending 3"). */
  readonly count?: number
}

export interface TabsProps {
  /** Names the tab list for assistive technology. */
  readonly label: string
  /** Prefix for tab and panel ids; pass the same value to TabPanel. */
  readonly idPrefix: string
  readonly tabs: readonly TabItem[]
  readonly selected: string
  /** Keep the selection in the URL (?tab=...), so links reproduce the view. */
  readonly onSelect: (id: string) => void
}

/** Arrow keys wrap, Home/End jump: the APG tabs keyboard model (also used by SegmentedControl). */
export function targetIndex(key: string, index: number, count: number): number | null {
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

const TAB = `px-3 py-2 text-body-sm font-body-sm rounded-t whitespace-nowrap transition-colors ${FOCUS_RING}`
const SELECTED = 'font-semibold text-primary border-b-2 border-primary bg-surface-container-lowest'
const IDLE = 'font-medium text-secondary hover:text-on-surface border-b-2 border-transparent'

/** Page tabs (sc_01 l.214): peer views of one object, never steps. One tab stop; arrow keys move and select. */
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
    // Wraps instead of scrolling: a tab out of view gave no sign that it existed (BUG-034).
    <div className="flex flex-wrap items-center gap-1 px-space-md pt-space-sm bg-surface-container-low rounded-t-xl" role="tablist" aria-label={label}>
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
            className={`${TAB} ${isSelected ? SELECTED : IDLE}`}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
            {tab.count !== undefined && ' '}
            {tab.count !== undefined && (
              <span className="ml-1 inline-flex items-center px-1.5 rounded-full text-[10px] font-semibold bg-secondary-container text-on-secondary-container">{tab.count}</span>
            )}
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
    <div role="tabpanel" id={`${idPrefix}-panel-${tabId}`} aria-labelledby={`${idPrefix}-tab-${tabId}`} tabIndex={0} className={`pt-space-md rounded ${FOCUS_RING}`}>
      {children}
    </div>
  )
}
