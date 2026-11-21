import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requireAuth, requirePortal, type AuthContext } from '../../lib/auth.js'
import { inOwnRealm, inPortal, runInVendor } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { LOCALE_LABELS, portalLocale } from '../../lib/locale.js'
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
  // PLAN B6 section 1.9: first, so the Executive lands on the overview.
  { key: 'overview', path: '/overview', label: 'Overview', anyOf: ['dashboard.exec'] },
  { key: 'compliance', path: '/compliance', label: 'Compliance', anyOf: ['compliance.read'] },
  { key: 'imports', path: '/imports', label: 'Data imports', anyOf: ['import.manage'] },
  { key: 'migration', path: '/imports/migration', label: 'Migration', anyOf: ['migration.manage', 'migration.signoff'] },
  { key: 'users', path: '/settings/users', label: 'Users and roles', anyOf: ['user.manage'] },
  { key: 'vendor_access', path: '/settings/vendor-access', label: 'Vendor access', anyOf: ['vendor_access.decide'] },
  { key: 'audit', path: '/settings/audit', label: 'Audit log', anyOf: ['audit.read'], allMarkets: true },
  {
    key: 'settings', path: '/settings', label: 'Settings',
    anyOf: ['settings.manage', 'settings.approve', 'participant_type.approve', 'privacy.manage', 'agreement.publish', 'tenant.offboard'],
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
      // PLAN B-MKT section 1.9: grievances and the market-pack registers (/cases/registers).
      'case.grievance.read', 'register.read',
    ],
  },
  { key: 'orders', path: '/orders', label: 'Orders', anyOf: ['order.read', 'product.manage'] },
  { key: 'late', path: '/periods/late', label: 'Late transactions', anyOf: ['late.manage'] },
  { key: 'periods', path: '/periods', label: 'Periods and runs', anyOf: ['period.read'] },
  { key: 'plans', path: '/plans', label: 'Plans', anyOf: ['plan.read'] },
  { key: 'guardrails', path: '/compliance/guardrails', label: 'Guardrails', anyOf: ['guardrail.read'] },
  // V1-A: the Credits tab (credit.read) and the Exchange rates tab (fx.manage, fx.approve) live on the ledger page.
  { key: 'ledger', path: '/ledger', label: 'Ledger and exports', anyOf: ['ledger.read', 'credit.read', 'fx.manage', 'fx.approve'] },
  { key: 'tax', path: '/tax', label: 'Tax', anyOf: ['tax.read'] },
  { key: 'payouts', path: '/payouts', label: 'Payouts', anyOf: ['payout.read'] },
  { key: 'reconciliation', path: '/payouts/reconciliation', label: 'Payout reconciliation', anyOf: ['payout.read'] },
  { key: 'privacy', path: '/privacy', label: 'Privacy requests', anyOf: ['privacy.manage', 'legal_hold.manage'] },
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
 * While MFA is pending only the user, tenant, MFA state and language are returned: the password alone reveals no member
 * data. D-BM-11: the effective locale, the locales the market offers and its default.
 */
async function portalMe(tx: Tx, request: FastifyRequest, auth: AuthContext) {
  const pending = mfaPending(auth)
  const { rows } = await tx.query<{ user: Profile['user']; tenant: unknown; participant: PortalProfile | null }>(
    `SELECT jsonb_build_object('id', u.id, 'email', u.email, 'display_name', u.display_name) AS "user",
            jsonb_build_object('slug', t.slug, 'legal_name', t.legal_name, 'state', t.state, 'read_only', tenant_read_only(t.id)) AS tenant,
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
  const { locale, offered, defaultLocale } = await portalLocale(tx, request)
  return {
    realm: 'portal' as const, user, tenant, ...profile, roles: [], permissions: [],
    locale, locales: offered.map((code) => ({ code, label: LOCALE_LABELS[code] })), default_locale: defaultLocale,
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

const localeBody = z.strictObject({ locale: z.string().regex(/^[a-z]{2}$/, 'must be a two-letter language code') })

const USER_SELECT = 'SELECT id, email, display_name FROM user_account WHERE id = $1'

interface Profile {
  user: { id: string; email: string; display_name: string | null }
  tenant: unknown
  support_session: { id: string; tenant_slug: string; ends_at: Date | null; scope: unknown } | null
}

async function loadTenant(tx: Tx, auth: AuthContext): Promise<unknown> {
  if (auth.tenantId === null) return null
  // D-V1A-07: read_only drives the read-only notice and hides write controls.
  const { rows } = await tx.query(
    'SELECT id, slug, legal_name, region, state, tenant_read_only(id) AS read_only FROM tenant WHERE id = $1', [auth.tenantId],
  )
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
    if (auth.realm === 'portal') return envelope(await inOwnRealm(request, (tx) => portalMe(tx, request, auth)))
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

  // D-BM-11: the portal user's language, one of the locales the participant's market offers.
  app.put('/v1/me/locale', { preHandler: [requirePortal()] }, async (request) => {
    const { locale } = parse(localeBody, request.body)
    const auth = currentAuth(request)
    return envelope(await inPortal(request, async (tx) => {
      const { offered } = await portalLocale(tx, request)
      if (!(offered as readonly string[]).includes(locale)) {
        throw new ApiError(422, 'LOCALE_NOT_OFFERED', 'This language is not offered in your market.', { offered })
      }
      await tx.query('UPDATE user_account SET locale = $1 WHERE id = $2', [locale, auth.userId])
      await recordAudit(tx, { action: 'PORTAL_LOCALE.CHANGED', objectType: 'user_account', objectId: auth.userId, after: { user_id: auth.userId } })
      return { locale }
    }))
  })
}
