'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '../../../components/button'
import { ErrorSummary, type SummaryItem } from '../../../components/error-summary'
import { TextField } from '../../../components/form-field'
import { fromLocalInput, isUuid, toLocalInput } from '../format'

/** FR-AUD-001 search fields (aud/events.ts auditFilterSchema); from inclusive, to exclusive. */
export const FILTER_KEYS = ['actor_id', 'action', 'object_type', 'object_id', 'from', 'to'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
export type AuditFilters = Readonly<Partial<Record<FilterKey, string>>>

const TEXT_MAX_LENGTH = 100
const fieldId = (key: FilterKey) => `audit-filter-${key}`

/** The applied filters, read from the URL (the URL always reflects the filter, UX-05 6.3). */
export function filtersFrom(params: { get(name: string): string | null }): AuditFilters {
  return Object.fromEntries(FILTER_KEYS.flatMap((key) => {
    const value = params.get(key)
    return value === null || value === '' ? [] : [[key, value]]
  }))
}

type Draft = Record<FilterKey, string>

function draftOf(filters: AuditFilters): Draft {
  return {
    actor_id: filters.actor_id ?? '',
    action: filters.action ?? '',
    object_type: filters.object_type ?? '',
    object_id: filters.object_id ?? '',
    from: filters.from === undefined ? '' : toLocalInput(filters.from),
    to: filters.to === undefined ? '' : toLocalInput(filters.to),
  }
}

/** Checks a draft and turns it into filters (times as ISO), or lists what to fix. */
export function checkDraft(draft: Draft): { readonly filters: AuditFilters; readonly errors: Partial<Record<FilterKey, string>> } {
  const errors: Partial<Record<FilterKey, string>> = {}
  for (const key of ['actor_id', 'object_id'] as const) {
    if (draft[key] !== '' && !isUuid(draft[key].trim())) errors[key] = 'Enter a full ID, like 0b9e6c1a-1f2d-4c3b-9a8e-7d6c5b4a3f21.'
  }
  const from = fromLocalInput(draft.from)
  const to = fromLocalInput(draft.to)
  if (from !== null && to !== null && from >= to) errors.to = 'The end must be after the start.'
  const text = (key: FilterKey) => (draft[key].trim() === '' ? [] : [[key, draft[key].trim()]])
  const filters = Object.fromEntries([
    ...text('actor_id'), ...text('action'), ...text('object_type'), ...text('object_id'),
    ...(from === null ? [] : [['from', from]]), ...(to === null ? [] : [['to', to]]),
  ]) as AuditFilters
  return { filters, errors }
}

export interface AuditFilterBarProps {
  readonly applied: AuditFilters
  readonly onApply: (filters: AuditFilters) => void
}

/** SC-30 filter bar: by actor, action, object and time range; applied with Search (the page's primary action). */
export function AuditFilterBar({ applied, onApply }: AuditFilterBarProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(applied))
  const [errors, setErrors] = useState<Partial<Record<FilterKey, string>>>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checked = checkDraft(draft)
    setErrors(checked.errors)
    const items = Object.entries(checked.errors).map(([key, message]) => ({ fieldId: fieldId(key as FilterKey), message }))
    setSummary(items)
    if (items.length === 0) onApply(checked.filters)
  }
  function clear() {
    setDraft(draftOf({}))
    setErrors({})
    setSummary([])
    onApply({})
  }
  const field = (key: FilterKey, label: string, extra: { type?: string; helper?: string } = {}) => (
    <TextField
      id={fieldId(key)}
      label={label}
      optional
      type={extra.type ?? 'text'}
      helper={extra.helper}
      maxLength={TEXT_MAX_LENGTH}
      value={draft[key]}
      error={errors[key]}
      onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
    />
  )
  return (
    <form className="admin-filters" onSubmit={submit} noValidate aria-label="Filter audit events">
      <ErrorSummary items={summary} />
      {field('action', 'Action', { helper: 'Exact name, for example USER.INVITED' })}
      {field('object_type', 'Object type', { helper: 'For example user_account' })}
      {field('object_id', 'Object ID')}
      {field('actor_id', 'Actor ID')}
      {field('from', 'From', { type: 'datetime-local' })}
      {field('to', 'Before', { type: 'datetime-local' })}
      <div className="form-actions">
        <Button onClick={clear}>Clear all</Button>
        <Button type="submit" variant="primary">Search</Button>
      </div>
    </form>
  )
}
