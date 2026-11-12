'use client'

import { useState, type ChangeEvent } from 'react'
import { FormField, type FieldLabelProps } from './form-field'

export interface FileInputProps extends Omit<FieldLabelProps, 'helper'> {
  /** File extensions the server accepts, for example [".csv"]. */
  readonly extensions: readonly string[]
  readonly name?: string
  readonly disabled?: boolean
  /** The chosen file when it passes the type check; [] when it fails or the choice is cleared. */
  readonly onFiles: (files: readonly File[]) => void
}

const BYTES_PER_MB = 1024 * 1024

export function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / BYTES_PER_MB) * 10) / 10} MB`
}

function problemWith(file: File, extensions: readonly string[]): string | null {
  const name = file.name.toLowerCase()
  return extensions.some((extension) => name.endsWith(extension.toLowerCase())) ? null : `${file.name} is not a ${extensions.join(' or ')} file.`
}

/**
 * File picker that states the accepted types and refuses other files (UI-04 File upload). The size limit is the
 * server's configuration, so the server alone enforces it (413 FILE_TOO_LARGE, shown with its message).
 */
export function FileInput({ label, extensions, name, disabled, onFiles, error, optional, id }: FileInputProps) {
  const [problem, setProblem] = useState<string | null>(null)
  function change(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    const first = files.map((file) => problemWith(file, extensions)).find((message) => message !== null) ?? null
    setProblem(first)
    onFiles(first === null ? files : [])
  }
  const helper = `${extensions.join(', ')} file.`
  return (
    <FormField label={label} helper={helper} error={error ?? problem} optional={optional} id={id}>
      {(control) => (
        <input {...control} className="file-input" type="file" name={name} accept={extensions.join(',')} disabled={disabled} onChange={change} />
      )}
    </FormField>
  )
}
