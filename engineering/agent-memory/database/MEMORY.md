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

## State after B2 schema (0200-0206, 2026-11-17)
- 0200 PAR + helpers (pg_trgm, app_actor_type(), ltree_prefix, to_base36, position_label_seq, set_once_guard(cols...), 2-arg assert_document_referenceable(doc, class), document_reference_guard(col, class)); 0201 GEN; 0202 CRM; 0203 ORD+INT; 0204 case_file system cases, provider_config connectors, approval_setting_keys() backstop, market_references (+participants, positions, orders, product_volumes, agreement_versions, connectors; providers excludes commerce); 0205 shared SQL (PLAN 1.8 reads, 4.2 writes G1-G5/C1/C3/P2, gen_stale_models, gen_analyze_genealogy); 0206 base roles. Next free B2 number: 0207.
- Actor pair (D-B2-03) on key-writable tables: created_by DEFAULT app_user_id() (no FK) + created_by_type DEFAULT app_actor_type(). Bare withTenant (no app.actor_type) stores 'system'.
- `position` is a keyword: regclass::text renders it "position" (tests strip quotes), and a plpgsql variable cannot be typed `position` (use record).
- Generated columns are NULL in NEW inside BEFORE triggers: exclude them from to_jsonb(NEW) comparisons (late_transaction.origin_type).
- Custom SQLSTATEs GN001-009, PA001-003, CR001-003, OR001 (PLAN 4.3); `apply` writers must go through gen_apply_relationship (it takes the per-tenant per-kind tree lock, marks path_model stale, queues outbox genealogy.changed).
- Tests: b2-guards.test.ts (every function + SQLSTATE, trigger matrix, lock serialisation with two raw connections), case-evidence-race.test.ts (OI-3). seed.ts seedB2Rows writes every B2 table through the functions.

## State after B2 review fixes (0207, 2026-11-17)
- 0207_b2_review_fixes: G5 refuses p_effective_from < position.status_from (GN006); C1 takes `pg_advisory_xact_lock('servicing:'||customer)` (serialises, no 23P01); C3 validates notice_days 0..90 (22023) and moves a customer serviced since after the reassignment date at its valid_from + 1µs; `system_time_is_now(cols...)` (nmp_app, 42501) on relationship.recorded_at/superseded_at, position_status_history.recorded_at, agreement_version.published_at; AFTER trigger on relationship marks path_model stale (G2's own upsert now redundant); path_node parent composite FK; inbound_event CHECK payload only while held; late_transaction nmp_app insert pending-only (forbid_mutation, P0001); chargeback_reversed must name a same-order chargeback with equal lines, once (unique index, 23505); order_line actor pair + created_at; `volumes_valid` / `volume_effect_valid` CHECKs (D-B2-17 strings). Next free B2 number: 0208.
- b2-guards.test.ts: tenant a has a tenant_setting_version 2 (rule company, no notice_days) from the last servicing test: later tests must not terminate positions with customers in tenant a.

## State after B2 review round 3 (0208, 2026-11-17)
- 0208_b2_active_servicers: crm_set_servicer refuses any non-active position (CR002, was: terminated only); crm_reassign_customers hands customers to the sponsor only while it is active, else company (NULL). b2-guards pins pending/suspended CR002 and the suspended-sponsor reassignment. Next free B2 number: 0209.

## State after B3 schema (0300-0304, 2026-11-17)
- Approval object types the guards require: plan_version (compliance approval and activation approval: approver ∉ {submitter, compliance approver}), run (approver ∉ {prepared_by, commit_requested_by}), guardrail_decision (override: object = evaluation id, approver = decided_by, preparer = evaluation's decided_by).
- Runtime-role inserts: plan_version draft by created_by = acting user; run queued by prepared_by = acting user; simulation queued by requested_by with content_hash = digest(version.compiled); period open only; restatement only for a restatement case whose subject is its period. submitted_by / review_opened_by / commit_requested_by are the acting user and set once.
- run: results (totals, hashes, outputs) only on running -> calculated, Σ result_line.amount_minor must equal totals.gross_minor (string); one calculated run per period is a DEFERRED exclusion (flip and discard in either order, same tx). result_line / qualification_state / sim_result_line rows only while their run/simulation is running (statement-level AFTER triggers, nmp_app only).
- plan rules/transitions/goldens: writes only while the version is draft (42501), version row taken FOR SHARE; calendar must be one of the plan's (23514).
- plpgsql: `IF CASE ... END THEN` does not parse; wrap the CASE in parentheses.
- engine static test forbids Object.keys/entries in src: json.ts sorts keys with a key-list replacer instead.
- A new position marks both path models stale (statement trigger): tests watching one kind filter rebuild outcomes by kind.
- Next free B3 number: 0305.

## State after B3 review fixes (0305, 2026-11-17)
- 0305_b3_review_fixes: rows_of_running_run/simulation take FOR SHARE on the parent (a concurrent flip waits or the insert is refused, 23514). adjustment_origin INSERT (nmp_app): unconsumed; restatement origin needs its case `approved`, restatement calculated|approved, original_period = restatement.period (FOR SHARE on restatement); late origin needs late.original_period_id match and run queued|running (FOR SHARE on run). Consumption also needs a result_line of the consuming run citing the origin.
- result_line with origin_id must equal the origin (type, payee, rule, source, amount, original period), unconsumed; late: same run; restatement: restatement `approved`, run's period later in the same calendar. Deferred constraint trigger `run_origins_consumed`: a run turned committed must have consumed every origin its lines carry by COMMIT (API commit must consume origins in the same tx; an origin carried by two runs fails the second commit: API needs a staleness gate for that).
- restatement: calculated->approved|applied need case `approved`, ->rejected case `rejected`; calculated->applied only with no origins; approved->applied needs ≥1 origin consumed by applied_in_run_id and none consumed elsewhere/unconsumed. COMP must insert origins after markDecided (CAS already flips the case before onDecision).
- run: started_at only on queued->running, finished_at on ->calculated|failed, error on ->failed, progress only while queued/running. plan_version: based_on same plan (INSERT), activated_at on ->active, retired_at on ->retired.
- `race(ctx, first, second)` two-connection helper now lives in test/support.ts. Next free B3 number: 0306.

## State after B4 schema (0400-0406, 2026-11-18)
- 0400 LED (ledger_account, journal_entry, posting, gl_account_map, journal_export, export_job created_by_type), 0401 COMP/CAS/IAM (run_settlement, manual adjustment origins, case second approval, user_related_participant, provider inbound source), 0402 PAY (+ period committed->paid guard), 0403 tax_profile, 0404 functions (ledger_post, led_post_run, led_balance, led_receivable_balances, led_receivables, led_attribution_period, period_mark_paid, staff_related_users, pay_* system lookups, money/approval key lists, market_references), 0405 base roles + Support agent MFA, 0406 opaque guardrail override. Next free B4 number: 0407.
- Ledger lock key (every payable/receivable writer): pg_advisory_xact_lock(hashtextextended('ledger:' || tenant_id || ':' || market_id, 0)); ledger_post and led_post_run take it.
- An entry's postings must arrive in ONE INSERT statement (statement trigger posting_balance); isolation/test seeds must post through ledger_post, never row by row.
- journal_entry runtime guard: origin must exist (committed run with its approval; instruction of a batch with a 'payout_batch' approval when instructed; approved write_off case with its final approval), period of the entry's market. approval_id required exactly for run_committed, payout_instructed, write_off.
- nmp_app UPDATE/DELETE on journal_entry/posting fails with 'permission denied' (42501, no grant); the LEDGER_IMMUTABLE trigger message is only seen by roles holding the privilege (owner).
- bank_detail_version: nmp_app inserts only created_via 'case' (approved bank_detail case whose payload.request_id = request); 'migration'/'self' go through the owner (seed fixtureBankDetail).
- case_file: approvals_required set only on open->submitted; first_approval_id only while submitted with 2; helper case_approval_eligible(case_file, approval, decision). GRANT UPDATE (first_approval_id, approvals_required).
- money_setting_keys() now also has the 4 B4 settings.approve keys (ten change-requests test pins it against approverPermission 'settings.approve').
- permissions.ts: renderBaseRoleMfaUpdate (line uses `name IN (...)` so the last-update regex ignores it); B4_UPDATED_BASE_ROLES, B4_MFA_CHANGED_BASE_ROLES.

## State after B4 review fixes (0407, 2026-11-18)
- journal_entry CHECK `journal_entry_key_is_origin`: key = run:<id> | writeoff:<case> | instr:<id>:instructed|settled|returned (failed shares :returned). One entry per origin+event via the unique key.
- Origin guard: instruction state must fit the event (pending for instructed, settled, returned, failed) -> PAY updates the instruction state BEFORE posting settled/returned/failed. Deferred journal_entry_balanced also binds instruction/write-off entries to exactly the two PLAN 4.3 lines for the origin's amount and payee (write-off amount = case payload.amount_minor, credit = the subject receivable account's payee).
- market.currency frozen (23514) once a ledger_account or payout_batch of the market exists; ledger account insert takes the market row FOR SHARE.
- bank_detail_version (nmp_app) must copy scheme/fingerprint/masked from its request.
- payout_instruction.retry_of (composite FK, unique; one first instruction per (batch, payee) where retry_of IS NULL). Insert: version current; batch approved -> exact line (payee, amount, version), retry_of NULL; batch failed -> retry_of = a failed instruction of the same batch/payee, amount <= it. approved->instructing: instructions = lines exactly. settled: every instruction without a retry is settled. total/exclusions change only when OLD or NEW state is draft.
- tax_profile: nmp_app sets valid_to >= now() (ms-truncated), never retroactive. Next free B4 number: 0408.

## State after B5 schema (0500-0505, 2026-11-19)
- 0500 identity (app_participant_id(), app_session_realm(), portal user_account rules, auth_find_user(realm, slug, email), sessions via auth_own_live_session, auth_reauth_session, portal_sign_in_code, portal_profile/portal_invite_target, tenant_by_slug, RESTRICTIVE portal_self policies on money/case tables + approval portal_never_approves); 0501 notification/notification_preference + notify_* + json_instant + dist_due_notifications; 0502 cases (dispute guard, system-opened privacy/bank_detail, escalated event, LOW-1 CHECK NOT VALID, comp_overdue_disputes); 0503 self bank versions, setting_in_force, assert_participant_scope, pay_shared_fingerprint_count, pay_payee_blockers; 0504 privacy tables, erasure exemptions, prv_* functions, map; 0505 base roles + approval_setting_keys. Next free B5 number: 0506.
- Portal = tenant realm + app.participant_id (withTenant ctx.participantId). RESTRICTIVE policies are in migrations.test as command '*!' / 'a!' (query no longer filters polpermissive).
- Owner-only erasure exemptions: erasure_clears_only(old, new, cols) (current_user <> 'nmp_app'), used by bank_detail_guard (args = set-once cols), tax_profile_guard, participant_guard (merge | erase | correct). participant_signal: UPDATE forbidden, DELETE ungranted.
- Definer functions bypass RLS: every query in them names own_tenant; INVOKER helpers they call (prv_erasure_blockers, setting_in_force) filter tenant explicitly too.
- Generic case tests use type 'grievance' (adjustment/write_off now need approvals_required once submitted). CAS fixture moved to grievance.
- prv_personal_data_map() must list every FK column to participant/user_account (b5-guards pins it against the catalogue): add a row when adding such a key.

## State after B5 review fixes (0506, 2026-11-19)
- acting_as_owner() (current_user = owner of participant) replaces `current_user <> 'nmp_app'` in erasure_clears_only, participant_guard, and gates the new owner exemptions (notification params.masked -> 'erased', portal user_account email/idp changes).
- bank_detail_version_insert_guard is SECURITY DEFINER now; self branch needs payouts.bank_detail_cooling_off_hours set and cooling_off_until >= ms-trunc(now()) + hours, no bank_detail case citing the request, and shared count < payouts.shared_account_threshold (when set). pay_shared_fingerprint_count is VOLATILE + advisory lock 'bank_fingerprint:<tenant>:<hex>'.
- System bank_detail case = portal tx, reason SHARED_ACCOUNT, subject = self, payload.request_id = own request by app_user_id(). System privacy case: subject_type privacy_request + deferred trigger (nmp_app) needs its privacy_request at COMMIT: create case and request in ONE tx.
- case_event (nmp_app): portal only opened/submitted/withdrawn as itself; 'escalated' only actor NULL, non-portal, submitted dispute past due_at. case_file.assigned_to must be a realm='tenant' user.
- Portal self policies added: user_account, session, portal_sign_in_code (user_id = app_user_id()), payout_batch_line, adjustment_origin (via own result_line.origin_id), case_evidence; payout_hold + payout_batch `portal_hidden` (statement uses pay_batch_period(batch)).
- user_account guard: portal deactivated = frozen; portal email/idp_subject change only by owner; firebase_subject set once.
- prv_erasure_blockers adds open_run {run_id} (queued/running/calculated run with subject lines); erasure locks ledger markets of accounts + owned positions; clears session ip/user_agent and notification params.masked.
- b5-guards helper setSetting(key, value) writes money keys with an approved change request (owner). Next free B5 number: 0507.
