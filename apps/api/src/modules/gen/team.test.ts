import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { genModule } from './index.js'
import { activeType, enrol, participant, position, rebuildNow } from './test-support.js'

// D-B5-10 portal team view (FR-DIST-004): AC-05.1, AC-05.2 / TS-20, AC-DIST4-1, AC-DIST4-2, T-B5-20.

let app: FastifyInstance
let acmeId: string
let viewer: TestUser
let admin: TestUser
let foreignPosition: string
let gb: string
let distType: string
const ids: Record<string, string> = {}
const owners: Record<string, string> = {}

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  acmeId = acme.id
  gb = await createMarket(acme.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  const dpo = await createSignedInUser({ tenantId: acme.id, roles: ['DPO'] })
  distType = await activeType(admin, dpo, 'DIST', { holdsPositions: true, endCustomer: false })
  for (const ref of ['ROOT', 'V', 'O', 'L1', 'L2', 'L3']) {
    owners[ref] = await participant(admin, gb, distType, ref, ref === 'L1' ? { contact: { email: 'lena@example.com' } } : {})
    ids[ref] = await position(admin, owners[ref]!, gb, `P-${ref}`)
  }
  for (const [child, parent] of [['V', 'ROOT'], ['O', 'ROOT'], ['L1', 'V'], ['L2', 'L1'], ['L3', 'L2']] as const) {
    await enrol(admin, 'sponsor', ids[child]!, ids[parent]!)
  }
  await rebuildNow()
  viewer = await createPortalUser({ tenantId: acme.id, participantId: owners.V! })
  const globex = await createTenant()
  const globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  const globexDpo = await createSignedInUser({ tenantId: globex.id, roles: ['DPO'] })
  const globexMarket = await createMarket(globex.id, 'GB')
  const globexType = await activeType(globexAdmin, globexDpo, 'DIST', { holdsPositions: true, endCustomer: false })
  foreignPosition = await position(globexAdmin, await participant(globexAdmin, globexMarket, globexType, 'G'), globexMarket, 'P-G')
  app = await buildTestApp({ modules: [genModule] })
})

afterAll(async () => {
  await app.close()
})

const team = (query = '', as: TestUser = viewer) => call(app, { method: 'GET', url: `/v1/me/team${query}`, as })

describe('GET /v1/me/team', () => {
  test('AC-05.1: the own position, personally sponsored with the permitted fields, deeper levels as counts only', async () => {
    const response = await team()
    expect(response.statusCode).toBe(200)
    const { data } = response.json()
    expect(data.viewer).toEqual({ position_id: ids.V, position_ref: 'P-V' })
    expect(data.node).toMatchObject({ position_id: ids.V, depth: 0, position_ref: 'P-V' })
    expect(data.children).toEqual([
      { position_id: ids.L1, depth: 1, display_name: 'Name L1', position_ref: 'P-L1', status: 'active', enrolled_on: expect.any(String) },
    ])
    expect(data.hidden_levels).toEqual([{ depth: 2, count: 1 }, { depth: 3, count: 1 }])
    expect(data.policy).toEqual({ named_depth: 1, contact_for_personally_sponsored: false, default: true })
    expect(response.body).not.toContain('lena')
    expect(response.body).not.toContain(ids.L2)

    const level1 = (await team(`?node=${ids.L1}`)).json().data
    expect(level1.node).toMatchObject({ position_id: ids.L1, depth: 1 })
    expect(level1.children).toEqual([])
    expect(level1.hidden_levels).toEqual([{ depth: 2, count: 1 }, { depth: 3, count: 1 }])
    const [audit] = await ownerRows<{ after: Record<string, unknown> }>(
      `SELECT after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE tenant_id = $1 AND action = 'GENEALOGY.DOWNLINE_VIEWED' ORDER BY seq DESC LIMIT 1`,
      [acmeId])
    expect(audit!.after).toMatchObject({ viewer: ids.V, target: ids.L1, policy_version: null })
  })

  test('TS-20 / AC-05.2: upline, a sibling, another tenant or an unknown id as node is 404, the same body', async () => {
    const unknown = await team(`?node=${randomUUID()}`)
    expect(unknown.statusCode).toBe(404)
    for (const node of [ids.ROOT, ids.O, foreignPosition]) {
      const response = await team(`?node=${node}`)
      expect(response.statusCode).toBe(404)
      expect(response.json().error).toEqual({ ...unknown.json().error, request_id: expect.any(String) })
    }
  })

  test('AC-DIST4-2: a position the participant does not own is 404 as viewer', async () => {
    expect((await team(`?position_id=${ids.O}`)).statusCode).toBe(404)
    expect((await team(`?position_id=${foreignPosition}`)).statusCode).toBe(404)
    expect((await team(`?position_id=${ids.V}`)).statusCode).toBe(200)
  })

  test('AC-DIST4-1: search finds only within the named depth; a deeper name or reference gives nothing', async () => {
    expect((await team('?q=Name%20L1')).json().data.matches).toEqual([expect.objectContaining({ position_id: ids.L1, depth: 1 })])
    expect((await team('?q=P-L1')).json().data.matches).toHaveLength(1)
    expect((await team('?q=P-L2')).json().data.matches).toEqual([])
    expect((await team('?q=Name%20L3')).json().data.matches).toEqual([])
    expect((await team('?q=%25')).statusCode).toBe(422)
    expect((await team('?q=_%25')).json().data.matches).toEqual([])
    expect((await team('?q=Name%20L1')).json().meta).toEqual({ truncated: false })
  })

  test('search says when more positions matched than the limit returns', async () => {
    ids.L1B = await position(admin, await participant(admin, gb, distType, 'L1B'), gb, 'P-L1B')
    await enrol(admin, 'sponsor', ids.L1B, ids.V!)
    await rebuildNow()
    const first = await team('?q=Name%20L1&limit=1')
    expect(first.json().data.matches).toEqual([expect.objectContaining({ position_id: ids.L1 })])
    expect(first.json().meta).toEqual({ truncated: true })
    expect((await team('?q=Name%20L1&limit=2')).json().meta).toEqual({ truncated: false })
  })

  test('D-B5-06: a participant with no live position is refused 403 PARTICIPANT_TERMINATED; staff sessions are refused', async () => {
    const closed = await createPortalUser({ tenantId: acmeId, participantId: await participant(admin, gb, distType, 'CLOSED') })
    expect((await team('', closed)).json().error.code).toBe('PARTICIPANT_TERMINATED')
    expect((await team('', admin)).json().error.code).toBe('REALM_FORBIDDEN')
  })
})
