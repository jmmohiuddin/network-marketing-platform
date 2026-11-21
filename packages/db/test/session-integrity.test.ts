// BUG-003 (session columns are not rewritable) and BUG-004 (sessions of closed accounts do not resolve).
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, withVendor, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '../src/testing.js'
import { closePoolsAfterAll, openSession as openAs, PERMISSION_DENIED, type OpenedSession as OpenSession } from './support.js'

const SESSION_PINNED = /a session keeps its identity/
const NOT_OWN_SESSION = /only the acting user's own live session/
const STEP_UP_NEEDS_AAL2 = /step-up without a new token needs an AAL2 session/
const NOT_ACTING_USER = /a session is opened only for the active acting user, in its own realm/
const SESSION_TOO_LONG = /a session lasts between 1 and 720 minutes/

let tenant: TestTenant
let ctx: TenantContext
let colleague: TenantContext
let vendorUserId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetTestDb()
  tenant = await createTenant()
  ctx = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  colleague = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  vendorUserId = (await createUser({ tenantId: null })).id
})

// Owner-only: rows nmp_app cannot create (sessions of closed accounts).
async function insertSession(tx: Tx, userId: string, tenantId: string | null): Promise<OpenSession> {
  const tokenHash = randomBytes(32)
  const { rows } = await tx.query<{ id: string; expires_at: Date }>(
    `INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, expires_at)
     VALUES ($1, $2, $3, $4, 'aal1', now() + interval '1 hour') RETURNING id, expires_at`,
    [tokenHash, userId, tenantId, tenantId === null ? 'vendor' : 'tenant'],
  )
  return { id: rows[0]!.id, tokenHash, expiresAt: rows[0]!.expires_at }
}

const openSession = (user: TenantContext) => withTenant(user, (tx) => openAs(tx))

const find = (tokenHash: Buffer) =>
  withSystem((tx) => tx.query('SELECT id, user_id, assurance_level, expires_at FROM auth_find_session($1)', [tokenHash]))

async function revoked(ids: readonly string[]): Promise<boolean[]> {
  const { rows } = await getOwnerPool().query<{ revoked: boolean }>(
    'SELECT revoked_at IS NOT NULL AS revoked FROM session WHERE id = ANY ($1::uuid[]) ORDER BY array_position($1::uuid[], id)',
    [ids],
  )
  return rows.map((row) => row.revoked)
}

describe('BUG-003 session integrity', () => {
  test('nmp_app holds no INSERT privilege on any session column', async () => {
    const { rows } = await getOwnerPool().query(`SELECT has_any_column_privilege('nmp_app', 'session', 'INSERT') AS insert`)

    expect(rows).toEqual([{ insert: false }])
  })

  test.each<[string, string]>([
    ['an AAL2 session', `'aal2', now(), NULL, now() + interval '1 hour'`],
    ['a stepped-up session', `'aal1', NULL, now(), now() + interval '1 hour'`],
    ['a ten-year session', `'aal1', NULL, NULL, now() + interval '10 years'`],
  ])('nmp_app cannot insert %s', async (_shape, values) => {
    await expect(
      withTenant(ctx, (tx) =>
        tx.query(
          `INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, mfa_verified_at, step_up_at, expires_at)
           VALUES ($1, $2, $3, 'tenant', ${values})`,
          [randomBytes(32), ctx.userId, ctx.tenantId],
        ),
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  test('nmp_app cannot insert a session for another user of its tenant', async () => {
    await expect(
      withTenant(ctx, (tx) =>
        tx.query(
          `INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, expires_at)
           VALUES ($1, $2, $3, 'tenant', 'aal1', now() + interval '1 hour')`,
          [randomBytes(32), colleague.userId, ctx.tenantId],
        ),
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  test('auth_open_session opens an AAL1 session for the acting user only, for at most 720 minutes', async () => {
    const opened = await openSession(ctx)
    const longest = await withTenant(ctx, (tx) => openAs(tx, 720))
    const { rows } = await getOwnerPool().query(
      `SELECT user_id, tenant_id, realm, assurance_level, mfa_verified_at, step_up_at, revoked_at,
              created_at = last_seen_at AS fresh, extract(epoch FROM expires_at - created_at)::int AS lifetime_seconds
       FROM session WHERE id = ANY ($1::uuid[]) ORDER BY expires_at`,
      [[opened.id, longest.id]],
    )
    const own = {
      user_id: ctx.userId, tenant_id: ctx.tenantId, realm: 'tenant', assurance_level: 'aal1', mfa_verified_at: null,
      step_up_at: null, revoked_at: null, fresh: true,
    }

    expect(rows).toEqual([{ ...own, lifetime_seconds: 3600 }, { ...own, lifetime_seconds: 43_200 }])
    await expect(withTenant(ctx, (tx) => openAs(tx, 721))).rejects.toThrow(SESSION_TOO_LONG)
    await expect(withTenant(ctx, (tx) => openAs(tx, 0))).rejects.toThrow(SESSION_TOO_LONG)
  })

  test('auth_open_session refuses an acting user outside the context: other tenant, other realm, closed, none', async () => {
    const other = await createTenant()
    const foreignUser = (await createUser({ tenantId: other.id })).id
    const leaver = (await createUser({ tenantId: tenant.id, state: 'deactivated' })).id

    await expect(withTenant({ tenantId: tenant.id, userId: foreignUser }, (tx) => openAs(tx))).rejects.toThrow(NOT_ACTING_USER)
    await expect(withTenant({ tenantId: tenant.id, userId: vendorUserId }, (tx) => openAs(tx))).rejects.toThrow(NOT_ACTING_USER)
    await expect(withVendor({ userId: ctx.userId }, (tx) => openAs(tx))).rejects.toThrow(NOT_ACTING_USER)
    await expect(withTenant({ tenantId: tenant.id, userId: leaver }, (tx) => openAs(tx))).rejects.toThrow(NOT_ACTING_USER)
    await expect(withSystem((tx) => openAs(tx))).rejects.toThrow(NOT_ACTING_USER)
  })

  test('last_seen_at never moves into the future (the idle timeout stays on)', async () => {
    const session = await openSession(ctx)
    const setLastSeen = (value: string) =>
      withTenant(ctx, (tx) => tx.query(`UPDATE session SET last_seen_at = ${value} WHERE id = $1`, [session.id]))

    await expect(setLastSeen(`now() + interval '100 years'`)).rejects.toThrow(SESSION_PINNED)
    await expect(setLastSeen('now()')).resolves.toMatchObject({ rowCount: 1 })
  })

  test.each<[string, string, () => unknown[]]>([
    ['token_hash', 'token_hash = $2', () => [randomBytes(32)]],
    ['user_id', 'user_id = $2', () => [colleague.userId]],
    ['tenant_id', 'tenant_id = tenant_id', () => []],
    ['realm', 'realm = realm', () => []],
    ['created_at', 'created_at = now()', () => []],
    ['expires_at', `expires_at = now() + interval '1 year'`, () => []],
    ['assurance_level', `assurance_level = 'aal2'`, () => []],
    ['mfa_verified_at', 'mfa_verified_at = now()', () => []],
    ['step_up_at', 'step_up_at = now()', () => []],
  ])('nmp_app cannot write session.%s', async (_column, assignment, params) => {
    const session = await openSession(ctx)

    await expect(
      withTenant(ctx, (tx) => tx.query(`UPDATE session SET ${assignment} WHERE id = $1`, [session.id, ...params()])),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  test('a revocation is final and the expiry only moves earlier, for the owner role as well', async () => {
    const session = await openSession(ctx)
    const owner = getOwnerPool()
    const ownerUpdate = (assignment: string, params: unknown[] = []) =>
      owner.query(`UPDATE session SET ${assignment} WHERE id = $1`, [session.id, ...params])

    await expect(ownerUpdate(`expires_at = expires_at + interval '1 day'`)).rejects.toThrow(SESSION_PINNED)
    await expect(ownerUpdate('user_id = $2', [colleague.userId])).rejects.toThrow(SESSION_PINNED)
    await expect(ownerUpdate('token_hash = $2', [randomBytes(32)])).rejects.toThrow(SESSION_PINNED)
    await ownerUpdate(`expires_at = expires_at - interval '1 minute'`)
    await withTenant(ctx, (tx) => tx.query('UPDATE session SET revoked_at = now() WHERE id = $1', [session.id]))
    await expect(
      withTenant(ctx, (tx) => tx.query('UPDATE session SET revoked_at = NULL WHERE id = $1', [session.id])),
    ).rejects.toThrow(SESSION_PINNED)
    await expect(ownerUpdate('revoked_at = now()')).rejects.toThrow(SESSION_PINNED)
    expect((await find(session.tokenHash)).rows).toEqual([])
  })

  test('a second factor elevates only the acting user’s own live session, under a new token', async () => {
    const session = await openSession(ctx)
    const newTokenHash = randomBytes(32)
    const elevate = (as: TenantContext, tokenHash: Buffer | null, id = session.id) =>
      withTenant(as, (tx) =>
        tx.query<{ session_id: string; session_expires_at: Date }>(
          'SELECT session_id, session_expires_at FROM auth_elevate_session($1, $2)',
          [id, tokenHash],
        ),
      )

    await expect(elevate(colleague, newTokenHash)).rejects.toThrow(NOT_OWN_SESSION)
    await expect(elevate(ctx, null)).rejects.toThrow(STEP_UP_NEEDS_AAL2)
    const elevated = (await elevate(ctx, newTokenHash)).rows[0]!
    const stepUp = (await elevate(ctx, null, elevated.session_id)).rows[0]!

    expect(elevated.session_id).not.toBe(session.id)
    expect(elevated.session_expires_at).toEqual(session.expiresAt)
    expect(stepUp.session_id).toBe(elevated.session_id)
    expect((await find(session.tokenHash)).rows).toEqual([])
    expect((await find(newTokenHash)).rows).toEqual([
      { id: elevated.session_id, user_id: ctx.userId, assurance_level: 'aal2', expires_at: session.expiresAt },
    ])
    await expect(elevate(ctx, randomBytes(32))).rejects.toThrow(NOT_OWN_SESSION) // the replaced session is revoked
  })
})

describe('BUG-004 sessions of closed accounts', () => {
  // C-V1A-9 (0805): an archived tenant stays readable, so a session opened after the archive resolves (archiving revokes
  // the sessions that were live, test below).
  test('auth_find_session does not return the session of a user who is not active; an archived tenant\'s new session resolves', async () => {
    const archivedTenant = await createTenant({ state: 'archived' })
    const closed = [
      { userId: (await createUser({ tenantId: tenant.id, state: 'deactivated' })).id, tenantId: tenant.id },
      { userId: (await createUser({ tenantId: tenant.id, state: 'locked' })).id, tenantId: tenant.id },
      { userId: (await createUser({ tenantId: archivedTenant.id })).id, tenantId: archivedTenant.id },
    ]
    const owner = await getOwnerPool().connect()
    const sessions: OpenSession[] = []
    try {
      for (const user of closed) sessions.push(await insertSession(owner, user.userId, user.tenantId))
    } finally {
      owner.release()
    }

    const found = await Promise.all(sessions.map((session) => find(session.tokenHash)))

    expect(found.map((result) => result.rowCount)).toEqual([0, 0, 1])
  })

  test('deactivating a user or archiving a tenant revokes their live sessions in the same transaction', async () => {
    const leaver = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
    const closing = await createTenant()
    const closingUser = { tenantId: closing.id, userId: (await createUser({ tenantId: closing.id })).id }
    const sessions = [await openSession(leaver), await openSession(colleague), await openSession(closingUser)]
    const vendorSession = await withVendor({ userId: vendorUserId }, (tx) => openAs(tx))

    await withTenant(ctx, (tx) => tx.query(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [leaver.userId]))
    await withVendor({ userId: vendorUserId }, (tx) => tx.query(`UPDATE tenant SET state = 'archived' WHERE id = $1`, [closing.id]))

    expect(await revoked([...sessions, vendorSession].map((session) => session.id))).toEqual([true, false, true, false])
  })
})
