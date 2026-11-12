'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { ConfirmDialog } from '../../components/modal'
import { PageHeader } from '../../components/page-header'
import { ErrorState, NotAvailable } from '../../components/states'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { TabPanel, Tabs } from '../../components/tabs'
import { useToast } from '../../components/toast'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { marketName } from '../../lib/markets'
import { figureLabel, figureValue, humanize, integer, parseFigureId, periodRange, REPORT_NAMES, SNAPSHOTS_PATH } from './format'
import { downloadCsv, saveFile } from './transfer'
import type { FigureSummary, PageMeta, Snapshot } from './types'
import { useResource } from '../../lib/use-resource'
import { Icon } from '../../components/icon'
import { NOTE, SECTION_HEADING } from './ui'

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
function columnsOf(rows: readonly Row[]): readonly DataTableColumn<Row>[] {
  const keys = Object.keys(rows[0] ?? {})
  if (keys.length === 0) return [{ key: 'none', header: 'Rows', cell: () => null }]
  return keys.map((key) => ({
    key,
    header: humanize(key),
    align: key.endsWith('_minor') ? 'end' : 'start',
    cell: (row) => (key.endsWith('_minor') && typeof row[key] === 'string' ? integer(row[key]) : cellText(row[key])),
  }))
}

const MICRO = 'bg-surface p-space-xs rounded shadow-sm flex flex-col'

/** sc_26 l.68 formula card: value = numerator / denominator, with the figure's components as micro-cards. */
function FormulaCard({ figure, label }: { readonly figure: FigureSummary; readonly label: string }) {
  const value = figureValue(figure)
  const micro: readonly (readonly [string, string])[] = [
    ['Value', value],
    ['Numerator', figure.numerator === null ? '—' : integer(figure.numerator)],
    ['Denominator', figure.denominator === null ? '—' : integer(figure.denominator)],
    ['Method version', figure.method_version ?? '—'],
  ]
  return (
    <section aria-label="Definition" data-testid="card" className="xl:col-span-8 bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm">
      <div>
        <div className="font-caption text-caption text-secondary uppercase font-semibold tracking-wider">Definition</div>
        <h2 className={`${SECTION_HEADING} mt-0.5`}>{label}</h2>
      </div>
      {figure.numerator !== null && figure.denominator !== null && (
        <div className="bg-surface-container-low p-space-sm rounded font-data-mono-sm text-data-mono-sm flex items-center gap-space-sm overflow-x-auto">
          <span className="font-bold text-on-surface">{value}</span>
          <span className="text-secondary">=</span>
          <div className="flex flex-col items-center">
            <span className="text-primary font-semibold px-2 py-0.5 bg-surface rounded shadow-sm">{integer(figure.numerator)}</span>
            <span className="h-px w-full bg-outline-variant my-1" aria-hidden="true" />
            <span className="text-on-surface px-2 py-0.5 bg-surface rounded shadow-sm">{integer(figure.denominator)}</span>
          </div>
          <span className="sr-only">numerator divided by denominator</span>
        </div>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
        {micro.map(([term, detail]) => (
          <div key={term} className={MICRO}>
            <dt className="font-caption text-caption text-secondary">{term}</dt>
            <dd className="font-data-mono-md text-data-mono-md text-on-surface font-semibold break-all">{detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** sc_26 l.540 method and provenance inspector, docked beside the formula. */
function MethodPanel({ figure, notice }: { readonly figure: FigureSummary; readonly notice: string | undefined }) {
  return (
    <section aria-label="Method" className="xl:col-span-4 bg-surface-container-lowest rounded shadow-sm p-space-md flex flex-col gap-space-md">
      <div className="flex items-center gap-2 pb-space-xs border-b border-surface-container">
        <Icon name="menu_book" size={20} className="text-primary" />
        <h2 className={SECTION_HEADING}>Method</h2>
      </div>
      <div className="bg-surface-container-low p-space-sm rounded">
        <div className="font-caption text-caption text-secondary uppercase font-semibold">Population</div>
        <p className="font-body-sm text-body-sm text-on-surface mt-1">{figure.population ?? '—'}</p>
      </div>
      <div className="bg-surface-container-low p-space-sm rounded">
        <div className="font-caption text-caption text-secondary uppercase font-semibold">How it is computed</div>
        <p className="font-body-sm text-body-sm text-on-surface mt-1">{figure.method ?? '—'}</p>
      </div>
      {figure.note !== null && <p className={NOTE}>{figure.note}</p>}
      {notice !== undefined && <Banner tone="info">{notice}</Banner>}
    </section>
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
  if (component === null) return <p className="px-space-md py-2 bg-primary/5 font-caption text-caption text-on-surface">Sums over the whole {set} set: <span className="font-data-mono-sm text-data-mono-sm font-semibold">{listed}</span>.</p>
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
  const snapshotHref = `/compliance/snapshots/${snapshotId}?report=${parsed.report}`
  const back = <LinkButton href={snapshotHref} icon="arrow_back">Back to the snapshot</LinkButton>
  // SNAPSHOT_NOT_READY, FIGURE_OMITTED, SNAPSHOT_NOT_REPRODUCIBLE: the server's sentence says what holds.
  if (error !== null) return <><ErrorState message={errorMessage(error)} onRetry={reload} /><div>{back}</div></>

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
  const label = figureLabel(parsed.key)
  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Snapshots', href: SNAPSHOTS_PATH },
          { label: snapshot.data === null ? 'Snapshot' : `${snapshot.data.market.code} · ${periodRange(snapshot.data.period_from, snapshot.data.period_to)}`, href: snapshotHref },
          { label: `${parsed.report} · ${label}` },
        ]}
        summary={[
          snapshot.data === null ? null : `Snapshot of ${marketName(snapshot.data.market)}.`,
          figure === undefined ? null : `Value ${figureValue(figure)}. These are the rows the figure was computed from.`,
        ].filter((part) => part !== null).join(' ') || undefined}
        actions={<>{back}{can('export') && <Button variant="primary" icon="ios_share" onClick={() => setExporting(true)} data-testid="primary-action">Export rows (logged)</Button>}</>}
      />
      {figure !== undefined && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
          <FormulaCard figure={figure} label={label} />
          <MethodPanel figure={figure} notice={rowsMeta.notice} />
        </div>
      )}
      {figure === undefined && typeof rowsMeta.notice === 'string' && <Banner tone="info">{rowsMeta.notice}</Banner>}
      <section aria-label="Rows" className="bg-surface-container-lowest rounded shadow-sm overflow-hidden">
        <Tabs label="Row sets" idPrefix={TABS_ID} tabs={SETS} selected={set} onSelect={chooseSet} />
        <TabPanel idPrefix={TABS_ID} tabId={set}>
          <div className="flex flex-col gap-space-sm px-space-md pb-space-md">
            {data !== null && <SumsLine meta={rowsMeta} set={set} />}
            <DataTable
              bare
              caption={`${integer(rowsMeta.row_count ?? rows.length)} ${entity} in the ${set} set`}
              columns={columnsOf(rows)}
              rows={rows}
              rowKey={(row) => cellText(Object.values(row)[0])}
              loading={loading}
              empty={{ title: 'No rows in this set.' }}
              pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor), rangeText: `${integer(rows.length)} shown of ${integer(rowsMeta.row_count ?? rows.length)}` }}
              density="compact"
            />
          </div>
        </TabPanel>
      </section>
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
