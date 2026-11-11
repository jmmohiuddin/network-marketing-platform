# P3 — BRIEFS FOR COUNSEL AND A TAX ADVISER
## Self-contained question packs to send to a lawyer and a tax adviser in the launch market

| Field | Value |
|---|---|
| Document ID | PA-P3 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Task | Phase A, items 3 and 4 (GAP-031, GAP-085, GAP-087; FD-04, FD-05; AQ-01..AQ-06) |
| How to use | Pick the launch market (FD-02). Send Brief A to a direct-selling / consumer-protection lawyer there, and Brief B to a tax adviser there. Both are written to be read without the rest of the repository. Nothing has been sent |
| Confidentiality | Share under an engagement letter; the briefs contain no third-party personal data |

---

## Brief A — for counsel

### A.1 What we are building (one paragraph)

Software for **direct-selling companies** that calculates commissions from orders under each company's compensation plan, produces statements for distributors, and sends **payout instructions to the company's own payment provider**. The software company **does not hold, receive or move funds**. It also produces compliance reports from the company's data: the share of sales to non-participant customers, the share of rewarded volume from distributors' own purchases, the sources of each payout line, and earnings disclosures computed from actual payouts. Customers would be companies **licensed or registered** in [market].

### A.2 Our current design positions (please tell us where they are wrong)

| # | Position | Why we hold it |
|---|---|---|
| P1 | We do not hold participant funds, operate wallets, issue e-pins or pay in cryptocurrency | To stay outside money-transmission, e-money and prepaid-instrument regimes |
| P2 | Each customer company contracts with its own payment and payout providers | Providers decide merchant eligibility; several prohibit or restrict MLM merchants |
| P3 | The platform **blocks** configurations that pay solely for enrolling a person, and fees or deposits where the market prohibits them; it **warns** on starter kits carrying commissionable volume and on high personal-consumption shares; it **reports** retail share and earnings distribution | To avoid supplying the "means and instrumentalities" of an unlawful plan |
| P4 | We will not offer income projections or "what you could earn" tools | Misleading for typical participants |
| P5 | A refund after payout is recovered by deducting the commission paid on that order from future earnings (default), with full recalculation as an option | Matches documented industry practice; distributors are never debited directly |
| P6 | We act as a **data processor** for the customer company | The company decides why and how distributor data is used |

### A.3 Questions

| ID | Question | Why it matters to the design |
|---|---|---|
| **L-1** | Could a software vendor be exposed (aiding, facilitating, "promoting", or under consumer-protection law) if a customer's plan is later found to be a pyramid scheme? Does the exposure change if we (a) only report, (b) warn, (c) block certain configurations, or (d) review plans before onboarding? | Decides the guardrail stance (FD-06) and our customer acceptance policy |
| **L-2** | Does calculating commissions and sending payout instructions to the customer's provider require any licence or registration for us? What about integrating a provider-hosted wallet in which the provider holds the balances? | Confirms P1/P2; decides whether wallets can ever be offered |
| **L-3** | In a provider-hosted payout, should the customer company or our company be the provider's contracting party? Does either make us an agent for both payer and payee? | Contract structure for payouts |
| **L-4** | For [Malaysia]: which licence conditions, plan-amendment filings, cooling-off and buy-back duties under the Direct Sales and Anti-Pyramid Scheme Act 1993 must a licensed company be able to evidence from its systems? What is the status and content of the announced amendments? / For [India]: under the Consumer Protection (Direct Selling) Rules, 2021, which records, grievance timelines, disclosures and seller-identity duties must be supported by software, and does any rule require data to be stored in India? / For [US]: which state buy-back statutes and federal rules (including the FTC's January 2025 proposed earnings-claim rule) should our reports support? | Market compliance features in the first version |
| **L-5** | May a commission reversal after a product return change a closed period, or must it be an adjustment in the current period? How may a negative balance be recovered? Does a statutory buy-back affect commissions already paid to the upline? | Reversal rules |
| **L-6** | As a data processor serving companies in [market]: do we need our own data protection officer, breach-notification process and cross-border transfer basis? (Malaysia's amended PDPA binds processors from 2025; India's DPDP Rules apply from May 2027) | Privacy requirements for the first version |
| **L-7** | Can we lawfully erase a distributor's identity on request while keeping the commission ledger (pseudonymisation), given tax and audit retention duties? | Erasure design |
| **L-8** | Are there restrictions on our product's marketing (e.g., claims about compliance) or on using customer data in aggregate to improve the product? | Positioning and data use |
| **L-9** | What should our customer contract include: acceptance criteria for customers, right to suspend service for unlawful plans, indemnities, audit rights, exit and data return? | Contract template |

### A.4 What we can share

Product summary, data model outline, list of guardrails, sample statements and compliance reports (synthetic data), and our draft customer acceptance and product honesty policies.

---

## Brief B — for a tax adviser

### B.1 Context

Same product as A.1. The software computes each distributor's gross commission, any **tax to withhold**, and the net amount instructed for payment by the customer company. The customer company is the payer for tax purposes; the software prepares figures and year-end statements.

### B.2 Questions — Malaysia

| ID | Question | Basis we found (secondary) |
|---|---|---|
| **T-MY-1** | Does Income Tax Act 1967 s.107D (2% withholding on payments to agents, dealers and distributors) apply to commissions and bonuses paid by a licensed direct-selling company to individual distributors? | EY Malaysia tax alert, 7 Mar 2022 |
| **T-MY-2** | How is the RM100,000 prior-year threshold measured (per payer, monetary and non-monetary, calendar year)? Which non-monetary incentives (product credits, trips, cars) count? | Same |
| **T-MY-3** | What must a CP58 statement contain, when must it be issued, and can a software-generated statement be used? | Same |
| **T-MY-4** | Remittance (CP107D) timing and penalties; treatment of clawbacks after a payment was withheld | — |
| **T-MY-5** | Does a foreign software vendor selling subscriptions to Malaysian companies need to register for service tax on digital services? | Not researched |

### B.3 Questions — India

| ID | Question | Basis we found (secondary) |
|---|---|---|
| **T-IN-1** | Which TDS provision applies to commissions paid by a direct-selling entity to direct sellers (s.194H or another), at what rate and threshold today (we found 2% and Rs 20,000 per year), and the higher rate without PAN? | ClearTax summary |
| **T-IN-2** | Does the new Income-tax Act renumber or change this, and from when? | Reported; not verified |
| **T-IN-3** | Required certificates and returns (e.g., quarterly TDS returns and certificates) and what data the software must produce | — |
| **T-IN-4** | GST on distributor commissions (are registered distributors invoicing the company?) and on product credits | — |
| **T-IN-5** | Does a foreign software vendor selling to Indian companies need to register for GST on online services, and is any withholding applied to our fees? | Not researched |

### B.4 Questions — United States

| ID | Question | Basis we found (secondary) |
|---|---|---|
| **T-US-1** | Confirm the 1099-NEC/1099-MISC threshold for 2026 payments ($2,000 per secondary sources) and indexing from 2027 | Patriot Software summary of the 2025 law |
| **T-US-2** | Treatment of the direct-sales checkbox (products for resale of $5,000 or more) and of non-cash awards | — |
| **T-US-3** | Backup withholding when a payee has no valid TIN | — |
| **T-US-4** | State filing duties that software should support | — |

### B.5 What the answers change

Withholding is computed on every payout line, so each answer becomes a configuration rule (rate, threshold, basis, effective dates) and a test case before the first live run (rules BR-TAX-01..04; tests TS-18, TS-19 in the gap audit).
