import type { FastifyRequest } from 'fastify'
import { currentAuth } from '../../lib/auth.js'
import { ApiError } from '../../lib/errors.js'
import type { Permission } from '../../lib/permissions.js'

/** Who may read mapping versions and a batch's partner codes: whoever drafts, approves or attaches mappings. */
export const MAPPING_READERS: readonly Permission[] = ['import.manage', 'mapping.edit', 'mapping.approve']

/** The caller's tenant (guards have already required the tenant realm). */
export function tenantOf(request: FastifyRequest): string {
  const { tenantId } = currentAuth(request)
  if (tenantId === null) throw new ApiError(403, 'REALM_FORBIDDEN', 'This endpoint is not available to your account type.')
  return tenantId
}
