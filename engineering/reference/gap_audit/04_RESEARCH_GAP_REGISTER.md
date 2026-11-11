# 04 — RESEARCH GAP REGISTER
## Every gap found, with severity, status, timing and where its full record lives

| Field | Value |
|---|---|
| Document ID | GAP-04 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Full records | Each gap has a full 14-field record (brief §11) in the domain document named in the "Record" column. This register is the index |
| Totals | **57 gaps**: 13 Critical, 26 High, 16 Medium, 2 Low |

## 1. How priority was set (no false precision)

- **Severity** follows brief §9: **Critical** = could cause legal, financial, security or fundamental product failure; **High** = major business or user impact; **Medium** = important improvement; **Low** = minor.
- Severity is a **judgement on consequence**, made explicit in each full record. No numeric score is used here, because the inputs a score needs (frequency, cost, reach) are unknown for most gaps.
- **Timing** uses dependency analysis: a gap is "Before MVP" when an MVP scope or architecture decision cannot be made safely without it; "MVP" when the first sellable version must contain the capability; later stages otherwise.
- RICE is applied only where its inputs can be stated, for candidate MVP capabilities in 31, with every assumption written down.

Columns: **Status** (brief §9 research status) · **Impact** (brief §9 product impact) · **Stage** · **Conf.** = confidence in the gap itself.

## 2. Register

### Process and evidence

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-100 | No PRD, architecture, database, API, UX, test or financial documents exist; nothing to build from | Critical | Missing | Strategic, Technical | Before MVP | High | 22 |
| GAP-101 | Gate G3 could not pass on desk research by design, and obtainable desk evidence was not used before failing it | High | Inconsistent | Strategic | Before MVP | High | 33 |
| GAP-102 | 57 of 129 sources read in full; primary legal texts unread; recapture list stale since Wave 2 | Medium | Validate | Compliance | Before MVP | High | 05 |
| GAP-103 | This audit is not independent (same system, same session) | High | Validate | Strategic | Before MVP | High | 32 |

### Industry (07)

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-001 | Earnings and health claims on social media: frequent (DSSRC monitoring) and missed; specialist vendors already exist | High | Missing | Compliance, Commercial | V1 (integrate) | High (problem) / Low (willingness to pay) | 07 |
| GAP-002 | Genealogy and account-integrity disputes (sponsor change, cross-line, duplicates, multiple accounts, succession, divorce, transfer) | High | Missing | Operational, Technical | MVP (rules) | Medium | 07 |
| GAP-003 | Distributor outcome evidence unused; product must not imply income and must measure honestly | High | Inadequate | Compliance, Strategic, UX | MVP (policy) | Medium-High | 07 |
| GAP-004 | Mainstream payment providers prohibit or restrict MLM merchants | **Critical** | Incorrect (06 P-16) | Technical, Commercial | Before MVP | High | 07 |
| GAP-005 | No operational definitions for inventory loading, bonus buying, fake customers | Medium | Inadequate | Compliance, Security | V1 | Medium | 07 |
| GAP-006 | Unauthorised channels and cross-border selling conflicts | Low | Missing | Operational | V2 | Low | 07 |

### Genealogy (08)

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-010 | No effective-dated sponsor and placement model; multiple positions per person; corrections without rewriting history | **Critical** | Missing | Technical, Financial | MVP | High | 08 |
| GAP-011 | No storage and query strategy; V-06 benchmark never run; no workload model | High | Missing | Technical | Before MVP (spike) | Medium | 08 |
| GAP-012 | Downline visibility, privacy and large-tree search and display | High | Missing | Security, UX | MVP | Medium | 08 |
| GAP-013 | Placement, spillover, compression, roll-up, breakaway and re-parenting are distinct, versioned behaviours | High | Inadequate | Financial, Technical | MVP (plan types in scope) | High | 08 |

### Compensation engine (09)

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-020 | Building blocks miss at least 15 mechanism classes found in current public plans | **Critical** | Incorrect | Technical, Strategic | Before MVP | High | 09 |
| GAP-021 | Money arithmetic unspecified (decimal units, rounding, remainder allocation, FX order, points factor) | High | Missing | Financial | MVP | High | 09 |
| GAP-022 | Caps are scoped and prioritised, not one proportional scale | High | Incorrect (simplified) | Financial, Compliance | MVP | High | 09 |
| GAP-023 | No period lifecycle or retroactivity model | **Critical** | Missing | Financial, Technical | MVP | High | 09 |
| GAP-024 | Non-cash rewards (product credits, store currency, trips) need their own ledger | Medium | Missing | Financial | V1 | High | 09 |
| GAP-025 | Qualification state (paid-as vs title, rolling windows, grace, streaks, one-time bonuses, mixed cadences) | High | Inadequate | Technical | MVP | High | 09 |
| GAP-026 | Plan test harness (golden datasets, parallel run) is table stakes, not a differentiator | High | Incorrect (framed as gap) | Technical, Commercial | MVP | High | 09 |
| GAP-027 | Per-line calculation provenance and "why was I paid this" trace | High | Inadequate | UX, Compliance | MVP | Medium | 09 |
| GAP-028 | Participant types beyond customer vs participant | High | Inadequate | Compliance, Technical | MVP | High | 09 |

### Financial systems (10)

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-030 | No ledger design (double entry, immutability, idempotency, reconciliation) | **Critical** | Inadequate | Financial, Technical | MVP | High | 10 |
| GAP-031 | Payout withholding and tax reporting in each launch market | **Critical** (launch market) | Incorrect (US-only, outdated) | Financial, Compliance | MVP | Medium-High | 10 |
| GAP-032 | Negative balance and clawback policy undecided | High | Inadequate | Financial, Compliance | MVP (decision) | High | 10 |
| GAP-033 | Boundaries between statement, ledger, wallet, payment processing and regulated account; GL export not an accounting system | Medium | Inadequate | Financial | MVP | High | 10 |
| GAP-034 | Multi-currency and FX rate history | Medium | Missing | Financial | V1 | Medium | 10 |
| GAP-035 | Payout failures, returns, unclaimed funds, bank-detail change controls | High | Inadequate | Financial, Security | MVP | High | 10 |

### CRM, commerce, productivity, UX (11–14)

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-040 | Customer ownership and attribution are commission inputs | High | Missing | Financial, Operational | MVP (attribution) | Medium | 11 |
| GAP-041 | Distributor-held contact data: controllership and consent | Medium | Missing | Compliance | V1 | Medium | 11 |
| GAP-045 | Build vs integrate commerce undecided while the market unbundles | High | Missing | Strategic, Technical | Before MVP | Medium | 12 |
| GAP-046 | Subscription lifecycle and chargebacks | Medium | Inadequate | Operational, Compliance | V1 | Medium | 12 |
| GAP-047 | Returns, exchanges and partial returns and their volume effects | Medium | Inadequate | Financial | MVP (rules) | Medium | 12 |
| GAP-050 | Productivity metrics must target retail customers and sustainable activity | Medium | Missing | Growth, Compliance | V1 | Medium | 13 |
| GAP-051 | Language, accessibility, low bandwidth for target users | Medium | Missing | UX | MVP if India or Malaysia | Medium | 13 |
| GAP-055 | No IA, screens or states; statement and genealogy usability | High | Missing | UX | Before UX work | High | 14 |

### Architecture, security, AI (15–17)

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-060 | No architecture or workload model | **Critical** | Missing | Technical | Before MVP | Medium | 15 |
| GAP-061 | Data residency and regional deployment | High | Inadequate | Technical, Compliance | MVP if India | Medium | 15 |
| GAP-062 | Buyers expect SQL-level reporting access | Medium | Missing | Technical, Commercial | MVP | Medium | 15 |
| GAP-065 | Vendor-staff access, insider threat, payout fraud, tenant isolation | **Critical** | Missing | Security | MVP | High | 16 |
| GAP-066 | Security attestations expected by buyers | High | Missing | Commercial, Security | V1 | Medium | 16 |
| GAP-070 | AI use cases evaluated; most rejected | Medium | Inadequate | Strategic | V2 | Medium | 17 |
| GAP-071 | Plan-document-to-configuration assistant for implementation staff | Medium | Missing | Operational | V1 (internal) | Low | 17 |

### Business model, competitors, regulation, other (18–21)

| ID | Gap | Severity | Status | Impact | Stage | Conf. | Record |
|---|---|---|---|---|---|---|---|
| GAP-075 | Platform business model and cost to serve absent; low-price competition in India and Malaysia | **Critical** | Missing | Strategic, Commercial | Before MVP | High | 18 |
| GAP-076 | Segment and market choice weakly grounded; founder access decisive | **Critical** | Validate | Strategic | Before MVP | Medium | 18 |
| GAP-077 | Migration and implementation as product | High | Inadequate | Commercial, Operational | MVP | Medium | 18 |
| GAP-080 | Competitors missed (new entrants, local vendors, plugins, adjacent compliance tools) | High | Inadequate | Strategic | Before MVP | High | 19 |
| GAP-081 | Incumbent documentation shows several "gaps" are table stakes | **Critical** | Incorrect | Strategic | Before MVP | High | 19 |
| GAP-085 | Platform's own privacy duties as a processor | High | Missing | Compliance, Technical | MVP | Medium-High | 20 |
| GAP-086 | FTC earnings-claim proposal: substantiation and records | High (US) | Inadequate | Compliance | V1 | Medium | 20 |
| GAP-087 | Which compliance behaviour is mandatory vs configurable; vendor liability (Q-1) | **Critical** | Validate | Compliance, Strategic | Before MVP | Unknown | 20 |
| GAP-088 | Communications consent, subscription law outside the US, accessibility law, worker status | Medium | Missing | Compliance | Per market | Low | 20 |
| GAP-095 | Company mergers, multi-brand tenants, genealogy merges | Medium | Missing | Technical | Enterprise | Low | 21 |
| GAP-096 | Exit and data-portability guarantee as a trust asset | Medium | Missing | Commercial | V1 | Medium | 21 |
| GAP-097 | Plan-change governance with the field (grandfathering, notice) | High | Missing | Operational, Compliance | MVP | Medium | 21 |
| GAP-098 | Company wind-down: final payouts, retention, data return | Low | Missing | Operational | V1 | Low | 21 |

## 3. Critical gaps at a glance (13)

GAP-004 payment acceptance · GAP-010 genealogy model · GAP-020 taxonomy · GAP-023 period lifecycle · GAP-030 ledger · GAP-031 payout tax · GAP-060 architecture · GAP-065 insider and payout fraud · GAP-075 business model · GAP-076 segment choice · GAP-081 table stakes · GAP-087 mandatory compliance and vendor liability · GAP-100 no product documents.

**Dependency order** (what must be settled first): GAP-076 and GAP-075 (who and how we make money) → GAP-081 and GAP-087 (what is actually differentiated, and what we must enforce) → GAP-004 and GAP-031 (can money move in the launch market, with what tax steps) → GAP-020, GAP-010, GAP-023, GAP-030 (engine, genealogy, periods, ledger) → GAP-060 and GAP-065 (architecture and security) → GAP-100 (write the product documents).
