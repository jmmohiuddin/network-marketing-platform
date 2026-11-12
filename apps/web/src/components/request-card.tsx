import type { ReactNode } from 'react'
import { Icon } from './icon'

export interface RequestField {
  readonly label: string
  readonly value: ReactNode
  /** Second line under the value. */
  readonly detail?: ReactNode
  readonly icon?: string
}

export interface RequestCardProps {
  /** Request reference chip (short id). */
  readonly reference: string
  readonly title: string
  /** A StatusBadge (pending, active, expired, denied). */
  readonly state?: ReactNode
  /** Time left while active (the vendor support-session countdown is the only countdown allowed). */
  readonly timeLeft?: ReactNode
  /** Requester, tenant, scope, duration: the two-column grid. */
  readonly fields: readonly RequestField[]
  /** The requester's stated reason. */
  readonly reason?: ReactNode
  /** Deny, then Approve (the API checks separation of duties again). */
  readonly actions?: ReactNode
  readonly children?: ReactNode
}

/** sc_14 l.147 access request card: header stripe, requester grid, justification, decision actions. */
export function RequestCard({ reference, title, state, timeLeft, fields, reason, actions, children }: RequestCardProps) {
  return (
    <article aria-label={`${title} ${reference}`} className="bg-surface-container-lowest rounded shadow-md overflow-hidden flex flex-col">
      <div className="p-space-md bg-surface-container-high flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <span className="px-2.5 py-1 rounded bg-primary-container text-on-primary font-data-mono-sm text-caption font-bold">{reference}</span>
          <h3 className="font-body-sm text-body-sm text-on-surface font-semibold">{title}</h3>
          {state}
        </div>
        {timeLeft !== undefined && (
          <span className="flex items-center gap-1.5 font-caption text-caption text-on-surface font-semibold bg-surface-container-lowest px-2.5 py-1 rounded shadow-sm">
            <Icon name="schedule" size={14} />{timeLeft}
          </span>
        )}
      </div>
      <div className="p-space-lg space-y-space-md">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md rounded bg-surface-container-low">
          {fields.map((field) => (
            <div key={field.label} className="space-y-1">
              <dt className="font-caption text-caption text-on-surface-variant uppercase font-semibold">{field.label}</dt>
              <dd className="flex items-center gap-space-xs pt-0.5 font-body-md text-body-md text-on-surface font-semibold">
                {field.icon !== undefined && <Icon name={field.icon} size={18} className="text-secondary" />}
                {field.value}
              </dd>
              {field.detail !== undefined && <dd className="font-data-mono-sm text-caption text-on-surface-variant">{field.detail}</dd>}
            </div>
          ))}
        </dl>
        {reason !== undefined && (
          <div className="space-y-space-xs">
            <h4 className="font-caption text-caption text-on-surface-variant font-semibold uppercase tracking-wider">Reason given</h4>
            <div className="p-space-md rounded bg-surface-container font-body-sm text-body-sm text-on-surface leading-relaxed">{reason}</div>
          </div>
        )}
        {children}
        {actions !== undefined && <div className="pt-space-sm flex flex-wrap items-center justify-end gap-space-sm">{actions}</div>}
      </div>
    </article>
  )
}
