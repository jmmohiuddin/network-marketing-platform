'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { Checkbox } from '../../components/form-field'
import { Modal } from '../../components/modal'
import { isApiError } from '../../lib/api'
import { countLabel } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import type { Query } from '../../lib/use-resource'
import { saveFile } from '../data/transfer'
import { CHECK_GRID } from '../admin/ui'

// Column chooser and CSV export of the lists with saved views (PLAN B6 2.5): the same column keys drive the table,
// the saved view and the export.

export interface ColumnOption {
  readonly key: string
  readonly label: string
  /** The row's own column (its link): always shown. */
  readonly required?: boolean
}

/**
 * sc_31 column chooser: which registry columns the table shows (and the export holds), in registry order. The list's
 * `required` column (its link) is always kept, so a choice is never empty.
 */
export function ColumnChooser({ options, selected, onApply }: {
  readonly options: readonly ColumnOption[]
  readonly selected: readonly string[]
  readonly onApply: (columns: readonly string[]) => void
}) {
  const [draft, setDraft] = useState<readonly string[] | null>(null)
  const close = () => setDraft(null)
  const apply = () => {
    if (draft === null) return
    onApply(options.filter((option) => option.required === true || draft.includes(option.key)).map((option) => option.key))
    close()
  }
  return (
    <>
      <Button icon="view_column" onClick={() => setDraft(selected)}>Columns</Button>
      <Modal open={draft !== null} onClose={close} title="Choose columns" description="The table shows these columns; an export holds the same ones."
        footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="primary" onClick={apply}>Apply columns</Button></>}>
        <fieldset className={CHECK_GRID}>
          <legend className="sr-only">Columns</legend>
          {options.map((option) => (
            <Checkbox key={option.key} label={option.label} checked={option.required === true || (draft?.includes(option.key) ?? false)} disabled={option.required}
              helper={option.required === true ? 'Always shown: it opens the row.' : undefined}
              onChange={(event) => setDraft((current) => (event.target.checked ? [...(current ?? []), option.key] : (current ?? []).filter((key) => key !== option.key)))} />
          ))}
        </fieldset>
      </Modal>
    </>
  )
}

/** Data rows of a CSV text: record ends outside quotes, minus the header line. */
export function csvRowCount(csv: string): number {
  let records = 0
  let quoted = false
  for (const char of csv) {
    if (char === '"') quoted = !quoted
    else if (char === '\n' && !quoted) records += 1
  }
  if (csv !== '' && !csv.endsWith('\n')) records += 1
  return Math.max(0, records - 1)
}

type Outcome = { readonly kind: 'busy' } | { readonly kind: 'ready'; readonly file: Blob; readonly rows: number } | { readonly kind: 'failed'; readonly message: string }

/** EXPORT_ROW_CAP_EXCEEDED with its counts in words; other failures as the API says them. */
function refusalText(error: unknown): string {
  if (!isApiError(error, 'EXPORT_ROW_CAP_EXCEEDED')) return errorMessage(error)
  const details = (error.details ?? {}) as { row_count?: number; row_cap?: number }
  return `${countLabel(details.row_count ?? 0, 'row')} match, more than the ${countLabel(details.row_cap ?? 0, 'row')} an export may hold. Narrow the filters and export again. The refused export is recorded in the audit log.`
}

/**
 * "Export orders" / "Export CSV": every row of the list's filters in its sort with the chosen columns (GET <path>, audited
 * by the API with the row count), then a dialog naming the row count before the file is saved.
 */
export function ListExport({ label, path, query, filename }: { readonly label: string; readonly path: string; readonly query: Query; readonly filename: string }) {
  const api = useApi()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  async function run() {
    setOutcome({ kind: 'busy' })
    try {
      const { data } = await api.get<Blob>(path, { query, responseType: 'blob', headers: { Accept: 'text/csv' } })
      setOutcome({ kind: 'ready', file: data, rows: csvRowCount(await data.text()) })
    } catch (error) {
      setOutcome({ kind: 'failed', message: refusalText(error) })
    }
  }
  const close = () => setOutcome(null)
  const ready = outcome?.kind === 'ready' ? outcome : null
  return (
    <>
      <Button icon="file_download" loading={outcome?.kind === 'busy'} onClick={() => void run()}>{label}</Button>
      <Modal open={outcome !== null && outcome.kind !== 'busy'} onClose={close} title={label} icon="file_download" size="sm"
        footer={<>
          <Button variant="secondary" onClick={close}>Close</Button>
          {ready !== null && <Button variant="primary" icon="save" data-autofocus onClick={() => {
            saveFile(ready.file, filename)
            close()
          }}>Save CSV file</Button>}
        </>}>
        {ready !== null && <p data-testid="export-count">{`${countLabel(ready.rows, 'row')}, with the columns and sort shown. The export is recorded in the audit log.`}</p>}
        {outcome?.kind === 'failed' && <Banner tone="danger" title="No export">{outcome.message}</Banner>}
      </Modal>
    </>
  )
}
