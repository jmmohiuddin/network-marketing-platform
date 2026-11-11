import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRealm, requireStepUp } from '../../lib/auth.js'
import { inVendor } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { vendorIdempotency } from '../support/index.js'
import { approveProvisioning, createTenant, goLive } from './provisioning.js'
import { getTenant, listTenants } from './tenants.js'

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/ // as the tenant_slug CHECK of migration 0002

const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const market = z.strictObject({
  code: z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code'),
  minor_unit: z.number().int().min(0).max(4),
  time_zone: z.string().min(1).max(64).refine(isTimeZone, 'must be an IANA time zone'),
  languages: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'must be a BCP 47 tag')).min(1).max(20),
  market_pack: z.string().trim().min(1).max(64),
})
const createBody = z.strictObject({
  legal_name: z.string().trim().min(1).max(200),
  slug: z.string().regex(SLUG, 'lower-case letters, digits and hyphens'),
  region: z.string().trim().min(1).max(32),
  isolation_tier: z.enum(['pooled', 'dedicated']),
  dpa_document_id: z.uuid(),
  markets: z.array(market).min(1).max(50)
    .refine((list) => new Set(list.map((item) => item.code)).size === list.length, 'market codes must be unique'),
  first_admin: z.strictObject({
    email: z.email().max(320).transform((email) => email.toLowerCase()),
    display_name: z.string().trim().min(1).max(200).nullable().default(null),
  }),
})
const listQuery = z.strictObject({ ...pageQuery, state: z.enum(['provisioning', 'implementation', 'live', 'archived']).optional() })
const idParams = z.object({ id: z.uuid() })

const vendor = { preHandler: [requireRealm('vendor')] }
// The second-person approval of FR-TEN-001 confirms with a fresh second factor (MVP_A C-4) and an Idempotency-Key.
const approver = { preHandler: [requireRealm('vendor'), requireStepUp()] }

/** Vendor operations console (FR-OPS-001, SC-39) and tenant provisioning (FR-TEN-001). Vendor realm only. */
export function registerOpsRoutes(app: FastifyInstance): void {
  app.get('/v1/tenants', vendor, async (request) => {
    const query = parse(listQuery, request.query)
    const afterSlug = decodeCursor(query.cursor, z.string().regex(SLUG))
    const rows = await inVendor(request, (tx) => listTenants(tx, query.state, afterSlug, query.limit))
    return toPage(rows, query.limit, (tenant) => tenant.slug)
  })

  app.get('/v1/tenants/:id', vendor, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inVendor(request, (tx) => getTenant(tx, id)))
  })

  app.post('/v1/tenants', vendor, async (request, reply) => {
    const body = parse(createBody, request.body)
    const input = {
      legalName: body.legal_name, slug: body.slug, region: body.region, isolationTier: body.isolation_tier,
      dpaDocumentId: body.dpa_document_id, markets: body.markets,
      firstAdmin: { email: body.first_admin.email, displayName: body.first_admin.display_name },
    }
    const created = await createTenant(request, input, vendorIdempotency(request))
    return sendIdempotent(reply, { statusCode: 201, body: envelope(created.tenant), replayed: created.replayed })
  })

  app.post('/v1/tenants/:id/approve', approver, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const approved = await approveProvisioning(request, id, vendorIdempotency(request))
    return sendIdempotent(reply, { statusCode: 200, body: envelope(approved.tenant), replayed: approved.replayed })
  })

  app.post('/v1/tenants/:id/go-live', vendor, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await goLive(request, id))
  })
}
