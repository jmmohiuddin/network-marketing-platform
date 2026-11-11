# 13 — COMPENSATION PLAN RESEARCH
## Fourteen plan types, the building blocks they share, worked hypothetical examples, legal-risk indicators, and what a configurable engine must record

| Field | Value |
|---|---|
| Document ID | 13_COMPENSATION_PLAN_RESEARCH |
| Version | 0.1 (Wave 3) |
| Date | 2026-11-11 |
| Research ID | R-14 (priority P0; depends on R-01, R-35, R-08). Feeds 15_BUSINESS_RULES_CATALOG (draft), engine architecture (D7), MVP (D5) |
| Companion script | `13_comp_examples.py` (run with `python3 -I 13_comp_examples.py`); every number in §4 is its output |
| Sources | `S-xxx` register; `CMP-xx` in 51; `P-xx` in 06 |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV] |

## 0. Summary

1. **Evidence base is thin and mostly vendor-authored.** Only **one real plan** is described in any detail (Young Living, via a trade review of the **2015–2019** plan, S-141), plus structural facts from Herbalife's filing and FTC order (S-120, S-121) and a Nu Skin statement (S-122). Five other sources describe plan types in general (S-125 practitioner; S-142, S-143 vendors; S-144 non-MLM vendor).
2. **The gate G3 criterion "taxonomy covers at least 90% of observed plan types" cannot be computed meaningfully.** With two or three observed plans, a percentage means nothing. This document reports **mechanism-level coverage** (§2.2) and states why that is **circular by construction** (the building blocks were derived from the same sources). The real test is against plan documents not yet seen: collect ten from interviews (66 Appendix A).
3. **Of the 14 plan types in the brief, 12 have at least one source and 2 rest on the brief alone** (performance incentives and recurring; §2.1). Of the 12, only 3 are fully observed in a real company's plan (unilevel, rank-based, fast-start); 3 are partly observed; 6 are described only by vendors or practitioners.
4. **Plan labels do not determine legality; what money is paid for does.** The FTC order bars compensation "solely for enrolling or recruiting" and compensation on excess claimed retail sales (S-120); FTC guidance treats purchases to qualify as evidence of a pyramid (S-020). **No source read assesses binary or matrix plans as plans** [UV]. Risk indicators in §6 are **named by sources**, not conclusions.
5. **Nine worked examples (EX-1 to EX-9, hypothetical numbers)** show where plans need decisions the engine must make explicit: compression, carry-forward versus flush, caps, differential versus override, shares in a pool, and **a refund that creates a negative balance** (EX-8).
6. **Engine requirements (§7)** follow the brief: **do not hardcode one compensation model.** The evidence for them is job-posting duties (test scenarios, regression, reconciliation, audit; S-130, S-131), a regulator's audit and claw-back duties (S-120) and a non-MLM vendor's change-control description (S-144). Declarative versus code-plugin rules is analyzed in §7.3 as an **inference [IP]**, not a finding.

## 1. Method and limits

| Item | What was done | Limit |
|---|---|---|
| Plan documents | Read one trade review of a real plan (S-141), one company income statement (S-140), a practitioner overview (S-125), two vendor pages (S-142, S-143), one 10-K and one order (S-121, S-120) | **No current primary plan document** from any company; S-141 is 2015–2019 and may have changed |
| Taxonomy | Built from those sources and the brief's 14 types | Types not found in sources are labeled [HY] |
| Examples | Python script with invented volumes; two vendor examples reproduced (binary pairing, S-143) | Numbers are **hypothetical**, not any company's data |
| Legal review | Indicators named in sources; screening only | Counsel has not reviewed (A-07) |

## 2. Taxonomy

### 2.1 The 14 plan types

"Observed" = a real company plan or filing uses it. "Described" = a source explains the type but not as a real plan. "Brief only" = no source read describes it.

| # | Type | What it pays on (generic) | Core mechanics | Evidence | Status |
|---|---|---|---|---|---|
| 1 | **Unilevel** | Volume of members at set depths under the earner | % per level, levels 1..n, personal and group volume, activity requirement, compression | S-141 (8/5/4% on up to five levels), S-125, S-142 | **Observed** (one dated plan) |
| 2 | **Binary** | Matched volume of two legs | Left and right legs, weak or pay leg, pairing ratios (1:1, 1:2, 2:3), carry-forward or flush, caps, spillover and placement | S-143, S-142 | Described (vendor only) |
| 3 | **Matrix** | Volume within a fixed-width, fixed-depth grid | Width × depth (3×5 holds 363 positions, EX-4), placement, spillover | S-125, S-142 | Described |
| 4 | **Breakaway** | Group volume until a member "breaks away" | A leader who reaches a rank leaves the sponsor's pay group; sponsor earns an override or nothing | S-125 | Described |
| 5 | **Stairstep breakaway** | Group volume by rank, with breakaway | Rank steps with rising percentages; override or differential; breakaway on rank (EX-3) | S-125, S-142 | Described |
| 6 | **Hybrid** | A blend of the above | E.g., unilevel plus binary plus ranks | S-142 (definition only) | Described |
| 7 | **Generation-based** | Volume of generations of leaders below the earner | Bonus on "generations" of qualifying leaders (not simple levels) | S-141 ("generational bonus"; details not read) | Observed, **detail unread** |
| 8 | **Rank-based** | Achievement of ranks | 10 ranks using PV, GV, PGV and leg requirements; pay depends on rank | S-141 (10 ranks), S-142 | **Observed** |
| 9 | **Customer-sales incentives** | Sales to non-participants | Retail commission (24% in S-141); retail-sale records | S-141, S-120 (retail sales data) | **Observed** as a feature, not a standalone plan |
| 10 | **Leadership** | Top-rank pools or bonuses | Profit pools by shares, leadership bonuses (EX-6) | S-141 (three pools: 1%, 6.25%, 0.5% of commissionable volume) | **Observed** as pools; "leadership bonus" label is **brief only** |
| 11 | **Matching** | A percentage of a downline's bonus | 10% of downline bonus in the vendor example (EX-7) | S-143 | Described |
| 12 | **Fast-start** | New enrollees' early orders | Capped % on early orders, second level (EX-5) | S-141 (20%, cap $200 per order; 10%, cap $80) | **Observed** |
| 13 | **Performance incentives** | Promotion or contest results | Time-limited bonuses, travel or prizes | **Brief only** (S-138 vendor: promotions that do not expire or stack create leakage, unsourced) | [HY] |
| 14 | **Recurring** | Repeat or autoship orders | Residual commission on recurring orders | **Brief only** (S-126 concerns the customer's recurring charge, not pay) | [HY] |

**Count:** Fully observed in a real company's plan: **1, 8, 12** (three). Partly observed: **7** (detail unread), **9** (a feature, not a standalone plan), **10** (pools seen; the "leadership bonus" label is from the brief). Described by vendors or practitioners only: **2, 3, 4, 5, 6, 11** (six). Brief only: **13, 14** (two). So **12 of 14 types have at least one source** and **2 rest on the brief alone**.

### 2.2 Mechanism-level coverage (replaces the "90% of plan types" test)

The mechanisms seen in the sources, and the building blocks (§3) that express them:

| Mechanism seen | Source | Building blocks |
|---|---|---|
| Retail commission on sales to customers | S-141 | Volume measure (retail), percentage payout |
| Unilevel percentages by level | S-141 | Hierarchy (sponsor tree), percentage by depth |
| Fast-start with per-order caps and a second level | S-141 | Time window, percentage, per-order cap, depth |
| Ranks from personal, group and leg-limited volume | S-141 | Volume measures, qualification, leg limits |
| Generational bonus | S-141 | Hierarchy, rank-qualified depth |
| Profit pools divided by shares | S-141 | Pool, share allocation |
| Pairing with ratios, carry-forward or flush, weekly caps | S-143 | Two-leg hierarchy, ratio, carry state, cap |
| Spillover and placement | S-143, S-125 | Placement tree distinct from sponsor tree |
| Matching bonus | S-143 | Percentage of another payee's bonus (second-pass calculation) |
| Compensation only on defined "rewardable" transactions; no pay solely for enrolling | S-120 | Eligibility filter on volume |
| Retail-sale data in a standardized format; audits | S-120 | Data model, audit |
| Company-level cap when the rewardable share is under 80% | S-120 | Company-level cap function (EX-9) |
| Per-market compensation caps (30% China, 35% South Korea) | S-122 | Market override of cap |
| Refunds with claw-back | S-120, S-124 | Reversal, balance policy (EX-8) |

**Result: 14 of 14 mechanisms map to the §3 blocks. This is circular:** the blocks were chosen from these mechanisms. **The meaningful test is future:** map ten plan documents that were not used to build the taxonomy and count what does not fit (66 Appendix A, ask for plan documents).

## 3. Building blocks (the primitives a configurable engine would need) [IP]

| Block | Variants seen or implied | Decision the plan must state |
|---|---|---|
| **Volume measures** | PV (personal), GV (group), PGV (personally enrolled group), CV or SV (commissionable or sales value); retail versus personal use (S-141, S-143) | Which orders count; how returns affect them |
| **Hierarchy** | Sponsor tree; **placement tree** (binary, matrix); depth limits | Which tree each bonus uses; what happens on sponsor change |
| **Qualification** | Active status, personal-volume minimum, rank, leg requirements, purchase minimums | Whether qualification by **purchase** is allowed in a market (CMP-02) |
| **Payout function** | % by level; per-pair amount; differential; override; matching; pool share; flat bonus | Rounding, currency, minimum payout |
| **Limits** | Per-order cap, per-period cap, per-person cap, company-level cap | Whether caps flush or carry |
| **State across periods** | Carry-forward volume, rank retention, grace periods | How reversals reach past periods |
| **Compression** | Standard versus dynamic (S-142) | Definition (EX-1b: an illustrative definition, not the only one) |
| **Timing** | Weekly or monthly runs (S-131); period close | Cut-off time zone; late orders |
| **Adjustments** | Hold, reversal, claw-back, manual adjustment | Who may approve; negative balance rule |
| **Market overrides** | Caps, windows (cooling-off, buy-back), currency | Which rule wins when plan and market conflict |

## 4. Worked examples (hypothetical numbers; reproduce with the script)

**All volumes, counts and prices are invented.** Plan parameters echo structures reported in the sources named in each row. Only the four pairing examples in EX-2 reproduce examples published by a vendor (S-143, per the script's header); the $10 per pair and the 100-unit pair size are the script's parameters.

| ID | Feature | Inputs | Result | Decision the example exposes |
|---|---|---|---|---|
| **EX-1** | Unilevel, 5 levels at 8, 5, 4, 4, 4 % (structure of S-141) | Level volumes 1,000 / 2,500 / 4,000 / 6,000 / 8,000 | Level payouts 80 / 125 / 160 / 240 / 320; **total 925** | Which volumes count; level cap |
| **EX-1b** | Compression (illustrative definition: inactive members drop out of the level path) | Chain of six members; the second is inactive | **800 without compression; 1,040 with** | Compression changes pay for everyone above; the definition must be explicit and versioned |
| **EX-2** | Binary pairing, 100-unit pairs at $10 per pair (vendor example, S-143) | 300 v 350 | **3 pairs, $30, carry 50** on the right | Carry-forward versus flush |
| | | 3,300 v 3,333 | **33 pairs, $330, carry 33** | |
| | | 300 v 600 at 1:2 | **3 pairs, $30** | Ratio changes pair definition |
| | | 620 v 900 at 2:3 | **3 pairs, $30, carry 20** on the left | |
| | Weak-leg 10% version | 500 v 1,100 | **$50**; strong leg keeps 600 | Which leg pays |
| | Weekly cap of 100 on each leg | 200 and 300 | **100 and 100 counted**; 100 and 200 flushed | Flush hides earned volume; disclosure matters |
| **EX-3** | Stairstep breakaway, group volume 6,000 | Override 3% **or** differential (21% − 15%) | **180 override; 360 differential** | The same structure pays double under one reading; the engine must make the model explicit |
| **EX-4** | Matrix 3×5 | Width 3, depth 5 | 3, 9, 27, 81, 243 = **363 positions** | Spillover placement rule |
| **EX-5** | Fast-start (cap $200 per order; upline 10%, cap $80; S-141 parameters) | 1,200 order | **240 capped to 200; upline 120 capped to 80** | Cap per order or per period |
| **EX-6** | Profit pool by shares (6.25% of company volume, S-141 structure) | Company volume 1,000,000; 40 Silver at 1 share, 10 Gold at 2, 2 Platinum at 3 | Pool **$62,500**; 66 shares; **$946.97 per share**; Gold $1,893.94; Platinum $2,840.91 | Pool depends on **company-wide** volume; it must be recomputed whenever any volume is reversed |
| **EX-7** | Matching bonus (10%, S-143) | Downline bonus $10 and $480 | **$1 and $48** | Matching needs a second calculation pass |
| **EX-8** | **Refund after commissions paid** | 500 order; level 1 at 8% = 40, level 2 at 5% = 25; level-1 earner's next-period commission is 25 | **Balance −15** if the reversal is netted | **Negative-balance policy:** carry, write off or collect. A legal and policy question (S-124 says practice varies) |
| **EX-9** | Company-level payout cap (structure from S-120 summaries) | Net sales 1,000,000; rewardable 700,000 (70%); proposed pool 330,000 | Ratio under 80% → cap 41.75% of rewardable = **292,250**; **scaling factor 0.8856** | A company-level cap can scale down **every** payee; it must run after all individual calculations |

## 5. Edge cases the engine must define (checklist) [IP]

Each needs an explicit rule, tested in simulation, and recorded in the plan version.

1. Sponsor change or account merge: do past volumes move?
2. Backdated enrollment or order: is a closed period reopened?
3. Rank ties and demotions after a return (EX-8 consequence).
4. Compression definition and depth after a termination (J-16).
5. Rounding and currency: when to convert, how to round, minimum payout.
6. A cap that applies per period versus per order (EX-5) versus per company (EX-9).
7. Time zone of period close.
8. Placement and spillover with no free slot (EX-4).
9. Pool recomputation after a late reversal (EX-6).
10. Manual adjustments: who approves, and how they are labeled in reports (P-13).

## 6. Legal-risk indicators by plan feature (screening, not advice) [SR]

**Principle:** regulators judge what money is paid for and how much rests on real retail sales, not the plan's name (S-020, S-120). **No source read assesses binary, matrix or unilevel plans as such [UV].** The indicators below are features that **sources name**.

| Feature | Indicator named | Source | Platform response (candidate) |
|---|---|---|---|
| Pay for enrolling or recruiting alone | Barred in the Herbalife order; stated as **not paid** at Nu Skin | S-120, S-122 | Block or flag "recruitment-linked" payout lines (CMP-03, MH-REQ-07) |
| Purchases required to qualify or high ongoing personal purchase requirements | Evidence of a pyramid (FTC guidance); named risk feature (practitioner) | S-020 (via 51), S-125 | Qualification-by-purchase report (CMP-02) |
| Inventory loading | Named risk feature | S-125 | Order-pattern flags (links to P-14) |
| Starter kits carrying commission | Red flag (trade review) | S-141 | Flag in plan review (CMP-02) |
| Matrix "game" appearance | Named risk feature | S-125 | Plan-review checklist |
| Compensation on claimed retail sales above actual | No multi-level pay on excess claimed retail sales | S-120 | Retail-sale evidence in a standard format (CMP-01) |
| Low share of rewardable sales | Company-specific payout cap in the Herbalife order | S-120 | Company-level cap simulation (EX-9; **CMP-19** per-market caps planned) |
| Earnings claims | Must reflect the typical participant | S-020 | Earnings-disclosure reports (CMP-05) |
| Sales mostly to reps | Invites FTC scrutiny (vendor caution) | S-142 (vendor) | Retail-share report (CMP-01) |

**The platform's role [IP]:** show these indicators to the operator and to a compliance reviewer; **do not certify** a plan as lawful. The risk that a tool helps dress up an unlawful plan is real (challenge C6; Q-1).

## 7. Configurable engine: what the research says it must record

**Brief rule: do not hardcode one compensation model.** Requirements below show where evidence exists.

### 7.1 Requirements

| Requirement | What it means | Evidence | Label |
|---|---|---|---|
| **Versioned rules** | Each plan change is a new version with effective dates, approver, justification; old versions immutable and replayable | Plan-change duties (S-130, S-131); Malaysian filing of plan amendments with justification (S-043); change control with owner, approver, effective date and version (S-144, a non-MLM vendor) | [RB]; CMP-04 |
| **Simulation** | Run a proposed version on historical data before release; show payout differences by payee and total | Regression testing and test scenarios (S-130, S-131) | [RB] |
| **Calculation history** | Store, for every run: inputs snapshot, rule version, outputs and run id, so any payout line can be reproduced | Audit and reconciliation duties (S-130, S-131); seller-visible calculation detail (S-144) | [RB]; MH-REQ-09 |
| **Reconciliation** | Control totals from orders to volume to commissions to payout instructions to provider settlement; variance against the previous run | Reconciliation duties (S-130, S-132) | [RB] |
| **Exception queue** | Manual adjustments, holds and approvals recorded with reason, approver and timestamp; reported separately | Manual exception requests (S-132) | [RB] |
| **Audit trail** | Who changed what, when, why; immutable | FTC order requires audits and independent auditor reports (S-120) | [VF for one company] |
| **Per-market overrides** | Caps, cooling-off and buy-back windows, currency and tax rules per market; clear precedence | S-122 (caps by market), S-015, S-043, S-124 | [RB]; CMP-07, CMP-19 |
| **Reversal and recalculation** | Refunds and terminations reach back into closed periods or post adjustments; negative-balance policy | S-124, S-120 (claw-back); EX-8 | [RB] |
| **Determinism** | The same inputs and rule version always give the same output | Needed for audit and dispute handling | [IP] |
| **Separation of duties** | Preparer and approver differ for payout batches and plan changes | MH-REQ-02 | [SR] |

### 7.2 Calculation order

Because of EX-6, EX-7 and EX-9, the calculation is **not one pass**: individual bonuses first, then matching (depends on others' bonuses), then pools (depend on company volume), then company-level caps (scale all), then per-person minimums and rounding. A reversal anywhere can change later passes [IP].

### 7.3 Declarative rules versus code plugins [IP]

No source compares these. The analysis below is reasoning for Wave 5, not a finding.

| Criterion | Declarative rules (data) | Code plugins | Reading |
|---|---|---|---|
| Edit by non-programmers | Possible within the language | No | Matters if the pain is cost of change (P-02, unproven) |
| Expressiveness | Limited to the primitives | Unlimited | Edge cases (§5) may exceed primitives |
| Audit and simulation | Easy: rules are data | Harder: behavior lives in code | Matters for P-05 |
| Security | Smaller attack surface | Needs sandboxing | P-04 |
| Risk | Language becomes a poorly designed programming language | Each tenant becomes a custom build | Both are real |

**Hypothesis:** declarative primitives for common mechanics, with a controlled extension point for exceptions, versioned and simulated like rules. **A decision for Wave 5 after interviews show how often plans need code.**

## 8. What would settle this

- **Plan documents:** ten from operators (interviews) to test taxonomy coverage (§2.2).
- **Primary plan text:** a current Young Living or other company plan document instead of a 2015–2019 review.
- **Counsel:** the legal-risk indicators (§6), the negative-balance policy (EX-8), and whether a reversal may alter a closed period.
- **Vendor documentation reads (V3):** how existing platforms configure plans, history and simulation (U-16).
