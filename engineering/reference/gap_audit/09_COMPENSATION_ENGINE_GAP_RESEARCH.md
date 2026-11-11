# 09 — COMPENSATION ENGINE GAP RESEARCH
## The engine as a product of its own: missing mechanisms, money arithmetic, periods, caps, reversals and proof

| Field | Value |
|---|---|
| Document ID | GAP-09 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 3 |
| Gaps | GAP-020 to GAP-028 |
| Script | `09_comp_stress_tests.py` (run with `python3 -I`); every number in §4 is its output. **All numbers are hypothetical**; structures follow the sources named |
| Evidence | Four current public plans (G-S25..G-S28), the Herbalife order (G-S02), DirectScale and Exigo documentation (G-S29..G-S31), original 13 and 15 |

## 1. Verification of the original compensation work

| Check | Result |
|---|---|
| Arithmetic of EX-1..EX-9 | **Correct** (hand and script) |
| Engine principles (versioning, simulation, history, reconciliation, determinism, multi-pass order) | **Sound** |
| Taxonomy coverage | **Incomplete** (§2) |
| Money arithmetic | **Unspecified**; the original script uses binary floats (acceptable for illustration, not for an engine) |
| Caps | **Oversimplified** (§4 T3, T4) |
| Reversals | Policy left open, correctly; **the money consequence of the choice was not shown** (§4 T5) |

## 2. Mechanisms in real plans that the building blocks do not name

The original 13 §3 lists ten blocks. Four current public plans were read for this audit (G-S25 USANA India 2023, G-S26 Modere India 2022, G-S27 Scentsy US 2025, G-S28 Arieyl). Mechanisms **not expressible** with the ten blocks as written:

| # | Mechanism | Plan(s) | What the engine needs |
|---|---|---|---|
| M1 | Several positions (business centres) per person, more earned by performance, placement distance rules | USANA | Position entity separate from participant (08 GAP-010) |
| M2 | Time-boxed sponsor/placement change windows; moves needing approval | USANA, Modere | Dated change events with policy checks (07 GAP-002) |
| M3 | Fractional volume roll-up (70% / 30% of customer volume to sponsor) | USANA | Volume attribution with weights |
| M4 | Non-cash rewards: product credits, store currency, shopping credits with expiry | USANA, Modere, Arieyl | Non-cash rewards ledger (GAP-024) |
| M5 | Points-to-currency factor changeable by the company | Modere (70 INR/point) | Effective-dated conversion parameter per market |
| M6 | Count-based qualification (active customers in month) | Modere | Counting rules with their own definitions of "active" |
| M7 | Dual title tracks (builder vs promoter) | Modere | Several rank ladders per participant |
| M8 | Highest-ever title vs paid title | Modere, Arieyl | Two rank states (GAP-025) |
| M9 | Fixed bonus paid to the **first qualified upline** of each title, stackable | Modere | Upline search with qualification predicate |
| M10 | Market-scoped pools (2% of India GSV) | USANA | Pool base scoped to a market |
| M11 | Rank-ordered allocation (top-20 earners share 1%) | USANA | Ranking step before allocation |
| M12 | Cap on a **subset** of bonuses, reducing only one | Modere | Scoped, prioritised caps (GAP-022) |
| M13 | Long-horizon state (bonus after 25 months of another bonus) | Arieyl | Streak counters across periods (GAP-025) |
| M14 | One-time lifetime bonuses | Arieyl | Once-only ledger key |
| M15 | Mixed cadences (weekly and monthly components); pay-date calendar rules | USANA, Arieyl | Several calendars per plan (GAP-023) |
| M16 | Participant types beyond customer vs distributor (Affiliate, Influencer, VIP, Promoter) | USANA, Arieyl, Modere | Participant-type model (GAP-028) |
| M17 | Annual renewal fee | Arieyl | Fee ledger; CMP-14 review |
| M18 | Conditional carry-forward with cap and expiry (3,000/side while qualified; 12 months while active) | USANA, Arieyl | Carry state with conditions and expiry |
| M19 | Leg requirements on **personally enrolled** volume per leg | Arieyl | Sponsor-tree predicate inside a placement-tree bonus |

**Result:** every plan read contains at least one mechanism the blocks do not name. The taxonomy is not just untested; it is **incomplete** (GAP-020).

## 3. The brief's six questions, answered

| Question | Answer and basis |
|---|---|
| **Refund after commissions are paid?** | Two policies exist with different money results: **order-line clawback** (deduct the commission paid on that order from the next payout; the documented DirectScale behaviour, G-S29) and **restatement** (recalculate the closed period, including ranks and matching, and post the difference). §4 T5 shows order-line clawback can leave a payee with **double** the true amount when a rank threshold depended on the refunded order. The policy is a tenant decision with legal input (D-R2, D-R3) |
| **Genealogy changes retroactively?** | Distinguish **correction** from **change** (08 §4). Changes are prospective. Corrections are recorded with their original valid date; committed periods they touch are flagged; the plan's restatement policy decides whether to recalculate or adjust. Committed runs stay replayable |
| **Qualification lost mid-period?** | Depends on the **qualification window** of each bonus: point-in-time at period close (most monthly plans), rolling windows (USANA 4 weeks, G-S25), or per-order (fast start). The engine must store **when** each qualification was evaluated and on which data (GAP-025) |
| **Plan change vs historical calculations?** | A run uses exactly one plan version by effective date (BR-CMP-01, correct). Missing: **transition rules** (grandfathering ranks, carry-forward balances, streak counters into the new version) and field communication (GAP-097) |
| **Prove why a commission was calculated?** | Store for every payout line: run id, plan version, rule id, input facts (order ids, volumes, rank as evaluated, tree snapshot reference), intermediate values and rounding applied. An **explain trace** rendered for staff and, in simplified form, for distributors (GAP-027) |
| **Test a plan before activation?** | A sandbox is already marketed by incumbents (Exigo, G-S31) and projected commissions are documented (DirectScale, G-S30), so this is **table stakes**. The engine needs golden datasets, a comparison report against the current version, and a parallel run before go-live (GAP-026) |

## 4. Stress tests (output of `09_comp_stress_tests.py`)

| Test | Result | Finding |
|---|---|---|
| **T1** Pool of $62,500 over 66 shares (13 EX-6) | Rounding each share to cents pays **$62,500.02**; largest-remainder allocation pays exactly $62,500.00 | Pools and splits need a defined **remainder allocation rule** (GAP-021) |
| **T2** Company cap by proportional scaling over 8 lines | Naive rounding pays **$0.02 over the cap** | Same as T1; at scale the residue must go to a defined account or line |
| **T3** Cap of 10% of sales on team bonus ($70,000) + LDB ($45,000), Modere-style | Priority (reduce LDB only): team $70,000, LDB $30,000. Proportional: team $60,869.57, LDB $39,130.43 | Two readings of "a cap" move $9,130 between groups of leaders (GAP-022) |
| **T4** Herbalife-order structure | When the capped component exceeds one-third, the rewardable base drops from $800,000 to $750,000; ratio 75% < 80%; cap applies to MLC **excluding wholesale commissions** at $313,125 | 13 EX-9's "scale all pay" cuts lines the order leaves outside the cap |
| **T5** Refund after payout with a rank threshold and a 20% matching bonus | Paid: A $80, C $16. True after refund: A $15, C $3. Order-line clawback leaves A with **$30** and C with **$16**; restatement leaves $15 and $3 | Order-line clawback under-recovers by $15 (A) and $13 (C) here. The policy choice has real money effects, which the original did not quantify |

## 5. Gap records

### GAP-020 — The building blocks miss at least 15 mechanism classes found in current plans

| Field | Content |
|---|---|
| **Category** | Technical, product |
| **Previous research coverage** | 13 §2.2–§3 (10 blocks; "14 of 14", acknowledged circular) |
| **Missing element** | M1–M19 in §2 |
| **Evidence** | G-S25..G-S28 |
| **Why it matters** | An engine designed on the ten blocks would need custom code for each of these, recreating the "paid customization" problem reviewers complain about (03 §6) |
| **Affected stakeholders** | Engineering, implementation staff, tenants |
| **Product implications** | Plan configuration model must cover positions, participant types, multiple ladders, scoped pools, priority caps, non-cash rewards, calendars |
| **Technical implications** | Primitive set and the extension point (13 §7.3) must be re-derived from a **corpus of 20–30 public plans** before architecture |
| **Recommended solution** | Desk task now: collect 20–30 current public plans across plan types and the two candidate markets; code each against a primitive list; record what does not fit; this also satisfies G3 criterion 2 without interviews |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | High |
| **Documentation changes required** | 13 §2–§3, 15, 66 U-27 (partly answerable now) |

### GAP-021 — Money arithmetic is unspecified

| Field | Content |
|---|---|
| **Category** | Financial |
| **Previous research coverage** | BR-CMP-09 "rounding and currency follow a tenant policy" |
| **Missing element** | Decimal type and minor units; rounding mode and the step at which it applies; remainder allocation for splits, pools and scaling; currency conversion step and rate source; points-to-currency factor (M5) |
| **Evidence** | T1, T2; Modere factor (G-S26) |
| **Why it matters** | Cents that do not reconcile break the ledger (10) and erode trust in statements |
| **Affected stakeholders** | Finance, auditors, distributors |
| **Product implications** | Statement shows rounding; reconciliation tolerates zero unexplained difference |
| **Technical implications** | Integer minor units or fixed-precision decimal everywhere; no binary floats; rounding only at defined points; residue posted to a named ledger account |
| **Recommended solution** | Platform rule: compute in high precision, round once per payout line (half-up unless tenant chooses otherwise), allocate splits by largest remainder, post residue explicitly |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 13 §7, 15 BR-CMP-09, first ledger design |

### GAP-022 — Caps are scoped and prioritised, not one proportional scale

| Field | Content |
|---|---|
| **Category** | Financial, compliance |
| **Previous research coverage** | 13 EX-9, BR-CMP-05, CMP-19 |
| **Missing element** | Cap **scope** (which bonuses), **base** (which sales, with adjustments such as the one-third rule), **method** (proportional, priority order, per-person), and **remainder** rule; per-participant limits (Herbalife's one-third proviso) |
| **Evidence** | G-S02 (§I.A.1, §I.A.4, Def. G), G-S26; T3, T4 |
| **Why it matters** | Different cap methods move money between groups (T3); a regulator-imposed cap applied to the wrong lines is non-compliance with the order |
| **Affected stakeholders** | Finance, Compliance, leaders |
| **Product implications** | Cap configuration with scope, base formula, method; simulation shows who is cut |
| **Technical implications** | Caps as a dedicated pass after individual and matching passes, before rounding; per-participant constraints evaluated earlier |
| **Recommended solution** | Model caps as `Cap{scope: set of bonus types, base: expression, rate, method: proportional, priority(list) or per_person; residue: rule}` |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 13 §4, §7.2; 15 BR-CMP-05; 51 CMP-19 |

### GAP-023 — No period lifecycle or retroactivity model

| Field | Content |
|---|---|
| **Category** | Financial, technical |
| **Previous research coverage** | D-R1, D-R2 (open); 11 §4; 13 §5 edge cases 2, 7 |
| **Missing element** | A state machine for periods and the rules for late, backdated and reversed transactions |
| **Evidence** | DirectScale documents adjustments in **uncommitted** periods, committing profiles, and clawbacks after close (G-S29, G-S30) — the incumbent pattern is open → committed → paid, with post-close effects posted as adjustments |
| **Why it matters** | Without it, a late order or correction either silently changes paid history or is lost |
| **Affected stakeholders** | Finance, analysts, distributors |
| **Product implications** | Period screen with states; late-transaction queue; restatement approval |
| **Technical implications** | States: **Open → Calculating → Calculated (reviewable, re-runnable) → Committed (frozen inputs and outputs) → Paid → Closed**. Rules: (1) transactions are assigned to periods by a defined event and time zone (D-R1, edge case 7); (2) after Committed, changes post as **adjustments** in the current open period unless an approved **restatement** reopens the period; (3) every run stores its input snapshot |
| **Recommended solution** | Adopt this lifecycle as a platform rule; let tenants choose the adjustment vs restatement policy per bonus type, with T5 shown to them in simulation |
| **Priority** | **Critical** |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 11 §1, §4; 13 §5, §7; 15 BR-VOL-02, BR-REV-02 |

### GAP-024 — Non-cash rewards need their own ledger

| Field | Content |
|---|---|
| **Category** | Financial |
| **Previous research coverage** | None |
| **Missing element** | Product credits, store currency, shopping credits with expiry, incentive trips and car programmes |
| **Evidence** | USANA (product credits), Modere (shopping credits, 60-day expiry), Arieyl ("Arieyl Bucks", Tesla lease) (G-S25, G-S26, G-S28) |
| **Why it matters** | These are compensation with value; they affect disclosures, tax and liabilities; expiry rules are consumer-facing |
| **Affected stakeholders** | Finance, distributors, tax |
| **Product implications** | Credit balances, redemption at checkout, expiry notices |
| **Technical implications** | Separate ledger accounts per credit type with expiry; integration with commerce checkout |
| **Recommended solution** | Include credit types in the ledger design from day one; build redemption in V1 |
| **Priority** | Medium |
| **Implementation stage** | V1 |
| **Confidence** | High |
| **Documentation changes required** | 13, 15, 10 of this audit |

### GAP-025 — Qualification state across time

| Field | Content |
|---|---|
| **Category** | Technical |
| **Previous research coverage** | BR-RNK-01..04 (BR-RNK-03 "not researched") |
| **Missing element** | Paid-as vs highest title; rolling windows; maintenance and grace; streak counters; one-time bonuses; several cadences per plan |
| **Evidence** | M7, M8, M13, M14, M15 (§2) |
| **Why it matters** | Rank is the main driver of pay; ambiguity here produces disputes |
| **Affected stakeholders** | Distributors, leaders, Support |
| **Product implications** | Rank history screen; "what you need to keep your rank" view (factual, not income projection) |
| **Technical implications** | Per-participant state store per period: titles, counters, carry balances, one-time flags; state is an **output** of a committed run and an **input** to the next |
| **Recommended solution** | Treat all cross-period state as versioned run outputs, never as mutable fields |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 15 BR-RNK, 13 §3 |

### GAP-026 — Plan testing is table stakes and needs a real harness

| Field | Content |
|---|---|
| **Category** | Technical, commercial |
| **Previous research coverage** | 13 §7.1 "Simulation" as a requirement; 05 H-4 treats self-service change as a possible gap |
| **Missing element** | Recognition that incumbents already market it; the harness design |
| **Evidence** | Exigo sandbox (G-S31); DirectScale projected commissions (G-S30) |
| **Why it matters** | Without it the product is not credible; with it, it is not a differentiator |
| **Affected stakeholders** | Analysts, implementation staff |
| **Product implications** | Golden datasets per tenant; version comparison report (per payee, per bonus); parallel run during migration (GAP-077) |
| **Technical implications** | Deterministic engine; property tests (sum of lines = run total; caps never exceeded; no negative pay unless policy allows) |
| **Recommended solution** | Build as core, market as hygiene |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 05 H-4, 13 §7, 30 of this audit |

### GAP-027 — Per-line provenance and explanation

| Field | Content |
|---|---|
| **Category** | UX, compliance |
| **Previous research coverage** | 13 §7.1 calculation history; MH-REQ-09 statements by source |
| **Missing element** | The **content** of the trace and the distributor-facing explanation |
| **Evidence** | 41% of AARP respondents felt misled about chances (G-S16); support questions about pay are a hypothesised driver (P-07, P-08) |
| **Why it matters** | Disputes, support cost and trust |
| **Affected stakeholders** | Distributors, Support, auditors |
| **Product implications** | Statement line → "how this was calculated" with inputs; staff view with full trace |
| **Technical implications** | Trace stored per line or reproducible on demand from the committed snapshot |
| **Recommended solution** | Store a compact trace per line (rule id, inputs, rate, rounding) and regenerate full detail by replay |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | Medium |
| **Documentation changes required** | 13 §7, 15 BR-PAY-06 |

### GAP-028 — Participant types are richer than "customer or participant"

| Field | Content |
|---|---|
| **Category** | Compliance, technical |
| **Previous research coverage** | BR-ORD-01, CMP-01 |
| **Missing element** | Affiliates, influencers, VIP and preferred customers, builder vs promoter tracks, each with different eligibility |
| **Evidence** | G-S25, G-S26, G-S28; Herbalife "Preferred Customer Sales" in the rewardable base (G-S02) |
| **Why it matters** | The retail-share figure regulators care about depends on which types count as customers |
| **Affected stakeholders** | Compliance, Finance |
| **Product implications** | Configurable participant types with flags: earns? counts as end customer? can sponsor? |
| **Technical implications** | Type is effective-dated (customers become distributors) |
| **Recommended solution** | Replace the binary buyer type with a typed participant model and an order "purpose" tag |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 15 BR-ORD-01, 51 CMP-01, 12 §3 |

## 6. Business rules the engine still lacks (input to 24)

Genealogy changes (BR-GEN), period lifecycle (BR-PER), caps (scope, base, method), money arithmetic (BR-MNY), qualification state (BR-RNK-05..), non-cash rewards (BR-CRD), participant types (BR-PTY), plan transitions (BR-PLN). Draft rules are in 24.
