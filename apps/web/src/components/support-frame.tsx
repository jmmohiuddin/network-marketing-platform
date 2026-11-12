'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { leavePage } from '../lib/leave-page'
import { countdownLabel, leaveSupportSession, SUPPORT_SESSIONS_PATH, type SupportSessionFrame } from '../lib/support-session'
import { useNow } from '../lib/use-now'
import { useApi } from './api-provider'
import { Button } from './button'
import { ConfirmDialog } from './dialog'

const COUNTDOWN_TICK_MS = 15_000

function backToConsole(): void {
  leaveSupportSession()
  leavePage(SUPPORT_SESSIONS_PATH)
}

/**
 * Support-session frame (UI-04, FR-IAM-005): a coloured border and a bar around the tenant app while a vendor
 * user reads it in a session: read-only, the time left, and End. When the window closes it returns to the console.
 */
export function SupportFrame({ frame, children }: { readonly frame: SupportSessionFrame; readonly children: ReactNode }) {
  const api = useApi()
  const now = useNow(COUNTDOWN_TICK_MS)
  const [ending, setEnding] = useState(false)
  const over = Date.parse(frame.endsAt) <= now
  useEffect(() => {
    if (over) backToConsole()
  }, [over])
  return (
    <div className="support-frame">
      <section className="support-frame-bar" aria-label="Vendor support session">
        <p>
          Vendor support session · read-only · {frame.tenantSlug} · ends in <time dateTime={frame.endsAt}>{countdownLabel(frame.endsAt, now)}</time>
        </p>
        <Button variant="secondary" onClick={() => setEnding(true)}>End session</Button>
      </section>
      {children}
      <ConfirmDialog
        open={ending}
        title="End support session"
        consequence={`Your read-only access to ${frame.tenantSlug} ends now. The tenant keeps the session log.`}
        confirmLabel="End session"
        destructive
        onCancel={() => setEnding(false)}
        onConfirm={async () => {
          await api.post(`/v1/support-sessions/${frame.id}/end`)
          backToConsole()
        }}
      />
    </div>
  )
}
