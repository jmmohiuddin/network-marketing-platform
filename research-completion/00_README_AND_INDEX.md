# RESEARCH COMPLETION — PHASE 2 (BANGLADESH AND INDIA)
## What was completed, what could not be, and where each finding went

| Field | Value |
|---|---|
| Date | 2026-11-12 |
| Request | "Complete the missing research" — scope: the 3 missing documents, unfinished Phase A desk work, never-produced research, and the market/tax/legal screen; markets: Bangladesh and India |
| Location | Beside `RESEARCH` (unchanged) and `product-documentation` (updated) |
| Grade | **Desk research, screening grade.** No interviews, no written provider answers, no counsel or tax opinion. These cannot be produced by desk work and remain open |

## 1. Documents

| File | Content | Status |
|---|---|---|
| `07_PROBLEM_SEVERITY_MATRIX_RECONSTRUCTED.md` | Ratings of P-01..P-18, two-class test, gate G3 | Reconstruction (complete from 06) |
| `10_USER_JOURNEY_MAPS_RECONSTRUCTED.md` | J-01..J-17: subject, module, evidence status, coverage | Reconstruction (11 of 17 subjects; steps lost) |
| `15_BUSINESS_RULES_CATALOG_RECONSTRUCTED.md` | Original rule IDs, recovered text, D-R1..D-R6 | Reconstruction (~35 of 57 IDs; ~22 lost) |
| `70_BANGLADESH_MARKET_LEGAL_TAX_SCREEN.md` | MLM law, enforcement, withholding, data law | Screening grade |
| `71_INDIA_MARKET_LEGAL_TAX_SCREEN.md` | Direct Selling Rules duties, s.393 withholding, DPDP, market size | Screening grade |
| `72_PAYMENT_AND_PAYOUT_PROVIDER_SCREEN_BD_IN.md` | Provider terms in India and Bangladesh; letters to send | Published terms only |
| `73_COMPETITOR_DOCUMENTATION_READS.md` | Fluid, Pillars, TeqTank; Indian and Bangladeshi vendors; prices | Vendor claims unverified |
| `74_INDIA_PLAN_CORPUS.md` + `india_plan_corpus/` | Amway, Vestige, Modicare coded; coverage 1 of 3 | Weak sources |
| `75_MARKET_RESCORE_BANGLADESH_INDIA.md` + `models/market_rescore.py` | Weighted score with sensitivity | Judgement on screening evidence |
| `76_FEASIBILITY_AND_UNIT_ECONOMICS.md` + `models/unit_economics.py` | Break-even model, every input labelled | **Illustrative only** |
| `77_PRICING_AND_GO_TO_MARKET_BD_IN.md` | Price structure to test; India go-to-market | Proposal |
| `78_TECHNOLOGY_AND_REGION_BD_IN.md` | Cloud regions; pack technical items | Screening grade |
| `79_SOURCE_REGISTER_PHASE2.md` | Every source, date, grade and URL | 9 URLs to re-locate |

Run the models with `python3 -I models/market_rescore.py` and `python3 -I models/unit_economics.py`; outputs are saved beside them.

## 2. Headline findings

1. **Bangladesh: do not target MLM operators.** No licence issued since 2015; e-commerce MLM sites closed in 2022; Bangladesh Bank warning in March 2025. A single-level affiliate offer is possible only if Bangladeshi counsel says it falls outside the 2013 Act.
2. **India is the stronger market (score 3.20 vs 1.45 / 2.35)** and its Direct Selling Rules create duties that match the compliance-analytics product: registration, officers, grievance timers, public seller registers, in-country data.
3. **The Indian price anchor is very low** ($699–$5,399 one-time licences with e-wallets). A subscription is viable only for larger companies that value compliance evidence — unmeasured.
4. **Indian plans** lean on stairstep differentials and company-wide pools with monthly caps; one plan requires monthly personal purchases to earn (a counsel question).
5. **The missing research documents could be partly rebuilt;** about 22 original business rules cannot be recovered without the original file.

## 3. What was changed in `product-documentation`

| Document | Change |
|---|---|
| New PD-04 `01-product-definition/04_MARKET_PACKS_INDIA_BANGLADESH.md` | India pack content with basis status; no Bangladesh MLM pack; conditional affiliate pack |
| SYN-00 | §8 addendum with Phase 2 findings and conflict C-14 |
| GOV-02 Decision log | DEC-19 (Phase 2 scope, decided), DEC-20 (no Bangladesh MLM, provisional), DEC-21 (India first pack, proposed) |
| GOV-03 Open questions | FD-02, OQ-07, -08, -09, -19, -22, -37 updated; AQ-10..13, OQ-38, DA-13, DA-14 added |
| GOV-04 Readiness | Verdict rows for packs; §5 items; §9 Phase 2 update |
| GOV-01 Index; PRD-04 source note | New document and folder referenced |

Consistency check after the changes: no unknown IDs, no broken links; 69 diagrams render.

## 4. Still open (cannot be done by desk research)

Interviews and the demand test (OQ-01..03); written provider answers (AQ-01); Indian counsel and chartered-accountant review (AQ-10..12); Bangladeshi counsel (AQ-13); human spot-check of plan coding (OQ-07); performance spike (OQ-05); usability tests (OQ-21); the founder's launch-market decision with own access scored (FD-02).
