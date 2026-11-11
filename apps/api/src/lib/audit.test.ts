import { withSystem } from '@nmp/db'
import { beforeAll, describe, expect, test } from 'vitest'
import { closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb } from '../../test/helpers/index.js'
import { recordAudit, recordVendorAudit } from './audit.js'
import { runInTenant, runInVendor, SYSTEM_ACTOR_ID } from './db.js'
import { enqueueOutbox } from './outbox.js'

let tenantId: string
let userId: string
let vendorId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  userId = (await createSignedInUser({ tenantId })).id
  vendorId = (await createSignedInUser({ tenantId: null })).id
})

describe('recordAudit', () => {
  test('takes tenant, actor, request id and support session from the transaction, not from the caller', async () => {
    const supportSessionId = '11111111-1111-4111-8111-111111111111'
    const actor = { actorType: 'vendor_user' as const, requestId: 'req-1', supportSessionId }

    const { id } = await runInTenant({ tenantId, userId }, actor, (tx) =>
      recordAudit(tx, { action: 'TEST.DONE', objectType: 'thing', objectId: userId, before: { a: 1 }, after: { a: 2 }, reason: 'because' }),
    )
    const [row] = await ownerRows('SELECT * FROM audit.audit_event WHERE id = $1', [id])

    expect(row).toMatchObject({
      tenant_id: tenantId, actor_type: 'vendor_user', actor_id: userId, support_session_id: supportSessionId,
      request_id: 'req-1', action: 'TEST.DONE', before_ref: '{"a":1}', after_ref: '{"after":{"a":2},"reason":"because"}',
    })
  })

  test('the system actor is stored as no actor, and an outbox row is written in the same transaction', async () => {
    const system = { actorType: 'system' as const, requestId: null, supportSessionId: null }

    const [audit, outboxId] = await runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, system, async (tx) => [
      await recordAudit(tx, { action: 'TEST.SYSTEM' }),
      await enqueueOutbox(tx, { type: 'test.event', payload: { x: 1 } }),
    ] as const)
    const [event] = await ownerRows('SELECT actor_type, actor_id, request_id FROM audit.audit_event WHERE id = $1', [audit.id])
    const [outbox] = await ownerRows('SELECT tenant_id, topic, payload, created_by FROM outbox_event WHERE id = $1', [outboxId])

    expect(event).toEqual({ actor_type: 'system', actor_id: null, request_id: null })
    expect(outbox).toEqual({ tenant_id: tenantId, topic: 'test.event', payload: { x: 1 }, created_by: null })
  })

  test('cannot write outside a tenant transaction', async () => {
    await expect(withSystem((tx) => recordAudit(tx, { action: 'TEST.NOWHERE' }))).rejects.toThrow()
  })
})

describe('recordVendorAudit', () => {
  test('writes the vendor chain in the vendor realm', async () => {
    const actor = { actorType: 'vendor_user' as const, requestId: 'req-v', supportSessionId: null }

    const { seq } = await runInVendor(vendorId, actor, (tx) => recordVendorAudit(tx, { action: 'TEST.VENDOR' }))
    const [row] = await ownerRows('SELECT actor_id, action, request_id FROM audit.vendor_event WHERE seq = $1', [seq])

    expect(row).toEqual({ actor_id: vendorId, action: 'TEST.VENDOR', request_id: 'req-v' })
  })
})
