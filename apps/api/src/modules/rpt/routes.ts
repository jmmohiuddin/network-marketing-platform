import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requireAnyPermission, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { complianceDashboard, executiveDashboard, financeDashboard } from './dashboards.js'
import { COMPLIANCE_DEFINITIONS, EXECUTIVE_DEFINITIONS, FINANCE_DEFINITIONS, LIST_NAMES } from './definitions.js'
import { assertListReader, createView, deleteView, listViews, updateView, viewBody } from './saved-views.js'

// PLAN B6 2.4 (FR-RPT-001/002): staff realm only, scope per market of the route's permission (D-B6-14).

const executiveQuery = z.strictObject({ market_id: z.uuid().optional(), calendar_id: z.uuid().optional(), period_id: z.uuid().optional() })
const financeQuery = z.strictObject({ market_id: z.uuid() })
const complianceQuery = z.strictObject({ market_id: z.uuid().optional() })
const viewsQuery = z.strictObject({ list: z.enum(LIST_NAMES) })
const idParams = z.object({ id: z.uuid() })

export function registerRptRoutes(app: FastifyInstance): void {
  const reading = (permission: 'dashboard.exec' | 'ledger.read' | 'compliance.read') => ({ preHandler: [requireRealm('tenant'), requirePermission(permission)] })
  // Each list's read permission is checked per request (orders: order.read, ledger entries: ledger.read).
  const views = { preHandler: [requireRealm('tenant'), requireAnyPermission('order.read', 'ledger.read')] }

  app.get('/v1/dashboards/executive', reading('dashboard.exec'), async (request) => {
    const query = parse(executiveQuery, request.query)
    const scope = marketScope(currentAuth(request), 'dashboard.exec')
    return envelope(await inTenant(request, (tx) => executiveDashboard(tx, scope, query)), { definitions: EXECUTIVE_DEFINITIONS })
  })

  app.get('/v1/dashboards/finance', reading('ledger.read'), async (request) => {
    const { market_id: marketId } = parse(financeQuery, request.query)
    const scope = marketScope(currentAuth(request), 'ledger.read')
    return envelope(await inTenant(request, (tx) => financeDashboard(tx, scope, marketId)), { definitions: FINANCE_DEFINITIONS })
  })

  app.get('/v1/dashboards/compliance', reading('compliance.read'), async (request) => {
    const { market_id: marketId } = parse(complianceQuery, request.query)
    const scope = marketScope(currentAuth(request), 'compliance.read')
    return envelope(await inTenant(request, (tx) => complianceDashboard(tx, scope, marketId)), { definitions: COMPLIANCE_DEFINITIONS })
  })

  app.get('/v1/saved-views', views, async (request) => {
    const { list } = parse(viewsQuery, request.query)
    const auth = currentAuth(request)
    assertListReader(auth, list)
    return envelope(await inTenant(request, (tx) => listViews(tx, auth, list)))
  })

  app.post('/v1/saved-views', views, async (request, reply) => {
    const body = parse(viewBody, request.body)
    const auth = currentAuth(request)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({
      statusCode: 201, body: envelope(await createView(tx, auth, body)),
    })))
    return sendIdempotent(reply, result)
  })

  app.put('/v1/saved-views/:id', views, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(viewBody, request.body)
    const auth = currentAuth(request)
    return envelope(await inTenant(request, (tx) => updateView(tx, auth, id, body)))
  })

  app.delete('/v1/saved-views/:id', views, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const auth = currentAuth(request)
    await inTenant(request, (tx) => deleteView(tx, auth, id))
    return reply.status(204).send()
  })
}
