// Display helpers shared by the admin and vendor console screens.

const MINUTES_PER_HOUR = 60
const MS_PER_MINUTE = 60_000
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT_ID_LENGTH = 8

/** A timestamp in the user's locale; "—" when absent. */
export function formatDateTime(value: string | null | undefined): string {
  return value === null || value === undefined ? '—' : DATE_TIME.format(new Date(value))
}

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
 * Support-session scopes a vendor user may request: the catalogue without participant.unmask (support/sessions.ts
 * scopePermission). The vendor realm cannot read GET /v1/roles, so the list is kept here; the API validates it.
 */
export const SUPPORT_SCOPE_PERMISSIONS: readonly string[] = Object.keys(PERMISSION_LABELS).filter(
  (permission) => permission !== 'participant.unmask',
)

/** null = every market of the tenant. */
export function marketScopeLabel(marketIds: readonly string[] | null): string {
  if (marketIds === null) return 'All markets'
  return marketIds.length === 1 ? '1 market' : `${marketIds.length} markets`
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
