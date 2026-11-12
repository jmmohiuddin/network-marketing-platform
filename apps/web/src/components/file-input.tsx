'use client'

import { useState, type ChangeEvent } from 'react'
import { FormField, type FieldLabelProps } from './form-field'

export interface FileInputProps extends Omit<FieldLabelProps, 'helper'> {
  /** File extensions the server accepts, for example [".csv"]. */
  readonly extensions: readonly string[]
  readonly name?: string
  readonly disabled?: boolean
  /** The server's size limit (GET /v1/imports/limits); unknown while it loads, when the server alone checks it. */
  readonly maxBytes?: number
  /** The chosen file when it passes the type check; [] when it fails or the choice is cleared. */
  readonly onFiles: (files: readonly File[]) => void
}

const BYTES_PER_MB = 1024 * 1024

export function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / BYTES_PER_MB) * 10) / 10} MB`
}

function problemWith(file: File, extensions: readonly string[], maxBytes: number | undefined): string | null {
  const name = file.name.toLowerCase()
  if (!extensions.some((extension) => name.endsWith(extension.toLowerCase()))) return `${file.name} is not a ${extensions.join(' or ')} file.`
  if (maxBytes !== undefined && file.size > maxBytes) return `${file.name} is larger than the ${formatMegabytes(maxBytes)} limit.`
  return null
}

/**
 * File picker that states the accepted types and size and refuses other files (UI-04 File upload). The server
 * checks both again (413 FILE_TOO_LARGE, shown with its message).
 */
export function FileInput({ label, extensions, name, disabled, maxBytes, onFiles, error, optional, id }: FileInputProps) {
  const [problem, setProblem] = useState<string | null>(null)
  function change(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    const first = files.map((file) => problemWith(file, extensions, maxBytes)).find((message) => message !== null) ?? null
    setProblem(first)
    onFiles(first === null ? files : [])
  }
  const helper = `${extensions.join(', ')} file${maxBytes === undefined ? '' : `, up to ${formatMegabytes(maxBytes)}`}.`
  return (
    <FormField label={label} helper={helper} error={error ?? problem} optional={optional} id={id}>
      {(control) => (
        <input {...control} className="file-input" type="file" name={name} accept={extensions.join(',')} disabled={disabled} onChange={change} />
      )}
    </FormField>
  )
}
