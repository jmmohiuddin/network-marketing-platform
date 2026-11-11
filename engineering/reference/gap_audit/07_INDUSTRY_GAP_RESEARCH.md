# 07 — INDUSTRY GAP RESEARCH
## Hidden direct-selling problems the original research missed or under-researched

| Field | Value |
|---|---|
| Document ID | GAP-07 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 1 |
| Gaps | GAP-001 to GAP-006 |
| Rule | "Do not assume every issue applies to every company" (brief). Each record says which companies it plausibly affects |

## 1. Domain-1 problems: what software does about them today

"Incumbent handling" = what vendor documentation or first-party sources show (not marketing silence). "Unknown" = nothing found either way.

| Problem (brief list) | Who it affects | Evidence of the problem | Incumbent handling found | Gap ID |
|---|---|---|---|---|
| Distributor inactivity, churn, downline abandonment | All MLM operators | AARP: 47% lost money and 27% made none; 39% stopped because pitching friends and family felt awkward (G-S16); Nu Skin net declines (S-122) | Activity flags in plans (rolling windows, G-S25); retention tooling is vendor-claimed only | GAP-003, GAP-050 |
| Sponsor reassignment, genealogy correction, network conflicts | Operators with placement trees or sponsor-change policies | Plans fix change windows (USANA 10 days; Modere 60 days) and require ethics approval to move a business centre (G-S25, G-S26): companies write rules because disputes occur | Unknown in vendor docs read | GAP-002 |
| Duplicate, fake and multiple accounts | Binary plans especially; any plan paying on enrolment | USANA gives three business centres by design and restricts their placement (G-S25): multiple positions are legitimate in some plans and abuse in others | Unknown | GAP-002, GAP-065 |
| Self-purchasing to qualify, inventory loading, rank manipulation, manipulated volume | Plans with personal-volume qualification | FTC guidance (S-020); bonus-buying fraud research in job postings (S-131); Herbalife order caps personal consumption at one-third of rewards (G-S02) | No vendor documentation found for detection | GAP-005 |
| Fake retail customers | Plans that reward "customer" volume | Herbalife order requires retail-sale records with purchaser identity (S-120, G-S02) | Unknown | GAP-005 |
| Cross-line purchasing, unauthorised activity, international conflicts | Multi-market operators | Indonesia bars licensed sellers from marketplaces (C-grade, S-045) | Unknown | GAP-006 |
| Termination, customer-ownership and commission disputes | All | Customer ownership rules appear in plans (personally enrolled QV per leg, G-S28; customer "POD", G-S26) | DirectScale documents commission overrides and payable adjustments (G-S30) | GAP-002, GAP-040 |
| Returns and refunds after payout | All | Covered in original (P-12) | DirectScale clawback to next check (G-S29) | GAP-032 (policy) |
| Unethical income and product claims | All, especially fast-growing operators | **DSSRC 2025: 2,966 income posts and 792 health posts flagged from ~526,000 URLs; 94% from social media** (G-S15) | Specialist vendors: FieldWatch monitoring (G-S17), Masset approved-content library (G-S18) | GAP-001 |
| Payment acceptance and merchant risk | All MLM operators | Stripe prohibits MLM; PayPal requires approval (G-S04, G-S20) | Top vendors partner with specialist processors (S-091) | GAP-004 |
| Company–distributor trust | All | 41% felt misled about chances of success (G-S16) | Statements with pay history (G-S30) | GAP-003, GAP-027 |

## 2. Gap records

### GAP-001 — Earnings and health claims on social media are frequent, and the research missed them

| Field | Content |
|---|---|
| **Category** | Compliance, market |
| **Previous research coverage** | CMP-05 (earnings disclosures from payout data) and J-07 note that "a distributor makes an unapproved earnings claim (monitoring is outside the platform unless materials are managed)". No source on frequency |
| **Missing element** | Evidence that claims are the most frequently **observed** compliance problem in US direct selling, and that a vendor category already serves it |
| **Evidence** | DSSRC 2025: 46 new inquiries, 560 earnings and 48 product claims in inquiries; monitoring flagged 2,966 income posts and 792 health posts; ~94% of inquiry claims from social media; 5 referrals to the FTC or state AGs (G-S15). FTC NPRM (Jan 2025) bars giving participants recruitment materials with deceptive earnings claims and requires substantiation (G-S03). Vendors: FieldWatch (G-S17), Masset (G-S18) |
| **Why it matters** | It is the only direct-selling compliance problem with published frequency. It also shows that **companies are held responsible for distributors' posts**, which affects what tools a company needs |
| **Affected stakeholders** | Compliance Officer, Marketing Manager, distributors, the operator's counsel |
| **Product implications** | (a) Content library of approved claims and income-disclosure links (J-07); (b) a disclosure statement computed from payout data, so approved content can link to a true figure (CMP-05); (c) **integrate** with monitoring vendors rather than build crawling |
| **Technical implications** | Webhook or export of the approved-content catalogue and disclosure figures; no web-scraping subsystem |
| **Recommended solution** | Do not build monitoring. Build the **data side** (earnings disclosure computed from payouts, versioned approved claims per market) and partner with a monitoring vendor. Test in G-CMP interviews whether buyers already pay for monitoring |
| **Priority** | High |
| **Implementation stage** | V1 (disclosure data); partner integration later |
| **Confidence** | High that the problem is frequent (US); **Low** that buyers would pay a platform vendor for it |
| **Documentation changes required** | 06 (new problem P-19), 07 (rating), 05 (new hypothesis H-10), 51 CMP-05, 66 Appendix A (add claims questions to G-CMP) |

### GAP-002 — Genealogy and account-integrity disputes are unresearched

| Field | Content |
|---|---|
| **Category** | Business, technical |
| **Previous research coverage** | 06 §3 lists "duplicate or fake accounts" as not researched; 13 §5 edge case 1 asks whether past volume moves on a sponsor change; BR-REG-02, -03 |
| **Missing element** | The dispute and change processes: sponsor reassignment, placement change, cross-line recruiting, duplicate merges, multiple or household accounts, **succession on death, division on divorce, sale or transfer of a distributorship**, and how each touches past and future commissions |
| **Evidence** | Real plans set hard windows and approvals for changes: USANA placement change only within 10 days; moving a business centre needs 6 months of inactivity and Ethics Department approval (G-S25); Modere sponsor designation within 60 days, then permanent (G-S26). Such rules exist because changes are contested |
| **Why it matters** | A genealogy change moves future income between people. Without effective dating and an approval trail, a change either rewrites history (breaking reproducibility, 13 §7) or cannot be made |
| **Affected stakeholders** | Distributors, sponsors and uplines, Compliance, Support, Finance |
| **Product implications** | Case-based change requests with reason codes, evidence, approvals and effective dates; duplicate-detection queue; account types (individual, joint, business entity); transfer and succession workflows |
| **Technical implications** | Effective-dated relationships (GAP-010); immutable history; recalculation scope rules (GAP-023); audit trail |
| **Recommended solution** | Model every genealogy change as a **dated event** with a request → review → approve → effective lifecycle; never update a relationship in place; plan version states which changes move past volume (default: none) |
| **Priority** | High |
| **Implementation stage** | MVP (change events, duplicate flag); V1 (succession, transfer) |
| **Confidence** | Medium (rules evidenced; dispute frequency unknown) |
| **Documentation changes required** | 06 (new problem P-20), 10 (new journeys), 15 (new BR-GEN domain), 08 (new stakeholders: heirs, assignees, business-entity distributors) |

### GAP-003 — Distributor outcome evidence was not used, and the product must be honest by design

| Field | Content |
|---|---|
| **Category** | Compliance, strategy, UX |
| **Previous research coverage** | P-06 (attrition, hypothesis only); Young Living income statement (S-140); ethical caution that the product must not market higher income |
| **Missing element** | Available survey and disclosure evidence, and its design consequences |
| **Evidence** | AARP Foundation 2018 (n=1,016): 47% lost money, 27% made none, 25% profit (53% of those under $5,000); 39% stopped because pitching friends and family felt awkward; 41% felt misled about chances (G-S16). Scentsy 2024: full-year consultants' median annual commissions $466.56, part-year $77.68, before expenses (G-S27) |
| **Why it matters** | Any feature that shows distributors "potential earnings", projects income or rewards recruiting can produce the misleading impression the FTC targets (G-S03). Honest statements are also a trust feature |
| **Affected stakeholders** | Distributors, prospects, Compliance, the platform's own reputation |
| **Product implications** | No income projections or "what you could earn" calculators by default; earnings disclosure from real payout data; product metrics based on retail customers and repeat purchases, not recruits |
| **Technical implications** | Disclosure computation over full participant population including zero earners (CMP-05) |
| **Recommended solution** | Adopt a written **product honesty policy** (no income projection features; disclosure links wherever earnings are shown) alongside the tenant acceptance policy (OQ-03) |
| **Priority** | High |
| **Implementation stage** | MVP (policy and statement design) |
| **Confidence** | Medium-High (US evidence) |
| **Documentation changes required** | 06 P-06, 09 PR-05, 51 CMP-05, 66 OQ-03 |

### GAP-004 — Mainstream payment providers prohibit or restrict MLM merchants

| Field | Content |
|---|---|
| **Category** | Technical, financial, commercial |
| **Previous research coverage** | 51 §5.3 cites one vendor claim (S-116) that banks see MLM as high risk; 06 P-16 says merchant risk has no source; payout Option 1 assumes the tenant's own provider |
| **Missing element** | First-party provider policies and their effect on the integration plan |
| **Evidence** | Stripe: **prohibited** "Pyramid schemes" and "Multilevel marketing services offering commission or recruitment-based sales" (G-S04). PayPal: prohibits "certain multi-level marketing programs"; MLM and direct selling **require pre-approval** (G-S20). Zoho Payments India: "Multi-level marketing collection fees" prohibited (G-S21). Exigo lists specialist partners (Nexio, PayQuicker, FlexPay; S-091) |
| **Why it matters** | If tenants cannot accept card payments or pay out through mainstream providers, the platform needs integrations with **specialist or high-risk processors** in each launch market, and a tenant's ability to go live depends on a third party's underwriting |
| **Affected stakeholders** | Tenant Finance, Super Admin, the platform's integration team, distributors (payout availability) |
| **Product implications** | Payment and payout adapters for specialist providers; go-live checklist includes processor approval; fallback payout by bank file |
| **Technical implications** | Provider-agnostic payment and payout interfaces (MH-REQ-03); per-tenant provider configuration; no dependency on a single mainstream provider |
| **Recommended solution** | Before MVP: list processors that accept MLM merchants **in the launch market**, confirm in writing, and choose at least two (one card acceptance, one payout). Also confirm the **platform's own** billing provider accepts a vendor whose customers are MLMs |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | High (first-party policies); Unknown for Malaysian and Indian providers |
| **Documentation changes required** | 06 P-16, 51 §5 (add provider eligibility), 66 (new OQ-11), future integration architecture |

### GAP-005 — No operational definitions for inventory loading, bonus buying or fake customers

| Field | Content |
|---|---|
| **Category** | Compliance, security |
| **Previous research coverage** | P-14; CMP-01, CMP-02 (tagging and flags) without definitions |
| **Missing element** | Measurable signals and the data needed to compute them |
| **Evidence** | Herbalife order defines **Net Rewardable Sales** and limits personal-consumption share to one-third (G-S02) — a regulator-imposed, computable definition. Job duties include bonus-buying research (S-131) |
| **Why it matters** | "Flag inventory loading" cannot be built without a definition; a vague flag produces noise and liability |
| **Affected stakeholders** | Compliance, Finance, Fraud analysts |
| **Product implications** | Configurable signal library, e.g., personal-consumption share of a participant's rewarded volume; orders placed in the last days of a period just above a rank threshold; customer accounts sharing payment instruments or addresses with the distributor; returns spiking after qualification |
| **Technical implications** | Signals computed from order, payment-instrument and address data; needs hashed payment fingerprints and address normalisation |
| **Recommended solution** | Ship a small set of **documented, configurable signals** with tenant-set thresholds; describe them as indicators, never as findings of unlawfulness (13 §6) |
| **Priority** | Medium |
| **Implementation stage** | V1 |
| **Confidence** | Medium |
| **Documentation changes required** | 15 (BR-CPL), 51 CMP-02, 16 of this audit |

### GAP-006 — Unauthorised channels and cross-border selling conflicts

| Field | Content |
|---|---|
| **Category** | Operational |
| **Previous research coverage** | CMP-13 (Indonesia marketplace bar, C-grade) |
| **Missing element** | Distributors reselling on marketplaces, selling into unlicensed countries, or enrolling people in markets the company has not opened |
| **Evidence** | Indonesia restriction (S-045, C-grade). No other evidence found in this audit |
| **Why it matters** | A distributor enrolling someone in a market where the company is unlicensed can create legal exposure (for example, Bangladesh, 51 §3.2) |
| **Affected stakeholders** | Compliance, Country Managers |
| **Product implications** | Enrolment and shipping restricted to opened markets; residency checks per market |
| **Technical implications** | Market eligibility rules on registration and orders |
| **Recommended solution** | Market-gating rule in registration (BR-REG-04) for MVP; marketplace monitoring left to partners |
| **Priority** | Low |
| **Implementation stage** | V2 (beyond the basic gate) |
| **Confidence** | Low |
| **Documentation changes required** | 15 BR-REG-04, 51 CMP-13 |
