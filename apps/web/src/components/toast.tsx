'use client'

import { CircleCheck, Info, X } from 'lucide-react'
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

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
const ICONS = { success: CircleCheck, info: Info } as const

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
  const Icon = ICONS[toast.tone]
  return (
    <div
      className={`toast toast-${toast.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={20} aria-hidden="true" />
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="icon-button" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

/** Polite live region, bottom-right (bottom on phones); 5 s each, paused on hover or focus, at most 3. */
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
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismiss} />)}
      </div>
    </ToastContext>
  )
}
