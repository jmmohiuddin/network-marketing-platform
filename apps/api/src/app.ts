import { randomUUID } from 'node:crypto'
import cookie from '@fastify/cookie'
import { getPool } from '@nmp/db'
import fastify, { type FastifyInstance } from 'fastify'
import { loadConfig, type Config } from './config.js'
import { registerErrorHandling } from './lib/errors.js'
import type { ApiModule } from './lib/module.js'
import { resolveAuth } from './lib/session.js'
import { registerCsrfCheck, registerRateLimit } from './lib/web-security.js'
import { defaultModules } from './modules/index.js'
import { registerSupportSessionAccess } from './modules/support/index.js'

export interface BuildAppOptions {
  /** Feature modules to mount; defaults to every module in modules/index.ts. */
  readonly modules?: readonly ApiModule[]
  /** Defaults to loadConfig(process.env). */
  readonly config?: Config
}

// Never log credentials, session tokens, one-time codes or database error details (which can echo values).
const REDACTED_PATHS = [
  'req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]',
  '*.password', '*.code', '*.token', '*.secret', 'err.detail',
]

const watchedPools = new WeakSet<object>()

// An idle client can fail (database restart); without a listener the process would crash.
function watchPool(app: FastifyInstance): void {
  const pool = getPool()
  if (watchedPools.has(pool)) return
  watchedPools.add(pool)
  pool.on('error', (error) => app.log.error({ err: error }, 'idle postgres client failed'))
}

function securityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id)
    reply.header('cache-control', 'no-store')
    reply.header('x-content-type-options', 'nosniff')
  })
}

/** The API: core hooks (errors, request id, CSRF, session, rate limit) plus the given feature modules. */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig(process.env)
  const logger = config.logLevel === 'silent'
    ? false
    : { level: config.logLevel, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }
  const trustProxy = config.trustProxy === false ? false : [...config.trustProxy]
  const app = fastify({ logger, genReqId: () => randomUUID(), requestIdHeader: false, trustProxy })
  app.decorate('config', config)
  app.decorateRequest('auth', null)
  registerErrorHandling(app)
  watchPool(app)
  securityHeaders(app)
  await app.register(cookie)
  registerCsrfCheck(app)
  app.addHook('onRequest', async (request) => {
    request.auth = await resolveAuth(request, config)
  })
  // A vendor user inside an approved support session works in that tenant's realm (FR-IAM-005).
  registerSupportSessionAccess(app)
  await registerRateLimit(app)
  for (const module of options.modules ?? defaultModules) {
    await app.register(async (scope) => {
      await module.register(scope)
    })
  }
  return app
}
