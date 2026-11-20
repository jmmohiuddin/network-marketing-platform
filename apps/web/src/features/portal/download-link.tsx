'use client'

import { buttonClass } from '../../components/button'
import { Icon } from '../../components/icon'

/** A native GET download link styled as a button (the session cookie goes with it; works without scripts). */
export function DownloadLink({ href, name, label, testId }: { readonly href: string; readonly name?: string; readonly label: string; readonly testId?: string }) {
  return (
    <a href={href} download={name ?? true} data-testid={testId} className={buttonClass('secondary', 'lg')}>
      <Icon name="download" size={18} />
      {label}
    </a>
  )
}
