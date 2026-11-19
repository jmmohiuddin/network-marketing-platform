import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, mailsTo, ownerRows,
  resetApiDb, testConfig, type TestUser,
} from '../../../test/helpers/index.js'
import { deliverCron } from './deliver.js'
import { distModule } from './index.js'

// T-B5-25 delivery, T-B5-26 inbox and preferences (AC-DIST8-2..4).

let app: FastifyInstance
let tenant: string
let market: string
let mine: string
let theirs: string
let me: TestUser
let them: TestUser
let outsider: TestUser
const MY_EMAIL = `dist-${Date.now()}@example.test`

closePoolsAfterAll()

async function participant(tenantId: string, marketId: string, email: string | null): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, 'Dist Payee', $4, '2025-01-01', '00000000-0000-0000-0000-000000000000', 'system') RETURNING id`,
    [tenantId, `DIST-${randomUUID().slice(0, 8)}`, marketId, email === null ? null : { email }],
  )
  return row!.id
}

/** notify_participant as a business transaction of the tenant calls it (system actor). */
async function notify(tenantId: string, participantId: string, template: string, params: Record<string, unknown>): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `WITH ctx AS MATERIALIZED (SELECT set_config('app.realm', 'tenant', true), set_config('app.tenant_id', $1::text, true),
                                      set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.actor_type', 'system', true))
     SELECT notify_participant($2, $3, $4::jsonb) AS id FROM ctx`,
    [tenantId, participantId, template, JSON.stringify(params)],
  )
  return row!.id
}

const STATEMENT = {
  run_id: randomUUID(), period_id: randomUUID(), starts_at: '2026-08-31T23:00:00.000Z', ends_at: '2026-09-30T23:00:00.000Z', // September in Europe/London
  net_minor: '1234', currency: 'GBP', minor_unit: 2,
}
const BANK = { version_id: randomUUID(), masked: '•••• 3000', previous_masked: null, cooling_off_until: '2026-11-22T09:00:00.000Z' }

/** The `after` of every audit event of `action` on object `id`. */
const audited = async (action: string, id: string) => (await ownerRows<{ after: unknown }>(
  `SELECT after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE action = $1 AND object_id = $2 ORDER BY seq`, [action, id])).map((row) => row.after)

const runDelivery = (mailDir = testConfig().mailDir) =>
  deliverCron.run({ jobId: randomUUID(), log: fastify({ logger: false }).log, config: { ...testConfig(), mailDir } })

const emailRow = (inApp: string) => ownerRows<{ id: string; state: string; attempts: number; next_attempt_at: Date | null; last_error: string | null }>(
  `SELECT e.id, e.state, e.attempts, e.next_attempt_at, e.last_error FROM notification e JOIN notification a ON a.id = $1
   WHERE e.channel = 'email' AND e.recipient_participant_id = a.recipient_participant_id AND e.template = a.template AND e.created_at = a.created_at`,
  [inApp])

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [distModule] })
  tenant = (await createTenant()).id
  market = await createMarket(tenant)
  mine = await participant(tenant, market, MY_EMAIL)
  theirs = await participant(tenant, market, `their-${Date.now()}@example.test`)
  me = await createPortalUser({ tenantId: tenant, participantId: mine })
  them = await createPortalUser({ tenantId: tenant, participantId: theirs })
  const other = (await createTenant()).id
  outsider = await createPortalUser({ tenantId: other, participantId: await participant(other, await createMarket(other), null) })
})

afterAll(async () => {
  await app.close()
})

describe('inbox (T-B5-26, AC-DIST8-4)', () => {
  let first: string
  let second: string
  let foreign: string

  beforeAll(async () => {
    first = await notify(tenant, mine, 'statement.ready', STATEMENT)
    second = await notify(tenant, mine, 'bank_detail.changed', BANK)
    foreign = await notify(tenant, theirs, 'statement.ready', STATEMENT)
  })

  test('lists only the session participant in-app rows, newest first, with the unread count and a cursor', async () => {
    const page1 = await call(app, { method: 'GET', url: '/v1/me/notifications?limit=1', as: me })
    expect(page1.statusCode).toBe(200)
    expect(page1.json().data).toEqual([expect.objectContaining({ id: second, template: 'bank_detail.changed', topic: 'security', mandatory: true, read_at: null })])
    expect(page1.json().meta).toMatchObject({ unread_count: 2, next_cursor: expect.any(String) })
    const page2 = await call(app, { method: 'GET', url: `/v1/me/notifications?limit=1&cursor=${page1.json().meta.next_cursor}`, as: me })
    expect(page2.json().data.map((n: { id: string }) => n.id)).toEqual([first])
    expect(page2.json().meta.next_cursor).toBeNull()
    expect(page1.body).not.toContain(foreign)
  })

  test('another participant or tenant cannot read or mark a row: 404 as an unknown id', async () => {
    expect((await call(app, { method: 'POST', url: `/v1/me/notifications/${first}/read`, as: them })).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: `/v1/me/notifications/${first}/read`, as: outsider })).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: `/v1/me/notifications/${randomUUID()}/read`, as: me })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/me/notifications', as: outsider })).json().data).toEqual([])
    expect((await ownerRows('SELECT 1 FROM notification WHERE id = $1 AND read_at IS NOT NULL', [first]))).toHaveLength(0)
  })

  test('a portal transaction cannot read another participant notifications even by id', async () => {
    const seen = await withTenant({ tenantId: tenant, userId: them.id, participantId: theirs }, (tx) =>
      tx.query('SELECT id FROM notification WHERE id = ANY ($1)', [[first, second, foreign]]))
    expect(seen.rows.map((row) => row.id)).toEqual([foreign])
  })

  test('mark read sets read_at once; read-all marks the rest', async () => {
    const read = await call(app, { method: 'POST', url: `/v1/me/notifications/${first}/read`, as: me })
    expect(read.statusCode).toBe(200)
    const readAt = read.json().data.read_at
    expect(readAt).toEqual(expect.any(String))
    expect((await call(app, { method: 'POST', url: `/v1/me/notifications/${first}/read`, as: me })).json().data.read_at).toBe(readAt)
    expect((await call(app, { method: 'GET', url: '/v1/me/notifications?unread=true', as: me })).json().data.map((n: { id: string }) => n.id)).toEqual([second])
    expect((await call(app, { method: 'POST', url: '/v1/me/notifications/read-all', as: me })).json().data).toEqual({ updated: 1 })
    expect((await call(app, { method: 'GET', url: '/v1/me/notifications', as: me })).json().meta.unread_count).toBe(0)
    expect((await ownerRows('SELECT 1 FROM notification WHERE id = $1 AND read_at IS NULL', [foreign]))).toHaveLength(1)
    // Each read mark is audited once (the repeated read changes nothing); read-all with its count.
    expect(await audited('NOTIFICATION.READ', first)).toEqual([null])
    expect(await audited('NOTIFICATION.READ_ALL', mine)).toEqual([{ updated: 1 }])
  })

  test('staff sessions and signed-out callers are refused', async () => {
    const staff = await createSignedInUser({ tenantId: tenant, roles: ['Tenant admin'] })
    for (const url of ['/v1/me/notifications', '/v1/me/notification-preferences']) {
      expect((await call(app, { method: 'GET', url, as: staff })).json().error.code).toBe('REALM_FORBIDDEN')
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    }
  })
})

describe('preferences (T-B5-26, AC-DIST8-2)', () => {
  test('statement, payout and dispute default to email on; mandatory topics are listed locked', async () => {
    const response = await call(app, { method: 'GET', url: '/v1/me/notification-preferences', as: them })
    expect(response.json().data).toEqual([
      { topic: 'statement', email: true, mandatory: false }, { topic: 'payout', email: true, mandatory: false },
      { topic: 'dispute', email: true, mandatory: false }, { topic: 'security', mandatory: true }, { topic: 'privacy', mandatory: true },
      { topic: 'plan_change', mandatory: true },
    ])
  })

  test('switching off stops optional emails only; a mandatory topic cannot be switched', async () => {
    for (const topic of ['statement', 'payout', 'dispute']) {
      const put = await call(app, { method: 'PUT', url: '/v1/me/notification-preferences', as: them, body: { topic, email: false } })
      expect(put.statusCode).toBe(200)
    }
    const refused = await call(app, { method: 'PUT', url: '/v1/me/notification-preferences', as: them, body: { topic: 'security', email: false } })
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('VALIDATION_FAILED')
    expect((await call(app, { method: 'GET', url: '/v1/me/notification-preferences', as: them })).json().data[0]).toEqual({ topic: 'statement', email: false, mandatory: false })
    expect((await call(app, { method: 'GET', url: '/v1/me/notification-preferences', as: me })).json().data[0].email).toBe(true)
    expect(await auditActions(tenant)).toContain('NOTIFICATION_PREFERENCE.CHANGED')

    const statement = await notify(tenant, theirs, 'statement.ready', STATEMENT)
    const bank = await notify(tenant, theirs, 'bank_detail.changed', BANK)
    expect(await emailRow(statement)).toEqual([])
    expect(await emailRow(bank)).toHaveLength(1)
  })
})

describe('delivery (T-B5-25, AC-DIST8-3)', () => {
  test('writes the mail to MAIL_DIR from the params and the contact read at send time, then marks it sent', async () => {
    const inApp = await notify(tenant, mine, 'statement.ready', STATEMENT)
    await runDelivery()
    expect(await emailRow(inApp)).toEqual([expect.objectContaining({ state: 'sent', attempts: 1 })])
    const mail = (await mailsTo(MY_EMAIL)).find((m) => m.includes('Your commission statement is ready'))!
    expect(mail).toContain('Net amount: 12.34 GBP.')
    expect(mail).toContain('Sep 1, 2026 to Sep 30, 2026')
    expect(mail).toContain(`${testConfig().webUrl}/portal`)
    expect(await audited('NOTIFICATION.SENT', (await emailRow(inApp))[0]!.id)).toEqual([{ template: 'statement.ready' }])
  })

  test('no contact email at send time: undeliverable; the in-app row stays', async () => {
    const lost = await participant(tenant, market, `gone-${Date.now()}@example.test`)
    const inApp = await notify(tenant, lost, 'bank_detail.changed', BANK)
    await ownerRows('UPDATE participant SET contact = NULL WHERE id = $1', [lost])
    await runDelivery()
    expect(await emailRow(inApp)).toEqual([expect.objectContaining({ state: 'undeliverable' })])
    expect(await audited('NOTIFICATION.UNDELIVERABLE', (await emailRow(inApp))[0]!.id)).toHaveLength(1)
    expect(await ownerRows(`SELECT 1 FROM notification WHERE id = $1 AND state = 'delivered'`, [inApp])).toHaveLength(1)
  })

  test('a failing write retries with backoff and ends failed after 5 attempts', async () => {
    const inApp = await notify(tenant, mine, 'bank_detail.changed', BANK)
    const [email] = await emailRow(inApp)
    const before = Date.now()
    await runDelivery('/dev/null/mail')
    const [retry] = await emailRow(inApp)
    expect(retry).toMatchObject({ state: 'queued', attempts: 1, last_error: expect.any(String) })
    expect(retry!.next_attempt_at!.getTime()).toBeGreaterThanOrEqual(before + 60_000 - 1000)
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await ownerRows(`UPDATE notification SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [email!.id])
      await runDelivery('/dev/null/mail')
    }
    expect(await emailRow(inApp)).toEqual([expect.objectContaining({ state: 'failed', attempts: 5, next_attempt_at: null })])
    expect(await audited('NOTIFICATION.RETRY_SCHEDULED', email!.id)).toHaveLength(4)
    expect(await audited('NOTIFICATION.FAILED', email!.id)).toHaveLength(1)
    expect(await ownerRows(`SELECT 1 FROM notification WHERE id = $1 AND state = 'delivered'`, [inApp])).toHaveLength(1)
  })
})
