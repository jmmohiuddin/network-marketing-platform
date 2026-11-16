// Behaviour of the B1 guards (PLAN B1 section 1, migrations 0100-0107) as the runtime role nmp_app.
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { getPool, withSystem, withTenant, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertEvidence, insertMarket, insertOutboxEvent, insertRow, PERMISSION_DENIED } from './support.js'

const NOT_ALLOWED = { code: '42501' }
const CHECK = { code: '23514' }
const NO_DOCUMENT = { code: 'P0002' }

// a requests and prepares, b decides; c is a third user of the same tenant.
let a: TenantContext
let b: TenantContext
let c: TenantContext

closePoolsAfterAll()

beforeEach(async () => {
  await resetTestDb()
  const tenantId = (await createTenant()).id
  const ctx = async (): Promise<TenantContext> => ({ tenantId, userId: (await createUser({ tenantId })).id })
  ;[a, b, c] = [await ctx(), await ctx(), await ctx()]
})

const as = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant(ctx, fn)
const update = (ctx: TenantContext, sql: string, params: unknown[] = []) => as(ctx, (tx) => tx.query(sql, params))

/** An approval by approver (the transaction's acting user) of an object prepared by a, or by b when a approves. */
function approve(tx: Tx, approver: TenantContext, objectType: string, objectId: string, decision = 'approved') {
  return insertRow(tx, 'approval', {
    tenant_id: approver.tenantId, object_type: objectType, object_id: objectId,
    preparer_id: approver === a ? b.userId : a.userId,
    approver_id: approver.userId, decision, decided_at: new Date(),
  })
}

function goLiveRequest(marketId: string, overrides: Record<string, unknown> = {}) {
  return as(a, (tx) =>
    insertRow(tx, 'market_go_live_request', {
      tenant_id: a.tenantId, market_id: marketId, state: 'pending', requested_by: a.userId, checklist: {}, ...overrides,
    }),
  )
}

/** b decides the request with an approval of the given object (by default: this request, the same decision). */
function decideGoLive(requestId: string, decision: 'approved' | 'rejected', approvalOf = { type: 'market_go_live_request', id: requestId, decision }) {
  return as(b, async (tx) => {
    const approvalId = await approve(tx, b, approvalOf.type, approvalOf.id, approvalOf.decision)
    await tx.query(
      `UPDATE market_go_live_request SET state = $2, decided_by = $3, decided_at = now(), approval_id = $4 WHERE id = $1`,
      [requestId, decision, b.userId, approvalId],
    )
  })
}

describe('approval (FR-IAM-004)', () => {
  test('is given by the acting user only', async () => {
    await expect(as(a, (tx) => approve(tx, b, 'case', randomUUID()))).rejects.toMatchObject(NOT_ALLOWED)
    expect(await as(b, (tx) => approve(tx, b, 'case', randomUUID()))).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('market launch (AC-TEN4-4, D-B1-17)', () => {
  test('a market is created draft and goes live only through its own approved request', async () => {
    const marketId = await as(a, (tx) => insertMarket(tx, a.tenantId))
    const live = () => update(b, `UPDATE market SET state = 'live' WHERE id = $1`, [marketId])
    const requestId = await goLiveRequest(marketId)

    await expect(live()).rejects.toMatchObject(NOT_ALLOWED)
    await expect(decideGoLive(requestId, 'approved', { type: 'unrelated', id: requestId, decision: 'approved' }))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(decideGoLive(requestId, 'approved', { type: 'market_go_live_request', id: requestId, decision: 'rejected' }))
      .rejects.toMatchObject(NOT_ALLOWED)
    await decideGoLive(requestId, 'approved')
    expect((await live()).rowCount).toBe(1)
    await expect(update(a, `UPDATE market SET state = 'suspended' WHERE id = $1`, [marketId])).rejects.toMatchObject(NOT_ALLOWED)
    await expect(update(a, 'DELETE FROM market WHERE id = $1', [marketId])).rejects.toMatchObject(CHECK)
  })

  test('the runtime role cannot insert a market live or a request already decided or in another name', async () => {
    const marketId = await as(a, (tx) => insertMarket(tx, a.tenantId))
    const approvalId = await as(b, (tx) => approve(tx, b, 'unrelated', randomUUID()))

    await expect(as(a, (tx) => insertRow(tx, 'market', {
      tenant_id: a.tenantId, code: 'IE', currency: 'EUR', minor_unit: 2, time_zone: 'Europe/Dublin', languages: ['en'],
      market_pack: 'ie-1', state: 'live',
    }))).rejects.toMatchObject(NOT_ALLOWED)
    await expect(goLiveRequest(marketId, { state: 'approved', decided_by: b.userId, decided_at: new Date(), approval_id: approvalId }))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(goLiveRequest(marketId, { requested_by: c.userId })).rejects.toMatchObject(NOT_ALLOWED)
    expect((await update(a, 'DELETE FROM market WHERE id = $1', [marketId])).rowCount).toBe(1)
  })

  test('a request is decided once, as the acting user, and withdrawn by its requester with a reason', async () => {
    const marketId = await as(a, (tx) => insertMarket(tx, a.tenantId))
    const requestId = await goLiveRequest(marketId)
    const withdraw = (ctx: TenantContext, reason: string | null) =>
      update(ctx, `UPDATE market_go_live_request SET state = 'withdrawn', decided_at = now(), decision_reason = $2 WHERE id = $1`,
        [requestId, reason])

    await expect(as(c, async (tx) => {
      const approvalId = await approve(tx, c, 'market_go_live_request', requestId)
      await tx.query(`UPDATE market_go_live_request SET state = 'approved', decided_by = $2, decided_at = now(),
        approval_id = $3 WHERE id = $1`, [requestId, b.userId, approvalId])
    })).rejects.toMatchObject(NOT_ALLOWED)
    await expect(withdraw(a, null)).rejects.toMatchObject(CHECK)
    await expect(withdraw(c, 'not mine')).rejects.toMatchObject(NOT_ALLOWED)
    await withdraw(a, 'not needed')
    await expect(decideGoLive(requestId, 'rejected')).rejects.toMatchObject(CHECK)
    await expect(update(a, 'DELETE FROM market_go_live_request')).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('evidence documents (D-B1-04)', () => {
  test('are never changed, so nobody takes over or swaps a document', async () => {
    const documentId = await as(b, (tx) => insertEvidence(tx, b.tenantId, b.userId))
    const marketId = await as(a, (tx) => insertMarket(tx, a.tenantId))
    const reference = () => as(a, (tx) => insertRow(tx, 'market_checklist_entry', {
      tenant_id: a.tenantId, market_id: marketId, item: 'licence_evidence', document_id: documentId, recorded_by: a.userId,
    }))

    await expect(reference()).rejects.toMatchObject(NO_DOCUMENT)
    await expect(update(a, 'UPDATE document SET uploaded_by = $1', [a.userId])).rejects.toThrow(PERMISSION_DENIED)
    await expect(getOwnerPool().query(`UPDATE document SET storage_key = 'other'`)).rejects.toThrow(/a document never changes/)
    await expect(reference()).rejects.toMatchObject(NO_DOCUMENT)
  })

  test('are referenced once, by their uploader, as evidence only', async () => {
    const marketId = await as(a, (tx) => insertMarket(tx, a.tenantId))
    const entry = (documentId: string) => as(a, (tx) => insertRow(tx, 'market_checklist_entry', {
      tenant_id: a.tenantId, market_id: marketId, item: 'licence_evidence', document_id: documentId, recorded_by: a.userId,
    }))
    const evidence = await as(a, (tx) => insertEvidence(tx, a.tenantId, a.userId))
    const agreement = await as(a, (tx) => insertRow(tx, 'document', {
      tenant_id: a.tenantId, class: 'agreement', storage_key: 'k', sha256: randomBytes(32), mime: 'application/pdf',
      size_bytes: 1, uploaded_by: a.userId, version: 1,
    }))

    await entry(evidence)
    await expect(entry(evidence)).rejects.toMatchObject(NO_DOCUMENT)
    await expect(entry(agreement)).rejects.toMatchObject(NO_DOCUMENT)
    await expect(entry(randomUUID())).rejects.toMatchObject(NO_DOCUMENT)
  })

  test('two concurrent references of one document: the second waits and is refused', async () => {
    const marketId = await as(a, (tx) => insertMarket(tx, a.tenantId))
    const documentId = await as(a, (tx) => insertEvidence(tx, a.tenantId, a.userId))
    const [first, second] = [await getPool().connect(), await getPool().connect()]
    const reference = (tx: Tx) => insertRow(tx, 'market_checklist_entry', {
      tenant_id: a.tenantId, market_id: marketId, item: 'licence_evidence', document_id: documentId, recorded_by: a.userId,
    })
    try {
      for (const tx of [first, second]) {
        await tx.query('BEGIN')
        await tx.query(
          `SELECT set_config('app.realm', 'tenant', true), set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
          [a.tenantId, a.userId],
        )
      }
      await reference(first)
      const waiting = reference(second).then(() => 'referenced', (error: { code?: string }) => error.code)
      await waitForBlockedAdvisoryLock()
      await first.query('COMMIT')

      expect(await waiting).toBe('P0002')
    } finally {
      await first.query('ROLLBACK')
      await second.query('ROLLBACK')
      first.release()
      second.release()
    }
  })
})

async function waitForBlockedAdvisoryLock(): Promise<void> {
  for (;;) {
    const { rows } = await getOwnerPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
    )
    if (rows[0]!.n > 0) return
  }
}

describe('money-affecting settings (D-B1-01 backstop)', () => {
  let version = 0
  beforeEach(() => {
    version = 0
  })

  const insertVersion = (tx: Tx, effectiveFrom: string, settings: object, approvalId: string | null = null) =>
    insertRow(tx, 'tenant_setting_version', {
      tenant_id: a.tenantId, version: ++version, effective_from: effectiveFrom, settings, reason: 'test',
      created_by: a.userId, approval_id: approvalId,
    })

  const request = (key: string, value: string, effectiveFrom: string) => as(a, (tx) => insertRow(tx, 'setting_change_request', {
    tenant_id: a.tenantId, key, value: JSON.stringify(value), effective_from: effectiveFrom, reason: 'test',
    base_version: version, state: 'pending', requested_by: a.userId,
  }))
  const markApproved = (tx: Tx, requestId: string, approvalId: string, versionId: string) =>
    tx.query(`UPDATE setting_change_request SET state = 'approved', decided_by = $2, decided_at = now(), approval_id = $3,
      version_id = $4 WHERE id = $1`, [requestId, b.userId, approvalId, versionId])

  /**
   * a requests key = value at effectiveFrom; b approves it and appends settings with that approval, then the rebased
   * later rows (D-B1-01: [effective_from, settings], carrying no approval) in the same transaction.
   */
  async function approvedChange(key: string, value: string, effectiveFrom: string, settings: object,
    rebased: ReadonlyArray<readonly [string, object]> = []) {
    const requestId = await request(key, value, effectiveFrom)
    await as(b, async (tx) => {
      const approvalId = await approve(tx, b, 'setting_change_request', requestId)
      const versionId = await insertVersion(tx, effectiveFrom, settings, approvalId)
      for (const [from, later] of rebased) await insertVersion(tx, from, later)
      await markApproved(tx, requestId, approvalId, versionId)
    })
  }

  test('superseding an approved money row at its date without approval is refused; a rebase row is not', async () => {
    const rounding = (mode: string, plain: number) => ({ 'money.rounding_mode': mode, plain })
    await as(a, (tx) => insertVersion(tx, '2026-10-01T00:00:00Z', {}))
    await approvedChange('money.rounding_mode', 'half_even', '2026-11-01T00:00:00Z', rounding('half_even', 0))

    await expect(as(a, (tx) => insertVersion(tx, '2026-11-01T00:00:00Z', {}))).rejects.toMatchObject(NOT_ALLOWED)
    await expect(as(a, (tx) => insertVersion(tx, '2026-11-01T00:00:00Z', rounding('half_even', 1)))).resolves.toBeDefined()
    await as(a, (tx) => insertVersion(tx, '2027-01-01T00:00:00Z', rounding('half_even', 2)))
    await expect(approvedChange('money.rounding_mode', 'half_up', '2026-12-01T00:00:00Z', rounding('half_up', 1),
      [['2027-01-01T00:00:00Z', rounding('half_up', 2)]])).resolves.toBeUndefined()
  })

  test('an approved request names the version that carries its approval', async () => {
    const otherVersionId = await as(a, (tx) => insertVersion(tx, '2026-10-01T00:00:00Z', {}))
    const requestId = await request('money.rounding_mode', 'half_up', '2026-11-01T00:00:00Z')

    await expect(as(b, async (tx) => {
      const approvalId = await approve(tx, b, 'setting_change_request', requestId)
      await insertVersion(tx, '2026-11-01T00:00:00Z', { 'money.rounding_mode': 'half_up' }, approvalId)
      await markApproved(tx, requestId, approvalId, otherVersionId)
    })).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('a backdated version cannot become the baseline that drops an approved money key', async () => {
    await approvedChange('money.rounding_mode', 'half_up', '2026-11-01T00:00:00Z', { 'money.rounding_mode': 'half_up' })
    await as(a, (tx) => insertVersion(tx, '2026-10-01T00:00:00Z', {}))

    await expect(as(a, (tx) => insertVersion(tx, '2026-12-01T00:00:00Z', {}))).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('an approval decides only its own key and value, and only when its request was approved', async () => {
    await approvedChange('money.rounding_mode', 'half_up', '2026-11-01T00:00:00Z', { 'money.rounding_mode': 'half_up' })
    const { rows } = await getOwnerPool().query<{ approval_id: string }>('SELECT approval_id FROM setting_change_request')
    const reuse = (settings: object) =>
      as(a, (tx) => insertVersion(tx, '2026-11-01T00:00:00Z', settings, rows[0]!.approval_id))

    await expect(reuse({ 'money.rounding_mode': 'half_even' })).rejects.toMatchObject(NOT_ALLOWED)
    await expect(reuse({ 'money.rounding_mode': 'half_up', 'money.clawback_policy': { default: 'order_line' } }))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(as(a, (tx) => insertVersion(tx, '2026-12-01T00:00:00Z', { 'money.rounding_mode': 'half_up', plain: 1 })))
      .resolves.toBeDefined()
    await expect(as(b, async (tx) => {
      const approvalId = await approve(tx, b, 'setting_change_request', randomUUID())
      await insertVersion(tx, '2027-01-01T00:00:00Z', {}, approvalId)
    })).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('a request cannot be created decided', async () => {
    const approvalId = await as(b, (tx) => approve(tx, b, 'setting_change_request', randomUUID()))

    await expect(as(a, (tx) => insertRow(tx, 'setting_change_request', {
      tenant_id: a.tenantId, key: 'money.rounding_mode', value: '"half_up"', effective_from: new Date(), reason: 'x',
      base_version: 0, state: 'approved', requested_by: a.userId, decided_by: b.userId, decided_at: new Date(),
      approval_id: approvalId, version_id: null,
    }))).rejects.toMatchObject(NOT_ALLOWED)
  })
})

describe('cases (FR-CAS-001)', () => {
  const openCase = (overrides: Record<string, unknown> = {}) => as(a, (tx) => insertRow(tx, 'case_file', {
    tenant_id: a.tenantId, type: 'adjustment', subject_type: 'test', subject_id: randomUUID(), reason_code: 'r',
    state: 'open', payload: {}, opened_by: a.userId, ...overrides,
  }))
  const decide = (decider: TenantContext, caseId: string, decision = 'approved') => as(decider, async (tx) => {
    const approvalId = await approve(tx, decider, 'case', caseId, decision)
    await tx.query(`UPDATE case_file SET state = $2, decided_at = now(), approval_id = $3 WHERE id = $1`,
      [caseId, decision, approvalId])
  })

  test('are opened open by the acting user', async () => {
    await expect(openCase({ state: 'approved', approval_id: await as(b, (tx) => approve(tx, b, 'case', randomUUID())) }))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(openCase({ opened_by: b.userId })).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('move open -> submitted -> decided by someone who did not prepare them, then never change', async () => {
    const caseId = await openCase()
    await as(c, async (tx) => {
      const documentId = await insertEvidence(tx, c.tenantId, c.userId)
      await insertRow(tx, 'case_evidence', { tenant_id: c.tenantId, case_id: caseId, document_id: documentId, added_by: c.userId })
    })

    await expect(update(a, `UPDATE case_file SET state = 'approved'`)).rejects.toMatchObject(CHECK)
    await update(a, `UPDATE case_file SET state = 'submitted', submitted_by = $1, submitted_at = now()`, [a.userId])
    await expect(update(b, `UPDATE case_file SET state = 'approved', decided_at = now()`)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(decide(a, caseId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(decide(c, caseId)).rejects.toMatchObject(NOT_ALLOWED)
    await decide(b, caseId, 'rejected')
    await expect(update(a, `UPDATE case_file SET state = 'withdrawn'`)).rejects.toMatchObject(CHECK)
    await expect(update(a, `UPDATE case_file SET subject_type = 'other'`)).rejects.toThrow(PERMISSION_DENIED)
  })

  test('a submission is the acting user\'s, recorded once, and cannot be erased to decide one\'s own case', async () => {
    const [first, second] = [await openCase(), await openCase()]
    const set = (ctx: TenantContext, caseId: string, sets: string, params: unknown[] = []) =>
      update(ctx, `UPDATE case_file SET ${sets} WHERE id = $1`, [caseId, ...params])

    await expect(set(b, first, `state = 'submitted', submitted_by = $2, submitted_at = now()`, [c.userId]))
      .rejects.toMatchObject(NOT_ALLOWED)
    await expect(set(b, first, `state = 'submitted'`)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(set(b, first, `state = 'withdrawn', decided_at = now()`)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(set(a, first, `state = 'withdrawn'`)).rejects.toMatchObject(CHECK)
    await set(a, first, `state = 'withdrawn', decided_at = now()`)

    await set(b, second, `state = 'submitted', submitted_by = $2, submitted_at = now()`, [b.userId])
    await expect(set(b, second, 'submitted_by = $2', [c.userId])).rejects.toMatchObject(CHECK)
    await expect(set(b, second, `payload = '{"changed": true}'`)).rejects.toMatchObject(CHECK)
    await expect(as(b, async (tx) => {
      const approvalId = await approve(tx, b, 'case', second)
      await tx.query(`UPDATE case_file SET state = 'approved', approval_id = $2, decided_at = now(), submitted_by = NULL
        WHERE id = $1`, [second, approvalId])
    })).rejects.toMatchObject(CHECK)
    await expect(as(c, async (tx) => {
      const approvalId = await approve(tx, c, 'case', second)
      await tx.query(`UPDATE case_file SET state = 'approved', approval_id = $2 WHERE id = $1`, [second, approvalId])
    })).rejects.toMatchObject(CHECK)
    await decide(c, second)
  })

  test('evidence and events are the acting user\'s, and evidence is added only while the case is open', async () => {
    const caseId = await openCase()
    const addEvidence = (ctx: TenantContext, addedBy: string) => as(ctx, async (tx) => insertRow(tx, 'case_evidence', {
      tenant_id: ctx.tenantId, case_id: caseId, document_id: await insertEvidence(tx, ctx.tenantId, ctx.userId),
      added_by: addedBy,
    }))
    const event = (ctx: TenantContext, actorId: string | null) =>
      as(ctx, (tx) => insertRow(tx, 'case_event', { tenant_id: ctx.tenantId, case_id: caseId, actor_id: actorId, kind: 'updated' }))

    await expect(addEvidence(b, a.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(event(b, a.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(event(b, null)).resolves.toBeDefined()
    await addEvidence(b, b.userId)
    await update(a, `UPDATE case_file SET state = 'submitted', submitted_by = $1, submitted_at = now()`, [a.userId])
    await expect(addEvidence(b, b.userId)).rejects.toMatchObject(CHECK)
  })

  test('their events, evidence and checklist entries are insert-only', async () => {
    const owner = getOwnerPool()
    await openCase()
    await as(a, async (tx) => {
      const caseId = (await tx.query<{ id: string }>('SELECT id FROM case_file')).rows[0]!.id
      await insertRow(tx, 'case_event', { tenant_id: a.tenantId, case_id: caseId, kind: 'opened' })
      await insertRow(tx, 'case_evidence', {
        tenant_id: a.tenantId, case_id: caseId, document_id: await insertEvidence(tx, a.tenantId, a.userId), added_by: a.userId,
      })
      await insertRow(tx, 'market_checklist_entry', {
        tenant_id: a.tenantId, market_id: await insertMarket(tx, a.tenantId), item: 'data_region', note: 'eu',
        recorded_by: a.userId,
      })
    })

    for (const table of ['case_event', 'case_evidence', 'market_checklist_entry']) {
      await expect(owner.query(`UPDATE ${table} SET tenant_id = tenant_id`)).rejects.toThrow(/UPDATE on .* is not allowed/)
      await expect(owner.query(`DELETE FROM ${table}`)).rejects.toThrow(/DELETE on .* is not allowed/)
    }
  })
})

describe('provider records, service accounts and API keys', () => {
  test('a provider record changes once, from recorded to withdrawn', async () => {
    const id = await as(a, (tx) => insertRow(tx, 'provider_config', {
      tenant_id: a.tenantId, kind: 'messaging', provider: 'Sandbox mail', state: 'recorded', created_by: a.userId,
    }))
    const withdraw = () => update(a, `UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2
      WHERE id = $1`, [id, a.userId])

    await expect(update(a, `UPDATE provider_config SET state = 'withdrawn', withdrawn_by = $1`, [a.userId])).rejects.toMatchObject(CHECK)
    await expect(update(a, `UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now()`)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(update(a, `UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $1`, [b.userId]))
      .rejects.toMatchObject(NOT_ALLOWED)
    await withdraw()
    await expect(withdraw()).rejects.toMatchObject(CHECK)
  })

  test('a service account is disabled once; a key only shortens its expiry and its revocation is final', async () => {
    const accountId = await as(a, (tx) => insertRow(tx, 'service_account', {
      tenant_id: a.tenantId, name: 'BI', purpose: 'export', state: 'active', created_by: a.userId,
    }))
    await as(a, (tx) => insertRow(tx, 'api_key', {
      tenant_id: a.tenantId, service_account_id: accountId, name: 'k', key_prefix: 'nmpk_abcdefg',
      key_hash: randomBytes(32).toString('hex'), scopes: ['compliance:read'], rate_tier: 'standard', created_by: a.userId,
      expires_at: '2027-01-01T00:00:00Z',
    }))

    await expect(update(a, `UPDATE service_account SET state = 'disabled', disabled_at = now(), disabled_by = $1`, [b.userId]))
      .rejects.toMatchObject(NOT_ALLOWED)
    await update(a, `UPDATE service_account SET state = 'disabled', disabled_at = now(), disabled_by = $1`, [a.userId])
    await expect(update(a, `UPDATE service_account SET state = 'active', disabled_at = NULL`)).rejects.toMatchObject(CHECK)
    await expect(update(a, `UPDATE api_key SET expires_at = '2028-01-01T00:00:00Z'`)).rejects.toMatchObject(CHECK)
    await expect(update(a, 'UPDATE api_key SET expires_at = NULL')).rejects.toMatchObject(CHECK)
    await update(a, `UPDATE api_key SET expires_at = '2026-12-01T00:00:00Z', revoked_at = now()`)
    await expect(update(a, 'UPDATE api_key SET revoked_at = NULL')).rejects.toMatchObject(CHECK)
  })
})

describe('calendars and periods', () => {
  test('a calendar takes a known time zone and its timing never changes; periods never overlap', async () => {
    const calendar = (zone: string) => as(a, async (tx) => insertRow(tx, 'calendar', {
      tenant_id: a.tenantId, market_id: await insertMarket(tx, a.tenantId, zone.slice(0, 2).toUpperCase()), name: 'Monthly',
      cadence: 'monthly', cutoff_time_zone: zone, first_period_start: '2026-01-01',
    }))
    const period = (calendarId: string, startsAt: string, endsAt: string) => as(a, (tx) => insertRow(tx, 'period', {
      tenant_id: a.tenantId, calendar_id: calendarId, starts_at: startsAt, ends_at: endsAt,
    }))

    await expect(calendar('Mars/Olympus_Mons')).rejects.toMatchObject(CHECK)
    const calendarId = await calendar('Europe/London')
    await expect(update(a, `UPDATE calendar SET name = 'Renamed'`)).resolves.toMatchObject({ rowCount: 1 })
    await expect(update(a, `UPDATE calendar SET cadence = 'weekly'`)).rejects.toThrow(PERMISSION_DENIED)
    await expect(getOwnerPool().query(`UPDATE calendar SET cutoff_time_zone = 'Asia/Tokyo'`)).rejects.toMatchObject(CHECK)
    await period(calendarId, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')
    await expect(period(calendarId, '2026-01-15T00:00:00Z', '2026-02-15T00:00:00Z')).rejects.toMatchObject({ code: '23P01' })
    await expect(period(calendarId, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')).resolves.toBeDefined()
  })
})

describe('webhooks (AC-INT1-3, AC-INT1-4)', () => {
  const endpoint = (topics: string[]) => as(a, (tx) => insertRow(tx, 'webhook_endpoint', {
    tenant_id: a.tenantId, url: 'https://hooks.example.test/nmp', secret_sealed: 'sealed', topics, state: 'active',
    created_by: a.userId,
  }))
  const fanOut = (eventId: string) =>
    withSystem(async (tx) => (await tx.query<{ n: number }>('SELECT webhook_fan_out($1) AS n', [eventId])).rows[0]!.n)

  test('fan-out reaches subscribed endpoints that existed when the event was written, once', async () => {
    const subscribed = await endpoint(['audit'])
    await endpoint(['other.topic'])
    const eventId = await as(a, (tx) => insertOutboxEvent(tx, a.tenantId))
    const later = await endpoint(['audit'])
    const testEventId = await as(a, (tx) => insertRow(tx, 'outbox_event', {
      tenant_id: a.tenantId, topic: 'webhook.test', key: 'k', payload: { endpoint_id: later },
    }))

    expect([await fanOut(eventId), await fanOut(eventId)]).toEqual([1, 0])
    expect((await getOwnerPool().query<{ endpoint_id: string }>(
      'SELECT endpoint_id FROM webhook_delivery WHERE outbox_event_id = $1', [eventId])).rows).toEqual([{ endpoint_id: subscribed }])
    expect(await fanOut(testEventId)).toBe(1)
  })

  test('an attempt is created scheduled and settles once, consistently with its response', async () => {
    const endpointId = await endpoint(['audit'])
    const eventId = await as(a, (tx) => insertOutboxEvent(tx, a.tenantId))
    const attempt = (n: number, overrides: Record<string, unknown> = {}) => as(a, (tx) => insertRow(tx, 'webhook_delivery', {
      tenant_id: a.tenantId, endpoint_id: endpointId, outbox_event_id: eventId, attempt: n, outcome: 'scheduled',
      next_attempt_at: new Date(), ...overrides,
    }))
    const settle = (sets: string) => update(a, `UPDATE webhook_delivery SET ${sets}, attempted_at = now() WHERE attempt = 1`)

    await expect(attempt(2, { outcome: 'delivered', status: 200, attempted_at: new Date() })).rejects.toMatchObject(CHECK)
    await attempt(1)
    await expect(settle(`status = 503, error = 'HTTP_STATUS'`)).rejects.toMatchObject(CHECK)
    await expect(settle(`outcome = 'delivered', status = 500`)).rejects.toMatchObject(CHECK)
    await expect(settle(`outcome = 'failed'`)).rejects.toMatchObject(CHECK)
    await expect(settle(`outcome = 'failed', status = 204`)).rejects.toMatchObject(CHECK)
    await settle(`outcome = 'failed', status = 503, error = 'HTTP_STATUS'`)
    await expect(settle(`outcome = 'delivered', status = 200, error = NULL`)).rejects.toMatchObject(CHECK)
  })
})

describe('market-pack rules (DATABASE C-11)', () => {
  test('an id is <rule>@<effective_from>, and two versions of one rule never overlap', async () => {
    const owner = getOwnerPool()
    const rule = (id: string, effectiveFrom: string, effectiveTo: string | null) => owner.query(
      `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status,
         source_ref, effective_from, effective_to)
       VALUES ($1, 'test-pack', 'Test rule', 'warned', '{}', true, false, 'test basis', 'screening', 'test', $2, $3)`,
      [id, effectiveFrom, effectiveTo],
    )

    await rule('cap@2026-01-01', '2026-01-01', null)
    await expect(rule('cap@2026-06-01', '2026-06-01', null)).rejects.toMatchObject({ code: '23P01' })
    await expect(rule('cap', '2026-06-01', null)).rejects.toMatchObject(CHECK)
    await expect(rule('cap@2026-01-01x', '2026-06-01', null)).rejects.toMatchObject(CHECK)
    await owner.query(`UPDATE guardrail_rule SET effective_to = '2026-06-01'`)
    await expect(rule('cap@2026-06-01', '2026-06-01', null)).resolves.toBeDefined()
  })
})
