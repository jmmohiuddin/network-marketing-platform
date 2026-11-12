'use client'

import { useId, useState } from 'react'
import { Button } from './button'
import { LABEL_CLASS } from './form-field'

const GROUP = 4

export interface SecretTextProps {
  readonly label: string
  /** Shown in groups of four for reading aloud and typing; copied without spaces. */
  readonly value: string
}

/** A one-time secret or code to copy or type, such as the TOTP setup key. Monospace, selectable. */
export function SecretText({ label, value }: SecretTextProps) {
  const labelId = useId()
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const grouped = value.match(new RegExp(`.{1,${GROUP}}`, 'g'))?.join(' ') ?? value
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }
  return (
    <div className="flex flex-col gap-space-xs">
      <span id={labelId} className={LABEL_CLASS}>{label}</span>
      <div className="flex flex-wrap items-center gap-space-sm">
        <code className="px-space-sm py-space-xs rounded bg-surface-container-low font-data-mono-md text-data-mono-md text-on-surface select-all" aria-labelledby={labelId}>{grouped}</code>
        <Button icon="content_copy" onClick={copy}>Copy key</Button>
      </div>
      <p className="font-caption text-caption text-secondary" role="status">
        {status === 'copied' && 'Key copied.'}
        {status === 'failed' && 'The key could not be copied. Select it and copy it, or type it.'}
      </p>
    </div>
  )
}
