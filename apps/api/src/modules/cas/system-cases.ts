import type { Tx } from '@nmp/db'
import { insertCase, recordChange, type NewCase } from './cases.js'
import { parsePayload, submitCase } from './routes.js'
import type { CaseRecord, CaseTypeDefinition } from './types.js'

const openedAfter = (c: CaseRecord) => ({ type: c.type, subject_type: c.subject_type, subject_id: c.subject_id, reason_code: c.reason_code })

/**
 * Opens a case on behalf of the system inside the caller's transaction (D-B2-04, PLAN B2 section 2.4): no opener, an
 * `opened` event without actor. The audit event's actor is whoever runs the transaction (user, service account or
 * system). The caller has validated the payload against its own type. Only type duplicate may be system-opened.
 */
export async function openSystemCase(tx: Tx, input: NewCase): Promise<CaseRecord> {
  const opened = await insertCase(tx, input, 'system')
  await recordChange(tx, opened.id, 'opened', null, { after: { ...openedAfter(opened), opened_by_kind: 'system' } }, 'system')
  return opened
}

/**
 * Opens and submits a case as the portal user in one transaction (D-B5-15, PLAN B5 section 4.1): the payload is
 * checked against the type's schema and the type's submit hooks run as at POST /v1/cases/:id/submit; the DB insert
 * guard decides which types a portal transaction may open.
 */
export async function openPortalCase(tx: Tx, definition: CaseTypeDefinition, input: Omit<NewCase, 'type'>): Promise<CaseRecord> {
  const opened = await insertCase(tx, { ...input, type: definition.type, payload: parsePayload(definition, input.payload) })
  await recordChange(tx, opened.id, 'opened', null, { after: openedAfter(opened) })
  return submitCase(tx, { record: opened, definition })
}

/** The system's escalation of an overdue case (D-B5-15): event `escalated` without actor and audit CASE.ESCALATED. */
export async function escalateCase(tx: Tx, caseId: string, data: Record<string, unknown>): Promise<void> {
  await recordChange(tx, caseId, 'escalated', data, { after: data }, 'system')
}
