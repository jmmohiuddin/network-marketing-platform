import { ComplianceInputError, type ComplianceFacts, type DrillEntity, type Figure, type ReportCode } from '@nmp/compliance'
import type { Tx } from '@nmp/db'
import { toCsv } from '../../lib/csv.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { recordExport, type ExportDecision } from '../../lib/exports.js'
import type { Envelope } from '../../lib/http.js'
import { toPage } from '../../lib/pagination.js'
import { findStoredFigure, parseFigureId, type FigureRef, type StoredFigure } from './figures.js'
import { reproduce, SnapshotInputError } from './inputs.js'
import { participantMeasures } from './measures.js'
import { findSnapshot } from './snapshots.js'
import { FIGURES_NOTICE, type MarketScope, type Snapshot } from './snapshot-row.js'

export type DrillSet = 'numerator' | 'denominator'

export const DRILL_EXPORT_KIND = 'compliance_rows'

// Drill-down needs every id of a set, not the capped sample.
const ALL_IDS = Number.MAX_SAFE_INTEGER

type Cells = readonly unknown[]

interface EntityTable {
  /** First column is the record's reference: the sort and cursor key. */
  readonly columns: readonly string[]
  readonly cells: ReadonlyMap<string, Cells>
}

// Personal data minimised (BR-IMP-02): pseudonymous references and the measures the figures use. No servicing
// or sponsor reference, which would disclose the genealogy.
function entityTable(ref: FigureRef, entity: DrillEntity, facts: ComplianceFacts): EntityTable {
  if (entity === 'order') {
    return {
      // net_minor = amount_minor - refunded_minor: the net sales R1 sums (AC-41.1).
      columns: ['order_ref', 'order_month', 'order_day', 'buyer_ref', 'amount_minor', 'volume_minor', 'refunded_minor',
        'net_minor', 'refund_month', 'purpose', 'is_starter_kit'],
      cells: new Map(facts.orders.map((o) => [o.orderRef, [o.orderRef, o.orderMonth, o.orderDay, o.buyerRef,
        o.amountMinor.toString(), o.volumeMinor.toString(), o.refundedMinor.toString(), (o.amountMinor - o.refundedMinor).toString(),
        o.refundMonth, o.purpose, o.isStarterKit]])),
    }
  }
  if (entity === 'payout_line') {
    return {
      columns: ['line_ref', 'pay_month', 'payee_ref', 'bonus_type', 'source_kind', 'source_order_ref', 'amount_minor'],
      cells: new Map(facts.payoutLines.map((l) => [l.lineRef, [l.lineRef, l.payMonth, l.payeeRef, l.bonusType, l.sourceKind,
        l.sourceOrderRef, l.amountMinor.toString()]])),
    }
  }
  const measures = participantMeasures(ref, facts)
  return {
    columns: ['participant_ref', 'type_code', 'counts_as_end_customer', 'can_earn', 'enrolled_month', ...measures.columns],
    cells: new Map(facts.participants.map((p) => [p.participantRef, [p.participantRef, p.typeCode, p.countsAsEndCustomer,
      p.canEarn, p.enrolledMonth, ...measures.of(p).map(String)]])),
  }
}

function cellsOf(table: EntityTable, ref: string): Cells {
  const cells = table.cells.get(ref)
  if (cells === undefined) throw new Error(`drill-down id ${ref} is not among the snapshot facts`)
  return cells
}

export interface DrillTarget {
  readonly report: ReportCode
  readonly snapshotId: string
  readonly figureId: string
  readonly stored: StoredFigure
  readonly figure: Figure
  readonly table: EntityTable
}

const notReproducible = (detail: string) =>
  new ApiError(409, 'SNAPSHOT_NOT_REPRODUCIBLE', 'The rows behind this figure cannot be reproduced from the snapshot inputs.', { detail })

function sameFigure(figure: Figure, stored: StoredFigure): boolean {
  return figure.value === stored.value && (figure.numerator?.toString() ?? null) === stored.numerator
    && (figure.denominator?.toString() ?? null) === stored.denominator
}

async function recompute(tx: Tx, snapshot: Snapshot) {
  try {
    return await reproduce(tx, snapshot, ALL_IDS)
  } catch (error) {
    if (error instanceof ComplianceInputError || error instanceof SnapshotInputError) throw notReproducible(error.message)
    throw error
  }
}

/**
 * FR-CPL-006: the figure of a ready (or since outdated) snapshot, recomputed from the snapshot's recorded inputs
 * with every drill id, and checked against the stored figure, so the rows shown are the rows that made it.
 */
export async function drillTarget(tx: Tx, snapshotId: string, figureId: string, scope: MarketScope): Promise<DrillTarget> {
  const ref = parseFigureId(figureId)
  const snapshot = await findSnapshot(tx, snapshotId, scope)
  if (ref === null) throw notFound()
  if (snapshot.state !== 'ready' && snapshot.state !== 'outdated') {
    throw new ApiError(409, 'SNAPSHOT_NOT_READY', `The snapshot is ${snapshot.state}; its figures have no rows to show.`)
  }
  const stored = await findStoredFigure(tx, snapshot.id, ref)
  if (stored === null) throw notFound()
  if (stored.unit === null) {
    throw new ApiError(422, 'FIGURE_OMITTED', 'This indicator was not computed, so it has no rows.', { reason: stored.note })
  }
  const { periods, facts } = await recompute(tx, snapshot)
  const figure = periods.find((p) => p.report === ref.report && p.period === ref.period)?.figures.find((f) => f.key === ref.key)
  if (figure === undefined || !sameFigure(figure, stored)) throw notReproducible('The recomputed figure differs from the stored one.')
  return { report: ref.report, snapshotId: snapshot.id, figureId, stored, figure, table: entityTable(ref, figure.drill.entity, facts) }
}

const idsOf = (target: DrillTarget, set: DrillSet): readonly string[] =>
  set === 'numerator' ? target.figure.drill.numeratorIds : target.figure.drill.denominatorIds

function figureSummary(target: DrillTarget) {
  const { stored } = target
  return {
    id: target.figureId, unit: stored.unit, value: stored.value, numerator: stored.numerator, denominator: stored.denominator,
    population: stored.population, method: stored.method, method_version: stored.method_version, note: stored.note,
  }
}

// AC-41.1: the *_minor column whose sum over a set equals the figure's component (as @nmp/compliance computes it);
// null where the component is a count of rows.
const R2_VOLUME_FIGURES = new Set(['rewarded_volume_cents', 'personal_use_share_pct', 'unknown_purpose_share_pct'])
const COMPONENT_COLUMN: Readonly<Record<ReportCode, (key: string, set: DrillSet) => string | null>> = {
  R1: (key) => (key === 'participant_orders_purpose_unknown_pct' ? null : 'net_minor'),
  R2: (key) => (R2_VOLUME_FIGURES.has(key) ? 'volume_minor' : key === 'unattributable_amount_cents' ? 'amount_minor' : null),
  R3: () => 'amount_minor',
  R4: () => null,
  R5: (key, set) => (key === 'mean' && set === 'numerator' ? 'earnings_minor' : null),
}

/** Sum of every *_minor column over the whole set (not the page), as bigint strings. */
function sumsOf(target: DrillTarget, ids: readonly string[]): Record<string, string> {
  const minor = target.table.columns.flatMap((column, index) => (column.endsWith('_minor') ? [{ column, index }] : []))
  const totals = minor.map(({ index }) => ids.reduce((total, id) => total + BigInt(cellsOf(target.table, id)[index] as string), 0n))
  return Object.fromEntries(minor.map(({ column }, i) => [column, totals[i]!.toString()]))
}

/** The sums key that must equal the figure's component for this set, and that component; null for counts. */
function componentOf(target: DrillTarget, set: DrillSet): { key: string; expected_minor: string } | null {
  const key = COMPONENT_COLUMN[target.report](target.figure.key, set)
  const expected = target.stored[set]
  return key === null || expected === null ? null : { key, expected_minor: expected }
}

/** One page of a figure's numerator or denominator rows, by ascending reference. */
export function drillPage(target: DrillTarget, set: DrillSet, after: string | undefined, limit: number): Envelope<Record<string, unknown>[]> {
  const ids = idsOf(target, set)
  const remaining = after === undefined ? ids : ids.filter((id) => id > after)
  const { columns } = target.table
  const rows = remaining.slice(0, limit + 1).map((id) => {
    const cells = cellsOf(target.table, id)
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]))
  })
  const page = toPage(rows, limit, (row) => row[columns[0]!])
  return {
    data: page.data,
    meta: {
      ...page.meta, set, entity: target.figure.drill.entity, row_count: ids.length, figure: figureSummary(target),
      sums: sumsOf(target, ids), component: componentOf(target, set), notice: FIGURES_NOTICE,
    },
  }
}

export type DrillExport = { readonly refused: Extract<ExportDecision, { refused: true }> } | {
  readonly refused: null
  readonly filename: string
  readonly csv: string
}

/**
 * FR-AUD-002 / AC-41.1: both row sets as CSV, capped and logged (export_job, EXPORT.CREATED with the row
 * count; above the cap EXPORT.REFUSED only). Every row carries a watermark naming the export and requester.
 */
export async function exportDrillRows(tx: Tx, target: DrillTarget, rowCap: number, requesterId: string): Promise<DrillExport> {
  const sets: DrillSet[] = ['numerator', 'denominator']
  const rowCount = sets.reduce((total, set) => total + idsOf(target, set).length, 0)
  const decision = await recordExport(tx, {
    kind: DRILL_EXPORT_KIND, filters: { snapshot_id: target.snapshotId, figure: target.figureId }, rowCount, rowCap,
  })
  if (decision.refused) return { refused: decision }
  const watermark = `export ${decision.job.id} for user ${requesterId}`
  const rows = sets.flatMap((set) => idsOf(target, set).map((id) => [set, ...cellsOf(target.table, id), watermark]))
  return {
    refused: null,
    filename: `compliance-rows-${decision.job.id}.csv`,
    csv: toCsv(['set', ...target.table.columns, 'watermark'], rows),
  }
}
