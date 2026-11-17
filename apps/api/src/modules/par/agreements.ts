import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requireAnyPermission, requirePermission, requireRealm, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { inScope } from '../ten/index.js'
import { pgCode } from './sql-errors.js'

// D-B2-15: agreement versions per market; the current version is the latest published.
const PUBLISH = 'agreement.publish'
const READERS = ['participant.read', PUBLISH, 'market.manage', 'market.signoff'] as const
const publishBody = z.strictObject({
  market_id: z.uuid(), label: z.string().trim().min(1).max(50), document_id: z.uuid(), acceptance_required: z.boolean(),
})
const listQuery = z.strictObject({ market_id: z.uuid().optional() })

export interface CurrentVersion {
  readonly id: string
  readonly acceptance_required: boolean
}

export async function currentVersion(tx: Tx, marketId: string): Promise<CurrentVersion | null> {
  const { rows } = await tx.query<CurrentVersion>(
    'SELECT id, acceptance_required FROM agreement_version WHERE market_id = $1 ORDER BY published_at DESC, id DESC LIMIT 1',
    [marketId],
  )
  return rows[0] ?? null
}

const notCurrent = (): ApiError =>
  new ApiError(422, 'AGREEMENT_VERSION_NOT_CURRENT', 'Accept the market\'s current agreement version.')

export interface Acceptance {
  readonly versionId: string
  readonly acceptedAt: Date
  readonly evidence: { channel: string; reference: string } | null
}

/** AC-PAR6-2: an acceptance of the market's current version, once per participant (409 ALREADY_ACCEPTED). */
export async function recordAcceptance(tx: Tx, participantId: string, marketId: string, acceptance: Acceptance) {
  if ((await currentVersion(tx, marketId))?.id !== acceptance.versionId) throw notCurrent()
  const { rows: timing } = await tx.query<{ future: boolean }>('SELECT $1::timestamptz > now() AS future', [acceptance.acceptedAt])
  if (timing[0]!.future) throw new ApiError(422, 'ACCEPTED_AT_INVALID', 'accepted_at cannot be in the future.')
  const { rows } = await tx.query<{ id: string; agreement_version_id: string; accepted_at: Date }>(
    `INSERT INTO agreement_acceptance (tenant_id, participant_id, agreement_version_id, accepted_at, evidence)
     VALUES (app_tenant_id(), $1, $2, $3, $4) ON CONFLICT (participant_id, agreement_version_id) DO NOTHING
     RETURNING id, agreement_version_id, accepted_at`,
    [participantId, acceptance.versionId, acceptance.acceptedAt, acceptance.evidence],
  )
  if (rows[0] === undefined) throw new ApiError(409, 'ALREADY_ACCEPTED', 'The participant has accepted this version already.')
  await recordAudit(tx, {
    action: 'AGREEMENT.ACCEPTED', objectType: 'participant', objectId: participantId,
    after: { acceptance_id: rows[0].id, agreement_version_id: acceptance.versionId, accepted_at: acceptance.acceptedAt },
  })
  return { id: rows[0].id, agreement_version_id: rows[0].agreement_version_id, accepted_at: rows[0].accepted_at.toISOString() }
}

/** AC-42.2: enrolment into a market whose current version needs acceptance carries an acceptance of that version. */
export async function assertEnrolmentAcceptance(tx: Tx, marketId: string, versionId: string | undefined): Promise<void> {
  const current = await currentVersion(tx, marketId)
  if (versionId !== undefined && current?.id !== versionId) throw notCurrent()
  if (versionId === undefined && current?.acceptance_required === true) {
    throw new ApiError(422, 'AGREEMENT_ACCEPTANCE_REQUIRED', 'Enrolment in this market needs an acceptance of its current agreement version.', {
      agreement_version_id: current.id,
    })
  }
}

// accepted / not_accepted: the market's active participants with and without an acceptance of the version.
const LIST = `
  SELECT v.id, jsonb_build_object('id', m.id, 'code', m.code) AS market, v.label,
         jsonb_build_object('id', d.id, 'file_name', d.file_name) AS document, v.acceptance_required, v.published_at,
         jsonb_build_object('id', u.id, 'display_name', u.display_name) AS published_by,
         v.id = (SELECT x.id FROM agreement_version x WHERE x.market_id = v.market_id ORDER BY x.published_at DESC, x.id DESC LIMIT 1)
           AS current,
         jsonb_build_object(
           'accepted', (SELECT count(*) FROM agreement_acceptance a WHERE a.agreement_version_id = v.id),
           'not_accepted', (SELECT count(*) FROM participant p WHERE p.market_id = v.market_id AND p.status = 'active'
                              AND NOT EXISTS (SELECT 1 FROM agreement_acceptance a
                                              WHERE a.participant_id = p.id AND a.agreement_version_id = v.id))) AS acceptances
  FROM agreement_version v JOIN market m ON m.id = v.market_id JOIN document d ON d.id = v.document_id
  JOIN user_account u ON u.id = v.published_by`

/** PLAN B2 2.2: agreement versions (publish, list with acceptance counts). */
export function registerAgreementRoutes(app: FastifyInstance): void {
  // shortcut: no pagination, a market has a handful of versions; add a cursor if a tenant publishes hundreds.
  app.get('/v1/agreement-versions', { preHandler: [requireRealm('tenant'), requireAnyPermission(...READERS)] }, async (request) => {
    const { market_id: marketId } = parse(listQuery, request.query)
    const scope = scopeOfAny(currentAuth(request), READERS)
    return envelope(await inTenant(request, async (tx) => (await tx.query(
      `${LIST} WHERE ($1::uuid[] IS NULL OR v.market_id = ANY ($1)) AND ($2::uuid IS NULL OR v.market_id = $2)
       ORDER BY m.code, v.published_at DESC, v.id DESC`,
      [scope, marketId ?? null],
    )).rows))
  })

  app.post('/v1/agreement-versions', { preHandler: [requireRealm('tenant'), requirePermission(PUBLISH)] }, async (request, reply) => {
    const body = parse(publishBody, request.body)
    const scope = marketScope(currentAuth(request), PUBLISH)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { rowCount } = await tx.query('SELECT 1 FROM market WHERE id = $1', [body.market_id])
      if (rowCount !== 1 || !inScope(scope, body.market_id)) throw new ApiError(422, 'MARKET_UNKNOWN', 'No such market in your scope.')
      const id = await insertVersion(tx, body)
      await recordAudit(tx, {
        action: 'AGREEMENT.PUBLISHED', objectType: 'agreement_version', objectId: id,
        after: { market_id: body.market_id, document_id: body.document_id, acceptance_required: body.acceptance_required },
      })
      return { statusCode: 201, body: envelope((await tx.query(`${LIST} WHERE v.id = $1`, [id])).rows[0]) }
    }))
    return sendIdempotent(reply, result)
  })
}

async function insertVersion(tx: Tx, body: z.infer<typeof publishBody>): Promise<string> {
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO agreement_version (tenant_id, market_id, label, document_id, acceptance_required, published_by)
       VALUES (app_tenant_id(), $1, $2, $3, $4, app_user_id()) ON CONFLICT (tenant_id, market_id, label) DO NOTHING RETURNING id`,
      [body.market_id, body.label, body.document_id, body.acceptance_required],
    )
    if (rows[0] === undefined) throw new ApiError(409, 'VERSION_LABEL_TAKEN', 'This market already has a version with this label.')
    return rows[0].id
  } catch (error) {
    // assert_document_referenceable (AC-PAR6-1): not uploaded by the publisher, not class agreement, or already referenced.
    if (pgCode(error) === 'P0002') throw new ApiError(422, 'DOCUMENT_NOT_FOUND', 'Upload the agreement document yourself, then publish it.')
    throw error
  }
}
