# 05 — CRITICAL ASSUMPTIONS AND UNVERIFIED CLAIMS
## The claims that carry the most weight, checked again against new sources

| Field | Value |
|---|---|
| Document ID | GAP-05 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Format | Brief §7: claim · previous conclusion · independent verification · supporting evidence · contradictory evidence · confidence · implication |
| Confidence | **High** strong · **Medium** reasonable with limits · **Low** weak · **Unknown** |

Claims are ordered by how much a wrong answer would cost.

## CL-01 — "The platform can avoid financial licensing by calculating and instructing payouts through licensed providers" (A-02)

| Element | Content |
|---|---|
| Previous conclusion | Supported at screening grade; counsel unconfirmed (51 §5) |
| Independent verification | Checked whether the **providers themselves** will serve MLM operators |
| Supporting | Top-end vendors integrate third-party payout and payment providers (S-091, S-114, S-117) |
| Contradictory | Stripe **prohibits** "multilevel marketing services offering commission or recruitment-based sales" (G-S04); PayPal prohibits "certain multi-level marketing programs" and requires approval for MLM (G-S20); Zoho Payments India prohibits MLM collection fees (G-S21) |
| Confidence | **Medium** for the legal stance; **High** that mainstream providers are restricted |
| Implication | The design stance survives, but the **provider set is narrow**: specialist or high-risk processors (for example Nexio and PayQuicker appear in Exigo's partner list) and per-market eligibility checks. Provider eligibility in Malaysia and India is unknown and is now a launch blocker (GAP-004) |

## CL-02 — "The compliance evidence and reversals cluster is the strongest opportunity" (66 §7)

| Element | Content |
|---|---|
| Previous conclusion | Strongest cluster [HY]; under-service based on silence on 8 marketing pages |
| Independent verification | Read vendor help centres and product pages |
| Supporting | No vendor page or help article found claims **compliance analytics from transaction data**: retail-customer share, qualification-by-purchase flags, payout-source attribution, earnings disclosures computed from payouts. Epixel's "income disclosure generator" is a manual form (G-S32) |
| Contradictory | DirectScale documents **clawbacks, payable adjustments, overrides, approvals, committed periods and projected commissions** (G-S29, G-S30); Exigo advertises a **sandbox** to test plans (G-S31). Reversals (H-8) and plan-change control (H-4) are table stakes. Field-claim compliance already has specialist vendors (G-S17, G-S18) |
| Confidence | **Medium** that a narrow analytics gap exists; **High** that reversals and simulation are not gaps |
| Implication | Narrow the hypothesis to **compliance analytics derived from transaction data**, and test willingness to pay; drop reversal handling and plan sandbox from the differentiator list (GAP-081) |

## CL-03 — "Malaysia and India should be the priority markets" (02 §7, D1)

| Element | Content |
|---|---|
| Previous conclusion | Priority; only target markets with material growth and a lawful framework |
| Independent verification | Looked for local competition, tax duties, and data-protection timing |
| Supporting | Growth and licensing facts stand (S-001, S-043, S-085) |
| Contradictory | Infinite MLM is headquartered in **Calicut, India**, claims 3,000+ MLM customers and opened in Malaysia in 2023 (G-S06); Malaysian vendors exist (G-S19); several profiled low-end vendors use Indian legal forms (03 §8). Payout withholding applies in both (G-S12, G-S13). India's DPDP duties start 13 May 2027 (G-S10) |
| Confidence | **Low** that these are the best first markets for this founder; the choice ignored competition and the founder's access (OQ-08) |
| Implication | Re-open D1 with three explicit criteria the screen skipped: founder access, local price competition, payout and provider feasibility (GAP-076) |

## CL-04 — "The compensation taxonomy covers observed plans" (13 §2.2, G3 criterion 2)

| Element | Content |
|---|---|
| Previous conclusion | 14 of 14 mechanisms map to the building blocks, admitted circular; real test deferred to interviews |
| Independent verification | Read four current public plans (G-S25..G-S28) |
| Supporting | Core blocks (volume measures, hierarchy, percentage by level, caps, carry-forward) appear in every plan |
| Contradictory | Each plan contains mechanisms the blocks do not name: multiple business centres per person, change windows, fractional roll-up, non-cash credits with expiry, points factor, active-customer counts, dual title tracks, first-qualified-upline bonuses, market-scoped pools, top-N pools, priority caps, 25-month streaks, one-time bonuses, renewal fees |
| Confidence | **High** that the taxonomy is incomplete |
| Implication | The engine's primitive set must be rebuilt from a larger plan corpus **before** architecture (GAP-020). This is desk work and does not wait for interviews |

## CL-05 — "Commission errors are not the central pain" (05 §3)

| Element | Content |
|---|---|
| Previous conclusion | Not supported; reviews praise engines |
| Independent verification | Looked for any measured error rate |
| Supporting | Still none found. Reviews and vendor docs show change cost and implementation as recurring themes |
| Contradictory | None found; absence of evidence remains weak |
| Confidence | **Medium** (agree with the original) |
| Implication | Keep. Do not position on "accurate commissions" |

## CL-06 — "Software for compliance evidence would be bought" (implicit in H-2)

| Element | Content |
|---|---|
| Previous conclusion | Willingness to pay unknown |
| Independent verification | Looked at demand drivers: enforcement intensity and the buyer's incentive |
| Supporting | DSSRC monitored ~526,000 URLs in 2025 and opened 46 inquiries, 5 referred to regulators (G-S15). The FTC issued an earnings-claim NPRM in Jan 2025 (G-S03) |
| Contradictory | **Adverse selection:** operators with risky plans have reasons to avoid tools that make risk visible; compliant operators may see small marginal value. 35 of 46 DSSRC inquiries concerned non-DSA members, the population least likely to buy compliance tooling. FTC rule status after 2025 is uncertain (mondaq summary in the G-S03 search) |
| Confidence | **Low** |
| Implication | Compliance analytics may be a **feature that lowers risk for the vendor and its good customers**, not a stand-alone purchase driver. Test both readings in interviews (G-EXEC, G-CMP) before positioning on it (GAP-075, GAP-087) |

## CL-07 — "Breadth (all-in-one) is not a differentiator" (05 §3)

| Element | Content |
|---|---|
| Previous conclusion | Supported |
| Independent verification | New entrant behaviour |
| Supporting | Exigo states most modules (S-091). The best-funded new entrant, Fluid, **unbundles**: commerce and rep tools, with back-office sync that "keeps the comp plan where it is" (G-S07) |
| Contradictory | Fluid also markets "one system" against "fragile multi-vendor stacks" (G-S07) |
| Confidence | **High** |
| Implication | Keep the narrow-wedge default; consider an **engine-plus-compliance layer that integrates with commerce front ends** rather than another all-in-one (33) |

## CL-08 — "The software market is a niche worth tens of millions a year" (02 §5.2)

| Element | Content |
|---|---|
| Previous conclusion | Order-of-magnitude bound for three markets at displayed entry prices |
| Independent verification | Re-ran arithmetic; examined scope |
| Supporting | Arithmetic correct |
| Contradictory | The 1,521-company count covers only the US, Malaysia and India, so it excludes 8 of the top 10 markets by sales (Germany, China, Korea, Japan, Brazil, Mexico, France, Taiwan; S-001); excludes payment and payout revenue, which some platforms monetise (Fluid has its own payments product, G-S07); excludes services revenue; directory entry prices are not contract values |
| Confidence | **Medium** that it is a niche; **Low** on the size |
| Implication | Treat the figure as "three markets, licence fees only". The founder threshold (OQ-04) is still the binding question (GAP-075) |

## CL-09 — "Holding no funds removes the platform from financial regulation" (C4)

| Element | Content |
|---|---|
| Previous conclusion | Partly resolved |
| Independent verification | Tax and data duties that apply even without holding funds |
| Supporting | 51 §5 reasoning stands for money transmission |
| Contradictory | Payout **withholding** in Malaysia (2%, s.107D) and India (TDS) is computed at payout (G-S12, G-S13): the platform calculates the tax line even if it never holds the money. Malaysia's amended PDPA binds **processors** directly (G-S14) |
| Confidence | **High** that other regulated duties remain |
| Implication | "No funds held" is necessary but not sufficient; tax and privacy duties enter the MVP (GAP-031, GAP-085) |

## CL-10 — "The Herbalife order gives a usable model of a company-level cap" (13 EX-9, CMP-19)

| Element | Content |
|---|---|
| Previous conclusion | Cap 41.75% of rewardable sales when rewardable sales < 80%; applied after all calculations by proportional scaling |
| Independent verification | Read the order (G-S02) |
| Supporting | Numbers correct |
| Contradictory | Cap excludes wholesale commissions; rewardable sales have a one-third personal-consumption adjustment; a per-participant one-third rule exists. Modere's India cap reduces **one named bonus only** (G-S26) |
| Confidence | **High** |
| Implication | Caps need scope, priority and allocation rules (GAP-022) |

## CL-11 — "Distributor attrition is a business-model outcome the software may not address" (07 §3.3)

| Element | Content |
|---|---|
| Previous conclusion | Hypothesis only; software role unknown |
| Independent verification | Survey and disclosure evidence |
| Supporting | AARP 2018: 47% lost money, 27% made none; 39% stopped because pitching friends and family felt awkward; 41% felt misled (G-S16). Scentsy 2024 median annual commissions $466.56 for full-year consultants and $77.68 for part-year (G-S27) |
| Contradictory | Evidence is US-only and self-reported (AARP) or one company (Scentsy) |
| Confidence | **Medium** |
| Implication | Agree, and go further: the product must not promise income, should measure retail customers rather than recruits, and earnings statements must be honest by design (GAP-003, GAP-050) |

## CL-12 — "1099 forms are the tax documentation problem" (P-15)

| Element | Content |
|---|---|
| Previous conclusion | US 1099-NEC ($600) and 1099-MISC ($5,000 resale), thresholds "may have changed" |
| Independent verification | Current US threshold and priority-market rules |
| Supporting | US forms remain relevant |
| Contradictory | US threshold $2,000 from 2026 (G-S05); Malaysia 2% WHT + CP58 (G-S12); India TDS 2% (G-S13) |
| Confidence | **Medium-High** (Grade B sources; confirm with authorities) |
| Implication | Tax is a payout-calculation step, per market and per year (GAP-031) |

## CL-13 — "Payout timing and wallets differentiate" (H-6, H-7)

| Element | Content |
|---|---|
| Previous conclusion | Very weak |
| Independent verification | Provider landscape |
| Supporting | API payout rails exist in India (G-S23) |
| Contradictory | Wallet-first payout providers already market to direct sellers (G-S22); provider eligibility for MLM is restricted (G-S04, G-S20, G-S21) |
| Confidence | **Low** as a differentiator |
| Implication | Treat payouts as integration work, not a wedge |

## CL-14 — "No competitor serves the compliance needs of licensed markets" (H-3)

| Element | Content |
|---|---|
| Previous conclusion | Silence on 8 pages; local vendors not searched |
| Independent verification | Found local and Indian vendors serving Malaysia (G-S06, G-S19) |
| Supporting | No vendor read claims Act 500 or India Rules features |
| Contradictory | Local developer shops can build per-client features cheaply; absence of claims is still weak |
| Confidence | **Low** |
| Implication | Validate in interviews with licensed operators before any positioning on "local compliance packs" |

## CL-15 — "G3 needs interviews to pass" (66 §7)

| Element | Content |
|---|---|
| Previous conclusion | Yes |
| Independent verification | Which G3 inputs desk research can supply |
| Supporting | Frequency and willingness to pay do need buyers |
| Contradictory | Criterion 2 (taxonomy coverage) is testable from public plans now (CL-04); one compliance problem has frequency evidence now (G-S15) |
| Confidence | **High** |
| Implication | Re-run G3 with desk evidence plus interviews; do not wait for interviews to do the desk part (GAP-101) |

## Summary of changed conclusions

| Claim | Original stance | After verification |
|---|---|---|
| CL-01 payout stance | Feasible | Feasible, **provider set narrow; launch blocker until eligibility confirmed** |
| CL-02 strongest cluster | Compliance evidence and reversals | **Compliance analytics only**; reversals and sandbox are table stakes |
| CL-03 priority markets | Malaysia, India | **Re-open**; competition and access ignored |
| CL-04 taxonomy | Circular coverage | **Incomplete** |
| CL-06 willingness to pay | Unknown | Unknown, with an adverse-selection risk |
| CL-09 no funds held | Mostly outside regulation | Tax and privacy duties remain |
| CL-10 caps | One proportional cap | Scoped and prioritised caps |
| CL-12 tax | US 1099 | Per-market withholding |

## Gap record

### GAP-102 — Source depth: most evidence read as excerpts; primary legal texts still unread

| Field | Content |
|---|---|
| **Category** | Compliance, evidence |
| **Previous research coverage** | Register observations: 57 of 129 entries read in full; Act 500 and India Rules unread; "Recapture and gaps (to resolve in Wave 2)" still open |
| **Missing element** | Full reads of the sources that legal and product conclusions depend on |
| **Evidence** | Register profile: Grade A 27 (11 read in full), B 44 (19), C 57 (27); 41 entries undated (01 of this audit) |
| **Why it matters** | Screening-grade law is acceptable for a market screen, not for product rules that block or allow money flows |
| **Affected stakeholders** | Founder, counsel |
| **Product implications** | No rule in 24 marked "mandatory" may ship until its primary source is read and counsel agrees |
| **Technical implications** | Rules carry a `basis_status` (screening / primary-read / counsel-confirmed) in configuration metadata |
| **Recommended solution** | For the chosen launch market only: obtain Act 500 or the India Rules through counsel; read the Herbalife order in full; retitle and work the recapture list |
| **Priority** | Medium |
| **Implementation stage** | Before MVP |
| **Confidence** | High |
| **Documentation changes required** | Register (recapture list), 51, 15 |
