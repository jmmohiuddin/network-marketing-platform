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

    expect(users).toHaveLength(9)
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

  test('prints no secret outside development and refuses production', async () => {
    await resetApiDb()
    const lines: string[] = []

    await seed(testConfig({ NODE_ENV: 'test' }), 'given password 123', (line) => lines.push(line))

    expect(lines.some((line) => line.includes('otpauth') || line.includes('password'))).toBe(false)
    await expect(seed(testConfig({ NODE_ENV: 'production' }), undefined, () => undefined)).rejects.toThrow('production')
  })

  test('seeds only the local databases', () => {
    expect(() => assertSeedable('development', 'nmp_dev')).not.toThrow()
    expect(() => assertSeedable('test', 'nmp_e2e')).not.toThrow()
    expect(() => assertSeedable('development', 'nmp_prod')).toThrow('refuses database nmp_prod')
  })
})
