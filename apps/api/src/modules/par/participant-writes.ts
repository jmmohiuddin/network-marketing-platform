import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type StoredResponse } from '../../lib/idempotency.js'
import { assertMarketLive, getSetting } from '../ten/index.js'
import { callerScope, callerTenant, participantInScope, participantsWrite, type ParticipantRef } from './access.js'
import { recordAcceptance } from './agreements.js'
import { activeType, enrol } from './enrolment.js'
import { createPosition, resolveSponsor } from './positions.js'
import {
  acceptanceBody, acceptanceResponse, enrolmentBody, enrolmentResponse, positionBody, positionResponse, signalsBody,
  signalsResponse, typeChangeBody, typesResponse,
} from './schemas.js'
import { addSignals, digestSignals, findDuplicates, openDuplicateCases, type SignalDigests } from './signals.js'

const MANAGE = 'participant.manage'
const idParams = z.object({ id: z.uuid() })

interface TypeRow {
  type: { id: string; code: string; name: string }
  valid_from: Date
  valid_to: Date | null
}

async function typesOf(tx: Tx, participantId: string) {
  const { rows } = await tx.query<TypeRow>(
    `SELECT jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) AS type, a.valid_from, a.valid_to
     FROM participant_type_assignment a JOIN participant_type t ON t.id = a.type_id
     WHERE a.participant_id = $1 ORDER BY a.valid_from`,
    [participantId],
  )
  return typesResponse.parse({
    types: rows.map((row) => ({ ...row, valid_from: row.valid_from.toISOString(), valid_to: row.valid_to?.toISOString() ?? null })),
  })
}

/** AC-PAR1-2: the open assignment closes at T and the new type starts at T (T >= now); past orders keep their type. */
async function changeType(tx: Tx, participantId: string, body: z.infer<typeof typeChangeBody>) {
  const type = await activeType(tx, body.type_code)
  const { rows: time } = await tx.query<{ at: Date; past: boolean }>(
    'SELECT t.at, t.at < now() AS past FROM (SELECT coalesce($1::timestamptz, now()) AS at) t', [body.valid_from ?? null],
  )
  const { at, past } = time[0]!
  // Every participant has an open assignment from enrolment (the participant row is locked by the caller).
  const { rows } = await tx.query<{ id: string; type_id: string; valid_from: Date }>(
    'SELECT id, type_id, valid_from FROM participant_type_assignment WHERE participant_id = $1 AND valid_to IS NULL FOR UPDATE',
    [participantId],
  )
  const open = rows[0]!
  if (open.type_id === type.id) throw new ApiError(409, 'TYPE_UNCHANGED', 'The participant already has this type.')
  if (past || open.valid_from >= at) {
    throw new ApiError(422, 'VALID_FROM_INVALID', 'valid_from must be now or later, after the start of the current type.')
  }
  if (!type.can_hold_positions) {
    const { rowCount } = await tx.query('SELECT 1 FROM gen_positions_of($1, NULL) WHERE owned_to IS NULL', [participantId])
    if (rowCount !== 0) {
      throw new ApiError(422, 'TYPE_CONFLICTS_WITH_POSITIONS', 'The participant owns positions; this type cannot hold positions.')
    }
  }
  await tx.query('UPDATE participant_type_assignment SET valid_to = $2 WHERE id = $1', [open.id, at])
  await tx.query(
    'INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from) VALUES (app_tenant_id(), $1, $2, $3)',
    [participantId, type.id, at],
  )
  await recordAudit(tx, {
    action: 'PARTICIPANT.TYPE_CHANGED', objectType: 'participant', objectId: participantId,
    before: { type_id: open.type_id }, after: { type_id: type.id, valid_from: at }, reason: body.reason,
  })
  return typesOf(tx, participantId)
}

/** A new position is held pending while hold_activation is on and a duplicate review of the owner is open (D-B2-10). */
async function heldByReview(tx: Tx, participantId: string): Promise<boolean> {
  if ((await getSetting(tx, 'participants.duplicate_matching'))?.hold_activation !== true) return false
  const { rowCount } = await tx.query(
    `SELECT 1 FROM case_file WHERE type = 'duplicate' AND state IN ('open', 'submitted') AND subject_type = 'participant'
       AND subject_id = $1`,
    [participantId],
  )
  return rowCount !== 0
}

async function addPosition(tx: Tx, participant: ParticipantRef, body: z.infer<typeof positionBody>) {
  await assertMarketLive(tx, participant.market_id)
  const { rows } = await tx.query<{ now: Date }>('SELECT now()')
  const at = rows[0]!.now
  const sponsorId = body.sponsor === undefined ? null : await resolveSponsor(tx, body.sponsor.position_ref, at)
  const status = (await heldByReview(tx, participant.id)) ? 'pending' : 'active'
  return positionResponse.parse(await createPosition(tx, { participantId: participant.id, marketId: participant.market_id, at, status, input: body, sponsorId }))
}

async function addParticipantSignals(tx: Tx, participant: ParticipantRef, digests: SignalDigests) {
  const added = await addSignals(tx, participant.id, digests)
  const { matches } = await findDuplicates(tx, participant.id)
  const caseId = await openDuplicateCases(tx, participant.id, participant.market_id, matches)
  return signalsResponse.parse({ added: added.length, duplicate_case_id: caseId })
}

type ParticipantAction = (tx: Tx, participant: ParticipantRef) => Promise<StoredResponse>

/**
 * An idempotent write on one active participant of the caller's markets (a key reaches every market); a merged one only
 * lives on as its target (409 PARTICIPANT_MERGED).
 */
async function onParticipant(request: FastifyRequest, action: ParticipantAction) {
  const { id } = parse(idParams, request.params)
  const scope = callerScope(request, MANAGE)
  return inTenant(request, async (tx) => {
    const participant = await participantInScope(tx, id, scope, true)
    if (participant.status === 'merged') throw new ApiError(409, 'PARTICIPANT_MERGED', 'This participant was merged into another.')
    return idempotent(tx, request, () => action(tx, participant))
  })
}

/** PLAN B2 2.2: the participant writes open to keys with participants:write and to participant.manage sessions. */
export function registerParticipantWriteRoutes(app: FastifyInstance): void {
  const write = participantsWrite(app, MANAGE)

  app.post('/v1/participants', write, async (request, reply) => {
    const body = parse(enrolmentBody, request.body)
    const scope = callerScope(request, MANAGE)
    // D-B2-10: the request hash of the Idempotency-Key covers the digests, never the raw signals.
    const signals = body.signals === undefined ? undefined : digestSignals(request.server.config.secretKey, callerTenant(request), body.signals)
    request.body = { ...body, signals }
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({
      statusCode: 201, body: envelope(enrolmentResponse.parse(await enrol(tx, body, scope, signals))),
    })))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/participants/:id/type', write, async (request, reply) => {
    const body = parse(typeChangeBody, request.body)
    const result = await onParticipant(request, async (tx, participant) => ({ statusCode: 200, body: envelope(await changeType(tx, participant.id, body)) }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/participants/:id/positions', write, async (request, reply) => {
    const body = parse(positionBody, request.body)
    const result = await onParticipant(request, async (tx, participant) => ({ statusCode: 201, body: envelope(await addPosition(tx, participant, body)) }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/participants/:id/agreement-acceptances', write, async (request, reply) => {
    const body = parse(acceptanceBody, request.body)
    const result = await onParticipant(request, async (tx, participant) => {
      const acceptance = await recordAcceptance(tx, participant.id, participant.market_id, {
        versionId: body.agreement_version_id, acceptedAt: new Date(body.accepted_at), evidence: body.evidence ?? null,
      })
      return { statusCode: 201, body: envelope(acceptanceResponse.parse(acceptance)) }
    })
    return sendIdempotent(reply, result)
  })

  app.post('/v1/participants/:id/signals', write, async (request, reply) => {
    // D-B2-10: the request hash of the Idempotency-Key covers the digests, never the raw signals.
    const digests = digestSignals(request.server.config.secretKey, callerTenant(request), parse(signalsBody, request.body))
    request.body = digests
    const result = await onParticipant(request, async (tx, participant) => ({
      statusCode: 200, body: envelope(await addParticipantSignals(tx, participant, digests)),
    }))
    return sendIdempotent(reply, result)
  })
}
