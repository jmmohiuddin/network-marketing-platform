'use client'

import { useState, type ChangeEvent, type DragEvent } from 'react'
import { FormField, type FieldLabelProps } from './form-field'
import { Icon } from './icon'

export interface FileDropZoneProps extends Omit<FieldLabelProps, 'helper'> {
  /** File extensions the server accepts, for example [".csv"]. */
  readonly extensions: readonly string[]
  readonly name?: string
  readonly disabled?: boolean
  /** The server's size limit (GET /v1/imports/limits); unknown while it loads, when the server alone checks it. */
  readonly maxBytes?: number
  /** The chosen file when it passes the checks; [] when it fails or the choice is cleared. */
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
 * sc_24 l.65 drag-and-drop canvas over a native file input (keyboard and screen readers use the input). States
 * the accepted types and size and refuses other files; the server checks both again (413 FILE_TOO_LARGE).
 */
export function FileDropZone({ label, extensions, name, disabled = false, maxBytes, onFiles, error, optional, id }: FileDropZoneProps) {
  const [problem, setProblem] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  function take(files: readonly File[]) {
    const first = files.map((file) => problemWith(file, extensions, maxBytes)).find((message) => message !== null) ?? null
    setProblem(first)
    setChosen(first === null ? files[0]?.name ?? null : null)
    onFiles(first === null ? files : [])
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setOver(false)
    if (!disabled) take([...event.dataTransfer.files].slice(0, 1))
  }
  const helper = `${extensions.join(', ')} file${maxBytes === undefined ? '' : `, up to ${formatMegabytes(maxBytes)}`}.`
  return (
    <FormField label={label} helper={helper} error={error ?? problem} optional={optional} id={id}>
      {(control) => (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            if (!disabled) setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={`group relative rounded-lg p-space-lg flex flex-col items-center justify-center text-center transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${over ? 'bg-surface-container ring-2 ring-primary' : 'bg-surface-container-low hover:bg-surface-container'} ${disabled ? 'opacity-60' : ''}`}
        >
          <span className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center text-primary mb-space-sm">
            <Icon name="upload_file" size={24} />
          </span>
          <span className="font-body-md text-body-md font-semibold text-on-surface">{chosen ?? 'Drag and drop a file here, or choose one'}</span>
          <input
            {...control}
            className="mt-space-sm font-body-sm text-body-sm text-secondary file:mr-space-sm file:h-8 file:px-space-sm file:rounded file:border-0 file:bg-surface-container file:text-on-surface file:font-medium hover:file:bg-surface-container-high file:cursor-pointer"
            type="file"
            name={name}
            accept={extensions.join(',')}
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => take([...(event.target.files ?? [])])}
          />
        </div>
      )}
    </FormField>
  )
}
