'use client'

import { useEffect, useRef, type MouseEvent } from 'react'

export interface SummaryItem {
  /** The field the message is about; the item links to it. Absent for errors of the whole form. */
  readonly fieldId?: string
  readonly message: string
}

export interface ErrorSummaryProps {
  /** Hold this array in state and replace it once per submit: focus moves here whenever it changes. */
  readonly items: readonly SummaryItem[]
  readonly title?: string
}

function focusField(event: MouseEvent<HTMLAnchorElement>, fieldId: string) {
  const field = document.getElementById(fieldId)
  if (field === null) return
  event.preventDefault()
  field.focus()
}

/** Errors of a failed submit at the top of the form, with links to the fields (UX-05 §6.1). */
export function ErrorSummary({ items, title = 'There is a problem' }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (items.length > 0) ref.current?.focus()
  }, [items])
  if (items.length === 0) return null
  return (
    <div ref={ref} className="p-space-sm bg-surface-container-lowest border-l-4 border-l-error border border-outline-variant rounded-sm flex flex-col gap-space-xs focus:outline focus:outline-2 focus:outline-primary" role="alert" tabIndex={-1}>
      <h2 className="font-section-heading text-section-heading text-error">{title}</h2>
      <ul className="list-disc pl-space-md font-body-sm text-body-sm text-on-surface space-y-0.5">
        {items.map((item) => (
          <li key={`${item.fieldId ?? 'form'}:${item.message}`}>
            {item.fieldId === undefined
              ? item.message
              : <a className="text-primary underline" href={`#${item.fieldId}`} onClick={(event) => focusField(event, item.fieldId!)}>{item.message}</a>}
          </li>
        ))}
      </ul>
    </div>
  )
}
