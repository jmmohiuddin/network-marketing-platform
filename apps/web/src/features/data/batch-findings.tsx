'use client'

import { countLabel } from '../../lib/format'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage } from '../../lib/messages'
import { integer } from './format'
import type { Finding, PageMeta } from './types'
import { useResource } from '../../lib/use-resource'
import { CODE } from './ui'

const PAGE_SIZE = 50

const CYCLE_PREFIX = 'sponsor cycle: '

/**
 * A finding's detail as shown. GENEALOGY_CYCLE (D-B6-09) names the cycle members in chain order:
 * "sponsor cycle: 'AT-A' -> 'AT-C' -> 'AT-B' -> 'AT-A'" reads "Genealogy cycle: AT-A → AT-C → AT-B → AT-A".
 */
export function findingText(finding: Pick<Finding, 'code' | 'detail'>): string {
  const { code, detail } = finding
  if (detail === null) return '—'
  if (code !== 'GENEALOGY_CYCLE' || !detail.startsWith(CYCLE_PREFIX)) return detail
  const members = detail.slice(CYCLE_PREFIX.length).split(' -> ').map((member) => member.replace(/^'(.*)'$/, '$1'))
  return `Genealogy cycle: ${members.join(' → ')}`
}

// Details come from the API, which never echoes personal data (email-like values are withheld there).
const COLUMNS: readonly DataTableColumn<Finding>[] = [
  { key: 'file', header: 'File', cell: (finding) => finding.file },
  { key: 'row', header: 'Row', align: 'end', cell: (finding) => (finding.row_no === null ? 'Whole file' : integer(finding.row_no)) },
  { key: 'column', header: 'Column', cell: (finding) => finding.column_name ?? '—' },
  { key: 'code', header: 'Code', cell: (finding) => <span className={CODE}>{finding.code}</span> },
  { key: 'detail', header: 'What to fix', cell: findingText },
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
    <DataTable
      bare
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
