// TEST FIXTURE ONLY (D-B1-13): a labelled case type for integration and isolation tests. Production registers no case
// type in B1; never import this file from a module index.
import type { Tx } from '@nmp/db'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { z } from 'zod'
import { call, ownerRows, type Caller } from '../../../test/helpers/index.js'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { createCasModule } from './index.js'
import type { CaseTypeDefinition } from './types.js'

export const FIXTURE_SUBJECT = 'fixture_market'
export const FIXTURE_REASONS = ['fixture_reason_a', 'fixture_reason_b'] as const

const fixturePayload = z.strictObject({ amount_minor: z.string().regex(/^-?\d{1,18}$/), fail_on_decision: z.boolean().optional() })
type FixturePayload = z.infer<typeof fixturePayload>

/**
 * The 'adjustment' slot with a market row (created through the owner pool) as its subject and existing catalogue
 * permissions: read compliance.read, create import.manage, decide mapping.approve. Its hooks show where they run:
 * validateCreate refuses amount -999 (409 FIXTURE_REFUSED), effectPreview echoes the amount, dueAt is two days after
 * submission, onDecision writes FIXTURE.CASE_DECIDED in the decision's transaction and throws when the payload asks for
 * it (atomicity test).
 */
export const FIXTURE_CASE_TYPE: CaseTypeDefinition<FixturePayload> = {
  type: 'adjustment',
  subjectTypes: [FIXTURE_SUBJECT],
  reasonCodes: FIXTURE_REASONS,
  evidenceRequired: true,
  permissions: { read: 'compliance.read', create: 'import.manage', decide: 'mapping.approve' },
  payload: fixturePayload,
  async resolveSubject(tx: Tx, _subjectType: string, subjectId: string) {
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM market WHERE id = $1', [subjectId])
    return rows[0] === undefined ? null : { marketId: rows[0].id }
  },
  async validateCreate(_tx, _subject, payload) {
    if (payload.amount_minor === '-999') throw new ApiError(409, 'FIXTURE_REFUSED', 'The fixture refuses this amount.')
  },
  async effectPreview(_tx, c) {
    return { amount_minor: c.payload.amount_minor }
  },
  async dueAt(tx) {
    const { rows } = await tx.query<{ due: Date }>(`SELECT now() + interval '2 days' AS due`)
    return rows[0]!.due
  },
  async onDecision(tx, c, decision) {
    if (c.payload.fail_on_decision === true) throw new Error('fixture onDecision failure')
    await recordAudit(tx, { action: 'FIXTURE.CASE_DECIDED', objectType: 'case', objectId: c.id, after: { decision } })
  },
}

export const fixtureCasModule = () => createCasModule({ types: [FIXTURE_CASE_TYPE as CaseTypeDefinition] })

/** POST /v1/cases for the fixture type about the market. */
export function openFixtureCase(
  app: FastifyInstance, as: Caller, marketId: string, payload: FixturePayload = { amount_minor: '1500' },
): Promise<LightMyRequestResponse> {
  return call(app, {
    method: 'POST', url: '/v1/cases', as, idempotencyKey: true,
    body: { type: 'adjustment', subject_type: FIXTURE_SUBJECT, subject_id: marketId, reason_code: FIXTURE_REASONS[0], payload },
  })
}

/** An evidence document of the user, inserted through the owner pool (no file: case tests only reference it). */
export async function evidenceDocument(user: { id: string; tenantId: string | null }): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO document (tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, file_name)
     VALUES ($1, 'evidence', 'documents/fixture', sha256(gen_random_uuid()::text::bytea), 'application/pdf', 1, $2, 1, 'fixture.pdf')
     RETURNING id`,
    [user.tenantId, user.id],
  )
  return row!.id
}
