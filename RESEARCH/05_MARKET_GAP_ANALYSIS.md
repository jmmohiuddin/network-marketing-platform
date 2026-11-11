# 05 — MARKET GAP ANALYSIS (DRAFT)
## Gap hypotheses, the evidence for and against each, and what would settle them

| Field | Value |
|---|---|
| Document ID | 05_MARKET_GAP_ANALYSIS |
| Version | 0.1 **draft** (Wave 2). Final version follows problem research (Wave 3) and interviews |
| Date | 2026-11-11 |
| Research IDs | R-03 → R-32 (positioning); feeds gate G2 and D2, D3, D4 |
| Sources | `S-xxx` in 00_RESEARCH_SOURCE_REGISTER.md; analysis in 02, 03, 04, 51 |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV] |

## 0. Summary

1. **This document contains hypotheses, not findings.** A real gap needs three things: a **problem** buyers have, **under-service** by current vendors, and **willingness to pay**. For every candidate below, at least one of the three is unevidenced. **No candidate meets all three.**
2. **Seven candidate gaps are recorded (H-1 to H-7)** and **three popular assumptions are not supported by the evidence found** (§3): that commission errors are the central pain, that "all-in-one" breadth is a differentiator, and that AI is a differentiator.
3. **The strongest candidates are narrow and market-specific [HY]:** MLM-specific compliance evidence tooling (H-2), compliance packs for licensed markets, Malaysia and India first (H-3), and predictable cost of change (H-4). Each rests on **vendor-page silence plus regulator requirements plus a few directory reviews**, which is weak.
4. **For gate G2 (criterion "at least one under-served segment"): not met.** The best candidate segment is **S2, mid-market established companies in Malaysia and India** (§4), and it is a hypothesis.
5. **Coverage limits that bear on every gap:** local software vendors in Malaysia and India were **not searched**; documentation was not read; no interview exists.

## 1. Method

| Step | What was used | Limit |
|---|---|---|
| Gap candidates | Absences across seven vendor pages (04); regulator obligations (51); complaint themes in four directory review pages (03 §6); price dispersion (02 §5.2) | Silence on a marketing page is weak evidence |
| Evidence for / against | Source IDs from the register | Mostly Grade C |
| Test | A falsifier and a named validation (V-01 to V-08, counsel review) for each | None run yet |

## 2. Gap register

Evidence strength: **weak** = a single page type or a few reviews; **moderate** = two independent kinds of evidence consistent with each other; **strong** = primary or A-grade source plus buyer evidence. Nothing here reaches strong.

| ID | Hypothesis (what might be under-served) | Segment / markets | Evidence for | Evidence against or alternative reading | Strength | What would confirm | What would refute | Validation |
|---|---|---|---|---|---|---|---|---|
| **H-1** | **Transparent, published pricing.** Buyers cannot compare vendors because six of seven captured sites hide price | S2, S3; all markets | Only Infinite shows prices (S-096); prices run from $699 one-time to $5,000 per month (02 §5.2); three of four review pages mention surprise charges or scope not matching the sales call (03 §6) | Opaque pricing is normal in B2B software; enterprises expect custom quotes; a price list does not by itself create demand | weak | Buyers say hidden pricing cost them time or led to a bad purchase, and they would pay to avoid it | Buyers say price opacity is not an issue or that they negotiate anyway | V-01 interviews, including "how did you buy last time" |
| **H-2** | **MLM-specific compliance evidence in the product** (retail-customer share, qualification-by-purchase flags, payout-source attribution, versioned plans, earnings-disclosure reports; CMP-01 to CMP-05) | S1 to S3; US first (FTC), Malaysia, India, UK, EU | Regulators judge on compensation incentives and documentation (51 §3.1, 01 §1.2); FTC guidance stresses documenting retail sales; **0 of 8 vendors state these capabilities** (04 §2) | Silence on marketing pages; compliance may be handled by counsel outside the software; buyers may not pay for it; a tool can also help dress up an unlawful plan (challenge C6; counsel question Q-1) | weak | Operators and compliance officers describe manual evidence-gathering for regulators or counsel and would pay for tooling | Counsel say the evidence is produced from existing reports without effort; or no buyer cares | V-01, interviews with compliance staff; counsel review of Q-1; vendor documentation reads |
| **H-3** | **Local compliance packs for licensed markets** (contracts, cooling-off/buy-back, disclosures, grievance workflow, in-country data, licence evidence; CMP-06 to CMP-12) | S2; **Malaysia, India** (also Vietnam) | Malaysia licence application requires a sample sales contract, a buy-back policy, a price structure and marketing-plan amendment filings (S-043); India requires a written contract, a grievance officer with set response times, seller records, a published list of delisted sellers and data kept in India (S-083, S-085); **0 of 8 vendors state any of it**; about 400 licensed companies in Malaysia and 461+ registered in India (02 §5.1) | **Not searched:** local vendors in either market. Infinite lists offices in Malaysia, India and UAE (S-096), so it may already serve them. Primary texts of Act 500 and the Rules not read. Many of these are paperwork duties that a company may handle manually at small cost | weak | A sample of licensed companies reports manual compliance work and unmet vendor support; local vendors lack it | Local vendors already offer these; buyers see them as low-cost administration | Read Act 500 and the Rules (51); search local vendors; V-01 interviews in Malaysia and India |
| **H-4** | **Predictable cost and speed of change** (self-service plan and workflow configuration instead of paid customization or tickets) | S2, S3; all markets | Three of four review pages mention paid customization, ticket-based change or scope surprises (S-097, S-099, S-100); ByDesign reviewers praise "customization without custom programming" (S-098), which shows configurability is valued | Reviews are few and selected; vendors reply publicly; every platform needs some services; a configurable engine is hard to build (Master Plan R-MOD-G) | weak | Operators report frequent change requests with material cost or delay and would switch for control | Changes are rare or cheap; or configurability is already adequate at the top vendors | V-02 and V-07 interviews: last three change requests, cost, elapsed time |
| **H-5** | **A price point between a one-time $699 to $5,399 licence and $2,500 to $5,000 per month** (modern SaaS for companies that outgrew a script but do not need an enterprise platform) | S2 | Prices cluster at both ends and the middle is populated only by ByDesign's "from $2,500" and MarketPowerPRO's per-feature $499 (02 §5.2) | The middle may be already served; price per month versus one-time units are not comparable; no evidence of unmet demand | weak | Buyers in S2 name no good option in the middle | Buyers are satisfied with ByDesign or similar | V-01 |
| **H-6** | **Payout rails for Malaysia and India** (local rails such as UPI and DuitNow, instead of global card, wallet and bank payouts) | S2, S3; Malaysia, India | Orchestration providers describe global reach by card, mobile wallet and bank transfer (S-114); local rail support is **not evidenced either way**; R-38 rails not yet sourced | NPCI and PayNet pages were blocked and not read; providers may already cover local rails | very weak | Provider sandbox tests and operators' payout pain in those markets | Providers support the rails | R-38 second pass; V-05 provider tests |
| **H-7** | **Honest handling of the wallet question** (a platform that does not hold funds and says so) as a trust differentiator | S1, S2 | Low-end vendors advertise in-software wallets, e-pins and crypto (S-095, S-096); regulators scrutinize participant money flows (51 §5); an FCA page says a business acting for both payer and payee is likely to need authorisation (S-111) | A trust claim is not a purchase driver; enterprises already use provider-based payouts (S-091, S-114); evidence that buyers value this is absent | very weak | Buyers or banks cite wallet risk in purchasing | Buyers do not care | Interviews; counsel on Q-2 |

## 3. Assumptions the evidence does not support (so far)

| Assumption in the brief or plan | What the evidence shows | Status | Label |
|---|---|---|---|
| **Commission errors are a major pain** | Four review pages praise configurable commission engines; no commission-error complaint was visible (03 §6). Reviews come from buyers who stayed; finance staff may not post | **Not supported by Wave 2 evidence.** Keep as a hypothesis for V-02 | [IP, weak]; not proven absent |
| **"All-in-one" breadth is a differentiator** | At the marketing-page level the top vendor already states commissions, genealogy, mobile, e-commerce, CRM, analytics and AI (04 §1: 11 of 18 rows for Exigo). Breadth is **table stakes at the top end**, not a gap | **Not a gap.** Supports the narrow-wedge default (OQ-07, challenge C1) | [IP] |
| **AI is a differentiator** | Three vendors mention AI with no stated capability, data or accuracy (04 §4). No problem evidence yet | **Unsupported either way** until R-18 and V-08 | [UV] |

## 4. Segment view (S1 to S5 from 01 §4)

| Segment | Incumbent coverage seen | Candidate gap | Markets | Under-served? |
|---|---|---|---|---|
| **S1** Established enterprise brands | Exigo, DirectScale, Jenkon, InfoTrax; consolidation under one owner (03 §8); price $5,000 per month and up (02 §5.2) | Migration and cost of change; evidence thin | All | **Not shown.** Strong incumbents, high switching cost |
| **S2** Mid-market established | ByDesign, MarketPowerPRO, Exigo "Basic" | H-3, H-4, H-5; local compliance and cost of change | **Malaysia, India** first | **Best candidate (hypothesis)** |
| **S3** New launches and start-ups | Many low-cost vendors; one-time licences from $699 (S-096); crowded | Low price is already served; H-2 might matter, but these buyers have the least ability to pay and a higher chance of non-compliant plans (OQ-03) | All | **Not shown**; crowded at low price |
| **S4** Hybrid / affiliate-style programs | Adjacent tools (LeadDyno, 03 §7) | Needs a separate legal screen; some designs are indistinguishable from MLM to regulators | — | **Out of scope until OQ-03 is answered** |
| **S5** In-house builders | Not searched (job postings, talks) | Migration and modernization | — | **Unknown** |

## 5. What would settle this (Wave 3 handoff)

1. **Interviews (V-01, V-02, V-07):** 10 to 15 structured interviews with owners, operators, finance and compliance staff in **Malaysia and India** first (OQ-06 asks the founder for introductions). The guide (R-37) will test H-1 to H-5 directly and will ask for the last three change requests, price paid and how the platform was bought.
2. **Local vendor search** in Malaysia and India, and **Act 500 and Rules text reads**, to complete H-3.
3. **Vendor documentation reads (V3)** for compliance, data-residency and wallet features, to turn "not stated" into "absent" or "present".
4. **Counsel review** of Q-1 (vendor exposure) and Q-2 (payout and wallet), because H-2 and H-7 are the gaps most exposed to legal risk.
5. **Founder input:** OQ-01 (segment and first market), OQ-04 (resources, which set the "large enough" threshold), OQ-08 (starting position).

## 6. What this draft does not say

- It does **not** say a gap exists, that the product should be built, or that any hypothesis is likely true.
- It does **not** rank hypotheses by value: no willingness-to-pay data exists.
- Wave 3 will replace this with a gap analysis built on problem records (R-04 to R-09) and interview evidence.
