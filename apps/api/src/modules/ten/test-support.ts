// Test fixtures for TEN and PAY tests, written through the owner pool (labelled fixtures: B1 has no app path that
// uploads documents in this package, commits periods or maintains market packs; PLAN B1 FR-TEN-003, D-B1-14).
import { createHash, randomUUID } from 'node:crypto'
import { ownerRows } from '../../../test/helpers/index.js'

/** FIXTURE: an evidence document uploaded by `userId` (as POST /v1/documents would store it), ready to reference once. */
export async function evidenceDocument(tenantId: string, userId: string, fileName = 'licence.pdf'): Promise<string> {
  const id = randomUUID()
  await ownerRows(
    `INSERT INTO document (id, tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, created_by, file_name)
     VALUES ($1, $2, 'evidence', $3, $4, 'application/pdf', 1024, $5, 1, $5, $6)`,
    [id, tenantId, `documents/${id}`, createHash('sha256').update(id).digest(), userId, fileName],
  )
  return id
}

/** FIXTURE: moves a period to a state the app cannot set in B1 (committed, paid, closed: B3 runs do that). */
export async function setPeriodState(periodId: string, state: 'committed' | 'paid' | 'closed' | 'calculating'): Promise<void> {
  await ownerRows('UPDATE period SET state = $2 WHERE id = $1', [periodId, state])
}

/** FIXTURE: a committed period of a new calendar of `marketId` covering [startsAt, endsAt). */
export async function committedPeriod(tenantId: string, marketId: string, startsAt: Date, endsAt: Date): Promise<string> {
  const [calendar] = await ownerRows<{ id: string }>(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, $3, 'weekly', 'UTC', $4::date) RETURNING id`,
    [tenantId, marketId, `fixture ${randomUUID().slice(0, 8)}`, startsAt.toISOString().slice(0, 10)],
  )
  const [period] = await ownerRows<{ id: string }>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state) VALUES ($1, $2, $3, $4, 'committed') RETURNING id`,
    [tenantId, calendar!.id, startsAt, endsAt],
  )
  return period!.id
}

/** FIXTURE pack rule (not a real market rule, DEC-14): a guardrail rule of `pack` in force since 2026-01-01. */
export async function fixturePackRule(pack: string, options: { basisStatus: 'screening' | 'counsel_confirmed'; mandatory: boolean; key?: string }): Promise<string> {
  const id = `${options.key ?? 'fixture-rule'}@2026-01-01`
  await ownerRows(
    `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status,
       source_ref, effective_from)
     VALUES ($1, $2, 'FIXTURE rule', 'blocked', '{}', false, $3, 'Test fixture basis', $4, 'Test fixture, not a real market rule', '2026-01-01')`,
    [id, pack, options.mandatory, options.basisStatus],
  )
  return id
}
