import { BlockList, isIPv4 } from 'node:net'
import { withSystem } from '@nmp/db'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import type { ApiKeyCaller } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { API_KEY_BEARER } from '../../lib/web-security.js'
import { hashToken, TOKEN_PATTERN, type RateTier } from './api-keys.js'
import type { ApiScope } from './api-scopes.js'

const ONE_MINUTE = '1 minute'
// createRateLimit inherits the API-wide options, whose allowList exempts key callers (D-B1-18): these count everyone.
const COUNT_ALL = { allowList: [] as string[] }
const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i

type Limiter = ReturnType<FastifyInstance['createRateLimit']>

interface Limiters {
  readonly perKey: Readonly<Record<RateTier, Limiter>>
  readonly failedLookupPerIp: Limiter
}

// Every createRateLimit call has its own counter store, and each module registers in its own scope: the limiters are
// made once per app (keyed by the plugin's decorator, shared by every scope) so a key has one counter on every route.
const limitersByApp = new WeakMap<object, Limiters>()

function limitersOf(app: FastifyInstance): Limiters {
  const existing = limitersByApp.get(app.createRateLimit)
  if (existing !== undefined) return existing
  const perTier = (max: number): Limiter =>
    app.createRateLimit({ ...COUNT_ALL, max, timeWindow: ONE_MINUTE, keyGenerator: (request) => `api-key:${request.apiKey?.keyId ?? ''}` })
  const created: Limiters = {
    perKey: { standard: perTier(app.config.apiKeyRateStandardPerMinute), high: perTier(app.config.apiKeyRateHighPerMinute) },
    failedLookupPerIp: app.createRateLimit({
      ...COUNT_ALL, max: app.config.apiRateLimitPerMinute, timeWindow: ONE_MINUTE, keyGenerator: (request) => `api-key-fail-ip:${request.ip}`,
    }),
  }
  limitersByApp.set(app.createRateLimit, created)
  return created
}

async function assertWithin(limiter: Limiter, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = await limiter(request)
  if (result.isAllowed || !result.isExceeded) return
  reply.header('retry-after', result.ttlInSeconds)
  throw new ApiError(429, 'RATE_LIMITED', `Too many requests. Try again in ${result.ttlInSeconds} seconds.`)
}

interface FoundKey {
  id: string
  tenant_id: string
  service_account_id: string
  scopes: string[]
  rate_tier: RateTier
  ip_allow: string[] | null
}

async function findKey(token: string): Promise<FoundKey | null> {
  if (!TOKEN_PATTERN.test(token)) return null
  const { rows } = await withSystem((tx) =>
    tx.query<FoundKey>(
      'SELECT id, tenant_id, service_account_id, scopes, rate_tier, ip_allow::text[] AS ip_allow FROM auth_find_api_key($1)',
      [hashToken(token)],
    ),
  )
  return rows[0] ?? null
}

/** request.ip against the key's networks; an IPv4-mapped IPv6 address is checked as the IPv4 address. */
export function ipAllowed(networks: readonly string[] | null, ip: string): boolean {
  if (networks === null) return true
  const address = IPV4_MAPPED.exec(ip)?.[1] ?? ip
  const family = isIPv4(address) ? 'ipv4' : 'ipv6'
  // Same-family networks only: node would match an IPv4 address against IPv6 rules as IPv4-mapped.
  const list = new BlockList()
  for (const network of networks) {
    const [base, prefix] = network.split('/') as [string, string]
    if ((isIPv4(base) ? 'ipv4' : 'ipv6') === family) list.addSubnet(base, Number(prefix), family)
  }
  return list.check(address, family)
}

function invalidKey(reply: FastifyReply): ApiError {
  reply.header('www-authenticate', 'Bearer')
  return new ApiError(401, 'API_KEY_INVALID', 'The API key is not valid. It may be revoked, expired or mistyped.')
}

async function authenticateKey(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, token: string, scope: ApiScope) {
  const limiters = limitersOf(app)
  const key = await findKey(token)
  if (key === null) {
    await assertWithin(limiters.failedLookupPerIp, request, reply)
    throw invalidKey(reply)
  }
  if (!ipAllowed(key.ip_allow, request.ip)) {
    // Counted per address, not per key: a leaked key used from elsewhere must not use up its owner's quota.
    await assertWithin(limiters.failedLookupPerIp, request, reply)
    throw new ApiError(403, 'IP_NOT_ALLOWED', 'This API key may not be used from your network address.')
  }
  const caller: ApiKeyCaller = {
    keyId: key.id, tenantId: key.tenant_id, serviceAccountId: key.service_account_id, scopes: key.scopes, rateTier: key.rate_tier,
  }
  request.apiKey = caller
  await assertWithin(limiters.perKey[key.rate_tier], request, reply)
  if (!key.scopes.includes(scope)) {
    throw new ApiError(403, 'SCOPE_MISSING', `This API key does not have the scope ${scope}.`, { scope })
  }
  await withSystem((tx) => tx.query('SELECT auth_touch_api_key($1)', [key.id]))
}

/**
 * Route guard for routes open to API keys (PLAN B1 2.6): a session caller passes sessionChecks; a caller without a
 * session and with `Authorization: Bearer nmpk_…` is authenticated by key (IP allow-list, per-key rate limit, scope).
 * A key caller gets request.apiKey and keeps request.auth null, so it reaches nothing that reads the session
 * (D-B1-05). Without either, sessionChecks answer 401. Register the route with config.apiKey true so the API-wide
 * limiter leaves key callers to the per-key limiter (D-B1-18).
 */
export function apiKeyOrSession(
  app: FastifyInstance, scope: ApiScope, ...sessionChecks: preHandlerAsyncHookHandler[]
): preHandlerAsyncHookHandler {
  return async function guard(this: FastifyInstance, request, reply) {
    const bearer = API_KEY_BEARER.exec(request.headers.authorization ?? '')?.[1]
    if (request.auth === null && bearer !== undefined) {
      await authenticateKey(app, request, reply, bearer, scope)
      return
    }
    for (const check of sessionChecks) await check.call(this, request, reply)
  }
}
