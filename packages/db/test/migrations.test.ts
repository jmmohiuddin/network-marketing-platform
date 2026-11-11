import { describe, expect, test } from 'vitest'
import { migrate } from '../src/index.js'
import { getOwnerPool } from '../src/testing.js'
import { closePoolsAfterAll } from './support.js'

const MIGRATE_URL = process.env.MIGRATE_DATABASE_URL!

const RELEASE_A_TABLES = [
  'tenant', 'market', 'tenant_setting_version', 'user_account', 'role', 'role_assignment', 'approval',
  'support_session', 'audit.audit_event', 'document', 'import_batch', 'import_row_error', 'import_mapping',
  'cpl_fact_participant', 'cpl_fact_order', 'cpl_fact_payout_line', 'compliance_report_snapshot',
  'compliance_figure', 'outbox_event', 'export_job',
]
const ENGINEERING_TABLES = [
  'session', 'password_credential', 'mfa_credential', 'login_attempt', 'idempotency_key', 'audit.vendor_event',
  'role_grant_request', 'user_invitation',
]
const INSERT_ONLY_TABLES = [
  'audit.audit_event', 'audit.vendor_event', 'outbox_event', 'approval', 'tenant_setting_version',
]
const TENANT_ID_TABLES = `
  SELECT c.oid, c.oid::regclass::text AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
  FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
  WHERE c.relkind IN ('r', 'p') AND c.relnamespace IN ('public'::regnamespace, 'audit'::regnamespace)`

// The complete policy set: [table, policy, command, USING, WITH CHECK]. Commands: * all, r select, a insert,
// w update. Adding or widening a policy must change this list.
type Policy = [table: string, name: string, command: string, using: string | null, check: string | null]
const OWN_TENANT = "((app_realm() = 'tenant'::text) AND (tenant_id = app_tenant_id()))"
const VENDOR = "(app_realm() = 'vendor'::text)"
const VENDOR_OWNED = "((app_realm() = 'vendor'::text) AND (tenant_id IS NULL))"
const visibleOwner = (table: string) => `(EXISTS ( SELECT 1 FROM user_account u WHERE (u.id = ${table}.user_id)))`
const POLICIES_BEYOND_TENANT_ISOLATION: Policy[] = [
  ['tenant', 'tenant_self_read', 'r', "((app_realm() = 'tenant'::text) AND (id = app_tenant_id()))", null],
  ['tenant', 'vendor_manage', '*', VENDOR, VENDOR],
  ['market', 'vendor_read', 'r', VENDOR, null],
  ['user_account', 'vendor_users', '*', VENDOR_OWNED, VENDOR_OWNED],
  ['role', 'base_role_read', 'r', "((tenant_id IS NULL) AND is_base AND (app_realm() = 'tenant'::text))", null],
  ['role', 'vendor_platform_roles', '*', VENDOR_OWNED, VENDOR_OWNED],
  ['session', 'vendor_sessions', '*', VENDOR_OWNED, VENDOR_OWNED],
  ['support_session', 'vendor_read', 'r', VENDOR, null],
  [
    'support_session', 'vendor_request', 'a', null,
    "((app_realm() = 'vendor'::text) AND (state = 'requested'::text) AND (decided_by IS NULL) AND (starts_at IS NULL)" +
      ' AND (ends_at IS NULL) AND (EXISTS ( SELECT 1 FROM user_account u' +
      " WHERE ((u.id = support_session.requester_id) AND (u.realm = 'vendor'::text)))))",
  ],
  [
    'support_session', 'vendor_end', 'w',
    "((app_realm() = 'vendor'::text) AND (state = 'active'::text))",
    "((app_realm() = 'vendor'::text) AND (state = 'ended'::text))",
  ],
  ['audit.vendor_event', 'vendor_only', '*', VENDOR, VENDOR],
  ['password_credential', 'owner_visible', '*', visibleOwner('password_credential'), visibleOwner('password_credential')],
  ['mfa_credential', 'owner_visible', '*', visibleOwner('mfa_credential'), visibleOwner('mfa_credential')],
]
// Foreign keys to a tenant-scoped table that do not carry tenant_id, each kept in its tenant by other means.
const KEYS_WITHOUT_TENANT_ID = [
  'mfa_credential_user_id_fkey', // no tenant_id column: policy owner_visible
  'password_credential_user_id_fkey', // no tenant_id column: policy owner_visible
  'role_assignment_role_id_fkey', // base roles have no tenant: trigger role_assignment_role_in_tenant
  'role_grant_request_role_id_fkey', // base roles have no tenant: trigger role_grant_request_role_in_tenant
  'session_user_id_realm_fkey', // realm match; session_tenant_id_user_id_fkey carries the tenant
  'support_session_requester_id_fkey', // a vendor user: policy vendor_request
]

closePoolsAfterAll()

describe('migrations', () => {
  test('apply from an empty database and are idempotent on a second run', async () => {
    const applied = await migrate(MIGRATE_URL, { reset: true })
    const again = await migrate(MIGRATE_URL)

    expect(applied.length).toBeGreaterThanOrEqual(6)
    expect(applied).toEqual([...applied].sort())
    expect(again).toEqual([])
  })

  test('create every release A table and the engineering additions', async () => {
    const { rows } = await getOwnerPool().query<{ name: string }>(
      `SELECT CASE schemaname WHEN 'public' THEN tablename ELSE schemaname || '.' || tablename END AS name
       FROM pg_tables WHERE schemaname IN ('public', 'audit')`,
    )

    expect(rows.map((row) => row.name).sort()).toEqual(
      [...RELEASE_A_TABLES, ...ENGINEERING_TABLES, 'schema_migration'].sort(),
    )
  })

  test('use no floating point column anywhere', async () => {
    const { rows } = await getOwnerPool().query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema IN ('public', 'audit') AND data_type IN ('real', 'double precision')`,
    )

    expect(rows).toEqual([])
  })
})

describe('row-level security coverage', () => {
  test('every table with a tenant_id column has RLS enabled and forced', async () => {
    const { rows } = await getOwnerPool().query<{ name: string; enabled: boolean; forced: boolean }>(TENANT_ID_TABLES)

    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(rows.filter((row) => !row.enabled || !row.forced)).toEqual([])
  })

  test('the policy set is exactly tenant isolation on every tenant_id table plus the listed policies', async () => {
    const owner = getOwnerPool()
    const tenantIdTables = await owner.query<{ name: string }>(TENANT_ID_TABLES)
    const actual = await owner.query<{ policy: Policy }>(
      `SELECT ARRAY[p.polrelid::regclass::text, p.polname::text, p.polcmd::text,
                    regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\\s+', ' ', 'g'),
                    regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\\s+', ' ', 'g')] AS policy
       FROM pg_policy p WHERE p.polpermissive AND p.polroles = '{0}'`,
    )
    const everyPolicy = await owner.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_policy')
    const expected: Policy[] = [
      ...tenantIdTables.rows.map((table): Policy => [table.name, 'tenant_isolation', '*', OWN_TENANT, OWN_TENANT]),
      ...POLICIES_BEYOND_TENANT_ISOLATION,
    ]
    const byTableAndName = (left: Policy, right: Policy) => `${left[0]} ${left[1]}`.localeCompare(`${right[0]} ${right[1]}`)

    expect(actual.rows.map((row) => row.policy).sort(byTableAndName)).toEqual([...expected].sort(byTableAndName))
    // No restrictive or role-specific policy hides outside the comparison above.
    expect(everyPolicy.rows).toEqual([{ n: expected.length }])
  })

  test('every application table has RLS enabled and forced, with or without a tenant_id column', async () => {
    const { rows } = await getOwnerPool().query<{ name: string }>(
      `SELECT c.oid::regclass::text AS name FROM pg_class c
       WHERE c.relkind IN ('r', 'p') AND c.relnamespace IN ('public'::regnamespace, 'audit'::regnamespace)
         AND c.relname <> 'schema_migration' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
    )

    expect(rows).toEqual([])
  })

  test('every foreign key between tenant-scoped tables carries tenant_id, bar the listed exceptions', async () => {
    const { rows } = await getOwnerPool().query<{ name: string }>(
      `SELECT k.conname AS name FROM pg_constraint k
       WHERE k.contype = 'f' AND k.connamespace IN ('public'::regnamespace, 'audit'::regnamespace)
         AND k.confrelid IN (SELECT t.oid FROM (${TENANT_ID_TABLES}) t)
         AND NOT EXISTS (
           SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey) AND a.attname = 'tenant_id')
       ORDER BY k.conname`,
    )

    expect(rows.map((row) => row.name)).toEqual(KEYS_WITHOUT_TENANT_ID)
  })
})

describe('runtime role nmp_app', () => {
  test('cannot bypass RLS and has no elevated attribute', async () => {
    const { rows } = await getOwnerPool().query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = 'nmp_app'`,
    )

    expect(rows).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false },
    ])
  })

  test('owns no table, sequence, function or schema and cannot create objects', async () => {
    const { rows } = await getOwnerPool().query<{ owned: number; can_create: boolean }>(
      `SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'nmp_app'::regrole)::int
            + (SELECT count(*) FROM pg_proc WHERE proowner = 'nmp_app'::regrole)::int
            + (SELECT count(*) FROM pg_namespace WHERE nspowner = 'nmp_app'::regrole)::int AS owned,
              has_schema_privilege('nmp_app', 'public', 'CREATE') OR has_schema_privilege('nmp_app', 'audit', 'CREATE')
                AS can_create`,
    )

    expect(rows).toEqual([{ owned: 0, can_create: false }])
  })

  test.each(INSERT_ONLY_TABLES)('has INSERT and SELECT but no UPDATE, DELETE or TRUNCATE on %s', async (table) => {
    const { rows } = await getOwnerPool().query(
      `SELECT has_table_privilege('nmp_app', $1, 'INSERT') AS ins, has_table_privilege('nmp_app', $1, 'SELECT') AS sel,
              has_table_privilege('nmp_app', $1, 'UPDATE') AS upd, has_table_privilege('nmp_app', $1, 'DELETE') AS del,
              has_table_privilege('nmp_app', $1, 'TRUNCATE') AS trunc`,
      [table],
    )

    expect(rows).toEqual([{ ins: true, sel: true, upd: false, del: false, trunc: false }])
  })

  test('has no privilege at all on login_attempt and schema_migration', async () => {
    const { rows } = await getOwnerPool().query<{ any: boolean }>(
      `SELECT bool_or(has_table_privilege('nmp_app', t, 'SELECT, INSERT, UPDATE, DELETE')) AS any
       FROM unnest(ARRAY['login_attempt', 'schema_migration']) AS t`,
    )

    expect(rows).toEqual([{ any: false }])
  })
})
