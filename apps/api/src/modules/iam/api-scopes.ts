import type { Permission } from '../../lib/permissions.js'

/**
 * API key scope catalogue (FR-IAM-006, D-B1-05): a key caller's only authority. Colon namespace, never a role
 * permission. Later increments add orders:write and participants:write (B2), ledger:export (B4).
 * `permission`: the session permission whoever mints or rotates a key with the scope must hold for all markets, because
 * a key reads every market of the tenant.
 */
export const API_SCOPES = [
  { scope: 'compliance:read', description: 'Read compliance snapshots', personal_data: false, permission: 'compliance.read' },
] as const satisfies readonly { scope: string; description: string; personal_data: boolean; permission: Permission }[]

export type ApiScope = (typeof API_SCOPES)[number]['scope']

const SCOPE_SET: ReadonlySet<string> = new Set(API_SCOPES.map((entry) => entry.scope))

export function isApiScope(value: string): value is ApiScope {
  return SCOPE_SET.has(value)
}
