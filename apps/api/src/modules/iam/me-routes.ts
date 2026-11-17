import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { currentAuth, marketScope, requireAuth, type AuthContext } from '../../lib/auth.js'
import { inOwnRealm, runInVendor } from '../../lib/db.js'
import { envelope } from '../../lib/http.js'
import type { Permission } from '../../lib/permissions.js'
import { getSupportSession } from '../support/index.js'

export interface NavigationEntry {
  readonly key: string
  readonly path: string
  readonly label: string
}

// Screens and the permissions that open them (any one of anyOf). The server decides what the user may open; every
// endpoint behind a screen checks again (SECURITY_IAM_TENANCY 4.1).
// allMarkets: the screen manages tenant-wide objects, so the permission must be held for all markets.
const TENANT_NAVIGATION: readonly (NavigationEntry & { readonly anyOf: readonly Permission[]; readonly allMarkets?: true })[] = [
  { key: 'compliance', path: '/compliance', label: 'Compliance', anyOf: ['compliance.read'] },
  { key: 'imports', path: '/imports', label: 'Data imports', anyOf: ['import.manage'] },
  { key: 'users', path: '/settings/users', label: 'Users and roles', anyOf: ['user.manage'] },
  { key: 'vendor_access', path: '/settings/vendor-access', label: 'Vendor access', anyOf: ['vendor_access.decide'] },
  { key: 'audit', path: '/settings/audit', label: 'Audit log', anyOf: ['audit.read'], allMarkets: true },
  {
    key: 'settings', path: '/settings', label: 'Settings',
    anyOf: ['settings.manage', 'settings.approve', 'participant_type.approve', 'privacy.manage', 'agreement.publish'],
  },
  { key: 'markets', path: '/settings/markets', label: 'Markets', anyOf: ['settings.manage', 'market.manage', 'market.signoff'] },
  { key: 'integrations', path: '/settings/integrations', label: 'Integrations', anyOf: ['integration.manage', 'integration.read'], allMarkets: true },
  { key: 'people', path: '/people', label: 'People', anyOf: ['participant.read'] },
  { key: 'genealogy', path: '/genealogy', label: 'Genealogy', anyOf: ['genealogy.read'], allMarkets: true },
  { key: 'cases', path: '/cases', label: 'Cases', anyOf: ['case.genealogy.read', 'case.duplicate.read', 'case.restatement.read'] },
  { key: 'orders', path: '/orders', label: 'Orders', anyOf: ['order.read', 'product.manage'] },
  { key: 'late', path: '/periods/late', label: 'Late transactions', anyOf: ['late.manage'] },
  { key: 'periods', path: '/periods', label: 'Periods and runs', anyOf: ['period.read'] },
  { key: 'plans', path: '/plans', label: 'Plans', anyOf: ['plan.read'] },
  { key: 'guardrails', path: '/compliance/guardrails', label: 'Guardrails', anyOf: ['guardrail.read'] },
]
const VENDOR_NAVIGATION: readonly NavigationEntry[] = [{ key: 'console', path: '/vendor', label: 'Operations console' }]

function mfaPending(auth: AuthContext): boolean {
  return (auth.mfaRequired && !auth.mfaEnrolled) || (auth.mfaEnrolled && !auth.mfaVerified)
}

/** Navigation for the caller; empty while MFA is pending, because no page may be reached then (AC-35.1). */
export function navigationFor(auth: AuthContext): NavigationEntry[] {
  if (mfaPending(auth)) return []
  if (auth.realm === 'vendor') return [...VENDOR_NAVIGATION]
  const opens = (permission: Permission, allMarkets: boolean) =>
    auth.permissions.has(permission) && (!allMarkets || marketScope(auth, permission) === null)
  return TENANT_NAVIGATION.filter((entry) => entry.anyOf.some((permission) => opens(permission, entry.allMarkets === true))).map(
    ({ key, path, label }) => ({ key, path, label }),
  )
}

const USER_SELECT = 'SELECT id, email, display_name FROM user_account WHERE id = $1'

interface Profile {
  user: { id: string; email: string; display_name: string | null }
  tenant: unknown
  support_session: { id: string; tenant_slug: string; ends_at: Date | null; scope: unknown } | null
}

async function loadTenant(tx: Tx, auth: AuthContext): Promise<unknown> {
  if (auth.tenantId === null) return null
  const { rows } = await tx.query('SELECT id, slug, legal_name, region, state FROM tenant WHERE id = $1', [auth.tenantId])
  return rows[0] ?? null
}

async function loadProfile(tx: Tx, auth: AuthContext): Promise<Profile> {
  const user = await tx.query<Profile['user']>(USER_SELECT, [auth.userId])
  return { user: user.rows[0]!, tenant: await loadTenant(tx, auth), support_session: null }
}

/**
 * A vendor inside a support session works in the tenant's realm, where vendor users are invisible (RLS): the tenant
 * and the session are read there, the vendor user through the vendor realm.
 */
async function loadSupportProfile(request: FastifyRequest, auth: AuthContext, sessionId: string): Promise<Profile> {
  const inSession = await inOwnRealm(request, async (tx) => {
    const { id, tenant_slug, ends_at, scope } = await getSupportSession(tx, sessionId)
    return { tenant: await loadTenant(tx, auth), support_session: { id, tenant_slug, ends_at, scope } }
  })
  const actor = { actorType: 'vendor_user' as const, requestId: request.id, supportSessionId: sessionId }
  const user = await runInVendor(auth.userId, actor, (tx) => tx.query<Profile['user']>(USER_SELECT, [auth.userId]))
  return { user: user.rows[0]!, ...inSession }
}

/** GET /v1/me: who am I, what may I do, what must I do next (MFA). Reachable while MFA is pending. */
export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/v1/me', { preHandler: [requireAuth()], config: { allowPendingMfa: true } }, async (request) => {
    const auth = currentAuth(request)
    const profile = auth.supportSessionId === null
      ? await inOwnRealm(request, (tx) => loadProfile(tx, auth))
      : await loadSupportProfile(request, auth, auth.supportSessionId)
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
