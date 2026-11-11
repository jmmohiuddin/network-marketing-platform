# ARCHITECTURE — implementation brief

Domain: architecture (module boundaries, ADRs, process/deployment shapes, outbox/queues, read models/replica, NFR targets, TR-* constraints).
Sources (paths relative to `product-documentation/`): SDD-01 `04-system-design/01_SYSTEM_DESIGN_DOCUMENT.md` · SDD-02 `04-system-design/02_HIGH_LEVEL_ARCHITECTURE.md` · SDD-03 `04-system-design/03_MODULE_DESIGN.md` · SDD-11 `04-system-design/11_DEPLOYMENT_ARCHITECTURE.md` · TRD-01 `03-trd/01_TECHNICAL_REQUIREMENTS_DOCUMENT.md` · PD-03 `01-product-definition/03_PRODUCT_MODULE_ARCHITECTURE.md` · PRD-03 `02-prd/03_NON_FUNCTIONAL_REQUIREMENTS.md`. Cross-checked against `09-governance/02_DECISION_LOG.md` (ADR-17..21, DEC-*), `09-governance/03_OPEN_QUESTIONS.md`, `04-system-design/04_DATABASE_DESIGN.md` (outbox/export tables), `03-trd/05_*` §3 (dispatch retry), and `traceability-data/spec.json`.

All source documents are v0.1 drafts dated 2026-11-12. No benchmark has been run; anything marked *spike* must be proven in Phase C (TS-29, OQ-05).

Release tags: **A** = MVP-A (compliance overlay) · **B** = MVP-B (engine + ledger + payouts) · **B-MKT** = MVP-B market-pack dependent · **V1** · **V2**. "A+" means "from A, continues in all later releases".

---

## 1. Architecture decision summary (what to build)

| Decision | Value | Release | Source |
|---|---|---|---|
| Style | **Modular monolith** + separate **calculation worker pool**. One deployable artefact, multiple process entry points | A+ | ADR-01, TR-CON-03 |
| Process types | `web/api`, `general worker` (queues `ingest`, `dispatch`, `rebuild`, `export`, `schedule`), `calc worker` (queue `calc`, engine package) — same image | A+ (calc worker B) | SDD-02 §3, SDD-11 §4 |
| System of record | **PostgreSQL 16+** (with `ltree`), one per database target; also holds job queue and outbox | A+ | ADR-17, TR-CON-04 |
| Event transport | Domain events written to **outbox table in the same transaction**; consumed by workers. **No distributed bus** at MVP | A+ | ADR-10, ADR-20, TR-CON-03 |
| Tenancy | **Regional cells**; inside a cell a tenant-routing layer supporting **pooled** and **dedicated** databases; **RLS on every tenant-scoped table** in both | A+ (routing from first release) | ADR-02, TR-CON-05 |
| Schema-per-tenant | **Not used** | — | SDD-01 §3.2 |
| Reporting | Read replica or export; **never ad-hoc SQL on primary** | B (internal replica for dashboards/exports); tenant replica access V1 | ADR-11, TR-CON-07, FR-INT-004 (V1) |
| Cache | Redis: rate limits + immutable/versioned data only | A+ | SDD-01 §6 |
| Identity | Self-hosted **OIDC** IdP per cell, realms `staff`, `portal`, `vendor` | A+ (portal realm B) | ADR-19 |
| Language | TypeScript end to end; Node.js API; engine as isolated portable package | Proposed (OQ-18) | ADR-18, SDD-02 §3 |
| Kubernetes | **Not at MVP** (managed containers). Helm chart only for self-hosted package | V1 (Helm) | SDD-02 §5, SDD-11 §8–9 |
| Editions | Hosted multi-tenant cell **and** self-hosted single-tenant cell from **one codebase / one image** | Self-hosted V1 | DEC-17, ADR-16, TR-CON-11 |
| Mobile | No native app; portal is responsive installable web app | — | DEC-12, SDD-02 §3 |

### 1.1 Triggers to split something out of the monolith (SDD-01 §1)
Only when one of these is measured: (a) calc workers need a different runtime or scaling beyond the worker pool; (b) a regional cell must hold one tenant's data; (c) one module's release cadence blocks the others. None expected before several paying tenants. Hybrid = evolution path, not MVP.

### 1.2 Scale assumption driving the design
- Large tenant: 2,000,000 positions, 3,000,000 orders/month → ~600 MB result lines and 1.2–2.4M postings per monthly run. Fits one PostgreSQL instance.
- Risks addressed: period-end concurrency (ingestion queue), run duration (in-memory runs on isolated workers), noisy neighbours (per-tenant limits). Not addressed by distribution.
- Workload basis (PRD-03 §1, assumed): mid-market 50,000 positions / 100,000 orders/month / 30,000 payout lines per run; large 2,000,000 / 3,000,000 / 600,000; 30% of orders in last 3 days of a monthly period; 20% of payees view statements on pay day.

---

## 2. Architecture Decision Records

SDD-01 §7 lists ADR-01..16; the decision log adds ADR-17..21. All are Provisional or Proposed (none Decided).

| ADR | Decision | Status | Key consequence for code | Release |
|---|---|---|---|---|
| ADR-01 | Modular monolith with separate calc worker pool | Provisional | One deployable; single-DB transactions; split only on §1.1 triggers | A+ |
| ADR-02 | Regional cells; routing supports pooled + dedicated DBs; RLS everywhere | Provisional | Routing layer and RLS from first release | A+ |
| ADR-03 | Bitemporal, append-only genealogy; positions separate from participants | Provisional | `relationship` model, valid time + recorded time | B |
| ADR-04 | In-memory tree per run; materialised-path read model (`path_node`, `ltree`) for interactive use | Provisional (**spike**) | O(N) runs; read model derived, may be stale; never authoritative | B |
| ADR-05 | Declarative primitives + controlled extension point (expressions; platform modules); no tenant code | Provisional | Coverage target open (OQ-12) | B |
| ADR-06 | Money in minor units; round once per line; largest-remainder allocation; residue to named account | Provisional | BR-MNY; static no-float check | B |
| ADR-07 | Double-entry obligations sub-ledger + GL export; no general ledger | Provisional | SDD-09 | B |
| ADR-08 | Integrate commerce via idempotent ingestion API + connectors | Provisional | No storefront | B |
| ADR-09 | Provider-adapter interface; ≥2 payout routes per launch market; tenant-owned accounts | Provisional | Launch blocker until providers confirm in writing | B / B-MKT |
| ADR-10 | Transactional outbox for all external effects; idempotency keys everywhere | Provisional | At-least-once delivery, at-most-once effect | A+ |
| ADR-11 | Reporting on replica or export; never ad-hoc SQL on primary | Provisional | Export in B; replica (tenant access) V1 | B / V1 |
| ADR-12 | Vendor access only through tenant-approved, logged sessions | Provisional | FR-IAM-005 | A |
| ADR-13 | Erasure by pseudonymisation where ledger retention applies | Provisional (counsel) | — | B |
| ADR-14 | Brand and market dimensions in data model from first release | Provisional | Columns on plans, positions, orders | A+ |
| ADR-15 | Compliance fact layer (`cpl_fact_*`) shared by overlay (import) and engine (`RunCommitted`) | Proposed | One report engine for A and B | A (writer from imports), B (writer from runs) |
| ADR-16 | Both editions from one codebase; self-hosted = single-tenant cell; only standard self-hostable components in core | Proposed | TR-CON-11 | V1 |
| ADR-17 | PostgreSQL 16+ single system of record incl. job queue + outbox | Proposed | Transactional enqueue | A+ |
| ADR-18 | TypeScript end to end; engine isolated portable package | Proposed (OQ-18) | Engine reversible to another language | A+ |
| ADR-19 | Self-hosted OIDC IdP per cell, three realms | Proposed | Must be operated | A+ |
| ADR-20 | Domain events inside monolith via outbox; no bus at MVP | Provisional | Revisit on split triggers | A+ |
| ADR-21 | Run snapshots by reference to immutable/effective-dated sources + input hash | Proposed | Depends on DB-enforced immutability | B |

Related decisions: DEC-03 (never hold funds; no "wallet" — TR-FIN-11), DEC-06 (commerce integrated), DEC-12 (no native app), DEC-17 (two editions — **Decided (founder)**, details Proposed; the only Decided item here), DEC-18 (licence lapse never blocks pay; BR-LIC-01), DEC-21 (India first pack, cell `ap-south-1` with `ap-south-2` backup — Proposed).

---

## 3. Technical constraints (TR-CON) — hard rules for all code

TRD-01 assigns no release to TR-CON / TR-DEP items; the Release columns in §3 and §12.5 are this brief's inference from SDD-11, PD-03 §5 and spec.json, not source values.

| ID | Constraint | Enforcement | Release |
|---|---|---|---|
| TR-CON-01 | Platform never holds, moves or stores participant funds or card data | Design; no wallet tables/fields | A+ |
| TR-CON-02 | No tenant-specific code; differences are configuration, expressions or shared modules (BR-PLN-05) | Static check "no tenant-id branches" (NFR-MAIN-01, TS-67) | A+ |
| TR-CON-03 | One deployable + calc worker pool at MVP; no distributed event bus | Architecture | A+ |
| TR-CON-04 | One relational DB as system of record; ledger postings and run commits are single-database transactions | Architecture | A+ |
| TR-CON-05 | Tenant routing layer from first release (dedicated DB or region possible) | Architecture | A |
| TR-CON-06 | No binary floating point for money (BR-MNY-01) | Static check (NFR-INT-04, TS-67 — TS-67 rel B) | A+ (constraint); money paths arrive in B |
| TR-CON-07 | No ad-hoc reporting queries on primary DB (ADR-11) | Reporting routed to replica/export | A+ |
| TR-CON-08 | Legal values (rates, thresholds, windows) never compiled into app; live in market packs with basis status (BR-CPL-03, DEC-14) | Review; missing pack value blocks go-live, never guessed | A+ |
| TR-CON-09 | Engine versions that produced committed runs stay executable for retention period (NFR-MAIN-03) | Engine versions additive; pinned per run | B |
| TR-CON-10 | Small team: prefer managed services, few moving parts (DA-07) | — | A+ |
| TR-CON-11 | Two editions, one codebase (DEC-17): no cloud-specific DB/queue/identity in core; only standard protocols — **PostgreSQL, S3 API, OIDC, SMTP, OpenTelemetry**; configuration by environment; no feature requiring a vendor call to function (BR-LIC-02) | Architecture review | A+ (edition shipped V1) |

---

## 4. Module catalogue and boundaries

### 4.1 Rules for all modules (SDD-03 §1)
1. A module **owns its tables**. **No module writes another module's tables.**
2. Inter-module calls only via **in-process typed service facades** or by reacting to **domain events from the outbox**. No imports of another module's internals. **CI architecture test** enforces the dependency graph (§4.3) — NFR-MAIN-04.
3. A use case spanning modules runs in **one DB transaction opened by the initiating module**; others participate via their facades.
4. Every **external call** goes through **Integration (INT) adapters, from a worker, driven by the outbox**. Never from a web request.
5. Each module exposes: **commands** (state-changing), **queries** (read), **events** (published), and a **permission list**.

### 4.2 Module table (owner, data, interfaces, events, release)

Release per module from PD-03 §5: MVP-A = IAM (basic), TEN (tenant, region, market), IMP, CPL (R1–R5, snapshots, drill-down), AUD, OPS, vendor sessions. MVP-B = all modules below. V1 = LIC + items noted. Per-FR release tags in the Rel column come from spec.json (note FR-PRV-004 is A — Conflict C16).

| Module (code) | FR prefix | Data owned (tables; release from spec.json) | Facade interfaces | Events out | Components | Rel |
|---|---|---|---|---|---|---|
| Identity & access (IAM) | FR-IAM | `user_account` A, `role` A, `role_assignment` A, `api_key` B, `approval` A, `support_session` A (ENT-23) | `authorize(actor, permission, resource)`, `requireStepUp(actor)`, `recordApproval(object, preparer, approver)`, `openSupportSession(...)` | `SupportSessionRequested/Decided/Ended`, `RoleGranted`, `ApprovalRecorded` | AuthMiddleware, TenantResolver, PermissionCatalogue, PolicyService (RBAC+ABAC), ApprovalService, SupportSessionService, ApiKeyService | A (FR-IAM-001,-002,-003,-005); B (-004 SoD, -006 API keys, -007 distributor sign-in) |
| Tenant & market config (TEN) | FR-TEN | `tenant` A (ENT-01, not tenant-scoped), `market` A (ENT-02), `brand` B (ENT-02), `tenant_setting_version` A | `settingsAt(tenant, time)`, `marketPack(market, date)`, `isLive(market)` | `SettingsVersionCreated`, `MarketWentLive` | TenantDirectory, SettingsService (versioned, optimistic-locked), MarketService, MarketPackRegistry (loads **signed** packs: guardrails, tax rules, windows, languages, forms), LaunchChecklistService | A (-001); B (-002..-004); V1 (-005 archive/offboarding) |
| Data import (IMP) | FR-IMP | `import_batch`, `import_row_error`, `import_mapping` (all A) | `factsFor(tenant, market, range)` → batch ids in force | `ImportBatchLoaded`, `ImportBatchSuperseded` | UploadService, SchemaValidator (forbidden-column detector by name pattern + content sampling), MappingService, BatchLoader, DataQualityReporter | A (FR-IMP-001..003); V1 (FR-IMP-004 read-only DB connector) |
| Compliance & guardrails (CPL) | FR-CPL | `cpl_fact_participant` A, `cpl_fact_order` A, `cpl_fact_payout_line` A, `compliance_report_snapshot` A, `compliance_figure` A (ENT-21), `guardrail_rule` B (platform data, not tenant-scoped), `guardrail_decision` B (ENT-22), `integrity_signal` V1 | `evaluatePlan(planVersion, market) → decisions`, `createSnapshot(...)`, `figureRows(...)` | `SnapshotReady`, `GuardrailBlocked`. In: `ImportBatchLoaded`, `RunCommitted` | FactWriter, ReportEngine (pure functions over facts, method-versioned), SnapshotService, DrillDownQuery, GuardrailEvaluator, OverrideService | A (FR-CPL-001..006, R1–R5); B (-007, -008, -012: guardrails, facts from runs); B-MKT (-013 market-pack registers); V1 (-009 disclosure publishing, -010 signals, -011 claims feed) |
| Participants (PAR) | FR-PAR | `participant`, `participant_type`, `participant_type_assignment` (ENT-03), `agreement_acceptance` (all B) | `enrol(...)`, `typeAt(participant, time)` | `ParticipantEnrolled`, `ParticipantTypeChanged` | ParticipantService, TypeService, DuplicateMatcher | B; V1 (FR-PAR-004 account types, ownership transfer) |
| Genealogy (GEN) | FR-GEN | `position`, `position_ownership` (ENT-04), `relationship` (ENT-05), `path_node` (ENT-07) (all B) | `snapshotTree(tenant, kind, validAt, knownAt)`, `applyChange(case)`, `applyCorrection(case)`, `isInDownline(viewer, target)` | `PositionStatusChanged`, `GenealogyChanged` | PositionService, RelationshipStore (append-only, cycle check, tree lock), TreeQuery (as-of, known-at), VisibilityPolicy, PathReadModelBuilder | B |
| Attribution (CRM) | FR-CRM | `customer_servicing` (ENT-08, B) | `attribute(orderFacts)` | `CustomersReassigned` | ServicingService, AttributionResolver | B; V1 (FR-CRM-003 contacts, reminders) |
| Orders (ORD) | FR-ORD | `order` (`sales_order`) + `order_line` (ENT-09), `order_event` (ENT-10), `late_transaction`, `product_volume_map` (all B) | `snapshotOrders(period, watermark)`, `ingest(order)`, `ingestEvent(event)` | `OrderIngested`, `OrderEventIngested`, `LateTransactionQueued` | IngestionService, VolumeCalculator, PeriodAssigner (crediting event, calendar TZ), ReturnProcessor, LateTransactionQueue, ExceptionQueue | B; V1 (FR-ORD-006 subscription/dispute events) |
| Plans (PLN) | FR-PLN | `plan`, `plan_version`, `plan_rule` (ENT-11), `plan_transition`, `golden_dataset`, `simulation` (all B) | `versionFor(plan, time)`, `compiled(planVersion)` (immutable, cacheable) | `PlanVersionSubmitted/Approved/Activated` | PlanVersionService (state machine), RuleValidator, ExpressionCompiler, PlainLanguageRenderer, GoldenDatasetRunner, SimulationService, GovernanceWorkflow | B |
| Calculation (COMP / CAL) | FR-COMP | `calendar`, `period` (ENT-12), `run`, `run_snapshot` (ENT-13), `result_line` (ENT-14), `qualification_state` (ENT-15), `restatement` (all B) | `startRun(period, requestId)`, `commit(run, approver)`, `trace(line)`, `replay(run)`, `committedLines(payee, period)` | `PeriodCutOff`, `RunCalculated`, `RunCommitted`, `PeriodPaid`, `PeriodClosed` | PeriodService (state machine, scheduler), RunOrchestrator, SnapshotBuilder, **Engine** (pure package: loader ports, passes, invariants, trace writer), ReviewQuery, CommitService, ReplayService, RestatementService | B; V1 (FR-COMP-011 provisional runs with true-up) |
| Ledger (FIN / LED) | FR-FIN | `ledger_account`, `journal_entry`, `posting` (ENT-16) B; `credit_type` (ENT-20) V1; `fx_rate` V1 | `post(event)`, `balances(payee, asOf)` | `EntryPosted` | PostingRules (event → entry), JournalWriter, BalanceProjection, ClawbackService, GlExporter | B; V1 (FR-FIN-006 non-cash rewards, -007 multi-currency) |
| Payouts (PAY / PAYM / PO) | FR-PAY | `payout_batch`, `payout_instruction` (ENT-17), `provider_config`, `bank_detail_version` (ENT-19) (all B) | `prepareBatch(...)`, `approve(batch, approver)` | `PayoutBatchApproved`, `PayoutSettled/Returned/Failed`, `BankDetailChanged` | BatchService, InstructionSigner, Dispatcher, Reconciler, BankDetailService, HoldService | B |
| Tax (TAX) | FR-TAX | `tax_profile` (ENT-18), `tax_rule` (platform data, not tenant-scoped), `tax_line`, `tax_form` (all B) | `withholding(payee, gross, payDate)` | — | TaxProfileService, WithholdingCalculator, YearEndFormService | B (FR-TAX-001); B-MKT (-002 withholding rules, -003 year-end statements) |
| Cases (CAS) | FR-CAS | `case` (`case_file`), `case_event` (ENT-06, B) | — (case lifecycle) | `CaseOpened`, `CaseDecided` | CaseService, CaseTypeRegistry (policy checks + effect handlers per type), SlaTimer | B |
| Privacy (PRV) | FR-PRV | `privacy_request` (ENT-25, B) | — | `SubjectErased` | PrivacyRequestService, Pseudonymiser | **A (FR-PRV-004 breach-notification contacts and runbook data)**; B (-001, -002); V1 (-003 retention timers) |
| Audit (AUD) | FR-AUD | `audit_event` (ENT-24, A), `document` (A) | — | — | AuditWriter (outbox → audit store), ChainVerifier | A |
| Distributor portal API (DIST / DST) | FR-DIST | `statement`, `notification` (B) | Read API; writes delegate to PAY, TAX, CAS | — | StatementProjection (built on `RunCommitted`), ExplanationRenderer (templates per rule kind over compact trace), TeamQuery (uses VisibilityPolicy), NotificationService | B; B-MKT (FR-DIST-007 localisation/low-bandwidth); V1 (-009 leader dashboard) |
| Reporting (RPT) | FR-RPT | (read models) | — | — | DashboardReadModels | B |
| Integration (INT) | FR-INT | `outbox_event` **A**, `export_job` **A**, `inbound_event` B, `webhook_endpoint` B, `webhook_delivery` B | `enqueue(effect)` (called **inside caller's transaction**), `adapter(providerConfig)` | — | Public API surface, connectors, provider adapters, inbound events, outbox dispatcher, webhooks, sync health, exports | A (outbox, export_job); B (FR-INT-001..003); V1 (FR-INT-004 replica) |
| Migration (MIG) | FR-MIG | — | — | — | Staged history import, validation, opening entries, parallel-run comparison | B |
| Vendor operations (OPS) | FR-OPS | — | — | — | Vendor console (tenant list, provisioning, support requests, market packs) | A (FR-OPS-001) |
| Editions & licensing (LIC) | FR-LIC | `license_entitlement`, `update_log` (V1, not tenant-scoped) | `entitlement()`, `applyUpdate(package)` | — | Licence verification (offline signed file), update packages, diagnostics, support bundle | V1 (FR-LIC-001..003) |

Note: `AI` module (V1: FR-AI-001 run variance explainer, FR-AI-002 plan-document-to-configuration assistant, internal) appears in PD-03 §4 row 23 and spec.json; no module design in these sources.

### 4.3 Allowed dependency graph (SDD-03 §1 — CI-enforced)

Arrow `X → Y` = module X **may call** Y's facade. Everything may write audit events.

| Module | May call |
|---|---|
| AUD | — (leaf) |
| IAM | AUD |
| TEN | IAM |
| CAS | IAM |
| PAR | TEN |
| GEN | PAR, CAS |
| CRM | PAR |
| ORD | CRM, TEN, INT |
| PLN | TEN, CPL |
| CPL | TEN, IMP |
| TAX | TEN |
| CAL | ORD, GEN, PLN, TAX |
| LED | CAL *(see Conflict C1 — flows require CAL → LED)* |
| PAYM | LED, INT |
| IMP | TEN |
| DST | CAL, GEN, PAYM *(writes delegate to TAX and CAS too — Conflict C3)* |
| PRV | CAS |
| MIG | GEN, CAL, LED |
| RPT | CAL, CPL, LED |
| INT | IAM |
| LIC | AUD |
| OPS | not drawn (PD-03: depends on IAM) |

Non-negotiable boundary statements:
- **CPL never calls CAL.** Compliance reads calculation output only via `cpl_fact_*` written on `RunCommitted` and via events → no CAL↔CPL cycle (ADR-15).
- Engine package has **no I/O** except its input and output ports; never reads the clock (time is input); no wall-clock, random, or locale dependence (TR-ENG-09).
- External effects (payout instructions, webhooks, notifications, audit shipping, ERP export) only from workers via INT adapters, triggered by outbox rows.

### 4.4 Cross-module use case pattern (SDD-03 §3 — refund after payout, B)
1. Commerce → INT: refund webhook (event id) → `ORD.ingestEvent` (idempotent) → volume reversal per line.
2. Original period **open**: inputs changed; next run includes it.
3. Original period **committed**: `late_transaction` queued (handling by bonus policy) → adjustment origin for open run → CAL produces order-line clawback lines or restatement sandbox diff → on commit LED posts `Dr clawback receivable / Cr commission expense`, then netting → statement shows clawback as a separate line.

---

## 5. Runtime topology

### 5.1 Container view (one cell)

| Component | Responsibility | Technology (provisional) | Scales by | Release |
|---|---|---|---|---|
| Staff web app | Role-specific admin UI | React, TypeScript, server-rendered shell | CDN; stateless | A |
| Distributor portal | Statements, rank, team, customers, details; low bandwidth | Server-rendered React, small bundles, installable | CDN; stateless | B |
| Vendor console | Tenant ops without business data | Same codebase, **separate realm and hostname** | — | A |
| API entry point | Authentication, tenant resolution, schema validation, rate limits, idempotency; REST `/v1` | Node.js | Horizontal | A |
| Backend modules | Business logic; each owns its tables | In-process with API | With API processes | A+ |
| General workers | Ingestion, outbox dispatch, read-model rebuild, exports, schedules | Same artefact, worker entry point | Horizontal; autoscale on **queue age** | A |
| Calculation workers | Runs, simulations, replays | Same artefact, engine package; **memory-optimised instances**; separate task definition | Pool with per-tenant limits; dedicated pool for large tenants | B |
| PostgreSQL primary | System of record; queue; outbox | PostgreSQL 16+ (`ltree`), managed | Vertical; then dedicated DB per large tenant | A |
| Standby | Failover, other zone, synchronous or semi-synchronous | Managed | — | A |
| Read replica | Dashboards, reports, exports | Streaming replica | Add replicas | B (internal); V1 tenant access |
| Redis | Rate limits; immutable caches | Managed Redis | — | A |
| Object storage | Evidence, agreements, forms, run snapshot manifests, exports; versioned, encrypted | S3-compatible | — | A |
| Sensitive store | Identity documents, tax ids, bank-detail ciphertext keys | Separate bucket + **separate KMS key hierarchy**, per-tenant keys | — | B |
| Audit store | Append-only audit events; hash-chained per tenant (BR-SEC-07) | Separate DB (or schema) with **insert-only role**, separate credentials; archives to write-once storage | — | A |
| Identity provider | Authentication, MFA, federation with tenant SSO | Self-hosted OIDC, ×2 per cell (HA); realms `staff`, `portal`, `vendor` | — | A |
| Monitoring | Metrics, traces, logs, alerts | OpenTelemetry → regional backend | — | A |
| Product analytics | Staff-app usage events, **no personal data**, self-hosted | — | — | A |
| Egress proxy | Only outbound path; allow-list: providers, stores, mail | — | — | A (B for providers) |
| Global tenant directory | `slug → cell`; **no tenant business data** | — | — | A |

Clients: Staff web app, Distributor portal, Vendor console, API integrations (API keys, webhooks) → CDN + TLS → WAF + rate limiting → load balancer → API.

### 5.2 Network and zones (SDD-11 §4)
- Public subnets: load balancer only.
- Application subnets (≥2 availability zones): web/API tasks (autoscaled, stateless), general workers, calc workers, IdP ×2.
- Data subnets (**no internet route**): PostgreSQL primary (pooled DB), standby (other zone), read replica, dedicated tenant DBs, Redis, Audit DB.
- Outbound only via egress allow-list proxy. General workers reach external providers through it; web/API does not call externals.
- Connectivity: web → primary + dedicated DBs + Redis; general workers → primary + dedicated DBs; calc workers → primary + dedicated DBs; web, general and calc → object storage and secrets/KMS; web and general → sensitive store (calc workers do **not**).
- Backups: continuous WAL archive + daily snapshots, encrypted, **in region**.

### 5.3 Data stores access rules
- Primary: transactional writes and interactive reads (≤200 ms p95 target, TRD-01 §7).
- Replica: eventually consistent; only dashboards, exports, reports that **state their as-of time**.
- Redis: never balances or open-period figures; only plan versions, committed statements, published snapshots (immutable/versioned).

---

## 6. Multi-tenancy implementation

### 6.1 Request path (SDD-01 §3.2)
1. Hostname `{slug}.{cell-domain}` selects identity realm at sign-in. After sign-in the **token carries tenant id**. API keys bound to one tenant.
2. Resolve tenant **from token, never from client input** (TR-DAT-07).
3. Tenant directory lookup: `tenant → cell, database, tier`.
4. Wrong cell → **redirect** to tenant's cell hostname.
5. This cell → get connection from **the tenant's pool**.
6. `SET LOCAL app.tenant_id` at transaction start.
7. RLS policy filters every statement.

### 6.2 Isolation rules
| Rule | Detail |
|---|---|
| RLS | Policy on every tenant-scoped table (`tenant_id` NOT NULL); enabled in dedicated DBs too (identical code, defence in depth) |
| DB role | Application role **without `BYPASSRLS`** |
| Jobs | Every job carries tenant context; worker sets `app.tenant_id` |
| Namespacing | Storage keys, cache keys, logs prefixed by tenant |
| Secrets | Secrets manager path per tenant (provider credentials, signing keys); KMS keys per tenant for sensitive data |
| CI | Cross-tenant isolation suite **generated from OpenAPI**, covers 100% of endpoints, fails build if an endpoint is uncovered (SEC-28, NFR-SEC-01, TS-21 — rel A) |
| Migration check | New tables must have RLS policy (CI migration check) |
| Region | Writes, backups, exports in tenant region; out-of-region support session needs explicit region approval (TS-57, A). `export_job.destination` must be in tenant region |

### 6.3 Tenant-level variation (no code)
Configuration: `tenant_setting_version` (versioned, effective-dated); markets, brands, calendars, participant types. Permissions: tenant roles cloned from base roles; assignments scoped by market and brand. Branding: logo, name, primary colour token, sender identity only — no custom layouts or code. Business rules: plan versions, tenant settings, market packs per market. Integrations: `provider_config` per tenant and market; webhook endpoints per tenant. Feature flags: per tenant, evaluated **server-side** (TR-DEP-11: new engine behaviours behind flags and golden tests).

### 6.4 Placement and moves
| Item | Design | Release |
|---|---|---|
| Default | Pooled DB where allowed | A |
| Dedicated DB | Large or residency-bound tenants; created by routing tooling | A+ (capability), product offering V2 ("dedicated cells as a product") |
| Pooled → dedicated move | Logical replication of tenant's rows → short write freeze → directory switch. **No app change** (NFR-SCAL-01, Confirmed) | A+ |
| Noisy neighbours | Per-tenant worker concurrency and rate limits; large tenants on dedicated workers (NFR-SCAL-02) | B |
| Cross-region genealogy | MVP: **one data region per tenant**; split residency is OQ-17 | — |
| Tenant data export | Scheduled full export to tenant storage in region; on-demand on exit; replica access for dedicated tenants V1 | B / V1 |
| Self-hosted | A cell with exactly one dedicated tenant; RLS stays on; same migrations | V1 |

---

## 7. Transactions, outbox, events, queues

### 7.1 Transaction rule
- **One DB transaction per business event**, containing: state change + ledger entry (if financial) + outbox rows (TR-FIN-01, SDD-01 §6).
- Run commit (B), inside one transaction: run + period → `committed`; qualification state → authoritative; `LED` balanced journal entry; outbox `RunCommitted`; COMMIT. Approver ≠ preparer checked; step-up MFA.
- Case decision + its effect = one transaction; if effect fails, decision is not recorded (SDD-03 §2.10).
- Consistency: strong within a tenant's DB; replica eventual.

### 7.2 `outbox_event` table (INT, rel A; SDD-04)
| Column | Type | Null |
|---|---|---|
| `id` | uuid PK | NOT NULL |
| `tenant_id` | uuid → `tenant`.id | NOT NULL |
| `seq` | bigserial | NOT NULL |
| `topic` | text | NOT NULL |
| `key` | text (ordering/aggregate key) | NOT NULL |
| `payload` | jsonb | NOT NULL |
| `available_at` | timestamptz | NOT NULL |
| `attempts` | int | NOT NULL |
| `dispatched_at` | timestamptz | null |
| `dead` | boolean | NOT NULL |

Index `(dispatched_at, available_at) WHERE dispatched_at IS NULL`. Written in same transaction as state change. RLS on `tenant_id`. `inbound_event`, `outbox_event`, `webhook_delivery`: partition by week; purge after idempotency window (setting; proposed **35 days**, TR-DAT-04). Excluded from published tenant export model.

### 7.3 Dispatch state machine (TRD-05 §3; referenced by `dispatch` queue)
```
[*] → Pending
Pending → Sent          (dispatcher picks outbox row)
Sent → Confirmed        (2xx / provider accepted)
Sent → Unknown          (timeout or 5xx)
Unknown → Confirmed     (status query says accepted)
Unknown → Pending       (status query says not received; SAME idempotency key)
Sent → Rejected         (permanent error)
Pending → Dead          (attempts exhausted)
Dead → Pending          (manual replay after fix)
Rejected, Confirmed → [*]
```
Retry: exponential backoff with jitter; proposed 1 min → 6 h, **72 h total for webhooks**; payout instructions resolved by **status query, never blind retry**. Dead letters visible in integrations screen (payload ref, last error, replay). Inbound duplicates acknowledged without change.

### 7.4 Domain events (SDD-01 §4.1)
| Event | Producer | Consumers | Rel |
|---|---|---|---|
| `ImportBatchLoaded` | IMP | CPL (mark snapshots on superseded batch Outdated) | A |
| `OrderIngested`, `OrderEventIngested` | ORD | CAL (open-period inputs), Late queue, CPL facts | B |
| `GenealogyChanged` | GEN | Read-model rebuild (path rebuild, stale flag); Notifications | B |
| `PeriodCutOff` | CAL (scheduler) | Integration health check; analyst notifications | B |
| `RunCalculated` | CAL | Review dataset builder | B |
| `RunCommitted` | CAL | Ledger (**same transaction**), Statements, CPL facts, Webhooks, Notifications, GL export | B |
| `PayoutBatchApproved` | PAY | Instruction dispatcher | B |
| `PayoutSettled`, `PayoutReturned`, `PayoutFailed` | PAY (reconciliation) | Ledger (**same transaction**), Cases, Notifications, Webhooks | B |
| `BankDetailChanged` | PAY | Notifications (old **and** new contact), Fraud signals | B |
| `PlanVersionActivated` | PLN | Notifications, Webhooks | B |
| `CaseDecided` | CAS | Module that owns the effect (adjustment, genealogy, privacy…) | B |
| `SnapshotReady` | CPL | Webhooks, Dashboards | A |
| `SupportSessionRequested / Decided / Ended` | IAM | Notifications to tenant admins; session report | A |

Additional module events (SDD-03): `RoleGranted`, `ApprovalRecorded`, `SettingsVersionCreated`, `MarketWentLive`, `ImportBatchSuperseded`, `GuardrailBlocked`, `ParticipantEnrolled`, `ParticipantTypeChanged`, `PositionStatusChanged`, `CustomersReassigned`, `LateTransactionQueued`, `PlanVersionSubmitted/Approved`, `PeriodPaid`, `PeriodClosed`, `EntryPosted`, `CaseOpened`, `SubjectErased`.

"Same transaction" consumers are **synchronous facade calls inside the producer's transaction**, not outbox consumers (see Conflict C2).

### 7.5 Queues (job queue in PostgreSQL; SDD-01 §4.2)
| Queue | Work | Concurrency | Retry | Dead-letter | Process | Rel |
|---|---|---|---|---|---|---|
| `calc` | Runs, simulations, replays | Per-tenant limit **1 run per calendar**; pool sized per cell; advisory lock per (tenant, calendar, period) | **No blind retry**; failed run resumable by request | Run marked `Failed` with diagnostics | calc worker | B |
| `ingest` | Order and order-event processing, connector polls, imports | High; **ordered per source order id** | Exponential backoff, **10 attempts** | Exception queue visible in SC-13 | general | A (imports) / B |
| `dispatch` | Outbox: payout instructions, webhooks, notifications, audit shipping | **Ordered per aggregate key** | Per TRD-05 §3 (§7.3) | Dead letters with manual replay | general | A (audit shipping) / B |
| `rebuild` | Path read model, projections, statements | Per tenant | **5 attempts** | Alert; views stay marked stale | general | B |
| `export` | Journal, drill-down, full exports | Low | **3 attempts** | Alert | general | A (drill-down) / B |
| `schedule` | Period cut-offs, retention timers, reconciliations, licence checks | — | — | — | general | A+ |

Handler contract:
- **Idempotent**: checks a processed marker keyed by event id, **or** write is a natural-key upsert.
- **Lease**: workers stateless; job whose worker dies becomes visible again after lease expiry.
- Delivery: at-least-once delivery, at-most-once effect (NFR-REL-02); 0 platform-caused duplicate payments (NFR-REL-03).
- Monitoring: queue age and depth per queue and tenant; outbox oldest undispatched row; failed-job rate.
- Tracing: traces link API requests to jobs through the **outbox event id**.

### 7.6 Idempotency tests (spec.json)
| Test | Scenario → expected | Rel |
|---|---|---|
| TS-14 | Two concurrent run requests for same period → one run executes; both callers get same run id (`Run-Request-Id` header) | B |
| TS-15 | Duplicate order webhook → one order; second acknowledged without change | B |
| TS-16 | Payout instruction retried after timeout → provider sandbox shows one payment; same idempotency key both attempts | B |
| TS-41 | Same settlement webhook twice; webhook for unknown reference → one settlement posting; unknown → exceptions queue | B |

---

## 8. Read models and replica

| Read model | Owner | Built from | Trigger | Authority | Rel |
|---|---|---|---|---|---|
| `path_node` (materialised path, `ltree`) | GEN (PathReadModelBuilder) | `relationship` | `GenealogyChanged` → `rebuild` queue | **Never authoritative**; when stale, views show stale notice; authorisation falls back to system of record and **never widens access** (TR-GEN-09) | B |
| `statement` | DIST (StatementProjection) | Committed runs | `RunCommitted` | Rebuildable from committed data; cacheable after commit | B |
| Dashboard read models | RPT | Replica | — | Must state as-of time | B |
| Org reporting aggregates | — | Committed runs' volume summaries, **not live recursion** (TR-GEN-08) | — | — | B |
| Balance projection | FIN (BalanceProjection) | Postings | — | Verified against postings **nightly** (TR-FIN-06) | B |
| Compliance facts `cpl_fact_*` | CPL (FactWriter) | Imports (A) or `RunCommitted` (B) | Load / event | Snapshots immutable; only marked Outdated | A/B |

Replica: one streaming read replica per cell for dashboards and exports (B); full data export large tenant ≤ 6 h **from replica** (NFR-PERF-11); tenant read-only analytical replica for dedicated tenants is **V1** (FR-INT-004). Export formats: CSV and Parquet with manifest and checksums (TR-DAT-09, FR-INT-003, B). Published export model = SDD-04 minus `outbox_event`, `inbound_event`, `webhook_delivery`, `path_node`, secrets.

`export_job` (INT, rel A): `id`, `tenant_id`, `kind`, `filters` jsonb, `row_count` bigint, `document_id` → `document`, `destination`, `requested_by` → `user_account`, `state`; index `(tenant_id, kind)`; destination in tenant region; creation audited with row count.

---

## 9. Main runtime flows (sequence, exact)

### 9.1 MVP-A: export → evidence (A)
1. Implementation consultant `POST /v1/imports` (3 files; API-01, permission `import.manage`, `Idempotency-Key` required) → IMP creates batch `uploaded`.
2. Validate job (worker): schema, keys, references, **forbidden-column check**.
   - Forbidden column or schema error → batch `rejected` + row errors; validation report; **files deleted**. (TS-32: forbidden cols e.g. email, phone, bank_account, national_id, address → whole batch rejected, zero rows stored.)
   - Valid → batch `validated` + control totals.
3. Compliance officer `PUT` mapping, approve. Consultant loads batch.
4. Worker writes `cpl_fact_*` **in one transaction**, supersedes older batch (TS-33: old batch Superseded but readable; old snapshot unchanged and reproducible).
5. CO `POST /v1/compliance/snapshots` → worker computes R1..R5 → snapshot + figures (immutable).
6. CO `GET` figure rows (drill-down) → audit event if exported.

### 9.2 MVP-B: period close (B)
1. Cut-off evaluated in **calendar time zone**.
2. Analyst `POST /periods/{id}/runs` with `Run-Request-Id` → CAL checks **sync health** (Behind → run refused with last successful sync time) and takes lock `(tenant, calendar, period)`.
3. CAL writes `run_snapshot` (order watermark, known-at, versions) → enqueue on `calc`.
4. Calc worker loads facts + tree; passes 1..11 **in memory**; invariants; writes result lines + state candidates **staged** (keyed by run id), totals, hash.
5. Analyst `GET /runs/{id}/review`, requests commit.
6. Finance approver `POST /runs/{id}/commit` (**step-up MFA**) → CAL checks approver ≠ preparer → BEGIN → run, period = `committed`, state authoritative → LED balanced journal entry → outbox `RunCommitted` → COMMIT.
7. Outbox dispatcher → statements built, compliance facts written, webhooks sent.

Run snapshot fields (TR-ENG-05): order watermark, genealogy known-at instant, prior state run, plan version, settings version, market-pack version, engine version, input hash. By reference, not copy (ADR-21).

---

## 10. Failure and recovery (SDD-01 §5) — required behaviour

| Scenario | Required behaviour | Recovery |
|---|---|---|
| Payout provider fails / times out | Instruction stays `instructed`, outcome unknown; status query before any re-send; re-send with **same idempotency key** only if not received; ledger shows amount in *payout in transit* | Auto; after retry budget flag to payout officer; switch to second route (other adapter or bank file) **only after first provider confirms non-receipt** |
| Provider rejects part of batch | Rejected lines `failed`; amounts post back in transit → payable; batch `partially_settled` | Retry failed lines only, after cause fixed via case |
| Commission processing interrupted | Run wrote to staging keyed by run id; nothing visible; run `failed`; period returns to previous state (Open, or Calculated with earlier run) | Analyst restarts; **same snapshot reused** → identical result |
| DB connectivity lost | Web fails fast **503**; workers pause; inbound webhooks get non-2xx | Auto on reconnect; failover to standby; **ledger invariant job runs before payout dispatch resumes** |
| Jobs fail repeatedly | Backoff → dead-letter → alert; source state unchanged | Fix, replay from dead-letter view |
| External integration down | Commerce: store retries webhooks, poll backfills, sync health → Behind, **blocks runs at cut-off**. Messaging: retry; security notices fall back to another channel. ERP: export stays downloadable | Auto catch-up |
| Deployment rollback | Previous artefact; migrations expand-then-contract (old code runs on new schema); engine version pinned per run | Calculated run with faulty engine → discard and re-run; **committed** with faulty engine → **restatement, never edit** |
| Duplicate payout | Cannot arise from retry (same key); provider double-pay → reconciliation exception; one settlement posted, second unmatched | Case; if payee keeps excess → approved adjustment creates clawback receivable |
| Payout returned | Entry in transit → payable; case; payee notified | Payee corrects details (cooling-off applies); next batch |
| Order sync behind at cut-off | Run refused with last successful sync time; period stays Open | Catch up, then run |
| Read model stale / rebuild fails | Stale notice; authorisation falls back to system of record, never widens access | Retry rebuild |
| Audit store unavailable | Audit events buffer in outbox; **money actions blocked if buffer passes a limit** (limit unset) | Drain on recovery; verify chain |
| Restore from backup | PITR; outbox rows after restore point gone → provider may be ahead | **Mandatory reconciliation against provider reports before payout dispatch resumes**; differences → cases |
| IdP down | No new sign-ins; existing tokens valid until expiry | — |
| Policy errors | **Fail closed** | — |
| Licence problem | Never blocks calculation, commit, payout, statements or export (BR-LIC-01) — only new engine versions, market-pack updates, support | V1 |

---

## 11. Cross-cutting conventions (SDD-01 §6, TRD-01)

| Concern | Rule |
|---|---|
| Identifiers | **UUID v7**; human-facing refs (`position_ref`, external ids) are separate columns |
| Time | All timestamps **UTC** in storage; period boundaries computed in calendar's time zone; engine receives time as input, never reads clock |
| Money | Minor units or fixed-precision decimals; high-precision decimals until rounding pass, integer minor units after (TR-ENG-06); no float (static check) |
| Data lifecycle | Facts (orders, order events, result lines, postings, relationships, audit events) created once, never changed; state via new rows (TR-DAT-03). Insert-only tables DB-enforced (NFR-INT-05); CI migration check forbids rewrites of insert-only tables |
| Validation | Boundary (API schema) + domain (rules) + database constraints (TR-DAT-05) |
| Configuration | Settings, plans, market packs = versioned data; app config by environment (twelve-factor, TR-DEP-05); no secrets in code or images |
| Caching | Only immutable/versioned data |
| Observability | Logs structured with tenant id, correlation id, actor id; **no personal data, secrets, bank details** (NFR-OBS-03, automated scan); correlation id on 100% of requests/jobs into logs, traces, audit events (NFR-OBS-02) |
| Vocabulary | No table, field, API or label uses "wallet"; use "earnings balance owed by [tenant]" (TR-FIN-11; TS-67 build check) |
| Approvals | Step-up auth; approver ≠ preparer enforced in **service and database**; thresholds from settings (TR-FIN-09) |
| Vendor access | Only through tenant-approved logged sessions; separate realm (ADR-12; TS-37) |

---

## 12. TR-* requirements that constrain code

### 12.1 Data (TR-DAT)
| ID | Requirement |
|---|---|
| TR-DAT-01 | Entities as in SDD-04; every entity has **one owner module** |
| TR-DAT-02 | Tenant owns its data, platform is processor; market packs and guardrail rules are **platform data** |
| TR-DAT-03 | Facts created once, never changed; state by new rows |
| TR-DAT-04 | Retention per data class and market (market pack); committed run snapshots, ledger, tax lines, audit kept for legal retention; idempotency records proposed **35 days**; simulation results per setting |
| TR-DAT-05 | Validation at API schema, domain, DB constraints (SDD-04 §6) |
| TR-DAT-06 | NFR-INT-01..06 invariants by DB constraints where possible + engine invariants before commit |
| TR-DAT-07 | `tenant_id` on every tenant-scoped row; RLS; tenant id from session only; automated isolation tests for every endpoint |
| TR-DAT-08 | History import with validation and opening entries (FR-MIG-001, B) |
| TR-DAT-09 | Complete, documented, versioned export, CSV + Parquet, manifest + checksums (FR-INT-003, B) |
| TR-DAT-10 | Erasure by pseudonymisation where retention applies; hard delete of sensitive docs by **key destruction**; tenant deletion after archive retention |
| TR-DAT-11 | Continuous log archiving + daily snapshots per region; encrypted, in region; quarterly restore drills |
| TR-DAT-12 | Tax ids, identity docs, bank details encrypted with per-tenant keys in separate store; masked display; access logged |
| TR-DAT-13 | Overlay imports hold **pseudonymous ids only**; forbidden columns rejected (A) |

### 12.2 Engine (TR-ENG, all B)
| ID | Requirement |
|---|---|
| TR-ENG-01 | Plans are data: versioned rule documents from typed primitive catalogue, schema-validated; dependency graph orders rules |
| TR-ENG-02 | Typed pure expression language, bounded evaluation, no I/O; platform modules behind stable versioned parameterised interface; every extension recorded in traces |
| TR-ENG-03 | Version immutable from approval; effective dates on period boundaries of every calendar the plan uses; run resolves exactly one version |
| TR-ENG-04 | Calendars, cut-off time zones, state machine, late-transaction handling |
| TR-ENG-05 | Input snapshot per run (fields in §9.2) |
| TR-ENG-06 | Fixed pass order (SDD-07 §4); high-precision decimals until rounding pass; integer minor units after |
| TR-ENG-07 | Period-end, rolling, per-order windows; several ladders; paid-as and title; maintenance and grace; state as run output |
| TR-ENG-08 | Payout function catalogue with declared tree, measure, reversal policy per bonus |
| TR-ENG-09 | Same snapshot+plan+settings+engine version → **byte-identical ordered lines**; defined iteration order; no wall-clock/random/locale |
| TR-ENG-10 | Compact trace per line; full trace by replay; review dataset; preparer + approver recorded |
| TR-ENG-11 | Order-line clawback and restatement selectable per bonus; both produce adjustment lines, never edits |
| TR-ENG-12 | Late transactions, manual adjustments, restatements enter open run with **once-only origin keys** |
| TR-ENG-13 | Simulation = same code path with a flag; isolated result storage; comparison vs baseline |
| TR-ENG-14 | Control totals: orders → volume → gross lines → caps → net lines → ledger entry → payout instructions → settlements; variance vs previous run |
| TR-ENG-15 | Calculated run disposable and re-runnable; Committed run changed only by restatement |
| TR-ENG-16 | Invariants before commit: lines sum to run total; allocations sum to total; no cap exceeded; no payout to position terminated before period unless plan says; matching never pays on reversed bonus; gross = net + withholding per payee |
| TR-ENG-17 | Worker pool, resumable, progress; per-tenant concurrency limits; advisory lock per (tenant, calendar, period) |
| TR-ENG-18 | Engine versioned; each run pins version; releases pass golden, replay, differential tests |

### 12.3 Genealogy (TR-GEN, B)
TR-GEN-01 `sponsor` relationship kind, bitemporal, append-only · TR-GEN-02 `placement` kind with optional leg, independent of sponsor · TR-GEN-03 runs: in-memory arrays built once per run, one bottom-up pass for group volumes, upline walks by parent index; interactive: materialised path read model · TR-GEN-04 valid time + recorded time; "as of D, as known at T" · TR-GEN-05 no cycles; one parent per kind at any valid time; width limits matrix/binary; serialised placement per leg · TR-GEN-06 search by id, name (staff), rank; subtree counts; depth/breadth limits per request · TR-GEN-07 targets NFR-PERF-05, -07, -08; benchmark before architecture sign-off · TR-GEN-08 org reporting from committed runs' volume summaries · TR-GEN-09 field-by-depth visibility on server from read model, fallback to system of record when stale.

### 12.4 Financial (TR-FIN, B)
TR-FIN-01 one transaction = state change + balanced journal entry + outbox rows · TR-FIN-02 append-only postings; derived balances; idempotency key per entry; unbalanced rejected · TR-FIN-03 entry carries origin (run, batch, case), approver, time; chain statement line → posting → instruction → settlement · TR-FIN-04 batch state machine; preparer + approver; instructions via outbox; ambiguous outcome → status query before re-send · TR-FIN-05 order events → reversal policy → clawback receivable → netting → write-off with approval · TR-FIN-06 daily + per-period reconciliation vs provider reports; ledger projection verified nightly · TR-FIN-07 one currency per market in B; amounts carry currency; rate table designed, used from **V1**; conversion at one defined step · TR-FIN-08 adapter interface; tenant-owned credentials; ≥2 payout routes per launch market (one may be bank file) · TR-FIN-09 step-up; approver ≠ preparer in service and DB; thresholds from settings · TR-FIN-10 withholding pass after gross, before instruction; rules from market pack by pay date; tax lines stored; liability account per market (B-MKT) · TR-FIN-11 no "wallet".

### 12.5 Deployment (TR-DEP)
| ID | Requirement | Rel |
|---|---|---|
| TR-DEP-01 | Reproducible local env with containers; seeded synthetic data; no production data | A |
| TR-DEP-02 | Staging production-like per region; synthetic + anonymised only; provider sandboxes | A |
| TR-DEP-03 | Production per-region cell: web, workers, primary + replica, cache, object storage, secrets, IdP; **no cross-region tenant data flows** | A |
| TR-DEP-04 | CI on every change: lint, static checks (floats, tenant branches), unit, golden, replay sample, isolation suite, migration check; signed artefacts; staged rollout | A |
| TR-DEP-05 | Twelve-factor config; no secrets in code/images | A |
| TR-DEP-06 | Managed secrets store; per-tenant provider credentials and signing keys; rotation | A |
| TR-DEP-07 | Metrics, traces, structured logs with tenant + correlation ids; no personal data | A |
| TR-DEP-08 | NFR-DR-01..04 | A |
| TR-DEP-09 | Rollback by redeploying previous artefact; migrations backward-compatible one release (expand, then contract); engine pinning | A |
| TR-DEP-10 | Horizontal web; worker pool per region with per-tenant limits; DB vertical first, dedicated DB for large tenants | A |
| TR-DEP-11 | Feature flags per tenant; new engine behaviours behind flags + golden tests | A/B |
| TR-DEP-12 | Maintenance windows never across a tenant's cut-off or pay day | B |
| TR-DEP-13 | Self-hosted packaging: versioned images; Compose (small) + Helm (Kubernetes); published minimum infra; preflight; signed release/engine/market-pack packages verifiable offline; documented backup/restore/upgrade; supported-version policy | V1 |
| TR-DEP-14 | Self-hosted engine update activates only after installation's golden datasets + replay sample pass; auto rollback on failed migration; committed runs keep pinned engine | V1 |
| TR-DEP-15 | Self-hosted telemetry **off by default**; if enabled, operational metrics only, never business or personal data | V1 |

---

## 13. Environments, CI/CD, operations

### 13.1 Environments (SDD-11 §1)
| Env | Purpose | Data | Scale | Access |
|---|---|---|---|---|
| Local | Development | Synthetic (generator like prototype `synth.py`) | Containers on laptop | Developer |
| CI | Automated tests | Fixtures; golden datasets | Ephemeral | Pipeline |
| Development | Integration of merged work | Synthetic | Small, shared | Engineers |
| Staging | RC verification; provider sandboxes; restore drills | Synthetic + anonymised; **never production personal data** | Production-like topology, smaller | Engineers; design-partner preview by invitation |
| Production (per region = cell) | Tenants | Real | Sized per cell | No routine human access; **break-glass only** |

Local stack: app (web/API + workers, hot reload), PostgreSQL + `ltree`, Redis, S3-compatible store, IdP (seeded realms/users), mail catcher, **fake payout provider + fake store** with scriptable failures (time out, reject lines, return payments, duplicate webhooks). Seed: synthetic tenants, tree shapes, orders, golden datasets.

Staging cell: LB + WAF → web/API ×2; PostgreSQL primary + replica; Redis; general workers ×2; calc workers ×1–2; object + sensitive store; IdP; audit store; provider sandboxes and test stores. Quarterly restore drill: restore production backup into isolated access-restricted copy, run ledger invariants, destroy.

### 13.2 CI/CD pipeline (order matters)
1. Lint + type check
2. Static rules: **no float in money paths · no tenant-id branches · module boundary test · secret scan** (+ no "wallet" in UI messages, TS-67)
3. Unit + property tests
4. Golden datasets + replay sample + **differential vs previous engine**
5. Integration tests with fake provider: idempotency, ledger invariants
6. Cross-tenant isolation suite generated from OpenAPI
7. Migration check: forward-only, RLS policy on new tables, no rewrite of insert-only tables
8. Dependency + image scan
9. Build **signed image + SBOM**
10. Deploy dev → deploy staging + smoke + accessibility scan
11. Release approval **by non-author**
12. Production: **one cell at a time**, canary tasks, automatic rollback on error budget
13. (V1) Self-hosted package: signed images, charts, market packs

| Topic | Rule |
|---|---|
| Config | Env vars + mounted secrets; **same image** in every env and in self-hosted package |
| Migrations | Migration job per database **before** new version takes traffic; expand-then-contract; **no down-migrations** |
| Rollback | Redeploy previous image; engine versions additive |
| Release timing | No prod deploy inside a tenant's cut-off-to-commit window in that cell unless fixing that process |

### 13.3 Monitoring and alerts (SDD-11 §6, NFR-OBS)
| Signal | Examples | Alert |
|---|---|---|
| Service | Request rate, errors, latency per route and tenant | Error budget burn |
| Runs | Duration, lines, memory, failures, variance vs previous run | Failed run; run longer than target |
| Ingestion | Lag per connector, exception queue size, reconciliation differences | Lag at cut-off |
| Outbox and queues | Oldest undispatched row; queue age; dead letters | **Age > 5 min** (proposed); **any dead letter in `dispatch`** |
| Payouts | Instruction failure/return rates; in-transit ageing | Rate above tenant threshold |
| Ledger | Unbalanced entry attempts; projection mismatch; replay mismatch | **Any** |
| Security | Sign-in failures, new admins, vendor sessions, audit chain | Chain break; canary hit |
| Database | Connections, replication lag, bloat, slow queries | Replication lag; storage |

NFR-OBS-01 (Confirmed) per-tenant metrics: run duration and lines, ingestion lag, payout failure rate, outbox age, job queue age. NFR-OBS-04 (Proposed) paging on: unbalanced entry attempt, replay mismatch, audit chain break, outbox age > 5 min, sync lag at cut-off. Each tenant gets a status view of its own run, ingestion, payout health (SC-01, SC-13).

### 13.4 Backup, DR, scaling (SDD-11 §7)
| Topic | Design |
|---|---|
| Backups | Continuous WAL archiving + daily snapshots, encrypted, in region; object storage versioned; audit archives to write-once storage |
| Zone failure | Automatic failover to standby; web and workers already multi-zone |
| Region failure | Restore into a second region **only if tenant residency allows**; else wait. Must be stated in contracts |
| Restore drill | Quarterly: restore, ledger + audit-chain verification, replay sample of committed periods |
| After any restore | Mandatory provider reconciliation before payout dispatch resumes |
| Scaling | Web on CPU + latency; general workers on queue age; calc workers by pool size and instance memory; DB vertical then dedicated DBs |

---

## 14. Self-hosted edition (V1)

| Aspect | Design |
|---|---|
| Form | Versioned container images; Compose for small installs; Helm chart for Kubernetes; **no source code** (BR-LIC-05) |
| Topology | Hosted cell with exactly one tenant; RLS on; same migrations |
| Licensee infra | Reverse proxy/TLS → app containers (web/API, general workers, calc workers) → PostgreSQL 16+ with `ltree`, Redis, S3-compatible storage, IdP (reference config supplied), mail server (SMTP), secrets (files or vault) |
| Minimum infrastructure | Published per payee band after spike; includes PG extensions, backup target, time synchronisation |
| Preflight | Refuses install on unsupported versions, missing encryption, or no backup target |
| Updates | Signed packages from vendor release server (download or offline media); pre-activation golden + replay checks; rollback on failed migration; advisories by version |
| Market packs | Signed data packages with basis status; effective by date, **never retroactive** |
| Licence | Signed file, offline verification (BR-LIC-02); expiry never blocks runs or payouts (BR-LIC-01, DEC-18) |
| Vendor connectivity | Optional outbound-only update-feed check; **no inbound vendor access**; support via redacted support bundle sent by licensee, or licensee-approved session; vendor holds no credentials |
| Not included | Managed backups, monitoring service, identity operations (licensee responsibility, SDD-10 §8) |
| Supported versions | Current and previous minor; upgrade path tested every release (NFR-MAIN-06, Proposed) |
| Edition code | Same commit for both; differences = configuration + licence entitlement only; **0 edition-specific branches** in engine, ledger, guardrails (NFR-MAIN-05, Confirmed) |

---

## 15. NFR numeric targets

Status: **C** = Confirmed · **P** = Proposed (spike/founder) · **M** = Market pack.

### 15.1 Performance
| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-PERF-01 | Interactive API read latency (lists, detail, statements after commit) | p95 ≤ 300 ms, p99 ≤ 800 ms at server | P |
| NFR-PERF-02 | API write latency (order ingestion, case actions) | p95 ≤ 500 ms | P |
| NFR-PERF-03 | Order ingestion throughput per tenant | Sustained 50 orders/s; burst 200 orders/s for 10 min; no loss (assumed large-tenant period-end avg 3.5/s) | P |
| NFR-PERF-04 | Full run, mid-market tenant | ≤ 5 min | P (spike) |
| NFR-PERF-05 | Full run, large tenant (2M positions, deep-leg binary depth 5,000) | ≤ 60 min; worker memory ≤ 8 GB | P — **must be proven at spike** |
| NFR-PERF-06 | Distributor statement on 3G profile (1.6 Mbit/s, 300 ms RTT) | Usable ≤ 3 s; transfer ≤ 150 KB excl. cached fonts | P |
| NFR-PERF-07 | Genealogy authorisation check / subtree page (read model) | p95 ≤ 100 ms / ≤ 300 ms | P (spike) |
| NFR-PERF-08 | Read-model rebuild after moving 100,000-position subtree | ≤ 10 min, without blocking writes | P (spike) |
| NFR-PERF-09 | Admin dashboard load | ≤ 2 s to first figures at p95 | P |
| NFR-PERF-10 | Compliance snapshot, one year of mid-market export | ≤ 2 min | P (A) |
| NFR-PERF-11 | Full data export, large tenant | ≤ 6 h from replica | P |
| NFR-PERF-12 | Background job start delay | p95 ≤ 30 s from enqueue | P |
| NFR-PERF-13 | Concurrent users | 500 staff + 20,000 distributor sessions per large tenant on pay day | P |
| (TRD-01 §7) | Any interactive DB query | ≤ 200 ms p95 with SDD-04 indexes | P |

### 15.2 Scalability, availability, reliability
| ID | Target | Status |
|---|---|---|
| NFR-SCAL-01 | Pooled → dedicated DB without app change (routing change + data migration) | C |
| NFR-SCAL-02 | One tenant's run cannot starve others: per-tenant worker concurrency limit; large tenants on dedicated workers | C |
| NFR-SCAL-03 | No recursive query per node in calculation; tree loaded once per run | C |
| NFR-SCAL-04 | Stateless, horizontally scalable web tier | C |
| NFR-AVAIL-01 | Monthly availability API + portals (excl. announced maintenance) **99.9%** | P |
| NFR-AVAIL-02 | Planned maintenance never overlaps tenant cut-off or pay day; maintenance calendar per region | P |
| NFR-REL-01 | Failed run: no partial result visible; resumable from snapshot — always | C |
| NFR-REL-02 | External effects at least once delivered, at most once applied (outbox + idempotency keys) | C |
| NFR-REL-03 | Platform-caused duplicate payments = **0** | C |

### 15.3 Data integrity
| ID | Target | Status |
|---|---|---|
| NFR-INT-01 | Unexplained ledger difference per run = **0 minor units** | C |
| NFR-INT-02 | Replay of committed period = identical ordered hash of lines | C |
| NFR-INT-03 | Allocations (pools, splits, scaled caps): parts sum exactly to total | C |
| NFR-INT-04 | No binary float in money paths — static check | C |
| NFR-INT-05 | Insert-only tables cannot be updated/deleted by the app — DB-enforced | C |
| NFR-INT-06 | Compliance snapshot recomputation from same inputs and versions = identical figures | C |

### 15.4 Security and privacy
| ID | Target | Status |
|---|---|---|
| NFR-SEC-01 | Cross-tenant access through any endpoint = 0; suite covers 100% endpoints in CI | C |
| NFR-SEC-02 | MFA on privileged roles and vendor staff = 100% | C |
| NFR-SEC-03 | TLS ≥ 1.2 in transit; AES-256 at rest; per-tenant keys for sensitive fields | P |
| NFR-SEC-04 | Admin session 12 h absolute, 30 min idle; step-up factor ≤ 10 min old | P |
| NFR-SEC-05 | Vendor access outside approved session = 0 | C |
| NFR-SEC-06 | Audit coverage of money, role, plan, export, vendor actions = 100% | C |
| NFR-SEC-07 | Critical dependency vulns patched ≤ 7 days; high ≤ 30 days | P |
| NFR-SEC-08 | Independent pen test before first production tenant in MVP-B and yearly | P |
| NFR-PRIV-01 | DSR completion within market deadline | M |
| NFR-PRIV-02 | Breach notification to tenant without undue delay; per market and DPA | M |
| NFR-PRIV-03 | Personal data, backups, exports stay in tenant region = 100% | C where market requires; design rule elsewhere |
| NFR-PRIV-04 | Overlay imports: no direct identifiers or bank data; rejected at upload | C |

### 15.5 Disaster recovery
| ID | Target | Status |
|---|---|---|
| NFR-DR-01 | RPO ≤ 5 min (continuous log archiving) | P (founder sets; SEC-11) |
| NFR-DR-02 | RTO ≤ 4 h | P (founder sets) |
| NFR-DR-03 | Restore test quarterly per region, with ledger invariant check | P |
| NFR-DR-04 | Committed run snapshots and audit archives retained for legal retention period | M |

### 15.6 Maintainability, observability
| ID | Target | Status |
|---|---|---|
| NFR-MAIN-01 | Tenant-specific code branches = 0 (static check) | C |
| NFR-MAIN-02 | Engine releases gated by golden + replay tests, 100% pass | C |
| NFR-MAIN-03 | Engine versions used by committed runs runnable for retention period | C |
| NFR-MAIN-04 | Module boundaries enforced (no cross-module table writes) — architecture test in CI | P (treat as required; SDD-03 and CI mandate it) |
| NFR-MAIN-05 | Same commit for both editions; 0 edition branches in engine, ledger, guardrails | C |
| NFR-MAIN-06 | Self-hosted supported versions: current + previous minor; upgrade path tested every release | P |
| NFR-OBS-01 | Per-tenant metrics (run duration/lines, ingestion lag, payout failure rate, outbox age, job queue age) with dashboards + alerts | C |
| NFR-OBS-02 | Correlation id on 100% of requests and jobs into logs, traces, audit events | P |
| NFR-OBS-03 | Logs contain no personal data, secrets, bank details — automated scan | P |
| NFR-OBS-04 | Paging alerts (list in §13.3) | P |

### 15.7 Usability / accessibility / localisation (architectural impact only)
NFR-ACC-01 WCAG 2.2 AA portal + admin (C as target) · NFR-ACC-02 keyboard operation of tables, tree explorer, approval flows 100% (P) · NFR-USE-01 first-time task success on five highest-risk screens ≥ 80% of 5 participants per role without help (P) · NFR-USE-02 net pay + "how calculated" ≤ 2 taps (P) · NFR-USE-03 body ≥ 16 px, touch ≥ 44×44 px (P) · NFR-LOC-01 admin English first; distributor pages in market-pack languages (M) · NFR-LOC-02 all text externalised, locale-aware numbers/dates/currency, RTL-ready (P) · NFR-LOC-03 0 untranslated keys for market languages (P). Devices: staff min viewport 1024 px (tablet usable for read and approve); distributors phones from 360 px incl. low-end Android. Browsers: last two majors of Chrome, Edge, Safari, Firefox; Android Chrome + iOS Safari current and previous; Samsung Internet current. Distributor statement core renders **with scripts disabled** (proposal).

Needing validation before commitment (PRD-03 §3): NFR-PERF-04, -05, -07, -08 (spike, TS-29); NFR-DR-01, -02, NFR-AVAIL-01 (founder); NFR-PERF-06 and NFR-USE-* (distributor testing); all Market items.

### 15.8 Performance test
TS-29 (B, Performance): synthetic trees of 50k, 500k, 2M positions (balanced binary, deep-leg binary depth 5,000, wide unilevel); bottom-up volume pass and full run → within NFR-PERF-04 and -05. Also `ltree` path size at depth 5,000 (OQ-29; chunked-path fallback described in SDD-08).

---

## 16. Release map of architectural capabilities

| Capability | A | B | B-MKT | V1 | V2 |
|---|---|---|---|---|---|
| Cell, tenant directory, routing (pooled/dedicated), RLS, isolation suite | ✔ | | | | |
| IdP realms staff + vendor; vendor support sessions; MFA | ✔ | | | | |
| Portal realm, distributor sign-in, API keys, SoD | | ✔ | | | |
| Outbox + `dispatch` (audit shipping), `export_job`, audit store + chain | ✔ | | | | |
| Import pipeline, `cpl_fact_*` from imports, R1–R5 snapshots | ✔ | | | | |
| Calc worker pool, engine, run snapshots, ledger, payouts, webhooks, inbound events, connectors | | ✔ | | | |
| Market-pack tax/withholding, ≥2 payout routes per market | | | ✔ | | |
| Read replica (internal dashboards/exports); full tenant export | | ✔ | | | |
| Tenant replica access (FR-INT-004), multi-currency/fx, credit types, retention timers, archive, integrity signals, provisional runs | | | | ✔ | |
| Self-hosted edition (LIC, Compose/Helm, signed updates) | | | | ✔ | |
| Dedicated cells as a product, multi-brand tools, NL reporting | | | | | ✔ |

---

## Conflicts found

| # | Conflict | Sources | Resolution (reasoned) |
|---|---|---|---|
| C1 | Dependency graph draws `LED → CAL` (Ledger may call Calculation), but every flow has Calculation calling Ledger inside the commit transaction (`CAL->>LED: balanced journal entry`; refund flow `CAL->>FIN on commit`). PD-03 says Ledger "depends on CAL" (data dependency). | SDD-03 §1 graph vs SDD-02 §4.2, SDD-03 §3, SDD-01 §4.1 | Implement **`CAL → LED`** (CAL calls `LED.post(event)` with run totals) and **remove `LED → CAL`**. LED needs no CAL facade: posting rules take the event payload. No cycle results (LED's only other caller is PAYM, MIG, RPT). Update the CI boundary test accordingly. |
| C2 | `RunCommitted` and `PayoutSettled/Returned/Failed` list "Ledger (same transaction)" as an outbox *consumer*; outbox consumers are asynchronous by definition. | SDD-01 §4.1 vs §4 intro | Ledger posting is a **synchronous facade call within the producer's transaction** (TR-FIN-01); the outbox row is written in that same transaction for the asynchronous consumers only. |
| C3 | DIST "write paths delegate to PAY, TAX, CAS", but graph only allows DST → CAL, GEN, PAYM. | SDD-03 §2.11 vs §1 | Add `DST → TAX` and `DST → CAS` edges (both are leaves relative to DST; no cycle). |
| C4 | Case decisions must apply their effect in the same transaction via `CaseTypeRegistry` effect handlers, but graph has `GEN → CAS` (not `CAS → GEN`) and SDD-01 says owning modules consume `CaseDecided` (async). Same for PRV pseudonymising other modules' tables while only allowed to call CAS and "no module writes another's tables". | SDD-03 §2.10, §1 vs SDD-01 §4.1 | Use **dependency inversion**: owning modules (GEN, LED adjustments, PRV targets, etc.) register effect handlers with `CaseTypeRegistry` at startup; CAS invokes them in-transaction through the registered interface. Graph direction preserved; effect and decision atomic. `CaseDecided` event remains for notifications. Pseudonymisation likewise: each data-owning module exposes a pseudonymise handler registered with PRV. Needs confirmation by architect. |
| C5 | Engine package "has no I/O except through its ports" and "never reads the clock", yet TAX's `WithholdingCalculator` is "called by the engine's withholding pass" and graph has `CAL → TAX`. | SDD-02 §3, SDD-01 §6 vs SDD-03 §2.9 | `WithholdingCalculator` must be a **pure function** fed with tax rules (market pack by pay date) and tax profiles loaded into the run snapshot by `RunOrchestrator` via ports; `CAL → TAX` is used by the orchestrator (loader), not by I/O inside the engine. |
| C6 | Failed run "resumable" (TR-ENG-17, NFR-REL-01, `calc` queue) vs SDD-01 §5 "run marked failed … analyst restarts; the same snapshot is reused". | TRD-01, PRD-03 vs SDD-01 §5 | Implement **restart-from-same-snapshot** (deterministic → identical result). Progress reporting required; intra-run checkpoint resume is optional optimisation, not MVP. |
| C7 | `export_job` owner: SDD-03 lists it under AUD's data; SDD-04 and spec.json assign it to **Integration** (rel A). | SDD-03 §2.10 vs SDD-04 / spec.json | **INT owns `export_job`** (it runs exports); AUD records the export audit event (creation audited with row count). SDD-04 is the table catalogue of record per SDD-03 rule 1. |
| C8 | ADR list: SDD-01 §7 lists ADR-01..16 only; decision log has ADR-17..21 (PostgreSQL, TypeScript, OIDC IdP, no bus, snapshot-by-reference). | SDD-01 §7 vs 02_DECISION_LOG | Treat all 21 as in force (§2). SDD-01 §7 is stale. |
| C9 | INT is "cross-cutting, from MVP-A" in PD-03 §1, but PD-03 §5 MVP-A list omits INT; all FR-INT are B. Meanwhile `outbox_event` and `export_job` are rel A and audit shipping goes through `dispatch`. | PD-03 §1 vs §5; SDD-04 | MVP-A ships INT **infrastructure only** (outbox, dispatcher for audit shipping, export jobs, `/v1` API entry). Public API/webhooks/connectors/sync health = B. |
| C10 | Replica timing: SDD-11 production (and staging) include a read replica; ADR-11 says "Export in MVP-B; replica V1"; PD-03 lists "replica" in V1. | SDD-11 §4 vs ADR-11, PD-03 §5, FR-INT-004 | Internal replica for dashboards/exports from **B** (needed for TR-CON-07, NFR-PERF-11); **tenant-facing** replica access is **V1**. In MVP-A, dashboards are snapshot-based; any reporting load must still avoid ad-hoc primary queries. |
| C11 | Module dependency statements in PD-03 differ from SDD-03 graph: PD-03 PAR depends on GEN (SDD-03: GEN → PAR); Tax depends on CAL (SDD-03: CAL → TAX); CPL depends on CAL (SDD-03: CPL never calls CAL); LIC depends on AUD, PLN, COMP (SDD-03: LIC → AUD only); OPS depends on IAM (absent from SDD-03 graph). | PD-03 §2 vs SDD-03 §1 | (Also: PD-03 Payouts depends on IAM, Cases on IAM + AUD, Orders on INT + CRM, PAR on TEN + GEN.) PD-03 describes **business/data dependencies**; SDD-03 is the **call graph** and governs code. Add `OPS → IAM, TEN` edge (provisioning needs TEN). LIC's need for PLN/COMP (pre-activation golden + replay of engine updates) should go through a registered verification hook, or add `LIC → PLN, CAL` edges — architect to confirm. |
| C12 | NFR-MAIN-04 module-boundary test is "Proposed", while SDD-03 §1 and SDD-11 CI pipeline mandate it. | PRD-03 vs SDD-03, SDD-11 | Build it as required from A. |
| C13 | Audit store: "separate database or schema with insert-only role" (SDD-02) vs "Audit DB, separate credentials" (SDD-11) and BR-SEC-07 "stored separately from application tables". | SDD-02 §3 vs SDD-11 §4 | Hosted: **separate database** with separate credentials and insert-only role. Self-hosted may use a separate schema if licensee runs one PostgreSQL, still with distinct insert-only role. |
| C14 | `calc` concurrency "1 run per calendar" per tenant vs TR-ENG-17 advisory lock per (tenant, calendar, period). Simulations and replays share the `calc` queue; unclear whether they count against the limit. | SDD-01 §4.2, SDD-11 §4 vs TRD-01 | Lock key = (tenant, calendar, period) for **runs**; worker concurrency limit = 1 committed-path run per (tenant, calendar). Simulations/replays write isolated storage (TR-ENG-13) and should use a separate per-tenant concurrency budget — confirm (see O-6). |
| C15 | TR-CON numbering: TR-CON-11 appears before TR-CON-10 in TRD-01 §2. | TRD-01 | Cosmetic; IDs kept as written. |
| C16 | spec.json has **FR-PRV-004 (breach-notification contacts and runbook data) rel A**, but PD-03 §5 MVP-A module list omits PRV. | spec.json vs PD-03 §5 | Ship the FR-PRV-004 slice of PRV in A (data only: contacts + runbook); rest of PRV in B/V1. |

---

## Open / unresolved

| # | Item | Blocks |
|---|---|---|
| O-1 | **OQ-05** — engine and genealogy performance at assumed scale; Phase C spike (TS-29) not run | NFR-PERF-04, -05, -07, -08; ADR-04, ADR-18; TR-GEN-07 architecture sign-off; calc worker instance sizing (≤ 8 GB) |
| O-2 | **OQ-29** — `ltree` path size at depth 5,000; chunked-path fallback | ADR-04, `path_node` (ENT-07) design, NFR-PERF-07/-08 |
| O-3 | **OQ-18** — backend language (TypeScript proposed; JVM/.NET equally valid) | ADR-18; stack, engine package |
| O-4 | **OQ-19** — cloud provider and regions (AWS default; India `ap-south-1` + `ap-south-2`; Bangladesh: no hyperscaler region) | SDD-11 production cell, DR region choice, DEC-21; **FD-02** launch market |
| O-5 | **OQ-17** — one genealogy across countries with in-country storage; MVP supports one data region per tenant | Multi-country tenants; cross-region genealogy |
| O-6 | Whether simulations/replays count against the per-tenant `calc` concurrency limit (C14) | `calc` queue scheduler; NFR-SCAL-02 |
| O-7 | NFR-DR-01/-02 (RPO ≤ 5 min, RTO ≤ 4 h) and NFR-AVAIL-01 (99.9%) are proposals; founder sets them (cost trade-off) | Standby mode (sync vs semi-sync), backup design, contracts |
| O-8 | Audit-buffer limit at which money actions are blocked when audit store is unavailable — no value given | SDD-01 §5 behaviour; NFR-SEC-06 |
| O-9 | Retry budget before payout instruction is flagged to payout officer; exact backoff schedule (proposed 1 min–6 h, 72 h webhooks) | `dispatch` queue config; TR-FIN-04 |
| O-10 | Outbox age alert threshold > 5 min is proposed | NFR-OBS-04; SDD-11 §6 |
| O-11 | Idempotency window 35 days is proposed (setting) | TR-DAT-04; partition purge of `inbound_event`/`outbox_event`/`webhook_delivery` |
| O-12 | **OQ-09** — infrastructure cost per tenant (pooled vs dedicated) unmeasured | Pooled/dedicated placement policy; pricing (DEC-07) |
| O-13 | Self-hosted minimum infrastructure per payee band — published only after spike | TR-DEP-13; V1 package |
| O-14 | **OQ-24 / OQ-25** — self-hosted licence form and liability/update duties | FR-LIC-001..003, DEC-17 commercial terms |
| O-15 | **OQ-12** — target primitive coverage share (today 5 of 16 hold-out plans) | ADR-05 extension tiers; engine scope |
| O-16 | Case/Privacy effect-handler pattern (C4) and LIC verification dependency (C11) need architect confirmation | CI boundary test definition; FR-CAS, FR-PRV, FR-LIC-002 |
| O-17 | ADR-09 provider eligibility: launch blocker until ≥2 payout routes confirmed in writing per launch market | FR-PAY (B-MKT); TR-FIN-08 |
| O-18 | Distributor device/bandwidth assumptions unvalidated (**OQ-03**); scripts-disabled statement rendering is a proposal | NFR-PERF-06; portal rendering architecture |
| O-19 | All ADRs are Provisional/Proposed — none founder-decided | Architecture sign-off |
