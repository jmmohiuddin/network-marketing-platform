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
  {
    key: 'cases', path: '/cases', label: 'Cases',
    anyOf: [
      'case.genealogy.read', 'case.duplicate.read', 'case.restatement.read', 'case.adjustment.read', 'case.write_off.read',
      'case.bank_detail.read', 'case.returned_payment.read', 'case.dispute.read',
      // The privacy case type's read permission (prv/privacy-case.ts).
      'privacy.manage',
    ],
  },
  { key: 'orders', path: '/orders', label: 'Orders', anyOf: ['order.read', 'product.manage'] },
  { key: 'late', path: '/periods/late', label: 'Late transactions', anyOf: ['late.manage'] },
  { key: 'periods', path: '/periods', label: 'Periods and runs', anyOf: ['period.read'] },
  { key: 'plans', path: '/plans', label: 'Plans', anyOf: ['plan.read'] },
  { key: 'guardrails', path: '/compliance/guardrails', label: 'Guardrails', anyOf: ['guardrail.read'] },
  { key: 'ledger', path: '/ledger', label: 'Ledger and exports', anyOf: ['ledger.read'] },
  { key: 'payouts', path: '/payouts', label: 'Payouts', anyOf: ['payout.read'] },
  { key: 'reconciliation', path: '/payouts/reconciliation', label: 'Payout reconciliation', anyOf: ['payout.read'] },
  { key: 'privacy', path: '/privacy', label: 'Privacy requests', anyOf: ['privacy.manage'] },
]
const VENDOR_NAVIGATION: readonly NavigationEntry[] = [{ key: 'console', path: '/vendor', label: 'Operations console' }]

interface PortalProfile {
  positions: unknown[]
  can_sponsor: boolean
  has_downline: boolean
  terminated: boolean
}

/** UI_UX 4.4 bottom navigation: Team replaces Customers for a sponsor with a downline (Customers then moves to More). */
function portalNavigation(profile: PortalProfile): NavigationEntry[] {
  const team = profile.can_sponsor && profile.has_downline
  return [
    { key: 'home', path: '/portal', label: 'Home' },
    { key: 'earnings', path: '/portal/earnings', label: 'Earnings' },
    { key: 'rank', path: '/portal/rank', label: 'Rank' },
    team ? { key: 'team', path: '/portal/team', label: 'Team' } : { key: 'customers', path: '/portal/customers', label: 'Customers' },
    { key: 'more', path: '/portal/more', label: 'More' },
  ]
}

/**
 * FR-IAM-007 portal shape of GET /v1/me (PLAN B5 2.1): the participant from the session only, no roles or permissions.
 * While MFA is pending only the user, tenant and MFA state are returned: the password alone reveals no member data.
 */
async function portalMe(tx: Tx, auth: AuthContext) {
  const pending = mfaPending(auth)
  const { rows } = await tx.query<{ user: Profile['user']; tenant: unknown; participant: PortalProfile | null }>(
    `SELECT jsonb_build_object('id', u.id, 'email', u.email, 'display_name', u.display_name) AS "user",
            jsonb_build_object('slug', t.slug, 'legal_name', t.legal_name) AS tenant,
            CASE WHEN $2 THEN NULL ELSE portal_profile(u.participant_id) END AS participant
     FROM user_account u JOIN tenant t ON t.id = u.tenant_id WHERE u.id = $1`,
    [auth.userId, pending],
  )
  const { user, tenant, participant } = rows[0]!
  const profile = participant === null
    ? { participant: null, positions: [] }
    : {
        participant, positions: participant.positions, can_sponsor: participant.can_sponsor, has_downline: participant.has_downline,
        terminated: participant.terminated,
      }
  return {
    realm: 'portal' as const, user, tenant, ...profile, roles: [], permissions: [],
    mfa: { required: false, enrolled: auth.mfaEnrolled, verified: auth.mfaVerified }, step_up_at: auth.stepUpAt,
    navigation: participant === null ? [] : portalNavigation(participant),
  }
}

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
    if (auth.realm === 'portal') return envelope(await inOwnRealm(request, (tx) => portalMe(tx, auth)))
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
