# 03 — RESEARCH COVERAGE MATRIX
## The brief's fourteen gap domains against what the original research covered

| Field | Value |
|---|---|
| Document ID | GAP-03 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Status scale (brief §9) | **Missing** = completely missing · **Inadequate** = inadequately researched · **Incorrect** = incorrect or unsupported · **Inconsistent** · **Validate** = needs deeper validation · **Sufficient** = already sufficiently addressed (for this stage) |

## 1. Domain-level view

| # | Domain (brief §5) | Where the original covers it | Status | This audit | Gaps |
|---|---|---|---|---|---|
| 1 | Hidden industry problems | 06 (18 problems), 12, 51 | **Inadequate** | 07 | GAP-001..006 |
| 2 | Genealogy and organisational intelligence | 13 §3 (one row: "Hierarchy"), 13 §5 edge cases 1, 4, 8 | **Missing** (as a design subject) | 08 | GAP-010..013 |
| 3 | Compensation engine | 13, 15, 51 CMP-04/19 | **Inadequate** (principles right; taxonomy incomplete; money arithmetic unspecified) | 09 | GAP-020..028 |
| 4 | Financial systems and transaction integrity | 51 §5 (payout legality, MH-REQ-01..10) | **Inadequate** (legal boundary only; no ledger, tax, FX) | 10 | GAP-030..035 |
| 5 | CRM and sales intelligence | 10 J-06, J-07 (marked "not researched") | **Missing** | 11 | GAP-040, 041 |
| 6 | Customer experience and commerce | 10 J-08, J-09, J-17; 06 P-11, P-12 | **Inadequate** | 12 | GAP-045..047 |
| 7 | Distributor productivity and behaviour | 06 P-06, P-09, P-10 (all hypothesis) | **Missing** (evidence) | 13 | GAP-050, 051, GAP-003 |
| 8 | Advanced UX and interface design | None (Wave 6) | **Missing** | 14 | GAP-055 |
| 9 | Technical architecture stress test | 13 §7.3 (declarative vs plugin, inference) | **Missing** | 15 | GAP-060..062 |
| 10 | Security and fraud prevention | 06 P-04, P-14; 08 §6 RBAC sketch | **Inadequate** | 16 | GAP-065, 066, GAP-005 |
| 11 | AI and intelligence | 04 §4 (three vendors mention AI); C5 | **Inadequate** (challenge only) | 17 | GAP-070, 071 |
| 12 | Business model and market | 02, 05, 12 (tenant model only) | **Inadequate** (platform model missing) | 18 | GAP-075..077 |
| 13 | Competitor blind spots | 03, 04 | **Inadequate** | 19 | GAP-080, 081 |
| 14 | Regulatory and ethical | 51 (12-jurisdiction screen), CMP-01..19 | **Inadequate** (direct-selling law screened; platform-binding laws absent) | 20 | GAP-085..088 |
| — | Beyond the brief (§6) | Not addressed | **Missing** | 21 | GAP-095..098 |
| — | Process and evidence | Roadmap, register | **Inconsistent / Validate** | 02, 04, 06 | GAP-100..103 |

## 2. Sub-topic view (each sub-item named in the brief)

`●` covered adequately for this stage · `◐` touched, inadequate · `○` not covered · `✕` covered but wrong or unsupported.

### Domain 1 — Hidden industry problems

| Sub-topic | Cov. | Note |
|---|---|---|
| Distributor inactivity, churn, sponsor inactivity, downline abandonment | ◐ | P-06 net counts at one company only; AARP and income disclosures unused (GAP-003) |
| Network conflicts, sponsor reassignment, genealogy correction disputes | ○ | GAP-002 |
| Account duplication, fake accounts, multiple-account abuse | ○ | Listed "not researched" (06 §3); GAP-002, GAP-065 |
| Self-purchasing to qualify, inventory loading, manipulated volume, rank manipulation | ◐ | P-14 (one employer's job duty); no detection definitions (GAP-005) |
| Fake retail customers | ◐ | CMP-01 tagging; no verification method (GAP-005) |
| Commission manipulation, distributor fraud | ◐ | P-14; insider and admin fraud absent (GAP-065) |
| Cross-line purchasing, unauthorised activity, international conflicts | ○ | GAP-006 |
| Termination, customer-ownership, commission disputes | ◐ | J-16; no dispute process (GAP-002, GAP-040) |
| Returns and refunds after payout | ● | P-12, EX-8, D-R2/D-R3 (decision still open) |
| Unethical income claims | ◐ | CMP-05; social-media claims volume missed (GAP-001) |
| Company–distributor trust | ○ | GAP-003, GAP-027 |

### Domain 2 — Genealogy

| Sub-topic | Cov. | Note |
|---|---|---|
| Sponsor vs placement tree | ◐ | Named (13 §3) but not modelled |
| Binary, unilevel, matrix, generation structures | ◐ | Plan types only; multiple business centres per person missing (GAP-010) |
| Historical genealogy, tree changes, effective dating, immutable snapshots | ○ | GAP-010 |
| Placement restrictions, spillover | ◐ | EX-4 only |
| Compression, roll-up, breakaway | ◐ | EX-1b, EX-3; roll-up vs compression not distinguished (GAP-013) |
| Re-entry, suspension, termination, inactive nodes | ◐ | J-14, J-16, BR-TRM-03/04 (no rules) |
| Cross-border genealogy | ○ | GAP-010, GAP-061 |
| Large trees, search performance | ○ | V-06 never run (GAP-011) |
| Historical commissions after genealogy change | ◐ | Edge case 1 (13 §5), unanswered (GAP-023) |

### Domain 3 — Compensation engine

| Sub-topic | Cov. | Note |
|---|---|---|
| Multiple plans, versioning, effective dates | ● | 13 §7.1, CMP-04 (principle) |
| Rule precedence, calculation ordering | ◐ | 13 §7.2; caps oversimplified (GAP-022) |
| Qualification periods, PV/GV/CV, retail volume | ◐ | Rolling windows, count-based rules, participant types missing (GAP-025, GAP-028) |
| Binary carryover, compression, caps, thresholds, minimum payout | ◐ | Conditional carry, carry caps, priority caps missing (GAP-020, GAP-022) |
| Rank advancement and maintenance | ◐ | BR-RNK-03 "not researched"; paid-as vs title missing (GAP-025) |
| Leadership, matching, generation bonuses | ● | EX-6, EX-7; dynamic generations not covered (GAP-020) |
| Holds, refunds, chargebacks, retroactive adjustments, recalculation | ◐ | Policy open; period lifecycle missing (GAP-023, GAP-032) |
| Disputes, manual corrections | ◐ | Exception queue named; no dispute workflow (GAP-002) |
| Reproducibility, auditability, provenance | ● | Principle stated; explain trace not specified (GAP-027) |
| Simulation, test scenarios | ◐ | Treated as candidate differentiator; it is table stakes (GAP-026, GAP-081) |

### Domain 4 — Financial systems

| Sub-topic | Cov. | Note |
|---|---|---|
| Double-entry, ledger design, immutability, idempotency | ◐ | MH-REQ-01, -03 (principles only) (GAP-030) |
| Reconciliation, settlement, payment failures, payout reversals | ◐ | MH-REQ-04, -05 (GAP-035) |
| Refund accounting, chargebacks, negative balances, holds | ◐ | EX-8, D-R3 (GAP-032) |
| Multi-currency, FX history | ○ | GAP-034 |
| Tax handling | ✕ | US-only and outdated (GAP-031) |
| Approvals, audit trail, reporting | ◐ | MH-REQ-02 |
| Accounting integration vs subsystem; statement vs ledger vs wallet vs regulated account | ◐ | 51 §5.4 options are sound; terminology boundaries not written (GAP-033) |

### Domains 5–14 (summary)

| Domain | Sub-topics covered (●/◐) | Sub-topics not covered (○) |
|---|---|---|
| 5 CRM | Lead conversion journey (◐) | Ownership, assignment, duplication, scoring, attribution, company vs distributor CRM, forecasting |
| 6 Commerce | Autoship consent (◐), returns (◐) | Guest checkout, customer accounts, conversion, warehouses, variants, promotions, loyalty, reviews, support, build vs integrate |
| 7 Productivity | Attrition (◐) | Onboarding friction, time to first sale, training, motivation, recognition, mobile, accessibility, language |
| 8 UX | — | All sub-topics |
| 9 Architecture | Engine design choice (◐) | Tenancy, workloads, jobs, events, locking, caching, search, reporting, API, webhooks, DR, observability, deployment |
| 10 Security | Breach case (◐), bonus buying (◐), RBAC sketch (◐) | Tenant isolation attacks, privilege escalation, insider threat, takeover, API abuse, mass extraction, identity fraud, unauthorised adjustments |
| 11 AI | Challenge C5 (◐) | Every use case evaluation |
| 12 Business model | Segments (◐), price anchors (◐) | Platform pricing, cost to serve, services, white-label, API offering, usage pricing |
| 13 Competitors | 14 brief names (●), 18 vendors at V1 (◐) | New entrants, local vendors, plugins, adjacent compliance vendors, documentation-level capability |
| 14 Regulatory | Pyramid tests, licensing, payout legality (●) | Platform privacy duties, tax withholding, payment-provider policies, advertising and social-media claims, subscriptions outside the US, communications, accessibility, worker status |
