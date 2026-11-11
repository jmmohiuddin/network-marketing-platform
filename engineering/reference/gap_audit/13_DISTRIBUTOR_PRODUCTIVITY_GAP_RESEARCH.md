# 13 — DISTRIBUTOR PRODUCTIVITY GAP RESEARCH
## Real productivity versus engagement, and the people the product would actually serve

| Field | Value |
|---|---|
| Document ID | GAP-13 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 7 |
| Gaps | GAP-050, GAP-051 (and GAP-003 in 07) |

## 1. What the evidence says about distributors (secondary sources not used before)

| Finding | Source | Grade | Limits |
|---|---|---|---|
| 47% of former participants lost money, 27% made none, 25% made a profit (53% of those under $5,000) | AARP Foundation / GfK 2018 (G-S16) | B | US, online sample, self-reported, 2018 |
| 39% stopped because pitching to friends and family felt awkward; 41% felt misled about their chances | G-S16 | B | Same |
| 90% joined to make money; 63% to sell to others | G-S16 | B | Same |
| Median annual commissions 2024: $466.56 for full-year consultants, $77.68 part-year (Scentsy, gross) | G-S27 | A (company) | One company; before expenses |
| Median Brand Partner $23 (Young Living, 2022) | S-140 | A (company) | One company |
| 72.1% of reps female; 28% aged 55+ and 23% under 35 | S-001 | A (industry) | Contract signers, not active sellers |
| US: 12.2M contract signers, 5.4M actively building, 34.3M preferred customers | S-003..S-005 | A/B | Definitions differ |

**What this changes [SR]:** a productivity feature that increases recruiting activity or app sessions is not evidence of value and may increase harm. The measurable, defensible outcome is **retail customers acquired and retained**, and accurate expectations.

## 2. Gap records

### GAP-050 — Productivity metrics must target customers and sustainable activity

| Field | Content |
|---|---|
| **Category** | Growth, compliance |
| **Previous research coverage** | P-06 (attrition hypothesis), P-09, P-10 (unrated); journeys J-13, J-14 with no evidence |
| **Missing element** | A definition of "productive" that does not reward recruitment or engagement for its own sake |
| **Evidence** | §1 (G-S16, G-S27); FTC focus on recruitment rewards and earnings claims (S-020, G-S03) |
| **Why it matters** | Engagement metrics are easy to raise and say nothing about distributor welfare or lawful revenue |
| **Affected stakeholders** | Distributors, leaders, Compliance, the platform's reputation |
| **Product implications** | Leader dashboards show customers served, repeat-order rates, returns, and time-to-first-customer; **no** "recruits this week" leaderboards by default; onboarding checklists end in a first retail sale, not a first recruit |
| **Technical implications** | Metrics derived from attributed orders (GAP-040) |
| **Recommended solution** | Write a metrics policy; candidate north-star for the field side: **retail customers with a repeat order in 90 days, per active distributor** (to validate) |
| **Priority** | Medium |
| **Implementation stage** | V1 |
| **Confidence** | Medium |
| **Documentation changes required** | 06 P-06, P-10; 10 J-13, J-14; future analytics document |

### GAP-051 — Language, accessibility and low bandwidth

| Field | Content |
|---|---|
| **Category** | UX |
| **Previous research coverage** | Master Plan R-19 lists localisation (incl. RTL, Bangla, Hindi, Arabic) for Wave 6; not researched |
| **Missing element** | Requirements for the user base the evidence describes: majority female, a large 55+ share, multilingual markets (India, Malaysia), many low-spend accounts (02 §2) |
| **Evidence** | S-001 age and gender; 02 §2 revenue per rep from $131 to $3,538 |
| **Why it matters** | Statement comprehension and support cost depend on language and readability |
| **Affected stakeholders** | Distributors, Support |
| **Product implications** | Statements and key flows in local languages (Bahasa Malaysia, Hindi and regional languages, depending on launch market); readable type sizes; WCAG 2.2 AA as the target; light pages for slow connections |
| **Technical implications** | i18n from the first screen; server-rendered, low-weight distributor pages; locale-aware number and date formats |
| **Recommended solution** | If launching in India or Malaysia, include the launch language(s) in MVP for distributor-facing pages and statements; admin in English first |
| **Priority** | Medium |
| **Implementation stage** | MVP (if India or Malaysia) |
| **Confidence** | Medium |
| **Documentation changes required** | Master Plan R-19, future UX research |

## 3. Brief sub-topics: status after this audit

| Sub-topic | Status | Next step |
|---|---|---|
| Onboarding friction, time to first sale or customer | No evidence | G-DIST questions; metric defined in GAP-050 |
| Training completion and effectiveness | No evidence | Integrate an LMS; do not build (Master Plan R-MOD-I) |
| Confidence, motivation, recognition, goal setting | No evidence | Interviews; avoid income-goal features (GAP-003) |
| Activity patterns, inactivity and churn signals | Weak (AARP reasons) | Rules-first inactivity flags for leaders, privacy-limited |
| Mobile usage | No evidence (P-09) | Survey D (66 Appendix A); design mobile-first statements anyway (low cost) |
| Accessibility, language | Evidence of need (demographics) | GAP-051 |
