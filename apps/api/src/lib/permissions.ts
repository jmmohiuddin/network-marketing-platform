// Permission catalogue and base roles (E-ADR-09). One typed source: migration 0007 seeded the release A base roles
// (RELEASE_A_BASE_ROLES_SEED, frozen), migration 0106 brings them to BASE_ROLES (renderBaseRoleUpdate), and
// permissions.test.ts pins both files, the catalogue and the TS-36 role matrix.

/**
 * Every role permission in release A (SECURITY_IAM_TENANCY 4.3, API 7) plus participant.unmask and plan.activate, and
 * the B1 additions (PLAN B1 section 3).
 */
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
  'settings.approve',
  'market.manage',
  'market.signoff',
  'integration.manage',
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
  'settings.approve',
  'market.signoff',
  'integration.manage',
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
      'audit.read', 'vendor_access.decide', 'market.manage', 'integration.manage',
    ],
    mfaRequired: true,
  },
  { name: 'Commission analyst', permissions: ['compliance.read'], mfaRequired: false },
  { name: 'Plan administrator', permissions: ['compliance.read'], mfaRequired: false },
  {
    name: 'Finance approver',
    permissions: ['compliance.read', 'participant.unmask', 'plan.activate', 'settings.approve'],
    mfaRequired: true,
  },
  { name: 'Payout officer', permissions: ['participant.unmask'], mfaRequired: true },
  {
    name: 'Compliance officer',
    permissions: ['mapping.approve', 'compliance.read', 'snapshot.create', 'export', 'audit.read', 'market.signoff'],
    mfaRequired: true,
  },
  { name: 'Support agent', permissions: [], mfaRequired: false },
  { name: 'DPO', permissions: ['compliance.read', 'audit.read', 'participant.unmask'], mfaRequired: true },
  { name: 'Implementation consultant', permissions: ['import.manage', 'mapping.edit'], mfaRequired: false },
  { name: 'Executive read-only', permissions: ['compliance.read'], mfaRequired: false },
  { name: 'Integration', permissions: [], mfaRequired: false },
]

/** The SQL that seeds BASE_ROLES (test fixtures seed the current base roles with it). */
export function renderBaseRoleSeed(): string {
  const rows = BASE_ROLES.map(
    (role) => `  (NULL, '${role.name}', '{${role.permissions.join(',')}}'::text[], true, ${String(role.mfaRequired)})`,
  )
  return `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES\n${rows.join(',\n')};\n`
}

/** Migration 0007 contains exactly this text: the release A base roles. Frozen, because an applied migration never changes. */
export const RELEASE_A_BASE_ROLES_SEED = `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES
  (NULL, 'Tenant admin', '{user.manage,settings.manage,import.manage,mapping.edit,mapping.approve,compliance.read,audit.read,vendor_access.decide}'::text[], true, true),
  (NULL, 'Commission analyst', '{compliance.read}'::text[], true, false),
  (NULL, 'Plan administrator', '{compliance.read}'::text[], true, false),
  (NULL, 'Finance approver', '{compliance.read,participant.unmask,plan.activate}'::text[], true, true),
  (NULL, 'Payout officer', '{participant.unmask}'::text[], true, true),
  (NULL, 'Compliance officer', '{mapping.approve,compliance.read,snapshot.create,export,audit.read}'::text[], true, true),
  (NULL, 'Support agent', '{}'::text[], true, false),
  (NULL, 'DPO', '{compliance.read,audit.read,participant.unmask}'::text[], true, true),
  (NULL, 'Implementation consultant', '{import.manage,mapping.edit}'::text[], true, false),
  (NULL, 'Executive read-only', '{compliance.read}'::text[], true, false),
  (NULL, 'Integration', '{}'::text[], true, false);
`

/** The base roles whose permissions B1 changed (PLAN B1 section 3); migration 0106 updates exactly these. */
export const B1_UPDATED_BASE_ROLES: readonly BaseRoleName[] = ['Tenant admin', 'Finance approver', 'Compliance officer']

/** The SQL that brings the named base roles to their BASE_ROLES permissions. */
export function renderBaseRoleUpdate(names: readonly BaseRoleName[]): string {
  return names
    .map((name) => {
      const role = BASE_ROLES.find((candidate) => candidate.name === name)!
      return `UPDATE role SET permissions = '{${role.permissions.join(',')}}'::text[] WHERE is_base AND tenant_id IS NULL AND name = '${name}';\n`
    })
    .join('')
}
