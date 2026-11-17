import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { assertMarketLive, inScope } from '../ten/index.js'
import { assertEnrolmentAcceptance, recordAcceptance } from './agreements.js'
import { storedContact } from './contact.js'
import { createPosition, resolveSponsor, type PlacementView, type PositionView } from './positions.js'
import type { EnrolmentBody } from './schemas.js'
import { addSignals, findDuplicates, openDuplicateCases, type SignalDigests } from './signals.js'
import { sqlCall } from './sql-errors.js'

export interface ActiveType {
  readonly id: string
  readonly can_hold_positions: boolean
  readonly counts_as_end_customer: boolean
}

export async function activeType(tx: Tx, code: string): Promise<ActiveType> {
  const { rows } = await tx.query<ActiveType>(
    `SELECT id, can_hold_positions, counts_as_end_customer FROM participant_type WHERE code = $1 AND state = 'active'`, [code],
  )
  if (rows[0] === undefined) throw new ApiError(422, 'TYPE_NOT_ACTIVE', 'No active participant type has this code.', { type_code: code })
  return rows[0]
}

/** The market by ISO code, in the caller's scope (else MARKET_UNKNOWN) and Live (else MARKET_NOT_LIVE, AC-PAR1-4). */
async function liveMarket(tx: Tx, code: string, scope: readonly string[] | null): Promise<string> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM market WHERE code = $1', [code])
  const id = rows[0]?.id
  if (id === undefined || !inScope(scope, id)) throw new ApiError(422, 'MARKET_UNKNOWN', 'No such market in your scope.', { market: code })
  await assertMarketLive(tx, id)
  return id
}

/** enrolled_at: default now, never in the future, never before the end of the latest committed period (AC-PAR2-1). */
async function enrolmentTime(tx: Tx, marketId: string, given: string | undefined): Promise<Date> {
  const { rows } = await tx.query<{ at: Date; future: boolean; committed: boolean }>(
    `SELECT t.at, t.at > now() AS future, coalesce(t.at < latest_committed_end($2), false) AS committed
     FROM (SELECT coalesce($1::timestamptz, now()) AS at) t`,
    [given ?? null, marketId],
  )
  const time = rows[0]!
  if (time.future) throw new ApiError(422, 'ENROLLED_AT_INVALID', 'enrolled_at cannot be in the future.')
  if (time.committed) {
    throw new ApiError(422, 'ENROLLED_AT_IN_COMMITTED_PERIOD', 'enrolled_at lies in a period whose results are committed.')
  }
  return time.at
}

async function insertParticipant(tx: Tx, body: EnrolmentBody, marketId: string, at: Date): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, external_ref) DO NOTHING RETURNING id`,
    [body.external_ref, body.account_type, marketId, body.display_name ?? null, storedContact(body.contact), at],
  )
  if (rows[0] === undefined) throw new ApiError(409, 'PARTICIPANT_EXISTS', 'A participant has this external reference.')
  return rows[0].id
}

/** First servicer of an end customer enrolled with a sponsor (FR-CRM-001, source enrolment), audited. */
async function servicerAtEnrolment(tx: Tx, customerId: string, positionId: string, at: Date): Promise<void> {
  const { rows } = await sqlCall(() => tx.query<{ id: string }>(
    `SELECT crm_set_servicer($1, $2, 'enrolment', $3, NULL, NULL) AS id`, [customerId, positionId, at],
  ))
  await recordAudit(tx, {
    action: 'SERVICING.CHANGED', objectType: 'participant', objectId: customerId,
    after: { servicing_id: rows[0]!.id, position_id: positionId, source: 'enrolment', valid_from: at },
  })
}

export interface EnrolmentResult {
  participant: { id: string; external_ref: string; status: 'active' }
  position: PositionView | null
  placement: PlacementView | null
  servicing: { position_id: string } | null
  duplicate_case_id: string | null
}

const POSITION_FIELDS = ['position_ref', 'brand_id', 'placement'] as const

/** FR-PAR-002 (PLAN B2 2.2.1): every part of an enrolment in the caller's one transaction; signals arrive as digests. */
export async function enrol(
  tx: Tx, body: EnrolmentBody, scope: readonly string[] | null, signals: SignalDigests | undefined,
): Promise<EnrolmentResult> {
  const marketId = await liveMarket(tx, body.market, scope)
  const at = await enrolmentTime(tx, marketId, body.enrolled_at)
  const type = await activeType(tx, body.type_code)
  if (!type.can_hold_positions && POSITION_FIELDS.some((field) => body[field] !== undefined)) {
    throw new ApiError(422, 'TYPE_CANNOT_HOLD_POSITIONS', 'This participant type cannot hold positions.')
  }
  await assertEnrolmentAcceptance(tx, marketId, body.agreement?.version_id)
  const sponsorId = body.sponsor === undefined ? null : await resolveSponsor(tx, body.sponsor.position_ref, at)
  const participantId = await insertParticipant(tx, body, marketId, at)
  await tx.query(
    'INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from) VALUES (app_tenant_id(), $1, $2, $3)',
    [participantId, type.id, at],
  )
  if (signals !== undefined) await addSignals(tx, participantId, signals)
  const duplicates = await findDuplicates(tx, participantId)
  const held = duplicates.hold && duplicates.matches.length > 0
  const created = type.can_hold_positions
    ? await createPosition(tx, { participantId, marketId, at, status: held ? 'pending' : 'active', input: body, sponsorId })
    : null
  if (body.agreement !== undefined) {
    const { version_id: versionId, accepted_at: acceptedAt, evidence } = body.agreement
    await recordAcceptance(tx, participantId, marketId, { versionId, acceptedAt: new Date(acceptedAt), evidence: evidence ?? null })
  }
  const services = type.counts_as_end_customer && sponsorId !== null
  if (services) await servicerAtEnrolment(tx, participantId, sponsorId, at)
  const caseId = await openDuplicateCases(tx, participantId, marketId, duplicates.matches)
  await recordAudit(tx, {
    action: 'PARTICIPANT.ENROLLED', objectType: 'participant', objectId: participantId,
    after: { market_id: marketId, type_id: type.id, enrolled_at: at, position_id: created?.position.id ?? null, sponsor_position_id: sponsorId, duplicate_case_id: caseId },
  })
  return {
    participant: { id: participantId, external_ref: body.external_ref, status: 'active' },
    position: created?.position ?? null, placement: created?.placement ?? null,
    servicing: services ? { position_id: sponsorId } : null, duplicate_case_id: caseId,
  }
}
