import { isIP } from 'node:net'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  assertAllMarkets, currentAuth, requireAllMarkets, requirePermission, requireRealm, requireStepUp, type AuthContext,
} from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type IdempotentResult } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import {
  createKey, createServiceAccount, disableServiceAccount, listServiceAccounts, revokeKey, rotateKey,
} from './api-keys.js'
import { API_SCOPES, isApiScope } from './api-scopes.js'

const MAX_IP_NETWORKS = 20
const IPV4_BITS = 32
const IPV6_BITS = 128

const idParams = z.object({ id: z.uuid() })
const name = z.string().trim().min(1).max(100)
const reasonBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })
const listQuery = z.strictObject(pageQuery)
const nameCursor = z.string().min(1).max(100)
const accountBody = z.strictObject({ name, purpose: z.string().trim().min(1).max(500) })

// An address or address/prefix; host bits are checked in the database (api-keys.ts).
const network = z.string().trim().refine((value) => {
  const [address = '', prefix, ...rest] = value.split('/')
  const family = isIP(address)
  // A zone id (fe80::1%eth0) passes isIP but not the inet cast.
  if (family === 0 || rest.length > 0 || address.includes('%')) return false
  if (prefix === undefined) return true
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? IPV4_BITS : IPV6_BITS)
}, 'must be an IP address or network (CIDR)')

const keyBody = z.strictObject({
  name,
  scopes: z.array(z.string().min(1).max(64)).min(1).max(API_SCOPES.length * 2),
  rate_tier: z.enum(['standard', 'high']),
  ip_allow: z.array(network).min(1).max(MAX_IP_NETWORKS).optional(),
  expires_at: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) > Date.now(), 'must be in the future').optional(),
})

function assertKnownScopes(scopes: readonly string[]): void {
  const unknown = scopes.filter((scope) => !isApiScope(scope))
  if (unknown.length > 0) {
    throw new ApiError(422, 'SCOPE_UNKNOWN', 'These scopes are not in the catalogue.', { scopes: unknown, catalogue: API_SCOPES.map((s) => s.scope) })
  }
}

/** A key acts on every market: whoever mints or rotates it holds each scope's session permissions for all markets. */
function assertScopesHeld(auth: AuthContext, scopes: readonly string[]): void {
  for (const entry of API_SCOPES) {
    if (scopes.includes(entry.scope)) for (const permission of entry.permissions) assertAllMarkets(auth, permission)
  }
}

/** D-B1-06: the stored (replayable) response never holds the token; only the first response carries it. */
function sendWithToken(reply: FastifyReply, result: IdempotentResult, token: string | null, body: Record<string, unknown>): unknown {
  if (result.replayed || token === null) return sendIdempotent(reply, result)
  return sendIdempotent(reply, { ...result, body: envelope({ ...body, token, token_shown: true }) })
}

/**
 * FR-IAM-006 (PLAN B1 2.5): service accounts and their API keys. integration.manage for all markets (keys are
 * tenant-wide); minting and revoking need step-up.
 */
export function registerApiKeyRoutes(app: FastifyInstance): void {
  const guard = [requireRealm('tenant'), requirePermission('integration.manage'), requireAllMarkets('integration.manage')]
  const read = { preHandler: guard }
  const stepUp = { preHandler: [...guard, requireStepUp()] }
  const maxGrace = app.config.apiKeyMaxGraceMinutes
  const graceBody = z.strictObject({ grace_minutes: z.number().int().min(0).max(maxGrace) })

  app.get('/v1/api-keys/options', read, async () =>
    envelope({
      scopes: API_SCOPES,
      rate_tiers: [
        { tier: 'standard', requests_per_minute: app.config.apiKeyRateStandardPerMinute },
        { tier: 'high', requests_per_minute: app.config.apiKeyRateHighPerMinute },
      ],
      max_grace_minutes: maxGrace,
    }))

  app.get('/v1/service-accounts', read, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, nameCursor)
    const rows = await inTenant(request, (tx) => listServiceAccounts(tx, maxGrace, after, query.limit))
    return toPage(rows, query.limit, (account) => account.name)
  })

  app.post('/v1/service-accounts', read, async (request, reply) => {
    const body = parse(accountBody, request.body)
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await createServiceAccount(tx, body)) })),
    )
    return sendIdempotent(reply, result)
  })

  app.post('/v1/service-accounts/:id/disable', stepUp, async (request) => {
    const { id } = parse(idParams, request.params)
    const { reason } = parse(reasonBody, request.body)
    return envelope(await inTenant(request, (tx) => disableServiceAccount(tx, id, reason)))
  })

  app.post('/v1/service-accounts/:id/keys', stepUp, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(keyBody, request.body)
    assertKnownScopes(body.scopes)
    assertScopesHeld(currentAuth(request), body.scopes)
    const input = {
      name: body.name, scopes: [...new Set(body.scopes)], rateTier: body.rate_tier, ipAllow: body.ip_allow ?? null,
      expiresAt: body.expires_at ?? null,
    }
    let token: string | null = null
    let shown: Record<string, unknown> = {}
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => {
        const created = await createKey(tx, id, input, maxGrace)
        token = created.token
        shown = { key: created.key }
        return { statusCode: 201, body: envelope({ ...shown, token_shown: false }) }
      }),
    )
    return sendWithToken(reply, result, token, shown)
  })

  app.post('/v1/api-keys/:id/rotate', stepUp, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const { grace_minutes: graceMinutes } = parse(graceBody, request.body)
    let token: string | null = null
    let shown: Record<string, unknown> = {}
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => {
        const rotated = await rotateKey(tx, id, graceMinutes, maxGrace, (scopes) => assertScopesHeld(currentAuth(request), scopes))
        token = rotated.token
        shown = { key: rotated.key, rotated_from: rotated.rotatedFrom }
        return { statusCode: 201, body: envelope({ ...shown, token_shown: false }) }
      }),
    )
    return sendWithToken(reply, result, token, shown)
  })

  app.post('/v1/api-keys/:id/revoke', stepUp, async (request) => {
    const { id } = parse(idParams, request.params)
    const { reason } = parse(reasonBody, request.body)
    return envelope(await inTenant(request, (tx) => revokeKey(tx, id, reason)))
  })
}
