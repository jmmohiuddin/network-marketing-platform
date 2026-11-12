import { randomUUID } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { beforeAll, describe, expect, test } from 'vitest'
import { closePoolsAfterAll, ownerRows, resetApiDb, testConfig } from '../../test/helpers/index.js'
import { acceptInvitation } from '../modules/iam/index.js'
import { assertBootstrapAllowed, createVendorUser, parseArgs } from './create-vendor-user.js'

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
})

describe('create-vendor-user (BUG-031 operator bootstrap)', () => {
  test('outside a local database, or in production, refuses unless both the flag and the environment variable are given', () => {
    const local = { database: 'nmp_test', serverAddress: '127.0.0.1' }
    const remote = { database: 'nmp_test', serverAddress: '10.0.0.5' }
    const otherDb = { database: 'nmp', serverAddress: null }

    for (const [env, target] of [['production', local], ['development', remote], ['test', otherDb]] as const) {
      expect(() => assertBootstrapAllowed(env, target, false, undefined)).toThrow('refusing')
      expect(() => assertBootstrapAllowed(env, target, true, undefined)).toThrow('refusing')
      expect(() => assertBootstrapAllowed(env, target, false, 'yes')).toThrow('refusing')
      expect(() => assertBootstrapAllowed(env, target, true, 'true')).toThrow('refusing')
      expect(() => assertBootstrapAllowed(env, target, true, 'yes')).not.toThrow()
    }
    expect(() => assertBootstrapAllowed('development', local, false, undefined)).not.toThrow()
    expect(() => assertBootstrapAllowed('test', { database: 'nmp_e2e', serverAddress: null }, false, undefined)).not.toThrow()
  })

  test('parses the email (required, lower-cased), an optional name and the flag', () => {
    expect(parseArgs(['--email', 'Ops@Vendor.Example', '--name', 'Ada Ops', '--i-understand']))
      .toEqual({ email: 'ops@vendor.example', displayName: 'Ada Ops', iUnderstand: true })
    expect(parseArgs(['--email', 'ops@vendor.example'])).toEqual({ email: 'ops@vendor.example', displayName: null, iUnderstand: false })
    expect(() => parseArgs(['--name', 'No Email'])).toThrow()
  })

  test('creates an inviter-less vendor user with a one-time link that activates it, logged in the vendor log', async () => {
    const email = `boot-${randomUUID().slice(0, 8)}@vendor.test`
    const config = testConfig()

    const created = await createVendorUser(config, { email, displayName: null, iUnderstand: false })
    const token = created.link.split('#token=')[1]!
    await acceptInvitation(token, 'correct horse battery staple', 'test')
    const [user] = await ownerRows('SELECT state, created_by, invitation_decision FROM user_account WHERE id = $1', [created.userId])
    const log = await ownerRows(
      `SELECT action, actor_type, actor_id, (after_ref::jsonb)->'after'->>'os_user' AS os_user, (after_ref::jsonb)->'after'->>'host' AS host
       FROM audit.vendor_event WHERE object_id = $1 ORDER BY seq`, [created.userId])

    expect(created.link).toBe(`${config.webUrl}/invitation?realm=vendor#token=${token}`)
    expect(user).toEqual({ state: 'active', created_by: null, invitation_decision: null })
    expect(log).toEqual([
      { action: 'USER.BOOTSTRAPPED', actor_type: 'system', actor_id: null, os_user: userInfo().username, host: hostname() },
      { action: 'USER.ACTIVATED', actor_type: 'vendor_user', actor_id: created.userId, os_user: null, host: null },
    ])
    await expect(acceptInvitation(token, 'another password 123', 'test')).rejects.toThrow('not valid')
    await expect(createVendorUser(config, { email, displayName: null, iUnderstand: false })).rejects.toThrow('already exists')
  })

  // Runs after the test above: one usable vendor user exists.
  test('stops at two usable vendor users: further ones are invited in the console; pending invitations do not count', async () => {
    const config = testConfig()
    const boot = (email: string) => createVendorUser(config, { email, displayName: null, iUnderstand: false })
    const [first] = await ownerRows<{ id: string }>(`SELECT id FROM user_account WHERE realm = 'vendor' AND state = 'active'`)
    await ownerRows(
      `INSERT INTO user_account (tenant_id, realm, idp_subject, email, state, created_by) VALUES (NULL, 'vendor', $1, $2, 'invited', $3)`,
      [`local:${randomUUID()}`, `pending-${randomUUID().slice(0, 8)}@vendor.test`, first!.id],
    )

    await boot(`boot-${randomUUID().slice(0, 8)}@vendor.test`)

    await expect(boot(`boot-${randomUUID().slice(0, 8)}@vendor.test`)).rejects.toThrow('2 vendor users already exist')
  })
})
