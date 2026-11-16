import { z } from 'zod'
import { pageQuery } from '../../lib/pagination.js'
import { REPORT_CODES } from './snapshot-row.js'

// The snapshot reads open to API keys (PLAN B1 2.4). The routes send every response through these schemas, so the
// OpenAPI document (int) built from them describes exactly what is sent. Ids are z.guid(): rows written by fixtures
// need not be RFC 4122 v4.
const id = z.guid()
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const reportCode = z.enum(REPORT_CODES)

const listQuery = z.strictObject(pageQuery)

const listItem = z.object({
  id,
  state: z.enum(['computing', 'ready', 'outdated', 'failed']).describe('ready: figures can be read; outdated: its inputs changed'),
  market_id: id,
  market: z.object({ id, code: z.string(), name: z.string() }),
  period_from: month,
  period_to: month,
  method_version: z.string(),
  mapping_id: id.nullable(),
  settings_version_id: id.nullable(),
  inputs_hash: z.string().describe('Hex SHA-256 of everything the snapshot was computed from'),
  failure_reason: z.string().nullable(),
  created_by: id,
  created_at: z.iso.datetime(),
  reports: z.array(reportCode),
  input_batch_ids: z.array(id),
  input_mapping_ids: z.array(id),
  input_mapping_versions: z.array(z.number().int()),
})

const count = z.number().int().nonnegative()
const dataQuality = z.object({
  orders: count,
  orders_unknown_purpose: count,
  refunded_orders: count,
  refunds_without_month: count,
  payout_lines: count,
  payout_lines_without_source_order: count,
  payout_lines_unknown_source_kind: count,
  unmapped: z.object({ purposes: z.array(z.string()), source_kinds: z.array(z.string()) }),
})

const decimal = z.string().describe('Decimal number as a string')
const figure = z.object({
  id: z.string().describe('<report>.<period>.<key>, e.g. R1.2025-01.customer_share_pct'),
  key: z.string(),
  unit: z.enum(['percent', 'minor', 'count', 'currency', 'ratio']),
  value: decimal.nullable(),
  numerator: decimal.nullable(),
  denominator: decimal.nullable(),
  population: z.string().nullable(),
  population_count: z.number().int().nullable(),
  method: z.string().nullable(),
  method_version: z.string().nullable(),
  note: z.string().nullable(),
  rows: z.string().describe('Drill-down path (staff session only)'),
})

const periodResult = z.object({
  report: reportCode,
  period: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/),
  period_kind: z.enum(['month', 'year']),
  partial: z.boolean().describe('A year with fewer than 12 months of payout data: not publishable'),
  notes: z.array(z.string()),
  figures: z.array(figure),
  omitted: z.array(z.object({ key: z.string(), reason: z.string().nullable() })),
})

const detail = listItem.extend({
  input_data_quality: z.array(z.object({ batch_id: id, data_quality: dataQuality.nullable() })),
  results: z.array(periodResult),
})

/** Query and response schemas of GET /v1/compliance/snapshots and GET /v1/compliance/snapshots/:id. */
export const publicSnapshotSchemas = {
  listQuery,
  listItem,
  detail,
  listMeta: z.object({ next_cursor: z.string().nullable() }),
  detailMeta: z.object({ notice: z.string() }),
} as const
