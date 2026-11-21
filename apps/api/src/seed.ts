// Local development data (nmp_dev) and the browser-test seed (nmp_e2e, `pnpm --filter @nmp/api seed:e2e`): two
// independent vendor operators with MFA (BUG-031: bootstrap users, no inviter, so either can be the other's second
// person) and two tenants with staff (no MFA: their forced enrolment is part of the browser test). nmp_e2e also gets the
// labelled fixture market pack and markets (PLAN B1, B2, B3, B4, B6, B-MKT and V1-A section 6).
// Idempotent: existing rows are kept and their passwords are not changed. Refuses production, any database but the
// local ones, and any database server not on this machine.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { closePool, withSystem, type Tx } from '@nmp/db'
import { closeOwnerPool, getOwnerPool } from '@nmp/db/testing'
import { pathToFileURL } from 'node:url'
import { loadConfig, type Config } from './config.js'
import { recordAudit, recordVendorAudit } from './lib/audit.js'
import { runInTenant, runInVendor, SYSTEM_ACTOR_ID, type ActorContext } from './lib/db.js'
import { hashPassword } from './lib/passwords.js'
import { bankFingerprint, BankDetails, bankVersionContext, maskAccount } from './lib/bank-crypto.js'
import { BASE_ROLES, isPrivileged, type BaseRoleName } from './lib/permissions.js'
import { seal } from './lib/secret-box.js'
import { generateTotpSecret, totpUri } from './lib/totp.js'
import { recordStructureChange } from './modules/ten/index.js'

const SYSTEM: ActorContext = { actorType: 'system', requestId: 'seed', supportSessionId: null }
const VENDORS = [
  { email: 'operator@vendor.example', name: 'Vendor Operator' },
  { email: 'operator2@vendor.example', name: 'Second Vendor Operator' },
] as const
const TENANTS = [
  { slug: 'acme', legalName: 'Acme Direct Ltd' },
  { slug: 'globex', legalName: 'Globex Wellness Ltd' },
] as const
const STAFF: readonly { local: string; name: string; role: BaseRoleName }[] = [
  { local: 'admin', name: 'Tenant Admin', role: 'Tenant admin' },
  { local: 'admin2', name: 'Second Admin', role: 'Tenant admin' },
  { local: 'compliance', name: 'Compliance Officer', role: 'Compliance officer' },
  { local: 'compliance2', name: 'Second Compliance Officer', role: 'Compliance officer' }, // V1-A: related party of BE-E
  { local: 'finance', name: 'Finance Approver', role: 'Finance approver' },
  { local: 'finance2', name: 'Second Finance Approver', role: 'Finance approver' }, // B4 second approvals
  { local: 'analyst', name: 'Commission Analyst', role: 'Commission analyst' },
  { local: 'support', name: 'Support Agent', role: 'Support agent' },
  { local: 'support2', name: 'Second Support Agent', role: 'Support agent' }, // V1-A: a second participant.manage holder (SEC-BM-7)
  { local: 'dpo', name: 'Data Protection Officer', role: 'DPO' },
  { local: 'dpo2', name: 'Second Data Protection Officer', role: 'DPO' }, // B5 privacy decisions need a second DPO
  { local: 'planadmin', name: 'Plan Administrator', role: 'Plan administrator' },
  { local: 'payout', name: 'Payout Officer', role: 'Payout officer' },
  // BUG-111: the result file is imported by someone other than the preparer of its batch or bank file (SOD-01).
  { local: 'payout2', name: 'Second Payout Officer', role: 'Payout officer' },
  { local: 'consultant', name: 'Implementation Consultant', role: 'Implementation consultant' },
  { local: 'executive', name: 'Executive Read-only', role: 'Executive read-only' },
]

/** Staging opt-in: both the flag and the environment variable, like create-vendor-user, so a copied command is not enough. */
export const STAGING_FLAG = '--i-understand'
export const STAGING_ENV = 'NMP_ALLOW_STAGING_SEED'

// The two admins are the bootstrap grants of provisioning; every other privileged grant needs a second admin's approval.
const needsApproval = (role: BaseRoleName): boolean =>
  role !== 'Tenant admin' && isPrivileged(BASE_ROLES.find((base) => base.name === role)!.permissions)

type Print = (line: string) => void

// Credentials are reachable only by their own user (0040, BUG-002): the seed writes them as that user, then acts as
// the system again.
async function asSelf<T>(tx: Tx, userId: string, write: () => Promise<T>): Promise<T> {
  await tx.query(`SELECT set_config('app.user_id', $1, true)`, [userId])
  const result = await write()
  await tx.query(`SELECT set_config('app.user_id', $1, true)`, [SYSTEM_ACTOR_ID])
  return result
}

async function insertUser(tx: Tx, user: { tenantId: string | null; email: string; name: string; passwordHash: string }) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, display_name, state, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', NULL) RETURNING id`,
    [user.tenantId, user.tenantId === null ? 'vendor' : 'tenant', `local:${randomUUID()}`, user.email, user.name],
  )
  const id = rows[0]!.id
  await asSelf(tx, id, () =>
    tx.query('INSERT INTO password_credential (user_id, password_hash) VALUES ($1, $2)', [id, user.passwordHash]),
  )
  return id
}

async function existingUser(tx: Tx, email: string): Promise<string | undefined> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM user_account WHERE email = $1', [email])
  return rows[0]?.id
}

/** A vendor operator, MFA enrolled (all vendor staff use MFA, SEC-03). printTotp: print its otpauth URI once. */
async function seedVendor(
  config: Config, vendor: (typeof VENDORS)[number], passwordHash: string, printTotp: boolean, print: Print,
): Promise<boolean> {
  return runInVendor(SYSTEM_ACTOR_ID, SYSTEM, async (tx) => {
    if ((await existingUser(tx, vendor.email)) !== undefined) return false
    const id = await insertUser(tx, { tenantId: null, email: vendor.email, name: vendor.name, passwordHash })
    const secret = generateTotpSecret()
    await asSelf(tx, id, () =>
      tx.query(
        `INSERT INTO mfa_credential (user_id, type, secret_encrypted, confirmed_at) VALUES ($1, 'totp', $2, now())`,
        [id, seal(config.secretKey, secret, id)],
      ),
    )
    await tx.query('UPDATE user_account SET mfa_enrolled = true WHERE id = $1', [id])
    await recordVendorAudit(tx, { action: 'SEED.USER_CREATED', objectType: 'user_account', objectId: id })
    print(`vendor: ${vendor.email}`)
    // Local databases only (assertSeedable): the operator, or the browser test, needs it once for an authenticator.
    if (printTotp) print(`vendor TOTP: ${totpUri(vendor.email, secret)}`)
    return true
  })
}

async function upsertTenant(slug: string, legalName: string): Promise<string> {
  return runInVendor(SYSTEM_ACTOR_ID, SYSTEM, async (tx) => {
    await tx.query(
      `INSERT INTO tenant (legal_name, slug, region, isolation_tier, db_route, state)
       VALUES ($1, $2, 'eu', 'pooled', 'pooled', 'implementation') ON CONFLICT (slug) DO NOTHING`,
      [legalName, slug],
    )
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM tenant WHERE slug = $1', [slug])
    return rows[0]!.id
  })
}

async function grant(tx: Tx, assignmentId: string, userId: string, role: BaseRoleName, approvalId: string | null) {
  await tx.query(
    `INSERT INTO role_assignment (id, tenant_id, user_id, role_id, valid_from, approval_id)
     SELECT $1, app_tenant_id(), $2, r.id, now(), $4 FROM role r WHERE r.tenant_id IS NULL AND r.name = $3`,
    [assignmentId, userId, role, approvalId],
  )
  await recordAudit(tx, {
    action: 'ROLE.GRANTED', objectType: 'role_assignment', objectId: assignmentId, after: { user_id: userId, role, approval_id: approvalId },
  })
}

// Privileged grants carry an approval by the second admin, prepared by the first, as the API would record them;
// the approval is written as its approver (0107: approver_id = app.user_id).
async function grantStaffRoles(tx: Tx, ids: ReadonlyMap<string, string>): Promise<void> {
  for (const member of STAFF) {
    const userId = ids.get(member.local)!
    const assignmentId = randomUUID()
    if (!needsApproval(member.role)) {
      await grant(tx, assignmentId, userId, member.role, null)
      continue
    }
    const approver = ids.get('admin2')!
    const { rows } = await asSelf(tx, approver, () =>
      tx.query<{ id: string }>(
        `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, decided_at)
         VALUES (app_tenant_id(), 'role_assignment', $1, $2, $3, 'approved', 'seed', now()) RETURNING id`,
        [assignmentId, ids.get('admin'), approver],
      ),
    )
    await grant(tx, assignmentId, userId, member.role, rows[0]!.id)
  }
}

async function seedTenant(slug: string, legalName: string, passwordHash: string, print: Print): Promise<boolean> {
  const tenantId = await upsertTenant(slug, legalName)
  return runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, SYSTEM, async (tx) => {
    // D-B1-17: a market starts draft and goes live only through its launch checklist.
    await tx.query(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES (app_tenant_id(), 'DEMO', 'GBP', 2, 'Europe/London', '{en}', 'none', 'draft') ON CONFLICT DO NOTHING`,
    )
    if ((await existingUser(tx, `admin@${slug}.example`)) !== undefined) return false
    const ids = new Map<string, string>()
    for (const member of STAFF) {
      const email = `${member.local}@${slug}.example`
      ids.set(member.local, await insertUser(tx, { tenantId, email, name: member.name, passwordHash }))
      print(`${slug}: ${email} (${member.role})`)
    }
    await grantStaffRoles(tx, ids)
    return true
  })
}

const E2E_DATABASE = 'nmp_e2e'
export const E2E_FIXTURE_PACK = 'e2e-fixture'
/** PLAN B-MKT section 6: the labelled tax fixture pack of market AT (withholding, year-end form, registers). */
export const E2E_TAX_PACK = 'e2e-fixture-tax'

/** The owner connection, refused unless it is on the database the app seeds (MIGRATE_DATABASE_URL, .env: nmp_dev). */
async function ownerOn(expectedDatabase: string, what: string) {
  const owner = getOwnerPool()
  const { rows } = await owner.query<{ name: string }>('SELECT current_database() AS name')
  if (rows[0]?.name !== expectedDatabase) {
    throw new Error(`seed refuses the fixture ${what}: the owner connection is on ${rows[0]?.name}, not ${expectedDatabase}`)
  }
  return owner
}

/**
 * PLAN B1 section 6: a labelled fixture market pack for the browser tests (no real pack data ships, DEC-14). Pack
 * rules are platform tables only migrations or the owner write, so this goes through the owner connection. PLAN B3
 * section 6: the guardrail rules carry the checks CPL evaluates (blocked enrolment-only pay, warned starter-kit
 * volume). Idempotent; an older enrolment-only row gets the B3 predicate.
 */
export async function seedFixturePack(expectedDatabase: string): Promise<void> {
  const owner = await ownerOn(expectedDatabase, 'pack')
  await owner.query(
    `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status,
       source_ref, effective_from)
     VALUES ('e2e-enrolment-only-bonus@2026-01-01', $1, 'E2E FIXTURE — enrolment-only bonus', 'blocked',
       '{"check": "enrolment_only_pay"}', false, true, 'E2E fixture basis, not a real market rule', 'screening',
       'E2E fixture, not a real market rule', '2026-01-01'),
       ('e2e-starter-kit-volume@2026-01-01', $1, 'E2E FIXTURE — starter kit', 'warned', '{"check": "starter_kit_volume"}',
       true, true, 'E2E fixture basis, not a real market rule', 'screening', 'E2E fixture, not a real market rule',
       '2026-01-01')
     ON CONFLICT (id) DO UPDATE SET predicate = EXCLUDED.predicate`,
    [E2E_FIXTURE_PACK],
  )
  await owner.query(
    `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, rounding, mandatory, effective_from, basis,
       basis_status, source_ref)
     VALUES ('e2e-withholding@2026-01-01', $1, 'E2E FIXTURE — withholding', 'withholding', '{}', NULL, 'none', true,
       '2026-01-01', 'E2E fixture basis, not a real tax rule', 'counsel_confirmed', 'E2E fixture')
     ON CONFLICT (id) DO NOTHING`,
    [E2E_FIXTURE_PACK],
  )
  // PLAN B-MKT section 6: pack rows are immutable (forbid_mutation), so these are inserted once and never updated.
  await owner.query(
    `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, threshold_minor, threshold_basis, missing_id_rate, rounding,
       mandatory, effective_from, basis, basis_status, source_ref)
     VALUES ('e2e-tax-withholding@2020-01-01', $1, 'E2E FIXTURE — withholding, not a real tax rule', 'withholding', '{}', 0.020000, 2350,
       'current_year_cumulative', 0.200000, 'half_up', true, '2020-01-01', 'E2E fixture basis, not a real tax rule', 'counsel_confirmed',
       'E2E fixture'),
       ('e2e-tax-form@2020-01-01', $1, 'E2E FIXTURE — annual statement, not a real tax form', 'year_end_form',
       '{"form_type": "FX-ANNUAL", "title": "E2E FIXTURE annual statement", "min_gross_minor": "2000"}', NULL, NULL, NULL, NULL, 'none', true,
       '2020-01-01', 'E2E fixture basis, not a real tax rule', 'counsel_confirmed', 'E2E fixture')
     ON CONFLICT (id) DO NOTHING`,
    [E2E_TAX_PACK],
  )
  // shortcut: the fixture tax year follows the month of the first seed:e2e, reset nmp_e2e to move it
  await owner.query(
    `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
     SELECT r.id, $1, r.kind, r.title, r.params, true, 'E2E fixture basis, not a real market rule', 'counsel_confirmed', 'E2E fixture',
            '2020-01-01'
     FROM (VALUES
       ('e2e-tax-year@2020-01-01', 'tax_year', 'E2E FIXTURE — tax year',
        jsonb_build_object('start_month', extract(month FROM now() AT TIME ZONE 'Europe/Vienna')::int, 'start_day', 1)),
       ('e2e-tax-id@2020-01-01', 'tax_id_format', 'E2E FIXTURE — tax id format', '{"pattern": "^FX[0-9]{6}$", "label": "FX tax id"}'::jsonb),
       ('e2e-grievance@2020-01-01', 'grievance_register', 'E2E FIXTURE — grievance register',
        '{"ack_hours": 48, "resolution": {"days": 30}, "escalation_lead_hours": 24}'::jsonb),
       ('e2e-delisted@2020-01-01', 'delisted_register', 'E2E FIXTURE — delisted sellers',
        '{"fields": ["external_ref", "display_name", "terminated_on"]}'::jsonb)
     ) AS r (id, kind, title, params)
     ON CONFLICT (id) DO NOTHING`,
    [E2E_TAX_PACK],
  )
}

/**
 * PLAN B2 section 6, E2E FIXTURE: acme's market NL inserted live (the browser tests cannot commit a period, and a launch
 * is covered by B1), with a monthly calendar from 2026-01-01 to twelve months ahead whose periods ending a month or more
 * before this month are committed (late-transaction and correction workflows). Owner connection, like the fixture
 * pack; needs the acme tenant. Idempotent.
 */
export async function seedFixtureMarket(expectedDatabase: string): Promise<void> {
  const owner = await ownerOn(expectedDatabase, 'market')
  await owner.query(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     SELECT t.id, 'NL', 'EUR', 2, 'Europe/Amsterdam', '{nl}', $1, 'live' FROM tenant t WHERE t.slug = 'acme'
     ON CONFLICT DO NOTHING`,
    [E2E_FIXTURE_PACK],
  )
  await owner.query(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     SELECT m.tenant_id, m.id, 'NL monthly', 'monthly', 'Europe/Amsterdam', '2026-01-01'
     FROM market m JOIN tenant t ON t.id = m.tenant_id WHERE t.slug = 'acme' AND m.code = 'NL'
     ON CONFLICT DO NOTHING`,
  )
  await owner.query(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state)
     SELECT c.tenant_id, c.id, s.starts_at, s.ends_at,
            CASE WHEN s.ends_at <= date_trunc('month', now()) - interval '1 month' THEN 'committed' ELSE 'open' END
     FROM calendar c JOIN tenant t ON t.id = c.tenant_id
     CROSS JOIN LATERAL (
       SELECT d AT TIME ZONE c.cutoff_time_zone AS starts_at, (d + interval '1 month') AT TIME ZONE c.cutoff_time_zone AS ends_at
       FROM generate_series(c.first_period_start::timestamp,
                            date_trunc('month', now() AT TIME ZONE c.cutoff_time_zone) + interval '11 months', interval '1 month') AS d
     ) AS s
     WHERE t.slug = 'acme' AND c.name = 'NL monthly'
     ON CONFLICT DO NOTHING`,
  )
}

const FIXTURE_DE = 'E2E FIXTURE'

/** A participant type proposed by admin and approved by admin2, as the API records it (D-B2-09). */
async function approvedType(tx: Tx, ids: { admin: string; admin2: string }, code: string, distributor: boolean): Promise<string> {
  const { rows } = await asSelf(tx, ids.admin, () => tx.query<{ id: string }>(
    `INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions,
       state, reason, requested_by)
     VALUES (app_tenant_id(), $1, $1, $2, NOT $2, $2, $2, 'pending', $3, $4) RETURNING id`,
    [code, distributor, FIXTURE_DE, ids.admin],
  ))
  const typeId = rows[0]!.id
  await asSelf(tx, ids.admin2, async () => {
    const approval = await tx.query<{ id: string }>(
      `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, decided_at)
       VALUES (app_tenant_id(), 'participant_type', $1, $2, $3, 'approved', $4, now()) RETURNING id`,
      [typeId, ids.admin, ids.admin2, FIXTURE_DE],
    )
    await tx.query(
      `UPDATE participant_type SET state = 'active', decided_by = $2, decided_at = now(), approval_id = $3 WHERE id = $1`,
      [typeId, ids.admin2, approval.rows[0]!.id],
    )
  })
  return typeId
}

/** An approved type with this code: the existing one, or a new one. */
async function fixtureType(tx: Tx, ids: { admin: string; admin2: string }, code: string, distributor: boolean): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(`SELECT id FROM participant_type WHERE code = $1 AND state = 'active'`, [code])
  return rows[0]?.id ?? approvedType(tx, ids, code, distributor)
}

/** A participant of the type enrolled at `at`, display name = its reference; contact {email} when given (B4 notices). */
async function fixtureParticipant(
  tx: Tx, ref: string, marketId: string, typeId: string, at: string, email: string | null = null,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, contact)
     VALUES (app_tenant_id(), $1, 'individual', $2, $1, $3, $4) RETURNING id`,
    [ref, marketId, at, email === null ? null : { email }],
  )
  await tx.query(
    `INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from) VALUES (app_tenant_id(), $1, $2, $3)`,
    [rows[0]!.id, typeId, at],
  )
  return rows[0]!.id
}

/**
 * PLAN B3 section 6, E2E FIXTURE: acme's market DE (live, owner connection) with a Berlin monthly calendar from three
 * months before this month to three months ahead (all open), approved types FXDIST and FXRETAIL, distributors DE-A <-
 * DE-B <- DE-C (sponsor), customer DE-K serviced by DE-C and SKU FX-1 worth 100.00 pv per unit, written in acme's
 * tenant realm through the shared SQL as the API would. No orders and no plan (the browser workflows make them).
 * Needs the seeded acme staff. Idempotent: skipped once DE-A exists. PLAN B4 section 6: DE-A, DE-B, DE-C carry a contact
 * email, and DE-A a bank-detail version (fixtureBankDetail).
 */
export async function seedFixturePlanMarket(expectedDatabase: string, secretKey: Buffer): Promise<void> {
  const owner = await ownerOn(expectedDatabase, 'plan market')
  await owner.query(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     SELECT t.id, 'DE', 'EUR', 2, 'Europe/Berlin', '{en,de}', $1, 'live' FROM tenant t WHERE t.slug = 'acme'
     ON CONFLICT DO NOTHING`,
    [E2E_FIXTURE_PACK],
  )
  // PLAN B-MKT section 6: English stays DE's default, German its second language (an older DE row is brought along).
  await owner.query(`UPDATE market SET languages = '{en,de}' WHERE code = 'DE' AND languages = '{de}'`)
  const { rows } = await owner.query<{ id: string }>(`SELECT id FROM tenant WHERE slug = 'acme'`)
  await runInTenant({ tenantId: rows[0]!.id, userId: SYSTEM_ACTOR_ID }, SYSTEM, async (tx) => {
    if ((await tx.query(`SELECT 1 FROM participant WHERE external_ref = 'DE-A'`)).rowCount !== 0) return
    const staff = await tx.query<{ email: string; id: string }>(
      `SELECT email, id FROM user_account WHERE email IN ('admin@acme.example', 'admin2@acme.example')`,
    )
    const userId = (email: string) => staff.rows.find((row) => row.email === email)!.id
    const ids = { admin: userId('admin@acme.example'), admin2: userId('admin2@acme.example') }
    const { rows: [setup] } = await tx.query<{ market_id: string; calendar_id: string; first_start: string }>(
      `WITH market AS (SELECT id FROM market WHERE code = 'DE'),
            start AS (SELECT (date_trunc('month', now() AT TIME ZONE 'Europe/Berlin') - interval '3 months')::date AS d),
            cal AS (
              INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
              SELECT app_tenant_id(), market.id, 'DE monthly', 'monthly', 'Europe/Berlin', start.d FROM market, start
              RETURNING id, market_id, first_period_start)
       SELECT cal.market_id, cal.id AS calendar_id, (cal.first_period_start::timestamp AT TIME ZONE 'Europe/Berlin')::text AS first_start
       FROM cal`,
    )
    await tx.query(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
       SELECT app_tenant_id(), c.id, d AT TIME ZONE c.cutoff_time_zone, (d + interval '1 month') AT TIME ZONE c.cutoff_time_zone
       FROM calendar c
       CROSS JOIN generate_series(c.first_period_start::timestamp, c.first_period_start::timestamp + interval '6 months',
                                  interval '1 month') AS d
       WHERE c.id = $1`,
      [setup!.calendar_id],
    )
    const distributor = await fixtureType(tx, ids, 'FXDIST', true)
    const retail = await fixtureType(tx, ids, 'FXRETAIL', false)
    const at = setup!.first_start
    const position = async (ref: string) => {
      const participant = await fixtureParticipant(tx, ref, setup!.market_id, distributor, at, `${ref.toLowerCase()}@example.test`)
      const created = await tx.query<{ id: string }>(
        `SELECT gen_create_position($1, $2, NULL, NULL, 'active', $3) AS id`, [participant, setup!.market_id, at],
      )
      return created.rows[0]!.id
    }
    const [a, b, c] = [await position('DE-A'), await position('DE-B'), await position('DE-C')]
    for (const [child, parent] of [[b, a], [c, b]]) {
      await tx.query(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, $3, 'enrolment', NULL, NULL)`, [child, parent, at])
    }
    const customer = await fixtureParticipant(tx, 'DE-K', setup!.market_id, retail, at, 'de-k@example.test') // B5: contact visibility
    await tx.query(`SELECT crm_set_servicer($1, $2, 'enrolment', $3, NULL, NULL)`, [customer, c, at])
    await asSelf(tx, ids.admin, () => tx.query(
      `INSERT INTO product_volume_map (tenant_id, market_id, sku, item_class, volumes, valid_from, reason, created_by)
       VALUES (app_tenant_id(), $1, 'FX-1', 'product', '{"pv": "10000"}', $2, $3, $4)`,
      [setup!.market_id, at, FIXTURE_DE, ids.admin],
    ))
    // BUG-085: runs and simulations of M-3..M-1 need a settings version in force at their end, and settings are only
    // saved from now on: the fixture records its structure (market DE, its calendar) as of the first period start.
    const { rows: [first] } = await tx.query<{ starts_at: Date; covered: boolean }>(
      `SELECT p.starts_at, EXISTS (SELECT 1 FROM tenant_setting_version v WHERE v.effective_from <= p.starts_at) AS covered
       FROM period p WHERE p.calendar_id = $1 ORDER BY p.starts_at LIMIT 1`,
      [setup!.calendar_id],
    )
    if (!first!.covered) await asSelf(tx, ids.admin, () => recordStructureChange(tx, `${FIXTURE_DE}: market DE and its calendar`, first!.starts_at))
  })
  await fixtureBankDetail(owner, secretKey, 'DE-A', 'DE monthly', 'DE89370400440532013000')
}

/**
 * PLAN B4 section 6, E2E FIXTURE: a participant's bank details (a public example IBAN), sealed and fingerprinted as PAY
 * does, as a migration-created version out of cooling-off from the calendar's first period. The runtime role creates
 * versions only through an approved case (0402), so this goes through the owner connection. Skipped when the participant
 * already has a version.
 */
async function fixtureBankDetail(
  owner: ReturnType<typeof getOwnerPool>, secretKey: Buffer, ref: string, calendarName: string, iban: string,
): Promise<void> {
  const { rows: [target] } = await owner.query<{ tenant_id: string; participant_id: string; first_start: Date }>(
    `SELECT p.tenant_id, p.id AS participant_id,
            (SELECT min(d.starts_at) FROM period d JOIN calendar c ON c.id = d.calendar_id WHERE c.tenant_id = p.tenant_id
               AND c.name = $2) AS first_start
     FROM participant p JOIN tenant t ON t.id = p.tenant_id
     WHERE t.slug = 'acme' AND p.external_ref = $1
       AND NOT EXISTS (SELECT 1 FROM bank_detail_version v WHERE v.tenant_id = p.tenant_id AND v.participant_id = p.id)`,
    [ref, calendarName],
  )
  if (target === undefined) return
  const details = BankDetails.parse({ scheme: 'iban', account_holder: `${ref} E2E`, iban })
  const id = randomUUID()
  await owner.query(
    `INSERT INTO bank_detail_version (id, tenant_id, participant_id, scheme, details_sealed, fingerprint, masked, created_via,
       cooling_off_until)
     VALUES ($1, $2, $3, 'iban', $4, $5, $6, 'migration', $7)`,
    [id, target.tenant_id, target.participant_id, seal(secretKey, JSON.stringify(details), bankVersionContext(id)),
      bankFingerprint(secretKey, target.tenant_id, details), maskAccount(details), target.first_start],
  )
}

/**
 * PLAN B6 section 6, E2E FIXTURE: acme's market AT in implementation (draft, owner connection) with a Vienna monthly
 * calendar from three months before this month to three months ahead (all open), and the structure settings version as
 * of its first period (BUG-085). No participants, plans or orders: the migration workflows import them. Idempotent:
 * skipped once the AT calendar exists.
 */
export async function seedFixtureMigrationMarket(expectedDatabase: string): Promise<void> {
  const owner = await ownerOn(expectedDatabase, 'migration market')
  await owner.query(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     SELECT t.id, 'AT', 'EUR', 2, 'Europe/Vienna', '{de}', $1, 'draft' FROM tenant t WHERE t.slug = 'acme'
     ON CONFLICT DO NOTHING`,
    [E2E_TAX_PACK],
  )
  // PLAN B-MKT section 6: AT runs on the tax fixture pack (an older AT row on the B6 pack is moved).
  await owner.query(`UPDATE market SET market_pack = $1 WHERE code = 'AT' AND market_pack = $2`, [E2E_TAX_PACK, E2E_FIXTURE_PACK])
  const { rows } = await owner.query<{ id: string }>(`SELECT id FROM tenant WHERE slug = 'acme'`)
  await runInTenant({ tenantId: rows[0]!.id, userId: SYSTEM_ACTOR_ID }, SYSTEM, async (tx) => {
    if ((await tx.query(`SELECT 1 FROM calendar WHERE name = 'AT monthly'`)).rowCount !== 0) return
    const { rows: [calendar] } = await tx.query<{ id: string }>(
      `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
       SELECT app_tenant_id(), m.id, 'AT monthly', 'monthly', 'Europe/Vienna',
              (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '3 months')::date
       FROM market m WHERE m.code = 'AT' RETURNING id`,
    )
    await tx.query(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
       SELECT app_tenant_id(), c.id, d AT TIME ZONE c.cutoff_time_zone, (d + interval '1 month') AT TIME ZONE c.cutoff_time_zone
       FROM calendar c
       CROSS JOIN generate_series(c.first_period_start::timestamp, c.first_period_start::timestamp + interval '6 months',
                                  interval '1 month') AS d
       WHERE c.id = $1`,
      [calendar!.id],
    )
    const { rows: [first] } = await tx.query<{ starts_at: Date }>('SELECT min(starts_at) AS starts_at FROM period WHERE calendar_id = $1', [calendar!.id])
    const { rows: [admin] } = await tx.query<{ id: string }>(`SELECT id FROM user_account WHERE email = 'admin@acme.example'`)
    await asSelf(tx, admin!.id, () => recordStructureChange(tx, `${FIXTURE_DE}: market AT and its calendar`, first!.starts_at))
  })
}

const FIXTURE_V1A = 'E2E FIXTURE V1-A'
const BE_ZONE = 'Europe/Brussels'
/** PLAN V1-A section 6: BE participants, enrolled 2025-06-01; A, B, C, E with a tax profile (tax id) and bank details. */
const BE_READY: readonly (readonly [ref: string, iban: string])[] = [
  ['BE-A', 'BE68539007547034'], ['BE-B', 'BE71096123456769'], ['BE-C', 'BE62510007547061'], ['BE-E', 'BE48001234567802'],
]
/** PLAN V1-A section 6 orders, credited when ordered: ref, buyer, units of FX-BE-1 (1.00 EUR and 1 PV each), ordered at. */
const BE_ORDERS: readonly (readonly [ref: string, buyer: string, units: number, at: string])[] = [
  ['O-BE-1', 'BE-A', 100, '2026-10-06T10:00:00Z'], ['O-BE-2', 'BE-A', 50, '2026-10-20T10:00:00Z'],
  ['O-BE-3', 'BE-A', 30, '2026-10-23T10:00:00Z'], ['O-BE-4', 'BE-B', 200, '2026-10-28T10:00:00Z'],
]

/** The acme staff ids by the local part of their e-mail. */
async function acmeStaff(tx: Tx): Promise<(local: string) => string> {
  const { rows } = await tx.query<{ email: string; id: string }>(`SELECT email, id FROM user_account WHERE email LIKE '%@acme.example'`)
  const ids = new Map(rows.map((row) => [row.email.split('@')[0]!, row.id]))
  return (local) => ids.get(local)!
}

/**
 * PLAN V1-A section 6, E2E FIXTURE: acme's market BE (live on the fixture pack, which has no withholding duty) with BE
 * monthly from October 2026 and BE weekly advances, provisional for it, whose weeks are cut at the month ends (Oct 26-Nov 1
 * and Nov 1-Nov 2), periods through 2026-12-31; distributors BE-A <- BE-B, BE-A <- BE-C (portal be-c@example.test), BE-E
 * (ready new owner, related party of compliance2), BE-D (no tax profile, no bank details), BE-R1 and BE-R2 terminated
 * 2025-09-01 (a legal hold on BE-R2 by dpo, a closed access request of BE-R1 with sealed requester data); orders O-BE-1..4;
 * credit type PRODUCT_CREDIT; an approved FX batch (analyst proposes, finance approves) and fx.max_rate_age_days = 45; a
 * plan_filing pack rule on the tax pack. Owner connection for platform rows, tax profiles, bank details, the portal account
 * and the closed request; the rest in acme's realm as the API writes it. Idempotent: skipped once BE-A exists.
 * shortcut: the plan "BE advances" (weekly_advance, monthly_bonus, loyalty_credit in PRODUCT_CREDIT) is not seeded: a pay
 * rule's credit_type_code is defined by the V1-A PLN/engine package; seed it here once PLN accepts credit rules.
 */
export async function seedFixtureAdvancesMarket(expectedDatabase: string, secretKey: Buffer, passwordHash: string): Promise<void> {
  const owner = await ownerOn(expectedDatabase, 'advances market')
  const { rows: [duty] } = await owner.query<{ rate: string | null }>(`SELECT rate FROM tax_rule WHERE id = 'e2e-withholding@2026-01-01'`)
  if (duty === undefined || duty.rate !== null) throw new Error('seed refuses the advances market: the fixture pack must carry no withholding duty')
  await owner.query(
    `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
     VALUES ('e2e-plan-filing@2020-01-01', $1, 'plan_filing', 'E2E FIXTURE — plan filing', '{"authority": "E2E fixture authority, not a real regulator"}',
       true, 'E2E fixture basis, not a real market rule', 'counsel_confirmed', 'E2E fixture', '2020-01-01')
     ON CONFLICT (id) DO NOTHING`,
    [E2E_TAX_PACK],
  )
  await owner.query(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     SELECT t.id, 'BE', 'EUR', 2, $2, '{en}', $1, 'live' FROM tenant t WHERE t.slug = 'acme' ON CONFLICT DO NOTHING`,
    [E2E_FIXTURE_PACK, BE_ZONE],
  )
  const { rows: [acme] } = await owner.query<{ id: string }>(`SELECT id FROM tenant WHERE slug = 'acme'`)
  const made = await runInTenant({ tenantId: acme!.id, userId: SYSTEM_ACTOR_ID }, SYSTEM, async (tx) => {
    if ((await tx.query(`SELECT 1 FROM participant WHERE external_ref = 'BE-A'`)).rowCount !== 0) return null
    const user = await acmeStaff(tx)
    const one = async (sql: string, params: unknown[]): Promise<string> => Object.values((await tx.query(sql, params)).rows[0]!)[0] as string
    const marketId = await one(`SELECT id FROM market WHERE code = 'BE'`, [])
    const monthly = await one(
      `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
       VALUES (app_tenant_id(), $1, 'BE monthly', 'monthly', $2, '2026-10-01') RETURNING id`, [marketId, BE_ZONE])
    const weekly = await one(
      `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start, provisional_for_calendar_id)
       VALUES (app_tenant_id(), $1, 'BE weekly advances', 'weekly', $2, '2026-10-05', $3) RETURNING id`, [marketId, BE_ZONE, monthly])
    await tx.query(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
       SELECT app_tenant_id(), $1, d AT TIME ZONE $2, (d + interval '1 month') AT TIME ZONE $2
       FROM generate_series('2026-10-01'::timestamp, '2026-12-01'::timestamp, interval '1 month') AS d`, [monthly, BE_ZONE])
    // D-V1A-02: the weekly grid cut at the monthly boundaries, up to the last monthly period.
    await tx.query(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
       SELECT app_tenant_id(), $1, greatest(w.s, f.starts_at), least(w.e, f.ends_at)
       FROM (SELECT d AT TIME ZONE $3 AS s, (d + interval '7 days') AT TIME ZONE $3 AS e
             FROM generate_series('2026-10-05'::timestamp, '2026-12-28'::timestamp, interval '7 days') AS d) w
       JOIN period f ON f.calendar_id = $2 AND f.starts_at < w.e AND w.s < f.ends_at`, [weekly, monthly, BE_ZONE])
    const firstStart = new Date(await one('SELECT min(starts_at) FROM period WHERE calendar_id = $1', [monthly]))
    await asSelf(tx, user('admin'), () => recordStructureChange(tx, `${FIXTURE_V1A}: market BE and its calendars`, firstStart))
    const distributor = await fixtureType(tx, { admin: user('admin'), admin2: user('admin2') }, 'FXDIST', true)
    const at = '2025-06-01T00:00:00Z'
    const participants = new Map<string, { participant: string; position: string }>()
    for (const ref of ['BE-A', 'BE-B', 'BE-C', 'BE-D', 'BE-E', 'BE-R1', 'BE-R2']) {
      const participant = await fixtureParticipant(tx, ref, marketId, distributor, at, `${ref.toLowerCase()}@example.test`)
      const position = await one(`SELECT gen_create_position($1, $2, NULL, NULL, 'active', $3)`, [participant, marketId, at])
      participants.set(ref, { participant, position })
    }
    const of = (ref: string) => participants.get(ref)!
    for (const child of ['BE-B', 'BE-C']) {
      await tx.query(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, $3, 'enrolment', NULL, NULL)`, [of(child).position, of('BE-A').position, at])
    }
    for (const ref of ['BE-R1', 'BE-R2']) {
      await tx.query(`SELECT gen_set_position_status($1, 'terminated', '2025-09-01T00:00:00Z', $2, NULL)`, [of(ref).position, FIXTURE_V1A])
    }
    await asSelf(tx, user('admin'), () => tx.query(
      `INSERT INTO product_volume_map (tenant_id, market_id, sku, item_class, volumes, valid_from, reason, created_by)
       VALUES (app_tenant_id(), $1, 'FX-BE-1', 'product', '{"pv": "100"}', $2, $3, $4)`, [marketId, at, FIXTURE_V1A, user('admin')]))
    for (const [ref, buyer, units, orderedAt] of BE_ORDERS) {
      const inbound = await one(
        `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state)
         VALUES (app_tenant_id(), 'api:e2e-fixture', $1, $2, now(), 'processed') RETURNING id`, [`order:${ref}`, randomBytes(32)])
      const orderId = await one(
        `INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
           attributed_position_id, attribution_source, attribution_conflict, ordered_at, credited_at, period_id, amount_minor, tax_minor,
           currency, payload_hash, inbound_event_id)
         VALUES (app_tenant_id(), 'e2e-fixture', $1, $2, $3, $4, 'personal', false, $5, 'buyer', false, $6, $6, market_period_at($2, $6),
           $7, 0, 'EUR', $8, $9) RETURNING id`,
        [ref, marketId, of(buyer).participant, distributor, of(buyer).position, orderedAt, units * 100, randomBytes(32), inbound])
      await tx.query(
        `INSERT INTO order_line (tenant_id, order_id, line_no, sku, item_class, quantity, amount_minor, volumes)
         VALUES (app_tenant_id(), $1, 1, 'FX-BE-1', 'product', $2, $3, jsonb_build_object('pv', $4::text))`,
        [orderId, units, units * 100, String(units * 100)])
    }
    await asSelf(tx, user('finance'), () => tx.query(
      `INSERT INTO credit_type (tenant_id, code, name, unit_value_minor, expiry_days, expiry_notice_days, redemption_scope, taxable)
       VALUES (app_tenant_id(), 'PRODUCT_CREDIT', 'Product credit', 100, 30, 7, jsonb_build_object('markets', jsonb_build_array($1::text)), false)`,
      [marketId]))
    const batch = await asSelf(tx, user('analyst'), () => one(
      `INSERT INTO fx_rate_batch (tenant_id, source, rows) VALUES (app_tenant_id(), $1, $2) RETURNING id`,
      [`${FIXTURE_V1A} rates, not market data`, JSON.stringify([
        { base: 'CHF', quote: 'EUR', rate: '1.0412000000', valid_from: '2026-11-01T00:00:00Z' },
        { base: 'USD', quote: 'EUR', rate: '0.9200000000', valid_from: '2026-09-01T00:00:00Z' },
      ])]))
    await asSelf(tx, user('finance'), async () => {
      const approval = await one(
        `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, decided_at)
         VALUES (app_tenant_id(), 'fx_rate_batch', $1, $2, $3, 'approved', $4, now()) RETURNING id`, [batch, user('analyst'), user('finance'), FIXTURE_V1A])
      await tx.query(`UPDATE fx_rate_batch SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [batch, approval])
      await tx.query(
        `INSERT INTO fx_rate (tenant_id, batch_id, base, quote, rate, source, valid_from)
         SELECT app_tenant_id(), b.id, r ->> 'base', r ->> 'quote', (r ->> 'rate')::numeric, b.source, (r ->> 'valid_from')::timestamptz
         FROM fx_rate_batch b CROSS JOIN jsonb_array_elements(b.rows) r WHERE b.id = $1`, [batch])
    })
    await asSelf(tx, user('admin'), () => tx.query(
      `INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by)
       VALUES (app_tenant_id(), $1, $2, 'relative', $3)`, [user('compliance2'), of('BE-E').participant, user('admin')]))
    await asSelf(tx, user('dpo'), () => tx.query(
      `INSERT INTO legal_hold (tenant_id, participant_id, reason) VALUES (app_tenant_id(), $1, $2)`, [of('BE-R2').participant, FIXTURE_V1A]))
    return { participant: (ref: string) => of(ref).participant, admin: user('admin'), finance: user('finance'), dpo: user('dpo'), dpo2: user('dpo2') }
  })
  if (made === null) return
  for (const [ref, iban] of BE_READY) {
    const id = randomUUID()
    const taxId = `BE${ref.slice(3)}0000001`
    await owner.query(
      `INSERT INTO tax_profile (id, tenant_id, participant_id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, created_by)
       VALUES ($1, $2, $3, 'BE', 'individual', $4, $5, '2025-06-01T00:00:00Z', $6)`,
      [id, acme!.id, made.participant(ref), seal(secretKey, taxId, `tax_profile:${id}`), `•••• ${taxId.slice(-2)}`, made.admin])
    await fixtureBankDetail(owner, secretKey, ref, 'BE monthly', iban)
  }
  const portalUser = randomUUID()
  await owner.query(
    `INSERT INTO user_account (id, tenant_id, realm, idp_subject, email, display_name, state, participant_id, locale)
     VALUES ($1, $2, 'portal', $3, 'be-c@example.test', 'BE-C', 'active', $4, 'en')`, [portalUser, acme!.id, `local:${randomUUID()}`, made.participant('BE-C')])
  await owner.query('INSERT INTO password_credential (user_id, password_hash) VALUES ($1, $2)', [portalUser, passwordHash])
  // A closed access request of BE-R1 (2025-10-01) with its approved system case, written together (0506: one transaction).
  const requestId = randomUUID()
  const client = await owner.connect()
  try {
    await client.query('BEGIN')
    const { rows: [privacyCase] } = await client.query<{ id: string }>(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, opened_by_kind, created_at)
       VALUES ($1, 'privacy', 'privacy_request', $2, 'RECEIVED_BY_STAFF', 'open', jsonb_build_object('request_id', $3::text), 'system', '2025-09-10T00:00:00Z')
       RETURNING id`, [acme!.id, requestId, requestId])
    await client.query(
      `INSERT INTO privacy_request (id, tenant_id, case_id, type, channel, subject_participant_id, requester_sealed, received_at, created_by,
         created_by_type) VALUES ($1, $2, $3, 'access', 'staff', $4, $5, '2025-09-10T00:00:00Z', $6, 'user')`,
      [requestId, acme!.id, privacyCase!.id, made.participant('BE-R1'),
        seal(secretKey, JSON.stringify({ full_name: 'BE-R1 E2E', email: 'be-r1@example.test', received_via: FIXTURE_V1A }), `privacy_request:${requestId}`),
        made.dpo])
    const { rows: [approval] } = await client.query<{ id: string }>(
      `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, decided_at, created_by)
       VALUES ($1, 'case', $2, $3, $4, 'approved', $5, '2025-09-20T00:00:00Z', $4) RETURNING id`, [acme!.id, privacyCase!.id, made.dpo, made.dpo2, FIXTURE_V1A])
    await client.query(
      `UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = '2025-09-12T00:00:00Z', approvals_required = 1 WHERE id = $1`,
      [privacyCase!.id, made.dpo])
    await client.query(`UPDATE case_file SET state = 'approved', approval_id = $2, decided_at = '2025-09-20T00:00:00Z' WHERE id = $1`, [privacyCase!.id, approval!.id])
    await client.query(
      `UPDATE privacy_request SET verified_at = '2025-09-11T00:00:00Z', verified_by = $2, verification_method = 'contact_match', outcome = 'fulfilled',
         closed_at = '2025-10-01T00:00:00Z', retention_basis = $3 WHERE id = $1`, [requestId, made.dpo, FIXTURE_V1A])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  // fx.max_rate_age_days = 45 (D-V1A-10): an approved change request (admin requests, finance approves) and its version.
  await owner.query(
    `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, decided_at, created_by)
                VALUES ($1, 'setting_change_request', $2, $3, $4, 'approved', $5, now(), $4) RETURNING id),
          v AS (INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
                SELECT $1, max(version) + 1, now(),
                       (SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1)
                         || '{"fx.max_rate_age_days": 45}', $5, $3, (SELECT id FROM a)
                FROM tenant_setting_version WHERE tenant_id = $1 RETURNING id, effective_from)
     INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, decided_by,
       decided_at, approval_id, version_id)
     SELECT $2, $1, 'fx.max_rate_age_days', '45', v.effective_from, $5, 0, 'approved', $3, $4, now(), a.id, v.id FROM a, v`,
    [acme!.id, randomUUID(), made.admin, made.finance, FIXTURE_V1A])
}

/**
 * PLAN V1-A section 6, E2E FIXTURE: tenant offboard ("Offboard Demo", live) with one market OB and no activity, and its
 * Tenant admin admin@offboard.test (the bootstrap grant; MFA enrolled in the browser like the other e2e admins).
 * Idempotent.
 */
export async function seedFixtureOffboardTenant(expectedDatabase: string, passwordHash: string): Promise<void> {
  const owner = await ownerOn(expectedDatabase, 'offboarding tenant')
  await owner.query(
    `INSERT INTO tenant (legal_name, slug, region, isolation_tier, db_route, state)
     VALUES ('Offboard Demo', 'offboard', 'eu', 'pooled', 'pooled', 'live') ON CONFLICT (slug) DO NOTHING`)
  const { rows: [tenant] } = await owner.query<{ id: string }>(`SELECT id FROM tenant WHERE slug = 'offboard'`)
  await runInTenant({ tenantId: tenant!.id, userId: SYSTEM_ACTOR_ID }, SYSTEM, async (tx) => {
    if ((await existingUser(tx, 'admin@offboard.test')) !== undefined) return
    const admin = await insertUser(tx, { tenantId: tenant!.id, email: 'admin@offboard.test', name: 'Offboard Admin', passwordHash })
    await grant(tx, randomUUID(), admin, 'Tenant admin', null)
  })
  await owner.query(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, 'OB', 'EUR', 2, $2, '{en}', 'none', 'live') ON CONFLICT DO NOTHING`, [tenant!.id, BE_ZONE])
}

/** The three ended AT months M-3, M-2, M-1 as YYYY-MM (the cutover C is M-1). */
export interface MigrationMonths {
  readonly m3: string
  readonly m2: string
  readonly m1: string
}

/**
 * PLAN B6 section 6: the migration workflow's files for market AT (pseudonymous ids, the overlay validator's columns; type
 * code FXDIST, purpose code personal, source kinds as their platform codes). opening_balances.csv sums to 950 (the
 * control_total_minor the workflow sends).
 */
export function migrationFixtureFiles({ m3, m2, m1 }: MigrationMonths): Readonly<Record<string, string>> {
  const participants = (cycle: boolean) =>
    `participant_id,type,enrolled_month,sponsor_id\nAT-A,FXDIST,${m3},${cycle ? 'AT-C' : ''}\nAT-B,FXDIST,${m3},AT-A\nAT-C,FXDIST,${m3},AT-B\n`
  return {
    'participants.csv': participants(false),
    'participants-cycle.csv': participants(true),
    'orders.csv': 'order_id,month,day,buyer_id,amount_cents,volume_cents,purpose,is_starter_kit,refunded_cents,refund_month\n'
      + `AT-O0,${m2},10,AT-A,10000,10000,personal,0,0,\nAT-O1,${m1},5,AT-A,10000,10000,personal,0,0,\n`
      + `AT-O2,${m1},6,AT-B,10000,10000,personal,0,0,\nAT-O3,${m1},7,AT-C,30000,30000,personal,0,0,\n`,
    'payout_lines.csv': 'line_id,month,payee_id,bonus_type,source_kind,source_order_id,amount_cents\n'
      + `L1,${m1},AT-A,unilevel,downline_volume,AT-O2,800\nL2,${m1},AT-A,unilevel,downline_volume,AT-O3,1500\n`
      + `L3,${m1},AT-B,unilevel,downline_volume,AT-O3,2401\nL4,${m1},AT-C,retail,other,,500\n`,
    'opening_balances.csv': 'payee_id,amount_minor\nAT-A,1250\nAT-C,-300\n',
    'opening_state.csv': 'participant_id,item,value\nAT-A,title.main,R1\n',
  }
}

/** Writes the migration files into dir (repo var/e2e/b6-migration/ by default), months from AT's zone now. */
export async function writeMigrationFixtureFiles(
  expectedDatabase: string, dir = new URL('../../../var/e2e/b6-migration/', import.meta.url),
): Promise<void> {
  const owner = await ownerOn(expectedDatabase, 'migration files')
  const { rows: [months] } = await owner.query<MigrationMonths>(
    `SELECT to_char(m - interval '3 months', 'YYYY-MM') AS m3, to_char(m - interval '2 months', 'YYYY-MM') AS m2,
            to_char(m - interval '1 month', 'YYYY-MM') AS m1
     FROM (SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') AS m) t`,
  )
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(migrationFixtureFiles(months!))) await writeFile(new URL(name, dir), content)
}

// The seed creates known staff accounts: only the local databases of PROJECT_ENGINEERING_CONTEXT may get them.
const SEEDABLE_DATABASES: ReadonlySet<string> = new Set(['nmp_dev', 'nmp_test', 'nmp_test_1', 'nmp_test_2', 'nmp_test_3', 'nmp_test_4', 'nmp_test_5', 'nmp_test_6', 'nmp_e2e'])
// A fixed password (SEED_PASSWORD) makes every seeded account known: development and browser-test databases only.
const FIXED_PASSWORD_DATABASES: ReadonlySet<string> = new Set(['nmp_dev', 'nmp_e2e'])

/** The database the seed is connected to: its name and the server's address (null over a Unix socket). */
export interface SeedTarget {
  readonly database: string
  readonly serverAddress: string | null
}

const isLoopback = (address: string | null): boolean =>
  address === null || address === '::1' || /^(::ffff:)?127\./.test(address)

/** One of the local databases of PROJECT_ENGINEERING_CONTEXT, on a server reached over a Unix socket or loopback. */
export const isLocalDatabase = (target: SeedTarget): boolean => isLoopback(target.serverAddress) && SEEDABLE_DATABASES.has(target.database)

/**
 * Throws unless seeding is allowed: never in production, only into a local database on a server reached over a
 * Unix socket or loopback, a fixed password only where listed.
 */
export function assertSeedable(env: Config['env'], target: SeedTarget, fixedPassword: boolean, staging = false): void {
  // A staging server (any database, even NODE_ENV=production) only with a random password, so no account is guessable.
  if (staging) {
    if (fixedPassword) throw new Error('seed refuses SEED_PASSWORD on staging: the password is generated and printed once')
    return
  }
  if (env === 'production') throw new Error('seed refuses to run with NODE_ENV=production')
  if (!isLoopback(target.serverAddress)) {
    throw new Error(`seed refuses the database server at ${target.serverAddress}: only a local server (Unix socket or loopback)`)
  }
  const { database } = target
  if (!SEEDABLE_DATABASES.has(database)) {
    throw new Error(`seed refuses database ${database}: only ${[...SEEDABLE_DATABASES].join(', ')}`)
  }
  if (fixedPassword && !FIXED_PASSWORD_DATABASES.has(database)) {
    throw new Error(`seed refuses SEED_PASSWORD for database ${database}: only ${[...FIXED_PASSWORD_DATABASES].join(', ')}`)
  }
}

/**
 * Seeds the database behind DATABASE_URL. password (SEED_PASSWORD) is used for every account created now; without
 * it a random one is generated and printed. The vendor's otpauth URI is printed in development, with a password or on
 * staging (the operator needs it once for an authenticator).
 */
export async function seed(config: Config, password: string | undefined, print: Print, staging = false): Promise<void> {
  const { rows } = await withSystem((tx) =>
    tx.query<SeedTarget>('SELECT current_database() AS database, host(inet_server_addr()) AS "serverAddress"'),
  )
  const target = rows[0]!
  assertSeedable(config.env, target, password !== undefined, staging)
  const effective = password ?? randomBytes(18).toString('base64url')
  const passwordHash = await hashPassword(effective)
  const printTotp = config.env === 'development' || password !== undefined || staging
  let created = false
  for (const vendor of VENDORS) created = (await seedVendor(config, vendor, passwordHash, printTotp, print)) || created
  for (const tenant of TENANTS) created = (await seedTenant(tenant.slug, tenant.legalName, passwordHash, print)) || created
  if (target.database === E2E_DATABASE) {
    await seedFixturePack(E2E_DATABASE)
    await seedFixtureMarket(E2E_DATABASE)
    await seedFixturePlanMarket(E2E_DATABASE, config.secretKey)
    await seedFixtureMigrationMarket(E2E_DATABASE)
    await writeMigrationFixtureFiles(E2E_DATABASE)
    await seedFixtureAdvancesMarket(E2E_DATABASE, config.secretKey, passwordHash)
    await seedFixtureOffboardTenant(E2E_DATABASE, passwordHash)
    print(`market packs: ${E2E_FIXTURE_PACK}, ${E2E_TAX_PACK} (fixtures), acme market NL live with committed past periods (fixture)`)
    print('acme market DE live with DE-A, DE-B, DE-C, DE-K and SKU FX-1, DE-A bank details, no plan yet (fixture)')
    print(`acme market AT in implementation on ${E2E_TAX_PACK}, migration files in var/e2e/b6-migration/ (fixture)`)
    print('acme market BE live: monthly + weekly advances, BE-A..BE-E, BE-R1/R2, O-BE-1..4, PRODUCT_CREDIT, FX rates; tenant offboard (fixture)')
  }
  if (created && password === undefined) print(`password of the accounts created now: ${effective}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const print: Print = (line) => process.stdout.write(`${line}\n`)
  const fixedPassword = process.env.SEED_PASSWORD
  const staging = process.argv.includes(STAGING_FLAG) && process.env[STAGING_ENV] === 'yes'
  seed(loadConfig(process.env), fixedPassword === '' ? undefined : fixedPassword, print, staging)
    .catch((error: unknown) => {
      process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
    .finally(() => Promise.all([closePool(), closeOwnerPool()]))
}
