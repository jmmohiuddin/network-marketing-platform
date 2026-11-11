# 00 — RESEARCH MASTER PLAN
## All-in-One Network Marketing Management Platform

| Field | Value |
|---|---|
| Document ID | 00_RESEARCH_MASTER_PLAN |
| Version | 1.0 (Phase Zero deliverable) |
| Date | 2026-11-11 |
| Status | Approved for execution (provisional — founder input recorded in 66_OPEN_QUESTIONS_AND_ASSUMPTIONS.md) |
| Companion documents | 00_RESEARCH_EXECUTION_ROADMAP.md, 00_RESEARCH_SOURCE_REGISTER.md |
| Governing brief | MASTER PROJECT INSTRUCTION (Sections 1–20) |

---

## 1. Purpose and the decision this research must inform

The founder's final expectation is "an informed decision about building this product." That sentence defines the research. We are not researching to describe a market; we are researching to answer **one top-level decision** and a short list of sub-decisions.

**Top-level decision (D0):** Should we build a software platform for network marketing / direct selling companies, and if yes, what exactly should the first sellable version be, for whom, in which market, and at what cost and risk?

**Sub-decisions the research must unlock**

| ID | Decision | Needs research | Decision owner |
|---|---|---|---|
| D1 | Which markets are legally and commercially viable for launch? | R-02, R-35, R-36 | Founder |
| D2 | Which customer segment is the ideal first customer (size, region, product type)? | R-02, R-03, R-04–R-09, R-32 | Founder |
| D3 | Is there a real, expensive, frequent problem that incumbents leave under-served? | R-03, R-04–R-09 | Founder |
| D4 | Which positioning (MLM ERP, OS, DS platform, etc.) is strongest? | R-03, R-32 | Founder |
| D5 | What is in the MVP and what is deliberately excluded? | R-17, R-MOD-A–M, R-33 | Founder + CPO role |
| D6 | Can the platform hold or move distributor money, or must it integrate with licensed providers? | R-39, R-35 | Founder + counsel |
| D7 | What architecture fits the stage (modular monolith vs services; tenancy model)? | R-24, R-25, R-26 | CTO role |
| D8 | Is the business viable (pricing, margin, break-even)? | R-16, R-13, R-40 | Founder |
| D9 | Should we proceed, pivot the segment, or stop? | All | Founder |

---

## 2. Critical review of the brief (challenges raised before research starts)

The brief asks us to challenge weak ideas. We start with the brief itself. Items below are **hypotheses to be tested**, not conclusions. Each is tracked in the Open Questions register.

| # | Observation about the brief | Why it matters | How research will test it |
|---|---|---|---|
| C1 | "All-in-one" across 13 modules (A–M) plus mobile apps is the scope of several incumbent vendors combined. A new entrant that builds everything risks shipping nothing validated. | Scope is the single largest execution risk. | R-17 and R-33 must justify every MVP feature by problem evidence. Default stance: narrow wedge first. |
| C2 | Several competitor names in the brief may be mis-categorized or non-vendors (hypothesis: some are direct-selling brands, general loyalty/engagement companies, or affiliate tools rather than MLM back-office vendors). | A competitor list built on wrong names produces a wrong market map. | R-03 starts with **verification of every name** before any analysis (task R-03.0). |
| C3 | The brief assumes Bangladesh, India, UAE, SE Asia and the West are all worth evaluating equally. Their legal regimes differ sharply (some jurisdictions license or restrict MLM; some regulate payouts). | One market may be a no-go or may impose licensing that changes product design. | R-35 is promoted to an **early legal screening gate** (see roadmap), not left for Phase Ten. |
| C4 | Wallets, payouts and "financial management" may put the platform near regulated money transmission. | Could require licensing or change the business model entirely. | R-39 dedicated study; default design stance: integrate licensed payout providers, do not hold funds. |
| C5 | AI assistant (Module M) appears in the brief as a differentiator. Differentiation by AI is only valuable if it solves a measured user problem. | Risk of AI-as-marketing. | R-18 requires problem, data, accuracy, oversight, cost, and benefit per AI feature. |
| C6 | Software for MLM companies carries reputational and legal exposure if it enables deceptive or recruitment-driven compensation. | Customer selection, product guardrails and brand risk. | R-36 designs guardrails; R-32 considers an ethical-use policy as a positioning asset. |
| C7 | The target buyer is ambiguous: a startup MLM company, an established mid-size brand, or an enterprise. Needs, budgets and sales cycles differ by an order of magnitude. | Pricing, MVP and GTM depend on it. | R-02 segmentation, R-03 incumbents' target customers, R-29/R-46 sales-cycle research. |
| C8 | The brief wants 67+ documents. Documents without evidence are worse than no documents. | Quality over volume. | Every document must cite register sources or be labeled hypothesis. Empty documents are not created. |

---

## 3. Research objectives

| ID | Objective |
|---|---|
| RO-1 | Build a verified understanding of how direct selling and network marketing businesses operate, make money, and are regulated. |
| RO-2 | Size the opportunity for software (TAM/SAM/SOM) with transparent methods and explicit uncertainty. |
| RO-3 | Map the real competitive landscape, verified vendor by vendor, and find genuine gaps. |
| RO-4 | Identify and rank the problems of every stakeholder by frequency, severity and willingness to pay. |
| RO-5 | Determine which market(s) to enter first, based on legal viability and commercial attractiveness. |
| RO-6 | Define the compensation-plan domain precisely enough to design a configurable, auditable engine. |
| RO-7 | Determine what money-handling the platform can legally and safely do. |
| RO-8 | Derive a defensible MVP, roadmap, positioning, pricing and architecture from evidence. |
| RO-9 | Produce documentation complete enough that a development team does not have to guess. |
| RO-10 | Document every gap, assumption and validation need honestly. |

---

## 4. Master research questions

| ID | Question | Feeds |
|---|---|---|
| RQ-01 | What distinguishes legitimate direct selling / MLM from pyramid schemes in each target jurisdiction, in law and in enforcement practice? | D1, D6 |
| RQ-02 | How big is global and regional direct selling, and how reliable are the available figures? | D2 |
| RQ-03 | Who buys MLM software today, from whom, for how much, and how do they feel about it? | D2, D3, D4 |
| RQ-04 | Which problems do companies, distributors, leaders, customers and finance teams experience most often and most expensively? | D3, D5 |
| RQ-05 | Which compensation structures exist, how are they calculated, and which edge cases break software? | D5, D7 |
| RQ-06 | What must the platform do to be defensible under direct-selling and consumer-protection rules? | D1, D5 |
| RQ-07 | What can the platform do with money (ledger, wallet, payout) without becoming a regulated entity? | D6 |
| RQ-08 | Which features are table stakes, which differentiate, and which are noise? | D4, D5 |
| RQ-09 | Which technical architecture supports multi-tenant, auditable, high-volume commission processing at our stage and budget? | D7 |
| RQ-10 | What would it cost to build and run, and what revenue model supports healthy margins? | D8 |
| RQ-11 | How would we acquire, onboard and retain customers in the chosen segment? | D8 |
| RQ-12 | Where is the evidence thin, and what primary research would close the gap fastest? | D9 |

---

## 5. Evidence standards

### 5.1 Claim classification (mandatory in all deliverables)

| Label | Meaning | Citation requirement |
|---|---|---|
| **[VF] Verified fact** | Stated in a primary or authoritative source we read | Register ID + page/section |
| **[RB] Research-backed observation** | Supported by two or more independent credible sources | Register IDs |
| **[IP] Industry pattern** | Recurs across competitor/community evidence; not a hard statistic | Register IDs |
| **[HY] Hypothesis** | Plausible, untested | State what would validate it |
| **[SR] Strategic recommendation** | Our judgment derived from labeled evidence | Link to supporting claims |
| **[UV] Unknown requiring validation** | Evidence not found or conflicting | Validation method |

### 5.2 Source hierarchy (per brief §3.1)

1. Government and regulator publications
2. Official industry association reports (WFDSA, DSA, national associations)
3. Original academic research
4. Official competitor documentation
5. Product documentation and pricing pages
6. Credible market research (treated cautiously; compared across sources)
7. Customer reviews and community discussion
8. Primary interviews (only if conducted — none exist yet)

### 5.3 Confidence grading for sources

| Grade | Criteria |
|---|---|
| A | Primary/official, current, methodology visible |
| B | Credible secondary, methodology partly visible |
| C | Vendor marketing, forum posts, anecdotal, undisclosed methodology |

Market-size claims drawn from Grade C sources are never used alone.

### 5.4 Hard prohibitions

No fabricated interviews, surveys, statistics, market sizes, competitor features, competitor prices or financial projections. Any financial scenario uses labeled assumptions. Competitor pricing is recorded only if publicly displayed, with the access date.

### 5.5 Source register fields (applies to 00_RESEARCH_SOURCE_REGISTER.md)

`Source ID | Title | Publisher | URL | Publication date | Access date | Grade (A/B/C) | Relevance | Claims supported | Research IDs`

---

## 6. Research categories

| Cat | Category | Research IDs |
|---|---|---|
| A | Industry and market | R-01, R-02, R-13 |
| B | Competitive intelligence | R-03 |
| C | Problem discovery | R-04 – R-09 |
| D | Users and stakeholders | R-10 – R-12 |
| E | Business analysis | R-13 – R-16 |
| F | Solution and product | R-17, R-18, R-MOD-A – R-MOD-M |
| G | UX and design | R-19 – R-23 |
| H | Technical | R-24 – R-28 |
| I | Growth and commercial | R-29 – R-31, R-40 |
| J | Legal, regulatory, ethical | R-35, R-36, R-39 |
| K | Strategy and consolidation | R-32 – R-34, R-37 |

---

## 7. Research topic catalog

Priority key: **P0** = gate; blocks other work or can end the project. **P1** = required for MVP decision. **P2** = required for full documentation. **P3** = refinement.

Each entry lists: Why it matters · Questions · Information to collect · Methodology · Expected output · Dependencies · Priority · Influence on product decisions.

### Category A — Industry and market

#### R-01 Industry Overview
- **Why:** Everything else rests on correctly understanding how this industry works and where legitimate direct selling ends.
- **Questions:** What is direct selling vs MLM vs pyramid scheme legally and operationally? What business models exist (single-level, multi-level, party plan, subscription, membership)? How do companies and distributors earn? How do companies expand across borders? What technology do they use and what is changing?
- **Collect:** Definitions from regulators and associations, taxonomy of company types (wellness, beauty, household, education, financial, lifestyle, subscription), revenue structure examples from public filings, trend data.
- **Method:** Desk research (WFDSA, DSA, FTC, national regulators), public company filings, academic literature.
- **Output:** 01_INDUSTRY_RESEARCH.md.
- **Depends on:** none.
- **Priority:** P0.
- **Influences:** Terminology in all documents; segment selection (D2); compliance stance (D1).

#### R-02 Market Size and Opportunity
- **Why:** Determines whether a software business can be large enough.
- **Questions:** How big is direct selling globally and by region? How reliable are the numbers? How many companies exist per segment? What do they spend on software? What share is addressable by a new vendor?
- **Collect:** WFDSA global sales and sales-force figures, DSA US data, national association data (e.g., India, Bangladesh where available), software-spend proxies, vendor customer counts.
- **Method:** Triangulation of at least three independent sources; bottom-up TAM/SAM/SOM using company counts × realistic annual software spend; document discrepancies.
- **Output:** 02_MARKET_SIZE_AND_OPPORTUNITY.md.
- **Depends on:** R-01, R-03 (pricing evidence).
- **Priority:** P0.
- **Influences:** D1, D2, D8; ambition of roadmap.

### Category B — Competitive intelligence

#### R-03 Competitor Intelligence
- **Why:** Reveals table stakes, gaps, price anchors and customer complaints.
- **Questions:** Which vendors really exist and are active? Whom do they serve? What do they offer across 23 dimensions in the brief? What do customers complain about? Which segments are under-served?
- **Collect:** Official sites, documentation, pricing pages, case studies, customer reviews (G2, Capterra, Trustpilot, Reddit, forums), job postings (signals of technology/investment), press and acquisition news.
- **Method:** Verification step (R-03.0), then structured teardown using a fixed template, then review mining, then feature matrix.
- **Output:** 03_COMPETITOR_ANALYSIS.md, 04_COMPETITIVE_FEATURE_MATRIX.md, 05_MARKET_GAP_ANALYSIS.md.
- **Depends on:** R-01 (to categorize).
- **Priority:** P0.
- **Influences:** D2, D3, D4, D5, pricing.

### Category C — Problem discovery

For R-04 to R-09 the shared methodology is: community mining (Reddit, forums, review sites, social groups), competitor complaint analysis, regulator enforcement cases, vendor case studies, job postings, and hypothesis generation for later primary validation. Each identified problem is recorded in the standard problem record (Problem ID, user affected, current workflow, root cause, frequency, severity, business impact, financial impact if measurable, workarounds, existing software, evidence, opportunities). Severity and frequency without evidence are marked **[HY]**.

| ID | Title | Core questions | Priority | Output feed |
|---|---|---|---|---|
| R-04 | Company management problems | Where do fragmented systems, manual admin, weak reporting, multi-market and multi-brand operations cost money? | P1 | 06, 07 |
| R-05 | Distributor problems | What do distributors need to become productive? What causes early drop-out? | P1 | 06, 07 |
| R-06 | Team leader problems | What visibility and tooling do leaders lack? | P1 | 06, 07 |
| R-07 | Customer problems | What breaks purchase, returns, subscriptions, trust? | P2 | 06, 07 |
| R-08 | Finance and operations problems | Where do commission errors, reversals, chargebacks, tax docs, currency and reconciliation hurt? | P1 | 06, 07, 13 |
| R-09 | Technology problems | What fails in legacy platforms: speed, integrations, API access, migration, security, mobile? | P1 | 06, 07 |

**Common dependencies:** R-01, R-03 (for existing-solution mapping).
**Common influence:** Problem-to-Solution Traceability Matrix (R-17); MVP scope (R-33).
**Expected output:** 06_PROBLEM_RESEARCH.md, 07_PROBLEM_SEVERITY_MATRIX.md.

### Category D — Users and stakeholders

#### R-10 Stakeholder Mapping
- **Why:** Defines who the system serves and who can block adoption.
- **Questions:** Who interacts with, pays for, approves, and is affected by the platform? Are there personas missing from the brief's 17 (e.g., Payroll/Payout Officer, Data Protection Officer, Legal Counsel, Product Developer/Formulator relationships, Third-party Logistics operator, Integration Developer, Auditor)?
- **Collect:** Role descriptions from vendor documentation and job postings; org charts of public direct-selling companies.
- **Method:** Role analysis from documentation; influence/interest mapping.
- **Output:** 08_STAKEHOLDER_ANALYSIS.md.
- **Depends on:** R-01.
- **Priority:** P1.
- **Influences:** RBAC design, permissions, personas, sitemap.

#### R-11 User Personas
- **Why:** Prevents generic design.
- **Questions:** Goals, tasks, devices, proficiency, frustrations per persona.
- **Collect:** Community evidence, vendor docs, role descriptions. No invented demographics. Personas labeled **research-based** or **provisional hypothesis**.
- **Method:** Evidence synthesis; interview guide design for later validation (R-37).
- **Output:** 09_USER_PERSONAS.md.
- **Depends on:** R-10, R-04–R-09.
- **Priority:** P1.
- **Influences:** UX, feature prioritization.

#### R-12 User Journey Mapping
- **Why:** Surfaces failure points and automation opportunities.
- **Questions:** For the 17 journeys listed in the brief: trigger, action, system response, expectation, pain, failure, opportunity, metric.
- **Method:** Workflow mapping from vendor docs and community accounts; Mermaid journeys.
- **Output:** 10_USER_JOURNEY_MAPS.md, 11_USER_WORKFLOW_ANALYSIS.md.
- **Depends on:** R-10, R-11, R-15.
- **Priority:** P2.

### Category E — Business analysis

#### R-13 Business Model Research
- **Why:** Separates legitimate product revenue from recruitment-driven revenue; informs which customers we can ethically serve.
- **Questions:** How do companies earn from retail, wholesale, subscriptions, memberships, bundles, autoship? What share of sales is to non-participant customers? What payment flows look like recruitment fees?
- **Collect:** Public company disclosures (10-K filings of listed direct sellers), income disclosure statements, regulator case documents.
- **Method:** Document analysis; build revenue-flow diagrams.
- **Output:** 12_BUSINESS_MODEL_ANALYSIS.md.
- **Depends on:** R-01.
- **Priority:** P1.

#### R-14 Compensation Plan Research
- **Why:** The heart of the product; the largest source of complexity and legal exposure.
- **Questions:** For each plan type (unilevel, binary, matrix, breakaway, stairstep, hybrid, generation, rank-based, customer-sales incentives, leadership, matching, fast-start, performance, recurring): calculation logic, qualification, volumes (PV/GV/CV), ranks, compression, carry-forward, caps, refunds/chargebacks, payout cycles, edge cases, legal risk. How must a configurable engine represent these? What goes into rule versioning, simulation, audit trail?
- **Collect:** Published plan documents from public companies; vendor documentation of plan configuration; academic descriptions; regulator commentary on plan features that signal pyramid risk (e.g., pay for recruiting, inventory loading).
- **Method:** Taxonomy build; worked numerical examples with explicit hypothetical numbers; design-pattern analysis for rules engines (declarative DSL vs code plugins).
- **Output:** 13_COMPENSATION_PLAN_RESEARCH.md, 15_BUSINESS_RULES_CATALOG.md.
- **Depends on:** R-01, R-35 (legal limits), R-08.
- **Priority:** P0.
- **Influences:** Engine architecture (D7), MVP (D5), legal guardrails.

#### R-15 Business Process Analysis
- **Why:** Features must follow real workflows.
- **Questions:** Actors, inputs, outputs, rules, exceptions, bottlenecks for ten processes (lead-to-customer, prospect-to-distributor, registration-to-activation, order-to-fulfillment, sales-to-commission, commission-to-payout, rank qualification, refund-to-reconciliation, support, suspension/termination).
- **Method:** BPMN-style Mermaid flows from documentation and community evidence.
- **Output:** 14_BUSINESS_PROCESS_ANALYSIS.md.
- **Depends on:** R-01, R-14.
- **Priority:** P1.

#### R-16 Financial Feasibility
- **Why:** Decides whether the business is viable.
- **Questions:** Build cost, infrastructure, third-party services, payment/SMS/email costs, support, CAC, margins, break-even.
- **Collect:** Public cloud pricing, payment gateway fee schedules, SMS/email pricing, salary benchmarks for target hiring location, competitor pricing (public only).
- **Method:** Three scenarios (conservative, moderate, optimistic); all assumptions labeled; sensitivity analysis.
- **Output:** 16_FINANCIAL_FEASIBILITY.md, 17_BUSINESS_CASE.md.
- **Depends on:** R-02, R-03, R-24, R-25, R-33, R-47.
- **Priority:** P1.

### Category F — Solution and product

#### R-17 Solution Discovery
- Evaluate solutions per validated problem against user value, business value, feasibility, complexity, cost, scalability, security, compliance, differentiation. Build the Problem-to-Solution Traceability Matrix. **Depends on:** R-04–R-09, R-03. **Priority:** P1. **Output:** 20_PRODUCT_OPPORTUNITY_ANALYSIS.md, 21_PRODUCT_FEATURE_CATALOG.md.

#### R-18 Product Opportunity Research (AI and differentiation)
- For each candidate AI feature: actual problem, capability required, data requirements, accuracy expectation, failure risk, human oversight, privacy, cost, measurable benefit. Reject features that fail the test. **Depends on:** R-17, R-27. **Priority:** P2. **Output:** section of 20 plus Module M specification.

#### Module research R-MOD-A to R-MOD-M
Each module is researched independently for purpose, user needs, business rules, workflows, integrations, dependencies, security requirements and edge cases, then specified in 22_PRODUCT_MODULE_SPECIFICATIONS.md and per-module feature research documents.

| ID | Module | Priority | Key special investigations |
|---|---|---|---|
| R-MOD-A | Company administration | P1 | Multi-country, multi-currency, tax configuration, audit logs |
| R-MOD-B | Distributor management | P1 | KYC where legally required; reinstatement rules; status lifecycle |
| R-MOD-C | Genealogy and network | P0 | **Sponsor vs placement distinction**; historical genealogy changes; very large tree performance |
| R-MOD-D | CRM and leads | P2 | Duplicate detection; attribution; consent |
| R-MOD-E | Sales and e-commerce | P1 | Build vs integrate with existing commerce platforms; returns/refunds interaction with commissions |
| R-MOD-F | Inventory and fulfillment | P2 | Likely integrate (ERP/WMS) rather than build; test this |
| R-MOD-G | Compensation engine | P0 | Configurability, versioning, simulation, reversals, audit |
| R-MOD-H | Financial management | P0 | Ledger design; wallet legality (R-39); reconciliation |
| R-MOD-I | Training / LMS | P2 | Build vs integrate third-party LMS |
| R-MOD-J | Communication | P2 | Channel regulation: SMS, WhatsApp, email consent |
| R-MOD-K | Marketing tools | P2 | Safeguards against deceptive income claims; spam |
| R-MOD-L | Analytics and BI | P1 | Which dashboards drive decisions; embedded vs external BI |
| R-MOD-M | AI assistant | P3 | Gated by R-18 outcome |

### Category G — UX and design

| ID | Title | Key questions | Priority | Depends on | Output |
|---|---|---|---|---|---|
| R-19 | UX research | Expectations, mobile behavior, accessibility, localization (including right-to-left and Bangla/Hindi/Arabic needs), trust patterns, onboarding, error prevention | P2 | R-11, R-12 | 26_UX_RESEARCH.md |
| R-20 | Information architecture | Roles, navigation, modules, search, notifications, settings | P2 | R-10, R-MOD-* | 27_INFORMATION_ARCHITECTURE.md, 28_APPLICATION_SITEMAP.md |
| R-21 | User flow research | 16 critical flows with alternates, errors, empty states, permission blocks | P2 | R-12, R-20 | 29_USER_FLOW_SPECIFICATIONS.md |
| R-22 | Wireframing | Screen inventory with the 20 specification fields; low-fidelity first; desktop and mobile | P2 | R-21 | 30_WIREFRAMING_SPECIFICATIONS.md |
| R-23 | UI design system | Tokens, components, tables, forms, dashboards, charts, accessibility | P3 | R-19, R-22 | 31, 32, 33 |

### Category H — Technical

| ID | Title | Key questions | Priority | Depends on | Output |
|---|---|---|---|---|---|
| R-24 | Technical feasibility / stack evaluation | Frontend, backend, database, cache, search, queue, jobs, storage, auth, realtime, cloud, monitoring, CI/CD, DR — compared against our team and budget, not popularity | P1 | R-14, R-25 | 34_TECH_STACK_EVALUATION.md |
| R-25 | System architecture | Modular monolith vs microservices, tenancy model, calculation engine design, event sourcing question for ledgers, scalability | P1 | R-14, R-26 | 35, 40, 43, 44, 61 |
| R-26 | Database design | Entities, ER, constraints, indexing, hierarchy storage (closure table, nested set, materialized path, graph) benchmarked against large-tree needs, data isolation, retention, migration | P1 | R-MOD-C, R-MOD-G, R-MOD-H | 36, 37 |
| R-27 | Security and compliance architecture | AuthN/Z, RBAC/ABAC, tenant isolation, encryption, API security, audit, fraud, sessions, privacy, retention, backup, DR, incident response; map to GDPR and local laws (technical, not legal advice) | P1 | R-35 | 39, 41, 54 |
| R-28 | Integration research | Payments, payouts, accounting, shipping, SMS, email, WhatsApp Business, CRM, e-commerce, analytics, IDV, tax, LMS — **per target market** | P1 | R-39, R-38 | 38, 42 |

### Category I — Growth and commercial

| ID | Title | Key questions | Priority | Depends on | Output |
|---|---|---|---|---|---|
| R-29 | Growth strategy | Funnel Awareness→Advocacy, conversion events, B2B SaaS sales cycle in this vertical | P2 | R-02, R-03 | 45, 46, 48, 49 |
| R-30 | Product growth loops | Sustainable loops without manipulative or recruitment-incentive mechanics | P3 | R-29 | 45 |
| R-31 | Product analytics | North Star, activation, retention metrics, event taxonomy | P2 | R-29 | 25, 50 |
| R-40 | Pricing and monetization | Per-distributor, per-order, % of volume, tiered platform, implementation fees; benchmark against **publicly posted** prices only | P1 | R-03, R-16 | 47_PRICING_AND_MONETIZATION.md |

### Category J — Legal, regulatory, ethical (promoted to an early gate)

#### R-35 Legal and Regulatory Research (jurisdiction by jurisdiction)
- **Why:** Can eliminate markets and change the product.
- **Questions:** Per jurisdiction: direct-selling/MLM statute; pyramid scheme tests and recent enforcement; licensing or registration; income-disclosure rules; advertising and earnings claims; cooling-off/refund rules; distributor agreement requirements; KYC/AML; tax reporting; payment regulation; data protection; cross-border rules.
- **Collect:** Statutes, regulator guidance, enforcement actions, official association codes of ethics.
- **Method:** Primary-source reading, jurisdictional compliance matrix, flagged items for qualified local counsel. **This work is research, not legal advice.**
- **Output:** 51_LEGAL_AND_REGULATORY_RESEARCH.md, 52_COMPLIANCE_REQUIREMENTS.md.
- **Depends on:** R-01. **Priority:** P0.
- **Influences:** D1, D5, D6, compensation engine guardrails.

#### R-36 Compliance Safeguard Design
- Design features that reduce risk: compensation transparency, retail-sales-based qualification metrics, refund/chargeback handling, income disclosure workflows, audit trails, fraud monitoring, policy acknowledgement, advertising claim review, consent, data access control. **Depends on:** R-35, R-14. **Priority:** P1. **Output:** part of 52, 53_RISK_REGISTER.md, 54.

#### R-39 Wallet, Ledger and Payout Legality
- **Why:** Decides whether we can hold balances.
- **Questions:** In each target market, when does holding or moving distributor balances require a money-transmitter, e-money, or payment-institution license? What do competitors do (hold funds vs integrate)? What payout rails exist (bank, mobile wallet, card, crypto — and which are advisable)?
- **Method:** Regulator sources; competitor documentation; payment provider documentation.
- **Output:** section of 51 plus Module H specification.
- **Depends on:** R-35. **Priority:** P0.

### Category K — Strategy and consolidation

| ID | Title | Depends on | Priority | Output |
|---|---|---|---|---|
| R-32 | Product positioning | R-03, R-02, R-04–R-09 | P1 | 19_PRODUCT_POSITIONING.md |
| R-33 | MVP definition (RICE, MoSCoW, value/effort, risk/value, dependency) | R-17, R-MOD-*, R-14, R-16 | P0 | 23_MVP_SCOPE.md |
| R-34 | Product roadmap | R-33 | P1 | 18_PRODUCT_VISION.md, 24_PRODUCT_ROADMAP.md |
| R-37 | Primary research design (interview guides, surveys, validation experiments) | R-11 | P1 | Appendix to 66_OPEN_QUESTIONS_AND_ASSUMPTIONS.md |
| R-38 | Market localization and payment ecosystem (language, currency, mobile wallets, logistics per target market) | R-02, R-35 | P1 | Part of 28, 42 |

---

## 8. Competitor research targets

### 8.1 Verification status

Every name from the brief is **unverified** until R-03.0 completes. The "Initial hypothesis" column records doubts to be tested, not conclusions.

| Name | Listed in brief | Initial hypothesis (to verify) | Verification task |
|---|---|---|---|
| DirectScale | Yes | MLM/direct-selling commerce and back-office vendor | Confirm ownership, product, customers |
| Exigo | Yes | MLM back-office/commerce vendor | Confirm current offering |
| ByDesign Technologies | Yes | MLM platform vendor | Confirm current offering |
| MarketPowerPRO | Yes | MLM software vendor | Confirm current offering |
| Rallyware | Yes | Engagement/performance platform used by direct sellers | Confirm whether MLM back-office or adjacent |
| Infinite MLM Software | Yes | Developer/service vendor, likely script-based | Confirm product and pricing |
| ARM MLM Software | Yes | Developer/service vendor | Confirm |
| Epixel MLM Software | Yes | Developer/service vendor | Confirm |
| Global MLM Software | Yes | Developer/service vendor | Confirm |
| LeadDyno | Yes | Affiliate/referral tracking tool, adjacent not direct | Confirm positioning |
| Salesforce-based MLM solutions | Yes | Partner/ISV-built solutions | Identify specific products |
| Plexus | Yes | May be a direct-selling brand rather than software vendor | Confirm; if brand, reclassify as potential customer type |
| Prodigy | Yes | Unclear which company is meant | Identify or drop |
| eLoyalty | Yes | Unclear; may be unrelated to MLM | Identify or drop |

### 8.2 Additional discovery (minimum target: 15 verified relevant competitors)

Search categories: enterprise direct-selling platforms; mid-market SaaS MLM platforms; developer-shop MLM script vendors (very common in South Asia); regional vendors (South Asia, Middle East, Southeast Asia); adjacent categories (affiliate/referral platforms, e-commerce subscription platforms, social-selling tools, generic loyalty platforms, ERP add-ons); open-source options; in-house builds by large brands (visible via job postings and conference talks).

### 8.3 Teardown template (all 23 dimensions from the brief)

Company overview · target customer · positioning · core features · distributor management · genealogy · compensation · CRM · e-commerce · financial capabilities · mobile apps · reporting · automation · AI · integrations · public pricing · implementation model · strengths · weaknesses · customer complaints · UX quality · differentiation · market positioning. Each field is tagged with an evidence label and a register ID. Fields without public evidence are marked **[UV]**, never filled by guess.

---

## 9. Stakeholders to investigate

| Group | Roles |
|---|---|
| Buy-side (company) | Owner/CEO, Operations Manager, Finance Manager, Sales Manager, Marketing Manager, Compliance Officer, Warehouse Manager, Customer Support, IT lead |
| Field | Distributor, Sponsor, Team Leader, Regional/Country Manager, Prospect |
| Customers | Retail customer, preferred customer/subscriber |
| External | Regulator, payment provider, bank, logistics partner, auditor, tax authority |
| Additional roles to test | Payout officer, Data Protection Officer, Legal counsel, Integration developer, Platform operator (our own support and implementation team) |

---

## 10. Geographic scope and market-selection method

**Initial scope:** United States · United Kingdom · European Union (focus on a small number of representative states, not 27 separate analyses at first) · Bangladesh · India · UAE · Southeast Asia (initial focus: Malaysia, Indonesia, Philippines, Vietnam, Thailand, Singapore, treated individually because regimes differ).

**Market scoring (applied in R-35, R-38 and R-02):**

| Criterion | Weight (initial, adjustable) |
|---|---|
| Legal viability of direct selling / MLM and clarity of rules | 25% |
| Constraints on payouts/wallets | 15% |
| Number and size of reachable companies | 20% |
| Competitive intensity and incumbent strength | 10% |
| Willingness and ability to pay for software | 15% |
| Our access and localization cost (language, payments, relationships) | 10% |
| Data protection and cross-border data burden | 5% |

Weights are provisional and will be listed in the decision log with rationale. Output: a ranked launch-market shortlist and an explicit "do not enter yet" list.

---

## 11. Methodologies

| Method | Used for | Controls |
|---|---|---|
| Desk research | All | Source hierarchy, register entries, dated access |
| Competitor teardown | R-03 | Fixed template, evidence labels |
| Community and review mining | R-04–R-09, R-03 | Record URLs and dates; code themes by frequency; flag small samples; guard against selection bias |
| Regulatory document analysis | R-35, R-39 | Primary text first; flag items for local counsel |
| Document analysis of public filings | R-13, R-14 | Use as illustrations, not universal truth |
| Triangulation | R-02 | At least three independent sources; explain discrepancies |
| Bottom-up market sizing | R-02 | Explicit formula, every input labeled |
| Scenario modeling | R-16 | Three scenarios, sensitivity analysis |
| Worked examples | R-14 | Hypothetical numbers clearly flagged |
| Design evaluation | R-24–R-26 | Weighted decision matrices, written trade-offs, proof-of-concept benchmarks where useful |
| Primary research design | R-37 | Interview guides and surveys prepared; not represented as conducted |

---

## 12. Required data and evidence

| Need | Ideal evidence | Fallback |
|---|---|---|
| Global/regional direct selling sales and sales-force size | WFDSA, DSA, national associations | Cross-check with company filings; mark estimates |
| Number of direct-selling companies by region | Association membership lists, regulator registers | Bottom-up estimate with stated uncertainty |
| MLM software spend | Vendor price pages, public case studies | Hypothesis with sensitivity range |
| Competitor features | Official docs, demos, help centers | Marked [UV] if absent |
| Problems and frequency | Reviews, forums, enforcement cases | Marked [HY] until primary research |
| Legal status per country | Statutes and regulator pages | Marked [UV] and escalated to counsel |
| Payment and payout rails per country | Provider documentation, central bank pages | Marked [UV] |
| Build and run cost | Public pricing, salary benchmarks | Labeled assumptions |

---

## 13. Potential research sources

**Associations and industry:** World Federation of Direct Selling Associations (WFDSA), Direct Selling Association (US), Direct Selling Association of India / IDSA, national associations in Malaysia, Indonesia, Philippines and others, Direct Selling Europe/Seldia, Direct Selling Association of Bangladesh if one exists (to be found).
**Regulators and law:** US Federal Trade Commission (business guidance, enforcement actions, Business Opportunity Rule), US state attorneys general; UK Competition and Markets Authority, Insolvency Service, legislation.gov.uk; EU Unfair Commercial Practices Directive and national implementations; Bangladesh Multi-Level Marketing (Regulation) Act and related Bangladesh Bank and Directorate of National Consumer Rights Protection materials; India consumer-protection direct-selling rules, state-level and central banning-of-schemes law; UAE consumer protection and relevant regulators; Southeast Asian direct-selling laws (e.g., Malaysia's Direct Sales and Anti-Pyramid Scheme Act; Indonesia, Philippines, Vietnam, Thailand, Singapore equivalents).
**Financial/payment:** Central banks and financial regulators for payout rules; payment provider documentation (Stripe, PayPal, Payoneer, Wise, regional providers, mobile financial services in South Asia).
**Companies and vendors:** Official sites and help centers; public company annual reports (10-K) for listed direct sellers; income-disclosure statements.
**Reviews and communities:** G2, Capterra, Trustpilot, Reddit communities, industry forums, LinkedIn discussions, YouTube vendor demos.
**Academic:** Peer-reviewed work on MLM economics, distributor outcomes and consumer protection.
**Technical:** Official documentation of candidate technologies; published benchmarks; architecture write-ups.
**Market research firms:** Used only as Grade B/C inputs, always compared against at least one other source.

---

## 14. Research dependencies (summary)

Full Mermaid dependency graph is in 00_RESEARCH_EXECUTION_ROADMAP.md.

Key gates:
1. R-01 → everything.
2. R-35 + R-39 (legal screen) → market shortlist, Module H design, compensation guardrails.
3. R-03 → R-02 (pricing evidence), R-17, R-32, R-40.
4. R-14 → R-MOD-G, R-25, R-26, R-33.
5. R-33 → R-34, R-16, all development documentation.

---

## 15. Priorities

| Priority | Meaning | Items |
|---|---|---|
| P0 | Gates; may end or reshape the project | R-01, R-02, R-03, R-14, R-33, R-35, R-39, R-MOD-C, R-MOD-G, R-MOD-H |
| P1 | Needed to define MVP and architecture | R-04, R-05, R-06, R-08, R-09, R-10, R-11, R-13, R-15, R-16, R-17, R-24–R-28, R-32, R-34, R-36–R-38, R-40, R-MOD-A, B, E, L |
| P2 | Needed for complete documentation | R-07, R-12, R-18, R-19–R-22, R-29, R-31, R-MOD-D, F, I, J, K |
| P3 | Refinement | R-23, R-30, R-MOD-M |

---

## 16. Expected deliverables

All 67 documents named in brief §16 remain the target repository. Mapping from research to documents appears in each topic entry above. Additional documents will be created only where research shows a need (e.g., per-country compliance briefs, a Wallet-and-Payout Legality brief, a Hierarchy Storage Benchmark). No empty placeholder documents will be created. A final **Documentation Completeness Report** and **Cross-Document Consistency Audit** close the project (Stage 9).

---

## 17. Research limitations (stated upfront)

1. **No primary research has been conducted.** All findings are desk research. Problem frequency and willingness-to-pay remain hypotheses until interviews or surveys happen.
2. **Vendor sites rarely publish pricing.** Many MLM software vendors use "contact sales." Price benchmarks will be sparse; gaps will be marked, not guessed.
3. **Market-size data is dominated by industry-association and commercial reports** with differing definitions and methodologies; they may not align and may be self-interested.
4. **Community evidence is biased** toward vocal and dissatisfied users and may over-represent small operators and developer-shop customers.
5. **Legal research is not legal advice.** Statutes change and enforcement is context-dependent. Every jurisdiction conclusion must be confirmed by qualified local counsel before launch.
6. **Language and access:** Some regulatory and market sources are non-English or not indexed. Gaps will be listed.
7. **Cutoff and recency:** Findings are current to the access date in the source register; the market moves.
8. **Tool limits:** Some sites decline automated retrieval or sit behind paywalls; these are logged as gaps, not bypassed.
9. **Scale:** 67+ documents cannot all be evidenced equally in one pass. The roadmap sequences them by decision value; later-stage documents will say so if upstream evidence is incomplete.

---

## 18. Validation requirements (what desk research cannot settle)

| ID | Item | Proposed validation | Needed before |
|---|---|---|---|
| V-01 | Willingness to pay of target segment | 10–15 structured interviews with owners/operators in the chosen first market; pricing-sensitivity questions | Pricing finalization, business case |
| V-02 | Frequency and cost of commission errors | Interviews with finance/operations roles; request anonymized reconciliation examples | MVP lock |
| V-03 | Distributor mobile usage and tooling | Short survey and observation sessions with distributors/leaders | UX design |
| V-04 | Legal conclusions per target market | Review by local counsel | Launch |
| V-05 | Payout rails practicality | Provider sandbox tests and written confirmations | Module H build |
| V-06 | Large-tree performance | Benchmark prototype with synthetic networks of 1M+ nodes | Architecture sign-off |
| V-07 | Migration difficulty from incumbents | Interviews with companies that switched; vendor export documentation | Go-to-market |
| V-08 | Willingness to adopt AI features | Concept tests with leaders and operators | Module M scope |

Interview guides and survey instruments will be drafted under R-37. They will be labeled **designed, not conducted**.

---

## 19. Quality gates for this plan

- Every research topic has an ID, priority, dependency, output.
- All 34 research items in the brief are covered (R-01–R-34), plus R-35–R-40 and R-MOD-A–M added by this plan.
- The plan challenges the brief (Section 2) rather than echoing it.
- Limitations and validation needs are explicit.

**Next:** execute per 00_RESEARCH_EXECUTION_ROADMAP.md, starting with Wave 1 (R-01, R-35 early screen, R-02 initial sizing, R-03.0 competitor verification).
