import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { ApiError } from './errors.js'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_HEADER = 'x-requested-with'
const ONE_MINUTE = '1 minute'
/** An API key bearer token (PLAN B1 2.6); the key guard reads the same pattern. */
export const API_KEY_BEARER = /^Bearer (nmpk_\S*)$/

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The route takes API keys (apiKeyOrSession): bearer callers are limited per key, not here (D-B1-18). */
    apiKey?: boolean
    /** The route authenticates by an HMAC over the raw body and carries no cookie authority (PLAN B2 2): no CSRF header. */
    signedWebhook?: boolean
  }
}

/**
 * CSRF defence for cookie authentication (SEC-35), on top of SameSite=Strict: every unsafe request must
 * carry X-Requested-With. A cross-site form cannot set it, and a cross-site script cannot send it without
 * a CORS preflight, which this API never grants. Exempt (PLAN B2 2): API key bearers (a cross-site form cannot send an
 * Authorization header either) and signed webhooks (no cookie authority; the HMAC authenticates them).
 */
export function registerCsrfCheck(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return
    if (API_KEY_BEARER.test(request.headers.authorization ?? '') || request.routeOptions.config.signedWebhook === true) return
    const header = request.headers[CSRF_HEADER]
    if (typeof header !== 'string' || header.length === 0) {
      throw new ApiError(403, 'CSRF_HEADER_MISSING', 'Send the X-Requested-With header with this request.')
    }
  })
}

/**
 * API-wide limit per session (per IP when signed out). Sign-in routes use signInRateLimit instead. A signed-out bearer
 * request to a route that takes API keys is not counted (D-B1-18): its per-key limiter and the failed-lookup limiter of
 * apiKeyOrSession are its quota. On other routes a bearer header changes nothing.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  // shortcut: in-memory counters, per process; use a shared store (Redis) once the API runs on more than one node.
  await app.register(rateLimit, {
    global: true,
    hook: 'onRequest', // runs after session resolution, so the key can be the session
    max: app.config.apiRateLimitPerMinute,
    timeWindow: ONE_MINUTE,
    allowList: (request) =>
      request.auth === null && request.routeOptions.config.apiKey === true && API_KEY_BEARER.test(request.headers.authorization ?? ''),
    keyGenerator: (request) => (request.auth === null ? `ip:${request.ip}` : `session:${request.auth.sessionId}`),
    errorResponseBuilder: (_request, context) =>
      new ApiError(429, 'RATE_LIMITED', `Too many requests. Try again in ${context.after}.`),
  })
}

type Limiter = ReturnType<FastifyInstance['createRateLimit']>

async function assertWithin(limiter: Limiter, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = await limiter(request)
  if (result.isAllowed || !result.isExceeded) return
  reply.header('retry-after', result.ttlInSeconds)
  throw new ApiError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${result.ttlInSeconds} seconds.`)
}

/**
 * Strict limits for sign-in style routes (TR-API-12, SEC-23): one counter per IP and, when accountOf is given,
 * one per account across all IPs, so neither password spraying from one address nor guessing one account from
 * many addresses passes. A preHandler (accountOf reads the parsed body); register the route with
 * config.rateLimit false so the API-wide limiter does not count it as well.
 */
export function signInRateLimit(
  app: FastifyInstance, accountOf?: (request: FastifyRequest) => string,
): preHandlerAsyncHookHandler {
  const window = { max: app.config.signInRateLimitPerMinute, timeWindow: ONE_MINUTE }
  const perIp = app.createRateLimit({ ...window, keyGenerator: (request) => `sign-in-ip:${request.ip}` })
  const perAccount = accountOf === undefined
    ? null
    : app.createRateLimit({ ...window, keyGenerator: (request) => `sign-in-account:${accountOf(request)}` })
  return async (request, reply) => {
    await assertWithin(perIp, request, reply)
    if (perAccount !== null) await assertWithin(perAccount, request, reply)
  }
}
