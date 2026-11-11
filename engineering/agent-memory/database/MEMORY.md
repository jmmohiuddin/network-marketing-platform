# database — MEMORY

_Agent: database. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## State after T-A01 (2026-11-12)
- `packages/db` holds migrations 0001-0006 (27 tables incl. `schema_migration`), `src/{migrate,pool,index,testing}.ts`, 90 passing tests in `test/`.
- Migrations are checksummed in `schema_migration`: never edit an applied file, add `0007_*.sql`.
- New tenant-scoped table recipe: create table, `SELECT apply_tenant_rls('<table>')`, grant the minimum to `nmp_app`, add `forbid_mutation()` trigger if insert-only. The coverage test fails otherwise.
- Context helpers in SQL: `app_tenant_id()`, `app_realm()` ('tenant' | 'vendor' | 'system'); they treat '' as unset (pooled connections keep '' after SET LOCAL).
- `pnpm --filter @nmp/db reset|migrate` reads `.env` (nmp_dev) unless `MIGRATE_DATABASE_URL` is set in the shell. Always set it explicitly.
- Test helpers: `import { resetTestDb, createTenant, createUser, getOwnerPool, closeOwnerPool } from '@nmp/db/testing'` (owner connection, refuses anything but nmp_test / nmp_e2e).
- pg returns bigint/int8 as string; consumers convert with `BigInt()`.

## State after T-A01-R1 (2026-11-12) — supersedes the lines above where they differ
- 76 passing tests in 7 files; new: `test/seed.ts` (`seedTenantRows`, `seedVendorRows`), `references.test.ts`, `support-session.test.ts`; helpers `insertRow`, `withSettings` in `test/support.ts`.
- 0001-0006 were edited in place once, before any release, and nmp_test + nmp_dev were rebuilt with `--reset`. nmp_e2e was not touched: it needs `--reset` before its next use or `migrate` stops on the checksum check. From here on the rule stands again: add `0007_*.sql`.
- New tenant-scoped table recipe, added steps: `UNIQUE (tenant_id, id)` if anything will reference it; every reference to another tenant-scoped table is `FOREIGN KEY (tenant_id, x_id) REFERENCES x (tenant_id, id)`; add the table and a seed row to `test/seed.ts` and to `TENANT_ID_TABLES` in `isolation.test.ts`. Three tests fail otherwise (policy set, key catalogue, seed coverage).
- A new or changed policy must be added to `POLICIES_BEYOND_TENANT_ISOLATION` in `migrations.test.ts` (exact `pg_get_expr` text, whitespace collapsed).
- Tenant policies match only `app.realm = 'tenant'`. A portal context (release B) needs its own realm value in `apply_tenant_rls` or its own policies.
- support_session rules the API must follow: the vendor realm inserts `state = 'requested'` only (no decided_by / starts_at / ends_at, requester a vendor user) and may update only active -> ended (ends_at may move earlier, nothing else). Approve, deny, start and expire run in the tenant realm (`withTenant`). An illegal vendor update of a non-active row affects 0 rows; on an active row it raises. `SELECT ... FOR UPDATE` in the vendor realm returns active rows only.
- Actor columns with a key (approval.preparer_id/approver_id, tenant_setting_version.created_by, document.uploaded_by, import_*.uploaded_by/approved_by, export_job.requested_by, support_session.decided_by) accept users of the same tenant only, never vendor users.
- FK errors: code 23503 with `constraint` = `<table>_tenant_id_<column>_fkey`; the role trigger raises 23503 with a message and no constraint name.
