import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  B2_UPDATED_BASE_ROLES,
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
const MIGRATION_0206 = new URL('../../../../packages/db/migrations/0206_b2_base_roles.sql', import.meta.url)

// TS-36 fixture (SDD-10 matrix, SEC-25 names, E-ADR-09). Changing a role's permissions must change this table.
const MATRIX: Readonly<Record<string, string>> = {
  'Tenant admin':
    'user.manage settings.manage import.manage mapping.edit mapping.approve compliance.read audit.read vendor_access.decide market.manage integration.manage participant.read order.read product.manage integration.read',
  'Commission analyst':
    'compliance.read participant.read genealogy.read case.genealogy.read order.read late.manage integration.read',
  'Plan administrator': 'compliance.read',
  'Finance approver': 'compliance.read participant.unmask plan.activate settings.approve participant.read order.read',
  'Payout officer': 'participant.unmask participant.read',
  'Compliance officer':
    'mapping.approve compliance.read snapshot.create export audit.read market.signoff participant.read participant.terminate participant_type.approve agreement.publish genealogy.read case.genealogy.read case.genealogy.approve case.duplicate.read case.duplicate.approve order.read',
  'Support agent':
    'participant.read participant.manage genealogy.read case.genealogy.read case.genealogy.create case.duplicate.read case.duplicate.create servicing.manage order.read',
  DPO: 'compliance.read audit.read participant.unmask participant.read privacy.manage',
  'Implementation consultant': 'import.manage mapping.edit',
  'Executive read-only': 'compliance.read',
  Integration: '',
}
// SEC-03 union (SECURITY_IAM_TENANCY conflict 1).
const MFA_ROLES = ['Tenant admin', 'Finance approver', 'Payout officer', 'Compliance officer', 'DPO']
// SEC-27: admin or approver roles.
const PRIVILEGED_ROLES = ['Tenant admin', 'Finance approver', 'Compliance officer', 'DPO']

describe('permission catalogue (TS-36 fixture)', () => {
  test('lists exactly the release A permissions, participant.unmask, plan.activate and the B1 and B2 additions', () => {
    expect([...PERMISSIONS].sort()).toEqual([
      'agreement.publish', 'audit.read', 'case.duplicate.approve', 'case.duplicate.create', 'case.duplicate.read',
      'case.genealogy.approve', 'case.genealogy.create', 'case.genealogy.read', 'compliance.read', 'export',
      'genealogy.read', 'import.manage', 'integration.manage', 'integration.read', 'late.manage', 'mapping.approve',
      'mapping.edit', 'market.manage', 'market.signoff', 'order.read', 'participant.manage', 'participant.read',
      'participant.terminate', 'participant.unmask', 'participant_type.approve', 'plan.activate', 'privacy.manage',
      'product.manage', 'servicing.manage', 'settings.approve', 'settings.manage', 'snapshot.create', 'user.manage',
      'vendor_access.decide',
    ])
  })

  test('B2 deciding, terminating, publishing and privacy permissions are privileged; reads and filing are not', () => {
    for (const permission of [
      'participant.terminate', 'participant_type.approve', 'agreement.publish', 'case.genealogy.approve',
      'case.duplicate.approve', 'privacy.manage',
    ] as const) expect(isPrivileged([permission])).toBe(true)
    expect(isPrivileged(BASE_ROLES.find((role) => role.name === 'Support agent')!.permissions)).toBe(false)
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

  test('migration 0206 brings exactly the B2-changed base roles to the catalogue', () => {
    expect(readFileSync(MIGRATION_0206, 'utf8')).toContain(renderBaseRoleUpdate(B2_UPDATED_BASE_ROLES))
  })

  test('0007, then 0106, then 0206 equals the catalogue: each role as its last migration leaves it', () => {
    const lastUpdate = new Map<string, string>()
    for (const file of [MIGRATION_0106, MIGRATION_0206]) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const name = /^UPDATE role .* name = '([^']+)';$/.exec(line)?.[1]
        if (name !== undefined) lastUpdate.set(name, line)
      }
    }
    // Strip the row separator so the last row (no comma) compares with the others.
    const seedRow = (seed: string, name: string) =>
      seed.split('\n').find((line) => line.includes(`'${name}'`))?.replace(/[,;]$/, '')

    for (const role of BASE_ROLES) {
      const updated = lastUpdate.get(role.name)
      if (updated === undefined) expect(seedRow(RELEASE_A_BASE_ROLES_SEED, role.name)).toBe(seedRow(renderBaseRoleSeed(), role.name))
      else expect(`${updated}\n`).toBe(renderBaseRoleUpdate([role.name]))
    }
    expect(RELEASE_A_BASE_ROLES_SEED.split('\n').length).toBe(renderBaseRoleSeed().split('\n').length)
  })
})
