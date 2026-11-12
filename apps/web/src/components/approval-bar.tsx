import type { ReactNode } from 'react'
import { Icon } from './icon'

export interface ApprovalBarProps {
  /** "Prepared by Ada Admin" and when: from the API record. */
  readonly preparedBy: ReactNode
  readonly preparedAt?: ReactNode
  /** Why the current user cannot approve (separation of duties), shown instead of an approve button. */
  readonly blockedReason?: string
  /** The approver line or checks summary (centre). */
  readonly approvers?: ReactNode
  /** Reject, then the one primary action naming the object. */
  readonly actions?: ReactNode
}

/**
 * sc_02 l.562 pinned approval bar: preparer (SoD), approver status, actions. Offsets the shell sidebar (56 px rail
 * at lg, 208 px at xl, none below lg). Give the page bottom padding (pb-24) so the bar does not cover content.
 */
export function ApprovalBar({ preparedBy, preparedAt, blockedReason, approvers, actions }: ApprovalBarProps) {
  return (
    <section aria-label="Approval" className="fixed bottom-0 left-0 lg:left-14 xl:left-52 right-0 bg-surface-container-lowest border-t border-outline-variant shadow-xl z-30 px-space-md py-2.5 flex flex-col md:flex-row items-center justify-between gap-space-sm">
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-fixed"><Icon name="draw" size={16} /></span>
        <div className="flex flex-col text-left leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="font-caption text-caption text-on-surface font-semibold">{preparedBy}</span>
            {preparedAt !== undefined && <span className="px-1.5 rounded bg-surface-container font-data-mono-sm text-[10px] text-secondary">{preparedAt}</span>}
          </div>
          {blockedReason !== undefined && <span className="font-caption text-[11px] text-error font-medium">{blockedReason}</span>}
        </div>
      </div>
      {approvers !== undefined && <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1 rounded font-caption text-caption text-on-surface">{approvers}</div>}
      {actions !== undefined && <div className="flex items-center gap-space-xs self-stretch md:self-auto justify-end">{actions}</div>}
    </section>
  )
}
