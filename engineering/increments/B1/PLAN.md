# Increment B1 — MVP-B foundations: PLAN (the contract)

Scope: FR-TEN-002, FR-TEN-003, FR-TEN-004, FR-IAM-004, FR-IAM-006, FR-CAS-001, FR-INT-001, FR-CPL-012, plus the MVP-A LOW web polish (BUG-023, 025, 026, 027, 028, 029, 045, 046, 047, 048).
Migrations: **0100–0199 only**. Sources: spec.json (requirements, stories, acceptance, rules, tests, screens, apis, entities), `context/DATABASE.md`, `API.md`, `SECURITY_IAM_TENANCY.md`, `MONEY.md`, `UI_UX.md`, `STITCH_DESIGN_INVENTORY.md`, `BUG_REGISTER.md`, the existing code in `apps/api/src` and `packages/db`.

Section map (packages cite these): **§R** requirements · **§1** schema · **§2** API · **§3** permissions · **§4** facades/events · **§5** screens · **§6** seed/e2e · **§7** browser workflows · **§8** deferred · **§P** work packages · **§B** polish defects.

## §0 Decisions taken in this plan (proposed E-ADRs; the records phase copies them to ARCHITECTURE_DECISION_LOG)

| ID | Decision | Why |
|---|---|---|
| D-B1-01 | **Settings timeline with rebase.** `tenant_setting_version` keeps one invariant: a row's `settings` jsonb is exactly what is in force from its `effective_from` until the next row of the chain. Appending a version effective at E while versions with `effective_from > E` exist re-appends each later version on top of the new one (delta rebase, §1.3). The A rule "a later version is already scheduled" (422) is removed. | AC-37.1 needs future-dated (period-boundary) money changes; other settings, markets and brands must still change immediately. Snapshots/runs keep reading one row (BR-CPL-01, FR-TEN-003). |
| D-B1-02 | **Structure is versioned in settings**: every market, brand, calendar change (and go-live) appends a settings version, effective now, whose `settings.structure` holds the snapshot of markets, brands and calendars. | FR-TEN-002 logic "store as a new settings version"; a run (B3) that records a settings version also pins the structure. |
| D-B1-03 | **SoD primitive lives in `@nmp/db`** (`packages/db/src/approvals.ts`: `recordApproval`, `eligibleApprovers`), built by the schema agent before the backend packages. Each approving route maps a refusal to `422 SOD_SELF_APPROVAL` (`details.reason_code = 'SOD-01'`, `details.eligible_approvers`) and writes `APPROVAL.REFUSED` in the same (committed) transaction. | FR-IAM-004 is consumed by TEN (BE2) and CAS (BE3) which build in parallel; one implementation, no cross-package TS dependency. The `approval` CHECK stays the DB backstop. |
| D-B1-04 | **Evidence documents are uploaded once (`POST /v1/documents`, AUD) and referenced by id** (composite FK) from checklist entries, provider records, go-live risk acceptances and case evidence. Download access follows the referencing object (SQL `document_references`). **A document can be referenced exactly once, only by its uploader, only with class `evidence`** (DB guard `assert_document_referenceable`, §1.8, on every referencing table; routes map its refusal to 422 DOCUMENT_NOT_FOUND so existence never leaks). | Removes cross-package file-store coupling; FK guarantees same tenant; the single-use, uploader-only rule stops a user from attaching someone else's document (case evidence, another market's licence) to an object they can read and so escalating read access. |
| D-B1-05 | **API keys belong to a `service_account`** (new table; spec has none). Key scopes (colon namespace) are the only authority of a key caller; a key caller has an empty permission set, so every staff route refuses it by default. Keys never authenticate a session-only route. The scopes are the service account's role: FR-IAM-006 "service account with its own role" is met by the scope catalogue, and the `Integration` base role stays unassigned to service accounts (§8). | FR-IAM-006 "tied to a service account"; default-deny. |
| D-B1-06 | **Secret-returning creates** (API key, rotation, webhook endpoint, secret rotation) use `Idempotency-Key`, but the stored response never contains the secret: a replay returns the resource with `token_shown: false` / `secret_shown: false`. | `idempotency_key` stores response bodies; plaintext secrets must never be persisted (SEC-33). |
| D-B1-07 | **Webhook signing secrets are sealed with `lib/secret-box` (`SECRET_ENCRYPTION_KEY`, context `webhook:<endpoint_id>`) in `webhook_endpoint.secret_sealed`**, replacing `secret_ref` until a secrets manager exists (same model as TOTP seeds). | No secrets manager locally (E-ADR-02 class deviation). |
| D-B1-08 | **Outbound webhook format = Standard Webhooks**: headers `webhook-id` (outbox event id), `webhook-timestamp` (unix s), `webhook-signature: v1,<base64 HMAC-SHA256(secret, id.timestamp.body)>` (space-separated second signature during a rotation grace). Body `{id, type, occurred_at, tenant, data}`. | API.md §5.2 leaves header names open; a published standard beats an invented one. |
| D-B1-09 | **Egress is SSRF-safe**: https only, port allow-list (`WEBHOOK_ALLOWED_PORTS`, default `443`), no userinfo, no IP literal / name in blocked ranges at save time; at delivery every resolved address must be public, the socket connects to the vetted address (no re-resolution), no redirects, response body capped and discarded. | FR-INT-001 task text, SEC-39, T16. |
| D-B1-10 | **TEN owns `calendar` and `period` in B1** (spec owner COMP). B1 creates calendars and generates `open` periods; B3 decides whether ownership moves to COMP (period state transitions, runs). | FR-TEN-002 creates them; COMP arrives in B3. |
| D-B1-11 | **Calendar timing is immutable** (market, cadence, cut-off time zone, first period start). A calendar whose periods are all `open` can be deleted and recreated; otherwise `409 PERIOD_COMMITTED`. | "Change would alter a committed period (refused)" with the smallest rule. |
| D-B1-12 | **Provider eligibility record in a new PAY module** (`provider_config`, spec owner PAY): B1 records eligibility (no credentials; `credentials_secret_ref` nullable until B4 connects an adapter). | AC-38.1 needs a recorded payout-provider approval; FR-PAY-006 completes in B4. |
| D-B1-13 | **Case framework without production case types in B1, and not mounted.** CAS ships tables, state machine, evidence, SoD decisions, events and the type registry (`createCasModule`, `casModule`); each later increment registers its types (genealogy B2, adjustment/write-off/restatement/returned payment/bank detail B4, dispute/privacy B5, grievance B-MKT). `casModule` is exported but **not added to `defaultModules`** in B1 (no reachable route without a working path); B2 mounts it with its first types. Integration and isolation tests mount `createCasModule({ types: [fixture] })` with a labelled fixture type. SC-06/SC-08 UI ships with the first types (B2). | Every case type's subject (participant, position, result line, payout) arrives later; enabling a type without a subject would be fake, and mounting routes that always answer 422 would be dead production code. |
| D-B1-14 | **Pack rules**: `guardrail_rule`/`tax_rule` gain `title`, `mandatory`, `source_ref`, `reviewed_by` (+ `reviewed_at` on tax_rule). No real pack data ships in B1 (India pack = B-MKT, E-ADR-15); the e2e seed inserts a labelled fixture pack through the owner connection. | FR-CPL-012 "with source reference and review date"; DEC-14. |
| D-B1-15 | **Checklist items are a platform list, all mandatory in B1** (§R FR-TEN-004). `agreement_versions` and `plan_variant` are evidence/attestation items until B2/B3 make them automatic checks. | Agreements (B2) and plan versions (B3) do not exist yet. |
| D-B1-16 | Rate tiers and egress limits are **engineering configuration** (E-ADR-10 style), not product values: `API_KEY_RATE_STANDARD_PER_MINUTE=120`, `API_KEY_RATE_HIGH_PER_MINUTE=1200`, `API_KEY_MAX_GRACE_MINUTES=10080`, `WEBHOOK_TIMEOUT_MS=10000`, `WEBHOOK_ALLOWED_PORTS=443`, backoff 1 min doubling to 6 h, give up after 72 h (TR-API-15 proposals), `EVIDENCE_MAX_FILE_BYTES=10485760`. The DB agent adds all of them to `apps/api/src/config.ts` (zod-validated, these defaults) before the backend packages start (§P). | Sources give no numbers; DEC-14 covers plan/compliance values, which still ship with none. |
| D-B1-17 | **Provisioned markets start `draft` and go Live only through the checklist.** `ops/tenant-creation.ts` and `seed.ts` insert markets as `draft` (no grandfathered `live`); a DB INSERT guard refuses any other state for `nmp_app` (§1.1). Rows already in dev/test databases are not migrated (databases are reset; no production data exists). | FR-TEN-004 "a market goes Live only when every mandatory item is complete"; nothing in MVP-A reads `market.state = 'live'` (imports and snapshots do not check it), so an overlay tenant loses nothing; one rule instead of a vendor exception. |
| D-B1-18 | **Bearer (`nmpk_`) requests skip the global per-IP/per-session limiter**; the per-key limiter of `apiKeyOrSession` is their only quota. Lookup misses (unknown, revoked or expired token) are counted by a per-IP limiter `api-key-fail-ip:<ip>` at `API_RATE_LIMIT_PER_MINUTE`, consulted only after a miss (429 once exceeded). | AC-IAM6-4 "counters are per key": keys behind one egress IP must not throttle each other and the `high` tier must be reachable; failed-key brute force stays bounded. |
| D-B1-19 | **Key callers are audited as actor type `service_account`** (`lib/db.ts` `ActorType`; `audit_event.actor_id` = service account id). Every key request that reads data writes one `API_KEY.READ {key_id, scope, route, count}` audit row in the read transaction. No B1 key route inserts rows with a `created_by` FK to `user_account`. | BR-SEC-03 "API extraction logged and attributed"; the existing `'user'` mapping would attribute key reads to a non-existent user. |

---

## §R Requirements

Test ids: existing TS-* where the spec has one; `T-B1-nn` for B1-specific integration/unit tests (each package names them in its test titles).

### FR-TEN-002 Markets, brands, currencies and calendars — owner TEN (BE2)
Rule: Tenant admin adds/edits markets (ISO 3166-1 alpha-2 code, ISO 4217 currency, IANA time zone, BCP-47 languages, market pack), brands and calendars (cadence + cut-off time zone); every change is a new settings version (D-B1-02); calendars generate periods ahead; no overlapping periods in a calendar; a referenced market cannot be deleted; a change that would alter a committed period is refused. BR-PER-01 (each calendar has its cut-off time zone). Perm: `settings.manage` (market-scoped edits need the market in scope; creating a market needs all-markets scope). Screen SC-29 (sections) + Markets page (§5). API-39 family (§2.2).
ACs:
- AC-TEN2-1 Given admin with settings.manage, when POST market `FR`/`EUR`/`Europe/Paris`/`[fr]`, then market `draft` with minor_unit 2 exists, a settings version with reason and `structure` containing FR is appended, audit `MARKET.CREATED`.
- AC-TEN2-2 Given code `XX`, currency `EUX`, zone `Mars/Base` or language `zz-!!`, then 422 VALIDATION_FAILED naming the field.
- AC-TEN2-3 Given a market referenced by anything `market_references` counts (§1.8: calendar, import batch, snapshot, fact participant, provider record, checklist entry, go-live request, case, role assignment or role grant request `market_ids`), when DELETE, then 409 MARKET_REFERENCED `{references}` and nothing changes; a residual FK violation (23503) also maps to 409 MARKET_REFERENCED, never 500; an unreferenced draft market is deleted (204) with a version + audit.
- AC-TEN2-4 Given a monthly calendar in `Europe/Paris` from 2027-01-01 with periods_ahead 12, then periods `[local midnight 1st, next 1st)` exist through at least 12 periods after now, DST-correct, no overlap (EXCLUDE), unique (calendar, starts_at).
- AC-TEN2-5 Given any period of a calendar not `open`, when DELETE calendar, then 409 PERIOD_COMMITTED; PATCH of timing fields is refused 422 CALENDAR_TIMING_IMMUTABLE (only `name` is editable).
- AC-TEN2-6 Brand names unique per tenant (409 BRAND_NAME_TAKEN); a brand in any `role_assignment.brand_ids` (the only brand reference in B1; `role_grant_request` has no `brand_ids`) cannot be deleted (409 BRAND_REFERENCED, counted by `brand_references`, §1.8).
- AC-TEN2-7 `minor_unit` comes from the pinned ISO 4217 exponent table (§2.2), never from Intl/CLDR: `IQD` → 3, `RSD` → 2, `JPY` → 0; a currency not in the table → 422 VALIDATION_FAILED (`currency`).
Tests: T-B1-01 market validation (incl. the ISO 4217 table pin: every entry, and the CLDR-divergent codes ALL, AFN, IQD, IRR, LAK, LBP, MMK, RSD, SYP, YER), T-B1-02 delete refusals (every `market_references` kind incl. `market_ids` arrays and a `native` fact participant; brand via `role_assignment.brand_ids`), T-B1-03 period generation (monthly + weekly, DST Europe/London and America/New_York, horizon extension idempotent), T-B1-04 structure snapshot in version, TS-21/TS-36 rows.

### FR-TEN-003 Versioned tenant settings — owner TEN (BE2)
Rule: settings (rounding mode, clawback policy, notice periods, thresholds, breach contacts) are immutable versions with effective date and reason; money-affecting keys need a Finance approver (second person); effective date not back-dated and not inside a committed period; every run (B3) records the settings version it used. BR-MNY-02, AC-37.1. Perm: `settings.manage` prepares; money keys approved by `settings.approve` (Finance approver). Screen SC-29. API-39.
ACs:
- AC-37.1 Given a rounding-mode change with effective date inside a committed period (period state committed/paid/closed), when saved, then 422 EFFECTIVE_IN_COMMITTED_PERIOD; a date at the next period boundary is accepted, creates a pending change request, and after approval a new settings version.
- AC-TEN3-1 Given a money-affecting key, when the Tenant admin PUTs it, then 202 with a `pending` change request; no version is created; a second pending request for the same key is 409 CHANGE_PENDING.
- AC-TEN3-2 Given the requester tries to decide its own request, then 422 SOD_SELF_APPROVAL with `reason_code` SOD-01 and the eligible approvers listed; a Finance approver (step-up) approves and the version carries `approval_id`; reject closes it without a version.
- AC-TEN3-3 Given an effective date in the past, then 422 SETTING_EFFECTIVE_FROM_INVALID (back-dating refused); at approval time a date that has since passed is refused the same way and the request stays pending.
- AC-TEN3-4 Given a scheduled version at Dec 1 and an immediate threshold change now, then the threshold is in force now and the Dec 1 change still applies from Dec 1 with the new threshold (rebase, D-B1-01).
- AC-TEN3-5 (BUG-025) GET /v1/settings/:key and GET /v1/settings return `value_since {version, effective_from}` = start of the uninterrupted run of the current value, not the latest version.
- AC-TEN3-6 Given a PUT that rebases later versions, then the response `ETag` and `meta.latest_version` are the highest version after the rebase (not R's number) and the view lists the rebased rows (`rebased:[{version, effective_from}]`); a follow-up PUT with that ETag succeeds (no 412).
Tests: TS-59 (AC-37.1 part), T-B1-05 rebase pure-function cases + route-level ETag/`meta.latest_version` after a rebase, T-B1-06 money request lifecycle + SoD (incl. withdraw leaves `decided_by` NULL), T-B1-07 value_since + follow-up save with the returned ETag, T-B1-08 DB backstop: a version that changes a money key without approval_id is rejected by trigger.
Committed periods cannot be produced through the app in B1 (`period` has no UPDATE grant): TS-59 (AC-37.1) and every T-B1 test needing a committed/paid/closed period (EFFECTIVE_IN_COMMITTED_PERIOD, PERIOD_COMMITTED, AC-TEN2-5) set `period.state` through `getOwnerPool()`; W-B1-2 covers only the next-period-boundary path.

### FR-TEN-004 Market launch checklist — owner TEN (+PAY for provider records) (BE2)
Rule: a market goes Live only when every mandatory item is complete (each item: owner = who recorded it, evidence, status) plus Compliance officer sign-off; enrolment and order ingestion for a non-live market are refused MARKET_NOT_LIVE (enforced by B2 through the TEN facade). BR-PAY-11, BR-REG-04, AC-38.1, AC-38.2, AC-53.1. Perm: `market.manage` prepares; `market.signoff` signs off (step-up). Screen SC-17.
Items (platform list, all mandatory in B1; kind decides what completes it):

| item | title | kind | complete when |
|---|---|---|---|
| `licence_evidence` | Licence or registration evidence | evidence | latest entry has a document |
| `payout_provider` | Payout provider eligibility | provider | ≥1 `recorded` provider_config kind `payout` for the market with approved_description, approval document, approved_at, funds_holder |
| `payment_provider` | Payment provider eligibility | provider | same, kind `payment` |
| `tax_configuration` | Tax configuration reference | evidence | document attached (the item also shows the pack's tax rules and their basis status) |
| `agreement_versions` | Participant agreement versions | evidence | document attached (B2 replaces with an agreement-version check) |
| `data_region` | Data region | attestation | note recorded; item shows `tenant.region` |
| `plan_variant` | Plan variant | attestation | note naming the variant (B3 replaces with an active-plan check) |
| `breach_contacts` | Breach notification contacts | automatic | `privacy.breach_contacts` in force has ≥1 contact (AC-53.1) |
| `pack_rules` | Market-pack rules basis | automatic | no mandatory pack rule at `screening`; otherwise status `needs_risk_acceptance` (FR-CPL-012) |

ACs:
- AC-38.1 Given a market with no recorded payout-provider approval, when go-live is requested, then 422 CHECKLIST_INCOMPLETE with `details.missing` containing `{item: 'payout_provider', title, reason}` (every missing item is named).
- AC-38.2 Given a market not Live, when the TEN facade `assertMarketLive` is called (B2 enrolment/orders), then 422 MARKET_NOT_LIVE.
- AC-53.1 Given no breach contact, go-live is blocked naming `breach_contacts`.
- AC-TEN4-1 Given a complete checklist, when the Tenant admin requests go-live, then a `pending` request with a checklist snapshot exists; new entries are refused 409 GO_LIVE_PENDING until it is decided or withdrawn.
- AC-TEN4-2 Given the sign-off user is the requester or recorded any current entry or provider record (contributor), then 422 SOD_SELF_APPROVAL listing eligible approvers; a different Compliance officer (step-up, market in scope) approves → market `live`, settings version, audit `MARKET.WENT_LIVE` with approver, outbox `market.went_live`.
- AC-TEN4-3 At decision the checklist is re-evaluated; if now incomplete → 422 CHECKLIST_INCOMPLETE and the request stays pending.
- AC-TEN4-4 DB backstop: `market.state` may change draft→live only when an `approved` go-live request for it exists in the same transaction; a market can only be inserted as `draft` by the app role (vendor provisioning included, D-B1-17).
- AC-TEN4-5 Given a newly provisioned tenant (`POST /v1/tenants` with markets), then its markets are `draft` and need the checklist to go Live.
Tests: TS-50 (go-live without provider approval or breach contact, MARKET_NOT_LIVE via facade, screening rule), TS-42 (go-live part), T-B1-09 checklist evaluation per kind, T-B1-10 pending-request locking, T-B1-11 state guard trigger (UPDATE and INSERT as `nmp_app`; owner connection exempt), ops.test provisioned markets `[['GB','draft'], ['MY','draft']]`.

### FR-CPL-012 Rule basis status in configuration — owner CPL (BE1 API) / TEN (BE2 gate)
Rule: every market-pack rule (guardrail, tax) stores basis, basis status (`screening`, `primary_read`, `counsel_confirmed`), source reference, reviewer, review date; status shown wherever the rule is applied; a market cannot go Live with mandatory rules still at `screening` unless the tenant accepts the risk in writing. BR-CPL-03. Perm: vendor maintains packs (migrations, source control); Compliance officer accepts. Screen SC-17.
ACs:
- AC-CPL12-1 Given a pack with a mandatory rule at `screening`, when the Compliance officer approves go-live without `risk_acceptance`, then 422 RISK_ACCEPTANCE_REQUIRED listing the rules (id, title, basis_status); with `risk_acceptance.statement` (and optional document) → approved; the request stores the accepted rule ids with their basis status at that moment; audit names them.
- AC-CPL12-2 GET pack rules returns every rule with basis, status, source, reviewer, review date; the app role cannot INSERT/UPDATE/DELETE pack rules (platform tables).
- AC-CPL12-3 `basis_status` outside the set and an empty `basis`/`source_ref` are rejected by CHECK.
Tests: TS-50 (BR-CPL-03 part), T-B1-12 pack rules API + grants (RLS forced, nmp_app SELECT only, writes refused), T-B1-13 risk acceptance (the Compliance officer uploads the risk document with `POST /v1/documents` and references it in the decision).
Not in B1 (§8): FR-CPL-012 rule kinds beyond guardrail and tax (cooling-off, filing).

### FR-IAM-004 Separation of duties — owner IAM rule, primitive in `@nmp/db` (schema agent); applied by TEN, CAS
Rule: the preparer and every contributor of an approvable object cannot approve it; evaluated from recorded actor ids, not role names; refusal reason SOD-01; eligible approvers listed; never self-approval. BR-SEC-06, BR-ADJ-02. B1 objects: money setting change requests, market go-live requests, cases. Later objects (run commit B3, payout batch B4, plan activation B6, adjustment B4) call the same primitive.
ACs:
- AC-07.1 (generalised) Given user X prepared object O, when X decides O, then 422 SOD_SELF_APPROVAL (`reason_code` SOD-01, eligible approvers exclude X and contributors); a different authorised user succeeds and an `approval` row records preparer, approver, decision, reason, `factor_verified_at`.
- AC-07.2 Given an approver without a factor inside the step-up window, when deciding, then 403 STEP_UP_REQUIRED; after step-up the decision proceeds (same Idempotency-Key).
- AC-IAM4-1 Every refusal writes `APPROVAL.REFUSED {object_type, object_id, reason_code}` that survives the 422.
- AC-IAM4-2 `eligibleApprovers` returns only active users with an in-force assignment of a role holding the permission over the object's market (all-markets grants included), MFA enrolled where the role requires it, minus excluded users.
- AC-IAM4-3 An approver listed in `excludedIds` (beneficiary payees, declared related parties) is refused SOD-01 like a contributor; B1 objects have no beneficiary, so B1 callers pass `[]` (B2 participants/related-party declarations and B4 payouts fill it).
- AC-IAM4-4 Given no eligible approver exists, the refusal and every list view return `eligible_approvers: []` with `details.no_eligible_approver: true`; the UI shows "No one can approve this yet: a Tenant admin must assign <role> to another user" and no Approve/Sign-off control.
Tests: TS-42 (B1 subset: settings, go-live, case), T-B1-14 primitive unit/integration in packages/db (incl. `excludedIds` and empty list), TS-35 step-up part.

### FR-IAM-006 API keys and service accounts — owner IAM (BE1)
Rule: Tenant admin creates service accounts and scoped keys (name, scopes from the catalogue, rate tier, IP allow-list, expiry); key shown once, only SHA-256 stored; per-key rate limit and pagination caps; rotation keeps the old key valid for a grace period; expired/revoked → 401, missing scope → 403, over limit → 429 + Retry-After; every creation, rotation, revocation audited. BR-SEC-03. Perm: `integration.manage` (step-up for minting/rotating/revoking). Screen SC-13.
ACs:
- AC-22.3 (B1 form) Given a key without scope `compliance:read`, when it GETs `/v1/compliance/snapshots`, then 403 SCOPE_MISSING and nothing is read; with the scope → 200 with the snapshots of **every market** of its own tenant (market scope null for key callers, §2.4) and none of another tenant.
- AC-IAM6-1 Create returns the token once (`nmpk_…`); the DB holds only `key_hash` (hex SHA-256) and `key_prefix`; a replay of the same Idempotency-Key returns the key without the token.
- AC-IAM6-2 Rotation with `grace_minutes` G creates a new key and sets the old key's `expires_at` to min(old, now+G); both work inside G; after it the old key → 401 API_KEY_INVALID.
- AC-IAM6-3 Revoked key, disabled service account, archived tenant or expired key → 401 API_KEY_INVALID with `WWW-Authenticate: Bearer`; request from an IP outside `ip_allow` → 403 IP_NOT_ALLOWED.
- AC-IAM6-4 Exceeding the tier → 429 RATE_LIMITED with `Retry-After`; counters are per key: bearer requests are not counted by the global per-IP limiter (D-B1-18), so two keys from one IP each get their full tier and a `high` key reaches more than `API_RATE_LIMIT_PER_MINUTE`.
- AC-IAM6-5 A key never reaches a session-only route (any staff route) → 401; a session never needs a key.
- AC-IAM6-6 Service account requires a stated `purpose`; scopes outside the catalogue → 422 SCOPE_UNKNOWN.
- AC-IAM6-7 A key read writes `API_KEY.READ` with `actor_type = 'service_account'` and `actor_id` = the service account id (D-B1-19).
Tests: TS-21/TS-36 rows, T-B1-15 key lifecycle, T-B1-16 auth refusals (401/403/429/IP; standard and high tier each exhausted per key with two keys on one IP; failed-lookup limiter), T-B1-17 hash-only storage + replay without token, T-B1-27 key read audit attribution.
Not in B1 (§8): per-key pagination caps (the global `limit ≤ 200` applies to keys).

### FR-INT-001 Public API and webhooks — owner INT (BE1)
Rule: versioned `/v1` REST with an OpenAPI 3.1 description generated from the validating zod schemas, idempotency keys on writes, cursor pagination (limit ≤ 200), per-key rate limits, signed outbound webhooks with retries and dead letters for domain events, delivered only to tenant-configured HTTPS endpoints, SSRF-safe (D-B1-09). BR-SEC-03. API-10 (key surface; orders themselves in B2), API-33. Perm: scopes (key) / `integration.manage` (endpoint management, step-up for create and secret rotation). Screen SC-13.
ACs:
- AC-INT1-1 GET `/v1/openapi.json` (no auth) is valid OpenAPI 3.1: key-accessible paths with their request/response schemas, bearer security scheme, error envelope, and a `webhooks` entry per subscribable topic with signature headers.
- AC-INT1-2 Endpoint URL must be `https`, allowed port, no userinfo, not an IP literal or reserved name in a blocked range → else 422 WEBHOOK_URL_NOT_ALLOWED (reason in details); `http://`, `https://127.0.0.1`, `https://[::1]`, `https://169.254.169.254`, `https://10.0.0.5`, `https://localhost`, `https://x.internal`, `https://h:8080` (not allowed port) are all refused.
- AC-INT1-3 A domain event with an active subscribed endpoint produces one delivery per endpoint (fan-out is idempotent: UNIQUE (endpoint, event, attempt)); only endpoints created at or before the event (`endpoint.created_at <= outbox_event.created_at`) receive it, so the undispatched MVP-A backlog is never replayed to a new endpoint; the request carries the Standard Webhooks headers and a signature verifiable with the secret; 2xx → `delivered`.
- AC-INT1-4 A DNS answer containing a private/loopback/link-local address → attempt `failed` with error `ADDRESS_BLOCKED` and no connection made; timeout, TLS error, 3xx (`REDIRECT_REFUSED`), 4xx/5xx → `failed`, next attempt scheduled with backoff; after 72 h → `dead`, audit `WEBHOOK.DELIVERY_DEAD`; "retry" re-schedules a dead or waiting delivery now.
- AC-INT1-5 Secret rotation with grace signs with both secrets during the grace (two `v1,` signatures).
- AC-INT1-6 Payloads contain ids and minimal data only (no personal data); events of tenant A never reach endpoints of tenant B.
- AC-INT1-7 The dispatcher drains every outbox event (webhook topic or not) exactly once into `dispatched_at` (internal topics settle with no deliveries).
Tests: TS-21 rows, T-B1-18 URL validation + address blocklist (unit, IPv4/IPv6/mapped/NAT64/6to4), T-B1-19 fan-out + signing with a fake transport and a local TLS server through an injected resolver (incl. an event older than the endpoint → no delivery), T-B1-20 retry/backoff/dead/retry-now, T-B1-21 OpenAPI document validity, T-B1-22 cross-tenant fan-out.

### FR-CAS-001 Case framework — owner CAS (BE3)
Rule: one case model for every exception type: type, subject, reason code from the type's list, evidence, state, assignment, approval, due date, immutable event history; type-specific policy checks, effect preview before approval; permission by case type. BR-ADJ-01. API-30. Screens SC-06/SC-08 deferred to B2 (D-B1-13).
State machine: `open` → `submitted` → `approved` | `rejected`; `open|submitted` → `withdrawn` (opener). Evidence only while `open`. Every change = `case_event` + `audit_event` in the same transaction; decision also outbox `case.decided`.
ACs:
- AC-CAS1-1 Given a type that is not registered, POST /v1/cases → 422 CASE_TYPE_NOT_ENABLED.
- AC-CAS1-2 Reason code outside the type's list → 422 REASON_CODE_INVALID; unknown subject → 422 SUBJECT_NOT_FOUND; caller without the type's create permission → 404 on read routes / 403 on create.
- AC-CAS1-3 Submit without evidence where the type requires it → 422 EVIDENCE_REQUIRED; with evidence → `submitted`, `effect_preview` stored from the type hook, `due_at` from the type hook (null when the type has none).
- AC-CAS1-4 Decision by the opener, submitter or an evidence adder → 422 SOD_SELF_APPROVAL; by another user with the type's decide permission and step-up → approval row, case approved/rejected, type `onDecision` hook runs in the same transaction.
- AC-CAS1-5 case_event is insert-only (UPDATE/DELETE refused by grant and trigger); the events list reproduces the case history.
Tests: T-B1-23..26 with a labelled fixture type (`'adjustment'` slot registered only in tests, subject = a test row, module mounted only in tests, D-B1-13), TS-42 (case part), TS-21 rows.
Not in B1 (§8): system- and portal-opened cases (API-30; `opened_by` stays NOT NULL until B4 returned payments / B5 portal).

---

## §1 Schema contract (schema agent; migrations 0100–0199)

Recipe for every tenant table (database MEMORY): `tenant_id uuid NOT NULL REFERENCES tenant`, `UNIQUE (tenant_id, id)`, every reference to a tenant table is `FOREIGN KEY (tenant_id, x_id) REFERENCES x (tenant_id, id)`, `SELECT apply_tenant_rls('<t>')` (ENABLE + FORCE RLS, realm-aware USING + WITH CHECK), minimum grants to `nmp_app`, `forbid_mutation()` trigger on insert-only tables, rows in `test/seed.ts`, `TENANT_ID_TABLES` in isolation.test.ts, new/changed policies in `POLICIES_BEYOND_TENANT_ISOLATION`. `created_at timestamptz NOT NULL DEFAULT now()`, `created_by uuid` unless listed. Money/volume: none in B1. Suggested files: 0100 structure (brand, calendar, period, market grants/guards), 0101 settings (setting_change_request, money-key trigger), 0102 launch (provider_config, market_checklist_entry, market_go_live_request, market state guard), 0103 pack rules, 0104 api keys, 0105 cases, 0106 webhooks, 0107 functions (approvals, document refs, support requester), 0108 base-role permissions. The agent may split differently inside 0100–0199.

### 1.1 TEN structure
- `market` (exists, A): add grants `INSERT, UPDATE (time_zone, languages, market_pack, currency, minor_unit, state), DELETE` (check 0006 first: it already grants SELECT/INSERT/UPDATE/DELETE — then narrow nothing, add triggers only). Triggers: `market_delete_guard` (DELETE only when `state = 'draft'`); `market_insert_guard` (INSERT only with `state = 'draft'`, D-B1-17); `market_state_guard` (UPDATE of `state`: only `draft → live`, and only when `EXISTS (SELECT 1 FROM market_go_live_request WHERE market_id = NEW.id AND state = 'approved')`; `live → suspended` reserved for B6, refused now). The insert and state guards apply when `current_user = 'nmp_app'`; the owner connection (migrations, owner-pool test fixtures such as cpl/snapshots.test.ts) is exempt. The same migration changes no existing rows. Composite FKs that reference market from B1 tables use `ON DELETE RESTRICT`.
- `brand` (spec): `id uuid PK, tenant_id, name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100), created_at, created_by`; `UNIQUE (tenant_id, name)`, `UNIQUE (tenant_id, id)`. Grants SELECT, INSERT, UPDATE(name), DELETE.
- `calendar` (spec + additions): `id, tenant_id, market_id NOT NULL (composite FK, RESTRICT), name text NOT NULL (1..100), cadence text NOT NULL CHECK (cadence IN ('weekly','monthly')), cutoff_time_zone text NOT NULL, first_period_start date NOT NULL, created_at, created_by`; `UNIQUE (tenant_id, market_id, name)`, `UNIQUE (tenant_id, id)`; trigger: market_id, cadence, cutoff_time_zone, first_period_start immutable. `cutoff_time_zone` checked by trigger against `pg_timezone_names`. Grants SELECT, INSERT, UPDATE(name), DELETE.
- `period` (spec): `id, tenant_id, calendar_id NOT NULL (composite FK, RESTRICT), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','calculating','calculated','committed','paid','closed')), committed_run_id uuid NULL` (FK to `run` added in B3), `created_at`; `CHECK (ends_at > starts_at)`, `UNIQUE (calendar_id, starts_at)`, `EXCLUDE USING gist (calendar_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)`, `UNIQUE (tenant_id, id)`. Trigger: DELETE only when `state = 'open'`; grants SELECT, INSERT, DELETE (no UPDATE in B1). Index `(tenant_id, state)`.
- `tenant_setting_version` (exists): unchanged columns. New trigger `tenant_setting_version_money_guard`: when `settings -> 'money.rounding_mode'` or `settings -> 'money.clawback_policy'` differs from the chain row in force at NEW.effective_from with the highest version (or from the previous version when none) and `approval_id IS NULL` → raise 42501 (backstop for D-B1-01 rebase rows, which copy the approval_id of the row they rebase). Keep the key list as one SQL array constant and pin it in a test against `SETTINGS` money keys.
- `setting_change_request` (new): `id, tenant_id, key text NOT NULL, value jsonb NOT NULL, effective_from timestamptz NOT NULL, reason text NOT NULL (1..500), base_version int NOT NULL, state text NOT NULL CHECK (state IN ('pending','approved','rejected','withdrawn')), requested_by uuid NOT NULL (FK user), requested_at timestamptz NOT NULL DEFAULT now(), decided_by uuid NULL (FK user), decided_at timestamptz NULL, decision_reason text NULL, approval_id uuid NULL (FK approval), version_id uuid NULL (FK tenant_setting_version)`; `CHECK (decided_by IS NULL OR decided_by <> requested_by)`; `CHECK ((state = 'pending') = (decided_at IS NULL))`; `CHECK (state <> 'approved' OR (approval_id IS NOT NULL AND version_id IS NOT NULL))`; partial `UNIQUE (tenant_id, key) WHERE state = 'pending'`. Guard trigger: only `pending →` one terminal state, once; key/value/effective_from/reason/base_version/requested_* immutable; `approved`/`rejected` require `decided_by IS NOT NULL`; `withdrawn` (by the requester) sets `decided_at` and `decision_reason` and requires `decided_by IS NULL`, so the self-decision CHECK never blocks a withdraw. Grants SELECT, INSERT, UPDATE(state, decided_by, decided_at, decision_reason, approval_id, version_id).

### 1.2 TEN launch + PAY
- `provider_config` (spec, D-B1-12): `id, tenant_id, market_id uuid NULL (composite FK RESTRICT), kind text NOT NULL CHECK (kind IN ('payout','payment','commerce','messaging')), provider text NOT NULL (1..100), credentials_secret_ref text NULL, approved_description text NULL, approval_document_id uuid NULL (composite FK document), approved_at date NULL, funds_holder text NULL, state text NOT NULL CHECK (state IN ('recorded','withdrawn')), last_ok_at timestamptz NULL, withdrawn_at timestamptz NULL, withdrawn_by uuid NULL (FK user), created_at, created_by uuid NOT NULL (FK user)`; `CHECK (kind NOT IN ('payout','payment') OR (approved_description IS NOT NULL AND approval_document_id IS NOT NULL AND approved_at IS NOT NULL AND funds_holder IS NOT NULL))`; `CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))`; partial `UNIQUE NULLS NOT DISTINCT (tenant_id, kind, provider, market_id) WHERE state = 'recorded'` (deviation from spec full UQ: a withdrawn record may be recorded again). Guard: only `recorded → withdrawn`; other columns immutable. Grants SELECT, INSERT, UPDATE(state, withdrawn_at, withdrawn_by). B4 adds `connected` and credentials.
- `market_checklist_entry` (new, insert-only): `id, tenant_id, market_id NOT NULL (FK RESTRICT), item text NOT NULL CHECK (item IN ('licence_evidence','tax_configuration','agreement_versions','data_region','plan_variant')), document_id uuid NULL (FK document), note text NULL CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 2000), recorded_by uuid NOT NULL (FK user), recorded_at timestamptz NOT NULL DEFAULT now()`; `CHECK (document_id IS NOT NULL OR note IS NOT NULL)`; index `(tenant_id, market_id, item, recorded_at DESC)`; `forbid_mutation` trigger; grants SELECT, INSERT.
- `market_go_live_request` (new): `id, tenant_id, market_id NOT NULL (FK RESTRICT), state text NOT NULL CHECK (state IN ('pending','approved','rejected','withdrawn')), requested_by uuid NOT NULL (FK user), requested_at timestamptz NOT NULL DEFAULT now(), checklist jsonb NOT NULL, decided_by uuid NULL (FK user), decided_at timestamptz NULL, decision_reason text NULL, approval_id uuid NULL (FK approval), risk_acceptance jsonb NULL, risk_document_id uuid NULL (FK document)`; `CHECK (decided_by IS NULL OR decided_by <> requested_by)`; `CHECK ((state = 'pending') = (decided_at IS NULL))`; `CHECK (state NOT IN ('approved','rejected') OR approval_id IS NOT NULL)`; partial `UNIQUE (tenant_id, market_id) WHERE state = 'pending'`. Guard as setting_change_request (withdraw: `decided_at` + `decision_reason`, `decided_by` NULL). Grants SELECT, INSERT, UPDATE(state, decided_by, decided_at, decision_reason, approval_id, risk_acceptance, risk_document_id).
- `document` (exists, A): `ALTER TABLE document ADD COLUMN file_name text NULL CHECK (file_name IS NULL OR file_name ~ '^[^/\\\x00-\x1f]{1,200}$')`. No other change.

### 1.3 Settings timeline semantics (D-B1-01) — implemented by TEN in TS, documented here for the schema agent's trigger
- Chain: for each distinct `effective_from`, the row with the highest `version` (others are *superseded*). In force at T = chain row with the greatest `effective_from ≤ T`.
- Append change C at E: lock `pg_advisory_xact_lock(hashtextextended('tenant_setting_version:' || app_tenant_id(), 0))`; base = chain row in force at E (or `{}`); insert R = apply(C, base.settings) at E; then for each chain row S with `effective_from > E`, ascending: delta(S) = keys where S.settings differs from its chain predecessor (old); S' = previous-new-row.settings overlaid with delta(S); insert S' (same effective_from, `approval_id` = S.approval_id, reason = `Rebased v<S> onto v<R>: <S.reason>`), skipping S' when equal to its new predecessor. Pure function `rebaseTimeline(chain, change)` (ten/timeline.ts) returns the rows to insert; unit-tested.

### 1.4 CPL pack rules (platform tables without tenant_id; written only by migrations)
Both tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` with one read-only policy `platform_read FOR SELECT USING (app_realm() IN ('tenant','vendor','system'))` and no write policy; `SELECT` is the only grant to `nmp_app`. Add both policies to `POLICIES_BEYOND_TENANT_ISOLATION` (packages/db/test/migrations.test.ts), so the invariant "every application table has RLS enabled and forced" holds unchanged.
- `guardrail_rule` (spec + D-B1-14): `id text PK` (version-specific id `<rule>@<effective_from>`, DATABASE C-11), `market_pack text NOT NULL`, `title text NOT NULL`, `outcome text NOT NULL CHECK (outcome IN ('blocked','warned','reported'))`, `predicate jsonb NOT NULL`, `overridable boolean NOT NULL`, `mandatory boolean NOT NULL`, `basis text NOT NULL CHECK (basis <> '')`, `basis_status text NOT NULL CHECK (basis_status IN ('screening','primary_read','counsel_confirmed'))`, `source_ref text NOT NULL CHECK (source_ref <> '')`, `reviewed_by text NULL`, `reviewed_at date NULL`, `effective_from date NOT NULL`, `effective_to date NULL CHECK (effective_to IS NULL OR effective_to > effective_from)`, `created_at`; index `(market_pack, effective_from)`.
- `tax_rule` (spec + D-B1-14): `id text PK, market_pack, title text NOT NULL, kind text NOT NULL, conditions jsonb NOT NULL, rate numeric(9,6) NULL, threshold_minor bigint NULL, threshold_basis text NULL, missing_id_rate numeric(9,6) NULL, rounding text NOT NULL, mandatory boolean NOT NULL, effective_from date NOT NULL, effective_to date NULL, basis text NOT NULL CHECK (basis <> ''), basis_status (same CHECK), source_ref text NOT NULL, reviewed_by text NULL, reviewed_at date NULL, created_at`; index `(market_pack, effective_from)`. No rows shipped.
- Function `market_pack_rules(p_pack text, p_on date) RETURNS TABLE (kind text, id text, title text, mandatory boolean, basis text, basis_status text, source_ref text, reviewed_by text, reviewed_at date, effective_from date, effective_to date)` (STABLE, SECURITY INVOKER): rules of the pack in force on `p_on`, ordered by kind, id.

### 1.5 IAM keys
- `service_account` (new): `id, tenant_id, name text NOT NULL (1..100), purpose text NOT NULL (1..500), state text NOT NULL CHECK (state IN ('active','disabled')), disabled_at timestamptz NULL, disabled_by uuid NULL (FK user), created_at, created_by uuid NOT NULL (FK user)`; `UNIQUE (tenant_id, name)`; `CHECK ((state = 'disabled') = (disabled_at IS NOT NULL))`; guard: only active → disabled. Grants SELECT, INSERT, UPDATE(state, disabled_at, disabled_by).
- `api_key` (spec + D-B1-05): `id, tenant_id, service_account_id uuid NOT NULL (FK), name text NOT NULL (1..100), key_prefix text NOT NULL CHECK (key_prefix ~ '^nmpk_[A-Za-z0-9_-]{7}$'), key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'), scopes text[] NOT NULL CHECK (cardinality(scopes) > 0), rate_tier text NOT NULL CHECK (rate_tier IN ('standard','high')), ip_allow cidr[] NULL, expires_at timestamptz NULL, revoked_at timestamptz NULL, rotated_from_id uuid NULL (FK api_key), last_used_at timestamptz NULL, created_at, created_by uuid NOT NULL (FK user)`. Guard trigger: only `expires_at` (may only move earlier or from NULL to a value), `revoked_at` (set once) and `last_used_at` may change. Grants SELECT, INSERT, UPDATE(expires_at, revoked_at).
- `auth_find_api_key(p_key_hash text) RETURNS TABLE (id uuid, tenant_id uuid, service_account_id uuid, scopes text[], rate_tier text, ip_allow cidr[])` SECURITY DEFINER, `require_system_realm()`: the key when not revoked, not expired, service account active, tenant not archived.
- `auth_touch_api_key(p_id uuid) RETURNS void` SECURITY DEFINER, system realm: `last_used_at = now()` when NULL or older than one minute.

### 1.6 CAS
- `case_file` (spec): `id, tenant_id, type text NOT NULL CHECK (type IN (<12 types of DATABASE §7>)), subject_type text NOT NULL, subject_id uuid NOT NULL, reason_code text NOT NULL, state text NOT NULL CHECK (state IN ('open','submitted','approved','rejected','withdrawn')), payload jsonb NOT NULL, effect_preview jsonb NULL, due_at timestamptz NULL, market_id uuid NULL (FK market), opened_by uuid NOT NULL (FK user), assigned_to uuid NULL (FK user), submitted_by uuid NULL (FK user), submitted_at timestamptz NULL, decided_at timestamptz NULL, approval_id uuid NULL (FK approval), created_at`; indexes `(tenant_id, type, state)`, `(tenant_id, subject_type, subject_id)`, `(tenant_id, due_at) WHERE state = 'submitted'`. Guard: type, subject_type, subject_id, opened_by, market_id, created_at immutable; state transitions only as §R FR-CAS-001; `approval_id` required for approved/rejected. Grants SELECT, INSERT, UPDATE(state, reason_code, payload, effect_preview, due_at, assigned_to, submitted_by, submitted_at, decided_at, approval_id). (`opened_by` NOT NULL: B5 portal-opened cases revisit.)
- `case_event` (spec, insert-only): `id, tenant_id, case_id NOT NULL (FK), occurred_at timestamptz NOT NULL DEFAULT now(), actor_id uuid NULL (FK user), kind text NOT NULL CHECK (kind IN ('opened','evidence_added','assigned','submitted','approved','rejected','withdrawn','updated')), data jsonb NULL`; index `(case_id, occurred_at)`; forbid_mutation.
- `case_evidence` (new, insert-only): `id, tenant_id, case_id NOT NULL (FK), document_id uuid NOT NULL (FK document), note text NULL (≤2000), added_by uuid NOT NULL (FK user), added_at timestamptz NOT NULL DEFAULT now()`; `UNIQUE (case_id, document_id)`; forbid_mutation.

### 1.7 INT webhooks
- `outbox_event` (exists): add `UNIQUE (tenant_id, id)` (target of composite FK).
- `webhook_endpoint` (spec + D-B1-07): `id, tenant_id, url text NOT NULL CHECK (url ~ '^https://' AND length(url) <= 2048), description text NULL (≤200), secret_sealed text NOT NULL, previous_secret_sealed text NULL, previous_secret_expires_at timestamptz NULL, topics text[] NOT NULL CHECK (cardinality(topics) > 0), state text NOT NULL CHECK (state IN ('active','disabled')), updated_at timestamptz NOT NULL DEFAULT now(), created_at, created_by uuid NOT NULL (FK user)`; `CHECK ((previous_secret_sealed IS NULL) = (previous_secret_expires_at IS NULL))`; index `(tenant_id)`. Grants SELECT, INSERT, UPDATE(url, description, secret_sealed, previous_secret_sealed, previous_secret_expires_at, topics, state, updated_at).
- `webhook_delivery` (spec + additions): `id, tenant_id, endpoint_id NOT NULL (FK), outbox_event_id NOT NULL (FK (tenant_id, outbox_event_id) → outbox_event), attempt int NOT NULL CHECK (attempt >= 1), outcome text NOT NULL CHECK (outcome IN ('scheduled','delivered','failed','dead','cancelled')), next_attempt_at timestamptz NOT NULL, claimed_until timestamptz NULL, attempted_at timestamptz NULL, status int NULL CHECK (status BETWEEN 100 AND 599), error text NULL CHECK (error IN ('ADDRESS_BLOCKED','DNS_FAILED','CONNECTION_FAILED','TLS_FAILED','TIMEOUT','REDIRECT_REFUSED','HTTP_STATUS','ENDPOINT_DISABLED')), duration_ms int NULL, created_at, created_by uuid NULL`; `UNIQUE (endpoint_id, outbox_event_id, attempt)`; indexes `(endpoint_id, next_attempt_at)` (spec), `(next_attempt_at) WHERE outcome = 'scheduled'`. Guard: only outcome `scheduled →` one of the others once; claimed_until/next_attempt_at changeable while scheduled. Grants SELECT, INSERT, UPDATE(outcome, next_attempt_at, claimed_until, attempted_at, status, error, duration_ms).
- `webhook_fan_out(p_outbox_event_id uuid) RETURNS int` SECURITY DEFINER, system realm: for topic `webhook.test` one `scheduled` attempt-1 delivery to `payload->>'endpoint_id'` (same tenant, active); otherwise one per active endpoint of the event's tenant whose `topics` contains the topic **and whose `created_at <= outbox_event.created_at`** (an endpoint never receives events from before it existed, e.g. the undispatched MVP-A `compliance.snapshot.ready` backlog); `ON CONFLICT DO NOTHING`; returns rows inserted.
- `webhook_claim_due(p_limit int, p_lease_seconds int) RETURNS TABLE (tenant_id uuid, delivery_id uuid)` SECURITY DEFINER, system realm: `scheduled` rows with `next_attempt_at <= now()` and (`claimed_until IS NULL OR claimed_until < now()`), `FOR UPDATE SKIP LOCKED`, sets `claimed_until = now() + p_lease_seconds`.
- Existing `outbox_claim`/`outbox_settle` are reused by the dispatcher.

### 1.8 Shared functions
- `approval_eligible_users(p_permission text, p_market_id uuid, p_exclude uuid[]) RETURNS TABLE (user_id uuid, display_name text, email text)` (STABLE, SECURITY INVOKER, tenant realm): active tenant users with an assignment in force now (`valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`) of a role whose permissions contain p_permission, `market_ids IS NULL OR p_market_id IS NULL OR p_market_id = ANY(market_ids)`, `NOT role.mfa_required OR user.mfa_enrolled`, not in p_exclude; ordered by display_name, email.
- `document_references(p_document_id uuid) RETURNS TABLE (object_type text, object_id uuid, market_id uuid, case_type text)` (STABLE, SECURITY INVOKER): rows from `market_checklist_entry`, `provider_config` (approval_document_id), `market_go_live_request` (risk_document_id), `case_evidence` (+ case type and market).
- `assert_document_referenceable(p_document_id uuid)` (SECURITY INVOKER) + trigger `document_reference_guard` BEFORE INSERT (and UPDATE of the document column) on `market_checklist_entry.document_id`, `provider_config.approval_document_id`, `market_go_live_request.risk_document_id`, `case_evidence.document_id` when the column is not NULL (D-B1-04): raises `P0002` unless the document exists in the tenant, `uploaded_by = current_setting('app.user_id')::uuid`, `class = 'evidence'`, and `document_references(p_document_id)` is empty. Routes map P0002 to 422 DOCUMENT_NOT_FOUND.
- `document_summary(p_document_id uuid) RETURNS TABLE (id uuid, file_name text, mime text, size_bytes bigint, sha256 text)` (STABLE, SECURITY INVOKER; `sha256` as lower-case hex of the bytea): the metadata TEN/PAY show for checklist entries and provider records (no TS import of AUD).
- `market_references(p_market_id uuid) RETURNS jsonb` (STABLE, SECURITY INVOKER): `{calendars, imports, snapshots, fact_participants, providers, checklist_entries, go_live_requests, cases, grants}` counts from `calendar`, `import_batch`, `compliance_report_snapshot`, `cpl_fact_participant` (every source, incl. `native`), `provider_config` (any state), `market_checklist_entry`, `market_go_live_request`, `case_file`, and `grants` = `role_assignment` + `role_grant_request` rows with `p_market_id = ANY(market_ids)`. A pinned test lists every FK to `market` from `pg_constraint` and fails when a referencing table is missing from the function.
- `brand_references(p_brand_id uuid) RETURNS jsonb` (STABLE, SECURITY INVOKER): `{grants}` = `role_assignment` rows with `p_brand_id = ANY(brand_ids)`.
- `support_session_requester(p_session_id uuid) RETURNS TABLE (id uuid, display_name text, email text)` SECURITY DEFINER: in the tenant realm, the vendor requester of a support session **of the current tenant** (BUG-023); nothing for another tenant's session.

### 1.9 `@nmp/db` approvals primitive (D-B1-03) — `packages/db/src/approvals.ts`, exported from `@nmp/db`
```ts
export interface EligibleApprover { readonly user_id: string; readonly display_name: string | null; readonly email: string }
export interface ApprovalInput {
  readonly objectType: string              // 'setting_change_request' | 'market_go_live_request' | 'case' | later types
  readonly objectId: string
  readonly preparerId: string
  readonly contributorIds: readonly string[]
  readonly excludedIds: readonly string[]  // beneficiary payees, declared related parties (FR-IAM-004); B1 callers pass []
  readonly decision: 'approved' | 'rejected'
  readonly reason: string | null
  readonly factorVerifiedAt: Date | null  // auth.stepUpAt of the approver
  readonly approverPermission: string      // used to list eligible approvers on refusal
  readonly marketId: string | null
}
export type ApprovalOutcome =
  | { readonly ok: true; readonly approvalId: string; readonly decidedAt: Date }
  | { readonly ok: false; readonly reasonCode: 'SOD-01'; readonly eligibleApprovers: readonly EligibleApprover[] }
/** Approver = app.user_id of the transaction. Refuses (no row) when the approver is the preparer, a contributor or excluded.
 *  eligibleApprovers excludes all three; an empty list is a valid refusal payload (AC-IAM4-4). */
export function recordApproval(tx: Tx, input: ApprovalInput): Promise<ApprovalOutcome>
export function eligibleApprovers(tx: Tx, q: { permission: string; marketId: string | null; excludeUserIds: readonly string[] }): Promise<EligibleApprover[]>
```
Tests in packages/db: refusal for preparer, for each contributor and for an excluded id, success inserts one approval, empty eligible list, eligible list respects permission, market scope, validity window, MFA, exclusions, RLS (other tenant's users never listed).

---

## §2 API contract

Conventions (existing code wins over API.md where they differ): envelope `{data, meta}` / `{error:{code,message,details}}`; cursor pagination `?cursor&limit` (default 50, max 200, `meta.next_cursor`); creating POSTs need `Idempotency-Key` (lib `idempotent`, replay = stored response; reuse with another body = 422 IDEMPOTENCY_KEY_REUSED); unsafe methods need `X-Requested-With` (session callers); step-up = `assertStepUp` (403 STEP_UP_REQUIRED); unknown fields rejected (`z.strictObject`); ids uuid; timestamps RFC 3339 with offset; out-of-scope objects 404. Every state change: audit in the same transaction. All tenant routes `requireRealm('tenant')` unless stated.

### 2.1 Settings (TEN, BE2)
| Method path | Perm | Step-up | Idem | Request | Response | Errors |
|---|---|---|---|---|---|---|
| GET /v1/settings | settings.manage or settings.approve | – | – | – | `{version, effective_from, values: {<key>: {value, value_since:{version, effective_from}|null}}}` readable keys only (breach contacts only with settings.manage); `meta.latest_version`; ETag | – |
| GET /v1/settings/:key (exists) | per key readPermissions (+ settings.approve for money/plan keys) | – | – | – | adds `value_since` (BUG-025) | 404 unknown key |
| PUT /v1/settings/:key (exists) | settings.manage | key's flag | If-Match (428/412) | `{value, reason, effective_from?}` (money keys: effective_from required) | non-money: 200 version view of R plus `rebased:[{version, effective_from}]`; `ETag` and `meta.latest_version` = the highest version after the rebase (AC-TEN3-6); money: **202** `{change_request}` | 422 EFFECTIVE_IN_COMMITTED_PERIOD, 422 SETTING_EFFECTIVE_FROM_INVALID (past), 409 CHANGE_PENDING, 412, 428 |
| GET /v1/settings/versions | settings.manage or settings.approve | – | – | cursor | `[{id, version, effective_from, reason, created_at, created_by:{id, display_name}, approval:{approver:{id, display_name}, decided_at}|null, superseded_by_version|null, changed:[{key}]}]` newest first | – |
| GET /v1/settings/versions/:version | same | – | – | – | `{…row, changes:[{key, before, after}]}` (structure changes as markets/brands/calendars added/changed/removed by id; breach contacts values only with settings.manage, else `{key, redacted: true}`) | 404 |
| GET /v1/setting-change-requests | settings.manage or settings.approve | – | – | `?state=pending|all`, cursor | `[{id, key, value, effective_from, reason, base_version, state, requested_by:{id, display_name}, requested_at, decided_by, decided_at, decision_reason, version, eligible_approvers:[{user_id, display_name, email}]}]` | – |
| POST /v1/setting-change-requests/:id/decision | settings.approve | yes | yes | `{decision:'approve'|'reject', reason}` | 200 `{change_request, version|null}` | 422 SOD_SELF_APPROVAL {reason_code, eligible_approvers}, 422 SETTING_EFFECTIVE_FROM_INVALID, 422 EFFECTIVE_IN_COMMITTED_PERIOD, 409 CHANGE_NOT_PENDING |
| POST /v1/setting-change-requests/:id/withdraw | settings.manage, requester only | – | – | `{reason}` | 200 (`decided_at`, `decision_reason` set; `decided_by` NULL) | 404 (not own), 409 CHANGE_NOT_PENDING |

Settings registry additions (`ten/settings.ts`), none with a default (unset = null; UI states the platform rule where one exists):
- `money.rounding_mode`: `z.enum(['half_up','half_even'])`; money-affecting; readers settings.manage, settings.approve. Null = BR-MNY-02 platform rule half-up applies (engine B3).
- `money.clawback_policy`: `z.strictObject({ default: z.enum(['order_line','restatement']) })`; money-affecting (B4 may add optional per-bonus-type overrides).
- `plan.activation_notice_days`: `z.number().int().min(0).max(365)` (BR-PLN-04); not money; readers settings.manage, settings.approve.
- Registry gains `moneyAffecting: boolean`. `structure` is an internal key (not in the registry, never returned by /settings/:key).

### 2.2 Markets, brands, calendars (TEN, BE2) — every write takes `reason` (1..500) and appends a settings version (D-B1-02)
| Method path | Perm | Idem | Request | Response | Errors |
|---|---|---|---|---|---|
| GET /v1/markets (exists) | any tenant user | – | – | adds `state, market_pack, time_zone, languages, minor_unit` (additive) | – |
| GET /v1/markets/:id | settings.manage, market.manage or market.signoff (in scope) | – | – | full market + `references` = `market_references(id)` (§1.8) + `deletable` (`state = 'draft'` and every count 0) | 404 |
| POST /v1/markets | settings.manage (all markets) | yes | `{code, currency, time_zone, languages[1..10], market_pack (1..64), reason}`; `minor_unit` from the pinned ISO 4217 exponent table `ten/iso4217.ts` (active codes → exponent, e.g. JPY 0, EUR 2, IQD 3, KWD 3), never from Intl (CLDR fraction digits differ: ALL, AFN, IQD, IRR, LAK, LBP, MMK, RSD, SYP, YER); a code not in the table → 422 | 201 market (`draft`) | 409 MARKET_CODE_TAKEN, 422 VALIDATION_FAILED |
| PATCH /v1/markets/:id | settings.manage (in scope) | – | `{time_zone?, languages?, market_pack?, currency?, reason}` (a currency change re-derives `minor_unit` from the same table) | 200 | 409 MARKET_NOT_DRAFT (pack/currency on non-draft), 409 MARKET_REFERENCED (currency once `market_references` is non-zero) |
| DELETE /v1/markets/:id | settings.manage (in scope) | – | `{reason}` | 204 | 409 MARKET_NOT_DRAFT, 409 MARKET_REFERENCED {references} (also for any residual 23503) |
| GET /v1/brands | any tenant user | – | – | `[{id, name}]` | – |
| POST /v1/brands | settings.manage | yes | `{name, reason}` | 201 | 409 BRAND_NAME_TAKEN |
| PATCH /v1/brands/:id | settings.manage | – | `{name, reason}` | 200 | 409 BRAND_NAME_TAKEN |
| DELETE /v1/brands/:id | settings.manage | – | `{reason}` | 204 | 409 BRAND_REFERENCED (`brand_references`: role_assignment.brand_ids) |
| GET /v1/calendars | settings.manage, market.manage, market.signoff | – | `?market_id` | `[{id, market:{id, code}, name, cadence, cutoff_time_zone, first_period_start, periods:{count, first_starts_at, last_ends_at, open}}]` | – |
| POST /v1/calendars | settings.manage (market in scope) | yes | `{market_id, name, cadence, cutoff_time_zone, first_period_start (YYYY-MM-DD; monthly: day 1), periods_ahead (1..120, required), reason}` | 201 calendar + generated count | 409 CALENDAR_NAME_TAKEN, 422 VALIDATION_FAILED, 422 GENERATION_LIMIT (more than 520 periods) |
| PATCH /v1/calendars/:id | settings.manage | – | `{name, reason}` (timing fields → 422 CALENDAR_TIMING_IMMUTABLE) | 200 | as noted |
| DELETE /v1/calendars/:id | settings.manage | – | `{reason}` | 204 (periods deleted too) | 409 PERIOD_COMMITTED |
| POST /v1/calendars/:id/periods | settings.manage | yes | `{through: date, reason}` | 200 `{generated}` (existing periods kept) | 422 GENERATION_LIMIT |
| GET /v1/calendars/:id/periods | settings.manage, market.manage, market.signoff | – | `?from&to`, cursor | `[{id, starts_at, ends_at, state}]` ascending | 404 |
Period generation is SQL (`generate_series` of local dates, `(d::timestamp AT TIME ZONE tz)`), `ON CONFLICT DO NOTHING`; monthly periods start on day 1 local midnight; weekly on the weekday of `first_period_start`.

### 2.3 Launch checklist and provider eligibility (TEN + PAY, BE2)
| Method path | Perm | Step-up | Idem | Request | Response | Errors |
|---|---|---|---|---|---|---|
| GET /v1/markets/:id/checklist | market.manage or market.signoff (in scope) | – | – | `{market:{id, code, name, state, market_pack}, items:[{item, title, kind, category ('regulatory'|'payment'|'tax'|'plan'|'data'), mandatory, status ('complete'|'missing'|'needs_risk_acceptance'), entry:{id, document:{id, file_name, mime, size_bytes, sha256}|null, note, recorded_by:{id, display_name}, recorded_at}|null, detail}], summary:{complete, missing, needs_risk_acceptance}, pending_request|null, eligible_signers:[…]}`; `detail`: providers list / `{region}` / `{contacts: n}` / `{rules:[…basis…]}` | 404 |
| POST /v1/markets/:id/checklist/:item/entries | market.manage | – | yes | `{document_id?, note?}` (evidence kinds need document, attestation kinds need note) | 201 entry | 409 MARKET_NOT_DRAFT, 409 GO_LIVE_PENDING, 422 ITEM_NOT_RECORDABLE (provider/automatic), 422 EVIDENCE_REQUIRED, 422 NOTE_REQUIRED, 422 DOCUMENT_NOT_FOUND |
| POST /v1/markets/:id/go-live-requests | market.manage | – | yes | `{}` | 201 request | 422 CHECKLIST_INCOMPLETE {missing:[{item, title, reason}]}, 409 GO_LIVE_PENDING, 409 MARKET_NOT_DRAFT |
| GET /v1/markets/:id/go-live-requests | market.manage or market.signoff | – | – | – | history newest first | – |
| POST /v1/market-go-live-requests/:id/withdraw | market.manage, requester | – | – | `{reason}` | 200 (`decided_at`, `decision_reason` set; `decided_by` NULL) | 409 GO_LIVE_NOT_PENDING |
| POST /v1/market-go-live-requests/:id/decision | market.signoff (market in scope) | yes | yes | `{decision:'approve'|'reject', reason, risk_acceptance?: {statement (1..4000), document_id?}}` | 200 `{request, market}` | 422 SOD_SELF_APPROVAL, 422 CHECKLIST_INCOMPLETE, 422 RISK_ACCEPTANCE_REQUIRED {rules}, 409 GO_LIVE_NOT_PENDING |
| GET /v1/provider-configs | market.manage or market.signoff | – | – | `?market_id&kind&state` | `[{id, market_id, kind, provider, approved_description, approval_document:{id, file_name}, approved_at, funds_holder, state, created_by:{id, display_name}, created_at, withdrawn_at}]` | – |
| POST /v1/provider-configs | market.manage (in scope) | – | yes | `{market_id, kind:'payout'|'payment', provider, approved_description (1..2000), approval_document_id, approved_at (date ≤ today), funds_holder (1..200)}` | 201 | 409 PROVIDER_ALREADY_RECORDED, 422 DOCUMENT_NOT_FOUND |
| POST /v1/provider-configs/:id/withdraw | market.manage | – | – | `{reason}` | 200 | 409 PROVIDER_NOT_RECORDED |
Every `document_id` / `approval_document_id` / `risk_acceptance.document_id` must pass `assert_document_referenceable` (uploaded by the caller, class `evidence`, not yet referenced; D-B1-04) → else 422 DOCUMENT_NOT_FOUND. Document metadata in these responses comes from `document_summary` (§1.8).
Contributors for go-live SoD = requester ∪ `recorded_by` of current entries ∪ `created_by` of the recorded provider configs counted. Decision `approve`: re-evaluate → screening check → `recordApproval` → request approved → `UPDATE market SET state='live'` → settings version (structure) → audit `MARKET.WENT_LIVE {approver, accepted_rules}` → outbox `market.went_live {market_id, code}`.

### 2.4 Pack rules and public snapshot reads (CPL, BE1)
| Method path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET /v1/market-packs/:pack/rules | session: market.manage, market.signoff or compliance.read | `?on=YYYY-MM-DD` (default today) | `[{kind, id, title, mandatory, basis, basis_status, source_ref, reviewed_by, reviewed_at, effective_from, effective_to}]`, `meta.screening_mandatory` | 422 VALIDATION_FAILED (pack 1..64) |
| GET /v1/compliance/snapshots (exists) | session compliance.read **or key scope `compliance:read`** (key = all markets) | unchanged | unchanged | key errors §2.6 |
| GET /v1/compliance/snapshots/:id (exists, API-05) | same | unchanged | unchanged | same |
Both routes compute `scope = request.apiKey ? null : marketScope(auth, 'compliance.read')` (a key's AuthContext has no roles, so `marketScope` would return `[]` = no markets); tenant isolation still comes from RLS. Both write `API_KEY.READ` for key callers (D-B1-19). Test: a key sees every market's snapshots of its own tenant and none of another tenant.
CPL exports the zod schemas of these two responses (and query) for the OpenAPI document (§4).

### 2.5 Service accounts and API keys (IAM, BE1) — `integration.manage`
| Method path | Step-up | Idem | Request | Response | Errors |
|---|---|---|---|---|---|
| GET /v1/api-keys/options | – | – | – | `{scopes:[{scope, description, personal_data}], rate_tiers:[{tier, requests_per_minute}], max_grace_minutes}` | – |
| GET /v1/service-accounts | – | – | – | `[{id, name, purpose, state, created_at, created_by:{id, display_name}, keys:[{id, name, key_prefix, scopes, rate_tier, ip_allow, expires_at, revoked_at, last_used_at, rotated_from_id, created_at, status ('active'|'expiring'|'expired'|'revoked')}]}]` | – |
| POST /v1/service-accounts | – | yes | `{name, purpose}` | 201 | 409 SERVICE_ACCOUNT_NAME_TAKEN |
| POST /v1/service-accounts/:id/disable | yes | – | `{reason}` | 200 | 409 SERVICE_ACCOUNT_DISABLED |
| POST /v1/service-accounts/:id/keys | yes | yes (D-B1-06) | `{name, scopes[1..], rate_tier, ip_allow?: cidr[] (≤20), expires_at?: future}` | 201 `{key, token, token_shown: true}` / replay `{key, token_shown: false}` | 422 SCOPE_UNKNOWN, 422 VALIDATION_FAILED (cidr), 409 SERVICE_ACCOUNT_DISABLED |
| POST /v1/api-keys/:id/rotate | yes | yes (D-B1-06) | `{grace_minutes: 0..max}` | 201 new key + token once; old key `expires_at` lowered | 409 API_KEY_INACTIVE |
| POST /v1/api-keys/:id/revoke | yes | – | `{reason}` | 200 | 409 API_KEY_INACTIVE |
Scope catalogue B1 (`iam/api-scopes.ts`, typed, pinned by test): `compliance:read` ("Read compliance snapshots", personal_data false). Later increments add `orders:write` (B2), `participants:write` (B2, personal_data true → needs the service account purpose, already mandatory), `ledger:export` (B4).
Token: `nmpk_` + 43 chars base64url (32 random bytes); `key_prefix` = first 12 characters; `key_hash` = hex SHA-256 of the full token.

### 2.6 Key authentication (IAM facade, used by CPL routes)
`apiKeyOrSession(app, scope, ...sessionChecks)` preHandler: if `request.auth === null` and `Authorization: Bearer nmpk_…` → hash → `auth_find_api_key` (withSystem) → IP check (`net.BlockList` of `ip_allow`, request.ip) → per-key limiter `app.createRateLimit({max: tierRpm, timeWindow: '1 minute', keyGenerator: key id})` → scope check → `auth_touch_api_key` → set `request.auth` = AuthContext `{realm:'tenant', tenantId, userId: service_account_id, sessionId: key id, roles: [], permissions: ∅, assurance:'aal1', mfaRequired:false, mfaEnrolled:false, mfaVerified:false, stepUpAt:null, supportSessionId:null}` and `request.apiKey = {id, serviceAccountId, scopes}`. The `FastifyRequest` declaration `apiKey?: ApiKeyContext` and `ActorType` `'service_account'` live in `lib/db.ts` (DB agent, before BE1): `actorOf` returns `'service_account'` when `request.apiKey` is set, so `app.actor_type = 'service_account'` and audit `actor_id` = the service account id (D-B1-19). Otherwise run `sessionChecks` in order. Errors: 401 API_KEY_INVALID (+`WWW-Authenticate: Bearer`), 403 IP_NOT_ALLOWED, 403 SCOPE_MISSING, 429 RATE_LIMITED (+`Retry-After`); a bearer on a route without `apiKeyOrSession` is ignored (request.auth stays null → 401 UNAUTHENTICATED).
Global limiter (D-B1-18, BE1 changes `lib/web-security.ts` `registerRateLimit`): its `allowList` returns true for requests whose `Authorization` starts with `Bearer nmpk_`, so bearer requests are never counted against `ip:<ip>`; the per-key limiter above is their only quota, and a lookup miss consults `app.createRateLimit({max: API_RATE_LIMIT_PER_MINUTE, keyGenerator: 'api-key-fail-ip:' + ip})` before answering 401 (429 once exceeded). Tests exhaust both tiers per key with two keys on one IP.

### 2.7 Webhooks and OpenAPI (INT, BE1)
| Method path | Perm | Step-up | Idem | Request | Response | Errors |
|---|---|---|---|---|---|---|
| GET /v1/openapi.json | public | – | – | – | OpenAPI 3.1 JSON (§R AC-INT1-1) | – |
| GET /v1/webhook-topics | integration.manage | – | – | – | `[{topic, description, payload_fields}]` (subscribable: `compliance.snapshot.ready`, `market.went_live`, `case.decided`) | – |
| GET /v1/webhook-endpoints | integration.manage | – | – | – | `[{id, url, description, topics, state, secret_rotation_ends_at, created_at, created_by, last_delivery:{outcome, attempted_at}|null}]` | – |
| POST /v1/webhook-endpoints | integration.manage | yes | yes (D-B1-06) | `{url, topics[1..], description?}` | 201 `{endpoint, secret, secret_shown: true}` / replay without secret | 422 WEBHOOK_URL_NOT_ALLOWED {reason}, 422 TOPIC_UNKNOWN |
| GET /v1/webhook-endpoints/:id | integration.manage | – | – | – | endpoint | 404 |
| PATCH /v1/webhook-endpoints/:id | integration.manage | – | – | `{url?, topics?, description?, state?}` | 200 | 422 as POST |
| POST /v1/webhook-endpoints/:id/rotate-secret | integration.manage | yes | yes (D-B1-06) | `{grace_minutes: 0..max}` | 200 `{endpoint, secret}` once | 409 ENDPOINT_DISABLED |
| POST /v1/webhook-endpoints/:id/test | integration.manage | – | yes | `{}` | 202 `{event_id}` (outbox `webhook.test {endpoint_id}`) | 409 ENDPOINT_DISABLED |
| GET /v1/webhook-endpoints/:id/deliveries | integration.manage | – | – | `?outcome`, cursor | `[{id, event:{id, type, occurred_at}, attempt, outcome, status, error, attempted_at, next_attempt_at, duration_ms}]` newest first | 404 |
| POST /v1/webhook-deliveries/:id/retry | integration.manage | – | yes | `{}` | 200 (scheduled now: existing `scheduled` row moved to now, or new attempt after a `dead`/`failed`-final row) | 409 DELIVERY_NOT_RETRYABLE (delivered/cancelled), 409 ENDPOINT_DISABLED |
Dispatcher (system job `int.webhooks.dispatch`, cron `* * * * *`): (1) loop ≤500: system tx `outbox_claim(1)` → `webhook_fan_out(id)` → `outbox_settle(id, true)` → commit; (2) `webhook_claim_due(100, 120)` → for each (concurrency 4): tenant tx (system actor) read endpoint + event → outside any transaction resolve + POST via `WebhookTransport` → tenant tx record outcome (+ next attempt row with backoff `min(6 h, 1 min × 2^(attempt-1))` ± 10 % jitter while `now + delay < first attempt created_at + 72 h`, else `dead` + audit `WEBHOOK.DELIVERY_DEAD`); disabled endpoint → `cancelled`. `createIntModule({ transport?, resolver? })` for tests; default transport = node `https.request` with a `lookup` returning only the vetted addresses, `servername` = host, timeout, no redirects, ≤4 KiB body read.

### 2.8 Evidence documents (AUD, BE3)
| Method path | Perm | Idem | Request | Response | Errors |
|---|---|---|---|---|---|
| GET /v1/documents/limits | any evidence uploader | – | – | `{max_file_bytes, types:['application/pdf','image/png','image/jpeg']}` | – |
| POST /v1/documents | market.manage or market.signoff (go-live risk documents) or any registered case type's create permission (any market in scope) | yes | multipart: `file` (one), `class=evidence` | 201 `{id, file_name, mime, size_bytes, sha256 (hex), uploaded_at}` | 400 FILE_MISSING, 413 FILE_TOO_LARGE, 415 FILE_TYPE_NOT_ALLOWED (magic bytes, not the client type) |
| GET /v1/documents/:id | uploader or reader of a referencing object | – | – | metadata | 404 |
| GET /v1/documents/:id/content | same | – | – | bytes, `Content-Disposition: attachment; filename*=`, exact `Content-Type`, nosniff; audit `DOCUMENT.DOWNLOADED` | 404 |
Readers via `document_references`: checklist entry / provider config / go-live risk document → market.manage or market.signoff with the market in scope; case evidence → the case type's read permission (CAS facade `canReadCase`). An unreferenced document is readable by its uploader only. Referencing is single-use and uploader-only (D-B1-04, `assert_document_referenceable`). Tests: the Compliance officer (market.signoff only) uploads a document and references it as `risk_acceptance.document_id`; cross-object negative: user B references user A's document, or a document already referenced by a case/another market's entry → 422 DOCUMENT_NOT_FOUND and no read access gained. Storage: `UPLOAD_DIR/<tenant>/documents/<id>` (write once, 0600), `storage_key = 'documents/<id>'`, `version = 1`, `file_name` sanitised.

### 2.9 Cases (CAS, BE3) — API-30
| Method path | Perm (type registry) | Step-up | Idem | Request | Response | Errors |
|---|---|---|---|---|---|---|
| POST /v1/cases | type.create | – | yes | `{type, subject_type, subject_id, reason_code, payload, note?}` | 201 case | 422 CASE_TYPE_NOT_ENABLED, REASON_CODE_INVALID, SUBJECT_NOT_FOUND, VALIDATION_FAILED (payload schema) |
| GET /v1/cases | read of the types | – | – | `?type&state&subject_type&subject_id&assigned_to&overdue=true`, cursor | cases of readable types within market scope | – |
| GET /v1/cases/:id | type.read | – | – | – | case + `evidence[]` + `events[]` + `eligible_approvers` (when submitted) | 404 |
| POST /v1/cases/:id/evidence | type.create | – | yes | `{document_id, note?}` | 201 | 409 CASE_STATE_CONFLICT, 409 EVIDENCE_DUPLICATE, 422 DOCUMENT_NOT_FOUND |
| POST /v1/cases/:id/assign | type.decide | – | – | `{user_id|null}` (assignee must hold type.decide or type.create) | 200 | 422 ASSIGNEE_NOT_ELIGIBLE |
| POST /v1/cases/:id/submit | type.create | – | – | `{}` | 200 | 422 EVIDENCE_REQUIRED, 409 CASE_STATE_CONFLICT |
| POST /v1/cases/:id/decision | type.decide | yes | yes | `{decision:'approve'|'reject', reason}` | 200 | 422 SOD_SELF_APPROVAL, 409 CASE_STATE_CONFLICT |
| POST /v1/cases/:id/withdraw | opener | – | – | `{reason}` | 200 | 409 CASE_STATE_CONFLICT |
Registry contract (`cas/types.ts`, exported):
```ts
export interface CaseTypeDefinition<P = unknown> {
  readonly type: CaseType                                  // one of the 12 DATABASE §7 values
  readonly subjectTypes: readonly string[]
  readonly reasonCodes: readonly string[]
  readonly evidenceRequired: boolean
  readonly permissions: { readonly read: Permission; readonly create: Permission; readonly decide: Permission }
  readonly payload: z.ZodType<P>
  resolveSubject(tx: Tx, subjectType: string, subjectId: string): Promise<{ marketId: string | null } | null>
  effectPreview?(tx: Tx, c: CaseRecord<P>): Promise<unknown>
  dueAt?(tx: Tx, c: CaseRecord<P>): Promise<Date | null>
  onDecision?(tx: Tx, c: CaseRecord<P>, decision: 'approved' | 'rejected'): Promise<void>
}
export function createCasModule(options: { types: readonly CaseTypeDefinition[] }): ApiModule
export const casModule: ApiModule  // createCasModule({ types: [] }); exported, NOT in defaultModules in B1 (D-B1-13)
```
SoD contributors = opened_by ∪ submitted_by ∪ evidence added_by.

### 2.10 Navigation (IAM me-routes, BE1)
`TENANT_NAVIGATION` entries gain `anyOf: Permission[]`: `settings` `/settings` (settings.manage | settings.approve), new `markets` `/settings/markets` label "Markets" (settings.manage | market.manage | market.signoff), new `integrations` `/settings/integrations` label "Integrations" (integration.manage).

### 2.11 Support (BE1, BUG-023)
Tenant-realm support-session list/detail views gain `requester: {id, display_name, email}` from `support_session_requester`. Vendor views unchanged.

---

## §3 Permissions (schema agent owns `apps/api/src/lib/permissions.ts`)
- Add to `PERMISSIONS`: `settings.approve`, `market.manage`, `market.signoff`, `integration.manage`.
- `PRIVILEGED_PERMISSIONS` += `settings.approve`, `market.signoff`, `integration.manage` (grant needs a second admin; MFA via `requiresMfa`).
- Base roles: Tenant admin += `market.manage`, `integration.manage`; Finance approver += `settings.approve`; Compliance officer += `market.signoff`. Others unchanged. (No case permissions in B1: types bring theirs, D-B1-13.)
- Applied migration 0007 cannot change: keep its pinned text as a frozen constant (`RELEASE_A_BASE_ROLES_SEED`), add migration `01xx_b1_base_roles.sql` that `UPDATE role SET permissions = … WHERE is_base AND tenant_id IS NULL AND name = …` for the three roles; `renderBaseRoleUpdate()` renders it and permissions.test pins the file text; TS-36 fixture updated.
- API-key scopes are not role permissions (§2.5 catalogue in modules/iam).
- Support sessions (read-only, FR-IAM-005): BE1 extends `scopePermission` in `modules/support/sessions.ts` to `.exclude(['participant.unmask', 'settings.approve', 'market.signoff', 'integration.manage'])` — approving, signing off and minting credentials are tenant-own decisions a vendor support user never holds (BUG-048 precedent). `market.manage` stays requestable (SC-17 exists). Pinned by a support test.
- Web (W2, `features/admin/format.ts` + test): `PERMISSION_LABELS` for all four (`settings.approve` "Approve money settings", `market.manage` "Prepare market launches", `market.signoff` "Sign off market launches", `integration.manage` "Manage API keys and webhooks"), `SUPPORT_SCOPE_LABELS` for `market.manage` only, and the BUG-047 base-role matrix rows updated to the B1 base roles.

## §4 Facades and events between modules
| Producer (index.ts) | Export | Consumer |
|---|---|---|
| `@nmp/db` | `recordApproval`, `eligibleApprovers`, types | TEN, CAS (later: COMP, PAY, PLN) |
| ten | existing exports + `assertMarketLive(tx, marketId)` (422 MARKET_NOT_LIVE), `getMarket(tx, id)`, `getEffectiveSettings(tx, at?)` now chain-aware | B2 PAR/ORD, B3 COMP |
| pay | `recordedProviders(tx, marketId)` → `[{id, kind, provider, created_by}]` | ten (checklist, same package) |
| iam | `apiKeyOrSession`, `API_SCOPES`, `type ApiScope`; existing exports | cpl (same package), B2 ORD |
| cpl | existing + `publicSnapshotSchemas` (zod: list query, list item, detail) + `packRules(tx, pack, on)` | int (OpenAPI), ten reads pack rules through SQL `market_pack_rules` (no TS import across packages) |
| int | `createIntModule`, `WEBHOOK_TOPICS` | modules/index.ts |
| cas | `createCasModule`, `casModule`, `CaseTypeDefinition`, `CaseType`, `casePermissions()`, `canReadCase(tx, auth, caseId)` | aud (same package), B2+ type owners |
| aud | existing; documents internal | – |
Cross-package reads are SQL-only and named here (all functions built by the DB agent, §1.4/§1.8); no other cross-package table read is allowed:
| Reader | Function / table | Owner of the data |
|---|---|---|
| TEN | `market_pack_rules` | CPL (`guardrail_rule`, `tax_rule`) |
| TEN, PAY | `document_summary`, `assert_document_referenceable` (trigger), document existence via composite FK | AUD (`document`) |
| TEN | `market_references` (reads IMP `import_batch`, CPL `compliance_report_snapshot`/`cpl_fact_participant`, PAY `provider_config`, CAS `case_file`, IAM `role_assignment`/`role_grant_request`) | several |
| TEN | `brand_references` (IAM `role_assignment.brand_ids`) | IAM |
| TEN, CAS | `approval_eligible_users` via `@nmp/db` `eligibleApprovers` (IAM `user_account`, `role`, `role_assignment`) | IAM |
| AUD | `document_references`, CAS `canReadCase` (TS facade, same package BE3) | TEN, PAY, CAS |
| IAM (support) | `support_session_requester` | IAM |
Outbox topics (ids + minimal data, no personal data): `market.went_live {market_id, code}` (TEN), `case.decided {case_id, type, decision}` (CAS), `webhook.test {endpoint_id}` (INT), existing `compliance.snapshot.ready`, `settings.version.created` (now also for structure). Subscribable in B1: `compliance.snapshot.ready`, `market.went_live`, `case.decided`.
Audit actions (new): MARKET.CREATED/UPDATED/DELETED/WENT_LIVE, BRAND.CREATED/RENAMED/DELETED, CALENDAR.CREATED/RENAMED/DELETED/PERIODS_GENERATED, SETTINGS.CHANGE_REQUESTED/APPROVED/REJECTED/WITHDRAWN, MARKET.CHECKLIST_RECORDED, MARKET.GO_LIVE_REQUESTED/WITHDRAWN/REJECTED, APPROVAL.REFUSED, PROVIDER.ELIGIBILITY_RECORDED/WITHDRAWN, SERVICE_ACCOUNT.CREATED/DISABLED, API_KEY.CREATED/ROTATED/REVOKED, WEBHOOK_ENDPOINT.CREATED/UPDATED/SECRET_ROTATED, WEBHOOK.TEST_SENT, WEBHOOK.DELIVERY_RETRIED, WEBHOOK.DELIVERY_DEAD, DOCUMENT.UPLOADED/DOWNLOADED, CASE.OPENED/EVIDENCE_ADDED/ASSIGNED/SUBMITTED/APPROVED/REJECTED/WITHDRAWN. before/after = ids, versions, counts, keys; never secrets, tokens or personal data.

## §5 Screens
Stitch folder root: `design/stitch/stitch_complete_ui_screen_design/`. Shell = canonical sc_01 (existing AppShell); light theme; real data only; every control backed by a §2 route; states (loading/empty/error/read-only in support sessions) from shared components.

| Screen | Route | Stitch folder | Build | Must not implement |
|---|---|---|---|---|
| SC-29 Tenant settings (B part) | `/settings` | `sc_29_tenant_settings` (S1) | money policies card (rounding mode, clawback default) with "Save new version with effective date" modal (effective date + reason; money keys show "Needs Finance approval"), plan notice period, existing thresholds + breach contacts, pending change requests with eligible approvers and Approve/Reject (settings.approve, step-up), versions table (7 cols) + diff inspector drawer (`md:w-[540px] lg:w-[600px]`) from GET /v1/settings/versions(/:v); "in force since" from `value_since` (BUG-025) | Prospect Data Ownership; retention timers; Revert / "Initiate Policy Rollback"; write-off threshold, minimum payout, bank-change cooling-off, downline depth masking (no API in B1); SOD warning sub-header text that claims enforcement not shown by data |
| Markets, brands, calendars | `/settings/markets` | none (guidelines §9: sc_29 section cards + sc_28 table pattern) | tabs Markets / Brands / Calendars; create/edit/delete dialogs with reason; market state chip + "Launch checklist" link; calendar create (periods_ahead required), extend, delete, periods drawer | any period state change; market suspend |
| SC-17 Market launch checklist | `/settings/markets/[id]` | `sc_17_market_launch_checklist` (S8 drawing; render in sc_01 shell) | context bar, blocked banner naming missing items, 4 KPI cards (complete / missing / needs risk acceptance / state), filter tabs (All, Regulatory & Legal, Payment & Payout, Taxation, Plan & Disclosures → item categories), gate table (item, basis/status, evidence file + sha256, recorded by/at), gate inspector (upload evidence via POST /v1/documents then entry; attestation note; provider approval dialog; pack rules with basis status chips), sign-off bar: "Request go-live" (market.manage), "Sign off" (market.signoff, step-up) with risk-acceptance statement when needed, SoD refusal shows eligible signers | "Override" on a blocked gate; "Filing Packet (.PDF)"; halt/statutory banner copy without data; animate-pulse dots; legal-conclusion badges |
| SC-13 Integrations (B1 tabs) | `/settings/integrations` | `sc_13_integrations_and_sync_health` (S2, broken config: markup + shared theme, not the PNG) | tabs "Public API keys" (service accounts, keys table, create service account, create key modal "shown once" with copy, rotate with grace, revoke, disable) and "Webhook subscriptions" (endpoints, create modal with secret shown once, edit topics/state, rotate secret, send test, deliveries table with outcome/status/error/next attempt, Retry now); KPI cards only from real counts (active keys, endpoints, failed deliveries 24 h) | connector cards (Shopify, WooCommerce, Wells Fargo, Hyperwallet) and their telemetry; Trigger Global Backfill; Add Integration Connector; two-person ingestion certification strip; API key quota sparkline and FX ticker; storefront/provider tabs (B2/B4); gradients |
| Polish (existing screens) | SC-14, SC-39, SC-25, SC-10 dialogs, SC-30, SC-28 | existing | §B | – |
SC-06 and SC-08 (cases) are not built in B1 (D-B1-13). Visual harness: `testing/visual/screens.json` entries for SC-29 (update), SC-17 (W1) and SC-13 (W2 lists it for the web integrator).

## §6 Seed and e2e data (schema agent owns `apps/api/src/seed.ts`)
- STAFF += `{ local: 'finance', name: 'Finance Approver', role: 'Finance approver' }` for acme and globex.
- The `DEMO` market (seed.ts:131) is inserted as `draft` (D-B1-17; the market insert guard refuses `live`).
- e2e only (database `nmp_e2e`): through `getOwnerPool()` insert a labelled fixture pack `e2e-fixture`: guardrail_rule `e2e-enrolment-only-bonus@2026-01-01` (title "E2E FIXTURE — enrolment-only bonus", mandatory true, basis_status `screening`, source_ref "E2E fixture, not a real market rule") and tax_rule `e2e-withholding@2026-01-01` (mandatory true, `counsel_confirmed`, rate NULL, rounding 'none', source_ref "E2E fixture"). Nothing for nmp_dev/production.
- No API keys, endpoints, markets or cases are seeded: the workflows create them.
- Isolation seed (`apps/api/test/isolation/seed.ts`, integrator): tenant A gains a draft market with calendar + periods, a brand, a pending money change request, checklist entries, a provider config, a pending go-live request, a service account + key, a webhook endpoint + delivery, an evidence document, a fixture-type case (test registry) with evidence.

## §7 Browser workflows (seed:e2e; API with workers on nmp_e2e; web on 3100)
- **W-B1-1 Markets, brands, calendars** — admin@acme: Settings › Markets: create market FR (EUR, Europe/Paris, fr, pack `e2e-fixture`, reason) → draft chip; create brand "Acme Nutrition"; Calendars: monthly "FR monthly" from the first of next month, 12 periods ahead → periods drawer shows 12+ periods with local-midnight bounds; rename calendar; try delete FR → refused "referenced by 1 calendar"; Settings versions table shows the new versions with reasons; diff drawer shows the structure change.
- **W-B1-2 Money settings with separation of duties** — admin@acme: rounding mode → Half even, effective = next period start, reason → "Waiting for Finance approval" with eligible approvers listing finance@acme only; a past date is refused; finance@acme (step-up) approves → version with approver; versions table shows it scheduled; thresholds show their own "in force since" (BUG-025); a threshold saved now leaves the scheduled change intact (rebase visible in versions).
- **W-B1-3 Launch checklist and go-live** — admin@acme opens FR checklist: Request go-live → refused naming every missing item incl. "Payout provider eligibility" and (if contacts removed in a fresh tenant) breach contacts; upload licence PDF, tax reference, agreement document; attestations for region and plan variant; record payout and payment provider approvals (document, description, date, funds holder); pack rules show the screening rule → Request go-live → pending; compliance@acme signs off: without a statement → "Risk acceptance required" listing the rule; with a statement (step-up) → FR Live, chip updates, audit log shows MARKET.WENT_LIVE with approver; admin2@acme sees no sign-off control.
- **W-B1-4 API keys** — admin@acme: Integrations › Public API keys: create service account "BI export" (purpose), create key with `compliance:read`, standard tier → token shown once (copy), dialog closed → never shown again; from the page context `fetch('/v1/compliance/snapshots', {headers:{authorization:'Bearer …'}, credentials:'omit'})` → 200 with acme snapshots only; key without the scope → 403 SCOPE_MISSING; rotate with 0 grace → old token 401, new token 200; revoke → 401; audit log shows API_KEY.* events.
- **W-B1-5 Webhooks** — admin@acme: create endpoint `https://hooks.invalid.example/nmp` subscribed to `compliance.snapshot.ready` → secret shown once; `http://…` and `https://127.0.0.1/…` refused with the reason; Send test → within ~1 min a delivery attempt `failed` (DNS_FAILED) with the next attempt time; Retry now re-schedules; create a snapshot → a `compliance.snapshot.ready` delivery appears; disable endpoint → pending attempt `cancelled`.
- **W-B1-6 MVP-A polish retest** — BUG-023 (tenant card names the vendor requester), 025, 026 (type 2025-01 in month fields as hinted), 027 ("1 event"), 028 (focus after Revoke/Reject/End now lands on a defined element, not BODY), 029 (admin sees author/approver names), 045 (one `dialog[open]` during step-up), 046 (accurate "may be asked" copy), 047 (areas the approver lacks are named before approving), 048 ("Compensation plans" gone).
- Regression (QA standard): sign-in/MFA, import, snapshot, audit; 4 viewports for SC-29, markets, SC-17, SC-13.

## §8 Deliberately deferred
| Item | To | Why |
|---|---|---|
| Case types, SC-06/SC-08 UI, per-type permissions, SLA settings | B2 (genealogy, duplicate, transfer), B4 (adjustment, write-off, restatement, returned payment, bank detail), B5 (dispute, privacy), B-MKT (grievance) | subjects do not exist in B1 (D-B1-13) |
| Automatic `agreement_versions` / `plan_variant` checklist checks; pack-specific checklist items; market suspend/resume | B2 / B3 / B-MKT / B6 | sources (agreements, plans, packs) arrive later; PRD B6 "launch checklist complete" |
| Calendar horizon top-up job; period state transitions; `period.committed_run_id` FK | B3 | runs consume periods |
| Provider credentials, adapters, `connected` state, expiry reminders (FR-PAY-006 rest) | B4 | payouts are B4; sandbox adapters only |
| Visibility policy (DPO approval), write-off/min-payout/cooling-off/dispute settings | B2 / B4 / B5 | each key ships with its consumer |
| Order/participant write scopes and endpoints (API-10/11/12), CSRF exemption for bearer writes | B2 | B1 key surface is read-only |
| OpenAPI for staff (session) endpoints; sandbox tenant docs (TR-API-17) | B6 | B1 documents the integration surface |
| outbox/webhook/idempotency purge and partitioning (35-day window) | V1 / ops | DATABASE O-5; volumes are assumptions |
| India pack rule data | B-MKT | E-ADR-15 |
| Shared-store (Redis) rate limiting | hosted deployment | single API process locally (existing shortcut) |
| FR-IAM-006 "service account with its own role" as a role assignment; the `Integration` base role stays unassigned | B2 (when write scopes arrive) | D-B1-05: scopes are the service account's authority; one model until a write surface needs more |
| FR-IAM-006 per-key pagination caps | B2 | B1 key surface is two read routes; the global `limit ≤ 200` applies |
| FR-IAM-004 beneficiary-payee and declared-related-party refusal data | B2 (related parties) / B4 (payees) | `excludedIds` exists in the primitive (§1.9); B1 objects have no beneficiary |
| API-30 system- and portal-opened cases (`opened_by` nullable + opener kind) | B4 (returned payments) / B5 (portal) | no B1 case type is opened by the system or a participant |
| FR-CPL-012 rule kinds beyond guardrail and tax (cooling-off, filing) | B-MKT | they arrive with the first real market pack |
| API-33 topics beyond `compliance.snapshot.ready`, `market.went_live`, `case.decided` | each with its producer (B2 orders/participants, B3 runs, B4 payouts) | a topic ships with the event that emits it |
| SC-29 participant types section (visibility policy: see its row above) | B2 | participant types arrive with participants |

---

## §P Work packages
Order: schema agent (all of §1, §1.9, §3, §6 seed) → BE1 ∥ BE2 ∥ BE3 → API integrator (modules/index.ts, isolation cases, role matrix, `.env.example`) → W1 ∥ W2 → web integrator (navigation icons, shared lib/components requests, screens.json SC-13). No package writes migrations. Each backend package: integration tests per route incl. cross-tenant denial and missing permission; lists new routes for the isolation suite and role matrix.

- **DB** (workflow-defined): packages/db/** (+ approvals.ts primitive §1.9), apps/api/src/lib/permissions.ts, apps/api/src/seed.ts, **apps/api/src/config.ts** (every D-B1-16 key with its default and validation, so BE1–BE3 read `app.config` instead of hard-coding), **apps/api/src/lib/db.ts** (`ActorType` `'service_account'`, `apiKey?` request declaration, `actorOf`, D-B1-19), **apps/api/src/modules/ops/tenant-creation.ts + ops.test.ts** (provisioned markets `draft`, expectation `[['GB','draft'], ['MY','draft']]`, D-B1-17 — same change as the insert guard so the build stays green).
- **BE1 iam-int-cpl**: apps/api/src/modules/iam/**, apps/api/src/modules/int/** (new), apps/api/src/modules/cpl/**, apps/api/src/modules/support/**, **apps/api/src/lib/web-security.ts** (`registerRateLimit` bearer allowList, D-B1-18). Implements §R FR-IAM-006, FR-INT-001, FR-CPL-012 (API part), §2.4–2.7, §2.10, §2.11, §3 support-scope exclusions, §4 (iam/cpl/int rows).
- **BE2 ten-pay**: apps/api/src/modules/ten/**, apps/api/src/modules/pay/** (new). Implements §R FR-TEN-002/003/004, FR-CPL-012 (go-live gate), FR-IAM-004 (settings + go-live use), §1.3, §2.1–2.3, §4 (ten/pay rows).
- **BE3 cas-aud**: apps/api/src/modules/cas/** (new), apps/api/src/modules/aud/**. Implements §R FR-CAS-001, FR-IAM-004 (case use), §2.8, §2.9, §4 (cas/aud rows).
- **W1 settings-markets**: apps/web/src/app/(staff)/settings/page.tsx, apps/web/src/app/(staff)/settings/markets/** (new), apps/web/src/features/admin/settings/**, apps/web/src/features/markets/** (new), **apps/web/src/lib/markets.ts** (additive `state`, `market_pack`, `time_zone`, `languages`, `minor_unit` fields; W2 only reads it), testing/visual/screens.json. Implements §5 SC-29, Markets, SC-17; §7 W-B1-1..3; §B BUG-025 (web), BUG-046 (breach-contacts dialog copy).
- **W2 polish-integrations**: apps/web/src/app/(staff)/settings/integrations/** (new), apps/web/src/features/integrations/** (new), apps/web/src/features/data/**, apps/web/src/features/admin/{audit,users,vendor-access,vendor}/**, apps/web/src/features/admin/format.ts + format.test.ts, apps/web/src/components/{modal,step-up-modal,api-provider}.tsx + their tests. Implements §5 SC-13; §7 W-B1-4..6; §3 web labels and base-role matrix rows for the four new permissions; §B all other defects.
Not owned by any package (integrators only): apps/api/src/modules/index.ts (adds `int`, `pay`; does **not** add `cas`, D-B1-13), apps/api/src/lib/** except permissions.ts, db.ts (DB) and web-security.ts (BE1), apps/api/test/** (the isolation app mounts `createCasModule` with the fixture type), apps/web/src/lib/** except markets.ts (W1), other apps/web/src/components/**, features/admin/{ui,form-dialog,page-states,resource,types,test-support}.

## §B MVP-A polish defects (all LOW)
| Bug | Fix | Owner |
|---|---|---|
| BUG-023 | API: tenant support-session views return `requester {id, display_name, email}` (§2.11, SQL §1.8). Web: tenant request/active/history cards show "Asked by <name> (<email>)". | BE1 (API), W2 (web) |
| BUG-025 | API: `value_since` (§2.1). Web: "In force since" per value uses `value_since`, not the latest version. | BE2 (API), W1 (web: features/admin/settings) |
| BUG-026 | Month fields become one text input (`inputMode="numeric"`, `pattern` and client validation `YYYY-MM`, month 01–12) so the hint "Year and month, for example 2025-01" describes what the keyboard user types; one shared field in features/data; tests type the hinted value. Files: features/data/create-snapshot-dialog.tsx, new-import-form.tsx. | W2 |
| BUG-027 | `countLabel` in the audit export banner ("1 event"). features/admin/audit/export-dialog.tsx. | W2 |
| BUG-028 | Modal/ConfirmDialog: on close, when the trigger is no longer in the document, focus a defined fallback (the dialog's `returnFocusTo` if given, else the page `<main>` heading); callers that remove rows (Revoke, Deactivate, Reject grant, End now) pass the list heading. components/modal.tsx + callers in admin/users, vendor-access, vendor. | W2 |
| BUG-029 | Mapping editor names author/approver from GET /v1/users for user.manage holders (as `actorLabel`), "you" for self, else "another user". features/data/mapping-editor.tsx. | W2 |
| BUG-045 | Step-up never stacks: when an open action dialog triggers STEP_UP_REQUIRED, the step-up prompt renders inside that dialog (or the action dialog is closed and restored after), so at most one `dialog[open]`; focus to the code field, retry with the same Idempotency-Key, focus back to the action's primary button. Keep the ApiProvider/StepUpModal public API unchanged (W1 depends on it). components/step-up-modal.tsx, api-provider.tsx, modal.tsx. | W2 |
| BUG-046 | Copy "You may be asked for a code from your authenticator app." in approvals-tab, vendor-access decision dialog (W2) and breach-contacts dialog (W1). | W2, W1 |
| BUG-047 | Vendor request dialog: each area shows which tenant roles can approve it (from the base-role matrix in format.ts); tenant request card lists "You cannot approve: <areas>" computed from the caller's permissions and all-markets scope, before Approve. features/admin/vendor/request-session-dialog.tsx, vendor-access/*, format.ts. | W2 |
| BUG-048 | Remove "Compensation plans" (`plan.activate`) from the support-area list until a plan screen exists (B3). features/admin/format.ts. | W2 |
