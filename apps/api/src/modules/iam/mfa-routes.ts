import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, requireAuth } from '../../lib/auth.js'
import { inOwnRealm } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { setSessionCookie } from '../../lib/session.js'
import {
  auditFactorLocked, recordFactorSuccess, reserveFactorAttempt, startTotpEnrolment, verifyFactor, type FactorPurpose,
} from './mfa.js'

const codeBody = z.strictObject({ code: z.string().regex(/^\d{6}$/, 'must be the 6-digit code') })

async function checkFactor(request: FastifyRequest, reply: FastifyReply, purpose: FactorPurpose) {
  const { code } = parse(codeBody, request.body)
  const config = request.server.config
  const auth = currentAuth(request)
  if (!(await reserveFactorAttempt(config, auth.userId, request.ip))) {
    await inOwnRealm(request, (tx) => auditFactorLocked(tx, auth, purpose))
    throw new ApiError(429, 'MFA_LOCKED', 'Too many wrong codes. Try again later.')
  }
  const result = await inOwnRealm(request, (tx) => verifyFactor(tx, config, auth, code, purpose))
  if (result === null) {
    throw new ApiError(422, 'MFA_CODE_INVALID', 'The code is not valid. Enter the current code from your app.')
  }
  await recordFactorSuccess(auth.userId, request.ip)
  if (result.session !== null) setSessionCookie(reply, config, result.session.token, result.session.expiresAt)
  return envelope({ assurance: 'aal2', step_up_at: new Date() })
}

/**
 * FR-IAM-002: self-service TOTP enrolment, second factor at sign-in, step-up. Enrolment and sign-in
 * verification stay reachable while MFA is pending; step-up needs a verified session. No Idempotency-Key:
 * a replayed response would have to store the secret, and repeating these requests is safe.
 */
export function registerMfaRoutes(app: FastifyInstance): void {
  const pending = { preHandler: [requireAuth()], config: { allowPendingMfa: true } }

  app.post('/v1/auth/mfa/totp', pending, async (request, reply) => {
    const auth = currentAuth(request)
    const enrolment = await inOwnRealm(request, (tx) => startTotpEnrolment(tx, app.config, auth))
    reply.code(201)
    return envelope(enrolment)
  })

  app.post('/v1/auth/mfa/totp/confirm', pending, (request, reply) => checkFactor(request, reply, 'enrolment'))
  app.post('/v1/auth/sessions/current/mfa', pending, (request, reply) => checkFactor(request, reply, 'sign_in'))
  const verified = { preHandler: [requireAuth()] }
  app.post('/v1/auth/sessions/current/step-up', verified, (request, reply) => checkFactor(request, reply, 'step_up'))
}
