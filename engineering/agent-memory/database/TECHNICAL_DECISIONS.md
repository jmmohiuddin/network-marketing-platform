# database — TECHNICAL_DECISIONS

_Agent: database. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## T-A01
- **RLS on every table, including `tenant`** (brief says "no RLS"): tenant reads own row, vendor realm manages all. Stops one tenant listing others. Sign-in resolves the slug through `auth_find_user`.
- **Vendor realm** = `app.realm = 'vendor'`. Policies only on tenant, market (read-only), user_account (tenant_id NULL), role (tenant_id NULL, so base roles can be seeded/maintained — one table beyond the task's list), support_session, session (tenant_id NULL), audit.vendor_event. A test pins this list.
- **Pre-context access** only through SECURITY DEFINER functions that raise unless `app.realm = 'system'` (`withSystem`): `auth_find_user(slug, email)` (slug NULL = vendor), `auth_find_session(token_hash)`, `auth_record_login_attempt(key, ip, ok)`, `auth_count_recent_failures(key, since)`, `outbox_claim(limit)`, `outbox_settle(id, delivered, retry_at)`.
- **Outbox**: nmp_app has INSERT+SELECT only. Dispatch state changes go through `outbox_claim`/`outbox_settle`; trigger allows only dispatch fields on undispatched rows, never DELETE.
- **Audit chain** computed in a BEFORE INSERT trigger (caller-supplied seq/prev_hash/hash are overwritten): per-tenant advisory lock, `hash = sha256(prev_hash || jsonb text of the row without hash/prev_hash)`, timezone pinned to UTC. `audit.verify_audit_chain(tenant)` / `audit.verify_vendor_chain()` return first broken seq or NULL.
- **Added `password_credential`** (user_id, password_hash): E-ADR-02 needs it and `user_account` has no such column. `mfa_credential.last_used_step` added for one-time TOTP codes. `login_attempt` keyed by opaque `account_key`, no direct grant.
- **Credential tables** have no tenant_id; their policy is `EXISTS (visible user_account row)`.
- **Provisional enums**: user_account.state (invited, active, locked, deactivated), import_mapping.state (draft, approved), tenant.isolation_tier (pooled, dedicated), session.assurance_level (aal1, aal2). export_job.state/kind left unchecked.
- `id` columns default to `gen_random_uuid()` (apps may still supply uuid v7). `email` must be lower case (CHECK). Standard `created_at`/`created_by` on all tables except the audit ones.
- Snapshot state machine: computing -> ready | failed | outdated, ready -> outdated; nothing else changes.
- "First data load" for `tenant.region` immutability = an import_batch in state loaded or superseded.
- cpl_fact_* not partitioned (E-ADR-12); audit_event not partitioned.

## T-A01-R1
- **Edited 0001-0006 in place** instead of adding 0007: nothing is released, the task required `--reset` on both databases, and one definition per table reads better than create-then-alter.
- **Composite keys over triggers** wherever both sides have tenant_id (declarative, and an unknown id and a foreign id fail with the same constraint). Exceptions, each listed in `KEYS_WITHOUT_TENANT_ID`: role_assignment.role_id (base roles have no tenant: BEFORE trigger, SECURITY INVOKER with an explicit tenant predicate), session (user_id, realm), support_session.requester_id (vendor user, checked in policy `vendor_request`), the two credential tables (no tenant_id; policy `owner_visible`).
- **Vendor support-session rights are two mechanisms**: policies state the allowed states (visible in `pg_policy`, pinned by the allow-list test), the trigger pins the other columns because a policy cannot compare OLD and NEW.
- **Did not enforce the whole support-session state machine**: the brief has no transition for revoking an approved, unused session, so a strict machine would block a flow the API will need. Enforced only what protects the tenant: who may decide, that access states carry a decider, and a bounded window.
- **`support_session_access_needs_decision` covers approved and active only**: denied may have no decider (auto-deny, SECURITY_IAM_TENANCY note 10).
- **Realm in the tenant policy and a blank context in the helpers** are both kept: either alone closes the reported path, together a stray session-level SET cannot widen anything.
- **Isolation tests are a matrix** (8 contexts x 24 tenant tables + 5 vendor tables) returning the list of leaking tables, with a guard test that the owner sees a seeded row in every table nmp_app can SELECT. Per-table `test.each` cases were removed, hence 76 tests instead of 90.
- The LIKE-based policy test and the vendor-table-list test were replaced by one exact comparison of the whole policy set.

## B2 schema
- One generic set_once_guard(cols) for close-once rows (assignments, ownership, servicing, volume map, relationship, sales_order facts) instead of per-table triggers.
- G2 'change' with no open row inserts directly (root positions can get a parent); overlap is still refused by relationship_guard.
- System duplicate case decision: approval preparer must be the submitter (checked only for opened_by NULL; B1 user cases unchanged).
- market_references splits provider_config into providers (non-commerce) and connectors (commerce).
- order_event_quantity_guard locks the order row (FOR UPDATE) and also refuses unknown lines / non-positive quantities (23514).

## B3 schema
- run_snapshot hash checked by a BEFORE INSERT trigger, not a CHECK, so a tampered row (owner) is still detectable by replay (AC-COMP8-1).
- Extra uniques beyond PLAN: one acknowledgement per evaluation, one late origin per (run, late item, position, rule), one calculated run per period (deferred EXCLUDE).
- Acknowledgements/overrides must repeat their evaluation's rule, version, outcome and content hash (guardrail queries need no join to find the content).
- guardrail_outstanding reasons: acknowledgement_required, override_required, not_overridable.

## B4 schema
- Balance check = statement-level trigger on posting (all of an entry's postings in one statement, balanced, >= 2) + deferred per-entry constraint trigger; avoids O(n^2) per-posting deferred checks on large run entries and forbids appending to old entries.
- led_post_run aggregates commission_expense into one debit and one credit line (not one per payee); withholding aggregated; payee lines per payee.
- Added beyond PLAN: journal_entry origin/approval guard, ledger_account currency = market currency, composite FKs (tenant, participant, version/request) so lines/instructions/versions name the payee's own bank version/request, unique request per version, period_mark_paid locks the period row first (race of last two settlements), Paid needs >= 1 instruction, bank-detail versions by nmp_app only from a case.
- Opaque override limited to blocked evaluations; NULL-safe comparison on detail->>'opaque'.

## B5 schema
- Added beyond PLAN: user_account realm/tenant/participant pinned (self scope cannot be redirected); dispute guard also checks payload line_id/run_id and market = line's position market; privacy_request insert guard (own privacy case, portal = self verified by session); privacy_export insert guard (approved access/portability); notification_template() map enforced by CHECK; notification_preference.updated_by FK + actor binding; prv_sign_in_attempts definer (nmp_app has no login_attempt grant).
- prv_personal_data INVOKER (RLS) with a definer only for login_attempt; the map is a SQL function (section or reason per FK column).
- prv_correct_participant refuses portal transactions; prv_erase_participant also resets mfa_enrolled.

## B-MKT schema
- tax_form/tax_form_generation insert guard = GUC `app.tax_generation` equal to the generation id (set and cleared by tax_generate_forms), not xmin (B6 lesson).
- Year-end status reason order: TAX_YEAR_NOT_DEFINED alone when no tax year (the form rule is looked up on the year's last day); else FORM_NOT_DEFINED, TAX_YEAR_NOT_ENDED, TAX_YEAR_NOT_CLOSED. tax_generate_forms raises the first.
- tax_withholding_instructions returns the rule's rounding as stored (rate-NULL rules may carry 'none'); prior_minor = this year's gross (cumulative) or last year's (prior-year basis), NULL without threshold.
- Grievance resolution deadline in calendar days/months of the market zone; ack in elapsed hours.
- Personal-data map: tax_line/tax_form excluded with reason "tax records of the payer" (PLAN D-BM-13 wording), not exported sections.
- Added beyond PLAN: unique index case_event (tenant, case, data->>'deadline') WHERE escalated (once per deadline under concurrency); market_references counts the two tax tables with a market key (AC-TEN2-3 pin).
