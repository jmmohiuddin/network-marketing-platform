import { createHash, randomBytes } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'

const TOKEN_PREFIX = 'nmpk_'
const TOKEN_BYTES = 32
const KEY_PREFIX_LENGTH = 12
/** nmpk_ + base64url of 32 bytes (43 characters). */
export const TOKEN_PATTERN = /^nmpk_[A-Za-z0-9_-]{43}$/

export type RateTier = 'standard' | 'high'

/** Hex SHA-256 of the full token: the only form a key is stored in (AC-IAM6-1). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function mintToken(): { token: string; prefix: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`
  return { token, prefix: token.slice(0, KEY_PREFIX_LENGTH), hash: hashToken(token) }
}

export interface KeyView {
  id: string
  service_account_id: string
  name: string
  key_prefix: string
  scopes: string[]
  rate_tier: RateTier
  ip_allow: string[] | null
  expires_at: Date | null
  revoked_at: Date | null
  last_used_at: Date | null
  rotated_from_id: string | null
  created_at: Date
  status: 'active' | 'expiring' | 'expired' | 'revoked'
}

// expiring: still usable but with an end inside the longest rotation grace ($1 minutes), e.g. the old key of a rotation.
const KEY_COLUMNS = `k.id, k.service_account_id, k.name, k.key_prefix, k.scopes, k.rate_tier, k.ip_allow::text[] AS ip_allow,
  k.expires_at, k.revoked_at, k.last_used_at, k.rotated_from_id, k.created_at,
  CASE WHEN k.revoked_at IS NOT NULL THEN 'revoked'
       WHEN k.expires_at <= now() THEN 'expired'
       WHEN k.expires_at <= now() + make_interval(mins => $1) THEN 'expiring'
       ELSE 'active' END AS status`

export interface ServiceAccountView {
  id: string
  name: string
  purpose: string
  state: 'active' | 'disabled'
  disabled_at: Date | null
  created_at: Date
  created_by: { id: string; display_name: string | null }
  keys: KeyView[]
}

/** Service accounts by name with their keys, newest key first; after = the last name of the previous page. */
export async function listServiceAccounts(
  tx: Tx, maxGraceMinutes: number, after: string | undefined, limit: number,
): Promise<ServiceAccountView[]> {
  const { rows } = await tx.query<ServiceAccountView>(
    `SELECT s.id, s.name, s.purpose, s.state, s.disabled_at, s.created_at,
            json_build_object('id', u.id, 'display_name', u.display_name) AS created_by,
            coalesce((SELECT json_agg(key ORDER BY key.created_at DESC, key.id)
                      FROM (SELECT ${KEY_COLUMNS} FROM api_key k WHERE k.service_account_id = s.id) AS key), '[]') AS keys
     FROM service_account s JOIN user_account u ON u.id = s.created_by
     WHERE ($2::text IS NULL OR s.name > $2)
     ORDER BY s.name LIMIT $3`,
    [maxGraceMinutes, after ?? null, limit + 1],
  )
  return rows
}

export async function createServiceAccount(tx: Tx, input: { name: string; purpose: string }) {
  const { rows } = await tx.query<{ id: string; name: string; purpose: string; state: string; created_at: Date }>(
    `INSERT INTO service_account (tenant_id, name, purpose, state, created_by)
     VALUES (app_tenant_id(), $1, $2, 'active', app_user_id())
     ON CONFLICT (tenant_id, name) DO NOTHING
     RETURNING id, name, purpose, state, created_at`,
    [input.name, input.purpose],
  )
  const account = rows[0]
  if (account === undefined) {
    throw new ApiError(409, 'SERVICE_ACCOUNT_NAME_TAKEN', 'A service account with this name already exists.')
  }
  await recordAudit(tx, { action: 'SERVICE_ACCOUNT.CREATED', objectType: 'service_account', objectId: account.id, after: { name: account.name } })
  return account
}

async function lockActiveAccount(tx: Tx, id: string): Promise<void> {
  const { rows } = await tx.query<{ state: string }>('SELECT state FROM service_account WHERE id = $1 FOR UPDATE', [id])
  if (rows[0] === undefined) throw notFound()
  if (rows[0].state !== 'active') {
    throw new ApiError(409, 'SERVICE_ACCOUNT_DISABLED', 'The service account is disabled.')
  }
}

/** Disabling stops every key of the account at once (auth_find_api_key requires an active account). */
export async function disableServiceAccount(tx: Tx, id: string, reason: string) {
  await lockActiveAccount(tx, id)
  const { rows } = await tx.query<{ id: string; state: string; disabled_at: Date }>(
    `UPDATE service_account SET state = 'disabled', disabled_at = now(), disabled_by = app_user_id()
     WHERE id = $1 RETURNING id, state, disabled_at`,
    [id],
  )
  await recordAudit(tx, {
    action: 'SERVICE_ACCOUNT.DISABLED', objectType: 'service_account', objectId: id, before: { state: 'active' },
    after: { state: 'disabled' }, reason,
  })
  return rows[0]!
}

export interface NewKey {
  readonly name: string
  readonly scopes: readonly string[]
  readonly rateTier: RateTier
  readonly ipAllow: readonly string[] | null
  readonly expiresAt: string | null
}

/** Networks given with host bits set (10.0.0.1/8): refused with the network meant, never silently changed. */
async function assertNetworks(tx: Tx, networks: readonly string[] | null): Promise<void> {
  if (networks === null) return
  const { rows } = await tx.query<{ position: number; network: string }>(
    `SELECT position::int - 1 AS position, network(a)::text AS network FROM unnest($1::inet[]) WITH ORDINALITY AS u (a, position)
     WHERE host(a) <> host(network(a))`,
    [networks],
  )
  if (rows.length > 0) {
    const issues = rows.map((row) => ({ path: `ip_allow.${row.position}`, message: `has host bits set; use ${row.network}` }))
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request is not valid.', { issues })
  }
}

async function insertKey(tx: Tx, serviceAccountId: string, key: NewKey, rotatedFromId: string | null, maxGraceMinutes: number) {
  await assertNetworks(tx, key.ipAllow)
  const minted = mintToken()
  const { rows } = await tx.query<KeyView>(
    `WITH k AS (
       INSERT INTO api_key (tenant_id, service_account_id, name, key_prefix, key_hash, scopes, rate_tier, ip_allow, expires_at,
         rotated_from_id, created_by)
       VALUES (app_tenant_id(), $2, $3, $4, $5, $6, $7, $8::cidr[], $9, $10, app_user_id()) RETURNING *)
     SELECT ${KEY_COLUMNS} FROM k`,
    [maxGraceMinutes, serviceAccountId, key.name, minted.prefix, minted.hash, key.scopes, key.rateTier, key.ipAllow,
      key.expiresAt, rotatedFromId],
  )
  return { key: rows[0]!, token: minted.token }
}

/** A new key of an active service account; the token is returned here once and never stored (AC-IAM6-1). */
export async function createKey(tx: Tx, serviceAccountId: string, key: NewKey, maxGraceMinutes: number) {
  await lockActiveAccount(tx, serviceAccountId)
  const created = await insertKey(tx, serviceAccountId, key, null, maxGraceMinutes)
  await recordAudit(tx, {
    action: 'API_KEY.CREATED', objectType: 'api_key', objectId: created.key.id,
    after: {
      service_account_id: serviceAccountId, key_prefix: created.key.key_prefix, scopes: created.key.scopes,
      rate_tier: created.key.rate_tier, ip_allow: created.key.ip_allow, expires_at: created.key.expires_at,
    },
  })
  return created
}

interface LockedKey {
  service_account_id: string
  name: string
  scopes: string[]
  rate_tier: RateTier
  ip_allow: string[] | null
  expires_at: string | null
  usable: boolean
}

async function lockUsableKey(tx: Tx, id: string): Promise<LockedKey> {
  const { rows } = await tx.query<LockedKey>(
    `SELECT service_account_id, name, scopes, rate_tier, ip_allow::text[] AS ip_allow, expires_at::text AS expires_at,
            revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AS usable
     FROM api_key WHERE id = $1 FOR UPDATE`,
    [id],
  )
  const key = rows[0]
  if (key === undefined) throw notFound()
  if (!key.usable) throw new ApiError(409, 'API_KEY_INACTIVE', 'The API key is already revoked or expired.')
  return key
}

/**
 * AC-IAM6-2: a new key with the same authority (and the old key's own end, if any); the old key stops at
 * min(its end, now + grace). Grace 0 stops it now.
 */
/** assertScopes refuses (throws) when the caller may not mint a key with the old key's scopes. */
export async function rotateKey(
  tx: Tx, id: string, graceMinutes: number, maxGraceMinutes: number, assertScopes: (scopes: readonly string[]) => void,
) {
  const old = await lockUsableKey(tx, id)
  assertScopes(old.scopes)
  // One successor per key (a single rotation chain): a key still in its grace was already rotated.
  const { rowCount: successors } = await tx.query('SELECT 1 FROM api_key WHERE rotated_from_id = $1', [id])
  if (successors !== 0) throw new ApiError(409, 'API_KEY_ALREADY_ROTATED', 'This API key was already rotated. Rotate its replacement instead.')
  await lockActiveAccount(tx, old.service_account_id)
  const { rows } = await tx.query<{ expires_at: Date }>(
    `UPDATE api_key SET expires_at = least(expires_at, now() + make_interval(mins => $2)) WHERE id = $1 RETURNING expires_at`,
    [id, graceMinutes],
  )
  const replacement = { name: old.name, scopes: old.scopes, rateTier: old.rate_tier, ipAllow: old.ip_allow, expiresAt: old.expires_at }
  const created = await insertKey(tx, old.service_account_id, replacement, id, maxGraceMinutes)
  const oldExpiresAt = rows[0]!.expires_at
  await recordAudit(tx, {
    action: 'API_KEY.ROTATED', objectType: 'api_key', objectId: id,
    after: { new_key_id: created.key.id, new_key_prefix: created.key.key_prefix, grace_minutes: graceMinutes, expires_at: oldExpiresAt },
  })
  return { ...created, rotatedFrom: { id, expires_at: oldExpiresAt } }
}

export async function revokeKey(tx: Tx, id: string, reason: string) {
  await lockUsableKey(tx, id)
  const { rows } = await tx.query<{ id: string; revoked_at: Date }>(
    'UPDATE api_key SET revoked_at = now() WHERE id = $1 RETURNING id, revoked_at',
    [id],
  )
  await recordAudit(tx, { action: 'API_KEY.REVOKED', objectType: 'api_key', objectId: id, after: { revoked_at: rows[0]!.revoked_at }, reason })
  return rows[0]!
}
