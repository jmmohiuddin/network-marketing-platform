// Display helpers shared by the admin and vendor console screens.
import { countLabel } from '../../lib/format'
import type { Market } from '../../lib/markets'

const MINUTES_PER_HOUR = 60
const MS_PER_MINUTE = 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT_ID_LENGTH = 8

export { formatDateTime } from '../../lib/format'

/** 240 -> "4 h", 90 -> "1 h 30 min", 45 -> "45 min". */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = minutes % MINUTES_PER_HOUR
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/**
 * Time left until endsAt, rounded up to the minute ("2 h 41 min"); "Ended" once it has passed. Never more than the
 * window itself: `now` ticks (and the client clock may lag the server), so right after approval it can predate
 * startsAt and would read "1 h 1 min" for a 60-minute session (BUG-038).
 */
export function remainingLabel(endsAt: string, now: number, startsAt: string | null): string {
  const end = Date.parse(endsAt)
  const left = startsAt === null ? end - now : Math.min(end - now, end - Date.parse(startsAt))
  return left <= 0 ? 'Ended' : durationLabel(Math.ceil(left / MS_PER_MINUTE))
}

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/** First characters of an id, for tables (the full id is in the detail view). */
export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH)
}

const ACTOR_TYPES: Readonly<Record<string, string>> = { user: 'User', vendor_user: 'Vendor user', system: 'System' }

/** "Ada Admin (ada@acme.example)" when the actor is known, else "Vendor user 1a2b3c4d" or "System". */
export function actorLabel(actor: { readonly actor_type: string; readonly actor_id: string | null }, names: ReadonlyMap<string, string>): string {
  const kind = ACTOR_TYPES[actor.actor_type] ?? actor.actor_type
  if (actor.actor_id === null) return kind
  return names.get(actor.actor_id) ?? `${kind} ${shortId(actor.actor_id)}`
}

/** Labels for the permission catalogue (apps/api/src/lib/permissions.ts); unknown strings show as they are. */
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'import.manage': 'Upload and load data imports',
  'mapping.edit': 'Edit import mappings',
  'mapping.approve': 'Approve import mappings',
  'snapshot.create': 'Create compliance snapshots',
  'compliance.read': 'Read compliance reports',
  export: 'Export rows',
  'audit.read': 'Read the audit log',
  'vendor_access.decide': 'Decide vendor access requests',
  'settings.manage': 'Change tenant settings',
  'user.manage': 'Manage users and roles',
  'participant.unmask': 'See masked participant fields',
  'plan.activate': 'Activate compensation plans',
  'settings.approve': 'Approve money settings',
  'market.manage': 'Prepare market launches',
  'market.signoff': 'Sign off market launches',
  'integration.manage': 'Manage API keys and webhooks',
  'participant.read': 'View participants',
  'participant.manage': 'Enrol and manage participants',
  'participant.terminate': 'Terminate positions',
  'participant_type.approve': 'Approve participant types',
  'agreement.publish': 'Publish agreement versions',
  'genealogy.read': 'View genealogy',
  'case.genealogy.read': 'View genealogy cases',
  'case.genealogy.create': 'File genealogy cases',
  'case.genealogy.approve': 'Approve genealogy cases',
  'case.duplicate.read': 'View duplicate cases',
  'case.duplicate.create': 'Investigate duplicates',
  'case.duplicate.approve': 'Decide duplicate cases',
  'servicing.manage': 'Manage customer servicing',
  'order.read': 'View orders',
  'product.manage': 'Manage product volumes',
  'late.manage': 'Decide late transactions',
  'integration.read': 'View integration health',
  'privacy.manage': 'Approve privacy policies',
  'plan.read': 'View compensation plans',
  'plan.edit': 'Author plan versions',
  'plan.approve': 'Approve plan versions',
  'plan.simulate': 'Run plan simulations',
  'period.read': 'View periods and runs',
  'run.execute': 'Run calculations',
  'run.review': 'Review calculation runs',
  'run.commit': 'Commit calculation runs',
  'trace.read': 'View calculation traces',
  'restatement.request': 'Request restatements',
  'restatement.approve': 'Approve restatements',
  'case.restatement.read': 'View restatement cases',
  'guardrail.read': 'View plan guardrails',
  'override.approve': 'Override guardrail blocks',
  'ledger.read': 'View the ledger',
  'ledger.export': 'Export journals',
  'payout.read': 'View payout batches and reconciliation',
  'payout.prepare': 'Prepare payout batches',
  'payout.approve': 'Approve payout batches',
  'payout.reconcile': 'Reconcile payouts',
  'payout.hold': 'Place and release payout holds',
  'tax.manage': 'Manage tax profiles',
  'case.adjustment.read': 'View adjustment cases',
  'case.adjustment.create': 'Propose adjustments',
  'case.adjustment.approve': 'Approve adjustments',
  'case.write_off.read': 'View write-off cases',
  'case.write_off.create': 'Propose write-offs',
  'case.write_off.approve': 'Approve write-offs',
  'case.bank_detail.read': 'View bank-detail cases',
  'case.bank_detail.create': 'Request bank-detail changes',
  'case.bank_detail.approve': 'Approve bank-detail changes',
  'case.returned_payment.read': 'View returned-payment cases',
  'case.returned_payment.create': 'Handle returned payments',
  'case.dispute.read': 'View commission disputes',
  'case.dispute.approve': 'Decide commission disputes',
  'dashboard.exec': 'View the executive dashboard',
  'export.full': 'Export all tenant data',
  'migration.manage': 'Run data migrations',
  'migration.signoff': 'Sign off data migrations',
  'period.close': 'Close periods',
  'tax.read': 'View tax rules, withholding and year-end statements',
  'tax.forms': 'Generate and export year-end tax statements',
  'case.grievance.read': 'View grievances and the grievance register',
  'case.grievance.create': 'Record grievances',
  'case.grievance.approve': 'Resolve grievances',
  'register.read': 'View the delisted-seller register',
  'credit.read': 'View credit types, balances and redemptions',
  'credit.manage': 'Manage credit types',
  'fx.manage': 'Propose exchange rates',
  'fx.approve': 'Approve exchange rates',
  'legal_hold.manage': 'Place and release legal holds',
  'tenant.offboard': 'Confirm or cancel the account offboarding',
  'case.transfer.approve': 'Approve ownership transfers',
}

export function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission
}

/**
 * What a support session with each permission lets the vendor see. Sessions are read-only (GET only, FR-IAM-005),
 * so a scope names areas to view, never actions; unknown strings show as they are.
 */
const SUPPORT_SCOPE_LABELS: Readonly<Record<string, string>> = {
  'import.manage': 'Data imports',
  'mapping.edit': 'Import mappings (editor’s view)',
  'mapping.approve': 'Import mappings (approver’s view)',
  'snapshot.create': 'Compliance snapshots (creator’s view)',
  'compliance.read': 'Compliance reports',
  export: 'Row exports',
  'audit.read': 'Audit log',
  'vendor_access.decide': 'Vendor access requests',
  'settings.manage': 'Settings',
  'user.manage': 'Users and roles',
  'market.manage': 'Market launches',
  'participant.read': 'Participants',
  'genealogy.read': 'Genealogy',
  'case.genealogy.read': 'Genealogy cases',
  'case.duplicate.read': 'Duplicate cases',
  'order.read': 'Orders',
  'integration.read': 'Integration health',
  'plan.read': 'Compensation plans',
  'period.read': 'Periods and runs',
  'run.review': 'Calculation run review',
  'trace.read': 'Calculation traces',
  'case.restatement.read': 'Restatement cases',
  'guardrail.read': 'Plan guardrails',
  'ledger.read': 'Ledger',
  'payout.read': 'Payout batches and reconciliation',
  'case.adjustment.read': 'Adjustment cases',
  'case.write_off.read': 'Write-off cases',
  'case.bank_detail.read': 'Bank-detail cases',
  'case.returned_payment.read': 'Returned-payment cases',
  'case.dispute.read': 'Commission dispute cases',
  'dashboard.exec': 'Executive dashboard',
  'tax.read': 'Tax rules, withholding and year-end statements',
  'case.grievance.read': 'Grievance cases and register',
}

// BUG-048: areas with no screen to view yet (plans arrive in B3); never offered in a session request.
const AREAS_WITHOUT_SCREEN: ReadonlySet<string> = new Set(['plan.activate'])

/** The areas of GET /v1/support-sessions/limits a vendor user may ask for: those a session can show. */
export function requestableScopes(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => !AREAS_WITHOUT_SCREEN.has(scope))
}

export function supportScopeLabel(permission: string): string {
  return SUPPORT_SCOPE_LABELS[permission] ?? permission
}

/** The areas of a support session's scope, in words: "Compliance reports, Audit log". */
export function supportScopeText(permissions: readonly string[]): string {
  return permissions.map(supportScopeLabel).join(', ')
}

/** null = every market of the tenant; market codes once the markets are known, else how many. */
export function marketScopeLabel(marketIds: readonly string[] | null, markets: readonly Pick<Market, 'id' | 'code'>[] = []): string {
  if (marketIds === null) return 'All markets'
  const codes = marketIds.map((id) => markets.find((market) => market.id === id)?.code)
  if (codes.length > 0 && codes.every((code) => code !== undefined)) return codes.join(', ')
  return countLabel(marketIds.length, 'market')
}

export function personLabel(user: { readonly display_name: string | null; readonly email: string }): string {
  return user.display_name === null ? user.email : `${user.display_name} (${user.email})`
}

/** ISO timestamp -> value of an <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * MS_PER_MINUTE)
  return local.toISOString().slice(0, 16)
}

/** <input type="datetime-local"> value -> ISO timestamp; null when empty or not a date. */
export function fromLocalInput(value: string): string | null {
  if (value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** "2 queued · 1 running · 0 failed": counts only, never job data (AC-57.1). */
export function jobHealthLabel(health: { readonly queued: number; readonly running: number; readonly failed: number }): string {
  return `${health.queued} queued · ${health.running} running · ${health.failed} failed`
}

/** The tenant base roles and their permissions (apps/api/src/lib/permissions.ts BASE_ROLES, PLAN B1 to B6 and V1-A section 3). */
export const BASE_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'Tenant admin': [
    'user.manage', 'settings.manage', 'import.manage', 'mapping.edit', 'mapping.approve', 'compliance.read',
    'audit.read', 'vendor_access.decide', 'market.manage', 'integration.manage', 'participant.read', 'order.read',
    'product.manage', 'integration.read', 'ledger.export', 'export.full', 'tenant.offboard',
  ],
  'Commission analyst': [
    'compliance.read', 'participant.read', 'genealogy.read', 'case.genealogy.read', 'order.read', 'late.manage',
    'integration.read', 'plan.read', 'period.read', 'run.execute', 'run.review', 'trace.read', 'restatement.request',
    'case.restatement.read', 'ledger.read', 'case.adjustment.read', 'case.adjustment.create', 'case.write_off.read',
    'case.write_off.create', 'case.dispute.read', 'case.dispute.approve', 'credit.read', 'fx.manage',
  ],
  'Plan administrator': ['compliance.read', 'plan.read', 'plan.edit', 'plan.simulate', 'period.read', 'guardrail.read'],
  'Finance approver': [
    'compliance.read', 'participant.unmask', 'plan.activate', 'settings.approve', 'participant.read', 'order.read',
    'plan.read', 'period.read', 'run.review', 'run.commit', 'trace.read', 'restatement.approve', 'case.restatement.read',
    'ledger.read', 'ledger.export', 'payout.read', 'payout.approve', 'tax.manage', 'case.adjustment.read',
    'case.adjustment.approve', 'case.write_off.read', 'case.write_off.create', 'case.write_off.approve',
    'case.returned_payment.read', 'case.dispute.read', 'migration.signoff', 'period.close', 'tax.read', 'tax.forms',
    'credit.read', 'credit.manage', 'fx.manage', 'fx.approve',
  ],
  'Payout officer': [
    'participant.unmask', 'participant.read', 'ledger.read', 'payout.read', 'payout.prepare', 'payout.reconcile',
    'payout.hold', 'case.bank_detail.read', 'case.returned_payment.read', 'case.returned_payment.create', 'credit.read',
  ],
  'Compliance officer': [
    'mapping.approve', 'compliance.read', 'snapshot.create', 'export', 'audit.read', 'market.signoff',
    'participant.read', 'participant.terminate', 'participant_type.approve', 'agreement.publish', 'genealogy.read',
    'case.genealogy.read', 'case.genealogy.approve', 'case.duplicate.read', 'case.duplicate.approve', 'order.read',
    'plan.read', 'plan.approve', 'period.read', 'run.review', 'trace.read', 'restatement.request', 'case.restatement.read',
    'guardrail.read', 'override.approve', 'ledger.read', 'payout.read', 'payout.hold', 'case.adjustment.read',
    'case.write_off.read', 'case.bank_detail.read', 'case.bank_detail.approve', 'case.dispute.read', 'tax.read',
    'case.grievance.read', 'case.grievance.create', 'case.grievance.approve', 'register.read',
    'case.transfer.approve', 'legal_hold.manage',
  ],
  'Support agent': [
    'participant.read', 'participant.manage', 'genealogy.read', 'case.genealogy.read', 'case.genealogy.create',
    'case.duplicate.read', 'case.duplicate.create', 'servicing.manage', 'order.read', 'period.read', 'run.review',
    'trace.read', 'case.bank_detail.read', 'case.bank_detail.create', 'case.dispute.read', 'case.grievance.read',
    'case.grievance.create', 'credit.read',
  ],
  DPO: ['compliance.read', 'audit.read', 'participant.unmask', 'participant.read', 'privacy.manage', 'legal_hold.manage'],
  'Implementation consultant': ['import.manage', 'mapping.edit', 'plan.read', 'plan.edit', 'plan.simulate', 'period.read', 'migration.manage'],
  'Executive read-only': ['compliance.read', 'plan.read', 'period.read', 'dashboard.exec'],
  Integration: [],
}

const DECIDE_VENDOR_ACCESS = 'vendor_access.decide'

/**
 * BUG-047: base roles whose holders can approve a support session that includes this area. The approver decides
 * vendor access and holds the area over all markets (support/decisions.ts SUPPORT_SCOPE_NOT_HELD).
 */
export function supportApproverRoles(permission: string): string[] {
  return Object.entries(BASE_ROLE_PERMISSIONS)
    .filter(([, permissions]) => permissions.includes(DECIDE_VENDOR_ACCESS) && permissions.includes(permission))
    .map(([role]) => role)
}

/** Who can approve an area, in words, for the vendor's request dialog. */
export function supportApproverText(permission: string): string {
  const roles = supportApproverRoles(permission)
  return roles.length === 0
    ? 'No base role can approve this; the tenant needs a role that decides vendor access and holds this area.'
    : `Approved by: ${roles.join(', ')}`
}

export interface PermissionHolder {
  readonly permissions: readonly string[]
  readonly roles: readonly { readonly name: string; readonly market_ids: readonly string[] | null }[]
}

/**
 * BUG-047: the areas of a session request the signed-in user cannot approve, because they do not hold the area over
 * all markets. shortcut: a role's permissions are known for base roles only (GET /v1/me names roles, not their
 * permissions); a tenant role over all markets counts as holding what the user holds. The API decides either way.
 */
export function unapprovableAreas(holder: PermissionHolder, areas: readonly string[]): string[] {
  return areas.filter((area) => !holder.permissions.includes(area) || !holder.roles.some(
    (role) => role.market_ids === null && (BASE_ROLE_PERMISSIONS[role.name]?.includes(area) ?? true),
  ))
}
