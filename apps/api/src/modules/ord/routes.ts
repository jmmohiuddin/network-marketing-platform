import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requireAnyPermission, requirePermission, requireRealm, scopeOfAny } from '../../lib/auth.js'
import { toCsv } from '../../lib/csv.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { recordExport } from '../../lib/exports.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { decideLate, lateCounts, listLate, previewLate } from './late-queue.js'
import { listVolumes, setVolumes } from './product-volumes.js'
import { minorString } from './schemas.js'
import { ORDER_COLUMNS, ORDER_SORTS, orderFilters, type OrderSort } from './order-list.js'
import { countOrders, listOrders, orderDetail, orderSummary, sortValueOf, type OrderCursor } from './views.js'

const idParams = z.object({ id: z.uuid() })
const instant = z.iso.datetime({ offset: true })
const orderCursor = z.object({ sort: z.enum(ORDER_SORTS), value: z.string().min(1).max(40), id: z.uuid() })
const SORT_VALUE = { credited_at: instant, amount: minorString } as const
const createdCursor = z.object({ created_at: instant, id: z.uuid() })
const keyOf = (field: string) => (row: Record<string, unknown>) => ({ [field]: (row[field] as Date).toISOString(), id: row.id })
const window = { from: instant.optional(), to: instant.optional() }
const sort = z.enum(ORDER_SORTS).default('credited_at_desc')
const orderQuery = z.strictObject({ ...pageQuery, ...orderFilters, sort })
const columnList = z.string().max(1000).transform((list) => list.split(','))
  .pipe(z.array(z.enum(Object.keys(ORDER_COLUMNS) as [string, ...string[]])).min(1).refine((c) => new Set(c).size === c.length, 'columns repeat'))
const exportQuery = z.strictObject({ ...orderFilters, sort, columns: columnList.optional() })

/** The cursor of the same sort, else 422 VALIDATION_FAILED (a cursor of another sort would skip or repeat rows). */
function cursorFor(cursor: string | undefined, sorted: OrderSort): OrderCursor | undefined {
  const after = decodeCursor(cursor, orderCursor)
  if (after === undefined) return undefined
  if (after.sort !== sorted || !SORT_VALUE[sorted.startsWith('amount') ? 'amount' : 'credited_at'].safeParse(after.value).success) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'The cursor belongs to another sort. Start again without a cursor.', { path: 'cursor' })
  }
  return { value: after.value, id: after.id }
}
const summaryQuery = z.strictObject({ ...window, market_id: z.uuid().optional() })
const volumesQuery = z.strictObject({ ...pageQuery, market_id: z.uuid().optional(), sku: z.string().min(1).max(64).optional(), at: instant.optional() })
const volumesBody = z.strictObject({
  market_id: z.uuid(),
  sku: z.string().regex(/^[\x21-\x7e]{1,64}$/),
  item_class: z.enum(['product', 'starter_kit', 'service', 'shipping', 'fee']),
  volumes: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), minorString)
    .refine((volumes) => Object.keys(volumes).length >= 1 && Object.keys(volumes).length <= 20, '1 to 20 measures'),
  valid_from: instant,
  reason: z.string().trim().min(1).max(500),
})
const lateQuery = z.strictObject({ ...pageQuery, state: z.enum(['pending', 'decided', 'consumed']).optional(), market_id: z.uuid().optional() })
const lateIds = z.array(z.uuid()).min(1).max(500)
const decisionBody = z.strictObject({ ids: lateIds, handling: z.enum(['adjust', 'restatement']).optional(), reason: z.string().trim().min(1).max(500) })

/** SC-31 order reads, product volumes, and the SC-32 late-transaction queue (FR-ORD-001..005). */
export function registerOrderRoutes(app: FastifyInstance): void {
  const orderRead = { preHandler: [requireRealm('tenant'), requirePermission('order.read')] }
  const scopeOf = (request: Parameters<typeof currentAuth>[0], permission: 'order.read' | 'late.manage' | 'product.manage') =>
    marketScope(currentAuth(request), permission)

  app.get('/v1/orders', orderRead, async (request) => {
    const query = parse(orderQuery, request.query)
    const after = cursorFor(query.cursor, query.sort)
    const rows = await inTenant(request, (tx) => listOrders(tx, scopeOf(request, 'order.read'), query, query.sort, after, query.limit))
    return toPage(rows, query.limit, (row) => ({ sort: query.sort, value: sortValueOf(query.sort, row), id: row.id }))
  })

  // D-B6-08: the list's rows under its filter and sort as CSV, capped and audited with the filters (BR-SEC-03).
  app.get('/v1/orders/export', orderRead, async (request, reply) => {
    const { columns = Object.keys(ORDER_COLUMNS), ...query } = parse(exportQuery, request.query)
    const scope = scopeOf(request, 'order.read')
    const cap = app.config.exportRowCap
    const result = await inTenant(request, async (tx) => {
      // One statement reads the rows (at most cap + 1), so the audited count is exactly what the file holds.
      const rows = await listOrders(tx, scope, query, query.sort, undefined, cap)
      const decision = await recordExport(tx, {
        kind: 'orders', filters: { ...(request.query as Record<string, unknown>) },
        rowCount: rows.length > cap ? await countOrders(tx, scope, query) : rows.length, rowCap: cap,
      })
      return decision.refused ? decision : { refused: false as const, rows }
    })
    if (result.refused) {
      throw new ApiError(422, 'EXPORT_ROW_CAP_EXCEEDED', 'The export is larger than the row limit.', { row_count: result.rowCount, row_cap: result.rowCap })
    }
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', 'attachment; filename="orders.csv"')
    reply.header('cache-control', 'no-store')
    return reply.send(toCsv(columns, result.rows.map((row) => columns.map((column) => ORDER_COLUMNS[column]!(row)))))
  })

  app.get('/v1/orders/summary', orderRead, async (request) => {
    const query = parse(summaryQuery, request.query)
    return envelope(await inTenant(request, (tx) => orderSummary(tx, scopeOf(request, 'order.read'), query)))
  })

  app.get('/v1/orders/:id', orderRead, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => orderDetail(tx, id, scopeOf(request, 'order.read'))))
  })

  const volumeReaders = ['order.read', 'product.manage'] as const
  app.get('/v1/product-volumes', { preHandler: [requireRealm('tenant'), requireAnyPermission(...volumeReaders)] }, async (request) => {
    const query = parse(volumesQuery, request.query)
    const after = decodeCursor(query.cursor, createdCursor)
    const scope = scopeOfAny(currentAuth(request), volumeReaders)
    const rows = await inTenant(request, (tx) => listVolumes(tx, scope, query, after, query.limit))
    return toPage(rows, query.limit, keyOf('created_at'))
  })

  app.post('/v1/product-volumes', { preHandler: [requireRealm('tenant'), requirePermission('product.manage')] }, async (request, reply) => {
    const body = parse(volumesBody, request.body)
    const scope = scopeOf(request, 'product.manage')
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await setVolumes(tx, scope, body)) })))
    return sendIdempotent(reply, result)
  })

  const late = { preHandler: [requireRealm('tenant'), requirePermission('late.manage')] }
  app.get('/v1/late-transactions', late, async (request) => {
    const query = parse(lateQuery, request.query)
    const after = decodeCursor(query.cursor, createdCursor)
    const scope = scopeOf(request, 'late.manage')
    const { rows, counts } = await inTenant(request, async (tx) => ({
      rows: await listLate(tx, scope, query, after, query.limit), counts: await lateCounts(tx, scope),
    }))
    const page = toPage(rows, query.limit, keyOf('created_at'))
    return envelope(page.data, { ...page.meta, counts })
  })

  app.post('/v1/late-transactions/preview', late, async (request) => {
    const { ids } = parse(z.strictObject({ ids: lateIds }), request.body)
    return envelope(await inTenant(request, (tx) => previewLate(tx, scopeOf(request, 'late.manage'), [...new Set(ids)])))
  })

  app.post('/v1/late-transactions/decisions', late, async (request, reply) => {
    const body = parse(decisionBody, request.body)
    const scope = scopeOf(request, 'late.manage')
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 200, body: envelope(await decideLate(tx, scope, body)) })))
    return sendIdempotent(reply, result)
  })
}
