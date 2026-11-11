import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { getLatestVersion, type SettingKey } from './settings.js'

export interface SettingWrite {
  readonly key: SettingKey
  /** Already validated against the key's schema. */
  readonly value: unknown
  readonly reason: string
  /** null = now. Versions are effective in version order, so a new one may not start before the latest. */
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
}

const UNIQUE_VIOLATION = '23505'

function preconditionFailed(latest: number): ApiError {
  return new ApiError(412, 'PRECONDITION_FAILED', 'Settings changed since you loaded them. Reload and try again.', {
    latest_version: latest,
  })
}

function assertEffectiveFrom(effectiveFrom: Date | null, latestFrom: Date | null): void {
  const start = effectiveFrom ?? new Date()
  if (effectiveFrom !== null && effectiveFrom.getTime() < Date.now()) {
    throw new ApiError(422, 'SETTING_EFFECTIVE_FROM_INVALID', 'effective_from cannot be in the past.')
  }
  if (latestFrom !== null && start < latestFrom) {
    throw new ApiError(422, 'SETTING_EFFECTIVE_FROM_INVALID', 'A later version is already scheduled; start on or after it.', {
      scheduled_from: latestFrom,
    })
  }
}

async function insertVersion(tx: Tx, version: number, write: SettingWrite, settings: Record<string, unknown>) {
  try {
    const { rows } = await tx.query<{ id: string; effective_from: Date }>(
      `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
       VALUES (app_tenant_id(), $1, coalesce($2::timestamptz, now()), $3, $4, current_setting('app.user_id')::uuid)
       RETURNING id, effective_from`,
      [version, write.effectiveFrom, settings, write.reason],
    )
    return rows[0]!
  } catch (error) {
    // Another write took this version number first.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw preconditionFailed(version)
    throw error
  }
}

/**
 * Appends a settings version (tenant_setting_version is insert-only): the latest settings with this key
 * replaced. Optimistic concurrency through If-Match (TR-API-14). The version row is the audit record of the
 * values; the audit event references it without repeating them (breach contacts are personal data).
 */
export async function putSetting(tx: Tx, write: SettingWrite): Promise<SettingVersionView> {
  const latest = await getLatestVersion(tx)
  const current = latest?.version ?? 0
  if (current !== write.expectedVersion) throw preconditionFailed(current)
  assertEffectiveFrom(write.effectiveFrom, latest?.effective_from ?? null)
  const version = current + 1
  const row = await insertVersion(tx, version, write, { ...(latest?.settings ?? {}), [write.key]: write.value })
  await recordAudit(tx, {
    action: 'SETTINGS.VERSION_CREATED', objectType: 'tenant_setting_version', objectId: row.id,
    before: { version: current }, after: { version, key: write.key }, reason: write.reason,
  })
  await enqueueOutbox(tx, { type: 'settings.version.created', key: 'settings', payload: { version_id: row.id, version, key: write.key } })
  return { key: write.key, value: write.value, version, version_id: row.id, effective_from: row.effective_from }
}
