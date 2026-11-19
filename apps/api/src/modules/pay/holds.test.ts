import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, ownerRows, resetApiDb, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { intModule } from '../int/index.js'
import { batchDispatchJob, sandboxAdapter } from './dispatch.js'
import { payModule } from './index.js'
import {
  approvedBatch, bankVersion, credit, creditAt, participant, payWorld, post, provider, setSettings, webhook, type PayWorld,
} from './test-support.js'

let app: FastifyInstance
let w: PayWorld
let other: PayWorld

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  w = await payWorld()
  other = await payWorld()
  await setSettings(w, {
    'payouts.market_policy': { [w.market]: { minimum_payout_minor: '100', tax_profile_required: true } },
    'payouts.bank_detail_cooling_off_hours': 0,
    'payouts.dormant_after_days': 90,
  })
  app = await buildTestApp({ modules: [payModule, intModule] })
}, 120_000)

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })

describe('holds (AC-PAY7-1, T-B4-23) and the tax-profile exclusion (AC-TAX1-2)', () => {
  test('a hold needs a reason, excludes the payee with it, is released once, then the payee is included', async () => {
    const payee = await participant(w.tenant.id, w.market)
    await credit(w, payee, '2000')
    await bankVersion(w.tenant.id, payee)
    const sandbox = await provider(app, w, 'sandbox')
    expect((await post(app, w.compliance, `/v1/payees/${payee}/holds`, { market_id: w.market })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await post(app, w.finance, `/v1/payees/${payee}/holds`, { market_id: w.market, reason: 'x' })).statusCode).toBe(403)
    const placed = await post(app, w.compliance, `/v1/payees/${payee}/holds`, { market_id: w.market, reason: 'Fraud review' })
    expect(placed.statusCode).toBe(201)
    const holdId = placed.json().data.id as string

    const held = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })
    expect(held.json().data.exclusions).toEqual([{
      participant: expect.objectContaining({ id: payee }),
      reasons: [{ reason: 'tax_profile_missing', detail: {} }, { reason: 'hold', detail: { hold_id: holdId, reason: 'Fraud review', placed_at: placed.json().data.placed_at } }],
    }])
    await post(app, w.officer, `/v1/payout-batches/${held.json().data.id}/cancel`, { reason: 'held' })

    expect((await post(app, other.compliance, `/v1/payout-holds/${holdId}/release`, { reason: 'x' })).statusCode).toBe(404)
    expect((await post(app, w.compliance, `/v1/payout-holds/${holdId}/release`, {})).json().error.code).toBe('VALIDATION_FAILED')
    // The Payout officer holds payout.hold but prepares the batches the hold keeps the payee out of: never the releaser.
    const own = await post(app, w.officer, `/v1/payout-holds/${holdId}/release`, { reason: 'Lifting it myself' })
    expect([own.statusCode, own.json().error.code]).toEqual([403, 'RELEASER_NOT_INDEPENDENT'])
    const released = await post(app, w.compliance, `/v1/payout-holds/${holdId}/release`, { reason: 'Cleared' })
    expect(released.json().data).toMatchObject({ release_reason: 'Cleared', released_by: { id: w.compliance.id } })
    expect((await post(app, w.compliance, `/v1/payout-holds/${holdId}/release`, { reason: 'again' })).json().error.code).toBe('HOLD_RELEASED')
    expect((await get(w.officer, `/v1/payees/${payee}/holds?active=true`)).json().data).toEqual([])
    expect((await get(w.officer, `/v1/payees/${payee}/holds`)).json().data).toHaveLength(1)
    expect(await auditActions(w.tenant.id)).toEqual(expect.arrayContaining(['PAYOUT.HOLD_PLACED', 'PAYOUT.HOLD_RELEASED']))

    await ownerTaxProfile(payee)
    const included = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })
    expect(included.json().data).toMatchObject({ line_count: 1, total_minor: '2000', exclusions: [] })
    await post(app, w.officer, `/v1/payout-batches/${included.json().data.id}/cancel`, { reason: 'test done' })
  })

  test('another tenant and callers without the permissions are refused', async () => {
    const payee = await participant(w.tenant.id, w.market)
    expect((await get(other.officer, `/v1/payees/${payee}/holds`)).statusCode).toBe(404)
    expect((await post(app, other.compliance, `/v1/payees/${payee}/holds`, { market_id: other.market, reason: 'x' })).statusCode).toBe(404)
    const integration = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Integration'] })
    expect((await get(integration, `/v1/payees/${payee}/holds`)).statusCode).toBe(403)
    expect((await post(app, integration, `/v1/payout-holds/${payee}/release`, { reason: 'x' })).statusCode).toBe(403)
  })

  test('a market-scoped reader gets 404 for a participant of another market with no hold in scope (D-B4-23)', async () => {
    const ie = await createMarket(w.tenant.id, 'IE')
    const iePayee = await participant(w.tenant.id, ie)
    const gbOnly = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Payout officer'], marketIds: [w.market] })
    expect((await get(gbOnly, `/v1/payees/${iePayee}/holds`)).statusCode).toBe(404)
    expect((await get(w.officer, `/v1/payees/${iePayee}/holds`)).json().data).toEqual([])
    // A GB hold of the IE participant is the scoped reader's to see.
    await post(app, w.compliance, `/v1/payees/${iePayee}/holds`, { market_id: w.market, reason: 'GB review' })
    expect((await get(gbOnly, `/v1/payees/${iePayee}/holds`)).json().data).toEqual([expect.objectContaining({ reason: 'GB review' })])
  })
})

async function ownerTaxProfile(payee: string): Promise<void> {
  await ownerRows(
    `INSERT INTO tax_profile (tenant_id, participant_id, residency, valid_from, created_by) VALUES ($1, $2, 'GB', now() - interval '1 day', $3)`,
    [w.tenant.id, payee, w.admin.id],
  )
}

describe('dormant payables (AC-PAY7-2, T-B4-24)', () => {
  test('lists payables older than the setting with no settled instruction since; unset is 422', async () => {
    const old = await participant(w.tenant.id, w.market)
    const recent = await participant(w.tenant.id, w.market)
    await creditAt(w, old, '5000', new Date(Date.now() - 100 * 86_400_000))
    await credit(w, recent, '5000')

    const listed = await get(w.finance, '/v1/payouts/dormant')
    expect(listed.statusCode).toBe(200)
    const rows = listed.json().data as { participant: { id: string }; payable_minor: string; last_settled_at: string | null }[]
    expect(rows.map((row) => row.participant.id)).toEqual([old])
    expect(rows[0]).toMatchObject({ payable_minor: '5000', last_settled_at: null })

    expect((await get(other.finance, '/v1/payouts/dormant')).json().error.code).toBe('SETTING_NOT_CONFIGURED')
    const integration = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Integration'] })
    expect((await get(integration, '/v1/payouts/dormant')).statusCode).toBe(403)
  })

  test('a payable that arose before the last settled payout stays listed, dated from its streak (not hidden by the settlement)', async () => {
    const payee = await participant(w.tenant.id, w.market)
    await creditAt(w, payee, '5000', new Date(Date.now() - 200 * 86_400_000))
    await bankVersion(w.tenant.id, payee)
    await ownerTaxProfile(payee)
    const sandbox = await provider(app, w, 'sandbox')
    const batchId = await approvedBatch(app, w, sandbox)
    await creditAt(w, payee, '300', new Date(Date.now() - 100 * 86_400_000))
    await runQueuedJobs(batchDispatchJob({ adapter: sandboxAdapter }) as never)
    const [paid] = await ownerRows<{ provider_ref: string }>(
      'SELECT provider_ref FROM payout_instruction WHERE batch_id = $1 AND payee_participant_id = $2', [batchId, payee])
    const settled = await webhook(app, sandbox, { type: 'payout.settled', provider_ref: paid!.provider_ref, amount_minor: '5000', currency: 'GBP' })
    expect(settled.statusCode).toBe(200)

    const rows = (await get(w.finance, '/v1/payouts/dormant')).json().data as { participant: { id: string }; payable_since: string }[]
    const row = rows.find((candidate) => candidate.participant.id === payee)
    expect(row).toMatchObject({ payable_minor: '300', last_settled_at: expect.any(String) })
    expect(new Date(row!.payable_since).getTime()).toBeLessThan(Date.now() - 90 * 86_400_000)
  })
})
