import type { ReactNode } from 'react'
import { Icon } from '../../components/icon'
import type { Me } from '../../lib/me'

/** sc_27 card title (h1); also used for the outcome screens inside the card. */
export const AUTH_TITLE = 'font-title-lg text-title-lg text-on-surface tracking-tight'
/** sc_27 card text. */
export const AUTH_TEXT = 'font-body-sm text-body-sm text-on-surface-variant'

export interface AuthHeaderProps {
  /** The small uppercase line above the title ("Sign in", "Second factor"). */
  readonly eyebrow: string
  readonly icon: string
  readonly title: string
  /** "Step 2 / 2" chip, only where the flow's length is known. */
  readonly step?: string
  readonly children?: ReactNode
}

/** sc_27 card header: eyebrow with icon and optional step chip, h1, one line of explanation. */
export function AuthHeader({ eyebrow, icon, title, step, children }: AuthHeaderProps) {
  return (
    <div className="flex flex-col gap-space-xs pt-space-xs">
      <div className="flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs text-primary font-caption text-caption uppercase tracking-wider font-semibold">
          <Icon name={icon} size={16} />
          <span>{eyebrow}</span>
        </div>
        {step !== undefined && (
          <span className="px-space-xs py-space-xxs rounded bg-secondary-container text-on-secondary-container font-data-mono-sm text-data-mono-sm">{step}</span>
        )}
      </div>
      <h1 className={AUTH_TITLE}>{title}</h1>
      {children !== undefined && <div className={AUTH_TEXT}>{children}</div>}
    </div>
  )
}

/** sc_27 identity context box: who is signing in (GET /v1/me), so the person can tell it is their account. */
export function IdentityBox({ me }: { readonly me: Me }) {
  const roles = me.roles.map((role) => role.name).join(', ')
  return (
    <div className="p-space-md bg-surface-container-low rounded-lg flex items-start gap-space-sm">
      <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center shrink-0 text-primary">
        <Icon name="badge" size={20} />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-section-heading text-section-heading text-on-surface truncate">{me.user.display_name ?? me.user.email}</span>
        {roles !== '' && <span className="font-body-sm text-body-sm text-on-surface-variant truncate">{roles}</span>}
        <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant truncate mt-space-xxs">{me.user.email}</span>
      </div>
    </div>
  )
}

/** sc_27 bottom row of the card: the way back out ("Sign in as a different staff member"). */
export function AuthFooter({ children }: { readonly children: ReactNode }) {
  return <div className="flex items-center justify-between gap-space-sm text-on-surface-variant font-caption text-caption pt-space-xs">{children}</div>
}
