import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import type { Volumes } from './volumes.js'

// FR-ORD-001 / D-B2-17: per-unit volumes per SKU and market, effective-dated, one row in force at a time.
const COLUMNS = `v.id, jsonb_build_object('id', m.id, 'code', m.code) AS market, v.sku, v.item_class, v.volumes, v.valid_from,
  v.valid_to, jsonb_build_object('id', u.id, 'display_name', u.display_name) AS created_by, v.reason, v.created_at`
const FROM = 'FROM product_volume_map v JOIN market m ON m.id = v.market_id JOIN user_account u ON u.id = v.created_by'

export interface VolumeFilter {
  readonly market_id?: string | undefined
  readonly sku?: string | undefined
  readonly at?: string | undefined
}

export interface VolumeCursor {
  readonly created_at: string
  readonly id: string
}

/** Newest first (millisecond precision, the cursor's). */
export async function listVolumes(
  tx: Tx, scope: readonly string[] | null, filter: VolumeFilter, after: VolumeCursor | undefined, limit: number,
): Promise<Record<string, unknown>[]> {
  const { rows } = await tx.query(
    `SELECT ${COLUMNS} ${FROM}
     WHERE ($1::uuid[] IS NULL OR v.market_id = ANY ($1)) AND ($2::uuid IS NULL OR v.market_id = $2) AND ($3::text IS NULL OR v.sku = $3)
       AND ($4::timestamptz IS NULL OR (v.valid_from <= $4 AND (v.valid_to IS NULL OR v.valid_to > $4)))
       AND ($5::timestamptz IS NULL OR (date_trunc('milliseconds', v.created_at), v.id) < ($5, $6::uuid))
     ORDER BY date_trunc('milliseconds', v.created_at) DESC, v.id DESC LIMIT $7`,
    [scope, filter.market_id ?? null, filter.sku ?? null, filter.at ?? null, after?.created_at ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}

export interface NewVolumes {
  readonly market_id: string
  readonly sku: string
  readonly item_class: string
  readonly volumes: Volumes
  readonly valid_from: string
  readonly reason: string
}

const invalidMarket = () =>
  new ApiError(422, 'VALIDATION_FAILED', 'market_id is not valid: no such market.', { issues: [{ path: 'market_id', message: 'no such market' }] })

/**
 * A SKU's first row may start at any instant (no order can carry the SKU yet: they are all held); a later row starts at
 * or after now and after the latest row, and closes the open row at its start.
 */
export async function setVolumes(tx: Tx, scope: readonly string[] | null, input: NewVolumes): Promise<Record<string, unknown>> {
  const market = await tx.query('SELECT 1 FROM market WHERE id = $1', [input.market_id])
  if (market.rowCount === 0 || (scope !== null && !scope.includes(input.market_id))) throw invalidMarket()
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('volumes:' || app_tenant_id() || ':' || $1 || ':' || $2, 0))`, [input.market_id, input.sku])
  const { rows: latest } = await tx.query<{ valid_from: Date | null; past: boolean }>(
    `SELECT max(valid_from) AS valid_from, $3::timestamptz < now() AS past FROM product_volume_map WHERE market_id = $1 AND sku = $2`,
    [input.market_id, input.sku, input.valid_from],
  )
  const last = latest[0]!.valid_from
  if (last !== null && last.getTime() === Date.parse(input.valid_from)) {
    throw new ApiError(409, 'VOLUME_ROW_EXISTS', 'A row for this SKU already starts at valid_from.')
  }
  if (last !== null && (latest[0]!.past || last.getTime() > Date.parse(input.valid_from))) {
    throw new ApiError(422, 'VALID_FROM_INVALID', 'A SKU that already has volumes changes from now on, after its latest row.', { latest_valid_from: last })
  }
  const closed = await tx.query<{ id: string }>(
    'UPDATE product_volume_map SET valid_to = $3 WHERE market_id = $1 AND sku = $2 AND valid_to IS NULL RETURNING id',
    [input.market_id, input.sku, input.valid_from],
  )
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO product_volume_map (tenant_id, market_id, sku, item_class, volumes, valid_from, reason, created_by)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, app_user_id()) RETURNING id`,
    [input.market_id, input.sku, input.item_class, input.volumes, input.valid_from, input.reason],
  )
  const id = rows[0]!.id
  await recordAudit(tx, {
    action: 'PRODUCT_VOLUME.SET', objectType: 'product_volume_map', objectId: id,
    after: { market_id: input.market_id, sku: input.sku, item_class: input.item_class, valid_from: input.valid_from, closed_id: closed.rows[0]?.id ?? null },
    reason: input.reason,
  })
  const view = await tx.query(`SELECT ${COLUMNS} ${FROM} WHERE v.id = $1`, [id])
  return view.rows[0]!
}
