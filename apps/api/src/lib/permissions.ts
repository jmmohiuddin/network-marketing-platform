// Permission catalogue and base roles (E-ADR-09). One typed source: the 0007 migration seeds the base roles
// from renderBaseRoleSeed(), and permissions.test.ts pins both the catalogue and the TS-36 role matrix.

/** Every role permission in release A (SECURITY_IAM_TENANCY 4.3, API 7) plus participant.unmask and plan.activate. */
export const PERMISSIONS = [
  'import.manage',
  'mapping.edit',
  'mapping.approve',
  'snapshot.create',
  'compliance.read',
  'export',
  'audit.read',
  'vendor_access.decide',
  'settings.manage',
  'user.manage',
  'participant.unmask',
  'plan.activate',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS)

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value)
}

/** Holding any of these makes a role an admin or approver role: granting it needs a second admin (SEC-27). */
export const PRIVILEGED_PERMISSIONS: readonly Permission[] = [
  'user.manage',
  'settings.manage',
  'vendor_access.decide',
  'mapping.approve',
  'plan.activate',
]

// SEC-03: privileged roles and anyone who can unmask sensitive fields use MFA.
const MFA_PERMISSIONS: ReadonlySet<Permission> = new Set([...PRIVILEGED_PERMISSIONS, 'participant.unmask'])

export function isPrivileged(permissions: readonly string[]): boolean {
  return permissions.some((permission) => (PRIVILEGED_PERMISSIONS as readonly string[]).includes(permission))
}

export function requiresMfa(permissions: readonly string[]): boolean {
  return permissions.some((permission) => isPermission(permission) && MFA_PERMISSIONS.has(permission))
}

export type BaseRoleName =
  | 'Tenant admin' | 'Commission analyst' | 'Plan administrator' | 'Finance approver' | 'Payout officer'
  | 'Compliance officer' | 'Support agent' | 'DPO' | 'Implementation consultant' | 'Executive read-only'
  | 'Integration'

export interface BaseRole {
  readonly name: BaseRoleName
  readonly permissions: readonly Permission[]
  readonly mfaRequired: boolean
}

// SEC-25 names; permission sets from the SDD-10 matrix (SECURITY_IAM_TENANCY 4.4), restricted to the catalogue.
// Implementation consultant has no matrix column: its set follows the personas of SC-24 and SC-25 (MVP_A 1.3).
// Support agent and Integration have no release-A permission.
export const BASE_ROLES: readonly BaseRole[] = [
  {
    name: 'Tenant admin',
    permissions: [
      'user.manage', 'settings.manage', 'import.manage', 'mapping.edit', 'mapping.approve', 'compliance.read',
      'audit.read', 'vendor_access.decide',
    ],
    mfaRequired: true,
  },
  { name: 'Commission analyst', permissions: ['compliance.read'], mfaRequired: false },
  { name: 'Plan administrator', permissions: ['compliance.read'], mfaRequired: false },
  { name: 'Finance approver', permissions: ['compliance.read', 'participant.unmask', 'plan.activate'], mfaRequired: true },
  { name: 'Payout officer', permissions: ['participant.unmask'], mfaRequired: true },
  {
    name: 'Compliance officer',
    permissions: ['mapping.approve', 'compliance.read', 'snapshot.create', 'export', 'audit.read'],
    mfaRequired: true,
  },
  { name: 'Support agent', permissions: [], mfaRequired: false },
  { name: 'DPO', permissions: ['compliance.read', 'audit.read', 'participant.unmask'], mfaRequired: true },
  { name: 'Implementation consultant', permissions: ['import.manage', 'mapping.edit'], mfaRequired: false },
  { name: 'Executive read-only', permissions: ['compliance.read'], mfaRequired: false },
  { name: 'Integration', permissions: [], mfaRequired: false },
]

/** The SQL that seeds BASE_ROLES. Migration 0007 contains exactly this text (pinned by a test). */
export function renderBaseRoleSeed(): string {
  const rows = BASE_ROLES.map(
    (role) => `  (NULL, '${role.name}', '{${role.permissions.join(',')}}'::text[], true, ${String(role.mfaRequired)})`,
  )
  return `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES\n${rows.join(',\n')};\n`
}
