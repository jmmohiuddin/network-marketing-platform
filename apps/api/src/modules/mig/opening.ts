// Opening balances and opening state (PLAN B6 D-B6-10): staged from CSV while the migration is applied, submitted by the
// consultant, decided by a Finance approver other than the submitter; approval posts the one opening journal entry (SQL
// led_post_migration_opening) and freezes the opening state, which COMP reads as the chain-start prior state.
import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requireAnyPermission, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { approveAcrossMarkets, decideAcrossMarkets } from '../cpl/index.js'
import { assertState, loadMigration, planAtCutover, READERS, readScope, writeScope, type CompiledPlan, type MigrationRow } from './access.js'
import { migrationView } from './migrations.js'

/** Largest opening CSV accepted (D-B6-16; one row per payee or state item of an implementation-sized market). */
export const MIGRATION_CSV_MAX_BYTES = 10 * 1024 * 1024
const MAX_ID_LENGTH = 200
const AMOUNT = /^-?[1-9]\d{0,17}$/
const COUNT = /^(0|[1-9]\d{0,8})$/
const MINOR = /^(0|[1-9]\d{0,17})$/
const ITEM = /^(paid_as|title|carry|counter|banked|one_time)\.([a-z][a-z0-9_]{0,63})$/

const balancesQuery = z.strictObject({ control_total_minor: z.string().regex(/^-?\d{1,19}$/, 'an integer in minor units') })
const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(1).max(500) })
const openingQuery = z.strictObject({ ...pageQuery })

interface Finding {
  readonly row: number | null
  readonly code: string
  readonly detail: string
}

const invalid = (findings: readonly Finding[]): ApiError => new ApiError(422, 'OPENING_INVALID', 'The file has errors; nothing was staged.', { findings })

/**
 * The rows of an opening CSV with exactly `header` (case-insensitive), one line per record; row numbers count the header
 * as row 1. shortcut: no quoted cells (ids are pseudonymous, values numeric or keys); use a full CSV reader if a legacy
 * export quotes its cells.
 */
function csvRows(body: unknown, header: readonly string[]): string[][] {
  if (typeof body !== 'string') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as text/csv.')
  const lines = body.replace(/^﻿/, '').split(/\r?\n/)
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  const [first, ...records] = lines
  if (first?.split(',').map((cell) => cell.trim().toLowerCase()).join(',') !== header.join(',')) {
    throw invalid([{ row: 1, code: 'SCHEMA_MISMATCH', detail: `the header must be ${header.join(',')}` }])
  }
  const findings: Finding[] = []
  const rows = records.map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim())
    if (cells.length !== header.length || line.includes('"')) findings.push({ row: index + 2, code: 'SCHEMA_MISMATCH', detail: `expected ${header.length} unquoted cells` })
    else if (cells[0] === '' || cells[0]!.length > MAX_ID_LENGTH) findings.push({ row: index + 2, code: 'INVALID_VALUE', detail: `${header[0]} is empty or longer than ${MAX_ID_LENGTH}` })
    return cells
  })
  if (findings.length > 0) throw invalid(findings)
  return rows
}

/** External ref -> participant id (and its current position) for participants of the migration's market. */
async function participantsOf(tx: Tx, migration: MigrationRow, refs: readonly string[]) {
  const { rows } = await tx.query<{ ref: string; id: string; position_id: string | null }>(
    `SELECT p.external_ref AS ref, p.id,
            (SELECT o.position_id FROM position_ownership o WHERE o.participant_id = p.id AND o.valid_to IS NULL ORDER BY o.position_id LIMIT 1) AS position_id
     FROM participant p WHERE p.market_id = $1 AND p.external_ref = ANY ($2::text[])`,
    [migration.market_id, refs],
  )
  return new Map(rows.map((row) => [row.ref, row]))
}

async function stageBalances(tx: Tx, migration: MigrationRow, csv: unknown, controlTotal: bigint) {
  const rows = csvRows(csv, ['payee_id', 'amount_minor'])
  const findings: Finding[] = []
  const seen = new Set<string>()
  rows.forEach(([payee, amount], index) => {
    if (seen.has(payee!)) findings.push({ row: index + 2, code: 'DUPLICATE_KEY', detail: `payee ${payee} appears more than once` })
    if (!AMOUNT.test(amount!)) findings.push({ row: index + 2, code: 'INVALID_VALUE', detail: 'amount_minor must be a non-zero whole number of minor units' })
    seen.add(payee!)
  })
  if (findings.length > 0) throw invalid(findings)
  const total = rows.reduce((sum, [, amount]) => sum + BigInt(amount!), 0n)
  if (total !== controlTotal) {
    throw new ApiError(422, 'CONTROL_TOTAL_MISMATCH', 'The amounts do not sum to the control total.', { control_total_minor: controlTotal.toString(), total_minor: total.toString() })
  }
  const known = await participantsOf(tx, migration, rows.map(([payee]) => payee!))
  rows.forEach(([payee], index) => {
    if (!known.has(payee!)) findings.push({ row: index + 2, code: 'PAYEE_UNKNOWN', detail: `no participant ${payee} in the migration's market` })
  })
  if (findings.length > 0) throw invalid(findings)
  await tx.query('DELETE FROM migration_opening_balance WHERE migration_id = $1', [migration.id])
  await tx.query(
    `INSERT INTO migration_opening_balance (tenant_id, migration_id, participant_id, amount_minor)
     SELECT app_tenant_id(), $1, b.participant_id, b.amount::bigint FROM unnest($2::uuid[], $3::text[]) AS b (participant_id, amount)`,
    [migration.id, rows.map(([payee]) => known.get(payee!)!.id), rows.map(([, amount]) => amount)],
  )
  await recordAudit(tx, { action: 'MIGRATION.OPENING_STAGED', objectType: 'migration', objectId: migration.id, after: { kind: 'balances', count: rows.length, total_minor: total.toString() } })
  return { count: rows.length, total_minor: total.toString() }
}

interface StateRow {
  paidAs: { ladder: string; rank: string }[]
  titles: { ladder: string; rank: string }[]
  counters: { key: string; value: number }[]
  carry: { key: string; amountMinor: string; periodsHeld: number }[]
  oneTimeFlags: string[]
  banked: { key: string; amountMinor: string }[]
}

const emptyState = (): StateRow => ({ paidAs: [], titles: [], counters: [], carry: [], oneTimeFlags: [], banked: [] })

/** Why `value` is not a valid opening value of `item` under the plan version in force at C, or null. */
function itemProblem(plan: CompiledPlan, kind: string, key: string, value: string): string | null {
  const ladder = plan.ladders.find((l) => l.key === key)
  switch (kind) {
    case 'paid_as':
    case 'title':
      if (ladder === undefined) return `the plan has no ladder ${key}`
      return ladder.ranks.some((rank) => rank.key === value) ? null : `${value} is not a rank of ladder ${key}`
    case 'carry':
      if (!plan.carries.some((c) => c.key === key)) return `the plan has no carry ${key}`
      return MINOR.test(value) ? null : 'a carry is a whole number of minor units, 0 or more'
    case 'counter':
      if (!plan.counters.some((c) => c.key === key)) return `the plan has no counter ${key}`
      return COUNT.test(value) ? null : 'a counter is a whole number, 0 or more'
    case 'one_time':
      if (!plan.bonuses.some((b) => b.kind === 'pay.one_time' && b.onceKey === key)) return `the plan has no one-time bonus ${key}`
      return value === '1' ? null : 'a one-time flag is 1'
    default:
      // banked.<key>: the engine carries banked balances forward under any key (no plan rule declares them).
      return MINOR.test(value) ? null : 'a banked balance is a whole number of minor units, 0 or more'
  }
}

function addItem(state: StateRow, kind: string, key: string, value: string): void {
  if (kind === 'paid_as') state.paidAs.push({ ladder: key, rank: value })
  else if (kind === 'title') state.titles.push({ ladder: key, rank: value })
  else if (kind === 'counter') state.counters.push({ key, value: Number(value) })
  // shortcut: the legacy age of a carry balance is not imported, it counts as held one period (a non-zero carry always
  // has periodsHeld >= 1); add a periods column to the file if a plan expires carries during the migration.
  else if (kind === 'carry') state.carry.push({ key, amountMinor: value, periodsHeld: 1 })
  else if (kind === 'one_time') state.oneTimeFlags.push(key)
  else state.banked.push({ key, amountMinor: value })
}

/** Entries in key (or ladder) order, as the engine writes state rows. */
const sorted = (rows: readonly ({ key: string } | { ladder: string })[]): unknown[] => {
  const keyOf = (row: { key: string } | { ladder: string }): string => ('key' in row ? row.key : row.ladder)
  return [...rows].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1))
}

async function stageState(tx: Tx, migration: MigrationRow, csv: unknown) {
  const { plan } = (await planAtCutover(tx, migration.cutover_period_id, true))!
  const rows = csvRows(csv, ['participant_id', 'item', 'value'])
  const known = await participantsOf(tx, migration, rows.map(([ref]) => ref!))
  const findings: Finding[] = []
  const seen = new Set<string>()
  const states = new Map<string, StateRow>()
  rows.forEach(([ref, item, value], index) => {
    const row = index + 2
    const match = ITEM.exec(item!)
    const participant = known.get(ref!)
    const problem = match === null ? `${item} is not a state item` : itemProblem(plan, match[1]!, match[2]!, value!)
    if (participant === undefined) findings.push({ row, code: 'PARTICIPANT_UNKNOWN', detail: `no participant ${ref} in the migration's market` })
    else if (participant.position_id === null) findings.push({ row, code: 'NO_POSITION', detail: `participant ${ref} holds no position` })
    if (problem !== null) findings.push({ row, code: 'ITEM_INVALID', detail: problem })
    if (seen.has(`${ref}\u0000${item}`)) findings.push({ row, code: 'DUPLICATE_KEY', detail: `${ref} ${item} appears more than once` })
    seen.add(`${ref}\u0000${item}`)
    if (participant?.position_id == null || match === null || problem !== null) return
    const state = states.get(participant.position_id) ?? emptyState()
    addItem(state, match[1]!, match[2]!, value!)
    states.set(participant.position_id, state)
  })
  if (findings.length > 0) throw invalid(findings)
  const positions = [...states.keys()].sort()
  await tx.query('DELETE FROM migration_opening_state WHERE migration_id = $1', [migration.id])
  const column = (pick: (state: StateRow) => readonly ({ key: string } | { ladder: string })[]) => positions.map((id) => JSON.stringify(sorted(pick(states.get(id)!))))
  await tx.query(
    `INSERT INTO migration_opening_state (tenant_id, migration_id, position_id, paid_as_rank, highest_titles, counters, carry, one_time_flags, banked)
     SELECT app_tenant_id(), $1, s.position_id, s.paid_as, s.titles, s.counters, s.carry, ARRAY(SELECT jsonb_array_elements_text(s.flags) ORDER BY 1), s.banked
     FROM unnest($2::uuid[], $3::jsonb[], $4::jsonb[], $5::jsonb[], $6::jsonb[], $7::jsonb[], $8::jsonb[])
       AS s (position_id, paid_as, titles, counters, carry, flags, banked)`,
    [migration.id, positions, column((s) => s.paidAs), column((s) => s.titles), column((s) => s.counters), column((s) => s.carry),
      positions.map((id) => JSON.stringify(states.get(id)!.oneTimeFlags)), column((s) => s.banked)],
  )
  await recordAudit(tx, { action: 'MIGRATION.OPENING_STAGED', objectType: 'migration', objectId: migration.id, after: { kind: 'state', count: rows.length, positions: positions.length } })
  return { positions: positions.length, items: rows.length }
}

const OPENING_ROWS = `
  WITH refs AS (
    SELECT b.participant_id FROM migration_opening_balance b WHERE b.migration_id = $1
    UNION SELECT o.participant_id FROM migration_opening_state s
          JOIN position_ownership o ON o.position_id = s.position_id AND o.valid_to IS NULL WHERE s.migration_id = $1
  )
  SELECT jsonb_build_object('id', p.id, 'external_ref', p.external_ref) AS participant, -- pseudonymous refs only (PLAN API-38)
         (SELECT b.amount_minor::text FROM migration_opening_balance b WHERE b.migration_id = $1 AND b.participant_id = p.id) AS amount_minor,
         (SELECT jsonb_build_object('position_id', s.position_id, 'paid_as', s.paid_as_rank, 'titles', s.highest_titles, 'counters', s.counters,
                                    'carry', s.carry, 'one_time_flags', s.one_time_flags, 'banked', s.banked)
          FROM migration_opening_state s JOIN position_ownership o ON o.position_id = s.position_id AND o.valid_to IS NULL
          WHERE s.migration_id = $1 AND o.participant_id = p.id) AS state
  FROM refs JOIN participant p ON p.id = refs.participant_id
  WHERE ($2::text IS NULL OR p.external_ref > $2) ORDER BY p.external_ref LIMIT $3`

async function decideOpening(tx: Tx, request: FastifyRequest, body: z.infer<typeof decisionBody>) {
  const migration = await loadMigration(tx, request, writeScope(request, 'migration.signoff'), true)
  assertState(migration, 'opening_submitted')
  const approve = body.decision === 'approve'
  // Everyone who staged the balances or state contributed the numbers being posted (SoD as for parallel-run classifiers).
  const { rows: stagers } = await tx.query<{ actor_id: string }>(
    `SELECT DISTINCT actor_id FROM audit.audit_event
     WHERE object_type = 'migration' AND object_id = $1 AND action = 'MIGRATION.OPENING_STAGED' AND actor_id IS NOT NULL`,
    [migration.id],
  )
  const { approvalId } = await approveAcrossMarkets(tx, {
    objectType: 'migration', objectId: migration.id, preparerId: migration.opening_submitted_by!, contributorIds: stagers.map((s) => s.actor_id), excludedIds: [],
    decision: approve ? 'approved' : 'rejected', reason: body.reason, factorVerifiedAt: currentAuth(request).stepUpAt,
    approverPermission: 'migration.signoff', marketIds: [migration.market_id],
  })
  let entryId: string | null = null
  if (approve) {
    const { rows } = await tx.query<{ entry_id: string | null }>('SELECT led_post_migration_opening($1, $2) AS entry_id', [migration.id, approvalId])
    entryId = rows[0]!.entry_id
    await tx.query("UPDATE migration SET state = 'opening_posted', opening_approval_id = $2, opening_entry_id = $3 WHERE id = $1", [migration.id, approvalId, entryId])
  } else {
    await tx.query("UPDATE migration SET state = 'applied', opening_submitted_by = NULL, opening_submitted_at = NULL WHERE id = $1", [migration.id])
  }
  const state = approve ? 'opening_posted' : 'applied'
  await recordAudit(tx, {
    action: approve ? 'MIGRATION.OPENING_APPROVED' : 'MIGRATION.OPENING_REJECTED', objectType: 'migration', objectId: migration.id,
    before: { state: 'opening_submitted' }, after: { state, approval_id: approvalId, journal_entry_id: entryId }, reason: body.reason,
  })
  return { statusCode: 200, body: envelope({ state, journal_entry_id: entryId }) }
}

export function registerOpeningRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')
  const manage = { preHandler: [tenant, requirePermission('migration.manage')] }

  // The CSV parser lives in this plugin scope only (pay/reconciliation-routes.ts pattern).
  void app.register(async (scope) => {
    scope.addContentTypeParser('text/csv', { parseAs: 'string', bodyLimit: MIGRATION_CSV_MAX_BYTES }, (_request, body, done) => done(null, body))

    scope.put('/v1/migrations/:id/opening-balances', manage, async (request) => {
      const query = parse(balancesQuery, request.query)
      return envelope(await inTenant(request, async (tx) => {
        const migration = await loadMigration(tx, request, writeScope(request, 'migration.manage'), true)
        assertState(migration, 'applied')
        return stageBalances(tx, migration, request.body, BigInt(query.control_total_minor))
      }))
    })

    scope.put('/v1/migrations/:id/opening-state', manage, async (request) =>
      envelope(await inTenant(request, async (tx) => {
        const migration = await loadMigration(tx, request, writeScope(request, 'migration.manage'), true)
        assertState(migration, 'applied')
        return stageState(tx, migration, request.body)
      })))
  })

  app.get('/v1/migrations/:id/opening', { preHandler: [tenant, requireAnyPermission(...READERS)] }, async (request) => {
    const query = parse(openingQuery, request.query)
    const after = decodeCursor(query.cursor, z.string())
    const rows = await inTenant(request, async (tx) => {
      const migration = await loadMigration(tx, request, readScope(request))
      return (await tx.query<{ participant: { external_ref: string } }>(OPENING_ROWS, [migration.id, after ?? null, query.limit + 1])).rows
    })
    return toPage(rows, query.limit, (row) => row.participant.external_ref)
  })

  app.post('/v1/migrations/:id/opening/submit', manage, async (request, reply) => {
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const migration = await loadMigration(tx, request, writeScope(request, 'migration.manage'), true)
      assertState(migration, 'applied')
      await tx.query("UPDATE migration SET state = 'opening_submitted', opening_submitted_by = app_user_id(), opening_submitted_at = now() WHERE id = $1", [migration.id])
      await recordAudit(tx, { action: 'MIGRATION.OPENING_SUBMITTED', objectType: 'migration', objectId: migration.id, before: { state: 'applied' }, after: { state: 'opening_submitted' } })
      return { statusCode: 200, body: envelope(await migrationView(tx, migration.id)) }
    }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/migrations/:id/opening/decision', { preHandler: [tenant, requirePermission('migration.signoff'), requireStepUp()] }, async (request, reply) => {
    const body = parse(decisionBody, request.body)
    return sendIdempotent(reply, await decideAcrossMarkets(request, (tx) => decideOpening(tx, request, body)))
  })
}
