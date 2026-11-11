import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { auditInRealm } from '../../lib/audit.js'
import { currentAuth, requireAuth } from '../../lib/auth.js'
import { inOwnRealm } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { passwordSchema } from '../../lib/passwords.js'
import { clearSessionCookie, revokeSession, setSessionCookie } from '../../lib/session.js'
import { signInRateLimit } from '../../lib/web-security.js'
import { acceptInvitation } from './invitations.js'
import { signIn, type SignInResult } from './sign-in.js'

export const emailSchema = z.email().max(320).transform((value) => value.toLowerCase())
const password = z.string().min(1).max(256)
const tenantSignInBody = z.strictObject({ tenant: z.string().min(1).max(63), email: emailSchema, password })
const vendorSignInBody = z.strictObject({ email: emailSchema, password })
const acceptBody = z.strictObject({ token: z.string().min(1).max(128), password: passwordSchema })

const ACCOUNT_KEY_MAX = 400

// Rate-limit key from the raw body (validation runs later, in the handler).
function accountOf(request: FastifyRequest): string {
  const body = (request.body ?? {}) as { tenant?: unknown; email?: unknown }
  return `${String(body.tenant ?? '')}:${String(body.email ?? '')}`.toLowerCase().slice(0, ACCOUNT_KEY_MAX)
}

function respond(app: FastifyInstance, reply: FastifyReply, result: SignInResult) {
  if (!result.ok && result.locked) {
    throw new ApiError(429, 'SIGN_IN_LOCKED', 'Too many failed sign-in attempts. Try again later.')
  }
  if (!result.ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email or password is not correct.')
  setSessionCookie(reply, app.config, result.session.token, result.session.expiresAt)
  reply.code(201)
  return envelope({ expires_at: result.session.expiresAt, next_step: result.next })
}

function signInInput(request: FastifyRequest, email: string, passwordText: string) {
  return { email, password: passwordText, ip: request.ip, userAgent: request.headers['user-agent'], requestId: request.id }
}

/** API-07: sign-in (tenant and vendor realms), sign-out, invitation acceptance. */
export function registerAuthRoutes(app: FastifyInstance): void {
  const signInRoute = { config: { rateLimit: false as const }, preHandler: [signInRateLimit(app, accountOf)] }

  app.post('/v1/auth/sessions', signInRoute, async (request, reply) => {
    const body = parse(tenantSignInBody, request.body)
    const input = { ...signInInput(request, body.email, body.password), realm: 'tenant' as const, tenantSlug: body.tenant }
    return respond(app, reply, await signIn(app.config, input))
  })

  app.post('/v1/auth/vendor-sessions', signInRoute, async (request, reply) => {
    const body = parse(vendorSignInBody, request.body)
    const input = { ...signInInput(request, body.email, body.password), realm: 'vendor' as const, tenantSlug: null }
    return respond(app, reply, await signIn(app.config, input))
  })

  app.delete(
    '/v1/auth/sessions/current',
    { preHandler: [requireAuth()], config: { allowPendingMfa: true } },
    async (request, reply) => {
      const auth = currentAuth(request)
      await inOwnRealm(request, async (tx) => {
        await revokeSession(tx, auth.sessionId)
        await auditInRealm(tx, auth.realm, { action: 'AUTH.SIGN_OUT', objectType: 'session', objectId: auth.sessionId })
      })
      clearSessionCookie(reply, app.config)
      return reply.code(204).send()
    },
  )

  // The token is 256 random bits: guessing is bounded per IP; there is no account to count against.
  const acceptRoute = { config: { rateLimit: false as const }, preHandler: [signInRateLimit(app)] }
  app.post('/v1/auth/invitations/accept', acceptRoute, async (request, reply) => {
    const body = parse(acceptBody, request.body)
    await acceptInvitation(body.token, body.password, request.id)
    return reply.code(204).send()
  })
}
