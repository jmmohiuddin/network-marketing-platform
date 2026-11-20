'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { FOCUS_RING, LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { useModalDialog } from '../../components/modal'
import { CARD } from './blocks'

// The line explanation's frame (client island of the server-rendered statement): a 360 px side panel at ≥ 1024 px and
// before scripts run (inline, first on phones), a modal bottom sheet on phones once scripts run (sc_18).

const WIDE = '(min-width: 1024px)'

/** Whether the viewport is 1024 px or wider (line explanation as a side panel); null until read, false without matchMedia. */
function useWideScreen(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setWide(false)
      return
    }
    const query = window.matchMedia(WIDE)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

export function ExplanationFrame({ title, closeLabel, closeHref, children }: {
  readonly title: string
  readonly closeLabel: string
  readonly closeHref: string
  readonly children: ReactNode
}) {
  const wide = useWideScreen()
  const router = useRouter()
  if (wide === false) {
    // replace: closing must not leave a history entry that reopens the sheet on Back.
    return <BottomSheet title={title} closeLabel={closeLabel} onClose={() => router.replace(closeHref)}>{children}</BottomSheet>
  }
  return (
    <aside data-side-panel aria-label={title} className={`${CARD} order-first lg:order-none lg:sticky lg:top-20 flex flex-col gap-space-md`}>
      {children}
      <LinkButton href={closeHref} replace size="lg">{closeLabel}</LinkButton>
    </aside>
  )
}

/** sc_18 bottom sheet: modal on phones (focus trapped, Escape and the close button leave). */
function BottomSheet({ title, closeLabel, onClose, children }: { readonly title: string; readonly closeLabel: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const dialog = useModalDialog(true, onClose)
  return (
    <dialog ref={dialog.ref} aria-label={title} aria-modal="true" onKeyDown={dialog.onKeyDown} onCancel={dialog.onCancel}
      className="fixed bottom-0 top-auto left-0 right-0 m-0 w-full max-w-none max-h-[80vh] overflow-y-auto bg-surface-container-lowest text-on-surface rounded-t-xl shadow-2xl p-space-md backdrop:bg-black/45">
      <div className="w-12 h-1.5 rounded-full bg-outline-variant mx-auto mb-space-sm" aria-hidden="true" />
      <div className="flex justify-end mb-space-sm">
        <button type="button" aria-label={closeLabel} onClick={onClose}
          className={`w-11 h-11 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface ${FOCUS_RING}`}>
          <Icon name="close" size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
