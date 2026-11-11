import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { currentAuth, marketScope } from '../../lib/auth.js'
import { ApiError, permissionDenied } from '../../lib/errors.js'
import type { Permission } from '../../lib/permissions.js'
import type { MarketScope } from './batches.js'

/** Who may read mapping versions and a batch's partner codes: whoever drafts, approves or attaches mappings. */
export const MAPPING_READERS: readonly Permission[] = ['import.manage', 'mapping.edit', 'mapping.approve']

/** At least one of the permissions (lib's requirePermission needs all of them). */
export function requireAnyPermission(permissions: readonly Permission[]): preHandlerAsyncHookHandler {
  return async (request) => {
    const auth = currentAuth(request)
    if (!permissions.some((permission) => auth.permissions.has(permission))) throw permissionDenied()
  }
}

/** Union of the caller's market scopes over the permissions it holds: null = every market. */
export function scopeForAny(request: FastifyRequest, permissions: readonly Permission[]): MarketScope {
  const auth = currentAuth(request)
  const scopes = permissions.filter((permission) => auth.permissions.has(permission)).map((permission) => marketScope(auth, permission))
  if (scopes.some((scope) => scope === null)) return null
  return [...new Set(scopes.flatMap((scope) => scope ?? []))]
}

/** The caller's tenant (guards have already required the tenant realm). */
export function tenantOf(request: FastifyRequest): string {
  const { tenantId } = currentAuth(request)
  if (tenantId === null) throw new ApiError(403, 'REALM_FORBIDDEN', 'This endpoint is not available to your account type.')
  return tenantId
}
