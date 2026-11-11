# 30 — QA AND TEST COVERAGE GAPS
## How the engine, ledger and isolation must be tested — and the scenarios the original research implies

| Field | Value |
|---|---|
| Document ID | GAP-30 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Situation | No test strategy exists (GAP-100). The original contains nine worked examples (13) and this audit five stress tests (09). Both become seed test cases |

## 1. Test layers the product needs

| Layer | What it proves | Tooling idea | Gap |
|---|---|---|---|
| **Golden datasets** | A plan version produces exactly the expected payout lines on a frozen input set | Versioned fixtures per plan type from the corpus (GAP-020) and per tenant | GAP-026 |
| **Property-based tests** | Invariants hold for random inputs: lines sum to run total; caps never exceeded; allocations sum exactly; no payout to terminated positions after effective date; matching never pays on a bonus that was reversed | Generators for trees, orders and plans | GAP-021, GAP-022 |
| **Replay tests** | Re-running a committed period reproduces it byte-for-byte after later corrections | Snapshot + replay | GAP-010, GAP-023 |
| **Differential tests** | New engine release vs previous release on all golden sets: zero unexplained differences | CI gate | GAP-026 |
| **Parallel-run tests** | New platform vs legacy system for a migrating tenant | Per-payee diff report | GAP-077 |
| **Ledger invariants** | Every journal entry balances; balances equal sum of postings; no edits | DB constraints + tests | GAP-030 |
| **Idempotency tests** | Duplicate webhooks, retried instructions, concurrent run requests | Chaos-style retries | GAP-035, 15 B4 |
| **Cross-tenant isolation tests** | No endpoint returns another tenant's data | Automated suite over the API surface | GAP-065 |
| **Authorisation matrix tests** | Each role sees and does only what it should (incl. downline depth limits) | Table-driven tests | GAP-012 |
| **Performance benchmarks** | Run time and memory on synthetic trees; ingestion at period-end peaks | 08 §6 plan | GAP-011 |
| **Tax rule tests** | Withholding per market and year with boundary cases | Fixtures confirmed by a tax adviser | GAP-031 |
| **Localisation and accessibility tests** | Statements in launch languages; WCAG 2.2 AA checks | Automated + manual | GAP-051 |
| **Restore tests** | Backups restore within the RTO | Scheduled drills | GAP-060 |

## 2. Seed scenarios

| ID | Scenario | Expected result | Source |
|---|---|---|---|
| TS-01 | EX-1 unilevel five levels | 925.00 | 13 EX-1 |
| TS-02 | EX-1b compression with an inactive member | 800.00 without, 1,040.00 with | 13 EX-1b |
| TS-03 | Correction of a sponsor after period commit, then replay | Committed output unchanged; correction flagged | 08 §4 |
| TS-04 | Binary pairing 620 vs 900 at 2:3 | 3 pairs, carry 20 left | 13 EX-2 |
| TS-05 | Carry-forward capped at 3,000 per side, only while qualified | Carry truncated; zeroed when unqualified | G-S25 |
| TS-06 | Pool of 62,500.00 over 66 shares | Sum exactly 62,500.00 | 09 T1 |
| TS-07 | Proportional cap over 8 lines | Sum exactly equals cap | 09 T2 |
| TS-08 | Priority cap on {team, leadership}; leadership reduced only | Team unchanged; leadership = cap − team | 09 T3 |
| TS-09 | Herbalife-structure cap: one-third rule on base; wholesale commissions excluded | Base 750,000; cap 313,125 on in-scope lines only | 09 T4, G-S02 |
| TS-10 | Refund after payout with rank threshold and matching | Order-line: A −50, C 0; restatement: A −65, C −13 | 09 T5 |
| TS-11 | Negative balance after clawback larger than next earnings | Receivable carried; write-off only with approval | 13 EX-8 |
| TS-12 | Fast start capped per order | 240 → 200; upline 120 → 80 | 13 EX-5 |
| TS-13 | Late order after commit | Adjustment in open period; committed period unchanged | GAP-023 |
| TS-14 | Two concurrent "run" requests for the same period | One run executes; the other returns the same run id | 15 B4 |
| TS-15 | Duplicate order webhook | One order | AC-22.1 |
| TS-16 | Payout instruction retried after timeout | One payment at provider | AC-16.1 |
| TS-17 | Bank detail changed two days before payout | Payout held per cooling-off | AC-17.1 |
| TS-18 | Withholding: payee just below and just above prior-year threshold (MY) | 0% and configured rate | G-S12 |
| TS-19 | Withholding without tax ID (IN) | Higher configured rate | G-S13 |
| TS-20 | Leader requests node outside downline | Denied without disclosure | AC-05.2 |
| TS-21 | Tenant A token, Tenant B object | Denied | AC-29.2 |
| TS-22 | Plan with three business centres per participant | Statement grouped per position; total per person | G-S25 |
| TS-23 | Points-to-currency factor changed mid-year | Periods before and after use their own factor | G-S26 |
| TS-24 | 25-month streak bonus across a plan version change | Streak carried per transition rule | G-S28, GAP-097 |
| TS-25 | One-time rank bonus re-qualified after demotion | Not paid twice | G-S28 |
| TS-26 | Starter kit carrying volume | Warning logged per guardrail | BR-GRD-03 |
| TS-27 | Bonus triggered only by enrolment in a market that bans it | Configuration blocked | BR-GRD-01 |
| TS-28 | Erasure request for a payee with history | Identity pseudonymised; ledger intact | AC-30.1 |
| TS-29 | Deep-leg binary tree of 5,000 levels, 2M positions | Run within the agreed window | 08 §6 |
| TS-30 | Malay/Hindi statement on a slow connection | Within page budget | AC-34.1 |

## 3. What the original research's examples do not test (and should)

Rounding and allocation (TS-06, TS-07), priority caps (TS-08), the one-third rule (TS-09), cascade effects of reversals (TS-10), multi-position participants (TS-22), effective-dated factors (TS-23), long-horizon state across plan changes (TS-24), and idempotency and isolation (TS-14..TS-21).
