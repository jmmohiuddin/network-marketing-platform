# 71 — INDIA: MARKET, LEGAL, TAX AND DATA SCREEN
## What a direct-selling company in India must do, and what that means for the product

| Field | Value |
|---|---|
| Document ID | P2-71 |
| Version | 0.1 |
| Date | 2026-11-12 |
| Grade | **Screening grade.** Law-firm and tax-portal summaries; the Rules' gazette text was not read in full. No Indian counsel or chartered accountant has reviewed it. Not legal or tax advice |
| Sources | P2-S20..P2-S33 (79) |

## 0. Result in five lines

1. **Direct selling, including multi-level plans that pay on product sales, is lawful** under the Consumer Protection (Direct Selling) Rules 2021 (amended 2023). Pyramid schemes and money-circulation schemes are prohibited.
2. The Rules create **concrete, checkable duties** — registration, an Indian office, compliance and nodal officers, grievance timelines, public registers of sellers, in-country data. These map directly onto compliance-analytics and evidence features.
3. **Market:** ₹23,021 crore of sales in FY2024-25 (+4%), 93.2 lakh direct sellers (IDSA/Ipsos, May 2026). Growing slowly.
4. **Tax:** commission withholding is **2% under s.393** of the Income-tax Act 2025 (formerly s.194H), above ₹20,000 a year; 20% without PAN; quarterly Form 26Q.
5. **Data:** consumer data must be kept in India under the Rules; DPDP Rules phase in from Nov 2026 to May 2027. Two AWS regions exist (Mumbai, Hyderabad).

## 1. Direct-selling law

| Duty (as summarised) | Product feature it implies | Source | Basis status |
|---|---|---|---|
| Registration of the direct-selling entity with DPIIT (2023 amendment) | Licence/registration evidence gating go-live (CMP-12) | P2-S20 (KS&K, 4 May 2026) | Secondary |
| Registered office in India | None (company matter) | P2-S20 | Secondary |
| Chief Compliance Officer; nodal officer available 24×7 | Named roles in the tenant; contact page | P2-S20 | Secondary |
| Grievance acknowledgement within **48 hours**; resolution within **one month** | Grievance register with timers and escalation; report of breaches | P2-S20 | Secondary |
| **No entry or registration fee** for direct sellers | Guardrail: block any fee charged on joining | P2-S20 | Secondary |
| Pyramid and money-circulation schemes prohibited (Rule 10 as summarised) | Guardrails; R3 payout-source report; R4 purchase-qualification report | P2-S20 | Secondary |
| Written agreement with each direct seller; KYC; ID card | E-agreement capture, KYC status per participant | Research 51 §3.3 (S-039) | Primary text read in Wave 1 (excerpt) |
| Register of direct sellers **and of delisted sellers** on the website | Public register export from the participant record | P2-S20 | Secondary |
| Consumer data stored in India | In-country data region (CMP-08) | Research 51; P2-S20 | Primary excerpt + secondary |
| State monitoring committees (8 states notified by Apr 2023) | Reporting to states; no format found | P2-S23 (Business Standard, 2 Apr 2023) | Newspaper |
| FSSAI "Direct Seller" licence category since July 2024 (food and supplements) | Product-category registration evidence | P2-S20 | Secondary |
| Prize Chits and Money Circulation Schemes (Banning) Act 1978 **not amended**; a standalone Direct Selling Act is **pending** | Rules may change; pack must be versioned | P2-S20 | Secondary |

### 1.1 Open legal questions (India)

| ID | Question | Who |
|---|---|---|
| AQ-IN-01 | Does a monthly **personal purchase requirement** to receive commissions (seen in two corpus plans, 74) conflict with the Rules or the 1978 Act? | Indian counsel |
| AQ-IN-02 | What is the exact scope of "consumer data" stored in India — does it include direct sellers' data and commission records? Does it override DPDP cross-border rules? | Counsel |
| AQ-IN-03 | Is a foreign software vendor processing data for a direct-selling entity subject to any duty under the Rules (for example, as an agent)? | Counsel |
| AQ-IN-04 | Buy-back, return and cooling-off duties under the Rules (not verified in this phase) | Counsel |
| AQ-IN-05 | Formats, if any, for state committee reporting | Counsel; IDSA |

## 2. Tax

| Item | Finding | Source |
|---|---|---|
| Statute | Income-tax Act 2025, in force from 1 Apr 2026 | P2-S24 |
| Provision | s.393(1), Table serial 1(ii) — commission or brokerage (formerly s.194H) | P2-S24 (tdsman, Jun 2026) |
| Rate | **2%** | P2-S24 |
| Threshold | ₹20,000 per payee per financial year | P2-S24 |
| No PAN | 20% | P2-S24 |
| Return | Form 26Q, quarterly | P2-S24 |
| GST on direct sellers' commission | **Not researched** in this phase | AQ-IN-06 (chartered accountant) |

**Product consequence:** an India pack needs per-payee annual aggregation against the threshold, a PAN status field that switches the rate, withholding lines on statements and a 26Q-ready export. Values stay in the pack and are confirmed by a chartered accountant before release (DEC-14).

## 3. Data protection

| Item | Finding | Source |
|---|---|---|
| DPDP Act 2023; DPDP Rules notified 13 Nov 2025 | Phased: consent-manager provisions from 12/13 Nov 2026; main duties from 12/13 May 2027 | P2-S25 (AZB & Partners) |
| Direct Selling Rules in-country storage | As above | P2-S20 |

**Product consequence:** India tenants in an India cell (ap-south-1 or ap-south-2). Processor duties (breach notice, erasure) apply to the platform as a data processor.

## 4. Market

| Measure | Value | Source |
|---|---|---|
| Sales FY2024-25 | ₹23,021 crore (+4%) | P2-S26 (IDSA/Ipsos, published 15 May 2026) |
| Direct sellers | 93.2 lakh; 48% women | P2-S26 |
| Category mix | Wellness ≈60%, cosmetics ≈26% | P2-S26 |
| Top states | Maharashtra 15.31%, West Bengal 10.88% | P2-S26 |
| Earlier | ₹19,000+ crore and 84 lakh sellers in FY22 | P2-S23 |
| Number of registered entities | **Not found** | — |

**Not known:** how many companies exist, how many are mid-market (the target segment), and what they pay for software today. A secondary report (Hindi press, not fetched) cites ₹23,522 crore and 47% women — possibly a newer year; not used.

## 5. Implications for the product

| Area | Implication |
|---|---|
| MVP-A | Strong fit. R3 (payout source) and R4 (qualification by purchase) speak directly to the pyramid prohibition; the grievance and register duties are evidence-production work |
| Market pack | India is the **only one of the two markets with a lawful MLM framework**; a pack is specified in product document PD-04 |
| Residency | India cell from the first India tenant |
| Price | Local competitors sell one-time licences from about $699 (73); a SaaS price must be justified by compliance value, not by commission features |
