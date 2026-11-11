# 31 — MVP AND ROADMAP REVISION RECOMMENDATIONS
## What must happen before an MVP, two candidate MVP shapes, and what to defer or drop

| Field | Value |
|---|---|
| Document ID | GAP-31 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Previous state | No MVP defined; narrow-wedge default (OQ-07); G3 not passed; interviews chosen (Option A) but not started |
| Rule | No calendar durations are given: they depend on founder resources (OQ-04), which are unknown |

## 1. Revised sequence

| Phase | Purpose | Work (desk unless stated) | Exit criterion |
|---|---|---|---|
| **A. Decide and de-risk** | Remove the Critical unknowns that do not need a product | (1) Founder decisions FD-01..FD-06 (35); (2) payment and payout provider eligibility in the candidate market, in writing (GAP-004); (3) tax adviser on withholding (GAP-031); (4) counsel on guardrails, vendor exposure, payout design, residency (GAP-087; Q-1, Q-2, Q-5, Q-9); (5) **plan corpus of 20–30 public plans and primitive set** (GAP-020); (6) competitor documentation reads for Fluid, Pillars, TeqTank, ByDesign and one local vendor (GAP-080) | Each item answered or explicitly accepted as a risk |
| **B. Validate demand** | Test the one remaining whitespace and the engine positioning | Interviews per 66 Appendix A, **re-weighted** to compliance officers and analysts; add questions on compliance analytics, migration, attestations, provider problems, tax steps; a clickable prototype of compliance reports on a design partner's export (option P4) | Pre-agreed decision rules (66 A.6) plus a new rule: ≥ 3 operators with budget authority say they would pay for compliance analytics or engine replacement, with a named budget |
| **C. Technical spike** | Prove the hard parts | Genealogy benchmark (08 §6); engine prototype on the plan corpus (golden tests); ledger prototype; isolation test harness | Benchmarks pass founder thresholds; corpus coverage ≥ the founder's target |
| **D. MVP build** | One of the two shapes in §2 | Per 23 (MVP rows), 24, 25–30 | One design partner live in parallel run with zero unexplained differences |
| **E. V1** | Broaden | V1 rows in 23 | Second and third tenants |

**Gate re-definitions (replacing the original G3/G4 wording):**
- **G3′:** (a) at least one problem with **frequency** evidence and at least one with **willingness-to-pay** evidence from buyers; (b) the primitive set covers ≥ the founder's target share of the plan corpus, counted on plans **not** used to define it.
- **G4′:** every MVP feature traces to a GAP, problem or compliance requirement **and** to at least one buyer interview or design-partner request.

## 2. Two candidate MVP shapes

| | **MVP-A: Compliance analytics overlay** (positioning P4) | **MVP-B: Engine + compliance, API-first** (positioning P2) |
|---|---|---|
| What it does | Reads an operator's existing back-office data (export or read-only SQL, which incumbents provide, G-S30, G-S31) and produces retail-customer share, personal-consumption share, payout-source mix, qualification-by-purchase report, earnings disclosure from payouts | Runs commissions end-to-end behind any commerce front end, with periods, ledger, payouts via providers, tax, provenance, plus the compliance reports |
| Features (23) | F-20 (as mapping), F-24, F-25, F-30-style import, F-12-lite (trace to source rows) | F-01..F-04, F-06..F-24, F-26, F-28..F-30, F-32..F-34, F-38, F-40, F-43 |
| Build size | Small | Large |
| Risk retired | Demand for the one remaining whitespace (05 CL-02, CL-06) | Engine feasibility, migration, margins |
| Main risks | Adverse selection; small ticket; data-access cooperation | Competes with established vendors on hygiene; long sales cycles; provider eligibility |
| Sequencing | First, as a demand test | Second, only if MVP-A or interviews show buyers want to replace their engine |

**Recommendation [SR]:** run MVP-A as a **paid pilot or design-partner prototype** during Phase B. Commit to MVP-B only if Phase B evidence passes G3′ and G4′.

## 3. Prioritisation of MVP-B candidates

RICE needs reach, impact, confidence and effort. **Reach and impact are unknown** without interviews, so a numeric RICE score would be false precision. The table below uses an explicit **risk-based** ordering instead; RICE can be applied in Phase B when interview counts exist (the frame is in §4).

| Order | Capability | Why it is first | Classification |
|---|---|---|---|
| 1 | Ledger, money rules, payout lifecycle, provider adapters, bank-detail controls | Wrong money is the worst failure | Must (hygiene, Critical gaps) |
| 2 | Periods, runs, snapshots, approvals, provenance | Reproducibility and disputes | Must |
| 3 | Genealogy model (positions, bitemporal relationships, change cases, visibility) | Every calculation depends on it | Must |
| 4 | Plan primitives from the corpus; caps; qualification state; simulation and golden tests | Core engine | Must |
| 5 | Tax withholding for the launch market | Mandatory | Must (launch market) |
| 6 | Isolation, vendor access sessions, privacy tooling | Critical security and processor duties | Must |
| 7 | Commerce ingestion and attribution | Data in | Must |
| 8 | Compliance analytics and guardrails | The differentiator candidate | Should (Must if Phase B confirms) |
| 9 | Migration toolkit and parallel run | Switching lever; go-live safety | Should |
| 10 | Distributor statement, local language, mobile | Trust and support cost | Must (minimal), Should (polish) |

## 4. RICE frame for Phase B (inputs to collect, not values)

| Input | Definition for this product | Source |
|---|---|---|
| Reach | Number of interviewed operators (of n) reporting the problem in the last 12 months | G-EXEC, G-FIN, G-CMP |
| Impact | Their own estimate of hours or money per occurrence (ordinal 1–3 if no figure) | Same |
| Confidence | High if ≥ 2 independent source types plus buyers; Medium if buyers only; Low otherwise | 07 rubric |
| Effort | Engineering estimate after the spike (Phase C) | CTO |

## 5. Defer and do not build

| Item | Decision | Reason |
|---|---|---|
| Non-cash credits, multi-currency, leader dashboards, integrity signals, earnings disclosure (if not US), AI variance explainer, configuration assistant | **V1** | Needed, not first |
| Natural-language reporting, support AI, forecasting, multi-brand tools, SQL replica for all | **V2 / Enterprise** | No evidence yet |
| Native storefront, LMS, social monitoring crawler, GL/AP module | **Integrate / partner** | Served by others |
| Wallets, e-pins, crypto; income projections; recruit leaderboards; AI recruiting content; lead scoring; percentage-of-volume pricing; tenant-specific code | **Not recommended** | Legal, ethical or economic reasons in 23 §2 |
