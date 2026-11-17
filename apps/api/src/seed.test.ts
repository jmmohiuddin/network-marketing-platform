import { beforeAll, describe, expect, test } from 'vitest'
import { closePoolsAfterAll, ownerRows, resetApiDb, testConfig } from '../test/helpers/index.js'
import { assertSeedable, E2E_FIXTURE_PACK, seed, seedFixtureMarket, seedFixturePack } from './seed.js'

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
})

describe('seed', () => {
  test('creates two independent vendor operators and two tenants with staff, and is idempotent', async () => {
    const first: string[] = []
    const second: string[] = []

    await seed(testConfig({ NODE_ENV: 'development' }), undefined, (line) => first.push(line))
    await seed(testConfig({ NODE_ENV: 'development' }), undefined, (line) => second.push(line))
    const users = await ownerRows<{ email: string; realm: string; mfa_enrolled: boolean }>(
      'SELECT email, realm, mfa_enrolled FROM user_account ORDER BY email',
    )
    const grants = await ownerRows<{ name: string; approved: boolean }>(
      `SELECT r.name, ra.approval_id IS NOT NULL AS approved FROM role_assignment ra JOIN role r ON r.id = ra.role_id
       JOIN tenant t ON t.id = ra.tenant_id WHERE t.slug = 'acme' ORDER BY r.name`,
    )

    const credentials = await ownerRows<{ passwords: number; factors: number }>(
      'SELECT (SELECT count(*)::int FROM password_credential) AS passwords, (SELECT count(*)::int FROM mfa_credential) AS factors',
    )

    const vendors = await ownerRows(`SELECT email, created_by FROM user_account WHERE realm = 'vendor' ORDER BY email`)

    const markets = await ownerRows('SELECT code, state FROM market ORDER BY code')

    expect(users).toHaveLength(16)
    expect(credentials).toEqual([{ passwords: 16, factors: 2 }]) // written as their own users; only vendors have a factor
    expect(users.filter((user) => user.realm === 'vendor')).toEqual([
      { email: 'operator@vendor.example', realm: 'vendor', mfa_enrolled: true },
      { email: 'operator2@vendor.example', realm: 'vendor', mfa_enrolled: true },
    ])
    // BUG-031: bootstrap users, no inviter, so each can be the other's second person.
    expect(vendors).toEqual([
      { email: 'operator@vendor.example', created_by: null }, { email: 'operator2@vendor.example', created_by: null },
    ])
    expect(grants).toEqual([
      { name: 'Commission analyst', approved: false },
      { name: 'Compliance officer', approved: true },
      { name: 'DPO', approved: true }, // privileged since B2 (privacy.manage): a second admin's approval
      { name: 'Finance approver', approved: true },
      { name: 'Support agent', approved: false },
      { name: 'Tenant admin', approved: false },
      { name: 'Tenant admin', approved: false },
    ])
    expect(markets).toEqual([{ code: 'DEMO', state: 'draft' }, { code: 'DEMO', state: 'draft' }]) // D-B1-17
    expect(await ownerRows('SELECT count(*)::int AS n FROM guardrail_rule')).toEqual([{ n: 0 }]) // fixture pack: nmp_e2e only
    expect(first.filter((line) => line.startsWith('vendor TOTP: otpauth://'))).toHaveLength(2)
    expect(first.some((line) => line.startsWith('password of the accounts created now: '))).toBe(true)
    expect(second).toEqual([])
  })

  test('prints no TOTP secret outside development, refuses a fixed password on nmp_test and refuses production', async () => {
    await resetApiDb()
    const lines: string[] = []

    await seed(testConfig({ NODE_ENV: 'test' }), undefined, (line) => lines.push(line))

    expect(lines.some((line) => line.includes('otpauth'))).toBe(false)
    await expect(seed(testConfig({ NODE_ENV: 'test' }), 'given password 123', () => undefined)).rejects.toThrow(
      'refuses SEED_PASSWORD for database nmp_test',
    )
    await expect(seed(testConfig({ NODE_ENV: 'production' }), undefined, () => undefined)).rejects.toThrow('production')
  })

  test('the e2e fixture pack is labelled, idempotent and refused when the owner connection is on another database', async () => {
    await resetApiDb()
    const database = (await ownerRows<{ name: string }>('SELECT current_database() AS name'))[0]!.name

    await seedFixturePack(database)
    await seedFixturePack(database)
    const rules = await ownerRows(
      `SELECT 'guardrail' AS kind, id, title, mandatory, basis_status, source_ref FROM guardrail_rule WHERE market_pack = $1
       UNION ALL SELECT 'tax', id, title, mandatory, basis_status, source_ref FROM tax_rule WHERE market_pack = $1 ORDER BY 1`,
      [E2E_FIXTURE_PACK],
    )

    expect(rules).toEqual([
      {
        kind: 'guardrail', id: 'e2e-enrolment-only-bonus@2026-01-01', title: 'E2E FIXTURE — enrolment-only bonus',
        mandatory: true, basis_status: 'screening', source_ref: 'E2E fixture, not a real market rule',
      },
      {
        kind: 'tax', id: 'e2e-withholding@2026-01-01', title: 'E2E FIXTURE — withholding', mandatory: true,
        basis_status: 'counsel_confirmed', source_ref: 'E2E fixture',
      },
    ])
    await expect(seedFixturePack('nmp_e2e')).rejects.toThrow('not nmp_e2e')
  })

  test('the e2e fixture market NL is live for acme with a monthly calendar, past periods committed; idempotent', async () => {
    await resetApiDb()
    const database = (await ownerRows<{ name: string }>('SELECT current_database() AS name'))[0]!.name
    await seed(testConfig({ NODE_ENV: 'test' }), undefined, () => undefined)

    await seedFixtureMarket(database)
    await seedFixtureMarket(database)
    const markets = await ownerRows(
      `SELECT t.slug, m.code, m.currency, m.time_zone, m.languages, m.market_pack, m.state
       FROM market m JOIN tenant t ON t.id = m.tenant_id WHERE m.code = 'NL'`,
    )
    const periods = await ownerRows<{ state: string; starts_at: Date; ends_at: Date }>(
      `SELECT p.state, p.starts_at, p.ends_at FROM period p JOIN calendar c ON c.id = p.calendar_id
       WHERE c.name = 'NL monthly' ORDER BY p.starts_at`,
    )
    const [bounds] = await ownerRows<{ committed_until: Date; months: number }>(
      `SELECT date_trunc('month', now()) - interval '1 month' AS committed_until,
              ((extract(year FROM x) - 2026) * 12 + extract(month FROM x) - 1)::int AS months
       FROM (SELECT date_trunc('month', now()) + interval '12 months' AS x) AS ahead`,
    )

    expect(markets).toEqual([
      { slug: 'acme', code: 'NL', currency: 'EUR', time_zone: 'Europe/Amsterdam', languages: ['nl'], market_pack: E2E_FIXTURE_PACK, state: 'live' },
    ])
    expect(periods[0]!.starts_at).toEqual(new Date('2025-12-31T23:00:00Z')) // 2026-01-01 00:00 Amsterdam
    expect(periods.every((period) => (period.state === 'committed') === (period.ends_at <= bounds!.committed_until))).toBe(true)
    expect(periods.filter((period) => period.state === 'committed').length).toBeGreaterThan(0)
    expect(periods).toHaveLength(bounds!.months) // 2026-01 up to twelve months ahead
    await expect(seedFixtureMarket('nmp_e2e')).rejects.toThrow('not nmp_e2e')
  })

  test('seeds only the local databases, with a fixed password only in nmp_dev and nmp_e2e', () => {
    const local = (database: string) => ({ database, serverAddress: '127.0.0.1' })

    expect(() => assertSeedable('development', local('nmp_dev'), true)).not.toThrow()
    expect(() => assertSeedable('test', local('nmp_e2e'), true)).not.toThrow()
    expect(() => assertSeedable('test', local('nmp_test'), false)).not.toThrow()
    expect(() => assertSeedable('test', local('nmp_test'), true)).toThrow('refuses SEED_PASSWORD')
    expect(() => assertSeedable('development', local('nmp_prod'), false)).toThrow('refuses database nmp_prod')
    expect(() => assertSeedable('production', local('nmp_e2e'), true)).toThrow('production')
  })

  test('seeds only a server on this machine: Unix socket or loopback, never a remote host named like a local database', () => {
    const at = (serverAddress: string | null) => () => assertSeedable('test', { database: 'nmp_e2e', serverAddress }, true)

    for (const address of [null, '127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) expect(at(address)).not.toThrow()
    for (const address of ['10.0.0.5', '203.0.113.7', '128.0.0.1', '::ffff:10.0.0.5', '2001:db8::1']) {
      expect(at(address)).toThrow(`refuses the database server at ${address}`)
    }
  })
})
