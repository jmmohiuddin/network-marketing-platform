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
// PLAN B1 section 1 (guardrail_rule and tax_rule are platform tables without tenant_id).
const B1_TABLES = [
  'brand', 'calendar', 'period', 'setting_change_request', 'provider_config', 'market_checklist_entry',
  'market_go_live_request', 'guardrail_rule', 'tax_rule', 'service_account', 'api_key', 'case_file', 'case_event',
  'case_evidence', 'webhook_endpoint', 'webhook_delivery',
]
// PLAN B2 section 1.
const B2_TABLES = [
  'participant_type', 'participant', 'participant_type_assignment', 'participant_signal', 'agreement_version',
  'agreement_acceptance', 'position', 'position_status_history', 'position_ownership', 'relationship', 'path_model',
  'path_node', 'customer_servicing', 'product_volume_map', 'inbound_event', 'sales_order', 'order_line', 'order_event',
  'late_transaction',
]
// PLAN B3 section 1.
const B3_TABLES = [
  'plan', 'plan_market', 'plan_calendar', 'plan_version', 'plan_rule', 'plan_transition', 'golden_dataset',
  'guardrail_decision', 'run_snapshot', 'run', 'result_line', 'qualification_state', 'simulation', 'sim_result_line',
  'adjustment_origin', 'restatement',
]
// PLAN B4 section 1.
const B4_TABLES = [
  'ledger_account', 'journal_entry', 'posting', 'gl_account_map', 'journal_export', 'run_settlement',
  'user_related_participant', 'bank_detail_request', 'bank_detail_version', 'payout_batch', 'payout_batch_line',
  'payout_instruction', 'sandbox_provider_payment', 'payout_exception', 'payout_hold', 'tax_profile',
]
// PLAN B5 section 1.
const B5_TABLES = ['portal_sign_in_code', 'notification', 'notification_preference', 'privacy_request', 'privacy_export']
// PLAN B6 section 1.
const B6_TABLES = [
  'plan_version_filing', 'data_export', 'data_export_file', 'saved_view', 'migration', 'migration_opening_balance',
  'migration_opening_state', 'parallel_run', 'parallel_run_difference',
]
// PLAN B-MKT section 1 (pack_rule is a platform table without tenant_id).
const BMKT_TABLES = ['pack_rule', 'tax_line', 'tax_form_generation', 'tax_form']
const INSERT_ONLY_TABLES = [
  'audit.audit_event', 'audit.vendor_event', 'outbox_event', 'approval', 'tenant_setting_version',
  'market_checklist_entry', 'case_event', 'case_evidence', 'document', 'participant_signal', 'agreement_version',
  'agreement_acceptance', 'position_status_history', 'order_line', 'order_event', 'plan_market', 'plan_calendar',
  'guardrail_decision', 'run_snapshot', 'result_line', 'qualification_state', 'sim_result_line',
  'ledger_account', 'journal_entry', 'posting', 'journal_export', 'run_settlement', 'bank_detail_request',
  'sandbox_provider_payment', 'privacy_export', 'plan_version_filing', 'tax_line',
]
// market_references (0105, 0204, AC-TEN2-3) counts every table with a key to market under these names, plus 'grants'
// (market_ids arrays carry no key) and 'connectors' (the commerce rows of provider_config).
const MARKET_REFERENCES: Record<string, string> = {
  calendar: 'calendars', import_batch: 'imports', compliance_report_snapshot: 'snapshots',
  cpl_fact_participant: 'fact_participants', provider_config: 'providers', market_checklist_entry: 'checklist_entries',
  market_go_live_request: 'go_live_requests', case_file: 'cases', participant: 'participants', position: 'positions',
  sales_order: 'orders', product_volume_map: 'product_volumes', agreement_version: 'agreement_versions',
  plan_market: 'plans', ledger_account: 'ledger_accounts', journal_entry: 'journal_entries', gl_account_map: 'gl_mappings',
  journal_export: 'journal_exports', payout_batch: 'payout_batches', payout_hold: 'payout_holds',
  plan_version_filing: 'filings', migration: 'migrations', tax_form_generation: 'tax_form_generations', tax_form: 'tax_forms',
}
// PLAN B1 1.1 (FR-TEN-003). The TEN settings registry pins its money-affecting keys against money_setting_keys().
const MONEY_SETTING_KEYS = [
  'money.rounding_mode', 'money.clawback_policy', 'payouts.market_policy', 'payouts.bank_detail_cooling_off_hours',
  'adjustments.policy', 'write_offs.policy',
]
// PLAN B2 1.7 (D-B2-08): every key whose change needs an approval; the registry pins it against approverPermission.
const APPROVAL_SETTING_KEYS = [
  ...MONEY_SETTING_KEYS.slice(0, 2), 'genealogy.visibility_policy', ...MONEY_SETTING_KEYS.slice(2), 'privacy.policy',
  'portal.customer_contact_visible', 'plan.filing_requirements',
]
// Table names unquoted: regclass quotes keywords such as position.
const TENANT_ID_TABLES = `
  SELECT c.oid, replace(c.oid::regclass::text, '"', '') AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
  FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
  WHERE c.relkind IN ('r', 'p') AND c.relnamespace IN ('public'::regnamespace, 'audit'::regnamespace)`

// The complete policy set: [table, policy, command, USING, WITH CHECK]. Commands: * all, r select, a insert,
// w update; a trailing ! marks a RESTRICTIVE policy. Adding, widening or dropping a policy must change this list.
type Policy = [table: string, name: string, command: string, using: string | null, check: string | null]
const OWN_TENANT = "((app_realm() = 'tenant'::text) AND (tenant_id = app_tenant_id()))"
const VENDOR = "(app_realm() = 'vendor'::text)"
const VENDOR_OWNED = "((app_realm() = 'vendor'::text) AND (tenant_id IS NULL))"
// BUG-002 (0040): a credential is reachable only by its own user, in that user's realm.
const PLATFORM_READ = "(app_realm() = ANY (ARRAY['tenant'::text, 'vendor'::text, 'system'::text]))"
const actingUser = (table: string) =>
  `((user_id = app_user_id()) AND (EXISTS ( SELECT 1 FROM user_account u WHERE (u.id = ${table}.user_id))))`
function portalSelf(table: string, own: string): Policy {
  const expression = `((app_participant_id() IS NULL) OR ${own})`
  return [table, 'portal_self', '*!', expression, expression]
}
const POLICIES_BEYOND_TENANT_ISOLATION: Policy[] = [
  ['tenant', 'tenant_self_read', 'r', "((app_realm() = 'tenant'::text) AND (id = app_tenant_id()))", null],
  ['tenant', 'vendor_manage', '*', VENDOR, VENDOR],
  ['market', 'vendor_read', 'r', VENDOR, null],
  ['user_account', 'vendor_users', '*', VENDOR_OWNED, VENDOR_OWNED],
  ['role', 'base_role_read', 'r', "((tenant_id IS NULL) AND is_base AND (app_realm() = 'tenant'::text))", null],
  ['role', 'vendor_platform_roles', '*', VENDOR_OWNED, VENDOR_OWNED],
  ['session', 'vendor_sessions', '*', VENDOR_OWNED, VENDOR_OWNED],
  // BUG-011 (0042): vendor users invite vendor users.
  [
    'user_invitation', 'vendor_invitations', '*', VENDOR_OWNED,
    "((app_realm() = 'vendor'::text) AND (tenant_id IS NULL) AND (EXISTS ( SELECT 1 FROM user_account u" +
      " WHERE ((u.id = user_invitation.user_id) AND (u.realm = 'vendor'::text)))))",
  ],
  ['support_session', 'vendor_read', 'r', VENDOR, null],
  [
    'support_session', 'vendor_request', 'a', null,
    "((app_realm() = 'vendor'::text) AND (requester_id = app_user_id()) AND (state = 'requested'::text)" +
      ' AND (decided_by IS NULL) AND (starts_at IS NULL)' +
      ' AND (ends_at IS NULL) AND (EXISTS ( SELECT 1 FROM user_account u' +
      " WHERE ((u.id = support_session.requester_id) AND (u.realm = 'vendor'::text)))))",
  ],
  [
    'support_session', 'vendor_end', 'w',
    "((app_realm() = 'vendor'::text) AND (state = 'active'::text))",
    "((app_realm() = 'vendor'::text) AND (state = 'ended'::text))",
  ],
  ['audit.vendor_event', 'vendor_only', '*', VENDOR, VENDOR],
  ['password_credential', 'acting_user', '*', actingUser('password_credential'), actingUser('password_credential')],
  ['mfa_credential', 'acting_user', '*', actingUser('mfa_credential'), actingUser('mfa_credential')],
  // FR-CPL-012 (0101): every realm reads the platform market-pack rules; nobody writes them at runtime.
  ['guardrail_rule', 'platform_read', 'r', PLATFORM_READ, null],
  ['tax_rule', 'platform_read', 'r', PLATFORM_READ, null],
  ['pack_rule', 'platform_read', 'r', PLATFORM_READ, null],
  // D-B5-02 (2): inside a portal transaction (app.participant_id set) only the session participant's rows; no-ops otherwise.
  ...([
    ['result_line', 'payee_participant_id'], ['run_settlement', 'payee_participant_id'],
    ['payout_instruction', 'payee_participant_id'], ['ledger_account', 'payee_participant_id'],
    ['bank_detail_request', 'participant_id'], ['bank_detail_version', 'participant_id'], ['tax_profile', 'participant_id'],
    ['notification', 'recipient_participant_id'], ['notification_preference', 'participant_id'],
    ['privacy_request', 'subject_participant_id'], ['user_account', 'participant_id'], ['payout_batch_line', 'participant_id'],
    // D-BM-13: the payee's own tax lines and year-end forms.
    ['tax_line', 'payee_participant_id'], ['tax_form', 'participant_id'],
  ] as const).map(([table, column]): Policy => portalSelf(table, `(${column} = app_participant_id())`)),
  // 0506: the portal session's own sessions and sign-in codes, the origins of its own lines, the evidence of its own cases.
  portalSelf('session', '(user_id = app_user_id())'),
  portalSelf('portal_sign_in_code', '(user_id = app_user_id())'),
  portalSelf('adjustment_origin', '(EXISTS ( SELECT 1 FROM result_line l WHERE ((l.origin_id = adjustment_origin.id) AND (l.payee_participant_id = app_participant_id()))))'),
  portalSelf('case_evidence', "(EXISTS ( SELECT 1 FROM case_file c WHERE ((c.id = case_evidence.case_id) AND ((c.payload ->> 'participant_id'::text) = (app_participant_id())::text))))"),
  // 0506: never in a portal transaction (staff hold text, other payees' exclusion reasons).
  ...['payout_hold', 'payout_batch'].map((table): Policy => [table, 'portal_hidden', '*!', '(app_participant_id() IS NULL)', '(app_participant_id() IS NULL)']),
  // D-B6-13: B6 tables holding one participant's data or every exported field, and saved views.
  ...['data_export', 'data_export_file', 'saved_view', 'migration_opening_balance', 'migration_opening_state', 'parallel_run_difference',
    'tax_form_generation']
    .map((table): Policy => [table, 'portal_hidden', '*!', '(app_participant_id() IS NULL)', '(app_participant_id() IS NULL)']),
  portalSelf('case_file', "((payload ->> 'participant_id'::text) = (app_participant_id())::text)"),
  portalSelf('case_event', "(EXISTS ( SELECT 1 FROM case_file c WHERE ((c.id = case_event.case_id) AND ((c.payload ->> 'participant_id'::text) = (app_participant_id())::text))))"),
  portalSelf('posting', '(EXISTS ( SELECT 1 FROM ledger_account a WHERE ((a.id = posting.account_id) AND (a.payee_participant_id = app_participant_id()))))'),
  portalSelf('privacy_export', '(EXISTS ( SELECT 1 FROM privacy_request r WHERE ((r.id = privacy_export.request_id) AND (r.subject_participant_id = app_participant_id()))))'),
  ['approval', 'portal_never_approves', 'a!', null, '(app_participant_id() IS NULL)'],
]
// Foreign keys to a tenant-scoped table that do not carry tenant_id, each kept in its tenant by other means.
const KEYS_WITHOUT_TENANT_ID = [
  'mfa_credential_user_id_fkey', // no tenant_id column: policy acting_user
  'password_credential_user_id_fkey', // no tenant_id column: policy acting_user
  'role_assignment_role_id_fkey', // base roles have no tenant: trigger role_assignment_role_in_tenant
  'role_grant_request_role_id_fkey', // base roles have no tenant: trigger role_grant_request_role_in_tenant
  'saved_view_shared_role_id_fkey', // base roles have no tenant: trigger saved_view_role_in_tenant
  'session_user_id_realm_fkey', // realm match; session_tenant_id_user_id_fkey carries the tenant
  'support_session_requester_id_fkey', // a vendor user: policy vendor_request
  'user_invitation_user_id_fkey', // vendor invitations have no tenant: policy vendor_invitations (0042)
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

  test('create every release A table, the engineering additions and the B1..B-MKT tables', async () => {
    const { rows } = await getOwnerPool().query<{ name: string }>(
      `SELECT CASE schemaname WHEN 'public' THEN tablename ELSE schemaname || '.' || tablename END AS name
       FROM pg_tables WHERE schemaname IN ('public', 'audit')`,
    )

    expect(rows.map((row) => row.name).sort()).toEqual(
      [...RELEASE_A_TABLES, ...ENGINEERING_TABLES, ...B1_TABLES, ...B2_TABLES, ...B3_TABLES, ...B4_TABLES, ...B5_TABLES, ...B6_TABLES,
        ...BMKT_TABLES, 'schema_migration']
        .sort(),
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

describe('shared functions match the catalogue', () => {
  test('market_references counts every table with a foreign key to market', async () => {
    const owner = getOwnerPool()
    const keys = await owner.query<{ name: string }>(
      `SELECT DISTINCT replace(conrelid::regclass::text, '"', '') AS name FROM pg_constraint
       WHERE contype = 'f' AND confrelid = 'market'::regclass ORDER BY 1`,
    )
    const counted = await owner.query<{ keys: string[] }>(
      'SELECT array(SELECT jsonb_object_keys(market_references(gen_random_uuid())) ORDER BY 1) AS keys',
    )

    expect(keys.rows.map((row) => row.name)).toEqual(Object.keys(MARKET_REFERENCES).sort())
    expect(counted.rows[0]!.keys).toEqual([...Object.values(MARKET_REFERENCES), 'grants', 'connectors'].sort())
  })

  test('money_setting_keys is the PLAN list of money-affecting settings', async () => {
    const { rows } = await getOwnerPool().query<{ keys: string[] }>('SELECT money_setting_keys() AS keys')

    expect(rows[0]!.keys).toEqual(MONEY_SETTING_KEYS)
  })

  test('approval_setting_keys is the PLAN list of settings whose change needs an approval', async () => {
    const { rows } = await getOwnerPool().query<{ keys: string[] }>('SELECT approval_setting_keys() AS keys')

    expect(rows[0]!.keys).toEqual(APPROVAL_SETTING_KEYS)
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
      `SELECT ARRAY[replace(p.polrelid::regclass::text, '"', ''), p.polname::text,
                    p.polcmd::text || CASE WHEN p.polpermissive THEN '' ELSE '!' END,
                    regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\\s+', ' ', 'g'),
                    regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\\s+', ' ', 'g')] AS policy
       FROM pg_policy p WHERE p.polroles = '{0}'`,
    )
    const everyPolicy = await owner.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_policy')
    const expected: Policy[] = [
      ...tenantIdTables.rows.map((table): Policy => [table.name, 'tenant_isolation', '*', OWN_TENANT, OWN_TENANT]),
      ...POLICIES_BEYOND_TENANT_ISOLATION,
    ]
    const byTableAndName = (left: Policy, right: Policy) => `${left[0]} ${left[1]}`.localeCompare(`${right[0]} ${right[1]}`)

    expect(actual.rows.map((row) => row.policy).sort(byTableAndName)).toEqual([...expected].sort(byTableAndName))
    // No role-specific policy hides outside the comparison above.
    expect(everyPolicy.rows).toEqual([{ n: expected.length }])
  })

  test('every application table has RLS enabled and forced, with or without a tenant_id column', async () => {
    const { rows } = await getOwnerPool().query<{ name: string }>(
      `SELECT replace(c.oid::regclass::text, '"', '') AS name FROM pg_class c
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
