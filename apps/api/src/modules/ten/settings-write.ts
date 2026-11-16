import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { pgCode } from './pg.js'
import type { SettingKey } from './settings.js'
import { appendVersion, latestVersionNumber, lockSettings } from './versions.js'

export interface SettingWrite {
  readonly key: SettingKey
  /** Already validated against the key's schema. */
  readonly value: unknown
  readonly reason: string
  /** null = now. Any instant from now on, outside committed periods; later versions are rebased (D-B1-01). */
  readonly effectiveFrom: Date | null
  /** The latest version the client saw (If-Match); 0 when the tenant has none. */
  readonly expectedVersion: number
}

export interface SettingVersionView {
  key: SettingKey
  value: unknown
  version: number
  version_id: string
  effective_from: Date
  /** Later versions re-appended on top of this one (AC-TEN3-6). */
  rebased: readonly { id: string; version: number; effective_from: Date }[]
}

export interface SavedSetting {
  readonly view: SettingVersionView
  readonly latestVersion: number
}

function preconditionFailed(latest: number): ApiError {
  return new ApiError(412, 'PRECONDITION_FAILED', 'Settings changed since you loaded them. Reload and try again.', {
    latest_version: latest,
  })
}

/**
 * FR-TEN-003: a settings change starts neither inside a period of the tenant whose results are committed, paid or
 * closed (checked first, AC-37.1) nor in the past (no back-dating, AC-TEN3-3). `effectiveFrom` null = now.
 */
export async function assertEffectiveFrom(tx: Tx, effectiveFrom: Date | null): Promise<void> {
  const { rows } = await tx.query<{ id: string; starts_at: Date; ends_at: Date }>(
    `SELECT id, starts_at, ends_at FROM period
     WHERE state IN ('committed', 'paid', 'closed') AND starts_at <= coalesce($1::timestamptz, now())
       AND ends_at > coalesce($1::timestamptz, now())
     ORDER BY starts_at LIMIT 1`,
    [effectiveFrom],
  )
  const committed = rows[0]
  if (committed !== undefined) {
    throw new ApiError(422, 'EFFECTIVE_IN_COMMITTED_PERIOD', 'The date falls inside a period whose results are committed. Choose the next period boundary or later.', {
      period: { id: committed.id, starts_at: committed.starts_at, ends_at: committed.ends_at },
    })
  }
  if (effectiveFrom !== null && effectiveFrom.getTime() < Date.now()) {
    throw new ApiError(422, 'SETTING_EFFECTIVE_FROM_INVALID', 'effective_from cannot be in the past.')
  }
}

async function assertExpectedVersion(tx: Tx, expected: number): Promise<number> {
  await lockSettings(tx)
  const latest = await latestVersionNumber(tx)
  if (latest !== expected) throw preconditionFailed(latest)
  return latest
}

/**
 * Appends a version with this key replaced (tenant_setting_version is insert-only). Optimistic concurrency through
 * If-Match (TR-API-14). The version row is the audit record of the values; the audit event references it without
 * repeating them (breach contacts are personal data). Not for money-affecting keys (createChangeRequest).
 */
export async function putSetting(tx: Tx, write: SettingWrite): Promise<SavedSetting> {
  await assertExpectedVersion(tx, write.expectedVersion)
  await assertEffectiveFrom(tx, write.effectiveFrom)
  const appended = await appendVersion(tx, {
    effectiveFrom: write.effectiveFrom, patch: { [write.key]: write.value }, reason: write.reason, approvalId: null, key: write.key,
  })
  return {
    view: {
      key: write.key, value: write.value, version: appended.version, version_id: appended.id,
      effective_from: appended.effectiveFrom, rebased: appended.rebased,
    },
    latestVersion: appended.latestVersion,
  }
}

export const CHANGE_REQUEST_COLUMNS = `id, key, value, effective_from, reason, base_version, state, requested_by, requested_at,
  decided_by, decided_at, decision_reason, approval_id, version_id`

export interface ChangeRequestRow {
  id: string
  key: string
  value: unknown
  effective_from: Date
  reason: string
  base_version: number
  state: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  requested_by: string
  requested_at: Date
  decided_by: string | null
  decided_at: Date | null
  decision_reason: string | null
  approval_id: string | null
  version_id: string | null
}

/**
 * FR-TEN-003, AC-TEN3-1: a money-affecting key is changed through a pending request a Finance approver decides; no
 * version yet. effective_from is required and validated now (and again at approval). 409 CHANGE_PENDING while the
 * key has a pending request.
 */
export async function createChangeRequest(tx: Tx, write: SettingWrite & { readonly effectiveFrom: Date }): Promise<ChangeRequestRow> {
  const base = await assertExpectedVersion(tx, write.expectedVersion)
  await assertEffectiveFrom(tx, write.effectiveFrom)
  let row: ChangeRequestRow
  try {
    const { rows } = await tx.query<ChangeRequestRow>(
      `INSERT INTO setting_change_request (tenant_id, key, value, effective_from, reason, base_version, state, requested_by)
       VALUES (app_tenant_id(), $1, $2, $3, $4, $5, 'pending', current_setting('app.user_id')::uuid)
       RETURNING ${CHANGE_REQUEST_COLUMNS}`,
      [write.key, JSON.stringify(write.value), write.effectiveFrom, write.reason, base],
    )
    row = rows[0]!
  } catch (error) {
    if (pgCode(error) === '23505') {
      throw new ApiError(409, 'CHANGE_PENDING', 'A change of this setting is already waiting for approval. Decide or withdraw it first.')
    }
    throw error
  }
  await recordAudit(tx, {
    action: 'SETTINGS.CHANGE_REQUESTED', objectType: 'setting_change_request', objectId: row.id,
    after: { key: row.key, effective_from: row.effective_from, base_version: base }, reason: write.reason,
  })
  return row
}
