// B1 OI-3 (PLAN B2 "CAS mount and B1 open items"): evidence added concurrently with a submit lands before it or is
// refused (23514). case_evidence_case_open (0108) takes FOR SHARE on the case, which conflicts with the submit's row lock.
import { beforeEach, describe, expect, test } from 'vitest'
import { withTenant, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertEvidence, insertRow, race } from './support.js'

let ctx: TenantContext
let caseId: string
let documentId: string

closePoolsAfterAll()

beforeEach(async () => {
  await resetTestDb()
  const tenantId = (await createTenant()).id
  ctx = { tenantId, userId: (await createUser({ tenantId })).id }
  ;[caseId, documentId] = await withTenant(ctx, async (tx) => [
    await insertRow(tx, 'case_file', {
      tenant_id: tenantId, type: 'adjustment', subject_type: 'test_subject', subject_id: tenantId, reason_code: 'TEST',
      state: 'open', payload: {}, opened_by: ctx.userId,
    }),
    await insertEvidence(tx, tenantId, ctx.userId),
  ])
})

const addEvidence = (client: Tx) =>
  client.query('INSERT INTO case_evidence (tenant_id, case_id, document_id, added_by) VALUES ($1, $2, $3, $4)',
    [ctx.tenantId, caseId, documentId, ctx.userId])
const submit = (client: Tx) =>
  client.query(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [caseId, ctx.userId])

const state = async () => (await getOwnerPool().query<{ state: string; evidence: number }>(
  `SELECT c.state, (SELECT count(*)::int FROM case_evidence e WHERE e.case_id = c.id) AS evidence FROM case_file c WHERE c.id = $1`,
  [caseId])).rows[0]

describe('evidence versus submit (OI-3)', () => {
  test('evidence first: the submit waits, then submits the case with the evidence in it', async () => {
    const result = await race(ctx, addEvidence, submit)

    expect(result).toEqual({ waited: true, outcome: { ok: true } })
    expect(await state()).toEqual({ state: 'submitted', evidence: 1 })
  })

  test('submit first: the evidence insert waits, then is refused because the case is no longer open', async () => {
    const result = await race(ctx, submit, addEvidence)

    expect(result).toEqual({ waited: true, outcome: { ok: false, code: '23514' } })
    expect(await state()).toEqual({ state: 'submitted', evidence: 0 })
  })
})
