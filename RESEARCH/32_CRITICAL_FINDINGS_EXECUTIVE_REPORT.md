# 32 — CRITICAL FINDINGS: EXECUTIVE REPORT
## What the board needs to know before money is spent on development

| Field | Value |
|---|---|
| Document ID | GAP-32 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Audience | Founder, board, investors |
| Basis | Full read of the original repository (01); 35 new sources (00_GAP_SOURCE_REGISTER); 57 gaps (04) |

## 1. Bottom line

**Do not start building.** The original research is honest and careful, but it ended at desk-research limits it had not exhausted, and it contains **no product, technical or financial documents**. This audit found **13 Critical gaps**. Four of them change the strategy, not just the specification:

1. **Payments.** Stripe prohibits "multilevel marketing services offering commission or recruitment-based sales"; PayPal requires approval for MLM; an Indian provider prohibits MLM collection fees (G-S04, G-S20, G-S21). A tenant can only go live if a specialist processor accepts it in its market. **This is a launch blocker until confirmed in writing for the chosen market** (GAP-004).
2. **The "strongest opportunity" is mostly table stakes.** Vendor help centres document clawbacks, adjustments, approvals, committed periods and projected commissions (DirectScale); Exigo advertises a plan sandbox and full SQL access (G-S29..G-S31). What remains unclaimed is narrow: **compliance analytics computed from transaction data** — retail-customer share, personal-consumption share, payout-source mix, and earnings disclosures built from real payouts (GAP-081).
3. **The first markets are hard ones.** Malaysia and India were picked on channel growth and legal frameworks, without looking at competition or the founder's access. The largest low-price vendor is **headquartered in Calicut, India** and opened in Malaysia in 2023; local Malaysian developers sell MLM systems; both countries **withhold tax from distributor payouts** (Malaysia 2% and CP58; India TDS) (G-S06, G-S12, G-S13, G-S19) (GAP-075, GAP-076, GAP-031).
4. **The compensation model is incomplete.** Four current public plans contain at least 15 kinds of rule the original building blocks do not name: several positions per person, change windows, fractional roll-ups, store credit with expiry, a changeable points-to-currency factor, caps that cut one bonus only, 25-month streaks, and more (G-S25..G-S28) (GAP-020). Designing an engine on the original blocks would rebuild the "paid customisation" problem buyers already complain about.

## 2. The 13 Critical gaps

| Gap | One line | What to do |
|---|---|---|
| GAP-100 | No PRD, architecture, database, API, UX, test or financial documents | Write the minimum set in 22 §3 after founder decisions |
| GAP-076 | Market and segment choice ignored competition and founder access | Re-score markets with the founder's access column (18 §3) |
| GAP-075 | Platform's own business model and cost to serve absent | Unit-economics inputs (18 §4); pricing per active payee, not % of volume |
| GAP-081 | Several "gaps" are documented incumbent features | Narrow the whitespace to compliance analytics; test it first (MVP-A, 31) |
| GAP-087 | Which compliance rules the platform enforces, and vendor liability, undecided | Founder + counsel decision; default proposal BR-GRD (24) |
| GAP-004 | MLM merchants restricted by mainstream payment providers | Confirm ≥ 2 eligible providers in the launch market, in writing |
| GAP-031 | Payout tax withholding and reporting per market | Tax adviser for the launch market before scope freeze |
| GAP-020 | Compensation primitives incomplete | Build a 20–30 plan corpus and code it (desk work, now) |
| GAP-010 | No effective-dated genealogy; positions not separated from people | Bitemporal relationship model (08 §4) |
| GAP-023 | No period lifecycle or retroactivity model | Open → committed → paid with adjustments and approved restatements (09) |
| GAP-030 | No ledger design | Double-entry obligations sub-ledger (10 §3) |
| GAP-060 | No architecture or workload model | Modular monolith, calc workers, tenant routing (15, 28) |
| GAP-065 | Vendor-staff access, insider and payout fraud, tenant isolation | Controls as MVP acceptance criteria (16, 26, 29) |

## 3. What changed in the evidence

| Topic | Before this audit | After |
|---|---|---|
| Frequency of any compliance problem | None found | DSSRC flagged 2,966 income posts and 792 health posts from ~526,000 URLs monitored in 2025; 94% on social media (G-S15) |
| Distributor outcomes | One company's income statement | AARP 2018: 47% lost money, 27% made none; 41% felt misled (G-S16); Scentsy 2024 median $466.56 full-year (G-S27) |
| Regulatory direction (US) | A risk heading in a 10-K | FTC NPRM on MLM earnings claims, 13 Jan 2025: substantiation and records; status uncertain (G-S03) |
| Platform's own privacy duties | Not considered | Malaysia: processors directly bound; DPO for processors (from Jun 2025) (G-S14). India: DPDP duties from 13 May 2027 (G-S10) |
| US 1099 threshold | "May have changed" | $2,000 for 2026 payments (G-S05) |
| New competitors | Not found | Fluid ($15M, Mar 2026; commerce + rep tools that keep the comp plan elsewhere), Pillars, TeqTank, field-compliance vendors (G-S07, G-S17, G-S18, G-S33) |

## 4. What the original research got right (keep)

- Breadth is not a differentiator; narrow wedge (confirmed again: the best-funded entrant unbundles, G-S07).
- Commission errors are not shown to be the central pain (still no error-rate evidence anywhere).
- Do not hold funds; calculate and instruct (confirmed, with the provider caveat).
- Engine principles: versioned, deterministic, replayable, multi-pass (sound).
- Honest labelling and refusal to invent market sizes.

## 5. Recommended decision [SR]

1. **Phase A now (desk + advisers):** provider eligibility, tax, counsel questions, plan corpus, competitor documentation (31 §1).
2. **Phase B:** interviews re-weighted to compliance and finance staff, plus a **compliance-analytics prototype on a design partner's export** (MVP-A).
3. **Only if Phase B passes G3′/G4′:** build the engine-plus-compliance product (MVP-B), integrating commerce rather than building a storefront.
4. **Stop triggers (added to 66 §7):** no eligible payment and payout providers in the launch market; buyers will not pay for compliance analytics **and** will not replace their engine; counsel finds unacceptable vendor exposure (Q-1).

## 6. GAP-103 — This audit is not independent

| Field | Content |
|---|---|
| **Category** | Process |
| **Previous research coverage** | Not applicable |
| **Missing element** | An independent reviewer |
| **Evidence** | The original research and this audit were produced by the same AI system in the same working session (01 caveat) |
| **Why it matters** | Shared blind spots survive self-review; a board-level audit needs independence |
| **Affected stakeholders** | Founder, investors |
| **Product implications** | None directly |
| **Technical implications** | None |
| **Recommended solution** | Ask an independent reviewer (a direct-selling compliance lawyer, an engineer who has built a commission engine, or both) to check §2 and §3 of this report — especially GAP-004, GAP-020, GAP-031 and GAP-081 — before any spend |
| **Priority** | High |
| **Implementation stage** | Before MVP |
| **Confidence** | High |
| **Documentation changes required** | 35 FD-07 |
