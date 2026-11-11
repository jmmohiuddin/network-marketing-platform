# 21 — ADDITIONAL UNDISCOVERED OPPORTUNITIES
## The brief's §6 questions, answered from the evidence available, and four new gap records

| Field | Value |
|---|---|
| Document ID | GAP-21 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Gaps | GAP-095 to GAP-098 |
| Labels | Answers are [SR] (judgement from evidence) or [HY] where no evidence exists; sources named |

## 1. Brief §6 questions

| Question | Answer | Basis |
|---|---|---|
| What would a CEO expect that no competitor delivers well? | **Predictable change** (cost and time of plan changes) and **defensible numbers** for regulators and counsel. The first is partly served (sandboxes, G-S31); the second (compliance analytics from transaction data) was not found in any vendor material read | 03 §6; 19 §2 [SR] |
| What problems do distributors not report to management? | Losses and expenses (AARP: 47% lost money), feeling misled (41%), awkwardness of selling to friends (39%) | G-S16 [RB, US] |
| What is invisible in ordinary customer interviews? | Payment-provider refusals and tax withholding mechanics (back-office facts operators take for granted); adverse selection on compliance tooling | G-S04, G-S12; 05 CL-06 [SR] |
| What still runs on spreadsheets, WhatsApp, email and manual calculation? | Commission exceptions, adjustments and audits (postings S-130..S-132); cheques printed and mailed (S-132); plan documents as PDFs (G-S25..G-S28) | [RB] |
| 500 → 500,000 distributors: what breaks? | Recursive tree queries, manual adjustments, single-person finance (no preparer/approver split), reporting on the primary database, support without masked data | 08, 15, 16 [SR] |
| What breaks entering a new country? | Licence evidence, payout tax, provider eligibility, language, data residency, plan variants (caps, pools scoped by market, G-S25, G-S26) | 10, 20 [SR] |
| What happens when the plan changes? | Rank, carry and streak state must transition; distributors must be told; old periods stay replayable | 09 §3; GAP-097 |
| What happens when a company is acquired? | Genealogies, IDs and plans must merge or run side by side; distributors may hold positions in both | GAP-095 [HY] |
| What happens when an organisation restructures? | Mass moves of subtrees through approved, dated events; read-model rebuild | 08 S4, B8 |
| What makes migration painful, and what would make switching easier? | History (genealogy, ranks, carry balances) and proof that the new system pays the same: **parallel-run reconciliation** and **guaranteed export** | P-18; GAP-077, GAP-096 |
| What would make a distributor prefer our platform? | A statement they can understand and trust; fast, predictable payouts in their local rail and language | GAP-027, GAP-051 [HY] |
| What would make an enterprise trust us with commission and financial data? | Attestations (GAP-066), tenant-visible vendor-staff access logs (GAP-065), reproducible runs, contractual exit rights (GAP-096) | [SR] |

## 2. Gap records

### GAP-095 — Company mergers, multi-brand tenants and genealogy merges

| Field | Content |
|---|---|
| **Category** | Technical |
| **Previous research coverage** | None |
| **Missing element** | Multi-brand tenants; merging two companies' fields |
| **Evidence** | Consolidation among vendors (Exigo–DirectScale, S-090) shows platform M&A; brand-level M&A not researched [HY] |
| **Why it matters** | Retro-fitting multi-brand support into single-brand data models is costly |
| **Affected stakeholders** | Enterprise tenants |
| **Product implications** | Tenant → brands → markets hierarchy; person matching across brands |
| **Technical implications** | Brand dimension on plans, positions and orders from day one (cheap now, expensive later) |
| **Recommended solution** | Add the brand dimension to the data model; build merge tooling only for enterprise |
| **Priority** | Medium |
| **Implementation stage** | Enterprise (data model in MVP) |
| **Confidence** | Low |
| **Documentation changes required** | Future database document |

### GAP-096 — Exit and data-portability guarantee as a trust asset

| Field | Content |
|---|---|
| **Category** | Commercial |
| **Previous research coverage** | None |
| **Missing element** | A contractual and technical promise that a tenant can leave with complete, usable history |
| **Evidence** | Migration fear is "the primary roadblock" (S-137, vendor); data-portability rights now exist in Malaysia's PDPA (G-S14) |
| **Why it matters** | Lowers the buyer's perceived risk of switching **to** a new vendor |
| **Affected stakeholders** | Tenants |
| **Product implications** | Documented export of genealogy history, runs, traces, ledger in open formats |
| **Technical implications** | Same export as GAP-062 |
| **Recommended solution** | Publish the data model and export format; put exit assistance in the contract |
| **Priority** | Medium |
| **Implementation stage** | V1 |
| **Confidence** | Medium |
| **Documentation changes required** | Future pricing and contract documents |

### GAP-097 — Plan-change governance with the field

| Field | Content |
|---|---|
| **Category** | Operational, compliance |
| **Previous research coverage** | CMP-04 (versioned plans, approval, justification); Malaysia amendment filing (S-043) |
| **Missing element** | Transition rules (grandfathered ranks, carry balances, streaks), notice periods, distributor communication, and per-market filing status |
| **Evidence** | Real plans carry long-horizon state (25-month streaks, 12-month carry; G-S28) that a change would cut; Nu Skin lists plan changes as a risk (S-122) |
| **Why it matters** | A change that silently wipes accrued state is a dispute and possibly a legal issue |
| **Affected stakeholders** | Distributors, leaders, Compliance, Country Managers |
| **Product implications** | Plan-change workflow: draft → simulate → compliance review → market filing status → notice → effective date → transition report |
| **Technical implications** | Transition functions between plan versions, tested like rules |
| **Recommended solution** | Include in MVP for the first plan change after go-live |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | Medium |
| **Documentation changes required** | 13 §7, 15 BR-CPL-02 |

### GAP-098 — Company wind-down or insolvency

| Field | Content |
|---|---|
| **Category** | Operational |
| **Previous research coverage** | None |
| **Missing element** | Final commission runs, outstanding clawbacks, buy-back obligations and data retention when a tenant closes |
| **Evidence** | 34 Malaysian licences revoked by 2020 (S-015); no case read about a platform's role |
| **Why it matters** | Distributors owed money and regulators asking for records may come to the platform |
| **Affected stakeholders** | Distributors, regulators, platform |
| **Product implications** | Tenant offboarding runbook: final run, export, retention per law |
| **Technical implications** | Read-only archive mode |
| **Recommended solution** | Contract terms + archive mode |
| **Priority** | Low |
| **Implementation stage** | V1 |
| **Confidence** | Low |
| **Documentation changes required** | Future contract and operations documents |
