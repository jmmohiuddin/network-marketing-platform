import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  B1_UPDATED_BASE_ROLES,
  BASE_ROLES,
  isPrivileged,
  PERMISSIONS,
  RELEASE_A_BASE_ROLES_SEED,
  renderBaseRoleSeed,
  renderBaseRoleUpdate,
  requiresMfa,
} from './permissions.js'

const MIGRATION_0007 = new URL('../../../../packages/db/migrations/0007_iam_api.sql', import.meta.url)
const MIGRATION_0106 = new URL('../../../../packages/db/migrations/0106_b1_base_roles.sql', import.meta.url)

// TS-36 fixture (SDD-10 matrix, SEC-25 names, E-ADR-09). Changing a role's permissions must change this table.
const MATRIX: Readonly<Record<string, string>> = {
  'Tenant admin':
    'user.manage settings.manage import.manage mapping.edit mapping.approve compliance.read audit.read vendor_access.decide market.manage integration.manage',
  'Commission analyst': 'compliance.read',
  'Plan administrator': 'compliance.read',
  'Finance approver': 'compliance.read participant.unmask plan.activate settings.approve',
  'Payout officer': 'participant.unmask',
  'Compliance officer': 'mapping.approve compliance.read snapshot.create export audit.read market.signoff',
  'Support agent': '',
  DPO: 'compliance.read audit.read participant.unmask',
  'Implementation consultant': 'import.manage mapping.edit',
  'Executive read-only': 'compliance.read',
  Integration: '',
}
// SEC-03 union (SECURITY_IAM_TENANCY conflict 1).
const MFA_ROLES = ['Tenant admin', 'Finance approver', 'Payout officer', 'Compliance officer', 'DPO']
// SEC-27: admin or approver roles.
const PRIVILEGED_ROLES = ['Tenant admin', 'Finance approver', 'Compliance officer']

describe('permission catalogue (TS-36 fixture)', () => {
  test('lists exactly the release A permissions, participant.unmask, plan.activate and the B1 additions', () => {
    expect([...PERMISSIONS].sort()).toEqual([
      'audit.read', 'compliance.read', 'export', 'import.manage', 'integration.manage', 'mapping.approve',
      'mapping.edit', 'market.manage', 'market.signoff', 'participant.unmask', 'plan.activate', 'settings.approve',
      'settings.manage', 'snapshot.create', 'user.manage', 'vendor_access.decide',
    ])
  })

  test('B1 approving and credential permissions are privileged; market.manage is not', () => {
    expect(isPrivileged(['settings.approve'])).toBe(true)
    expect(isPrivileged(['market.signoff'])).toBe(true)
    expect(isPrivileged(['integration.manage'])).toBe(true)
    expect(isPrivileged(['market.manage'])).toBe(false)
  })

  test('has the 11 SEC-25 base roles with the matrix permissions', () => {
    const actual = Object.fromEntries(BASE_ROLES.map((role) => [role.name, role.permissions.join(' ')]))

    expect(actual).toEqual(MATRIX)
  })

  test('flags MFA for the SEC-03 roles and privilege for admin and approver roles', () => {
    expect(BASE_ROLES.filter((role) => role.mfaRequired).map((role) => role.name)).toEqual(MFA_ROLES)
    expect(BASE_ROLES.filter((role) => isPrivileged(role.permissions)).map((role) => role.name)).toEqual(PRIVILEGED_ROLES)
  })

  test('every privileged base role requires MFA, and so does any custom role with those permissions', () => {
    const privileged = BASE_ROLES.filter((role) => isPrivileged(role.permissions))

    expect(privileged.every((role) => role.mfaRequired)).toBe(true)
    expect(requiresMfa(['plan.activate'])).toBe(true)
    expect(requiresMfa(['participant.unmask'])).toBe(true)
    expect(requiresMfa(['compliance.read', 'export'])).toBe(false)
  })

  test('migration 0007 seeds the frozen release A base roles', () => {
    expect(readFileSync(MIGRATION_0007, 'utf8')).toContain(RELEASE_A_BASE_ROLES_SEED)
  })

  test('migration 0106 brings exactly the B1-changed base roles to the catalogue', () => {
    expect(readFileSync(MIGRATION_0106, 'utf8')).toContain(renderBaseRoleUpdate(B1_UPDATED_BASE_ROLES))
  })

  test('0007 plus 0106 equals the catalogue: every role 0106 leaves alone is seeded as in BASE_ROLES', () => {
    const current = renderBaseRoleSeed().split('\n')
    const frozen = RELEASE_A_BASE_ROLES_SEED.split('\n')
    const unchanged = (line: string) => !B1_UPDATED_BASE_ROLES.some((name) => line.includes(`'${name}'`))
    // Strip the row separator so the last row (no comma) compares with the others.
    const rows = (lines: string[]) => lines.filter(unchanged).map((line) => line.replace(/[,;]$/, ''))

    expect(rows(current)).toEqual(rows(frozen))
    expect(frozen.length).toBe(current.length)
  })
})
