# 02 — MARKET SIZE AND OPPORTUNITY
## What the evidence says about channel size, and what is still unknown about the software market

| Field | Value |
|---|---|
| Document ID | 02_MARKET_SIZE_AND_OPPORTUNITY |
| Version | 0.1 (Wave 1; **no TAM/SAM/SOM figure is given, deliberately**) |
| Date | 2026-11-11 |
| Research IDs | R-02; inputs to R-16 (financial feasibility), R-35 (market selection) |
| Calculations | `02_market_calcs.py` (inputs copied from S-001; run output reproduced below) |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV] (see Master Plan §5.1) |

## 0. Summary

1. **The channel is large but flat-to-shrinking.** Global direct-selling retail sales were $163.9B in 2024 (−0.05% on 2023) across 104.3M contract-signing reps [VF] (S-001). US sales fell from $40.5B (2022) to $34.7B (2024) [VF] (S-006, S-003).
2. **Markets are diverging.** Malaysia (+2.1% in 2024; 9.0% 3-year CAGR) and India (+4.0%; 7.0%) grew while the US (−5.2%), Thailand (−7.1%), Indonesia (−11.3%) and the Philippines (−11.4%) fell [VF] (S-001).
3. **Retail sales are not the market for software.** The software market is the number of direct-selling companies multiplied by what each pays for a platform. **Neither number has been found.** Two public data points bound the problem: an advocacy group's 2021 list of "more than 660" direct selling companies operating in the US [VF as to the claim; scope is not an official census] (S-009), and public entry-price anchors of $499–$2,500 per month on software directories [Grade C] (S-066, S-071).
4. **No market-size number for the software is stated in this document.** Inventing one is prohibited by the brief; §5 gives the method, the inputs found, and the inputs missing.
5. **Gate G1 (market part): conditional pass.** At least two markets have a lawful framework and large channel sales (US, Malaysia, India; see 51), and no whole-category blocker was found. G2 (is the market big enough) **cannot yet be assessed**.

---

## 1. Global and regional channel size

### 1.1 Series (USD millions, S-001; 2023 restated)

| Year | Retail sales | Note |
|---|---|---|
| 2021 | 170,023 | |
| 2022 | 168,147 | |
| 2023 | 163,937 | **167,694 as first published** (S-002); see §4, D-1 |
| 2024 | 163,863 | −0.05% vs 2023; 3-year CAGR −1.22% (recomputed; S-001 says −1.2%) |

### 1.2 Regions (S-001; shares recomputed)

Asia/Pacific 66,058 (40.3%) · Americas 61,189 (37.3%) · Europe 35,352 (21.6%) · Africa/Middle East 1,265 (0.8%).

### 1.3 Concentration [VF] (S-001)

The top 10 markets hold 78% of sales; 21 markets exceed $1B and hold 92%.

---

## 2. Target-market table

Reps = people who signed a contractor agreement (includes inactive and discount-only buyers). **"$ per rep" is retail sales divided by contract signers. It is not income.** Source for all sales/reps/growth columns: S-001. Derived columns computed by `02_market_calcs.py`.

| Market | 2024 sales ($M) | % of global sales | Reps | % of global reps | $ per rep contract | YoY 2024 | 3-yr CAGR |
|---|---|---|---|---|---|---|---|
| United States | 34,740 | 21.20% | 12,180,000 | 11.7% | 2,852 | −5.2% | −6.6% |
| Malaysia | 10,197 | 6.22% | 9,609,326 | 9.2% | 1,061 | +2.1% | +9.0% |
| India | 3,528 | 2.15% | 8,806,000 | 8.4% | 401 | +4.0% | +7.0% |
| Thailand | 1,980 | 1.21% | 10,900,000 | 10.4% | 182 | −7.1% | −6.4% |
| United Kingdom | 1,171 | 0.71% | 331,011 | 0.3% | 3,538 | +0.8% | −10.5% |
| Indonesia | 1,092 | 0.67% | 8,331,000 | 8.0% | 131 | −11.3% | −7.3% |
| Vietnam | 894 | 0.55% | 695,778 | 0.7% | 1,285 | −3.9% | −5.3% |
| Philippines | 855 | 0.52% | 2,468,763 | 2.4% | 346 | −11.4% | −9.7% |
| Singapore | 442 | 0.27% | 557,894 | 0.5% | 792 | −1.8% | +0.2% |

Markets without a rep breakdown in the extracted text: Germany $19,050M (11.63% of global), France $4,714M (2.88%), Italy $2,930M (1.79%), EU-27 $31,315M (19.11%; Germany is 60.8% of it), UAE $31.7M (0.019%; a WFDSA research estimate).

**Observations**

- **[VF/derived]** Malaysia is the fifth-largest market globally and the highest-penetration market of the 63 ranked (2.417%; WFDSA defines penetration as a country's direct sales divided by its GDP, S-001 p. 9–10) and, among the nine target markets tabulated, the one with both high sales ($10.2B) and strong 3-year growth (+9.0% CAGR). India (+7.0% CAGR) is the only other target market that grew materially over three years; Singapore was flat (+0.2%). Markets outside the target list (for example Germany, China, Korea) were not examined.
- **[VF/derived]** Revenue per contract signer varies by a factor of about 27 between the UK ($3,538) and Indonesia ($131). Markets with many low-spend reps (Thailand, Indonesia, India) imply **a very large number of small accounts per company**: a product requirement (scale and low cost per rep) rather than a revenue opportunity per se. [HY] This needs testing against how vendors actually price (per rep, per active rep, flat).
- **[VF]** The UAE channel is tiny ($31.7M) and Bangladesh is not reported separately (it sits inside "Other Asia/Pacific", $399M for the whole group). **A sales-based case for either market cannot be built from public data.** (See 51 for why Bangladesh is a legal question first.)
- **[UV]** The UK's 331,011 reps was parsed from the PDF text; recheck against the source table because the ratio ($3,538) is an outlier.
- **[UV]** The UAE rep count in the extracted text looked anomalous and is not cited.

### 2.1 Run output (reproducibility)

```
Global: $163,863M, 104,338,049 reps -> $1,571 retail sales per rep contract
US per person, 12.18M contract signers: $2,852   |   5.4M "actively engaged": $6,433
2023 global as first published $167,694M vs restated $163,937M: -2.24%
Global 2021->2024 CAGR check: -1.22% (report says -1.2%)
Asia/Pacific rep components sum to 62,342,268 (report total 62,342,268)
```

---

## 3. The United States: three different "seller" numbers

| Measure (2024) | Value | Source | Definition |
|---|---|---|---|
| People who signed or renewed an independent contractor agreement | 12.2M | S-004 | Includes people not actively selling |
| "Actively engaged" in building a direct selling business | 5.4M (44% of 12.2M) | S-004, S-005 | A subset |
| Preferred customers and discount buyers | 34.3M | S-003 | Buy for own use or discount |

Retail sales per person is $2,852 on the first basis and $6,433 on the second: **a 2.3x difference caused only by definition.** Any model that sizes revenue per seller must say which denominator it uses.

For 2022 the DSA reported $40.5B, 6.7M direct sellers and 41M customers (S-006; the article does not define "direct seller"), so the **2022 and 2024 seller counts are not necessarily comparable**.

The 2024 figures are repeated by trade press (S-007). A vendor blog (S-008, Grade C) claims 2025 US data of $34.2B, 5.2M sellers, 34.8M customers. **It is not corroborated by an A/B source and is not used.** [UV]

---

## 4. Discrepancy log

Every conflict found while collecting data, with the treatment used.

| ID | Conflict | Treatment | Status |
|---|---|---|---|
| D-1 | 2023 global sales: $167,694M (S-002, constant 2023 USD) vs $163,937M (S-001, constant 2024 USD per our reading) | Use S-001 series throughout; note restatement; do not mix reports | Cause **[UV]**; ask WFDSA |
| D-2 | S-001 narrative swaps the Thailand and Indonesia dollar figures | Data table is correct (Thailand $1,980M, Indonesia $1,092M), checked against local-currency values | Resolved |
| D-3 | US "sellers": 12.2M vs 5.4M vs 34.3M customers; 2022's 6.7M is undefined | Always label the denominator | Resolved as definitional |
| D-4 | **Malaysia:** Bernama (10 Mar 2025, S-014) reports RM34.4B for 2024 (+7.4% from RM32.04B) and penetration 2.28%; WFDSA (S-001) shows $10,197M, whose local-currency column reads **46,667 million** (S-001 pp. 43 and 47; the report does not label the currency, but the row is Malaysia), penetration 2.417% and 2024 growth +2.1% in USD. Bernama also describes Malaysia as the world's sixth-largest market, while S-001 ranks it **fifth** for 2024 | Use WFDSA for cross-market comparison; **do not mix** with the Bernama figure. The two RM figures differ by 1.36x (46,667 vs 34,400); the implied RM/USD if both measured the same thing would be 3.37 (not a real exchange rate), so they measure different scopes or years | Cause **[UV]**; ask KPDN/MDSA/WFDSA |
| D-5 | Vendor blog (S-008) claims US 2025 data | Excluded | [UV] until DSA publishes |
| D-6 | DSEF report S-005 running headers say "…IN 2022" while the body uses 2024 data | Body used; flagged | Resolved as a typo in the source |
| D-7 | A statistics summary (Statista, S-013) says "almost $4B decline" using the old 2023 figure | Not used | Resolved by D-1 |
| D-8 | Paid market reports (IBISWorld, Euromonitor, market.us) inaccessible | Not cited | Limitation |

---

## 4a. What was *not* found

- No published count of direct-selling companies for any target market other than the TINA list of 660+ in the US (S-009; 2021; advocacy source). Do not confuse it with TINA's separate public list of 97 MLMs that consumers asked it to investigate (S-010).
- No independent analyst estimate of MLM/direct-selling software revenue.
- No vendor revenue, customer-count or pricing data except directory-listed entry prices (Grade C).
- No data on willingness to pay, platform switching frequency, or the share of companies on in-house systems.

---

## 5. Software market sizing: method and status (TAM, SAM, SOM)

**Unit of analysis.** The buyer is the direct-selling company. Revenue for a vendor comes from the companies, so:

- **TAM (software)** = Σ over markets of (number of direct-selling companies × annual platform spend per company), plus any revenue linked to payouts or transactions if the pricing model includes it.
- **SAM** = the part of TAM in markets we can serve legally and operationally, in company segments we can serve (S1–S5 in 01 §4), and that is **not locked into in-house systems** or long contracts.
- **SOM** = the share we could win in a stated time, limited by sales capacity, product readiness and incumbents.

### 5.1 Inputs: found vs missing

| Input | Found? | Value / evidence | Grade | Gap |
|---|---|---|---|---|
| Companies per market, US | Partial | "More than 660" direct selling companies operating in the US (S-009; 2021) | B (advocacy list) | Scope unclear; includes small firms? Source of the list not seen |
| Companies per market, Malaysia | Partial | 45 licences presented on one occasion (18 new, 27 renewals) (S-014) | B | That is a ceremony count, **not** the number of licensed firms; KPDN register needed |
| Companies per market, India, UK, EU, SEA, UAE | No | | | Regulator registers, DSA member lists (IU-1) |
| Annual platform spend per company | Anchors only | Entry listings: MarketPowerPRO from $499/month; ByDesign "Freedom" from $2,500/month (directories, accessed 2026-11-11) | C | Entry price ≠ typical contract; enterprise contracts unknown |
| Share on in-house vs vendor platforms | No | | | IU-3 |
| Vendor switching frequency | No | | | IU-2 |
| Willingness to pay for AI, compliance, mobile modules | No | | | Primary research (none done) |

### 5.2 Arithmetic on public anchors (not a market size, not a forecast)

| Anchor (Grade C, directories) | Annualized entry price | Customers needed per $1M annual revenue at that price |
|---|---|---|
| $499 / month (MarketPowerPRO listing) | $5,988 | 167 |
| $2,500 / month (ByDesign "Freedom" listing) | $30,000 | 33 |

**What this does and does not show.** It shows that at directory entry prices a software business needs **tens to low hundreds of paying customers per $1M of revenue**, which is a **small-customer-count business**. It does not show that such revenue is attainable, what customers actually pay, or what it costs us to serve them. Using it for a forecast is not permitted without labeled assumptions in R-16.

### 5.3 Next steps to close the sizing (Wave 2)

1. Build a **bottom-up company list** from regulator registers and DSA member directories for Malaysia, India, the US, UK and one EU country, and report counts with scope notes.
2. Capture **public pricing pages** with dates (not directory summaries) for each vendor and record whether price is per rep, per active rep, flat or percentage of volume.
3. Count **platform-switching signals** (migration case studies, acquisition announcements, job postings for in-house build).
4. Define the S1–S5 segments and assign each a company count range with evidence, or leave as [UV].
5. Only then define SAM filters and three scenarios in R-16 using **labeled assumptions**.

---

## 6. Preliminary market screen (qualitative, provisional)

This is **not** the weighted scoring promised in the Master Plan §10; that needs evidence on willingness to pay, localization cost and payment constraints that has not been gathered. This screen lists what the evidence supports so far and what blocks a score. Stance labels are [SR] and provisional.

| Market | Channel size/trend (S-001) | Legal frame (see 51; screening-grade) | Main blockers or unknowns | Provisional stance |
|---|---|---|---|---|
| United States | Largest; falling | MLM lawful; FTC guidance, no safe harbor | Incumbents entrenched (DirectScale/Exigo, ByDesign, InfoTrax, Jenkon); mature | **Candidate** (largest customer pool; hardest competition) |
| Malaysia | Highest penetration; growing | Licence under Act 500; Malaysian-incorporated company; amendments in progress | Local licensing, local language/payments; conflicting size data (D-4) | **Candidate** |
| India | $3.5B; growing; 8.8M reps | Direct Selling Rules 2021 (physical office, KYC, data stored in India, grievance officer) | Data localization; many small accounts; price sensitivity | **Candidate** |
| United Kingdom | Small, declining (−10.5% CAGR) | Lawful; CPRs replaced by DMCCA 2024 | Small market; but HQ for some brands | **Watch** |
| EU (Germany first) | Germany $19.1B; EU-27 $31.3B | UCPD bans pyramid schemes; national rules vary | Member-state specifics not yet researched | **Watch** (research needed) |
| Vietnam | $0.9B; falling | Decree 40/2018 licence; **IT system with in-country server** | Data residency; small market | **Watch** |
| Thailand | $2.0B; falling | OCPB registration; compensation-plan review | Declining; draft capital rules [UV] | **Watch** |
| Indonesia | $1.1B; −11.3% | SIUPL licence; PP 3/2026 tightening | Declining; marketplace restrictions | **Watch** |
| Philippines | $0.9B; −11.4% | No dedicated law; voluntary DTI seal | Declining; informal market | **Watch** |
| Singapore | $0.4B; flat | MLM generally prohibited; exclusion order for legitimate schemes | Narrow lawful set [UV] | **Do not enter yet** |
| UAE | $31.7M | Conflicting evidence on licensing | Tiny retail market; may be an HQ hub for risky operators | **Do not enter yet** (as a market); revisit as HQ location |
| Bangladesh | Not reported | 2013 Act requires licence; ministry says no legal MLM companies; e-commerce bar | Legal blocker for MLM operators | **Do not target MLM operators** (see 51 §3.2) |

---

## 7. Implications and limits [SR]

1. **Do not plan on market growth.** Plan on switching, new-company formation, and compliance-driven demand in selected markets. Test each in Wave 2–3.
2. **Malaysia and India deserve deep research first.** They are the two target markets (of the nine tabulated) where the channel is growing materially and a lawful framework exists. Both impose **local-presence and data-handling requirements** that change product scope.
3. **Treat the retail-sales pie as context, not as revenue.** Do not multiply "retail sales × a percentage" to size the software market; there is no evidence for the percentage.
4. **Next gate (G2)** needs company counts, public pricing, and wallet/payout feasibility (R-39); none is complete.
