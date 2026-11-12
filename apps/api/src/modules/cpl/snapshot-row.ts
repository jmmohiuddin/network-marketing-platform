import type { ReportCode } from '@nmp/compliance'
import { z } from 'zod'
import { marketName } from '../ten/index.js'

export const REPORT_CODES = ['R1', 'R2', 'R3', 'R4', 'R5'] as const satisfies readonly ReportCode[]

export type SnapshotState = 'computing' | 'ready' | 'outdated' | 'failed'

/** Market ids the caller may see (null = every market), from marketScope (AC-36.2). */
export type MarketScope = readonly string[] | null

/** Markets in both scopes: an action needing two permissions applies each grant's own markets (SEC-26). */
export function intersectScopes(first: MarketScope, second: MarketScope): MarketScope {
  if (first === null) return second
  if (second === null) return first
  return first.filter((marketId) => second.includes(marketId))
}

/** BR-HON-01: carried in the meta of every response that shows figures. */
export const FIGURES_NOTICE =
  'Indicator figures computed from loaded historical data. They describe past periods and are not income projections or potential earnings.'

/**
 * input_refs: the loaded batches the snapshot was computed on (sorted ids), their mapping versions (sorted ids,
 * and the version numbers ascending), the reports asked for.
 */
const inputRefsSchema = z.object({
  batch_ids: z.array(z.uuid()),
  mapping_ids: z.array(z.uuid()),
  mapping_versions: z.array(z.number().int().positive()),
  reports: z.array(z.enum(REPORT_CODES)),
})

export type InputRefs = z.infer<typeof inputRefsSchema>

export interface SnapshotRecord {
  id: string
  state: SnapshotState
  market_id: string
  market_code: string
  period_from: string
  period_to: string
  method_version: string
  mapping_id: string | null
  settings_version_id: string | null
  input_refs: unknown
  inputs_hash: string
  failure_reason: string | null
  created_by: string
  created_at: Date
}

export interface Snapshot extends Omit<SnapshotRecord, 'input_refs'> {
  readonly inputs: InputRefs
}

/** Periods as 'YYYY-MM' (the snapshot covers whole months), the inputs hash as hex, the market's code. */
export const SNAPSHOT_COLUMNS = `id, state, market_id,
  (SELECT m.code FROM market m WHERE m.id = compliance_report_snapshot.market_id) AS market_code, to_char(period_from, 'YYYY-MM') AS period_from,
  to_char(period_to, 'YYYY-MM') AS period_to, method_version, mapping_id, settings_version_id, input_refs,
  encode(inputs_hash, 'hex') AS inputs_hash, failure_reason, created_by, created_at`

// The database is a trust boundary: input_refs is parsed, not cast.
export function toSnapshot(record: SnapshotRecord): Snapshot {
  const { input_refs: inputRefs, ...rest } = record
  return { ...rest, inputs: inputRefsSchema.parse(inputRefs) }
}

export function snapshotView(snapshot: Snapshot) {
  const { inputs, market_code: code, ...rest } = snapshot
  return {
    ...rest, market: { id: rest.market_id, code, name: marketName(code) }, reports: inputs.reports, input_batch_ids: inputs.batch_ids, input_mapping_ids: inputs.mapping_ids,
    input_mapping_versions: inputs.mapping_versions,
  }
}
