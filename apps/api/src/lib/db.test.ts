import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { beforeAll, describe, expect, test } from 'vitest'
import { closePoolsAfterAll, createTenant, ownerRows, resetApiDb } from '../../test/helpers/index.js'
import { recordAudit } from './audit.js'
import { inTenant } from './db.js'

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
})

describe('inTenant for an API key caller (D-B1-19)', () => {
  test('runs in the key tenant and audits as the service account, without a session', async () => {
    const tenant = await createTenant()
    const serviceAccountId = randomUUID()
    const request = {
      id: 'req-key-1',
      auth: null,
      apiKey: { keyId: randomUUID(), tenantId: tenant.id, serviceAccountId, scopes: ['compliance:read'], rateTier: 'standard' },
    } as unknown as FastifyRequest

    const realm = await inTenant(request, async (tx) => {
      await recordAudit(tx, { action: 'API_KEY.READ', after: { count: 0 } })
      const { rows } = await tx.query<{ tenant: string; realm: string }>(
        `SELECT app_tenant_id()::text AS tenant, app_realm() AS realm`,
      )
      return rows[0]
    })
    const audit = await ownerRows('SELECT actor_type, actor_id, request_id FROM audit.audit_event WHERE tenant_id = $1', [tenant.id])

    expect(realm).toEqual({ tenant: tenant.id, realm: 'tenant' })
    expect(audit).toEqual([{ actor_type: 'service_account', actor_id: serviceAccountId, request_id: 'req-key-1' }])
  })
})
