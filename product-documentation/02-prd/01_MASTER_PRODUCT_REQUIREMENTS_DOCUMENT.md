# 01 — MASTER PRODUCT REQUIREMENTS DOCUMENT
## What is being built and why

| Field | Value |
|---|---|
| Document ID | PRD-01 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Product (senior PM role) |
| Depends on | SYN-00, PD-01..03 |
| Companion documents | PRD-02 functional requirements · PRD-03 non-functional · PRD-04 business rules · PRD-05 stories · PRD-06 acceptance criteria · PRD-07 MVP and roadmap |
| Status | Draft. Not approved. Built on founder choices DEC-01 and DEC-02 |

## 1. Executive summary

| Item | Statement |
|---|---|
| **Product** | A compliance and compensation back end for direct-selling companies, delivered as (A) a compliance-analytics overlay on the operator's existing data and then, conditionally, (B) an API-first commission engine with genealogy, ledger, payouts, tax and native compliance reports |
| **Editions** | Sold as a digital product in two editions from one codebase (DEC-17): **hosted SaaS** (primary; MVP-A and MVP-B launch here) and a **licensed self-hosted edition** (single-tenant installation run by the buyer; V1) |
| **Vision** | Operators can prove what they pay and why |
| **Business objectives** | Prove demand before building the engine; reproducible, reconcilable pay; safe switching; lower cost of plan change (PD-01 §3) |
| **Target customers** | Licensed or registered direct-selling companies; mid-market first (hypothesis); launch market undecided |
| **Target users** | Compliance officer, commission analyst, finance approver and payout officer, plan administrator, support agent, owner; distributors and team leaders through a portal; vendor operations staff |
| **Core problems** | Compliance figures are not computed from transaction data; pay is hard to reproduce and explain after corrections, refunds and plan changes; money integrity (rounding, caps, clawbacks, payout failures); market launch blockers (providers, tax, privacy); switching fear |
| **Solution** | Reports with population, method and drill-down; bitemporal genealogy; period lifecycle with replay; scoped caps and money rules; double-entry obligations ledger; idempotent payouts through the tenant's providers; market packs; migration with parallel-run proof; statements that explain themselves |
| **Differentiation** | Compliance analytics from transaction data (unproven demand); explainable pay; proven migration; tenant-visible vendor access. Reversals, simulation and approvals are hygiene, not differentiators |

## 2. Business context

| Topic | Summary | Source |
|---|---|---|
| Industry | Direct selling pays independent participants on product volume through multi-level plans. Regulators judge what money is paid for and how much rests on real retail sales, not the plan's label | Research 12, 13 §6 |
| Enforcement and outcomes | US self-regulatory monitoring flagged 2,966 income posts and 792 health posts in 2025; a US survey found 47% of former participants lost money; one company's full-year median commissions were $466.56 | G-S15, G-S16, G-S27 |
| Market opportunity | **Not sized.** The research refuses a market-size figure; an order-of-magnitude bound of tens of millions of dollars a year across three markets is an illustration only. No willingness-to-pay evidence exists | Research 02; A-11 |
| Existing alternatives | Enterprise back offices (Exigo, which owns DirectScale; ByDesign; InfoTrax); low-price licences (Infinite MLM, Epixel and local developers); commerce-first entrants that keep the comp plan elsewhere (Fluid); specialists in claims monitoring and messaging; spreadsheets and SQL | Research 03; gap audit 19 |
| Competitive position | Narrow: compliance analytics first; then engine depth, provenance, migration proof behind any storefront | PD-01 §4 |
| Business model | Tenant: product sales with multi-level compensation. Platform: per active payee plus fixed-scope implementation (provisional) | PD-02 §5 |
| Revenue opportunities | Paid pilots (MVP-A); subscriptions; implementation and migration packages; compliance module add-on | PD-02 §5 |
| Strategic priorities | 1 Phase A blockers; 2 MVP-A demand test; 3 technical spike; 4 MVP-B with one design partner | PD-02 §2 |

## 3. User research summary

**No user has been interviewed.** PR-01 is built from three job postings; the rest are hypotheses. Fields the research marks unverified are shown as such; nothing is filled in by invention.

| Persona | Role | Goals | Responsibilities | Pain points | Needs | Motivations | Technical proficiency | Devices | Success criteria |
|---|---|---|---|---|---|---|---|---|---|
| **Commission analyst** (PR-01, document-based) | Runs, audits and supports commission calculation | Timely, accurate runs; changes that do not break payouts | Weekly and monthly runs; clean-up; reconciliation; test scenarios; fraud research; market launches | *Hypothesis:* manual exceptions, fragile macros, waiting for a vendor to change rules, no test before payout | Trace from line to inputs; run-to-run comparison; exception lists | *Hypothesis:* right to the cent | High (SQL, Excel, APIs) | Desktop assumed | On-time runs with no discrepancies |
| **Finance approver / payout officer** (PR-02, hypothesis) | Approves payouts, reconciles, tax, providers | Right people, right amount, once; clean audit | Batch approval; reconciliation; tax documents | Reversals after returns; manual reconciliation; tax documentation | Batch totals, variance, statements, provider status | Control, audit-readiness | Moderate to high with finance tools | Unverified | Zero duplicate payments; reconciliation closes |
| **Compliance officer** (PR-03, hypothesis) | Reviews plans and claims; filings; regulator requests | Stay within the law; produce evidence | Retail-sale data; earnings claims; grievances; filings | Assembling evidence from several systems; no preview of a plan change's compliance effect | Retail share, purchase-to-qualify flags, payout sources, disclosure data | Avoid enforcement | Moderate; wants reports not queries | Unverified | A request is answered from the system |
| **Owner or CEO** (PR-04, hypothesis) | Chooses and pays for the platform | Growth; no legal trouble; predictable change cost | Strategy, plan design, vendor selection | Cost and time of change; migration fear; surprise charges | Overview with definitions; simulation; predictable cost | Predictability | Low to moderate | Unverified | Changes in days; no regulatory finding |
| **Plan administrator** (added) | Configures plan versions | Change without custom code | Rules, caps, simulation, governance | — (hypothesis) | Plain-language rules; payee-level impact | — | High | Desktop | Activation without defects in parallel run |
| **Support agent** (added; brief only) | Answers pay, genealogy and privacy questions | Answer without engineering | Search, cases, statements | — (hypothesis) | Trace; masked data; cases | — | Moderate | Desktop | Handle time; first-contact resolution |
| **Distributor** (PR-05, hypothesis; cannot be one persona) | Buys, sells, may recruit, earns commissions | *Do not assume income* (median earnings in sources are very low) | Order, sell, follow up | *Hypothesis:* understanding rank and pay; payout timing | "Why was I paid this"; rank status; statements | Unverified | Unverified, likely widely varied | Unverified (mobile assumed, not evidenced) | **Not** defined as higher income |
| **Team leader** (PR-06, hypothesis; no need evidenced) | Builds and coaches a team | — | — | Vendor content only | Privacy-limited team view | — | Unverified | Unverified | Unverified |
| **DPO** (added) | Privacy duties | Meet deadlines | Requests, breach contacts | — | Request tooling | — | Moderate | Desktop | Requests closed in time |
| **Implementation consultant** (added) | Onboards tenants | Go live when payouts match | Import, configure, parallel run | — | Mapping, validation, difference report | — | High | Desktop | Zero unexplained differences |
| **Vendor operations staff** (added, ST-25) | Runs the platform | Operate without standing access | Provisioning, support sessions, packs | — | Console without business data | — | High | Desktop | No access outside sessions |
| **Retail customer** (PR-07) | Buys product | — | — | One consumer case | **Not a user of this product**; a data subject with rights | — | — | — | — |

Interview guides that would convert each hypothesis exist in the research (66 Appendix A) and have not been fielded.

## 4. Product scope

| Scope | Content |
|---|---|
| **In scope** | The modules of PD-03 §2 |
| **Out of scope** | Native storefront and checkout; product catalogue beyond a volume map; inventory and warehouse; LMS and video; marketing automation and social feeds; events; general ledger and accounts payable; social-media monitoring; help desk; wallets, e-pins and crypto; income projection; recruit leaderboards; lead scoring; tenant-specific code |
| **MVP-A** | Tenant and region; sign-in, MFA, roles; vendor support sessions; export upload, validation, mapping, load; reports R1–R5 with snapshots and drill-down; audit log and export logging; breach contacts; vendor console. **18 requirements** |
| **MVP-B** | Participants and types; positions and bitemporal genealogy with cases and visibility; order ingestion with connectors, returns, late queue; attribution; plan versions, primitives, extension point, caps, simulation, golden datasets, governance, transitions; period lifecycle, runs, review, commit, trace, replay, restatement; ledger, clawbacks, write-offs, GL export; payouts with adapters, reconciliation, bank-detail controls; tax profile and (per market pack) withholding and forms; cases; distributor portal; privacy requests; guardrails; public API, webhooks, sync health, full export; dashboards; migration and parallel run. **85 requirements** including 4 market-pack items |
| **Version 1** | **Self-hosted edition**: licence entitlement, signed updates and market packs, installer, diagnostics and support bundle (FR-LIC-001..003); non-cash credits; multi-currency; disclosure publication; integrity signals; claims feed; account types and transfers; subscription events; provisional runs; retention timers; analytical replica; archive; contacts and reminders; leader dashboard; variance explainer; internal configuration assistant; read-only SQL connector for the overlay. **19 requirements** |
| **Version 2** | Natural-language reporting; support assistant; forecasting; rule-based then model-based anomaly detection |
| **Enterprise** | Multi-brand tooling and genealogy merges; dedicated regional cells; external attestation (SOC 2 or ISO 27001); read replica for all dedicated tenants |
| **Future opportunities** | Provider-hosted payout accounts through a licensed partner (payout Option 2, after counsel); tenant-facing configuration assistant; non-MLM direct-selling tools (separate study) |

## 5. Functional requirements

`02_FUNCTIONAL_REQUIREMENTS.md`: 122 requirements in 23 modules, each with ID, description, justification, role, preconditions, trigger, inputs, processing, outputs, rules, validation, errors, permissions, dependencies, priority and acceptance criteria.

## 6. User stories and acceptance criteria

`05_USER_STORIES.md` (58 stories) and `06_ACCEPTANCE_CRITERIA.md` (102 criteria).

## 7. Business rules

`04_BUSINESS_RULES.md`: 119 rules with basis and status; unresolved rules listed separately and not invented.

## 8. Non-functional requirements

`03_NON_FUNCTIONAL_REQUIREMENTS.md`. Every numeric target is a **proposal** to be validated at the Phase C spike or set by the founder.

## 9. Reporting and analytics requirements

Calculation definitions are fixed here so every screen and export uses the same one. All monetary figures are in the market currency, minor units internally. Every dashboard figure links to its definition.

| Audience | Dashboard or report | Metrics | Filters and dimensions | Permission | Release |
|---|---|---|---|---|---|
| Executives | Executive overview (SC-35) | Net sales; active earners; payout total and **payout as share of net sales**; retail-customer share; net change in active positions | Period, market, brand | `dashboard.exec` | B |
| Compliance officer and executives | Compliance overview and reports (SC-46, SC-10) | R1–R5 (below); guardrail warnings; open compliance cases | Period range, market; drill-down | `compliance.read` | A |
| Company administrators | Integration health (SC-13); audit log (SC-30); vendor sessions (SC-14) | Sync lag, error count, reconciliation differences; audit events; session logs | Connector, time, actor | `integration.read`, `audit.read` | A/B |
| Commission analysts ("sales managers" in the brief have no evidenced need; see OQ-20) | Periods and runs (SC-01); run review (SC-02) | Run totals; variance by bonus; top movers; exceptions; late-transaction count | Period, calendar, bonus, market | `run.review` | B |
| Finance managers | Finance dashboard and ledger (SC-33); payouts (SC-03, SC-34) | Payable, in transit, receivable, withholding payable, residue, write-offs; failed and returned payouts; dormant balances | Period, market, account, provider | `ledger.read`, `payout.*` | B |
| Team leaders | Team (SC-20); leader dashboard V1 | Counts and volume aggregates within visibility policy; V1: customers served, repeat-order rate | Own downline only | Self downline | B / V1 |
| Distributors | Home, statements, rank, customers (SC-37, 18, 19, 21) | Gross, withholding, clawback, adjustment, net; paid-as rank and titles; customers with last order and repeat indicator | Period | Self | B |
| Customer support | Search, participant record, cases (SC-36, 09, 06) | Case counts by type and state; response time against deadline | Type, state, assignee | `case.*` | B |

**Calculation definitions**

| Metric | Definition | Notes |
|---|---|---|
| Net sales | Σ (order amount − refunded amount) for orders credited in the period, excluding tax | From compliance facts |
| R1 retail-customer share | Net sales to buyers whose participant type is flagged *counts as end customer* ÷ net sales | Second figure adds participant orders with purpose *resale* |
| R2 personal-use share of rewarded volume | Volume of distinct source orders tagged *personal* behind positive payout lines of source kind *downline volume* ÷ volume of all such source orders | Unknown-purpose share reported beside it |
| R2 flagged payees | Payees whose multi-level pay from personal-use orders exceeds the tenant threshold × their multi-level pay | Threshold is the tenant's counsel's decision |
| R3 payout source mix | Σ payout lines by source kind ÷ Σ payout lines excluding clawbacks | Clawbacks shown separately |
| R4 active with no customer order | Distributors meeting the plan's own-purchase activity rule with zero attributed customer orders ÷ active distributors | Indicator only |
| R4 late threshold crossings | Orders on or after the configured day that move the buyer's cumulative personal volume across a rank threshold; count later refunded | Indicator only |
| R5 earnings distribution | Population: all participants with an earning type enrolled on or before year end. Earnings: Σ payout lines net of clawbacks, zero if none. Share above zero, mean, median, percentiles, bands | Gross, before expenses |
| Active earner | A participant with at least one positive committed result line in the period | Also the billing unit candidate |
| Payout as share of sales | Σ committed gross result lines ÷ net sales | — |
| Variance | Current run total − previous committed run total of the same calendar, by bonus type | — |

**Not provided by design:** income projections, "what you could earn", recruit counts as leaderboards (BR-HON-01).

## 10. Integration requirements

Detail in `03-trd/05_INTEGRATION_REQUIREMENTS.md`.

| Integration | Direction | Data | Trigger | Failure handling | Security | Release |
|---|---|---|---|---|---|---|
| Back-office export (overlay) | In | Participants, orders, payout lines (pseudonymised) | Upload | Reject whole batch with row report | Forbidden-column check; region-bound storage | A |
| Commerce (Shopify, WooCommerce, generic API) | In | Orders, lines, refunds, customers, attribution hints | Webhook; reconciliation poll | Idempotent upsert; exception queue; backfill | Signature verification; scoped keys | B |
| Payout providers and bank files | Out and in | Instructions; settlement, return and failure events | Batch approval; webhook or report | Outbox, same-key retry, status query, reconciliation | Signed instructions; allow-list; tenant-owned credentials in secrets manager | B |
| Tenant ERP | Out | Period journal | Period commit or close | Re-downloadable export | API key | B |
| Identity provider and tenant SSO | Both | Authentication | Sign-in | Retry page | OIDC; MFA | A |
| Messaging (email; SMS or chat by tenant provider) | Out | Notifications | Domain events | Retry; fallback for security notices | Tenant-owned sender | B |
| Tenant data warehouse | Out | Full data model | Schedule | Retry; manifest | Region-bound destination | B |
| Claims-monitoring partners | Out | Approved claims; disclosure figures | Change events | Webhook retries | HMAC | V1 |

## 11. Success metrics

| Area | Metric | Definition | Target |
|---|---|---|---|
| Demand (MVP-A) | Budget commitments; data commitments | FD-10 rule | ≥ 3 and ≥ 2 (proposed) |
| Product adoption | Snapshots created per tenant per month; share of staff roles active monthly | — | Baseline at first tenant |
| Activation | Time from first upload to first ready snapshot (A); time from history import to first parallel run (B) | — | Baseline; founder to set |
| Retention | Tenants renewing; logo churn | — | Set with pricing |
| Customer satisfaction | Buyer satisfaction after go-live; support tickets about the platform per tenant | — | Baseline |
| Distributor productivity | **Defined as** retail customers with a repeat order in 90 days per active distributor (candidate, to validate); never recruits or sessions | GAP-050 | None until validated |
| Operational efficiency | Hours to close a period; manual adjustments per 1,000 payees; pay-related support contacts per 1,000 payees | — | Baseline with design partner |
| Sales conversion | Not a platform metric (commerce is integrated) | — | — |
| Revenue | Per pricing model once decided | — | FD-03 |
| Platform reliability | Availability; failed runs; duplicate payments; unexplained ledger difference; replay mismatches | PRD-03 | 99.9% (proposed); 0; 0; 0; 0 |

## 12. Risks and dependencies

Full list in PD-02 §7–§8. The five that can stop the product: no willingness to pay (R1); provider refusal (R2); vendor liability (R3); plan long tail making each tenant a custom build (R5); performance at scale unproven (R6).
