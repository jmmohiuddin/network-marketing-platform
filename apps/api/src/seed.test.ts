import { beforeAll, describe, expect, test } from 'vitest'
import { closePoolsAfterAll, ownerRows, resetApiDb, testConfig } from '../test/helpers/index.js'
import { assertSeedable, E2E_FIXTURE_PACK, seed, seedFixtureMarket, seedFixturePack, seedFixturePlanMarket } from './seed.js'

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

    expect(users).toHaveLength(24)
    expect(credentials).toEqual([{ passwords: 24, factors: 2 }]) // written as their own users; only vendors have a factor
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
      { name: 'Executive read-only', approved: false },
      { name: 'Finance approver', approved: true },
      { name: 'Implementation consultant', approved: false },
      { name: 'Payout officer', approved: false }, // MFA required, but no privileged permission: no approval
      { name: 'Plan administrator', approved: false },
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
       UNION ALL SELECT 'tax', id, title, mandatory, basis_status, source_ref FROM tax_rule WHERE market_pack = $1 ORDER BY 1, 2`,
      [E2E_FIXTURE_PACK],
    )
    const checks = await ownerRows('SELECT id, outcome, overridable, predicate FROM guardrail_rule ORDER BY id')

    expect(rules).toEqual([
      {
        kind: 'guardrail', id: 'e2e-enrolment-only-bonus@2026-01-01', title: 'E2E FIXTURE — enrolment-only bonus',
        mandatory: true, basis_status: 'screening', source_ref: 'E2E fixture, not a real market rule',
      },
      {
        kind: 'guardrail', id: 'e2e-starter-kit-volume@2026-01-01', title: 'E2E FIXTURE — starter kit',
        mandatory: true, basis_status: 'screening', source_ref: 'E2E fixture, not a real market rule',
      },
      {
        kind: 'tax', id: 'e2e-withholding@2026-01-01', title: 'E2E FIXTURE — withholding', mandatory: true,
        basis_status: 'counsel_confirmed', source_ref: 'E2E fixture',
      },
    ])
    expect(checks).toEqual([ // PLAN B3 section 6: the checks CPL evaluates
      { id: 'e2e-enrolment-only-bonus@2026-01-01', outcome: 'blocked', overridable: false, predicate: { check: 'enrolment_only_pay' } },
      { id: 'e2e-starter-kit-volume@2026-01-01', outcome: 'warned', overridable: true, predicate: { check: 'starter_kit_volume' } },
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

  test('the e2e fixture market DE: Berlin months M-3 to M+3 open, A <- B <- C, K serviced by C, FX-1; idempotent', async () => {
    await resetApiDb()
    const database = (await ownerRows<{ name: string }>('SELECT current_database() AS name'))[0]!.name
    await seed(testConfig({ NODE_ENV: 'test' }), undefined, () => undefined)

    await seedFixturePlanMarket(database)
    await seedFixturePlanMarket(database)
    const periods = await ownerRows<{ state: string; starts_at: Date; first: Date }>(
      `SELECT p.state, p.starts_at,
              (date_trunc('month', now() AT TIME ZONE 'Europe/Berlin') - interval '3 months') AT TIME ZONE 'Europe/Berlin' AS first
       FROM period p JOIN calendar c ON c.id = p.calendar_id WHERE c.name = 'DE monthly' ORDER BY p.starts_at`,
    )
    const sponsors = await ownerRows(
      `SELECT pc.external_ref AS child, pp.external_ref AS parent
       FROM relationship r
       JOIN position_ownership oc ON oc.position_id = r.child_position_id JOIN participant pc ON pc.id = oc.participant_id
       JOIN position_ownership op ON op.position_id = r.parent_position_id JOIN participant pp ON pp.id = op.participant_id
       WHERE r.kind = 'sponsor' ORDER BY 1`,
    )
    const servicing = await ownerRows(
      `SELECT k.external_ref AS customer, p.external_ref AS servicer, t.code
       FROM customer_servicing s JOIN participant k ON k.id = s.customer_id
       JOIN participant_type_assignment a ON a.participant_id = k.id JOIN participant_type t ON t.id = a.type_id
       JOIN position_ownership o ON o.position_id = s.servicing_position_id JOIN participant p ON p.id = o.participant_id`,
    )

    expect(await ownerRows(`SELECT state, currency, time_zone, market_pack FROM market WHERE code = 'DE'`)).toEqual([
      { state: 'live', currency: 'EUR', time_zone: 'Europe/Berlin', market_pack: E2E_FIXTURE_PACK },
    ])
    expect(periods).toHaveLength(7)
    expect(periods.every((period) => period.state === 'open')).toBe(true)
    expect(periods[0]!.starts_at).toEqual(periods[0]!.first)
    expect(sponsors).toEqual([{ child: 'DE-B', parent: 'DE-A' }, { child: 'DE-C', parent: 'DE-B' }])
    expect(servicing).toEqual([{ customer: 'DE-K', servicer: 'DE-C', code: 'FXRETAIL' }])
    expect(await ownerRows(`SELECT sku, volumes FROM product_volume_map WHERE sku = 'FX-1'`)).toEqual([{ sku: 'FX-1', volumes: { pv: '10000' } }])
    expect(await ownerRows(`SELECT state FROM participant_type WHERE code IN ('FXDIST', 'FXRETAIL')`)).toEqual([{ state: 'active' }, { state: 'active' }])
    // BUG-085: a settings version is in force from the first DE period on, so M-3..M-1 can be simulated and run.
    expect(await ownerRows(
      `SELECT v.settings -> 'structure' -> 'markets' @> '[{"code": "DE"}]' AS has_de FROM tenant_setting_version v JOIN tenant t ON t.id = v.tenant_id
       WHERE t.slug = 'acme' AND v.effective_from <= $1`, [periods[0]!.starts_at],
    )).toEqual([{ has_de: true }])
    await expect(seedFixturePlanMarket('nmp_e2e')).rejects.toThrow('not nmp_e2e')
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

  test('staging opt-in: any database server, even production, but never a fixed password', () => {
    const remote = { database: 'nmp', serverAddress: '172.18.0.2' }

    expect(() => assertSeedable('production', remote, false, true)).not.toThrow()
    expect(() => assertSeedable('production', remote, true, true)).toThrow('refuses SEED_PASSWORD on staging')
    expect(() => assertSeedable('production', remote, false)).toThrow('production')
    expect(() => assertSeedable('test', remote, false)).toThrow('refuses the database server at 172.18.0.2')
  })

  test('a staging seed prints the vendor authenticator URIs and the generated password', async () => {
    await resetApiDb()
    const lines: string[] = []

    await seed(testConfig({ NODE_ENV: 'production' }), undefined, (line) => lines.push(line), true)

    expect(lines.filter((line) => line.startsWith('vendor TOTP: otpauth://'))).toHaveLength(2)
    expect(lines.some((line) => line.startsWith('password of the accounts created now: '))).toBe(true)
    expect(lines.filter((line) => line.startsWith('acme: '))).toHaveLength(11)
  })

  test('seeds only a server on this machine: Unix socket or loopback, never a remote host named like a local database', () => {
    const at = (serverAddress: string | null) => () => assertSeedable('test', { database: 'nmp_e2e', serverAddress }, true)

    for (const address of [null, '127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) expect(at(address)).not.toThrow()
    for (const address of ['10.0.0.5', '203.0.113.7', '128.0.0.1', '::ffff:10.0.0.5', '2001:db8::1']) {
      expect(at(address)).toThrow(`refuses the database server at ${address}`)
    }
  })
})
