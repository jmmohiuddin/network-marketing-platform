import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { notFound } from '../../lib/errors.js'
import type { Permission } from '../../lib/permissions.js'
import { apiKeyOrSession } from '../iam/index.js'
import { inScope } from '../ten/index.js'

/**
 * Route options of a write open to API keys with participants:write (PLAN B2 2.2/2.3) and to sessions holding the
 * permission. config.apiKey leaves key callers to the per-key limiter (D-B1-18).
 */
export function participantsWrite(app: FastifyInstance, permission: Permission): RouteShorthandOptions {
  return {
    config: { apiKey: true },
    preHandler: [apiKeyOrSession(app, 'participants:write', requireRealm('tenant'), requirePermission(permission))],
  }
}

/** The caller's tenant: the key's, else the session's (these routes require the tenant realm). */
export function callerTenant(request: FastifyRequest): string {
  return request.apiKey?.tenantId ?? currentAuth(request).tenantId!
}

/** Markets the caller may act in through the permission: null = all; a key acts on every market of its tenant. */
export function callerScope(request: FastifyRequest, permission: Permission): readonly string[] | null {
  return request.apiKey !== undefined ? null : marketScope(currentAuth(request), permission)
}

export interface ParticipantRef {
  readonly id: string
  readonly market_id: string
  readonly status: 'active' | 'merged'
}

/** The participant if it exists in the caller's markets, else 404 (lock: FOR UPDATE). */
export async function participantInScope(
  tx: Tx, id: string, scope: readonly string[] | null, lock = false,
): Promise<ParticipantRef> {
  const { rows } = await tx.query<ParticipantRef>(
    `SELECT id, market_id, status FROM participant WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  )
  const row = rows[0]
  if (row === undefined || !inScope(scope, row.market_id)) throw notFound()
  return row
}
