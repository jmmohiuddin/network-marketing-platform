import { randomUUID } from 'node:crypto'
import { withSystem, withTenant } from '@nmp/db'
import fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, testConfig } from '../../test/helpers/index.js'
import { defineTenantJob, enqueue, startWorkers, type Workers } from './jobs.js'

const WAIT_MS = 15_000
const POLL_MS = 100

interface Seen {
  marker: string
  tenantInTx: string | null
  actorType: string | null
}

const seen: Seen[] = []

const echoJob = defineTenantJob({
  name: 'test.echo',
  payload: z.strictObject({ marker: z.string() }),
  async run(tx, payload) {
    const { rows } = await tx.query<{ tenant_id: string | null; actor_type: string | null }>(
      `SELECT app_tenant_id() AS tenant_id, current_setting('app.actor_type', true) AS actor_type`,
    )
    seen.push({ marker: payload.marker, tenantInTx: rows[0]!.tenant_id, actorType: rows[0]!.actor_type })
  },
})

let workers: Workers
let tenantId: string
let userId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  userId = (await createSignedInUser({ tenantId })).id
  workers = await startWorkers({ config: testConfig({ JOB_POOL_SIZE: '2' }), log: fastify({ logger: false }).log, jobs: [echoJob] })
})

afterAll(async () => {
  await workers.stop()
})

async function waitFor(marker: string): Promise<Seen | undefined> {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    const hit = seen.find((entry) => entry.marker === marker)
    if (hit !== undefined) return hit
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return undefined
}

describe('jobs', () => {
  test('a job enqueued in a tenant transaction runs inside withTenant for that tenant, as the system actor', async () => {
    const marker = randomUUID()

    await withTenant({ tenantId, userId }, (tx) => enqueue(tx, echoJob, { marker }))

    expect(await waitFor(marker)).toEqual({ marker, tenantInTx: tenantId, actorType: 'system' })
  })

  test('the job exists only if the transaction commits', async () => {
    const marker = randomUUID()

    await expect(
      withTenant({ tenantId, userId }, async (tx) => {
        await enqueue(tx, echoJob, { marker })
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')
    const jobs = await ownerRows(`SELECT 1 FROM pgboss.job WHERE name = 'test.echo' AND data->'payload'->>'marker' = $1`, [marker])

    expect(jobs).toEqual([])
  })

  test('enqueue needs a tenant transaction and a valid payload', async () => {
    await expect(withSystem((tx) => enqueue(tx, echoJob, { marker: 'x' }))).rejects.toThrow('needs a tenant transaction')
    await expect(
      withTenant({ tenantId, userId }, (tx) => enqueue(tx, echoJob, { marker: 1 } as unknown as { marker: string })),
    ).rejects.toThrow()
  })
})
