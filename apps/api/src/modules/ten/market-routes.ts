import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assertStepUp, currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { pageQuery } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import { createBrand, deleteBrand, listBrands, renameBrand } from './brands.js'
import { createCalendar, deleteCalendar, extendPeriods, listCalendars, listPeriods, renameCalendar } from './calendars.js'
import { checklistView, decideGoLive, listGoLiveRequests, recordEntry, requestGoLive, withdrawGoLive } from './go-live.js'
import { createMarket, deleteMarket, listMarkets, marketDetail, updateMarket } from './markets.js'
import { requireAnyPermission, scopeOfAny } from './scope.js'
import { decideWithSod } from './sod.js'

const reason = z.string().trim().min(1).max(500)
const idParams = z.object({ id: z.uuid() })
const itemParams = z.object({ id: z.uuid(), item: z.string().max(64) })
const reasonBody = z.strictObject({ reason })
const languages = z.array(z.string().min(1).max(35)).min(1).max(10)
const marketBody = z.strictObject({
  code: z.string().length(2),
  currency: z.string().length(3),
  time_zone: z.string().min(1).max(64),
  languages,
  market_pack: z.string().trim().min(1).max(64),
  reason,
})
const marketPatch = z.strictObject({
  time_zone: z.string().min(1).max(64).optional(),
  languages: languages.optional(),
  market_pack: z.string().trim().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
  reason,
}).refine((patch) => Object.keys(patch).length > 1, 'change at least one field')
const brandBody = z.strictObject({ name: z.string().trim().min(1).max(100), reason })
const calendarBody = z.strictObject({
  market_id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  cadence: z.enum(['weekly', 'monthly']),
  cutoff_time_zone: z.string().min(1).max(64),
  first_period_start: z.iso.date(),
  periods_ahead: z.number().int().min(1).max(120),
  reason,
})
const CALENDAR_TIMING = ['market_id', 'cadence', 'cutoff_time_zone', 'first_period_start', 'periods_ahead'] as const
const calendarPatch = z.strictObject({ name: z.string().trim().min(1).max(100), reason })
const calendarsQuery = z.strictObject({ market_id: z.uuid().optional() })
const extendBody = z.strictObject({ through: z.iso.date(), reason })
const periodsQuery = z.strictObject({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), ...pageQuery })
const entryBody = z.strictObject({ document_id: z.uuid().optional(), note: z.string().trim().min(1).max(2000).optional() })
const emptyBody = z.strictObject({})
const decisionBody = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason,
  risk_acceptance: z.strictObject({ statement: z.string().trim().min(1).max(4000), document_id: z.uuid().optional() }).optional(),
})

const STRUCTURE_READERS: Permission[] = ['settings.manage', 'market.manage', 'market.signoff']
const LAUNCH_READERS: Permission[] = ['market.manage', 'market.signoff']

const settingsScope = (request: FastifyRequest) => marketScope(currentAuth(request), 'settings.manage')

/** Creating POSTs: the side effect and its Idempotency-Key commit together. */
function creating(request: FastifyRequest, statusCode: number, run: Parameters<typeof inTenant>[1]) {
  return inTenant(request, (tx) => idempotent(tx, request, async () => ({ statusCode, body: envelope(await run(tx)) })))
}

/** FR-TEN-002: markets, brands and calendars (API-39 family); every write appends a structure version (D-B1-02). */
export function registerMarketRoutes(app: FastifyInstance): void {
  const manage = { preHandler: [requireRealm('tenant'), requirePermission('settings.manage')] }

  app.get('/v1/markets', { preHandler: [requireRealm('tenant')] }, async (request) => envelope(await inTenant(request, listMarkets)))

  app.get('/v1/markets/:id', { preHandler: [requireRealm('tenant'), requireAnyPermission(...STRUCTURE_READERS)] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = scopeOfAny(currentAuth(request), STRUCTURE_READERS)
    return envelope(await inTenant(request, (tx) => marketDetail(tx, id, scope)))
  })

  app.post('/v1/markets', manage, async (request, reply) => {
    if (settingsScope(request) !== null) throw permissionDenied() // creating a market needs every market in scope
    const body = parse(marketBody, request.body)
    return sendIdempotent(reply, await creating(request, 201, (tx) => createMarket(tx, body)))
  })

  app.patch('/v1/markets/:id', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(marketPatch, request.body)
    return envelope(await inTenant(request, (tx) => updateMarket(tx, id, settingsScope(request), body)))
  })

  app.delete('/v1/markets/:id', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(reasonBody, request.body)
    await inTenant(request, (tx) => deleteMarket(tx, id, settingsScope(request), body.reason))
    return reply.code(204).send()
  })

  app.get('/v1/brands', { preHandler: [requireRealm('tenant')] }, async (request) => envelope(await inTenant(request, listBrands)))

  app.post('/v1/brands', manage, async (request, reply) => {
    const body = parse(brandBody, request.body)
    return sendIdempotent(reply, await creating(request, 201, (tx) => createBrand(tx, body.name, body.reason)))
  })

  app.patch('/v1/brands/:id', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(brandBody, request.body)
    return envelope(await inTenant(request, (tx) => renameBrand(tx, id, body.name, body.reason)))
  })

  app.delete('/v1/brands/:id', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(reasonBody, request.body)
    await inTenant(request, (tx) => deleteBrand(tx, id, body.reason))
    return reply.code(204).send()
  })

  registerCalendarRoutes(app)
}

function registerCalendarRoutes(app: FastifyInstance): void {
  const manage = { preHandler: [requireRealm('tenant'), requirePermission('settings.manage')] }
  const read = { preHandler: [requireRealm('tenant'), requireAnyPermission(...STRUCTURE_READERS)] }

  app.get('/v1/calendars', read, async (request) => {
    const query = parse(calendarsQuery, request.query)
    const scope = scopeOfAny(currentAuth(request), STRUCTURE_READERS)
    return envelope(await inTenant(request, (tx) => listCalendars(tx, scope, query.market_id)))
  })

  app.post('/v1/calendars', manage, async (request, reply) => {
    const body = parse(calendarBody, request.body)
    return sendIdempotent(reply, await creating(request, 201, (tx) => createCalendar(tx, settingsScope(request), body)))
  })

  app.patch('/v1/calendars/:id', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    const raw = (request.body ?? {}) as Record<string, unknown>
    const timing = CALENDAR_TIMING.filter((field) => Object.hasOwn(raw, field))
    if (timing.length > 0) {
      throw new ApiError(422, 'CALENDAR_TIMING_IMMUTABLE', 'A calendar\'s market, cadence, cut-off zone and first period never change: delete and recreate it while every period is open.', { fields: timing })
    }
    const body = parse(calendarPatch, request.body)
    return envelope(await inTenant(request, (tx) => renameCalendar(tx, id, settingsScope(request), body.name, body.reason)))
  })

  app.delete('/v1/calendars/:id', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(reasonBody, request.body)
    await inTenant(request, (tx) => deleteCalendar(tx, id, settingsScope(request), body.reason))
    return reply.code(204).send()
  })

  app.post('/v1/calendars/:id/periods', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(extendBody, request.body)
    return sendIdempotent(reply, await creating(request, 200, (tx) => extendPeriods(tx, id, settingsScope(request), body.through, body.reason)))
  })

  app.get('/v1/calendars/:id/periods', read, async (request) => {
    const { id } = parse(idParams, request.params)
    const query = parse(periodsQuery, request.query)
    const scope = scopeOfAny(currentAuth(request), STRUCTURE_READERS)
    return inTenant(request, (tx) => listPeriods(tx, id, scope, query))
  })
}

/** FR-TEN-004 launch checklist and go-live sign-off (SC-17). */
export function registerLaunchRoutes(app: FastifyInstance): void {
  const prepare = { preHandler: [requireRealm('tenant'), requirePermission('market.manage')] }
  const read = { preHandler: [requireRealm('tenant'), requireAnyPermission(...LAUNCH_READERS)] }
  const prepareScope = (request: FastifyRequest) => marketScope(currentAuth(request), 'market.manage')

  app.get('/v1/markets/:id/checklist', read, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = scopeOfAny(currentAuth(request), LAUNCH_READERS)
    return envelope(await inTenant(request, (tx) => checklistView(tx, id, scope)))
  })

  app.post('/v1/markets/:id/checklist/:item/entries', prepare, async (request, reply) => {
    const { id, item } = parse(itemParams, request.params)
    const body = parse(entryBody, request.body)
    return sendIdempotent(reply, await creating(request, 201, (tx) => recordEntry(tx, id, prepareScope(request), item, body)))
  })

  app.post('/v1/markets/:id/go-live-requests', prepare, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    parse(emptyBody, request.body ?? {})
    return sendIdempotent(reply, await creating(request, 201, (tx) => requestGoLive(tx, id, prepareScope(request))))
  })

  app.get('/v1/markets/:id/go-live-requests', read, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = scopeOfAny(currentAuth(request), LAUNCH_READERS)
    return envelope(await inTenant(request, (tx) => listGoLiveRequests(tx, id, scope)))
  })

  app.post('/v1/market-go-live-requests/:id/withdraw', prepare, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(reasonBody, request.body)
    return envelope(await inTenant(request, (tx) => withdrawGoLive(tx, id, body.reason)))
  })

  app.post(
    '/v1/market-go-live-requests/:id/decision',
    { preHandler: [requireRealm('tenant'), requirePermission('market.signoff')] },
    async (request, reply) => {
      assertStepUp(request)
      const { id } = parse(idParams, request.params)
      const body = parse(decisionBody, request.body)
      const auth = currentAuth(request)
      const scope = marketScope(auth, 'market.signoff')
      const result = await decideWithSod(request, async (tx) => ({
        statusCode: 200, body: envelope(await decideGoLive(tx, id, scope, { ...body, factorVerifiedAt: auth.stepUpAt })),
      }))
      return sendIdempotent(reply, result)
    },
  )
}
