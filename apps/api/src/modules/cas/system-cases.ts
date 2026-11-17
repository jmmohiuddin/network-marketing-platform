import type { Tx } from '@nmp/db'
import { insertCase, recordChange, type NewCase } from './cases.js'
import type { CaseRecord } from './types.js'

/**
 * Opens a case on behalf of the system inside the caller's transaction (D-B2-04, PLAN B2 section 2.4): no opener, an
 * `opened` event without actor. The audit event's actor is whoever runs the transaction (user, service account or
 * system). The caller has validated the payload against its own type. Only type duplicate may be system-opened.
 */
export async function openSystemCase(tx: Tx, input: NewCase): Promise<CaseRecord> {
  const opened = await insertCase(tx, input, 'system')
  await recordChange(tx, opened.id, 'opened', null, {
    after: {
      type: opened.type, subject_type: opened.subject_type, subject_id: opened.subject_id, reason_code: opened.reason_code,
      opened_by_kind: 'system',
    },
  }, 'system')
  return opened
}
