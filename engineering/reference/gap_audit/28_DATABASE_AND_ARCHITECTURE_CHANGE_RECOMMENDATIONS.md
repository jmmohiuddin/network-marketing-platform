# 28 — DATABASE AND ARCHITECTURE CHANGE RECOMMENDATIONS
## Entities, invariants and architecture decisions the first design must start from

| Field | Value |
|---|---|
| Document ID | GAP-28 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Status | **Recommendations for documents that do not exist yet** (GAP-100). Not a schema; names are indicative |
| Basis | 08, 09, 10, 15, 16 of this audit |

## 1. Core entities

| ID | Entity | Key attributes | Invariants | Gap |
|---|---|---|---|---|
| ENT-01 | Tenant | region, residency policy, settings version | Every row of every tenant-scoped table carries tenant id enforced in the data layer | GAP-060, GAP-065 |
| ENT-02 | Brand / Market | tenant, brand, market, currency, tax regime, calendars | Plans and orders reference a market | GAP-095 |
| ENT-03 | Participant | type (effective-dated), account type (individual/joint/entity), identity refs, tax profile ref | Type changes are dated, not overwritten | GAP-028 |
| ENT-04 | Position | owner participant (effective-dated), market, status history | A participant may own many positions | GAP-010 |
| ENT-05 | Relationship | kind (sponsor/placement), parent position, child position, valid_from, valid_to, recorded_at, superseded_at, event id | Append-only; no cycles; at most one active parent per kind per child at any valid time | GAP-010 |
| ENT-06 | Genealogy event / case | kind (change/correction/transfer/merge), request, approvals, evidence | Approved before effect | GAP-002 |
| ENT-07 | Path read model | position, path (materialised), as-of | Rebuildable from ENT-05 | GAP-011 |
| ENT-08 | Customer servicing | customer participant, servicing position, valid_from/to | One active servicer at a time | GAP-040 |
| ENT-09 | Order / order line (ingested) | source system id, idempotency key, buyer type, purpose, attribution, volumes per line, crediting event time | Fields fixed at ingestion; edits arrive as new events | GAP-045, GAP-028 |
| ENT-10 | Return / refund / chargeback event | order line refs, amounts, volume effect | Linked to original lines | GAP-047 |
| ENT-11 | Plan version | rules (declarative), extension refs, effective dates, transition rules, approvals, filing status | Immutable after activation | GAP-020, GAP-097 |
| ENT-12 | Period / calendar | calendar, period, state, cut-off time zone | State machine BR-PER-03 | GAP-023 |
| ENT-13 | Run | period, plan version, input snapshot ref, status, run request id | One committed run per period per calendar | GAP-023 |
| ENT-14 | Result line | run, payee position, rule id, amount (minor units), compact trace | Sum of lines = run total | GAP-027 |
| ENT-15 | Qualification state | position, period, paid-as rank, highest title, counters, carry balances, one-time flags | Output of a committed run only | GAP-025 |
| ENT-16 | Journal entry / posting | account, amount, currency, run or case ref, idempotency key, approver | Balanced; append-only | GAP-030 |
| ENT-17 | Payout batch / instruction | provider, state, idempotency key, signature, provider ref | Instruction at most once per key | GAP-035 |
| ENT-18 | Tax rule / tax line | market, effective dates, rate, threshold basis; per-line withholding | Rules effective-dated | GAP-031 |
| ENT-19 | Bank detail version | payee, encrypted details, verified_at, cooling-off until | New versions only | GAP-035 |
| ENT-20 | Credit type / credit balance | value, expiry, redemption scope | Liability per type | GAP-024 |
| ENT-21 | Compliance report snapshot | period, method version, figures, population | Reproducible from runs | GAP-081, GAP-086 |
| ENT-22 | Guardrail decision | rule id, outcome (blocked/warned/reported), override justification | Immutable | GAP-087 |
| ENT-23 | Access session (vendor) | requester, approver, scope, start/end, actions | Time-boxed | GAP-065 |
| ENT-24 | Audit event | actor, action, object, before/after refs | Separate store, append-only | GAP-065 |
| ENT-25 | Privacy request | type, subject, deadline, outcome | Logged | GAP-085 |

## 2. Architecture decision records to write first

| ADR | Decision (recommended) | Alternatives considered | Why |
|---|---|---|---|
| ADR-01 | Modular monolith; calculation on a separate worker pool | Microservices | One team, strong consistency for ledger and runs; separate later only on triggers in 15 §4 |
| ADR-02 | One relational database per tenant **capability** (routing), pooled by default | Shared schema only; DB per tenant only | Residency and large tenants without day-one cost |
| ADR-03 | Bitemporal, append-only genealogy (ENT-05) | Update-in-place parent column | Reproducibility, disputes |
| ADR-04 | In-memory tree per run; path read model for UI | Closure table; graph DB | Deep binary trees; write cost |
| ADR-05 | Declarative rule primitives + sandboxed extension point, both versioned | Code per tenant; DSL only | GAP-020 breadth vs auditability |
| ADR-06 | Money in minor units; rounding once per line; largest-remainder allocation | Floats; per-step rounding | GAP-021 |
| ADR-07 | Double-entry obligations sub-ledger + GL export | General ledger in product | GAP-030, GAP-033 |
| ADR-08 | Integrate commerce; ingestion API with idempotency | Native storefront | GAP-045 |
| ADR-09 | Provider-adapter interface for payments and payouts; at least two eligible providers per launch market | Single mainstream provider | GAP-004 |
| ADR-10 | Outbox for all external effects; idempotency keys everywhere | Direct calls | Payout safety |
| ADR-11 | Reporting via replica or export, never ad-hoc SQL on primary | Shared BI on primary | GAP-062 |
| ADR-12 | Vendor access through approved, logged sessions only | Standing admin access | GAP-065 |
| ADR-13 | Erasure by pseudonymisation where ledger retention applies | Hard delete | GAP-085 |
| ADR-14 | Brand and market dimensions in the data model from day one | Add later | GAP-095 |

## 3. What the original research's database planning missed

The Master Plan's R-26 listed storage options for the hierarchy (closure table, nested set, materialised path, graph) and data isolation. It did not list: **positions separate from people**, **bitemporal relationships**, **period state**, **run snapshots**, **result traces**, **ledger**, **tax lines**, **bank detail versions**, **guardrail decisions** or **vendor access sessions**. Those are the entities where money and liability live.
