# 74 — INDIA PLAN CORPUS
## Public Indian compensation plans coded against the engine's building blocks

| Field | Value |
|---|---|
| Document ID | P2-74 |
| Version | 0.1 |
| Date | 2026-11-12 |
| Extends | Phase A `P1_PLAN_CORPUS.md` (21 plans; India only through the definition set) |
| Files | `india_plan_corpus/plans_india.csv`, `analyze_india.py`, `analysis_output.txt` |
| Grade | **Weak sources.** No Indian company-hosted plan document was obtained in this phase. Two plans come from third-party reviews (one ~2020, one a software vendor's blog of Dec 2022); Amway's structure comes from its page for another market. Codes are machine-assisted readings and need a human spot-check |

## 0. Result in four lines

1. **Five Indian plans** are now coded: USANA India and Modere India (Phase A definition set) and three new: Amway, Vestige, Modicare.
2. **Coverage of the three new plans with the extended primitive list: 1 of 3.** Amway needs an eligibility gate on business/tax registration (N-GATE, already seen in Amway UK); Vestige needs **earmarked cash funds** (new candidate class, N-EARMARK).
3. **Indian plans lean on stairstep differentials and company-wide pools:** differential/breakaway (D3) in 4 of 5, **pools by shares (D6) in 3 of 5** (globally 2–3 of 16), per-person monthly caps on pool payouts in 2 of 3 new plans.
4. **Purchase-based qualification is explicit** in Vestige (20 or 40 PV personal purchase each month to earn) — the pattern compliance report R4 is built to measure, and an open counsel question (AQ-IN-01).

## 1. Plans

| ID | Company | Source and date | Family | Key mechanics (as reported) | Tier |
|---|---|---|---|---|---|
| IN01 | Amway | Amway Romania "Understanding the plan" (undated); India document **not obtained** | Stairstep breakaway | Performance bonus 3% at 200 PV → 21% at 10,000 PV (monthly bracket) paid on BV; differential bonus to each downline; PV:BV ratio; **bonus only with local business/tax registration**; milestone incentives | **N** (N-GATE) |
| IN02 | Vestige | BehindMLM review (~2020) | Stairstep + unilevel + pools | Ranks by **accumulated** PV; performance bonus 5–20%; monthly personal purchase 20 PV (40 PV for Directors) to earn; fast-start on GV 282; Director bonus pool (14% of company volume) over up to 9 unilevel levels excluding Bronze+ legs; travel (3%), car (5%, cap ₹80,000/month, must go to an approved car), house (3%, cap ₹1,00,000/month, 4 months at rank) funds | **N** (N-EARMARK) |
| IN03 | Modicare | Infinite MLM blog (updated 9 Dec 2022) | Stairstep + pools | Retail up to 20%; accumulated performance bonus 7–22% by rank; Director bonus pool 14%; travel 3%; vehicle 5% (cap ₹1,00,000/month from the 4th consecutive month at rank); home 3% (cap ₹1,20,000/month from the 6th month). **Rank thresholds not published** | M (low detail) |

## 2. New candidate mechanism

| Class | Plans | Description | Engine consequence |
|---|---|---|---|
| **N-EARMARK** — earmarked cash award | Vestige (car fund to approved car; travel fund only for company trips); Modicare possibly (purpose stated by the reviewer, not the company) | A cash pool share that is payable only against a qualifying use, with a monthly cap | A reward account with a **release condition** (evidence of use) — between non-cash rewards (D11) and holds. Keep as a **D11 variant** with a hold-until-evidence state; do not build until a design partner needs it |

## 3. What this changes

| Item | Change |
|---|---|
| MVP primitive priorities for an India pack | **Pools by shares (D6)** moves from Should to **Must for India**; per-person caps on pool payouts (E1) confirmed |
| Guardrails | Personal purchase requirements to earn (Vestige) are reported by R4; whether they are **blocked or warned** in India waits for AQ-IN-01 |
| G3′(b) | Combined hold-out coverage: **6 of 19 (32%)** with the extended list (5 of 16 + 1 of 3) |
| OQ-07 | Still open: no Indian company-hosted plan document; human spot-check still needed |

## 4. Limits

- Third-party descriptions can be outdated or wrong. Vestige's review predates the 2021 Rules; the plan may have changed to comply.
- The Amway coding uses a European market page. India-specific rules (for example, the treatment of GST in BV) are unknown.
- **Nothing here says any plan is lawful or fair.**

## 5. Sources

P2-S70 Amway Romania; P2-S71 BehindMLM Vestige; P2-S72 Infinite MLM Modicare review. URLs in 79.
