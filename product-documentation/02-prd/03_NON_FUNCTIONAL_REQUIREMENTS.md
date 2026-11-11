# 03 — NON-FUNCTIONAL REQUIREMENTS
## Measurable quality requirements, with the status of every number

| Field | Value |
|---|---|
| Document ID | PRD-03 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | CTO role |
| Depends on | PRD-01; gap audit 08, 15, 16, 29; TRD-01 |
| Status | Draft |

## 1. Status of the numbers

The research sets **no** performance, availability or recovery threshold: it says thresholds are the founder's and that setting them would invent requirements (gap audit 08 §6, 15 §6). To avoid vague statements, every requirement below has a number, and every number carries a status:

| Status | Meaning |
|---|---|
| **Confirmed** | Follows from a rule in the research or from the definition of correctness (for example, zero unexplained ledger difference) |
| **Proposed** | Engineering proposal; to be validated by the Phase C spike or confirmed by the founder before it becomes a commitment |
| **Market** | Depends on the launch market's law; value comes from the market pack |

Workload basis for proposed targets (assumed, gap audit 15 §2): mid-market tenant 50,000 positions, 100,000 orders a month, 30,000 payout lines per run; large tenant 2,000,000 positions, 3,000,000 orders a month, 600,000 payout lines per run; 30% of orders in the last three days of a monthly period; 20% of payees view statements on pay day.

## 2. Requirements

### Performance

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-PERF-01 | Interactive API read latency (lists, detail, statements after commit) | p95 ≤ 300 ms, p99 ≤ 800 ms at the server | Proposed |
| NFR-PERF-02 | API write latency (order ingestion, case actions) | p95 ≤ 500 ms | Proposed |
| NFR-PERF-03 | Order ingestion throughput per tenant | Sustained 50 orders/s, burst 200 orders/s for 10 minutes, with no loss (assumed large-tenant average at period end is 3.5/s) | Proposed |
| NFR-PERF-04 | Full run, mid-market tenant | ≤ 5 minutes | Proposed |
| NFR-PERF-05 | Full run, large tenant (2M positions, deep-leg binary depth 5,000) | ≤ 60 minutes; worker memory ≤ 8 GB | Proposed; **must be proven at the spike** |
| NFR-PERF-06 | Distributor statement page on a 3G-class profile (1.6 Mbit/s, 300 ms round trip) | Usable ≤ 3 s; transfer ≤ 150 KB excluding fonts cached | Proposed |
| NFR-PERF-07 | Genealogy authorisation check and subtree page (read model) | p95 ≤ 100 ms and ≤ 300 ms | Proposed |
| NFR-PERF-08 | Read-model rebuild after moving a subtree of 100,000 positions | ≤ 10 minutes, without blocking writes | Proposed |
| NFR-PERF-09 | Admin dashboard load | ≤ 2 s to first figures at p95 | Proposed |
| NFR-PERF-10 | Compliance snapshot for one year of a mid-market export | ≤ 2 minutes | Proposed |
| NFR-PERF-11 | Full data export, large tenant | ≤ 6 hours from the replica | Proposed |
| NFR-PERF-12 | Background job start delay | p95 ≤ 30 s from enqueue | Proposed |
| NFR-PERF-13 | Concurrent users | 500 staff and 20,000 distributor sessions per large tenant on pay day | Proposed |

### Scalability

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-SCAL-01 | A tenant can move from pooled to dedicated database without application change | Routing change plus data migration | Confirmed (GAP-060) |
| NFR-SCAL-02 | One tenant's run cannot starve others | Per-tenant worker concurrency limit; large tenants on dedicated workers | Confirmed |
| NFR-SCAL-03 | Calculation does not issue a recursive query per node | Tree loaded once per run | Confirmed (GAP-011) |
| NFR-SCAL-04 | Web tier is stateless and scales horizontally | — | Confirmed |

### Availability and reliability

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-AVAIL-01 | Monthly availability of API and portals, excluding announced maintenance | 99.9% | Proposed (incumbents advertise 99.99%, a Grade C claim) |
| NFR-AVAIL-02 | Planned maintenance never overlaps a tenant's cut-off or pay day | Maintenance calendar per region | Proposed |
| NFR-REL-01 | A failed run leaves no partial result visible and can be resumed from its snapshot | Always | Confirmed |
| NFR-REL-02 | External effects are delivered at least once and applied at most once | Outbox plus idempotency keys | Confirmed |
| NFR-REL-03 | Duplicate payments caused by the platform | 0 | Confirmed |

### Data integrity

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-INT-01 | Unexplained ledger difference per run | 0 minor units | Confirmed |
| NFR-INT-02 | Replay of a committed period | Identical ordered hash of lines | Confirmed |
| NFR-INT-03 | Allocations (pools, splits, scaled caps) | Parts sum exactly to the total | Confirmed |
| NFR-INT-04 | No binary floating point in money paths | Enforced by static check | Confirmed |
| NFR-INT-05 | Insert-only tables cannot be updated or deleted by the application | Database-enforced | Confirmed |
| NFR-INT-06 | Compliance snapshot recomputation from the same inputs and versions | Identical figures | Confirmed |

### Security and privacy

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-SEC-01 | Cross-tenant access through any endpoint | 0; automated suite covers 100% of endpoints in CI | Confirmed (SEC-01) |
| NFR-SEC-02 | MFA coverage of privileged roles and vendor staff | 100% | Confirmed (SEC-03) |
| NFR-SEC-03 | Encryption | TLS 1.2 or later in transit; AES-256 at rest; per-tenant keys for sensitive fields | Proposed |
| NFR-SEC-04 | Admin session lifetime; step-up window | 12 h absolute, 30 min idle; step-up factor ≤ 10 min old | Proposed |
| NFR-SEC-05 | Vendor access outside an approved session | 0 | Confirmed (SEC-02) |
| NFR-SEC-06 | Audit coverage of money, role, plan, export and vendor actions | 100% | Confirmed (SEC-09) |
| NFR-SEC-07 | Critical vulnerabilities in dependencies | Patched ≤ 7 days; high ≤ 30 days | Proposed |
| NFR-SEC-08 | Independent penetration test | Before first production tenant in MVP-B and yearly | Proposed |
| NFR-PRIV-01 | Data-subject request completion | Within the market deadline | Market |
| NFR-PRIV-02 | Breach notification to tenant | Without undue delay; timeline per market and DPA | Market |
| NFR-PRIV-03 | Personal data, backups and exports stay in the tenant's region | 100% | Confirmed where the market requires; design rule elsewhere |
| NFR-PRIV-04 | Overlay imports contain no direct identifiers or bank data | Rejected at upload | Confirmed (BR-IMP-01) |

### Disaster recovery

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-DR-01 | Recovery point objective | ≤ 5 minutes (continuous log archiving) | Proposed; founder sets (SEC-11) |
| NFR-DR-02 | Recovery time objective | ≤ 4 hours | Proposed; founder sets |
| NFR-DR-03 | Restore test | Quarterly, per region, with ledger invariant check after restore | Proposed |
| NFR-DR-04 | Committed run snapshots and audit archives | Retained for the legal retention period of the market | Market |

### Maintainability and observability

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-MAIN-01 | No tenant-specific code branches | 0; static check | Confirmed (BR-PLN-05) |
| NFR-MAIN-02 | Engine releases gated by golden and replay tests | 100% pass | Confirmed |
| NFR-MAIN-03 | Engine versions used by committed runs remain runnable | For the retention period | Confirmed |
| NFR-MAIN-05 | Hosted and self-hosted editions are built from the same commit; edition differences are configuration and licence entitlement only | 0 edition-specific code branches in the engine, ledger and guardrails | Confirmed (BR-LIC-05) |
| NFR-MAIN-06 | Self-hosted: supported versions | Current and previous minor release; upgrade path tested for every release | Proposed |
| NFR-MAIN-04 | Module boundaries enforced (no cross-module table writes) | Architecture test in CI | Proposed |
| NFR-OBS-01 | Per-tenant metrics: run duration and lines, ingestion lag, payout failure rate, outbox age, job queue age | Dashboards and alerts | Confirmed (gap audit 15 §6) |
| NFR-OBS-02 | Every request and job carries a correlation id into logs, traces and audit events | 100% | Proposed |
| NFR-OBS-03 | Logs contain no personal data, secrets or bank details | Automated scan | Proposed |
| NFR-OBS-04 | Alert on: unbalanced entry attempt, replay mismatch, audit chain break, outbox age > 5 min, sync lag at cut-off | Paging | Proposed |

### Usability, accessibility and localisation

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-ACC-01 | Accessibility standard | WCAG 2.2 level AA for portal and admin | Confirmed as target (GAP-051) |
| NFR-ACC-02 | Keyboard operation of tables, tree explorer and approval flows | 100% of functions | Proposed |
| NFR-USE-01 | First-time task success in usability tests of the five highest-risk screens | ≥ 80% of 5 participants per role without help | Proposed |
| NFR-USE-02 | A new distributor can find net pay and open "how calculated" | ≤ 2 taps from home | Proposed |
| NFR-USE-03 | Minimum body text size on distributor pages | 16 px; touch targets ≥ 44 × 44 px | Proposed |
| NFR-LOC-01 | Languages | Admin: English first. Distributor pages: the market pack's languages at launch | Market |
| NFR-LOC-02 | All user-visible text externalised; locale-aware numbers, dates, currency; right-to-left ready layout | 100% | Proposed |
| NFR-LOC-03 | Untranslated keys in a release | 0 for market languages | Proposed |

## 3. Requirements needing validation before commitment

NFR-PERF-04, -05, -07, -08 (spike, QA TS-29); NFR-DR-01, -02 and NFR-AVAIL-01 (founder, cost trade-off); NFR-PERF-06 and NFR-USE-* (usability testing with distributors, which the research has not done); all **Market** items (advisers).
