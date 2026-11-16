'use client'

import type { ReactNode } from 'react'
import { Button } from '../../../components/button'
import { Icon } from '../../../components/icon'
import { StatusBadge } from '../../../components/status-badge'
import { formatDateTime } from '../format'
import type { BreachContact } from '../types'
import { MONO, NOTE } from '../ui'
import type { SettingEntry } from './types'

export interface SettingRowProps {
  readonly title: string
  readonly description: string
  /** What applies while the value is unset (DEC-14, E-ADR-11: no default is shipped). */
  readonly whenUnset: string
  /** The chip shown while unset: "Not set", or "Platform rule" where one applies (BR-MNY-02). */
  readonly unsetLabel?: string
  readonly entry: SettingEntry
  readonly show: (value: never) => ReactNode
  /** Absent when the user may not change it (read-only session, no settings.manage). */
  readonly onChange?: () => void
}

/** sc_29 policy row: name and explanation on the left, the value in force and Change on the right. */
export function SettingRow({ title, description, whenUnset, unsetLabel = 'Not set', entry, show, onChange }: SettingRowProps) {
  const titleId = `setting-${title.replace(/\W+/g, '-').toLowerCase()}`
  const since = entry.value_since
  return (
    <li className="p-space-md rounded bg-surface-container-low flex flex-col md:flex-row md:items-center justify-between gap-space-md" aria-labelledby={titleId}>
      <div className="max-w-md flex flex-col gap-1">
        <h3 id={titleId} className="font-section-heading text-section-heading text-on-surface">{title}</h3>
        <p className={NOTE}>{description}</p>
        {entry.value !== null && since !== null && (
          <p className="font-caption text-caption text-secondary">In force since {formatDateTime(since.effective_from)} (version {since.version}).</p>
        )}
      </div>
      <div className="flex flex-col md:items-end gap-space-sm shrink-0 md:max-w-xs">
        {entry.value === null
          ? (
            <div className="flex flex-col md:items-end gap-1">
              <StatusBadge state="draft" label={unsetLabel} />
              <span className="font-caption text-caption text-secondary md:text-right">{whenUnset}</span>
            </div>
          )
          : <div className="font-data-mono-md text-data-mono-md text-on-surface font-semibold md:text-right">{show(entry.value as never)}</div>}
        {onChange !== undefined && <Button size="sm" icon="edit" aria-label={`Change ${title.toLowerCase()}`} onClick={onChange}>Change</Button>}
      </div>
    </li>
  )
}

/** sc_29 breach contact card: role caption, name, email and phone in mono. */
export function ContactCard({ contact }: { readonly contact: BreachContact }) {
  return (
    <li className="p-space-md rounded bg-surface-container-low flex items-start justify-between gap-space-sm">
      <div className="min-w-0">
        <span className="font-caption text-caption uppercase tracking-wider text-secondary">{contact.role}</span>
        <h3 className="font-section-heading text-section-heading text-on-surface font-semibold mt-0.5">{contact.name}</h3>
        <p className={`${MONO} text-primary mt-1 break-all`}>{contact.email}</p>
        <p className={`${MONO} text-primary break-all`}>{contact.phone}</p>
      </div>
      <div className="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-primary shrink-0">
        <Icon name="contact_phone" size={18} />
      </div>
    </li>
  )
}
