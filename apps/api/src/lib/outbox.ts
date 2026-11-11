import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { SYSTEM_ACTOR_ID } from './db.js'

export interface OutboxMessage {
  /** Event type, e.g. 'iam.admin.granted'. Stored as outbox_event.topic. */
  readonly type: string
  /** Ids and minimal data only; no personal data (TR-API-15). */
  readonly payload: Record<string, unknown>
  /** Ordering / aggregate key; defaults to a fresh id (no ordering constraint). */
  readonly key?: string
}

/**
 * Writes an outbox event in the caller's tenant transaction (ARCHITECTURE 7.1). In release A nothing
 * delivers these externally (API C-3); they are the durable record that an alert or event was raised.
 */
export async function enqueueOutbox(tx: Tx, message: OutboxMessage): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO outbox_event (tenant_id, topic, key, payload, created_by)
     VALUES (app_tenant_id(), $1, $2, $3, nullif(nullif(current_setting('app.user_id', true), ''), $4)::uuid)
     RETURNING id`,
    [message.type, message.key ?? randomUUID(), message.payload, SYSTEM_ACTOR_ID],
  )
  return rows[0]!.id
}
