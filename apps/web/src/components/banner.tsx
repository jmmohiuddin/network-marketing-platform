import { AlertTriangle, CircleCheck, Info, OctagonAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type BannerTone = 'info' | 'success' | 'warning' | 'danger'

const ICONS = { info: Info, success: CircleCheck, warning: AlertTriangle, danger: OctagonAlert } as const

export interface BannerProps {
  readonly tone: BannerTone
  readonly title?: string
  /** Cause, effect and what to do. */
  readonly children: ReactNode
  readonly action?: ReactNode
}

/** Full-width condition message; stays while the condition holds (UI-04 Banner). Danger is announced as an alert. */
export function Banner({ tone, title, children, action }: BannerProps) {
  const Icon = ICONS[tone]
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="banner-icon" size={20} aria-hidden="true" />
      <div className="banner-body">
        {title !== undefined && <p className="banner-title">{title}</p>}
        <div>{children}</div>
      </div>
      {action !== undefined && <div className="banner-action">{action}</div>}
    </div>
  )
}
