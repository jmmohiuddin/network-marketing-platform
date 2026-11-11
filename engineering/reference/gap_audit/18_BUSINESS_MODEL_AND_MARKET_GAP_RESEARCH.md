# 18 — BUSINESS MODEL AND MARKET GAP RESEARCH
## The platform's own business model, the segment choice, and alternative positionings

| Field | Value |
|---|---|
| Document ID | GAP-18 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 12 |
| Gaps | GAP-075 to GAP-077 |
| Rule | No revenue, cost or market-size figure is invented. Where economics are discussed, inputs are named and left blank for the founder or for interviews |

## 1. What the original research established, and what it did not

| Established | Not established |
|---|---|
| The software buyer is the direct-selling company (A-01) | **How the platform makes money** (12 deferred it to Wave 4; never done) |
| Displayed price anchors from $699 one-time to $5,000/month (02 §5.2) | Contract values, services revenue, payment-related revenue |
| A three-market bound in the tens of millions a year (02 §5.2) | Founder's threshold (OQ-04) — still unanswered |
| Breadth is table stakes (05 §3) | What would make a buyer switch |
| Best candidate segment S2 in Malaysia and India (hypothesis) | Competition in those markets, founder access, cost to serve |

## 2. Gap records

### GAP-075 — Platform business model and cost to serve are absent; the priority markets have strong low-price competition

| Field | Content |
|---|---|
| **Category** | Strategy, commercial |
| **Previous research coverage** | 02 §5 (sizing method), 12 §0 item 7 (pricing linked to volume would tie vendor income to recruitment volume) |
| **Missing element** | Pricing model, implementation and migration revenue, cost to serve per tenant, gross margin logic, and the competitive price floor in India and Malaysia |
| **Evidence** | Implementation and change cost dominate reviews (03 §6); the largest low-price vendor is **headquartered in Calicut, India**, claims 3,000+ MLM customers and expanded to Malaysia in 2023 (G-S06); Malaysian developers sell MLM systems (G-S19); WordPress/WooCommerce MLM plug-ins exist (G-S24); one-time licences start at $699 (S-096) |
| **Why it matters** | In India and Malaysia a new SaaS vendor competes on price with local developer shops and one-time licences; a configurable engine is expensive to implement per plan. Without a cost-to-serve model, pricing could lose money on every tenant |
| **Affected stakeholders** | Founder, investors |
| **Product implications** | Features that cut implementation time (plan corpus primitives, configuration assistant GAP-071, migration tooling GAP-077) are **margin features**, not nice-to-haves |
| **Technical implications** | Multi-tenant efficiency; no tenant-specific code |
| **Recommended solution** | Build a unit-economics sheet with the inputs in §4 filled from interviews (G-EXEC price questions; G-OPS implementation questions); decide the pricing model in §5 before MVP scope |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | High (that it is missing and that competition is real) |
| **Documentation changes required** | 12 (add platform model), 02 §6 (add competition column), future 16, 17, 47 |

### GAP-076 — The segment and market choice is weakly grounded; founder access decides it

| Field | Content |
|---|---|
| **Category** | Strategy |
| **Previous research coverage** | 02 §6 qualitative screen; 05 §4 segment view; OQ-01, OQ-08 open |
| **Missing element** | The weighted screen promised in the Master Plan §10, including "our access and localisation cost" and competitive intensity |
| **Evidence** | Access criterion unscored (66 OQ-08); competition not searched (U-15) and now shown to be strong (G-S06, G-S19); tax and privacy duties differ by market (G-S10..G-S14) |
| **Why it matters** | A first market without founder access means slow, costly sales and no interviews (OQ-06 is still open) |
| **Affected stakeholders** | Founder |
| **Product implications** | Launch market decides language, tax, residency and provider work in the MVP |
| **Technical implications** | Residency (GAP-061), tax (GAP-031), providers (GAP-004) |
| **Recommended solution** | Re-score candidate markets on §3; the founder supplies the access column. If the founder has no access in Malaysia or India, the recommendation changes (33) |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | Medium |
| **Documentation changes required** | 02 §6, 66 OQ-01, OQ-08 |

### GAP-077 — Migration and implementation as product

| Field | Content |
|---|---|
| **Category** | Commercial, operational |
| **Previous research coverage** | P-18 (migration risk, Medium); J-01 (parallel run) |
| **Missing element** | Treating migration tooling and services as a core offer and a switching lever |
| **Evidence** | Vendor content says fear of moving commission and genealogy history is "the primary roadblock" (S-137, vendor); one failed go-live in reviews (S-098); Exigo owns DirectScale (S-090) — a consolidation that may push some customers to re-platform [HY] |
| **Why it matters** | A buyer's switching cost is the barrier every entrant must lower |
| **Affected stakeholders** | Tenants switching platforms |
| **Product implications** | Import of genealogy history, rank history and carry balances; **parallel-run reconciliation report** (old vs new payouts per payee); data-export guarantee on exit (GAP-096) |
| **Technical implications** | Import mapping framework; comparison engine reusing the simulation harness (GAP-026) |
| **Recommended solution** | Price migration as a fixed-scope package; make the parallel-run report a sales asset |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | Medium |
| **Documentation changes required** | 06 P-18, 10 J-01 |

## 3. Market re-screen criteria (founder fills the access column)

| Criterion | United States | Malaysia | India | Note |
|---|---|---|---|---|
| Channel size and trend | Largest, falling (S-001) | 5th, growing | Growing | Original 02 |
| Lawful framework | Yes | Licensed | Rules | Original 51 |
| Company count | 660+ (2021) | ~400 licensed | 461+ | Original 02 §5.1 |
| Price competition | Enterprise incumbents; mid-market vendors | Indian and local developers (G-S06, G-S19) | **Home of low-price vendors** (G-S06) | New |
| Compliance demand driver | FTC NPRM 2025, DSSRC monitoring (G-S03, G-S15) | Licence filings (S-043), Act amendments pending (G-S11) | Rules 2021 (S-085) | New |
| Payout tax step | 1099 (G-S05) | 2% WHT + CP58 (G-S12) | TDS 2% (G-S13) | New |
| Data duties | State laws [UV] | PDPA amended; processor DPO (G-S14) | DPDP from May 2027; residency [UV] (G-S10) | New |
| Payment-provider eligibility | Specialists exist (S-091) | [UV] | [UV] | New (GAP-004) |
| **Founder access** | ? | ? | ? | **Founder** (OQ-08) |
| **Language and time-zone fit for the founder's team** | ? | ? | ? | **Founder** |

## 4. Unit-economics inputs (to be filled, not estimated here)

| Input | Source to fill it |
|---|---|
| Implementation hours per plan (by plan complexity) | Prototype on the plan corpus (GAP-020); vendor and operator interviews |
| Migration hours per tenant | Design-partner migration |
| Support hours per tenant per month | First tenants |
| Infrastructure cost per tenant per month (pooled vs dedicated) | Benchmark (08 §6, 15) |
| Payment-provider and tax-reporting third-party costs | Provider quotes |
| Achievable price by segment | G-EXEC interviews (current spend, budget owner) |
| Sales cycle length and cost | First pipeline |

**Rule:** a business case built before these inputs exist would be fabrication (Master Plan §5.4).

## 5. Pricing models considered

| Model | For | Against | Verdict [SR] |
|---|---|---|---|
| Percentage of sales volume | Scales with tenant size | **Ties vendor revenue to the tenant's volume, including recruitment-driven volume** (12 §0 item 7); unpredictable for buyers, whose top complaint is surprise cost (03 §6) | **Do not use** |
| Per active payee per month | Tracks cost to serve; understandable | Needs a precise, auditable definition of "active payee"; cost rises with the tenant's field size | **Primary candidate** |
| Flat tiers by payee bands | Predictable | Cliff effects | Candidate (simplest to sell) |
| Modular (engine; compliance analytics; migration) | Lets buyers start small | Complexity | Candidate as add-ons |
| Implementation and migration fees (fixed scope) | Covers cost to serve | Buyers dislike surprises | **Use, fixed-scope** |
| One-time licence | Matches low-end market | Poor fit for a hosted, regulated-data service | **Do not use** |
| Payments revenue share | Common in commerce platforms (Fluid has payments, G-S07) | Depends on MLM-eligible processors (GAP-004); adds regulatory scope | **Later**, only through a licensed partner |

## 6. Alternative positionings (input to 33)

| # | Positioning | Who buys | Why it might work | Why it might not | First test |
|---|---|---|---|---|---|
| P1 | All-in-one platform for mid-market in Malaysia and India (original direction) | Owners in S2 | Growing markets; licensing creates duties | Price competition at home of low-cost vendors; breadth is not a differentiator; founder access unknown | Interviews with licensed operators |
| P2 | **Compensation and compliance engine, API-first**, behind any commerce front end (Shopify, WooCommerce, Fluid) | Mid-market brands that already run commerce elsewhere | Market is unbundling (G-S07, G-S33); engine quality + provenance + caps + reversals is the hard part | Incumbents also integrate Shopify; engine alone is a smaller ticket | Partner conversations with commerce-first brands and with Fluid-type platforms |
| P3 | Migration and parallel-run tooling + service | Companies leaving legacy or in-house systems | Switching cost is the barrier (P-18) | Small, episodic market | Talk to companies that switched (V-07) |
| P4 | **Compliance analytics overlay** that reads an operator's existing back-office data (incumbents expose SQL access, G-S30, G-S31) and produces retail-share, personal-consumption share, payout-source and earnings-disclosure reports | Compliance officers and counsel | Fastest, cheapest way to test the one remaining whitespace (05 CL-02) without replacing anyone's back office | Adverse selection (05 CL-06); smaller ticket; depends on data access | Five compliance-officer interviews + a prototype on a design partner's export |
| P5 | Non-MLM direct-selling and affiliate tools (e.g., for markets where MLM is closed) | Single-level sellers, social sellers | Lawful where MLM is not | Crowded affiliate-software market (LeadDyno-class, 03 §7); different product | Separate study |
