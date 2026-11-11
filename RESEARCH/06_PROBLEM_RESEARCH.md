# 06 — PROBLEM RESEARCH
## Eighteen candidate problems in direct-selling operations, with the evidence for each and what is still unknown

| Field | Value |
|---|---|
| Document ID | 06_PROBLEM_RESEARCH |
| Version | 0.1 (Wave 3) |
| Date | 2026-11-11 |
| Research IDs | R-04 company management · R-05 distributors · R-06 team leaders · R-07 customers · R-08 finance and operations · R-09 technology |
| Companion | 07_PROBLEM_SEVERITY_MATRIX.md (ratings, opportunity view, gate G3 test) |
| Sources | `S-xxx` in 00_RESEARCH_SOURCE_REGISTER.md (Section E added in Wave 3) |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV]; source grades A/B/C |

## 0. Summary

1. **These are candidate problems, not validated ones.** The evidence is documents about direct-selling companies (regulator orders, two SEC filings, three employer job postings, one data-breach report, one consumer case, practitioner and law-firm commentary, one academic abstract, vendor content). **No distributor, team leader, customer, finance or compliance person was heard from.** The attempt to mine Reddit failed (the search proxy rejected the request) and was not retried.
2. **What the evidence does show:**
   - Operators employ people to run, audit and fix commission calculations, and some run them on old, specialist tools plus spreadsheets (S-130, S-131, S-132) [RB].
   - Regulators and courts ask direct sellers for **retail-sale evidence, earnings disclosures and audits** (S-020, S-120) [VF].
   - One distributor data breach is documented (S-133) [VF, trade press].
   - **Buy-back, cooling-off and autoship-cancellation duties exist** in law and practice (S-124, S-126, S-015) [SR].
3. **What it does not show:** how often any problem happens, what it costs, or that incumbent vendors leave it unsolved. **Commission-error frequency is unmeasured.** The only numbers on "leakage" come from vendors and are unsourced (S-138).
4. **Three problems rest on vendor content alone and are rated [UV]:** team-leader visibility (P-10), distributor mobile experience (P-09), and capacity or reporting access (P-17).
5. **Two problems carry a documented High consequence** under the strict rubric in 07 (P-04 distributor data breach; P-05 producing compliance evidence). Several more are High **if they occur** but have no documented occurrence or sanction in the sources read. 07 makes this split explicit and applies the gate test.
6. **Caution:** most of the problems below are problems **of a direct-selling business**, not problems a software product necessarily solves. P-06 (attrition and low earnings) is the clearest case: the evidence shows the outcome, not its cause, and software may not be the lever [HY].

## 1. Method, evidence classes and the rating rules

### 1.1 Evidence classes ("independent source types")

A problem counts one class once, however many pages sit in it. **Vendor content (V) is never counted** toward the two-class test, to avoid vendors grading their own category.

| Code | Class | Examples in this wave | Counts for the test |
|---|---|---|---|
| R | Regulator order or primary legal text | S-020, S-120, S-043, S-039, S-015 | Yes |
| F | Company filing or company disclosure | S-121, S-122, S-140 | Yes |
| J | Employer job posting | S-130, S-131, S-132 | Yes |
| I | Incident report or trade press | S-133 | Yes |
| K | Consumer or advocate case | S-134 | Yes |
| P | Practitioner or law-firm commentary | S-124, S-125, S-126, S-127 | Yes |
| A | Academic | S-135 (abstract only) | Yes |
| B | Buyer reviews on a software directory | S-097, S-098, S-099, S-100 | Yes, but weak: reviews are few, selected, and vendors reply |
| V | Vendor content | S-136, S-137, S-138, S-139, S-142, S-143, S-144, S-123 (tax-software vendor) | **No** |

### 1.2 Fields

Every record uses the twelve fields from the brief. **Frequency, financial impact and "existing software" are marked [UV] unless a source states them.** Where a field says "Not evidenced", no source read in Waves 1 to 3 speaks to it.

### 1.3 Reading limits that apply to every record

- Pages in Wave 3 were fetched and **questioned for specific facts**, not read end to end. Both 10-Ks were read as excerpts (the first 200,000 characters of about 600,000 each).
- Job postings show **what an employer wants staff to do**, not how often something goes wrong.
- Several practitioner and vendor pages are **undated or old** (S-124, S-125, S-141); they are used for structure, not for current law.
- Law summaries are **screening-grade** (A-07). Counsel has not reviewed them.

## 2. Problem records

### P-01 — Legacy and manual commission tooling [R-08, R-09]

| Field | Record |
|---|---|
| **Problem ID** | P-01 |
| **User affected** | Finance Manager, Operations Manager (commission analysts), Super Admin / IT |
| **Current workflow** | Weekly and monthly commission runs with data clean-up before and after the run, audit procedures, test scenarios and reconciliation (S-130, S-131). One employer requires **Pick/jBase (MultiValue)**, VBA macros, advanced Excel and Visio (S-130). Payments and adjustments are partly manual; commission cheques are printed, folded and mailed globally (S-132) [RB] |
| **Root cause** | [IP] Long-lived platforms built around the first plan, extended by scripts and spreadsheets. **No source states the cause** |
| **Frequency** | Not evidenced. Three postings at two large companies show the work exists; they do not show how often it fails |
| **Severity** | **Medium** under the 07 rubric (recurring staff cost and delay documented by postings). Consequence if the platform fails: High (Herbalife lists IT dependence as a risk that "could impair our ability to track sales and pay compensation", S-121) [VF for the risk statement; no incident described] |
| **Business impact** | Staff time on checks and rework; dependence on rare skills; slower plan changes (P-02) [IP] |
| **Financial impact** | Not measurable from sources. Vendor claims of 1 to 3 percent "leakage" are unsourced (S-138) and are **not used** |
| **Workarounds** | Manual exception requests under a standard procedure (S-132); macros and spreadsheets (S-130); regression testing before changes (S-131) |
| **Existing software** | Employer postings name DataTrax, SAP, a CRM and Pick/jBase (S-130, S-131, S-132). Vendor platforms exist (03). **Whether they solve this for these employers is unknown** |
| **Evidence** | **J** (S-130, S-131, S-132), **F** (S-121); vendor: S-136 (not counted) |
| **Opportunities** | [HY] A calculation engine with test scenarios, reconciliation and exception queues built in. **Falsifier:** operators say the legacy engine works and change cost is the only issue (then P-02, not P-01) |

### P-02 — Cost and speed of changing the compensation plan [R-04, R-09]

| Field | Record |
|---|---|
| **Problem ID** | P-02 |
| **User affected** | Company Owner, CEO, Operations Manager, Finance Manager |
| **Current workflow** | Plan changes are specified, built, regression-tested and rolled out; one posting names a "compensation plan change initiative" with regression testing (S-131) and another supports "changes to compensation structures" (S-130). On vendor platforms, reviewers describe **paid customization**, **changes only via tickets**, and **extra charges after contract** (S-097, S-099, S-100) |
| **Root cause** | [IP] Plans encoded in code or vendor configuration that only the vendor or specialists can edit |
| **Frequency** | Not evidenced. Three of four directory pages (small, selected samples) mention cost or ticket friction |
| **Severity** | **Medium** (recurring cost and delay) |
| **Business impact** | Slower launches of promotions and market-specific plans. Nu Skin's filing lists **compensation-plan changes** as a risk heading (S-122) [VF for the heading; consequences not read] |
| **Financial impact** | Not measurable from sources |
| **Workarounds** | Pay the vendor; keep a backlog; run parallel spreadsheets |
| **Existing software** | ByDesign reviewers praise "customization without custom programming" (S-098), so some vendors may already serve this. Configurability by non-programmers is **claimed, not tested**, anywhere in 03 |
| **Evidence** | **B** (S-097, S-099, S-100), **J** (S-130, S-131), **F** (S-122); vendor: S-136 "plan changes waiting in vendor queue" (not counted) |
| **Opportunities** | [HY] Self-service, versioned plan configuration with simulation (H-4 in 05). **Falsifier:** operators report that changes are rare or cheap |

### P-03 — Operating in several markets at once [R-04, R-08]

| Field | Record |
|---|---|
| **Problem ID** | P-03 |
| **User affected** | Country Manager, Compliance Officer, Finance Manager, Company Owner |
| **Current workflow** | Posting duties include "consistency across markets" and global tax reporting (S-130) and new-market launch projects (S-131). Herbalife operates in **95 markets** (S-121). Nu Skin states **compensation caps of 30% (Mainland China) and 35% (South Korea)** (S-122; legal basis not stated in the excerpt read [UV]). Malaysia's licence application needs a sample sales contract, buy-back policy and plan-amendment filings (S-043); India imposes seller records, a grievance officer and in-country data (S-083, S-085, S-039) |
| **Root cause** | [RB] Rules, taxes, currencies and consumer duties differ by market; plans and systems are usually designed for one |
| **Frequency** | Structural: every multi-market operator faces it. How often it **fails** is not evidenced |
| **Severity** | **Medium** by the rubric (no sanction for a multi-market failure is documented in the sources read). High if it occurs in a licensed market [HY]. A documented sanction exists only for Bangladesh, where operating without a licence carries up to 10 years' imprisonment (S-032; Bangladesh is out of scope, OQ-02) |
| **Business impact** | Launch delay; licence and filing work; per-market plan variants (see P-02) |
| **Financial impact** | Not measurable |
| **Workarounds** | Separate instances per country (vendor-described, S-136); local counsel; manual filings |
| **Existing software** | **0 of 8 vendors state any per-market compliance capability** (04 §2); this is silence on marketing pages, not proof of absence (A-10). Local vendors in Malaysia and India **not searched** (U-15) |
| **Evidence** | **F** (S-121, S-122), **J** (S-130, S-131), **R** (S-043, S-085, S-039); vendor: S-136 (not counted) |
| **Opportunities** | [HY] Per-market rule packs (CMP-06 to CMP-12, CMP-19) as configuration. **Falsifier:** local vendors already ship them, or operators handle them cheaply by hand |

### P-04 — Protecting distributor personal data [R-09]

| Field | Record |
|---|---|
| **Problem ID** | P-04 |
| **User affected** | Distributor (data subject), Super Admin, Compliance Officer, Company Owner |
| **Current workflow** | Platforms hold names, addresses, contacts, tax data and bank or payout details for large numbers of independent sellers. Herbalife reports **6.4M Members** (S-121); Nu Skin's affiliates and leaders are counted in the hundreds of thousands (S-122) |
| **Root cause** | [IP] Large personal-data stores, many integrations, credentials. **The cause of the Arbonne incident is not stated** (S-133 says "unusual activity in internal systems") |
| **Frequency** | **One documented incident** in the sources read (S-133, year not shown on the page); Herbalife says it has been "the target of" cyberattacks (S-121) [VF]. A rate cannot be derived |
| **Severity** | **High (documented):** personal-data breach. A data table with name, address, username and password **may have been accessed**; **3,527 California residents** were notified; the matter was reported to the FBI (S-133) |
| **Business impact** | Notification and credit-monitoring cost; regulator attention; trust loss [IP]. India's DPDP Act is named in the Herbalife risk factors and India requires data kept in India (S-121, S-039) |
| **Financial impact** | Not measurable from sources |
| **Workarounds** | Password reset, credit monitoring (S-133); in-country storage where required |
| **Existing software** | Vendors **claim** security certifications (for example ISO 27001, SOC 2, in S-096). **Claims are unverified** (A-10) |
| **Evidence** | **I** (S-133), **F** (S-121, S-122 risk headings), **R** (S-039) |
| **Opportunities** | This is a **must-meet obligation** for any platform and every vendor claims it; it is **unlikely to be a differentiator** [IP]. Design implications go to the security documents (Wave 5) |

### P-05 — Producing compliance evidence on demand [R-04, R-08]

| Field | Record |
|---|---|
| **Problem ID** | P-05 |
| **User affected** | Compliance Officer, Finance Manager, Company Owner, CEO; external counsel and auditors |
| **Current workflow** | Regulators and counsel ask for retail-sale data, qualification rules, payout attribution and earnings disclosures. The FTC order against Herbalife requires retail-sale data collected **"in a standardized format"** (payment method, products, date, price, purchaser, contact), **random and targeted audits**, independent compliance-auditor reports, and limits on earnings claims (S-120). FTC guidance says earnings claims must reflect the typical participant (S-020). Nu Skin lists an FTC proposed rule on deceptive earnings claims among its risks (S-122). Young Living publishes an income disclosure by rank (S-140). Posting S-131 lists audit and fraud-research duties |
| **Root cause** | [RB] Regulators judge on compensation incentives and documentation; the evidence must be assembled from order, plan and payout data |
| **Frequency** | Not evidenced for routine requests. The FTC order is **one** case; other enforcement cases are in 51 |
| **Severity** | **High (documented):** legal sanction. The order is a stipulated judgment with a monetary component, a compensation cap if the retail ratio falls under 80% (41.75% of rewardable sales), and an independent auditor (S-120) [VF]. **Caveat:** the order binds Herbalife only and punished company conduct, not a software gap |
| **Business impact** | Legal exposure, audit cost, constraints on plan design [RB] |
| **Financial impact** | Not measurable here (see 51 for the order's terms) |
| **Workarounds** | Counsel-led audits; spreadsheets; manual reports [HY; not evidenced] |
| **Existing software** | 0 of 8 vendors state CMP-01 to CMP-12 capabilities (04 §2); **silence is weak evidence**. Whether counsel and finance teams already produce this cheaply is unknown |
| **Evidence** | **R** (S-020, S-120), **F** (S-121, S-122, S-140), **J** (S-131) |
| **Opportunities** | [HY] CMP-01 to CMP-05 as built-in reports (51). **Falsifier:** counsel say the evidence comes from existing reports without effort, or no buyer pays for it. **Risk:** a tool that helps document a plan can also help dress up an unlawful one (challenge C6, Q-1) |

### P-06 — Distributor attrition and low earnings [R-05]

| Field | Record |
|---|---|
| **Problem ID** | P-06 |
| **User affected** | Distributor, Team Leader, Sponsor, Company Owner |
| **Current workflow** | Most participants earn little. Young Living's own 2023 statement (calendar year 2022): **64.1% of Brand Partners** highest rank Associate, **average $22, median $0**; all Brand Partners **average $881, median $23**; "potential gross income" before expenses; no count of those earning $0 (S-140) [VF as company statement]. Herbalife counts about **750,000 sales leaders** among 6.4M Members (S-121) |
| **Root cause** | **Unknown.** An academic study of 13,000+ distributors found few join for personal consumption alone, joining reasons are often replaced by other reasons for staying, and **no link between joining reasons and leaving**; the abstract gives **no attrition rates** (S-135) [VF for the abstract]. The causes of leaving are not stated in any source read |
| **Frequency** | Net counts at Nu Skin, Q4 2025 vs a year earlier: customers 748,796 vs 831,972 (**−10.0%**), paid affiliates 129,311 vs 144,874 (**−10.7%**), sales leaders 30,045 vs 36,912 (**−18.6%**) (S-122) [RB; **net change, not attrition**; one company; reasons not read] |
| **Severity** | **Medium** as a business problem for the operator. **Whether software can address it is [UV]** |
| **Business impact** | Lost leaders and volume; replacement recruiting cost [IP] |
| **Financial impact** | Not measurable. Vendor "retention" figures (S-139) have no stated method and are **not used** |
| **Workarounds** | Training, incentives, onboarding programs (not researched) |
| **Existing software** | Vendors advertise engagement and training modules (03); effect on retention **unevidenced** |
| **Evidence** | **F** (S-121, S-122, S-140), **A** (S-135) |
| **Opportunities** | Hold as **[UV]**. **Ethical caution [IP]:** earnings data show most participants earn little; a product must not market itself as raising distributor income. Interview design (R-37) must ask why distributors leave |

### P-07 — Plan and rank complexity [R-05, R-08]

| Field | Record |
|---|---|
| **Problem ID** | P-07 |
| **User affected** | Distributor, Team Leader, Customer Support Agent, Finance Manager |
| **Current workflow** | Plans combine retail commission, fast start, unilevel levels, rank-based bonuses, generation bonuses and profit pools. Young Living's 2015–2019 plan (dated, S-141) shows **10 ranks** using personal, group and leg-limited volume, a 24% retail commission, fast-start with caps, three-level unilevel, a generational bonus and three profit pools |
| **Root cause** | [IP] Plans grow by accretion; each promotion adds rules |
| **Frequency** | Not evidenced |
| **Severity** | **Not rated:** no non-vendor source documents a consequence of complexity for distributors or support staff. A general (non-MLM) vendor blog ties disputes to unclear plan terms (S-144) [UV for MLM] |
| **Business impact** | [HY] Support load, disputes, mis-set expectations |
| **Financial impact** | Not measurable |
| **Workarounds** | Calculators, training material [HY] |
| **Existing software** | Vendors describe plan simulators and back-office views (03); quality unknown |
| **Evidence** | Plan structure only: **F** (S-140), **I** (S-141, a dated trade review), **P** (S-125). **No evidence of harm** |
| **Opportunities** | [HY] Plain-language plan statements and "why was I paid this" breakdowns (links to MH-REQ-09). **Falsifier:** distributors say they understand their statements |

### P-08 — Payout timing and visibility [R-08, R-05]

| Field | Record |
|---|---|
| **Problem ID** | P-08 |
| **User affected** | Distributor, Finance Manager, Customer Support Agent |
| **Current workflow** | Payment, adjustment and exception requests are handled manually under procedure; direct-deposit data is entered and reconciled by hand; cheques are printed and mailed globally (S-132). Vendors describe overnight batch runs and limited data access as warning signs (S-136, not counted) |
| **Root cause** | [IP] Batch calculation; manual payout steps; many payment methods and countries |
| **Frequency** | Not evidenced |
| **Severity** | **Medium for the operator** (recurring manual effort, S-132). **Distributor-side delay or confusion is [UV]**: no distributor voice exists in the evidence |
| **Business impact** | Support enquiries ("where is my commission?") [HY] |
| **Financial impact** | Not measurable |
| **Workarounds** | Manual payments, cheques |
| **Existing software** | Payout providers advertise global reach (S-114; vendor content). Local rails (UPI, DuitNow) **not evidenced either way** (H-6 in 05) |
| **Evidence** | **J** (S-132) only among counted classes |
| **Opportunities** | [HY] Statement-level visibility and instructed payouts (MH-REQ-01 to MH-REQ-10 in 51 §5.5). Needs interviews |

### P-09 — Distributor mobile experience [R-05, R-09] — **[UV]**

| Field | Record |
|---|---|
| **Problem ID** | P-09 |
| **User affected** | Distributor, Team Leader |
| **Current workflow** | Not evidenced. Vendors advertise mobile apps (04) |
| **Root cause** | Not evidenced |
| **Frequency** | Not evidenced |
| **Severity** | **Not rated** |
| **Business impact** | [HY] Engagement and ordering convenience |
| **Financial impact** | Not measurable |
| **Workarounds** | Not evidenced |
| **Existing software** | Several vendors list mobile apps; MarketPowerPRO reviewers praise distributor ease of use (S-099); a ByDesign reviewer notes the shopping cart lags Shopify-class carts (S-098) |
| **Evidence** | **B** weak only (S-098, S-099); vendor marketing (not counted) |
| **Opportunities** | None to claim. Interview and device-usage questions are in 66 Appendix A (V-03) |

### P-10 — Team-leader visibility and tooling [R-06] — **[UV]**

| Field | Record |
|---|---|
| **Problem ID** | P-10 |
| **User affected** | Team Leader, Sponsor |
| **Current workflow** | Not evidenced. The population exists at scale: Herbalife about **750,000 sales leaders** (S-121), Nu Skin **30,045** (S-122) |
| **Root cause** | Not evidenced |
| **Frequency** | Not evidenced |
| **Severity** | **Not rated** |
| **Business impact** | [HY] Leaders manage downlines in other tools (spreadsheets, chat) |
| **Financial impact** | Not measurable |
| **Workarounds** | Not evidenced |
| **Existing software** | Vendors list genealogy views and team dashboards (04); adequacy unknown |
| **Evidence** | Population only (**F**). **The need for tooling rests on vendor content alone (not counted)** |
| **Opportunities** | None to claim. **R-06 produced no problem evidence in Wave 3**; leader interviews are required |

### P-11 — Autoship, recurring orders and dispute friction [R-07]

| Field | Record |
|---|---|
| **Problem ID** | P-11 |
| **User affected** | Retail Customer, Distributor, Customer Support Agent, Compliance Officer |
| **Current workflow** | One consumer-advocate case (Rodan + Fields, 6 Apr 2022): a customer did not recognize a **$461** order; two card disputes were reversed; the website offered no way to start a return; cancelling a subscription was done through "manage subscription"; refunded after the advocate intervened (S-134) [VF for one case]. Law-firm commentary: the FTC proposed rule (23 Mar 2023) would require **separate consent** to recurring charges, disclosures before card entry, cancellation "just as easy" as sign-up, and **consent records kept for 3 years** (S-126). **Later history:** the Eighth Circuit vacated the click-to-cancel rule (July 2025, per law-firm alerts), the FTC restarted rulemaking, and ROSCA enforcement continues (S-127; **title and search result only; details not read**) [SR] |
| **Root cause** | [IP] Auto-renewing orders tied to consultants' accounts; weak consent records; hard-to-find cancellation. One case only |
| **Frequency** | Not evidenced (one case) |
| **Severity** | **Medium** documented (card disputes, customer harm). **Could be High** if ROSCA enforcement actions against direct sellers are read and show sanctions; **not read** |
| **Business impact** | Chargebacks, refunds, regulator attention [RB] |
| **Financial impact** | One order, $461 (S-134). No aggregate |
| **Workarounds** | Advocate or regulator complaint; card dispute (S-134) |
| **Existing software** | E-commerce modules exist in vendor platforms (04); **consent-record and cancellation features not stated** |
| **Evidence** | **K** (S-134), **P** (S-126, S-127) |
| **Opportunities** | [HY] Consent capture, cancellation parity and records (CMP-18, to be added to 51). **Falsifier:** operators already run these on their e-commerce platform |

### P-12 — Returns, buy-back and commission reversal [R-07, R-08]

| Field | Record |
|---|---|
| **Problem ID** | P-12 |
| **User affected** | Finance Manager, Customer Support Agent, Compliance Officer, Distributor, Retail Customer, Sponsor (upline) |
| **Current workflow** | A refund or buy-back must also reverse or adjust commissions and volume already credited up the line. **State buy-back statutes** (Maryland, Massachusetts, Wyoming, Louisiana, Georgia, Puerto Rico named) generally require about **90% of net cost**; the DSA ethics rule is 12 months at 90% for resalable inventory; upline commissions "may not be deducted from the refund"; **practice on charging commissions back varies** (S-124, undated, practitioner). Malaysia: a 10-working-day cooling-off period (S-015) and a **buy-back policy required in the licence application** (S-043). The Herbalife order imposes claw-back and corrective-action duties (S-120). Return rates: **about 0.1% of net sales** (Herbalife, S-121); **under 5% of revenue** (Nu Skin: 30 days full refund, 12 months with 10% restocking fee, S-122) |
| **Root cause** | [RB] Compensation is calculated on sales that can later be reversed; rules for reversal differ by market and plan |
| **Frequency** | Bounded by the return rates above (small share of sales). How often a reversal **goes wrong** is not evidenced |
| **Severity** | **Medium documented** (a legal duty exists; no sanction for a mishandled reversal is documented in the sources read). **High if it occurs** in a market with a statutory buy-back [HY] |
| **Business impact** | Over-payment of commissions after returns (vendor-listed leakage cause, S-138, not counted); disputes; legal duty breaches [IP] |
| **Financial impact** | Small relative to sales at the two public companies (above); not measurable for others |
| **Workarounds** | Manual adjustment and negative balances (worked example EX-8 in 13: a reversal can leave a **negative balance** whose treatment is a policy and legal question) |
| **Existing software** | Not stated for any vendor (04); S-132 shows manual adjustment procedures exist |
| **Evidence** | **P** (S-124), **R** (S-015, S-043, S-120), **F** (S-121, S-122) |
| **Opportunities** | [HY] Reversal engine with per-market buy-back and cooling-off rules (CMP-07; rules BR-REV-01 to BR-REV-06 in 15). **Falsifier:** operators handle reversals rarely and manually without loss |

### P-13 — Commission accuracy and exception effort [R-08]

| Field | Record |
|---|---|
| **Problem ID** | P-13 |
| **User affected** | Finance Manager, Operations Manager, Distributor, Customer Support Agent |
| **Current workflow** | Staff audit and test the system "to prevent discrepancies", run test scenarios and reconcile data (S-130); run pre- and post-run clean-up and audit procedures (S-131); handle manual payment, adjustment and exception requests (S-132) |
| **Root cause** | [IP] Complex rules, data quality, manual adjustments. Vendor-listed causes (promotions that do not expire or stack, extended rank qualifications, FX and fees, unapproved manual exceptions, S-138) are **unsourced** |
| **Frequency** | **Not evidenced.** No source gives an error rate. Wave 2 found **no commission-error complaint** on four directory pages (03 §6) |
| **Severity** | **Medium** (recurring effort documented). "Wrong pay at scale" is **not documented** |
| **Business impact** | Staff cost; disputes; trust [IP] |
| **Financial impact** | Not measurable |
| **Workarounds** | Audits, regression tests, manual exceptions (S-130, S-131, S-132) |
| **Existing software** | Directory reviewers praise configurable commission engines (S-097, S-098) [IP: calculation itself may not be the pain] |
| **Evidence** | **J** (S-130, S-131, S-132); **B** contradicts (praise, no complaint) |
| **Opportunities** | [HY] Reconciliation, exception queues, calculation history (see 13 §7). **Challenge to the brief:** "commission errors" as the central pain is **not supported** by the evidence (05 §3) |

### P-14 — Plan manipulation ("bonus buying") and purchase-driven qualification [R-08, R-04]

| Field | Record |
|---|---|
| **Problem ID** | P-14 |
| **User affected** | Compliance Officer, Finance Manager, Operations Manager, Company Owner |
| **Current workflow** | Two dōTERRA postings list research of fraud including **"manipulation of the compensation plan through bonus buying"** (S-131, S-132). FTC guidance treats purchases required to qualify as evidence of a pyramid; the Herbalife order bars multi-level compensation on **excess claimed retail sales** (S-020, S-120). Practitioner commentary names inventory loading and high ongoing personal-purchase requirements as risk features (S-125) |
| **Root cause** | [RB] Rank and bonus qualification by volume rewards purchases that are not end-consumer demand |
| **Frequency** | Not evidenced; the job duty shows it is a recognized concern at one company |
| **Severity** | **Medium documented** (staffed fraud research). Linked to P-05 for regulatory consequence |
| **Business impact** | Compensation paid on non-consumer volume; legal exposure [RB] |
| **Financial impact** | Not measurable |
| **Workarounds** | Manual investigation; plan rules (caps, expiry) |
| **Existing software** | Not stated (04) |
| **Evidence** | **J** (S-131, S-132), **R** (S-020, S-120), **P** (S-125) |
| **Opportunities** | [HY] Detection views (CMP-01, CMP-02) and caps. **Risk:** detection features are also the tenant-acceptance tools (CMP-16, OQ-03) |

### P-15 — Payee tax documentation [R-08]

| Field | Record |
|---|---|
| **Problem ID** | P-15 |
| **User affected** | Finance Manager, Distributor, Compliance Officer |
| **Current workflow** | US direct sellers issue **1099-MISC** for resale sales of $5,000 or more and **1099-NEC** for commissions of $600 or more; in 2020 the IRS did not allow combined statements, so payors paying both send two forms; about **80% of one tax vendor's 2019 clients** reported both (S-123). **Thresholds may have changed since 2020 [UV]**. A posting lists "global tax reporting" duties (S-130) |
| **Root cause** | [RB] Different payment types and per-country tax rules |
| **Frequency** | Annual, recurring |
| **Severity** | **Medium** at most (recurring effort; no penalty documented) |
| **Business impact** | Year-end workload [HY] |
| **Financial impact** | Not measurable |
| **Workarounds** | Tax-software vendors and spreadsheets (S-123 is itself a vendor) |
| **Existing software** | Tax-reporting vendors exist; fit unknown |
| **Evidence** | **J** (S-130); S-123 is vendor commentary (not counted) |
| **Opportunities** | [HY] Export-ready payee data by form type per market. Low differentiation |

### P-16 — Cross-border payout, currency and merchant-account risk [R-08]

| Field | Record |
|---|---|
| **Problem ID** | P-16 |
| **User affected** | Finance Manager, Distributor, Country Manager |
| **Current workflow** | Cheques printed and mailed globally (S-132). Vendor-listed leakage sources include FX and fees (S-138, not counted). **Merchant-account risk has no source in this wave [UV]** |
| **Root cause** | [IP] Many currencies, rails and providers |
| **Frequency** | Not evidenced |
| **Severity** | **Not rated** (one non-vendor source, showing effort only) |
| **Business impact** | [HY] Payout cost and delay |
| **Financial impact** | Not measurable |
| **Workarounds** | Cheques; provider-based payouts (S-114, vendor) |
| **Existing software** | Orchestration providers (S-114); local rails unevidenced (H-6) |
| **Evidence** | **J** (S-132) only |
| **Opportunities** | See 51 §5 (instruction-only design). **No problem claim** until interviews or provider tests |

### P-17 — Capacity, speed and reporting access [R-09] — **[UV]**

| Field | Record |
|---|---|
| **Problem ID** | P-17 |
| **User affected** | Operations Manager, Super Admin, Marketing Manager (reporting) |
| **Current workflow** | Not evidenced. Vendor-listed signs: failures at volume spikes, overnight batches, limited data access (S-136, not counted) |
| **Root cause** | Not evidenced |
| **Frequency** | Not evidenced |
| **Severity** | **Not rated** |
| **Business impact** | [HY] Slow reporting; missed windows at promotion peaks |
| **Financial impact** | Not measurable |
| **Workarounds** | Not evidenced |
| **Existing software** | One 1.0-star review mentions stability and bugs on one vendor (S-100); one reviewer calls reporting "cumbersome" (S-099) |
| **Evidence** | **B** weak (S-099, S-100) |
| **Opportunities** | None to claim |

### P-18 — Migration and cutover risk [R-09]

| Field | Record |
|---|---|
| **Problem ID** | P-18 |
| **User affected** | Company Owner, Finance Manager, Super Admin, Operations Manager |
| **Current workflow** | Herbalife's modernization (Oracle Fusion, "Herbalife One") "may be subject to cost overruns and delays" (S-121). A posting for Nu Skin requires a legacy MultiValue skill set (S-130). Vendor content says fear of moving historical commission and genealogy data is "the primary roadblock" and describes parallel-run validation (S-137, not counted). Reviewers mention **incomplete go-live** (one customer returned to old software, 2017, S-098) and cost surprises (S-097, S-100) |
| **Root cause** | [IP] Years of plan history and genealogy in the old system; commissions must match to the cent |
| **Frequency** | Not evidenced |
| **Severity** | **Medium** documented (risk of cost overruns and delay; a failed go-live in one review) |
| **Business impact** | Switching cost keeps buyers on old systems [IP] |
| **Financial impact** | Not measurable |
| **Workarounds** | Parallel runs; staged cutover (vendor-described) |
| **Existing software** | Vendors offer migration services (03); quality unknown |
| **Evidence** | **F** (S-121), **J** (S-130), **B** (S-097, S-098, S-100) |
| **Opportunities** | [HY] Parallel-run and reconciliation tooling. Link to P-01 and P-02 |

## 3. Problem areas in the brief with no evidence gathered

These were **not researched** in Wave 3. Nothing is claimed about them.

| Area (stakeholder) | Status |
|---|---|
| Warehouse, inventory and fulfillment (Warehouse Manager) | Not researched |
| Customer support operations beyond refunds (Customer Support Agent) | Not researched |
| Training, content and campaign tools (Marketing Manager) | Not researched |
| Distributor onboarding, identity checks and duplicate or fake accounts | Not researched (relates to CMP-10) |
| Lead capture and prospecting tools used by distributors | Not researched |
| Distributor voices (any problem) | **None obtained** (Reddit mining failed; no interviews) |

## 4. What would change these records

- **Interviews and the survey in the R-37 appendix** (66 Appendix A): frequency, cost, last-three-incidents, willingness to pay.
- **Primary reads:** ROSCA enforcement actions against direct sellers (P-11); Act 500 and India Rules text (P-03).
- **Vendor documentation reads (V3)** to turn "not stated" into present or absent (04, U-16).
- **Founder input:** OQ-01 (segment and first market) decides which of these problems matter first.
