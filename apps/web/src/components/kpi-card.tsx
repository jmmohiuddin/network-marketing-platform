import type { ReactNode } from 'react'
import { Icon } from './icon'

export interface KpiCardProps {
  /** Short noun phrase ("Snapshots ready"). */
  readonly label: string
  /** Formatted by the caller from the API value; null shows "—" and needs `detail` to say why. */
  readonly value: string | null
  readonly unit?: string
  /** Signed change as text with its comparison ("+4.50 points since 2025-01"); neutral colour, never a judgement. */
  readonly delta?: string
  readonly detail?: ReactNode
  readonly icon?: string
  /** Bottom strip: a label and a mono value (sc_01 "Cut-off lock"). */
  readonly footer?: { readonly label: string; readonly value: ReactNode }
  /** Extra content under the value (a Sparkline, a MeterBar). */
  readonly children?: ReactNode
}

/** sc_01 l.123 KPI card. Put cards in `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md`. */
export function KpiCard({ label, value, unit, delta, detail, icon, footer, children }: KpiCardProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm relative overflow-hidden flex flex-col justify-between">
      <div className="flex items-start justify-between gap-space-sm">
        <div className="flex flex-col min-w-0">
          <span className="font-caption text-caption text-secondary uppercase tracking-wider">{label}</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-title-md text-title-md text-on-surface font-bold tabular-nums">{value ?? '—'}</span>
            {unit !== undefined && value !== null && <span className="font-body-sm text-body-sm text-secondary">{unit}</span>}
          </div>
          {delta !== undefined && <span className="font-data-mono-sm text-data-mono-sm text-on-surface font-semibold mt-0.5">{delta}</span>}
          {detail !== undefined && <span className="font-body-sm text-body-sm text-on-surface-variant">{detail}</span>}
        </div>
        {icon !== undefined && <div className="p-2 rounded bg-surface-container text-primary flex items-center justify-center"><Icon name={icon} size={20} /></div>}
      </div>
      {children !== undefined && <div className="mt-space-sm">{children}</div>}
      {footer !== undefined && (
        <div className="mt-4 bg-surface-container-low -mx-space-md -mb-space-md px-space-md py-2 flex items-center justify-between gap-space-sm">
          <span className="font-caption text-caption text-secondary">{footer.label}</span>
          <span className="font-data-mono-sm text-data-mono-sm text-on-surface font-semibold">{footer.value}</span>
        </div>
      )}
    </div>
  )
}
