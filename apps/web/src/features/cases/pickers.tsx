'use client'

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '../../components/button'
import { FieldError, INPUT_CLASS, LABEL_CLASS } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { errorMessage } from '../../lib/messages'
import { useResource, type Query } from '../../lib/use-resource'
import type { ParticipantRow, TreeKind, TreeNode } from './types'

const QUERY_MAX = 100
const PARTICIPANT_RESULTS = 20

interface SearchPickerProps<T> {
  readonly id: string
  readonly label: string
  readonly helper: string
  readonly error?: string | null
  readonly path: string
  readonly query: (q: string) => Query
  readonly chosen: T | null
  readonly onChoose: (row: T | null) => void
  readonly rowKey: (row: T) => string
  readonly rowName: (row: T) => string
  readonly rowDetail: (row: T) => ReactNode
}

/**
 * Search-first chooser (UI_UX: never a long dropdown): type, search, choose one result; the choice shows with Change.
 * Results answer the server's own search (refs, external refs, names).
 */
function SearchPicker<T>({ id, label, helper, error, path, query, chosen, onChoose, rowKey, rowName, rowDetail }: SearchPickerProps<T>) {
  const [text, setText] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const results = useResource<T[]>(submitted === null ? null : path, submitted === null ? undefined : query(submitted))
  const hasError = error !== undefined && error !== null
  const search = () => setSubmitted(text.trim() === '' ? null : text.trim())
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault() // inside the case form: search, never submit
    search()
  }
  if (chosen !== null) {
    return (
      <div className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>{label}</span>
        <div className="flex items-center justify-between gap-space-sm p-space-sm rounded bg-surface-container-low border border-outline-variant" data-testid={`${id}-chosen`}>
          <div className="flex flex-col min-w-0">
            <span className="font-body-md text-body-md font-semibold text-on-surface break-words">{rowName(chosen)}</span>
            <span className="font-caption text-caption text-secondary">{rowDetail(chosen)}</span>
          </div>
          <Button size="sm" aria-label={`Change ${label.toLowerCase()}`} onClick={() => onChoose(null)}>Change</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      <div className="flex gap-space-xs">
        <input
          id={id} type="search" className={INPUT_CLASS} value={text} maxLength={QUERY_MAX} aria-describedby={`${id}-note`} aria-invalid={hasError || undefined}
          onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown}
        />
        <Button icon="search" aria-label={`Search ${label.toLowerCase()}`} onClick={search}>Search</Button>
      </div>
      {hasError ? <FieldError id={`${id}-note`} message={error} /> : <p id={`${id}-note`} className="font-caption text-caption text-secondary">{helper}</p>}
      <div aria-live="polite">
        {results.loading && <p className="font-caption text-caption text-secondary">Searching…</p>}
        {results.error !== null && <p role="alert" className="font-caption text-caption text-error">{errorMessage(results.error)}</p>}
        {results.data !== null && results.data.length === 0 && <p className="font-caption text-caption text-secondary">Nothing found for “{submitted}”.</p>}
        {results.data !== null && results.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-surface-container rounded border border-outline-variant bg-surface-container-lowest" aria-label={`Results for ${label.toLowerCase()}`}>
            {results.data.map((row) => (
              <li key={rowKey(row)} className="flex items-center justify-between gap-space-sm p-space-xs">
                <div className="flex flex-col min-w-0">
                  <span className="font-body-sm text-body-sm font-semibold text-on-surface break-words">{rowName(row)}</span>
                  <span className="font-caption text-caption text-secondary">{rowDetail(row)}</span>
                </div>
                <Button size="sm" aria-label={`Choose ${rowName(row)}`} onClick={() => onChoose(row)}>Choose</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export const nodeName = (node: TreeNode): string =>
  `${node.position_ref}${node.owner === null ? '' : ` · ${node.owner.display_name ?? node.owner.external_ref}`}`

function nodeDetail(node: TreeNode) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-space-xs">
      <span>{node.market_code}{node.owner === null ? '' : ` · ${node.owner.external_ref}`}</span>
      {node.status !== null && <StatusBadge state={node.status} />}
    </span>
  )
}

interface PositionPickerProps {
  readonly id: string
  readonly label: string
  readonly kind: TreeKind
  readonly chosen: TreeNode | null
  readonly onChoose: (node: TreeNode | null) => void
  readonly error?: string | null
}

/** A position, found with GET /v1/genealogy/search (position ref prefix, external ref, owner name). */
export function PositionPicker({ id, label, kind, chosen, onChoose, error }: PositionPickerProps) {
  return (
    <SearchPicker
      id={id} label={label} helper="Search by position reference, participant reference or name." error={error}
      path="/v1/genealogy/search" query={(q) => ({ kind, q })} chosen={chosen} onChoose={onChoose}
      rowKey={(node) => node.position_id} rowName={nodeName} rowDetail={nodeDetail}
    />
  )
}

export const participantName = (row: ParticipantRow): string =>
  `${row.external_ref}${row.display_name === null ? '' : ` · ${row.display_name}`}`

/** A participant, found with GET /v1/participants?q (exact external reference or a similar name). */
export function ParticipantPicker({ id, label, chosen, onChoose, error }: Omit<PositionPickerProps, 'kind' | 'chosen' | 'onChoose'> & {
  readonly chosen: ParticipantRow | null
  readonly onChoose: (row: ParticipantRow | null) => void
}) {
  return (
    <SearchPicker
      id={id} label={label} helper="Search by exact participant reference or by name." error={error}
      path="/v1/participants" query={(q) => ({ q, limit: PARTICIPANT_RESULTS })} chosen={chosen} onChoose={onChoose}
      rowKey={(row) => row.id} rowName={participantName}
      rowDetail={(row) => (
        <span className="inline-flex flex-wrap items-center gap-x-space-xs">
          <span>{row.market.code} · {row.current_type?.name ?? 'No type'}</span>
          <StatusBadge state={row.status} />
        </span>
      )}
    />
  )
}
