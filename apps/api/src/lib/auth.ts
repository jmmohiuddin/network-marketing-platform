import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { ApiError, permissionDenied, unauthenticated } from './errors.js'
import type { Permission } from './permissions.js'

export type Realm = 'tenant' | 'vendor'
export type Assurance = 'aal1' | 'aal2'

/** One active role assignment. marketIds null = every market of the tenant (SEC-26 attribute a); validTo null = open-ended. */
export interface RoleGrant {
  readonly assignmentId: string
  readonly roleId: string
  readonly name: string
  readonly permissions: readonly Permission[]
  readonly marketIds: readonly string[] | null
  readonly validTo: Date | null
}

/** Who is calling. Built from the session cookie only: the tenant id never comes from client input. */
export interface AuthContext {
  readonly realm: Realm
  readonly tenantId: string | null
  readonly userId: string
  readonly sessionId: string
  readonly roles: readonly RoleGrant[]
  readonly permissions: ReadonlySet<Permission>
  readonly assurance: Assurance
  /** A role of the user (or the vendor realm) requires MFA (SEC-03). */
  readonly mfaRequired: boolean
  readonly mfaEnrolled: boolean
  /** The second factor was verified in this session. */
  readonly mfaVerified: boolean
  readonly stepUpAt: Date | null
  readonly supportSessionId: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
  interface FastifyContextConfig {
    /** The route stays reachable while MFA enrolment or verification is pending (me, MFA, sign-out). */
    allowPendingMfa?: boolean
  }
}

function assertMfaSatisfied(auth: AuthContext): void {
  if (auth.mfaRequired && !auth.mfaEnrolled) {
    throw new ApiError(403, 'MFA_ENROLMENT_REQUIRED', 'Enrol a second factor to continue.')
  }
  if (auth.mfaEnrolled && !auth.mfaVerified) {
    throw new ApiError(403, 'MFA_VERIFICATION_REQUIRED', 'Enter the code from your authenticator app to continue.')
  }
}

/** The caller's context; 401 without a session, 403 while MFA is pending (unless the route allows it). */
export function currentAuth(request: FastifyRequest): AuthContext {
  const auth = request.auth
  if (auth === null) throw unauthenticated()
  if (request.routeOptions.config.allowPendingMfa !== true) assertMfaSatisfied(auth)
  return auth
}

export function hasPermission(auth: AuthContext, permission: Permission): boolean {
  return auth.permissions.has(permission)
}

/** Markets the caller may see through this permission: null = all markets, [] = none. */
export function marketScope(auth: AuthContext, permission: Permission): readonly string[] | null {
  const grants = auth.roles.filter((role) => role.permissions.includes(permission))
  if (grants.some((grant) => grant.marketIds === null)) return null
  return [...new Set(grants.flatMap((grant) => grant.marketIds ?? []))]
}

/** 403 STEP_UP_REQUIRED unless a second factor was verified within maxAgeSeconds (SEC-20). */
export function assertStepUp(request: FastifyRequest, maxAgeSeconds?: number): void {
  const auth = currentAuth(request)
  const window = (maxAgeSeconds ?? request.server.config.stepUpMaxAgeSeconds) * 1000
  if (auth.stepUpAt === null || Date.now() - auth.stepUpAt.getTime() > window) {
    throw new ApiError(403, 'STEP_UP_REQUIRED', 'Confirm with your second factor to continue.')
  }
}

export function requireAuth(): preHandlerAsyncHookHandler {
  return async (request) => {
    currentAuth(request)
  }
}

export function requireRealm(realm: Realm): preHandlerAsyncHookHandler {
  return async (request) => {
    if (currentAuth(request).realm !== realm) {
      throw new ApiError(403, 'REALM_FORBIDDEN', 'This endpoint is not available to your account type.')
    }
  }
}

/** All listed permissions are required. */
export function requirePermission(...permissions: Permission[]): preHandlerAsyncHookHandler {
  return async (request) => {
    const auth = currentAuth(request)
    if (!permissions.every((permission) => auth.permissions.has(permission))) throw permissionDenied()
  }
}

export function requireStepUp(maxAgeSeconds?: number): preHandlerAsyncHookHandler {
  return async (request) => {
    assertStepUp(request, maxAgeSeconds)
  }
}
