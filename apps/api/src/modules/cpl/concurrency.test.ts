import { withTenant } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { buildTestApp, closePoolsAfterAll, ownerRows, resetApiDb, runQueuedJobs, type TestUser } from '../../../test/helpers/index.js'
import { cplModule, computeSnapshotJob } from './index.js'
import { freshTenant, getSnapshot, JAN_FEB, requestSnapshot, TS31 } from './test-fixtures.js'

const POLL_MS = 50
const POLL_ATTEMPTS = 200

let app: FastifyInstance

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [cplModule] })
})

afterAll(async () => {
  await app.close()
})

/** Resolves once some session waits on a lock while running a statement that matches the pattern. */
async function lockWaitOn(pattern: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const waiting = await ownerRows(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE $1`, [pattern])
    if (waiting.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`no session waited on a lock running ${pattern}`)
}

/** The import module's load of a re-import: supersede the overlapping batch, then mark the new one loaded. */
function reload(user: TestUser, batchId: string): Promise<void> {
  return withTenant({ tenantId: user.tenantId!, userId: user.id }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO import_batch (tenant_id, market_id, kind, period_from, period_to, state, mapping_id, uploaded_by)
       SELECT tenant_id, market_id, kind, period_from, period_to, 'mapped', mapping_id, $2 FROM import_batch WHERE id = $1
       RETURNING id`,
      [batchId, user.id],
    )
    await tx.query(`UPDATE import_batch SET state = 'superseded', superseded_by = $2 WHERE id = $1`, [batchId, rows[0]!.id])
    await tx.query(`UPDATE import_batch SET state = 'loaded' WHERE id = $1`, [rows[0]!.id])
  })
}

test('a load that retires snapshots waits for a computation in progress instead of deadlocking with it', async () => {
  const { user, batch, tenant } = await freshTenant(TS31)
  const ready = (await requestSnapshot(app, user, JAN_FEB)).json().data.id
  await runQueuedJobs(computeSnapshotJob)
  const computing = (await requestSnapshot(app, user, JAN_FEB)).json().data.id
  const blocker = await getOwnerPool().connect()
  try {
    await blocker.query('BEGIN')
    // Pauses the job after it has locked its snapshot: the settings version is what it reads next.
    await blocker.query('LOCK TABLE tenant_setting_version IN ACCESS EXCLUSIVE MODE')
    const job = runQueuedJobs(computeSnapshotJob)
    await lockWaitOn('%FROM tenant_setting_version%')
    const load = reload(user, batch)
    await lockWaitOn(`%SET state = 'superseded'%`)
    await blocker.query('COMMIT')

    await expect(Promise.all([job, load])).resolves.toBeDefined()
  } finally {
    await blocker.query('ROLLBACK')
    blocker.release()
  }
  const states = await Promise.all([ready, computing].map(async (id) => (await getSnapshot(app, user, id)).json().data.state))
  const events = await ownerRows<{ action: string }>(
    'SELECT action FROM audit.audit_event WHERE tenant_id = $1 AND object_id = $2 ORDER BY seq', [tenant.id, computing],
  )

  expect(states).toEqual(['outdated', 'outdated'])
  expect(events.map((e) => e.action)).toEqual(['SNAPSHOT.CREATED', 'SNAPSHOT.READY', 'SNAPSHOT.OUTDATED'])
})
