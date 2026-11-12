'use client'

import { Copy } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from './button'

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
    <div className="secret">
      <span id={labelId} className="field-label">{label}</span>
      <div className="secret-row">
        <code className="secret-value" aria-labelledby={labelId}>{grouped}</code>
        <Button onClick={copy}>
          <Copy size={16} aria-hidden="true" />
          Copy key
        </Button>
      </div>
      <p className="field-helper" role="status">
        {status === 'copied' && 'Key copied.'}
        {status === 'failed' && 'The key could not be copied. Select it and copy it, or type it.'}
      </p>
    </div>
  )
}
