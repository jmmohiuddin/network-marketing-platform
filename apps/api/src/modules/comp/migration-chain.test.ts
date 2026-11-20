import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, runQueuedJobs } from '../../../test/helpers/index.js'
import { ledModule } from '../led/index.js'
import { compModule, requestParallelRunSimulation } from './index.js'
import { simulationJob } from './simulations.js'
import {
  activePlan, approval, calculate, commit, createWorld, inside, member, migrationAt, order, ownerUnchecked, ts10Plan, type Member, type World,
} from './test-support.js'

// T-B6-44 (PLAN B6 D-B6-10, D-B6-11; AC-MIG1-4): the cutover period C of a migration is a chain start whose prior state is
// the approved opening state (SQL mig_opening_state_for); C neither runs nor commits until the migration is signed off;
// the parallel_run simulation (MIG's facade) calculates from the same opening state. Also AC-RPT2-4's origin `migration`.

let app: FastifyInstance
let w: World
let a: Member
let c: Member
let cutover: string
let versionId: string
let migration: { id: string; openingApprovalId: string }
closePoolsAfterAll()

const TITLE_R1 = [{ ladder: 'main', rank: 'R1' }]

/** Signs the migration off, or takes the sign-off back (owner fixture: the only way to hold a calculated run of C unsigned). */
async function signedOff(on: boolean): Promise<void> {
  const signoff = on ? await approval(w.tenantId, 'migration', migration.id, w.analyst.id, w.finance2.id) : null
  await ownerUnchecked(
    `UPDATE migration SET state = CASE WHEN $2::uuid IS NULL THEN 'opening_posted' ELSE 'signed_off' END, signoff_approval_id = $2,
       signed_off_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END WHERE id = $1`,
    [migration.id, signoff],
  )
}

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, ledModule] })
  w = await createWorld()
  cutover = w.periods[2]!.id
  c = await member(w, 'DE-C')
  a = await member(w, 'DE-A', c)
  // The plan starts at C, so C's previous period has no plan version: C is a chain start.
  versionId = (await activePlan(w, ts10Plan(), w.periods[2]!.starts_at)).versionId
  await order(w, c, inside(w.periods[2]!), 30_000) // A has no volume in C: its title can only come from the opening state
  migration = await migrationAt(w, cutover, 'opening_posted')
  await ownerUnchecked(
    `INSERT INTO migration_opening_state (tenant_id, migration_id, position_id, paid_as_rank, highest_titles, counters, carry, one_time_flags)
     VALUES ($1, $2, $3, '[]', $4, '[]', '[]', '{}')`,
    [w.tenantId, migration.id, a.positionId, JSON.stringify(TITLE_R1)])
  await ownerUnchecked('INSERT INTO migration_opening_balance (tenant_id, migration_id, participant_id, amount_minor) VALUES ($1, $2, $3, 1250)',
    [w.tenantId, migration.id, a.participantId])
  await withTenant({ tenantId: w.tenantId, userId: w.finance.id }, (tx) => tx.query('SELECT led_post_migration_opening($1, $2)', [migration.id, migration.openingApprovalId]))
}, 120_000)

afterAll(async () => {
  await app.close()
})

describe('T-B6-44 opening state as the chain-start prior state (D-B6-10) and the sign-off blocker (D-B6-11)', () => {
  test('AC-MIG1-4: a run of C is refused 422 MIGRATION_NOT_SIGNED_OFF while the opening is posted but not signed off', async () => {
    const response = await call(app, { method: 'POST', url: `/v1/periods/${cutover}/runs`, as: w.analyst, headers: { 'run-request-id': 'unsigned' } })

    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatchObject({ code: 'MIGRATION_NOT_SIGNED_OFF', details: { migration_id: migration.id, state: 'opening_posted' } })
  })

  test('D-B6-11: a parallel_run simulation of C calculates from the opening state; simulation listings keep kind simulation only', async () => {
    const simulationId = await withTenant({ tenantId: w.tenantId, userId: w.analyst.id }, async (tx) => {
      const id = await requestParallelRunSimulation(tx, { planVersionId: versionId, periodId: cutover })
      await tx.query('INSERT INTO parallel_run (tenant_id, migration_id, simulation_id, bonus_map) VALUES (app_tenant_id(), $1, $2, $3)', [migration.id, id, {}])
      return id
    })
    await runQueuedJobs(simulationJob)
    const [sim] = await ownerRows<{ kind: string; state: string; outputs: { warnings: { code: string }[] }; lines: number }>(
      `SELECT kind, state, outputs, (SELECT count(*)::int FROM sim_result_line l WHERE l.simulation_id = s.id) AS lines FROM simulation s WHERE id = $1`,
      [simulationId])

    expect(sim).toMatchObject({ kind: 'parallel_run', state: 'completed' })
    expect(sim!.lines).toBeGreaterThan(0)
    expect(sim!.outputs.warnings.map((x) => x.code)).not.toContain('PRIOR_STATE_ABSENT')
    const listed = await call(app, { method: 'GET', url: '/v1/simulations', as: w.analyst })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().data.map((s: { id: string }) => s.id)).not.toContain(simulationId)
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${simulationId}`, as: w.analyst })).statusCode).toBe(404)
  })

  test('AC-MIG1-4: after sign-off the run of C reads title.main = R1 for A from the opening state; commit waits for sign-off; replay matches', async () => {
    await signedOff(true)
    const runId = await calculate(app, w, cutover)
    const [state] = await ownerRows<{ highest_titles: unknown; prior_state_run_id: string | null }>(
      `SELECT q.highest_titles, s.prior_state_run_id FROM qualification_state q JOIN run r ON r.id = q.run_id JOIN run_snapshot s ON s.id = r.snapshot_id
       WHERE q.run_id = $1 AND q.position_id = $2`, [runId, a.positionId])
    expect(state).toEqual({ highest_titles: TITLE_R1, prior_state_run_id: null })

    await signedOff(false)
    await call(app, { method: 'GET', url: `/v1/runs/${runId}/review`, as: w.analyst })
    await call(app, { method: 'POST', url: `/v1/runs/${runId}/request-commit`, as: w.analyst, idempotencyKey: true })
    const refused = await call(app, { method: 'POST', url: `/v1/runs/${runId}/commit`, as: w.finance, idempotencyKey: true, body: { acknowledged_exceptions: [] } })
    expect(refused.json().error).toMatchObject({ code: 'MIGRATION_NOT_SIGNED_OFF', details: { migration_id: migration.id, state: 'opening_posted' } })

    await signedOff(true)
    await commit(app, w, runId)
    const [run] = await ownerRows<{ result_hash: string; lines_hash: string }>(`SELECT outputs ->> 'result_hash' AS result_hash, lines_hash FROM run WHERE id = $1`, [runId])
    const replayed = await call(app, { method: 'POST', url: `/v1/runs/${runId}/replay`, as: w.analyst })
    expect(replayed.json().data).toMatchObject({ status: 'match', result_hash: run!.result_hash, lines_hash: run!.lines_hash })
  })

  test('AC-RPT2-4: ledger entries origin_type=migration list the migration_opening entry', async () => {
    const entries = await call(app, { method: 'GET', url: '/v1/ledger/entries?origin_type=migration', as: w.finance })

    expect(entries.json().data).toEqual([expect.objectContaining({
      event_type: 'migration_opening', origin_type: 'migration', origin_id: migration.id, idempotency_key: `migration:${migration.id}:opening`,
    })])
  })
})
