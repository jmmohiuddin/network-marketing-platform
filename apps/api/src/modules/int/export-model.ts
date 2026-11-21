import type { Tx } from '@nmp/db'

// D-B6-06 published model of the full data export (FR-INT-003, DATABASE §4): every tenant table of schemas public and
// audit, minus the excluded tables, minus the excluded columns. T-B6-10 (full-export-model.test.ts) fails when a tenant
// table is neither exported nor excluded, or a secret-like column is neither excluded nor kept on purpose.

export const EXPORT_MODEL_VERSION = 1
export const EXPORT_FETCH_ROWS = 5000
export const FULL_EXPORTS_KEPT = 7
/**
 * shortcut: whole table file held in memory as one gzip buffer and stored as bytea; a table whose compressed file passes
 * EXPORT_TABLE_MAX_BYTES fails the export with EXPORT_TABLE_TOO_LARGE {table} instead of running out of memory. The cap
 * also bounds the download: Postgres sends bytea as hex text, so a file costs about 5x its size in the API process
 * (hex string, its Buffer, the decoded copy), and the hex form must stay under V8's string limit (2^29 - 24 characters).
 * Stream to the FileStore (generation and download) before a tenant at the D-B6-12 scale (2M positions: result_line in the
 * tens of millions of rows) enables full exports. Measured 2026-11-20 on the S-2 write-path fixture (100k positions): the
 * largest table, result_line, is 100,000 rows = 26,959,813 bytes gzipped JSON Lines (~270 bytes per row), so the cap is
 * reached near 500k result lines (about 85k positions at S-2's six lines per position).
 */
export const EXPORT_TABLE_MAX_BYTES = 128 * 1024 * 1024

export interface ModelTable {
  readonly schema: 'public' | 'audit'
  readonly name: string
}

const PUBLIC_TABLES = [
  'adjustment_origin', 'agreement_acceptance', 'agreement_version', 'api_key', 'approval', 'bank_detail_request', 'bank_detail_version',
  'brand', 'calendar', 'case_event', 'case_evidence', 'case_file', 'compliance_figure', 'compliance_report_snapshot', 'cpl_fact_order',
  'cpl_fact_participant', 'cpl_fact_payout_line', 'customer_servicing', 'document', 'export_job', 'gl_account_map', 'golden_dataset',
  'guardrail_decision', 'import_batch', 'import_mapping', 'import_row_error', 'journal_entry', 'late_transaction', 'ledger_account',
  'market', 'market_checklist_entry', 'market_go_live_request', 'migration', 'migration_opening_balance', 'migration_opening_state',
  'notification', 'notification_preference', 'order_event', 'order_line', 'parallel_run', 'parallel_run_difference', 'participant',
  'participant_signal', 'participant_type', 'participant_type_assignment', 'path_model', 'payout_batch', 'payout_batch_line',
  'payout_exception', 'payout_hold', 'payout_instruction', 'period', 'plan', 'plan_calendar', 'plan_market', 'plan_rule',
  'plan_transition', 'plan_version', 'plan_version_filing', 'position', 'position_ownership', 'position_status_history', 'posting',
  'privacy_request', 'product_volume_map', 'provider_config', 'qualification_state', 'relationship', 'restatement', 'result_line', 'role',
  'role_assignment', 'role_grant_request', 'run', 'run_settlement', 'run_snapshot', 'sales_order', 'sandbox_provider_payment',
  'saved_view', 'service_account', 'setting_change_request', 'sim_result_line', 'simulation', 'support_session', 'tax_form',
  'tax_form_generation', 'tax_line', 'tax_profile',
  // PLAN V1-A section 1.9.
  'credit_award', 'credit_lot_event', 'credit_redemption', 'credit_type', 'fx_rate', 'fx_rate_batch', 'legal_hold', 'retention_run',
  'retention_schedule', 'tenant_offboarding',
  'tenant_setting_version', 'user_account', 'user_invitation', 'user_related_participant', 'webhook_endpoint',
]

/** Exported tables, by name (names are unique across both schemas: the file of a table is <name>.jsonl.gz). */
export const EXPORTED_TABLES: readonly ModelTable[] = [
  { schema: 'audit' as const, name: 'audit_event' },
  ...PUBLIC_TABLES.map((name) => ({ schema: 'public' as const, name })),
].sort((a, b) => a.name.localeCompare(b.name))

export const EXCLUDED_TABLES: readonly { readonly name: string; readonly reason: string }[] = [
  { name: 'outbox_event', reason: 'Delivery queue of webhook events; each event is in the audit trail and reached your endpoints.' },
  { name: 'inbound_event', reason: 'Raw provider payloads and transport state; the orders and events they produced are exported.' },
  { name: 'webhook_delivery', reason: 'Transport log of webhook attempts.' },
  { name: 'path_node', reason: 'Derived genealogy path cache, rebuilt from relationship (DATABASE §4).' },
  { name: 'session', reason: 'Sign-in sessions (credential material).' },
  { name: 'password_credential', reason: 'Password hashes (credential material).' },
  { name: 'mfa_credential', reason: 'Second-factor secrets (credential material).' },
  { name: 'portal_sign_in_code', reason: 'One-time sign-in codes (credential material).' },
  { name: 'login_attempt', reason: 'Sign-in rate-limit counters.' },
  { name: 'idempotency_key', reason: 'Stored responses of repeated requests (transport).' },
  { name: 'data_export', reason: 'The full exports themselves (listed by GET /v1/exports).' },
  { name: 'data_export_file', reason: 'The files of the full exports.' },
  { name: 'journal_export', reason: 'GL journal files, exported by their own route.' },
  { name: 'privacy_export', reason: 'Data-subject access files, exported by their own route.' },
  { name: 'pgboss.job', reason: 'Background job queue (outside schema public).' },
]

const CREDENTIAL_DIGEST = 'Digest of a credential: it would let the holder test guessed secrets offline.'
const SEALED = 'Sealed with the platform key: unreadable outside the platform; the plaintext personal data is not exported through a side door.'
const BANK_FINGERPRINT = 'Keyed digest of an account number, guessable offline.'

export const EXCLUDED_COLUMNS: readonly { readonly table: string; readonly column: string; readonly reason: string }[] = [
  { table: 'user_invitation', column: 'token_hash', reason: CREDENTIAL_DIGEST },
  { table: 'api_key', column: 'key_hash', reason: CREDENTIAL_DIGEST },
  { table: 'bank_detail_request', column: 'contact_email_sealed', reason: SEALED },
  { table: 'bank_detail_request', column: 'details_sealed', reason: SEALED },
  { table: 'bank_detail_version', column: 'details_sealed', reason: SEALED },
  { table: 'privacy_request', column: 'corrections_sealed', reason: SEALED },
  { table: 'privacy_request', column: 'requester_sealed', reason: SEALED },
  { table: 'provider_config', column: 'webhook_secret_sealed', reason: SEALED },
  { table: 'tax_profile', column: 'tax_id_sealed', reason: SEALED },
  { table: 'webhook_endpoint', column: 'secret_sealed', reason: SEALED },
  { table: 'webhook_endpoint', column: 'previous_secret_sealed', reason: SEALED },
  { table: 'bank_detail_request', column: 'fingerprint', reason: BANK_FINGERPRINT },
  { table: 'bank_detail_version', column: 'fingerprint', reason: BANK_FINGERPRINT },
  { table: 'provider_config', column: 'credentials_secret_ref', reason: 'Pointer into the platform secret store.' },
  { table: 'document', column: 'storage_key', reason: 'Internal file-store location; the file is downloaded through the documents route.' },
]

const INTEGRITY = 'Integrity value: lets you check runs, plans and the audit chain offline (BR-DAT-12).'
const REQUEST_DIGEST = 'Unkeyed digest of a request body for idempotent replays; no secret behind it.'

/** Exported on purpose although their names look secret-like (the model test requires every such column to be named). */
export const KEPT_INTEGRITY_COLUMNS: readonly { readonly table: string; readonly column: string; readonly reason: string }[] = [
  { table: 'audit_event', column: 'prev_hash', reason: INTEGRITY },
  { table: 'audit_event', column: 'hash', reason: INTEGRITY },
  { table: 'run', column: 'inputs_hash', reason: INTEGRITY },
  { table: 'run', column: 'lines_hash', reason: INTEGRITY },
  { table: 'run_snapshot', column: 'content', reason: 'The exact inputs of each run, to replay it offline (BR-DAT-12).' },
  { table: 'plan_version', column: 'content_hash', reason: INTEGRITY },
  { table: 'plan_version_filing', column: 'content_hash', reason: INTEGRITY },
  { table: 'simulation', column: 'content_hash', reason: INTEGRITY },
  { table: 'tax_form', column: 'totals_hash', reason: 'Integrity of the frozen statement: the hash of its totals.' },
  { table: 'compliance_report_snapshot', column: 'inputs_hash', reason: INTEGRITY },
  { table: 'sales_order', column: 'payload_hash', reason: INTEGRITY },
  { table: 'payout_instruction', column: 'signature', reason: INTEGRITY },
  { table: 'support_session', column: 'request_hash', reason: REQUEST_DIGEST },
  { table: 'user_account', column: 'request_hash', reason: REQUEST_DIGEST },
  { table: 'user_account', column: 'decision_request_hash', reason: REQUEST_DIGEST },
  { table: 'webhook_endpoint', column: 'previous_secret_expires_at', reason: 'When the rotated secret stops being accepted; a time, no key material.' },
]

export interface ModelColumn {
  readonly name: string
  readonly type: string
}

export interface LoadedTable extends ModelTable {
  readonly columns: readonly ModelColumn[]
  readonly primaryKey: readonly string[]
}

const excluded = new Set(EXCLUDED_COLUMNS.map((c) => `${c.table}.${c.column}`))

/** The exported tables with their exported columns (catalogue order) and primary key, as the database has them now. */
export async function loadModel(tx: Tx): Promise<LoadedTable[]> {
  const { rows } = await tx.query<{ schema: string; name: string; column: string; type: string; pk: number | null }>(
    `SELECT t.schema, t.name, a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type,
            array_position(i.indkey::int2[], a.attnum) AS pk
     FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t (schema, name, ord)
     JOIN pg_attribute a ON a.attrelid = to_regclass(quote_ident(t.schema) || '.' || quote_ident(t.name)) AND a.attnum > 0 AND NOT a.attisdropped
     LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary
     ORDER BY t.ord, a.attnum`,
    [EXPORTED_TABLES.map((t) => t.schema), EXPORTED_TABLES.map((t) => t.name)],
  )
  return EXPORTED_TABLES.map((table) => {
    const own = rows.filter((row) => row.schema === table.schema && row.name === table.name)
    return {
      ...table,
      columns: own.filter((row) => !excluded.has(`${table.name}.${row.column}`)).map((row) => ({ name: row.column, type: row.type })),
      primaryKey: own.filter((row) => row.pk !== null).sort((a, b) => a.pk! - b.pk!).map((row) => row.column),
    }
  })
}

/** GET /v1/exports/model. */
export async function modelView(tx: Tx) {
  const tables = await loadModel(tx)
  return {
    version: EXPORT_MODEL_VERSION,
    tables: tables.map((t) => ({ name: t.name, schema: t.schema, columns: t.columns })),
    excluded_tables: EXCLUDED_TABLES,
    excluded_columns: EXCLUDED_COLUMNS,
  }
}
