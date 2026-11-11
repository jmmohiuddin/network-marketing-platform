# MVP_A_SPEC — implementation brief for release MVP-A (compliance-analytics overlay)

Sources read in full for the MVP-A slice: `product-documentation/02-prd/02_FUNCTIONAL_REQUIREMENTS.md` (PRD-02 v0.1, draft, not approved) — the 18 MVP-A records; `04_BUSINESS_RULES.md` (PRD-04) — rel A rules plus B rules referenced by A requirements; `05_USER_STORIES.md` (PRD-05), `06_ACCEPTANCE_CRITERIA.md` (PRD-06); `08-qa/02_TEST_SCENARIOS.md` (QA-02); `09-governance/traceability-data/spec.json` (rel=A filter; acceptance rows carry no `rel`, derived via story); prototype `engineering/reference/phase_a/prototype/{analytics.py, test_analytics.py, validate_export.py, report.json, data_synthetic/README.txt, *.csv}`.

Verification done while writing: `python3 -I test_analytics.py` → ALL TESTS PASSED (16 fixture checks + synthetic invariants); `python3 -I validate_export.py data_synthetic` → exit 0 "usable"; `python3 -I analytics.py data_synthetic` re-run output is byte-for-byte equal (sorted JSON) to the committed `report.json`; replacing `pct()` with Decimal ROUND_HALF_UP gives identical output on the synthetic set (no rounding ties).

Status of every source: draft v0.1, persona needs are unvalidated hypotheses. All amounts are integer **minor units** ("cents"). "Release" column: **A** = MVP-A, **B** = MVP-B, **B-MKT** = MVP-B market pack, **V1**.

---

## 0. Scope at a glance

| Kind | MVP-A IDs (all rel A) |
|---|---|
| Requirements (18) | FR-IAM-001, FR-IAM-002, FR-IAM-003, FR-IAM-005, FR-TEN-001, FR-IMP-001, FR-IMP-002, FR-IMP-003, FR-CPL-001..006, FR-PRV-004, FR-AUD-001, FR-AUD-002, FR-OPS-001 |
| Stories (12) | US-24, US-25, US-29, US-31, US-35, US-36, US-39, US-40, US-41, US-53, US-54, US-57 |
| Acceptance criteria (21) | AC-24.1, AC-24.2, AC-25.1, AC-25.2, AC-29.1..3, AC-31.1, AC-35.1, AC-35.2, AC-36.1, AC-36.2, AC-39.1..3, AC-40.1, AC-41.1, AC-53.1, AC-54.1, AC-54.2, AC-57.1 |
| Business rules (16) | BR-PTY-01, BR-GRD-04, BR-SEC-01, -02, -03, -04, -05, -07, BR-DAT-07, BR-DAT-09, BR-IMP-01..04, BR-CPL-01, BR-HON-01 |
| Tests (10) | TS-21, TS-31, TS-32, TS-33, TS-34, TS-35, TS-36, TS-37, TS-56, TS-57 |
| Screens (10) | SC-10, SC-14, SC-24, SC-25, SC-26, SC-27, SC-28, SC-30, SC-39, SC-46 |
| APIs (11) | API-01..09, API-39, API-40 |
| Entities (20 tables) | tenant (ENT-01), market (ENT-02), tenant_setting_version, user_account, role, role_assignment, approval, support_session (ENT-23), audit_event (ENT-24), document, import_batch, import_row_error, import_mapping, cpl_fact_participant, cpl_fact_order, cpl_fact_payout_line, compliance_report_snapshot (ENT-21), compliance_figure (ENT-21), outbox_event, export_job |

Out of scope in A even though referenced by A records (rel B unless noted): FR-IAM-004 (SoD), FR-IAM-006 (API keys), FR-GEN-006 (downline scope), FR-TEN-002 (markets/brands/calendars UI), FR-TEN-003 (versioned settings UI), FR-CPL-007..013, FR-CPL-009 (V1), SC-29, TS-50, TS-59, BR-GRD-03, BR-CAP-02, BR-SEC-06, engine-sourced facts ("period committed"), market packs.

Product invariants that apply to everything in A:
- BR-HON-01 (A, P): the product contains **no income projection, potential-earnings calculator or recruit leaderboard**. R5 is an internal computation only; publication is FR-CPL-009 (V1).
- Reports are **indicators** for a compliance reviewer, not findings that a plan is lawful/unlawful (analytics.py docstring).
- PRD-04 convention: **no parameter value (rate, threshold, window) is set by the catalogue**; values are tenant settings. The only numbers fixed by documents are test-fixture values (TS-31) and AC-35.2's "five failed sign-ins".

---

## 1. Roles, permissions, screens and APIs

### 1.1 Personas / base roles used in A
Tenant admin; Compliance officer; Implementation consultant; Executive (read); DPO; Finance approver (only as an MFA-required role for AC-35.1); Vendor ops (separate vendor realm).

### 1.2 Permission strings (verbatim from spec)
| Permission | Used by |
|---|---|
| `import.manage` | SC-24, API-01, API-02 |
| `mapping.edit`, `mapping.approve` | SC-25, API-03 |
| `snapshot.create` | SC-10, SC-46, API-04 |
| `compliance.read` | SC-10, SC-26, SC-46, API-05, API-06 |
| `export` | SC-26, API-06 (`?export=true`) |
| `audit.read` | SC-30, API-09 |
| `user.manage` | SC-28, API-40 |
| `vendor_access.decide` | SC-14, API-08 decision |
| `settings.manage` (+ item-specific) | API-39 |
| `vendor role(s)` | SC-39, API-08 request |
| `public` | SC-27, API-07 |

Role→permission matrix is not specified beyond the FR "Permissions" fields below; TS-36 requires it to be table-driven and exhaustively tested.

### 1.3 Screens (rel A)
| ID | Name | Area | Personas | Primary / secondary actions | Info shown | Components | Perms | Goes to |
|---|---|---|---|---|---|---|---|---|
| SC-46 | Compliance overview (overlay home) | Admin | Compliance officer; Executive | Create snapshot / Open reports; open imports | Latest R1–R5 headline figures; data coverage; warnings | KPI cards; trend sparkline; data status panel | compliance.read | SC-10, SC-24 |
| SC-10 | Compliance reports | Admin | Compliance officer; Executive | Create snapshot / Open figure; export; compare periods | Figures with populations, method notes, data-quality warnings, trend | Period selector; figure cards; charts; method drawer; snapshot list | compliance.read; snapshot.create | SC-26, SC-46 |
| SC-26 | Figure drill-down | Admin | Compliance officer | Export (logged) / Page; filter | Definition; numerator and denominator rows; sums | Definition panel; paged table | compliance.read; export | SC-10 |
| SC-24 | Data imports | Admin | Implementation consultant | Upload files / Load; Download error report; view batches | Batches with state, counts, control totals; validation errors | Upload zone; batch table; validation report | import.manage | SC-25, SC-10 |
| SC-25 | Import mapping | Admin | Compliance officer; Implementation consultant | Approve mapping / Add note | Distinct values with counts; target category; version history | Mapping table; version selector | mapping.edit; mapping.approve | SC-24, SC-10 |
| SC-27 | Sign-in and second factor | Shared | All | Sign in / Enrol factor; recover | Credential fields; factor prompt | Form | public | role home |
| SC-28 | Users and roles | Admin | Tenant admin | Invite / Assign role; Approve privileged grant; deactivate | Users with roles, scopes, MFA state; role permission matrix; pending approvals | Table; role editor; permission matrix | user.manage | SC-30 |
| SC-14 | Vendor access sessions | Admin | Tenant admin | Approve / Deny; Set duration; end session now | Requests with reason, scope; active sessions; session logs | Request cards; log table | vendor_access.decide | SC-30 |
| SC-30 | Audit log | Admin | Compliance officer; Tenant admin | Search / Open event; export | Events with actor, action, object, time | Filter bar; table; event drawer | audit.read | — |
| SC-39 | Vendor operations console | Vendor | Vendor ops | Request support session / Provision tenant; maintain market packs (B) | Tenants with region, tier, state, job health; session requests | Table; request modal; provisioning wizard | vendor roles | — |

Entry points (spec.json `entry`): SC-46 "Sign-in landing in MVP-A"; SC-10 "Nav Compliance; overlay home"; SC-26 "From SC-10"; SC-24 "Overlay nav Data"; SC-25 "From SC-24"; SC-27 "Tenant URL"; SC-28 "Nav Settings › Users"; SC-14 "Notification; nav Settings › Vendor access"; SC-30 "Nav Settings › Audit"; SC-39 "Vendor sign-in". Wireframe flag: all Y except SC-30 (N).

Landing: SC-46 is the sign-in landing in MVP-A. SC-29 (Tenant settings, incl. breach contacts) is **rel B** — see Conflicts C-1.

### 1.4 APIs (rel A)
| ID | Method + path | Purpose | Auth | Authz | Idempotency |
|---|---|---|---|---|---|
| API-01 | `POST /v1/imports` | Create an import batch and upload export files | User session | import.manage | Idempotency-Key required |
| API-02 | `GET /v1/imports/{id}` | Batch state, control totals, validation report | User session | import.manage | Safe |
| API-03 | `PUT /v1/import-mappings/{id}` | Save a new mapping version; `POST …/approve` to approve | User session | mapping.edit, mapping.approve | If-Match version |
| API-04 | `POST /v1/compliance/snapshots` | Create a report snapshot (async job) | User session | snapshot.create | Idempotency-Key required |
| API-05 | `GET /v1/compliance/snapshots/{id}` | Snapshot with figures, populations, method and input versions | User session or API key (API key = B, see C-9) | compliance.read | Safe |
| API-06 | `GET /v1/compliance/snapshots/{id}/figures/{key}/rows` | Drill-down rows for a figure; `?export=true` creates a logged export | User session | compliance.read, export | Safe |
| API-07 | `POST /v1/auth/sessions` | Sign-in, MFA verification, step-up, refresh, sign-out (sub-resources) | Public, rate limited | — | Not applicable |
| API-08 | `POST /v1/support-sessions` | Vendor requests access; `POST …/{id}/decision` by tenant admin; `GET …/{id}/log` | Vendor session / user session | vendor role / vendor_access.decide | Idempotency-Key required |
| API-09 | `GET /v1/audit-events` | Search audit events | User session | audit.read | Safe |
| API-39 | `PUT /v1/settings/{key}` | Versioned settings, markets, brands, calendars, provider records, market checklist, tenant provisioning (vendor) | User or vendor session | settings.manage and item-specific | If-Match version |
| API-40 | `POST /v1/users` | Invite users; roles and role assignments; approvals of privileged grants | User session | user.manage | Idempotency-Key required |

Universal API rule (BR-SEC-04, TS-21): tenant id comes **only** from the authenticated session and is enforced in the data layer (RLS); no endpoint accepts a tenant id from the client; cross-tenant object ids fail **without leaking existence**.

---

## 2. Entities (20 tables, Release A migration)

Flags: PK, NN (not null), UQ. `scoped=Y` → `tenant_id` + RLS.

| Table (ENT) | Owner | Columns (type, flags, FK) | Indexes | Constraints | Audit |
|---|---|---|---|---|---|
| tenant (ENT-01), scoped N | TEN | id uuid PK; legal_name text NN; slug text NN UQ; region text NN; isolation_tier text NN; db_route text NN; state text NN; dpa_document_id uuid; created_at timestamptz NN | slug | state in (provisioning, implementation, live, archived); **region immutable after first data load** | all changes → vendor audit log and tenant audit log |
| market (ENT-02) | TEN | id PK; tenant_id NN→tenant; code text NN; currency char(3) NN; minor_unit smallint NN; time_zone text NN; languages text[] NN; market_pack text NN; state text NN | (tenant_id, code) UQ | state in (draft, live, suspended); cannot delete once referenced | state changes audited with approver |
| tenant_setting_version | TEN | id PK; tenant_id NN→tenant; version int NN; effective_from timestamptz NN; settings jsonb NN; reason text NN; created_by uuid NN→user_account; approval_id uuid→approval | (tenant_id, version) UQ; (tenant_id, effective_from) | no update or delete; effective_from not inside a committed period | every version is itself the audit record |
| user_account | IAM | id PK; tenant_id uuid→tenant; realm text NN; idp_subject text NN; email text NN; display_name text; mfa_enrolled boolean NN; state text NN; participant_id uuid→participant (B table, see C-14); last_sign_in_at timestamptz | (realm, idp_subject) UQ; (tenant_id, email) UQ | realm in (tenant, portal, vendor); vendor users have null tenant_id | sign-in, lock, role changes audited |
| role | IAM | id PK; tenant_id uuid→tenant (null = platform base role); name text NN; permissions text[] NN; is_base boolean NN; mfa_required boolean NN | (tenant_id, name) UQ | permissions must exist in the permission catalogue | changes audited |
| role_assignment | IAM | id PK; tenant_id NN; user_id NN→user_account; role_id NN→role; market_ids uuid[]; brand_ids uuid[]; valid_from timestamptz NN; valid_to timestamptz; approval_id uuid→approval | (tenant_id, user_id) | privileged roles require approval_id | grant and revoke audited; alert on new admin |
| approval | IAM | id PK; tenant_id NN; object_type text NN; object_id uuid NN; preparer_id NN→user_account; approver_id NN→user_account; decision text NN; reason text; factor_verified_at timestamptz; decided_at timestamptz NN | (tenant_id, object_type, object_id) | CHECK approver_id <> preparer_id; decision in (approved, rejected) | is an audit record; immutable |
| support_session (ENT-23) | IAM | id PK; tenant_id NN; requester_id NN→user_account; reason text NN; scope jsonb NN; requested_minutes int NN; state text NN; decided_by uuid→user_account; starts_at, ends_at timestamptz | (tenant_id, state) | state in (requested, approved, denied, active, expired, ended); ends_at − starts_at within tenant maximum | every action in session written to audit_event with session id |
| audit_event (ENT-24) | AUD | id PK; tenant_id uuid NN; seq bigint NN; occurred_at timestamptz NN; actor_type text NN; actor_id uuid; support_session_id uuid; action text NN; object_type text; object_id uuid; before_ref text; after_ref text; request_id text; prev_hash bytea; hash bytea NN | (tenant_id, seq) UQ; (tenant_id, object_type, object_id); (tenant_id, actor_id, occurred_at) | insert only; **hash = H(prev_hash, payload)** | chain verified daily |
| document | AUD | id PK; tenant_id NN; class text NN; storage_key text NN; sha256 bytea NN; mime text NN; size_bytes bigint NN; uploaded_by uuid→user_account; version int NN | (tenant_id, class) | class in (evidence, agreement, tax_form, export, sensitive_id, disclosure) | access to sensitive class logged per read |
| import_batch | IMP | id PK; tenant_id NN; market_id NN→market; kind text NN; period_from date NN; period_to date NN; state text NN; mapping_id uuid→import_mapping; row_counts jsonb; control_totals jsonb; superseded_by uuid→import_batch; uploaded_by NN→user_account | (tenant_id, market_id, period_from, state) | state in (uploaded, rejected, validated, mapped, loaded, superseded); kind in (overlay, migration) — A uses `overlay` | state changes audited |
| import_row_error | IMP | id PK; tenant_id NN; batch_id NN→import_batch; file text NN; row_no int; column_name text; code text NN; detail text | (batch_id, code) | — | none (derived) |
| import_mapping | IMP | id PK; tenant_id NN; version int NN; mappings jsonb NN; notes text; state text NN; approved_by uuid→user_account | (tenant_id, version) UQ | approved versions immutable | approval audited |
| cpl_fact_participant | CPL | id PK; tenant_id NN; source text NN; batch_id→import_batch; participant_ref text NN; type_code text NN; counts_as_end_customer boolean NN; can_earn boolean NN; enrolled_month date NN; servicing_ref text; market_id NN→market | (tenant_id, batch_id, participant_ref) UQ | source in (import, native); participant_ref pseudonymous for imports | none (reproducible) |
| cpl_fact_order | CPL | id PK; tenant_id NN; source text NN; batch_id→import_batch; order_ref text NN; order_date date NN; buyer_ref text NN; amount_minor bigint NN; volume_minor bigint NN; purpose text NN; is_starter_kit boolean NN; refunded_minor bigint NN; refund_month date | (tenant_id, batch_id, order_ref) UQ; (tenant_id, order_date) | purpose in (customer, personal, resale, enrolment, unknown); refunded_minor <= amount_minor | none |
| cpl_fact_payout_line | CPL | id PK; tenant_id NN; source text NN; batch_id→import_batch; line_ref text NN; pay_month date NN; payee_ref text NN; bonus_type text NN; source_kind text NN; source_order_ref text; amount_minor bigint NN | (tenant_id, batch_id, line_ref) UQ; (tenant_id, pay_month, source_kind) | source_kind in (retail_sale, downline_volume, enrolment_order, pool, match, clawback, other, unknown) | none |
| compliance_report_snapshot (ENT-21) | CPL | id PK; tenant_id NN; market_id NN→market; period_from date NN; period_to date NN; method_version text NN; mapping_id→import_mapping; settings_version_id→tenant_setting_version; input_refs jsonb NN; state text NN; created_by NN→user_account; inputs_hash bytea NN | (tenant_id, market_id, period_from, period_to) | no update except state → outdated; state in (computing, ready, outdated, failed) | creation audited |
| compliance_figure (ENT-21) | CPL | id PK; tenant_id NN; snapshot_id NN→compliance_report_snapshot; report text NN; period date; key text NN; value_num numeric(20,6); numerator bigint; denominator bigint; population_count int; note text | (snapshot_id, report, period, key) UQ | report in (R1, R2, R3, R4, R5) | none |
| outbox_event | INT | id PK; tenant_id NN; seq bigserial NN; topic text NN; key text NN; payload jsonb NN; available_at timestamptz NN; attempts int NN; dispatched_at timestamptz; dead boolean NN | (dispatched_at, available_at) WHERE dispatched_at IS NULL | written in the same transaction as the state change | none |
| export_job | INT | id PK; tenant_id NN; kind text NN; filters jsonb; row_count bigint; document_id→document; destination text; requested_by→user_account; state text NN | (tenant_id, kind) | destination must be in the tenant's region | creation audited with row count |

---

## 3. Import file format (FR-IMP-001) — exact, from prototype

Three UTF-8 CSV files with header row (validator opens with `utf-8-sig`, so a BOM is tolerated). Extra columns are allowed **unless** they trip the forbidden-column rule.

### 3.1 Required columns
| File | Required columns (order irrelevant) | Optional seen in synthetic |
|---|---|---|
| `participants.csv` | `participant_id`, `type`, `enrolled_month`, `sponsor_id` | `market`, `status` |
| `orders.csv` | `order_id`, `month`, `day`, `buyer_id`, `amount_cents`, `volume_cents`, `purpose`, `is_starter_kit`, `refunded_cents`, `refund_month` | — |
| `payout_lines.csv` | `line_id`, `month`, `payee_id`, `bonus_type`, `source_kind`, `source_order_id`, `amount_cents` | — |

Synthetic headers (verbatim): `participant_id,type,enrolled_month,sponsor_id,market,status` · `order_id,month,day,buyer_id,amount_cents,volume_cents,purpose,is_starter_kit,refunded_cents,refund_month` · `line_id,month,payee_id,bonus_type,source_kind,source_order_id,amount_cents`.

### 3.2 Column semantics → fact mapping
| CSV column | Type / format | Fact column | Notes |
|---|---|---|---|
| participant_id | pseudonymous text | cpl_fact_participant.participant_ref | BR-IMP-02: must be pseudonymous |
| type | partner code | type_code → flags via mapping | flags `counts_as_end_customer`, `can_earn` (BR-PTY-01) |
| enrolled_month | `YYYY-MM` (regex `^\d{4}-(0[1-9]\|1[0-2])$`) | enrolled_month (date, 1st of month) | |
| sponsor_id | participant_id or empty | servicing_ref | for customers = servicing distributor (used by R4); for distributors = upline |
| order_id | text, unique | order_ref | |
| month + day | `YYYY-MM` + int day | order_date | day used by R4 late-order test; synthetic day range 1..28 |
| buyer_id | participant_id | buyer_ref | must exist in participants |
| amount_cents, volume_cents, refunded_cents | integer minor units (empty → 0) | amount_minor, volume_minor, refunded_minor | refunded ≤ amount |
| purpose | `customer \| personal \| resale \| unknown \| enrolment` (or partner code mapped via FR-IMP-002) | purpose | |
| is_starter_kit | int 0/1 (empty → 0) | is_starter_kit | |
| refund_month | `YYYY-MM` or empty | refund_month | |
| line_id | text | line_ref | |
| month (payout) | `YYYY-MM` | pay_month | |
| payee_id | participant_id | payee_ref | must exist |
| bonus_type | free text | bonus_type | |
| source_kind | `retail_sale \| downline_volume \| enrolment_order \| pool \| match \| clawback \| other` (+ `unknown` in entity) | source_kind | |
| source_order_id | order_id or empty | source_order_ref | required for order-level kinds (below) |
| amount_cents | signed integer minor units | amount_minor | clawbacks negative |

### 3.3 Validation rules (validate_export.py, with product deltas)
Blocking errors (batch → `rejected`, **zero rows stored**, BR-IMP-01 / AC-39.1):

| # | Rule (prototype) | Message pattern (prototype) | Product requirement |
|---|---|---|---|
| V1 | each of the 3 files present | `{fn}: file missing` | same |
| V2 | required columns present | `{fn}: missing columns [...]` | same (schema mismatch) |
| V3 | **forbidden column**: header split on `[^a-z0-9]+` (lower-cased); any token in FORBIDDEN_TOKENS | `{fn}: columns look like personal or bank data and must be removed before sharing: [...]` | reject **whole batch**, name offending columns (AC-39.1, TS-32) |
| V4 | duplicate participant_id | `participants.csv: duplicate participant_id` | same; also add duplicate `line_id` (not in prototype, C-17) |
| V5 | enrolled_month matches `YYYY-MM` (first failure only) | `participant {id}: enrolled_month '…' is not YYYY-MM` | same |
| V6 | duplicate order_id | `orders.csv: {n} duplicate order_id values, e.g. {id}` | same |
| V7 | buyer_id exists | `order {id}: buyer {b} not in participants.csv` | orphan → error **above tolerance setting** (FR-IMP-001, AC-39.3) |
| V8 | month / refund_month `YYYY-MM` | `order {id}: month or refund_month is not YYYY-MM` | also months within declared period range (FR-IMP-001 "months in range"); also validate payout `month` (missing in prototype) |
| V9 | amount_cents, volume_cents, refunded_cents, day, is_starter_kit integers | `…: {k}='…' is not an integer (amounts must be whole cents)` | BR-IMP-02 |
| V10 | refunded_cents ≤ amount_cents | `order {id}: refunded more than the order amount` | same (entity CHECK) |
| V11 | purpose in vocabulary | `orders.csv: purpose values outside [...]: {...} — map them before running` | product: raw codes accepted and mapped in FR-IMP-002 (C-10) |
| V12 | payout amount_cents integer | as V9 | same |
| V13 | payee_id exists | `line {id}: payee {p} not in participants.csv` | orphan, tolerance (AC-39.3) |
| V14 | source_kind in (retail_sale, downline_volume, enrolment_order, clawback) ⇒ source_order_id ∈ orders | `line {id}: source_order_id '…' not in orders.csv (order-level lines are needed for R2 and R3)` | product: counted as unattributable (FR-CPL-002) — blocking only above tolerance (C-12) |
| V15 | source_kind in vocabulary | `payout_lines.csv: source_kind values outside [...]` | mapped via FR-IMP-002; unmapped → `unknown` |

Repeated row-level problems: the first instance is reported, then `  ... the problem above ({cat}) occurs {n} times in total`. Product stores **every** row finding in `import_row_error` (file, row_no, column_name, code, detail) and exposes a downloadable error report (SC-24).

FORBIDDEN_TOKENS (verbatim): `name, firstname, lastname, fullname, email, phone, mobile, address, street, postcode, zip, nric, ic, pan, aadhaar, ssn, tin, passport, bank, iban, account, dob, birth, birthdate`. TS-32 names: `email, phone, bank_account, national_id, address` — note `national_id` tokenises to `national`,`id` and is **not** caught by the prototype list (C-18): product must add `national` (and any identity token) so TS-32 passes.

Warnings (do not block):
| Condition | Message |
|---|---|
| always | `participant types found: {...} — confirm which are non-participant customers` |
| sponsor_id not in file | `{n} participants have a sponsor_id not in the file (export cut-off or data error)` |
| refunded_cents > 0 and refund_month empty | `{n} refunded orders have no refund_month (R4 refund follow-up will miss them)` |
| purpose `unknown` > 25% of orders | `{x%} of orders have purpose 'unknown'; R1 and R2 will be weak indicators` |
| source_kind `other` > 20% of lines | `more than 20% of payout lines are 'other'; R3 will not say much` |

Order of checks: V1–V3 are file-level; if any fires the validator stops before row checks (returns immediately). An order row failing V9 skips V10 and the refund-month warning for that row. Output lines: `read {n} participants, {n} orders, {n} payout lines` (only when rows were read), then `ERROR  …`, `WARNING …`, `RESULT  usable | not usable until the errors are fixed`.

Result: exit 0 = `usable` (warnings may remain), 1 = `not usable until the errors are fixed`.

Control totals (FR-IMP-001/003): row counts per file and sums of amount_cents, volume_cents, refunded_cents, payout amount_cents, computed at validation and re-checked after load (must be equal, FR-IMP-003). Synthetic golden control totals:

| Measure | Value |
|---|---|
| participants rows | 1,466 (customer 667, distributor 449, preferred_customer 350; market DEMO; status active; enrolled 2024-12..2025-12) |
| orders rows | 4,775 (purpose: customer 2,439, personal 1,365, enrolment 429, resale 365, unknown 177; starter kits 429) |
| Σ amount_cents = Σ volume_cents | 53,195,001 |
| Σ refunded_cents | 2,600,070 (235 refunded orders, all full refunds) |
| Σ net sales (Σ R1 monthly net) | 50,594,931 |
| payout_lines rows | 7,442 (downline_volume 4,159; retail_sale 2,439; enrolment_order 429; clawback 321; pool 94) |
| Σ payout amount_cents | 9,225,679 = gross 9,563,635 + clawbacks −337,956 |
| lines with empty source_order_id | 94 (all `pool`) |
| bonus_type values | unilevel 4,159; retail_commission 2,439; fast_start 429; clawback 321; leader_pool 94 |
| order day range; refunded orders without refund_month | 1..28; 0 |
| Data: synthetic, `synth.py` seed 20261111 — "Not any company's data." | |

---

## 4. Requirement records (MVP-A)

Format per FR: inputs · logic · validation · outputs · errors · permissions · screens/APIs/entities · rules · ACs (verbatim) · tests.

### 4.1 FR-IAM-001 — Tenant-scoped authentication and sessions (A, Must)
- **Desc**: every human user signs in to exactly one tenant context (or the vendor console); session carries tenant id, user id, roles, assurance level; no request served without it.
- **Trigger**: sign-in page opened or session expires. **Pre**: account exists, active in tenant.
- **In**: email or SSO assertion; password or passkey; second factor when required.
- **Logic**: verify credential at IdP; **resolve tenant from sign-in hostname**; issue short-lived access token + rotating refresh token bound to tenant; record audit event.
- **Validation**: account not locked; tenant active; clock skew within tolerance.
- **Out**: authenticated session; audit event `AUTH.SIGN_IN`.
- **Errors**: wrong credential (generic message, counter incremented); locked account; tenant archived (read-only notice); IdP unavailable (retry page).
- **Role**: All staff roles. **Perm**: public endpoint; rate limited per IP and per account.
- **Links**: SC-27 / API-07 / user_account, audit_event. Dep FR-AUD-001. Rule BR-SEC-04. Story US-35. ACs (source): AC-35.1, AC-35.2.
- **AC-35.1**: see §4.2 (verbatim there).
- **AC-35.2**: GIVEN Five failed sign-ins inside the lockout window / WHEN A sixth attempt is made / THEN The account is temporarily locked and the response does not reveal whether the account exists.
- BR-SEC-04 is proved by TS-21 (via AC-29.2, which the source attaches to FR-IAM-005/US-29 — verbatim in §4.4).
- **Tests**: TS-35; TS-21 (BR-SEC-04).

### 4.2 FR-IAM-002 — MFA for privileged roles (A, Must)
- Roles requiring 2nd factor: tenant admins, payout preparers/approvers, plan approvers, compliance officers, **all vendor staff**. Approvals require **step-up** (fresh factor within configurable window).
- **Trigger**: sign-in, or step-up action (source list: approve batch, commit run, activate plan, approve adjustment, change bank details — all B objects; A step-up targets see C-4).
- **In**: TOTP code or WebAuthn assertion.
- **Logic**: deny privileged session without enrolled factor; step-up requires factor verified within window; record assurance level on approval record (`approval.factor_verified_at`).
- **Out**: session assurance level **AAL2**; approval records carry factor time.
- **Validation**: factor enrolled; code unused; within window.
- **Errors**: no factor enrolled → forced enrolment; invalid code → limited retries; lost device → admin-assisted reset as logged case with second approver.
- **Role**: Tenant admin; Finance approver; Vendor ops. **Pre**: role flagged MFA-required (`role.mfa_required`).
- **Perm**: self-service enrolment; reset needs Tenant admin + second approver.
- **Links**: SC-27 / API-07 / user_account, approval. Dep FR-IAM-001. Story US-35. ACs AC-35.1, AC-35.2. Rule BR-SEC-02 (payout approvers, tenant admins, vendor staff use MFA).
- **AC-35.1**: GIVEN A user with the Finance approver role and no enrolled factor / WHEN They sign in / THEN They cannot reach any page until a factor is enrolled.
- **Tests**: TS-35 (Forced enrolment; temporary lock with generic message; approval refused until factor verified).

### 4.3 FR-IAM-003 — Roles, permissions and attribute scopes (A, Must)
- Permissions granted through roles; assignment scoped by **market** and **brand**; platform base roles (`role.is_base`, tenant_id null) can be cloned into tenant roles. Distributor downline scope (FR-GEN-006) is B.
- **Pre**: Tenant admin signed in with MFA. **Trigger**: admin creates a role, edits permissions or assigns a user.
- **In**: role name; permission set; scope (markets, brands); assignee.
- **Logic**: validate against permission catalogue; reject SoD-breaking combinations (FR-IAM-004, B — C-5); **grant of admin or approver role opens an approval request for a second admin**; all changes audited; effective immediately on approval.
- **Out**: role, role_assignment, audit events, **alert on new admin role**.
- **Validation**: permission exists; scope values exist; assigner cannot grant permissions they do not hold.
- **Errors**: conflicting duty pair; sole remaining admin cannot remove own admin role.
- **Perm**: Tenant admin (admin/approver grant needs second admin). Rule BR-SEC-05.
- **Links**: SC-28 / API-40 / role, role_assignment, approval, audit_event. Dep FR-IAM-001. Story US-36.
- **AC-36.1**: GIVEN A role assignment that grants admin or approver permissions / WHEN Submitted by one admin / THEN It takes effect only after a second admin approves; both actions are audited.
- **AC-36.2**: GIVEN A user scoped to market X / WHEN They request data of market Y in the same tenant / THEN The API returns no rows for market Y.
- **Tests**: TS-36 (table-driven matrix: every permission × every base role × market scope; each role can do exactly what the matrix states; privileged grants need a second admin).

### 4.4 FR-IAM-005 — Vendor support sessions (A, Must)
- Vendor staff have **no standing access**. Access = request (reason, scope) approved by a tenant admin for fixed duration; read-only by default; region-bound; fully logged; visible to tenant.
- **Pre**: vendor user has MFA; tenant has at least one admin. **Trigger**: vendor engineer requests access.
- **In**: tenant; reason; scope (modules, read-only or named write action); duration.
- **Logic**: create request; notify tenant admins; on approval mint time-boxed scoped credential; log every screen view, query and API call to the tenant-visible session log; auto-expire; produce session report.
- **Out**: support session, session log, session report.
- **State machine** (support_session.state): `requested → approved | denied`; `approved → active → expired | ended`; request undecided before request expiry → `denied` (auto-denied).
- **Validation**: duration within tenant maximum (`ends_at − starts_at`); requester outside tenant's region needs explicit region approval.
- **Errors**: no decision before request expiry (auto-denied); action outside scope (blocked and logged).
- **Perm**: request = Vendor ops; decide = Tenant admin (`vendor_access.decide`).
- **Links**: SC-14, SC-39 / API-08 / support_session, audit_event (with `support_session_id`). Dep FR-AUD-001. Story US-29. Rule BR-SEC-01. ACs AC-29.1, AC-29.2, AC-29.3.
- **AC-29.1**: GIVEN Vendor engineer requests access / WHEN Tenant approves for a set number of hours read-only / THEN Access expires automatically; every query and screen view is logged and visible to the tenant.
- **AC-29.2**: GIVEN Any API request / WHEN Tenant A's token is used to read Tenant B's object id / THEN The request fails; an automated suite covers every endpoint for this.
- **AC-29.3**: GIVEN A vendor user without an approved session / WHEN They request tenant business data / THEN The request is refused and logged in both vendor and tenant audit logs.
- **Tests**: TS-37 (refused and logged in both logs; write blocked in read-only session; access ends at expiry), TS-21 (AC-29.2), TS-57 (out-of-region session needs explicit region approval).

### 4.5 FR-OPS-001 — Vendor operations console (A, Must)
- Separate app area + **separate identity realm** (`user_account.realm = vendor`, tenant_id null): tenant list (region, tier, health), provisioning, support-session requests, market-pack maintenance (B). Shows **no tenant business data** outside an approved session.
- All actions audited to vendor audit log and, if tenant-affecting, to tenant log.
- **Trigger**: vendor user signs in. **In**: none. **Out**: console views. **Validation**: no tenant data without session.
- **Errors**: open tenant data without session → blocked, logged. Perm: vendor ops roles. Pre: vendor staff account with MFA.
- **Links**: SC-39 / API-08 / tenant, support_session. Dep FR-IAM-005. Story US-57. Rule BR-SEC-01.
- **AC-57.1**: GIVEN The vendor console tenant list / WHEN Opened without a support session / THEN It shows operational metadata only (status, region, tier, job health) and no participant, order or payout data.
- **Tests**: TS-37.

### 4.6 FR-TEN-001 — Tenant provisioning and data region (A, Must)
- Tenant created with data region, isolation tier (pooled or dedicated database) and routing entry; all tenant data, backups and exports stay in region.
- **Pre**: signed DPA recorded (`tenant.dpa_document_id`). **Trigger**: vendor ops creates a tenant. **In**: legal name; region; isolation tier; first admin contact.
- **Out**: tenant, routing entry, admin invitation.
- **Logic**: create routing entry (`db_route`) and database (or schema objects in pooled DB); apply RLS policies; create first admin invitation; record DPA reference and breach contacts.
- **Tenant state machine**: `provisioning → implementation → live → archived`; failed step → idempotent retry, stays `provisioning`. Region immutable after first data load.
- **Validation**: region available; tier allowed in region.
- **Perm**: Vendor ops **with second-person approval**.
- **Links**: SC-39 / API-39 / tenant, tenant_setting_version. Dep FR-IAM-003. Story US-31. Rule BR-DAT-09.
- **AC-31.1**: GIVEN Tenant region set / WHEN Data written / THEN Personal data and backups stay in the configured region; vendor support from outside the region needs explicit approval.
- **Tests**: TS-57 (writes, backups and export destinations checked against tenant region; `export_job.destination` must be in region).

### 4.7 FR-PRV-004 — Breach-notification contacts and runbook data (A, Must)
- Per tenant and market: breach contacts and notification timelines; produce list of affected data subjects and data classes for a scope.
- **Role**: DPO; Vendor ops. **Pre**: tenant provisioned. **Trigger**: tenant onboarding; incident. **In**: contacts; timelines.
- **Logic**: stored in settings (`tenant_setting_version.settings`); incident tooling queries audit and data maps.
- **Out**: contact record; affected-subject report. **Validation**: ≥1 contact per tenant. **Error**: missing contact blocks go-live.
- **Perm**: Tenant admin edits; Vendor ops reads. Links: SC-29 (B — C-1) / API-39 / tenant_setting_version. Dep FR-TEN-001. Story US-53. Rule BR-DAT-07 (configured per market and per tenant, At M).
- **AC-53.1**: GIVEN A tenant without a breach contact / WHEN Go-live or first data load is attempted / THEN It is blocked until a contact is recorded.
- **Tests**: TS-50 is **MVP-B** (C-2); A needs its own check: `POST /v1/imports` load and tenant state → `live` refused when no breach contact.

### 4.8 FR-AUD-001 — Immutable audit log (A, Must)
- Every security- and money-relevant action writes audit_event (actor, action, object, before/after refs, tenant, time, request id) to an **append-only store separate from application tables**.
- **Logic**: written in the same transaction **through the outbox** to the audit store; **hash-chained per tenant** (`hash = H(prev_hash, payload)`, `seq` gap-free per tenant); searchable by actor, object, time.
- **Validation**: chain verification job passes (runs daily).
- **Error**: audit store unavailable → events buffered in outbox; **money actions blocked if buffer exceeds a limit** (limit = setting, unspecified).
- **Perm**: read = Tenant admin, Compliance officer (`audit.read`); vendor reads only inside a support session.
- **Role**: Tenant admin; Compliance officer. **Pre**: none. **Trigger**: any audited action. **In**: event. **Out**: audit event.
- **Links**: SC-30 / API-09 / audit_event, outbox_event. Dep —. Story US-54. Rule BR-SEC-07. ACs AC-54.1 (verbatim §4.9), AC-54.2.
- **AC-54.2**: GIVEN The audit chain verification job / WHEN Run after any event is altered in storage / THEN It reports the break.
- **Tests**: TS-56 (break detected; export above cap refused; tax-id masking part is B/AC-48.1).

### 4.9 FR-AUD-002 — Export limits and logging (A, Must)
- Exports of rows containing personal data: size-limited **per role**, respect visibility rules, logged with who, what filter, how many rows.
- **Role**: all staff roles. **Pre**: user has export permission. **Trigger**: export. **In**: view; filters. **Validation**: within cap. **Perm**: by role.
- **Logic**: row cap per role; asynchronous for large exports; **watermark with requester id**.
- **Out**: export file (`document` class `export`), `export_job`, audit event. **Error**: above cap → refused with path to request a scheduled export.
- **Links**: SC-30, SC-26 / API-06 / export_job, audit_event. Dep FR-AUD-001. Story US-54. Rule BR-SEC-03. ACs AC-54.1, AC-54.2 (verbatim §4.8).
- **AC-54.1**: GIVEN An export of rows with personal data / WHEN Performed / THEN An audit event records actor, view, filters and row count.
- **Tests**: TS-34, TS-56.

### 4.10 FR-IMP-001 — Export upload and schema validation (A, Must)
- Upload participants, orders, payout lines; validated against published schema **before any row is stored**.
- **Pre**: tenant exists; data terms accepted. **Trigger**: upload or drop into tenant inbound location.
- **In**: three CSV files; declared period range; market; currency.
- **Logic**: required columns, types, key uniqueness, referential links; reject files with columns that look like names, contacts, addresses, identity or bank data; compute row counts and control totals; store batch as `validated` or `rejected` with row-level error report. (§3)
- **Validation**: participant ids pseudonymous; amounts integers in minor units; months in range; every order buyer and payout payee exists.
- **Errors**: schema mismatch; forbidden column present; orphan references above tolerance; duplicate keys.
- **Out**: import batch; validation report.
- **Role**: Implementation consultant; Compliance officer. **Perm**: Implementation consultant; Tenant admin (`import.manage`).
- **Links**: SC-24 / API-01, API-02 / import_batch, import_row_error. Dep FR-TEN-001. Story US-39. Rules BR-IMP-01, BR-IMP-02. ACs (source): AC-39.1, AC-39.2 (verbatim §4.12), AC-39.3.
- **AC-39.1**: GIVEN A participants file containing a column named email or bank_account / WHEN Uploaded / THEN The batch is rejected, no row is stored and the offending columns are named.
- **AC-39.3**: GIVEN A payout line whose payee id is not in the participants file / WHEN Validated / THEN The row is reported and the batch is not loadable until resolved or the tolerance setting allows it.
- **Tests**: TS-32.

### 4.11 FR-IMP-002 — Value mapping with versions (A, Must)
- Map partner codes → platform vocabulary: **participant types → flags** (earns, counts as end customer), **order purpose**, **payout source kind**, **starter-kit flag**. Mapping versioned; every report records mapping version (BR-IMP-03).
- **Role**: Compliance officer; Implementation consultant. **Pre**: a validated batch exists. **Trigger**: user opens mapping. **In**: source values; target vocabulary; notes. **Out**: mapping version. **Dep**: FR-IMP-001. **Story**: US-40. **Rules**: BR-IMP-03, BR-PTY-01.
- **Logic**: list distinct source values with counts; require a target for each; unmapped → `unknown` and reported; saving creates a new mapping version.
- **Validation**: every source value mapped or explicitly left unknown.
- **Error**: mapping changed after a snapshot was published → new snapshot required; old one keeps its version.
- **Perm**: Compliance officer approves (`mapping.approve`); consultant drafts (`mapping.edit`).
- **State**: import_mapping.state values are **not enumerated in the source** (entity says only "approved versions immutable", `approved_by`); proposed draft → approved (approved immutable; edit = new version). API-03 uses If-Match version.
- **Target vocabularies**: participant type flags per BR-PTY-01 (can earn, counts as end customer, can sponsor, can hold positions); purpose ∈ {customer, personal, resale, enrolment, unknown}; source_kind ∈ {retail_sale, downline_volume, enrolment_order, pool, match, clawback, other, unknown}.
- Synthetic default mapping (prototype config): `end_customer_types = ["customer", "preferred_customer"]`; every other type (`distributor`) is treated as distributor/earning.
- **AC-40.1**: GIVEN A mapping version used by a published snapshot / WHEN The mapping is edited / THEN A new version is created; the published snapshot still shows the old version and is marked Outdated.
- **Links**: SC-25 / API-03 / import_mapping. Tests TS-31 (BR-PTY-01), TS-33.

### 4.12 FR-IMP-003 — Import batch lifecycle and data-quality report (A, Must)
- **State machine** (import_batch.state):
  `uploaded → validated | rejected`; `validated → mapped` (mapping approved and attached, `mapping_id`); `mapped → loaded` (load txn); `loaded → superseded` (later batch for same period loaded; `superseded_by` set). Load interrupted → txn rolled back, stays `mapped`. `rejected` is terminal.
- **Logic**: load into cpl_fact_* in **one transaction per batch**; re-import of same period supersedes earlier batch **without deleting it** (BR-IMP-04); data-quality report: share of orders with unknown purpose, refunds without month, payout lines without source order.
- **Validation**: control totals after load = totals at validation.
- **Trigger**: user loads the batch. **In**: batch id; mapping version. **Out**: loaded facts; data-quality report.
- **Perm**: Implementation consultant. Pre (source): batch validated and mapping approved; (added per C-21) AC-53.1 breach contact present.
- **Links**: SC-24 / API-01, API-02 / import_batch, cpl_fact_participant, cpl_fact_order, cpl_fact_payout_line. Dep FR-IMP-002. Story US-39. Rule BR-IMP-04. ACs (source): AC-39.1, AC-39.2, AC-39.3.
- **AC-39.2**: GIVEN A valid batch loaded for a period already loaded / WHEN Load completes / THEN The earlier batch is marked Superseded, remains readable and existing snapshots keep pointing to it.
- **Tests**: TS-33 (old batch Superseded and readable; old snapshot figures unchanged and reproducible; new snapshot uses the new batch).

### 4.13 FR-CPL-006 — Snapshots, method versions and drill-down (A, Must)
- Each report run = immutable snapshot recording inputs (batch ids), mapping/settings version, method version, figures, populations. Any figure opens to its population and source rows.
- **Logic**: compute in a job (API-04 async); store figures with keys (compliance_figure UQ (snapshot_id, report, period, key)); drill-down returns rows forming numerator and denominator, paginated; export logged.
- **Snapshot state machine**: `computing → ready | failed`; `ready → outdated` (inputs superseded or mapping changed); never otherwise updated. Facts superseded during computation → abort and retry (FR-CPL-001 error).
- **Validation**: recomputing from same inputs + versions gives identical figures (`inputs_hash`; BR-CPL-01).
- **Pre**: facts (or committed runs, B) exist. **Trigger**: snapshot creation or a figure is opened. **In**: report set; period; versions. **Out**: snapshot; figure rows.
- **Errors (source)**: inputs superseded → snapshot marked Outdated, never changed.
- **Perm**: Compliance officer; drill-down export logged (FR-AUD-002).
- **Links**: SC-10, SC-26 / API-04, API-05, API-06 / compliance_report_snapshot, compliance_figure. Dep FR-AUD-002. Story US-41.
- **AC-41.1**: GIVEN A figure in a snapshot / WHEN The user opens drill-down / THEN Numerator and denominator row sets are returned, their sums equal the figure's components, and the export is logged.
- **Tests**: TS-34 (drill-down on each R1..R5 figure; sums equal components; export audit event with row count), TS-33.

### 4.14 FR-CPL-001..005 — R1..R5 (A, Must)
Shared: Pre = facts loaded (overlay); engine-committed source is B. Trigger = snapshot request. Snapshot stores population counts + method version. Exact formulas in §5.

| FR | Report | In | Validation | Errors | Perm | Rules | ACs |
|---|---|---|---|---|---|---|---|
| FR-CPL-001 | R1 retail-customer share | period range; market; mapping/settings version | denominator 0 → figure null with reason | facts superseded during computation → aborted, retried | Compliance officer, Tenant admin, Executive (read) | BR-GRD-04, BR-CPL-01 | AC-24.1, AC-24.2 |
| FR-CPL-002 | R2 personal-use share of rewarded volume | period; threshold setting | lines without source order counted, reported as unattributable | threshold not set → figure shown, flag count omitted | Compliance officer | BR-GRD-03 (B), BR-CAP-02 (B) | AC-24.1, AC-24.2 |
| FR-CPL-003 | R3 payout source mix (period + year) | period range | every line has source kind (unknown allowed, reported) | none specific | Compliance officer, Executive | BR-GRD-04 | AC-24.1, AC-24.2 |
| FR-CPL-004 | R4 qualification-by-purchase; period-end threshold orders | active threshold; rank thresholds; late-order day | thresholds present | missing day field → indicator omitted with note | Compliance officer | BR-GRD-03 (B) | AC-24.1, AC-24.2 |
| FR-CPL-005 | R5 earnings distribution | year; population rule | population count = band total | partial year → labelled partial, not publishable | Compliance officer | BR-GRD-04, BR-HON-01 | AC-25.1, AC-25.2 |

Further source fields (PRD-02):

| FR | Role | Pre | In / logic (source wording, condensed) | Out | Screens / APIs / Entities | Story |
|---|---|---|---|---|---|---|
| FR-CPL-001 | Compliance officer | Facts loaded (overlay) or period committed (engine) | net sales = amount − refunded per order; numerator = orders whose buyer type counts as end customer; second figure adds participant orders with purpose resale; all figures stored with population counts and method version | Report snapshot with figures and method notes | SC-10, SC-46 / API-04, API-05 / compliance_report_snapshot, compliance_figure | US-24 |
| FR-CPL-002 | Compliance officer | Payout lines carry source order references | select positive payout lines of source kind downline volume; sum volume of their distinct source orders by purpose; per payee compare pay from personal-use orders with the threshold share of that payee's multi-level pay | Figures; flagged payee list (ids only) | SC-10 / API-04, API-05 / same | US-24 |
| FR-CPL-003 | Compliance officer; Executive | Payout lines classified by source kind | sum amounts by source kind excluding clawbacks for shares; clawbacks as a separate negative total; shares sum to 100 within rounding. Kinds: retail sale, downline volume, enrolment order, pool, match, other | Figures and chart data | SC-10 / API-04, API-05 / same | US-24 |
| FR-CPL-004 | Compliance officer | Thresholds configured | accumulate personal volume per distributor in day order; detect crossings by late orders (on or after a configurable day); join refunds | Figures; crossing list | SC-10 / API-04, API-05 / same | US-24 |
| FR-CPL-005 | Compliance officer | A full year of payout lines | population = earning-type participants enrolled on or before year end; earnings = sum of payout lines per participant, zero when none; statistics; band counts sum to population. Basis: gross commissions net of clawbacks, before expenses | Distribution figures | SC-10 / API-04, API-05 / same | US-25 |

All FR-CPL-001..005: Trigger = snapshot request (FR-CPL-001: "User requests a snapshot for a period range"); Dep FR-CPL-006.

ACs verbatim:
- **AC-24.1**: GIVEN A period / WHEN Reports run / THEN Each figure links to its population and method; totals reconcile with the committed run or the loaded batch control totals.
- **AC-24.2**: GIVEN The hand-checked fixture of three participants, three orders and four payout lines (QA TS-31) / WHEN Reports run / THEN R1 customer share is 62.50%, R2 personal-use share is 60.00%, R3 retail share is 80.65% and downline share 19.35%.
- **AC-25.1**: GIVEN A year / WHEN Distribution generated / THEN It includes all participants who held an earning agreement in the year, including those with zero earnings; method and version are stored.
- **AC-25.2**: GIVEN The fixture of TS-31 / WHEN Distribution generated / THEN Population is 2, share earning more than zero is 50.00%, median is 14.30.
- **AC-21.1** (US-21, rel B story, proved by TS-31): GIVEN Participant types configured / WHEN Retail share report runs / THEN Only types flagged counts as end customer are in the numerator.

---

### 4.15 User stories (rel A, PRD-05)
| US | Persona | Want | Pre | Main flow | Alt flow | ACs | Requirements | Dep |
|---|---|---|---|---|---|---|---|---|
| US-24 | Compliance officer | reports on retail-customer share, personal-consumption share and payout sources per period | Facts loaded or period committed | Open Compliance reports → choose period range → create snapshot → read figures with method notes → open a figure to its rows → export | Data-quality warnings: shown beside affected figures | AC-24.1, AC-24.2 | FR-CPL-001..004 | FR-CPL-006 |
| US-25 | Compliance officer | earnings distribution from all participants' payouts, incl. zero earners, kept with its method | Full year of payout lines | Create yearly snapshot → read distribution → (V1) draft and publish disclosure | Partial year: labelled partial and not publishable | AC-25.1, AC-25.2 | FR-CPL-005, FR-CPL-009 (V1) | FR-CPL-006 |
| US-29 | Tenant admin | approve or deny a vendor support session and see everything done in it | Request raised | Receive request → read reason and scope → approve for a duration or deny → later read the session report | No decision before request expiry: auto-denied | AC-29.1..3 | FR-IAM-005 | FR-AUD-001 |
| US-31 | Tenant admin | keep data in a chosen region | Region offered | Region chosen at provisioning → shown in settings → support access from outside needs explicit approval | Region change: migration project, not a setting | AC-31.1 | FR-TEN-001 | FR-TEN-001 |
| US-35 | Staff user | sign in with a second factor when role requires it | Account invited | Open tenant sign-in → enter credential → pass second factor → land on role home | No factor enrolled for a privileged role: forced enrolment | AC-35.1, AC-35.2 | FR-IAM-001, FR-IAM-002 | None |
| US-36 | Tenant admin | give each colleague only the permissions their job needs | Admin with MFA | Open Users and roles → invite user → assign role and market scope → second admin approves privileged grants | Conflicting duties: refused with explanation | AC-36.1, AC-36.2 | FR-IAM-003 | FR-IAM-002 |
| US-39 | Implementation consultant | upload an export and get a validation report before anything is stored | Data terms accepted | Open Data imports → upload three files → read validation report → fix and re-upload → load | Forbidden column detected: batch rejected, nothing stored | AC-39.1..3 | FR-IMP-001, FR-IMP-003 | None |
| US-40 | Compliance officer | decide how own codes map to customer, personal use and payout source categories | Validated batch | Open mapping → review distinct values with counts → set targets → note reasons → approve | Value left unknown: counted and shown in data-quality figures | AC-40.1 | FR-IMP-002 | FR-IMP-001 |
| US-41 | Compliance officer | open any figure and see the rows behind it | Snapshot exists | Click a figure → read population definition → page through rows → export within limits | Export above the cap: refused with a path to a scheduled export | AC-41.1 | FR-CPL-006 | FR-AUD-002 |
| US-53 | DPO | breach contacts and timelines recorded per tenant and market | Tenant provisioned | Open settings → enter contacts and timelines → confirm | Missing contact: go-live blocked | AC-53.1 | FR-PRV-004 | FR-TEN-001 |
| US-54 | Compliance officer | search an audit log of who did what and who exported what | Audit read permission | Open Audit log → filter by actor, object, action, time → open event | Vendor staff: readable only inside an approved session | AC-54.1, AC-54.2 | FR-AUD-001, FR-AUD-002 | None |
| US-57 | Vendor operations engineer | a console showing tenant health without tenant business data | Vendor account with MFA | Open console → see tenants, region, tier, health → request a support session when data access is needed | No session: business data endpoints refuse | AC-57.1 | FR-OPS-001 | FR-IAM-005 |

AC → test mapping (PRD-06 Tests column): AC-24.1 TS-59 (B); AC-24.2 TS-31; AC-25.1 TS-59 (B); AC-25.2 TS-31; AC-29.1 TS-37; AC-29.2 TS-21; AC-29.3 TS-37; AC-31.1 TS-57; AC-35.1/35.2 TS-35; AC-36.1/36.2 TS-36; AC-39.1 TS-32; AC-39.2 TS-33; AC-39.3 TS-32; AC-40.1 TS-33; AC-41.1 TS-34; AC-53.1 TS-50 (B); AC-54.1 TS-34; AC-54.2 TS-56; AC-57.1 TS-37.

---

## 5. Report definitions R1–R5 — as implemented in analytics.py (method baseline)

Configuration (`DEFAULT_CONFIG`, prototype; in product each is a tenant setting / mapping, no shipped default — C-15):

| Key | Prototype value | Product source |
|---|---|---|
| end_customer_types | `["customer", "preferred_customer"]` | mapping flag `counts_as_end_customer` |
| active_pv_cents | 5000 | tenant setting (R4 active threshold) |
| rank_thresholds_pv_cents | `{"active": 5000, "leader": 10000}` | tenant setting |
| late_order_day | 27 | tenant setting |
| personal_share_flag | 1/3 (report.json `config` stores `0.3333333333333333`; R2 `flag_threshold` stores `round(…, 4)` = `0.3333`) | tenant setting (counsel's) |

Loader (`load`): reads CSVs with `utf-8` (no BOM tolerance, unlike the validator); orders `amount_cents, volume_cents, refunded_cents, is_starter_kit, day` → `int(v or 0)`; payout `amount_cents` → `int` (empty raises). report.json top-level keys: `months`, `config`, `R1`..`R5`. Empty population → R5 statistics `None`.

Definitions:
- `endc` = end-customer types; `is_dist` = participants whose type ∉ endc (prototype; product should use `can_earn`, C-9b).
- `months` = sorted distinct `month` over orders ∪ payout lines (`YYYY-MM`).
- `pct(n, d)` = `None` if d == 0 else `round(100.0 * n / d, 2)`. Product: null with reason when d = 0; Decimal ROUND_HALF_UP to 2 dp reproduces report.json exactly.
- `net(o)` = amount_cents − refunded_cents (refund netted into the **order's** month regardless of refund_month).

### R1 — sales to non-participant customers (per order month m; orders with month = m)
| Key | Formula |
|---|---|
| net_sales_cents | Σ net(o) |
| customer_share_pct | pct(Σ net(o) where buyer type ∈ endc, total) |
| customer_plus_declared_resale_pct | pct(cust + Σ net(o) where buyer ∈ is_dist and purpose = resale, total) |
| starter_kit_share_pct | pct(Σ net(o) where is_starter_kit = 1, total) — any buyer |
| participant_orders_purpose_unknown_pct | part = orders with buyer ∈ is_dist and not starter kit; pct(count(part with purpose = unknown), count(part)) — **order count**, not amount |
Note: numerator is by **buyer type**, not by purpose (AC-21.1).

### R2 — personal-use share of volume that earned multi-level pay (per payout month m)
| Step | Formula |
|---|---|
| ml | payout lines with month = m, source_kind = `downline_volume`, amount_cents > 0 |
| oids | distinct source_order_id of ml |
| rewarded_volume_cents | Σ volume_cents of orders in oids (full volume, **not** net of refunds) |
| personal_use_share_pct | pct(Σ volume of oids with purpose = personal, vol) |
| unknown_purpose_share_pct | pct(Σ volume of oids with purpose = unknown, vol) |
| per payee | total[p] = Σ amount of p's ml lines; pers[p] = Σ amount of p's ml lines whose order purpose = personal |
| payees_with_multilevel_pay | count(total) |
| payees_above_flag | count(p where pers[p] > personal_share_flag × total[p]) (strict >) |
| flag_threshold | round(personal_share_flag, 4) |
| flagged_payees_sample | first 10 flagged payee ids, sorted ascending (ids only) |
Product: lines without source order → counted as unattributable figure (prototype would raise KeyError — C-12); threshold unset → omit payees_above_flag.

### R3 — payout source mix (per payout month m, and `year` = all lines)
`by[kind]` = Σ amount_cents per source_kind; `gross_cents` = Σ by[k] for k ≠ clawback; `clawback_cents` = by[clawback] (0 if none; negative); `share_pct[k]` = pct(by[k], gross) for each k ≠ clawback **present in the data** (sorted keys). Invariant (test): Σ share_pct = 100 ± 0.05.

### R4 — activity from own purchases; end-of-period threshold orders (per order month m)
Process orders of month m sorted by `day` (stable):
- buyer b ∈ is_dist: if day ≥ late_order_day → record (o, pv[b] before this order); then pv[b] += volume_cents.
- else (customer): cust_orders[sponsor_id of b] += 1 (servicing distributor).
| Key | Formula |
|---|---|
| active_distributors | count(d in pv where pv[d] ≥ active_pv_cents) — only distributors with ≥1 own order this month |
| active_with_no_customer_order_pct | pct(count(active d with cust_orders[d] = 0), count(active)) |
| late_threshold_crossing_orders | for each late (o, before): after = before + volume; for each threshold t in rank_thresholds: count if before < t ≤ after (one order can count once per threshold crossed) |
| of_which_refunded_later | count of crossings whose order has refunded_cents > 0 (any refund month) |
| note | "Activity here is defined by the plan on own-purchase volume, so every active status depends on own purchases; the indicator that varies is activity without any customer order." |
Product: missing `day` → indicator omitted with note (prototype coerces empty to 0 — C-13).

### R5 — earnings distribution (year)
- year_end = last month in `months`; population = d ∈ is_dist with enrolled_month ≤ year_end (string compare `YYYY-MM`).
- earn[p] = Σ amount_cents of **all** payout lines (all months, clawbacks included) per payee; vals = sorted(earn.get(p, 0)/100 for p in population) — currency units.
| Key | Formula |
|---|---|
| population | "All distributors holding an agreement at any time in the year, including those who earned nothing" |
| count | len(vals) |
| earned_more_than_zero_pct | pct(count(v > 0), count) |
| mean | round(Σ vals / count, 2) |
| median | round(statistics.median(vals), 2) (mean of middle two when even) |
| p75 / p90 / p99 | linear interpolation: k = (n−1)·q; f = int(k); c = min(f+1, n−1); v[f] + (v[c] − v[f])·(k − f); round 2 |
| max | max(vals) |
| bands | `0 or less` v ≤ 0; `0.01-100` 0<v≤100; `100.01-1,000` 100<v≤1000; `1,000.01-10,000` 1000<v≤10000; `>10,000` v>10000; Σ bands = count (invariant) |
| basis | "Gross commissions and bonuses net of clawbacks, before expenses; currency units" |

### 5.1 Storage of figures (compliance_figure)
One row per (report, period, key): `report` ∈ R1..R5; `period` = first day of month (null for R3 `year` and R5 → use year key); `value_num` numeric(20,6); `numerator`/`denominator` bigint (minor units or counts) for every pct; `population_count`; `note` (null-with-reason, partial-year, omitted-indicator text). Proposed key names = prototype JSON keys above (e.g. `customer_share_pct`, `share_pct.retail_sale`, `bands.0 or less`). Snapshot `method_version` must identify this method (value not specified — OQ list).

---

## 6. Golden tests

### 6.1 TS-31 hand-checked fixture (A, Golden) — also `test_analytics.py`
Input:
- participants: D1 distributor enrolled 2024-12, sponsor ''; D2 distributor 2025-01, sponsor D1; C1 customer 2025-01, sponsor D1 (market T, status active).
- orders (month 2025-01, volume = amount, not starter kits): O1 day 3 buyer C1 10000 customer; O2 day 5 D2 6000 personal; O3 day 28 D2 4000 resale, refunded 4000, refund_month 2025-02.
- payout_lines: L1 2025-01 D1 retail_commission retail_sale O1 2500; L2 2025-01 D1 unilevel downline_volume O2 360; L3 2025-01 D1 unilevel downline_volume O3 240; L4 2025-02 D1 clawback clawback O3 −240.
- config: prototype DEFAULT_CONFIG (late day 27, active 5000, leader 10000, flag 1/3).

| Check (period 2025-01 unless stated) | Expected |
|---|---|
| R1 net_sales_cents | 16000 (160.00) |
| R1 customer_share_pct | 62.5 |
| R1 customer_plus_declared_resale_pct (resale fully refunded) | 62.5 |
| R2 personal_use_share_pct | 60.0 (6000 / 10000) |
| R2 payees_above_flag | 1 (D1: 360 > 1/3 × 600) |
| R3 share retail_sale | 80.65 (2500/3100) |
| R3 share downline_volume | 19.35 |
| R3 year clawback_cents | −240 |
| R4 active_distributors | 1 (D2, pv 10000) |
| R4 active_with_no_customer_order_pct | 100.0 |
| R4 late_threshold_crossing_orders | 1 (O3: 6000 → 10000 crosses `leader`) |
| R4 of_which_refunded_later | 1 |
| R5 count | 2 (D1, D2) |
| R5 earned_more_than_zero_pct | 50.0 |
| R5 median | 14.3 (0 and 28.60) |
| R5 bands `0 or less` | 1 |

### 6.2 Synthetic dataset golden (report.json) — exact expected values

R1 (per order month):
| month | net_sales_cents | customer_share_pct | customer_plus_declared_resale_pct | starter_kit_share_pct | participant_orders_purpose_unknown_pct |
|---|---|---|---|---|---|
| 2025-01 | 1517950 | 16.61 | 18.55 | 56.6 | 9.09 |
| 2025-02 | 1651251 | 31.9 | 39.56 | 31.77 | 10.2 |
| 2025-03 | 2384053 | 28.57 | 41.39 | 35.65 | 8.33 |
| 2025-04 | 2985098 | 34.22 | 39.03 | 25.87 | 10.38 |
| 2025-05 | 3454971 | 33.67 | 42.52 | 24.98 | 6.56 |
| 2025-06 | 3864099 | 40.06 | 49.1 | 17.7 | 12.41 |
| 2025-07 | 4682828 | 33.76 | 41.89 | 21.72 | 11.05 |
| 2025-08 | 5062431 | 37.61 | 46.9 | 17.43 | 8.12 |
| 2025-09 | 5355646 | 39.59 | 48.48 | 15.0 | 10.36 |
| 2025-10 | 5934835 | 42.72 | 53.85 | 10.08 | 6.75 |
| 2025-11 | 6639023 | 39.86 | 49.52 | 12.72 | 10.51 |
| 2025-12 | 7062746 | 42.06 | 49.82 | 11.1 | 8.24 |

R2 (per payout month; flag_threshold 0.3333 every month):
| month | rewarded_volume_cents | personal_use_share_pct | unknown_purpose_share_pct | payees_with_multilevel_pay | payees_above_flag |
|---|---|---|---|---|---|
| 2025-01 | 409110 | 61.33 | 2.95 | 16 | 14 |
| 2025-02 | 559965 | 40.32 | 4.42 | 18 | 10 |
| 2025-03 | 1039107 | 35.66 | 2.05 | 32 | 13 |
| 2025-04 | 1599095 | 42.56 | 5.39 | 51 | 35 |
| 2025-05 | 1969849 | 43.29 | 4.7 | 50 | 27 |
| 2025-06 | 2320233 | 36.26 | 6.19 | 63 | 36 |
| 2025-07 | 2903984 | 43.65 | 6.33 | 81 | 51 |
| 2025-08 | 3219434 | 41.7 | 3.12 | 81 | 53 |
| 2025-09 | 3670898 | 40.15 | 6.09 | 99 | 56 |
| 2025-10 | 4018023 | 39.71 | 2.15 | 101 | 63 |
| 2025-11 | 4672053 | 43.6 | 6.05 | 122 | 79 |
| 2025-12 | 4567051 | 41.26 | 4.54 | 116 | 75 |
flagged_payees_sample 2025-01: P00008, P00009, P00010, P00013, P00016, P00021, P00022, P00026, P00027, P00029; 2025-12: P00008, P00010, P00011, P00012, P00014, P00018, P00023, P00024, P00026, P00027.

R3 (share_pct keys present: retail_sale, downline_volume, enrolment_order, pool; no match/other in data):
| period | gross_cents | clawback_cents | retail_sale | downline_volume | enrolment_order | pool |
|---|---|---|---|---|---|---|
| 2025-01 | 229650 | 0 | 28.48 | 14.1 | 57.43 | — (absent) |
| 2025-02 | 294525 | -6873 | 45.8 | 14.05 | 28.45 | 11.69 |
| 2025-03 | 429147 | -10950 | 41.7 | 16.42 | 30.25 | 11.64 |
| 2025-04 | 586498 | -15491 | 46.14 | 21.56 | 21.31 | 10.99 |
| 2025-05 | 650761 | -35004 | 47.33 | 19.92 | 21.4 | 11.35 |
| 2025-06 | 755063 | -37993 | 53.62 | 21.41 | 13.91 | 11.06 |
| 2025-07 | 863144 | -35805 | 48.2 | 22.69 | 17.67 | 11.44 |
| 2025-08 | 940275 | -31966 | 52.28 | 22.4 | 14.07 | 11.25 |
| 2025-09 | 1030538 | -29231 | 54.08 | 23.15 | 11.69 | 11.08 |
| 2025-10 | 1166929 | -45026 | 56.92 | 24.01 | 8.26 | 10.8 |
| 2025-11 | 1290420 | -53301 | 52.66 | 26.64 | 9.81 | 10.89 |
| 2025-12 | 1326685 | -36316 | 55.96 | 24.53 | 8.86 | 10.65 |
| year | 9563635 | -337956 | 51.38 | 22.55 | 15.27 | 10.8 |
CLI summary line: `months 2025-01..2025-12; gross payouts 95,636.35; clawbacks -3,379.56`.

R4 (per order month):
| month | active_distributors | active_with_no_customer_order_pct | late_threshold_crossing_orders | of_which_refunded_later |
|---|---|---|---|---|
| 2025-01 | 48 | 56.25 | 3 | 0 |
| 2025-02 | 59 | 50.85 | 8 | 0 |
| 2025-03 | 87 | 59.77 | 5 | 0 |
| 2025-04 | 119 | 52.94 | 25 | 11 |
| 2025-05 | 133 | 59.4 | 26 | 6 |
| 2025-06 | 152 | 46.71 | 23 | 13 |
| 2025-07 | 192 | 58.33 | 26 | 11 |
| 2025-08 | 210 | 56.19 | 23 | 8 |
| 2025-09 | 231 | 58.44 | 29 | 11 |
| 2025-10 | 246 | 53.25 | 37 | 11 |
| 2025-11 | 278 | 54.32 | 47 | 20 |
| 2025-12 | 277 | 55.23 | 52 | 0 |

R5 (year 2025): count 449; earned_more_than_zero_pct 73.27; mean 205.47; median 80.21; p75 232.68; p90 545.7; p99 1630.95; max 2306.38; bands `0 or less` 120, `0.01-100` 121, `100.01-1,000` 188, `1,000.01-10,000` 20, `>10,000` 0 (Σ 449).

Synthetic invariants (test_analytics.py): every month Σ R3 share_pct within 0.05 of 100; R1 customer_share_pct and customer_plus_declared_resale_pct ∈ [0,100] or null; customer_share ≤ customer_plus_resale; Σ R5 bands = count.

### 6.3 MVP-A test catalogue (verbatim scenario / expected)
| TS | Layer | Scenario | Expected | Proves |
|---|---|---|---|---|
| TS-21 | Isolation | Tenant A credential used against every endpoint with Tenant B object ids (generated from the OpenAPI document) | Every request fails without leaking existence; suite fails the build if an endpoint is not covered | AC-29.2, BR-SEC-04 |
| TS-31 | Golden | Overlay fixture: participants D1, D2 (distributors), C1 (customer); orders O1 C1 100.00 customer, O2 D2 60.00 personal, O3 D2 40.00 resale on day 28 fully refunded next month; payout lines to D1: retail 25.00 (O1), unilevel 3.60 (O2), unilevel 2.40 (O3), clawback −2.40 next month (§6.1) | R1 net sales 160.00, customer share 62.50%, with declared resale 62.50%; R2 personal-use share 60.00%, 1 payee above the one-third flag; R3 retail 80.65%, downline 19.35%, year clawbacks −2.40; R4 1 active, 100% with no customer order, 1 late crossing of which 1 refunded; R5 population 2, 50.00% above zero, median 14.30 | AC-24.2, AC-25.2, AC-21.1, BR-CPL-01, BR-GRD-04, BR-PTY-01 |
| TS-32 | Functional | Upload with forbidden column (email, phone, bank_account, national_id, address) | Batch rejected whole; columns named; zero rows stored | AC-39.1, BR-IMP-01, BR-IMP-02, AC-39.3 |
| TS-33 | Functional | Re-import of a loaded period, then recomputation of an old snapshot | Old batch Superseded and readable; old snapshot figures unchanged and reproducible; new snapshot uses the new batch | AC-39.2, AC-40.1, BR-IMP-04, BR-IMP-03 |
| TS-34 | Functional | Drill-down on each R1 to R5 figure | Row sets returned; sums equal figure components; export creates an audit event with row count | AC-41.1, AC-54.1, BR-SEC-03 |
| TS-35 | Security | Privileged role without MFA; lockout after repeated failures; step-up on approval | Forced enrolment; temporary lock with generic message; approval refused until factor verified | AC-35.1, AC-35.2, AC-07.2 (B), BR-SEC-02 |
| TS-36 | Authorisation | Table-driven role matrix: every permission against every base role and market scope | Each role can do exactly what the matrix states; privileged grants need a second admin | AC-36.1, AC-36.2, BR-SEC-05 |
| TS-37 | Security | Vendor user without session requests tenant data; approved read-only session attempts a write; session expiry | Refused and logged in both logs; write blocked; access ends at expiry | AC-29.1, AC-29.3, AC-57.1, BR-SEC-01 |
| TS-56 | Security | Audit chain tamper test; tax id masking and audited unmasking; export above cap | Break detected; masked by default; export refused | AC-54.2, AC-48.1 (B), BR-SEC-07 |
| TS-57 | Functional | Data region: writes, backups and export destinations checked against tenant region; out-of-region support session | All in region; session needs explicit region approval | AC-31.1, BR-DAT-09 |

Recommended CI gates for A: TS-31 + §6.2 full-report equality on `data_synthetic` (compare sorted JSON), validate_export exit 0 on synthetic, TS-21 coverage generated from OpenAPI.

---

## 7. Business rules in force (rel A, verbatim)

| ID | Rule | At | Status | Used by (A) | Tests |
|---|---|---|---|---|---|
| BR-PTY-01 | Participant types are tenant-defined with flags: can earn, counts as end customer, can sponsor, can hold positions | T | R | FR-IMP-002 | TS-31 |
| BR-GRD-04 | Reported: retail-customer share, payout-source mix, earnings distribution | P | D | FR-CPL-001, -003, -005 | TS-31 |
| BR-SEC-01 | Vendor staff have no standing access to tenant data; access is a tenant-approved, time-boxed session, logged and visible to the tenant | P | D | FR-IAM-005, FR-OPS-001 | TS-37 |
| BR-SEC-02 | Payout approvers, tenant admins and vendor staff use multi-factor authentication | P | D | FR-IAM-002 | TS-35 |
| BR-SEC-03 | Exports and API extraction of personal data are limited, logged and attributed | P | D | FR-AUD-002 | TS-34 |
| BR-SEC-04 | The tenant id is taken from the authenticated session and enforced in the data layer; it is never accepted from the client | P | D | FR-IAM-001 | TS-21 |
| BR-SEC-05 | A grant of an admin or approver role needs a second admin; a user cannot grant permissions they do not hold | P | D | FR-IAM-003 | TS-36 |
| BR-SEC-07 | Audit events are append-only, stored separately from application tables and hash-chained per tenant | P | D | FR-AUD-001 | TS-56 |
| BR-DAT-07 | Breach-notification timelines and contacts are configured per market and per tenant | M | S | FR-PRV-004 | TS-50 (B) |
| BR-DAT-09 | Personal data, backups and exports stay in the tenant's configured region | P, M | D/C | FR-TEN-001 | TS-57 |
| BR-IMP-01 | An overlay export may not contain names, contact details, addresses, identity numbers or bank data; a file with such columns is rejected whole | P | D | FR-IMP-001 | TS-32 |
| BR-IMP-02 | Imported amounts are integers in minor units; participant ids are pseudonymous | P | D | FR-IMP-001 | TS-32 |
| BR-IMP-03 | Every compliance figure records the mapping version that produced it | P | D | FR-IMP-002 | TS-33 |
| BR-IMP-04 | A re-import supersedes, never deletes, the earlier batch | P | D | FR-IMP-003 | TS-33 |
| BR-CPL-01 | Every compliance figure stores its population, method version and inputs and can be recomputed identically | P | D | FR-CPL-001, FR-CPL-006 | TS-31 |
| BR-HON-01 | The product contains no income projection, potential-earnings calculator or recruit leaderboard | P | D | FR-CPL-005 | TS-53 (B) |

Referenced by A FRs but rel B (informational only in A): BR-GRD-03 "Warned and logged: starter kits carrying commissionable volume; personal-consumption share above a tenant threshold"; BR-CAP-02 "Per-participant constraints are evaluated before company-level caps".
Precedence (PRD-04 §4): platform invariants (P) > market pack (M) > tenant setting (T) > plan version (V).

---

## 8. Audit events (minimum set)
Only `AUTH.SIGN_IN` is named in sources. Every action below must write an audit_event (FR-AUD-001 "security-relevant and money-relevant"; entity audit columns): sign-in/failure/lock, MFA enrol/reset, role create/edit, role grant/revoke + approval, support-session request/decision/each action (with `support_session_id`)/expiry, tenant provisioning + state change (vendor + tenant logs), setting version create, import batch state changes, mapping approval, snapshot creation, every export (actor, view, filters, row_count), vendor access refusals (both logs). Action naming beyond `AUTH.SIGN_IN` is not specified (proposed: `<DOMAIN>.<VERB>`).

---

## Conflicts found

| # | Conflict | Resolution (reasoned) |
|---|---|---|
| C-1 | FR-PRV-004 (A) lists screen SC-29, but SC-29 Tenant settings is rel B; FR-TEN-003 (versioned settings) is B while `tenant_setting_version` and API-39 are A. | Build in A only API-39 `PUT /v1/settings/{key}` writing `tenant_setting_version` for keys needed by A (breach contacts/timelines, thresholds for R2/R4, lockout/step-up/export caps, support-session max); expose a minimal "Breach contacts" form (in SC-39 provisioning wizard and a settings page slice). Full SC-29 stays B. |
| C-2 | AC-53.1 (A) is proved only by TS-50 (B); AC-24.1 and AC-25.1 (A) are proved only by TS-59 (B); TS-35 cites AC-07.2 (B). | Add A-scope tests: go-live/first-load blocked without breach contact; figure-links-to-population + control-total reconciliation against loaded batch; R5 includes zero earners and stores method version. Treat AC-07.2 portion of TS-35 as applied to A approvals (role grant, support-session decision). |
| C-3 | FR-CPL-001/AC-24.1 mention "period committed (engine)" / "committed run". | A supports only `source = import` facts; reconciliation target is batch control totals. Engine source is B. |
| C-4 | FR-IAM-002 step-up action list (approve batch, commit run, activate plan, approve adjustment, change bank details) contains only B objects. | In A apply step-up to approvals that exist: privileged role grant approval, support-session decision, tenant provisioning second-person approval, mapping approval. Record `approval.factor_verified_at`. |
| C-5 | FR-IAM-003 says reject SoD-breaking combinations (FR-IAM-004, B; BR-SEC-06 B). | In A enforce only BR-SEC-05 and `approval` CHECK approver_id <> preparer_id. Full SoD catalogue in B. |
| C-6 | FR-IAM-003 scopes by brand; brands are FR-TEN-002 (B). Market entity (ENT-02) is A. | Keep `brand_ids` column, unused in A; market scope enforced server-side (AC-36.2). Create markets via API-39 at provisioning. |
| C-7 | FR-IMP-001 says batch stored "Validated or Rejected"; FR-IMP-003 lifecycle omits Rejected and Uploaded→…; entity includes both. | State machine = entity: uploaded, rejected, validated, mapped, loaded, superseded (§4.12). |
| C-8 | AC-40.1 / FR-IMP-002 speak of a "published snapshot"; snapshot states are computing, ready, outdated, failed (no published). | "Published" = `ready` in A (publication of disclosures is FR-CPL-009, V1). |
| C-9 | API-05 allows "User session or API key"; API keys are FR-IAM-006 (B). | A: user session only. |
| C-9b | Prototype classifies every non-end-customer type as distributor (`is_dist`), and uses it for R1 resale/unknown, R4 and R5 population; FR-CPL-005 says "earning-type participants", entity has `can_earn` separate from `counts_as_end_customer`. | Product: R5 population and R4 distributors use `can_earn = true`; R1 participant orders use `counts_as_end_customer = false`. With the synthetic mapping (customer, preferred_customer = end customer & not earning; distributor = earning) results equal report.json. |
| C-10 | validate_export.py rejects purpose/source_kind values outside the vocabulary ("map them before running"); FR-IMP-002 maps partner codes inside the product, unmapped → unknown. | Validation accepts raw codes (stored as source values); mapping step translates; unmapped → `unknown` and reported in data-quality. Vocabulary check moves to the mapping approval. |
| C-11 | Prototype/validator source_kind vocabulary lacks `unknown`; entity and FR-CPL-003 allow `unknown`. | Add `unknown`; R3 includes it in gross and shares; reported. |
| C-12 | R2 prototype assumes every downline line has a known source order (KeyError otherwise) and validator treats missing source order as blocking error; FR-CPL-002 requires counting them as unattributable; FR-IMP-001 allows orphans up to tolerance. | Validator: error per row, batch loadable if within tolerance setting (AC-39.3). R2: exclude unattributable lines from the volume denominator and emit figure `unattributable_lines` (count and amount). |
| C-13 | R4 prototype coerces empty `day` to 0 (never late); FR-CPL-004 says missing day → indicator omitted with note. | Product: if any order in the period lacks day, omit late-crossing figures with note; keep active/no-customer figures. |
| C-14 | user_account.participant_id FKs `participant` (B table not in A migration). | Nullable column without FK in A; FK added in B migration. |
| C-15 | Prototype ships defaults (flag 1/3, late day 27, active 5000, leader 10000); PRD-04 forbids shipping parameter values; FR-CPL-002 says threshold is counsel's. | No defaults in product; settings required (R4: "thresholds present" validation); R2 flag omitted if unset. Prototype values used only as test-fixture config. |
| C-16 | R5 prototype: "year" = whole export (no year filter, lines from all months), year_end = last month present, no partial-year label, ignores participant status/termination; FR-CPL-005/AC-25.1: a year, held an agreement "at any time in the year", partial year labelled. | Product filters payout lines to pay_month within year; population = can_earn and enrolled_month ≤ year end (no termination data in export → all such participants included, note it); label `partial` if fewer than 12 months of payout data. Synthetic set covers exactly 2025-01..12, so golden values unchanged. |
| C-17 | FR-IMP-001 requires key uniqueness; validator does not check duplicate `line_id` nor payout `month` format nor month-in-declared-range nor `day` range. | Product adds these checks (entity UQ (tenant_id, batch_id, line_ref) would otherwise fail at load). |
| C-18 | TS-32 lists `national_id` as forbidden, but prototype FORBIDDEN_TOKENS lacks `national`/`id`-type tokens (only nric, ic, pan, aadhaar, ssn, tin, passport). | Add `national` (and `nationalid`, `taxid`) to the token list; keep `id` allowed (participant_id). Also note `account` causes false positives (e.g. `account_type`) — accepted: partner renames column. |
| C-19 | FR-CPL-002 permission = Compliance officer only, FR-CPL-003 = + Executive, FR-CPL-001 = + Tenant admin, Executive; SC-10/SC-46 grant all figures via `compliance.read` to Executive. | A: `compliance.read` grants all figures (screens are authoritative for perms); per-report restriction flagged as open (OQ-A6). |
| C-20 | FR-OPS-001 / SC-39 include "market-pack maintenance"; market packs are B-MKT. | Not built in A; `market.market_pack` stored as text only. |
| C-21 | FR-PRV-004 "missing contact blocks go-live" vs AC-53.1 "go-live or first data load". | Block both (stricter AC wins); tenant cannot leave `implementation` and no batch can be loaded without a contact. |

## Open / unresolved

| # | Question | Blocks |
|---|---|---|
| OQ-A1 | Lockout window, lockout duration, step-up window, access/refresh token lifetimes, clock-skew tolerance (AC-35.2 fixes only "five failed" → sixth locked). | FR-IAM-001, FR-IAM-002, AC-35.2, TS-35 |
| OQ-A2 | Export row cap per role; size threshold for async export; watermark format. | FR-AUD-002, AC-54.1, TS-34, TS-56 |
| OQ-A3 | Orphan-reference tolerance setting (default value). | FR-IMP-001, AC-39.3, TS-32 |
| OQ-A4 | R2 personal-share flag, R4 active threshold, rank thresholds and late-order day — tenant/counsel values (no defaults allowed). | FR-CPL-002, FR-CPL-004, BR-GRD-03 |
| OQ-A5 | `method_version` identifier and versioning policy; figure key naming; whether value_num stores R5 statistics in currency units or minor units. | FR-CPL-006, BR-CPL-01, TS-33 |
| OQ-A6 | Per-report read permissions for Executive / Tenant admin (C-19); full role→permission matrix and permission catalogue (only strings in §1.2 exist). | FR-IAM-003, FR-CPL-001..005, TS-36 |
| OQ-A7 | R5 band boundaries and percentiles are prototype choices, not specified; partial-year definition; how terminated participants are known from export (status column optional, no dates). | FR-CPL-005, AC-25.1 |
| OQ-A8 | Max support-session duration, request expiry time, region list and which tiers allowed per region; out-of-region approval flow. | FR-IAM-005, FR-TEN-001, AC-29.1, AC-31.1, TS-57 |
| OQ-A9 | Audit outbox buffer limit that blocks "money actions" (no money actions exist in A — which A actions block?). | FR-AUD-001 |
| OQ-A10 | Breach timelines content per market (BR-DAT-07 status S, screening-grade); affected-subject report format. | FR-PRV-004, AC-53.1 |
| OQ-A11 | Identity provider choice, SSO protocols, passkey support; hostname→tenant routing scheme (slug subdomain assumed). | FR-IAM-001, FR-OPS-001 |
| OQ-A12 | Refund attribution period: R1 nets refunds into the order month (prototype) vs refund month; R4 "refunded later" counts any refund. Needs counsel/method decision before method_version is frozen. | FR-CPL-001, FR-CPL-004 |
| OQ-22 (PRD-04) | Original 57-rule catalogue missing; some BR groups not reproducible. Does not block A rules listed here. | — (B rules) |
