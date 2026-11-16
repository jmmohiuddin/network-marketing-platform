import type { preHandlerAsyncHookHandler } from 'fastify'
import { currentAuth, marketScope, type AuthContext } from '../../lib/auth.js'
import { permissionDenied } from '../../lib/errors.js'
import type { Permission } from '../../lib/permissions.js'

/** Any one of the listed permissions is enough. */
export function requireAnyPermission(...permissions: Permission[]): preHandlerAsyncHookHandler {
  return async (request) => {
    const auth = currentAuth(request)
    if (!permissions.some((permission) => auth.permissions.has(permission))) throw permissionDenied()
  }
}

/** Markets reachable through any of the permissions the caller holds: null = all markets, [] = none. */
export function scopeOfAny(auth: AuthContext, permissions: readonly Permission[]): readonly string[] | null {
  const scopes = permissions.filter((permission) => auth.permissions.has(permission)).map((permission) => marketScope(auth, permission))
  if (scopes.some((scope) => scope === null)) return null
  return [...new Set(scopes.flatMap((scope) => scope ?? []))]
}

export function inScope(scope: readonly string[] | null, marketId: string): boolean {
  return scope === null || scope.includes(marketId)
}
