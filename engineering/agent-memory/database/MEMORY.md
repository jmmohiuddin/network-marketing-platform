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

## State after B1 review (0107, 2026-11-12)
- 0107_b1_signoff_integrity: nmp_app inserts `approval` only with `approver_id = app_user_id()`; requests (setting_change_request, market_go_live_request) only `pending` by `requested_by = app_user_id()`; case_file only `open` by `opened_by = app_user_id()`; webhook_delivery only `scheduled`, unattempted. Owner exempt (D-B1-17 pattern).
- Deciding a request needs `approval_decides(approval_id, <table name>, id, state, decided_by)`; nmp_app decides as `decided_by = app_user_id()`, withdraws only its own request and must give `decision_reason`. Case decision needs an approval with object_type **'case'**, same decision, approver not opener/submitter/evidence adder. market_state_guard re-checks the approval.
- Money backstop is now a DEFERRABLE INITIALLY DEFERRED constraint trigger walking the chain from NEW.effective_from: each money-key change needs the approval of an approved setting_change_request with that exact key, value and effective_from (`money_change_approved`). Errors arrive at COMMIT (42501).
- document: no UPDATE for anyone (grant revoked + `document_no_update`). assert_document_referenceable takes `pg_advisory_xact_lock('document_reference:'||id)` (FOR UPDATE impossible without UPDATE grant).
- Test helper `asUser(tx, userId, fn)` (support.ts): approvals in fixtures are inserted as the approver. New tests: approvals.test.ts (§1.9), b1-guards.test.ts; migrations.test pins market FKs vs market_references and money_setting_keys.

## State after B1 DB package (2026-11-17)
- seed.ts helpers: `asSelf<T>` returns the write's result; `needsApproval(role)` = privileged and not Tenant admin; `seedFixturePack(db)` exported (e2e only).
- `@nmp/db/testing` getOwnerPool reads MIGRATE_DATABASE_URL, which .env sets to nmp_dev: any script using it must set it explicitly.
- API key caller contract (lib/db.ts): `request.apiKey` set, `request.auth` null; inTenant runs as the service account with actor_type 'service_account'.

## State after B1 review round 2 (0108, 2026-11-17)
- 0108_b1_review_actor_binding: generic `actor_is_acting_user('<column>')` BEFORE trigger (nmp_app only) binds case_file.submitted_by (open->submitted), case_file.opened_by on withdraw (opener only), case_evidence.added_by, case_event.actor_id (when not NULL), provider_config.withdrawn_by, service_account.disabled_by. Errors 42501.
- case_file: submitted_by/submitted_at change only on open->submitted; reason_code/payload/effect_preview frozen once not open; CHECKs submission pair, submitted_by required unless open/withdrawn, decided_at iff approved/rejected/withdrawn (withdraw must set decided_at). Evidence only on an open case (FOR SHARE on case_file, 23514).
- setting_change_request -> approved: version_id's row must carry approval_id (42501).
- Money guard (deferred): per chain row and key, if any version at that date applied an approved change of the key, the row must keep the latest such approved value; else it must keep its chain predecessor's value. Rebase rows need not copy approval_id; superseding at the same date keeping approved values is fine.
- webhook_delivery CHECK: scheduled rows have no attempted_at/status/error/duration_ms.
- guardrail_rule/tax_rule: generated `rule_key` = split_part(id,'@',1), CHECK id = rule_key@YYYY-MM-DD(effective_from), EXCLUDE overlapping versions per (market_pack, rule_key).
- 0109_b1_tenant_wide_approvers.sql: approval_eligible_users(text, uuid, uuid[], boolean) replaces the 3-arg form; p_all_markets true lists only all-markets assignments (setting change requests). Next free B1 number: 0110.
