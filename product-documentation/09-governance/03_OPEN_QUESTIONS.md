# 03 — OPEN QUESTIONS AND ASSUMPTIONS
## What is not decided, not known or only assumed (deliverable 11_OPEN_QUESTIONS_AND_ASSUMPTIONS)

| Field | Value |
|---|---|
| Document ID | GOV-03 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Founder |
| Depends on | Research 66; gap audit 35; SYN-00 |
| Status | Draft. Nothing here has been hidden or resolved by assumption |

**Reading rule.** A requirement or design that depends on an item below is **provisional**. The documents continue on the stated working assumption so that work is not blocked, but the assumption is not a decision.

## 1. Founder decisions

| ID | Decision | Why it matters | Working assumption in these documents | Blocks |
|---|---|---|---|---|
| FD-01 | Positioning | Everything | **Chosen 12 Nov 2026 for documentation:** test compliance analytics first, build engine plus compliance only if the gate passes (DEC-01). Still to be confirmed by buyer evidence | — |
| FD-02 | Launch market, with the founder's own access scored | Tax, language, providers, residency, competition | **Market-neutral core** (DEC-02). Phase 2 recommends **India** as the first pack (DEC-21; score 3.20 against Bangladesh 1.45 / 2.35, research 75); founder access still unscored | Market pack release; provider and tax work; languages |
| FD-03 | Revenue threshold, budget, team size, time horizon | Viability; roadmap dates; pricing | None; no dates or prices given | Business case; schedule |
| FD-04 | Engage counsel in the launch market | Vendor exposure, payout design, residency, guardrails | Not engaged; all legal content screening-grade | Guardrail outcomes; go-live |
| FD-05 | Engage a tax adviser | Withholding and year-end forms | Not engaged; no values shipped | FR-TAX-002, -003 |
| FD-06 | Guardrail stance | Brand, liability, addressable market | Moderate (DEC-04) | FR-CPL-007 outcomes |
| FD-07 | Independent review of the research audit and of these documents | The same AI system produced the research, the audit and this documentation | Not commissioned | Confidence in all Critical findings |
| FD-08 | Design partner for MVP-A | Cheapest demand test | None named | Phase B |
| FD-09 | Product honesty policy | Ethics; regulatory exposure | Adopted (DEC-05) | — |
| FD-10 | Pass/fail rule for the demand test | Prevents moving the bar after results | Proposed rule in PD-02 §2 | Phase B |
| OQ-12 | Target share of plans the primitive set must cover without new platform modules | Gate G3′(b); today 5 of 16 hold-out plans | None | Engine scope |
| OQ-13 | Does the target segment use binary or matrix plans? | Placement engine cost | Data model ready; build is "Could" | FR-GEN-005 |
| OQ-24 | Price and licence form of the self-hosted edition (annual licence against perpetual plus maintenance; payee bands; modules) | DEC-17 | Annual licence recommended; no figures | Commercial offer |
| OQ-26 | Offer MVP-A as a self-hosted package to a design partner that will not send an export out? | Could unlock the demand test | Not planned; possible | Phase B |
| OQ-23 | Product name and brand | UI direction | Neutral house style | High-fidelity design |

## 2. Questions for advisers and third parties

| ID | Question | Who | Effect |
|---|---|---|---|
| AQ-10 | India: is a monthly personal purchase requirement to earn lawful, and should the guardrail block, warn or report it? (research 71 AQ-IN-01) | Indian counsel | India pack guardrail outcome |
| AQ-11 | India: scope of in-country storage of "consumer data" (sellers' data, commission records?); interaction with DPDP; duties of a foreign software vendor (AQ-IN-02, -03) | Indian counsel | India cell scope; contracts |
| AQ-12 | India: buy-back and cooling-off duties; GST on commission; Form 26Q layout (AQ-IN-04..06) | Counsel; chartered accountant | Reversal rules; tax export |
| AQ-13 | Bangladesh: does a single-level affiliate programme fall outside the 2013 Act? vendor exposure; founder's exposure selling MLM software abroad; data localisation under the PDPO / amendment / reported 2026 Act (AQ-BD-01..06) | Bangladeshi counsel | DEC-20; any Bangladesh pack |
| AQ-01 | Which payment and payout providers accept licensed direct-selling merchants in the launch market, on what terms; will the platform's own billing provider serve a vendor to such companies? | Providers, in writing | **Launch blocker**; stop trigger if none |
| AQ-02..03 | Withholding provisions, rates, thresholds and forms for commissions in the launch market | Tax adviser | Market pack tax rules |
| AQ-04 | Is in-country storage required and for which data? | Counsel | Data region; cells |
| AQ-05 | Processor duties (DPO, breach timelines) from the first tenant | Counsel | PRV-01, PRV-02 |
| AQ-06 | Status of the US earnings-claim rulemaking | US counsel | FR-CPL-009 priority |
| Q-1 | Could the vendor be exposed if a tenant's plan is held unlawful? | Counsel | Guardrails, contracts, insurance; stop trigger |
| Q-2, Q-9 | Does calculate-and-instruct need a licence; who contracts with a payout provider? | Counsel | DEC-03 |
| Q-10 / D-R2, D-R3 | May a reversal alter a closed period; how may negative balances be recovered? | Counsel | Clawback policy defaults |
| OQ-25 | Liability and update duties when a self-hosted licensee runs an outdated engine or market pack; shared-responsibility terms | Counsel | Self-hosted contract |
| OQ-27 | Controllership of prospect data entered by distributors | Counsel | FR-CRM-003 |
| OQ-28 | Duties for unclaimed or dormant balances | Counsel | FR-PAY-007 |

## 3. Evidence gaps (need field research, a design partner or a spike)

| ID | Unknown | How to close | Affects |
|---|---|---|---|
| OQ-01 | Willingness to pay for compliance analytics or engine replacement | Phase B (MVP-A with a design partner; interviews weighted to compliance and finance) | Whether MVP-B is built |
| OQ-02 | Frequency and cost of the problems the product addresses in mid-market companies | Interviews | Priorities |
| OQ-03 | Distributor needs: statements, mobile, language, devices | Distributor interviews and comprehension tests | Portal scope; NFR-PERF-06 |
| OQ-04 | Whether buyers require a security attestation | Interviews | SEC-12 timing |
| OQ-05 | Engine and genealogy performance at assumed scale | Phase C spike (QA TS-29) | NFR-PERF-04, -05, -07, -08; ADR-04, ADR-18 |
| OQ-06 | Real workload figures (positions, orders, lines, period-end share) | Design partner export | Sizing; pricing |
| OQ-07 | Corpus coding accuracy (machine-assisted; no human spot-check); no Malaysian plan; Indian plans now coded from third-party reviews only (research 74) — no Indian company-hosted plan | Human spot-check of five plans; plans from the launch market | Primitive priorities |
| OQ-08 | Incumbent capabilities beyond published documentation. **Partly closed 12 Nov 2026** (research 73): Fluid, Pillars, TeqTank documentation and two Indian vendors read — none states compliance analytics; ByDesign still not read; Pillars' 25 reports not listed | Documentation reads; buyer interviews | Differentiation claims |
| OQ-09 | Unit economics inputs (an illustrative model with labelled assumptions now exists, research 76; no input is evidenced): implementation hours per plan, migration hours, support hours, infrastructure cost per tenant, provider costs, achievable price, sales cycle | Spike; first tenants; interviews | Pricing; viability |
| OQ-10 | Provider capabilities: idempotency, status query, settlement formats, coverage | Provider documentation after AQ-01 | Adapter design |
| OQ-15 | Which commerce platforms launch-market buyers use | Interviews | Connector priority |
| OQ-20 | Whether sales, regional and country managers, warehouse and marketing staff have needs in this product | Interviews | Roles; currently no screens for them |
| OQ-21 | Whether the wireframed structure works for real users | Usability tests (UX-01 §7) | All UX documents |

## 4. Design questions still open

| ID | Question | Current handling |
|---|---|---|
| OQ-17 | One genealogy across countries when some require in-country storage | MVP: one data region per tenant; no design for split residency |
| OQ-18 | Backend language given the founding team's skills | TypeScript proposed; JVM or .NET equally valid for the design |
| OQ-19 | Cloud provider and regions | AWS by default. India: ap-south-1 Mumbai and ap-south-2 Hyderabad (research 78). Bangladesh: no hyperscaler region found |
| OQ-29 | `ltree` path size at depth 5,000 | Spike; chunked-path fallback described |
| OQ-30 | Detection of forbidden columns by content (not only by name) without false rejections | Prototype in MVP-A |
| OQ-31 | Whether distributors should be required to use a second factor | Optional by default |
| OQ-32 | Retention periods per data class and market | Market pack; counsel |
| OQ-33 | Supported-version policy and upgrade cadence for self-hosted installations | Proposed: current and previous minor release |
| OQ-34 | Whether settled payouts need a contra account in the sub-ledger or stop at "in transit cleared" | Proposed `settled_clearing`; confirm with an accountant |

## 5. Repository and process questions

| ID | Question | Effect |
|---|---|---|
| OQ-22 | Three research documents named in the audit's inventory are missing from the folder: `07_PROBLEM_SEVERITY_MATRIX`, `10_USER_JOURNEY_MAPS`, `15_BUSINESS_RULES_CATALOG` | **Partly closed 12 Nov 2026:** labelled reconstructions in `research-completion` (07 complete from 06; 10 recovers 11 of 17 journey subjects; 15 recovers about 35 of 57 rule IDs, 14 with text). About 22 rules and D-R5 remain lost. The originals are still wanted; their SHA-256 values are in the gap audit snapshot |
| OQ-35 | Several research files exist in multiple copies with different sizes | The largest, latest copy was used; confirm which are current |
| OQ-36 | Founder question OQ-05 of the research (which vendors the brief meant by "Prodigy", "Global MLM Software", "Salesforce-based MLM solution") | No effect on these documents |
| OQ-37 | Bangladesh policy (research OQ-02): no MLM customers there, or non-MLM models only | **Answered provisionally** by DEC-20 (no MLM customers; affiliate only after AQ-13) |
| OQ-38 | Bangladeshi local hosting providers and certifications | Only if AQ-13 opens a Bangladesh market |

## 6. Assumptions in force

| ID | Assumption | Source | If wrong |
|---|---|---|---|
| A-01 | The buyer is the direct-selling company; distributors are users | Research | Portal and pricing change |
| A-02 | The platform does not hold participant funds | Research | Licensing; architecture of payouts |
| A-07 | Legal findings are screening-grade | Research | — |
| A-14 | Evidence comes mostly from large companies | Research | Mid-market needs may differ |
| DA-01 | Scope follows the research path | Founder choice | Module boundaries change |
| DA-02 | Market-neutral core with packs | Founder choice | — |
| DA-03 | Moderate guardrails | Research default | Guardrail outcomes change |
| DA-04 | Honesty policy adopted | Research default | UI rules change |
| DA-05 | One currency per tenant market in MVP-B | Research | Multi-currency moves earlier |
| DA-06 | Workload model: up to 2M positions, 3M orders a month, 600k lines per run, 30% of orders in the last three days | Research (labelled assumption) | Performance targets and sizing change |
| DA-07 | Small team; one deployable preferred | This documentation | Architecture trade-offs change |
| DA-08 | Two editions from one codebase | Founder choice | — |
| DA-09 | Commerce platforms can pass attribution hints and a purpose tag | This documentation | Attribution and R2 data quality suffer |
| DA-10 | Tenants can obtain eligible payout providers themselves | Phase A desk screen | Launch blocked |
| DA-11 | Operators can export orders and payout lines with source order references from their current back office | Phase A (incumbents expose SQL access) | MVP-A data quality; R2 and R3 weaker |
| DA-12 | Personas other than the commission analyst are hypotheses | Research | Stories may be cut |
| DA-13 | Unit-economics inputs UE-01..UE-15 are illustrative assumptions, not findings | Research 76 | Viability conclusions change |
| DA-14 | Phase 2 legal and tax findings are screening-grade, from secondary sources dated 2022–2026 | Research 70, 71 | India pack content changes |

## 7. Confirmed versus provisional

| Category | Confirmed | Provisional |
|---|---|---|
| Strategy | Scope path, market-neutral core, two editions (founder choices) | Everything about demand, market, pricing |
| Rules | Platform invariants that follow from correctness (ledger balance, immutability, idempotency, exact allocation, isolation) | Every market, tax and guardrail rule; reversal defaults; change-window values |
| Architecture | Constraints taken from the research (determinism, snapshots, outbox, no funds, no tenant code) | Stack, tenancy thresholds, read-model design, all performance numbers |
| UX and UI | Honesty constraints; accessibility target | All layouts and flows (untested) |
| QA | Calculated expected values (verified by script) | Performance targets; tax fixtures; coverage of corpus and tenant plans |
