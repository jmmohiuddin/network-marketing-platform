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
