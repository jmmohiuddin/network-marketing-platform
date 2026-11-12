'use client'

import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icon'

/** Toasts confirm success or give information; errors that need action are never toasts (UI-04). */
export type ToastTone = 'success' | 'info'

export interface ToastInput {
  readonly message: string
  readonly tone?: ToastTone
}

interface ToastItem {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
}

type ShowToast = (toast: ToastInput) => void

export const TOAST_DURATION_MS = 5000
const MAX_TOASTS = 3
// sc_33 l.595 toast: verified icon in tertiary-fixed on the inverse surface.
const ICONS = { success: { name: 'verified', className: 'text-tertiary-fixed' }, info: { name: 'info', className: 'text-inverse-primary' } } as const

const ToastContext = createContext<ShowToast | null>(null)

/** show({ message, tone? }) from any client component under ToastProvider. */
export function useToast(): ShowToast {
  const show = use(ToastContext)
  if (show === null) throw new Error('useToast is only available inside ToastProvider')
  return show
}

function Toast({ toast, onDismiss }: { readonly toast: ToastItem; readonly onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [paused, toast.id, onDismiss])
  const icon = ICONS[toast.tone]
  return (
    <div
      className="pointer-events-auto rounded-lg bg-inverse-surface text-inverse-on-surface p-space-md shadow-xl flex items-center gap-space-sm"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={icon.name} size={24} className={icon.className} />
      <span className="flex-1 font-body-sm text-body-sm font-semibold">{toast.message}</span>
      <button type="button" className="p-1 rounded text-inverse-on-surface hover:bg-on-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inverse-primary" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

/** Polite live region, bottom-right (sc_33), above the bottom edge on phones (sc_18); 5 s each, paused on hover or focus, at most 3. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const lastId = useRef(0)
  const show = useCallback<ShowToast>(({ message, tone = 'success' }) => {
    lastId.current += 1
    const item = { id: lastId.current, message, tone }
    setToasts((current) => [...current, item].slice(-MAX_TOASTS))
  }, [])
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  return (
    <ToastContext value={show}>
      {children}
      <div className="fixed z-50 bottom-6 right-6 max-sm:bottom-20 max-sm:left-4 max-sm:right-4 sm:w-[400px] flex flex-col gap-space-sm pointer-events-none" role="status" aria-live="polite">
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismiss} />)}
      </div>
    </ToastContext>
  )
}
