'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { ConfirmDialog } from '../../components/dialog'
import { PageHeader } from '../../components/page-header'
import { ErrorState, NotAvailable } from '../../components/states'
import { Table, type TableColumn } from '../../components/table'
import { TabPanel, Tabs } from '../../components/tabs'
import { useToast } from '../../components/toast'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { marketName } from '../../lib/markets'
import { figureLabel, figureValue, humanize, integer, parseFigureId, REPORT_NAMES } from './format'
import { downloadCsv, saveFile } from './transfer'
import type { FigureSummary, PageMeta, Snapshot } from './types'
import { useResource } from '../../lib/use-resource'

const PAGE_SIZE = 50
const WHOLE_NUMBER = /^-?\d+$/
const TABS_ID = 'rows'
const SETS = [{ id: 'numerator', label: 'Numerator rows' }, { id: 'denominator', label: 'Denominator rows' }] as const
type RowSet = (typeof SETS)[number]['id']

type Row = Readonly<Record<string, unknown>>

interface RowsMeta extends PageMeta {
  readonly entity?: string
  readonly row_count?: number
  readonly figure?: FigureSummary
  readonly notice?: string
  /** Sum of every *_minor column over the whole set (not the page), as bigint strings. */
  readonly sums?: Readonly<Record<string, string>>
  /** The figure component those sums must equal (AC-41.1). */
  readonly component?: { readonly key: string; readonly expected_minor: string } | null
}

const ENTITY_NAMES: Readonly<Record<string, string>> = { order: 'orders', payout_line: 'payout lines', participant: 'participants' }

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** Columns follow the rows the API returns for the figure's entity (orders, payout lines or participants). */
function columnsOf(rows: readonly Row[]): readonly TableColumn<Row>[] {
  const keys = Object.keys(rows[0] ?? {})
  if (keys.length === 0) return [{ key: 'none', header: 'Rows', cell: () => null }]
  return keys.map((key) => ({
    key,
    header: humanize(key),
    align: key.endsWith('_minor') ? 'end' : 'start',
    cell: (row) => (key.endsWith('_minor') && typeof row[key] === 'string' ? integer(row[key]) : cellText(row[key])),
  }))
}

function Definition({ figure }: { readonly figure: FigureSummary }) {
  return (
    <dl className="data-facts" aria-label="Definition">
      <dt>Value</dt><dd>{figureValue(figure)}</dd>
      {figure.numerator !== null && <><dt>Numerator</dt><dd>{integer(figure.numerator)}</dd></>}
      {figure.denominator !== null && <><dt>Denominator</dt><dd>{integer(figure.denominator)}</dd></>}
      <dt>Population</dt><dd>{figure.population ?? '—'}</dd>
      <dt>Method</dt><dd>{figure.method ?? '—'}</dd>
      <dt>Method version</dt><dd>{figure.method_version ?? '—'}</dd>
      {figure.note !== null && <><dt>Note</dt><dd>{figure.note}</dd></>}
    </dl>
  )
}

/** Columns whose whole-set sum equals the component (exact: bigint). */
export function matchingSums(sums: Readonly<Record<string, string>>, expected: string): readonly string[] {
  if (!WHOLE_NUMBER.test(expected)) return []
  return Object.entries(sums).filter(([, sum]) => WHOLE_NUMBER.test(sum) && BigInt(sum) === BigInt(expected)).map(([column]) => column)
}

/** AC-41.1 sums line: the set's sums against the figure component they must equal. */
function SumsLine({ meta, set }: { readonly meta: RowsMeta; readonly set: RowSet }) {
  const sums = Object.entries(meta.sums ?? {})
  const component = meta.component ?? null
  if (sums.length === 0 && component === null) return null
  const listed = sums.map(([column, sum]) => `${humanize(column)} ${integer(sum)}`).join(' · ')
  if (component === null) return <p className="data-note">Sums over the whole {set} set: {listed}.</p>
  const matching = matchingSums(meta.sums ?? {}, component.expected_minor)
  const target = `the figure's ${humanize(component.key).toLowerCase()}, ${integer(component.expected_minor)} minor units`
  return matching.length > 0
    ? <Banner tone="success" title="Sums match the figure">Sums over the whole {set} set: {listed}. {matching.map(humanize).join(' and ')} equals {target}.</Banner>
    : <Banner tone="danger" title="Sums do not match the figure">Sums over the whole {set} set: {listed || 'no amount columns'}. None equals {target}. The rows shown may not be the rows behind the figure: report this page to support.</Banner>
}

/** SC-26 drill-down: the numerator and denominator rows of one figure, paged; logged CSV export with `export`. */
export function FigureRows({ snapshotId }: { readonly snapshotId: string }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const toast = useToast()
  const { can } = useSession()
  const pages = useCursorPages()
  const [exporting, setExporting] = useState(false)
  const figureId = params.get('figure') ?? ''
  const set: RowSet = params.get('set') === 'denominator' ? 'denominator' : 'numerator'
  const parsed = parseFigureId(figureId)
  const path = `/v1/compliance/snapshots/${snapshotId}/figures/${encodeURIComponent(figureId)}/rows`
  const { data, meta, error, loading, reload } = useResource<Row[]>(parsed === null ? null : path, { set, cursor: pages.cursor, limit: PAGE_SIZE })
  // The market the rows belong to (the rows response does not name it).
  const snapshot = useResource<Snapshot>(parsed === null ? null : `/v1/compliance/snapshots/${snapshotId}`)

  if (parsed === null || (error !== null && isNotAvailable(error))) return <NotAvailable />
  const back = <LinkButton href={`/compliance/snapshots/${snapshotId}?report=${parsed.report}`}>Back to the snapshot</LinkButton>
  // SNAPSHOT_NOT_READY, FIGURE_OMITTED, SNAPSHOT_NOT_REPRODUCIBLE: the server's sentence says what holds.
  if (error !== null) return <><ErrorState message={errorMessage(error)} onRetry={reload} />{back}</>

  const rowsMeta = meta as RowsMeta
  const figure = rowsMeta.figure
  const rows = data ?? []
  const nextCursor = rowsMeta.next_cursor ?? null
  const entity = ENTITY_NAMES[rowsMeta.entity ?? ''] ?? 'rows'

  function chooseSet(id: string) {
    pages.reset()
    router.replace(`${pathname}?figure=${encodeURIComponent(figureId)}&set=${id}`)
  }
  async function exportRows() {
    const file = await downloadCsv(path, { export: 'true' })
    saveFile(file.blob, file.filename)
    setExporting(false)
    toast({ message: 'Rows exported. The export is recorded in the audit log.', tone: 'success' })
  }

  const title = `${parsed.report} ${REPORT_NAMES[parsed.report]} · ${figureLabel(parsed.key)} · ${parsed.period}`
  return (
    <>
      <PageHeader
        title={title}
        summary={[
          snapshot.data === null ? null : `Snapshot of ${marketName(snapshot.data.market)}.`,
          figure === undefined ? null : `Value ${figureValue(figure)}. These are the rows the figure was computed from.`,
        ].filter((part) => part !== null).join(' ') || undefined}
        actions={<>{back}{can('export') && <Button variant="primary" onClick={() => setExporting(true)}>Export rows (logged)</Button>}</>}
      />
      <div className="data-stack">
        {typeof rowsMeta.notice === 'string' && <Banner tone="info">{rowsMeta.notice}</Banner>}
        {figure !== undefined && <Definition figure={figure} />}
      </div>
      <Tabs label="Row sets" idPrefix={TABS_ID} tabs={SETS} selected={set} onSelect={chooseSet} />
      <TabPanel idPrefix={TABS_ID} tabId={set}>
        {data !== null && <SumsLine meta={rowsMeta} set={set} />}
        <Table
          caption={`${integer(rowsMeta.row_count ?? rows.length)} ${entity} in the ${set} set`}
          columns={columnsOf(rows)}
          rows={rows}
          rowKey={(row) => cellText(Object.values(row)[0])}
          loading={loading}
          empty={{ title: 'No rows in this set.' }}
          pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }}
          density="compact"
        />
      </TabPanel>
      {can('export') && (
        <ConfirmDialog
          open={exporting}
          title="Export rows"
          consequence="Downloads the numerator and denominator rows of this figure as a CSV file. The export is recorded in the audit log with your name, the figure and the row count."
          confirmLabel="Export rows"
          onConfirm={exportRows}
          onCancel={() => setExporting(false)}
        />
      )}
    </>
  )
}
