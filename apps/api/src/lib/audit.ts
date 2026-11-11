import type { Tx } from '@nmp/db'
import type { Realm } from './auth.js'
import { SYSTEM_ACTOR_ID } from './db.js'

/**
 * One audit event. action is <DOMAIN>.<VERB> (MVP_A 8). before/after are small JSON references (ids,
 * versions, counts), never personal data. Encoding in the store: before_ref = JSON of before;
 * after_ref = JSON of { after, reason }.
 */
export interface AuditEvent {
  readonly action: string
  readonly objectType?: string
  readonly objectId?: string | null
  readonly before?: unknown
  readonly after?: unknown
  readonly reason?: string
}

export interface RecordedAudit {
  id: string
  seq: string
}

function refs(event: AuditEvent): [string | null, string | null] {
  const before = event.before === undefined ? null : JSON.stringify(event.before)
  const hasAfter = event.after !== undefined || event.reason !== undefined
  const after = hasAfter ? JSON.stringify({ after: event.after ?? null, reason: event.reason ?? null }) : null
  return [before, after]
}

// Tenant, actor, request id and support session come from the transaction context (lib/db.ts), so a caller
// cannot attribute an event to another tenant or actor. The nil system actor is stored as NULL.
const ACTOR_COLUMNS = `
  coalesce(nullif(current_setting('app.actor_type', true), ''), 'user'),
  nullif(nullif(current_setting('app.user_id', true), ''), '${SYSTEM_ACTOR_ID}')::uuid,
  nullif(current_setting('app.support_session_id', true), '')::uuid`
const REQUEST_ID = `nullif(current_setting('app.request_id', true), '')`

/** Writes a tenant audit event in the caller's transaction (the same one as the change it records). */
export async function recordAudit(tx: Tx, event: AuditEvent): Promise<RecordedAudit> {
  const { rows } = await tx.query<RecordedAudit>(
    `INSERT INTO audit.audit_event (tenant_id, actor_type, actor_id, support_session_id, action, object_type,
       object_id, before_ref, after_ref, request_id)
     VALUES (app_tenant_id(), ${ACTOR_COLUMNS}, $1, $2, $3, $4, $5, ${REQUEST_ID})
     RETURNING id, seq`,
    [event.action, event.objectType ?? null, event.objectId ?? null, ...refs(event)],
  )
  return rows[0]!
}

/** Writes a vendor audit event (audit.vendor_event, E-ADR-06) in a vendor-realm transaction. */
export async function recordVendorAudit(tx: Tx, event: AuditEvent): Promise<RecordedAudit> {
  const { rows } = await tx.query<RecordedAudit>(
    `INSERT INTO audit.vendor_event (actor_type, actor_id, support_session_id, action, object_type, object_id,
       before_ref, after_ref, request_id)
     VALUES (${ACTOR_COLUMNS}, $1, $2, $3, $4, $5, ${REQUEST_ID})
     RETURNING id, seq`,
    [event.action, event.objectType ?? null, event.objectId ?? null, ...refs(event)],
  )
  return rows[0]!
}

/** Audit event in the realm's own log: tenant chain or vendor chain. */
export function auditInRealm(tx: Tx, realm: Realm, event: AuditEvent): Promise<RecordedAudit> {
  return realm === 'vendor' ? recordVendorAudit(tx, event) : recordAudit(tx, event)
}

export interface DecodedRefs {
  before: unknown
  after: unknown
  reason: string | null
}

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text // written by something other than recordAudit: return as stored
  }
}

/** Reverses the before_ref / after_ref encoding of recordAudit. */
export function decodeRefs(beforeRef: string | null, afterRef: string | null): DecodedRefs {
  const after = parseJson(afterRef)
  if (after !== null && typeof after === 'object' && 'after' in after && 'reason' in after) {
    const envelope = after as { after: unknown; reason: unknown }
    return { before: parseJson(beforeRef), after: envelope.after, reason: typeof envelope.reason === 'string' ? envelope.reason : null }
  }
  return { before: parseJson(beforeRef), after, reason: null }
}
