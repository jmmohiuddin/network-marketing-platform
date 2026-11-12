import { beforeAll, describe, expect, test } from 'vitest'
import { closePoolsAfterAll, ownerRows, resetApiDb, testConfig } from '../test/helpers/index.js'
import { assertSeedable, seed } from './seed.js'

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
})

describe('seed', () => {
  test('creates the vendor operator and two tenants with staff, and is idempotent', async () => {
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

    expect(users).toHaveLength(9)
    expect(credentials).toEqual([{ passwords: 9, factors: 1 }]) // written as their own users; only the vendor has a factor
    expect(users.find((user) => user.realm === 'vendor')).toEqual({ email: 'operator@vendor.example', realm: 'vendor', mfa_enrolled: true })
    expect(grants).toEqual([
      { name: 'Commission analyst', approved: false },
      { name: 'Compliance officer', approved: true },
      { name: 'Tenant admin', approved: false },
      { name: 'Tenant admin', approved: false },
    ])
    expect(first.some((line) => line.startsWith('vendor TOTP: otpauth://'))).toBe(true)
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
