'use client'

import { useId } from 'react'

export interface SwitchProps {
  readonly label: string
  /** One line under the label. */
  readonly description?: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  /** A mandatory setting that cannot be turned off: the reason is shown and the switch is disabled. */
  readonly locked?: string
  /** The state words in the page's language (portal catalogue); On/Off when absent. */
  readonly stateLabels?: { readonly on: string; readonly off: string }
}

const STATE_LABELS = { on: 'On', off: 'Off' } as const

/**
 * sc_38 toggle row: label and description left, track right with "On"/"Off" text (colour is not the only signal).
 * Only for settings that apply immediately; anything that needs review uses a form with Save.
 */
export function Switch({ label, description, checked, onChange, locked, stateLabels = STATE_LABELS }: SwitchProps) {
  const id = useId()
  const noteId = `${id}-note`
  const note = locked ?? description
  return (
    <div className="flex items-center justify-between gap-space-md py-1">
      <div>
        <label htmlFor={id} className="block text-body-sm font-body-sm text-on-surface font-semibold">{label}</label>
        {note !== undefined && <p id={noteId} className="text-caption font-caption text-on-surface-variant">{note}</p>}
      </div>
      <label className={`relative inline-flex items-center gap-space-xs shrink-0 ${locked === undefined ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="sr-only peer"
          checked={checked}
          disabled={locked !== undefined}
          aria-describedby={note === undefined ? undefined : noteId}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span aria-hidden="true" className="relative w-11 h-6 bg-surface-container-highest rounded-full peer-checked:bg-primary-container peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:rounded-full after:h-5 after:w-5 motion-safe:after:transition-all peer-checked:after:translate-x-full" />
        <span aria-hidden="true" className="w-6 font-caption text-caption text-on-surface-variant">{checked ? stateLabels.on : stateLabels.off}</span>
      </label>
    </div>
  )
}
