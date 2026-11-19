// Display helpers for the markets pages and the launch checklist (SC-17).
import { ApiError } from '../../lib/api'
import { countLabel } from '../../lib/format'
import { SUPPORT_SESSION_HEADER, supportSessionFor } from '../../lib/support-session'
import { BASE_ROLE_PERMISSIONS, type PermissionHolder } from '../admin/format'
import { errorFrom } from '../data/transfer'
import type { BasisStatus, ItemCategory, ItemStatus } from './types'

/** market_references / brand_references keys (PLAN B1 1.8) as counted nouns. */
const REFERENCE_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  calendars: ['calendar', 'calendars'],
  imports: ['import batch', 'import batches'],
  snapshots: ['compliance snapshot', 'compliance snapshots'],
  fact_participants: ['imported participant', 'imported participants'],
  providers: ['provider record', 'provider records'],
  checklist_entries: ['checklist entry', 'checklist entries'],
  go_live_requests: ['go-live request', 'go-live requests'],
  cases: ['case', 'cases'],
  grants: ['role grant', 'role grants'],
}

/** {calendars: 1, grants: 2} -> "1 calendar, 2 role grants" (zero counts left out). */
export function referencesText(references: Readonly<Record<string, number>>): string {
  return Object.entries(references)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const [one, many] = REFERENCE_NOUNS[key] ?? [key, key]
      return countLabel(count, one, many)
    })
    .join(', ')
}

/**
 * The refusals of the structure routes in words: what references the object (MARKET_REFERENCED, BRAND_REFERENCED) or
 * why a calendar cannot change. Other errors are returned unchanged.
 */
export function explainRefusal(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  const details = (error.details ?? {}) as { references?: Record<string, number>; periods_not_open?: number }
  const reword = (message: string) => new ApiError(error.status, error.code, message, error.details, error.requestId)
  switch (error.code) {
    case 'MARKET_REFERENCED':
    case 'BRAND_REFERENCED': {
      const what = details.references === undefined ? '' : referencesText(details.references)
      return what === '' ? error : reword(`${error.message} It is referenced by ${what}.`)
    }
    case 'PERIOD_COMMITTED':
      return reword(`The calendar cannot be deleted: ${countLabel(details.periods_not_open ?? 0, 'period is', 'periods are')} past open.`)
    case 'CALENDAR_TIMING_IMMUTABLE':
      return reword('A calendar’s market, cadence, cut-off time zone and first period never change. Delete it and create a new one while every period is open.')
    default:
      return error
  }
}

/** A period bound in the calendar's cut-off time zone ("1 Jan 2027, 00:00"), where its local midnight is visible. */
export function localBound(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone }).format(new Date(iso))
}

/** Item status -> StatusBadge state and label. */
export const ITEM_STATUS: Readonly<Record<ItemStatus, { readonly state: string; readonly label: string }>> = {
  complete: { state: 'ready', label: 'Complete' },
  missing: { state: 'blocked', label: 'Missing' },
  needs_risk_acceptance: { state: 'under_review', label: 'Needs risk acceptance' },
}

/** FR-CPL-012 basis status -> StatusBadge state and label (the rule's own status, never a legal conclusion). */
export const BASIS_STATUS: Readonly<Record<BasisStatus, { readonly state: string; readonly label: string }>> = {
  screening: { state: 'under_review', label: 'Screening' },
  primary_read: { state: 'reviewed', label: 'Primary read' },
  counsel_confirmed: { state: 'accepted', label: 'Counsel confirmed' },
}

export const KIND_LABELS = { evidence: 'Evidence', attestation: 'Attestation', provider: 'Provider approval', automatic: 'Automatic check' } as const

/** sc_17 filter tabs -> item categories (data region sits with regulatory items). */
export const CATEGORY_TABS: readonly { readonly id: string; readonly label: string; readonly categories: readonly ItemCategory[] }[] = [
  { id: 'all', label: 'All', categories: ['regulatory', 'payment', 'tax', 'plan', 'data'] },
  { id: 'regulatory', label: 'Regulatory and legal', categories: ['regulatory', 'data'] },
  { id: 'payment', label: 'Payment and payout', categories: ['payment'] },
  { id: 'tax', label: 'Taxation', categories: ['tax'] },
  { id: 'plan', label: 'Plan and disclosures', categories: ['plan'] },
]

const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
}

/** GET /v1/documents/limits types -> file extensions for FileDropZone. */
export function extensionsOf(types: readonly string[]): string[] {
  return types.flatMap((type) => EXTENSIONS[type] ?? [])
}

export function documentHref(id: string): string {
  return `/v1/documents/${id}/content`
}

/**
 * GET a document's bytes with the support-session header, which a plain download link cannot send (vendor support
 * sessions read the tenant only with X-Support-Session, apps/api support/access.ts).
 */
export async function fetchDocument(id: string): Promise<Blob> {
  const session = supportSessionFor(window.location.pathname)
  let response: Response
  try {
    response = await fetch(documentHref(id), { headers: session === null ? {} : { [SUPPORT_SESSION_HEADER]: session }, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The request did not reach the service.')
  }
  if (!response.ok) throw errorFrom(response.status, await response.text(), response.headers.get('x-request-id'))
  return response.blob()
}

/** The markets a user holds a permission in: every market, or the ids their role grants name. */
export type MarketScope = 'all' | ReadonlySet<string>

/**
 * Scope of a permission from GET /v1/me roles (null market_ids = all markets). shortcut: /v1/me names roles, not their
 * permissions, so a role that is not a base role counts as holding it (as admin/format unapprovableAreas does); the
 * API decides either way.
 */
export function marketScope(holder: PermissionHolder, permission: string): MarketScope {
  if (!holder.permissions.includes(permission)) return new Set()
  const holding = holder.roles.filter((role) => BASE_ROLE_PERMISSIONS[role.name]?.includes(permission) ?? true)
  if (holding.some((role) => role.market_ids === null)) return 'all'
  return new Set(holding.flatMap((role) => role.market_ids ?? []))
}

export function inScope(scope: MarketScope, marketId: string): boolean {
  return scope === 'all' || scope.has(marketId)
}

/** D-B4-20 review chip of a recorded provider: overdue once the date has passed, else due on the date; none without a date. */
export function reviewChip(reviewDueOn: string | null, today: string): { readonly state: string; readonly label: string } | null {
  if (reviewDueOn === null) return null
  return reviewDueOn < today ? { state: 'lapsed', label: 'Review overdue' } : { state: 'scheduled', label: `Review due ${reviewDueOn}` }
}

/** Today's date in the browser (YYYY-MM-DD), for dates that cannot be in the future. */
export function todayLocal(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
