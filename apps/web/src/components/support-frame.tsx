'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { leavePage } from '../lib/leave-page'
import { countdownLabel, leaveSupportSession, SUPPORT_SESSIONS_PATH, type SupportSessionFrame } from '../lib/support-session'
import { useNow } from '../lib/use-now'
import { useApi } from './api-provider'
import { Button } from './button'
import { ConfirmDialog } from './modal'

const COUNTDOWN_TICK_MS = 15_000

function backToConsole(): void {
  leaveSupportSession()
  leavePage(SUPPORT_SESSIONS_PATH)
}

/**
 * Support-session frame (UI-04, FR-IAM-005; no Stitch instance: violet-800 per guidelines §8): a border and a bar around the tenant app while a vendor
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
    <>
      {/* Fixed so it stays visible with the shell's fixed header (AppShell offsets itself by the bar's 32 px). */}
      <section className="fixed top-0 inset-x-0 h-8 z-[60] bg-violet-800 text-white font-caption text-caption flex items-center justify-between gap-space-sm px-space-md" aria-label="Vendor support session">
        <p className="truncate">
          Vendor support session · read-only · {frame.tenantSlug} · ends in <time dateTime={frame.endsAt}>{countdownLabel(frame.endsAt, now)}</time>
        </p>
        <Button variant="secondary" size="sm" onClick={() => setEnding(true)}>End session</Button>
      </section>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] border-4 border-violet-800" />
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
    </>
  )
}
