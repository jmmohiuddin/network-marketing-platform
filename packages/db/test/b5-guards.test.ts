// Behaviour of the B5 tables, guards and shared SQL (PLAN B5 sections 1 and 4.2; migrations 0500-0505) as the runtime role
// nmp_app. Test ids: T-B5-22 (shared fingerprint count), T-B5-24 (notify functions), T-B5-33 (tenant_by_slug), T-B5-35
// (personal-data map), T-B5-38 (erasure SQL and its guards), AC-50.1 (dispute insert guard), D-B5-02 (self policies).
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '../src/testing.js'
import { seedTenantRows, type TenantSeed } from './seed.js'
import { asUser, closePoolsAfterAll, insertRow, openSession, PERMISSION_DENIED, race, RLS_VIOLATION } from './support.js'

const CHECK = { code: '23514' }
const NOT_ALLOWED = { code: '42501' }
const UNIQUE = { code: '23505' }
const INVALID = { code: '22023' }
const HOUR = 3_600_000
const DAY = 24 * HOUR

let tenant: TestTenant
let a: TenantContext // staff, prepares
let secondUserId: string // staff, approves
let seed: TenantSeed
let portal: TenantContext // the seed participant's portal session
let other: { participantId: string; userId: string; email: string; ctx: TenantContext }

closePoolsAfterAll()

const owner = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await getOwnerPool().query(sql, params)).rows as T[]
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], ctx = a): Promise<T[]> =>
  (await withTenant(ctx, (tx) => tx.query(sql, params))).rows as T[]
const value = async <T>(sql: string, params: unknown[] = [], ctx = a): Promise<T> =>
  Object.values((await rows(sql, params, ctx))[0]!)[0] as T

/** An active participant of the seed market (owner-inserted, contact email) with an active portal account. */
async function participantWithPortal(ref: string) {
  const email = `${ref}@example.test`
  const [participant] = await owner<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $2, $4, now(), $5, 'system') RETURNING id`,
    [tenant.id, ref, seed.marketId, { email, phone: '+44 20 0000 0000' }, a.userId],
  )
  const [user] = await owner<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, state, participant_id) VALUES ($1, 'portal', $2, $3, 'active', $4) RETURNING id`,
    [tenant.id, randomUUID(), email, participant!.id],
  )
  return { participantId: participant!.id, userId: user!.id, email, ctx: { tenantId: tenant.id, userId: user!.id, participantId: participant!.id } }
}

/** A settings version in force now with key = value (owner); a money key with its approved change request, as the API writes it. */
async function setSetting(key: string, value: unknown) {
  await owner(
    `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                SELECT $1, 'setting_change_request', $4, $5, $6, 'approved', now(), $6 WHERE $2 = ANY (money_setting_keys()) RETURNING id),
          v AS (INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
                SELECT $1, (SELECT max(version) + 1 FROM tenant_setting_version WHERE tenant_id = $1), now(),
                       (SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1)
                         || jsonb_build_object($2::text, $3::jsonb), 'FIXTURE', $5, (SELECT id FROM a) RETURNING id, effective_from)
     INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, decided_by,
       decided_at, approval_id, version_id)
     SELECT $4, $1, $2, $3::jsonb, v.effective_from, 'FIXTURE', 0, 'approved', $5, $6, now(), a.id, v.id FROM a, v`,
    [tenant.id, key, JSON.stringify(value), randomUUID(), a.userId, secondUserId],
  )
}

/** A system-opened privacy case with its request (owner), submitted by a and approved by the second user (nmp_app). */
async function approvedRequest(type: string, subject: string, requesterSealed: string | null = null, payload: Record<string, unknown> = {}) {
  const id = randomUUID()
  const [opened] = await owner<{ id: string }>(
    `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, opened_by_kind)
     VALUES ($1, 'privacy', 'privacy_request', $2, 'RECEIVED_BY_STAFF', 'open', $3, 'system') RETURNING id`,
    [tenant.id, id, { request_id: id, participant_id: subject, ...payload }],
  )
  const caseId = opened!.id
  await owner(
    `INSERT INTO privacy_request (id, tenant_id, case_id, type, channel, subject_participant_id, verified_at, verified_by,
       verification_method, created_by, requester_sealed) VALUES ($1, $2, $3, $4, 'staff', $5, now(), $6, 'contact_match', $6, $7)`,
    [id, tenant.id, caseId, type, subject, a.userId, requesterSealed],
  )
  await withTenant(a, async (tx) => {
    await tx.query(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [caseId, a.userId])
    const approvalId = await asUser(tx, secondUserId, () => insertRow(tx, 'approval', {
      tenant_id: tenant.id, object_type: 'case', object_id: caseId, preparer_id: a.userId, approver_id: secondUserId,
      decision: 'approved', decided_at: new Date(),
    }))
    await tx.query(`UPDATE case_file SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [caseId, approvalId])
  })
  return { id, caseId }
}

beforeAll(async () => {
  await resetTestDb()
  tenant = await createTenant({ slug: 'acme' })
  a = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  secondUserId = (await createUser({ tenantId: tenant.id })).id
  seed = await seedTenantRows(a, secondUserId)
  portal = { tenantId: tenant.id, userId: seed.portalUserId, participantId: seed.participantId }
  other = await participantWithPortal('other-1')
})

describe('portal identity (section 1.1)', () => {
  test('a portal account belongs to one participant; emails are unique per realm and among open portal accounts', async () => {
    const account = (realm: string, email: string, participant: string | null, state = 'active') => owner(
      `INSERT INTO user_account (tenant_id, realm, idp_subject, email, state, participant_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenant.id, realm, randomUUID(), email, state, participant],
    )

    await expect(account('portal', 'x@example.test', null)).rejects.toMatchObject(CHECK)
    await expect(account('tenant', 'y@example.test', seed.participantId)).rejects.toMatchObject(CHECK)
    await account('tenant', other.email, null) // a staff account may share a portal account's email
    await expect(account('portal', other.email, seed.participantId)).rejects.toMatchObject(UNIQUE)
    await expect(account('portal', 'second@example.test', other.participantId)).rejects.toMatchObject(UNIQUE)
    await account('portal', 'gone@example.test', other.participantId, 'deactivated')
  })

  test('an account keeps its realm, tenant and participant; a portal account holds no role', async () => {
    await expect(rows('UPDATE user_account SET participant_id = $2 WHERE id = $1', [other.userId, seed.participantId])).rejects.toMatchObject(CHECK)
    await expect(withTenant(a, (tx) => insertRow(tx, 'role_assignment', {
      tenant_id: tenant.id, user_id: other.userId, role_id: seed.roleId, valid_from: new Date(), approval_id: seed.approvalId,
    }))).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('auth_find_user looks up per realm and reports whether the participant may still sign in', async () => {
    const find = (realm: string) => withSystem((tx) => tx.query(
      'SELECT user_id, realm, participant_id, participant_active FROM auth_find_user($1, $2, $3)', [realm, 'acme', other.email]))

    expect((await find('portal')).rows).toEqual([
      { user_id: other.userId, realm: 'portal', participant_id: other.participantId, participant_active: true },
    ])
    expect((await find('tenant')).rows.map((row) => row.realm)).toEqual(['tenant'])
  })

  test('a portal transaction opens, elevates and re-authenticates only its own portal session', async () => {
    const opened = await withTenant(other.ctx, (tx) => openSession(tx))
    const [session] = await owner<{ realm: string }>('SELECT realm FROM session WHERE id = $1', [opened.id])
    const reauth = await withTenant(other.ctx, (tx) => tx.query('SELECT auth_reauth_session($1) AS at', [opened.id]))

    expect(session).toEqual({ realm: 'portal' })
    expect(reauth.rows[0]!.at).toBeInstanceOf(Date)
    await expect(withTenant({ ...other.ctx, participantId: seed.participantId }, (tx) => openSession(tx))).rejects.toMatchObject(NOT_ALLOWED)
    await expect(withTenant({ tenantId: tenant.id, userId: other.userId }, (tx) => openSession(tx))).rejects.toMatchObject(NOT_ALLOWED)
    await expect(withTenant(portal, (tx) => tx.query('SELECT auth_reauth_session($1)', [opened.id]))).rejects.toMatchObject(NOT_ALLOWED)
    const staff = await withTenant(a, (tx) => openSession(tx))
    await expect(withTenant(a, (tx) => tx.query('SELECT auth_reauth_session($1)', [staff.id]))).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('a sign-in code is issued unused to a portal account, counts one attempt at a time and is used once', async () => {
    const issue = (user: string) => withTenant(a, (tx) => insertRow(tx, 'portal_sign_in_code', {
      tenant_id: tenant.id, user_id: user, code_hash: randomBytes(32), expires_at: new Date(Date.now() + 600_000),
    }))
    const code = await issue(other.userId)

    await expect(issue(a.userId)).rejects.toMatchObject(CHECK)
    await rows('UPDATE portal_sign_in_code SET attempts = attempts + 1 WHERE id = $1', [code])
    await expect(rows('UPDATE portal_sign_in_code SET attempts = attempts + 2 WHERE id = $1', [code])).rejects.toMatchObject(CHECK)
    await rows('UPDATE portal_sign_in_code SET used_at = now() WHERE id = $1', [code])
    await expect(rows(`UPDATE portal_sign_in_code SET used_at = now() + interval '1 second' WHERE id = $1`, [code])).rejects.toMatchObject(CHECK)
    await expect(rows('UPDATE portal_sign_in_code SET code_hash = $2 WHERE id = $1', [code, randomBytes(32)])).rejects.toThrow(PERMISSION_DENIED)
  })

  test('tenant_by_slug: a live tenant only, in the system realm only (T-B5-33)', async () => {
    const provisioning = await createTenant({ state: 'provisioning' })
    const slug = (value: string) => withSystem((tx) => tx.query('SELECT tenant_by_slug($1) AS id', [value]))

    expect((await slug('acme')).rows).toEqual([{ id: tenant.id }])
    expect((await slug(provisioning.slug)).rows).toEqual([{ id: null }])
    expect((await slug('unknown')).rows).toEqual([{ id: null }])
    await expect(rows(`SELECT tenant_by_slug('acme')`)).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('portal_profile and portal_invite_target describe the participant', async () => {
    const profile = await value<Record<string, unknown>>('SELECT portal_profile($1)', [seed.participantId], portal)
    const target = await rows('SELECT * FROM portal_invite_target($1)', [other.participantId])

    expect(profile).toMatchObject({
      participant_id: seed.participantId, external_ref: 'seed-distributor', pseudonymised: false, can_sponsor: true,
      has_downline: true, terminated: false, positions: [{ id: seed.positionId, status: 'active' }],
    })
    expect(target).toEqual([{ market_id: seed.marketId, email: other.email, can_earn: false, active: true, pseudonymised: false }])
  })
})

describe('self scope (D-B5-02)', () => {
  const OWN_ROWS: [table: string, where: string][] = [
    ['result_line', 'payee_participant_id = $1'], ['run_settlement', 'payee_participant_id = $1'],
    ['payout_instruction', 'payee_participant_id = $1'], ['ledger_account', 'payee_participant_id = $1'],
    ['posting', 'account_id IN (SELECT id FROM ledger_account WHERE payee_participant_id = $1)'],
    ['bank_detail_request', 'participant_id = $1'], ['bank_detail_version', 'participant_id = $1'],
    ['tax_profile', 'participant_id = $1'], ['notification', 'recipient_participant_id = $1'],
    ['notification_preference', 'participant_id = $1'], ['privacy_request', 'subject_participant_id = $1'],
    ['privacy_export', 'request_id IN (SELECT id FROM privacy_request WHERE subject_participant_id = $1)'],
    ['case_file', `payload ->> 'participant_id' = $1::text`],
    ['case_event', `case_id IN (SELECT id FROM case_file WHERE payload ->> 'participant_id' = $1::text)`],
    ['case_evidence', `case_id IN (SELECT id FROM case_file WHERE payload ->> 'participant_id' = $1::text)`],
    ['user_account', 'participant_id = $1'], ['session', 'user_id IN (SELECT id FROM user_account WHERE participant_id = $1)'],
    ['portal_sign_in_code', 'user_id IN (SELECT id FROM user_account WHERE participant_id = $1)'],
    ['payout_batch_line', 'participant_id = $1'],
  ]
  // Rows a portal session never reads: staff hold text, batches (other payees' exclusion reasons), origins no own line cites.
  const STAFF_ONLY_ROWS: [table: string, where: string][] = [
    ['payout_hold', 'participant_id = $1'],
    ['payout_batch', 'id IN (SELECT batch_id FROM payout_instruction WHERE payee_participant_id = $1)'],
    ['adjustment_origin', 'payee_position_id IN (SELECT position_id FROM position_ownership WHERE participant_id = $1)'],
  ]
  const visible = (ctx: TenantContext, list = OWN_ROWS) => withTenant(ctx, async (tx) => {
    const tables: string[] = []
    for (const [table, where] of list) {
      if ((await tx.query(`SELECT 1 FROM ${table} WHERE ${where}`, [seed.participantId])).rowCount !== 0) tables.push(table)
    }
    return tables
  })

  beforeAll(async () => {
    const request = await approvedRequest('access', seed.participantId)
    await owner('INSERT INTO privacy_export (tenant_id, request_id, content) VALUES ($1, $2, $3)', [tenant.id, request.id, randomBytes(8)])
    await owner(`INSERT INTO case_event (tenant_id, case_id, kind) VALUES ($1, $2, 'opened')`, [tenant.id, request.caseId])
    await owner(`INSERT INTO case_evidence (tenant_id, case_id, document_id, added_by)
                 SELECT $1, $2, id, $3 FROM document WHERE tenant_id = $1 LIMIT 1`, [tenant.id, request.caseId, a.userId])
    await withTenant(portal, (tx) => openSession(tx))
  })

  test('staff and the participant itself see its rows; another participant sees none of them', async () => {
    const all = OWN_ROWS.map(([table]) => table)

    expect(await visible(a)).toEqual(all)
    expect(await visible(portal)).toEqual(all)
    expect(await visible(other.ctx)).toEqual([])
  })

  test('holds, batches and origins no own line cites are staff-only; the statement reads a batch period by function', async () => {
    const [batch] = await owner<{ period_id: string }>('SELECT period_id FROM payout_batch WHERE id = $1', [seed.payoutBatchId])

    expect(await visible(a, STAFF_ONLY_ROWS)).toEqual(STAFF_ONLY_ROWS.map(([table]) => table))
    expect(await visible(portal, STAFF_ONLY_ROWS)).toEqual([])
    expect(await visible(other.ctx, STAFF_ONLY_ROWS)).toEqual([])
    expect(await value('SELECT pay_batch_period($1)', [seed.payoutBatchId], portal)).toBe(batch!.period_id)
  })

  test('a portal transaction cannot change another account or session', async () => {
    const changed = await withTenant(other.ctx, async (tx) => [
      (await tx.query('UPDATE user_account SET email = $2 WHERE id = $1', [a.userId, 'taken@example.test'])).rowCount,
      (await tx.query('UPDATE session SET revoked_at = now() WHERE user_id = $1', [seed.portalUserId])).rowCount,
      (await tx.query('DELETE FROM portal_sign_in_code WHERE user_id = $1', [seed.portalUserId])).rowCount,
    ])

    expect(changed).toEqual([0, 0, 0])
  })

  test('a portal transaction cannot write the rows of another participant, nor any approval', async () => {
    await expect(withTenant(other.ctx, (tx) => tx.query(
      `INSERT INTO notification_preference (tenant_id, participant_id, topic, email) VALUES ($1, $2, 'payout', false)`,
      [tenant.id, seed.participantId]))).rejects.toThrow(RLS_VIOLATION)
    await expect(withTenant(other.ctx, (tx) => tx.query(`SELECT notify_participant($1, 'statement.ready', '{}')`, [seed.participantId])))
      .rejects.toThrow(RLS_VIOLATION)
    await expect(withTenant({ ...other.ctx, userId: a.userId }, (tx) => insertRow(tx, 'approval', {
      tenant_id: tenant.id, object_type: 'case', object_id: randomUUID(), preparer_id: secondUserId, approver_id: a.userId,
      decision: 'approved', decided_at: new Date(),
    }))).rejects.toThrow(RLS_VIOLATION)
    const updated = await withTenant(other.ctx, (tx) => tx.query(`UPDATE notification SET read_at = now() WHERE recipient_participant_id = $1`, [seed.participantId]))
    expect(updated.rowCount).toBe(0)
  })
})

describe('disputes (D-B5-15, AC-50.1)', () => {
  let lineId: string
  const dispute = (ctx: TenantContext, overrides: Record<string, unknown> = {}) => withTenant(ctx, (tx) => insertRow(tx, 'case_file', {
    tenant_id: tenant.id, type: 'dispute', subject_type: 'result_line', subject_id: lineId, reason_code: 'DISTRIBUTOR_DISPUTE',
    state: 'open', market_id: seed.marketId, opened_by: ctx.userId,
    payload: { line_id: lineId, run_id: seed.runId, participant_id: seed.participantId, message: 'Volume missing', trace: {} },
    ...overrides,
  }))

  beforeAll(async () => {
    lineId = (await owner<{ id: string }>('SELECT id FROM result_line WHERE run_id = $1', [seed.runId]))[0]!.id
  })

  test('only the line owner opens one, in its portal session, with the lines trace; one open per line', async () => {
    await expect(dispute(a)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(dispute(portal, { payload: { line_id: lineId, run_id: seed.runId, participant_id: seed.participantId, message: 'x', trace: { forged: true } } }))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(dispute(other.ctx, { payload: { line_id: lineId, run_id: seed.runId, participant_id: other.participantId, message: 'x', trace: {} } }))
      .rejects.toMatchObject(NOT_ALLOWED)
    const caseId = await dispute(portal)
    await withTenant(portal, (tx) => insertRow(tx, 'case_event', { tenant_id: tenant.id, case_id: caseId, actor_id: portal.userId, kind: 'opened' }))

    await expect(dispute(portal)).rejects.toMatchObject(UNIQUE)
    await expect(withTenant(portal, (tx) => insertRow(tx, 'case_file', {
      tenant_id: tenant.id, type: 'grievance', subject_type: 'participant', subject_id: seed.participantId, reason_code: 'X',
      state: 'open', opened_by: portal.userId, payload: { participant_id: seed.participantId },
    }))).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('comp_overdue_disputes lists submitted disputes past due once, until escalated (system realm)', async () => {
    const [open] = await owner<{ id: string }>(`SELECT id FROM case_file WHERE type = 'dispute' AND tenant_id = $1`, [tenant.id])
    await owner(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now(), due_at = now() - interval '1 day' WHERE id = $1`,
      [open!.id, portal.userId])
    const overdue = () => withSystem((tx) => tx.query('SELECT case_id FROM comp_overdue_disputes(10)'))

    expect((await overdue()).rows).toEqual([{ case_id: open!.id }])
    await rows(`INSERT INTO case_event (tenant_id, case_id, kind) VALUES ($1, $2, 'escalated')`, [tenant.id, open!.id])
    expect((await overdue()).rows).toEqual([])
    await expect(rows('SELECT * FROM comp_overdue_disputes(10)')).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('a portal session records only its own open, submit and withdraw; the escalation is the systems, when overdue', async () => {
    const [dispute] = await owner<{ id: string }>(`SELECT id FROM case_file WHERE type = 'dispute' AND tenant_id = $1`, [tenant.id])
    const [privacy] = await owner<{ id: string }>(`SELECT id FROM case_file WHERE type = 'privacy' AND tenant_id = $1 LIMIT 1`, [tenant.id])
    const event = (ctx: TenantContext, caseId: string, kind: string, actor: string | null) => withTenant(ctx, (tx) => insertRow(tx, 'case_event', {
      tenant_id: tenant.id, case_id: caseId, kind, actor_id: actor,
    }))

    await expect(event(portal, dispute!.id, 'approved', portal.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(event(portal, dispute!.id, 'escalated', null)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(event(a, dispute!.id, 'escalated', a.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(event(a, privacy!.id, 'escalated', null)).rejects.toMatchObject(NOT_ALLOWED)
    await event(portal, dispute!.id, 'withdrawn', portal.userId)
  })

  test('a case is assigned to a staff account only', async () => {
    const [dispute] = await owner<{ id: string }>(`SELECT id FROM case_file WHERE type = 'dispute' AND tenant_id = $1`, [tenant.id])
    const assign = (ctx: TenantContext, user: string) => rows('UPDATE case_file SET assigned_to = $2 WHERE id = $1', [dispute!.id, user], ctx)

    await expect(assign(a, portal.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(assign(portal, portal.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await assign(a, secondUserId)
  })
})

describe('notifications (D-B5-14, D-B5-24, T-B5-24)', () => {
  const ofRecipient = (participant: string, template: string) =>
    owner('SELECT channel, state, mandatory FROM notification WHERE recipient_participant_id = $1 AND template = $2 ORDER BY channel', [participant, template])

  test('an in-app row always; an email row with a contact email unless the topic is switched off (mandatory topics always)', async () => {
    await rows(`INSERT INTO notification_preference (tenant_id, participant_id, topic, email, updated_by) VALUES ($1, $2, 'statement', false, $3)`,
      [tenant.id, other.participantId, other.userId], other.ctx)
    await rows(`SELECT notify_participant($1, 'statement.ready', '{}'), notify_participant($1, 'bank_detail.changed', '{}'),
                       notify_participant($1, 'payout.sent', '{}')`, [other.participantId])

    expect(await ofRecipient(other.participantId, 'statement.ready')).toEqual([{ channel: 'in_app', state: 'delivered', mandatory: false }])
    expect(await ofRecipient(other.participantId, 'bank_detail.changed')).toEqual([
      { channel: 'email', state: 'queued', mandatory: true }, { channel: 'in_app', state: 'delivered', mandatory: true },
    ])
    expect(await ofRecipient(other.participantId, 'payout.sent')).toHaveLength(2)
    await expect(rows(`SELECT notify_participant($1, 'made.up', '{}')`, [other.participantId])).rejects.toMatchObject(INVALID)
    await expect(rows(`INSERT INTO notification_preference (tenant_id, participant_id, topic, email) VALUES ($1, $2, 'security', false)`,
      [tenant.id, other.participantId])).rejects.toMatchObject(CHECK)
  })

  test('delivery fields change only while queued; an in-app row is read once; nothing is deleted', async () => {
    const [email] = await owner<{ id: string }>(`SELECT id FROM notification WHERE recipient_participant_id = $1 AND channel = 'email' LIMIT 1`, [other.participantId])
    const [inApp] = await owner<{ id: string }>(`SELECT id FROM notification WHERE recipient_participant_id = $1 AND channel = 'in_app' LIMIT 1`, [other.participantId])

    await rows(`UPDATE notification SET attempts = 1, next_attempt_at = now() + interval '1 minute', last_error = 'x' WHERE id = $1`, [email!.id])
    await rows(`UPDATE notification SET state = 'sent', sent_at = now() WHERE id = $1`, [email!.id])
    await expect(rows(`UPDATE notification SET state = 'queued' WHERE id = $1`, [email!.id])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE notification SET read_at = now() WHERE id = $1`, [email!.id])).rejects.toMatchObject(CHECK)
    await rows('UPDATE notification SET read_at = now() WHERE id = $1', [inApp!.id], other.ctx)
    await expect(rows(`UPDATE notification SET read_at = now() + interval '1 second' WHERE id = $1`, [inApp!.id])).rejects.toMatchObject(CHECK)
    await expect(owner('DELETE FROM notification WHERE id = $1', [inApp!.id])).rejects.toThrow(/not allowed/)
  })

  const dist = async () => (await withSystem((tx) => tx.query('SELECT notification_id FROM dist_due_notifications(10)'))).rows

  test('dist_due_notifications lists due queued email rows (system realm only)', async () => {
    await rows(`SELECT notify_participant($1, 'tax_profile.changed', '{}')`, [other.participantId])
    const [queued] = await owner<{ id: string }>(`SELECT id FROM notification WHERE template = 'tax_profile.changed' AND channel = 'email'`)

    expect(await dist()).toContainEqual({ notification_id: queued!.id })
    await expect(rows('SELECT * FROM dist_due_notifications(10)')).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('notify_run_statements and notify_batch: per payee, codes only for held payees', async () => {
    const [batch] = await owner<{ provider_config_id: string; period_id: string; approval_id: string }>(
      'SELECT provider_config_id, period_id, approval_id FROM payout_batch WHERE id = $1', [seed.payoutBatchId])
    const exclusions = [{ participant_id: other.participantId, reasons: [
      { reason: 'below_minimum', detail: { minimum_minor: '500' } },
      { reason: 'hold', detail: { hold_id: randomUUID(), reason: 'fraud investigation of the spouse', placed_at: '2026-01-01T00:00:00.000Z' } },
      { reason: 'bank_detail_cooling_off', detail: { until: '2026-12-01T00:00:00.000Z' } },
    ] }]
    const [held] = await owner<{ id: string }>(
      `INSERT INTO payout_batch (tenant_id, market_id, provider_config_id, period_id, state, total_minor, currency, exclusions, prepared_by,
         submitted_by, submitted_at, approval_id, approved_at)
       VALUES ($1, $2, $3, $4, 'approved', 0, 'GBP', $5, $6, $6, now(), $7, now()) RETURNING id`,
      [tenant.id, seed.marketId, batch!.provider_config_id, batch!.period_id, JSON.stringify(exclusions), a.userId, batch!.approval_id],
    )

    expect(await value('SELECT notify_run_statements($1)', [seed.runId])).toBe(1)
    expect(await value('SELECT notify_batch($1)', [seed.payoutBatchId])).toBe(1)
    expect(await value('SELECT notify_batch($1)', [held!.id])).toBe(1)
    expect(await owner(`SELECT params FROM notification WHERE template = 'payout.held' AND channel = 'in_app'`)).toEqual([{ params: {
      batch_id: held!.id, amount_minor: '0', currency: 'GBP', minor_unit: 2, until: '2026-12-01T00:00:00.000Z',
      reasons: [{ reason: 'hold' }, { reason: 'bank_detail_cooling_off', until: '2026-12-01T00:00:00.000Z' }],
    } }])
    expect(await owner(`SELECT params ->> 'masked' AS masked FROM notification WHERE template = 'payout.sent' AND recipient_participant_id = $1`,
      [seed.participantId])).toEqual([{ masked: '•••• 3000' }])
    await expect(rows('SELECT notify_plan_change($1)', [seed.planVersionId])).rejects.toMatchObject(INVALID) // a draft version
  })
})

describe('payee self-service (D-B5-07, D-B5-12, T-B5-22)', () => {
  test('a portal session writes its own version from its own request; staff cannot write a self version', async () => {
    const fingerprint = randomBytes(32)
    const request = (ctx: TenantContext) => withTenant(ctx, (tx) => insertRow(tx, 'bank_detail_request', {
      tenant_id: tenant.id, participant_id: other.participantId, scheme: 'iban', details_sealed: 'sealed', fingerprint, masked: '•••• 4000',
      created_by: ctx.userId,
    }))
    const version = (ctx: TenantContext, requestId: string, masked = '•••• 4000', until = new Date(Date.now() + 2 * HOUR)) =>
      withTenant(ctx, (tx) => insertRow(tx, 'bank_detail_version', {
        tenant_id: tenant.id, participant_id: other.participantId, scheme: 'iban', details_sealed: 'sealed', fingerprint, masked,
        created_via: 'self', request_id: requestId, cooling_off_until: until,
      }))
    const requestId = await request(other.ctx)

    await expect(version(other.ctx, requestId)).rejects.toMatchObject(NOT_ALLOWED) // no cooling-off configured
    await setSetting('payouts.bank_detail_cooling_off_hours', 1)
    await expect(version(other.ctx, requestId, '•••• 4000', new Date(Date.now() - DAY))).rejects.toMatchObject(NOT_ALLOWED)
    await expect(version(other.ctx, requestId, '•••• 4000', new Date(Date.now() + HOUR / 2))).rejects.toMatchObject(NOT_ALLOWED)
    await expect(version(a, requestId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(version(other.ctx, requestId, '•••• 9999')).rejects.toMatchObject(NOT_ALLOWED)
    await version(other.ctx, requestId)
    // The seed participant (portal) sees no other payee, yet the definer count sees other's current version.
    const count = (ctx: TenantContext) => value<number>('SELECT pay_shared_fingerprint_count($1, $2)', [ctx.participantId, fingerprint], ctx)
    expect(await value<number>('SELECT count(*)::int FROM bank_detail_version WHERE fingerprint = $1', [fingerprint], portal)).toBe(0)
    expect(await count(portal)).toBe(1)
    expect(await count(other.ctx)).toBe(0)
    await expect(value('SELECT pay_shared_fingerprint_count($1, $2)', [other.participantId, fingerprint], portal)).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('a shared account changes only through its review, opened by the system for the payees own request (D-B5-12)', async () => {
    const shared = await participantWithPortal('shared-1')
    const [current] = await owner<{ fingerprint: Buffer }>(
      'SELECT fingerprint FROM bank_detail_version WHERE participant_id = $1 AND superseded_at IS NULL', [other.participantId])
    const fingerprint = current!.fingerprint
    const account = { tenant_id: tenant.id, participant_id: shared.participantId, scheme: 'iban', details_sealed: 'sealed', fingerprint, masked: '•••• 4000' }
    const request = () => withTenant(shared.ctx, (tx) => insertRow(tx, 'bank_detail_request', { ...account, created_by: shared.userId }))
    const version = (requestId: string) => withTenant(shared.ctx, (tx) => insertRow(tx, 'bank_detail_version', {
      ...account, created_via: 'self', request_id: requestId, cooling_off_until: new Date(Date.now() + 2 * HOUR),
    }))
    const review = (ctx: TenantContext, requestId: string, overrides: Record<string, unknown> = {}) => withTenant(ctx, (tx) => insertRow(tx, 'case_file', {
      tenant_id: tenant.id, type: 'bank_detail', subject_type: 'participant', subject_id: shared.participantId, reason_code: 'SHARED_ACCOUNT',
      state: 'open', market_id: seed.marketId, payload: { request_id: requestId, participant_id: shared.participantId }, opened_by_kind: 'system',
      ...overrides,
    }))
    const reviewed = await request()

    await expect(review(a, reviewed)).rejects.toMatchObject(NOT_ALLOWED) // staff open bank_detail cases as users
    await expect(review(shared.ctx, reviewed, { reason_code: 'PAYEE_REQUEST' })).rejects.toMatchObject(NOT_ALLOWED)
    await expect(review(other.ctx, reviewed, { subject_id: other.participantId, payload: { request_id: reviewed, participant_id: other.participantId } }))
      .rejects.toMatchObject(NOT_ALLOWED) // another payee's request
    await review(shared.ctx, reviewed)
    await expect(version(reviewed)).rejects.toMatchObject(NOT_ALLOWED) // its request is under review
    await setSetting('payouts.shared_account_threshold', 1)
    await expect(version(await request())).rejects.toMatchObject(NOT_ALLOWED) // other holds the account: the review is due
    const count = (participant: string) => (tx: Tx) => tx.query('SELECT pay_shared_fingerprint_count($1, $2)', [participant, fingerprint])
    expect(await race(a, count(shared.participantId), count(other.participantId))).toEqual({ waited: true, outcome: { ok: true } })
  })

  test('pay_payee_blockers: the selection reasons of one payee in one market, in their shape', async () => {
    const blockers = (participant: string, ctx = a) => value<{ reason: string; detail: Record<string, unknown> }[]>(
      'SELECT pay_payee_blockers($1, $2)', [participant, seed.marketId], ctx)
    const fresh = await participantWithPortal('blocked-1')
    const [hold] = await owner<{ id: string }>('SELECT id FROM payout_hold WHERE participant_id = $1', [seed.participantId])
    await owner(`INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, opened_by_kind)
                 VALUES ($1, 'duplicate', 'participant', $2, 'MATCH', 'open', '{}', 'system')`, [tenant.id, fresh.participantId])
    await owner(`INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, opened_by_kind)
                 VALUES ($1, 'returned_payment', 'payout_instruction', $2, 'RETURNED', 'open', '{}', 'system')`, [tenant.id, seed.instructionId])

    expect(await blockers(seed.participantId, portal)).toEqual([
      { reason: 'hold', detail: { hold_id: hold!.id, reason: 'seed', placed_at: expect.stringMatching(/Z$/) } },
      { reason: 'returned_payment_open', detail: { case_id: expect.any(String) } },
    ])
    expect((await blockers(fresh.participantId)).map((b) => b.reason)).toEqual(['no_bank_details', 'duplicate_case'])
    expect((await blockers(other.participantId)).map((b) => b.reason)).toEqual(['bank_detail_cooling_off'])
  })
})

describe('privacy (D-B5-16..19)', () => {
  test('a privacy request is created with its own privacy case; its decisions are set once, sealed values only cleared', async () => {
    const id = randomUUID()
    const privacyCase = (tx: Tx, overrides: Record<string, unknown> = {}) => insertRow(tx, 'case_file', {
      tenant_id: tenant.id, type: 'privacy', subject_type: 'privacy_request', subject_id: id, reason_code: 'RECEIVED_BY_STAFF',
      state: 'open', payload: { request_id: id }, opened_by_kind: 'system', ...overrides,
    })
    const insert = (ctx: TenantContext, values: Record<string, unknown>) => withTenant(ctx, async (tx) => insertRow(tx, 'privacy_request', {
      id, tenant_id: tenant.id, case_id: await privacyCase(tx), type: 'correction', ...values,
    }))

    await expect(withTenant(a, (tx) => privacyCase(tx, { reason_code: 'X', opened_by_kind: 'user', opened_by: a.userId })))
      .rejects.toMatchObject(CHECK) // privacy is system-opened only
    await expect(withTenant(a, (tx) => privacyCase(tx, { subject_type: 'participant', subject_id: other.participantId })))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(withTenant(a, (tx) => privacyCase(tx))).rejects.toMatchObject(CHECK) // no privacy request at COMMIT
    await expect(insert(a, { channel: 'portal', requester_user_id: other.userId })).rejects.toMatchObject(NOT_ALLOWED)
    await insert(a, { channel: 'public_form', requester_sealed: 'sealed' })
    await rows(`UPDATE privacy_request SET corrections_sealed = 'one', verified_at = now(), verified_by = $2, verification_method = 'document',
                  subject_participant_id = $3 WHERE id = $1`, [id, a.userId, other.participantId])
    await rows(`UPDATE privacy_request SET corrections_sealed = 'two' WHERE id = $1`, [id])
    await expect(rows(`UPDATE privacy_request SET subject_participant_id = $2 WHERE id = $1`, [id, seed.participantId])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE privacy_request SET requester_sealed = 'other' WHERE id = $1`, [id])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE privacy_request SET verified_by = $2 WHERE id = $1`, [id, secondUserId])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE privacy_request SET requester_sealed = NULL WHERE id = $1`, [id])
  })

  test('a portal request is the session participants own, verified by the session', async () => {
    const id = randomUUID()
    const insert = (subject: string) => withTenant(other.ctx, async (tx) => insertRow(tx, 'privacy_request', {
      id, tenant_id: tenant.id, type: 'access', channel: 'portal', subject_participant_id: subject,
      requester_user_id: other.userId, verified_at: new Date(), verification_method: 'portal_session',
      case_id: await insertRow(tx, 'case_file', {
        tenant_id: tenant.id, type: 'privacy', subject_type: 'privacy_request', subject_id: id, reason_code: 'PORTAL_REQUEST',
        state: 'open', payload: { request_id: id, participant_id: other.participantId }, opened_by_kind: 'system',
      }),
    }))

    await expect(insert(seed.participantId)).rejects.toMatchObject(NOT_ALLOWED)
    expect(await insert(other.participantId)).toBe(id)
  })

  test('an export is written for an approved access request, hashed on insert, never updated', async () => {
    const request = await approvedRequest('access', other.participantId)
    const exportId = await withTenant(a, (tx) => insertRow(tx, 'privacy_export', {
      tenant_id: tenant.id, request_id: request.id, content: Buffer.from('{}'), content_sha256: randomBytes(32),
    }))

    expect(await owner(`SELECT content_sha256 = digest(content, 'sha256') AS hashed FROM privacy_export WHERE id = $1`, [exportId]))
      .toEqual([{ hashed: true }])
    await expect(owner(`UPDATE privacy_export SET content = '\\x00' WHERE id = $1`, [exportId])).rejects.toThrow(/not allowed/)
    await expect(rows('DELETE FROM privacy_export WHERE id = $1', [exportId])).rejects.toThrow(PERMISSION_DENIED)
  })

  test('the personal-data map covers every key to participant and user_account, and the export has each section (T-B5-35)', async () => {
    const keys = await owner<{ table_name: string; column_name: string }>(
      `SELECT DISTINCT replace(k.conrelid::regclass::text, '"', '') AS table_name, a.attname::text AS column_name
       FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
       WHERE k.contype = 'f' AND k.confrelid IN ('participant'::regclass, 'user_account'::regclass)
         AND a.attname NOT IN ('tenant_id', 'realm')
       ORDER BY 1, 2`,
    )
    const map = await owner<{ table_name: string; column_name: string; section: string | null; reason: string | null }>(
      'SELECT * FROM prv_personal_data_map() ORDER BY 1, 2')
    const exported = await value<Record<string, unknown>>('SELECT prv_personal_data($1)', [seed.participantId])

    // Beyond the keys, the columns holding personal data or participant lists (PLAN B-MKT 1.3, V1-A 1.7), the key-writable
    // actor without a key (V1-A 1.1) and the offboarding users kept past the tenant's purge (0807).
    const NON_KEYS = ['credit_redemption.created_by', 'legal_hold.reason', 'participant.account_holders', 'retention_run.items',
      'tax_form_generation.held', 'tenant_offboarding.closed_by', 'tenant_offboarding.confirmed_by']
    const lists = map.filter((row) => NON_KEYS.includes(`${row.table_name}.${row.column_name}`))
    expect(lists.map((row) => `${row.table_name}.${row.column_name}`)).toEqual(NON_KEYS)
    expect(map.filter((row) => !lists.includes(row)).map(({ table_name, column_name }) => ({ table_name, column_name }))).toEqual(keys)
    expect(map.filter((row) => (row.section === null) === (row.reason === null))).toEqual([])
    expect(Object.keys(exported).sort()).toEqual([...new Set(map.flatMap((row) => row.section ?? []))].sort())
    expect(exported).toMatchObject({
      participant: { id: seed.participantId, external_ref: 'seed-distributor' },
      statements: [{ run_id: seed.runId, net_payable_minor: '100' }],
      portal_accounts: [{ sign_in_codes: [expect.any(Object)], sign_in_attempts: [] }],
    })
    await expect(value('SELECT prv_personal_data($1)', [seed.participantId], other.ctx)).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('erasure is deferred by a payout in flight, a hold and an open dispute (PV001)', async () => {
    const request = await approvedRequest('erasure', seed.participantId)
    const erase = rows('SELECT prv_erase_participant($1)', [request.id])

    await expect(erase).rejects.toMatchObject({ code: 'PV001' })
    const blockers = await value<{ reason: string }[]>('SELECT prv_erasure_blockers($1)', [seed.participantId])
    expect(blockers.map((b) => b.reason)).toEqual(['payout_in_flight', 'payout_hold', 'open_case'])
  })

  test('erasure is deferred by a run not yet committed that holds lines of the subject', async () => {
    const subject = await participantWithPortal('erase-2')
    const [run] = await owner<{ id: string }>(
      `INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, engine_version, prepared_by)
       SELECT tenant_id, period_id, 'b5-open-run', plan_version_id, settings_version_id, engine_version, prepared_by FROM run WHERE id = $1
       RETURNING id`, [seed.runId])
    await owner(`UPDATE run SET state = 'running', snapshot_id = (SELECT snapshot_id FROM run WHERE id = $2), started_at = now() WHERE id = $1`,
      [run!.id, seed.runId])
    await owner(`INSERT INTO result_line (tenant_id, run_id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass,
                   amount_minor, currency, trace) VALUES ($1, $2, $3, $4, 'pv', 'pay.flat', 'other', 4, 100, 'GBP', '{}')`,
      [tenant.id, run!.id, seed.positionId, subject.participantId])
    const request = await approvedRequest('erasure', subject.participantId)

    await expect(rows('SELECT prv_erase_participant($1)', [request.id])).rejects.toMatchObject({ code: 'PV001' })
    expect(await value('SELECT prv_erasure_blockers($1)', [subject.participantId])).toEqual([{ reason: 'open_run', run_id: run!.id }])
  })

  test('erasure pseudonymises the subject and clears its identity data; ledger and lines stay (T-B5-38)', async () => {
    const subject = await participantWithPortal('erase-1')
    const key = `portal:acme:${subject.email}`
    await owner(`INSERT INTO password_credential (user_id, password_hash) VALUES ($1, 'h')`, [subject.userId])
    await owner(`INSERT INTO mfa_credential (user_id, type, secret_encrypted) VALUES ($1, 'totp', 's')`, [subject.userId])
    await owner(`INSERT INTO portal_sign_in_code (tenant_id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [tenant.id, subject.userId, randomBytes(32)])
    await owner(`INSERT INTO user_invitation (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [tenant.id, subject.userId, randomBytes(32)])
    await owner(`INSERT INTO login_attempt (account_key, succeeded) VALUES ($1, false), ('portal:acme:someone@example.test', false)`, [key])
    await owner(`INSERT INTO participant_signal (tenant_id, participant_id, kind, digest, created_by) VALUES ($1, $2, 'identity_ref', $3, $4)`,
      [tenant.id, subject.participantId, randomBytes(32), a.userId])
    const [bankRequest] = await owner<{ id: string }>(
      `INSERT INTO bank_detail_request (tenant_id, participant_id, scheme, details_sealed, contact_email_sealed, fingerprint, masked, created_by)
       VALUES ($1, $2, 'iban', 'sealed', 'sealed-mail', $3, '•••• 5000', $4) RETURNING id`, [tenant.id, subject.participantId, randomBytes(32), a.userId])
    await owner(`INSERT INTO bank_detail_version (tenant_id, participant_id, scheme, details_sealed, fingerprint, masked, created_via, cooling_off_until)
                 VALUES ($1, $2, 'iban', 'sealed', $3, '•••• 5000', 'migration', now())`, [tenant.id, subject.participantId, randomBytes(32)])
    await owner(`INSERT INTO tax_profile (tenant_id, participant_id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, created_by)
                 VALUES ($1, $2, 'GB', 'individual', 'sealed', '•••• 6789', now(), $3)`, [tenant.id, subject.participantId, a.userId])
    await rows(`SELECT notify_participant($1, 'bank_detail.changed', '{"masked": "•••• 3000", "previous_masked": "•••• 5432"}'), notify_participant($1, 'payout.sent', '{"masked": "•••• 5000"}')`,
      [subject.participantId])
    await owner(`INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, expires_at, ip, user_agent)
                 VALUES ($1, $2, $3, 'portal', 'aal1', now() + interval '1 hour', '192.0.2.1', 'agent')`, [randomBytes(32), subject.userId, tenant.id])
    const access = await approvedRequest('access', subject.participantId, 'sealed-requester')
    await owner('INSERT INTO privacy_export (tenant_id, request_id, content) VALUES ($1, $2, $3)', [tenant.id, access.id, randomBytes(8)])
    const request = await approvedRequest('erasure', subject.participantId, 'kept', { retention_basis: 'Ledger: 10 years' })
    await owner(`UPDATE user_account SET locale = 'de' WHERE id = $1`, [subject.userId])

    const result = await value<{ cleared: string[]; retained: string[] }>('SELECT prv_erase_participant($1)', [request.id])

    expect(result.cleared).toEqual(expect.arrayContaining(['participant.contact', 'user_account.locale']))
    expect(await owner('SELECT locale FROM user_account WHERE id = $1', [subject.userId])).toEqual([{ locale: null }])
    expect(await owner('SELECT display_name, contact, pseudonymised_at IS NOT NULL AS done FROM participant WHERE id = $1', [subject.participantId]))
      .toEqual([{ display_name: null, contact: null, done: true }])
    expect(await owner('SELECT email, idp_subject, state FROM user_account WHERE id = $1', [subject.userId])).toEqual([
      { email: `erased+${subject.userId}@erased.invalid`, idp_subject: `erased:${subject.userId}`, state: 'deactivated' },
    ])
    const remaining = await owner<{ n: number }>(
      `SELECT (SELECT count(*) FROM password_credential WHERE user_id = $1) + (SELECT count(*) FROM mfa_credential WHERE user_id = $1)
            + (SELECT count(*) FROM portal_sign_in_code WHERE user_id = $1) + (SELECT count(*) FROM login_attempt WHERE account_key = $3)
            + (SELECT count(*) FROM participant_signal WHERE participant_id = $2)
            + (SELECT count(*) FROM user_invitation WHERE user_id = $1 AND revoked_at IS NULL)
            + (SELECT count(*) FROM privacy_export WHERE request_id = $4) AS n`, [subject.userId, subject.participantId, key, access.id])
    expect(remaining).toEqual([{ n: '0' }])
    expect(await owner(`SELECT count(*)::int AS n FROM login_attempt WHERE account_key = 'portal:acme:someone@example.test'`)).toEqual([{ n: 1 }])
    expect(await owner('SELECT details_sealed, contact_email_sealed, masked FROM bank_detail_request WHERE id = $1', [bankRequest!.id]))
      .toEqual([{ details_sealed: null, contact_email_sealed: null, masked: 'erased' }])
    expect(await owner('SELECT tax_id_sealed, tax_id_masked, residency FROM tax_profile WHERE participant_id = $1', [subject.participantId]))
      .toEqual([{ tax_id_sealed: null, tax_id_masked: null, residency: 'GB' }])
    expect(await owner(`SELECT channel, state FROM notification WHERE recipient_participant_id = $1 AND template = 'bank_detail.changed' ORDER BY channel`,
      [subject.participantId])).toEqual([{ channel: 'email', state: 'suppressed' }, { channel: 'in_app', state: 'delivered' }])
    expect(await owner(`SELECT DISTINCT params ->> 'masked' AS masked, params ->> 'previous_masked' AS previous FROM notification
                        WHERE recipient_participant_id = $1 AND template = 'bank_detail.changed'`, [subject.participantId]))
      .toEqual([{ masked: 'erased', previous: 'erased' }])
    expect(await owner(`SELECT DISTINCT params ->> 'masked' AS masked FROM notification WHERE recipient_participant_id = $1 AND template = 'payout.sent'`,
      [subject.participantId])).toEqual([{ masked: 'erased' }])
    expect(await owner('SELECT ip, user_agent FROM session WHERE user_id = $1', [subject.userId])).toEqual([{ ip: null, user_agent: null }])
    expect(await owner('SELECT id, requester_sealed, outcome, retention_basis FROM privacy_request WHERE subject_participant_id = $1 ORDER BY received_at',
      [subject.participantId])).toEqual([
      { id: access.id, requester_sealed: null, outcome: null, retention_basis: null },
      { id: request.id, requester_sealed: 'kept', outcome: 'fulfilled', retention_basis: 'Ledger: 10 years' },
    ])
    expect(await rows(`SELECT notify_participant($1, 'tax_profile.changed', '{}') AS id`, [subject.participantId])).toEqual([{ id: null }])
  })

  test('every guard erasure passes still refuses the runtime role, and the owner beyond the erasure change (T-B5-38)', async () => {
    const [erased] = await owner<{ id: string }>(`SELECT id FROM participant WHERE external_ref = 'erase-1'`)
    const id = erased!.id

    await expect(rows('UPDATE participant SET display_name = $2 WHERE id = $1', [other.participantId, 'x'])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('DELETE FROM participant_signal WHERE participant_id = $1', [seed.participantId])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('UPDATE tax_profile SET tax_id_sealed = NULL WHERE participant_id = $1', [seed.participantId])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows(`UPDATE bank_detail_version SET details_sealed = NULL, masked = 'erased' WHERE participant_id = $1`, [seed.participantId]))
      .rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('DELETE FROM password_credential WHERE user_id = $1', [other.userId])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('DELETE FROM login_attempt')).rejects.toThrow(PERMISSION_DENIED)
    await expect(owner(`UPDATE participant SET display_name = 'back' WHERE id = $1`, [id])).rejects.toMatchObject(CHECK)
    // D-B5-05: the erased (deactivated) account stays closed; a portal email changes only by erasure; Firebase links once.
    const [account] = await owner<{ id: string }>('SELECT id FROM user_account WHERE participant_id = $1', [id])
    await expect(rows(`UPDATE user_account SET state = 'active', email = 'new-owner@example.test' WHERE id = $1`, [account!.id])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE user_account SET state = 'active' WHERE id = $1`, [account!.id])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE user_account SET email = 'moved@example.test' WHERE id = $1`, [other.userId])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE user_account SET firebase_subject = 'firebase-1' WHERE id = $1`, [other.userId])
    await expect(rows(`UPDATE user_account SET firebase_subject = 'firebase-2' WHERE id = $1`, [other.userId])).rejects.toMatchObject(CHECK)
    await expect(owner(`UPDATE bank_detail_request SET scheme = 'local' WHERE participant_id = $1`, [id])).rejects.toMatchObject(CHECK)
    await expect(owner(`UPDATE tax_profile SET residency = 'FR' WHERE participant_id = $1`, [id])).rejects.toMatchObject(CHECK)
    await expect(owner(`UPDATE participant_signal SET kind = 'address' WHERE participant_id = $1`, [seed.participantId])).rejects.toThrow(/not allowed/)
  })

  test('a correction applies exactly the requests fields and clears the sealed values (D-B5-19)', async () => {
    const request = await approvedRequest('correction', other.participantId, null, { corrections: ['contact.email', 'display_name'] })
    const correct = (name: string | null, contact: object | null) =>
      rows('SELECT prv_correct_participant($1, $2, $3) AS r', [request.id, name, contact === null ? null : JSON.stringify(contact)])

    await expect(correct('New Name', null)).rejects.toMatchObject(INVALID)
    await expect(correct('New Name', { email: 'new@example.test', fax: '1' })).rejects.toMatchObject(INVALID)
    expect(await correct('New Name', { email: 'new@example.test' })).toEqual([{ r: { fields: ['contact.email', 'display_name'] } }])
    expect(await owner('SELECT display_name, contact FROM participant WHERE id = $1', [other.participantId])).toEqual([
      { display_name: 'New Name', contact: { email: 'new@example.test', phone: '+44 20 0000 0000' } },
    ])
    await expect(withTenant(other.ctx, (tx: Tx) => tx.query('SELECT prv_correct_participant($1, $2, NULL)', [request.id, 'x'])))
      .rejects.toMatchObject(NOT_ALLOWED)
  })

  test('privacy_deadline_lookup runs in the system realm only and needs a privacy policy', async () => {
    expect((await withSystem((tx) => tx.query('SELECT * FROM privacy_deadline_lookup(10)'))).rows).toEqual([])
    await expect(rows('SELECT * FROM privacy_deadline_lookup(10)')).rejects.toMatchObject(NOT_ALLOWED)
  })
})
