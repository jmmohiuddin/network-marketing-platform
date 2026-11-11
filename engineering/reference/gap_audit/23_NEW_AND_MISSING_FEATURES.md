# 23 — NEW AND MISSING FEATURES
## Features the gaps imply, with stage, trace and an explicit "do not build" list

| Field | Value |
|---|---|
| Document ID | GAP-23 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Rule | A feature appears only if it traces to a GAP, a problem `P-xx` or a compliance requirement `CMP-xx`. **Hygiene** = required to be credible but not a differentiator (GAP-081). **Differentiator candidate** = unvalidated; needs willingness-to-pay evidence |
| Stage | MVP · V1 · V2 · Enterprise · Not recommended. "MVP" here means "if the MVP is the engine-plus-compliance product (33 option P2)"; for option P4 (overlay) see 31 |

## 1. Feature catalogue additions

| ID | Feature | Module | Class | Stage | Traces to |
|---|---|---|---|---|---|
| F-01 | Positions separate from participants; several positions per participant | Genealogy | Hygiene | MVP | GAP-010, M1 |
| F-02 | Effective-dated sponsor and placement relationships; "tree as of date" | Genealogy | Hygiene | MVP | GAP-010 |
| F-03 | Genealogy change and correction cases (request, review, approve, effective date) with change windows | Genealogy | Hygiene | MVP | GAP-002, M2 |
| F-04 | Duplicate-account detection queue | Participants | Hygiene | MVP | GAP-002, T8 |
| F-05 | Account types: individual, joint, business entity; succession and transfer workflow | Participants | Hygiene | V1 | GAP-002 |
| F-06 | Downline visibility policy (field by depth) with server enforcement | Genealogy | Hygiene | MVP | GAP-012 |
| F-07 | Search-first genealogy explorer with lazy expansion | Genealogy | Hygiene | MVP | GAP-012, GAP-055 |
| F-08 | Plan configuration covering primitives from the 20–30 plan corpus (positions, participant types, ladders, scoped pools, priority caps, calendars) | Plans | Hygiene (breadth) / Differentiator candidate (speed of configuration) | MVP | GAP-020 |
| F-09 | Period lifecycle (open → calculated → committed → paid → closed) with late-transaction queue and restatement requests | Calculation | Hygiene | MVP | GAP-023 |
| F-10 | Run review: variance vs previous run, top movers, exception list, second-person approval | Calculation | Hygiene | MVP | GAP-023, GAP-065 |
| F-11 | Plan version compare and simulate on historical data; golden datasets; payee-level impact | Plans | Hygiene | MVP | GAP-026 |
| F-12 | Per-line provenance; staff "how calculated" trace; distributor explanation | Calculation | Differentiator candidate (depth of explanation) | MVP | GAP-027 |
| F-13 | Scoped, prioritised caps with simulation of who is cut | Calculation | Hygiene | MVP | GAP-022 |
| F-14 | Money rules: decimal minor units, rounding policy, remainder allocation, residue account | Ledger | Hygiene | MVP | GAP-021 |
| F-15 | Obligations sub-ledger (double entry, append-only) with GL journal export | Ledger | Hygiene | MVP | GAP-030, GAP-033 |
| F-16 | Payout batches with lifecycle, provider adapters, idempotent instructions, reconciliation, returned-payment queue | Payouts | Hygiene | MVP | GAP-030, GAP-035, MH-REQ-02..05 |
| F-17 | Bank-detail change controls (re-auth, notice, cooling-off) | Payouts | Hygiene | MVP | GAP-035, T5 |
| F-18 | Withholding tax engine per market and year; year-end forms (CP58 / TDS certificates / 1099) | Payouts | Hygiene (mandatory in market) | MVP (launch market) | GAP-031 |
| F-19 | Clawback policy options (order-line, restatement, write-off threshold) with receivable tracking | Ledger | Hygiene | MVP | GAP-032 |
| F-20 | Participant-type model and order purpose tag | Orders | Hygiene | MVP | GAP-028 |
| F-21 | Order, refund, customer and subscription ingestion API + Shopify and WooCommerce connectors | Integration | Hygiene | MVP | GAP-045 |
| F-22 | Attribution and customer ownership (serviced-by relationship, reassignment on termination) | Orders/CRM | Hygiene | MVP | GAP-040 |
| F-23 | Returns, exchanges, partial returns with line-level volume adjustments | Orders | Hygiene | MVP | GAP-047 |
| F-24 | **Compliance analytics**: retail-customer share, personal-consumption share of rewarded volume, payout-source attribution, qualification-by-purchase report | Compliance | **Differentiator candidate** | MVP | GAP-081, CMP-01..03, G-S02 |
| F-25 | **Earnings disclosure computed from payouts** (all participants, zero earners included), versioned and reproducible | Compliance | **Differentiator candidate** | V1 (MVP if US launch) | GAP-003, GAP-086, CMP-05 |
| F-26 | Platform guardrails: blocked / warned / reported configurations | Compliance | Hygiene for the vendor; possible trust differentiator | MVP | GAP-087 |
| F-27 | Fraud and integrity signals (rules, thresholds per tenant) | Compliance | Hygiene | V1 | GAP-005 |
| F-28 | Plan-change governance: draft → simulate → compliance review → filing status → notice → effective → transition report | Plans | Differentiator candidate | MVP | GAP-097 |
| F-29 | Migration toolkit: history import, parallel-run reconciliation report per payee | Implementation | **Differentiator candidate** | MVP | GAP-077 |
| F-30 | Data export of the full tenant data model (scheduled; documented) | Integration | Hygiene / trust | MVP | GAP-062, GAP-096 |
| F-31 | Read-only analytical replica access for dedicated tenants | Reporting | Hygiene (enterprise) | V1 | GAP-062 |
| F-32 | Vendor-staff support sessions: tenant-approved, time-boxed, logged, visible to tenant | Security | Trust differentiator candidate | MVP | GAP-065 |
| F-33 | Data-subject request tooling; retention timers; pseudonymisation preserving ledger integrity | Privacy | Hygiene (mandatory) | MVP | GAP-085 |
| F-34 | Data region per tenant (routing to regional database or cell) | Platform | Hygiene where required | MVP if India | GAP-061 |
| F-35 | Non-cash rewards ledger (credits with expiry) and redemption hooks | Ledger | Hygiene | V1 | GAP-024 |
| F-36 | Multi-currency with effective-dated rates | Ledger | Hygiene | V1 | GAP-034 |
| F-37 | Approved-claims catalogue and disclosure data feed for claims-monitoring partners | Compliance | Partner integration | V1 | GAP-001 |
| F-38 | Distributor statement (mobile-first, local language) with withholding, clawbacks and disclosure link | Distributor portal | Hygiene | MVP | GAP-027, GAP-051, GAP-003 |
| F-39 | Leader dashboard on customers served and repeat orders (no recruit leaderboards) | Distributor portal | Policy choice | V1 | GAP-050 |
| F-40 | Market gating on enrolment and shipping | Participants | Hygiene | MVP | GAP-006 |
| F-41 | Plan-document-to-configuration assistant (internal) | Implementation | Margin feature | V1 | GAP-071 |
| F-42 | Run variance explainer (summarises deterministic diff) | Calculation | Later | V1 | GAP-070 |
| F-43 | Brand dimension on plans, positions and orders | Platform | Hygiene (data model only) | MVP (data), Enterprise (tools) | GAP-095 |
| F-44 | Tenant archive mode and offboarding | Platform | Hygiene | V1 | GAP-098 |

## 2. Not recommended (with reasons)

| Feature | Reason | Trace |
|---|---|---|
| Platform-held wallets, e-pins, crypto payouts | Licensing exposure; excluded in 51 §5.4 | A-02 |
| Income projection or "what you could earn" calculators | Misleading for typical participants | GAP-003, G-S16, G-S27 |
| Recruit leaderboards, AI recruiting scripts, social-post generators | Push recruitment and earnings claims | GAP-070, G-S15 |
| Native storefront in the MVP | Large, undifferentiated; integrate instead | GAP-045 |
| Built-in LMS, video hosting | Partners exist (Rallyware) | 03 §7 |
| Social-media monitoring crawler | Specialist vendors exist | GAP-001 |
| Lead scoring for distributors' prospects | No evidence of need; privacy risk | GAP-041 |
| General ledger / accounts payable module | Tenants have ERPs | GAP-033 |
| Percentage-of-volume pricing | Ties vendor revenue to recruitment volume | GAP-075 |
| Tenant-specific code branches | Re-creates paid customisation; breaks reproducibility | GAP-020, 15 §5 |
