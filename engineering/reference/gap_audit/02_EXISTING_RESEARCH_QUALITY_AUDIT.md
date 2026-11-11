# 02 — EXISTING RESEARCH QUALITY AUDIT
## Completeness, accuracy, depth, consistency, commercial and technical viability — with the evidence for each judgement

| Field | Value |
|---|---|
| Document ID | GAP-02 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Basis | Full read of every original document (01 inventory); re-run of both calculation scripts; 35 new sources (G-S01..G-S35) |
| Confidence scale | **High** strong evidence · **Medium** reasonable with limits · **Low** weak · **Unknown** |

## 0. Verdict in five lines

1. **Honest but incomplete.** The research rarely overstates. Its labels, arithmetic and refusals are sound. Its main failures are **omissions**, not errors.
2. **It stopped at desk-research limits it had not exhausted.** Several questions it marked "needs interviews" can be partly answered from public documents: current compensation plans, vendor help centres, payment-provider policies, self-regulatory reports, tax guidance (§4). Those sources change three conclusions (§3).
3. **Its strongest opportunity claim is weaker than stated.** The "compliance evidence and reversals" cluster rests on vendor marketing-page silence. Vendor documentation shows clawbacks, adjustments, approvals, period commits and plan sandboxes are **already documented incumbent features** (G-S29..G-S31). What remains unclaimed is narrower: compliance **analytics** derived from transaction data (03 of this audit, GAP-081).
4. **Two Critical omissions bear on any build:** mainstream payment providers prohibit or restrict MLM merchants (GAP-004), and the priority markets impose payout **tax withholding and reporting** the research never mentions (GAP-031).
5. **No product, technical or financial documentation exists,** so the brief's consistency and technical-viability questions cannot be answered from the repository; this audit answers them as design requirements (15, 28).

## 1. Completeness (brief §4.A)

| Question | Finding | Evidence | Confidence |
|---|---|---|---|
| Critical business areas covered? | **No.** Covered: industry, market, competitors, problems, stakeholders, compensation, legal screen. Not covered: the **platform's own business model** (pricing, cost to serve, implementation economics), process analysis (planned 14), financial feasibility, positioning | 01 §3 of this audit; original 12 states the platform's model is "Wave 4 work" and it was never done | High |
| All relevant user groups represented? | **Partly.** 24 stakeholders listed, but **vendor-side staff** (our support and implementation team, who can see every tenant), **field advisory councils**, **distributors as business entities or joint accounts**, **heirs and assignees**, **card acquirers** and **self-regulatory bodies** are missing | Original 08 §2–3; Master Plan §9 named "platform operator (our own support and implementation team)" but 08 did not add it | High |
| Operational workflows documented? | **Core chain only.** Missing: sponsor and placement changes, genealogy corrections, duplicate merges, succession and transfer, commission disputes, chargebacks, period close and late orders, plan-change rollout, market launch, KYC failure, fraud investigation, tax year-end, data-subject requests, migration cutover | Original 10 (17 brief journeys only) and 11 | High |
| Industry-specific problems missing? | **Yes, several** (07 of this audit): distributor earnings and health **claims on social media** (frequency evidenced by DSSRC, G-S15), genealogy disputes, account integrity, unauthorized channels, payment-acceptance risk, tax withholding | 06 §3 lists five areas "not researched" | High |
| Modules absent? | No module was researched (R-MOD-A..M were Wave 4) | Roadmap §10 | High |
| Integrations missing? | Payments, payouts, tax and commerce integration were not researched beyond the payout legal screen | 51 §5.6 "Not done" | High |
| Technical requirements sufficient? | **None exist.** T6 technical probes and the V-06 large-tree benchmark were never done | Roadmap §13.3 | High |

## 2. Accuracy (brief §4.B)

### 2.1 Checks that passed

| Item checked | Method | Result |
|---|---|---|
| Market arithmetic (02 §5.2) | Recomputed by hand and by re-running `02_market_calcs.py` | Correct: $9.1M / $45.6M / $91.3M; 167 / 33 / 17 customers per $1M |
| WFDSA figures and derived ratios | Script re-run | Output matches documents |
| Compensation examples EX-1..EX-9 | Recomputed by hand and by script | Arithmetic correct in all nine |
| Label discipline | Spot-checked 40 claims across 01–15, 51 | Labels match evidence in all spot checks |
| Herbalife order cap (51 CMP-19, 13 EX-9) | Read the order (G-S02 §I.A.4) | The 41.75% cap and 80% trigger are **correct** |

### 2.2 Claims that are incomplete, outdated or wrong

| # | Claim in the original | Independent finding | Effect | Confidence |
|---|---|---|---|---|
| A-1 | EX-9 and CMP-19 model the Herbalife cap as scaling **all** compensation | The cap applies to Multi-Level Compensation **excluding Wholesale Commissions**; Net Rewardable Sales has a **one-third personal-consumption limit**; a **per-participant one-third rule** also applies (G-S02, Definitions G, §I.A.1). A second real plan caps **one bonus only** (Modere India, G-S26) | Caps are not one function; the engine needs scoped, prioritised caps (GAP-022) | High |
| A-2 | "14 of 14 mechanisms map to the building blocks" (13 §2.2), already admitted to be circular | Four current public plans contain **at least 15 mechanism classes the blocks do not name** (multiple business centres, change windows, fractional roll-up, non-cash credits, points factor, count-based qualification, priority caps, top-N pools, streak state, and more; G-S25..G-S28) | The taxonomy is **materially incomplete**, not just untested (GAP-020) | High |
| A-3 | "Merchant-account risk has no source" (06 P-16) | Stripe **prohibits** "multilevel marketing services offering commission or recruitment-based sales" (G-S04); PayPal requires pre-approval (G-S20); Zoho Payments India prohibits MLM collection fees (G-S21). 51 §5.3 had already cited a weak source on this, so the two documents disagree | Payment integration is a gating constraint (GAP-004) | High |
| A-4 | US 1099 thresholds "may have changed since 2020" (06 P-15, 15 BR-PAY-07) | $600 → **$2,000** for 2026 payments, indexed from 2027 (G-S05, Grade B; confirm on IRS.gov) | Threshold must be configuration by tax year (GAP-031) | Medium-High |
| A-5 | Tax documentation is a US 1099 question (P-15) | Malaysia: **2% withholding** under s.107D and **CP58** statements for distributor incentives (G-S12). India: **TDS 2%** under s.194H with a Rs 20,000 threshold, 20% without PAN (G-S13) | Priority markets need withholding in the payout calculation, not just year-end forms (GAP-031) | Medium-High |
| A-6 | India's DPDP Act appears only in 06 (via a Herbalife risk factor); 51 lists "the data-protection statute's interaction with Rule 5(5)" as unknown (Q-5) | DPDP Rules notified 13 Nov 2025; substantive duties apply from **13 May 2027** (G-S10). Malaysia's PDPA amendments make **processors** directly liable and require a DPO for processors (G-S14) | The platform itself has obligations as a processor (GAP-085) | Medium-High |
| A-7 | "FTC proposed rule on deceptive earnings claims" known only as a Nu Skin risk heading (51 §4.1) | NPRM and ANPRM dated **13 Jan 2025**: substantiation on request, record-keeping, possible earnings disclosure and cooling-off period (G-S03). Status after the 2025 change in FTC leadership is unknown | Substantiation records are a concrete requirement candidate (GAP-086) | High (content) / Unknown (status) |
| A-8 | "0 of 8 vendors state reversal handling" (04) and H-8 candidate gap (05) | DirectScale's help centre documents clawbacks, payable adjustments, approvals, committed periods and projected commissions (G-S29, G-S30); Exigo advertises a plan sandbox (G-S31) | H-4 and H-8 are **table stakes**, not gaps (GAP-081) | High |
| A-9 | Local vendors in Malaysia and India "not searched" (U-15) and the two markets labelled "priority" | Infinite MLM is **headquartered in Calicut, India** and expanded to Malaysia in 2023 (G-S06); Malaysian vendors exist (VYROX, G-S19) | The priority markets are the **home ground of low-price competitors** (GAP-075) | High |
| A-10 | P-05 rated **High (documented)** on the strict rubric | The documented sanction (2016 Herbalife order) punished plan design and conduct, not a failure to produce evidence; 06 itself says so | Strictly, only P-04 (a must-meet) is High; the "strongest cluster" rests on analyst judgement (07 §3) | Medium |

## 3. Depth (brief §4.C)

| Area | Depth found | What deeper work would have shown | Confidence |
|---|---|---|---|
| Competitors | One marketing page per vendor; no documentation, demos or trials | Help centres are public (G-S29, G-S30) and overturn two "gap" hypotheses | High |
| Compensation | One real plan (2015–2019) plus vendor descriptions | Many companies publish current plans; four read in this audit reveal missing mechanisms (G-S25..G-S28) | High |
| Problems | 18 records; frequency evidenced for none | DSSRC publishes monitoring volumes (G-S15): the only frequency evidence found for any direct-selling compliance problem | High |
| Root causes | Mostly "[IP]" or "not stated" | Distributor outcome studies exist (AARP, G-S16; income disclosures, G-S27) | Medium |
| Edge cases | Ten listed (13 §5) | Real plans add more (business-centre moves, change windows, streaks, priority caps) | High |
| Business consequences | Clearly explained where evidence existed | — | — |

## 4. Sources that could have reduced uncertainty without interviews

| Question left open | Public source type not used | Example used in this audit |
|---|---|---|
| Do incumbents handle reversals, adjustments, simulations? | Vendor help centres and documentation | G-S29, G-S30, G-S31 |
| Does the taxonomy cover real plans (G3 criterion 2)? | Companies' published compensation plans | G-S25..G-S28 |
| How often do compliance problems occur? | Self-regulatory monitoring reports | G-S15 |
| Can MLM merchants use mainstream payment rails? | Providers' acceptable-use policies | G-S04, G-S20, G-S21 |
| What tax duties attach to payouts? | Tax-authority and adviser guidance | G-S05, G-S12, G-S13 |
| What do distributors earn and why do they leave? | Survey studies and income disclosures | G-S16, G-S27 |
| Who competes in Malaysia and India? | Vendor "about" pages, local directories | G-S06, G-S19 |

This matters for the gate logic: G3 was failed partly on evidence that **was obtainable** (see 04, GAP-101).

## 5. Consistency (brief §4.D)

The brief's consistency questions (PRD vs design, database vs requirements, API vs architecture) **cannot be asked**: the documents do not exist. Consistency **within** the research has twelve issues, all minor to moderate; they are listed in 06 of this audit. The two that matter most:

- The payment-risk contradiction between 06 P-16 and 51 §5.3 (now resolved against 06 by G-S04).
- The core workflow diagram in 11 assumes **volume is credited after fulfilment**, while 15 lists that same choice as open decision D-R1.

## 6. Commercial viability (brief §4.E)

| Question | Finding | Confidence |
|---|---|---|
| Real paying segment? | **Not shown.** No willingness-to-pay evidence exists; the S2 Malaysia/India choice rests on channel growth and legal frameworks, not on buyer evidence, founder access or competition | High (that it is not shown) |
| Differentiated positioning? | **Not yet.** Breadth is table stakes (original finding, confirmed); several remaining "gaps" are documented incumbent features (A-8) | High |
| Pricing realistic? | **Not researched** (platform pricing never done); price anchors only | High |
| Too broad? | The brief is; the research correctly defaults to a narrow wedge | High |
| Implementation and onboarding costs? | **Not considered.** Reviews show implementation and change cost is the dominant buyer pain (03 §6); the platform's cost to serve was never modelled | High |
| Path to product-market fit? | **Unclear.** Desk evidence points to compliance analytics and migration risk as the most defensible problems, both unvalidated with buyers (33 of this audit) | Medium |

## 7. Technical viability (brief §4.F)

No architecture exists to assess. What the research **did** establish is correct and important: the engine must be versioned, deterministic, replayable, multi-pass, and able to reach back into closed periods (13 §7, 11 §4). What it did **not** establish: genealogy storage and history (V-06 never run), ledger design, money arithmetic, tenancy and data residency, reporting load, and the multi-business-centre structures real binary plans use. 08, 09, 10 and 15 of this audit address these.

## 8. Document-level quality summary

Ratings are this auditor's judgement, explained in the column to the right; they are not scores.

| Doc | Strength | Main weakness | Use as-is? |
|---|---|---|---|
| 01 Industry | Careful statistics and definitions | Not updated since Wave 1; no distributor-outcome evidence | Yes, with 07 of this audit |
| 02 Market | Transparent method; refuses to invent TAM | Bound limited to three markets and entry prices; no payments revenue; market screen unweighted | Yes, conclusions narrowed |
| 03 Competitors | Verification discipline | One page per vendor; misses new entrants and local vendors | Needs 19 of this audit |
| 04 Matrix | Honest caveats | Method cannot detect table stakes (genealogy stated by 1 of 8) | Do not use for gap claims |
| 05 Gaps | Falsifiers for every hypothesis | H-4, H-8 contradicted by vendor docs; adverse-selection risk of compliance tooling not analysed | Revise per 18 |
| 06 Problems | Strict evidence classes | Five problem areas unresearched; missed DSSRC; merchant risk wrong | Extend per 07 |
| 07 Severity | Reproducible rubric | P-05 category error; gate unattainable by design | Re-rate per 04 |
| 08 Stakeholders | Adds sensible roles | Vendor-staff role missing; buying roles all hypothesis | Extend per 08/16 |
| 09 Personas | No invention | Ignores available secondary data on distributors | Keep as hypotheses |
| 10/11 Journeys, workflows | Evidence status per journey | Missing operational journeys (§1) | Extend per 27 |
| 12 Business model | Product vs recruitment test | Platform's own model absent | Extend per 18 |
| 13 Compensation | Correct arithmetic; good engine principles | Taxonomy incomplete; money arithmetic unspecified | Revise per 09 |
| 15 Business rules | Configurable-not-hardcoded principle | Missing genealogy, period, tax, holds, disputes, FX rules | Extend per 24 |
| 51 Legal | Clear screen and payout options | Platform-binding laws (privacy, tax, payments policy) absent | Extend per 20 |
| 66 Open questions | Complete decision record | Some headings stale; G2 blocked on OQ-04 since Wave 2 | Merge with 35 |
