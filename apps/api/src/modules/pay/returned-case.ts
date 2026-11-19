import { z } from 'zod'
import { ApiError } from '../../lib/errors.js'
import type { CaseTypeDefinition } from '../cas/index.js'

// D-B4-15: the system opens a returned_payment case for each returned instruction; while it is open or submitted the
// payee is excluded from batches. The payout officer adds a note and submits; a Finance approver decides (either
// decision closes it). The returned amount is already back in the payable (posting #4).

const payload = z.strictObject({ instruction_id: z.uuid(), note: z.string().trim().min(1).max(2000).optional() })
type ReturnedPayload = z.infer<typeof payload>

export const RETURNED_PAYMENT_CASE_TYPE: CaseTypeDefinition<ReturnedPayload> = {
  type: 'returned_payment',
  subjectTypes: ['payout_instruction'],
  reasonCodes: [],
  systemReasonCodes: ['RETURNED_BY_BANK'],
  evidenceRequired: false,
  permissions: { read: 'case.returned_payment.read', create: 'case.returned_payment.create', decide: 'payout.approve' },
  payload,
  async resolveSubject(tx, _subjectType, subjectId) {
    const { rows } = await tx.query<{ market_id: string }>(
      'SELECT b.market_id FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id WHERE i.id = $1', [subjectId])
    return rows[0] === undefined ? null : { marketId: rows[0].market_id }
  },
  async validateCreate(_tx, subject, value) {
    if (value.instruction_id !== subject.id) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'instruction_id is not valid: it must be the returned instruction.', {
        issues: [{ path: 'instruction_id', message: 'must be the returned instruction' }],
      })
    }
  },
  // Runs at submit (CAS): the officer records what was confirmed with the payee before the amount is payable again. The
  // participant's name stays null: the preview is history erasure cannot clear; case views fill in the current one (BUG-109).
  async effectPreview(tx, c) {
    if (c.payload.note === undefined) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'note is required to submit a returned-payment case.', { issues: [{ path: 'note', message: 'is required' }] })
    }
    const { rows } = await tx.query(
      `SELECT jsonb_build_object('id', i.id, 'batch_id', i.batch_id, 'bank_detail_masked', v.masked,
                'participant', jsonb_build_object('id', x.id, 'external_ref', x.external_ref, 'display_name', NULL)) AS instruction,
              i.amount_minor::text AS amount_minor, i.currency, i.terminal_at AS returned_at, i.last_error AS reason
       FROM payout_instruction i JOIN bank_detail_version v ON v.id = i.bank_detail_version_id JOIN participant x ON x.id = i.payee_participant_id
       WHERE i.id = $1`,
      [c.subject_id],
    )
    return rows[0] ?? null
  },
}
