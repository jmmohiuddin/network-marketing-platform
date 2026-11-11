# 01 — INDUSTRY RESEARCH
## Direct selling and network marketing: what the industry is, how big it is, where it is heading

| Field | Value |
|---|---|
| Document ID | 01_INDUSTRY_RESEARCH |
| Version | 0.1 (Wave 1; Wave 2 status notes added to §5 only) |
| Date | 2026-11-11 |
| Research IDs | R-01 (Industry overview); inputs to R-35, R-13, R-14 |
| Sources | `S-xxx` IDs refer to 00_RESEARCH_SOURCE_REGISTER.md |
| Labels | [VF] verified fact · [RB] research-backed · [IP] industry pattern · [HY] hypothesis · [SR] strategic recommendation · [UV] unknown requiring validation |

**Status of this document.** This is a Wave 1 foundation, built mainly from one authoritative statistical source (WFDSA, S-001, read in full) plus US association data and a legal screen read at excerpt level. Where background material is needed but no source has been read yet, the text says **"source pending"** and carries a [HY] or [IP] label. Nothing here is an estimate of the software market; that is in `02_MARKET_SIZE_AND_OPPORTUNITY.md`.

---

## 1. Definitions and why the boundaries matter

### 1.1 Three terms that are often mixed up

| Term | Working definition used in this research | Legal status (screen, see 51) | Source |
|---|---|---|---|
| **Direct selling** | A retail channel in which independent contractors sell products or services to consumers outside fixed retail premises. The WFDSA counts a "rep" as anyone who signed an independent-contractor agreement, **including inactive people and discount-only buyers**. | Lawful in the markets screened, subject to licensing/registration in several | [VF] S-001; S-005 describes participants as independent contractors paid "ultimately based on sales" |
| **Multi-level marketing (MLM) / network marketing** | A direct-selling compensation design in which a participant is paid on their own sales **and** on the sales or purchases of people they sponsored (a "downline"). | Lawful where direct selling is lawful, provided it is not a pyramid scheme. The FTC states MLM is not unlawful per se. | [VF] S-020 (excerpt) |
| **Pyramid scheme** | Participants pay for the opportunity to earn rewards derived primarily from recruiting others, not from sale or consumption of products to real customers. | Banned: EU (UCPD Annex I point 14), UK (CPRs 2008 Sch 1 item 14, now DMCCA 2024 Sch 20), Malaysia (Part VA of Act 500), Singapore (general prohibition), US (FTC, case law) | [VF] S-029, S-022, S-023, S-042, S-051, S-020 (all excerpts) |

### 1.2 How regulators draw the line (the point that shapes the product)

- **US.** The FTC's non-binding guidance says there is no percentage test and no safe harbor. "Primarily retail sales" is **not** the legal standard. Compensation incentives matter, and purchases made to qualify for recruitment-based rewards are evidence of a pyramid. The FTC stresses documenting retail sales to real customers. [VF] S-020, S-021 (excerpts).
- **EU.** UCPD Annex I point 14 bans "establishing, operating or promoting a pyramid promotional scheme where a consumer gives consideration for the opportunity to receive compensation that is derived primarily from the introduction of other consumers into the scheme rather than from the sale or consumption of products". [VF] S-029 (excerpt). A CJEU ruling of 15 Dec 2016 is reported as holding that a financial contribution plus a link, which may be indirect, between new members' payments and existing members' compensation can suffice. [RB] S-030 (excerpt; judgment itself not yet read).
- **UK.** The CPRs 2008 banned pyramid schemes; the DMCCA 2024 replaced them from 6 Apr 2025. [VF] S-022 to S-025 (excerpts). The CMA has obtained criminal convictions for a gifting-style scheme. [VF] S-026 (excerpt).

**Implication [SR].** A platform that configures commissions and payouts is not a neutral tool. The same configuration engine that pays a lawful plan can pay an unlawful one. Regulators look at (a) what the compensation rewards, (b) whether sales to real end customers exist and are documented, and (c) whether people must buy to qualify. The product should be designed so that these three facts are **visible and auditable** (see 51, candidate requirements CMP-01 onward). This is a design consequence, not legal advice.

---

## 2. Industry facts (WFDSA STATS 2024, S-001)

All figures are [VF] from S-001 unless stated. S-001 is Grade A (industry-run, estimates, method partly visible). Derived ratios were computed in `02_market_calcs.py`.

### 2.1 Scale

| Metric | 2024 value |
|---|---|
| Global retail sales | **$163,863M** (about −0.05% vs 2023; 3-year CAGR 2021–24 about −1.2%) |
| Independent representatives (contract signers) | **104,338,049**, of whom 72.1% are female |
| Member associations | 55 national DSAs |
| Markets above $1B | 21 markets = 92% of global sales |
| Top 10 markets | 78% of global sales: US, Germany, China, Korea, Malaysia, Japan, Brazil, Mexico, France, Taiwan |

**Restated history (USD M, S-001):** 2021 $170,023 · 2022 $168,147 · 2023 $163,937 · 2024 $163,863.

**Discrepancy [UV].** The prior WFDSA report published 2023 global sales as **$167,694M** (S-002, 26 Aug 2024). S-001 now shows 2023 as $163,937M, a **−2.24%** restatement. The likely explanation is a change of constant-dollar base year (2023 USD to 2024 USD), but S-001 as read does not say so; the cause is unverified. Anyone quoting "a decline of almost $4B in 2023" (as the Statista summary S-013 does) is using the pre-restatement figure. Validation: ask WFDSA or read the methodology note in S-001's appendix.

### 2.2 Regions (S-001; derived shares)

| Region | 2024 sales ($M) | Share |
|---|---|---|
| Asia/Pacific | 66,058 | 40.3% |
| Americas | 61,189 | 37.3% |
| Europe | 35,352 | 21.6% |
| Africa/Middle East | 1,265 | 0.8% |

(Components sum to 163,864 against the stated 163,863; rounding.)

### 2.3 Product categories (S-001)

Wellness 29.0%; cosmetics and personal care 22.8%; household goods and durables 15.3%. Financial services (about 5%) and utilities (about 4%) were read from a chart and are marked **[UV-read]**: verify against the table before relying on them.

**Why this matters [SR].** About two-thirds of channel sales sit in three physical-goods categories that carry **inventory, fulfilment, returns, tax and product-claims obligations**. A back-office platform for this channel needs commerce and order management, not just commissions. Financial-services and utilities direct selling (smaller share, higher regulatory load) is a different compliance profile and should not be assumed in scope.

### 2.4 The people

- 104.3M reps, 72.1% female [VF]. The share aged under 35 fell to 23% while the share aged 55+ rose to 28% [VF] (S-001 age cohorts).
- **Measurement caveat [VF].** "Rep" includes anyone who signed a contractor agreement. The US shows how large the definitional gap is: **12.2M** people signed or renewed contracts in 2024, of whom **5.4M** were "actively engaged in building their own direct selling businesses", and the US also reports **34.3M** preferred customers and discount buyers (S-003, S-004, S-005). So a "rep" count overstates the number of people actively working the business by roughly a factor of two in the US (5.4M is 44% of 12.2M).
- **Therefore** retail sales per rep are **not** earnings per person. They are descriptive ratios only (see 02).

### 2.5 Direction of travel

| Observation | Evidence | Label |
|---|---|---|
| Global sales fell from $170.0B (2021) to $163.9B (2024) in restated terms; 2024 was roughly flat | S-001 | [VF] |
| WFDSA describes 2024 as stabilization and "suggests the post-pandemic slump may be bottoming out" | S-001 narrative; S-011, S-012 | [VF] (WFDSA's own interpretation, not independent) |
| Markets are diverging: Malaysia (+2.1% in 2024, 9.0% CAGR) and India (+4.0%, 7.0% CAGR) grew; the US (−5.2%, CAGR −6.6%), Thailand, Indonesia and the Philippines fell | S-001 table | [VF] |
| The rep base is ageing | S-001 age cohorts | [VF] |
| US retail sales fell from $40.5B (2022) to $34.7B (2024) | S-006, S-003 | [VF] |
| WFDSA flags regulatory headwinds: ILO attention, EU developments, influencer marketing, youth targeting, and independent-contractor status | S-001 conclusions | [VF] |

**What this means [SR, labeled provisional].** This is a mature channel that is flat to shrinking at global level, so the opportunity for a software vendor is unlikely to come from market growth. It would have to come from **share gain** (migration from legacy platforms), **new-company formation**, **specific growth markets** (India, Malaysia), or **compliance-driven replacement** demand. Each of these is a hypothesis to test in Waves 2–3, not a finding.

---

## 3. Compensation plan families (background, source pending)

The following taxonomy is standard industry vocabulary used by vendors and practitioners. **No source for it has been read yet**; it is recorded as an **[IP] industry pattern** to be sourced and expanded in R-14 (compensation plan research). It is here only so later documents share a vocabulary.

| Family | Typical structure | What it implies for software [HY] |
|---|---|---|
| Unilevel | Each member has one sponsor; commissions are paid by depth/level | Tree of sponsor relationships; level-based payout |
| Binary | Two legs per member; payouts depend on volume balance between legs | Placement tree distinct from sponsor tree; carry-forward volume |
| Matrix (forced or width-limited) | Fixed width per member; spillover | Placement rules; spillover handling |
| Stair-step / breakaway | Rank thresholds, group volume, breakaway groups | Rank engine; group-volume roll-ups; re-parenting rules |
| Hybrid | Combinations of the above plus bonuses (fast-start, car, pool) | Rules must be composable, versioned and simulatable |

**Validation required [UV].** The sponsor-versus-placement distinction, volume definitions (PV, GV, QV) and rank logic vary by company. The compensation engine design in later stages must be built from sampled real plans (R-14), not from this table.

---

## 4. Who buys the software (customer taxonomy, hypotheses)

The buyer is the direct-selling **company** (the "corporate"), not the independent rep. Reps are the main end users of the product. The following segmentation is a **hypothesis** [HY] used to structure Wave 2–3 research; no segment size has been measured.

| Segment | Description | Likely needs | What would validate it |
|---|---|---|---|
| S1 Established multinational/enterprise brands | Large rep bases, multi-country, existing platform or in-house build. Plexus is an example of an established US brand (a direct-selling brand, not a vendor; S-076) | Scale, multi-currency, tax, integrations, change-management | Public case studies; vendor customer lists; conference talks |
| S2 Mid-market established companies | Tens of thousands of reps, single or few countries | Replace aging system, compliance, mobile experience | Vendor case studies; job postings; interviews (none yet) |
| S3 New launches / start-ups | Founders launching a plan quickly | Low-cost configurable plan engine, fast launch | Price anchors in S-066, S-071 (Grade C); founder interviews |
| S4 Hybrid / community-commerce / affiliate-style programs | Referral or social-selling programs that may or may not be MLM | Commissions on referrals, light genealogy | Needs a separate legal screen: some of these designs are indistinguishable from MLM to a regulator |
| S5 In-house builders | Companies that built their own system | Migration, modernization | Job postings, conference talks (not yet searched) |

**Challenge to the brief [SR].** The brief frames the product as for "network marketing" generally. S4 is the highest-risk segment: if the compensation depends mainly on recruitment or on required purchases, the platform becomes a tool for the exact structures regulators prosecute (see 51 and the ethical-use question OQ-03 in 66).

---

## 5. Unknowns that block deeper industry analysis

| ID | Unknown | Why it matters | How to resolve |
|---|---|---|---|
| IU-1 | **Partly answered in Wave 2 (US 660+, Malaysia about 400, India 461+; 02 §5.1).** Number of direct-selling companies per target market | Core input to the customer count (02 §5) | Association member lists, regulator licence registers (Malaysia KPDN, India, Vietnam, Thailand OCPB), DSA member directory |
| IU-2 | Churn of platforms (how often companies switch vendors) | Replacement demand | Vendor case studies, interviews |
| IU-3 | Share of companies on in-house vs vendor platforms | Serviceable market | Job postings, interviews |
| IU-4 | **Partly answered in Wave 2:** S-001 states 2023–24 are in "US Constant 2024 Dollars" (02 D-12), consistent with a rebasing; unconfirmed. Whether the WFDSA 2023 restatement is a currency-base change | Trend interpretation | WFDSA methodology |
| IU-5 | **Still open after a Wave 2 re-check** (chart text does not pair values with labels; 02 D-13). Product-category numbers for financial services and utilities | Scope of compliance | Re-read S-001 tables |
| IU-6 | Evidence on digital/social-selling share of the channel | Product direction (mobile, social) | WFDSA/DSA technology studies; source pending |

---

## 6. Evidence summary for this document

| Label | Count | Note |
|---|---|---|
| [VF] | Core statistics (S-001, S-005, S-006) and regulator/legislation statements at excerpt level | Legal items need full primary-text read |
| [RB] | CJEU interpretation | Single secondary source, judgment unread |
| [IP] | Compensation families | Source pending |
| [HY] | Customer segments, growth routes | Test in Waves 2–3 |
| [UV] | IU-1 to IU-6, restatement cause, categories read from chart | See table above |
