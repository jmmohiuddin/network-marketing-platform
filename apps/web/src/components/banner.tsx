import type { ReactNode } from 'react'
import { Icon } from './icon'

export type BannerTone = 'info' | 'success' | 'warning' | 'danger'

// sc_17 l.37 (danger), sc_08 l.278 (warning border), sc_10 l.74 (success), sc_15 l.782 (info).
const TONE: Readonly<Record<BannerTone, { readonly border: string; readonly tile: string; readonly icon: string }>> = {
  danger: { border: 'border-l-error', tile: 'bg-error-container text-on-error-container', icon: 'block' },
  warning: { border: 'border-l-[#7A4900]', tile: 'bg-amber-100 text-amber-900', icon: 'warning' },
  success: { border: 'border-l-tertiary-container', tile: 'bg-tertiary-fixed text-on-tertiary-fixed', icon: 'check_circle' },
  info: { border: 'border-l-primary', tile: 'bg-primary-fixed text-primary', icon: 'info' },
}

export interface BannerProps {
  readonly tone: BannerTone
  readonly title?: string
  /** Cause, effect and what to do. */
  readonly children: ReactNode
  readonly action?: ReactNode
}

/** Full-width condition message; stays while the condition holds. Danger is announced as an alert. */
export function Banner({ tone, title, children, action }: BannerProps) {
  const look = TONE[tone]
  return (
    <div data-tone={tone} className={`p-space-sm bg-surface-container-lowest border-l-4 ${look.border} border border-outline-variant rounded-sm flex items-start gap-space-sm`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className={`p-1 rounded mt-0.5 shrink-0 flex items-center justify-center ${look.tile}`}><Icon name={look.icon} size={20} /></span>
      <div className="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
        <div className="flex flex-col">
          {title !== undefined && <p className="font-section-heading text-section-heading text-on-surface leading-tight">{title}</p>}
          <div className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{children}</div>
        </div>
        {action !== undefined && <div className="flex items-center gap-space-xs shrink-0">{action}</div>}
      </div>
    </div>
  )
}
