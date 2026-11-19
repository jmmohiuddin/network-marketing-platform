import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  B4_MFA_CHANGED_BASE_ROLES,
  B4_UPDATED_BASE_ROLES,
  B5_UPDATED_BASE_ROLES,
  BASE_ROLES,
  isPrivileged,
  PERMISSIONS,
  RELEASE_A_BASE_ROLES_SEED,
  renderBaseRoleMfaUpdate,
  renderBaseRoleSeed,
  renderBaseRoleUpdate,
  requiresMfa,
} from './permissions.js'

const MIGRATION_0007 = new URL('../../../../packages/db/migrations/0007_iam_api.sql', import.meta.url)
const MIGRATION_0106 = new URL('../../../../packages/db/migrations/0106_b1_base_roles.sql', import.meta.url)
const MIGRATION_0206 = new URL('../../../../packages/db/migrations/0206_b2_base_roles.sql', import.meta.url)
const MIGRATION_0304 = new URL('../../../../packages/db/migrations/0304_b3_base_roles.sql', import.meta.url)
const MIGRATION_0405 = new URL('../../../../packages/db/migrations/0405_b4_base_roles.sql', import.meta.url)
const MIGRATION_0505 = new URL('../../../../packages/db/migrations/0505_b5_base_roles_settings.sql', import.meta.url)

// TS-36 fixture (SDD-10 matrix, SEC-25 names, E-ADR-09). Changing a role's permissions must change this table.
const MATRIX: Readonly<Record<string, string>> = {
  'Tenant admin':
    'user.manage settings.manage import.manage mapping.edit mapping.approve compliance.read audit.read vendor_access.decide market.manage integration.manage participant.read order.read product.manage integration.read ledger.export',
  'Commission analyst':
    'compliance.read participant.read genealogy.read case.genealogy.read order.read late.manage integration.read plan.read period.read run.execute run.review trace.read restatement.request case.restatement.read ledger.read case.adjustment.read case.adjustment.create case.write_off.read case.write_off.create case.dispute.read case.dispute.approve',
  'Plan administrator': 'compliance.read plan.read plan.edit plan.simulate period.read guardrail.read',
  'Finance approver':
    'compliance.read participant.unmask plan.activate settings.approve participant.read order.read plan.read period.read run.review run.commit trace.read restatement.approve case.restatement.read ledger.read ledger.export payout.read payout.approve tax.manage case.adjustment.read case.adjustment.approve case.write_off.read case.write_off.create case.write_off.approve case.returned_payment.read case.dispute.read',
  'Payout officer':
    'participant.unmask participant.read ledger.read payout.read payout.prepare payout.reconcile payout.hold case.bank_detail.read case.returned_payment.read case.returned_payment.create',
  'Compliance officer':
    'mapping.approve compliance.read snapshot.create export audit.read market.signoff participant.read participant.terminate participant_type.approve agreement.publish genealogy.read case.genealogy.read case.genealogy.approve case.duplicate.read case.duplicate.approve order.read plan.read plan.approve period.read run.review trace.read restatement.request case.restatement.read guardrail.read override.approve ledger.read payout.read payout.hold case.adjustment.read case.write_off.read case.bank_detail.read case.bank_detail.approve case.dispute.read',
  'Support agent':
    'participant.read participant.manage genealogy.read case.genealogy.read case.genealogy.create case.duplicate.read case.duplicate.create servicing.manage order.read period.read run.review trace.read case.bank_detail.read case.bank_detail.create case.dispute.read',
  DPO: 'compliance.read audit.read participant.unmask participant.read privacy.manage',
  'Implementation consultant': 'import.manage mapping.edit plan.read plan.edit plan.simulate period.read',
  'Executive read-only': 'compliance.read plan.read period.read',
  Integration: '',
}
// SEC-03 union (SECURITY_IAM_TENANCY conflict 1), plus Support agent for bank-detail requests (PLAN B4 section 3).
const MFA_ROLES = ['Tenant admin', 'Finance approver', 'Payout officer', 'Compliance officer', 'Support agent', 'DPO']
// SEC-27: admin or approver roles.
const PRIVILEGED_ROLES = ['Tenant admin', 'Finance approver', 'Compliance officer', 'DPO']

describe('permission catalogue (TS-36 fixture)', () => {
  test('lists exactly the release A permissions, participant.unmask, plan.activate and the B1..B5 additions', () => {
    expect([...PERMISSIONS].sort()).toEqual([
      'agreement.publish', 'audit.read', 'case.adjustment.approve', 'case.adjustment.create', 'case.adjustment.read',
      'case.bank_detail.approve', 'case.bank_detail.create', 'case.bank_detail.read', 'case.dispute.approve',
      'case.dispute.read', 'case.duplicate.approve',
      'case.duplicate.create', 'case.duplicate.read', 'case.genealogy.approve', 'case.genealogy.create',
      'case.genealogy.read', 'case.restatement.read', 'case.returned_payment.create', 'case.returned_payment.read',
      'case.write_off.approve', 'case.write_off.create', 'case.write_off.read', 'compliance.read', 'export',
      'genealogy.read', 'guardrail.read', 'import.manage', 'integration.manage', 'integration.read', 'late.manage',
      'ledger.export', 'ledger.read', 'mapping.approve', 'mapping.edit', 'market.manage', 'market.signoff', 'order.read',
      'override.approve', 'participant.manage', 'participant.read', 'participant.terminate', 'participant.unmask',
      'participant_type.approve', 'payout.approve', 'payout.hold', 'payout.prepare', 'payout.read', 'payout.reconcile',
      'period.read', 'plan.activate', 'plan.approve', 'plan.edit', 'plan.read', 'plan.simulate', 'privacy.manage',
      'product.manage', 'restatement.approve', 'restatement.request', 'run.commit', 'run.execute', 'run.review',
      'servicing.manage', 'settings.approve', 'settings.manage', 'snapshot.create', 'tax.manage', 'trace.read',
      'user.manage', 'vendor_access.decide',
    ])
  })

  test('B4 deciding and tax permissions are privileged; preparing, reconciling, holding, proposing and reads are not', () => {
    for (const permission of [
      'payout.approve', 'case.adjustment.approve', 'case.write_off.approve', 'case.bank_detail.approve', 'tax.manage',
    ] as const) expect(isPrivileged([permission])).toBe(true)
    for (const permission of [
      'ledger.read', 'ledger.export', 'payout.read', 'payout.prepare', 'payout.reconcile', 'payout.hold',
      'case.adjustment.create', 'case.write_off.create', 'case.bank_detail.create', 'case.returned_payment.create',
    ] as const) expect(isPrivileged([permission])).toBe(false)
    expect(requiresMfa(['case.bank_detail.create'])).toBe(true)
    expect(requiresMfa(['payout.prepare', 'ledger.read'])).toBe(false)
  })

  test('B5 dispute permissions are not privileged (PLAN B5 section 3)', () => {
    expect(isPrivileged(['case.dispute.read', 'case.dispute.approve'])).toBe(false)
    expect(requiresMfa(['case.dispute.approve'])).toBe(false)
  })

  test('B2 deciding, terminating, publishing and privacy permissions are privileged; reads and filing are not', () => {
    for (const permission of [
      'participant.terminate', 'participant_type.approve', 'agreement.publish', 'case.genealogy.approve',
      'case.duplicate.approve', 'privacy.manage',
    ] as const) expect(isPrivileged([permission])).toBe(true)
    expect(isPrivileged(BASE_ROLES.find((role) => role.name === 'Support agent')!.permissions)).toBe(false)
  })

  test('B3 approving, committing and overriding permissions are privileged; authoring, running and reads are not', () => {
    for (const permission of ['plan.approve', 'run.commit', 'restatement.approve', 'override.approve'] as const) {
      expect(isPrivileged([permission])).toBe(true)
    }
    for (const role of ['Plan administrator', 'Commission analyst', 'Support agent', 'Implementation consultant'] as const) {
      expect(isPrivileged(BASE_ROLES.find((base) => base.name === role)!.permissions)).toBe(false)
    }
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

  test('migration 0405 updates exactly the B4-changed base roles, and brings the MFA flags B4 changed to the catalogue', () => {
    const migration = readFileSync(MIGRATION_0405, 'utf8')
    const updated = migration.split('\n').flatMap((line) => /^UPDATE role SET permissions .* name = '([^']+)';$/.exec(line)?.[1] ?? [])

    // The permissions B4 wrote are pinned by the last-update test below (later increments extend some of these roles).
    expect(updated).toEqual([...B4_UPDATED_BASE_ROLES])
    expect(migration).toContain(renderBaseRoleMfaUpdate(B4_MFA_CHANGED_BASE_ROLES))
    // Every other base role keeps the MFA flag 0007 seeded.
    for (const role of BASE_ROLES.filter((base) => !B4_MFA_CHANGED_BASE_ROLES.includes(base.name))) {
      expect(RELEASE_A_BASE_ROLES_SEED.split('\n').find((line) => line.includes(`'${role.name}'`))).toMatch(
        new RegExp(`, true, ${String(role.mfaRequired)}\\)[,;]?$`),
      )
    }
  })

  test('migration 0505 brings exactly the B5-changed base roles to the catalogue', () => {
    expect(readFileSync(MIGRATION_0505, 'utf8')).toContain(renderBaseRoleUpdate(B5_UPDATED_BASE_ROLES))
  })

  test('0007, then 0106, 0206, 0304, 0405 and 0505 equals the catalogue: each role as its last migration leaves it', () => {
    const lastUpdate = new Map<string, string>()
    for (const file of [MIGRATION_0106, MIGRATION_0206, MIGRATION_0304, MIGRATION_0405, MIGRATION_0505]) {
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
