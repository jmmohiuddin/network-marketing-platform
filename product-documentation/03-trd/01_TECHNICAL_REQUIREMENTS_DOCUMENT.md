# 01 — TECHNICAL REQUIREMENTS DOCUMENT
## The technical capabilities the system must provide and the constraints it must satisfy

| Field | Value |
|---|---|
| Document ID | TRD-01 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | CTO role |
| Depends on | PRD-01..07; gap audit 08–10, 15, 16, 28, 29 |
| Companion documents | TRD-02 stack evaluation · TRD-03 API requirements · TRD-04 security requirements · TRD-05 integration requirements |
| Status | Draft. The TRD states **what** is required; **how** is in the system design (SDD-01..11) |

Requirement IDs here are `TR-<area>-nn`. Each traces to functional requirements or rules.

## 1. Technical overview

| Item | Requirement |
|---|---|
| System objectives | (1) Deterministic, reproducible compensation calculation; (2) provable money through a double-entry obligations ledger; (3) history that is never overwritten; (4) tenant isolation enforced in the data layer; (5) every external effect delivered safely once; (6) compliance figures reproducible from stored inputs |
| Technical scope | Multi-tenant web service with public API, staff web application, distributor portal, vendor console, calculation workers, connectors and provider adapters. No native mobile app, storefront, or funds-holding component |
| Platform | Hosted software as a service in regional deployments; tenants choose a data region |
| Environments | Local, CI, development, staging, production per region (TR-DEP) |
| Supported devices | Staff: desktop and laptop, minimum viewport 1024 px; tablet usable for read and approve. Distributors: phones from 360 px wide, low-end Android included; tablet and desktop responsive |
| Supported browsers | Last two major versions of Chrome, Edge, Safari and Firefox; Android Chrome and iOS Safari current and previous major; Samsung Internet current. Distributor statement core must render with scripts disabled (**proposal**, to validate against actual devices of the launch market) |
| Constraints | See §2 |

## 2. Technical constraints

| ID | Constraint | Source |
|---|---|---|
| TR-CON-01 | The platform never holds, moves or stores participant funds or card data | A-02; SEC-13 |
| TR-CON-02 | No tenant-specific code; differences are configuration, expressions or shared modules | BR-PLN-05 |
| TR-CON-03 | One deployable application plus a calculation worker pool at MVP; no distributed event bus | Gap audit 15 §4, §6; ADR-01 |
| TR-CON-04 | One relational database as system of record; ledger postings and run commits are single-database transactions | Gap audit 15 §6 |
| TR-CON-05 | Tenant routing layer from the first release so a tenant can be placed in a dedicated database or region | ADR-02 |
| TR-CON-06 | No binary floating point for money | BR-MNY-01 |
| TR-CON-07 | No ad-hoc reporting queries on the primary database | ADR-11 |
| TR-CON-08 | Legal values (rates, thresholds, windows) are never compiled into the application; they live in market packs with basis status | BR-CPL-03 |
| TR-CON-09 | Engine versions that produced committed runs stay executable for the retention period | NFR-MAIN-03 |
| TR-CON-11 | **Two editions, one codebase** (DEC-17): everything must run as a hosted multi-tenant cell **and** as a single-tenant self-hosted installation. Therefore: no dependency on a cloud-specific database, queue or identity service in the core; all external services reached through standard protocols (PostgreSQL, S3 API, OIDC, SMTP, OpenTelemetry); configuration by environment; no feature that requires a call to the vendor to function | DEC-17; BR-LIC-02 |
| TR-CON-10 | Small team: prefer managed services and few moving parts (assumption DA-07) | FD-03 unknown |

## 3. Data requirements

| ID | Topic | Requirement |
|---|---|---|
| TR-DAT-01 | Entities | As listed in SDD-04; every entity has one owner module |
| TR-DAT-02 | Ownership | The tenant owns its data; the platform is processor. Market packs and guardrail rules are platform data |
| TR-DAT-03 | Lifecycle | Facts (orders, order events, result lines, postings, relationships, audit events) are created once and never changed. State is expressed by new rows (status history, versions, superseding rows) |
| TR-DAT-04 | Retention | Per data class and market (market pack); committed run snapshots, ledger, tax lines and audit kept for the legal retention period; idempotency records for a setting (proposed 35 days); simulation results for a setting |
| TR-DAT-05 | Validation | At the boundary (API schema), in the domain (rules), and in the database (constraints listed in SDD-04 §6) |
| TR-DAT-06 | Integrity | Invariants of NFR-INT-01..06 enforced by database constraints where possible and by engine invariants checked before commit |
| TR-DAT-07 | Isolation | `tenant_id` on every tenant-scoped row; row-level security; tenant id from session only; automated isolation tests for every endpoint |
| TR-DAT-08 | Migration in | History import with validation and opening entries (FR-MIG-001) |
| TR-DAT-09 | Export | Complete, documented, versioned export in open formats (CSV and Parquet) with manifest and checksums (FR-INT-003) |
| TR-DAT-10 | Deletion | Erasure by pseudonymisation where retention applies; hard deletion of sensitive documents by key destruction; tenant deletion after archive retention |
| TR-DAT-11 | Backup | Continuous log archiving and daily snapshots per region; backups encrypted, in region; restore drills quarterly (NFR-DR) |
| TR-DAT-12 | Sensitive data | Tax ids, identity documents and bank details encrypted with per-tenant keys in a separate store; masked display; access logged |
| TR-DAT-13 | Overlay minimisation | Overlay imports hold pseudonymous ids only; forbidden columns rejected |

## 4. Compensation engine technical requirements

The engine must support complex calculations **without losing financial consistency**. The mechanism is: frozen inputs, pure calculation, invariants before commit, and a single transaction that commits results, state and the ledger entry together.

| ID | Topic | Requirement | Traces |
|---|---|---|---|
| TR-ENG-01 | Plan configuration | Plans are data: versioned rule documents built from a typed primitive catalogue, validated against a schema; a dependency graph orders rules | FR-PLN-001, -002 |
| TR-ENG-02 | Extension | Typed pure expression language with bounded evaluation and no I/O; platform modules behind a stable interface, versioned and parameterised; every extension recorded in traces | FR-PLN-003 |
| TR-ENG-03 | Versioned rules and effective dates | A version is immutable from approval; effective dates fall on period boundaries of every calendar the plan uses; a run resolves exactly one version by effective date | BR-CMP-01 |
| TR-ENG-04 | Period model | Calendars, cut-off time zones, state machine, late-transaction handling | FR-COMP-001 |
| TR-ENG-05 | Snapshot | Each run records an input snapshot: order watermark, genealogy known-at instant, prior state run, plan version, settings version, market-pack version, engine version, input hash | FR-COMP-002 |
| TR-ENG-06 | Commission calculation | Fixed pass order (SDD-07 §4); high-precision decimals until the rounding pass; integer minor units after | FR-COMP-003, -012 |
| TR-ENG-07 | Qualification periods and rank | Period-end, rolling and per-order windows; several ladders; paid-as and title; maintenance and grace; state as run output | FR-COMP-004 |
| TR-ENG-08 | Bonus calculations | Catalogue of payout functions with declared tree, measure and reversal policy per bonus | FR-PLN-002 |
| TR-ENG-09 | Reproducibility | Same snapshot, plan, settings and engine version give byte-identical ordered lines; iteration order is defined everywhere; no wall-clock, random or locale dependence | FR-COMP-008 |
| TR-ENG-10 | Auditability | Compact trace per line; full trace by replay; run review dataset; who prepared and approved | FR-COMP-005, -007 |
| TR-ENG-11 | Reversals | Order-line clawback and restatement as selectable policies per bonus; both produce adjustment lines, never edits | FR-FIN-003 |
| TR-ENG-12 | Adjustments | Late transactions, manual adjustments and restatements enter the open run with once-only origin keys | FR-COMP-010 |
| TR-ENG-13 | Simulation | Same code path with a flag; isolated result storage; comparison against a baseline run | FR-PLN-005 |
| TR-ENG-14 | Reconciliation | Control totals at each stage: orders → volume → gross lines → caps → net lines → ledger entry → payout instructions → settlements; variance against previous run | FR-COMP-005, FR-PAY-004 |
| TR-ENG-15 | Recalculation | A Calculated run is disposable and re-runnable; a Committed run is changed only by restatement | FR-COMP-009 |
| TR-ENG-16 | Invariants before commit | Lines sum to run total; every allocation sums to its total; no cap exceeded; no payout to a position terminated before the period unless the plan says so; matching never pays on a reversed bonus; gross = net + withholding per payee | QA property tests |
| TR-ENG-17 | Execution | Runs on a worker pool, resumable, with progress; per-tenant concurrency limits; advisory lock per tenant, calendar, period | NFR-SCAL-02 |
| TR-ENG-18 | Engine versioning | The engine is versioned; each run pins its version; releases pass golden, replay and differential tests | NFR-MAIN-02, -03 |

## 5. Genealogy technical requirements

| ID | Topic | Requirement |
|---|---|---|
| TR-GEN-01 | Sponsor hierarchy | Relationship kind `sponsor` between positions, bitemporal, append-only |
| TR-GEN-02 | Placement hierarchy | Relationship kind `placement` with optional leg; independent of sponsor |
| TR-GEN-03 | Traversal | Calculation: in-memory arrays built once per run; one bottom-up pass for group volumes; upline walks by parent index. Interactive: materialised path read model |
| TR-GEN-04 | Relationship history | Valid time and recorded time; query "as of D, as known at T" |
| TR-GEN-05 | Placement validation | No cycles; one parent per kind at any valid time; width limits for matrix or binary; serialised placement per leg |
| TR-GEN-06 | Tree search | By id, name (staff), rank; subtree counts; depth and breadth limits per request |
| TR-GEN-07 | Large-tree performance | Targets NFR-PERF-05, -07, -08; benchmark of gap audit 08 §6 before architecture sign-off |
| TR-GEN-08 | Organisational reporting | Aggregates by subtree from committed runs' volume summaries, not live recursion |
| TR-GEN-09 | Visibility | Field-by-depth policy enforced on the server from the read model, falling back to the system of record when stale |

## 6. Financial technical requirements

| ID | Topic | Requirement |
|---|---|---|
| TR-FIN-01 | Transaction integrity | Each financial event is one database transaction containing the state change, the balanced journal entry and the outbox rows |
| TR-FIN-02 | Ledger behaviour | Append-only postings; balances derived; idempotency key per entry; entry rejected unless balanced |
| TR-FIN-03 | Auditability | Each entry carries origin (run, batch, case), approver and time; chain from statement line to posting to instruction to settlement |
| TR-FIN-04 | Payout processing | Batch state machine; preparer and approver; instructions via outbox; ambiguous outcomes resolved by status query before any re-send |
| TR-FIN-05 | Refund handling | Order events → reversal policy → clawback receivable → netting → write-off with approval |
| TR-FIN-06 | Reconciliation | Daily and per-period reconciliation of instructions against provider reports; ledger projection verified against postings nightly |
| TR-FIN-07 | Currency | One currency per market in MVP-B; amounts carry currency; rate table designed, used from V1; conversion at one defined step |
| TR-FIN-08 | Provider integration | Adapter interface; tenant-owned credentials; at least two payout routes per launch market, one of which may be a bank file |
| TR-FIN-09 | Approval workflows | Step-up authentication; approver ≠ preparer enforced in service and database; thresholds from settings |
| TR-FIN-10 | Tax | Withholding pass after gross and before instruction; rules from market pack by pay date; tax lines stored; liability account per market |
| TR-FIN-11 | Vocabulary | No table, field, API or label uses "wallet"; balances are "earnings balance owed by [tenant]" |

## 7. Performance requirements

Confirmed requirements and proposed service-level objectives are separated in PRD-03 §2. Summary of what is **confirmed** versus **proposed**:

| Area | Confirmed requirement | Proposed objective |
|---|---|---|
| API response | — | NFR-PERF-01, -02 |
| Database queries | No recursive query per node in runs; no reporting on primary | Any interactive query ≤ 200 ms at p95 with indexes of SDD-04 |
| Genealogy traversal | In-memory per run | NFR-PERF-05, -07, -08 |
| Dashboard loading | Figures reconcile with sources | NFR-PERF-09 |
| Commission batch | Resumable, isolated per tenant | NFR-PERF-04, -05 |
| Background jobs | At-least-once with idempotent handlers | NFR-PERF-12 |
| Concurrent users | Stateless web tier | NFR-PERF-13 |
| Data export | Snapshot-consistent, from replica | NFR-PERF-11 |

## 8. Deployment and infrastructure requirements

| ID | Topic | Requirement |
|---|---|---|
| TR-DEP-01 | Development | Reproducible local environment with containers; seeded synthetic data; no production data |
| TR-DEP-02 | Staging | Production-like per region; synthetic and anonymised data only; provider sandboxes |
| TR-DEP-03 | Production | Per-region stack ("cell"): web, workers, primary database with replica, cache, object storage, secrets, identity provider; no cross-region tenant data flows |
| TR-DEP-04 | CI/CD | Every change: lint, static checks (floats, tenant branches), unit, golden, replay sample, isolation suite, migration check; signed build artefacts; staged rollout |
| TR-DEP-05 | Environment configuration | Twelve-factor configuration; no secrets in code or images |
| TR-DEP-06 | Secrets | Managed secrets store; tenant provider credentials and signing keys per tenant; rotation |
| TR-DEP-07 | Monitoring and logging | Metrics, traces and structured logs with tenant and correlation ids; no personal data in logs |
| TR-DEP-08 | Backup and recovery | NFR-DR-01..04 |
| TR-DEP-09 | Rollback | Application rollback by redeploying the previous artefact; database migrations backward-compatible for one release (expand, then contract); engine version pinning makes calculation rollback unnecessary |
| TR-DEP-10 | Scaling | Horizontal web tier; worker pool sized per region with per-tenant limits; database vertical first, dedicated database for large tenants |
| TR-DEP-11 | Feature flags | Per tenant; new engine behaviours behind flags and golden tests |
| TR-DEP-12 | Maintenance windows | Never across a tenant's cut-off or pay day |
| TR-DEP-13 | Self-hosted packaging (V1) | Versioned container images and a reference deployment (Compose for small installations, Helm chart for Kubernetes); published minimum infrastructure; preflight check; signed release, engine and market-pack packages verifiable offline; documented backup, restore and upgrade procedures; supported-version policy |
| TR-DEP-14 | Self-hosted updates | An engine update activates only after the installation's golden datasets and a replay sample pass; automatic rollback on failed migration; committed runs keep their pinned engine version |
| TR-DEP-15 | Telemetry from self-hosted installations | Off by default; if the licensee enables it, operational metrics only, never tenant business or personal data |
