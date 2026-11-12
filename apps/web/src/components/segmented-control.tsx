'use client'

import { useId, useRef, type KeyboardEvent } from 'react'
import { FOCUS_RING } from './button'
import { Icon } from './icon'
import { targetIndex } from './tabs'

export interface SegmentOption {
  readonly value: string
  readonly label: string
  readonly icon?: string
}

export interface SegmentedControlProps {
  /** Names the choice ("Tree kind"). */
  readonly label: string
  /** 2 to 4 options. */
  readonly options: readonly SegmentOption[]
  readonly value: string
  readonly onChange: (value: string) => void
}

const ITEM = `flex-1 px-2.5 py-1 text-center font-body-sm text-body-sm rounded flex items-center justify-center gap-1 transition-all ${FOCUS_RING}`

/** sc_07 l.50 segmented control: a radio group of buttons (arrow keys move and select, one tab stop). */
export function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
  const labelId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = targetIndex(event.key === 'ArrowDown' ? 'ArrowRight' : event.key === 'ArrowUp' ? 'ArrowLeft' : event.key, index, options.length)
    const option = next === null ? undefined : options[next]
    if (next === null || option === undefined) return
    event.preventDefault()
    refs.current[next]?.focus()
    onChange(option.value)
  }
  return (
    <div className="flex flex-col">
      <span id={labelId} className="font-caption text-caption text-secondary uppercase font-semibold mb-1">{label}</span>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex h-8 bg-surface-container-lowest p-0.5 rounded shadow-sm">
        {options.map((option, index) => {
          const checked = option.value === value
          return (
            <button
              key={option.value}
              ref={(element) => {
                refs.current[index] = element
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className={`${ITEM} ${checked ? 'font-semibold bg-primary text-on-primary shadow-sm' : 'font-medium text-secondary hover:text-on-surface'}`}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {option.icon !== undefined && <Icon name={option.icon} size={14} />}
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
