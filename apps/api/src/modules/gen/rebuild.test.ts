import { getOwnerPool } from '@nmp/db/testing'
import { beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestUser,
} from '../../../test/helpers/index.js'
import { genModule } from './index.js'
import { modelState } from './read-model.js'
import { pathsRebuildJob, REBUILD_JOB_NAME } from './rebuild.js'
import { activeType, asUser, enrol, markStale, participant, position, rebuildNow } from './test-support.js'
import { childrenPage } from './tree.js'

// T-B2-22 (FR-GEN-008, D-B2-07): labels, depth, parent and subtree counts, version switch, the conditional stale clear
// and the failure path (old version keeps serving, stale kept, REBUILD_FAILED).
let user: TestUser
let tenantId: string
let gb: string
let typeId: string
const ids: Record<string, string> = {}

closePoolsAfterAll()

async function holder(by: TestUser, market: string, type: string, ref: string): Promise<string> {
  return position(by, await participant(by, market, type, ref), market, `P-${ref}`)
}

const model = async (tenant = tenantId) => (await ownerRows<{ version: string; stale: boolean; built: boolean }>(
  `SELECT version::text AS version, stale_since IS NOT NULL AS stale, built_at IS NOT NULL AS built FROM path_model
   WHERE tenant_id = $1 AND kind = 'sponsor'`, [tenant]))[0]

const versions = async () => (await ownerRows<{ v: number }>(
  `SELECT DISTINCT model_version::int AS v FROM path_node WHERE tenant_id = $1 AND kind = 'sponsor' ORDER BY v`, [tenantId]))
  .map((row) => row.v)

// A new position marks both models stale (0303, OI-3): these tests follow the sponsor model.
const rebuildSponsor = async () => (await rebuildNow()).filter((outcome) => outcome.kind === 'sponsor')

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  tenantId = acme.id
  gb = await createMarket(acme.id, 'GB')
  user = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  typeId = await activeType(user, approver, 'DIST', { holdsPositions: true, endCustomer: false })
  for (const ref of ['R', 'A', 'B', 'C']) ids[ref] = await holder(user, gb, typeId, ref)
  await enrol(user, 'sponsor', ids.A!, ids.R!)
  await enrol(user, 'sponsor', ids.B!, ids.A!)
  await enrol(user, 'sponsor', ids.C!, ids.R!)
})

describe('gen.paths.rebuild (T-B2-22)', () => {
  test('the module runs it as a system job every minute', () => {
    expect(genModule.jobs).toContain(pathsRebuildJob)
    expect(pathsRebuildJob).toMatchObject({ name: REBUILD_JOB_NAME, scope: 'system', cron: '* * * * *' })
    expect(REBUILD_JOB_NAME).toBe('gen.paths.rebuild')
  })

  test('AC-GEN8-1: a stale model is built with labels, depths, parents and subtree counts, then serves', async () => {
    expect(await model()).toEqual({ version: '0', stale: true, built: false })
    expect(await rebuildSponsor()).toEqual([{ kind: 'sponsor', result: 'rebuilt', version: '1', nodes: 4, stillStale: false }])
    const nodes = await ownerRows<{ position_id: string; parent_position_id: string | null; path: string; depth: number; subtree_count: number }>(
      `SELECT n.position_id, n.parent_position_id, n.path::text AS path, n.depth, n.subtree_count FROM path_node n
       WHERE n.tenant_id = $1 AND n.kind = 'sponsor' AND n.model_version = 1 ORDER BY n.path`, [tenantId])
    const labels = await ownerRows<{ id: string; label: string }>('SELECT id, label FROM position WHERE tenant_id = $1', [tenantId])
    const label = (ref: string) => labels.find((row) => row.id === ids[ref])!.label
    expect(nodes).toEqual(expect.arrayContaining([
      { position_id: ids.R, parent_position_id: null, path: label('R'), depth: 0, subtree_count: 3 },
      { position_id: ids.A, parent_position_id: ids.R, path: `${label('R')}.${label('A')}`, depth: 1, subtree_count: 1 },
      { position_id: ids.B, parent_position_id: ids.A, path: `${label('R')}.${label('A')}.${label('B')}`, depth: 2, subtree_count: 0 },
      { position_id: ids.C, parent_position_id: ids.R, path: `${label('R')}.${label('C')}`, depth: 1, subtree_count: 0 },
    ]))
    expect(nodes).toHaveLength(4)
    expect(await model()).toEqual({ version: '1', stale: false, built: true })
    expect(await auditActions(tenantId)).toContain('GENEALOGY.REBUILT')
    expect(await rebuildSponsor()).toEqual([]) // nothing stale, nothing to do
  })

  test('a write makes it stale; the next run switches to version 2 and keeps version 1 one more cycle', async () => {
    const d = await holder(user, gb, typeId, 'D')
    await enrol(user, 'sponsor', d, ids.B!)
    expect((await model())!.stale).toBe(true)
    await rebuildNow()
    expect(await model()).toEqual({ version: '2', stale: false, built: true })
    expect(await versions()).toEqual([1, 2])
    expect(await ownerRows(`SELECT subtree_count FROM path_node WHERE position_id = $1 AND kind = 'sponsor' AND model_version = 2`, [ids.R]))
      .toEqual([{ subtree_count: 4 }])
  })

  test('a reader that read version N before a switch still finds its nodes; version N - 1 goes', async () => {
    await asUser(user, async (tx) => {
      const state = await modelState(tx, 'sponsor')
      const view = { kind: 'sponsor' as const, asOf: null, knownAt: null, modelVersion: state.version }
      const before = await childrenPage(tx, view, ids.R!, undefined, 50)
      await markStale(tenantId, 'sponsor')
      await rebuildNow() // another connection switches to version 3 while this transaction reads
      expect(await childrenPage(tx, view, ids.R!, undefined, 50)).toEqual(before)
      expect(before.ids).toHaveLength(2)
    })
    expect(await versions()).toEqual([2, 3])
  })

  test('a write committed during the build switches the version but keeps the model stale', async () => {
    await ownerRows(`UPDATE path_model SET stale_since = now() WHERE tenant_id = $1 AND kind = 'sponsor'`, [tenantId])
    const writer = await getOwnerPool().connect()
    try {
      await writer.query('BEGIN')
      await writer.query(`UPDATE path_model SET stale_since = stale_since WHERE tenant_id = $1 AND kind = 'sponsor'`, [tenantId])
      const run = rebuildSponsor()
      for (let tries = 0; tries < 200; tries += 1) {
        const [waiting] = await ownerRows<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE path_model SET version%'`)
        if (waiting!.n > 0) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await writer.query('COMMIT')
      expect(await run).toEqual([{ kind: 'sponsor', result: 'rebuilt', version: '4', nodes: 5, stillStale: true }])
    } finally {
      writer.release()
    }
    expect(await model()).toEqual({ version: '4', stale: true, built: true })
    await rebuildNow()
    expect(await model()).toEqual({ version: '5', stale: false, built: true })
  })

  test('TS-61, BR-GEN-12: a future-dated change that takes effect after the build makes the model stale; never served', async () => {
    const app = await buildTestApp({ modules: [genModule] })
    try {
      const support = await createSignedInUser({ tenantId, roles: ['Support agent'] })
      await asUser(user, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by)
           SELECT app_tenant_id(), 'genealogy_change', 'position', p.id, 'COMPANY_DECISION', 'open', 'null'::jsonb, p.market_id,
             app_user_id() FROM position p WHERE p.id = $1 RETURNING id`, [ids.B])
        await tx.query(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, now() + interval '2 seconds', 'change', $3, NULL)`,
          [ids.B, ids.R, rows[0]!.id])
      })
      await rebuildNow() // built before the change takes effect: B still under A
      const [expiry] = await ownerRows<{ until_change: boolean; stale: boolean }>(
        `SELECT m.valid_until = (SELECT max(valid_from) FROM relationship WHERE child_position_id = $2) AS until_change,
           m.stale_since IS NOT NULL AS stale
         FROM path_model m WHERE m.tenant_id = $1 AND m.kind = 'sponsor'`, [tenantId, ids.B])
      expect(expiry).toEqual({ until_change: true, stale: false }) // OI-3: the build knows when it expires
      const downline = () => call(app, { method: 'GET', url: `/v1/positions/${ids.B}/downline?viewer=${ids.A}`, as: support })
      expect((await downline()).statusCode).toBe(200)
      await ownerRows(`SELECT pg_sleep(greatest(0, extract(epoch FROM (SELECT max(valid_from) FROM relationship
        WHERE child_position_id = $1) - clock_timestamp())) + 0.05)`, [ids.B])
      const moved = await downline()
      expect(moved.statusCode).toBe(404) // the system of record has B under R now
      const tree = (await call(app, { method: 'GET', url: `/v1/genealogy/tree?root=${ids.R}`, as: support })).json()
      expect(tree.data.children.map((node: { position_id: string }) => node.position_id)).toContain(ids.B)
      expect(tree.meta.read_model).toMatchObject({ source: 'system_of_record', state: 'stale', stale_since: expect.any(String) })
      // OI-3: expired by valid_until (no per-read scan and no write by the read); the job lists it and rebuilds.
      const [expired] = await ownerRows<{ expired: boolean; stale: boolean }>(
        `SELECT valid_until <= now() AS expired, stale_since IS NOT NULL AS stale FROM path_model WHERE tenant_id = $1 AND kind = 'sponsor'`,
        [tenantId])
      expect(expired).toEqual({ expired: true, stale: false })
      await rebuildNow()
      const rebuilt = (await call(app, { method: 'GET', url: `/v1/genealogy/tree?root=${ids.R}`, as: support })).json()
      expect(rebuilt.meta.read_model).toMatchObject({ source: 'read_model', state: 'current' })
      expect(rebuilt.data.children.map((node: { position_id: string }) => node.position_id)).toContain(ids.B)
    } finally {
      await app.close()
    }
  })

  test('AC-GEN8-2: a build that fails validation leaves the old version serving, stays stale and is audited', async () => {
    const broken = await createTenant()
    const market = await createMarket(broken.id, 'GB')
    const owner = await createSignedInUser({ tenantId: broken.id, roles: ['Tenant admin'] })
    const approver = await createSignedInUser({ tenantId: broken.id, roles: ['Compliance officer'] })
    const type = await activeType(owner, approver, 'DIST', { holdsPositions: true, endCustomer: false })
    const [x, y] = [await holder(owner, market, type, 'X'), await holder(owner, market, type, 'Y')]
    await enrol(owner, 'sponsor', y, x)
    await rebuildNow()
    // A cycle the guard would refuse, written around it: X and Y are then unreachable from any root.
    const client = await getOwnerPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL session_replication_role = replica`)
      await client.query(`INSERT INTO relationship (tenant_id, kind, parent_position_id, child_position_id, valid_from, event_type, created_by)
        VALUES ($1, 'sponsor', $2, $3, now() - interval '1 day', 'migration', $4)`, [broken.id, y, x, owner.id])
      await client.query(`UPDATE path_model SET stale_since = now() WHERE tenant_id = $1`, [broken.id])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    const outcomes = await rebuildSponsor()
    expect(outcomes.map((outcome) => outcome.result)).toEqual([])
    expect(await model(broken.id)).toEqual({ version: '1', stale: true, built: true })
    expect(await ownerRows(`SELECT count(*)::int AS n FROM path_node WHERE tenant_id = $1 AND kind = 'sponsor' AND model_version = 1`, [broken.id])).toEqual([{ n: 2 }])
    const [failed] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'GENEALOGY.REBUILD_FAILED'`, [broken.id])
    expect(JSON.parse(failed!.after_ref).after).toEqual({ kind: 'sponsor', code: 'COUNT_MISMATCH' })
  })
})
