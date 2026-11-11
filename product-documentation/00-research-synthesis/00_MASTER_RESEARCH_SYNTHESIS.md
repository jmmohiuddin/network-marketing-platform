# 00 — MASTER RESEARCH SYNTHESIS
## The single source of truth the product documents are built on

| Field | Value |
|---|---|
| Document ID | SYN-00 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Product (CPO role) |
| Inputs | Research repository `RESEARCH/` (original Waves 0–3), `GAP_AUDIT.zip` (39 files), `PHASE_A.zip` (desk work and prototype) |
| Status | Draft. Not approved |

> **The most important fact.** The research does **not** conclude "build an all-in-one network-marketing platform". It concludes **"do not start building"** until founder decisions and four launch blockers are cleared, and it recommends a narrower product tested cheaply first. The master brief for this documentation assumed a finished, build-ready research base covering UX, technology, database and financial feasibility. That base does not exist: the research stops at the end of Wave 3 of 10 and its own audit records "no product, technical or financial documents" (GAP-100). These documents are therefore the **first** product definition, written on the founder's choice of 12 November 2026 to follow the research path, and they carry the research's open questions forward instead of closing them by assumption.

## 1. What was read, and how deeply

| Material | Read | Note |
|---|---|---|
| Gap audit 01, 07–18, 20–35 and `09_comp_stress_tests.py` | In full | Product-shaping content; primary input |
| Gap audit 04 (register), 06 (consistency) | Index tables in full | |
| Gap audit 00, 02, 03, 05, 19 | Not read in full | Their conclusions are carried by 32–34, which were read in full |
| Original 09, 11, 13, `13_comp_examples.py` | In full | |
| Original 51 (latest copy) | §4–§6 in full; jurisdiction notes not read | Screening-grade legal content |
| Original 03 (latest), 08, 12, 66 (latest) | Summaries, registers and decision tables | |
| Original 06 | Problem list only | |
| Original 00 (plan, roadmap, source registers), 01, 02, 04, 05 | Not read | Market sizing and source lists; not used for requirements |
| Phase A README, P1, P2, prototype `analytics.py`, `test_analytics.py`, corpus analysis output | In full | |
| Phase A P3 (adviser briefs), P4 (design-partner kit) | P4 §1–§2 only | |

**Repository defects found.** (1) Files exist in several copies (`(1)`, `(2)`…); the largest and latest was used. (2) Three documents named in the audit's inventory are **not in the folder**: `07_PROBLEM_SEVERITY_MATRIX`, `10_USER_JOURNEY_MAPS` and `15_BUSINESS_RULES_CATALOG`. Journeys J-01..J-17 and the original 57 business rules could therefore be used only where other documents quote them (open question OQ-22). (3) Research types the brief lists but the repository never produced: UX research, UI research, technology and architecture research, database research, financial feasibility, growth and go-to-market. The gap audit's design-level work (08–10, 14–16, 28) is the only input for those areas, and it is reasoning, not field research.

## 2. The ten questions

### 2.1 What product are we building?

A **compliance and compensation back end for direct-selling companies**, delivered in two steps:

1. **MVP-A — compliance-analytics overlay.** Reads an operator's existing back-office export and produces five reports no vendor material read computes from transaction data: retail-customer share, personal-use share of rewarded volume, payout-source mix, qualification-by-purchase indicators, and an earnings distribution over all participants including those who earned nothing. It is a **demand test**, built small.
2. **MVP-B — engine plus compliance, API-first.** A commission engine with effective-dated genealogy, period lifecycle, obligations ledger, payouts through the tenant's own providers, tax withholding by market pack, per-line provenance, and the same compliance reports computed natively. It sits **behind** a commerce front end (Shopify, WooCommerce, others) rather than replacing it. Built **only if** the demand test and interviews pass gates G3′ and G4′.

It is not an all-in-one suite. Storefront, inventory, LMS, marketing automation, general ledger and social-media monitoring are integrated or left to partners.

### 2.2 Who will use it?

The **buyer is the company** (assumption A-01); distributors are users. Only one persona is document-based; six are hypotheses; no interview has been held.

| Persona | Basis | Role in the product |
|---|---|---|
| PR-01 Commission systems analyst | Three job postings (document-based) | Runs periods, reviews, traces, tests plan changes |
| PR-02 Finance manager and payout approver | Hypothesis | Approves, reconciles, tax, exports |
| PR-03 Compliance officer | Hypothesis; function required by orders and rules | Primary user of MVP-A; guardrails; plan-change review |
| PR-04 Owner or CEO (mid-market) | Hypothesis | Buyer; overview |
| PR-05 Distributor | Hypothesis; "cannot be one persona" | Statements, rank, customers, bank and tax details |
| PR-06 Team leader | Hypothesis; no need evidenced | Privacy-limited team view |
| PR-07 Retail customer | Hypothesis | Not a user of this product; a data subject |
| Added by the audit | Design reasoning | Support agent, plan administrator, payout officer, DPO, implementation consultant, integration developer, **vendor operations staff** (ST-25) |

### 2.3 What problems does it solve?

| Problem | Evidence strength | Product answer |
|---|---|---|
| Compliance figures (retail share, personal consumption, payout sources, honest earnings disclosure) are not computed from transaction data by any vendor read (GAP-081) | Whitespace in sources read; **demand unproven** | MVP-A; compliance module |
| Cost and speed of plan change; paid customisation; surprise charges (P-02; review themes) | Weak (directory reviews) | Declarative primitives, extension point, simulation, governance |
| Reproducing and explaining pay after corrections, refunds, plan changes (GAP-010, GAP-023, GAP-027) | Design reasoning; incumbents document partial answers | Bitemporal genealogy, period lifecycle, replay, traces |
| Money integrity: rounding, caps, clawbacks, payout failures (GAP-021, 022, 030, 032, 035) | Reproducible stress tests | Money rules, scoped caps, ledger, payout controls |
| Launch blockers per market: provider eligibility, withholding tax, privacy duties, residency (GAP-004, 031, 085, 061) | First-party policies and adviser summaries | Provider adapters, market packs, launch checklist, data region |
| Switching fear (P-18, GAP-077) | Vendor content only | History import, parallel-run reconciliation, export guarantee |
| Distributor trust in statements (GAP-003, GAP-027) | US survey and company disclosures | Statement with line explanation; honesty policy |

**Not supported by evidence, and therefore not a positioning:** "commission errors are the central pain" (no error-rate source anywhere); "all-in-one is a differentiator" (top incumbent states 11 of 18 capability rows on a marketing page); "AI is a differentiator" (no buyer evidence).

### 2.4 What business model does it support?

- **Tenant's model:** product sales to customers and participants, with multi-level compensation. The platform records obligations the tenant owes; it **never holds participant funds** (A-02, payout Option 1).
- **Editions (founder choice, DEC-17):** hosted SaaS operated by us, and a licensed self-hosted edition the buyer runs.
- **Platform's own model: not established** (GAP-075, Critical). Candidates: per active payee per month (primary), flat tiers, modular add-ons, fixed-scope implementation and migration fees. **Rejected:** percentage of sales volume (ties vendor revenue to recruitment-driven volume) and one-time licences. Unit-economics inputs are blank until interviews and a design partner fill them. The founder's revenue threshold (FD-03, open since Wave 2) is unset, so viability cannot be judged.

### 2.5 What differentiates it?

| Candidate | Status |
|---|---|
| Compliance analytics computed from transaction data | **Only unclaimed area found**; buyer demand unproven; adverse selection is a named risk |
| Depth of per-line explanation for staff and distributors | Differentiator candidate |
| Migration toolkit with parallel-run proof; export and exit guarantee | Differentiator candidate (switching lever) |
| Tenant-visible vendor access sessions | Trust differentiator candidate |
| Plan-change governance with transition rules | Differentiator candidate |
| Reversals, adjustments, approvals, committed periods, plan sandbox, projected commissions | **Table stakes** — documented by incumbents (DirectScale, Exigo) |

### 2.6 What are the main product modules?

Identity and access · tenant and market configuration · data import (overlay) · compliance analytics and guardrails · participants · genealogy · orders and returns (ingested) · customer attribution · plans · calculation engine · obligations ledger · payouts · tax · cases · distributor portal · privacy · audit · integration · reporting · migration · vendor operations. Boundaries and the fate of each of the brief's 25 candidate modules are in `01-product-definition/03_PRODUCT_MODULE_ARCHITECTURE.md`.

### 2.7 What are the critical business rules?

1. Positions are separate from people; sponsor and placement relationships are effective-dated and append-only; corrections and changes are different events (BR-GEN).
2. Periods move Open → Calculating → Calculated → Committed → Paid → Closed; committed inputs and outputs are frozen; late facts post as adjustments; restatement only by approved request (BR-PER).
3. Money in minor units; round once per line; allocate by largest remainder; residue to a named account (BR-MNY).
4. Caps have scope, base, method and residue rule; per-person limits before company caps (BR-CAP).
5. Cross-period state is an output of a committed run, never edited (BR-RNK).
6. Double-entry, append-only obligations ledger; the platform never debits a distributor and never holds funds (BR-LED, BR-REV-09).
7. Preparer is never approver; vendor staff have no standing access (BR-ADJ, BR-SEC).
8. Tree structure never changes to implement a pay rule (BR-GEN-07).
9. No tenant-specific code (BR-PLN-05).
10. No income projections; disclosures from real payouts (BR-HON).

Full catalogue with basis and status: `02-prd/04_BUSINESS_RULES.md`. **No rate, threshold or window value is set anywhere**; the research forbids it.

### 2.8 What technical constraints exist?

| Constraint | Source |
|---|---|
| Deterministic, replayable, multi-pass engine bound to plan version, settings version and input snapshot | 13 §7; GAP-023 |
| Calculation must not depend on recursive SQL per node; in-memory tree per run; path read model for interactive checks | GAP-011 |
| Plans have a long tail: 0 of 16 hold-out plans fit the original blocks, 5 of 16 the extended list; a versioned extension point is required | Phase A P1 |
| Tenant routing with database-per-tenant capability from day one; regional cells where residency requires | GAP-060, GAP-061 |
| Outbox and idempotency keys for every external effect | GAP-035 |
| Reporting on replica or export, never ad-hoc SQL on the primary | GAP-062 |
| Workload figures (2M positions, 3M orders a month, 600k lines per run) are **assumptions** for sizing a benchmark | Gap audit 15 §2 |
| No benchmark has been run; thresholds belong to the founder | Gap audit 08 §6 |

### 2.9 What legal and compliance constraints exist?

All **screening-grade**; counsel and a tax adviser are not engaged (FD-04, FD-05).

| Constraint | Binds | Effect |
|---|---|---|
| Mainstream payment providers prohibit or restrict MLM merchants (Stripe prohibits; PayPal pre-approval; Indian and Malaysian providers list MLM) | Tenant and platform (contract) | Tenants bring their own provider accounts; adapters; eligibility recorded before go-live; **launch blocker** until confirmed in writing |
| Payout withholding and year-end forms (Malaysia, India, US as reported) | Tenant as payer | Tax step in payouts by market pack; values from an adviser |
| Processor privacy duties (Malaysia from 2025; India from May 2027 as reported) | **Platform** | DPO function, breach runbook, data-subject tooling, DPA |
| Data residency (India, Vietnam as reported) | Tenant | Data region per tenant |
| No pay solely for recruiting; purchase-to-qualify and inventory loading as indicators | Tenant | Guardrails (blocked, warned, reported); platform does **not** certify plans |
| Holding balances may be a regulated activity | Platform | Calculate and instruct only; no wallets, e-pins or crypto |
| Vendor exposure if a tenant's plan is unlawful (Q-1) | Platform | **Unknown**; tenant acceptance policy, guardrails, honesty policy pending counsel |
| Bangladesh: no MLM company licensed, enforcement active (51 §3.2) | — | MLM operators there are not a customer base |

### 2.10 What remains uncertain?

| # | Uncertainty | Owner | Effect if unresolved |
|---|---|---|---|
| 1 | Willingness to pay for compliance analytics or engine replacement | Phase B | No basis to build MVP-B |
| 2 | Launch market (FD-02) and founder access (OQ-08) | Founder | Tax, language, providers, residency unspecified |
| 3 | Provider eligibility in the launch market | Providers, in writing | Stop trigger |
| 4 | Tax treatment of commissions | Tax adviser | Withholding module cannot be finalised |
| 5 | Vendor liability and guardrail stance (FD-06, Q-1) | Founder and counsel | Guardrail outcomes provisional |
| 6 | Revenue threshold, resources, pricing (FD-03, GAP-075) | Founder | Viability and roadmap dates unknown |
| 7 | Engine and genealogy performance at scale | Phase C spike | Performance targets are proposals only |
| 8 | Primitive coverage on launch-market plans (no Malaysian plan in corpus; corpus coding not human-checked) | Founder, design partners | MVP primitive set may be wrong |
| 9 | Distributor needs (mobile, language, statements) | Interviews | Portal scope is hypothesis |
| 10 | Independence of the audit (same AI system produced research and audit; these documents too) | Independent reviewer (FD-07) | Shared blind spots |

Full register: `09-governance/03_OPEN_QUESTIONS.md`.

## 3. Problem and gap index used by the trace

| ID | One line | Severity |
|---|---|---|
| GAP-004 | Payment providers restrict MLM merchants | Critical |
| GAP-010 | No effective-dated genealogy; positions not separated from people | Critical |
| GAP-020 | Compensation primitives incomplete | Critical |
| GAP-023 | No period lifecycle or retroactivity model | Critical |
| GAP-030 | No ledger design | Critical |
| GAP-031 | Payout withholding and tax reporting per market | Critical |
| GAP-060 | No architecture or workload model | Critical |
| GAP-065 | Vendor-staff access, insider and payout fraud, tenant isolation | Critical |
| GAP-075 | Platform business model and cost to serve absent | Critical |
| GAP-076 | Market and segment choice weakly grounded | Critical |
| GAP-081 | Several "gaps" are incumbent table stakes; whitespace is compliance analytics | Critical |
| GAP-087 | Which compliance behaviour the platform enforces; vendor liability | Critical |
| GAP-100 | No product, technical or financial documents | Critical (addressed by this set) |
| GAP-001, 002, 003, 011–013, 021, 022, 025–028, 032, 035, 040, 045, 055, 061, 066, 077, 080, 085, 086, 097 | See gap audit 04 | High |
| GAP-005, 024, 033, 034, 041, 046, 047, 050, 051, 062, 070, 071, 095, 096 | See gap audit 04 | Medium |

## 4. Conflicts in the research, and the decision taken

Conflicts are not resolved silently. Each row states the evidence and the recommendation; all are recorded in `09-governance/02_DECISION_LOG.md`.

| # | Conflict | Evidence | Decision for this documentation |
|---|---|---|---|
| C-1 | Brief: all-in-one platform with 25 modules. Research: breadth is table stakes and the market is unbundling | Feature matrix (04); Fluid raised $15M selling commerce and rep tools while keeping the comp plan elsewhere (G-S07); specialists for messaging and claims | **Narrow** (founder choice 2026-11-12, DEC-01). The 25 modules are each classified build, integrate, later or not recommended |
| C-2 | Original research: reversals and plan simulation are market gaps. Audit: incumbent help centres document both | G-S29..G-S31 | Treat as **hygiene**: must build, must not market as differentiators |
| C-3 | Original: Malaysia and India are priority markets. Audit: strongest low-price competition, withholding, residency, provider uncertainty; founder access unscored | G-S06, G-S12, G-S13, G-S19 | **Market-neutral core with market packs** (founder choice, DEC-02). FD-02 stays open |
| C-4 | Original caps: one proportional scale on all pay. Audit: caps are scoped and prioritised; a regulator's order excludes some lines | Stress tests T3, T4 | Scoped caps (BR-CAP); original example EX-9 kept only as the proportional special case |
| C-5 | Original problem research: merchant-account risk "has no source". Legal research and provider policies say otherwise | G-S04, G-S20, G-S21 | Provider eligibility is a launch blocker (BR-PAY-11) |
| C-6 | Workflow diagram credits volume after fulfilment; rules list the crediting event as open (D-R1) | 11 §1 vs 15 | Crediting event is a plan-version parameter; no default shipped |
| C-7 | Plan taxonomy "covers 14 of 14" vs corpus: 0 of 16 hold-out plans fit | Phase A P1 | Primitive library ranked by corpus frequency **plus** extension point; coverage target is a founder decision (OQ-12) |
| C-8 | Audit feature list puts MVP on the engine (F-01…); audit roadmap puts MVP-A first | 23 vs 31 | Two releases: MVP-A then, conditionally, MVP-B |
| C-9 | Audit marks earnings disclosure V1; the Phase A prototype already computes it (R5) | 23 F-25 vs prototype | Computation in MVP-A (internal figure); publication workflow in V1 |
| C-10 | "Super Admin" mixes the tenant's administrator and the vendor's staff | IC-13 | Two roles and two application areas (tenant admin; vendor operations) |
| C-11 | Brief: binary and matrix as core plan types. Corpus: placement trees in 4 of 16 hold-out plans, but the sample is US-heavy and low-end vendors' customers reportedly favour binary | P1 §4 | Data model supports placement trees and multiple positions from MVP-B; serialised placement is **Could** until the segment is chosen (OQ-13) |
| C-13 | Founder (12 Nov 2026): sell the product in **two editions**, hosted SaaS and a licensed self-hosted edition. Research: one-time licences are "a poor fit for a hosted, regulated-data service" and the low end of the market already sells licences from $699 | Gap audit 18 §5; research 03 | **Both editions from one codebase** (DEC-17). The research objection is to competing on a cheap one-time licence, not to self-hosting as such. The self-hosted edition is therefore a single-tenant deployment of the same product, licensed by **annual subscription with updates** (or perpetual plus mandatory maintenance), never as source code, never without guardrails, and sequenced after the hosted product is proven. Pricing and the liability position of a vendor who cannot patch a customer's installation are open (OQ-24, OQ-25) |
| C-12 | Brief asks for a distributor wallet. Research: stored value is a regulated activity | 51 §5.4 | No wallet. "Earnings balance owed by the tenant", derived from the ledger |

## 5. Assumptions in force

| ID | Assumption | Status |
|---|---|---|
| A-01 | The buyer is the direct-selling company | Provisional |
| A-02 | The platform does not hold participant funds | Provisional; counsel to confirm (Q-2) |
| A-07 | Legal findings are screening-grade | Rule |
| A-13 | Numbers in compensation examples are hypothetical | Rule |
| A-14 | Evidence comes mostly from large companies and may not hold for mid-market | Rule |
| DA-01 | Scope follows the research path (P4 test, then P2) | Founder choice 2026-11-12 |
| DA-02 | Specifications are market-neutral; market-specific rules live in packs | Founder choice 2026-11-12 |
| DA-03 | Guardrail stance is Moderate | Provisional (FD-06) |
| DA-04 | Product honesty policy is adopted | Provisional (FD-09) |
| DA-05 | One currency per tenant market in MVP-B | Provisional (GAP-034) |
| DA-06 | Workload model of gap audit 15 §2 | Assumption for sizing only |
| DA-07 | Team is small and one deployable is preferred | Assumption; team size unknown (FD-03) |
| DA-08 | Two editions: hosted SaaS (primary) and licensed self-hosted (single-tenant, same codebase) | Founder choice 2026-11-12 (DEC-17) |

## 6. What these documents do not and cannot establish

They do not show that anyone will pay; that any market is the right one; that the platform's economics work; that any legal reading is correct; or that the engine meets performance needs. They make the product **definable and testable**, so that when those answers arrive the build can start without guessing. The readiness verdict is in `09-governance/04_DEVELOPMENT_READINESS_REPORT.md`.

## 7. Compliance and security requirement index (from research 51 and gap audit 29)

| ID | Requirement | Class |
|---|---|---|
| CMP-01 | Tag sales by buyer type; report retail-customer share | Candidate |
| CMP-02 | Flag qualification or pay that depends on personal purchases | Candidate |
| CMP-03 | Attribute every payout line to its source | Candidate |
| CMP-04 | Versioned plans with approval, effective dates, audit trail | Candidate |
| CMP-05 | Earnings disclosure from actual payout data including low and zero earners | Candidate |
| CMP-06 | Electronic agreements with versions | Candidate |
| CMP-07 | Cooling-off, returns and buy-back per market | Candidate |
| CMP-08 | In-country storage option | Candidate |
| CMP-09, CMP-17 | Grievance register; delisted-seller register (India, as reported) | Candidate |
| CMP-12 | Licence evidence per tenant gating go-live | Candidate |
| CMP-14 | Block deposits or non-refundable joining fees where prohibited | Needs counsel |
| CMP-16 | Tenant acceptance policy | Founder decision |
| MH-REQ-01..10 | Ledger records obligations; batch lifecycle with preparer and approver; provider adapters; reconciliation; reversals; per-market payout rules; no crypto or e-pins; statements by source; provider record | Design inputs |
| SEC-01..13, PRV-01..07, CPL-01..15 | Security, privacy and compliance capability requirements with class (mandatory, contractual, recommended, design) | Gap audit 29; carried into `03-trd/04_SECURITY_REQUIREMENTS.md` |

## 8. Addendum (12 November 2026): Phase 2 research for Bangladesh and India

The founder asked for the missing research to be completed, scoped to Bangladesh and India. The new research sits in the sibling folder `research-completion` (documents 07-R, 10-R, 15-R and 70–79); the original RESEARCH folder is unchanged. It is desk research at screening grade: no interviews, no written provider answers, no counsel or tax opinion.

| Question | Phase 2 answer | Effect on these documents |
|---|---|---|
| Missing documents 07, 10, 15 (OQ-22) | Rebuilt from citations as labelled reconstructions: 07 fully (ratings were all quoted in 06); 10 for 11 of 17 journeys with a stated subject; 15 for about 35 of 57 rules, 14 with text | OQ-22 partly closed; no rule invented |
| Bangladesh | MLM closed in practice: no licence since 2015; 2025 central-bank warning; enforcement. Data law of 2025 with conflicting reports on localisation | DEC-20: do not target Bangladeshi MLM operators; affiliate pack only after counsel |
| India | Direct Selling Rules 2021/2023 give concrete duties (registration, officers, 48-hour / one-month grievance timers, seller registers, in-country data); commission withholding 2% under s.393 of the Income-tax Act 2025; ₹23,021 crore market; two AWS regions | PD-04 India pack; DEC-21 India as first-pack candidate |
| Competitors | Fluid, Pillars, TeqTank documentation shows no compliance analytics; Indian vendors sell one-time licences from $699 with e-wallets and no India-specific compliance features stated | Differentiation claim holds in direction; price anchor is very low |
| Plan corpus | Three Indian plans coded; 1 of 3 covered by the extended primitive list; pools by shares and stairstep differentials common | Pools move to Must for an India pack (SDD-07 unchanged in design) |
| Market score | India 3.20 (range 2.60–3.80); Bangladesh-MLM 1.45 (excluded by legal gate); Bangladesh-affiliate 2.35 | FD-02 input; founder access still unscored |
| Unit economics | Illustrative only: viability depends on reaching large Indian companies and on subscription acceptance against one-time licences | No pricing values set (DEC-14 holds) |

**Conflict C-14 (new):** Bangladesh data law — one source reports strict localisation of confidential and restricted data and a 2026 Act replacing the Ordinance; a government statement reports no blanket localisation. Recorded as AQ-13; no design depends on it because no Bangladesh MLM pack exists.
