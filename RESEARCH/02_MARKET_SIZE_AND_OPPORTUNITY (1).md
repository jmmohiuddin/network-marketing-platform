# 02 — MARKET SIZE AND OPPORTUNITY
## What the evidence says about channel size, and what is still unknown about the software market

| Field | Value |
|---|---|
| Document ID | 02_MARKET_SIZE_AND_OPPORTUNITY |
| Version | 0.2 (Wave 2: company counts, price captures, national-vs-WFDSA gap; **still no TAM/SAM/SOM point estimate, deliberately**) |
| Date | 2026-11-11 |
| Research IDs | R-02; inputs to R-16 (financial feasibility), R-35 (market selection) |
| Calculations | `02_market_calcs.py` (inputs copied from S-001 and the Wave 2 sources; run output reproduced below) |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV] (see Master Plan §5.1) |

## 0. Summary

1. **The channel is large but flat-to-shrinking.** Global direct-selling retail sales were $163.9B in 2024 (−0.05% on 2023) across 104.3M contract-signing reps [VF] (S-001). US sales fell from $40.5B (2022) to $34.7B (2024) [VF] (S-006, S-003).
2. **Markets are diverging.** Malaysia (+2.1% in 2024; 9.0% 3-year CAGR) and India (+4.0%; 7.0%) grew while the US (−5.2%), Thailand (−7.1%), Indonesia (−11.3%) and the Philippines (−11.4%) fell [VF] (S-001).
3. **Retail sales are not the market for software.** The software market is the number of direct-selling companies multiplied by what each pays for a platform. **Wave 2 found three company counts**: more than 660 in the US (advocacy list, 2021, S-009), about 400 licensed in Malaysia (minister, 2023, S-082) and 461+ registered in India (Department of Consumer Affairs, 2025, quoted by a law-firm page, S-083). They use different definitions and years and are **not a census**. UK, EU and other counts were not found.
4. **Prices are widely dispersed and mostly hidden.** Of seven vendor sites read, only **Infinite MLM** shows prices (one-time licence: $699 Basic, $5,399 Standard, S-096). Directory listings show Exigo "Basic" at **$5,000 per month flat** (S-097), ByDesign "Freedom" from **$2,500** (S-098) and MarketPowerPRO from **$499 per feature** (S-099). No per-rep or percentage-of-volume price was found on any page read.
5. **A national-source gap.** WFDSA's India and Malaysia figures are about **1.3x higher** than the national sources in local currency (§2.2). WFDSA states its figures are at "Estimated Retail level", so national figures may be measured differently. Software sizing should start from company counts, not from either retail series.
6. **No market-size number for the software is stated in this document.** §5 gives the method, the inputs found, and one clearly labeled piece of arithmetic (companies × displayed prices) that shows the order of magnitude without estimating the market.
7. **Gate G2: not passed, and partly not assessable.** The payout-architecture criterion is met at screening grade (51 §5: instruct payouts through providers rather than hold funds; top-end competitors integrate third-party payout providers, though who holds funds and under which licence is not stated). The "SAM large enough" criterion needs the founder's threshold (OQ-04). The "under-served segment" criterion has hypotheses only (05). See §7.

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
- **[RB, re-read in Wave 2]** The UK row (916M local currency, $1,171M, 331,011 reps; S-001 p. 44) was re-read; values are matched by row position because the extracted text lacks row labels, and the neighbouring Rest-of-Europe rep values sum consistently. The $3,538 per rep is an outlier but is arithmetic on those inputs (see D-13).
- **[UV]** The UAE rep count in the extracted text looked anomalous and is not cited.

### 2.1 Run output (reproducibility)

```
Global: $163,863M, 104,338,049 reps -> $1,571 retail sales per rep contract
US per person, 12.18M contract signers: $2,852   |   5.4M "actively engaged": $6,433
2023 global as first published $167,694M vs restated $163,937M: -2.24%
Global 2021->2024 CAGR check: -1.22% (report says -1.2%)
Asia/Pacific rep components sum to 62,342,268 (report total 62,342,268)
```

### 2.2 WFDSA figures vs national-association figures (Wave 2)

WFDSA states (S-001 p. 44) that its sales figures "are expressed at Estimated Retail level and exclude Value Added Tax", that "country figures are for the entire industry and are based on research by national direct selling associations", and that 2023–24 are in "US Constant 2024 Dollars" at IMF average annual exchange rates. The report does **not** say whether "retail" is measured against wholesale value, nor whether years are fiscal or calendar.

| Market | WFDSA 2024 (local currency, S-001) | National source | Ratio | Notes |
|---|---|---|---|---|
| India | 295,193 million, read as INR = **Rs 29,519 crore** (p. 47; currency not printed) | IDSA/Ipsos: Rs **22,142 crore** FY2023-24; Rs **23,021 crore** FY2024-25 (S-081) | **1.33x** (FY24), **1.28x** (FY25) | Indian fiscal year runs April–March; WFDSA is a calendar year. Growth matches (+4%). **Seller counts match exactly**: WFDSA 8,806,000 vs IDSA 88 lakh |
| Malaysia | **46,667 million** (pp. 43, 47) | Bernama 10 Mar 2025: **RM34.4 billion** for 2024 (S-014) | **1.36x** | Same year; no FX involved |

**Reading [RB for the gap; HY for the cause].** In two independent markets the national figure is 25–35% below WFDSA's, while rep counts and growth agree. A plausible but **untested** cause is a difference in the price level measured (retail value vs company turnover). WFDSA's own footnote supports the "retail level" side only. **Validation:** ask WFDSA and the national associations for definitions. **Why it matters:** a software vendor's addressable revenue relates to **company** revenue and company counts, so using retail series would overstate any percentage-of-sales view by up to about a third.

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
| D-9 | **India:** WFDSA Rs 29,519 crore (2024) vs IDSA Rs 22,142 crore (FY24) and Rs 23,021 crore (FY25) | See §2.2; use company counts for sizing | Cause [UV]; matches D-4's ~1.3x pattern |
| D-10 | **Malaysia rank:** Bernama (10 Mar 2025) says sixth-largest worldwide; S-001 ranks Malaysia fifth for 2024 | Use S-001 (2024 table, p. 13/43) | Likely a different year range; [UV] |
| D-11 | **Malaysia 2021:** minister cited "more than RM27 billion" for 2021 (S-082) | Not mixed with WFDSA; a further national-series point that does not reconcile with S-001's 3-year CAGR without definitions | [UV] |
| D-12 | **WFDSA 2023 restatement** (D-1): S-001 footnote says 2023–24 are in "US Constant 2024 Dollars", but does not name the earlier report's basis or reconcile $167,694M | Treated as a constant-dollar rebasing (consistent with the footnote); **not confirmed** | Partly resolved; confirm with WFDSA |
| D-13 | **UK figures** (carried from Wave 1): re-read in Wave 2 (S-001 p. 44): UK local-currency sales 916M, USD 1,171M, 331,011 reps, matched by row position because the extracted text has no row labels (the Rest-of-Europe rep values sum consistently). **Financial-services (~5%) and utilities (~4%) category shares remain unverified**: the chart text does not pair values with labels | UK row usable at [RB]; **category shares stay [UV-read]** and are not cited | UK partly resolved; category shares open |

---

## 4a. What was *not* found

- Company counts exist only for three markets (US 660+, Malaysia about 400, India 461+; §5.1) and each uses a different definition and year. None was found for the UK, Germany/EU, Vietnam, Thailand, Indonesia or the Philippines. (The DSA US member directory shows no total, and searches for the UK DSA and Germany's association returned none.) Do not confuse the 660+ list (S-009) with TINA's separate list of 97 MLMs that consumers asked it to investigate (S-010).
- No independent analyst estimate of MLM/direct-selling software revenue.
- No vendor revenue. Customer counts are **vendor claims only** (Epixel 450+, Infinite 3,000+, ByDesign nearly 1,000 client launches, Exigo 100+ brands) and cannot be reconciled with each other.
- Prices: see §5.2. Only one vendor displays prices on its own site.
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
| Companies, US | Partial | "More than 660" direct selling companies operating in the US (S-009; TINA.org list to the FTC, 30 Jun 2021) | B (advocacy list) | Scope unclear; list itself not seen; 5 years old |
| Companies, Malaysia | Partial | **About 400 licensed**, 18% foreign (Minister, 29 Mar 2023, S-082). Separately, 45 licences were presented on 10 Mar 2025 (18 new, 27 renewals; S-014), which is a ceremony count, not the total | B | Date is 3.5 years old; KPDN register not seen |
| Companies, India | Partial | **461+ registered direct selling entities** per the Department of Consumer Affairs, 2025 (quoted by S-083) | B (secondary quote) | Primary source not seen |
| Companies, UK, EU, Vietnam, Thailand, Indonesia, Philippines | No | | | Regulator registers, DSA member lists (IU-1) |
| Annual platform spend per company | Anchors only | See §5.2: Exigo listing $5,000 flat/month; ByDesign from $2,500; MarketPowerPRO from $499 per feature; Infinite one-time $699 / $5,399 (own site) | C (directories) / C (vendor site) | Entry price ≠ typical contract; enterprise contracts unknown; **no per-rep or %-of-volume price seen** |
| Share on in-house vs vendor platforms | No | | | IU-3 |
| Vendor switching frequency | No | | | IU-2 |
| Willingness to pay for AI, compliance, mobile modules | No | | | Primary research (none done) |

### 5.2 Prices seen and arithmetic (not a market size, not a forecast)

**Displayed prices, captured 2026-11-11.** All are Grade C. Directory prices are summaries by the directory, not offers.

| Vendor | Displayed price | Model | Source |
|---|---|---|---|
| Infinite MLM Software | Basic **$699**; Standard **$5,399**; Enterprise quoted; add-ons extra | **One-time licence**, "not a SaaS subscription" (currency shown only as "$") | S-096 (vendor site) |
| Exigo | "Basic" **$5,000 per month**, flat | Flat monthly (directory listing updated 29 Sep 2026) | S-097 |
| ByDesign "Freedom" | From **$2,500** (monthly per directory convention; unit not stated on the page read) | Contact vendor | S-098 |
| MarketPowerPRO | From **$499 per feature**; Starter / Professional / Enterprise / International plans | Per-feature | S-099 |
| DirectScale, InfoTrax, Jenkon, Epixel | None displayed | Demo/quote | S-090, S-093, S-094, S-095 |

**Illustration: what the displayed prices imply if every company found paid that price.** This multiplies the **sum of the three company counts as quoted (1,521)** by annualized displayed prices. It **assumes every company buys, ignores enterprise-contract values and one-time-licence economics, and mixes definitions and years.** It is an order-of-magnitude bound for three markets only, not an estimate.

| Price level used | Annualized | × 1,521 companies | Customers needed per $1M of annual revenue |
|---|---|---|---|
| $499 per month (MarketPowerPRO, one feature) | $5,988 | $9.1M | 167 |
| $2,500 per month (ByDesign) | $30,000 | $45.6M | 33 |
| $5,000 per month (Exigo Basic) | $60,000 | $91.3M | 17 |

**What this does and does not show.**
- **[SR, labeled]** At displayed price levels, the **software spend by every company in the US, Malaysia and India combined is in the tens of millions of dollars per year**, so this is a **niche, small-customer-count business**. Whether that is enough depends on the founder's ambition and costs (OQ-04), which have not been supplied.
- It does **not** show attainable revenue, true contract values (enterprise deals may be several times a "Basic" price), adoption share, or switching rates. A forecast needs labeled assumptions in R-16.
- Revenue linked to **payouts, transactions or percentage of volume** is not in this arithmetic because no vendor displays such pricing. Whether such pricing exists in contracts is [UV].

### 5.3 Status of the sizing steps and what remains

| Step | Status after Wave 2 |
|---|---|
| Bottom-up company counts: US, Malaysia, India, UK, one EU country | **Partly done** (US, Malaysia, India); UK and EU not found |
| Public pricing pages with dates | **Done for 7 vendor sites** (one shows prices); directory prices for 3 more |
| Platform-switching signals | **Partly**: vendor-authored migration content exists (Exigo blog series, S-091 context); DirectScale describes its target as companies "moving off an in-house system" (S-090). No independent measure |
| S1–S5 segment counts | Not done (needs the company lists with revenue/size) |
| Scenarios | Deferred to R-16; needs OQ-04 |

**Still required:** obtain the KPDN licensee list and the Indian registry of direct selling entities (primary), a Germany/UK association count, and interview-based contract values (V-01).

---

## 6. Preliminary market screen (qualitative, provisional)

This is **not** the weighted scoring promised in the Master Plan §10; that needs evidence on willingness to pay, localization cost and payment constraints that has not been gathered. This screen lists what the evidence supports so far and what blocks a score. Stance labels are [SR] and provisional.

| Market | Channel size/trend (S-001) | Legal frame (see 51; screening-grade) | Main blockers or unknowns | Provisional stance |
|---|---|---|---|---|
| United States | Largest; falling | MLM lawful; FTC guidance, no safe harbor | Incumbents entrenched (DirectScale/Exigo, ByDesign, InfoTrax, Jenkon); mature | **Candidate** (largest customer pool; hardest competition) |
| Malaysia | Fifth-largest market; highest penetration; growing (+9.0% CAGR); **about 400 licensed companies, 18% foreign** | Licence under Act 500; **licence application requires a sample sales contract, a buy-back policy, a price structure and marketing-plan amendment filings** (S-043); amendments in progress | Local licensing and filings; conflicting size data (D-4); Act's text not yet read | **Candidate (priority)** |
| India | WFDSA $3.5B; IDSA Rs 23,021 crore (FY25, +4%); 93.2 lakh sellers; **461+ registered entities** | Direct Selling Rules 2021: contract, registered office, website disclosures, grievance officer, data kept in India, seller records and delisted-seller list (S-083, S-085) | Data localization; many low-spend accounts; price sensitivity; Rules' text not yet read | **Candidate (priority)** |
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
4. **Gate G2 assessment (Wave 2): not passed; partly not assessable.**

| G2 criterion (Roadmap §5) | Result | Evidence |
|---|---|---|
| SAM large enough for the business case in the moderate scenario (threshold set in the financial model) | **Cannot be assessed**: no threshold exists (OQ-04). Order of magnitude: tens of millions of dollars per year if every company in three markets bought at displayed price levels (§5.2) | §5.2 |
| At least one under-served segment | **Hypotheses only**, none proven; see 05 | 05 |
| Feasible payout architecture identified | **Met at screening grade**: instruct payouts through providers rather than hold funds; top-end competitors integrate third-party payout providers (licensing basis not stated); counsel unconfirmed | 51 §5 |

**Shortlist for the next wave [SR, provisional]:** deep research on **Malaysia** and **India**, then the **US** for competitive reasons. **Do not enter yet:** Singapore, UAE (as a market), Bangladesh MLM operators.

**What would change the assessment:** (a) a founder-supplied revenue/cost threshold; (b) interview-based contract values and switching intent (V-01, V-07); (c) the KPDN and Indian entity lists with company sizes.
