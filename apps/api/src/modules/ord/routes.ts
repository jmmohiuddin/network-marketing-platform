import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requireAnyPermission, requirePermission, requireRealm, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { decideLate, lateCounts, listLate, previewLate } from './late-queue.js'
import { listVolumes, setVolumes } from './product-volumes.js'
import { minorString } from './schemas.js'
import { listOrders, orderDetail, orderSummary } from './views.js'

const idParams = z.object({ id: z.uuid() })
const instant = z.iso.datetime({ offset: true })
const orderCursor = z.object({ credited_at: instant, id: z.uuid() })
const createdCursor = z.object({ created_at: instant, id: z.uuid() })
const keyOf = (field: string) => (row: Record<string, unknown>) => ({ [field]: (row[field] as Date).toISOString(), id: row.id })
const window = { from: instant.optional(), to: instant.optional() }
const orderQuery = z.strictObject({
  ...pageQuery, ...window, market_id: z.uuid().optional(), source_system: z.string().min(1).max(100).optional(),
  purpose: z.enum(['resale', 'personal', 'unspecified', 'customer']).optional(), buyer_id: z.uuid().optional(),
  attributed_position_id: z.uuid().optional(), period_id: z.uuid().optional(), late: z.literal('true').transform(() => true).optional(),
  flag: z.enum(['purpose_missing', 'attribution_conflict']).optional(),
})
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
    const after = decodeCursor(query.cursor, orderCursor)
    const rows = await inTenant(request, (tx) => listOrders(tx, scopeOf(request, 'order.read'), query, after, query.limit))
    return toPage(rows, query.limit, keyOf('credited_at'))
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
