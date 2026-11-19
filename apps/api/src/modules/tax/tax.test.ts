import { randomUUID } from 'node:crypto'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { taxModule } from './index.js'

let app: FastifyInstance
let tenantId: string
let payee: string
let finance: TestUser
let officer: TestUser
let analyst: TestUser
let otherFinance: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  const market = await createMarket(tenantId, 'GB')
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, '2025-01-01', '00000000-0000-0000-0000-000000000000', 'system') RETURNING id`,
    [tenantId, `TAX-${randomUUID().slice(0, 8)}`, market],
  )
  payee = row!.id
  finance = await createSignedInUser({ tenantId, roles: ['Finance approver'], stepUp: true })
  officer = await createSignedInUser({ tenantId, roles: ['Payout officer'], stepUp: true })
  analyst = await createSignedInUser({ tenantId, roles: ['Commission analyst'], stepUp: true })
  otherFinance = await createSignedInUser({ tenantId: (await createTenant()).id, roles: ['Finance approver'], stepUp: true })
  app = await buildTestApp({ modules: [taxModule] })
})

afterAll(async () => {
  await app.close()
})

/** Resolves once a session waits on a lock while running a statement that matches the pattern. */
async function lockWaitOn(pattern: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await ownerRows(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`, [pattern])).length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`no session waited on a lock running ${pattern}`)
}

const put = (as: TestUser, body: unknown) => call(app, { method: 'PUT', url: `/v1/participants/${payee}/tax-profile`, as, body, idempotencyKey: true })
const read = (as: TestUser) => call(app, { method: 'GET', url: `/v1/participants/${payee}/tax-profile`, as })
const unmask = (as: TestUser) => call(app, { method: 'POST', url: `/v1/participants/${payee}/tax-profile/unmask`, as })

describe('tax profile (AC-48.1, AC-TAX1-1, T-B4-25, T-B4-26)', () => {
  test('format, empty body and step-up are enforced; no profile means unmask 404', async () => {
    expect((await put(finance, { tax_id: 'DE!1' })).json().error.code).toBe('TAX_ID_FORMAT')
    expect((await put(finance, {})).json().error.code).toBe('VALIDATION_FAILED')
    const noStepUp = await createSignedInUser({ tenantId, roles: ['Finance approver'] })
    expect((await put(noStepUp, { residency: 'DE' })).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await unmask(officer)).statusCode).toBe(404)
  })

  test('versions: masked reads, the previous closed at the same instant, fields carried over', async () => {
    const first = await put(finance, { residency: 'DE', entity_type: 'individual', tax_id: 'de 1234 56789' })
    expect(first.statusCode).toBe(200)
    expect(first.json().data).toMatchObject({ residency: 'DE', entity_type: 'individual', tax_id_masked: '•••• 6789', valid_to: null })
    expect(first.body).not.toContain('DE123456789')
    const second = await put(finance, { entity_type: 'company' })
    expect(second.json().data).toMatchObject({ residency: 'DE', entity_type: 'company', tax_id_masked: '•••• 6789' })

    const profile = (await read(analyst)).json().data
    expect(profile.current).toMatchObject({ id: second.json().data.id, tax_id_masked: '•••• 6789' })
    expect(profile.history).toHaveLength(1)
    expect(profile.history[0].valid_to).toBe(profile.current.valid_from)
    expect(JSON.stringify(profile)).not.toContain('sealed')
    const stored = await ownerRows<{ tax_id_sealed: string }>('SELECT tax_id_sealed FROM tax_profile WHERE participant_id = $1', [payee])
    expect(stored.every((row) => !row.tax_id_sealed.includes('123456789'))).toBe(true)
    // D-B5-14: a staff change is a security notice to the payee too, masked only.
    const notices = await ownerRows<{ params: Record<string, unknown> }>(
      `SELECT params FROM notification WHERE recipient_participant_id = $1 AND template = 'tax_profile.changed' AND channel = 'in_app'`, [payee])
    expect(notices).toHaveLength(2)
    expect(JSON.stringify(notices)).not.toContain('123456789')
  })

  test('unmask needs participant.unmask and step-up, answers no-store and audits without the value', async () => {
    expect((await unmask(analyst)).statusCode).toBe(403)
    const noStepUp = await createSignedInUser({ tenantId, roles: ['Payout officer'] })
    expect((await unmask(noStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    const shown = await unmask(officer)
    expect(shown.json().data).toEqual({ tax_id: 'DE123456789' })
    expect(shown.headers['cache-control']).toBe('no-store')
    const audit = await ownerRows<{ after_ref: string }>(`SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'TAX_ID.UNMASKED'`, [tenantId])
    expect(audit).toHaveLength(1)
    expect(audit[0]!.after_ref).not.toContain('123456789')
    const all = await ownerRows<{ after_ref: string | null }>('SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1', [tenantId])
    expect(all.some((row) => (row.after_ref ?? '').includes('123456789'))).toBe(false)
  })

  test('a PUT that waited on the lock while another version was written closes that version, never before it began', async () => {
    const holder = await getOwnerPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('tax_profile:' || $1::text || ':' || $2::text, 0))`, [tenantId, payee])
      const waiting = put(finance, { residency: 'FR' })
      await lockWaitOn('%tax_profile:%')
      // The concurrent writer: its version starts after the waiting PUT's transaction began.
      await holder.query('UPDATE tax_profile SET valid_to = clock_timestamp() WHERE participant_id = $1 AND valid_to IS NULL', [payee])
      await holder.query(
        `INSERT INTO tax_profile (tenant_id, participant_id, residency, valid_from, created_by) VALUES ($1, $2, 'NL', clock_timestamp(), $3)`,
        [tenantId, payee, finance.id],
      )
      await holder.query('COMMIT')

      const response = await waiting

      expect(response.statusCode).toBe(200)
      expect(response.json().data.residency).toBe('FR')
      const open = await ownerRows('SELECT 1 FROM tax_profile WHERE participant_id = $1 AND valid_to IS NULL', [payee])
      expect(open).toHaveLength(1)
    } finally {
      holder.release()
    }
  })

  test('another tenant gets 404; tax.manage is required to write', async () => {
    expect((await read(otherFinance)).statusCode).toBe(404)
    expect((await put(otherFinance, { residency: 'FR' })).statusCode).toBe(404)
    expect((await unmask(otherFinance)).statusCode).toBe(404)
    expect((await put(officer, { residency: 'FR' })).statusCode).toBe(403)
  })
})
