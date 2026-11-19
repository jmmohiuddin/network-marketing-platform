import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { decodeRefs } from '../../lib/audit.js'
import { notFound } from '../../lib/errors.js'
import { PERMISSIONS, type Permission } from '../../lib/permissions.js'

// shortcut: E-ADR-10 engineering values (OQ-A8 leaves the tenant maximum and the request expiry open); move them
// to tenant settings / config once the founder sets them.
/** Longest support session a request may ask for (minutes). */
export const SUPPORT_SESSION_MAX_MINUTES = 480
/** An undecided request is auto-denied after this many minutes (SECURITY_IAM_TENANCY note 10). */
export const REQUEST_TTL_MINUTES = 1440

/**
 * Vendor staff never unmask participants, approve money settings, sign off market launches or mint integration
 * credentials (tenant-own decisions, PLAN B1 3), never hold the B2 deciding and privacy permissions, and are not offered
 * permissions that only write (meaningless in a read-only session, PLAN B2 3): every other one may be requested.
 */
const SUPPORT_EXCLUDED_PERMISSIONS = [
  'participant.unmask', 'settings.approve', 'market.signoff', 'integration.manage',
  'participant.terminate', 'participant_type.approve', 'agreement.publish', 'case.genealogy.approve', 'case.duplicate.approve',
  'privacy.manage',
  'participant.manage', 'case.genealogy.create', 'case.duplicate.create', 'servicing.manage', 'product.manage', 'late.manage',
  // PLAN B3 section 2.7: authoring, approving, running, committing and overriding stay with the tenant.
  'plan.edit', 'plan.approve', 'plan.activate', 'plan.simulate', 'run.execute', 'run.commit', 'restatement.request',
  'restatement.approve', 'override.approve',
  // PLAN B4 section 2.6: preparing, approving and reconciling money stays with the tenant (reads stay possible).
  'payout.prepare', 'payout.approve', 'payout.reconcile', 'payout.hold', 'ledger.export', 'tax.manage', 'case.adjustment.create',
  'case.adjustment.approve', 'case.write_off.create', 'case.write_off.approve', 'case.bank_detail.create', 'case.bank_detail.approve',
  'case.returned_payment.create',
  // PLAN B5 section 3: deciding a dispute stays with the tenant (reading stays requestable).
  'case.dispute.approve',
] as const satisfies readonly Permission[]
export const scopePermission = z.enum(PERMISSIONS).exclude(SUPPORT_EXCLUDED_PERMISSIONS)
export type ScopePermission = z.infer<typeof scopePermission>

/**
 * support_session.scope: the permissions requested (read-only, FR-IAM-005) and the requester's recorded work
 * region (user_account.work_region; null = unknown).
 */
export const sessionScope = z.object({
  permissions: z.array(scopePermission).min(1),
  requester_region: z.string().min(1).nullable(),
})
export type SessionScope = z.infer<typeof sessionScope>

export interface SupportSessionView {
  id: string
  tenant_id: string
  tenant_slug: string
  requester_id: string
  reason: string
  scope: SessionScope
  requested_minutes: number
  state: string
  decided_by: string | null
  starts_at: Date | null
  ends_at: Date | null
  created_at: Date
}

// Works in both realms: the vendor realm reads every tenant row, a tenant reads its own (tenant_self_read).
const SESSION_SELECT = `
  SELECT s.id, s.tenant_id, t.slug AS tenant_slug, s.requester_id, s.reason, s.scope, s.requested_minutes,
         s.state, s.decided_by, s.starts_at, s.ends_at, s.created_at
  FROM support_session s JOIN tenant t ON t.id = s.tenant_id`

export async function getSession(tx: Tx, id: string): Promise<SupportSessionView> {
  const { rows } = await tx.query<SupportSessionView>(`${SESSION_SELECT} WHERE s.id = $1`, [id])
  const session = rows[0]
  if (session === undefined) throw notFound()
  return session
}

export interface SessionCursor {
  readonly created_at: string
  readonly id: string
}

/** Newest first; vendor users see every tenant's sessions, tenant users their own (RLS). */
export async function listSessions(
  tx: Tx, state: string | undefined, after: SessionCursor | undefined, limit: number,
): Promise<SupportSessionView[]> {
  // Ordered at millisecond precision, the precision of the cursor.
  const { rows } = await tx.query<SupportSessionView>(
    `${SESSION_SELECT}
     WHERE ($1::text IS NULL OR s.state = $1)
       AND ($2::timestamptz IS NULL OR (date_trunc('milliseconds', s.created_at), s.id) < ($2, $3::uuid))
     ORDER BY date_trunc('milliseconds', s.created_at) DESC, s.id DESC LIMIT $4`,
    [state ?? null, after?.created_at ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}

export interface SessionLogEntry {
  seq: string
  occurred_at: Date
  actor_type: string
  actor_id: string | null
  action: string
  object_type: string | null
  object_id: string | null
  before: unknown
  after: unknown
  reason: string | null
  request_id: string | null
}

interface LogRow extends Omit<SessionLogEntry, 'before' | 'after' | 'reason'> {
  before_ref: string | null
  after_ref: string | null
}

/**
 * The tenant-visible session log (AC-29.1, SEC-37): every audit event written in the session or about it,
 * newest first. Runs in the tenant's transaction, so another tenant's session is 404.
 */
export async function sessionLog(tx: Tx, id: string, beforeSeq: string | undefined, limit: number): Promise<SessionLogEntry[]> {
  await getSession(tx, id)
  const { rows } = await tx.query<LogRow>(
    `SELECT seq, occurred_at, actor_type, actor_id, action, object_type, object_id, before_ref, after_ref, request_id
     FROM audit.audit_event
     WHERE (support_session_id = $1 OR (object_type = 'support_session' AND object_id = $1))
       AND ($2::bigint IS NULL OR seq < $2)
     ORDER BY seq DESC LIMIT $3`,
    [id, beforeSeq ?? null, limit + 1],
  )
  return rows.map(({ before_ref, after_ref, ...event }) => ({ ...event, ...decodeRefs(before_ref, after_ref) }))
}

export interface Requester {
  id: string
  display_name: string | null
  email: string
}

/**
 * BUG-023: in the tenant realm a session view names its vendor requester (vendor users are otherwise invisible to a
 * tenant). support_session_requester answers only for sessions of the current tenant.
 */
export async function withRequesters<T extends { id: string }>(tx: Tx, sessions: readonly T[]): Promise<(T & { requester: Requester | null })[]> {
  const { rows } = await tx.query<Requester & { session_id: string }>(
    `SELECT s.id AS session_id, r.id, r.display_name, r.email
     FROM unnest($1::uuid[]) AS s (id) CROSS JOIN LATERAL support_session_requester(s.id) AS r`,
    [sessions.map((session) => session.id)],
  )
  const bySession = new Map(rows.map(({ session_id: sessionId, ...requester }) => [sessionId, requester]))
  return sessions.map((session) => ({ ...session, requester: bySession.get(session.id) ?? null }))
}
