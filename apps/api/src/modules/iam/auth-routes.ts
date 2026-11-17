import { createHash } from 'node:crypto'
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
import { FIREBASE_REFUSED, requireFirebase, verifyFirebaseToken } from './firebase.js'
import { acceptInvitation } from './invitations.js'
import { firebaseSignIn, signIn, type SignInResult } from './sign-in.js'

export const emailSchema = z.email().max(320).transform((value) => value.toLowerCase())
const password = z.string().min(1).max(256)
const tenantSlug = z.string().min(1).max(63)
const tenantSignInBody = z.strictObject({ tenant: tenantSlug, email: emailSchema, password })
const vendorSignInBody = z.strictObject({ email: emailSchema, password })
const idToken = z.string().min(1).max(4096)
// password: the account's own, required once, on the sign-in that links the account to its Firebase identity.
const tenantFirebaseBody = z.strictObject({ tenant: tenantSlug, id_token: idToken, password: password.optional() })
const vendorFirebaseBody = z.strictObject({ id_token: idToken, password: password.optional() })
const acceptBody = z.strictObject({ token: z.string().min(1).max(128), password: passwordSchema })

const ACCOUNT_KEY_MAX = 400

// Rate-limit key from the raw body (validation runs later, in the handler).
function accountOf(request: FastifyRequest): string {
  const body = (request.body ?? {}) as { tenant?: unknown; email?: unknown }
  return `${String(body.tenant ?? '')}:${String(body.email ?? '')}`.toLowerCase().slice(0, ACCOUNT_KEY_MAX)
}

/**
 * Rate-limit key of a Firebase sign-in: the email is only known once the token is verified, and keying by tenant would
 * let one address exhaust a whole tenant's quota. A token is a signature, not a guessable secret, so the per-IP counter
 * bounds probing; this one bounds replaying one token from many addresses. Account lockout applies after verification.
 */
function firebaseTokenOf(request: FastifyRequest): string {
  const body = (request.body ?? {}) as { tenant?: unknown; id_token?: unknown }
  const tokenHash = createHash('sha256').update(String(body.id_token ?? '')).digest('base64url')
  return `firebase:${String(body.tenant ?? '').toLowerCase().slice(0, ACCOUNT_KEY_MAX)}:${tokenHash}`
}

const PASSWORD_REFUSED = 'The email or password is not correct.'

function respond(app: FastifyInstance, reply: FastifyReply, result: SignInResult, refused = PASSWORD_REFUSED) {
  if (!result.ok && result.failure === 'locked') {
    throw new ApiError(429, 'SIGN_IN_LOCKED', 'Too many failed sign-in attempts. Try again later.')
  }
  if (!result.ok && result.failure === 'identity_in_use') {
    throw new ApiError(409, 'IDENTITY_IN_USE', 'This sign-in is already linked to another account.')
  }
  if (!result.ok && result.failure === 'link_required') {
    throw new ApiError(401, 'FIREBASE_LINK_REQUIRED', 'Enter the password of your account once to link this sign-in to it.')
  }
  if (!result.ok) throw new ApiError(401, 'INVALID_CREDENTIALS', refused)
  setSessionCookie(reply, app.config, result.session.token, result.session.expiresAt)
  reply.code(201)
  return envelope({ expires_at: result.session.expiresAt, next_step: result.next })
}

function signInInput(request: FastifyRequest, email: string, passwordText: string) {
  return { email, password: passwordText, ip: request.ip, userAgent: request.headers['user-agent'], requestId: request.id }
}

async function firebaseInput(app: FastifyInstance, request: FastifyRequest, body: { id_token: string; password?: string | undefined }) {
  const identity = await verifyFirebaseToken(body.id_token, requireFirebase(app.config.firebase), app.firebaseKeys)
  return { identity, password: body.password, ip: request.ip, userAgent: request.headers['user-agent'], requestId: request.id }
}

/** Firebase as an additional sign-in method: the browser SDK config, and sessions opened by a Firebase ID token. */
function registerFirebaseRoutes(app: FastifyInstance): void {
  app.get('/v1/auth/firebase-config', async () => {
    const firebase = requireFirebase(app.config.firebase)
    return envelope({
      api_key: firebase.webApiKey, auth_domain: firebase.authDomain, project_id: firebase.projectId, app_id: firebase.appId,
    })
  })

  const firebaseRoute = { config: { rateLimit: false as const }, preHandler: [signInRateLimit(app, firebaseTokenOf)] }

  app.post('/v1/auth/firebase-sessions', firebaseRoute, async (request, reply) => {
    requireFirebase(app.config.firebase)
    const body = parse(tenantFirebaseBody, request.body)
    const input = { ...(await firebaseInput(app, request, body)), realm: 'tenant' as const, tenantSlug: body.tenant }
    return respond(app, reply, await firebaseSignIn(app.config, input), FIREBASE_REFUSED)
  })

  app.post('/v1/auth/vendor-firebase-sessions', firebaseRoute, async (request, reply) => {
    requireFirebase(app.config.firebase)
    const body = parse(vendorFirebaseBody, request.body)
    const input = { ...(await firebaseInput(app, request, body)), realm: 'vendor' as const, tenantSlug: null }
    return respond(app, reply, await firebaseSignIn(app.config, input), FIREBASE_REFUSED)
  })
}

/** API-07: sign-in (tenant and vendor realms; password or Firebase), sign-out, invitation acceptance. */
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

  registerFirebaseRoutes(app)

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
