// B1 OI-3 (PLAN B2 "CAS mount and B1 open items"): evidence added concurrently with a submit lands before it or is
// refused (23514). case_evidence_case_open (0108) takes FOR SHARE on the case, which conflicts with the submit's row lock.
import type pg from 'pg'
import { beforeEach, describe, expect, test } from 'vitest'
import { getPool, withTenant, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertEvidence, insertRow } from './support.js'

const LOCK_WAIT_MS = 200

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

async function begin(): Promise<pg.PoolClient> {
  const client = await getPool().connect()
  await client.query('BEGIN')
  await client.query(`SELECT set_config('app.realm', 'tenant', true), set_config('app.tenant_id', $1, true),
                             set_config('app.user_id', $2, true)`, [ctx.tenantId, ctx.userId])
  return client
}

const addEvidence = (client: pg.PoolClient) =>
  client.query('INSERT INTO case_evidence (tenant_id, case_id, document_id, added_by) VALUES ($1, $2, $3, $4)',
    [ctx.tenantId, caseId, documentId, ctx.userId])
const submit = (client: pg.PoolClient) =>
  client.query(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [caseId, ctx.userId])

/** Runs first's statement, starts second's (which must wait for first's lock), commits first, then settles second. */
async function race(first: (c: pg.PoolClient) => Promise<unknown>, second: (c: pg.PoolClient) => Promise<unknown>) {
  const [one, two] = [await begin(), await begin()]
  try {
    await first(one)
    let settled = false
    const pending = second(two).then(
      () => ({ ok: true as const }),
      (error: { code?: string }) => ({ ok: false as const, code: error.code }),
    ).finally(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS))
    const waited = !settled
    await one.query('COMMIT')
    const outcome = await pending
    await two.query(outcome.ok ? 'COMMIT' : 'ROLLBACK')
    return { waited, outcome }
  } finally {
    one.release()
    two.release()
  }
}

const state = async () => (await getOwnerPool().query<{ state: string; evidence: number }>(
  `SELECT c.state, (SELECT count(*)::int FROM case_evidence e WHERE e.case_id = c.id) AS evidence FROM case_file c WHERE c.id = $1`,
  [caseId])).rows[0]

describe('evidence versus submit (OI-3)', () => {
  test('evidence first: the submit waits, then submits the case with the evidence in it', async () => {
    const result = await race(addEvidence, submit)

    expect(result).toEqual({ waited: true, outcome: { ok: true } })
    expect(await state()).toEqual({ state: 'submitted', evidence: 1 })
  })

  test('submit first: the evidence insert waits, then is refused because the case is no longer open', async () => {
    const result = await race(submit, addEvidence)

    expect(result).toEqual({ waited: true, outcome: { ok: false, code: '23514' } })
    expect(await state()).toEqual({ state: 'submitted', evidence: 0 })
  })
})
