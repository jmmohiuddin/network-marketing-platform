// Permission catalogue and base roles (E-ADR-09). One typed source: migration 0007 seeded the release A base roles
// (RELEASE_A_BASE_ROLES_SEED, frozen), migrations 0106 (B1), 0206 (B2), 0304 (B3) and 0405 (B4) bring the roles each increment
// changed to BASE_ROLES (renderBaseRoleUpdate, renderBaseRoleMfaUpdate), and permissions.test.ts pins the files, the
// catalogue and the TS-36 role matrix.

/**
 * Every role permission in release A (SECURITY_IAM_TENANCY 4.3, API 7) plus participant.unmask and plan.activate, and
 * the B1, B2, B3 and B4 additions (PLAN B1, B2, B3 and B4 section 3).
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
  'participant.read',
  'participant.manage',
  'participant.terminate',
  'participant_type.approve',
  'agreement.publish',
  'genealogy.read',
  'case.genealogy.read',
  'case.genealogy.create',
  'case.genealogy.approve',
  'case.duplicate.read',
  'case.duplicate.create',
  'case.duplicate.approve',
  'servicing.manage',
  'order.read',
  'product.manage',
  'late.manage',
  'integration.read',
  'privacy.manage',
  'plan.read',
  'plan.edit',
  'plan.approve',
  'plan.simulate',
  'period.read',
  'run.execute',
  'run.review',
  'run.commit',
  'trace.read',
  'restatement.request',
  'restatement.approve',
  'case.restatement.read',
  'guardrail.read',
  'override.approve',
  'ledger.read',
  'ledger.export',
  'payout.read',
  'payout.prepare',
  'payout.approve',
  'payout.reconcile',
  'payout.hold',
  'tax.manage',
  'case.adjustment.read',
  'case.adjustment.create',
  'case.adjustment.approve',
  'case.write_off.read',
  'case.write_off.create',
  'case.write_off.approve',
  'case.bank_detail.read',
  'case.bank_detail.create',
  'case.bank_detail.approve',
  'case.returned_payment.read',
  'case.returned_payment.create',
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
  'participant.terminate',
  'participant_type.approve',
  'agreement.publish',
  'case.genealogy.approve',
  'case.duplicate.approve',
  'privacy.manage',
  'plan.approve',
  'run.commit',
  'restatement.approve',
  'override.approve',
  'payout.approve',
  'case.adjustment.approve',
  'case.write_off.approve',
  'case.bank_detail.approve',
  'tax.manage',
]

// SEC-03: privileged roles and anyone who can unmask sensitive fields use MFA; a bank-detail change request needs a
// fresh second factor (AC-17.2), so its requester enrols one.
const MFA_PERMISSIONS: ReadonlySet<Permission> = new Set([
  ...PRIVILEGED_PERMISSIONS, 'participant.unmask', 'case.bank_detail.create',
])

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
// Integration has no permission; Support agent's arrive with B2, none privileged; B4's bank-detail requests need MFA.
export const BASE_ROLES: readonly BaseRole[] = [
  {
    name: 'Tenant admin',
    permissions: [
      'user.manage', 'settings.manage', 'import.manage', 'mapping.edit', 'mapping.approve', 'compliance.read',
      'audit.read', 'vendor_access.decide', 'market.manage', 'integration.manage', 'participant.read', 'order.read',
      'product.manage', 'integration.read', 'ledger.export',
    ],
    mfaRequired: true,
  },
  {
    name: 'Commission analyst',
    permissions: [
      'compliance.read', 'participant.read', 'genealogy.read', 'case.genealogy.read', 'order.read', 'late.manage',
      'integration.read', 'plan.read', 'period.read', 'run.execute', 'run.review', 'trace.read', 'restatement.request',
      'case.restatement.read', 'ledger.read', 'case.adjustment.read', 'case.adjustment.create', 'case.write_off.read',
      'case.write_off.create',
    ],
    mfaRequired: false,
  },
  {
    name: 'Plan administrator',
    permissions: ['compliance.read', 'plan.read', 'plan.edit', 'plan.simulate', 'period.read', 'guardrail.read'],
    mfaRequired: false,
  },
  {
    name: 'Finance approver',
    permissions: [
      'compliance.read', 'participant.unmask', 'plan.activate', 'settings.approve', 'participant.read', 'order.read',
      'plan.read', 'period.read', 'run.review', 'run.commit', 'trace.read', 'restatement.approve', 'case.restatement.read',
      'ledger.read', 'ledger.export', 'payout.read', 'payout.approve', 'tax.manage', 'case.adjustment.read',
      'case.adjustment.approve', 'case.write_off.read', 'case.write_off.create', 'case.write_off.approve',
      'case.returned_payment.read',
    ],
    mfaRequired: true,
  },
  {
    name: 'Payout officer',
    permissions: [
      'participant.unmask', 'participant.read', 'ledger.read', 'payout.read', 'payout.prepare', 'payout.reconcile',
      'payout.hold', 'case.bank_detail.read', 'case.returned_payment.read', 'case.returned_payment.create',
    ],
    mfaRequired: true,
  },
  {
    name: 'Compliance officer',
    permissions: [
      'mapping.approve', 'compliance.read', 'snapshot.create', 'export', 'audit.read', 'market.signoff',
      'participant.read', 'participant.terminate', 'participant_type.approve', 'agreement.publish', 'genealogy.read',
      'case.genealogy.read', 'case.genealogy.approve', 'case.duplicate.read', 'case.duplicate.approve', 'order.read',
      'plan.read', 'plan.approve', 'period.read', 'run.review', 'trace.read', 'restatement.request', 'case.restatement.read',
      'guardrail.read', 'override.approve', 'ledger.read', 'payout.read', 'payout.hold', 'case.adjustment.read',
      'case.write_off.read', 'case.bank_detail.read', 'case.bank_detail.approve',
    ],
    mfaRequired: true,
  },
  {
    name: 'Support agent',
    permissions: [
      'participant.read', 'participant.manage', 'genealogy.read', 'case.genealogy.read', 'case.genealogy.create',
      'case.duplicate.read', 'case.duplicate.create', 'servicing.manage', 'order.read', 'period.read', 'run.review',
      'trace.read', 'case.bank_detail.read', 'case.bank_detail.create',
    ],
    mfaRequired: true,
  },
  {
    name: 'DPO',
    permissions: ['compliance.read', 'audit.read', 'participant.unmask', 'participant.read', 'privacy.manage'],
    mfaRequired: true,
  },
  {
    name: 'Implementation consultant',
    permissions: ['import.manage', 'mapping.edit', 'plan.read', 'plan.edit', 'plan.simulate', 'period.read'],
    mfaRequired: false,
  },
  { name: 'Executive read-only', permissions: ['compliance.read', 'plan.read', 'period.read'], mfaRequired: false },
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

/** The base roles whose permissions B4 changed (PLAN B4 section 3); migration 0405 updates exactly these. */
export const B4_UPDATED_BASE_ROLES: readonly BaseRoleName[] = [
  'Tenant admin', 'Commission analyst', 'Finance approver', 'Payout officer', 'Compliance officer', 'Support agent',
]

/** The base roles whose MFA flag B4 changed (Support agent: bank-detail requests); migration 0405 updates exactly these. */
export const B4_MFA_CHANGED_BASE_ROLES: readonly BaseRoleName[] = ['Support agent']

/** The SQL that brings the named base roles to their BASE_ROLES permissions. */
export function renderBaseRoleUpdate(names: readonly BaseRoleName[]): string {
  return names
    .map((name) => {
      const role = BASE_ROLES.find((candidate) => candidate.name === name)!
      return `UPDATE role SET permissions = '{${role.permissions.join(',')}}'::text[] WHERE is_base AND tenant_id IS NULL AND name = '${name}';\n`
    })
    .join('')
}

/** The SQL that brings the named base roles' MFA flag to BASE_ROLES (one statement per role). */
export function renderBaseRoleMfaUpdate(names: readonly BaseRoleName[]): string {
  return names
    .map((name) => {
      const role = BASE_ROLES.find((candidate) => candidate.name === name)!
      return `UPDATE role SET mfa_required = ${String(role.mfaRequired)} WHERE is_base AND tenant_id IS NULL AND name IN ('${name}');\n`
    })
    .join('')
}
