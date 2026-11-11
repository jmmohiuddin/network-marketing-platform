# DECISIONS AND OPEN QUESTIONS — engineering brief

Domain: DECISIONS. Built from GOV-02 (decision log), GOV-03 (open questions), GOV-01 (index), PD-01 (vision), PD-02 (strategy), SYN-00 (master synthesis), cross-checked against `09-governance/traceability-data/spec.json`. All source documents are v0.1, dated 2026-11-12, **Draft, not approved**. Nothing has been reviewed by an independent reviewer (FD-07).

Release tags: **A** = MVP-A (compliance-analytics overlay) · **B** = MVP-B (engine + ledger + payouts + compliance) · **B-MKT** = MVP-B, content supplied per market pack · **V1** = after MVP-B. A release marked "(inferred)" is not stated in the source; it is derived from the decision's consequences.

---

## 0. How to use this brief

| Status (GOV-02) | Meaning for engineering |
|---|---|
| **Decided (founder)** | Build to it. Changing it needs the founder. |
| **Decided as a rule of this documentation** | Build to it (DEC-14). |
| **Provisional** | Build to it as the working assumption, but keep it reversible/configurable; it needs founder, counsel, adviser or a spike. |
| **Proposed** | Engineering proposal, not reviewed. Engineering may refine without founder sign-off unless it touches scope, money, law or pricing. |

Reading rule (GOV-03): any requirement depending on an open item is **provisional**; the documents proceed on the stated working assumption; the assumption is **not** a decision.

Business-rule status codes (PRD-04): **R** primary source read · **S** screening (secondary source) · **D** design rule (our judgement) · **C** needs counsel or tax adviser before relied on. Combined: `S/C`, `R/C`, `D/C`. Rule scope `at`: **P** platform · **T** tenant · **M** market · **V** plan version. Spec counts: D 87, R 14, C 6, S 5, S/C 3, R/C 2, D/C 2 (119 rules).

---

## 1. Product vision and positioning (10 lines)

1. Product: **compensation and compliance back end for direct-selling companies** — positioning "the compensation and compliance back end you can audit". **Not** all-in-one network-marketing software (DEC-01, C-1).
2. Vision: companies can prove what they pay and why — every commission traceable to a sale, every period reproducible, every compliance figure computed from real transactions, every distributor able to understand their statement.
3. Buyer = the company (A-01); distributors are users; retail customers are data subjects, not users (DEC-13).
4. **MVP-A (A)**: overlay on the operator's existing back-office export; 5 reports R1–R5 (FR-CPL-001..005): retail-customer share, personal-use share of rewarded volume, payout-source mix, qualification-by-purchase indicators, earnings distribution incl. zero earners. It is a **demand test**.
5. **MVP-B (B)**: API-first engine (effective-dated genealogy, period lifecycle, obligations ledger, payouts via tenant's own providers, market-pack tax, per-line provenance, same compliance reports natively) behind any commerce front end. Built **only if** gates G3′ and G4′ pass.
6. Only unclaimed differentiator found: compliance analytics from transaction data (GAP-081); demand unproven. Reversals, adjustments, approvals, committed periods, plan sandbox, projected commissions are **table stakes** — build, never market as differentiators (C-2).
7. Two editions, one codebase (DEC-17, ADR-16): hosted SaaS (primary, first) and licensed self-hosted single-tenant cell (V1).
8. Market-neutral core; all market rules in market packs (DEC-02). India recommended first pack (DEC-21, Proposed); no Bangladesh MLM pack (DEC-20).
9. Platform calculates and instructs; never holds funds; no wallets, e-pins, crypto (DEC-03).
10. Strategy: "Prove the narrow whitespace cheaply, then build the engine only if buyers want to replace theirs." No calendar dates exist (FD-03 open).

---

## 2. Explicit refusals — the product must NOT

| # | Refusal | Source IDs | Enforced by | Rel |
|---|---|---|---|---|
| X-01 | No income projections, potential-earnings calculators, or recruit leaderboards anywhere in UI or API | DEC-05, FD-09, BR-HON-01, PD-01 principle 1 | BR-HON-01 (P, D); FR-CPL-005, FR-DIST-001, FR-DIST-003, FR-DIST-009; TS-53 scans statement/rank pages for projection content | A (rule); B (portal: FR-DIST-001/003); V1 (FR-DIST-009 leader dashboard) |
| X-02 | Earnings shown to participants/prospects only from real payouts, including zero earners; link published disclosure when one exists | DEC-05, BR-HON-02, CMP-05 | FR-CPL-005 (A), FR-CPL-009 (V1) | A / V1 |
| X-03 | No wallets, stored value, e-pins, crypto; never hold participant funds. Use "earnings balance owed by the tenant", derived from the ledger | DEC-03, C-12, A-02, MH-REQ (no crypto/e-pins) | FR-FIN-002 derived balances; tenant-owned provider accounts (ADR-09) | B |
| X-04 | Never initiate a debit from a distributor's bank account | BR-REV-09 (P, D) | FR-FIN-003 | B |
| X-05 | No tenant-specific code branches; extensions only as expressions or platform-reviewed modules available to all tenants | BR-PLN-05, ADR-05 | FR-PLN-003 | B |
| X-06 | Never modify tree structure to implement a pay rule (compression, roll-up, breakaway) | BR-GEN-07, FR-GEN-009 | TS-02 | B |
| X-07 | No standing vendor-staff access to tenant data | BR-SEC-01, ADR-12, BR-LIC-04 | FR-IAM-005, FR-OPS-001, FR-LIC-003 | A (V1 for self-hosted) |
| X-08 | Never accept tenant id from the client | BR-SEC-04 | FR-IAM-001 | A |
| X-09 | No ad-hoc SQL on the primary for reporting | ADR-11 | Export (B), replica FR-INT-004 (V1) | B / V1 |
| X-10 | Platform does not certify plan legality — "indicators, not verdicts" | PD-01 principle 9; SYN-00 §2.9 | Copy/UI; GTM never "proof your plan is legal" | A |
| X-11 | No numeric rate, threshold or window hard-coded anywhere; values come from settings/market packs; tests use labelled fixtures | DEC-14 | Config model; BR-CPL-03 basis status | A |
| X-12 | No percentage-of-volume pricing; no cheap one-time licence without maintenance; no source-code or white-label resale edition | DEC-07, PD-02 §5, BR-LIC-05 | Commercial; BR-LIC-05 (V1) | — / V1 |
| X-13 | No native storefront, inventory, LMS, marketing automation, CRM pipelines, general ledger, social-media monitoring — integrate or drop | DEC-01, DEC-06, ADR-07, ADR-08 | Ingestion API + connectors (FR-ORD-001/002); GL export (FR-FIN-005) | B |
| X-14 | No workflow builder; fixed approval flows with a status component | DEC-11 | UI-04 §3.8 | B |
| X-15 | No native mobile app in MVP; responsive installable web app | DEC-12 | WF-06, UI-05 | A/B |
| X-16 | No customer accounts / storefront screens; only two public customer-facing pages | DEC-13 | WF-05 | B |
| X-17 | No recruiting tools; no platform-held value; no percentage-of-volume pricing (long-term exclusions) | PD-01 §9 | — | all |
| X-18 | Licence lapse never blocks calculation, commit, payout, statements or export; only new engine versions, pack updates, support stop | DEC-18, BR-LIC-01 | FR-LIC-001 | V1 |
| X-19 | Self-hosted must not require a call home to run (offline signed licence) | BR-LIC-02 | FR-LIC-001 | V1 |
| X-20 | Do not sell to Bangladeshi MLM operators; tenants cannot select Bangladesh for multi-level plans | DEC-20 | Market gating (FR-PAR-002, FR-TEN-004) | B |
| X-21 | Do not market: breadth, commission accuracy as novelty, AI, plan legality, any income outcome | PD-01 §7 | GTM | — |
| X-22 | AI limited to summarising deterministic diffs and drafting configuration for human approval; no model output may write to plans or the ledger; AI text mentioning money must cite the lines it summarises | PD-01 §9, BR-AI-01 | FR-AI-001, FR-AI-002 (internal) | V1 |
| X-23 | Preparer is never approver (money and rules) | PD-01 principle 6, BR-ADJ-02, BR-PAY-02, BR-SEC-06 | FR-IAM-004, FR-COMP-006, FR-PAY-001, FR-CAS-002 | B |
| X-24 | Nothing overwritten: genealogy effective-dated & append-only; money/results append-only; corrections are visible adjustments | PD-01 principle 3, ADR-03 | FR-GEN-002, FR-FIN-001 | B |

Excluded customers (PD-01 §5): companies in enforcement proceedings (ask counsel first); companies seeking "proof our plan is legal"; plans paying solely on recruitment; (MVP-B) anyone needing platform-held wallets, e-pins or crypto.

---

## 3. Product and strategy decisions (DEC-*)

| ID | Decision (verbatim essence) | Consequences for engineering | Status | Rel |
|---|---|---|---|---|
| DEC-01 | Scope follows research path: compliance-analytics overlay first (MVP-A), then engine + compliance, API-first (MVP-B), conditional on demand gate | Storefront, inventory, LMS, marketing, CRM pipelines, GL integrated or dropped; MVP-B conditional | **Decided (founder)** | A, B |
| DEC-02 | Specs market-neutral; market rules in market packs | Tax, guardrail, window, language, form values not in core docs; each pack needs advisers | **Decided (founder)** | A |
| DEC-03 | Calculate and instruct; never hold funds; no wallets, e-pins, crypto | Tenants bring own provider accounts; "earnings balance owed by the tenant" replaces "wallet" | Provisional (counsel Q-2) | B |
| DEC-04 | Guardrail stance **Moderate**: block where a market bans; warn and log; report | BR-GRD-01..05 as written; override path limited | Provisional (founder FD-06, counsel Q-1) | B (report part A) |
| DEC-05 | Honesty policy: no income projections, no recruit leaderboards, disclosures from real payouts | UI and API contain no projection feature; BR-HON | Provisional (founder) | A |
| DEC-06 | Commerce integrated, not built | Ingestion API and connectors; no customer-facing commerce screens | Provisional (revisit if buyers want one vendor) | B |
| DEC-07 | Pricing: per active payee + fixed-scope implementation; never % of volume | "Active payee" must be auditable; values unset | Provisional (FD-03) | B |
| DEC-08 | Two MVPs: MVP-A (18 requirements) before MVP-B (85) | Compliance module serves both through a fact layer (ADR-15) | Provisional | A, B |
| DEC-09 | Earnings-distribution computation in MVP-A; publication workflow V1 | FR-CPL-005 in A; FR-CPL-009 in V1 | Proposed | A / V1 |
| DEC-10 | Placement trees and multiple positions in data model from MVP-B; serialised binary placement is "Could" | FR-GEN-005 priority Could (OQ-13) | Provisional | B |
| DEC-11 | No workflow builder; fixed approval flows + status component | UI-04 §3.8 | Proposed | B |
| DEC-12 | No native mobile app in MVP; responsive installable web app | WF-06, UI-05 | Proposed | A, B |
| DEC-13 | Customers are not users; only two public pages customer-facing | WF-05 | Proposed | B |
| DEC-14 | No numeric rate, threshold or window defined anywhere in these documents | Settings and packs carry values; tests use labelled fixtures | **Decided as a rule of this documentation** | all |
| DEC-15, DEC-16 | **Not present** in the log (numbering gap) | — | — | — |
| DEC-17 | Two editions from one codebase: hosted SaaS (primary) + licensed self-hosted | Self-hosted = single-tenant cell; signed licence + updates; no source edition; no cloud-specific deps in core; sequenced V1; pricing and liability open (OQ-24, OQ-25) | **Decided (founder)**; details Proposed | V1 (core constraint from A) |
| DEC-18 | Licence lapse never blocks calculation, payout, statements, export | BR-LIC-01 | Proposed | V1 |
| DEC-19 | Phase 2 research scoped to Bangladesh and India | Research 70–79 in `research-completion`; PD-04. Does **not** decide FD-02 | **Decided (founder)** | — |
| DEC-20 | Do not sell to Bangladeshi MLM operators; no Bangladesh MLM pack; single-level affiliate pack only after counsel answers AQ-13 | Bangladesh may still host the build team; tenants cannot select Bangladesh for multi-level plans | Provisional (counsel AQ-13) | B |
| DEC-21 | India recommended first market pack, compliance-led offer (MVP-A first) | PD-04 India pack drafted; India cell ap-south-1 with ap-south-2 backup; FD-02 still needs founder access scored | Proposed (founder FD-02) | A (offer), B-MKT (pack) |

Founder-decided set (only these): DEC-01, DEC-02, DEC-17 (principle), DEC-19. DEC-14 is a documentation rule.

---

## 4. Architecture decisions (ADR-*)

ADR-01..14 = gap audit 28 §2 recommendations adopted. GOV-02 states "ADR-15 and ADR-16 are new"; ADR-17..21 are also logged but not attributed to the audit (treat as new to this documentation).

| ID | Decision | Consequences / constraints | Status | Rel (inferred) |
|---|---|---|---|---|
| ADR-01 | Modular monolith + separate calculation worker pool | One deployable; single-DB transactions; self-hostable; separate only on stated triggers (SDD-01 §1) | Provisional | A (monolith), B (workers) |
| ADR-02 | Regional cells; tenant routing supporting pooled and dedicated DBs; RLS everywhere | Routing layer and RLS **from the first release** | Provisional | A |
| ADR-03 | Bitemporal, append-only genealogy; positions separate from participants | `relationship` model (SDD-08); FR-GEN-001/002 | Provisional | B |
| ADR-04 | In-memory tree per run; materialised-path read model for interactive use | O(N) runs; read model derived, may be stale; **spike must prove it** (OQ-05, OQ-29, TS-29) | Provisional (spike) | B |
| ADR-05 | Declarative primitives + controlled extension point (expressions; platform modules); no tenant code | Extension tiers SDD-07 §3.2; coverage target needed (OQ-12); FR-PLN-003 | Provisional | B |
| ADR-06 | Money in minor units; round once per line; largest-remainder allocation; residue to a named account | BR-MNY; FR-COMP-012 | Provisional | B (A for report arithmetic) |
| ADR-07 | Double-entry obligations sub-ledger with GL export; no general ledger | SDD-09; FR-FIN-001, FR-FIN-005 | Provisional | B |
| ADR-08 | Commerce via idempotent ingestion API + connectors | TRD-05; FR-ORD-001/002 | Provisional | B |
| ADR-09 | Provider-adapter interface; ≥ 2 payout routes per launch market; tenant-owned accounts | **Launch blocker until providers confirm in writing** (AQ-01); FR-PAY-002 | Provisional | B |
| ADR-10 | Transactional outbox for all external effects; idempotency keys everywhere | At-least-once delivery, at-most-once effect; FR-PAY-003 | Provisional | A (keys on API-01) / B |
| ADR-11 | Reporting on replica or export; never ad-hoc SQL on primary | Export MVP-B; replica V1 | Provisional | B / V1 |
| ADR-12 | Vendor access only via tenant-approved, logged sessions | FR-IAM-005 | Provisional | A |
| ADR-13 | Erasure by pseudonymisation where ledger retention applies | Needs counsel per market; FR-PRV-002, BR-DAT-06 (C) | Provisional (counsel) | B |
| ADR-14 | Brand and market dimensions in data model from first release | Columns on plans, positions, orders | Provisional | A |
| ADR-15 | Compliance fact layer shared by overlay and engine | `cpl_fact_*` tables written by import (A) or by `RunCommitted` event (B) | Proposed | A |
| ADR-16 | Both editions one codebase; self-hosted = single-tenant cell; only standard self-hostable components in core | TR-CON-11; SDD-11 §8 | Proposed | A (constraint) / V1 |
| ADR-17 | PostgreSQL 16+ as single system of record incl. job queue and outbox | Uses `ltree`, RLS; TRD-02 | Proposed | A |
| ADR-18 | TypeScript end to end; engine as isolated portable package | Decision rule tied to spike (TRD-02 §3; OQ-18); JVM/.NET equally valid | Proposed | A |
| ADR-19 | Self-hosted OIDC identity provider per cell, three realms | No per-user cost; in region; must be operated | Proposed | A |
| ADR-20 | Domain events inside monolith through outbox; no distributed bus at MVP | Revisit on separation triggers | Provisional | A |
| ADR-21 | Run snapshots by reference to immutable/effective-dated sources + input hash | Depends on DB-enforced immutability | Proposed | B |

---

## 5. Research conflicts resolved (C-*)

| ID | Conflict | Resolution in force | Linked |
|---|---|---|---|
| C-1 | Brief: all-in-one 25 modules vs research: breadth is table stakes, market unbundling | **Narrow** (founder, DEC-01); 25 modules classified build/integrate/later/not recommended (PD-03) | DEC-01 |
| C-2 | Original research: reversals and plan simulation are gaps vs audit: incumbents document both | Hygiene: must build, must not market as differentiators | — |
| C-3 | Malaysia & India "priority" vs audit: competition, withholding, residency, provider risk; founder access unscored | Market-neutral core + packs (founder, DEC-02); FD-02 open | DEC-02, FD-02 |
| C-4 | Original caps: one proportional scale vs audit: scoped, prioritised caps | Scoped caps (BR-CAP); EX-9 kept only as proportional special case | BR-CAP-01..03 |
| C-5 | Merchant-account risk "has no source" vs provider policies | Provider eligibility is a launch blocker (BR-PAY-11) | ADR-09, AQ-01 |
| C-6 | Workflow diagram credits volume after fulfilment vs rules leave crediting event open (D-R1) | Crediting event is a plan-version parameter; **no default shipped** | BR-PER-02 (C), TS-62 |
| C-7 | Taxonomy "covers 14 of 14" vs corpus 0 of 16 hold-out plans fit | Primitive library by corpus frequency + extension point; coverage target = founder (OQ-12) | ADR-05 |
| C-8 | Audit feature list: MVP = engine vs audit roadmap: MVP-A first | MVP-A then, conditionally, MVP-B | DEC-08 |
| C-9 | Audit: earnings disclosure V1 vs prototype computes it (R5) | Computation MVP-A (internal); publication V1 | DEC-09 |
| C-10 | "Super Admin" mixes tenant admin and vendor staff | Two roles, two application areas (tenant admin; vendor operations) | FR-OPS-001, ST-25 |
| C-11 | Brief: binary and matrix core vs corpus 4 of 16 (US-heavy) | Data model supports placement trees + multiple positions from MVP-B; serialised placement **Could** (OQ-13) | DEC-10, FR-GEN-005 |
| C-12 | Brief asks distributor wallet vs stored value regulated | No wallet; "earnings balance owed by the tenant" from ledger | DEC-03 |
| C-13 | Founder: two editions vs research: one-time licences poor fit; low end sells from $699 | Both editions one codebase (DEC-17); self-hosted = single-tenant, annual subscription with updates (or perpetual + mandatory maintenance), never source code, never without guardrails, after hosted proven; pricing/liability open (OQ-24, OQ-25) | DEC-17, ADR-16 |
| C-14 | Bangladesh data law: strict localisation + 2026 Act vs government statement of no blanket localisation | Recorded as AQ-13; no design depends on it (no Bangladesh MLM pack) | DEC-20 |

Deferred research rules (PRD-04 §D-R): **D-R1** crediting event (payment · shipment · end of cooling-off) — configurable per plan version, no default (BR-PER-02, C); **D-R2** reversal altering closed period — adjust in open period, restate only by approved request (BR-PER-04/05, BR-REV-02 C); **D-R3** negative balance after clawback — carry as receivable, net against future earnings, write off with approval, never debit bank (BR-REV-07..09; Q-10); **D-R4, D-R6** block/warn/report set — Moderate (BR-GRD-01..05; FD-06, Q-1); **D-R5** not identifiable (lost with original catalogue, OQ-22).

---

## 6. Founder decisions (FD-*) and founder-level OQs

| ID | Decision | Working assumption | Blocks | Status |
|---|---|---|---|---|
| FD-01 | Positioning | Compliance analytics first; engine only if gate passes (DEC-01) | — | Chosen 2026-11-12 for documentation; still to be confirmed by buyer evidence |
| FD-02 | Launch market, with founder's own access scored | Market-neutral core (DEC-02); India recommended (DEC-21; score 3.20 vs Bangladesh-MLM 1.45 / Bangladesh-affiliate 2.35); founder access unscored | Market pack release; provider and tax work; languages | **Open** |
| FD-03 | Revenue threshold, budget, team size, time horizon | None; no dates/prices | Business case; schedule; roadmap dates; pricing values (DEC-07) | **Open** |
| FD-04 | Engage counsel in launch market | Not engaged; all legal content screening-grade | Guardrail outcomes; go-live | **Open** |
| FD-05 | Engage tax adviser | Not engaged; no values shipped | FR-TAX-002, FR-TAX-003 | **Open** |
| FD-06 | Guardrail stance | Moderate (DEC-04) | FR-CPL-007 outcomes | **Open** (provisional) |
| FD-07 | Independent review of research audit and these docs (same AI system authored all) | Not commissioned | Confidence in all Critical findings | **Open** |
| FD-08 | Design partner for MVP-A | None named | Phase B | **Open** |
| FD-09 | Product honesty policy | Adopted (DEC-05) | — | Adopted (DEC-05 still marked Provisional) |
| FD-10 | Pass/fail rule for demand test | Proposed rule PD-02 §2 (below) | Phase B | **Open** (proposed) |
| OQ-12 | Target share of plans primitive set must cover without new platform modules | None; today 5 of 16 hold-out plans | Engine scope; gate G3′(b); objective O6 | **Open** |
| OQ-13 | Does target segment use binary or matrix plans? | Data model ready; build "Could" | FR-GEN-005 | **Open** |
| OQ-23 | Product name and brand | Neutral house style | High-fidelity design | **Open** |
| OQ-24 | Self-hosted price and licence form (annual vs perpetual + maintenance; payee bands; modules) | Annual licence recommended; no figures | Commercial offer; FR-LIC-001 entitlement model | **Open** |
| OQ-26 | Offer MVP-A self-hosted to a design partner that will not send export out? | Not planned; possible | Phase B | **Open** |

FD-10 proposed rule (PD-02 §2): **PASS** ≥ 3 companies name a budget and approver or sign a paid-pilot letter, **and** ≥ 2 of them send a real one-year export. **FAIL** after 10 qualified conversations ≤ 1 sends data, or nobody commits budget after seeing results on their own data. (PD-01 O1 phrases it as "≥ 3 budget commitments, ≥ 2 with data, within 10–20 qualified conversations".)

---

## 7. Adviser and third-party questions (AQ-*, Q-*, counsel OQs)

| ID | Question | Who | Blocks / effect | Rel affected |
|---|---|---|---|---|
| AQ-01 | Which payment/payout providers accept licensed direct-selling merchants in launch market, terms; will platform's own billing provider serve a vendor to such companies? | Providers, in writing | **Launch blocker**; stop trigger 1 if none. FR-PAY-002, FR-PAY-006, FR-TEN-004, BR-PAY-11, ADR-09 | B |
| AQ-02..03 | Withholding provisions, rates, thresholds, forms for commissions in launch market | Tax adviser | Market pack tax rules: FR-TAX-002, FR-TAX-003, BR-TAX-01/03/04 | B-MKT |
| AQ-04 | Is in-country storage required, for which data? | Counsel | Data region; cells; FR-TEN-001, BR-DAT-09 (D/C) | A |
| AQ-05 | Processor duties (DPO, breach timelines) from first tenant | Counsel | PRV-01, PRV-02; FR-PRV-004, BR-DAT-07 (S) | A |
| AQ-06 | Status of US earnings-claim rulemaking | US counsel | FR-CPL-009 priority | V1 |
| AQ-10 | India: monthly personal purchase requirement to earn lawful? block, warn or report? (AQ-IN-01) | Indian counsel | India pack guardrail outcome; FR-CPL-007, BR-GRD-03 | B-MKT |
| AQ-11 | India: scope of in-country storage of "consumer data" (sellers, commission records?); DPDP interaction; foreign vendor duties (AQ-IN-02, -03) | Indian counsel | India cell scope; contracts; FR-TEN-001 | A / B-MKT |
| AQ-12 | India: buy-back and cooling-off; GST on commission; Form 26Q layout (AQ-IN-04..06) | Counsel; chartered accountant | Reversal rules (FR-ORD-004, BR-PER-02); tax export (FR-TAX-003) | B-MKT |
| AQ-13 | Bangladesh: single-level affiliate outside 2013 Act? vendor exposure; founder exposure selling MLM software abroad; data localisation (PDPO / amendment / reported 2026 Act) (AQ-BD-01..06) | Bangladeshi counsel | DEC-20; any Bangladesh pack; C-14 | B-MKT |
| Q-1 | Could vendor be exposed if a tenant's plan is held unlawful? | Counsel | Guardrails, contracts, insurance; **stop trigger 3**; DEC-04, BR-GRD-01/02 (C) | B |
| Q-2, Q-9 | Does calculate-and-instruct need a licence; who contracts with payout provider? | Counsel | DEC-03 | B |
| Q-10 / D-R2, D-R3 | May a reversal alter a closed period; how may negative balances be recovered? | Counsel | Clawback defaults: FR-FIN-003, BR-REV-02 (C), BR-REV-07 (D/C) | B |
| OQ-25 | Liability and update duties when self-hosted licensee runs outdated engine/pack; shared-responsibility terms | Counsel | Self-hosted contract; FR-LIC-002 | V1 |
| OQ-27 | Controllership of prospect data entered by distributors | Counsel | FR-CRM-003 | V1 |
| OQ-28 | Duties for unclaimed or dormant balances | Counsel | FR-PAY-007 (dormant-balance part) | B |
| OQ-32 | Retention periods per data class and market | Market pack; counsel | FR-PRV-003, BR-DAT-11 (S) | V1 |

Not defined anywhere in the set: AQ-07, AQ-08, AQ-09 (numbering gap).

---

## 8. Evidence gaps (need field research, design partner or spike)

| ID | Unknown | How to close | Affects | Rel |
|---|---|---|---|---|
| OQ-01 | Willingness to pay for compliance analytics or engine replacement | Phase B (MVP-A with design partner; interviews weighted to compliance/finance) | Whether MVP-B is built at all | A→B |
| OQ-02 | Frequency and cost of problems in mid-market companies | Interviews | Priorities | — |
| OQ-03 | Distributor needs: statements, mobile, language, devices | Distributor interviews; comprehension tests | Portal scope; NFR-PERF-06; FR-DIST-* | B |
| OQ-04 | Whether buyers require security attestation | Interviews | SEC-12 timing | V1 |
| OQ-05 | Engine and genealogy performance at assumed scale | Phase C spike (TS-29) | NFR-PERF-04, -05, -07, -08; ADR-04, ADR-18 | B |
| OQ-06 | Real workload figures (positions, orders, lines, period-end share) | Design partner export | Sizing; pricing; DA-06 | B |
| OQ-07 | Corpus coding accuracy (machine-assisted, no human spot-check); no Malaysian plan; Indian plans only from third-party reviews | Human spot-check of 5 plans; launch-market plans | Primitive priorities (FR-PLN-002) | B |
| OQ-08 | Incumbent capabilities beyond published docs. **Partly closed 2026-11-12**: Fluid, Pillars, TeqTank + 2 Indian vendors show no compliance analytics; ByDesign not read; Pillars' 25 reports not listed | Doc reads; interviews | Differentiation claims | — |
| OQ-09 | Unit-economics inputs (illustrative model research 76; nothing evidenced): implementation/migration/support hours, infra cost per tenant, provider costs, price, sales cycle | Spike; first tenants; interviews | Pricing; viability (DA-13, UE-01..UE-15) | — |
| OQ-10 | Provider capabilities: idempotency, status query, settlement formats, coverage | Provider docs after AQ-01 | Adapter design FR-PAY-002/003/004 | B |
| OQ-15 | Which commerce platforms launch-market buyers use | Interviews | Connector priority FR-ORD-002 (Shopify, WooCommerce assumed) | B |
| OQ-20 | Do sales, regional/country managers, warehouse, marketing staff have needs here? | Interviews | Roles; no screens for them today | — |
| OQ-21 | Does wireframed structure work for real users? | Usability tests (UX-01 §7) | All UX docs | A, B |

## 9. Design questions still open (engineering-owned)

| ID | Question | Current handling | Affects | Rel |
|---|---|---|---|---|
| OQ-17 | One genealogy across countries when some require in-country storage | MVP: one data region per tenant; no split-residency design | FR-TEN-001, FR-GEN-* | B |
| OQ-18 | Backend language given founding team skills | TypeScript proposed (ADR-18); JVM/.NET equally valid | All code | A |
| OQ-19 | Cloud provider and regions | AWS default. India: ap-south-1 Mumbai + ap-south-2 Hyderabad. Bangladesh: no hyperscaler region found | Deployment (SDD-11) | A |
| OQ-29 | `ltree` path size at depth 5,000 | Spike; chunked-path fallback described | FR-GEN-008, ADR-04 | B |
| OQ-30 | Detect forbidden columns by content (not just name) without false rejections | Prototype in MVP-A | FR-IMP-001 | A |
| OQ-31 | Require distributor second factor? | Optional by default (MFA mandatory only for approvers, tenant admins, vendor staff: BR-SEC-02) | FR-IAM-007 | B |
| OQ-33 | Self-hosted supported-version policy and upgrade cadence | Proposed: current and previous minor release | FR-LIC-002 | V1 |
| OQ-34 | Settled payouts: contra account in sub-ledger or stop at "in transit cleared"? | Proposed `settled_clearing`; confirm with accountant | FR-FIN-001, FR-PAY-004 | B |

## 10. Repository and process questions

| ID | Question | State |
|---|---|---|
| OQ-22 | Missing research docs `07_PROBLEM_SEVERITY_MATRIX`, `10_USER_JOURNEY_MAPS`, `15_BUSINESS_RULES_CATALOG` | **Partly closed**: labelled reconstructions (07 complete; 10 = 11 of 17 journeys; 15 ≈ 35 of 57 rule IDs, 14 with text). ≈ 22 rules and D-R5 still lost; originals wanted (SHA-256 in gap-audit snapshot) |
| OQ-35 | Research files in multiple copies with different sizes | Largest, latest copy used; confirm |
| OQ-36 | Research OQ-05: which vendors the brief meant by "Prodigy", "Global MLM Software", "Salesforce-based MLM solution" | No effect |
| OQ-37 | Bangladesh policy (research OQ-02) | **Answered provisionally** by DEC-20 |
| OQ-38 | Bangladeshi local hosting providers and certifications | Only if AQ-13 opens a Bangladesh market |

Not defined anywhere in the set: OQ-11, OQ-14, OQ-16 (numbering gap).

---

## 11. Assumptions in force

| ID | Assumption | Source | If wrong | Status |
|---|---|---|---|---|
| A-01 | Buyer is the direct-selling company; distributors are users | Research | Portal and pricing change | Provisional |
| A-02 | Platform does not hold participant funds | Research | Licensing; payout architecture | Provisional (Q-2) |
| A-07 | Legal findings are screening-grade | Research | — | Rule |
| A-13 | Numbers in compensation examples are hypothetical | Research | — | Rule (SYN-00 only) |
| A-14 | Evidence mostly from large companies | Research | Mid-market needs may differ | Rule |
| DA-01 | Scope follows research path | Founder | Module boundaries change | Founder choice |
| DA-02 | Market-neutral core with packs | Founder | — | Founder choice |
| DA-03 | Moderate guardrails | Research default | Guardrail outcomes change | Provisional (FD-06) |
| DA-04 | Honesty policy adopted | Research default | UI rules change | Provisional (FD-09) |
| DA-05 | One currency per tenant market in MVP-B | Research | Multi-currency (FR-FIN-007, V1) moves earlier | Provisional (GAP-034) |
| DA-06 | Workload: up to **2M positions, 3M orders/month, 600k lines per run, 30% of orders in last three days** | Research (labelled assumption) | Performance targets and sizing change | Sizing assumption only |
| DA-07 | Small team; one deployable preferred | This documentation | Architecture trade-offs change | Assumption |
| DA-08 | Two editions from one codebase | Founder | — | Founder choice (DEC-17) |
| DA-09 | Commerce platforms can pass attribution hints and a purpose tag | This documentation | Attribution and R2 data quality suffer | Assumption |
| DA-10 | Tenants can obtain eligible payout providers themselves | Phase A desk screen | Launch blocked | Assumption |
| DA-11 | Operators can export orders and payout lines with source order references | Phase A | MVP-A data quality; R2, R3 weaker | Assumption |
| DA-12 | Personas other than commission analyst (PR-01) are hypotheses | Research | Stories may be cut | Rule |
| DA-13 | Unit-economics inputs UE-01..UE-15 illustrative | Research 76 | Viability conclusions change | Assumption |
| DA-14 | Phase 2 legal/tax findings screening-grade, secondary sources 2022–2026 | Research 70, 71 | India pack content changes | Rule |

Confirmed vs provisional (GOV-03 §7): **confirmed** = scope path, market-neutral core, two editions; platform invariants from correctness (ledger balance, immutability, idempotency, exact allocation, isolation); research constraints (determinism, snapshots, outbox, no funds, no tenant code); honesty constraints; accessibility target; calculated expected values (55 of 55 verified by `08-qa/verification/verify_calculations.py`). **Provisional** = demand, market, pricing; every market/tax/guardrail rule; reversal defaults; change-window values; stack; tenancy thresholds; read-model design; all performance numbers; all layouts and flows; tax fixtures; corpus/tenant-plan coverage.

---

## 12. Strategy: phases, gates, stop triggers

| Phase | Content | Exit gate |
|---|---|---|
| A — Decide and de-risk | Founder decisions; providers in writing; tax adviser; counsel; corpus spot-check | FD-01..FD-06 decided; **≥ 2 eligible providers confirmed in writing** for launch market; tax and counsel questions answered or explicitly accepted as risk |
| B — Validate demand | MVP-A on design-partner export; interviews weighted to compliance/finance | **G3′**: (a) ≥ 1 problem with frequency evidence and ≥ 1 with willingness-to-pay evidence from buyers; (b) primitive set covers ≥ founder's target share of hold-out plans (OQ-12). **G4′**: every MVP feature traces to a gap/problem/compliance requirement **and** to ≥ 1 buyer interview or design-partner request. FD-10 rule. Fail → stop or pivot to overlay-only / P5; unclear → stay in B |
| C — Technical spike | Genealogy benchmark, engine on corpus, ledger prototype, isolation harness | Benchmarks in TS-29 meet founder thresholds; corpus coverage ≥ target |
| D — MVP-B build | One design partner in parallel run | **Zero unexplained differences** (go-live) |
| E — V1 | Second and third tenants; self-hosted edition | — |

Stop triggers: (1) no eligible payment/payout providers in launch market (AQ-01); (2) buyers will not pay for compliance analytics **and** will not replace their engine (OQ-01); (3) counsel finds unacceptable vendor exposure for chosen guardrail stance (Q-1); (4) one or none of ten operators with authority would evaluate or pay.

Positioning options: P1 all-in-one MY/IN — rejected as stated; P2 engine + compliance API-first — build path, conditional; P3 migration tooling — folded into P2; P4 compliance overlay — test first (MVP-A); P5 non-MLM direct-selling/affiliate tools — out of scope.

Product objectives (PD-01 §3): O1 demand (FD-10 rule); O2 compliance figures reproducible from stored inputs + method version = **100%**; O3 replay of committed period equals committed output = **100%, exact**; O4 unexplained per-payee differences after parallel run = **0**; O5 unexplained ledger difference per run = **0**, duplicate payments = **0**; O6 share of new tenant's plan rules without new module = founder target (OQ-12); O7 pay-related support contacts per 1,000 payees per period = baseline at first tenant.

Commercial model (provisional, GAP-075 open): MVP-A paid pilot / fixed fee (founder sets); MVP-B per active payee per month with band tiers — **"active payee" = participant with at least one committed result line in the billing month**, auditable from tenant's own export; fixed-scope implementation/migration incl. parallel-run report; compliance analytics add-on for non-engine tenants (candidate); self-hosted annual licence by payee band and modules (OQ-24); payments revenue share deferred (licensed partner only). Rejected: % of volume; cheap one-time licence; source/white-label edition.

Risks R1–R16 (PD-02 §7) of engineering relevance: R5 plan long tail (High; 11 of 16 corpus plans) → extension point; R6 scale unknown → Phase C spike; R7 cross-tenant leak/insider fraud (Severe) → data-layer isolation, CI isolation suite, support sessions, SoD; R11 single AI author → FD-07; R14 stale self-hosted engines pay wrongly → signed updates, pre-activation golden + replay checks (BR-LIC-03), diagnostics, OQ-25; R15 licence piracy → signed licence bound to installation, no source edition; R16 two editions double load → one codebase, ship self-hosted only after hosted MVP-B proven, supported-version policy (OQ-33).

---

## 13. Which open questions block which modules

Module codes from spec.json. "Hard" = cannot ship/go-live; "Values" = code can be built, content/values cannot be filled; "Default" = built with provisional default behind configuration.

| Module (rel) | Blocking IDs | Block type | Concrete requirements |
|---|---|---|---|
| Whole of MVP-B (B) | OQ-01, FD-10, FD-08, G3′/G4′ | Hard (build go/no-go) | All `rel=B` (85 requirements per DEC-08) |
| IMP — import (A) | OQ-30, DA-11 | Default | FR-IMP-001 (forbidden-column detection) |
| CPL — compliance reports (A) | FD-08 (no data to validate), DA-11 | Default | FR-CPL-001..006 |
| CPL — guardrails (B) | FD-06, Q-1, FD-04, AQ-10 (India) | Default (Moderate) + Values | FR-CPL-007, FR-CPL-008; BR-GRD-01/02 (C) |
| CPL — disclosure publishing (V1) | AQ-06 | Priority | FR-CPL-009, FR-CPL-011 |
| CPL — market registers (B-MKT) | FD-02, AQ-12 | Values | FR-CPL-013 |
| TEN — tenant/data region (A) | AQ-04, AQ-11, OQ-17, OQ-19 | Default (one region per tenant) | FR-TEN-001, BR-DAT-09 (D/C) |
| TEN — market launch checklist (B) | AQ-01, FD-02, AQ-05 | Hard for go-live | FR-TEN-004, BR-PAY-11, TS-50 |
| GEN — genealogy (B) | OQ-05, OQ-29, OQ-13, OQ-17 | Spike / scope | FR-GEN-005 (Could), FR-GEN-008, ADR-04 |
| PLN — plans/primitives (B) | OQ-12, OQ-07, FD-02 (launch-market plans) | Scope | FR-PLN-002, FR-PLN-003; BR-PLN-03 (S) filing gating per pack |
| COMP — engine (B) | OQ-05, OQ-18, D-R1 (BR-PER-02 C) | Spike / Default | FR-COMP-001 crediting event, FR-COMP-002 |
| FIN — ledger (B) | Q-10/D-R2/D-R3, OQ-34 | Default | FR-FIN-001, FR-FIN-003 (BR-REV-02 C, BR-REV-07 D/C) |
| PAY — payouts (B) | AQ-01 (**launch blocker**), OQ-10, Q-2/Q-9, OQ-28 | Hard (go-live) / Default | FR-PAY-002, -003, -004, -006, -007 |
| TAX (B / B-MKT) | FD-05, AQ-02..03, AQ-12 | Values (no values shipped) | FR-TAX-001 (B, buildable), FR-TAX-002, FR-TAX-003 (B-MKT, Hard per market) |
| ORD — orders/returns (B) | OQ-15, AQ-12 (cooling-off, buy-back), DA-09 | Default | FR-ORD-002 connector priority; FR-ORD-004; BR-PTY-03 (R/C) |
| CRM (V1) | OQ-27 | Hard | FR-CRM-003 |
| DIST — portal (B / B-MKT) | OQ-03, OQ-21, OQ-31, FD-02 (languages) | Scope / Values | FR-DIST-007 (B-MKT), FR-IAM-007 |
| PRV — privacy (A / B / V1) | AQ-05, ADR-13 counsel, OQ-32 | Default / Values | FR-PRV-004 (A), FR-PRV-002 (B; BR-DAT-06 C), FR-PRV-003 (V1) |
| INT / RPT (B / V1) | OQ-04 (attestation timing) | — | FR-INT-004 (V1) |
| LIC — self-hosted (V1) | OQ-24, OQ-25, OQ-33, OQ-26 (possible earlier MVP-A self-hosted) | Commercial / Values | FR-LIC-001..003, BR-LIC-01..05 |
| UI / branding | OQ-23, OQ-21 | Values | High-fidelity design |
| Bangladesh pack (B-MKT) | AQ-13, OQ-38 | Hard (no pack) | DEC-20 |
| India pack (B-MKT) | FD-02, AQ-10, AQ-11, AQ-12, FD-04, FD-05 | Values | PD-04 content |
| Pricing / billing metering | FD-03, OQ-09, OQ-24 | Values | "active payee" metric definition is fixed; prices are not |

Nothing in MVP-A (`rel=A`, 18 requirements: IAM-001/002/003/005, TEN-001, IMP-001..003, CPL-001..006, PRV-004, AUD-001/002, OPS-001) is **hard-blocked** by an open question; MVP-A is buildable now on working assumptions (AQ-04/AQ-05 affect region and breach-contact values only).

---

## 14. Engineering may decide provisionally vs needs founder/counsel

### 14.1 Engineering may decide (record as Proposed in GOV-02; reversible)

| Item | Current proposal | Guardrail on the decision |
|---|---|---|
| OQ-18 backend language | TypeScript (ADR-18); engine as isolated portable package | Decision rule tied to spike TS-29 |
| OQ-19 cloud/regions | AWS; India ap-south-1 + ap-south-2 | No cloud-specific deps in core (DEC-17, ADR-16) |
| OQ-29 `ltree` depth 5,000 | Spike; chunked-path fallback | ADR-04 must be proved |
| OQ-30 forbidden-column detection by content | Prototype in MVP-A | No false rejections |
| OQ-31 distributor 2FA | Optional by default | BR-SEC-02 mandatory for privileged roles |
| OQ-33 self-hosted support window | Current + previous minor | Contract side is OQ-25 (counsel) |
| OQ-34 settled-payout contra | `settled_clearing` | Confirm with accountant |
| OQ-17 split residency | One data region per tenant | Revisit after AQ-04/AQ-11 |
| ADR-15..21, DEC-09, DEC-11, DEC-12, DEC-13, DEC-18 | As logged | Proposed; no scope/money/law change |
| ADR-01..14, ADR-20 | As logged | Provisional; spike-dependent items (ADR-04) gated by Phase C |
| Configuration shape for all C/S rules | Settings/pack fields, effective-dated, with basis status (BR-CPL-03) | **No default values** (DEC-14); D-R1 has no default |

### 14.2 Needs the founder

FD-02 launch market · FD-03 budget/team/horizon/revenue threshold (unblocks dates and prices) · FD-04/FD-05 engaging counsel and tax adviser · FD-06 guardrail stance (confirm Moderate) · FD-07 independent review · FD-08 design partner · FD-10 demand pass/fail rule · OQ-12 primitive coverage target · OQ-13 binary/matrix segment · OQ-23 name/brand · OQ-24 self-hosted pricing · OQ-26 MVP-A self-hosted for a partner · DEC-03/05/06/07/08/10 confirmation (Provisional) · DEC-21 India first pack · Phase C benchmark thresholds · CMP-16 tenant acceptance policy.

### 14.3 Needs counsel / tax adviser / providers (engineering must not decide)

Q-1 vendor exposure (stop trigger) · Q-2/Q-9 calculate-and-instruct licensing (DEC-03) · Q-10 / D-R2 / D-R3 reversal & clawback · D-R1 crediting event (tenant with counsel) · AQ-01 providers in writing (launch blocker) · AQ-02..03 withholding · AQ-04/AQ-11 residency · AQ-05 processor duties · AQ-06 US earnings claims · AQ-10/AQ-12 India guardrail, cooling-off, buy-back, GST, Form 26Q · AQ-13 Bangladesh · ADR-13 pseudonymised erasure per market · OQ-25 self-hosted liability · OQ-27 prospect-data controllership · OQ-28 dormant balances · OQ-32 retention periods · CMP-14 fee/deposit blocking · all rules with status C, S/C, R/C, D/C: BR-PER-02, BR-REV-02, BR-REV-07, BR-GRD-01, BR-GRD-02, BR-DAT-06, BR-DAT-09, BR-TAX-01, BR-TAX-03, BR-TAX-04, BR-CAP-02, BR-PTY-03, BR-GEN-10 (V1).

---

## 15. Compliance/security requirement families carried from research (SYN-00 §7)

| ID | Requirement | Class |
|---|---|---|
| CMP-01 | Tag sales by buyer type; report retail-customer share | Candidate → FR-CPL-001 (A) |
| CMP-02 | Flag qualification or pay depending on personal purchases | Candidate → FR-CPL-002/004 (A) |
| CMP-03 | Attribute every payout line to its source | Candidate → FR-CPL-003 (A), FR-COMP-007 (B) |
| CMP-04 | Versioned plans with approval, effective dates, audit trail | Candidate → FR-PLN-001/007 (B) |
| CMP-05 | Earnings disclosure from actual payouts incl. low and zero earners | Candidate → FR-CPL-005 (A), FR-CPL-009 (V1) |
| CMP-06 | Electronic agreements with versions | Candidate → FR-PAR-006 (B) |
| CMP-07 | Cooling-off, returns, buy-back per market | Candidate → AQ-12 |
| CMP-08 | In-country storage option | Candidate → FR-TEN-001 |
| CMP-09, CMP-17 | Grievance register; delisted-seller register (India) | Candidate → FR-CPL-013 (B-MKT) |
| CMP-12 | Licence evidence per tenant gating go-live | Candidate → FR-TEN-004 |
| CMP-14 | Block deposits / non-refundable joining fees where prohibited | Needs counsel → BR-GRD-02 |
| CMP-16 | Tenant acceptance policy | Founder decision |
| MH-REQ-01..10 | Ledger records obligations; batch preparer/approver; adapters; reconciliation; reversals; per-market payout rules; no crypto or e-pins; statements by source; provider record | Design inputs (B) |
| SEC-01..13, PRV-01..07, CPL-01..15 | Security, privacy, compliance capability reqs | Carried into TRD-04 |

---

## Conflicts found

| # | Conflict (between documents) | Resolution adopted for engineering |
|---|---|---|
| K-1 | **DEC-14** ("no numeric rate, threshold or window is defined anywhere in these documents") vs SYN-00 §8 stating India commission withholding **2% under s.393 of the Income-tax Act 2025**, and PD-04 listing "Sourced: 2%, ₹20,000, 20%" (rate, annual threshold per payee, higher rate without PAN) | Treat India values as **market-pack data** with basis status `S` (screening) per BR-CPL-03 and DA-14, never as code constants or defaults. DEC-14 applies to the core spec; the pack values must not ship until FD-05/AQ-02..03 confirm. |
| K-2 | PD-01 §5 "Market: undecided (FD-02). Candidates: US, Malaysia, India" vs DEC-21 / SYN-00 §8 India recommended as first pack | PD-01 is stale relative to Phase 2. Build market-neutral; India pack is the first pack target (Proposed); FD-02 remains open. |
| K-3 | PD-01 O1 "within 10–20 qualified conversations" vs PD-02 FD-10 FAIL "after 10 qualified conversations ≤ 1 sends data" | Not an engineering blocker; PD-02 is the operative rule (FD-10 owner). Flag to founder. |
| K-4 | FD-09 "Adopted (DEC-05)" vs DEC-05 status "Provisional (founder)" vs DA-04 "Provisional (FD-09)" | Engineering treats BR-HON-01 as **hard** (rel A, status D, test TS-53). Only founder can relax it; nothing in sources suggests relaxing. |
| K-5 | PD-02 Phase A exit requires FD-01..FD-06 **decided**, yet DEC-01/DEC-02 are the only decided founder items and FD-02..FD-06 remain open while MVP-A design proceeds | MVP-A build may proceed on working assumptions (GOV-03 reading rule); Phase A exit gate must be cleared before Phase B demand test runs with a real partner / before go-live. |
| K-6 | ID collisions: GOV-03 **OQ-05** = engine performance, but research OQ-05 = vendor names (re-numbered OQ-36); research **OQ-02** = Bangladesh policy (re-numbered OQ-37); SYN-00 §2.10 #2 cites "founder access (**OQ-08**)" while GOV-03 OQ-08 = incumbent capabilities | Use GOV-03 numbering as canonical. Founder-access scoring belongs to **FD-02**, not OQ-08. |
| K-7 | DEC-03 "Provisional (counsel Q-2)" vs PD-01 principle 2 and X-03 treated as a hard product principle; C-12 states "No wallet" unconditionally | Build with no funds holding at all (no balance table that represents stored value). The only future option named is a **provider-hosted** wallet (later, via licensed partner), which would not change the core. |
| K-8 | DEC-17 "sequenced at V1" vs PD-01 §4.1 / OQ-26 "MVP-A may be offered self-hosted earlier" | Self-hosted ship target stays V1; ADR-16 constraints (no cloud-specific core deps, single-tenant cell) apply from release A so an early MVP-A package remains possible. |
| K-9 | DEC-08 says MVP-A = 18 requirements, MVP-B = 85; spec.json counts rel=A: 18 ✓; rel=B: 81 + B-MKT 4 (FR-TAX-002, FR-TAX-003, FR-CPL-013, FR-DIST-007) = 85 ✓; V1: 19 (122 total) | Consistent: "85" includes B-MKT. Treat B-MKT as MVP-B scope gated per market pack. |
| K-10 | Numbering gaps: DEC-15, DEC-16, OQ-11, OQ-14, OQ-16, AQ-07..09 are referenced nowhere | Assume withdrawn/renumbered; do not reuse these IDs. |
| K-11 | SYN-00 §2.9 says Indian processor duties apply "from May 2027 as reported"; GOV-03 AQ-05 says duties "from the first tenant" is an open question | Build FR-PRV-004 (A) breach contacts and runbook data from first release regardless; timelines are pack/tenant values (BR-DAT-07, S). |
| K-12 | ADR-01..ADR-14 are "Provisional" yet GOV-03 §7 lists stack, tenancy thresholds, read model as provisional while "determinism, snapshots, outbox, no funds, no tenant code" as **confirmed** | Treat ADR-06 (money), ADR-10 (outbox/idempotency), ADR-12 (vendor access), ADR-03 (append-only genealogy), ADR-05's no-tenant-code clause as effectively fixed invariants; treat ADR-02 thresholds, ADR-04 read model, ADR-17/18 stack as revisable. |

---

## Open / unresolved

| ID | Unresolved | Blocks |
|---|---|---|
| OQ-01, FD-08, FD-10 | Demand, design partner, pass/fail rule | Entire MVP-B (all rel=B) |
| AQ-01 | Provider eligibility in writing (≥ 2 per market) | Go-live; FR-PAY-002, FR-PAY-006, FR-TEN-004, BR-PAY-11; stop trigger 1 |
| FD-02 | Launch market | Every B-MKT item: FR-TAX-002, FR-TAX-003, FR-CPL-013, FR-DIST-007; BR-PLN-03, BR-REG-05; provider, tax, language work |
| FD-03 | Budget, team, horizon, revenue threshold | Roadmap dates; prices (DEC-07); viability |
| FD-04, Q-1 | Counsel; vendor exposure | Guardrail outcomes FR-CPL-007/008 (BR-GRD-01/02); stop trigger 3; go-live |
| FD-05, AQ-02..03 | Tax adviser; withholding | FR-TAX-002, FR-TAX-003 (BR-TAX-01/03/04) |
| FD-06 | Guardrail stance (Moderate assumed) | FR-CPL-007 |
| FD-07 | Independent review | Confidence in all Critical findings |
| OQ-12, OQ-07 | Primitive coverage target; corpus accuracy | G3′(b); FR-PLN-002, FR-PLN-003; O6 |
| OQ-13 | Binary/matrix segment | FR-GEN-005 |
| OQ-05, OQ-29, OQ-06 | Performance at scale; `ltree` depth; real workload | ADR-04, ADR-18, NFR-PERF-04/05/07/08, FR-GEN-008; Phase C exit |
| Q-2, Q-9 | Licence for calculate-and-instruct; contracting party with provider | DEC-03 |
| Q-10, D-R2, D-R3 | Reversal of closed period; negative balance recovery | FR-FIN-003, BR-REV-02, BR-REV-07 |
| D-R1 | Crediting event | BR-PER-02, FR-COMP-001, TS-62 (no default shipped) |
| D-R5 + ≈ 22 lost rules (OQ-22) | Lost original business rules | Unknown; possible missing rules |
| AQ-04, AQ-11, OQ-17 | Residency scope; split residency | FR-TEN-001, BR-DAT-09; India cell scope |
| AQ-05 | Processor duties | PRV-01, PRV-02; FR-PRV-004 values |
| AQ-06 | US earnings-claim rulemaking | FR-CPL-009 priority |
| AQ-10, AQ-12 | India purchase requirement; cooling-off, buy-back, GST, Form 26Q | India pack guardrail; FR-ORD-004; FR-TAX-003 |
| AQ-13, OQ-38, C-14 | Bangladesh affiliate legality; data law | DEC-20; any Bangladesh pack |
| ADR-13 | Erasure by pseudonymisation per market | FR-PRV-002, BR-DAT-06 |
| OQ-24, OQ-25, OQ-33, OQ-26 | Self-hosted price, liability, support window, early MVP-A self-hosted | FR-LIC-001..003; commercial offer |
| OQ-27 | Prospect-data controllership | FR-CRM-003 |
| OQ-28 | Dormant balances | FR-PAY-007 |
| OQ-32 | Retention periods | FR-PRV-003, BR-DAT-11 |
| OQ-34 | Settled payouts contra account | FR-FIN-001, FR-PAY-004 |
| OQ-03, OQ-21, OQ-31 | Distributor needs; usability; distributor 2FA | FR-DIST-*, FR-IAM-007, NFR-PERF-06 |
| OQ-04 | Security attestation | SEC-12 timing |
| OQ-09, DA-13 | Unit economics | Pricing; viability |
| OQ-10 | Provider technical capabilities | FR-PAY-002..004 adapter design |
| OQ-15 | Commerce platforms used | FR-ORD-002 connector priority |
| OQ-18, OQ-19 | Language; cloud | ADR-18; SDD-11 (engineering may decide) |
| OQ-20 | Other staff roles' needs | Roles/screens |
| OQ-23 | Name and brand | High-fidelity UI |
| OQ-30 | Forbidden-column content detection | FR-IMP-001 |
| CMP-16 | Tenant acceptance policy | Sales/onboarding; excluded-customer enforcement |
| OQ-35 | Which research copies are current | Source confidence |
