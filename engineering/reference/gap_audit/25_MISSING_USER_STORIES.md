# 25 — MISSING USER STORIES
## Stories for the capabilities the gaps make necessary

| Field | Value |
|---|---|
| Document ID | GAP-25 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Scope | Stories for features in 23 marked MVP or V1. Acceptance criteria are in 26 |
| Personas | Role names from the original 08/09 (all provisional hypotheses except PR-01). **These stories are hypotheses about needs**; interviews (66 Appendix A) should confirm or cut them |

| ID | As a… | I want… | So that… | Feature | Gap | Stage |
|---|---|---|---|---|---|---|
| US-01 | Commission analyst | to see the tree exactly as it was on any past date | I can explain a past payout after later corrections | F-02 | GAP-010 | MVP |
| US-02 | Support agent | to file a sponsor-change request with reason and evidence | changes are reviewed instead of edited directly | F-03 | GAP-002 | MVP |
| US-03 | Compliance officer | to approve or reject genealogy corrections and see which committed periods they affect | corrections do not silently change paid history | F-03, F-09 | GAP-002, GAP-023 | MVP |
| US-04 | Distributor | to hold several positions and see one combined statement | my earnings are clear even with several business centres | F-01, F-38 | GAP-010 | MVP |
| US-05 | Team leader | to search my downline and see only the fields the company allows | I can help my team without seeing private data | F-06, F-07 | GAP-012 | MVP |
| US-06 | Commission analyst | to run a period, review variance against the last run and send it for approval | mistakes are caught before money moves | F-09, F-10 | GAP-023 | MVP |
| US-07 | Finance approver | to approve a committed run only if I did not prepare it | no single person can release payouts | F-10 | GAP-065 | MVP |
| US-08 | Commission analyst | late orders after commit to land in a queue and post as adjustments | committed periods stay reproducible | F-09 | GAP-023 | MVP |
| US-09 | Compliance officer | to request a restatement with a reason and see the diff before approval | real errors can be corrected openly | F-09 | GAP-023 | MVP |
| US-10 | Plan administrator | to compare a new plan version with the current one on last period's data, payee by payee | I know who gains and loses before release | F-11 | GAP-026 | MVP |
| US-11 | Plan administrator | to configure a cap with scope, base, method and see who is cut | the cap behaves as the plan document says | F-13 | GAP-022 | MVP |
| US-12 | Distributor | to open any statement line and see how it was calculated | I can trust or dispute it with facts | F-12, F-38 | GAP-027 | MVP |
| US-13 | Support agent | to see the full calculation trace for a payout line | I can answer pay questions without engineering | F-12 | GAP-027 | MVP |
| US-14 | Finance manager | the sum of payout lines, residues and withholding to equal the run total to the cent | the ledger reconciles | F-14, F-15 | GAP-021, GAP-030 | MVP |
| US-15 | Finance manager | a journal export mapped to our chart of accounts at period end | our ERP stays the general ledger | F-15 | GAP-033 | MVP |
| US-16 | Payout officer | failed and returned payments to come back to a queue and be re-instructed safely | nobody is paid twice or not at all | F-16 | GAP-035 | MVP |
| US-17 | Distributor | to be told when my bank details change, and payouts to wait before using new details | a takeover cannot redirect my money | F-17 | GAP-035, GAP-065 | MVP |
| US-18 | Finance manager (Malaysia) | 2% withholding applied to payees above the prior-year threshold and CP58 statements produced | we meet our withholding duty | F-18 | GAP-031 | MVP (MY launch) |
| US-19 | Finance manager (India) | TDS applied per the rules in force, with the higher rate when no PAN is held | we meet our TDS duty | F-18 | GAP-031 | MVP (IN launch) |
| US-20 | Finance manager | to choose a clawback policy per bonus type and see receivables and write-offs | refunds are recovered consistently | F-19 | GAP-032 | MVP |
| US-21 | Compliance officer | to define participant types and order purposes | the retail-customer share is measured on the right population | F-20, F-24 | GAP-028 | MVP |
| US-22 | Operations manager | orders, refunds and customers from our Shopify or WooCommerce store to flow in automatically and idempotently | we do not re-key orders | F-21 | GAP-045 | MVP |
| US-23 | Support agent | to reassign a terminated distributor's customers by the company's rule | customers keep being served and attribution stays correct | F-22 | GAP-040 | MVP |
| US-24 | Compliance officer | reports on retail-customer share, personal-consumption share and payout sources per period | I can answer a regulator or counsel from the system | F-24 | GAP-081 | MVP |
| US-25 | Compliance officer (US) | an earnings disclosure computed from all participants' payouts, including zero earners, and kept with its method | our claims are substantiated | F-25 | GAP-086 | V1 |
| US-26 | Tenant owner | the platform to block plan components that pay solely for enrolment in markets that ban them, and tell me why | we do not configure an unlawful plan by accident | F-26 | GAP-087 | MVP |
| US-27 | Plan administrator | a plan change to move through simulation, compliance review, filing status, notice and an effective date, with a transition report | the field is treated fairly and filings are not missed | F-28 | GAP-097 | MVP |
| US-28 | Implementation consultant | to import history and run old and new systems in parallel with a per-payee difference report | go-live happens only when payouts match | F-29 | GAP-077 | MVP |
| US-29 | Tenant admin | to approve or deny a vendor support session and see everything done in it | the vendor cannot access our data silently | F-32 | GAP-065 | MVP |
| US-30 | Distributor | to request access to or erasure of my data | my privacy rights are honoured | F-33 | GAP-085 | MVP |
| US-31 | Tenant admin | to keep our data in a chosen region | we meet residency duties | F-34 | GAP-061 | MVP if India |
| US-32 | Analyst | a scheduled export of our full data model | we can analyse in our own tools and leave if we choose | F-30 | GAP-062, GAP-096 | MVP |
| US-33 | Compliance officer | integrity signals (period-end threshold orders, returns after qualification, shared payment instruments) with my thresholds | I can investigate bonus buying | F-27 | GAP-005 | V1 |
| US-34 | Distributor (Malaysia/India) | my statement and key pages in my language and readable on a slow phone | I understand what I am paid | F-38 | GAP-051 | MVP if MY/IN |
