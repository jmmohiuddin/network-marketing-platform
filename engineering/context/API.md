# API — Implementation Brief

Sources: SDD-06 `04-system-design/06_API_DESIGN.md` (v0.1), TRD-03 `03-trd/03_API_REQUIREMENTS.md` (v0.1), TRD-05 `03-trd/05_INTEGRATION_REQUIREMENTS.md` (v0.1), `09-governance/traceability-data/spec.json` (apis, requirements, rules, tests, entities). Cross-refs from `09-governance/02_DECISION_LOG.md`, `03_OPEN_QUESTIONS.md`.

Release tags: **A** = MVP-A (compliance overlay), **B** = MVP-B (engine + API-first), **B-MKT** = MVP-B market-pack-dependent, **V1** = later. SDD-06 writes `MVP-A`/`MVP-B`; spec.json writes `A`/`B` — identical meaning.
Status of all sources: draft, "contracts are representative, not final OpenAPI". Values marked *(proposal)* are proposals in the source.

---

## 1. Boundaries (SDD-06 §1)

One API surface, one deployable (ADR-01 modular monolith). API layer = no business logic; it calls module facades.

| Boundary | Audience | AuthN | Notes | Rel (derived from endpoint/entity releases; SDD-06 §1 gives none) |
|---|---|---|---|---|
| Staff API | Staff web app | OIDC access token, **staff realm** | Same endpoints usable by tenant automation via API key **where a scope exists** | A |
| Portal API `/v1/me/...` | Distributors | OIDC token, **portal realm** | Read-mostly; every response filtered to self or permitted downline | B |
| Integration API | Commerce connectors, tenant systems | API key with scopes (`Authorization: Bearer`) | All writes idempotent | B |
| Provider webhooks | Payout providers | Provider signature | No tenant token; tenant resolved from endpoint path secret + provider account (see Conflict C-7) | B |
| Vendor API | Vendor console | OIDC token, **vendor realm** | Tenant business data only inside an approved support session (API-08) | A |
| Public | Privacy request form; (V1) disclosure page | None | Strict rate limits + bot protection; returns nothing beyond confirmation | B (form), V1 (disclosure) |

Identity: self-hosted OIDC provider per cell with three realms (ADR-19); optional staff federation to tenant SSO (OIDC or SAML) (TRD-05 §2.6). IdP failure: sign-in shows retry state; existing sessions continue until expiry.

Module → path groups: auth/users/settings/audit · imports/compliance · participants/positions/genealogy/customers · orders/order-events · plans/simulations · periods/runs/result-lines/restatements · ledger/payout-batches/payees/tax · cases/privacy-requests · me · webhooks/providers · support-sessions/system.

Client → boundary: Staff app → auth, imports, compliance, participants…, plans, runs, ledger/payouts, cases. Portal → `me`, cases. Vendor console → support-sessions, system. Integrations → orders, participants, imports/compliance, ledger. Providers → webhooks/providers. Public forms → cases/privacy-requests.

---

## 2. Conventions (TRD-03 TR-API-01..21)

| ID | Topic | Rule (build exactly this) |
|---|---|---|
| TR-API-01 | Style | REST over HTTPS, JSON UTF-8. Plural resource nouns. Non-trivial state changes = sub-resource POST (`/runs/{id}/commit`, `/submit`, `/approve`, `/decision`, `/retry-failed`, `/replay`). One API for web apps, portal, integrations |
| TR-API-02 | Versioning | Major version in path `/v1`. Additive changes don't bump. Breaking change ⇒ new major; previous supported **≥ 12 months** *(proposal)* with `Deprecation` + `Sunset` headers |
| TR-API-03 | AuthN | Staff/portal: short-lived OIDC access token. Integrations: API key in `Authorization: Bearer`, **hashed at rest** (`api_key.key_hash`, plaintext never stored). Provider webhooks: provider signature. Vendor: vendor-realm token + approved support session |
| TR-API-04 | Tenant | Tenant from token or key **only** — never path/query/body. Set DB session tenant (RLS) before any query. (BR-SEC-04) |
| TR-API-05 | AuthZ | Per-endpoint permission check from permission catalogue; attribute checks (market, brand, downline, self, SoD) in service layer; out-of-scope objects ⇒ **404 not 403** where existence is sensitive |
| TR-API-06 | Validation | Schema-first **OpenAPI 3.1**; unknown fields **rejected on writes**; bounded sizes; money = integer **minor units** + ISO 4217 currency; timestamps **RFC 3339 with offset**; ids **UUID** |
| TR-API-07 | Responses | Single resource: bare object. Collection: `{ "data": [...], "next_cursor": "..." }`. Async: `202` + job resource to poll + webhook event |
| TR-API-08 | Errors | **RFC 9457** problem details: `type`, `title`, `status`, `detail`, `code` (stable machine code), `errors[]` with field pointers, `request_id`. No stack traces, no internal ids |
| TR-API-09 | Pagination | Cursor-based, opaque cursor, stable ordering; `limit` default **50**, max **200**; **no offset pagination** on large tables |
| TR-API-10 | Filtering | Explicit documented params per collection; date ranges as `from`/`to`; no free-form query language |
| TR-API-11 | Sorting | `sort=field` / `sort=-field`, allow-list per collection |
| TR-API-12 | Rate limiting | Token bucket per key and per user; tiers per key (`api_key.rate_tier`); `429` + `Retry-After`; stricter limits on auth + public endpoints; pagination caps; no bulk personal-data endpoint without stated purpose scope |
| TR-API-13 | Idempotency | `Idempotency-Key` required on **every state-changing integration request and every money or approval action**. Same key + same body ⇒ original response; same key + different body ⇒ `409 IDEMPOTENCY_CONFLICT`. Keys retained for a setting, proposed **35 days**. Natural keys (source order id, provider event id, run request id) enforced **in addition** |
| TR-API-14 | Concurrency | `ETag` + `If-Match` on editable drafts (plan versions, settings, mappings). Failure ⇒ `412` |
| TR-API-15 | Webhooks out | HMAC-SHA-256, per-endpoint secret + timestamp; at-least-once; exponential backoff for **72 h** *(proposal)* then dead-letter with manual replay; event id for dedupe; payload = ids + minimal data, **no personal data** |
| TR-API-16 | Webhooks in | Per-provider signature verification; raw body stored **hashed** in `inbound_event`; dedupe on provider event id; idempotent handler; fast `2xx` then async processing |
| TR-API-17 | Docs | OpenAPI generated from the same schemas that validate requests; published per version with examples, error codes, webhook catalogue, changelog; **sandbox tenant with synthetic data** |
| TR-API-18 | Personal data | Only fields allowed by role + visibility policy; sensitive values masked; **unmasking = separate audited call** |
| TR-API-19 | Caching | Committed/immutable resources (statements, committed run results, published snapshots): `ETag` + long `Cache-Control: private`. Everything else `no-store` |
| TR-API-20 | Observability | Every response has `X-Request-Id`; log tenant, actor, route, status, latency |
| TR-API-21 | Time/locale | API locale-neutral; clients format. Period assignment uses the calendar's time zone, server-side |

### 2.1 Error envelope (RFC 9457)

```json
{ "type": "https://…/problems/gen-cycle", "title": "Change would create a cycle", "status": 422,
  "detail": "…", "code": "GEN_CYCLE",
  "errors": [ { "pointer": "/proposed_parent_ref", "detail": "…" } ],
  "request_id": "…" }
```
(`type` URI form and `errors[].pointer` key name not fixed by sources — choose and freeze in OpenAPI.)

### 2.2 Status codes (TRD-03 §3)

| Code | Use |
|---|---|
| 200 / 201 / 202 / 204 | OK; created; accepted (async); no content |
| 400 | Malformed request |
| 401 | Missing/invalid credential |
| 403 | Lacks permission (only where existence not sensitive); step-up ⇒ `403 STEP_UP_REQUIRED` |
| 404 | Not found **or** outside caller's scope |
| 409 | State conflict: `PERIOD_COMMITTED`, `RUN_IN_PROGRESS`, `IDEMPOTENCY_CONFLICT`, (`GEN_CYCLE` — see C-4) |
| 412 | `If-Match` failed |
| 422 | Business rule violated: `MARKET_NOT_LIVE`, `GUARDRAIL_BLOCKED`, `OUTSIDE_CHANGE_WINDOW`, `SOD_SELF_APPROVAL` |
| 429 | Rate limited (+ `Retry-After`) |
| 503 | Dependency unavailable; safe to retry **with the same key** |

### 2.3 Error code registry (all codes named in sources)

| Code | HTTP | Where |
|---|---|---|
| `FILE_MISSING` | 400 | API-01 |
| `FILE_TOO_LARGE` | 413 | API-01 |
| `MARKET_UNKNOWN` | 422 | API-01 |
| `FORBIDDEN_COLUMN`, `SCHEMA_MISMATCH`, `ORPHAN_REFERENCE`, `DUPLICATE_KEY` | async row codes (batch → `rejected`) | API-01/02, `import_row_error.code` |
| `NO_DATA_FOR_RANGE` | 422 | API-04 |
| `INPUTS_CHANGING` | 409 | API-04 (load in progress) |
| `MARKET_NOT_LIVE` | 422 | API-10, API-12 (TS-50) |
| `UNKNOWN_SKU` | 422, or 202 into exception queue if tenant enables hold-and-map | API-10 |
| `IDEMPOTENCY_CONFLICT` | 409 | all keyed endpoints |
| (in-flight same key) | 409 + `Retry-After` | all keyed endpoints (code not named; see OQ list) |
| `PERIOD_COMMITTED` | 409 | API-18 |
| `SYNC_BEHIND` | 422 (body has `last_sync_at`) | API-18 (BR-ORD-05) |
| `BEFORE_CUTOFF` | 422 | API-18 |
| `RUN_IN_PROGRESS` | 409 | TRD-03 §3 (runs) |
| `STEP_UP_REQUIRED` | 403 | API-20, API-25 approve, API-27 |
| `SOD_SELF_APPROVAL` | 422 | API-20, API-25 (named in SDD-06); TRD-03 §3 generic 422 example. Applying it to API-15 decision, API-16 approve, API-22, API-30 decision is inferred from BR-ADJ-02 / TS-42, not named in sources |
| `RUN_SUPERSEDED` | 409 | API-20 |
| `INVARIANT_FAILED` | 500 (tx rolled back, alert) | API-20 |
| `GEN_CYCLE` | 422 (SDD-06) / 409 (TRD-03) | API-15 (API-12 placement inferred, not named) |
| `OUTSIDE_CHANGE_WINDOW` | 422 | API-15 |
| `GEN_SLOT_TAKEN` | 422 | API-15 (API-12 inferred from TS-45 concurrent enrolments, not named) |
| `EVIDENCE_REQUIRED` | 422 | API-15 |
| `GUARDRAIL_BLOCKED` | 422 | API-16 |
| `PROVIDER_NOT_ELIGIBLE` | 422 | API-25 |
| `BALANCE_CHANGED` | 409 (batch → Draft) | API-25 approve |
| `INVALID_BANK_DETAILS` | 422 | API-27 |
| Exclusion reasons (not errors): `COOLING_OFF`, `BELOW_MINIMUM`, `HOLD`, `TAX_PROFILE_MISSING`, `DUPLICATE_CASE` | — | API-25 response |

### 2.4 Idempotency mechanics (TRD-03 §2; entity `inbound_event`)

Store: `inbound_event(id uuid PK, tenant_id NN, source NN, idempotency_key NN, payload_hash bytea NN, received_at NN, processed_at, result jsonb)`; **UQ (tenant_id, source, idempotency_key)**; "same key with different hash is rejected".

Algorithm (same DB transaction as the side effect):
1. `INSERT inbound_event(key K, hash(body))`.
2. Inserted ⇒ process, store `result`, commit ⇒ return `201`/`202`.
3. Exists, same hash, `processed_at` set ⇒ return stored result, **`200`, no side effects**.
4. Exists, different hash ⇒ `409 IDEMPOTENCY_CONFLICT`.
5. Exists, still processing ⇒ `409` + `Retry-After`.
6. Purge after retention (proposed 35 days). Natural-key uniqueness constraints remain forever (e.g. BR-ORD-04 order unique per tenant + source system + source order id).

Key kinds per endpoint: `Idempotency-Key` header (most POST/PUT); `Run-Request-Id` header (API-18); natural keys (`source_system`+`source_order_id` API-10; `source_event_id` API-11; provider event id API-26); `If-Match` (API-03, API-16 draft edits, API-39).

### 2.5 Auth assurance + SoD

- **Step-up / AAL2 fresh**: API-20 commit, API-25 approve, API-27 bank details (portal re-auth "inside the last minutes", window unspecified), API-41 (AAL2). Missing ⇒ `403 STEP_UP_REQUIRED`.
- **Separation of duties** (BR-ADJ-02, BR-SEC-06, BR-PAY-02): evaluated from **recorded actor ids on the object**, not role names. Preparer/contributor cannot commit (API-20), approve batch (API-25), approve plan (API-16), approve genealogy case (API-15), approve restatement (API-22), decide adjustment (API-30). ⇒ `422 SOD_SELF_APPROVAL`. Test TS-42.
- Privileged grants (API-40): admin/approver role needs a second admin; cannot grant a permission you don't hold (BR-SEC-05).
- Tenant isolation test TS-21 (A): tenant A credential × every endpoint × tenant B ids, generated from OpenAPI; must fail without leaking existence; build fails if an endpoint is uncovered.

### 2.6 Forbidden endpoints (TRD-03 §4, SDD-06 §5) — enforce in API review

| Never build | Rule |
|---|---|
| `PUT`/`PATCH`/`DELETE` on orders, order events, result lines, postings, relationships, audit events, approvals | BR-ATT-02, BR-LED-02, BR-GEN-02 |
| Any endpoint that sets qualification state or a balance | BR-RNK-07, BR-LED-02 |
| Any endpoint that initiates a debit from a payee | BR-REV-09 |
| Any endpoint returning projected/potential earnings | BR-HON-01 (A), DEC-05 |
| Commit/approval endpoints accepting the preparer | BR-ADJ-02 |
| A separate "dashboard API" bypassing authz | SDD-06 §5 — dashboards reuse these endpoints with permission/scope filters |

Every catalogue endpoint must trace to ≥1 FR (QA-04 §4.7).

---

## 3. Endpoint catalogue (41 entries, from spec.json `apis`)

Endpoint `Rel` = when the endpoint must exist. FRs in parentheses ship in a later release: that sub-feature of the endpoint is not required at the endpoint's release.
Naming: user permissions use dots (`run.commit`); API-key scopes use colons (`orders:write`, `participants:write`, `ledger:export`).

| ID | Method + path | Purpose / sub-resources | AuthN | AuthZ | Idempotency | Rel | FRs (FR rel where different from endpoint) |
|---|---|---|---|---|---|---|---|
| API-01 | `POST /v1/imports` | Create an import batch and upload export files | User session | import.manage | Idempotency-Key required | A | FR-IMP-001, FR-IMP-003, FR-IMP-004 (V1) |
| API-02 | `GET /v1/imports/{id}` | Batch state, control totals, validation report | User session | import.manage | Safe | A | FR-IMP-001, FR-IMP-003 |
| API-03 | `PUT /v1/import-mappings/{id}` | Save a new mapping version; POST …/approve to approve | User session | mapping.edit, mapping.approve | If-Match version | A | FR-IMP-002 |
| API-04 | `POST /v1/compliance/snapshots` | Create a report snapshot (async job) | User session | snapshot.create | Idempotency-Key required | A | FR-CPL-001, FR-CPL-002, FR-CPL-003, FR-CPL-004, FR-CPL-005, FR-CPL-006 |
| API-05 | `GET /v1/compliance/snapshots/{id}` | Snapshot with figures, populations, method and input versions | User session or API key | compliance.read | Safe | A | FR-CPL-001, FR-CPL-002, FR-CPL-003, FR-CPL-004, FR-CPL-005, FR-CPL-006, FR-CPL-009 (V1), FR-CPL-010 (V1), FR-RPT-001 (B) |
| API-06 | `GET /v1/compliance/snapshots/{id}/figures/{key}/rows` | Drill-down rows for a figure; ?export=true creates a logged export | User session | compliance.read, export | Safe | A | FR-CPL-006, FR-AUD-002 |
| API-07 | `POST /v1/auth/sessions` | Sign-in, MFA verification, step-up, refresh, sign-out (sub-resources) | Public, rate limited | — | Not applicable | A | FR-IAM-001, FR-IAM-002, FR-IAM-007 (B) |
| API-08 | `POST /v1/support-sessions` | Vendor requests access; POST …/{id}/decision by tenant admin; GET …/{id}/log | Vendor session / user session | vendor role / vendor_access.decide | Idempotency-Key required | A | FR-IAM-005, FR-OPS-001 |
| API-09 | `GET /v1/audit-events` | Search audit events | User session | audit.read | Safe | A | FR-AUD-001 |
| API-10 | `POST /v1/orders` | Idempotent upsert of an order with lines | API key | orders:write | Idempotency-Key required; natural key source_system + source_order_id | B | FR-IAM-006, FR-ORD-001, FR-ORD-002, FR-ORD-003, FR-ORD-005, FR-INT-001 |
| API-11 | `POST /v1/order-events` | Refund, return, exchange, chargeback, subscription events | API key | orders:write | Idempotency-Key required; natural key source_event_id | B | FR-ORD-004, FR-ORD-005, FR-ORD-006 (V1) |
| API-12 | `POST /v1/participants` | Enrol a participant (with sponsor and placement); PATCH …/{id}/type, …/{id}/status | API key or user session | participants:write; participant.manage | Idempotency-Key required | B | FR-PAR-001, FR-PAR-002, FR-PAR-005, FR-PAR-006, FR-GEN-001, FR-GEN-005 |
| API-13 | `GET /v1/positions/{id}/downline` | Downline page for staff or distributor with visibility policy applied | User or portal session | genealogy.read / self downline | Safe | B | FR-GEN-006, FR-GEN-007, FR-GEN-008 |
| API-14 | `GET /v1/genealogy/tree` | Subtree as of a valid date and known-at time (staff) | User session | genealogy.read | Safe | B | FR-GEN-002, FR-GEN-003, FR-GEN-007 |
| API-15 | `POST /v1/genealogy-cases` | File a change or correction; POST …/{id}/decision | User session | case.genealogy.create / approve | Idempotency-Key required | B | FR-GEN-002, FR-GEN-004 |
| API-16 | `POST /v1/plans/{id}/versions` | Create or edit a draft version; POST …/{v}/submit, …/approve, …/schedule; guardrail decisions returned | User session | plan.edit, plan.approve | If-Match version; Idempotency-Key on transitions | B | FR-CPL-007, FR-CPL-008, FR-GEN-009, FR-PLN-001, FR-PLN-002, FR-PLN-003, FR-PLN-004, FR-PLN-007, FR-PLN-008, FR-AI-002 (V1) |
| API-17 | `POST /v1/simulations` | Simulate a plan version on a period; GET result and comparison; golden dataset runs | User session | plan.simulate | Idempotency-Key required | B | FR-PLN-004, FR-PLN-005, FR-PLN-006 |
| API-18 | `POST /v1/periods/{id}/runs` | Start a run; GET run status; POST …/replay | User session | run.execute | Run-Request-Id required | B | FR-COMP-001, FR-COMP-002, FR-COMP-003, FR-COMP-008, FR-COMP-011 (V1), FR-COMP-012 |
| API-19 | `GET /v1/runs/{id}/review` | Review dataset: totals, variance, movers, exceptions, changes | User session | run.review | Safe | B | FR-COMP-004, FR-COMP-005, FR-COMP-010, FR-RPT-001, FR-AI-001 (V1) |
| API-20 | `POST /v1/runs/{id}/commit` | Commit a calculated run (approver, step-up) | User session AAL2 fresh | run.commit; not preparer | Idempotency-Key required | B | FR-IAM-004, FR-COMP-006 |
| API-21 | `GET /v1/result-lines/{id}/trace` | Compact or expanded calculation trace | User session | trace.read | Safe | B | FR-COMP-007 |
| API-22 | `POST /v1/restatements` | Request a restatement; GET diff; POST decision | User session | restatement.request / approve | Idempotency-Key required | B | FR-COMP-009, FR-FIN-003 |
| API-23 | `GET /v1/ledger/accounts/{id}/postings` | Postings and balances; GET /v1/payees/{id}/balances | User session | ledger.read | Safe | B | FR-FIN-001, FR-FIN-002, FR-FIN-003, FR-FIN-006 (V1), FR-FIN-007 (V1), FR-RPT-002 |
| API-24 | `POST /v1/ledger/journal-exports` | Generate a GL journal export for a period | User session or API key | ledger.export | Idempotency-Key required | B | FR-FIN-005 |
| API-25 | `POST /v1/payout-batches` | Prepare a batch; POST …/{id}/submit, …/approve, …/retry-failed | User session (approve: AAL2 fresh) | payout.prepare / payout.approve; not preparer | Idempotency-Key required | B | FR-IAM-004, FR-PAY-001, FR-PAY-002, FR-PAY-003, FR-PAY-007 |
| API-26 | `POST /v1/webhooks/providers/{provider}` | Inbound provider webhook (settlement, return, failure) | Provider signature | Provider allow-list per tenant | Provider event id deduplicated | B | FR-PAY-004 |
| API-27 | `PUT /v1/payees/{id}/bank-details` | New bank-detail version; PUT …/tax-profile | Portal session (fresh) or case | self / case approval | Idempotency-Key required | B | FR-PAY-005, FR-TAX-001, FR-DIST-006 |
| API-28 | `GET /v1/me/statements` | Portal: statements, statement detail, rank status, customers, notifications | Portal session | self | Safe | B | FR-CRM-003 (V1), FR-FIN-002, FR-DIST-001, FR-DIST-003, FR-DIST-005, FR-DIST-007 (B-MKT), FR-DIST-008 |
| API-29 | `GET /v1/me/statement-lines/{id}/explanation` | Plain-language explanation of a line | Portal session | self | Safe | B | FR-DIST-002 |
| API-30 | `POST /v1/cases` | Open a case (adjustment, dispute, duplicate, write-off, grievance); POST …/{id}/decision | User or portal session | by case type | Idempotency-Key required | B | FR-CPL-013 (B-MKT), FR-PAR-003, FR-PAR-004 (V1), FR-FIN-004, FR-CAS-001, FR-CAS-002, FR-CAS-003 |
| API-31 | `POST /v1/privacy-requests` | Open and fulfil data-subject requests (public form variant is rate limited) | Public / user session | privacy.manage | Idempotency-Key required | B | FR-PRV-001, FR-PRV-002, FR-PRV-003 (V1) |
| API-32 | `POST /v1/exports` | Schedule or run a full data export; GET manifest | User session or API key | export.full | Idempotency-Key required | B | FR-TEN-005 (V1), FR-INT-003, FR-INT-004 (V1) |
| API-33 | Outbound webhooks | run.committed, period.closed, payout.settled, payout.returned, plan.activated, disclosure.published | HMAC signature | Tenant-configured endpoints | Event id; retries with backoff | B | FR-CPL-011 (V1), FR-INT-001 |
| API-34 | `GET /v1/me/team` | Portal: privacy-limited team search and node view | Portal session | self downline, visibility policy | Safe | B | FR-GEN-006, FR-DIST-004, FR-DIST-009 (V1) |
| API-35 | `PUT /v1/customers/{id}/servicing` | Set or change the servicing position (effective-dated) | User session or API key | servicing.manage | Idempotency-Key required | B | FR-CRM-001, FR-CRM-002 |
| API-36 | `POST /v1/tax/year-end-forms` | Generate year-end forms for a market and year | User session | tax.forms | Idempotency-Key required | B | FR-TAX-003 (B-MKT) |
| API-37 | `GET /v1/integrations/health` | Connector and provider health and reconciliation differences | User session | integration.read | Safe | B | FR-ORD-002, FR-INT-002 |
| API-38 | `POST /v1/migrations/parallel-runs` | History import jobs and parallel-run comparisons; POST sign-off | User session | migration.manage / signoff | Idempotency-Key required | B | FR-MIG-001, FR-MIG-002 |
| API-39 | `PUT /v1/settings/{key}` | Versioned settings, markets, brands, calendars, provider records, market checklist, tenant provisioning (vendor) | User or vendor session | settings.manage and item-specific | If-Match version | A | FR-TEN-001, FR-TEN-002 (B), FR-TEN-003 (B), FR-TEN-004 (B), FR-CPL-012 (B), FR-PAY-006 (B), FR-TAX-002 (B-MKT), FR-PRV-004 |
| API-40 | `POST /v1/users` | Invite users; roles and role assignments; approvals of privileged grants | User session | user.manage | Idempotency-Key required | A | FR-IAM-003 |
| API-41 | `GET /v1/system/licence` | Self-hosted edition: licence state, installed versions, update check, diagnostics, support bundle (sub-resources; POST to load licence or apply update) | User session AAL2 | system.manage | Idempotency-Key on POST | V1 | FR-LIC-001, FR-LIC-002, FR-LIC-003 |

### 3.1 Release split summary

| Release | Endpoints |
|---|---|
| A (11) | API-01, 02, 03, 04, 05, 06, 07, 08, 09, 39, 40 |
| B (29) | API-10 … API-38 |
| V1 (1) | API-41 |

Sub-features inside an endpoint that ship later (from FR releases):
- API-01: FR-IMP-004 (V1, Could).
- API-05: FR-CPL-009, FR-CPL-010 (V1, publication/disclosure); FR-RPT-001 (B, run-sourced figures).
- API-07: FR-IAM-007 (B) — portal-realm sign-in parts.
- API-11: subscription events FR-ORD-006 (V1).
- API-12: FR-GEN-005 (Could), FR-PAR-006 (Should).
- API-16: FR-AI-002 (V1).
- API-18: FR-COMP-011 (V1).
- API-19: FR-AI-001 (V1).
- API-23: FR-FIN-006, FR-FIN-007 (V1).
- API-28: FR-DIST-007 (B-MKT); FR-CRM-003 customers view (V1).
- API-30: FR-CPL-013 grievance (B-MKT); FR-PAR-004 (V1).
- API-31: FR-PRV-003 (V1).
- API-32: FR-TEN-005, FR-INT-004 (V1; replica is V1 per ADR-11).
- API-33: FR-CPL-011 / `disclosure.published` (V1).
- API-34: FR-DIST-009 (V1).
- API-36: only FR-TAX-003 which is **B-MKT** ⇒ endpoint effectively B-MKT.
- API-39 (A): only FR-TEN-001, FR-PRV-004 in A; FR-TEN-002/003/004, FR-CPL-012, FR-PAY-006 in B; FR-TAX-002 in B-MKT.

### 3.2 Sub-resource paths implied by the catalogue (same standards apply)

| Parent | Sub-resources |
|---|---|
| API-03 | `POST /v1/import-mappings/{id}/approve` (`mapping.approve`) |
| API-07 | sign-in, MFA verification, step-up, refresh, sign-out (paths not named) |
| API-08 | `POST /v1/support-sessions/{id}/decision` (`vendor_access.decide`, step-up, Idempotency-Key), `GET /v1/support-sessions/{id}/log`; built also: `GET /v1/support-sessions` (vendor: all; tenant: `vendor_access.decide`), `GET /v1/support-sessions/{id}`, `POST /v1/support-sessions/{id}/end` (requester or tenant); in-session reads send header `X-Support-Session: {id}` |
| API-39 (provisioning, E-ADR-23) | vendor realm: `GET /v1/tenants`, `GET /v1/tenants/{id}`, `POST /v1/tenants` (Idempotency-Key), `POST /v1/tenants/{id}/approve` (second vendor user, step-up, Idempotency-Key), `POST /v1/tenants/{id}/go-live`, `GET /v1/tenants/{id}/breach-contacts` |
| API-12 | `PATCH /v1/participants/{id}/type`, `PATCH /v1/participants/{id}/status` |
| API-15 | `POST /v1/genealogy-cases/{id}/decision` |
| API-16 | `POST /v1/plans/{id}/versions/{v}/submit`, `…/approve`, `…/schedule` |
| API-17 | `GET /v1/simulations/{id}` (result, comparison); golden dataset runs |
| API-18 | `GET` run status; `POST …/replay` |
| API-22 | `GET` diff; `POST …/decision` |
| API-23 | `GET /v1/payees/{id}/balances` |
| API-25 | `POST /v1/payout-batches/{id}/submit`, `/approve`, `/retry-failed` |
| API-27 | `PUT /v1/payees/{id}/tax-profile` |
| API-28 | `GET /v1/me/statements/{run_id}`; rank status, customers, notifications (paths not named) |
| API-30 | `POST /v1/cases/{id}/decision` |
| API-32 | `GET` manifest |
| API-38 | `POST` sign-off |
| API-41 | `POST` load licence, apply update; update check, diagnostics, support bundle |

---

## 4. Detailed specifications (SDD-06 §3)

### 4.1 API-01 `POST /v1/imports` — A

| Item | Spec |
|---|---|
| AuthN/Z | Staff token; `import.manage` |
| Request | `multipart/form-data`: `market` (code), `period_from`, `period_to` (`YYYY-MM`), files `participants`, `orders`, `payout_lines` |
| Response `202` | `{ "id": "…", "state": "uploaded", "links": { "self": "/v1/imports/{id}" } }` |
| Sync validation | file presence, size limit, content type |
| Async validation | schema, keys, references, forbidden columns |
| Errors | `400 FILE_MISSING` · `413 FILE_TOO_LARGE` · `422 MARKET_UNKNOWN` · async `rejected` with row codes `FORBIDDEN_COLUMN`, `SCHEMA_MISMATCH`, `ORPHAN_REFERENCE`, `DUPLICATE_KEY` |
| Idempotency | `Idempotency-Key` required; replay returns same batch |
| State (`import_batch.state`) | `uploaded, rejected, validated, mapped, loaded, superseded`; `kind in (overlay, migration)`; stores `row_counts`, `control_totals`, `mapping_id`, `superseded_by` |
| Failure | whole batch rejected with row report; **nothing stored**; rejected files deleted (TRD-05 §2.1) |
| Poll | API-02 `GET /v1/imports/{id}` → state, control totals, validation report (`import_row_error`: `file`, `row_no`, `column_name`, `code`, `detail`) |

### 4.2 API-04 `POST /v1/compliance/snapshots` — A

```json
// request
{ "market": "DEMO", "period_from": "2025-01", "period_to": "2025-12", "reports": ["R1","R2","R3","R4","R5"] }
// 202
{ "id": "snp_…", "state": "computing" }
// GET /v1/compliance/snapshots/{id} → 200 (API-05)
{ "id": "snp_…", "state": "ready", "method_version": "1.0", "mapping_version": 3,
  "inputs": { "batches": ["imp_…"] },
  "figures": [
    { "report": "R1", "period": "2025-01", "key": "customer_share_pct", "value": "62.50",
      "numerator_minor": 10000, "denominator_minor": 16000, "population_count": 3,
      "rows": "/v1/compliance/snapshots/snp_…/figures/R1.2025-01.customer_share_pct/rows" } ] }
```

| Item | Spec |
|---|---|
| AuthZ | create `snapshot.create`; read `compliance.read` (API-05 also API key) |
| Validation | period range within loaded batches; `reports` ⊆ {R1..R5} |
| Errors | `422 NO_DATA_FOR_RANGE` · `409 INPUTS_CHANGING` |
| Idempotency | key required; snapshot immutable; only later state `outdated` |
| States seen | `computing` → `ready` → (`outdated`) |
| Figure key format | `{report}.{period}.{key}` (e.g. `R1.2025-01.customer_share_pct`); `value` is a decimal **string**; components in minor units |
| Drill-down | API-06 rows; `?export=true` ⇒ logged export (`export_job`, audit event with row count; TS-34); export above cap refused (TS-56) |
| Event | `compliance.snapshot.ready` |
| Golden | TS-31 overlay fixture expected R1–R5 values |

### 4.3 API-10 `POST /v1/orders` — B

```json
{ "source_system": "shopify", "source_order_id": "5123998", "market": "MY",
  "buyer": { "external_ref": "C-88121", "type_hint": "customer" },
  "attribution": { "kind": "link", "position_ref": "POS-000123" },
  "purpose": "customer",
  "paid_at": "2027-03-28T09:15:00+08:00", "fulfilled_at": null,
  "currency": "MYR", "amount_minor": 25900, "tax_minor": 1554,
  "lines": [ { "line_no": 1, "sku": "SKU-1001", "quantity": 1, "amount_minor": 25900 } ] }
```

| Item | Spec |
|---|---|
| AuthN/Z | API key; scope `orders:write`; key's market scope includes `market` |
| Response | `201` with order id, resolved `buyer_type`, `attributed_position`, `period_id`, per-line `volumes`; `200` on replay; `"late": true` if assigned period already committed |
| Validation | Σ line `amount_minor` = `amount_minor`; `currency` = market currency; market Live; `quantity` > 0; timestamps not in future beyond tolerance (tolerance unspecified) |
| Processing | volumes from `product_volume_map` at crediting-event time; facts fixed (BR-ATT-02); period assigned in calendar TZ (TS-62); committed period ⇒ late transaction ⇒ adjustment line in open run (TS-13) |
| Errors | `401`, `403` · `422 MARKET_NOT_LIVE` · `422 UNKNOWN_SKU` (or `202` into exception queue when tenant enables hold-and-map) · `409 IDEMPOTENCY_CONFLICT` |
| Idempotency | key required; natural key `(source_system, source_order_id)`; **changed body for existing order rejected** — changes arrive as order events (API-11) |
| Enum hints | `attribution.kind` seen: `link` (TRD-05: link, code or sponsor reference); `purpose` (import enum: `customer, personal, resale, unknown, enrolment`); `buyer.type_hint` seen: `customer` |
| Tests | TS-15 duplicate webhook ⇒ one order; TS-50 market not live |

### 4.4 API-18 `POST /v1/periods/{id}/runs` + API-20 `POST /v1/runs/{id}/commit` — B

| Item | Start run (API-18) | Commit (API-20) |
|---|---|---|
| AuthN | staff token | staff token, factor verified inside step-up window (AAL2 fresh) |
| AuthZ | `run.execute` | `run.commit`; caller ≠ run preparer or contributor |
| Request | header `Run-Request-Id` | `{ "acknowledged_exceptions": ["exc_…"] }` |
| Response | `202 { "run_id", "state": "queued" }`; same id for concurrent/repeated request | `200 { "run_id", "state": "committed", "journal_entry_id", "totals" }` |
| Validation | period at/after cut-off and state Open or Calculated; sync healthy | run Calculated **and latest** for period; review opened (API-19); no blocking exception |
| Errors | `409 PERIOD_COMMITTED` · `422 SYNC_BEHIND` (+`last_sync_at`) · `422 BEFORE_CUTOFF` | `403 STEP_UP_REQUIRED` · `422 SOD_SELF_APPROVAL` · `409 RUN_SUPERSEDED` · `500 INVARIANT_FAILED` (rollback + alert) |
| Idempotency | `Run-Request-Id` | `Idempotency-Key`; second commit returns first result |
| Event | — | `run.committed` (run, period, totals) |

### 4.5 API-14 `GET /v1/genealogy/tree` — B

`GET /v1/genealogy/tree?root=POS-000123&kind=sponsor&as_of=2027-03-15&known_at=2027-04-01T00:00:00Z&depth=2&limit=100`

| Item | Spec |
|---|---|
| AuthZ | `genealogy.read` (staff only). Distributors use API-13/API-34 (visibility policy) |
| Params | `root` (position ref), `kind` (`sponsor`; placement presumably `placement`), `as_of` (valid date), `known_at` (RFC 3339), `depth`, `limit`, cursor |
| Response | `{ "root": {...}, "data": [ { "position_ref", "parent_ref", "depth", "status", "paid_as_rank", "children_count" } ], "next_cursor", "read_model": "current" }` — `"system_of_record"` when read model stale or a historical view requested |
| Validation | `depth` ≤ **5** per request; `known_at` ≤ now; `as_of` required when `known_at` given |
| Errors | `404` root unknown or outside scope |
| Test | AC-01.1 / TS-03 bitemporal view |

### 4.6 API-15 `POST /v1/genealogy-cases` — B

```json
{ "type": "correction", "kind": "sponsor", "position_ref": "POS-000456",
  "proposed_parent_ref": "POS-000789", "valid_from": "2027-01-10",
  "reason_code": "DATA_ENTRY_ERROR", "evidence_document_ids": ["doc_…"] }
```

| Item | Spec |
|---|---|
| AuthZ | create `case.genealogy.create`; decide `case.genealogy.approve` by a **different user** |
| Response `201` | case + `policy_check` (window result, approvals needed), `structural_check` (cycle, slot), and for corrections `affected_periods`, `estimated_impact` |
| Errors | `422 GEN_CYCLE` · `422 OUTSIDE_CHANGE_WINDOW` · `422 GEN_SLOT_TAKEN` · `422 EVIDENCE_REQUIRED` |
| Decision | `POST /v1/genealogy-cases/{id}/decision` `{ "decision": "approved" }` |
| `type` | `correction` (vs change — "File a change or correction") |
| Tests | TS-45 (outside window, cycle, concurrent slot ⇒ exactly one wins); TS-03 |

### 4.7 API-25 `POST /v1/payout-batches` — B

| Item | Spec |
|---|---|
| Request | `{ "market": "MY", "provider_config_id": "…", "periods": ["per_…"], "include_carried": true }` |
| Response `201` | batch in **Draft** with `total_minor`, `count`, `exclusions: [ { "payee", "reason" } ]`, reason ∈ `COOLING_OFF`, `BELOW_MINIMUM`, `HOLD`, `TAX_PROFILE_MISSING`, `DUPLICATE_CASE` |
| Sub-resources | `/submit` (preparer, `payout.prepare`) · `/approve` (approver, `payout.approve`, AAL2 fresh, ≠ preparer) · `/retry-failed` |
| Validation | provider eligible + on allow-list; instruction amount ≤ payee payable **at approval time**, re-checked inside the approval transaction |
| Errors | `422 PROVIDER_NOT_ELIGIBLE` · `422 SOD_SELF_APPROVAL` · `409 BALANCE_CHANGED` (batch returns to Draft) |
| Idempotency | key on create **and each transition** |
| Batch entity | `payout_batch`: `state in (draft, reviewed, approved, instructing, partially_settled, settled, failed, cancelled)`; cols `market_id`, `provider_config_id`, `total_minor`, `currency`, `exclusions jsonb`, `prepared_by`, `approval_id` |
| Instruction entity | `payout_instruction`: `payee_participant_id`, `amount_minor`, `idempotency_key`, `state in (pending, instructed, accepted, settled, returned, failed, cancelled)`, `amount > 0`, UQ `(tenant_id, idempotency_key)`, `signature bytea NN` (BR-PAY-10), `provider_ref`, `attempts`, `last_error`, `bank_detail_version_id` |
| Events | `payout.batch.approved`; per instruction `payout.settled` / `payout.returned` / `payout.failed` |
| Tests | TS-16 retry after timeout ⇒ one payment, same key; TS-40 full cycle; TS-42 SoD |

### 4.8 API-26 `POST /v1/webhooks/providers/{provider}` (inbound) — B

| Item | Spec |
|---|---|
| AuthN | provider signature over **raw body**; timestamp tolerance (value unspecified) |
| AuthZ | provider allow-list per tenant |
| Processing | store `inbound_event` (dedupe on provider event id; raw body hashed) → `2xx` → worker maps to instruction by provider reference → ledger entry 3 (settled: payout in transit → settled clearing) or 4 (returned **or failed** after instruction: payout in transit → payee payable) per SDD-09 |
| Errors | `401` bad signature · unknown reference ⇒ reconciliation exception, **still `2xx`** |
| Duplicates | acknowledged without change (TS-41) |
| Returned payment | amount back to payable + case opened (BR-PAY-09) |

### 4.9 API-27 `PUT /v1/payees/{id}/bank-details` — B

| Item | Spec |
|---|---|
| AuthN | portal token with re-auth "inside the last minutes" (step-up), or staff acting through an approved case |
| AuthZ | `self` / case approval |
| Request | market-specific bank fields; **never logged** |
| Response `201` | `{ "version_id", "masked": "•••• 4821", "cooling_off_until": "…" }` |
| Side effects | notices to previous and new contact; hold on payouts inside cooling-off; fraud signal if fingerprint shared above threshold (BR-PAY-08) |
| Errors | `403 STEP_UP_REQUIRED` · `422 INVALID_BANK_DETAILS` |
| Idempotency | key required; creates new `bank_detail_version` (insert only except `superseded_at`; `created_via in (self, case, migration)`; stores `details_ciphertext`, `fingerprint`, `masked`, `cooling_off_until`) |
| Sibling | `PUT /v1/payees/{id}/tax-profile` |
| Test | TS-17 |

### 4.10 API-28 / API-29 portal statements — B

- `GET /v1/me/statements?limit=12` → list of periods with `net_minor`, `payout_status`.
- `GET /v1/me/statements/{run_id}`:

```json
{ "period": "2027-03", "currency": "MYR",
  "totals": { "gross_minor": 123456, "withheld_minor": 2469, "clawback_minor": 0, "adjustment_minor": 0, "net_minor": 120987 },
  "positions": [ { "position_ref": "POS-000123", "paid_as_rank": "R2",
     "lines": [ { "id": "rl_…", "bonus": "unilevel", "amount_minor": 12500, "explain": "/v1/me/statement-lines/rl_…/explanation" } ] } ],
  "payout": { "status": "settled", "date": "2027-04-05" },
  "disclosure_url": null }
```
- `GET /v1/me/statement-lines/{id}/explanation` →
```json
{ "title": "Level 2 commission",
  "sentences": ["5% of 2,500.00 commissionable volume from 2 orders on your second level."],
  "inputs": { "rate": "5%", "base": "2,500.00", "rank_used": "R1", "period": "March 2027", "rounding": "to the nearest sen" } }
```
- Rules: no other person's name or contact; committed-run responses cacheable (ETag, `Cache-Control: private`); **no endpoint returns future/potential earnings**; `disclosure_url` populated only in V1. Explanation text is server-formatted (exception to TR-API-21 locale neutrality — see C-9).
- Totals identity (derived from the example, not stated in sources): `net = gross − withheld − clawback ± adjustment` (example: 123456 − 2469 = 120987).

### 4.11 API-08 support sessions — A

Flow:
1. Vendor engineer `POST /v1/support-sessions {tenant, reason, scope, minutes}` (vendor realm) ⇒ tenant admin notified. The requester's region is never in the body: it is `user_account.work_region` (E-ADR-24).
2. Tenant admin `POST /v1/support-sessions/{id}/decision {approved, minutes}` (`vendor_access.decide`) ⇒ vendor gets scoped, time-boxed credential.
3. During session: GET tenant data (read-only scope, header `X-Support-Session`); each access ⇒ audit event with `support_session_id` (method, route, params, query), visible to tenant; any 401/403 inside the session ⇒ `SUPPORT_SESSION.ACCESS_REFUSED` in both logs; without a session ⇒ vendor log only (E-ADR-22).
4. Expiry ⇒ credential invalid ⇒ session report to tenant admin.
- Entity `support_session`: `state in (requested, approved, denied, active, expired, ended)`; `ends_at − starts_at` ≤ tenant maximum; cols `requester_id`, `reason`, `scope jsonb`, `requested_minutes`, `decided_by`, `starts_at`, `ends_at`.
- Out-of-region session needs explicit region approval (TS-57, BR-DAT-09). BR-SEC-01, ADR-12.
- Note: `tenant` appears in the request body — permitted only because vendor realm is cross-tenant (see C-8).

---

## 5. Outbound webhooks and outbox

### 5.1 Event catalogue (union of SDD-06 §4, API-33, TRD-05 §2.9)

| Event | Payload ids | When | Rel |
|---|---|---|---|
| `compliance.snapshot.ready` | snapshot | snapshot computed | A emit / B deliver (C-3) |
| `run.committed` | run, period, totals | commit | B |
| `period.closed` | period | close | B |
| `payout.batch.approved` | batch | approval | B |
| `payout.settled` | instruction, batch | reconciliation | B |
| `payout.returned` | instruction, batch | reconciliation | B |
| `payout.failed` | instruction, batch | reconciliation | B (SDD-06 §4 only) |
| `plan.version.activated` | plan, version | activation | B (API-33 writes `plan.activated`, C-1) |
| `case.decided` | case, type, decision | decision | B (SDD-06 §4 only) |
| `disclosure.published` | — | disclosure publication | V1 (FR-CPL-011) |

### 5.2 Delivery format

- Envelope fields: event id, type, occurred-at, tenant, object ids (TRD-05 §2.9). No personal data. Proposed JSON:
  `{ "id": "<event uuid>", "type": "run.committed", "occurred_at": "<RFC3339>", "tenant": "<uuid>", "data": { "run": "...", "period": "...", "totals": {...} } }` (key names beyond the listed concepts are not fixed).
- Signature: HMAC-SHA-256 over timestamp + body with per-endpoint secret (`webhook_endpoint.secret_ref` in secrets manager). Header names unspecified.
- `webhook_endpoint(id, tenant_id, url, secret_ref, topics text[], state)` — **https only**. `webhook_delivery(id, tenant_id, endpoint_id, outbox_event_id, status int, attempt, next_attempt_at)`.
- At-least-once; receivers dedupe on event id. Retry: exponential backoff with jitter, proposed 1 min → 6 h, 72 h total; then dead-letter; dead letters visible in the integrations screen with payload reference, last error and replay action (manual replay after fix).

### 5.3 Transactional outbox (ADR-10, TR-INT-05)

`outbox_event(id, tenant_id, seq bigserial, topic, key, payload jsonb, available_at, attempts, dispatched_at, dead boolean)`; index `(dispatched_at, available_at) WHERE dispatched_at IS NULL`; **written in the same transaction as the state change**. Every external effect (payout instructions, bank files, journal pushes, webhooks, messages, exports) goes through it. Queue lives in PostgreSQL (ADR-17).

Dispatcher state machine (TRD-05 §3):

| From | To | Trigger |
|---|---|---|
| (new) | Pending | outbox row written |
| Pending | Sent | dispatcher picks row |
| Sent | Confirmed | 2xx / provider accepted |
| Sent | Unknown | timeout or 5xx |
| Unknown | Confirmed | status query says accepted |
| Unknown | Pending | status query says not received (**same key**) |
| Sent | Rejected | permanent error (terminal) |
| Pending | Dead | attempts exhausted |
| Dead | Pending | manual replay after fix |

Payout instructions are resolved by **status query, never blind retry**. Alerts: outbox age, dead letters, sync lag at cut-off, reconciliation differences. Inbound duplicates acknowledged without change.

---

## 6. Integration adapters (TRD-05)

Principles: (1) tenant owns merchant/payout/messaging accounts; platform stores credentials in secrets manager (`provider_config.credentials_secret_ref`; secrets never in table) and acts on tenant instruction. (2) Every integration behind an adapter interface. (3) Inbound idempotent; outbound via outbox.

`provider_config`: UQ `(tenant_id, kind, provider, market_id)`; `kind in (payout, payment, commerce, messaging)`; `approved_description`, `approval_document_id`, `approved_at`, `funds_holder`, `state`, `last_ok_at` (eligibility evidence, FR-PAY-006 / TR-INT-11 / BR-PAY-11).

### 6.1 Back-office export import — A (TR-INT-01, FR-IMP-001)

| File | Columns |
|---|---|
| `participants.csv` | `participant_id` (pseudonymous), `type`, `enrolled_month` (YYYY-MM), `sponsor_id` (for customers: servicing distributor), `market`, `status` |
| `orders.csv` | `order_id`, `month`, `day`, `buyer_id`, `amount_cents`, `volume_cents`, `purpose` (`customer, personal, resale, unknown, enrolment`), `is_starter_kit`, `refunded_cents`, `refund_month` |
| `payout_lines.csv` | `line_id`, `month`, `payee_id`, `bonus_type`, `source_kind` (`retail_sale, downline_volume, enrolment_order, pool, match, clawback, other`), `source_order_id`, `amount_cents` |

UTF-8, header row. Trigger: manual upload (V1: scheduled read-only SQL pull). Validation: required columns/types, key uniqueness, references resolve, **no column resembling name, contact, address, identity number, bank detail** (content-based detection = OQ-30). Failure: whole batch rejected with row report, nothing stored. TLS upload to tenant region; rejected files deleted; data terms signed first. Source codes mapped via versioned `import_mapping` (FR-IMP-002, API-03). Reference implementation: Phase A prototype `analytics.py`, `validate_export.py`.

### 6.2 Commerce connectors — B (TR-INT-02/03, FR-ORD-001/002, ADR-08, DEC-06)

| Aspect | Contract |
|---|---|
| Platforms | Shopify, WooCommerce (webhooks + reconciliation poll); custom commerce → Ingestion API (API-10/11) directly. "Fluid-type" third connector open (OQ-15) |
| Data in | order created/updated/paid/fulfilled; refund; customer created/updated; (V1) subscription events |
| Required fields | source order id; lines with SKU, qty, price, tax; buyer ref; payment + fulfilment times; attribution hint (link, code or sponsor ref); purpose where required |
| Trigger | store webhook; nightly reconciliation poll (proposed) comparing counts + totals; on-demand backfill by date range |
| Mapping | SKU → volume via `product_volume_map`; unknown SKU ⇒ exception queue |
| Failure | store retries delivery; handler idempotent; poll repairs gaps; sync health (API-37) shows lag + differences; **runs blocked when behind** (BR-ORD-05, `422 SYNC_BEHIND`) |
| Security | verify store webhook signature; store API token in secrets manager, least scopes; ingestion key scoped `orders:write` |
| Not exchanged | card data, checkout, catalogue beyond SKU + class, inventory |
| Payment acceptance (§2.4) | out of flow; commerce platform is checkout; platform records tenant payment provider + approval in launch checklist only |

Connector internals: connector receives store webhook → translates to API-10/API-11 call (`source_system` = `shopify`/`woocommerce`) → same idempotency path.

### 6.3 Payout adapter — B (TR-INT-04/06, ADR-09, FR-PAY-002/004)

Interface (every adapter implements all five):

| Operation | Contract |
|---|---|
| `submit(instructions)` | send 1..n instructions with **our idempotency key as provider client reference**; returns provider refs or per-line rejections |
| `status(reference)` | returns `pending`, `accepted`, `settled`, `returned`, `failed`; used to resolve ambiguous outcomes **before any re-send** |
| `parseSettlementReport(file)` | maps report lines to instructions |
| `verifyWebhook(headers, body)` | verify provider signature, extract event id |
| `capabilities()` | methods, currencies, limits, cut-off times, beneficiary validation yes/no |

| Aspect | Contract |
|---|---|
| Data out | payee ref, masked beneficiary + encrypted bank details as provider requires, amount minor units, currency, our idempotency key, narrative |
| Data in | settlement, return, failure events with provider ref, amount, reason |
| Failure | timeout → `status` → retry same key; partial batch rejection → failed lines only (`/retry-failed`); returned → back to payable + case; unknown ref → exceptions queue |
| Bank-file adapter | produces bank bulk-payment file for **manual upload** by payout officer; ingests bank result file; same reconciliation |
| Security | tenant-owned credentials; signed instructions; allow-list per tenant + market; eligibility evidence recorded |
| Minimum | **two payout routes per launch market**, one may be bank file (ADR-09) |
| Never | debit a payee (BR-REV-09); hold funds / wallets (DEC-03) |
| Unknown | eligible providers (**AQ-01 launch blocker**). Desk screen: Stripe prohibits MLM; PayPal requires pre-approval; two Indian providers prohibit "MLM collection fees"; a Malaysian gateway lists MLM banned/high-risk; specialist payout providers don't document MY/IN coverage. Provider idempotency/status/formats = OQ-10 |

Status mapping (adapter → `payout_instruction.state`) — **brief's proposal, not stated in sources**: `pending`→`instructed`; `accepted`→`accepted`; `settled`→`settled`; `returned`→`returned`; `failed`→`failed`. `pending` (entity) = created, not yet sent; `cancelled` = removed before send.

### 6.4 Tenant ERP / GL export — B (TR-INT-07, FR-FIN-005, API-24)

Balanced journal per period: mapped account code, debit, credit, currency, market, brand, run id, description. Trigger: period Committed or Closed; on demand. Format: CSV and JSON by API; one file per period + market; re-downloadable; versioned if regenerated. Failure: **unmapped account blocks export with list**. Security: API key scope `ledger:export` (user permission `ledger.export`); file link expires.

### 6.5 Tax — B-MKT (FR-TAX-003, API-36)

Year-end forms exported in market's file format where one exists; **platform does not file**. Formats belong to market pack, need a tax adviser. Withholding computed at commit (TS-38: 2.00% fixture rate on 1,234.56 ⇒ 24.69). Tax profile via `PUT /v1/payees/{id}/tax-profile`; tax id masked, unmask audited (TS-56). No external tax API.

### 6.6 Messaging — B

Email required; SMS/chat if tenant configures provider. Data out: template id, locale, recipient, minimal variables — **never bank details or full amounts in SMS**. Failure: retries; bounce ⇒ contact unverified; mandatory security notices fall back to second channel. Tenant sender identity; credentials in secrets manager.

### 6.7 Full export / replica — B (V1 replica)

Scheduled export of published data model (SDD-04 §7) to tenant-owned storage **in tenant region**, CSV + Parquet, manifest (row counts, checksums, schema version) — API-32, `export_job` (destination must be in tenant region). Manifest counts must reconcile (TS-58). V1: read-only replica for dedicated tenants.

### 6.8 V1 integrations

- Claims-monitoring partners (§2.10): approved-claims catalogue + current disclosure figures by API + webhook; no crawler.
- Update feed (self-hosted, §2.12, TR-INT-12, FR-LIC-002): outbound-only optional fetch of signed index (releases, engine versions, market packs, advisories); air-gapped import of same signed packages by file. API-41. Tests TS-69, TS-70.

### 6.9 Integration requirement index (TRD-05 §4)

| ID | Requirement | FR |
|---|---|---|
| TR-INT-01 | Overlay file contract + validator | FR-IMP-001 |
| TR-INT-02 | Idempotent ingestion API | FR-ORD-001 |
| TR-INT-03 | Shopify + WooCommerce connectors with reconciliation | FR-ORD-002 |
| TR-INT-04 | Payout adapter interface, ≥ 2 routes per market | FR-PAY-002 |
| TR-INT-05 | Outbox for every external effect | FR-PAY-003 |
| TR-INT-06 | Settlement reconciliation | FR-PAY-004 |
| TR-INT-07 | GL journal export | FR-FIN-005 |
| TR-INT-08 | Webhooks out and in | FR-INT-001 |
| TR-INT-09 | Sync health + run blocking | FR-INT-002 |
| TR-INT-10 | Full export | FR-INT-003 |
| TR-INT-11 | Provider eligibility record | FR-PAY-006 |
| TR-INT-12 | Signed update packages | FR-LIC-002 |

### 6.10 What is sandbox-able now

| Integration | Sandbox status | Build approach |
|---|---|---|
| Platform API itself | Required: sandbox tenant with synthetic data (TR-API-17) | Seed from golden datasets (TS-01, TS-31) |
| Back-office import | Fully local | Phase A prototype fixtures; TS-31 |
| Shopify / WooCommerce | Vendor dev stores exist (not stated in sources — general knowledge); connector priority still OQ-15 | Build against dev stores; contract-test API-10/11 directly |
| Custom commerce | Fully local | Call API-10/11 |
| Payout provider | **No provider chosen** (AQ-01, OQ-10). TS-16 assumes a "provider sandbox" | Build a fake adapter implementing all 5 ops (with injectable timeout/partial reject/return/unknown ref) + the bank-file adapter (fully local); swap real adapter after AQ-01 |
| Inbound provider webhooks | Local with fake adapter's signer | TS-41 |
| Tax filing | Nothing external; file formats per market pack (adviser needed) | Generate forms locally |
| ERP | File/API export only; no push target | Local |
| Identity | Self-hosted OIDC per cell (ADR-19) — run locally | — |
| Messaging | Provider unspecified | Stub with capture inbox |
| Outbound webhooks | Local receiver | Verify HMAC, retries, dead-letter |
| Update feed / licence | Local signed packages | TS-69/70 |

---

## 7. Permission / scope strings used by the API (verbatim)

User permissions (dot): `import.manage`, `mapping.edit`, `mapping.approve`, `snapshot.create`, `compliance.read`, `export` (API-06), `audit.read`, `vendor_access.decide`, `participant.manage`, `genealogy.read`, `case.genealogy.create`, `case.genealogy.approve`, `plan.edit`, `plan.approve`, `plan.simulate`, `run.execute`, `run.review`, `run.commit`, `trace.read`, `restatement.request`, `restatement.approve`, `ledger.read`, `ledger.export`, `payout.prepare`, `payout.approve`, `privacy.manage`, `export.full`, `servicing.manage`, `tax.forms`, `integration.read`, `migration.manage`, `signoff` (API-38), `settings.manage` (+ item-specific), `user.manage`, `system.manage`. Screen-level: `period.read` (SC-01).
Attribute/relationship authz: `self`, `self downline`, visibility policy, `by case type` (API-30), `case approval` (API-27), `not preparer`, provider allow-list per tenant (API-26), vendor role (API-08).
API-key scopes (colon): `orders:write`, `participants:write`, `ledger:export`. API keys: `api_key(name, key_hash, scopes text[], rate_tier, ip_allow cidr[], expires_at, revoked_at)` — B. Scope for API-05/24/32/35 key access not named (OQ list).

---

## 8. Conflicts found

| # | Conflict | Sources | Resolution |
|---|---|---|---|
| C-1 | Plan activation event name: `plan.activated` (API-33 catalogue row) vs `plan.version.activated` (SDD-06 §4, TRD-05 §2.9) | SDD-06 §2 vs §4, TRD-05 | Use **`plan.version.activated`** (2 of 3 sources, matches payload plan+version) |
| C-2 | Event set differs: API-33 lists 6 events (no `payout.failed`, `payout.batch.approved`, `compliance.snapshot.ready`, `case.decided`); SDD-06 §4 has 9 without `disclosure.published`; TRD-05 has 8 without `payout.failed`, `case.decided` | SDD-06, TRD-05 | Implement the **union** (§5.1); API-33 row is an abbreviation. `disclosure.published` V1 |
| C-3 | `compliance.snapshot.ready` is an A feature but outbound webhooks (API-33, `webhook_endpoint`, `webhook_delivery`) are B; `outbox_event` is A | SDD-06, spec.json entities | In A write the event to `outbox_event`; external delivery only from B. Polling API-05 is the A contract |
| C-4 | `GEN_CYCLE` status: `409` (TRD-03 §3) vs `422` (SDD-06 §3.6) | TRD-03, SDD-06 | Use **`422`** (business-rule violation on a proposed change, per TRD-03's own 409/422 definitions); keep code `GEN_CYCLE` stable. Fix TRD-03 table |
| C-5 | Idempotency store `inbound_event` is rel B, but A endpoints (API-01, 04, 08, 40) require `Idempotency-Key` | spec.json vs SDD-06 | Ship `inbound_event` (or the idempotency part of it) in **A** |
| C-6 | Replay status: TRD-03 §2 diagram says `200` stored result; TR-API-13 says "returns the original response"; API-01 "replay returns the same batch" (original was `202`) | TRD-03, SDD-06 | Return stored body; status `200` for synchronous creates (API-10 explicit); for async creates return the original `202` + same job id. Document per endpoint in OpenAPI |
| C-7 | API-26 tenant resolved "from the endpoint path secret and provider account", but TR-API-04 forbids tenant from path; catalogue path `/v1/webhooks/providers/{provider}` has no secret segment | SDD-06 §1 vs TRD-03 | Treat the path secret as a **credential**, not a tenant parameter: path `/v1/webhooks/providers/{provider}/{endpoint_token}`, token → `provider_config` → tenant, then verify signature with that config's secret; reject if provider account in payload ≠ config. Needs SDD-06 update |
| C-8 | API-08 request body carries `tenant` vs TR-API-04 (never from body) | SDD-06 §3.11, TRD-03 | Vendor realm is cross-tenant by design; allow `tenant` **only** on vendor-realm `POST /v1/support-sessions`; all tenant-data reads use the session-scoped credential |
| C-9 | TR-API-21 "API is locale-neutral; clients format" vs API-29 explanation returning formatted sentences/values ("2,500.00", "March 2027", "to the nearest sen") | TRD-03, SDD-06 §3.10 | API-29 is an explicit exception: render server-side in the portal user's locale (market pack, TS-30); all other endpoints stay neutral |
| C-10 | Endpoint release vs FR release: A endpoints contain B/B-MKT/V1 FRs (API-05, 07, 39); B endpoints contain V1/B-MKT FRs; API-36's only FR is B-MKT | spec.json | Endpoint ships at its tag with only the sub-features whose FR release ≤ current (§3.1); treat API-36 as **B-MKT** |
| C-11 | Import file money columns `*_cents` vs TR-API-06 minor units with currency | TRD-05 §2.1 vs TRD-03 | Import contract is the Phase A file format; map `*_cents` → `*_minor` on load, currency from market. API JSON always `_minor` |
| C-12 | API-01 `period_from`/`period_to` as `YYYY-MM` vs `import_batch.period_from date` | SDD-06, spec.json | Accept `YYYY-MM`; store first day of month (`period_to` = last day or first day of month — pick and document) |
| C-13 | Same capability, two names: `ledger:export` (TRD-05 key scope) vs `ledger.export` (API-24 permission) | TRD-05, SDD-06 | Not a contradiction: colon = key scope, dot = user permission. Keep both |
| C-14 | Adapter `status()` enum (`pending, accepted, settled, returned, failed`) vs `payout_instruction.state` (+ `instructed`, `cancelled`) vs outbox states (Pending/Sent/Confirmed/Unknown/Rejected/Dead) | TRD-05, spec.json | Three separate machines; mapping in §6.3. Outbox state ≠ instruction state |
| C-15 | API-11 lists subscription events but FR-ORD-006 is V1; TRD-05 commerce subscription events V1 | spec.json, TRD-05 | Accept only refund/return/exchange/chargeback in B; subscription event types return `422` (code unnamed) until V1 |
| C-16 | API-06 needs permission `export`; API-32 uses `export.full` | SDD-06 | Treat `export` as a distinct permission (drill-down export) unless the permission catalogue says otherwise; confirm in SECURITY/permission catalogue |

---

## 9. Open / unresolved

| Item | Detail | Blocks |
|---|---|---|
| AQ-01 | Which payment/payout providers accept licensed direct-selling merchants in launch market — **launch blocker** (DA-10) | API-25, API-26, TR-INT-04/06, FR-PAY-002/004/006, BR-PAY-11, ADR-09, go-live checklist (TS-50) |
| OQ-10 | Provider capabilities: idempotency, status query, settlement formats, coverage | Real payout adapters, `parseSettlementReport`, `verifyWebhook`, TS-16 |
| OQ-15 | Which commerce platforms launch-market buyers use; Fluid-type third connector | TR-INT-03, FR-ORD-002, connector priority |
| OQ-30 | Forbidden-column detection by content without false rejections | API-01 async validation (`FORBIDDEN_COLUMN`), FR-IMP-001 |
| OQ-32 | Retention per data class and market | `inbound_event` retention beyond 35 days default, export retention |
| OQ-33 | Self-hosted supported-version policy (proposed current + previous minor) | API-41, FR-LIC-002 |
| OQ-17 | Split residency | Export destinations (API-32), support sessions across regions |
| Proposals unconfirmed | 12-month deprecation window (TR-API-02); 35-day key retention (TR-API-13); 72 h webhook retry, 1 min–6 h backoff (TR-API-15, TRD-05 §3); nightly reconciliation poll | API versioning policy, idempotency purge, webhook dispatcher, API-37 |
| Unspecified numbers | rate-limit tiers/bucket sizes; upload size limit (`FILE_TOO_LARGE`); order timestamp future tolerance (API-10); webhook signature timestamp tolerance (API-26/33); step-up freshness window (API-20/25/27); cooling-off duration (market/tenant setting); fraud fingerprint threshold (API-27); export row cap (TS-56); dead-letter max attempts | API-01, 10, 20, 25, 26, 27, 33, 06/32 |
| Unnamed contracts | exact sub-resource paths for API-07, API-28 (rank status, customers, notifications), API-41; error code for in-flight idempotent request (409 + Retry-After); webhook header names; `errors[]` pointer key; `type` URI scheme; error code for missing `If-Match` (412 vs 428); error code when subscription events arrive before V1 | OpenAPI 3.1 first draft |
| API-key scopes | Only `orders:write`, `participants:write`, `ledger:export` named; scopes for API-05 (`compliance.read` by key), API-32, API-35 key access not named | API-05, API-24, API-32, API-35 integration use |
| Payload schemas | Request/response bodies for 30 catalogue endpoints are not specified beyond purpose (only 11 detailed specs exist) | All non-detailed endpoints — design in OpenAPI, trace to FR `in`/`out` fields in spec.json requirements |
| Tax formats | Year-end form file formats per market need a tax adviser | API-36 (B-MKT), FR-TAX-003 |
| OQ-34 | Settled payouts contra account (`settled_clearing`) | API-26 ledger entry 3, API-23 balances |
| Q-2 / Q-9 (DEC-03) | Whether calculate-and-instruct needs a licence; who contracts with payout provider | Payout adapter model |
