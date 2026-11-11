import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { currentAuth, requireAuth, type AuthContext } from '../../lib/auth.js'
import { inOwnRealm } from '../../lib/db.js'
import { envelope } from '../../lib/http.js'
import type { Permission } from '../../lib/permissions.js'

export interface NavigationEntry {
  readonly key: string
  readonly path: string
  readonly label: string
}

// Release A screens (MVP_A 1.3) and the permission each needs. The server decides what the user may open;
// every endpoint behind a screen checks again (SECURITY_IAM_TENANCY 4.1).
const TENANT_NAVIGATION: readonly (NavigationEntry & { readonly permission: Permission })[] = [
  { key: 'compliance', path: '/compliance', label: 'Compliance', permission: 'compliance.read' },
  { key: 'imports', path: '/imports', label: 'Data imports', permission: 'import.manage' },
  { key: 'users', path: '/settings/users', label: 'Users and roles', permission: 'user.manage' },
  { key: 'vendor_access', path: '/settings/vendor-access', label: 'Vendor access', permission: 'vendor_access.decide' },
  { key: 'audit', path: '/settings/audit', label: 'Audit log', permission: 'audit.read' },
  { key: 'settings', path: '/settings', label: 'Settings', permission: 'settings.manage' },
]
const VENDOR_NAVIGATION: readonly NavigationEntry[] = [{ key: 'console', path: '/vendor', label: 'Operations console' }]

function mfaPending(auth: AuthContext): boolean {
  return (auth.mfaRequired && !auth.mfaEnrolled) || (auth.mfaEnrolled && !auth.mfaVerified)
}

/** Navigation for the caller; empty while MFA is pending, because no page may be reached then (AC-35.1). */
export function navigationFor(auth: AuthContext): NavigationEntry[] {
  if (mfaPending(auth)) return []
  if (auth.realm === 'vendor') return [...VENDOR_NAVIGATION]
  return TENANT_NAVIGATION.filter((entry) => auth.permissions.has(entry.permission)).map(
    ({ key, path, label }) => ({ key, path, label }),
  )
}

async function loadProfile(tx: Tx, auth: AuthContext) {
  const user = await tx.query<{ id: string; email: string; display_name: string | null }>(
    'SELECT id, email, display_name FROM user_account WHERE id = $1',
    [auth.userId],
  )
  const tenant = auth.tenantId === null
    ? null
    : (await tx.query('SELECT id, slug, legal_name, region, state FROM tenant WHERE id = $1', [auth.tenantId])).rows[0]
  return { user: user.rows[0]!, tenant: tenant ?? null }
}

/** GET /v1/me: who am I, what may I do, what must I do next (MFA). Reachable while MFA is pending. */
export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/v1/me', { preHandler: [requireAuth()], config: { allowPendingMfa: true } }, async (request) => {
    const auth = currentAuth(request)
    const profile = await inOwnRealm(request, (tx) => loadProfile(tx, auth))
    return envelope({
      ...profile,
      realm: auth.realm,
      roles: auth.roles.map((role) => ({ assignment_id: role.assignmentId, role_id: role.roleId, name: role.name, market_ids: role.marketIds })),
      permissions: [...auth.permissions].sort(),
      mfa: { required: auth.mfaRequired, enrolled: auth.mfaEnrolled, verified: auth.mfaVerified },
      step_up_at: auth.stepUpAt,
      navigation: navigationFor(auth),
    })
  })
}
