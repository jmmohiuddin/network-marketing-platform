# 24 — MISSING BUSINESS RULES
## Draft rules to add to the original catalogue (15), with basis and status

| Field | Value |
|---|---|
| Document ID | GAP-24 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Convention | Same as original 15: rules state capabilities; **no parameter values are set**. **At:** P platform · T tenant · M market · V plan version. **Basis status:** `S` screening (secondary source) · `R` primary read · `D` design rule (our judgement) · `C` needs counsel |
| Count | 71 new rules in 17 rule groups (including extensions of the original BR-RNK, BR-REV, BR-PAY and BR-DAT groups) |

## BR-GEN — Genealogy (GAP-002, GAP-010, GAP-013)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-GEN-01 | A participant may own one or more positions; volume and qualification are evaluated per position unless the plan says per participant | V | G-S25 | R |
| BR-GEN-02 | Sponsor and placement relationships are separate, each with valid-from and valid-to dates, and are never updated in place | P | 08 §4 | D |
| BR-GEN-03 | A **change** takes effect from an approved future or current date and never alters committed periods | P | 08 §4 | D |
| BR-GEN-04 | A **correction** records the original valid date; committed periods it affects are flagged and handled by the restatement policy (BR-PER-05) | P, T | 08 §4 | D |
| BR-GEN-05 | Change windows (e.g., placement change allowed for n days after enrolment) and approval requirements are plan-version parameters | V | G-S25, G-S26 | R |
| BR-GEN-06 | Placement into a binary or matrix position is serialised per target leg; tie-break is deterministic and recorded | P | 08 S6 | D |
| BR-GEN-07 | Termination changes position status; the tree structure is not modified to implement compression, roll-up or breakaway | P | GAP-013 | D |
| BR-GEN-08 | Re-parenting of a terminated position's downline (if the plan requires it) is a dated change event with a stated rule per plan version | V | BR-TRM-03 | D |
| BR-GEN-09 | Duplicate-account suspicion (shared identity, payment instrument, address, device) blocks activation pending review where the tenant enables it | T | GAP-002, T8 | D |
| BR-GEN-10 | Succession, divorce division and sale of a distributorship are transfers of position ownership with documents and approval; history stays with the position | T | GAP-002 | C |

## BR-PER — Periods and retroactivity (GAP-023)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-PER-01 | Each plan defines one or more calendars (weekly, monthly, quarterly) and the time zone of each cut-off | V | G-S25, G-S28; 13 §5 #7 | R |
| BR-PER-02 | A transaction is assigned to a period by its defined crediting event (payment, shipment or end of cooling-off; D-R1) | V, M | 15 BR-VOL-02 | C |
| BR-PER-03 | Period states: Open, Calculating, Calculated, Committed, Paid, Closed; inputs and outputs are frozen at Committed | P | G-S30 pattern | D |
| BR-PER-04 | Transactions arriving after Committed post as adjustments in the current open period by default | P | G-S29 pattern | D |
| BR-PER-05 | A restatement reopens a committed period only with approval, a reason and a stored diff; paid amounts are corrected by adjustments, never by editing postings | T | GAP-023 | D |
| BR-PER-06 | A run is idempotent per (tenant, calendar, period, run request id) and locked against concurrent runs | P | 15 B4 | D |

## BR-MNY — Money arithmetic (GAP-021)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-MNY-01 | Amounts are held in minor units or fixed-precision decimals; binary floating point is prohibited | P | 09 T1 | D |
| BR-MNY-02 | Rounding happens once per payout line at a defined step; the rounding mode is a tenant setting with a platform default | P, T | 09 | D |
| BR-MNY-03 | Splits, pools and scaled caps are allocated so that parts sum exactly to the total (largest remainder or equivalent) | P | 09 T1, T2 | D |
| BR-MNY-04 | Any unavoidable residue posts to a named residue account | P | 10 §3 | D |
| BR-MNY-05 | Points-to-currency factors are effective-dated per market and shown on statements | V, M | G-S26 | R |

## BR-CAP — Caps (GAP-022)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-CAP-01 | A cap has a scope (bonus types), a base expression, a rate, a method (proportional, priority list, per person) and a residue rule | V, M | G-S02, G-S26 | R |
| BR-CAP-02 | Per-participant constraints (e.g., a maximum share of a participant's compensation from personal-consumption volume) are evaluated before company-level caps | V | G-S02 §I.A.1 | R/C |
| BR-CAP-03 | Simulation shows, for each cap, the payees affected and amounts removed | P | 09 T3 | D |

## BR-RNK (extension) — Qualification state (GAP-025)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-RNK-05 | Each participant has a paid-as rank per period and a highest-achieved title, stored separately | V | G-S26, G-S28 | R |
| BR-RNK-06 | Qualification windows (period-end, rolling n weeks, per order) are declared per requirement | V | G-S25 | R |
| BR-RNK-07 | Cross-period state (carry balances, streak counters, one-time bonus flags, grace counters) is an output of a committed run and an input to the next; it is never edited directly | P | GAP-025 | D |
| BR-RNK-08 | Carry-forward has optional conditions (qualified this period), caps and expiry | V | G-S25, G-S28 | R |
| BR-RNK-09 | Several rank ladders may exist per participant (e.g., builder and promoter) | V | G-S26 | R |

## BR-PTY — Participant types (GAP-028)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-PTY-01 | Participant types are tenant-defined with flags: can earn, counts as end customer, can sponsor, can hold positions | T | G-S25, G-S26, G-S28 | R |
| BR-PTY-02 | Type changes are effective-dated (customer → distributor) and do not re-label past orders | P | GAP-028 | D |
| BR-PTY-03 | Every participant order carries a purpose (resale, personal use, unspecified) where the market or tenant requires it | T, M | G-S02 | R/C |

## BR-ATT — Attribution and ownership (GAP-040)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-ATT-01 | Each customer has one serviced-by relationship at a time, effective-dated | T | GAP-040 | D |
| BR-ATT-02 | Attribution, buyer type, purpose and line volumes are fixed on the order at ingestion | P | 22 §5 | D |
| BR-ATT-03 | On termination of the servicing distributor, customers are reassigned by a tenant rule (sponsor, company, customer choice) with notice | T | GAP-040 | D |
| BR-ATT-04 | Fractional roll-ups (a share of customer volume credited to another position) are plan parameters | V | G-S25 | R |

## BR-RET — Returns and exchanges (GAP-047)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-RET-01 | Returns reverse volume per returned line, not per order | P | GAP-047 | D |
| BR-RET-02 | An exchange of equal value flagged as such does not reverse and re-credit volume | T | GAP-047 | D |
| BR-RET-03 | Restocking fees reduce the refund; their effect on volume is a tenant setting | T | S-122 | D |

## BR-REV (extension) — Reversal policy (GAP-032)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-REV-07 | Default clawback method is order-line clawback against future earnings; restatement is available per bonus type | T | G-S29; 09 T5 | D/C |
| BR-REV-08 | Clawback receivables below a tenant threshold may be written off with approval | T | 10 §3 | D |
| BR-REV-09 | The platform never initiates a debit from a distributor's bank account | P | A-02 | D |

## BR-TAX — Withholding and reporting (GAP-031)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-TAX-01 | Withholding rules are effective-dated and market-scoped: rate, threshold, threshold basis (e.g., prior-year totals from this payer), payee conditions (residency, tax ID present) | M | G-S12, G-S13 | S/C |
| BR-TAX-02 | Withholding is computed after gross commission and before payout instruction and posts to a withholding liability | P | 10 §3 | D |
| BR-TAX-03 | Missing tax ID applies the market's higher rate where the law sets one | M | G-S13 | S/C |
| BR-TAX-04 | Year-end statements are generated per market form (e.g., CP58, TDS certificate, 1099) with thresholds per tax year | M | G-S05, G-S12 | S/C |

## BR-PAY (extension) — Payout integrity (GAP-035)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-PAY-08 | New or changed bank details trigger re-authentication, notice to the previous contact, and a cooling-off before the first payout | T | 16 T5 | D |
| BR-PAY-09 | Returned payments move the amount back to the payee's payable balance and open a case | P | 10 §3 | D |
| BR-PAY-10 | Payout instructions carry idempotency keys and are signed | P | 16 T13 | D |
| BR-PAY-11 | Payout providers must be confirmed eligible for the tenant's business type in the market before go-live | T, M | G-S04, G-S20 | R |

## BR-ADJ — Manual adjustments and disputes (GAP-002, GAP-065)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-ADJ-01 | Every manual adjustment has a reason code, evidence and a case | P | G-S30 pattern | D |
| BR-ADJ-02 | Adjustments above a tenant threshold need a second approver; nobody approves their own | T | 16 T6 | D |
| BR-ADJ-03 | Adjustments to accounts of the approver, their relatives (if declared) or accounts created in the last n days are blocked or escalated | T | 16 T6 | D |
| BR-ADJ-04 | A commission dispute has states (opened, under review, resolved upheld / not upheld) and a response time per market where required | T, M | CMP-09 | S |

## BR-GRD — Platform guardrails (GAP-087) — **default proposal, needs founder and counsel**

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-GRD-01 | **Blocked:** a payout component whose only trigger is enrolling a person, in markets that ban it | P, M | S-020, G-S02, CMP-03 | C |
| BR-GRD-02 | **Blocked:** fees or deposits from participants where the market prohibits them | P, M | S-048, CMP-14 | C |
| BR-GRD-03 | **Warned and logged:** starter kits carrying commissionable volume; personal-consumption share above a tenant threshold | P | S-141, G-S02 | D |
| BR-GRD-04 | **Reported:** retail-customer share, payout-source mix, earnings distribution | P | CMP-01, CMP-05 | D |
| BR-GRD-05 | Guardrail overrides need a written justification from the tenant and are visible in compliance reports | P | GAP-087 | D |

## BR-PLN — Plan transitions (GAP-097)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-PLN-01 | Each new plan version declares transition rules for titles, carry balances, streaks and one-time flags | V | G-S28 | D |
| BR-PLN-02 | A version cannot be activated without a simulation on at least one full historical period | P | GAP-026 | D |
| BR-PLN-03 | Where a market requires a filing (e.g., Malaysia plan amendments), activation is blocked until the filing status is recorded | M | S-043 | S |
| BR-PLN-04 | Field notice period before activation is a tenant setting | T | GAP-097 | D |

## BR-CRD — Non-cash rewards (GAP-024)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-CRD-01 | Each credit type has value, expiry, redemption scope and tax treatment flag | T | G-S26, G-S28 | R |
| BR-CRD-02 | Expiry posts a reversal of the credit liability and notifies the holder in advance | T | GAP-024 | D |

## BR-SEC — Access (GAP-065)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-SEC-01 | Vendor staff have no standing access to tenant data; access is a tenant-approved, time-boxed session, logged and visible to the tenant | P | 16 T3 | D |
| BR-SEC-02 | Payout approvers and tenant admins use multi-factor authentication | P | 16 T10 | D |
| BR-SEC-03 | Exports of personal data are limited, logged and attributed | P | 16 T11 | D |

## BR-DAT (extension) — Privacy as processor (GAP-085)

| ID | Rule | At | Basis | Status |
|---|---|---|---|---|
| BR-DAT-06 | Erasure requests pseudonymise payee identity in the ledger rather than deleting postings, where retention law allows | P, M | GAP-085 | C |
| BR-DAT-07 | Breach-notification timelines and contacts are configured per market and per tenant | M | G-S14, G-S10 | S |
| BR-DAT-08 | Prospect data entered by a distributor is private to that distributor by default | T | GAP-041 | D |
