'use client'

import { useId, type ReactNode } from 'react'
import { Icon } from './icon'
import { useModalDialog } from './modal'

export interface DrawerProps {
  /** Keep it in the URL (UI_UX §4.7) so a link reopens the same drawer. */
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  /** One line under the title. */
  readonly description?: ReactNode
  /** Header icon. */
  readonly icon?: string
  /** md 480 px, lg 720 px; full width on phones. */
  readonly width?: 'md' | 'lg'
  readonly children: ReactNode
}

const WIDTH = { md: 'sm:w-[480px]', lg: 'sm:w-[720px]' } as const

/** Overlay inspector from the right (sc_35 l.574), modal: focus trapped, Escape closes, focus returns. */
export function Drawer({ open, onClose, title, description, icon, width = 'md', children }: DrawerProps) {
  const dialog = useModalDialog(open, onClose)
  const titleId = useId()
  if (!open) return null
  return (
    <dialog
      ref={dialog.ref}
      aria-labelledby={titleId}
      aria-modal="true"
      onKeyDown={dialog.onKeyDown}
      onCancel={dialog.onCancel}
      className={`fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-none ${WIDTH[width]} p-0 bg-surface-container-lowest text-on-surface shadow-2xl backdrop:bg-on-background/40`}
    >
      <div className="flex flex-col h-full">
        <div className="p-space-md bg-surface-container flex items-center justify-between gap-space-sm">
          <div className="flex items-center gap-2 min-w-0">
            {icon !== undefined && <Icon name={icon} size={24} className="text-primary" />}
            <div className="min-w-0">
              <h2 id={titleId} className="font-section-heading text-section-heading text-on-surface">{title}</h2>
              {description !== undefined && <p className="font-caption text-caption text-secondary">{description}</p>}
            </div>
          </div>
          <button type="button" className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Close panel" title="Close panel" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-space-md space-y-space-md font-body-sm text-body-sm">{children}</div>
      </div>
    </dialog>
  )
}
