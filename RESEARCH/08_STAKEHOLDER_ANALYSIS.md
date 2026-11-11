# 08 — STAKEHOLDER ANALYSIS
## Who uses, pays for, approves, regulates and is affected by the platform — and how much of that is evidenced

| Field | Value |
|---|---|
| Document ID | 08_STAKEHOLDER_ANALYSIS |
| Version | 0.1 (Wave 3) |
| Date | 2026-11-11 |
| Research ID | R-10 (depends on R-01; feeds personas 09, journeys 10, RBAC and sitemap in later waves) |
| Sources | `S-xxx` in 00_RESEARCH_SOURCE_REGISTER.md; problems `P-xx` in 06 |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV] |

## 0. Summary

1. **Of the 17 stakeholders in the brief, two groups are evidenced by documents** and the rest come from the brief alone ([HY]):
   - **Evidenced as populations or functions:** distributors, retail customers and sales leaders (company filings S-121, S-122, S-140); the commission-operations function (three employer postings S-130 to S-132); a compliance function (required by the FTC order S-120 and by Indian and Malaysian rules, S-085, S-043).
   - **From the brief only:** Super Admin, Sales Manager, Regional Manager, Customer Support Agent, Warehouse Manager, Marketing Manager, Prospect.
2. **No org chart of a direct-selling company was obtained.** Where a function sits (finance, operations or IT) is **not stated** in the postings read. The buying committee below is a **hypothesis** to test in interviews (66 Appendix A).
3. **Seven stakeholders were added** that the brief does not list but the evidence or the legal screen points to (ST-18 to ST-24), including **regulators**, **payout providers**, an **independent compliance auditor** and a **data protection or grievance officer**.
4. **Buyer versus user:** the buyer is the company (A-01). **Distributors are users, not buyers**, but their number and dependence make them the **largest affected population** (Herbalife 6.4M Members, S-121; Nu Skin 748,796 customers and 129,311 paid affiliates, S-122).
5. **Two conflicts matter for design:** the Compliance Officer's interest (evidence, restriction) may run against the Sales and Marketing interest (growth, bonuses), and **separation of preparer and approver** for payouts is needed (MH-REQ-02 in 51).

## 1. Method and limits

| Step | What was used | Limit |
|---|---|---|
| Role existence | Employer postings, SEC filings, regulator orders, legal texts | Three postings at two companies; no org charts |
| Role detail | Posting duties and the brief's list | Vendor documentation not read (U-16) |
| Buying roles, interest | **Hypotheses**: how companies buy this software was not found in any source | No buyer interview exists |
| Added roles | R-10 question (extra personas) and 51 | Several rest on single sources |

**Reading rule:** "Evidenced" means a document shows the population or function exists. It does **not** mean the document describes their pain or needs.

## 2. The 17 stakeholders from the brief

Buying role: **Decides** = approves spend; **Evaluates** = tests and recommends; **Vetoes** = can block on risk; **Uses** = daily user; **Affected** = does not choose but lives with the result. **All buying roles are [HY].**

| ID | Stakeholder | Side | What they do in a direct-selling business | Evidence basis | Buying role [HY] | Related problems |
|---|---|---|---|---|---|---|
| ST-01 | **Super Admin** (platform operator) | Operator | Configures tenants, users, roles, integrations, security | **Brief only** [HY]. Posting S-130 mentions API and system-to-system transfers, which implies technical administrators | Evaluates; Uses | P-04, P-17, P-18 |
| ST-02 | **Company Owner** | Operator | Owns the business, plan and brand; carries legal exposure | Filings are company documents; the owner role comes from the brief [HY]. How small companies buy: unknown | **Decides** | P-02, P-03, P-05 |
| ST-03 | **CEO** | Operator | Strategy, markets, compliance posture | Filings describe corporate risk (S-121, S-122) [VF for company risk statements] | **Decides** (larger firms) | P-01, P-03, P-05, P-18 |
| ST-04 | **Operations Manager** | Operator | Runs commission cycles, orders, support operations | Commission-systems and commission-support roles exist (S-130, S-131, S-132); **their reporting line is not stated** | Evaluates; Uses | P-01, P-02, P-13, P-14 |
| ST-05 | **Finance Manager** | Operator | Approves payouts, reconciles, tax reporting, FX | "Global tax reporting" duty in S-130; payment and reconciliation duties in S-132; 1099 duties in S-123 (vendor commentary) | **Vetoes**; Evaluates | P-08, P-12, P-13, P-15, P-16 |
| ST-06 | **Sales Manager** | Operator | Drives distributor sales and promotions | **Brief only** [HY] | Influences | P-02, P-14 |
| ST-07 | **Regional Manager** | Operator | Oversees a region's distributors and results | **Brief only** [HY] | Influences | P-03 |
| ST-08 | **Country Manager** | Operator | Licences, local rules, launches, local payout methods | New-market launch projects (S-131); Herbalife in 95 markets (S-121); per-market caps stated (S-122) [RB that the function is needed] | Evaluates; **Vetoes** locally | P-03, P-12, P-16 |
| ST-09 | **Team Leader** | Channel | Builds and coaches a team; earns on team volume | Population: about **750,000 sales leaders** (S-121); **30,045** (S-122) [VF]. **Their tooling needs are not evidenced** | Affected (influences via the company's field council [UV]) | P-06, P-10 |
| ST-10 | **Sponsor** | Channel | The enrolling distributor; often earns a sponsor bonus | Plan structure: fast-start bonuses with a second level (S-141, 2015–2019 plan) imply an enrolling relationship [IP]; sponsor and upline are roles in the plan, not necessarily a separate person | Affected | P-07, P-12, P-14 |
| ST-11 | **Distributor** | Channel | Buys product, sells, recruits, receives commissions | Populations: 2.3M distributors (S-121); 129,311 paid affiliates (S-122); Brand Partners (S-140) [VF]. **No distributor voice** | **Affected** (not a buyer, A-01) | P-04, P-06, P-07, P-08, P-09, P-12 |
| ST-12 | **Retail Customer** | Customer | Buys product without joining; may subscribe | Populations: 748,796 customers (S-122); 3.1M preferred members (S-121). One consumer case (S-134) [VF] | Affected | P-11, P-12 |
| ST-13 | **Prospect** | Channel | A person being recruited or sold to | **Brief only** [HY] | Affected | — |
| ST-14 | **Customer Support Agent** | Operator | Answers orders, returns, commission questions | **Brief only** [HY]; S-134 shows customers cannot self-serve a return | Uses | P-07, P-08, P-11, P-12 |
| ST-15 | **Warehouse Manager** | Operator or 3PL | Fulfillment, returns inventory | **Brief only** [HY]. **Not researched** | Uses | (none researched) |
| ST-16 | **Compliance Officer** | Operator | Plan review, claims review, licences, audits, complaints | The FTC order requires an independent compliance auditor and standardized retail-data records (S-120) [VF]; India expects a grievance officer and records (S-085, secondary); Malaysia licence filings (S-043) [SR] | **Vetoes** | P-03, P-04, P-05, P-11, P-12, P-14 |
| ST-17 | **Marketing Manager** | Operator | Campaigns, content, promotions | **Brief only** [HY]. **Not researched** | Influences | P-14 (promotion design), P-17 (reporting) |

## 3. Stakeholders added by this analysis

| ID | Stakeholder | Why added | Evidence basis | Buying role [HY] |
|---|---|---|---|---|
| ST-18 | **Payout or Payroll Officer** | Someone prepares and approves commission payments; segregation of duties matters (MH-REQ-02) | Manual payment, adjustment and direct-deposit duties (S-132) [RB] | Uses; Vetoes with ST-05 |
| ST-19 | **Commission Systems Analyst** | A distinct, specialist role in the postings: audits, test scenarios, plan-change regression | **S-130, S-131** [VF that the role exists at two companies] | **Evaluates** (likely the day-to-day expert) |
| ST-20 | **Data Protection or Grievance Officer** | India requires a grievance officer with response times (S-085); data-protection laws named in S-121 (including India's DPDP Act) | S-085 (secondary) [SR], S-121 | Vetoes |
| ST-21 | **Legal Counsel** (internal or external) | Plan structure and claims are reviewed by lawyers; practitioners write guidance (S-124, S-125, S-126) | Practitioner pages [RB] | Vetoes |
| ST-22 | **Independent Compliance Auditor** | Court-ordered at Herbalife; reports to the FTC (S-120) | S-120 [VF]; binds one company | Affected; consumer of reports |
| ST-23 | **Integration Developer** | Internal or partner developer connecting e-commerce, ERP, payments, tax | API and system-to-system transfers in S-130 [RB] | Evaluates |
| ST-24 | **External parties** | **Regulators** (FTC, Malaysia's KPDN, India's consumer affairs authority), **payout and payment providers** (S-114; S-111 on FCA authorisation), **tax authorities** (IRS, S-123), **banks** | Law and provider pages (51) [SR] | None; they set constraints |

**Brief-listed but not added:** Product developer or formulator relationships and third-party logistics operators were raised in the R-10 questions. **No evidence was gathered**; they stay as open roles until Wave 4 process work (14).

## 4. Influence and interest (hypothesis map)

**Every placement below is [HY].** No source describes how direct-selling companies choose software. The grid is meant to be corrected in interviews.

| | **High interest in the platform** | **Lower interest** |
|---|---|---|
| **High influence on the purchase** | **Decides or vetoes:** ST-02 Owner, ST-03 CEO, ST-05 Finance, ST-16 Compliance, ST-21 Counsel | **Keep satisfied:** ST-08 Country Manager, ST-20 Data Protection Officer |
| **Lower influence** | **Evaluates and uses daily:** ST-04 Operations, ST-19 Commission Systems Analyst, ST-18 Payout Officer, ST-14 Support, ST-01 Super Admin, ST-23 Integration Developer | **Inform:** ST-06 Sales, ST-07 Regional, ST-17 Marketing, ST-15 Warehouse |
| **Affected, no purchase role** | **ST-09 Team Leader, ST-10 Sponsor, ST-11 Distributor, ST-12 Customer, ST-13 Prospect** (the largest groups; may influence through the company's field relations [UV]) | |

### 4.1 Hypothesized buying committee [HY]

- **Decides:** Owner or CEO. **Vetoes:** Finance (money movement), Compliance and Counsel (regulatory exposure), Data Protection (data location).
- **Evaluates:** Operations, the Commission Systems Analyst and IT.
- **Question for interviews:** who initiated the last system change, who signed, who could stop it, and what stopped it.

## 5. Conflicts and tensions [IP]

| Tension | Between | Design implication |
|---|---|---|
| Growth and bonuses vs restriction and evidence | ST-06, ST-17 vs ST-16 | Plan changes need a compliance review step and a recorded justification (CMP-04); simulation before release |
| Fast payout vs control | ST-11 vs ST-05, ST-18 | Preparer and approver are different people; instructed payouts only in the MVP (A-02, MH-REQ-02) |
| Transparency to distributors vs company confidentiality | ST-11 vs ST-02 | "Why was I paid this" statements (MH-REQ-09) must not expose other people's data |
| Platform neutrality vs tenant legality | The platform vs customers with plans that pay mainly on recruitment | Acceptance policy and detection (OQ-03, CMP-16) |
| Local rules vs global plan | ST-08 vs ST-03 | Per-market overrides as configuration (13 §7) |

## 6. Implications for later design (not decisions) [HY]

- **Role-based access** needs at least: platform admin; tenant admin; finance (prepare, approve); compliance (read-only plus holds and reports); operations; support (limited personal-data view); distributor and leader (own data and downline view only); customer; auditor (read-only, time-boxed).
- **Distributors and leaders see downline data** only to the extent the plan and privacy rules allow; the genealogy permission model is a privacy issue as well as a feature (P-04).
- **Support agents need masked data** by default [IP].
- Detailed permission matrices belong to the security and RBAC documents (Waves 4 and 5).

## 7. What would settle this

- **Interviews (66 Appendix A):** ask each role what they do, what they approve, what they could veto, and who decided the last software change.
- **Documentation reads (V3):** the roles that vendor admin guides assume.
- **Org-chart evidence:** careers pages and LinkedIn-style role listings of public direct sellers (not collected here).
- **Founder input:** OQ-01 (segment): a start-up has one person in many of these roles; an enterprise has all of them.
