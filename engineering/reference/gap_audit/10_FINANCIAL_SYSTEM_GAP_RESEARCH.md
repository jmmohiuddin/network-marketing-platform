# 10 — FINANCIAL SYSTEM GAP RESEARCH
## Ledger, tax, reversals, currencies and payouts: the lifecycle of money the platform calculates but never holds

| Field | Value |
|---|---|
| Document ID | GAP-10 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 4 |
| Gaps | GAP-030 to GAP-035 |
| Stance carried over | A-02: the platform calculates and instructs; it does not hold participant funds (51 §5.4 Option 1). This audit keeps that stance (05 CL-01, CL-09) |
| Not advice | Tax and legal items are screening-grade from Grade B sources; confirm with local tax advisers and counsel |

## 1. Five things that must not be confused

The brief asks to "clearly distinguish commission statements, internal ledgers, wallets, payment processing and regulated financial accounts". The original research separates them implicitly (51 §5.4); this table makes the boundary a design rule.

| Thing | What it is | Who owns the money | Platform role (MVP) | Regulatory exposure |
|---|---|---|---|---|
| **Commission statement** | A document showing a payee what they earned and why | — (a report) | Generate | Consumer and disclosure rules on content (CMP-05) |
| **Obligations ledger** | Double-entry record of what the **tenant owes** each payee, and of clawbacks owed back | The tenant (obligation, not cash) | **System of record** | Accounting accuracy; audit |
| **Wallet / stored value** | A balance a payee can hold, spend or withdraw | Whoever holds the funds | **None** (Option 3 excluded) | E-money, prepaid, money-transmission rules (51 §5.2) |
| **Payment processing** | Card acceptance (orders) and disbursement (payouts) | Licensed processor / bank | Integrate via adapters; never touch funds | Provider eligibility (GAP-004); PCI scope minimised by tokenisation |
| **Regulated financial account** | Bank or e-money account | Bank / e-money issuer | None | Licensing |

**Design rule:** the word "wallet" must not appear in the product for anything the platform records; use "earnings balance (owed by [tenant])". This avoids implying the platform holds value.

## 2. Gap records

### GAP-030 — No ledger design

| Field | Content |
|---|---|
| **Category** | Financial, technical |
| **Previous research coverage** | MH-REQ-01 (ledger records obligations), MH-REQ-02..05 (batches, adapters, reconciliation, reversals) |
| **Missing element** | Chart of accounts, posting rules, immutability, idempotency, reconciliation points |
| **Evidence** | Reconciliation and manual-adjustment duties at real operators (S-130, S-132); incumbents document payable adjustments, approvals and batch failures (G-S30) |
| **Why it matters** | Without double entry, totals cannot be proved; without idempotency, retried payout instructions pay twice |
| **Affected stakeholders** | Finance, auditors, distributors |
| **Product implications** | Balances per payee are **derived** from postings, never edited; every manual change is a posting with reason and approver |
| **Technical implications** | Append-only `journal_entry` + `posting` tables; each run, adjustment, payout instruction and settlement posts a balanced entry; idempotency keys on every external instruction and every inbound webhook |
| **Recommended solution** | Adopt the account set and postings in §3 as the starting design |
| **Priority** | **Critical** |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 51 §5.5 (MH-REQ-01..05), first database document |

### GAP-031 — Payout tax withholding and reporting in each launch market

| Field | Content |
|---|---|
| **Category** | Financial, compliance |
| **Previous research coverage** | P-15 and BR-PAY-07: US 1099 only; thresholds "may have changed" |
| **Missing element** | Withholding at payout in the priority markets; current US thresholds |
| **Evidence** | **Malaysia:** ITA 1967 s.107D, 2% withholding on monetary payments to resident individual agents, dealers and distributors who received more than RM100,000 from the payer in the preceding year; remitted within 30 days (CP107D); reported on **CP58** (G-S12, EY, 2022). **India:** TDS on commission under s.194H at 2%, threshold Rs 20,000 a year, 20% without PAN (G-S13; applicability to direct-seller commissions to be confirmed by a CA). **US:** 1099-NEC/MISC threshold $2,000 for 2026 payments, indexed from 2027 (G-S05) |
| **Why it matters** | Withholding changes the **net amount** on every payout line; getting it wrong creates tax liability for the tenant and wrong pay for the distributor |
| **Affected stakeholders** | Tenant Finance, distributors, tax authorities |
| **Product implications** | Tax profile per payee (resident status, tax ID such as PAN, prior-year totals per payer); withholding line on statements; year-end forms (CP58, Form 16A-type certificates, 1099) |
| **Technical implications** | Tax rules as effective-dated, market-scoped configuration; withholding computed after gross commission and before payout instruction; withheld amounts post to a liability account for remittance |
| **Recommended solution** | For the chosen launch market only, specify withholding and reporting with a local adviser **before** MVP scope is frozen |
| **Priority** | **Critical** (for whichever market launches first) |
| **Implementation stage** | MVP |
| **Confidence** | Medium-High |
| **Documentation changes required** | 06 P-15, 15 BR-PAY-07, 51 (new tax section), 66 (new OQ-12 tax adviser) |

### GAP-032 — Negative balance and clawback policy

| Field | Content |
|---|---|
| **Category** | Financial, compliance |
| **Previous research coverage** | EX-8, D-R3, Q-10 |
| **Missing element** | The options, their accounting, and evidence of incumbent practice |
| **Evidence** | DirectScale deducts the commission paid on a refunded order from the next commission check (G-S29). 09 T5 shows order-line clawback can under-recover when ranks or matching depended on the order |
| **Why it matters** | It decides who bears the cost of a refund, and how distributors experience it |
| **Affected stakeholders** | Distributors, uplines, Finance, Compliance |
| **Product implications** | Policy per tenant per market: (a) order-line clawback against future earnings; (b) restatement; (c) write-off below a threshold; (d) carry a receivable with an age limit. Statements show clawbacks as separate lines |
| **Technical implications** | Clawback receivable account per payee; netting rule; write-off posting with approval |
| **Recommended solution** | Offer (a) as default, (b) as an option for bonuses with rank dependencies, and a write-off threshold; never collect from a distributor's bank account in the MVP |
| **Priority** | High |
| **Implementation stage** | MVP (decision and default) |
| **Confidence** | High |
| **Documentation changes required** | 15 BR-REV-02, -03; 51 Q-10 |

### GAP-033 — Boundaries and accounting integration

| Field | Content |
|---|---|
| **Category** | Financial |
| **Previous research coverage** | 51 §5.4 (options) |
| **Missing element** | Whether the platform needs an accounting subsystem |
| **Evidence** | Operators already run ERP/accounting systems (SAP named in postings, S-130..S-132) |
| **Why it matters** | Building a general ledger duplicates what every tenant already has and invites audit scope |
| **Affected stakeholders** | Finance |
| **Product implications** | Period-end **journal export** (commission expense, payable, withholding liability, clawback receivable) mapped to the tenant's chart of accounts |
| **Technical implications** | Sub-ledger only; export by file and API |
| **Recommended solution** | Sub-ledger + GL export in MVP; no general ledger, no AP module |
| **Priority** | Medium |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | Module H scope (future) |

### GAP-034 — Multi-currency and exchange-rate history

| Field | Content |
|---|---|
| **Category** | Financial |
| **Previous research coverage** | BR-CMP-09 (policy), MH-REQ-06 |
| **Missing element** | Rate source, rate time, conversion step, history, rounding |
| **Evidence** | Points-to-currency factors in real plans (G-S26); multi-market plans (S-121) |
| **Why it matters** | A plan paying on volume earned in several currencies is ambiguous without a defined conversion step |
| **Affected stakeholders** | Finance, distributors in several markets |
| **Product implications** | Statement shows original and converted amounts and the rate |
| **Technical implications** | Effective-dated rate table with source; conversion performed once at a defined step; FX difference account |
| **Recommended solution** | MVP in one currency per tenant; design the rate table now |
| **Priority** | Medium |
| **Implementation stage** | V1 |
| **Confidence** | Medium |
| **Documentation changes required** | 15 BR-CMP-09 |

### GAP-035 — Payout failures, returns, unclaimed funds and bank-detail changes

| Field | Content |
|---|---|
| **Category** | Financial, security |
| **Previous research coverage** | MH-REQ-02 lifecycle includes "failed" |
| **Missing element** | Returned payments, retries, unclaimed balances, dormant payees, and controls on bank-detail changes |
| **Evidence** | DirectScale documents "Resolving Batch Failures" (G-S30); manual direct-deposit handling (S-132) |
| **Why it matters** | Bank-detail changes are a classic payout-fraud vector (16); unclaimed balances can become legal liabilities in some jurisdictions [UV] |
| **Affected stakeholders** | Finance, distributors, Security |
| **Product implications** | Cooling-off on new bank details before first payout; notification to the payee on change; returned-payment queue; dormant balance report |
| **Technical implications** | Payout states extended: instructed → accepted → settled / returned / failed → re-instructed; reconciliation against provider reports |
| **Recommended solution** | Include these states and controls in MVP |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 51 MH-REQ-02, MH-REQ-04 |

## 3. Starting account set and postings (obligations sub-ledger)

| Account | Type | Meaning |
|---|---|---|
| Commission expense | Expense (tenant) | Gross compensation earned |
| Payee payable (per payee) | Liability | Owed to the payee, not yet instructed |
| Withholding tax payable (per market) | Liability | Withheld, to remit to the tax authority |
| Payout in transit | Liability (clearing) | Instructed, not yet settled |
| Clawback receivable (per payee) | Asset | Owed back by the payee after a reversal |
| Rounding residue | Expense/clearing | Cents from allocation (09 T1, T2) |
| Non-cash credit liability (per credit type) | Liability | Product credits outstanding (GAP-024) |
| Write-off | Expense | Clawbacks not recovered |

| Event | Debit | Credit |
|---|---|---|
| Run committed: gross 100 for payee P, 2% withholding | Commission expense 100 | Payee payable 98; Withholding payable 2 |
| Payout instructed | Payee payable 98 | Payout in transit 98 |
| Provider confirms settlement | Payout in transit 98 | (Tenant bank, outside the platform: export only) |
| Payout returned | Payout in transit 98 | Payee payable 98 |
| Refund after payout, clawback 40 | Clawback receivable 40 | Commission expense 40 |
| Clawback netted against next run of 25 | Payee payable 25 | Clawback receivable 25 |
| Write-off of remaining 15 (approved) | Write-off 15 | Clawback receivable 15 |

Every entry carries run id, rule id, approver and idempotency key. Balances are sums of postings; nothing is edited.
