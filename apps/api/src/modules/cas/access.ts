import type { Tx } from '@nmp/db'
import { hasPermission, marketScope, type AuthContext } from '../../lib/auth.js'
import type { Permission } from '../../lib/permissions.js'
import { caseTypeOf, type CaseTypePermissions, type CaseTypeRegistry } from './types.js'

/**
 * The caller holds the permission over the market. A case without a market is in every holder's scope, as in
 * approval_eligible_users (PLAN B1 section 1.8).
 */
export function holdsFor(auth: AuthContext, permission: Permission, marketId: string | null): boolean {
  if (!hasPermission(auth, permission)) return false
  const scope = marketScope(auth, permission)
  return scope === null || marketId === null || scope.includes(marketId)
}

/** The permissions of every case type of the registry (AUD: who may upload evidence). */
export function casePermissions(registry: CaseTypeRegistry): readonly CaseTypePermissions[] {
  return [...registry.values()].map((definition) => definition.permissions)
}

/** The caller may read the case: its type is registered and the caller holds the type's read permission over its market. */
export async function canReadCase(tx: Tx, auth: AuthContext, caseId: string, registry: CaseTypeRegistry): Promise<boolean> {
  const { rows } = await tx.query<{ type: string; market_id: string | null }>(
    'SELECT type, market_id FROM case_file WHERE id = $1',
    [caseId],
  )
  const row = rows[0]
  const definition = row === undefined ? undefined : caseTypeOf(registry, row.type)
  return row !== undefined && definition !== undefined && holdsFor(auth, definition.permissions.read, row.market_id)
}
