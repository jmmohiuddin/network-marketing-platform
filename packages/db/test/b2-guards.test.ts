// Behaviour of the B2 tables, guards and shared SQL (PLAN B2 sections 1 and 4.2, migrations 0200-0205) as the runtime
// role nmp_app. Test ids: T-B2-16 (relationship trigger matrix), TS-02 / AC-PAR5-2 (termination leaves relationships),
// AC-PAR1-2, AC-GEN2-1, AC-ORD3-1, E-ORD-09.
import { randomBytes, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { beforeAll, describe, expect, test } from 'vitest'
import { getPool, withSystem, withTenant, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertMarket, insertRow, PERMISSION_DENIED } from './support.js'

const CHECK = { code: '23514' }
const NOT_ALLOWED = { code: '42501' }
const OVERLAP = { code: '23P01' }
const DAY_MS = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)

// a prepares, b decides; other is a second tenant.
let a: TenantContext
let b: TenantContext
let other: TenantContext
let marketId: string
let distributorType: string // earns, sponsors, holds positions
let customerType: string // end customer only

closePoolsAfterAll()

const as = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant(ctx, fn)
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], ctx = a): Promise<T[]> =>
  (await as(ctx, (tx) => tx.query(sql, params))).rows as T[]
const value = async <T>(sql: string, params: unknown[] = [], ctx = a): Promise<T> =>
  Object.values((await rows(sql, params, ctx))[0]!)[0] as T

/** A participant type proposed by a and approved (or rejected) by b with b's approval of it. */
async function decidedType(code: string, flags: { hold: boolean; customer: boolean }, decision = 'active'): Promise<string> {
  const id = await as(a, (tx) => insertRow(tx, 'participant_type', {
    tenant_id: a.tenantId, code, name: code, can_earn: flags.hold, counts_as_end_customer: flags.customer,
    can_sponsor: flags.hold, can_hold_positions: flags.hold, state: 'pending', reason: 'test', requested_by: a.userId,
  }))
  await as(b, async (tx) => {
    const approvalId = await insertRow(tx, 'approval', {
      tenant_id: b.tenantId, object_type: 'participant_type', object_id: id, preparer_id: a.userId, approver_id: b.userId,
      decision: decision === 'active' ? 'approved' : 'rejected', decided_at: new Date(),
    })
    await tx.query(`UPDATE participant_type SET state = $2, decided_by = $3, decided_at = now(), approval_id = $4 WHERE id = $1`,
      [id, decision, b.userId, approvalId])
  })
  return id
}

function enrol(typeId: string, at = daysAgo(30)): Promise<string> {
  return as(a, async (tx) => {
    const id = await insertRow(tx, 'participant', {
      tenant_id: a.tenantId, external_ref: `ref-${randomUUID()}`, account_type: 'individual', market_id: marketId, enrolled_at: at,
    })
    await insertRow(tx, 'participant_type_assignment', { tenant_id: a.tenantId, participant_id: id, type_id: typeId, valid_from: at })
    return id
  })
}

const createPosition = (owner: string, status = 'active', at = daysAgo(30)) =>
  value<string>(`SELECT gen_create_position($1, $2, NULL, NULL, $3, $4)`, [owner, marketId, status, at])
const newPosition = async (at = daysAgo(30)) => createPosition(await enrol(distributorType, at), 'active', at)
const apply = (kind: string, child: string, parent: string, from: Date, event = 'enrolment', caseId: string | null = null, leg: string | null = null) =>
  value<string>('SELECT gen_apply_relationship($1, $2, $3, $4, $5, $6, $7, NULL)', [kind, child, parent, leg, from, event, caseId])

function openCase(type = 'genealogy_change', subjectId: string = randomUUID()): Promise<string> {
  return as(a, (tx) => insertRow(tx, 'case_file', {
    tenant_id: a.tenantId, type, subject_type: 'position', subject_id: subjectId, reason_code: 'TEST', state: 'open',
    payload: {}, opened_by: a.userId,
  }))
}

/** The relationship rows of a child, oldest first, as a comparable list. */
const history = (child: string, kind = 'sponsor') => rows<{ parent: string; valid_from: Date; valid_to: Date | null; superseded: boolean; event_type: string }>(
  `SELECT parent_position_id AS parent, valid_from, valid_to, superseded_at IS NOT NULL AS superseded, event_type
   FROM relationship WHERE kind = $2 AND child_position_id = $1 ORDER BY recorded_at, valid_from`, [child, kind])

/** A raw nmp_app transaction in a's tenant left open, for concurrency tests. */
async function openTransaction(ctx: TenantContext): Promise<pg.PoolClient> {
  const client = await getPool().connect()
  await client.query('BEGIN')
  await client.query(`SELECT set_config('app.realm', 'tenant', true), set_config('app.tenant_id', $1, true),
                             set_config('app.user_id', $2, true)`, [ctx.tenantId, ctx.userId])
  return client
}

beforeAll(async () => {
  await resetTestDb()
  const tenantId = (await createTenant()).id
  a = { tenantId, userId: (await createUser({ tenantId })).id }
  b = { tenantId, userId: (await createUser({ tenantId })).id }
  const otherTenant = (await createTenant()).id
  other = { tenantId: otherTenant, userId: (await createUser({ tenantId: otherTenant })).id }
  marketId = await as(a, (tx) => insertMarket(tx, tenantId))
  distributorType = await decidedType('DIST', { hold: true, customer: false })
  customerType = await decidedType('RETAIL', { hold: false, customer: true })
})

describe('participant types and assignments (D-B2-09, AC-PAR1-1, AC-PAR1-2)', () => {
  test('a type is proposed pending by its requester and decided once by someone else with an approval of it', async () => {
    const propose = (ctx: TenantContext, requestedBy: string, state = 'pending') => as(ctx, (tx) => insertRow(tx, 'participant_type', {
      tenant_id: a.tenantId, code: `T${randomBytes(3).toString('hex').toUpperCase()}`, name: 'x', can_earn: false,
      counts_as_end_customer: true, can_sponsor: false, can_hold_positions: false, state, reason: 'r', requested_by: requestedBy,
    }))
    await expect(propose(a, b.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await expect(propose(a, a.userId, 'active')).rejects.toMatchObject(NOT_ALLOWED)
    const id = await propose(a, a.userId)
    const decide = (ctx: TenantContext, approvalOf: string) => as(ctx, async (tx) => {
      const approvalId = await insertRow(tx, 'approval', {
        tenant_id: a.tenantId, object_type: approvalOf, object_id: id, preparer_id: ctx === a ? b.userId : a.userId,
        approver_id: ctx.userId, decision: 'approved', decided_at: new Date(),
      })
      await tx.query(`UPDATE participant_type SET state = 'active', decided_by = $2, decided_at = now(), approval_id = $3 WHERE id = $1`,
        [id, ctx.userId, approvalId])
    })

    await expect(decide(a, 'participant_type')).rejects.toMatchObject(CHECK) // the requester decides: SoD
    await expect(decide(b, 'case')).rejects.toMatchObject(NOT_ALLOWED) // an approval of something else
    await decide(b, 'participant_type')
    await expect(as(a, (tx) => tx.query(`UPDATE participant_type SET can_earn = true WHERE id = $1`, [id]))).rejects.toThrow(PERMISSION_DENIED)
    await expect(as(a, (tx) => tx.query(`UPDATE participant_type SET state = 'withdrawn', decision_reason = 'x' WHERE id = $1`, [id])))
      .rejects.toMatchObject(CHECK)
  })

  test('only an active type is assigned; assignments never overlap and close once', async () => {
    const rejected = await decidedType('REJ', { hold: false, customer: true }, 'rejected')
    const participant = await enrol(customerType, daysAgo(10))
    const assign = (typeId: string, from: Date) =>
      as(a, (tx) => insertRow(tx, 'participant_type_assignment', { tenant_id: a.tenantId, participant_id: participant, type_id: typeId, valid_from: from }))

    await expect(assign(rejected, daysAgo(1))).rejects.toMatchObject(CHECK)
    await expect(assign(distributorType, daysAgo(1))).rejects.toMatchObject(OVERLAP)
    await rows(`UPDATE participant_type_assignment SET valid_to = $2 WHERE participant_id = $1`, [participant, daysAgo(1)])
    await assign(distributorType, daysAgo(1))
    await expect(rows(`UPDATE participant_type_assignment SET valid_to = now() WHERE participant_id = $1 AND valid_to IS NOT NULL`, [participant]))
      .rejects.toMatchObject(CHECK)
    expect(await rows('SELECT code FROM par_type_at($1, $2)', [participant, daysAgo(5)])).toEqual([{ code: 'RETAIL' }])
    expect(await rows('SELECT code FROM par_type_at($1, now())', [participant])).toEqual([{ code: 'DIST' }])
  })

  test('a participant changes only by a merge, once', async () => {
    const [subject, target] = [await enrol(customerType), await enrol(customerType)]
    const merge = () => rows(`UPDATE participant SET status = 'merged', merged_into_id = $2 WHERE id = $1`, [subject, target])

    await expect(rows(`UPDATE participant SET status = 'merged' WHERE id = $1`, [subject])).rejects.toMatchObject(CHECK)
    await merge()
    await expect(rows(`UPDATE participant SET status = 'active', merged_into_id = NULL WHERE id = $1`, [subject])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE participant SET display_name = 'x' WHERE id = $1`, [target])).rejects.toThrow(PERMISSION_DENIED)
  })

  test('par_create_customer: an active end-customer type only (PA002); an existing ref returns its id', async () => {
    const ref = `buyer-${randomUUID()}`
    const create = (typeId: string) => value<string>('SELECT par_create_customer($1, $2, $3, now())', [ref, marketId, typeId])

    await expect(create(distributorType)).rejects.toMatchObject({ code: 'PA002' })
    const id = await create(customerType)
    expect(await create(customerType)).toBe(id)
    expect(await rows(`SELECT created_by, created_by_type FROM participant WHERE id = $1`, [id])).toEqual([
      { created_by: a.userId, created_by_type: 'system' }, // no app.actor_type in a bare withTenant transaction
    ])
  })
})

describe('positions and ownership (FR-GEN-001)', () => {
  test('gen_create_position: a holding type only (PA001), default ref from the label, unique refs (GN009)', async () => {
    const customer = await enrol(customerType)
    const owner = await enrol(distributorType)

    await expect(createPosition(customer)).rejects.toMatchObject({ code: 'PA001' })
    await expect(createPosition(owner, 'suspended')).rejects.toMatchObject({ code: '22023' })
    const id = await createPosition(owner)
    const [position] = await rows<{ position_ref: string; label: string; status: string }>('SELECT position_ref, label, status FROM position WHERE id = $1', [id])
    expect(position!.position_ref).toBe(`P-${position!.label.toUpperCase()}`)
    expect(await rows('SELECT from_status, to_status, reason FROM position_status_history WHERE position_id = $1', [id]))
      .toEqual([{ from_status: null, to_status: 'active', reason: 'Enrolment' }])
    await expect(value(`SELECT gen_create_position($1, $2, NULL, $3, 'active', now())`, [owner, marketId, position!.position_ref]))
      .rejects.toMatchObject({ code: 'GN009' })
    await expect(rows(`UPDATE position SET market_id = market_id WHERE id = $1`, [id])).rejects.toThrow(PERMISSION_DENIED)
  })

  test('gen_transfer_ownership closes the current owner at T and opens the new one (AC-GEN1-2); conflicts are GN008', async () => {
    const position = await newPosition()
    const [to, customer] = [await enrol(distributorType), await enrol(customerType)]
    const caseId = await openCase('transfer', position)
    const transfer = (target: string, at: Date) => value('SELECT gen_transfer_ownership($1, $2, $3, $4)', [position, target, at, caseId])

    await expect(transfer(customer, new Date())).rejects.toMatchObject({ code: 'PA001' })
    await transfer(to, daysAgo(1))
    expect(await value('SELECT gen_owner_at($1, now())', [position])).toBe(to)
    expect(await rows('SELECT position_id FROM gen_positions_of($1, NULL)', [to])).toEqual([{ position_id: position }])
    await expect(transfer(to, new Date())).rejects.toMatchObject({ code: 'GN008' }) // already the owner
    await expect(transfer(await enrol(distributorType), daysAgo(2))).rejects.toMatchObject({ code: 'GN008' }) // before the current owner
  })
})

describe('relationship invariants (T-B2-16, D-B2-01, AC-GEN2-1)', () => {
  test('one parent per kind at a time (GN002), a taken leg (GN003) and cycles (GN001) are refused', async () => {
    const [root, child, grandchild] = [await newPosition(), await newPosition(), await newPosition()]
    await apply('placement', child, root, daysAgo(20), 'enrolment', null, '1')
    await apply('placement', grandchild, child, daysAgo(20), 'enrolment', null, '1')
    const insert = (row: Record<string, unknown>) => as(a, (tx) => insertRow(tx, 'relationship', {
      tenant_id: a.tenantId, kind: 'placement', valid_from: daysAgo(10), event_type: 'migration', ...row,
    }))

    await expect(insert({ parent_position_id: grandchild, child_position_id: child })).rejects.toMatchObject({ code: 'GN002' })
    await expect(insert({ parent_position_id: root, child_position_id: await newPosition(), leg: '1' })).rejects.toMatchObject({ code: 'GN003' })
    await expect(insert({ parent_position_id: grandchild, child_position_id: root })).rejects.toMatchObject({ code: 'GN001' })
    await expect(insert({ kind: 'sponsor', parent_position_id: root, child_position_id: child, leg: '2' })).rejects.toMatchObject(CHECK)
    await expect(insert({ parent_position_id: root, child_position_id: await newPosition(), event_type: 'change' })).rejects.toMatchObject(CHECK)
  })

  test('rows are never rewritten: no parent update, no delete, valid_to and superseded_at set once', async () => {
    const [parent, child] = [await newPosition(), await newPosition()]
    const id = await apply('sponsor', child, parent, daysAgo(20))

    await expect(rows('UPDATE relationship SET parent_position_id = $2 WHERE id = $1', [id, child])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('DELETE FROM relationship WHERE id = $1', [id])).rejects.toThrow(PERMISSION_DENIED)
    await rows('UPDATE relationship SET valid_to = now() WHERE id = $1', [id])
    await expect(rows(`UPDATE relationship SET valid_to = now() + interval '1 day' WHERE id = $1`, [id])).rejects.toMatchObject(CHECK)
    await expect(getOwnerPool().query('DELETE FROM relationship WHERE id = $1', [id])).rejects.toThrow(/DELETE on relationship/)
  })

  test('system time is the transaction time for the runtime role; every relationship write marks the read model stale', async () => {
    const [parent, child, next] = [await newPosition(), await newPosition(), await newPosition()]
    const id = await apply('sponsor', child, parent, daysAgo(20))
    const later = new Date(Date.now() + DAY_MS)

    await expect(as(a, (tx) => insertRow(tx, 'relationship', {
      tenant_id: a.tenantId, kind: 'sponsor', parent_position_id: parent, child_position_id: next, valid_from: daysAgo(5),
      event_type: 'migration', recorded_at: new Date('1999-01-01'),
    }))).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`UPDATE relationship SET superseded_at = '2000-01-01' WHERE id = $1`, [id])).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`INSERT INTO position_status_history (tenant_id, position_id, to_status, effective_from, reason, recorded_at)
      VALUES ($1, $2, 'active', now(), 'x', $3)`, [a.tenantId, parent, later])).rejects.toMatchObject(NOT_ALLOWED)
    await rows(`UPDATE path_model SET stale_since = NULL WHERE kind = 'sponsor'`)
    await rows('UPDATE relationship SET superseded_at = now() WHERE id = $1', [id]) // a write outside gen_apply_relationship
    expect(await rows(`SELECT stale_since IS NOT NULL AS stale FROM path_model WHERE kind = 'sponsor'`)).toEqual([{ stale: true }])
    await expect(rows(`INSERT INTO path_node (tenant_id, kind, model_version, position_id, parent_position_id, path, depth, subtree_count)
      VALUES ($1, 'sponsor', 0, $2, $3, 'a', 0, 0)`, [a.tenantId, parent, randomUUID()])).rejects.toMatchObject({ code: '23503' })
  })

  test('the tree lock serialises writers: a concurrent placement on the same leg waits, then sees it taken (GN003)', async () => {
    const parent = await newPosition()
    const [first, second] = [await newPosition(), await newPosition()]
    const one = await openTransaction(a)
    const two = await openTransaction(a)
    try {
      await one.query(`SELECT gen_apply_relationship('placement', $1, $2, '1', now(), 'enrolment', NULL, NULL)`, [first, parent])
      let waited = true
      const blocked = two.query(`SELECT gen_apply_relationship('placement', $1, $2, '1', now(), 'enrolment', NULL, NULL)`, [second, parent])
        .finally(() => { waited = false })
      const outcome = expect(blocked).rejects.toMatchObject({ code: 'GN003' })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(waited).toBe(true)
      await one.query('COMMIT')
      await outcome
    } finally {
      await two.query('ROLLBACK')
      for (const client of [one, two]) client.release()
    }
  })
})

describe('gen_apply_relationship (G2) and gen_auto_place (G3)', () => {
  test('a change closes the open row at T and opens the new one; the read model goes stale and genealogy.changed is queued', async () => {
    const [oldParent, newParent, child] = [await newPosition(), await newPosition(), await newPosition()]
    await apply('sponsor', child, oldParent, daysAgo(20))
    const caseId = await openCase()
    const tomorrow = new Date(Date.now() + DAY_MS)

    await expect(apply('sponsor', child, newParent, daysAgo(25), 'change', caseId)).rejects.toMatchObject({ code: 'GN005' })
    await apply('sponsor', child, newParent, tomorrow, 'change', caseId)
    const parentAt = (at: Date) => value(`SELECT parent_position_id FROM relationship WHERE kind = 'sponsor' AND child_position_id = $1
      AND superseded_at IS NULL AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)`, [child, at])

    expect(await parentAt(new Date())).toBe(oldParent) // AC-03.2: today the old parent, tomorrow the new one
    expect(await parentAt(new Date(tomorrow.getTime() + 1000))).toBe(newParent)
    expect(await rows(`SELECT stale_since IS NOT NULL AS stale FROM path_model WHERE kind = 'sponsor'`)).toEqual([{ stale: true }])
    const payload = await value<Record<string, string>>(
      `SELECT payload FROM outbox_event WHERE topic = 'genealogy.changed' AND key = $1 ORDER BY seq DESC LIMIT 1`, [child])
    expect({ ...payload, valid_from: new Date(payload.valid_from!).getTime() })
      .toEqual({ kind: 'sponsor', child_position_id: child, valid_from: tomorrow.getTime(), event_type: 'change' })
  })

  test('a correction supersedes the row valid at its date, keeps the part before it and inserts the corrected row', async () => {
    const [wrong, right, child] = [await newPosition(), await newPosition(), await newPosition()]
    await apply('sponsor', child, wrong, daysAgo(20))
    const caseId = await openCase('genealogy_correction')

    await apply('sponsor', child, right, daysAgo(10), 'correction', caseId)
    const rowsNow = await history(child)
    expect(rowsNow.map((row) => [row.parent, row.superseded, row.event_type, row.valid_to === null])).toEqual([
      [wrong, true, 'enrolment', true], [wrong, false, 'enrolment', false], [right, false, 'correction', true],
    ])
    expect(rowsNow[1]!.valid_to).toEqual(rowsNow[2]!.valid_from)
    await expect(apply('sponsor', child, right, daysAgo(30), 'correction', caseId)).rejects.toMatchObject({ code: 'GN005' })
    await expect(apply('sponsor', child, right, daysAgo(5), 'enrolment')).rejects.toMatchObject({ code: 'GN005' })
  })

  test('a terminated parent is refused (GN004), also when it is another tenant\'s position (not visible)', async () => {
    const [parent, child] = [await newPosition(), await newPosition()]
    await rows(`SELECT gen_set_position_status($1, 'terminated', now(), 'test', NULL)`, [parent])

    await expect(apply('sponsor', child, parent, daysAgo(1))).rejects.toMatchObject({ code: 'GN004' })
    await expect(value(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, now(), 'enrolment', NULL, NULL)`, [child, await newPosition()], other))
      .rejects.toMatchObject({ code: 'GN004' })
  })

  test('auto placement takes the first free leg breadth-first, smallest leg first (D-B2-20)', async () => {
    const root = await newPosition()
    const place = () => rows<{ parent_position_id: string; leg: string }>('SELECT * FROM gen_auto_place($1, 2)', [root])
    const take = async () => {
      const [slot] = await place()
      const child = await newPosition()
      await apply('placement', child, slot!.parent_position_id, daysAgo(1), 'enrolment', null, slot!.leg)
      return { child, ...slot! }
    }

    const first = await take()
    const second = await take()
    const third = await take()
    expect([first.parent_position_id, first.leg, second.parent_position_id, second.leg]).toEqual([root, '1', root, '2'])
    expect([third.parent_position_id, third.leg]).toEqual([first.child, '1'])
    await expect(rows('SELECT * FROM gen_auto_place($1, 1)', [root])).rejects.toMatchObject({ code: '22023' })
  })
})

describe('position status and customer servicing (G5, C1, C3)', () => {
  test('transitions follow the table (GN006), dates lie between the latest committed end and now (GN007)', async () => {
    const position = await newPosition()
    const status = (to: string, at: Date | string = new Date()) => rows(`SELECT gen_set_position_status($1, $2, $3, 'test', NULL)`, [position, to, at])

    await expect(status('pending')).rejects.toMatchObject({ code: 'GN006' })
    await expect(status('suspended', new Date(Date.now() + DAY_MS))).rejects.toMatchObject({ code: 'GN007' })
    await status('suspended')
    await status('terminated')
    await expect(status('suspended')).rejects.toMatchObject({ code: 'GN006' })
    await status('active') // reinstatement: same position (BR-GEN-11)
    expect(await rows('SELECT from_status, to_status FROM position_status_history WHERE position_id = $1 ORDER BY recorded_at, effective_from', [position]))
      .toEqual([
        { from_status: null, to_status: 'active' }, { from_status: 'active', to_status: 'suspended' },
        { from_status: 'suspended', to_status: 'terminated' }, { from_status: 'terminated', to_status: 'active' },
      ])
  })

  test('a status change is never dated before the current status (GN006)', async () => {
    const position = await newPosition()
    const status = (to: string, at: Date) => rows(`SELECT gen_set_position_status($1, $2, $3, 'test', NULL)`, [position, to, at])

    await status('suspended', daysAgo(5))
    await expect(status('active', daysAgo(10))).rejects.toMatchObject({ code: 'GN006' })
    await status('active', daysAgo(5))
  })

  test('a committed period bounds the effective date (GN007)', async () => {
    const calendarId = await as(a, (tx) => insertRow(tx, 'calendar', {
      tenant_id: a.tenantId, market_id: marketId, name: `Cal ${randomUUID()}`, cadence: 'monthly', cutoff_time_zone: 'UTC',
      first_period_start: '2026-01-01',
    }))
    const periodId = await as(a, (tx) => insertRow(tx, 'period', {
      tenant_id: a.tenantId, calendar_id: calendarId, starts_at: daysAgo(60), ends_at: daysAgo(15),
    }))
    await getOwnerPool().query(`UPDATE period SET state = 'committed' WHERE id = $1`, [periodId])
    try {
      const position = await newPosition()
      await expect(rows(`SELECT gen_set_position_status($1, 'suspended', $2, 'test', NULL)`, [position, daysAgo(20)]))
        .rejects.toMatchObject({ code: 'GN007' })
      expect(await value('SELECT latest_committed_end($1)', [marketId])).toEqual(await value('SELECT ends_at FROM period WHERE id = $1', [periodId]))
      expect(await rows('SELECT period_id FROM committed_periods_overlapping($1, $2, now())', [marketId, daysAgo(20)])).toEqual([{ period_id: periodId }])
      expect(await value('SELECT market_period_at($1, $2)', [marketId, daysAgo(30)])).toBe(periodId)
    } finally {
      await getOwnerPool().query(`UPDATE period SET state = 'open' WHERE id = $1`, [periodId])
    }
  })

  test('an open duplicate case on the owner holds pending -> active (PA003) except for that case', async () => {
    const owner = await enrol(distributorType)
    const position = await createPosition(owner, 'pending')
    const caseId = await as(a, (tx) => insertRow(tx, 'case_file', {
      tenant_id: a.tenantId, type: 'duplicate', subject_type: 'participant', subject_id: owner, reason_code: 'SIGNAL_MATCH',
      state: 'open', payload: {}, opened_by: null, opened_by_kind: 'system',
    }))
    const activate = (caseRef: string | null) => rows(`SELECT gen_set_position_status($1, 'active', now(), 'test', $2)`, [position, caseRef])

    await expect(activate(null)).rejects.toMatchObject({ code: 'PA003' })
    await activate(caseId)
  })

  test('servicing: end customers only (CR001), active servicers only (CR002), the same servicer is a no-op', async () => {
    const [customer, distributor] = [await enrol(customerType), await enrol(distributorType)]
    const [servicer, terminated, suspended] = [await newPosition(), await newPosition(), await newPosition()]
    // A duplicate-held position (D-B2-10) and a suspended one must not collect customers while under review.
    const pending = await createPosition(await enrol(distributorType, daysAgo(30)), 'pending', daysAgo(30))
    await rows(`SELECT gen_set_position_status($1, 'terminated', now(), 'test', NULL)`, [terminated])
    await rows(`SELECT gen_set_position_status($1, 'suspended', now(), 'test', NULL)`, [suspended])
    const serve = (who: string, position: string | null, from: Date) =>
      value<string>(`SELECT crm_set_servicer($1, $2, 'manual', $3, NULL, NULL)`, [who, position, from])

    await expect(serve(distributor, servicer, daysAgo(1))).rejects.toMatchObject({ code: 'CR001' })
    for (const inactive of [terminated, suspended, pending]) {
      await expect(serve(customer, inactive, daysAgo(1))).rejects.toMatchObject({ code: 'CR002' })
    }
    const first = await serve(customer, servicer, daysAgo(5))
    expect(await serve(customer, servicer, daysAgo(1))).toBe(first)
    await serve(customer, null, daysAgo(1))
    expect(await rows('SELECT position_id, source FROM crm_servicer_at($1, now())', [customer])).toEqual([{ position_id: null, source: 'manual' }])
    expect(await rows('SELECT position_id FROM crm_servicer_at($1, $2)', [customer, daysAgo(3)])).toEqual([{ position_id: servicer }])
  })

  test('termination reassigns customers by the rule in force (CR003 when unset) and never touches relationships (TS-02)', async () => {
    const [sponsor, servicer] = [await newPosition(), await newPosition()]
    await apply('sponsor', servicer, sponsor, daysAgo(20))
    const customer = await enrol(customerType)
    await value(`SELECT crm_set_servicer($1, $2, 'enrolment', $3, NULL, NULL)`, [customer, servicer, daysAgo(10)])
    const before = await rows('SELECT * FROM relationship WHERE child_position_id = $1 OR parent_position_id = $1 ORDER BY id', [servicer])
    const terminate = () => value<number>(`SELECT gen_set_position_status($1, 'terminated', now(), 'test', NULL)`, [servicer])

    await expect(terminate()).rejects.toMatchObject({ code: 'CR003' })
    await as(a, (tx) => insertRow(tx, 'tenant_setting_version', {
      tenant_id: a.tenantId, version: 1, effective_from: daysAgo(30), reason: 'test', created_by: a.userId,
      settings: { 'customers.reassignment_rule': { rule: 'sponsor', notice_days: 0 } },
    }))
    expect(await terminate()).toBe(1)
    expect(await rows('SELECT position_id, source FROM crm_servicer_at($1, now())', [customer])).toEqual([{ position_id: sponsor, source: 'reassignment' }])
    expect(await rows('SELECT * FROM relationship WHERE child_position_id = $1 OR parent_position_id = $1 ORDER BY id', [servicer])).toEqual(before)

    // A sponsor that is not active (here suspended) takes no customers: they go to the company.
    const [suspendedSponsor, other] = [await newPosition(), await newPosition()]
    await apply('sponsor', other, suspendedSponsor, daysAgo(20))
    const otherCustomer = await enrol(customerType)
    await value(`SELECT crm_set_servicer($1, $2, 'enrolment', $3, NULL, NULL)`, [otherCustomer, other, daysAgo(10)])
    await rows(`SELECT gen_set_position_status($1, 'suspended', now(), 'test', NULL)`, [suspendedSponsor])
    expect(await value<number>(`SELECT gen_set_position_status($1, 'terminated', now(), 'test', NULL)`, [other])).toBe(1)
    expect(await rows('SELECT position_id, source FROM crm_servicer_at($1, now())', [otherCustomer])).toEqual([{ position_id: null, source: 'reassignment' }])
  })
})

describe('servicing edge cases (C1, C3)', () => {
  const serve = (customer: string, position: string, from: Date) =>
    value<string>(`SELECT crm_set_servicer($1, $2, 'manual', $3, NULL, NULL)`, [customer, position, from])

  test('a back-dated termination moves a customer assigned later just after that assignment', async () => {
    const [sponsor, servicer] = [await newPosition(), await newPosition()]
    await apply('sponsor', servicer, sponsor, daysAgo(20))
    const customer = await enrol(customerType)
    const since = daysAgo(2)
    await serve(customer, servicer, since)

    expect(await value<number>(`SELECT gen_set_position_status($1, 'terminated', $2, 'test', NULL)`, [servicer, daysAgo(5)])).toBe(1)
    expect(await rows(`SELECT servicing_position_id AS position_id, valid_from = $2::timestamptz + interval '1 microsecond' AS just_after
      FROM customer_servicing WHERE customer_id = $1 AND valid_to IS NULL`, [customer, since])).toEqual([{ position_id: sponsor, just_after: true }])
  })

  test('concurrent servicing changes of one customer are serialised, never an exclusion error', async () => {
    const customer = await enrol(customerType)
    const [first, second] = [await newPosition(), await newPosition()]
    const one = await openTransaction(a)
    const two = await openTransaction(a)
    try {
      await one.query(`SELECT crm_set_servicer($1, $2, 'manual', $3, NULL, NULL)`, [customer, first, daysAgo(3)])
      const blocked = two.query(`SELECT crm_set_servicer($1, $2, 'manual', $3, NULL, NULL)`, [customer, second, daysAgo(1)])
      await new Promise((resolve) => setTimeout(resolve, 200))
      await one.query('COMMIT')
      await blocked
      await two.query('COMMIT')
    } finally {
      for (const client of [one, two]) {
        await client.query('ROLLBACK')
        client.release()
      }
    }
    expect(await rows('SELECT servicing_position_id AS position_id FROM customer_servicing WHERE customer_id = $1 ORDER BY valid_from', [customer]))
      .toEqual([{ position_id: first }, { position_id: second }])
  })

  test('a reassignment rule without notice_days 0..90 is refused (22023)', async () => {
    const servicer = await newPosition()
    await serve(await enrol(customerType), servicer, daysAgo(10))
    await as(a, (tx) => insertRow(tx, 'tenant_setting_version', {
      tenant_id: a.tenantId, version: 2, effective_from: daysAgo(1), reason: 'test', created_by: a.userId,
      settings: { 'customers.reassignment_rule': { rule: 'company' } },
    }))

    await expect(value(`SELECT gen_set_position_status($1, 'terminated', now(), 'test', NULL)`, [servicer])).rejects.toMatchObject({ code: '22023' })
  })
})

describe('orders (FR-ORD-003, FR-ORD-004, FR-ORD-005)', () => {
  async function order() {
    const buyer = await enrol(customerType)
    return as(a, async (tx) => {
      const inbound = (key: string) => insertRow(tx, 'inbound_event', {
        tenant_id: a.tenantId, source: 'api:test', idempotency_key: key, payload_hash: randomBytes(32), processed_at: new Date(), state: 'processed',
      })
      const ref = randomUUID()
      const orderId = await insertRow(tx, 'sales_order', {
        tenant_id: a.tenantId, source_system: 'test', source_order_id: ref, market_id: marketId, buyer_id: buyer, buyer_type_id: customerType,
        purpose: 'customer', purpose_missing: false, attribution_conflict: false, ordered_at: daysAgo(2), credited_at: daysAgo(2),
        amount_minor: 3000, tax_minor: 0, currency: 'GBP', payload_hash: randomBytes(32), inbound_event_id: await inbound(`order:test:${ref}`),
      })
      for (const line_no of [1, 2]) {
        await insertRow(tx, 'order_line', {
          tenant_id: a.tenantId, order_id: orderId, line_no, sku: 'SKU', item_class: 'product', quantity: 2, amount_minor: 1500, volumes: { qv: '200' },
        })
      }
      return { orderId, inboundEventId: await inbound(`event:test:${ref}`) }
    })
  }
  const event = (orderId: string, inboundEventId: string, type: string, lines: unknown[], extra: Record<string, unknown> = {}) =>
    as(a, (tx) => insertRow(tx, 'order_event', {
      tenant_id: a.tenantId, order_id: orderId, source_system: 'test', source_event_id: randomUUID(), type, occurred_at: new Date(),
      lines: JSON.stringify(lines), refund_minor: 0, fee_minor: 0, volume_effect: {}, inbound_event_id: inboundEventId, ...extra,
    }))

  test('returned quantities stay within what was purchased per line (OR001, E-ORD-09); reversals re-credit', async () => {
    const { orderId, inboundEventId } = await order()

    await event(orderId, inboundEventId, 'return', [{ line_no: 1, quantity: 2 }])
    await expect(event(orderId, inboundEventId, 'refund', [{ line_no: 1, quantity: 1 }])).rejects.toMatchObject({ code: 'OR001' })
    await event(orderId, inboundEventId, 'exchange', [{ line_no: 1, quantity: 1 }], { equal_value: true }) // no volume effect
    const chargeback = await event(orderId, inboundEventId, 'chargeback', [{ line_no: 2, quantity: 2 }])
    await event(orderId, inboundEventId, 'chargeback_reversed', [{ line_no: 2, quantity: 2 }], { reverses_event_id: chargeback })
    await event(orderId, inboundEventId, 'cancelled', [{ line_no: 2, quantity: 2 }])
    await expect(event(orderId, inboundEventId, 'return', [{ line_no: 3, quantity: 1 }])).rejects.toMatchObject(CHECK)
    await expect(event(orderId, inboundEventId, 'return', [{ line_no: 2, quantity: 0 }])).rejects.toMatchObject(CHECK)
    await expect(rows('UPDATE order_event SET fee_minor = 1 WHERE order_id = $1', [orderId])).rejects.toThrow(PERMISSION_DENIED)
  })

  test('a chargeback reversal names a chargeback of the same order with its lines, once', async () => {
    const { orderId, inboundEventId } = await order()
    const chargeback = await event(orderId, inboundEventId, 'chargeback', [{ line_no: 1, quantity: 1 }])
    const returned = await event(orderId, inboundEventId, 'return', [{ line_no: 1, quantity: 1 }, { line_no: 2, quantity: 1 }])
    const both = [{ line_no: 1, quantity: 1 }, { line_no: 2, quantity: 1 }]
    const reverse = (target: string, lines: unknown[], on = { orderId, inboundEventId }) =>
      event(on.orderId, on.inboundEventId, 'chargeback_reversed', lines, { reverses_event_id: target })
    const otherOrder = await order()
    const otherChargeback = await event(otherOrder.orderId, otherOrder.inboundEventId, 'chargeback', [{ line_no: 1, quantity: 1 }])

    await expect(reverse(returned, both)).rejects.toMatchObject(CHECK) // a return is not a chargeback
    await expect(reverse(chargeback, both)).rejects.toMatchObject(CHECK) // not the chargeback's lines
    await expect(reverse(chargeback, [{ line_no: 1, quantity: 1 }], otherOrder)).rejects.toMatchObject(CHECK) // another order's
    await reverse(otherChargeback, [{ line_no: 1, quantity: 1 }], otherOrder)
    await reverse(chargeback, [{ line_no: 1, quantity: 1 }])
    await expect(reverse(chargeback, [{ line_no: 1, quantity: 1 }])).rejects.toMatchObject({ code: '23505' }) // reversed once
  })

  test('volumes are integer minor-unit strings by measure (D-B2-17); lines carry the actor pair', async () => {
    const { orderId, inboundEventId } = await order()
    const line = (volumes: unknown) => as(a, (tx) => insertRow(tx, 'order_line', {
      tenant_id: a.tenantId, order_id: orderId, line_no: 3, sku: 'SKU', item_class: 'product', quantity: 1, amount_minor: 0, volumes,
    }))
    const effect = (volume_effect: unknown) => event(orderId, inboundEventId, 'refund', [], { volume_effect })
    const map = (volumes: unknown) => as(a, (tx) => insertRow(tx, 'product_volume_map', {
      tenant_id: a.tenantId, market_id: marketId, sku: `SKU-${randomUUID()}`, item_class: 'product', volumes, valid_from: new Date(),
      reason: 'test', created_by: a.userId,
    }))

    await expect(line({ qv: '1.5' })).rejects.toMatchObject(CHECK)
    await expect(line({ qv: 15 })).rejects.toMatchObject(CHECK)
    await expect(map({ QV: '1' })).rejects.toMatchObject(CHECK)
    await expect(effect({ total: { qv: '-1.5' } })).rejects.toMatchObject(CHECK)
    await expect(effect({ lines: [{ line_no: 1, volumes: { qv: '1e3' } }] })).rejects.toMatchObject(CHECK)
    await expect(effect({ other: {} })).rejects.toMatchObject(CHECK)
    await map({ qv: '100', bv: '0' })
    await effect({ lines: [{ line_no: 1, volumes: { qv: '-100' } }], total: { qv: '-100' } })
    expect(await rows('SELECT created_by, created_by_type FROM order_line WHERE order_id = $1 AND line_no = 1', [orderId]))
      .toEqual([{ created_by: a.userId, created_by_type: 'system' }])
  })

  test('order facts never change; period and attribution are set once (AC-ORD3-1)', async () => {
    const { orderId } = await order()
    const position = await newPosition()

    await expect(rows('UPDATE sales_order SET amount_minor = 1 WHERE id = $1', [orderId])).rejects.toThrow(PERMISSION_DENIED)
    await rows(`UPDATE sales_order SET attributed_position_id = $2, attribution_source = 'servicing' WHERE id = $1`, [orderId, position])
    await expect(rows(`UPDATE sales_order SET attribution_source = 'link' WHERE id = $1`, [orderId])).rejects.toMatchObject(CHECK)
    await expect(getOwnerPool().query('UPDATE sales_order SET amount_minor = 1 WHERE id = $1', [orderId])).rejects.toMatchObject(CHECK)
  })

  test('an inbound event changes only while held; a natural key is unique among held and processed rows', async () => {
    const insert = (state: string, extra: Record<string, unknown> = {}) => as(a, (tx) => insertRow(tx, 'inbound_event', {
      tenant_id: a.tenantId, source: 'api:test', idempotency_key: 'order:test:held', payload_hash: randomBytes(32), state, ...extra,
    }))
    const held = await insert('held', { payload: { lines: [] }, hold_reason: 'UNKNOWN_SKU', hold_ref: 'SKU-9' })

    await insert('rejected', { processed_at: new Date(), result: { error: { code: 'ORDER_CONFLICT' } } })
    await expect(insert('processed', { processed_at: new Date() })).rejects.toMatchObject({ code: '23505' })
    await expect(rows(`UPDATE inbound_event SET state = 'processed', processed_at = now() WHERE id = $1`, [held])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE inbound_event SET state = 'processed', processed_at = now(), hold_reason = NULL WHERE id = $1`, [held]))
      .rejects.toMatchObject(CHECK) // the payload leaves with the hold
    await expect(insert('processed', { idempotency_key: `order:test:${randomUUID()}`, processed_at: new Date(), payload: { buyer: {} } }))
      .rejects.toMatchObject(CHECK)
    await rows(`UPDATE inbound_event SET state = 'processed', processed_at = now(), payload = NULL, attempts = 2 WHERE id = $1`, [held])
    await expect(rows(`UPDATE inbound_event SET attempts = 3 WHERE id = $1`, [held])).rejects.toMatchObject(CHECK)
  })

  test('a late transaction is decided once by the acting user, then only consumption remains', async () => {
    const { orderId } = await order()
    const calendarId = await as(a, (tx) => insertRow(tx, 'calendar', {
      tenant_id: a.tenantId, market_id: marketId, name: `Late ${randomUUID()}`, cadence: 'monthly', cutoff_time_zone: 'UTC', first_period_start: '2026-01-01',
    }))
    const periodId = await as(a, (tx) => insertRow(tx, 'period', { tenant_id: a.tenantId, calendar_id: calendarId, starts_at: daysAgo(400), ends_at: daysAgo(370) }))
    const insert = (extra: Record<string, unknown> = {}) => as(a, (tx) => insertRow(tx, 'late_transaction', {
      tenant_id: a.tenantId, order_id: orderId, handling: 'adjust', state: 'pending', original_period_id: periodId, ...extra,
    }))

    await expect(insert({ state: 'decided', decided_by: b.userId, decided_at: new Date() })).rejects.toThrow(/created pending/)
    await expect(insert({ decision_reason: 'x' })).rejects.toThrow(/created pending/)
    const id = await insert()
    const decide = (decidedBy: string) =>
      rows(`UPDATE late_transaction SET state = 'decided', handling = 'restatement', decided_by = $2, decided_at = now() WHERE id = $1`, [id, decidedBy])

    await expect(decide(b.userId)).rejects.toMatchObject(NOT_ALLOWED)
    await decide(a.userId)
    await expect(rows(`UPDATE late_transaction SET handling = 'adjust' WHERE id = $1`, [id])).rejects.toMatchObject(CHECK)
    expect(await rows('SELECT origin_type, state FROM late_transaction WHERE id = $1', [id])).toEqual([{ origin_type: 'order', state: 'decided' }])
  })
})

describe('B1 tables in B2 (PLAN 1.6, 1.7)', () => {
  test('the system opens only duplicate cases; a system case is approved with its submitter as preparer and never withdrawn', async () => {
    const systemCase = (type: string) => as(a, (tx) => insertRow(tx, 'case_file', {
      tenant_id: a.tenantId, type, subject_type: 'participant', subject_id: randomUUID(), reason_code: 'SIGNAL_MATCH', state: 'open',
      payload: {}, opened_by: null, opened_by_kind: 'system',
    }))
    await expect(systemCase('adjustment')).rejects.toMatchObject(NOT_ALLOWED)
    await expect(as(a, (tx) => insertRow(tx, 'case_file', {
      tenant_id: a.tenantId, type: 'duplicate', subject_type: 'participant', subject_id: randomUUID(), reason_code: 'x', state: 'open',
      payload: {}, opened_by: b.userId,
    }))).rejects.toMatchObject(NOT_ALLOWED)
    const id = await systemCase('duplicate')
    await expect(rows(`UPDATE case_file SET state = 'withdrawn', decided_at = now() WHERE id = $1`, [id])).rejects.toMatchObject(NOT_ALLOWED)
    await rows(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [id, a.userId])
    const decide = (preparer: string) => as(b, async (tx) => {
      const approvalId = await insertRow(tx, 'approval', {
        tenant_id: a.tenantId, object_type: 'case', object_id: id, preparer_id: preparer, approver_id: b.userId, decision: 'approved', decided_at: new Date(),
      })
      await tx.query(`UPDATE case_file SET state = 'approved', decided_at = now(), approval_id = $2 WHERE id = $1`, [id, approvalId])
    })

    await expect(decide((await createUser({ tenantId: a.tenantId })).id)).rejects.toMatchObject(NOT_ALLOWED)
    await decide(a.userId)
  })

  test('a commerce connector rotates its secret while recorded only; last_ok_at moves freely', async () => {
    const id = await as(a, (tx) => insertRow(tx, 'provider_config', {
      tenant_id: a.tenantId, market_id: marketId, kind: 'commerce', provider: 'shopify', name: `Shop ${randomUUID()}`,
      webhook_secret_sealed: 'sealed-1', state: 'recorded', created_by: a.userId,
    }))
    await expect(as(a, (tx) => insertRow(tx, 'provider_config', {
      tenant_id: a.tenantId, market_id: marketId, kind: 'commerce', provider: 'magento', name: 'x', webhook_secret_sealed: 's', state: 'recorded', created_by: a.userId,
    }))).rejects.toMatchObject(CHECK)

    await rows(`UPDATE provider_config SET webhook_secret_sealed = 'sealed-2', last_ok_at = now() WHERE id = $1`, [id])
    await rows(`UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1`, [id, a.userId])
    await rows(`UPDATE provider_config SET last_ok_at = now() WHERE id = $1`, [id])
    await expect(rows(`UPDATE provider_config SET webhook_secret_sealed = 'sealed-3' WHERE id = $1`, [id])).rejects.toMatchObject(CHECK)
    expect(await value(`SELECT market_references($1) -> 'connectors'`, [marketId])).toBe(1)
  })

  test('connector_for_webhook and gen_stale_models answer only in the system realm; gen_analyze_genealogy only in a tenant', async () => {
    const id = await as(a, (tx) => insertRow(tx, 'provider_config', {
      tenant_id: a.tenantId, market_id: marketId, kind: 'commerce', provider: 'woocommerce', name: `Woo ${randomUUID()}`,
      webhook_secret_sealed: 'sealed', state: 'recorded', created_by: a.userId,
    }))

    await expect(rows('SELECT * FROM connector_for_webhook($1)', [id])).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows('SELECT * FROM gen_stale_models()')).rejects.toMatchObject(NOT_ALLOWED)
    await rows('SELECT gen_analyze_genealogy()')
    const system = await withSystem(async (tx) => ({
      connector: (await tx.query('SELECT * FROM connector_for_webhook($1)', [id])).rows,
      stale: (await tx.query('SELECT tenant_id FROM gen_stale_models()')).rows,
    }))
    expect(system.connector).toEqual([{ tenant_id: a.tenantId, provider: 'woocommerce', market_id: marketId, webhook_secret_sealed: 'sealed' }])
    expect(system.stale).toContainEqual({ tenant_id: a.tenantId })
    await expect(withSystem((tx) => tx.query('SELECT gen_analyze_genealogy()'))).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('genealogy.visibility_policy needs an approval like the money keys (D-B2-08)', async () => {
    const tenantId = (await createTenant()).id
    const ctx = { tenantId, userId: (await createUser({ tenantId })).id }

    await expect(as(ctx, (tx) => insertRow(tx, 'tenant_setting_version', {
      tenant_id: tenantId, version: 1, effective_from: new Date(), reason: 'r', created_by: ctx.userId,
      settings: { 'genealogy.visibility_policy': { named_depth: 3, contact_for_personally_sponsored: true } },
    }))).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('agreement versions take an agreement document of the publisher, once', async () => {
    const document = (cls: string) => as(a, (tx) => insertRow(tx, 'document', {
      tenant_id: a.tenantId, class: cls, storage_key: 'k', sha256: randomBytes(32), mime: 'application/pdf', size_bytes: 1, uploaded_by: a.userId, version: 1,
    }))
    const publish = (documentId: string, by = a, extra: Record<string, unknown> = {}) => as(by, (tx) => insertRow(tx, 'agreement_version', {
      tenant_id: a.tenantId, market_id: marketId, label: randomUUID().slice(0, 8), document_id: documentId, acceptance_required: true, published_by: by.userId,
      ...extra,
    }))
    const agreement = await document('agreement')

    await expect(publish(agreement, a, { published_at: new Date(Date.now() + DAY_MS) })).rejects.toMatchObject(NOT_ALLOWED) // "current" ahead of time

    await expect(publish(await document('evidence'))).rejects.toMatchObject({ code: 'P0002' })
    await expect(publish(agreement, b)).rejects.toMatchObject({ code: 'P0002' })
    await publish(agreement)
    await expect(publish(agreement)).rejects.toMatchObject({ code: 'P0002' })
    expect(await rows('SELECT object_type FROM document_references($1)', [agreement])).toEqual([{ object_type: 'agreement_version' }])
  })
})

describe('participant search (PLAN 1.8)', () => {
  test('an exact external ref wins, else trigram similarity on the display name', async () => {
    const id = await as(a, (tx) => insertRow(tx, 'participant', {
      tenant_id: a.tenantId, external_ref: 'SEARCH-1', account_type: 'individual', market_id: marketId, enrolled_at: new Date(),
      display_name: 'Margarethe Vandersloot',
    }))

    expect(await rows('SELECT participant_id FROM par_search($1, 5)', ['SEARCH-1'])).toEqual([{ participant_id: id }])
    expect(await rows('SELECT participant_id FROM par_search($1, 5)', ['Margarethe Vandersloot'])).toEqual([{ participant_id: id }])
    expect(await rows('SELECT participant_id FROM par_search($1, 5)', ['Margarethe Vandersloot'], other)).toEqual([])
    expect(await rows('SELECT external_ref FROM par_display($1)', [[id]])).toEqual([{ external_ref: 'SEARCH-1' }])
  })
})
