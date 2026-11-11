# P1 — PUBLIC COMPENSATION-PLAN CORPUS
## 21 plans coded against the engine's building blocks: what the engine must express, and how often

| Field | Value |
|---|---|
| Document ID | PA-P1 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Task | Phase A, item 5 of 31 §1 (gap audit): "plan corpus and primitive set" (GAP-020); also tests G3′(b) |
| Files | `plan_corpus/plans.csv` (coding), `plan_corpus/coded_plans.md` (evidence lines per plan), `plan_corpus/analyze_corpus.py` (counts), `plan_corpus/analysis_output.txt` (run output) |
| Sources | G-S25..G-S28 and S-141 (definition set); G-S36..G-S51 (hold-out); see §6 |

## 0. Result in four lines

1. **No hold-out plan (0 of 16) can be expressed with the original ten building blocks** (13 §3 of the original research).
2. **Only 5 of 16 can be expressed even after adding the audit's 19 extra mechanisms** (M1–M19, 09 §2 of the gap audit). The other 11 each need at least one mechanism found only in this corpus.
3. **Twelve new mechanism classes** appeared (§3), most of them in only one or two plans. Plans have a **long tail**: each company adds its own rules.
4. **Design consequence:** a fixed primitive list will not cover real plans. The engine needs (a) the common primitives built well, ranked by frequency (§4), and (b) a **controlled, versioned extension point** for the tail, with golden tests. The original 13 §7.3 hypothesis ("declarative primitives plus a controlled extension point") is supported; its weight shifts toward the extension point.

## 1. Method

| Step | What was done | Limit |
|---|---|---|
| Selection | Searched for current, official or company-hosted plan documents; kept 16 that could be read, plus the 5 already used in the audit | Only plans published online could be found; Malaysian plans are filed with KPDN and were not found publicly (§5) |
| Split | **Definition set (DEF, 5 plans)** = the plans used to derive M1–M19 in the audit. **Hold-out (16 plans)** = everything else. Coverage is measured on hold-out only, so the test is not circular | 16 is a small sample |
| Coding | Each plan read with the same 33-item checklist (volume, trees, qualification, payout types, caps and carry, timing, participant types, fees) plus "anything else"; one evidence line per item (`coded_plans.md`) | **Reading was machine-assisted** (a fetch-and-summarise tool); codes need a human spot-check before engineering relies on them |
| Tiers | **O** = original 10 blocks suffice; **M** = needs M1–M19 or the audit's rules in 24; **N** = needs a mechanism new in this corpus | Tier assignments for E2 (carry with conditions) and D9 (one-time bonuses) are treated as M-level, because nearly every instance had conditions or a once-only key (stated in the script header) |

## 2. Coverage result (hold-out, 16 plans)

| Tier needed | Plans | Which |
|---|---|---|
| O — original blocks suffice | **0** | — |
| M — extended list suffices | **5** | Color Street, Mannatech (low detail), MarketPlace Global, Qyral, PŪRVii |
| N — needs a new primitive | **11** | Avon, doTERRA (Thailand), LifeVantage (UK), Amway (UK), Poofy, Multipure, Crunchi, YOR Health, Rodan + Fields (Australia), Shaklee, Nu Skin |

**G3′(b) (31 §1 of the audit):** "the primitive set covers ≥ the founder's target share of the plan corpus, counted on plans not used to define it." **Today: 31% (5 of 16) with the extended list.** The founder has not set a target; any target above about one-third is not met.

## 3. New mechanism classes (not in the original blocks or M1–M19)

| Class | Plans | Example | Engine and product consequence |
|---|---|---|---|
| **Item-level and derived volume rules** | 4 | Avon excludes brochures, samples and kits from leadership sales; R+F removes GST from the base; Multipure credits one product category to the seller only; Crunchi nets volume already commissioned below | Volume must be computed **per order line** with rules by item type, tax treatment and category, plus derived measures (expressions over other measures) |
| **Eligibility from non-volume facts** | 3 | Amway UK: bonus only with local business/tax registration; YOR: certification test before participating; Multipure: social-media follower counts for rank, paid back-office subscription for one programme | Qualification predicates over **profile facts and external data** (registration, training, subscriptions), each with evidence and dates |
| **Requirement banking / substitution points** | 2 | Avon "protection bank" of surplus points to cover a short month; Nu Skin "Flex Points" to maintain status | A points account per participant that can satisfy a requirement, with caps and refills |
| **Provisional payments with true-up** | 2 | Shaklee pays weekly advances, recalculated and trued up monthly; doTERRA withholds estimated overpayments from pool payouts and trues up | Runs can be **provisional**; a later run computes the final amount and posts the difference — fits the period lifecycle (GAP-023) only if "provisional" is a state |
| **Volume transfers** | 1 | Shaklee: QV/PV transfers between participants, capped, with a fee | A dated, approved volume-transfer event; also a **manipulation vector** to monitor (GAP-005) |
| **Rule-triggered genealogy change** | 1 | Shaklee: a Director who does not qualify within 12 months loses sponsorship rights | Genealogy changes can be **generated by rules**, not only by requests (08 GAP-010) |
| **Credit-risk gating and receivable offset** | 1 | Avon withholds bonuses if a downline's bad debt is disproportionate, and offsets outstanding balances against payouts | Representatives may buy on credit; the ledger must hold **trade receivables** and net them |
| **Breakage** | 1 | Poofy: unpaid bonuses from title/paid-as mismatch are retained by the company | Unpaid amounts need an explicit account and disclosure, not silent disappearance |
| **First-N quotas** | 1 | doTERRA Founders: limited to a predetermined number of first qualifiers | Order-dependent allocation; ties need deterministic rules |
| **Household rule** | 1 | LifeVantage UK: one business per family unit | Participant relationships (household) checked at enrolment — also an anti-duplicate rule (07 GAP-002) |
| **Rotation assignment** | 1 | Multipure: unassigned customers' orders allocated to advocates on rotation | Attribution rules include **round-robin assignment** (11 GAP-040) |
| **Sell-through gate** | 1 | YOR: 70% of inventory must be sold before restocking | Needs **distributor-reported retail sales** as an input; links to compliance analytics (inventory-loading evidence) |

## 4. How common each mechanism is (use to prioritise the MVP primitive set)

Counts are plans where the mechanism is coded Y. "All" = 21 plans; "Hold-out" = 16.

| Mechanism | Tier | All | Hold-out | MVP priority (proposal) |
|---|---|---|---|---|
| Group volume (A2), sponsor tree pay (B1), rank thresholds (C1) | O | 21 | 16 | **Must** |
| Personal volume (A1), qualifying vs commissionable volume (A3), retail/customer profit (A4) | O | 19 | 14–15 | **Must** |
| **Participant types beyond customer/distributor (F4)** | M | 18 | 14 | **Must** (GAP-028 confirmed) |
| Unilevel % by level (D1), generations / dynamic compression (D5) | O | 16 | 13 | **Must** |
| **Fast-start / bonus on enrolment orders (D10)** | O | 16 | 13 | **Must**, and flagged by guardrails (it pays on joiners' first orders; 13 §6 of the original) |
| Leg rules (C2) | O | 15 | 11 | **Must** |
| **Counts of customers or personally enrolled people in qualification (C3)** | M | 14 | 11 | **Must** |
| Rank maintenance / grace / demotion (C6) | O | 13 | 11 | **Must** |
| Caps (E1) | O | 13 | 10 | **Must** (scoped and prioritised, GAP-022) |
| **Non-cash rewards (D11)** | M | 13 | 9 | Should (MVP ledger account; redemption V1) |
| **Mixed cadences / pay-date rules (F1)** | M | 11 | 9 | **Must** (calendars, GAP-023) |
| **Fees: kits, renewals, subscriptions (F5)** | M | 10 | 9 | Should (fee ledger; guardrail review) |
| Differential / override (D3), matching (D4), one-time bonuses (D9) | O/M | 10 | 7–8 | **Must** |
| Title vs paid-as (C5), rolling windows (C4), compression (E3) | M/O | 8–9 | 7 | **Must** |
| Carry-forward with conditions or expiry (E2) | M | 8 | 6 | Must if binary is in scope |
| Placement tree / binary (B2, D2) | O | 5–7 | 3–4 | **Could** — less common in this sample; large engineering cost (08) |
| Change windows (F2) | M | 7 | 5 | **Must** (genealogy cases) |
| Pools by shares (D6), fractional roll-up (E4), points factor (F3) | O/M | 4–5 | 2–3 | Should |
| Several positions per person (B3), market pools (D7), top-N (D8) | M | 2 | 1 | Could (keep in data model, GAP-010) |

**Reading [SR]:** the most common mechanisms are **not binary**. A first engine that does unilevel + generations + compression + ranks with paid-as and maintenance + customer counts + participant types + fast start + scoped caps + calendars would cover the core of most hold-out plans; binary and multi-position support could follow, if the target segment uses them. **This sample is US-heavy** (§5), and binary plans are reported to be common among low-end vendors' customers (03 of the original); the segment decision (FD-01, FD-02) should settle this, not the sample.

## 5. Limits

| Limit | Effect | Next step |
|---|---|---|
| **No Malaysian plan** in the corpus (Malaysian plans are filed with KPDN as "Format B" and not usually public); one Thai plan; India only via the definition set | Coverage for the candidate markets is unmeasured | Ask design partners for their KPDN-filed plan (66 Appendix A already asks for plan documents) |
| US-heavy sample; mostly mid-size brands | Mechanism frequencies may not hold elsewhere | Add plans from the chosen launch market |
| Machine-assisted reading; some documents partial (Mannatech 10-K summary, Nu Skin single bonus) | Codes may contain errors; "?" was treated as absent | Human spot-check of 5 plans before engineering uses §4 |
| Plans describe rules, not outcomes or lawfulness | Nothing here says any plan is lawful or fair | — |
| Several documents undated | Some may be superseded | Prefer dated versions when available |
| Three documents are copies hosted by third parties, not the company (YOR Health G-S46, Rodan + Fields AU G-S49, Shaklee G-S50) | The version may not be the company's current one | Replace with company-hosted copies before relying on their codes |

## 6. Sources (all accessed 2026-11-11)

| ID | Plan | Market | Date / version | URL |
|---|---|---|---|---|
| G-S36 | Avon career and compensation guide | US | 2025 | https://avon.com/magnoliaPublic/dam/pdf/2025/guides/avon-2025-career-and-compensation-guide-en-v2.pdf |
| G-S37 | doTERRA Policy Manual §10 Sales Compensation Plan | Thailand | eff. 1 Nov 2025 | https://doterra.com/TH/en_TH/policy-manual-compensation-plan |
| G-S38 | LifeVantage UK compensation plan (SEC exhibit 10.7) | UK | eff. 1 Feb 2024 | https://www.sec.gov/Archives/edgar/data/849146/000084914624000047/evolvecompensationplanuk.htm |
| G-S39 | Amway "Understanding the Plan" | UK | undated | https://amway.co.uk/business-opportunity/amway-sales-marketing-plan/understanding-the-plan |
| G-S40 | Poofy Organics compensation plan guide | US | 2024 | https://cdn.shopify.com/s/files/1/0789/4188/0607/files/Poofy_Compensation_Plan.pdf |
| G-S41 | Color Street compensation plan summary | US/CA | undated | https://cdn.colorstreet.com/content/documents/compensationplansummary.pdf |
| G-S42 | Multipure compensation plan | US | 2026 (sign-ups from 1 Oct 2026) | https://Www.Multipure.com/content/mp-comp-plan.pdf |
| G-S43 | Crunchi advocate compensation plan | US | eff. Jun 2026 | https://attachments.gorgias.help/B9Zby7ZGXmNxeNk3/hc/mJQz8751N07adpn4/2026042817-b5fe0668-d1f7-41c5-8cdd-9d52609f5a62-advocate-compensation-plan%20effective%20june%201%202026.pdf |
| G-S44 | Mannatech Form 10-K FY2025 (plan summary; commissions and incentives 35–43% of net sales) | Global | FY2025 | https://www.sec.gov/Archives/edgar/data/0001056358/000143774926012430/mtex20251231_10k.htm |
| G-S45 | MarketPlace Global compensation plan | Global | REV 2.14.25 | https://cdn.raveretailer.com/4450703AD7/2025/02/GSR_67afb330337857576521739571520.pdf |
| G-S46 | YOR Health compensation plan V5.07 | US | rev. 7 Jul 2023 | https://truthinadvertising.org/wp-content/uploads/2023/11/YORHealth_Compensation_Plan.pdf |
| G-S47 | Qyral sales compensation plan | US | updated 28 Feb 2024 | https://cdn.shopify.com/s/files/1/0284/9197/2692/files/SALES_COMPENSATION_PLAN_1.pdf |
| G-S48 | PŪRVii compensation plan | US | dated 9 Nov 2024 | https://cdn.raveretailer.com/EEB36D845C/2024/11/GSR_673226dc5105a4327571731343596.pdf |
| G-S49 | Rodan + Fields compensation plan | Australia | undated (2017 programmes) | https://static1.squarespace.com/static/5388101ae4b04631a5e04b76/t/5e3da224797fca62b0cd3442/1581097551166/rodan-fields_comp_plan_au.pdf |
| G-S50 | Shaklee compensation plan | US/CA | eff. 1 Jun 2024 | https://storage.googleapis.com/msgsndr/AXg4uaUMvGaPpR4AJlOF/media/678bd901671b4d2c6feeb2a6.pdf |
| G-S51 | Nu Skin "What is the Leading Bonus" (knowledge base export) | Global | modified 31 Oct 2024 | https://nuskin.knowledgeowl.com/help/pdfexport/id/5d267c328e121c2d5977024c |
| — | Young Living Europe plan ©2016 (same generation as DEF plan; excluded from counts) | UK/FI | 2016 | https://asiakas.kotisivukone.com/files/oljymme.julkaisee.fi/compensationplan_UK_Web-VO-FI.pdf |

Definition set: S-141 (Young Living 2015–19 review), G-S25 (USANA India), G-S26 (Modere India), G-S27 (Scentsy US), G-S28 (Arieyl).

## 7. Distributor-outcome evidence found while collecting (for the compliance-analytics demo)

Herbalife's **Malaysian** "Statement of typical distributor earnings" (document dated 06/26, covering 2025): of 2,091,460 Distributors with at least one full year (scope as stated in the document), **421,753 (about 20%) received commissions or bonuses in a typical month**; the median of those was above RM 514 a month before expenses; the top 10% above RM 4,608; the top 1% above RM 39,050 (G-S52: https://www.herbalife.com/content/dam/global-reusable-assets/documents/pd-statement-typical-distributor-earnings-en-my.pdf). This is the kind of statement the compliance-analytics prototype (P4) would compute from payout data.
