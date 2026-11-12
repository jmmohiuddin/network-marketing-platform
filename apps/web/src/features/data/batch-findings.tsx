'use client'

import { countLabel } from '../../lib/format'
import { Table, type TableColumn } from '../../components/table'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage } from '../../lib/messages'
import { integer } from './format'
import type { Finding, PageMeta } from './types'
import { useResource } from '../../lib/use-resource'

const PAGE_SIZE = 50

// Details come from the API, which never echoes personal data (email-like values are withheld there).
const COLUMNS: readonly TableColumn<Finding>[] = [
  { key: 'file', header: 'File', cell: (finding) => finding.file },
  { key: 'row', header: 'Row', align: 'end', cell: (finding) => (finding.row_no === null ? 'Whole file' : integer(finding.row_no)) },
  { key: 'column', header: 'Column', cell: (finding) => finding.column_name ?? '—' },
  { key: 'code', header: 'Code', cell: (finding) => <span className="data-code">{finding.code}</span> },
  { key: 'detail', header: 'What to fix', cell: (finding) => finding.detail ?? '—' },
]

/** The batch's validation findings in the order found, 50 per page (GET /v1/imports/:id/errors). */
export function BatchFindings({ batchId, errorCount, stored }: { readonly batchId: string; readonly errorCount: number; readonly stored: number }) {
  const pages = useCursorPages()
  const { data, meta, error, loading, reload } = useResource<Finding[]>(`/v1/imports/${batchId}/errors`, { cursor: pages.cursor, limit: PAGE_SIZE })
  const nextCursor = (meta as PageMeta).next_cursor ?? null
  const caption = stored < errorCount
    ? `${countLabel(errorCount, 'validation error')}; the first ${integer(stored)} are listed. Rows count the header as row 1.`
    : `${countLabel(errorCount, 'validation error')}. Rows count the header as row 1.`
  return (
    <Table
      caption={caption}
      columns={COLUMNS}
      rows={data ?? []}
      rowKey={(finding) => finding.seq}
      loading={loading}
      error={error === null ? null : { message: errorMessage(error), onRetry: reload }}
      empty={{ title: 'No validation errors are stored for this batch.' }}
      pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }}
      density="compact"
    />
  )
}
