import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import type { FirebaseSettings } from '../../config.js'
import { ApiError } from '../../lib/errors.js'

declare module 'fastify' {
  interface FastifyInstance {
    /** Keys that sign Firebase ID tokens: Google's published set, or a local one in tests (BuildAppOptions). */
    firebaseKeys: JWTVerifyGetKey
  }
}

// Google's signing keys for Firebase ID tokens. jose caches the set and refetches it when a token names an unknown key.
const GOOGLE_KEYS_URL = new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
// Created once per process, so every app instance shares one cache; nothing is fetched until the first token.
export const googleFirebaseKeys: JWTVerifyGetKey = createRemoteJWKSet(GOOGLE_KEYS_URL)

const CLOCK_TOLERANCE_SECONDS = 30
// Firebase ID tokens are valid for one hour from iat.
const MAX_TOKEN_AGE_SECONDS = 3600
const SUBJECT_MAX = 128
// The agreed methods. Any other provider (SAML, OIDC, custom tokens, another social IdP), or a token of an Identity
// Platform tenant, is refused even if enabled in the project later: its email_verified is not Google's word.
const ALLOWED_PROVIDERS = new Set(['google.com', 'password'])

const TOKEN_ERRORS = [
  errors.JWSSignatureVerificationFailed, errors.JWTClaimValidationFailed, errors.JWTExpired, errors.JWSInvalid, errors.JWTInvalid,
  errors.JOSEAlgNotAllowed, errors.JOSENotSupported, errors.JWKSNoMatchingKey, errors.JWKSMultipleMatchingKeys,
]

/** Who a verified Firebase ID token proves the caller to be. */
export interface FirebaseIdentity {
  readonly subject: string
  readonly email: string
  /** firebase.sign_in_provider: google.com or password. */
  readonly provider: string
}

export const firebaseDisabled = (): ApiError =>
  new ApiError(404, 'FIREBASE_DISABLED', 'Firebase sign-in is not enabled.')
/** One answer for a bad token and for an account that cannot sign in (unknown, inactive, bound elsewhere). */
export const FIREBASE_REFUSED = 'The sign-in could not be completed.'
const invalidToken = (): ApiError => new ApiError(401, 'INVALID_CREDENTIALS', FIREBASE_REFUSED)

/** The settings, or 404 FIREBASE_DISABLED. */
export function requireFirebase(settings: FirebaseSettings | null): FirebaseSettings {
  if (settings === null) throw firebaseDisabled()
  return settings
}

async function verifiedClaims(token: string, projectId: string, keys: JWTVerifyGetKey): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: MAX_TOKEN_AGE_SECONDS, // also refuses an iat in the future
      requiredClaims: ['exp', 'iat', 'sub', 'auth_time'],
    })
    return payload
  } catch (error) {
    // Only a token that fails verification is the caller's fault; anything else (Google's key set cannot be fetched or
    // read, which jose may report as a plain JOSEError) is ours and surfaces as a 500.
    if (TOKEN_ERRORS.some((type) => error instanceof type)) throw invalidToken()
    throw error
  }
}

function authTimePassed(claims: JWTPayload): boolean {
  const authTime = claims.auth_time
  return typeof authTime === 'number' && authTime <= Date.now() / 1000 + CLOCK_TOLERANCE_SECONDS
}

/** firebase.sign_in_provider when it is an allowed one and the token belongs to no Identity Platform tenant, else null. */
function allowedProvider(claims: JWTPayload): string | null {
  const firebase = claims.firebase as { sign_in_provider?: unknown; tenant?: unknown } | undefined
  const provider = firebase?.sign_in_provider
  if (firebase?.tenant !== undefined || typeof provider !== 'string' || !ALLOWED_PROVIDERS.has(provider)) return null
  return provider
}

/**
 * Verifies a Firebase ID token (signature by Google's key, RS256 only, issuer and audience of this project, not
 * expired, issued and authenticated in the past, Google or email/password sign-in, no tenant) and returns the identity it proves. A bad token is 401
 * INVALID_CREDENTIALS; a good token whose email is not verified is 401 EMAIL_NOT_VERIFIED (the token is the caller's
 * own, so this says nothing about accounts here).
 */
export async function verifyFirebaseToken(
  token: string, settings: FirebaseSettings, keys: JWTVerifyGetKey,
): Promise<FirebaseIdentity> {
  const claims = await verifiedClaims(token, settings.projectId, keys)
  const subject = claims.sub ?? ''
  const provider = allowedProvider(claims)
  if (subject.length === 0 || subject.length > SUBJECT_MAX || !authTimePassed(claims) || provider === null) throw invalidToken()
  if (typeof claims.email !== 'string' || claims.email_verified !== true) {
    throw new ApiError(401, 'EMAIL_NOT_VERIFIED', 'Verify your email address with the sign-in provider first.')
  }
  return { subject, email: claims.email.toLowerCase(), provider }
}
