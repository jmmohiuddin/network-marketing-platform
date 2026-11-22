import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { ordModule } from '../ord/index.js'
import { ledModule } from './index.js'
import { ledWorld, type LedWorld } from './test-support.js'

// FX rate batches (T-V1A-20, AC-FIN7-1, PLAN V1-A 2.2). The release of held orders is pinned in ord/v1a.test.ts.

let app: FastifyInstance
let w: LedWorld
let other: LedWorld

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  w = await ledWorld()
  other = await ledWorld()
  app = await buildTestApp({ modules: [iamModule, ordModule, ledModule] })
}, 120_000)

afterAll(async () => {
  await app.close()
})

const row = (overrides: Record<string, unknown> = {}) => ({ base: 'CHF', quote: 'GBP', rate: '0.8800000000', valid_from: '2026-11-01T00:00:00Z', ...overrides })
const propose = (as: TestUser, rows: unknown[], source = 'Treasury sheet') =>
  call(app, { method: 'POST', url: '/v1/fx-rate-batches', as, body: { source, rows }, idempotencyKey: true })
const decide = (as: TestUser, id: string, decision: 'approve' | 'reject' = 'approve') =>
  call(app, { method: 'POST', url: `/v1/fx-rate-batches/${id}/decision`, as, body: { decision }, idempotencyKey: true })

describe('FX rate batches', () => {
  test('T-V1A-20: proposed by one user, approved by another with step-up; the proposer approving is SOD_SELF_APPROVAL', async () => {
    const proposed = await propose(w.finance, [row(), row({ base: 'USD', rate: '0.7900000000' })])
    expect(proposed.statusCode, proposed.body).toBe(201)
    const batch = proposed.json().data
    expect(batch).toMatchObject({ state: 'proposed', proposed_by: { id: w.finance.id }, approver: null, decided_at: null })
    expect(batch.rows[0]).toEqual({ base: 'CHF', quote: 'GBP', rate: '0.8800000000', valid_from: '2026-11-01T00:00:00.000Z' })

    const self = await decide(w.finance, batch.id)
    expect([self.statusCode, self.json().error.code]).toEqual([422, 'SOD_SELF_APPROVAL'])
    expect(await ownerRows('SELECT 1 FROM fx_rate WHERE batch_id = $1', [batch.id])).toEqual([])

    const approved = await decide(w.finance2, batch.id)
    expect(approved.statusCode, approved.body).toBe(200)
    expect(approved.json().data).toMatchObject({ state: 'approved', approver: { id: w.finance2.id }, released_orders: 0 })
    const rates = await call(app, { method: 'GET', url: '/v1/fx-rates?base=CHF&quote=GBP', as: w.analyst })
    expect(rates.json().data).toEqual([expect.objectContaining({ base: 'CHF', quote: 'GBP', rate: '0.8800000000', source: 'Treasury sheet', batch_id: batch.id, in_force: true })])
    const before = await call(app, { method: 'GET', url: '/v1/fx-rates?base=CHF&at=2026-10-01T00:00:00Z', as: w.analyst })
    expect(before.json().data[0].in_force).toBe(false)
    expect((await decide(w.finance2, batch.id)).json().error.code).toBe('BATCH_DECIDED')
    expect(await auditActions(w.tenant.id)).toEqual(expect.arrayContaining(['FX_RATES.PROPOSED', 'APPROVAL.REFUSED', 'FX_RATES.APPROVED']))

    // A rate never changes: the same pair and start again is 409 RATE_EXISTS, at proposal and at approval.
    const again = await propose(w.analyst, [row({ base: 'EUR' }), row()])
    expect([again.statusCode, again.json().error.code, again.json().error.details]).toEqual([409, 'RATE_EXISTS', { row: 1 }])
    const first = await propose(w.analyst, [row({ base: 'JPY', rate: '0.0052000000' })])
    const second = await propose(w.analyst, [row({ base: 'JPY', rate: '0.0053000000' })])
    expect((await decide(w.finance, first.json().data.id)).statusCode).toBe(200)
    expect((await decide(w.finance, second.json().data.id)).json().error.code).toBe('RATE_EXISTS')
  })

  test('a rejected batch creates no rate', async () => {
    const proposed = await propose(w.analyst, [row({ base: 'SEK', rate: '0.0730000000' })])
    const rejected = await decide(w.finance, proposed.json().data.id, 'reject')
    expect(rejected.json().data).toMatchObject({ state: 'rejected', approver: { id: w.finance.id } })
    expect(await ownerRows("SELECT 1 FROM fx_rate WHERE tenant_id = $1 AND base = 'SEK'", [w.tenant.id])).toEqual([])
    const listed = await call(app, { method: 'GET', url: '/v1/fx-rate-batches?state=rejected', as: w.analyst })
    expect(listed.json().data.map((b: { id: string }) => b.id)).toEqual([proposed.json().data.id])
  })

  test('validation: row and field of the first invalid row, ISO 4217 currencies, each pair and start once, 1..500 rows', async () => {
    const invalid = async (rows: unknown[]) => (await propose(w.analyst, rows)).json().error
    expect(await invalid([row(), row({ rate: '0.88' })])).toMatchObject({ code: 'VALIDATION_FAILED', details: { row: 1, field: 'rate' } })
    expect(await invalid([row({ rate: '0.0000000000' })])).toMatchObject({ details: { row: 0, field: 'rate' } })
    expect(await invalid([row({ quote: 'CHF' })])).toMatchObject({ details: { row: 0, field: 'quote' } })
    expect(await invalid([row({ valid_from: '2026-11-01' })])).toMatchObject({ details: { row: 0, field: 'valid_from' } })
    expect(await invalid([row({ extra: 1 })])).toMatchObject({ code: 'VALIDATION_FAILED', details: { row: 0 } })
    expect(await invalid([row({ base: 'XTS' })])).toMatchObject({ code: 'CURRENCY_UNKNOWN', details: { row: 0 } })
    expect(await invalid([row({ base: 'NOK' }), row({ base: 'NOK', valid_from: '2026-11-01T00:00:00.000Z' })])).toMatchObject({ details: { row: 1, field: 'valid_from' } })
    expect((await propose(w.analyst, [])).statusCode).toBe(400)
    expect((await propose(w.analyst, Array.from({ length: 501 }, (_, n) => row({ valid_from: new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString() })))).statusCode).toBe(400)
    expect((await propose(w.analyst, [row()], ' ')).statusCode).toBe(400)
  })

  test('permissions: fx.manage / fx.approve for all markets, step-up to decide; another tenant sees and decides nothing', async () => {
    const proposed = await propose(w.analyst, [row({ base: 'DKK', rate: '0.1180000000' })])
    const id = proposed.json().data.id as string
    const scoped = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Finance approver'], marketIds: [w.market], stepUp: true })
    const stale = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Finance approver'] })
    const planner = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Plan administrator'], stepUp: true })
    expect((await decide(w.analyst, id)).statusCode).toBe(403)
    expect((await decide(scoped, id)).json().error.code).toBe('SCOPE_NOT_HELD')
    expect((await decide(stale, id)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await propose(w.support, [row()])).statusCode).toBe(403)
    expect((await propose(scoped, [row()])).json().error.code).toBe('SCOPE_NOT_HELD')
    expect((await call(app, { method: 'POST', url: '/v1/fx-rate-batches', as: w.analyst, body: { source: 's', rows: [row()] } })).json().error.code)
      .toBe('IDEMPOTENCY_KEY_REQUIRED')
    for (const url of ['/v1/fx-rates', '/v1/fx-rate-batches']) expect((await call(app, { method: 'GET', url, as: planner })).statusCode).toBe(403)
    expect((await decide(other.finance, id)).statusCode).toBe(404)
    expect((await decide(w.finance, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/fx-rate-batches', as: other.analyst })).json().data).toEqual([])
    expect((await call(app, { method: 'GET', url: '/v1/fx-rates', as: other.analyst })).json().data).toEqual([])
  })
})

// AC-FIN7-1: no rate is ever fetched from outside. Nothing under led/** or ord/** opens a connection or names a rate service.
const FORBIDDEN = [
  /from\s+['"](node:)?(http|https|net|tls|dgram|http2)['"]/, /import\(\s*['"](node:)?(http|https|net|tls|dgram|http2)['"]/,
  /require\(\s*['"](node:)?(http|https|net|tls|dgram|http2)['"]/, /['"](undici|axios|got|node-fetch)['"]/, /\bfetch\s*\(/, /https?:\/\//,
]
const networkUses = (source: string): string[] => FORBIDDEN.filter((pattern) => pattern.test(source)).map(String)

describe('no external rate service (static no-network test)', () => {
  test('no source file of led or ord imports a network module, calls fetch or names a URL', () => {
    const offenders = ['led', 'ord'].flatMap((module) => {
      const dir = join(import.meta.dirname, '..', module)
      return readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .flatMap((name) => networkUses(readFileSync(join(dir, name), 'utf8')).map((use) => `${module}/${name}: ${use}`))
    })
    expect(offenders).toEqual([])
  })

  test('the checker catches each form', () => {
    for (const source of ["import { get } from 'node:https'", "await import('net')", "import axios from 'axios'", 'await fetch(url)', "const URL = 'https://rates.example'"]) {
      expect(networkUses(source)).not.toEqual([])
    }
    expect(networkUses("import { createHash } from 'node:crypto'")).toEqual([])
  })
})
