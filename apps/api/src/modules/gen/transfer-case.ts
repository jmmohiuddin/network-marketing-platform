import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { assertPositionsLimit } from '../par/index.js'
import { inScope } from '../ten/index.js'
import { PERMISSIONS, resolvePositionSubject, type GenCaseType } from './case-support.js'
import { notBeforeToday, toInstant } from './dates.js'
import { dryRun, withSqlErrors } from './errors.js'

/** D-V1A-06: the documents that ground a transfer, per reason code. */
const LEGAL_BASIS_KINDS: Readonly<Record<string, readonly string[]>> = {
  SUCCESSION: ['death_certificate', 'will_or_probate', 'court_order'],
  DIVORCE: ['court_order', 'settlement_agreement'],
  SALE: ['sale_agreement', 'court_order'],
  CORPORATE_RESTRUCTURE: ['registry_extract', 'court_order'],
}
const DOCUMENT_KINDS = [...new Set(Object.values(LEGAL_BASIS_KINDS).flat())] as [string, ...string[]]

// legal_basis is optional here so transfer cases stored before V1-A stay readable; new cases need it (validateCreate).
export const transferPayload = z.strictObject({
  to_participant_id: z.uuid(),
  effective_from: notBeforeToday,
  legal_basis: z.strictObject({ document_kind: z.enum(DOCUMENT_KINDS), reference: z.string().trim().min(1).max(100) }).optional(),
})
export type TransferPayload = z.infer<typeof transferPayload>

const invalidBasis = (field: string, message: string) =>
  new ApiError(422, 'VALIDATION_FAILED', `${field} ${message}.`, { field })

/**
 * The document kind must be allowed for the case's reason code. CAS gives validateCreate no reason code, so a new case is
 * checked at PATCH (stored reason) and always at submit (effectPreview), which refuses the submission.
 * shortcut: no per-reason check at create; add it there once CAS passes the reason code to validateCreate.
 */
function assertLegalBasis(payload: TransferPayload, reasonCode: string | null): void {
  if (payload.legal_basis === undefined) throw invalidBasis('legal_basis', 'is required')
  if (reasonCode !== null && !(LEGAL_BASIS_KINDS[reasonCode] ?? []).includes(payload.legal_basis.document_kind)) {
    throw invalidBasis('legal_basis.document_kind', `is not a document that grounds a transfer for ${reasonCode}`)
  }
}

/** AC-GEN1-2: the owner changes at greatest(effective_from, now()); the tree is unchanged. */
async function transferAt(tx: Tx, payload: TransferPayload): Promise<string> {
  const { rows } = await tx.query<{ at: string }>('SELECT greatest($1::timestamptz, now())::text AS at', [toInstant(payload.effective_from)])
  return rows[0]!.at
}

const transfer = (tx: Tx, position: string, to: string, at: string, caseId: string | null) =>
  tx.query<{ id: string }>('SELECT gen_transfer_ownership($1, $2, $3, $4) AS id', [position, to, at, caseId])

/** D-B3-07: the position counts toward the new owner's positions limit in its market unless it is terminated. */
async function assertLimit(tx: Tx, position: string, to: string): Promise<void> {
  const { rows } = await tx.query<{ market_id: string; live: boolean }>(
    `SELECT market_id, status <> 'terminated' AS live FROM position WHERE id = $1`, [position])
  await assertPositionsLimit(tx, to, rows[0]!.market_id, rows[0]!.live ? 1 : 0)
}

interface OwnerRef {
  readonly participant_id: string
  readonly external_ref: string
}

async function participantRef(tx: Tx, id: string | null): Promise<OwnerRef | null> {
  if (id === null) return null
  const { rows } = await tx.query<OwnerRef>('SELECT participant_id, external_ref FROM par_display(ARRAY[$1::uuid])', [id])
  return rows[0] ?? null
}

async function ownerAt(tx: Tx, position: string, at: string): Promise<string | null> {
  const { rows } = await tx.query<{ owner: string | null }>('SELECT gen_owner_at($1, $2::timestamptz) AS owner', [position, at])
  return rows[0]?.owner ?? null
}

interface NewOwnerState {
  can_hold: boolean
  active: boolean
  tax_profile: boolean
  bank_detail: boolean
}

/** D-V1A-06: may the new owner hold positions at `at`, and are a tax profile in force and a bank detail on record? */
async function newOwnerState(tx: Tx, participant: string, at: string): Promise<NewOwnerState> {
  const { rows } = await tx.query<NewOwnerState>(
    `SELECT coalesce((SELECT t.can_hold_positions FROM par_type_at(p.id, $2::timestamptz) t), false) AS can_hold,
            p.status = 'active' AND p.pseudonymised_at IS NULL AS active,
            EXISTS (SELECT 1 FROM tax_profile x WHERE x.participant_id = p.id AND x.valid_from <= $2::timestamptz
                      AND (x.valid_to IS NULL OR x.valid_to > $2::timestamptz)) AS tax_profile,
            EXISTS (SELECT 1 FROM bank_detail_version v WHERE v.participant_id = p.id AND v.superseded_at IS NULL
                      AND v.details_sealed IS NOT NULL) AS bank_detail
     FROM participant p WHERE p.id = $1`,
    [participant, at],
  )
  return rows[0]!
}

/** AC-PAR4-3: an ineligible or unready new owner refuses the approval. */
async function assertNewOwnerReady(tx: Tx, participant: string, at: string): Promise<void> {
  const state = await newOwnerState(tx, participant, at)
  if (!state.can_hold || !state.active) {
    throw new ApiError(422, 'NEW_OWNER_NOT_ELIGIBLE', 'The new owner cannot hold positions (type, merged or erased).')
  }
  const missing = [...(state.tax_profile ? [] : ['tax_profile']), ...(state.bank_detail ? [] : ['bank_detail'])]
  if (missing.length > 0) {
    throw new ApiError(422, 'NEW_OWNER_NOT_READY', 'The new owner needs a tax profile in force and a bank detail on record.', { missing })
  }
}

export const transferType: GenCaseType<TransferPayload> = {
  type: 'transfer',
  subjectTypes: ['position'],
  reasonCodes: ['SUCCESSION', 'SALE', 'DIVORCE', 'CORPORATE_RESTRUCTURE'],
  evidenceRequired: true,
  // D-V1A-06 (C-V1A-8): a Compliance officer decides transfers.
  permissions: { ...PERMISSIONS, decide: 'case.transfer.approve' },
  payload: transferPayload,
  resolveSubject: resolvePositionSubject,
  // The new owner must be in the filer's create markets, like PAR's duplicate target: out of scope reads as unknown.
  async validateCreate(tx, subject, payload, scope, stored) {
    assertLegalBasis(payload, stored?.reason_code ?? null)
    const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM par_display(ARRAY[$1::uuid])', [payload.to_participant_id])
    if (rows[0] === undefined || !inScope(scope, rows[0].market_id)) {
      throw new ApiError(422, 'PARTICIPANT_NOT_FOUND', 'The new owner is not a participant of this tenant.')
    }
    await assertLimit(tx, subject.id, payload.to_participant_id)
    const at = await transferAt(tx, payload)
    const refusal = await dryRun(tx, () => transfer(tx, subject.id, payload.to_participant_id, at, null))
    if (refusal !== null) throw refusal
  },
  async effectPreview(tx, c) {
    assertLegalBasis(c.payload, c.reason_code)
    const at = await transferAt(tx, c.payload)
    const state = await newOwnerState(tx, c.payload.to_participant_id, at)
    return {
      from_owner: await participantRef(tx, await ownerAt(tx, c.subject_id, at)),
      to_owner: await participantRef(tx, c.payload.to_participant_id),
      to_type_can_hold_positions: state.can_hold,
      new_owner_ready: { tax_profile: state.tax_profile, bank_detail: state.bank_detail },
    }
  },
  // BR-GEN-10: staff related to the current or the new owner never decide the transfer.
  async excludedApprovers(tx, c) {
    const at = await transferAt(tx, c.payload)
    const owners = [await ownerAt(tx, c.subject_id, at), c.payload.to_participant_id].filter((id): id is string => id !== null)
    const { rows } = await tx.query<{ id: string }>('SELECT DISTINCT staff_related_users(p) AS id FROM unnest($1::uuid[]) AS p', [owners])
    return rows.map((row) => row.id)
  },
  async onDecision(tx, c, decision) {
    if (decision !== 'approved') return
    const at = await transferAt(tx, c.payload)
    await assertNewOwnerReady(tx, c.payload.to_participant_id, at)
    const from = await ownerAt(tx, c.subject_id, at)
    await assertLimit(tx, c.subject_id, c.payload.to_participant_id)
    const { rows } = await withSqlErrors(() => transfer(tx, c.subject_id, c.payload.to_participant_id, at, c.id))
    await recordAudit(tx, {
      action: 'POSITION.OWNERSHIP_TRANSFERRED', objectType: 'position', objectId: c.subject_id,
      after: { ownership_id: rows[0]!.id, from_participant_id: from, to_participant_id: c.payload.to_participant_id, valid_from: at, case_id: c.id },
    })
  },
}
