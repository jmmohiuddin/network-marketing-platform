import type { Permission } from '../../lib/permissions.js'

/**
 * API key scope catalogue (FR-IAM-006, D-B1-05): a key caller's only authority. Colon namespace, never a role
 * permission. B2 adds participants:write and orders:write (PLAN B2 section 2.8), B4 ledger:export (D-B4-19), B6 exports:full
 * (PLAN B6 section 1.9).
 * `permissions`: the session permissions whoever mints or rotates a key with the scope must hold for all markets, because
 * a key acts on every market of the tenant: a key never does more than its minter could do in a session.
 */
export const API_SCOPES = [
  { scope: 'compliance:read', description: 'Read compliance snapshots', personal_data: false, permissions: ['compliance.read'] },
  {
    scope: 'participants:write',
    description: 'Enrol participants and record types, positions, agreements, signals and servicing',
    personal_data: true,
    permissions: ['integration.manage', 'participant.manage', 'servicing.manage'],
  },
  { scope: 'orders:write', description: 'Send orders and order events', personal_data: false, permissions: ['integration.manage'] },
  { scope: 'ledger:export', description: 'Create and download GL journal exports', personal_data: false, permissions: ['ledger.export'] },
  { scope: 'exports:full', description: 'Create and download full data exports', personal_data: true, permissions: ['export.full'] },
] as const satisfies readonly { scope: string; description: string; personal_data: boolean; permissions: readonly Permission[] }[]

export type ApiScope = (typeof API_SCOPES)[number]['scope']

const SCOPE_SET: ReadonlySet<string> = new Set(API_SCOPES.map((entry) => entry.scope))

export function isApiScope(value: string): value is ApiScope {
  return SCOPE_SET.has(value)
}
