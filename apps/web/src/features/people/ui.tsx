import type { ReactNode } from 'react'
import { Icon } from '../../components/icon'

// sc_09 record card (Section 1 "Masked Identity & Contact Master"): bordered card, low header with icon and h2.
export function RecordCard({ id, icon, title, action, testId, children }: { readonly id: string; readonly icon: string; readonly title: string; readonly action?: ReactNode; readonly testId?: string; readonly children: ReactNode }) {
  return (
    <section aria-labelledby={id} data-testid={testId} className="bg-surface-container-lowest rounded border border-outline-variant shadow-sm overflow-hidden">
      <div className="px-space-md py-space-sm bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <Icon name={icon} size={18} className="text-primary" />
          <h2 id={id} className="font-section-heading text-section-heading text-on-surface">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-space-md flex flex-col gap-space-md">{children}</div>
    </section>
  )
}

/** sc_09 fact grid (label over value, hairline under each). */
export function Facts({ items }: { readonly items: readonly { readonly label: string; readonly value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-space-lg gap-y-space-md font-body-sm text-body-sm">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 pb-space-xs border-b border-outline-variant/40 min-w-0">
          <dt className="font-caption text-caption text-on-surface-variant font-medium">{item.label}</dt>
          <dd className="text-on-surface break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
