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

/** Time left until endsAt, rounded up to the minute ("2 h 41 min"); "Ended" once it has passed. */
export function remainingLabel(endsAt: string, now: number): string {
  const left = Date.parse(endsAt) - now
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
  'plan.activate': 'Compensation plans',
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
