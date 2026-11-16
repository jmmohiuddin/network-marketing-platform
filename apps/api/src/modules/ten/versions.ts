import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { rebaseTimeline, type ChainRow, type Settings } from './timeline.js'

interface ChainQueryRow {
  id: string
  version: number
  effective_from: Date
  settings: Record<string, unknown>
  approval_id: string | null
  reason: string
}

/** The settings chain (D-B1-01), ascending by effective_from: for each effective_from the highest version. */
export async function loadChain(tx: Tx): Promise<ChainRow[]> {
  const { rows } = await tx.query<ChainQueryRow>(
    `SELECT DISTINCT ON (effective_from) id, version, effective_from, settings, approval_id, reason
     FROM tenant_setting_version ORDER BY effective_from, version DESC`,
  )
  return rows.map((row) => ({
    id: row.id, version: row.version, effectiveFrom: row.effective_from, settings: row.settings,
    approvalId: row.approval_id, reason: row.reason,
  }))
}

/** The highest version number (the ETag of settings), 0 when none. */
export async function latestVersionNumber(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ version: number }>('SELECT coalesce(max(version), 0)::int AS version FROM tenant_setting_version')
  return rows[0]!.version
}

/** Serialises every append of the tenant's settings timeline (versions and their rebases). */
export async function lockSettings(tx: Tx): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('tenant_setting_version:' || app_tenant_id(), 0))`)
}

export interface VersionAppend {
  /** null = now (the database clock, read after the lock so it follows every committed version). */
  readonly effectiveFrom: Date | null
  readonly patch: Settings
  readonly reason: string
  readonly approvalId: string | null
  /** Names the change in the audit event and the outbox event (a key, or 'structure'). */
  readonly key: string
  /** The author of R when it is not the session user: the requester of an approved change (BUG-049). */
  readonly createdBy?: string
}

export interface AppendedVersion {
  readonly id: string
  readonly version: number
  readonly effectiveFrom: Date
  readonly settings: Settings
  /** Later chain rows re-appended on top of R (new ids; consumers pinning a version id need them). */
  readonly rebased: readonly { id: string; version: number; effective_from: Date }[]
  /** The highest version after the append (R or its last rebased row). */
  readonly latestVersion: number
}

interface Instant {
  readonly at: Date
  /** Exact database text of the instant (microseconds), so the inserted row is not truncated to milliseconds. */
  readonly exact: string
}

async function instantOf(tx: Tx, effectiveFrom: Date | null): Promise<Instant> {
  if (effectiveFrom !== null) return { at: effectiveFrom, exact: effectiveFrom.toISOString() }
  const { rows } = await tx.query<{ at: Date; exact: string }>('SELECT now_exact AS at, now_exact::text AS exact FROM clock_timestamp() AS now_exact')
  return rows[0]!
}

/**
 * Appends a change to the settings timeline (PLAN B1 1.3): takes the tenant's settings lock, inserts R at its date and
 * re-appends every later chain row on top of it (rebased rows keep their author, approval and exact effective_from).
 * The caller has already taken the lock when it checked If-Match (taking it twice is harmless).
 */
export async function appendVersion(tx: Tx, change: VersionAppend): Promise<AppendedVersion> {
  await lockSettings(tx)
  const instant = await instantOf(tx, change.effectiveFrom)
  const chain = await loadChain(tx)
  const previous = await latestVersionNumber(tx)
  const rows = rebaseTimeline(chain, { effectiveFrom: instant.at, patch: change.patch, reason: change.reason, approvalId: change.approvalId }, previous + 1)
  const inserted: { id: string; effective_from: Date }[] = []
  for (const row of rows) {
    const { rows: written } = await tx.query<{ id: string; effective_from: Date }>(
      `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
       VALUES (app_tenant_id(), $1,
               coalesce($2::timestamptz, (SELECT effective_from FROM tenant_setting_version WHERE id = $3)),
               $4, $5,
               coalesce((SELECT created_by FROM tenant_setting_version WHERE id = $3), $7::uuid, current_setting('app.user_id')::uuid), $6)
       RETURNING id, effective_from`,
      [row.version, row.rebases === null ? instant.exact : null, row.rebases, row.settings, row.reason, row.approvalId, change.createdBy ?? null],
    )
    inserted.push(written[0]!)
  }
  const first = inserted[0]!
  const rebased = rows.slice(1).map((row, index) => ({ id: inserted[index + 1]!.id, version: row.version, effective_from: inserted[index + 1]!.effective_from }))
  const latestVersion = previous + rows.length
  await recordAudit(tx, {
    action: 'SETTINGS.VERSION_CREATED', objectType: 'tenant_setting_version', objectId: first.id,
    before: { version: previous }, after: { version: previous + 1, key: change.key, rebased },
    reason: change.reason,
  })
  await enqueueOutbox(tx, { type: 'settings.version.created', key: 'settings', payload: { version_id: first.id, version: previous + 1, key: change.key, rebased } })
  return { id: first.id, version: previous + 1, effectiveFrom: first.effective_from, settings: rows[0]!.settings, rebased, latestVersion }
}
