import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, mailsTo, ownerRows, resetApiDb, testConfig,
} from '../../../test/helpers/index.js'
import { payModule } from './index.js'
import { reviewReminderCron } from './reminders.js'
import { evidenceDocument, payWorld, provider, setSettings, WEBHOOK_SECRET, type PayWorld } from './test-support.js'

let app: FastifyInstance
let w: PayWorld
let other: PayWorld

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  w = await payWorld()
  other = await payWorld()
  app = await buildTestApp({ modules: [payModule] })
}, 120_000)

afterAll(async () => {
  await app.close()
})

const adapter = (id: string, body: unknown, as = w.admin) => call(app, { method: 'PUT', url: `/v1/provider-configs/${id}/adapter`, as, body })
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function recorded(kind: 'payout' | 'payment' = 'payout', reviewDueOn?: string): Promise<string> {
  const created = await call(app, {
    method: 'POST', url: '/v1/provider-configs', as: w.admin, idempotencyKey: true,
    body: {
      market_id: w.market, kind, provider: `Provider ${Math.random().toString(36).slice(2, 8)}`, approved_description: 'Licence (FIXTURE)',
      approval_document_id: await evidenceDocument(w.tenant.id, w.admin.id), approved_at: '2026-10-01', funds_holder: 'Holder (FIXTURE)',
      ...(reviewDueOn === undefined ? {} : { review_due_on: reviewDueOn }),
    },
  })
  return created.json().data.id
}

describe('adapters (AC-PAY2-1, T-B4-14)', () => {
  test('sandbox with a write-only secret, bank file without one; anything else is 422 ADAPTER_NOT_AVAILABLE', async () => {
    const id = await recorded()
    expect((await adapter(id, { adapter: 'razorpayx' })).json().error.code).toBe('ADAPTER_NOT_AVAILABLE')
    expect((await adapter(id, { adapter: 'sandbox' })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await adapter(id, { adapter: 'bank_file_csv', webhook_secret: WEBHOOK_SECRET })).json().error.code).toBe('VALIDATION_FAILED')
    const configured = await adapter(id, { adapter: 'sandbox', webhook_secret: WEBHOOK_SECRET })
    expect(configured.statusCode).toBe(200)
    expect(configured.json().data).toMatchObject({ adapter: 'sandbox', webhook_configured: true })
    expect(configured.body).not.toContain(WEBHOOK_SECRET)
    const [row] = await ownerRows<{ webhook_secret_sealed: string }>('SELECT webhook_secret_sealed FROM provider_config WHERE id = $1', [id])
    expect(row!.webhook_secret_sealed).not.toContain(WEBHOOK_SECRET)
    const list = await call(app, { method: 'GET', url: `/v1/provider-configs?market_id=${w.market}`, as: w.officer })
    expect(list.json().data.find((p: { id: string }) => p.id === id)).toMatchObject({ adapter: 'sandbox', webhook_configured: true, review_due_on: null })
    expect(await auditActions(w.tenant.id)).toContain('PROVIDER.ADAPTER_CONFIGURED')
  })

  test('a payment or commerce record is 422 PROVIDER_KIND_NOT_PAYOUT; withdrawn 409; step-up, permission and tenant are enforced', async () => {
    expect((await adapter(await recorded('payment'), { adapter: 'bank_file_csv' })).json().error.code).toBe('PROVIDER_KIND_NOT_PAYOUT')
    const [commerce] = await ownerRows<{ id: string }>(
      `INSERT INTO provider_config (tenant_id, market_id, kind, provider, name, webhook_secret_sealed, state, created_by)
       VALUES ($1, $2, 'commerce', 'shopify', 'Shop (FIXTURE)', 'sealed (FIXTURE)', 'recorded', $3) RETURNING id`, [w.tenant.id, w.market, w.admin.id])
    expect((await adapter(commerce!.id, { adapter: 'bank_file_csv' })).json().error.code).toBe('PROVIDER_KIND_NOT_PAYOUT')
    const withdrawn = await recorded()
    await call(app, { method: 'POST', url: `/v1/provider-configs/${withdrawn}/withdraw`, as: w.admin, body: { reason: 'ended' } })
    expect((await adapter(withdrawn, { adapter: 'bank_file_csv' })).json().error.code).toBe('PROVIDER_NOT_RECORDED')

    const id = await recorded()
    const noStepUp = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Tenant admin'] })
    expect((await adapter(id, { adapter: 'bank_file_csv' }, noStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await adapter(id, { adapter: 'bank_file_csv' }, w.finance)).statusCode).toBe(403)
    expect((await adapter(id, { adapter: 'bank_file_csv' }, other.admin)).statusCode).toBe(404)
  })

  test('an open batch blocks changing the adapter (409 BATCH_OPEN)', async () => {
    await setSettings(w, {
      'payouts.market_policy': { [w.market]: { minimum_payout_minor: '100', tax_profile_required: false } },
      'payouts.bank_detail_cooling_off_hours': 0,
    })
    const id = await provider(app, w, 'bank_file_csv')
    await call(app, { method: 'POST', url: '/v1/payout-batches', as: w.officer, idempotencyKey: true, body: { market_id: w.market, provider_config_id: id } })
    expect((await adapter(id, { adapter: 'sandbox', webhook_secret: WEBHOOK_SECRET })).json().error.code).toBe('BATCH_OPEN')
  })
})

describe('review dates and reminders (AC-PAY6-1, T-B4-22)', () => {
  test('review_due_on is saved on create and by PATCH; a withdrawn provider is 409; another tenant 404', async () => {
    const id = await recorded('payout', inDays(40))
    const patch = (body: unknown, as = w.admin, target = id) => call(app, { method: 'PATCH', url: `/v1/provider-configs/${target}`, as, body })
    expect((await patch({ review_due_on: inDays(10) })).json().data.review_due_on).toBe(inDays(10))
    expect((await patch({ review_due_on: inDays(10) }, other.admin)).statusCode).toBe(404)
    expect((await patch({ review_due_on: inDays(10) }, w.officer)).statusCode).toBe(403)
    const withdrawn = await recorded()
    await call(app, { method: 'POST', url: `/v1/provider-configs/${withdrawn}/withdraw`, as: w.admin, body: { reason: 'ended' } })
    expect((await patch({ review_due_on: null }, w.admin, withdrawn)).json().error.code).toBe('PROVIDER_NOT_RECORDED')
  })

  test('the daily job mails each market manager once per provider and due date (only when the setting is set)', async () => {
    const run = () => reviewReminderCron.run({ jobId: 'reminder-test', log: app.log, config: testConfig() })
    await run()
    expect(await mailsTo(w.admin.email)).toHaveLength(0)
    await setSettings(w, { 'payouts.provider_review_reminder_days': 30 })
    await run()
    await run()
    const mails = await mailsTo(w.admin.email)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toContain(`Provider review due ${inDays(10)}`)
    expect((await auditActions(w.tenant.id)).filter((a) => a === 'PROVIDER.REVIEW_REMINDED')).toHaveLength(1)
  })
})
