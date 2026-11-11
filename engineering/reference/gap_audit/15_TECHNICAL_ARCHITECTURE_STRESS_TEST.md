# 15 — TECHNICAL ARCHITECTURE STRESS TEST
## No architecture exists; this is the stress test the first one must pass

| Field | Value |
|---|---|
| Document ID | GAP-15 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 9 |
| Gaps | GAP-060 to GAP-062 |
| Rule | Workload figures are **assumptions**, labelled; they size a benchmark, they are not data. No recommendation is made for microservices because the product is large |

## 1. GAP-060 — No architecture or workload model

| Field | Content |
|---|---|
| **Category** | Technical |
| **Previous research coverage** | Master Plan R-24..R-28 (not started); 13 §7.3 declarative vs plugin (inference) |
| **Missing element** | Workload model, module boundaries, tenancy, run execution, reporting, DR and deployment decisions |
| **Evidence** | Engine properties required by 09 (determinism, snapshots, multi-pass); incumbents claim 99.99% uptime and "millions of orders in real time" (G-S31, Grade C) — the bar buyers will compare against |
| **Why it matters** | The engine and ledger are the hard parts; an architecture that treats them as CRUD will fail at the first period close |
| **Affected stakeholders** | Engineering, operations, tenants |
| **Product implications** | Period close becomes an operated process with status, not a button |
| **Technical implications** | §2–§6 |
| **Recommended solution** | Modular monolith with an isolated calculation worker pool, one relational database (Postgres-class) as system of record, append-only ledger and relationship tables, a read replica for reporting; regional deployment "cells" when residency requires |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | Medium (reasoned; benchmark pending) |
| **Documentation changes required** | Future 34–44 (stack, architecture, database, API, infrastructure) |

## 2. Workload model (assumptions to replace with data)

| Parameter | Mid-market tenant | Large tenant | Basis |
|---|---|---|---|
| Positions | 50,000 | 2,000,000 | **Assumption.** Large figure is in the range of public companies' participant counts (Herbalife 6.4M members, S-121; Nu Skin ~130k paid affiliates, S-122) |
| Orders per month | 100,000 | 3,000,000 | **Assumption** |
| Share of orders in the last 3 days of a monthly period | 30% | 30% | **Assumption** (period-end buying to qualify is a recognised pattern, GAP-005) |
| Payout lines per run | 30,000 | 600,000 | **Assumption** |
| Runs per month | 1 monthly + 4 weekly | same | Mixed cadences exist (G-S25, G-S28) |
| Distributors viewing statements on pay day | 20% | 20% | **Assumption** |

**Derived (arithmetic on the assumptions):** large tenant, period end ≈ 900,000 orders in 3 days ≈ 3.5 orders/second average, with peaks several times higher; trace storage at ~1 KB per payout line ≈ 600 MB per monthly run; ledger ≈ 2–4 postings per payout line ≈ 1.2–2.4M postings per run. None of these is large for a single well-run relational database; the risks are **concurrency at period end, run duration, and noisy neighbours**, not raw volume.

## 3. Bottlenecks to design for

| # | Bottleneck | Why | Mitigation |
|---|---|---|---|
| B1 | Period-end order surge plus late orders | Qualification buying at period end | Ingestion queue with idempotent upserts; period cut-off by defined event time and time zone (GAP-023); late-order queue |
| B2 | Run duration and memory on deep trees | Recursive SQL per node | In-memory tree per run, single bottom-up pass (08 §5); runs on worker pool, not web servers |
| B3 | Re-runs during review | Analysts iterate before commit | Calculated state is disposable until commit; inputs snapshotted once |
| B4 | Concurrent runs for the same tenant and period | Two analysts press "run" | Advisory lock per (tenant, calendar, period); idempotent run requests |
| B5 | Binary placement races | Simultaneous enrolments | Serialised placement per target leg (08 S6) |
| B6 | Reporting on the primary database | Owners and analysts run heavy queries; buyers expect SQL access (Exigo "full SQL access", DirectScale "client SQL reports"; G-S30, G-S31) | Read replica or per-tenant analytical export; never ad-hoc SQL on the primary (GAP-062) |
| B7 | Noisy neighbours in pooled tenancy | A large tenant's run starves others | Worker pools with per-tenant concurrency limits; large tenants on dedicated workers |
| B8 | Genealogy read-model rebuild after big moves | Path rewrites for a large subtree | Asynchronous rebuild; views marked stale until done |
| B9 | Payout provider latency and failures | External dependency | Outbox pattern; retries with idempotency keys; reconciliation (10 GAP-035) |
| B10 | Data residency | India, Vietnam requirements (51 CMP-08); Malaysia transfer rules (G-S14) | Regional cells (GAP-061) |

## 4. Modularise, centralise, separate later

| Module (inside one deployable) | Owns | Centralised concerns |
|---|---|---|
| Identity & access | Users, roles, sessions, vendor-staff access | One auth service in the monolith |
| Participants & genealogy | Participants, positions, effective-dated relationships, change events | Audit log |
| Orders & attribution | Ingested orders, returns, subscriptions events, attribution | Idempotent ingestion |
| Plans | Plan versions, rules, simulations | Rule validation |
| Calculation | Runs, snapshots, results, traces | Worker pool |
| Ledger & payouts | Journal, postings, batches, provider adapters, tax | Double-entry invariants |
| Compliance & reporting | Reports, disclosures, flags, exports | Read replica |
| Integration | Connectors (commerce, providers), webhooks, API | API gateway, rate limits |

**Separate into services only when** (a) calculation workers need independent scaling or a different runtime; (b) a regional cell must hold one tenant's data; (c) a module's change cadence blocks others. None is expected before several paying tenants.

## 5. Tenancy options

| Option | Isolation | Cost | Customisation | Residency | Fit |
|---|---|---|---|---|---|
| Shared schema with tenant id and row-level security | Logical; one bug can leak | Lowest | Configuration only | Hard | MVP for small tenants, **with automated cross-tenant tests** (GAP-065) |
| Schema per tenant | Stronger | Medium | Same | Medium | Possible middle ground |
| Database per tenant | Strong | Higher | Same | Easy (place DB in region) | Large tenants and residency markets |
| Regional cell (stack per region) | Strong | Highest | Same | **Required** for in-country storage | India (if Rule 5(5) confirmed), Vietnam |

**Recommendation:** design for **database-per-tenant capability** from day one (tenant routing layer), start pooled where allowed, move large or residency-bound tenants to dedicated databases or cells. **Tenant-specific code is not allowed**; tenant differences live in plan configuration and the controlled extension point (13 §7.3).

## 6. Cross-cutting decisions the first architecture must record

| Concern | Minimum decision |
|---|---|
| Transactions | Ledger postings and run commits are single-database transactions; external calls via outbox |
| Events | Domain events inside the monolith (order ingested, run committed, payout settled); not a distributed event bus at MVP |
| Caching | Read-through for plan versions and rank states of committed periods only (immutable) |
| Search | Database full-text plus path read model; dedicated search engine only if needed |
| API | Versioned public API (`/v1`), idempotency keys on writes, webhooks with signatures and retries, per-key rate limits |
| Mobile | Same API; statement endpoints cacheable after commit |
| DR and backups | RPO/RTO set by the founder; **restore tests on a schedule**; ledger and relationship tables are append-only, which simplifies point-in-time recovery |
| Observability | Run metrics (duration, lines, variance), ingestion lag, payout failure rates, per-tenant dashboards |
| Deployment and flags | Feature flags per tenant for new engine behaviours; plan engine changes gated by golden-dataset tests (30) |
| Configuration | Tenant settings versioned and audited like plan versions |

## 7. GAP-061 — Data residency and regional deployment

| Field | Content |
|---|---|
| **Category** | Technical, compliance |
| **Previous research coverage** | CMP-08, BR-DAT-01, counsel question Q-5 |
| **Missing element** | Architecture response and timing |
| **Evidence** | India Rule 5(5) as reported (S-039); Vietnam in-country server (S-048); India DPDP cross-border rules from May 2027 (G-S10); Malaysia removed its transfer whitelist (G-S14) |
| **Why it matters** | Retro-fitting residency into a single-region pooled design is expensive |
| **Affected stakeholders** | Tenants in India and Vietnam, DPO |
| **Product implications** | Tenant setting "data region"; genealogy across regions needs care (08 S10) |
| **Technical implications** | Tenant routing; per-region backups; support access constrained by region |
| **Recommended solution** | Confirm India's requirement with counsel (Q-5) before choosing the launch market; build tenant routing in MVP regardless |
| **Priority** | High |
| **Implementation stage** | MVP if India launches first |
| **Confidence** | Medium |
| **Documentation changes required** | 51 CMP-08, future infrastructure document |

## 8. GAP-062 — Buyers expect SQL-level reporting access

| Field | Content |
|---|---|
| **Category** | Technical, commercial |
| **Previous research coverage** | P-17 (reporting access, unrated) |
| **Missing element** | The expectation itself |
| **Evidence** | Exigo: "full SQL access" (G-S31); DirectScale: client SQL reports (G-S30); posting skills include SQL (S-130) |
| **Why it matters** | Analysts will not adopt a platform that hides their data |
| **Affected stakeholders** | Analysts, Finance |
| **Product implications** | Read-only analytical access to the tenant's own data |
| **Technical implications** | Per-tenant replica schema or scheduled export to the tenant's warehouse; never shared-schema SQL access |
| **Recommended solution** | MVP: scheduled export and a documented data model; V1: read-only replica access for dedicated tenants |
| **Priority** | Medium |
| **Implementation stage** | MVP |
| **Confidence** | Medium |
| **Documentation changes required** | Future reporting and data-architecture documents |
