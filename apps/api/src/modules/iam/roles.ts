import type { Tx } from '@nmp/db'
import { marketScope, type AuthContext } from '../../lib/auth.js'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { BASE_ROLES, isPermission, isPrivileged, requiresMfa, type Permission } from '../../lib/permissions.js'

export interface RoleView {
  id: string
  name: string
  permissions: string[]
  is_base: boolean
  mfa_required: boolean
  privileged: boolean
}

interface RoleRow {
  id: string
  name: string
  permissions: string[]
  is_base: boolean
  mfa_required: boolean
}

function toView(row: RoleRow): RoleView {
  const permissions = row.permissions.filter(isPermission)
  return { ...row, permissions, privileged: isPrivileged(permissions) }
}

/** Base roles and the tenant's own roles (RLS: base_role_read + tenant_isolation). */
export async function listRoles(tx: Tx): Promise<RoleView[]> {
  const { rows } = await tx.query<RoleRow>(
    'SELECT id, name, permissions, is_base, mfa_required FROM role ORDER BY is_base DESC, name',
  )
  return rows.map(toView)
}

/** A role the caller's tenant may assign: a base role or one of its own; null for unknown or foreign ids. */
export async function findRole(tx: Tx, roleId: string): Promise<RoleView | null> {
  const { rows } = await tx.query<RoleRow>(
    'SELECT id, name, permissions, is_base, mfa_required FROM role WHERE id = $1',
    [roleId],
  )
  return rows[0] === undefined ? null : toView(rows[0])
}

/**
 * The caller holds every permission listed over at least the given markets (null = every market): what one
 * may grant alone (BR-SEC-05), market scope included (SEC-26, AC-36.2).
 */
export function holdsWithin(auth: AuthContext, permissions: readonly string[], marketIds: readonly string[] | null): boolean {
  return permissions.every((permission) => {
    if (!isPermission(permission) || !auth.permissions.has(permission)) return false
    const scope = marketScope(auth, permission)
    return scope === null || (marketIds !== null && marketIds.every((id) => scope.includes(id)))
  })
}

export interface NewRole {
  readonly name: string
  readonly permissions: readonly Permission[]
  readonly mfaRequired: boolean
}

const UNIQUE_VIOLATION = '23505'
const BASE_ROLE_NAMES = new Set(BASE_ROLES.map((role) => role.name.toLowerCase()))

function nameTaken(): ApiError {
  return new ApiError(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists.')
}

/**
 * A tenant role (FR-IAM-003; clone a base role by sending its permissions). MFA is required when asked for
 * or when the permissions need it (SEC-03); it cannot be switched off for those. Creating a role grants
 * nothing: granting it is where BR-SEC-05 applies (grants.ts).
 */
export async function createRole(tx: Tx, role: NewRole): Promise<RoleView> {
  if (BASE_ROLE_NAMES.has(role.name.toLowerCase())) throw nameTaken()
  const permissions = [...new Set(role.permissions)]
  const mfaRequired = role.mfaRequired || requiresMfa(permissions)
  let row: RoleRow
  try {
    const { rows } = await tx.query<RoleRow>(
      `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required, created_by)
       VALUES (app_tenant_id(), $1, $2, false, $3, current_setting('app.user_id')::uuid)
       RETURNING id, name, permissions, is_base, mfa_required`,
      [role.name, permissions, mfaRequired],
    )
    row = rows[0]!
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw nameTaken()
    throw error
  }
  await recordAudit(tx, {
    action: 'ROLE.CREATED', objectType: 'role', objectId: row.id, after: { name: row.name, permissions, mfa_required: mfaRequired },
  })
  return toView(row)
}
