import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, closePoolsAfterAll, ownerRows, resetApiDb, runQueuedJobs, testConfig, type TestUser } from '../../../test/helpers/index.js'
import { runTenantJob } from '../../lib/jobs.js'
import { cplModule, computeSnapshotJob } from './index.js'
import {
  figureIn, freshTenant, getRows, getSnapshot, JAN_FEB, JAN_FEB_DATES, loadBatch, newMappingVersion, PROTOTYPE_SETTINGS,
  requestSnapshot, supersede, TS31,
} from './test-fixtures.js'

let app: FastifyInstance

const worker = () => ({ config: testConfig(), log: fastify({ logger: false }).log })

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [cplModule] })
})

afterAll(async () => {
  await app.close()
})

async function readySnapshot(as: TestUser, body: Record<string, unknown> = JAN_FEB) {
  const created = await requestSnapshot(app, as, body)
  await runQueuedJobs(computeSnapshotJob)
  return (await getSnapshot(app, as, created.json().data.id)).json()
}

const states = (user: TestUser, ids: readonly string[]) =>
  Promise.all(ids.map(async (id) => (await getSnapshot(app, user, id)).json().data))

interface EventRow { action: string; object_id: string; after_ref: string; [column: string]: unknown }
const snapshotEvents = (tenantId: string) =>
  ownerRows<EventRow>(
    `SELECT action, object_id, after_ref FROM audit.audit_event
     WHERE tenant_id = $1 AND action IN ('SNAPSHOT.OUTDATED', 'SNAPSHOT.FAILED') ORDER BY seq`,
    [tenantId],
  )

const outdatedEvent = (events: readonly EventRow[]): EventRow => events.find((e) => e.action === 'SNAPSHOT.OUTDATED')!

describe('snapshot states (FR-CPL-006: computing -> ready | failed, ready -> outdated)', () => {
  test('a load or supersede behind the range outdates ready snapshots and fails computing ones, audited; others stay', async () => {
    const { user, market, batch, tenant } = await freshTenant(TS31)
    await loadBatch(user, market, ['2025-06-01', '2025-06-30'], {
      participants: [['D1', 'distributor', '2024-12', null]], orders: [['J1', '2025-06-02', 'D1', '100', '100', 'personal', false, '0', null]], lines: [],
    })
    const ready = await readySnapshot(user)
    const june = await readySnapshot(user, { ...JAN_FEB, period_from: '2025-06', period_to: '2025-06' })
    const computing = (await requestSnapshot(app, user, JAN_FEB)).json().data

    const reload = await loadBatch(user, market, JAN_FEB_DATES, TS31)
    await supersede(user, batch, reload)
    await runQueuedJobs(computeSnapshotJob)
    const after = await states(user, [ready.data.id, june.data.id, computing.id])
    const events = await snapshotEvents(tenant.id)
    const renewed = (await requestSnapshot(app, user, JAN_FEB)).json().data

    expect(after.map((s) => s.state)).toEqual(['outdated', 'ready', 'failed'])
    expect(after[0].results).toEqual(ready.data.results)
    expect(after[2]).toMatchObject({ results: [], failure_reason: expect.stringContaining('import batches') })
    expect(events.map((e) => `${e.action} ${e.object_id}`).sort()).toEqual([
      `SNAPSHOT.FAILED ${computing.id}`, `SNAPSHOT.OUTDATED ${ready.data.id}`,
    ])
    expect(JSON.parse(outdatedEvent(events).after_ref).after).toEqual({ state: 'outdated', import_batch_id: reload })
    expect(renewed.input_batch_ids).toEqual([reload])
  })

  test('AC-40.1: a new mapping version outdates ready snapshots on an earlier one, which keep their version; computing ones fail', async () => {
    const { user, tenant } = await freshTenant(TS31)
    const ready = await readySnapshot(user)
    const computing = (await requestSnapshot(app, user, JAN_FEB)).json().data

    const mappingId = await newMappingVersion(user)
    await runQueuedJobs(computeSnapshotJob)
    const [outdated, failed] = await states(user, [ready.data.id, computing.id])
    const events = await snapshotEvents(tenant.id)

    expect(outdated).toMatchObject({ state: 'outdated', input_mapping_versions: [1], results: ready.data.results })
    expect(failed).toMatchObject({ state: 'failed', failure_reason: expect.stringContaining('mapping') })
    expect(events.map((e) => e.action).sort()).toEqual(['SNAPSHOT.FAILED', 'SNAPSHOT.OUTDATED'])
    expect(JSON.parse(outdatedEvent(events).after_ref).after).toEqual({ state: 'outdated', import_mapping_id: mappingId, mapping_version: 2 })
    expect((await getRows(app, user, ready.data.id, 'R1.2025-01.customer_share_pct')).statusCode).toBe(200)
  })

  test('the facts of a loaded or superseded batch can be neither added nor removed (BR-IMP-04)', async () => {
    const { user, tenant, batch } = await freshTenant(TS31)
    const asTenant = (sql: string, params: unknown[]) => withTenant({ tenantId: tenant.id, userId: user.id }, (tx) => tx.query(sql, params))
    const guarded = /allowed only while its import batch is being loaded/

    await expect(asTenant(
      `INSERT INTO cpl_fact_order (tenant_id, source, batch_id, order_ref, order_date, buyer_ref, amount_minor, volume_minor,
         purpose, is_starter_kit, refunded_minor) VALUES (app_tenant_id(), 'import', $1, 'O9', '2025-01-09', 'C1', 1, 1, 'customer', false, 0)`,
      [batch],
    )).rejects.toThrow(guarded)
    await expect(asTenant(`DELETE FROM cpl_fact_order WHERE batch_id = $1 AND order_ref = 'O2'`, [batch])).rejects.toThrow(guarded)
    await expect(asTenant(`DELETE FROM cpl_fact_payout_line WHERE batch_id = $1`, [batch])).rejects.toThrow(guarded)
    await expect(asTenant(`DELETE FROM cpl_fact_participant WHERE batch_id = $1`, [batch])).rejects.toThrow(guarded)
    expect(await ownerRows('SELECT 1 FROM cpl_fact_order WHERE batch_id = $1', [batch])).toHaveLength(TS31.orders.length)
  })

  test('BR-CPL-01: a settings save in flight at creation does not change the snapshot; it is computed and drilled on the recorded version', async () => {
    const { user, tenant } = await freshTenant(TS31)
    const created = (await requestSnapshot(app, user, JAN_FEB)).json().data
    // The end state of that interleaving: the save began before the snapshot request and committed after it,
    // so its version starts before the snapshot was created although the snapshot did not read it.
    await withTenant({ tenantId: tenant.id, userId: user.id }, (tx) =>
      tx.query(
        `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
         SELECT app_tenant_id(), max(version) + 1, $1::timestamptz - interval '1 second', $2, 'in flight', $3 FROM tenant_setting_version`,
        [created.created_at, { ...PROTOTYPE_SETTINGS, 'compliance.late_order_day': 1 }, user.id],
      ),
    )

    await runQueuedJobs(computeSnapshotJob)
    const body = (await getSnapshot(app, user, created.id)).json()
    const rows = await getRows(app, user, created.id, 'R4.2025-01.late_threshold_crossing_orders')

    expect(body.data).toMatchObject({ state: 'ready', settings_version_id: created.settings_version_id })
    expect(figureIn(body, 'R4.2025-01.late_threshold_crossing_orders').value).toBe('1') // late day 27, not 1
    expect(rows.statusCode).toBe(200)
    expect(rows.json().data.map((r: { order_ref: string }) => r.order_ref)).toEqual(['O3'])
  })

  test('an error that would repeat on every attempt fails the snapshot instead of leaving it computing', async () => {
    const { user, tenant, market } = await freshTenant(TS31)
    const [snapshot] = await ownerRows<{ id: string }>(
      `INSERT INTO compliance_report_snapshot (tenant_id, market_id, period_from, period_to, method_version, input_refs, state,
         created_by, inputs_hash)
       VALUES ($1, $2, '2025-01-01', '2025-02-28', 'cpl-method-1.0.0', '{"batch_ids": "not a list"}', 'computing', $3, '\\x01')
       RETURNING id`,
      [tenant.id, market, user.id],
    )

    await runTenantJob(computeSnapshotJob, { id: 'malformed', data: { tenantId: tenant.id, payload: { snapshotId: snapshot!.id } } }, worker())
    const [row] = await ownerRows<{ state: string; failure_reason: string }>(
      'SELECT state, failure_reason FROM compliance_report_snapshot WHERE id = $1', [snapshot!.id],
    )

    expect(row).toMatchObject({ state: 'failed', failure_reason: expect.stringContaining('internal error') })
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE object_id = $1 AND action = 'SNAPSHOT.FAILED'`, [snapshot!.id])).toHaveLength(1)
  })

  test('running the job again changes nothing', async () => {
    const { user, tenant } = await freshTenant(TS31)
    const body = await readySnapshot(user)
    const figures = () => ownerRows('SELECT count(*)::int AS n FROM compliance_figure WHERE snapshot_id = $1', [body.data.id])
    const before = await figures()

    await runTenantJob(computeSnapshotJob, { id: 'again', data: { tenantId: tenant.id, payload: { snapshotId: body.data.id } } }, worker())

    expect(await figures()).toEqual(before)
    expect((await getSnapshot(app, user, body.data.id)).json().data.state).toBe('ready')
  })
})
