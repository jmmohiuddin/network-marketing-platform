import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { genModule } from './index.js'
import { activeType, asUser, correct, daysAgo, dbNow, enrol, markStale, participant, position, rebuildNow } from './test-support.js'

// API-14 and search (FR-GEN-003, FR-GEN-007): T-B2-17 as-of/known-at matrix, TS-03 (view part), E-GEN-05, T-B2-21
// search + paging + breadcrumbs, AC-GEN7-1 (1,000 direct children paged without a subtree scan), AC-GEN7-2.
let app: FastifyInstance
let analyst: TestUser
let analystGb: TestUser
let admin: TestUser
let globexAnalyst: TestUser
let gb: string
let typeId: string
const ids: Record<string, string> = {}

closePoolsAfterAll()

async function holder(ref: string, displayName = `Name ${ref}`): Promise<string> {
  const owner = await participant(admin, gb, typeId, ref, { displayName })
  return position(admin, owner, gb, `P-${ref}`)
}

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  analystGb = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [gb] })
  globexAnalyst = await createSignedInUser({ tenantId: globex.id, roles: ['Commission analyst'] })
  typeId = await activeType(admin, approver, 'DIST', { holdsPositions: true, endCustomer: false })
  // R - A - B, R - C, R - X (X is corrected below)
  for (const ref of ['R', 'A', 'B', 'C', 'X']) ids[ref] = await holder(ref, ref === 'B' ? 'Beatrice Holloway' : `Name ${ref}`)
  await enrol(admin, 'sponsor', ids.A!, ids.R!)
  await enrol(admin, 'sponsor', ids.B!, ids.A!)
  await enrol(admin, 'sponsor', ids.C!, ids.R!)
  await enrol(admin, 'sponsor', ids.X!, ids.R!)
  await rebuildNow()
  app = await buildTestApp({ modules: [genModule] })
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const refs = (nodes: { position_ref: string }[]) => nodes.map((node) => node.position_ref)

describe('GET /v1/genealogy/tree (API-14)', () => {
  test('reads the current read model: focus, breadcrumbs root first, one level of children with counts', async () => {
    const response = await get(analyst, `/v1/genealogy/tree?root=${ids.A}`)
    expect(response.statusCode).toBe(200)
    const { data, meta } = response.json()
    expect(data.focus).toMatchObject({
      position_id: ids.A, position_ref: 'P-A', status: 'active', market_code: 'GB', leg: null, children_count: 1, subtree_count: 1,
      owner: { external_ref: 'A', display_name: 'Name A' },
    })
    expect(refs(data.breadcrumbs)).toEqual(['P-R'])
    expect(data.breadcrumbs_truncated).toBe(false)
    expect(refs(data.children)).toEqual(['P-B'])
    expect(meta.read_model).toMatchObject({ source: 'read_model', state: 'current', stale_since: null })
    expect(meta.next_cursor).toBeNull()
  })

  test('opens by reference; without a root lists the top-level positions', async () => {
    const byRef = (await get(analyst, '/v1/genealogy/tree?root=P-R')).json().data
    expect(byRef.focus.subtree_count).toBe(4)
    expect(refs(byRef.children)).toEqual(['P-A', 'P-C', 'P-X'])
    expect(refs((await get(analyst, '/v1/genealogy/tree')).json().data.children)).toEqual(['P-R'])
  })

  test('AC-GEN7-2: a stale model answers from the system of record and says so', async () => {
    const tenantId = analyst.tenantId!
    await markStale(tenantId, 'sponsor')
    const { data, meta } = (await get(analyst, `/v1/genealogy/tree?root=${ids.A}`)).json()
    expect(meta.read_model).toMatchObject({ source: 'system_of_record', state: 'stale' })
    expect(meta.read_model.stale_since).not.toBeNull()
    expect(data.focus).toMatchObject({ children_count: 1, subtree_count: null })
    expect(refs(data.breadcrumbs)).toEqual(['P-R'])
    await rebuildNow()
  })

  test('BR-GEN-12: a position created after the build (no relationship write) makes the model stale; it is listed', async () => {
    const lone = await holder('LONE')
    const { data, meta } = (await get(analyst, '/v1/genealogy/tree')).json()
    expect(meta.read_model).toMatchObject({ source: 'system_of_record', state: 'stale' })
    expect(refs(data.children)).toEqual(['P-LONE', 'P-R'])
    await rebuildNow()
    const rebuilt = (await get(analyst, '/v1/genealogy/tree')).json()
    expect(rebuilt.meta.read_model).toMatchObject({ source: 'read_model', state: 'current' })
    expect(rebuilt.data.children.map((node: { position_id: string }) => node.position_id)).toContain(lone)
  })

  test('TS-03 (view part), T-B2-17, E-GEN-05: as of a date and as known at a time, through two corrections', async () => {
    const parentOf = async (query: string) => {
      const crumbs = (await get(analyst, `/v1/genealogy/tree?root=${ids.X}&${query}`)).json().data.breadcrumbs
      return crumbs.at(-1)?.position_ref
    }
    const beforeFirst = await dbNow()
    await correct(admin, 'sponsor', ids.X!, ids.A!, daysAgo(30))
    const beforeSecond = await dbNow()
    await correct(admin, 'sponsor', ids.X!, ids.C!, daysAgo(30))
    const asOf = daysAgo(20)
    expect(await parentOf(`as_of=${asOf}&known_at=${beforeFirst}`)).toBe('P-R')
    expect(await parentOf(`as_of=${asOf}&known_at=${beforeSecond}`)).toBe('P-A')
    expect(await parentOf(`as_of=${asOf}`)).toBe('P-C')
    expect(await parentOf(`as_of=${daysAgo(40)}`)).toBe('P-R') // the part before the corrected date is kept
    expect(await parentOf(`as_of=${daysAgo(90)}`)).toBeUndefined() // not enrolled yet
    const before = (await get(analyst, `/v1/genealogy/tree?root=${ids.R}&as_of=${asOf}&known_at=${beforeFirst}`)).json()
    expect(refs(before.data.children)).toEqual(['P-A', 'P-C', 'P-X'])
    expect(before.meta.read_model.source).toBe('system_of_record')
    const dated = (await get(analyst, `/v1/genealogy/tree?root=${ids.R}&as_of=${asOf.slice(0, 10)}`)).json().data
    expect(refs(dated.children)).toEqual(['P-A', 'P-C'])
  })

  test('validation: known_at needs as_of and is not in the future; unknown root 404; bad kind 400', async () => {
    const past = daysAgo(1)
    expect((await get(analyst, `/v1/genealogy/tree?known_at=${past}`)).json().error.code).toBe('VALIDATION_FAILED')
    const future = await get(analyst, `/v1/genealogy/tree?as_of=${past}&known_at=${daysAgo(-1)}`)
    expect([future.statusCode, future.json().error.code]).toEqual([422, 'VALIDATION_FAILED'])
    expect((await get(analyst, '/v1/genealogy/tree?root=00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    expect((await get(analyst, '/v1/genealogy/tree?root=P-NOPE')).statusCode).toBe(404)
    expect((await get(analyst, '/v1/genealogy/tree?kind=binary')).statusCode).toBe(400)
  })

  test('needs genealogy.read for all markets; another tenant\'s position is unknown', async () => {
    expect((await get(admin, '/v1/genealogy/tree')).json().error.code).toBe('PERMISSION_DENIED')
    expect((await get(analystGb, '/v1/genealogy/tree')).json().error.code).toBe('SCOPE_NOT_HELD')
    expect((await get(globexAnalyst, `/v1/genealogy/tree?root=${ids.A}`)).statusCode).toBe(404)
    expect((await get(globexAnalyst, '/v1/genealogy/tree')).json().data.children).toEqual([])
  })

  test('breadcrumbs keep the 50 nearest ancestors and say they are truncated (read model and system of record)', async () => {
    let parent = ids.B!
    for (let level = 0; level < 50; level += 1) {
      const child = await holder(`D${level}`)
      await enrol(admin, 'sponsor', child, parent)
      parent = child
    }
    const check = async (query: string, source: string) => {
      const { data, meta } = (await get(analyst, `/v1/genealogy/tree?root=${parent}${query}`)).json()
      expect(meta.read_model.source).toBe(source)
      expect(data.breadcrumbs).toHaveLength(50)
      expect(data.breadcrumbs_truncated).toBe(true)
      expect(refs(data.breadcrumbs).slice(0, 2)).toEqual(['P-B', 'P-D0']) // A and R are the 51st and 52nd nearest
      expect(data.breadcrumbs.at(-1).position_ref).toBe('P-D48')
    }
    await check(`&as_of=${new Date().toISOString()}`, 'system_of_record')
    await rebuildNow()
    await check('', 'read_model')
  })
})

describe('AC-GEN7-1: a root with 1,000 direct children', () => {
  test('pages the children by parent with a cursor', async () => {
    const wide = await createTenant()
    const market = await createMarket(wide.id, 'GB')
    const owner = await createSignedInUser({ tenantId: wide.id, roles: ['Tenant admin'] })
    const reader = await createSignedInUser({ tenantId: wide.id, roles: ['Commission analyst'] })
    const type = await activeType(owner, reader, 'DIST', { holdsPositions: true, endCustomer: false })
    await ownerRows(
      `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by)
       SELECT $1, 'W' || n, 'individual', $2, now() - interval '10 days', $3 FROM generate_series(0, 1000) n`,
      [wide.id, market, owner.id],
    )
    await ownerRows(
      `INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by)
       SELECT tenant_id, id, $2, enrolled_at, $3 FROM participant WHERE tenant_id = $1`,
      [wide.id, type, owner.id],
    )
    await asUser(owner, async (tx) => {
      await tx.query(`SELECT gen_create_position(id, market_id, NULL, 'P-' || external_ref, 'active', enrolled_at) FROM participant
        ORDER BY external_ref`)
      await tx.query(`SELECT gen_apply_relationship('sponsor', p.id, r.id, NULL, now() - interval '9 days', 'enrolment', NULL, NULL)
        FROM position p, position r WHERE r.position_ref = 'P-W0' AND p.id <> r.id ORDER BY p.position_ref`)
    })
    await rebuildNow()
    const seen: string[] = []
    let cursor: string | null = ''
    while (cursor !== null) {
      const response = await get(reader, `/v1/genealogy/tree?root=P-W0&limit=200${cursor === '' ? '' : `&cursor=${cursor}`}`)
      const { data, meta } = response.json()
      expect(data.focus).toMatchObject({ children_count: 1000, subtree_count: 1000 })
      expect(meta.read_model.source).toBe('read_model')
      seen.push(...refs(data.children))
      cursor = meta.next_cursor
    }
    expect(seen).toHaveLength(1000)
    expect(new Set(seen).size).toBe(1000)
    expect(seen).toEqual([...seen].sort())
  })
})

describe('GET /v1/genealogy/search (FR-GEN-007)', () => {
  test('finds by reference prefix, exact external reference and name; nothing of another tenant', async () => {
    const search = async (as: TestUser, q: string) => refs((await get(as, `/v1/genealogy/search?q=${encodeURIComponent(q)}`)).json().data)
    expect(await search(analyst, 'p-d4')).toEqual(['P-D4', 'P-D40', 'P-D41', 'P-D42', 'P-D43', 'P-D44', 'P-D45', 'P-D46', 'P-D47', 'P-D48', 'P-D49'])
    expect(await search(analyst, 'C')).toEqual(['P-C'])
    expect(await search(analyst, 'Beatrice Holloway')).toEqual(['P-B'])
    expect(await search(analyst, 'P-')).toHaveLength(20)
    expect(await search(analyst, '%')).toEqual([])
    expect(await search(globexAnalyst, 'P-A')).toEqual([])
  })

  test('validation and permission', async () => {
    expect((await get(analyst, '/v1/genealogy/search')).statusCode).toBe(400)
    expect((await get(analyst, `/v1/genealogy/search?q=${'x'.repeat(101)}`)).statusCode).toBe(400)
    expect((await get(admin, '/v1/genealogy/search?q=P')).statusCode).toBe(403)
    expect((await get(analystGb, '/v1/genealogy/search?q=P')).statusCode).toBe(403)
  })
})

describe('opening a position by reference', () => {
  test('a reference shaped like a UUID opens that position; ids still open by id', async () => {
    const ref = 'a1b2c3d4-0000-4000-8000-00000000abcd'
    const legacy = await position(admin, await participant(admin, gb, typeId, 'LEGACY'), gb, ref)
    const byRef = (await get(analyst, `/v1/genealogy/tree?root=${ref}`)).json().data
    expect(byRef.focus).toMatchObject({ position_id: legacy, position_ref: ref })
    expect((await get(analyst, `/v1/genealogy/tree?root=${ids.A}`)).json().data.focus.position_id).toBe(ids.A)
  })
})
