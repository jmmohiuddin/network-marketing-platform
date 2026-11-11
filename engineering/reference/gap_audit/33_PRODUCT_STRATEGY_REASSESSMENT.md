# 33 — PRODUCT STRATEGY REASSESSMENT
## The original direction, challenged, with the alternatives and the evidence each needs

| Field | Value |
|---|---|
| Document ID | GAP-33 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Labels | Recommendations are [SR]; each names the evidence that would overturn it |

## 1. The original direction, as it stands in the repository

The brief asked for an **all-in-one network-marketing platform**. The research narrowed this to a **narrow wedge** (OQ-07), named the **compliance evidence and reversals** cluster as the strongest problem area, and the **mid-market in Malaysia and India** as the best candidate segment (66 §7), while refusing to pass its own gates.

## 2. Challenges

| # | Element of the direction | Challenge | Evidence | Verdict |
|---|---|---|---|---|
| SC-1 | All-in-one breadth | Breadth is table stakes at the top and the market is unbundling | 04 (Exigo states 11 of 18 rows); Fluid sells commerce and rep tools while keeping the comp plan elsewhere (G-S07); messaging and claims-compliance vendors specialise (G-S17, G-S18, G-S33) | **Drop all-in-one** as a positioning |
| SC-2 | Compliance evidence **and reversals** as the wedge | Reversals, adjustments, approvals, committed periods and plan sandboxes are documented incumbent features | G-S29..G-S31 | **Narrow to compliance analytics** computed from transaction data |
| SC-3 | Compliance analytics as a purchase driver | Demand depends on enforcement and on buyers' incentives; adverse selection may suppress it | DSSRC monitoring and referrals (G-S15); FTC NPRM status uncertain (G-S03); 35 of 46 DSSRC inquiries involved non-members | **Unproven**; test cheaply before building (MVP-A) |
| SC-4 | Malaysia and India first | Strong low-price competition, tax withholding, residency and provider uncertainty; founder access unknown | G-S06, G-S12, G-S13, G-S19, G-S10 | **Re-open**; the founder's access decides |
| SC-5 | The buyer is the company; distributors are users | Confirmed; but distributors' trust (statements) and protection (honest disclosures) are product requirements, not marketing | G-S16, G-S27 | Keep, with the honesty policy (CPL-14) |
| SC-6 | Commission errors as central pain | Still unsupported | No error-rate source anywhere | Keep rejecting it as a positioning |
| SC-7 | Payout design (instruct, do not hold) | Correct, but the provider set is narrow and tax steps remain | G-S04, G-S20, G-S12 | Keep, with provider and tax work in Phase A |
| SC-8 | Gate design | G3 required evidence desk research could not produce, and some obtainable desk evidence was not used before failing it | 02 §4 of this audit | Redefine gates (31 §1, GAP-101) |

## 3. Positioning options (from 18 §6) compared

| Option | Differentiation | Evidence for | Evidence against | Cost to test | Recommendation |
|---|---|---|---|---|---|
| P1 All-in-one for MY/IN mid-market | Weak | Growing channels | Price competition; breadth is table stakes | High | **Do not pursue as stated** |
| P2 Engine + compliance, API-first behind any commerce front end | Medium: engine depth, provenance, caps, migration, compliance analytics | Unbundling (G-S07, G-S33); implementation cost is the buyer's top complaint (03 §6) | Incumbents integrate Shopify too; long sales cycles | High (needs MVP-B) | **Build path, conditional on Phase B** |
| P3 Migration and parallel-run tooling + service | Medium | Switching fear (S-137); consolidation (S-090) | Episodic demand | Medium | **Fold into P2** as the sales lever |
| P4 Compliance-analytics overlay on existing back offices | Narrow but unclaimed (in sources read) | No vendor found computing disclosures or retail share from payout data (G-S32); SQL access is available (G-S30, G-S31) | Adverse selection; small ticket | **Low** | **Test first** (MVP-A) |
| P5 Non-MLM direct-selling / affiliate tools | Different market | Lawful where MLM is not | Crowded affiliate market | Separate study | Out of scope unless the founder's home market requires it |

## 4. Recommended strategy [SR]

**"Prove the narrow whitespace cheaply, then build the engine only if buyers want to replace theirs."**

1. **Phase A (no product):** decisions, providers, tax, counsel, plan corpus, competitor documentation (31).
2. **Phase B (demand):** interviews re-weighted to compliance officers, finance and commission analysts; MVP-A prototype on a design partner's export; ask about willingness to pay, current spend, replacement intent and attestations.
3. **Phase C/D (only if Phase B passes):** MVP-B, engine-plus-compliance, integrating commerce; migration toolkit as the switching lever; pricing per active payee plus fixed-scope implementation.

**What would overturn it:** (a) interviews show compliance analytics has no buyer **and** engine replacement has no buyer → stop or pivot (P5 or exit); (b) providers refuse MLM tenants in the launch market → change market or stop; (c) counsel finds vendor exposure unacceptable for guardrail-light configurations → strengthen guardrails or stop.

## 5. Is this more defensible than the original?

| Test | Original | Revised |
|---|---|---|
| Positioning rests on something incumbents do not already document | No (reversals, simulation are documented) | Partly (compliance analytics; still needs buyer evidence) |
| First step cost proportional to evidence | Interviews only (blocked on access) | Desk + advisers + cheap prototype, then interviews |
| Launch blockers named | Payout licensing only | Providers, tax, privacy duties, residency, guardrails |
| Engine scoped from real plans | One 2015–2019 plan | Corpus of current plans (4 read; 20–30 planned) |
| Ethical position explicit | Acceptance policy assumed | Acceptance policy + honesty policy + guardrails |

## 6. GAP-101 — Gate G3 could not pass by design, and obtainable evidence was unused

| Field | Content |
|---|---|
| **Category** | Process, strategy |
| **Previous research coverage** | Roadmap §5 G3; 07 §3.1; 66 §7 |
| **Missing element** | Gate criteria matched to what each wave can produce; exhaustion of desk sources before failing a gate |
| **Evidence** | G3 needs frequency and severity, which desk sources rarely give; yet DSSRC frequency (G-S15) and current public plans (G-S25..G-S28) were obtainable |
| **Why it matters** | A gate that cannot pass invites either endless research or ignoring the gate |
| **Affected stakeholders** | Founder |
| **Product implications** | None directly |
| **Technical implications** | None |
| **Recommended solution** | Adopt G3′ and G4′ (31 §1); finish the desk parts (corpus, providers, tax, documentation) before interviews start |
| **Priority** | High |
| **Implementation stage** | Before MVP |
| **Confidence** | High |
| **Documentation changes required** | Roadmap §5; 66 §7 |
