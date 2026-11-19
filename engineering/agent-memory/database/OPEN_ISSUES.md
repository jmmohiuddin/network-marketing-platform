# database — OPEN_ISSUES

_Agent: database. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## From T-A01
- SECURITY DEFINER functions and chain/region triggers rely on the owner bypassing RLS (local owner is a superuser). A non-superuser `nmp_owner` (E-ADR-03) needs BYPASSRLS or these return nothing under FORCE RLS.
- RESOLVED in T-A01-R1 (composite keys): Foreign keys are single-column as in the brief; RI checks bypass RLS, so a row can reference another tenant's uuid if it is known.
- `--reset` drops only `public` and `audit`. A future `pgboss` schema (E-ADR-04) is not dropped, and nmp_app cannot create it: pg-boss must be installed by the owner connection.
- No runtime path purges outbox_event, idempotency_key or session rows (outbox DELETE is blocked by trigger even for the owner; purge will need partition drop or a trigger change).
- Vendor POSTs with Idempotency-Key have no home: `idempotency_key.tenant_id` is NOT NULL.
- Not enforced in SQL (left to the app): permissions exist in catalogue, privileged role needs approval_id, support-session max duration, export destination region, tenant_setting_version.effective_from vs committed periods (B).
- The `--reset` refusal on non-nmp databases and the checksum-mismatch error are not covered by tests (would need a second database).
- `getPool()` attaches no `error` listener; the API should add one with its logger.
- Audit `occurred_at` is caller-supplied (defaults to now()); tail truncation of a chain is not detectable by verification alone.

## From T-A01-R1
- Vendor-authored tenant rows have no home: the composite keys reject a vendor user as approval preparer/approver, tenant_setting_version.created_by or document.uploaded_by, and the vendor realm has no policy on those tables or on tenant-scoped user_account rows. FR-TEN-001 (provisioning with second-person approval, first-admin invitation, DPA document) needs a decision: a SECURITY DEFINER provisioning function, or vendor policies plus a separate vendor-actor column.
- support_session: the database bounds the window by `requested_minutes` on the row; "within the tenant maximum" is still the app's check (no setting key is defined). The full state machine is not enforced for the tenant realm (for example ended -> active, or raising requested_minutes), only the vendor side and the invariants are. The tenant realm may also insert a session row directly.
- The database cannot tell a tenant admin from vendor staff acting inside an active support session, because both run in the tenant realm: read-only scope and `vendor_access.decide` are app checks.
- role_assignment_role_in_tenant checks at write time only: a later `UPDATE role SET is_base = false` on an assigned base role (vendor realm) is not re-checked.
- Columns without a key stay unchecked: every `created_by`, role_assignment.market_ids / brand_ids, approval.object_id, tenant.dpa_document_id.
- `session` relies on key declaration order for identical errors (tenant key first); `references.test.ts` pins it.
- `engineering/PROJECT_ENGINEERING_CONTEXT.md` and `context/DATABASE.md` still show the policy without the realm term and single-column keys; not edited (outside packages/db).

## From B1 review (0107)
- RESOLVED 2026-11-17: seed.ts DEMO market draft, approvals via asSelf(admin2).
- BE2: pin `SETTINGS` money-affecting keys against `SELECT money_setting_keys()` in ten/settings.test.ts (SETTINGS has no money keys yet). PLAN 1.3 rebase "skip S' when equal to its new predecessor" leaves the old S as chain row at its date (stale values); the deferred money guard refuses that case when a money key is involved.
- BE3: approvals of cases must use object_type 'case'.

## From B1 completion (2026-11-17)
- nmp_dev is at migration 0031: run `MIGRATE_DATABASE_URL=postgres://127.0.0.1:5432/nmp_dev pnpm --filter @nmp/db migrate` (or reset) before using it.
- Key callers: inTenant sets app.user_id = service account id. Any B2 key write route inserting a row with a created_by/actor FK to user_account will fail the FK; give such columns a service-account alternative first.
- .env.example lacks the D-B1-16 keys (integrator owns it); defaults apply.

## From B1 review round 2 (0108)
- webhook_delivery -> outbox_event FK has no ON DELETE: the planned outbox purge (DATABASE.md) is blocked by delivery history; decide purge-with-event vs keep when retention lands.
- BE3 cases: submit sets submitted_by = acting user + submitted_at; withdraw only by the opener and must set decided_at; payload/reason_code frozen after submit; case_event.actor_id must be the acting user or NULL; evidence insert on a non-open case raises 23514 (map to 409 CASE_STATE_CONFLICT).
- BE2: provider withdraw / service-account disable must set withdrawn_by / disabled_by = acting user.
- Evidence-vs-submit concurrency (FOR SHARE) is reasoned, not tested.

## From B2 schema (2026-11-17)
- relationship cycle check is conservative (D-B2-01 shortcut comment). gen_auto_place skips terminated nodes as parents but walks their subtree.
- crm_set_servicer called directly (manual servicing route) still raises 23514 (unmapped) when the new row would start at/before the current one: the API must validate or map it (0207 fixed the C3 and G5 paths).
- crm_reassign_customers re-checks each customer's end-customer type at the new valid_from: a customer whose type changed aborts the termination with CR001.
- money_setting_keys() kept (ten/change-requests.test.ts pins it) next to approval_setting_keys(); drop once BE1 removes moneyAffecting.
- Touched outside the DB file list to keep suites green: modules/support/sessions.ts (+test), iam/api-keys.test.ts, iam/grants.test.ts, iam/mfa.test.ts, ten/settings.test.ts, ten/change-requests.test.ts, test/authz/role-matrix.test.ts SETTING_READERS, lib/formats.test.ts.
- nmp_dev / nmp_e2e / nmp_test are not migrated to 0206 (only nmp_test_2 was reset).

## From B3 schema (2026-11-17)
- Touched outside the DB file list to keep suites green: ord/order-ingest.ts (SELECT id FROM par_create_customer), support/sessions.ts (+test: PLAN 2.7 exclusions), support/routes.ts (scope max = scopePermission.options.length; 23 scope permissions now), iam/grants.test.ts (custom roles: base roles now hold permissions Tenant admin lacks), iam/mfa.test.ts, ten/settings.test.ts, gen/rebuild.test.ts (sponsor-only filters), test/authz/role-matrix.test.ts SETTING_READERS.
- gen/rebuild.ts must set path_model.valid_until = gen_path_valid_until(kind) and also rebuild models listed for valid_until with stale_since NULL (its stale read filters stale_since IS NOT NULL) — BE3.
- aud/documents.ts: document_references now returns 'guardrail_decision' (market NULL); readers default to MARKET_READERS — map to guardrail.read (integrator).
- Not enforced in SQL: rule-author SoD on plan approval, eligible approvers across all plan markets, run commit staleness gates (API), restatement origin consumption by a run of P's calendar is checked, but not that the run is the first after approval.
- nmp_dev / nmp_e2e / nmp_test not migrated to 0304 (only nmp_test_2 was reset).

## From B4 schema (2026-11-18)
- BE2: comp/commit.test.ts now asserts no journal entry for the run (shortcut comment); replace with the D-B4-02 entry when commit calls led_post_run (map LD001 -> 409 receivables_changed, DETAIL = JSON participant ids).
- BE2: AC-14.3 as nmp_app yields 'permission denied' 42501 (no UPDATE/DELETE grant), not the LEDGER_IMMUTABLE text.
- BE2/integrator: recordExport must set created_by_type explicitly or rely on app.actor_type; export_job CHECK (created_by_type = 'user') = (requested_by IS NOT NULL).
- Integrator: isolation seed must post via ledger_post and create bank versions via an approved bank_detail case (or owner); e2e helper must enrol TOTP for Support agent (role now mfa_required).
- Not enforced in SQL: never-committed-with-unconsumed-manual-origin (insert guard + API gate only), batch partially_settled/failed derivation (only settled is checked), retry instructions limited to failed payees, write-off amount <= receivable.
- nmp_dev / nmp_e2e / nmp_test not migrated to 0406 (only nmp_test_2 was reset); nmp_e2e needs reset + seed:e2e.

## From B4 review (0407, 2026-11-18)
- PLAN amendment needed (planner): PLAN 1.3 / D-B4-12 "settled only when every instruction is settled" now reads "every instruction no retry replaced"; retry-failed must set payout_instruction.retry_of; API batch-state derivation must use the same rule.
- Not enforced (blocked on BE1): approvals_required NOT NULL at submit for adjustment/write_off — cas/cases.ts markSubmitted does not pin it yet and the CAS fixture slot is 'adjustment'; add the CHECK once submit pins it. Unconsumed manual origin at period commit still API-gated.
- Write-off amount <= receivable still API-side (onDecision under the ledger lock).

## From B5 schema (2026-11-19)
- Not done by DB (outside the files this task assigned): PLAN 1.7 lib/auth.ts, lib/db.ts (inPortal), lib/session.ts (portal resolveAuth), test/helpers/users.ts createPortalUser. Done: sign-in.ts auth_find_user call, settings registry (3 keys), support SUPPORT_EXCLUDED_PERMISSIONS, cas test-support (grievance) + cases tests' literals.
- Not tested in SQL: tax_profile_missing blocker and privacy_deadline_lookup positive path (both need an approved setting change: money guard); notify_plan_change positive path (needs a scheduled plan version). selection.ts vs pay_payee_blockers equality pin is BE3's (it composes the function).
- notify_batch must be called after the batch's instructions are written; payout.held amount = led_balance at call time.
- No user_account column guards beyond realm/tenant/participant pinning (nmp_app keeps full UPDATE grant on user_account).
- nmp_dev / nmp_e2e / nmp_test not migrated to 0505 (only nmp_test_2).

## From B5 review fixes (2026-11-19)
- PLAN amendment needed (C-B5 entry, PLAN owner): D-B5-18 blocker list gains open_run; D-B5-18 cleared list gains session.ip/user_agent, notification.params.masked; D-B5-07 statement reads batch period via pay_batch_period(batch) (payout_batch hidden from portal); D-B5-02 self-policy table list extended.
- Opening an adjustment/dispute case still takes no lock against a concurrent erasure (blocker check race); erasure holds participant FOR UPDATE + ledger locks only.
- pay_payee_blockers still returns hold.reason text to a portal caller: COMP must map to codes (D-B5-07).
- nmp_dev / nmp_e2e / nmp_test not migrated to 0506.
