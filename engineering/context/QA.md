# QA — Implementation Brief

Sources: QA-01 `08-qa/01_QA_AND_ACCEPTANCE_SPECIFICATION.md`, QA-02 `08-qa/02_TEST_SCENARIOS.md`, QA-03 `08-qa/03_EDGE_CASES.md`, QA-04 `08-qa/04_REQUIREMENTS_TRACEABILITY.md`, cross-checked against `09-governance/traceability-data/spec.json` (71 tests, 102 AC, 119 BR, 41 API) and `02-prd/03_NON_FUNCTIONAL_REQUIREMENTS.md` (NFR-PERF values). All docs are v0.1 draft, 2026-11-12, not approved.

Release tags: **A** = MVP-A, **B** = MVP-B, **B-MKT** = MVP-B (market pack), **V1** = post-MVP. `*` = release inferred by this brief (source gives none).

State of play: no product exists; no test has been executed. Calculated expected values are verified by `08-qa/verification/verify_calculations.py` (55 of 55 checks pass; output `08-qa/verification/verification_output.txt`). All calc inputs are **hypothetical**. Tax tests use fixture rates only.

---

## 1. Quality goals → proof

| Goal | Proof mechanism |
|---|---|
| Pay correct to the minor unit | Golden datasets; property tests; ledger invariants |
| Pay reproducible | Replay of committed periods; differential tests engine N vs N-1 |
| Money cannot be released/changed by one person, twice, or silently | SoD tests; idempotency tests; append-only tests |
| No cross-tenant data visibility | Generated isolation suite over every endpoint (TS-21) |
| Compliance figures reproducible and explainable | Hand-checked fixture (TS-31); snapshot recomputation; drill-down sums (TS-34) |
| Users can operate the product | Usability, accessibility (TS-54), responsive (TS-55), localisation (TS-30) |

## 2. Test layers and where they run

| Stage | Suites |
|---|---|
| **Every change (CI, automated)** | Unit (primitives, expressions, posting rules, validators); Property (random trees/orders/plans → invariants I1–I12); Golden datasets (exact expected lines); Replay sample of committed periods; Differential (engine N vs N-1); Ledger invariants in the DB; Idempotency + concurrency with scriptable fake provider; Cross-tenant isolation generated from OpenAPI; Authorisation matrix (table-driven); API contract tests; Accessibility checks on components + key screens; Static checks (TS-67 — not in the QA-01 diagram, but required by the "Change merged" gate) |
| **Before a release** | E2E UI journeys UJ-01..UJ-18; Performance benchmarks; Security tests + scans; Responsive + localisation matrix; Manual accessibility + exploratory |
| **Per tenant** | Parallel run vs legacy system; Tenant golden datasets |
| Flow | PYR → PRE → TEN → Go-live |
| CI release gate (QA-02 coverage diagram) | Golden datasets, property tests and replay tests feed the differential test (release N vs N-1); differential + ledger invariants + idempotency and isolation suites + authorisation matrix → CI release gate → parallel run per migrating tenant → go-live |

### 2.1 Test type catalogue (QA-01 §2)

| Type | Proves | Method | Scenarios |
|---|---|---|---|
| Functional | Each FR behaves per its AC | ≥1 test per AC (every AC has a test, QA-04 §4.4 = none missing) | TS-13, 17, 32–34, 45–52, 57–59, 61, 64, 68–70 |
| Business rule | Each PRD-04 rule holds | Rule-to-test mapping; 13 rules have no test (§9.3) | All |
| Compensation calc | Engine output = independently computed lines | Golden per primitive, per corpus plan, per tenant | TS-01, 02, 04–12, 22–25, 43, 44, 62, 63, 65 |
| Genealogy | Structure, history, visibility correct | Bitemporal queries; cycle/overlap constraints; placement races; read-model equivalence with system of record | TS-03, 20, 45, 61, 64 |
| Financial transaction | Ledger balances, append-only, idempotent; reversals consistent | DB-level tests; full payout cycles; clawback + write-off | TS-11, 38–41 |
| Permission | Each role/scope does exactly what matrix says | Table-driven: permission catalogue × base roles × market scopes; SoD | TS-36, 42 |
| Multi-tenant isolation | No endpoint leaks | Every OpenAPI endpoint: tenant A credential + tenant B ids; **build fails if an endpoint is uncovered**; canary rows | TS-21 |
| API | Contracts, validation, errors, pagination, idempotency, rate limits | Contract tests from OpenAPI; negative test per error code; replay + conflict cases | TS-14–16, 41, part of 59 |
| Integration | Connectors/adapters under failure | Fake store + fake provider: scripted time-outs, partial rejections, returns, duplicate + out-of-order webhooks; reconciliation | TS-15, 16, 40, 41, 58 |
| UI | Right data and states | Journeys UJ-01..18; state coverage per WF-02 §3; honesty check (no projection content) | TS-53, 59 |
| Responsive | Layouts follow UI-05 | Viewport matrix UI-05 §8 | TS-55 |
| Accessibility | WCAG 2.2 AA | Automated + manual keyboard/screen-reader on 5 highest-risk screens + all portal pages | TS-54 |
| Security | TRD-04 controls | MFA + step-up; sessions; vendor-session enforcement; audit chain tamper; export limits; signed instructions; upload handling; dependency + image scans; **independent pen test before first MVP-B production tenant** | TS-35, 37, 56, 71 |
| Performance | PRD-03 targets met or revised | Synthetic trees + order loads; period-end burst; statement page budget | TS-29, 30 |
| Regression | Nothing breaks | Full automated suite every change; differential engine test; visual regression of components | TS-60 |
| Tax | Market-pack rules applied as configured | Fixtures confirmed by a tax adviser per market; boundary cases | TS-18, 19 |
| Privacy | Requests fulfilled without breaking ledger | Pseudonymisation; region checks | TS-28, 57 |
| Editions | Self-hosted ≡ hosted; safe updates | Licence states; update package checks; bundle redaction | TS-69–71 |

## 3. Engine invariants (property tests — run after every generated run)

| # | Invariant |
|---|---|
| I1 | Σ result lines = run total |
| I2 | Every allocation (pool, split, scaled cap): Σ parts = total, exactly |
| I3 | No cap exceeded for its scope |
| I4 | Per payee: gross = net payable + withholding (+ netted clawback) |
| I5 | Run's journal entry balances and equals run totals |
| I6 | No line paid to a position terminated before the period unless plan version allows |
| I7 | Matching never pays on a bonus reversed in the same run |
| I8 | Once-only bonus never paid twice to the same position |
| I9 | Running twice on same snapshot → same ordered hash |
| I10 | Adding an order to one position never reduces another position's volume measures |
| I11 | Read model answers "is X in Y's downline" identically to system of record |
| I12 | After any payout event sequence: payable ≥ 0 and in-transit = Σ open instructions |

## 4. Golden datasets

| Level | Content | Owner | Exists? |
|---|---|---|---|
| Primitive | ≥1 fixture per primitive kind + option (TS-01, 02, 04, 05, 12, 43, 44 …) | Platform | Expected values verified |
| Corpus plan | ≥5 hold-out plans from Phase A corpus, end to end, expected lines from plan docs' own examples | Platform (Phase C spike) | **No** |
| Tenant | Tenant plan document examples + parallel-run periods | Implementation consultant + tenant | **No** |
| Regression | Every defect becomes a fixture | Platform | — |

Definition: input bundle (tree, orders, prior state, plan version, settings) + **exact** expected lines. Expected values produced independently of the engine (by hand or separate script) and reviewed by a second person.

## 5. Verified calculation expectations (assert exactly)

| Test | Inputs | Expected | Rule |
|---|---|---|---|
| TS-01 Unilevel | Rates 8,5,4,4,4%; level vols 1,000; 2,500; 4,000; 6,000; 8,000 | 80.00+125.00+160.00+240.00+320.00 = **925.00** | Percent by level |
| TS-02 Compression | Chain vols 1,000; 2,500 (inactive); 4,000; 6,000; 8,000; 5,000 | Without **800.00**; with **1,040.00** | BR-GEN-07 |
| TS-04 Binary 2:3 | L 620, R 900, unit 100 | **3 pairs**; carry L **20**, R **0** | Ratio + carry |
| TS-05 Carry cap | Carry 2,800 + 900 new, cap 3,000; next period unqualified | **3,000** then **0** | BR-RNK-08 |
| TS-06 Pool | 62,500.00 over 66 shares (40×1, 10×2, 2×3) | Naive 62,500.02; largest remainder **62,500.00** | BR-MNY-03 |
| TS-07 Proportional cap | 8 lines Σ 9,403.93; cap 8,328.12 (rate 0.8856) | Naive 8,328.14; exact **8,328.12** | BR-MNY-03 |
| TS-08 Priority cap | Sales 1,000,000; cap 10%; team 70,000 + leadership 45,000; reduce leadership | Team **70,000.00**, leadership **30,000.00** (proportional: 60,869.57 / 39,130.43) | BR-CAP-01 |
| TS-09 Order-structure cap | G1 500,000; G2 300,000 (> ⅓ of G1+G2); net sales 1,000,000; rate 41.75%; in-scope proposed 340,000 | Base **750,000**; 75% < 80%; cap **313,125.00**; factor **0.9210** on in-scope lines only | BR-CAP-01, -02 |
| TS-10 Refund cascade | GV 800 incl. refunded order 500; 10% at ≥700 else 5%; match 20% | Paid A 80.00, C 16.00. Order-line: A −50.00, C 0. Restatement: A **−65.00**, C **−13.00** | BR-REV-07 |
| TS-11 Netting | Receivable 40.00; next earnings 25.00 | Payable **0.00**; receivable **15.00** carried | BR-REV-09 |
| TS-12 Fast start | Order 1,200; 20% cap 200; upline 10% cap 80 | **200.00**, **80.00** | Per-order cap |
| TS-22 Multi-position | 100.10 + 250.25 + 49.65 | **400.00** | BR-GEN-01 |
| TS-38 Withholding | Gross 1,234.56; fixture 2% | Withheld **24.69**; payable **1,209.87**; entry balances | BR-TAX-02, BR-LED-01 |
| TS-43 Override vs differential | GV 6,000; 3% or (21% − 15%) | **180.00** or **360.00** | Plan states model |
| TS-44 Matching | 10% of 10.00 and 480.00 | **1.00**, **48.00** | Pass order |
| Tie-break | 100.00 over 3 equal shares P1,P2,P3 | **33.34, 33.33, 33.33** | Largest remainder; ties by payee id |

Allocation algorithm (BR-MNY-03): compute raw shares, floor to minor unit, distribute remaining minor units one each to the largest fractional parts; ties broken by payee id. Exact total always.

## 6. Golden dataset G-E2E-01 (one monthly period, one market) — B

Tree: A → B, A → C, B → D (sponsor). Own orders: A 100, B 200, C 100, D 300. Customers: K1 (served by B) 400; K2 (served by D) 150.

Plan: PV = own orders + serviced customers' orders. GV = PV of self + sponsor-tree downline. Rank R1 if PV ≥ 100; R2 if GV ≥ 700 (thresholds inclusive `gte` per E-CMP-06 / SDD-07 §3). Retail commission 25% of serviced customers' orders. Unilevel 8% L1 PV, 5% L2 PV. Rank bonus 5% GV at R1, 10% at R2. Matching 20% of rank bonus of personally sponsored. Cap: rank bonus + matching ≤ 20% of net sales; method priority, reduce matching first, then rank bonus proportionally; residue not earned. Withholding fixture 2% of gross.

| Step | A | B | C | D | Total |
|---|---|---|---|---|---|
| PV | 100 | 600 | 100 | 450 | — |
| GV | 1,250 | 1,050 | 100 | 450 | — |
| Rank | R2 | R2 | R1 | R1 | — |
| Retail commission | — | 100.00 | — | 37.50 | 137.50 |
| Unilevel | 56.00+22.50 = 78.50 | 36.00 | — | — | 114.50 |
| Rank bonus (pre-cap) | 125.00 | 105.00 | 5.00 | 22.50 | 257.50 |
| Matching (pre-cap) | 22.00 | 4.50 | — | — | 26.50 |
| Cap: net sales 1,250.00 × 20% = 250.00; in scope 284.00; excess 34.00 | | | | | |
| Matching after cap (−26.50) | 0.00 | 0.00 | — | — | 0.00 |
| Rank bonus after cap (−7.50, largest remainder) | 121.36 | 101.94 | 4.85 | 21.85 | 250.00 |
| **Gross** | **199.86** | **237.94** | **4.85** | **59.35** | **502.00** |
| Withholding 2% | 4.00 | 4.76 | 0.10 | 1.19 | 10.05 |
| **Net payable** | 195.86 | 233.18 | 4.75 | 58.16 | 491.95 |

- Ledger at commit: Dr commission expense 502.00 · Cr payee payable 491.95 · Cr withholding payable 10.05.
- Allocation: raw 121.3592, 101.9417, 4.8544, 21.8447; floors Σ 249.98; 2 cents → A and D (largest fractions).
- Compliance from same run: R1 customer share = 550 ÷ 1,250 = **44.00%**; R3 retail 137.50 ÷ 502.00 = **27.39%**, downline (unilevel + rank bonus) 364.50 ÷ 502.00 = **72.61%**, matching 0%.
- Follow-ons (expected values NOT yet defined; add when engine exists): (a) refund K1 order after commit under each clawback policy; (b) correct D's sponsor B→C after commit, then replay; (c) same period with proportional cap.

## 7. Compliance report fixture TS-31 — A

Participants D1, D2 (distributors), C1 (customer). Orders: O1 C1 100.00 customer; O2 D2 60.00 personal; O3 D2 40.00 resale on day 28, fully refunded next month. Payout lines to D1: retail 25.00 (O1), unilevel 3.60 (O2), unilevel 2.40 (O3), clawback −2.40 next month.

| Figure | Expected |
|---|---|
| R1 net sales | 160.00 |
| R1 customer share; with declared resale | 62.50%; 62.50% (resale order fully refunded) |
| R2 personal-use share of rewarded volume | 60.00%; 1 payee above one-third flag |
| R3 January retail; downline | 80.65%; 19.35%; year clawbacks −2.40 |
| R4 active distributors; % with no customer order; late threshold crossings; of which refunded | 1; 100%; 1; 1 |
| R5 population; % earned > 0; median | 2; 50.00%; 14.30 |

Additional checks: snapshot recomputation → identical figures; drill-down row sums = figure components; superseded batch leaves old snapshots unchanged.

## 8. Financial operation verification (QA-01 §8) — B

| Check | Method | Expected |
|---|---|---|
| Transaction consistency | Kill process at each step of commit, instruct, settle, return (automated fault injection) | Whole business event applied (state + ledger entry + outbox) or none |
| Reversal consistency | Commit → instruct → return → re-instruct → settle (TS-40) | Payable 0, in transit 0, settled 98.00; one balanced entry per step |
| Clawback consistency | TS-11 with write-off | Receivable never negative; write-off only with approval; no debit instruction exists |
| Immutability | UPDATE/DELETE on postings, entries, result lines, relationships (TS-39) | Rejected by the database |
| Idempotency | Duplicate run request, order, retried instruction, webhook (TS-14–16, 41) | One effect each |
| Reconciliation after restore | Restore to before settlements arrived, then reconcile | Differences surface as exceptions; no duplicate instruction sent |


## 9. Test scenario catalogue — all 71 TS (QA-02; identical to spec.json `tests`)

Counts: A = 10 (TS-21, 31–37, 56, 57); B = 55; B-MKT = 3 (TS-18, 19, 30); V1 = 3 (TS-69, 70, 71). TS-01..TS-30 keep IDs from gap audit 30 §2. Layers: Golden 18, Functional 22, Ledger 4, Idempotency 4, Security 4, Guardrail 3, Property 2, Tax 2, Authorisation 2, and one each of Replay, Isolation, Privacy, Performance, Localisation, UI, Accessibility, Responsive, Regression, Static.

| ID | Rel | Layer | Scenario | Expected | Proves (refs) |
|---|---|---|---|---|---|
| TS-01 | B | Golden | Unilevel five levels at 8, 5, 4, 4, 4 percent on level volumes 1,000; 2,500; 4,000; 6,000; 8,000 | Level payouts 80.00, 125.00, 160.00, 240.00, 320.00; total 925.00 | AC-44.1, BR-CMP-01 |
| TS-02 | B | Golden | Compression: chain of six members, second inactive, same rates; volumes 1,000; 2,500; 4,000; 6,000; 8,000; 5,000 | 800.00 without compression; 1,040.00 with compression; relationship rows unchanged | AC-44.2, BR-GEN-07 |
| TS-03 | B | Replay | Correction of a sponsor after period commit, then replay of the committed period | Committed output unchanged (hash equal); correction flagged with affected periods | AC-01.1, AC-01.2, AC-03.1, BR-GEN-04, BR-PER-03 |
| TS-04 | B | Golden | Binary pairing 620 against 900 at ratio 2:3, pair unit 100 | 3 pairs; carry 20 on the left, 0 on the right | BR-RNK-08 |
| TS-05 | B | Golden | Carry-forward capped at 3,000 per side, kept only while qualified | Carry truncated to 3,000; zeroed in the first unqualified period | BR-RNK-08 |
| TS-06 | B | Property | Pool of 62,500.00 over 66 shares (40 holders with 1, 10 with 2, 2 with 3) | Largest-remainder allocations sum to exactly 62,500.00; naive per-share rounding would pay 62,500.02 | AC-14.1, BR-MNY-03, BR-MNY-02, BR-MNY-04 |
| TS-07 | B | Property | Proportional cap 8,328.12 over 8 lines summing 9,403.93 (cap rate 0.8856) | Scaled lines sum exactly to 8,328.12; naive per-line rounding would pay 8,328.14 | AC-11.2, BR-MNY-03, BR-CAP-01 |
| TS-08 | B | Golden | Cap 10% of sales 1,000,000 on team bonus 70,000 and leadership bonus 45,000, method priority = leadership | Team 70,000.00 unchanged; leadership 30,000.00. Proportional method on the same inputs gives 60,869.57 and 39,130.43 | AC-11.1, BR-CAP-01, BR-CAP-03 |
| TS-09 | B | Golden | Order-structure cap: component G1 500,000, G2 300,000 (above one third of G1+G2); total net sales 1,000,000; in-scope pay proposed 340,000; rate 41.75% | Rewardable base 750,000; ratio 75% below 80%; cap 313,125.00 on in-scope lines only (factor 0.9210); out-of-scope lines untouched | BR-CAP-01, BR-CAP-02 |
| TS-10 | B | Golden | Refund after payout with rank threshold 700 (10% above, 5% below) on group volume 800 including refunded order 500; matching 20% | Paid A 80.00, C 16.00. Order-line clawback: A −50.00, C 0.00. Restatement: A −65.00, C −13.00 | AC-20.1, AC-20.2, BR-REV-07 |
| TS-11 | B | Ledger | Clawback 40.00 against next earnings 25.00, then approved write-off | Payable 0.00; receivable 15.00 carried; write-off posts 15.00 only with approval; no debit instruction exists | AC-20.3, BR-REV-08, BR-REV-09 |
| TS-12 | B | Golden | Fast start 20% capped 200 per order, upline 10% capped 80, order 1,200 | 240 capped to 200.00; 120 capped to 80.00 | BR-CAP-01 |
| TS-13 | B | Functional | Order dated inside a committed period arrives | Queued as late transaction; adjustment line in the open run linked to the original period; committed period hash unchanged | AC-08.1, AC-22.2, BR-PER-04 |
| TS-14 | B | Idempotency | Two concurrent run requests for the same period | One run executes; both callers get the same run id | AC-06.3, BR-PER-06 |
| TS-15 | B | Idempotency | Duplicate order webhook | One order; second delivery acknowledged without change | AC-22.1, BR-ORD-04 |
| TS-16 | B | Idempotency | Payout instruction retried after timeout | Provider sandbox shows one payment; same idempotency key on both attempts | AC-16.1, BR-PAY-10 |
| TS-17 | B | Functional | Bank detail changed two days before payout with cooling-off longer than two days | Payout held; notices to old and new contact recorded | AC-17.1, AC-47.1, BR-PAY-08, BR-PAY-12 |
| TS-18 | B-MKT | Tax | Market-pack fixture: payee just below and just above the configured prior-year threshold | Zero withholding below; configured rate above; values from configuration only | AC-18.1, BR-TAX-01 |
| TS-19 | B-MKT | Tax | Market-pack fixture: payee without tax id where the pack sets a higher rate | Higher configured rate applied and shown | AC-19.1, BR-TAX-03 |
| TS-20 | B | Authorisation | Leader requests a node outside their downline by id | 404 identical to an unknown id | AC-05.2, BR-DAT-03, AC-05.1 |
| TS-21 | A | Isolation | Tenant A credential used against every endpoint with Tenant B object ids (generated from the OpenAPI document) | Every request fails without leaking existence; suite fails the build if an endpoint is not covered | AC-29.2, BR-SEC-04 |
| TS-22 | B | Golden | Participant with three positions earning 100.10, 250.25 and 49.65 | Statement grouped per position; person total 400.00 | AC-04.1, BR-GEN-01 |
| TS-23 | B | Golden | Points-to-currency factor changed between two periods | Each period uses its own effective factor; statement shows the factor | BR-MNY-05 |
| TS-24 | B | Golden | Streak counter of 24 periods carried across a plan version change with transition rule carry | Counter is 25 after the first period under the new version; transition report lists the participant if the rule changes the value | AC-27.2, BR-PLN-01 |
| TS-25 | B | Golden | One-time rank bonus; participant demoted and re-qualified | Bonus not paid a second time (once-only key) | BR-RNK-07 |
| TS-26 | B | Guardrail | Starter kit configured to carry commissionable volume | Warning stored as guardrail decision; acknowledgement required | AC-26.2, BR-GRD-03 |
| TS-27 | B | Guardrail | Bonus triggered only by enrolment in a market whose pack bans it | Save refused with rule id | AC-26.1, BR-GRD-01 |
| TS-28 | B | Privacy | Erasure request for a payee with ledger history | Identity fields pseudonymised in primary and read models; postings and lines intact; request logged | AC-30.1, BR-DAT-06 |
| TS-29 | B | Performance | Synthetic trees of 50k, 500k and 2M positions (balanced binary, deep-leg binary depth 5,000, wide unilevel); bottom-up volume pass and full run | Within the proposed targets NFR-PERF-04 and NFR-PERF-05 (to be confirmed at the Phase C spike) | BR-PER-06 |
| TS-30 | B-MKT | Localisation | Statement in the market's second language on a throttled 3G-class profile | Within NFR-PERF-06 budget; no untranslated keys; locale number format | AC-34.1, BR-LOC-01 |
| TS-31 | A | Golden | Overlay fixture: participants D1, D2 (distributors), C1 (customer); orders O1 C1 100.00 customer, O2 D2 60.00 personal, O3 D2 40.00 resale on day 28 fully refunded next month; payout lines to D1: retail 25.00 (O1), unilevel 3.60 (O2), unilevel 2.40 (O3), clawback −2.40 next month | R1 net sales 160.00, customer share 62.50%, with declared resale 62.50%; R2 personal-use share 60.00%, 1 payee above the one-third flag; R3 retail 80.65%, downline 19.35%, year clawbacks −2.40; R4 1 active, 100% with no customer order, 1 late crossing of which 1 refunded; R5 population 2, 50.00% above zero, median 14.30 | AC-24.2, AC-25.2, AC-21.1, BR-CPL-01, BR-GRD-04, BR-PTY-01 |
| TS-32 | A | Functional | Upload with forbidden column (email, phone, bank_account, national_id, address) | Batch rejected whole; columns named; zero rows stored | AC-39.1, BR-IMP-01, BR-IMP-02, AC-39.3 |
| TS-33 | A | Functional | Re-import of a loaded period, then recomputation of an old snapshot | Old batch Superseded and readable; old snapshot figures unchanged and reproducible; new snapshot uses the new batch | AC-39.2, AC-40.1, BR-IMP-04, BR-IMP-03 |
| TS-34 | A | Functional | Drill-down on each R1 to R5 figure | Row sets returned; sums equal figure components; export creates an audit event with row count | AC-41.1, AC-54.1, BR-SEC-03 |
| TS-35 | A | Security | Privileged role without MFA; lockout after repeated failures; step-up on approval | Forced enrolment; temporary lock with generic message; approval refused until factor verified | AC-35.1, AC-35.2, AC-07.2, BR-SEC-02 |
| TS-36 | A | Authorisation | Table-driven role matrix: every permission against every base role and market scope | Each role can do exactly what the matrix states; privileged grants need a second admin | AC-36.1, AC-36.2, BR-SEC-05 |
| TS-37 | A | Security | Vendor user without session requests tenant data; approved read-only session attempts a write; session expiry | Refused and logged in both logs; write blocked; access ends at expiry | AC-29.1, AC-29.3, AC-57.1, BR-SEC-01 |
| TS-38 | B | Ledger | Commit of a run with gross 1,234.56 and withholding 2.00% (fixture rate) | Withholding 24.69; payable 1,209.87; entry balances: expense 1,234.56 = payable 1,209.87 + withholding 24.69 | AC-14.2, AC-18.1, BR-LED-01, BR-TAX-02 |
| TS-39 | B | Ledger | UPDATE or DELETE on posting or journal_entry by the application role | Statement rejected by the database; alert raised | AC-14.3, BR-LED-02 |
| TS-40 | B | Ledger | Full payout cycle for one payee: commit 98.00 payable, instruct, return, re-instruct, settle | Payable 0.00, in transit 0.00 at the end; each step one balanced entry; sum of postings per account equals projection | AC-16.2, AC-47.2, BR-PAY-09, BR-LED-02 |
| TS-41 | B | Idempotency | Same settlement webhook twice; webhook for unknown reference | One settlement posting; unknown reference lands in exceptions queue | AC-16.3 |
| TS-42 | B | Functional | Separation of duties on run commit, batch approval, plan activation, adjustment | Preparer refused on each; different approver succeeds | AC-07.1, AC-49.1, BR-ADJ-02, BR-SEC-06, BR-PAY-02, BR-ADJ-01, BR-ADJ-03 |
| TS-43 | B | Golden | Differential against override on stairstep breakaway, group volume 6,000 (override 3%; differential 21% − 15%) | Override 180.00; differential 360.00; the plan rule states which model applies | BR-PLN-06 |
| TS-44 | B | Golden | Matching bonus 10% of downline bonuses 10.00 and 480.00 | 1.00 and 48.00, computed in the matching pass after individual bonuses | BR-PLN-06 |
| TS-45 | B | Functional | Genealogy change outside window; change creating a cycle; concurrent enrolments into one slot | Rejected with rule; refused GEN_CYCLE; exactly one takes the slot | AC-02.1, AC-02.2, AC-42.1, BR-GEN-05, BR-GEN-06 |
| TS-46 | B | Functional | Plan activation without simulation; without filing status in a pack that requires it; with failing golden case | Blocked in each case with the reason | AC-10.2, AC-10.3, AC-27.1, BR-PLN-02, BR-PLN-03, BR-PLN-06, BR-REG-05 |
| TS-47 | B | Functional | Return of one of two lines; equal-value exchange | Only that line's volume reversed; no reversal for the exchange | AC-45.1, AC-45.2, BR-RET-01, BR-RET-02, BR-VOL-01, BR-VOL-03, BR-ORD-01 |
| TS-48 | B | Functional | Type change customer to distributor on 10 June; May report recomputed | May orders remain customer orders | AC-21.2, BR-PTY-02, BR-ATT-02 |
| TS-49 | B | Functional | Termination with reassignment rule = sponsor | Customers move from the effective date; past orders keep attribution; views of both distributors correct | AC-23.1, AC-52.1, BR-ATT-03, BR-ATT-01 |
| TS-50 | B | Functional | Market not Live: enrolment and order; go-live without provider approval or breach contact | Rejected MARKET_NOT_LIVE; go-live blocked naming the item | AC-38.1, AC-38.2, AC-53.1, BR-PAY-11, BR-REG-04, BR-DAT-07, BR-CPL-03 |
| TS-51 | B | Functional | Restatement: sandbox diff, approval, adjustments | Diff stored; adjustments equal diff; no posting edited; original period hash unchanged | AC-09.1, BR-PER-05 |
| TS-52 | B | Functional | Parallel run with a legacy payout file; import with a genealogy cycle | Per-payee difference report; sign-off blocked while unexplained differences exist; cyclic import blocked | AC-28.1, AC-28.2, BR-MIG-02, BR-MIG-01 |
| TS-53 | B | UI | Statement and rank pages scanned for projection content; statement arithmetic | No projected income or recruiting target; net = gross − withholding − clawback | AC-51.1, AC-04.2, AC-12.1, BR-HON-01, BR-PAY-06 |
| TS-54 | B | Accessibility | WCAG 2.2 AA automated scan plus manual keyboard and screen-reader pass on the five highest-risk screens and all distributor pages | No level A or AA failures; tree and tables operable by keyboard | BR-LOC-01 |
| TS-55 | B | Responsive | Distributor screens at 360, 768 and 1280 px; admin screens at 1024 and 1440 px | Layouts follow the responsive specification; no horizontal scroll on distributor pages at 360 px | AC-34.1 |
| TS-56 | A | Security | Audit chain tamper test; tax id masking and audited unmasking; export above cap | Break detected; masked by default; export refused | AC-54.2, AC-48.1, BR-SEC-07 |
| TS-57 | A | Functional | Data region: writes, backups and export destinations checked against tenant region; out-of-region support session | All in region; session needs explicit region approval | AC-31.1, BR-DAT-09 |
| TS-58 | B | Functional | Sync lag above threshold at cut-off; dashboards against run and snapshot totals; scheduled full export counts | Run refused; dashboard figures equal sources; manifest counts reconcile | AC-06.2, AC-55.1, AC-56.1, AC-32.1, BR-ORD-05, BR-DAT-12 |
| TS-59 | B | Functional | Run review dataset; qualification state display and direct-edit attempt; adjustment once-only; dispute trace attachment; settings back-dating; duplicate hold; agreement requirement; trace by replay; journal export; integrity flags | Each behaves as its acceptance criterion states | AC-06.1, AC-46.1, AC-46.2, AC-49.2, AC-50.1, AC-37.1, AC-43.1, AC-42.2, AC-13.1, AC-15.1, AC-33.1, AC-18.2, AC-24.1, AC-25.1, AC-22.3, AC-17.2, AC-03.2, AC-10.1, BR-GEN-09 |
| TS-60 | B | Regression | Differential test: new engine release against previous on all golden datasets and replay of sampled committed periods | Zero unexplained differences; release blocked otherwise | BR-PLN-06, BR-PER-03 |
| TS-61 | B | Functional | Bitemporal rows: enrolment, approved change with a future effective date, then query as of dates before and after | One row valid before, the new row valid after; earlier row closed, not updated in place; no committed period output changes | AC-03.2, BR-GEN-02, BR-GEN-03 |
| TS-62 | B | Golden | Orders credited one second before and one second after cut-off in the calendar's time zone, on a plan with a weekly and a monthly calendar | Each order lands in the period its crediting event falls in for each calendar; the crediting event used is the configured one | BR-PER-01, BR-PER-02 |
| TS-63 | B | Golden | Two rank ladders; a position whose title is above its paid-as rank; a requirement evaluated on a rolling window of four periods | State stores both ladders, title and paid-as separately; the rolling requirement uses exactly the four periods | BR-RNK-05, BR-RNK-06, BR-RNK-09 |
| TS-64 | B | Functional | Reinstatement of a terminated position; rule-generated re-parenting on termination; authorisation while the read model is stale | Same position id reinstated with dated event; re-parenting rows carry event type rule and the rule id; stale model falls back to system of record and never returns a node outside the downline | BR-GEN-08, BR-GEN-11, BR-GEN-12 |
| TS-65 | B | Golden | Restocking fee with volume effect off and on; chargeback; participant order without purpose where required; 70/30 roll-up of customer volume | Refund reduced by fee in both, volume effect per setting; chargeback reverses volume like a refund; purpose stored unspecified and counted; volume credited 70 and 30 | BR-RET-03, BR-REV-06, BR-PTY-03, BR-ATT-04 |
| TS-66 | B | Guardrail | Participant fee configured where the pack prohibits fees; override of a warned decision with justification | Fee save refused with rule id; override stored as a new decision row with justification and approver and appears in the compliance report | BR-GRD-02, BR-GRD-05 |
| TS-67 | B | Static | Build-time checks: no binary float type in money code paths; no branch on a tenant identifier in engine code; no occurrence of the word wallet in the UI message catalogue | Build fails on any finding | BR-MNY-01, BR-PLN-05, BR-LED-03 |
| TS-68 | B | Functional | Activation scheduled sooner than the tenant notice period; dispute left unanswered past the market response time | Scheduling refused; dispute escalated and shown as overdue | BR-PLN-04, BR-ADJ-04 |
| TS-69 | V1 | Functional | Self-hosted licence: valid, expired, wrong installation id, invalid signature, clock rolled back, no network | Valid and expired both calculate and pay; expired refuses new versions; wrong id or invalid signature gives read-only mode with export; rollback detected; offline works | AC-58.1, AC-58.4, BR-LIC-01, BR-LIC-02 |
| TS-70 | V1 | Functional | Update package: bad signature; failing golden dataset; failing migration; valid package | First three refused or rolled back with report; valid one activates after second approval; committed runs still replay on their pinned engine | AC-58.2, BR-LIC-03 |
| TS-71 | V1 | Security | Support bundle redaction scan on a seeded installation; vendor access attempt without a session on a self-hosted installation | No personal data, bank details or secrets in the bundle; no vendor access path exists without a licensee-approved session | AC-58.3, BR-LIC-04 |

## 10. Security, isolation and authorisation tests

### 10.1 Isolation (TS-21, A) — release blocker for MVP-A

- Generate one test per endpoint from the OpenAPI document: tenant A credential + tenant B object ids.
- Expected: every request fails **without leaking existence** (TS-21; E-SEC-01 "denied without revealing existence"). Canary rows (QA-01 §2).
- **Build fails if any OpenAPI endpoint is not covered.**
- Rule: BR-SEC-04 (A) — tenant id taken from authenticated session, enforced in the data layer, never accepted from client. AC-29.2.
- Edge: E-SEC-01; E-SEC-02 (market-scoped user requests other market → no rows, via TS-36).

### 10.2 Authorisation matrix (TS-36, A) and downline visibility (TS-20, B)

- TS-36: table-driven, every permission × every base role × market scope. Each role can do exactly what the matrix states. Privileged grants (admin/approver) need a second admin (BR-SEC-05: a user cannot grant permissions they do not hold). AC-36.1 (takes effect only after second admin approves; both audited), AC-36.2 (scoped to market X → API returns no rows for market Y).
- TS-20: leader requests node outside downline by id → **404 identical to unknown id** (AC-05.2, BR-DAT-03). Depth limit + 1 → aggregates only (E-GEN-13). Stale read model → fall back to system of record; never return node outside downline (TS-64, BR-GEN-12; invariant I11).
- Permission strings to enumerate in the matrix (from spec.json `apis`):

| API | Endpoint | Auth | Permission | Idempotency | Rel |
|---|---|---|---|---|---|
| API-01 | POST /v1/imports | User session | import.manage | Idempotency-Key required | A |
| API-02 | GET /v1/imports/{id} | User session | import.manage | Safe | A |
| API-03 | PUT /v1/import-mappings/{id} | User session | mapping.edit, mapping.approve | If-Match version | A |
| API-04 | POST /v1/compliance/snapshots | User session | snapshot.create | Idempotency-Key required | A |
| API-05 | GET /v1/compliance/snapshots/{id} | User session or API key | compliance.read | Safe | A |
| API-06 | GET /v1/compliance/snapshots/{id}/figures/{key}/rows | User session | compliance.read, export | Safe | A |
| API-07 | POST /v1/auth/sessions | Public, rate limited | — | Not applicable | A |
| API-08 | POST /v1/support-sessions | Vendor session / user session | vendor role / vendor_access.decide | Idempotency-Key required | A |
| API-09 | GET /v1/audit-events | User session | audit.read | Safe | A |
| API-10 | POST /v1/orders | API key | orders:write | Idempotency-Key required; natural key source_system + source_order_id | B |
| API-11 | POST /v1/order-events | API key | orders:write | Idempotency-Key required; natural key source_event_id | B |
| API-12 | POST /v1/participants | API key or user session | participants:write; participant.manage | Idempotency-Key required | B |
| API-13 | GET /v1/positions/{id}/downline | User or portal session | genealogy.read / self downline | Safe | B |
| API-14 | GET /v1/genealogy/tree | User session | genealogy.read | Safe | B |
| API-15 | POST /v1/genealogy-cases | User session | case.genealogy.create / approve | Idempotency-Key required | B |
| API-16 | POST /v1/plans/{id}/versions | User session | plan.edit, plan.approve | If-Match version; Idempotency-Key on transitions | B |
| API-17 | POST /v1/simulations | User session | plan.simulate | Idempotency-Key required | B |
| API-18 | POST /v1/periods/{id}/runs | User session | run.execute | Run-Request-Id required | B |
| API-19 | GET /v1/runs/{id}/review | User session | run.review | Safe | B |
| API-20 | POST /v1/runs/{id}/commit | User session **AAL2 fresh** | run.commit; **not preparer** | Idempotency-Key required | B |
| API-21 | GET /v1/result-lines/{id}/trace | User session | trace.read | Safe | B |
| API-22 | POST /v1/restatements | User session | restatement.request / approve | Idempotency-Key required | B |
| API-23 | GET /v1/ledger/accounts/{id}/postings | User session | ledger.read | Safe | B |
| API-24 | POST /v1/ledger/journal-exports | User session or API key | ledger.export | Idempotency-Key required | B |
| API-25 | POST /v1/payout-batches | User session (approve: **AAL2 fresh**) | payout.prepare / payout.approve; **not preparer** | Idempotency-Key required | B |
| API-26 | POST /v1/webhooks/providers/{provider} | Provider signature | Provider allow-list per tenant | Provider event id deduplicated | B |
| API-27 | PUT /v1/payees/{id}/bank-details | Portal session (fresh) or case | self / case approval | Idempotency-Key required | B |
| API-28 | GET /v1/me/statements | Portal session | self | Safe | B |
| API-29 | GET /v1/me/statement-lines/{id}/explanation | Portal session | self | Safe | B |
| API-30 | POST /v1/cases | User or portal session | by case type | Idempotency-Key required | B |
| API-31 | POST /v1/privacy-requests | Public / user session | privacy.manage | Idempotency-Key required | B |
| API-32 | POST /v1/exports | User session or API key | export.full | Idempotency-Key required | B |
| API-33 | Outbound webhooks | HMAC signature | Tenant-configured endpoints | Event id; retries with backoff | B |
| API-34 | GET /v1/me/team | Portal session | self downline, visibility policy | Safe | B |
| API-35 | PUT /v1/customers/{id}/servicing | User session or API key | servicing.manage | Idempotency-Key required | B |
| API-36 | POST /v1/tax/year-end-forms | User session | tax.forms | Idempotency-Key required | B |
| API-37 | GET /v1/integrations/health | User session | integration.read | Safe | B |
| API-38 | POST /v1/migrations/parallel-runs | User session | migration.manage / signoff | Idempotency-Key required | B |
| API-39 | PUT /v1/settings/{key} | User or vendor session | settings.manage and item-specific | If-Match version | A |
| API-40 | POST /v1/users | User session | user.manage | Idempotency-Key required | A |
| API-41 | GET /v1/system/licence | User session AAL2 | system.manage | Idempotency-Key on POST | V1 |

### 10.3 Separation of duties (TS-42, B)

- Run commit, payout batch approval, plan activation, manual adjustment: **preparer refused on each; a different approver succeeds**.
- BR-SEC-06: SoD evaluated from **recorded actor ids on the object**, not role names. BR-ADJ-02/-03, BR-PAY-02, BR-ADJ-01. Approver = beneficiary → refused (E-FIN-10).
- E-SEC-03 (to add): sole admin removing own admin role / deactivating last approver → refused with warning that approvals would be impossible (FR-IAM-003).

### 10.4 Authentication, MFA, step-up (TS-35, A)

- Privileged role without MFA → forced enrolment, cannot reach any page until a factor is enrolled (AC-35.1).
- Repeated failures → temporary lock, generic message not revealing account existence (AC-35.2: five failed sign-ins inside the lockout window, then the sixth attempt is locked).
- Step-up on approval: approval refused until factor verified (AC-07.2). Step-up older than window at approval → `STEP_UP_REQUIRED` (E-SEC-09, SEC-20).
- BR-SEC-02: payout approvers, tenant admins, vendor staff use MFA.
- E-SEC-05 (to add, A*): role changed while signed in → session permissions refreshed or revoked immediately (SEC-34).

### 10.5 Vendor access (TS-37, A; TS-71, V1)

- No session → request refused, logged in **both** vendor and tenant logs. Approved read-only session attempting a write → blocked. Session expiry → access ends (mid-request expiry: request fails; E-SEC-04). BR-SEC-01: no standing vendor access; tenant-approved, time-boxed, logged, visible to tenant.
- Out-of-region support session needs explicit region approval (TS-57, AC-31.1, BR-DAT-09).
- Self-hosted (TS-71, V1): no vendor access path exists without a licensee-approved session; support bundle contains no personal data, bank details or secrets.

### 10.6 Audit, masking, exports (TS-56, A; TS-34, A)

- Audit chain tamper → break detected (AC-54.2). BR-SEC-07: append-only, separate store, hash-chained per tenant.
- Tax id masked by default (all but last characters); staff unmasking audited (AC-48.1).
- Export above cap → refused. Drill-down export → audit event with row count (TS-34, BR-SEC-03).
- E-SEC-08 (to add): audit store unavailable during approval → buffered; money actions blocked beyond buffer limit (FR-AUD-001).

### 10.7 Imports / data minimisation (TS-32, A)

- Upload with forbidden column (email, phone, bank_account, national_id, address) → **batch rejected whole; columns named; zero rows stored**. Detection by name patterns **and** content sampling (e.g. `e_mail_addr`, `iban`; E-CPL-01). BR-IMP-01, -02.

### 10.8 Static build checks (TS-67, B)

Build fails on any: binary float type in money code paths (BR-MNY-01); branch on a tenant identifier in engine code (BR-PLN-05); word `wallet` in UI message catalogue (BR-LED-03).

### 10.9 Penetration test

Independent pen test before the first MVP-B production tenant; high-severity findings closed before MVP-B release candidate.

## 11. Performance targets (all **Proposed**, PRD-03; benchmark not run; confirm at Phase C spike, OQ-05)

| ID | Measure | Target | Test |
|---|---|---|---|
| NFR-PERF-01 | Interactive API read latency | p95 ≤ 300 ms, p99 ≤ 800 ms (server) | perf suite |
| NFR-PERF-02 | API write latency (order ingestion, case actions) | p95 ≤ 500 ms | perf suite |
| NFR-PERF-03 | Order ingestion throughput per tenant | Sustained 50 orders/s; burst 200/s for 10 min; no loss | period-end burst |
| NFR-PERF-04 | Full run, mid-market tenant | ≤ 5 min | TS-29 |
| NFR-PERF-05 | Full run, large tenant (2M positions, deep-leg binary depth 5,000) | ≤ 60 min; worker memory ≤ 8 GB; **must be proven at spike** | TS-29 |
| NFR-PERF-06 | Distributor statement page, 3G-class (1.6 Mbit/s, 300 ms RTT) | Usable ≤ 3 s; ≤ 150 KB transfer excl. cached fonts | TS-30 |
| NFR-PERF-07 | Genealogy authz check / subtree page (read model) | p95 ≤ 100 ms / ≤ 300 ms | E-GEN-11 |
| NFR-PERF-08 | Read-model rebuild after moving 100,000-position subtree | ≤ 10 min, non-blocking writes | E-GEN-12 / TS-64 |
| NFR-PERF-09 | Admin dashboard load | ≤ 2 s to first figures p95 | — |
| NFR-PERF-10 | Compliance snapshot, 1 year mid-market export | ≤ 2 min | — |
| NFR-PERF-11 | Full data export, large tenant | ≤ 6 h from replica | — |
| NFR-PERF-12 | Background job start delay | p95 ≤ 30 s | — |
| NFR-PERF-13 | Concurrent users per large tenant on pay day | 500 staff + 20,000 distributor sessions | — |

TS-29 synthetic shapes: 50k, 500k, 2M positions; balanced binary, deep-leg binary depth 5,000, wide unilevel (50,000 direct children per E-GEN-11); bottom-up volume pass + full run. MVP-B RC gate: targets **met or formally revised**.

## 12. Release gates

| Gate | Criteria |
|---|---|
| Requirement ready for build | Research trace + story + AC + ≥1 TS (QA-04). True for all A and B FRs **except FR-CPL-013**; not true for 14 V1 FRs without AC |
| Change merged | Automated suite green incl. isolation, golden, replay sample, ledger invariants, static checks |
| Engine release | 100% golden pass; differential test zero unexplained differences (TS-60); replay of sampled committed periods identical |
| **MVP-A release** | TS-21, 31, 32, 33, 34, 35, 36, 37, 56, 57 pass; accessibility check of SC-10, SC-24–28, SC-46; data terms and breach contacts in place |
| **MVP-B release candidate** | All MVP-B scenarios pass; performance targets met or formally revised; high-severity pen-test findings closed; restore drill done |
| Tenant go-live | Parallel run, zero unexplained differences (BR-MIG-02); launch checklist complete; tenant golden datasets pass |
| Market pack release | Every rule has basis + status; tax fixtures confirmed by adviser; pack signed |
| Self-hosted release (V1) | TS-69–71 pass; upgrade path tested from previous supported version; install guide + preflight verified on clean env |

### 12.1 Defect severity

| Sev | Definition | Rule |
|---|---|---|
| S1 | Wrong money, cross-tenant exposure, lost or duplicated payout, broken replay, security bypass | **Blocks any release**; root cause + new fixture required |
| S2 | Wrong report figure, wrong state shown, blocked critical journey | **Blocks release** |
| S3 | Impaired with workaround | Fix scheduled |
| S4 | Cosmetic | Backlog |

### 12.2 What is a release blocker (consolidated)

1. Any open S1 or S2 defect.
2. Any failing test in the gate's TS list (MVP-A list above; "all MVP-B scenarios" for MVP-B RC — QA-01 does not say whether the B-MKT scenarios TS-18, 19, 30 belong to the RC or only to the market pack release).
2a. Any other unmet criterion of the applicable §12 gate: MVP-A accessibility check of SC-10, SC-24–28, SC-46, data terms and breach contacts; tenant launch checklist and tenant golden datasets; self-hosted upgrade path, installation guide and preflight.
3. Isolation suite with an uncovered OpenAPI endpoint (build fails).
4. Any golden dataset not 100% passing; any unexplained differential difference (TS-60); any non-identical replay.
5. Any ledger invariant/property invariant (I1–I12) violation; static check finding (TS-67).
6. MVP-B: performance targets neither met nor formally revised; open high pen-test finding; no restore drill.
7. Tenant: any unexplained parallel-run difference (rounding differences too must be explained and approved — E-PLN-05).
8. Market pack: rule without basis/status, unconfirmed tax fixture, unsigned pack.
9. FR without AC/TS cannot enter build (FR-CPL-013 for India pack; V1 list §15.1).
10. A business rule without a test needs one before the release in which it applies (QA-04 §4.5): BR-REV-02 (B) and BR-TAX-04 (B-MKT) once their content is resolved; the V1 rules in §15.3 before V1.

## 13. Test data and environments

- Synthetic data only outside production: seeded generators for chosen tree shapes, order patterns incl. period-end bursts and refunds, payout lines.
- No production personal data in staging. Provider and store fakes scriptable (time-outs, partial rejections, duplicate/out-of-order webhooks).
- A design partner's export used only inside its tenant, under data terms.

## 14. Edge cases — all 112 (QA-03)

Status: covered = TS/fixture exists; TO ADD = behaviour defined, no TS yet (write when increment is built); OPEN = depends on unresolved rule, **must not be assumed**. Rel = earliest release among referenced FR/BR/TS (`*` = inferred).

Summary (verified by recount): 112 total = 68 covered, 39 to add, 5 open.

| Group | Cases | Covered | To add | Open |
|---|---|---|---|---|
| Period and timing | 10 | 5 | 4 | 1 |
| Genealogy | 16 | 10 | 5 | 1 |
| Orders, returns, attribution | 15 | 10 | 5 | 0 |
| Compensation | 22 | 14 | 7 | 1 |
| Ledger and payouts | 17 | 12 | 4 | 1 |
| Compliance, imports, guardrails | 10 | 4 | 5 | 1 |
| Access, tenancy, privacy | 9 | 5 | 4 | 0 |
| Plan change and migration | 6 | 4 | 2 | 0 |
| Portal and self-hosted | 7 | 4 | 3 | 0 |

Note: "covered" includes cases covered by G-E2E-01 (E-CMP-03, E-CMP-06) or QA-01 §8 fault-injection (E-FIN-12, E-FIN-13), not a TS.

### 1. Period and timing

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-PER-01 | Order credited one second before or after cut-off in the calendar's time zone, placed from another time zone | Assigned by the crediting event converted to the calendar's zone; half-open interval | BR-PER-01, -02 | TS-62 | covered | B |
| E-PER-02 | Daylight-saving change on the cut-off day | Cut-off is a wall-clock time in the calendar's zone, resolved to one instant; no hour is counted twice or skipped | SDD-07 §5 | To add | TO ADD | B* |
| E-PER-03 | Order with a credited time in the future, or far in the past | Future beyond tolerance rejected; past into a committed period → late queue | FR-ORD-001, -005 | TS-13 | covered | B |
| E-PER-04 | Two analysts start a run at the same moment | One run; both get the same run id | BR-PER-06 | TS-14 | covered | B |
| E-PER-05 | Run requested while order sync is behind | Refused with last sync time | BR-ORD-05 | TS-58 | covered | B |
| E-PER-06 | Orders keep arriving during a run | The run uses its watermark; later orders belong to the next calculation of the same open period or, after commit, the late queue | SDD-07 §6 | To add | TO ADD | B* |
| E-PER-07 | Weekly and monthly calendars overlap month end | Each calendar assigns independently; a bonus names its calendar | BR-PER-01 | TS-62 | covered | B |
| E-PER-08 | Period with no orders at all | Run completes with zero lines; state and carry still advance; commit allowed | SDD-07 | To add | TO ADD | B* |
| E-PER-09 | Commit attempted on a run superseded by a re-run | Refused (`RUN_SUPERSEDED`) | SDD-06 §3.4 | To add | TO ADD | B* |
| E-PER-10 | The crediting event itself (payment, shipment, end of cooling-off) | **Open** (D-R1): plan-version parameter, no default | PRD-04 §3 | — | OPEN | B* |

### 2. Genealogy

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-GEN-01 | Proposed parent is a descendant of the child | Refused `GEN_CYCLE` | SDD-08 §4 | TS-45 | covered | B |
| E-GEN-02 | Two enrolments target the same binary slot concurrently | Exactly one gets it; the other is placed by the plan's rule; tie-break recorded | BR-GEN-06 | TS-45 | covered | B |
| E-GEN-03 | Correction recorded after the period was committed | Committed output unchanged on replay; affected periods flagged; restatement policy applies | BR-GEN-04 | TS-03 | covered | B |
| E-GEN-04 | Change with a future effective date, then cancelled before it takes effect | Cancellation is a new case that supersedes the pending row; nothing is deleted | BR-GEN-02 | To add | TO ADD | B |
| E-GEN-05 | Two corrections to the same relationship in sequence | Each supersedes the previous; "as known at" any time returns the belief at that time | SDD-08 §2 | To add | TO ADD | B* |
| E-GEN-06 | Change request outside the plan's window | Rejected or exception route if the plan allows | BR-GEN-05 | TS-45 | covered | B |
| E-GEN-07 | Mid-tree position terminated | Status change only; downline untouched; compression or roll-up at calculation time | BR-GEN-07 | TS-02 | covered | B |
| E-GEN-08 | Plan requires re-parenting on termination | Rule-generated dated change rows with the rule id | BR-GEN-08 | TS-64 | covered | B |
| E-GEN-09 | Terminated position reinstated | Same position, new status event; rank and placement per plan rule | BR-GEN-11 | TS-64 | covered | B |
| E-GEN-10 | Participant owns three positions; one is terminated | Other positions unaffected; statement shows remaining positions | BR-GEN-01 | To add | TO ADD | B |
| E-GEN-11 | Very deep leg (depth 5,000) and very wide node (50,000 direct children) | Run within targets; explorer pages children; path length within limits or chunked fallback | SDD-08 §5 | TS-29 | covered | B |
| E-GEN-12 | Subtree of 100,000 moved | One change row; read model rebuilt asynchronously; views stale meanwhile; authorisation never widens | BR-GEN-12 | TS-64 | covered | B |
| E-GEN-13 | Leader requests a node outside their downline, or exactly at the depth limit plus one | 404 identical to unknown; aggregates only beyond the limit | BR-DAT-03 | TS-20 | covered | B |
| E-GEN-14 | Duplicate merge where both accounts own positions in the same leg | Blocked if it would create double ownership conflict or cycle; case decides | FR-PAR-003 | To add | TO ADD | B |
| E-GEN-15 | Sponsor differs from placement parent and a bonus requires personally enrolled volume per placement leg | Bonus evaluates a sponsor-tree predicate inside a placement-tree rule | SDD-07 §3 (M19) | To add | TO ADD | B* |
| E-GEN-16 | Tenant operating in several countries with in-country storage duties | **Open** (OQ-17) | SDD-01 §3.2 | — | OPEN | A* |

### 3. Orders, returns, attribution

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-ORD-01 | Same webhook delivered twice; delivered out of order (refund before order) | One order; the refund waits for the order and alerts after a timeout | BR-ORD-04; FR-ORD-004 | TS-15 | covered | B |
| E-ORD-02 | Same idempotency key, different body | `409 IDEMPOTENCY_CONFLICT` | TRD-03 | To add | TO ADD | B* |
| E-ORD-03 | Order edited in the store after ingestion | Arrives as an order event; original facts unchanged; after commit → late queue | BR-ATT-02 | TS-13 | covered | B |
| E-ORD-04 | Unknown SKU | Held in exception queue; not lost; run blocked if exceptions exceed a tenant threshold at cut-off | FR-ORD-001 | To add | TO ADD | B |
| E-ORD-05 | Partial return of one line of several; return of part of a quantity | Volume reversed per returned unit of that line only | BR-RET-01 | TS-47 | covered | B |
| E-ORD-06 | Return of a bundle component | Volume per the product volume map of the bundle's lines; if the store reports the bundle as one line, proportional by the map | BR-RET-01 | To add | TO ADD | B |
| E-ORD-07 | Equal-value exchange; unequal exchange | Equal: no reversal. Unequal: treated as return plus new order | BR-RET-02 | TS-47 | covered | B |
| E-ORD-08 | Restocking fee | Refund reduced; volume effect by tenant setting | BR-RET-03 | TS-65 | covered | B |
| E-ORD-09 | Returned quantity exceeds purchased minus already returned | Rejected | SDD-04 `order_event` | To add | TO ADD | B* |
| E-ORD-10 | Chargeback, later reversed in the merchant's favour | Treated as refund; then reversal entry | BR-REV-06; SDD-09 §3 (13) | TS-65 | covered | B |
| E-ORD-11 | Customer becomes a distributor mid-period | Type effective-dated; earlier orders keep the customer label | BR-PTY-02 | TS-48 | covered | B |
| E-ORD-12 | Two distributors claim one customer (link from one, code from another) | Tenant precedence rule decides at ingestion; conflict opens a case; later change affects future orders only | BR-ATT-01, -02 | To add | TO ADD | B |
| E-ORD-13 | Servicing distributor terminated; no eligible sponsor | Customers assigned to the company | BR-ATT-03 | TS-49 | covered | B |
| E-ORD-14 | Participant order with no purpose where required | Stored as unspecified; counted in data-quality figures | BR-PTY-03 | TS-65 | covered | B |
| E-ORD-15 | Order for a market that is not Live | Rejected `MARKET_NOT_LIVE` | BR-REG-04 | TS-50 | covered | B |

### 4. Compensation calculation

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-CMP-01 | Pool or split leaves a remainder | Largest remainder; ties by payee id; exact total | BR-MNY-03 | TS-06 | covered | B |
| E-CMP-02 | Cap equals proposed amount exactly; cap larger than proposed | No change; no residue | BR-CAP-01 | To add | TO ADD | B |
| E-CMP-03 | Priority cap where reducing the first bonus to zero is not enough | Continue down the priority list; the last listed is scaled by largest remainder | BR-CAP-01 | G-E2E-01 | covered | B |
| E-CMP-04 | Two caps with overlapping scope | Rejected at configuration unless precedence is stated | FR-PLN-004 | To add | TO ADD | B |
| E-CMP-05 | Per-participant constraint and company cap both apply | Constraint first, then cap | BR-CAP-02 | TS-09 | covered | B |
| E-CMP-06 | Rank tie at a threshold (exactly equal) | Thresholds are inclusive (`gte`) unless the rule says otherwise; stated in the rule | SDD-07 §3 | G-E2E-01 | covered | B* |
| E-CMP-07 | Demotion after a return; grace period | Paid-as recalculated per window; title kept; grace counter decrements | BR-RNK-05..07 | TS-63 | covered | B |
| E-CMP-08 | One-time bonus re-qualified after demotion | Not paid twice | BR-RNK-07 | TS-25 | covered | B |
| E-CMP-09 | Streak counter across a plan version change | Transition rule decides; reported | BR-PLN-01 | TS-24 | covered | B |
| E-CMP-10 | Carry with cap, expiry and loss when unqualified | Truncate; expire; zero | BR-RNK-08 | TS-05 | covered | B |
| E-CMP-11 | Matching on a bonus that is clawed back in the same run | Matching computed on the net of the base bonus | Invariant I7 | To add | TO ADD | B* |
| E-CMP-12 | Pool base changes after a late reversal | Pool of the committed period is not recomputed; effect by the pool bonus's reversal policy (restatement recommended) | SDD-07 §8 | To add | TO ADD | B* |
| E-CMP-13 | Negative gross for a payee after adjustments | Payable never negative; shortfall becomes clawback receivable | SDD-09 §6 | TS-11 | covered | B |
| E-CMP-14 | Points-to-currency factor changes at a period boundary; mid-period change requested | Effective at boundary; mid-period refused | BR-MNY-05 | TS-23 | covered | B |
| E-CMP-15 | Rounding mode changed by the tenant | New settings version effective next period; committed periods replay with their own version | FR-TEN-003 | TS-59 | covered | B |
| E-CMP-16 | Extremely large amounts or volumes | Overflow guard fails the run rather than wrapping | FR-COMP-012 | To add | TO ADD | B |
| E-CMP-17 | Compression where every position on the path is inactive | Volume rolls to the first qualified position or to the company by plan rule; never lost silently (breakage account if retained) | SDD-09 §2 | To add | TO ADD | B* |
| E-CMP-18 | Differential versus override ambiguity | The rule kind states the model; both exist as separate primitives | TS-43 | TS-43 | covered | B |
| E-CMP-19 | Plan activated mid-period | Not possible: effective dates snap to period boundaries | FR-PLN-001 | To add | TO ADD | B |
| E-CMP-20 | Mechanism not expressible in primitives or expressions | Cannot be configured; logged as an extension request; never tenant-specific code | BR-PLN-05 | TS-67 | covered | B |
| E-CMP-21 | Refund of an order that set a rank threshold, under order-line policy | Under-recovery is expected and shown in simulation; restatement policy gives exact figures | SDD-07 §8 | TS-10 | covered | B |
| E-CMP-22 | Whether a reversal may legally alter a closed period | **Open** (D-R2) | PRD-04 §3 | — | OPEN | B* |

### 5. Ledger and payouts

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-FIN-01 | Instruction times out; provider actually received it | Status query before any re-send; same key; one payment | BR-PAY-10 | TS-16 | covered | B |
| E-FIN-02 | Provider rejects 3 of 1,000 lines | Three failed, amounts back to payable; retry failed lines only | FR-PAY-002 | To add | TO ADD | B |
| E-FIN-03 | Payment returned days after settlement | Return entry; case; payee notified | BR-PAY-09 | TS-40 | covered | B |
| E-FIN-04 | Same settlement webhook twice; webhook for an unknown reference; amount differs from instruction | One posting; exception; exception | FR-PAY-004 | TS-41 | covered | B |
| E-FIN-05 | Payee balance changes between batch draft and approval | Amount re-checked in the approval transaction; batch returns to Draft for that line | SDD-06 §3.7 | To add | TO ADD | B* |
| E-FIN-06 | Bank details changed two days before payout; changed twice inside cooling-off | Held; cooling-off restarts from the latest version | BR-PAY-08 | TS-17 | covered | B |
| E-FIN-07 | Many payees change to the same account | Signal; case; payouts held | SEC-40 | To add | TO ADD | B* |
| E-FIN-08 | Clawback larger than all future earnings; payee terminated with a receivable | Receivable ages; write-off with approval; never a debit | BR-REV-08, -09 | TS-11 | covered | B |
| E-FIN-09 | Payable below the minimum for months | Accumulates; appears in the dormant report | BR-PAY-12 | TS-17 | covered | B |
| E-FIN-10 | Approver tries to approve their own batch, run or adjustment; approver is the beneficiary | Refused | BR-ADJ-02, -03 | TS-42 | covered | B |
| E-FIN-11 | Attempt to edit or delete a posting | Database rejects; alert | BR-LED-02 | TS-39 | covered | B |
| E-FIN-12 | Process dies between ledger entry and outbox write | Impossible: same transaction; fault-injection test | SDD-09 | QA-01 §8 | covered | B* |
| E-FIN-13 | Database restored to a point before settlements | Reconciliation required before dispatch resumes; no duplicate instruction | SDD-01 §5 | QA-01 §8 | covered | B* |
| E-FIN-14 | Provider pays twice by its own error | Second settlement is an unmatched exception; case with provider | SDD-01 §5 | To add | TO ADD | B* |
| E-FIN-15 | Payee without tax profile where the pack requires one; tax id supplied after payout | Hold or higher rate per pack; later id applies from the next pay date | BR-TAX-03 | TS-19 | covered | B-MKT |
| E-FIN-16 | Withholding threshold crossed mid-year | Per the market rule's threshold basis; **values and basis open** until a tax adviser confirms | BR-TAX-01 | TS-18 | covered | B-MKT |
| E-FIN-17 | Unclaimed balances | **Open**: legal duties unverified | PRD-04 §3 | — | OPEN | B* |

### 6. Compliance, imports, guardrails

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-CPL-01 | Export contains a forbidden column under an unusual name (for example `e_mail_addr`, `iban`) | Detected by name patterns and content sampling; batch rejected | BR-IMP-01 | TS-32 | covered | A |
| E-CPL-02 | Denominator zero (no sales in a month) | Figure null with reason, not zero | FR-CPL-001 | To add | TO ADD | A |
| E-CPL-03 | Payout line without a source order | Counted and reported as unattributable; excluded from R2 base | FR-CPL-002 | To add | TO ADD | A |
| E-CPL-04 | Re-import while a snapshot is computing | Snapshot aborted and retried, or completes on the old batch and is marked Outdated | FR-CPL-006 | TS-33 | covered | A |
| E-CPL-05 | Mapping changed after a snapshot was shared | New version; old snapshot unchanged, marked Outdated | BR-IMP-03 | TS-33 | covered | A |
| E-CPL-06 | Partial year for the earnings distribution | Labelled partial; cannot be published | FR-CPL-005 | To add | TO ADD | A |
| E-CPL-07 | All participants earned zero | Distribution valid: 0% above zero, median 0 | FR-CPL-005 | To add | TO ADD | A |
| E-CPL-08 | Guardrail predicate cannot read an extension module | Treated as warned; routed to compliance review | FR-CPL-007 | To add | TO ADD | B |
| E-CPL-09 | Guardrail rule at screening status blocks a configuration the tenant believes lawful | Override only where the rule is overridable, with justification; blocked-by-law rules never overridable; basis status shown | BR-GRD-05 | TS-66 | covered | B |
| E-CPL-10 | Which configurations are blocked, warned or reported | **Open** (FD-06, counsel) | PRD-04 §3 | — | OPEN | B* |

### 7. Access, tenancy, privacy

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-SEC-01 | Tenant A token with tenant B object id, on every endpoint | Denied without revealing existence | BR-SEC-04 | TS-21 | covered | A |
| E-SEC-02 | User scoped to one market requests another market's data | No rows | SEC-26 | TS-36 | covered | A |
| E-SEC-03 | Sole admin removes own admin role; last approver deactivated | Refused; warning that approvals would be impossible | FR-IAM-003 | To add | TO ADD | A |
| E-SEC-04 | Vendor session expires mid-request; write attempted in a read-only session | Request fails; write blocked; both logged | BR-SEC-01 | TS-37 | covered | A |
| E-SEC-05 | Role changed while the user is signed in | Session permissions refreshed or revoked immediately | SEC-34 | To add | TO ADD | A* |
| E-SEC-06 | Erasure request from a payee with an open payable or receivable | Deferred with explanation | FR-PRV-002 | TS-28 | covered | B |
| E-SEC-07 | Pseudonymised participant appears in a later restatement | Lines computed on the pseudonymous record; statement not deliverable; amounts handled by tenant policy | ADR-13 | To add | TO ADD | B* |
| E-SEC-08 | Audit store unavailable during an approval | Buffered; money actions blocked beyond the buffer limit | FR-AUD-001 | To add | TO ADD | A |
| E-SEC-09 | Step-up factor older than the window at the moment of approval | `STEP_UP_REQUIRED` | SEC-20 | TS-35 | covered | A |

### 8. Plan change and migration

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-PLN-01 | Activation without simulation, with a failing golden case, without filing where required, or inside the notice period | Blocked with the reason | BR-PLN-02..04, -06 | TS-46, TS-68 | covered | B |
| E-PLN-02 | A state item has no transition rule | Activation blocked | FR-PLN-008 | To add | TO ADD | B |
| E-PLN-03 | Late order for a period under the previous plan version | Adjustment computed with the **original** period's plan version | SDD-07 §8 | To add | TO ADD | B* |
| E-PLN-04 | Migration import with cycles, orphans or opening balances that do not match | Blocked with the list | FR-MIG-001 | TS-52 | covered | B |
| E-PLN-05 | Parallel run differs only by rounding | Classified "rounding"; must still be explained and approved, or the rounding setting aligned | FR-MIG-002 | TS-52 | covered | B |
| E-PLN-06 | Legacy payout file has totals but no bonus detail | Payee-level comparison only, flagged | FR-MIG-002 | TS-52 | covered | B |

### 9. Distributor portal and self-hosted edition

| # | Edge case | Expected | Defined in | Test | Status | Rel |
|---|---|---|---|---|---|---|
| E-DST-01 | Statement opened before the period is committed | Status only, no numbers | FR-DIST-001 | TS-53 | covered | B |
| E-DST-02 | Statement line from an extension rule without an explanation template | Generic explanation listing inputs; flagged to implementation | FR-DIST-002 | To add | TO ADD | B |
| E-DST-03 | Statement viewed offline; connection lost while submitting bank details | Last loaded statement shown with its time; form keeps input and reports failure, never a silent queue | UX-05 §8 | To add | TO ADD | B* |
| E-DST-04 | Terminated distributor signs in | Read access to past statements for the retention period; no changes | FR-IAM-007 | To add | TO ADD | B |
| E-DST-05 | Language missing a translation key | Market default language shown; logged | BR-LOC-01 | TS-30 | covered | B-MKT |
| E-LIC-01 | Licence expired, invalid, wrong installation, clock rolled back, no network | Expired: runs and payouts continue. Invalid or wrong installation: read-only with export. Rollback detected. Offline works | BR-LIC-01, -02 | TS-69 | covered | V1 |
| E-LIC-02 | Update with bad signature, failing golden case or failing migration | Refused or rolled back with a report | BR-LIC-03 | TS-70 | covered | V1 |

## 15. Traceability gaps (QA-04 §4, generated from spec.json)

Clean: §4.1 FRs without screens = none; §4.2 screens without FRs = none; §4.4 AC without test = none; §4.6 BR not referenced by any FR = none; §4.7 APIs without FR = none; §4.8 entities without FR = none; §4.10 stories without FR = none.

### 15.1 FRs without acceptance criteria (not ready for build)

FR-TEN-005 (V1), FR-IMP-004 (V1), FR-CPL-011 (V1), **FR-CPL-013 Market-pack registers (B-MKT; only needed if India pack activated; references TS-68)**, FR-PAR-004 (V1), FR-ORD-006 (V1), FR-CRM-003 (V1), FR-COMP-011 (V1), FR-FIN-006 (V1), FR-FIN-007 (V1), FR-DIST-009 (V1), FR-PRV-003 (V1), FR-INT-004 (V1), FR-AI-001 (V1), FR-AI-002 (V1). = 14 V1 + FR-CPL-013.

### 15.2 FRs with no test at all (all V1)

FR-TEN-005, FR-CPL-011, FR-PAR-004, FR-CRM-003, FR-COMP-011, FR-FIN-006, FR-FIN-007, FR-PRV-003, FR-AI-001, FR-AI-002.

### 15.3 Business rules without a test (13)

| Rule | Rel | Status | Rule |
|---|---|---|---|
| BR-GEN-10 | V1 | C | Succession, divorce division, sale = transfers of position ownership with documents and approval; history stays with the position |
| BR-PER-07 | V1 | R | Provisional run paid, later trued up by final run posting only the difference |
| BR-REV-02 | B | C | Reversal changes closed period vs posts adjustment = tenant policy; **UNRESOLVED legally (D-R2)** |
| BR-TAX-04 | B-MKT | S/C | Year-end statements per market form, thresholds per tax year |
| BR-CMP-09 | V1 | D | Currency conversion by tenant policy, effective-dated rate table |
| BR-CRD-01 | V1 | R | Each credit type has value, expiry, redemption scope, tax treatment flag |
| BR-CRD-02 | V1 | D | Expiry posts reversal of credit liability; holder notified in advance |
| BR-DAT-08 | V1 | D | Distributor-entered prospect data private to that distributor by default |
| BR-DAT-10 | V1 | D | Archived tenant read-only; retained per law then deleted |
| BR-DAT-11 | V1 | S | Retention period per data class per market; deletion jobs logged |
| BR-HON-02 | V1 | D | Earnings shown → published disclosure linked when one exists |
| BR-AI-01 | V1 | D | No model output writes to plans or ledger; AI money text cites lines |
| BR-LIC-05 | V1 | D | Both editions from one codebase, same guardrails/honesty/ledger invariants; no edition removes them; no source-code edition offered |

### 15.4 Critical end-to-end chains (all fully connected)

| Problem | FR | AC | Screen | API | Entity | Test |
|---|---|---|---|---|---|---|
| Retail-customer share (GAP-081) | FR-CPL-001 | AC-24.1, 24.2 | SC-10, SC-46 | API-04, 05 | compliance_report_snapshot, compliance_figure | TS-31 |
| Explainable figure (GAP-027) | FR-CPL-006 | AC-41.1 | SC-26 | API-06 | cpl_fact_* | TS-34 |
| Reproduce past pay (GAP-010) | FR-GEN-002, -003, FR-COMP-008 | AC-01.1, 01.2 | SC-07 | API-14, 18 | relationship, run_snapshot | TS-03, TS-61 |
| Late orders (GAP-023) | FR-COMP-001, FR-ORD-005 | AC-08.1 | SC-32 | API-10 | period, late_transaction | TS-13 |
| Cents reconcile (GAP-021/030) | FR-COMP-012, FR-FIN-001 | AC-14.1..3 | SC-33 | API-23 | journal_entry, posting | TS-06, 38, 39 |
| No double pay (GAP-035) | FR-PAY-003, -004 | AC-16.1..3 | SC-03, SC-34 | API-25, 26 | payout_instruction, outbox_event | TS-16, 40, 41 |
| Cap on right lines (GAP-022) | FR-PLN-004 | AC-11.1, 11.2 | SC-05 | API-16, 17 | plan_rule | TS-07, 08, 09 |
| Insider/isolation (GAP-065) | FR-IAM-005, -001 | AC-29.1..3 | SC-14 | API-08 | support_session, audit_event | TS-21, 37 |
| Bank-detail fraud (GAP-035) | FR-PAY-005 | AC-17.1, 17.2 | SC-22 | API-27 | bank_detail_version | TS-17 |
| Trust in pay (GAP-027/003) | FR-DIST-001, -002 | AC-04.1, 04.2, 12.1 | SC-18 | API-28, 29 | statement, result_line | TS-22, 53 |
| Switching fear (GAP-077) | FR-MIG-001, -002 | AC-28.1, 28.2 | SC-16 | API-38 | simulation | TS-52 |
| Unlawful plan config (GAP-087) | FR-CPL-007 | AC-26.1, 26.2 | SC-04, SC-11 | API-16 | guardrail_decision | TS-26, 27, 66 |

Full forward matrix (122 FRs → stories/AC/screens/APIs/entities/tests) lives in QA-04 §2 and is regenerable from spec.json; engineers should query spec.json rather than copy it.

## 16. Conflicts found

1. **MVP-A items proven only by MVP-B tests.** spec.json: AC-24.1 (figures link to population/method; totals reconcile) and AC-25.1 (distribution includes zero earners; method/version stored) are A, but only TS-59 (B) references them; AC-53.1 (breach contact blocks go-live/first data load) and BR-DAT-07 (A) only via TS-50 (B); BR-HON-01 (A, no income projection) only via TS-53 (B). QA-01 gate says MVP-A needs "breach contacts in place". **Resolution:** for MVP-A, TS-31 implicitly exercises AC-24.1/25.1 (R1–R5 values incl. zero earner); add explicit MVP-A assertions: (a) AC-53.1 first-data-load block, (b) BR-HON-01 honesty scan on SC-10/SC-46 MVP-A screens, (c) AC-24.1 reconciliation with batch control totals. Treat the TS-50/53/59 sub-cases as A-scope for those refs.
2. **MVP-A accessibility gate has no MVP-A scenario.** Gate requires accessibility check of SC-10, 24–28, 46, but TS-54 is B and targets "five highest-risk screens and all distributor pages". **Resolution:** run the TS-54 method on the MVP-A screen list at MVP-A; keep TS-54 for MVP-B scope.
3. **Tests tagged earlier than the items they prove.** TS-35 (A) refs AC-07.2 (B step-up on commit); TS-56 (A) refs AC-48.1 (B tax-id masking); TS-31 (A) refs AC-21.1 (B participant types); TS-38/46/54/55/59 (B) ref B-MKT/V1 items (AC-18.1, BR-PLN-03, BR-REG-05, BR-LOC-01, AC-34.1, AC-18.2, AC-33.1 V1). **Resolution:** run the sub-case only when the referenced capability ships; in MVP-A, TS-35 tests step-up on MVP-A approvals (e.g. role grants, support sessions), TS-56 masking applies when tax ids exist (B). TS-59's AC-33.1 (integrity flags, V1) sub-case is V1.
4. **QA-01 §2 "Functional" scenario list includes TS-69, TS-70 (V1)** while the type table is otherwise MVP-oriented — no conflict in release, just note they are V1 only.
5. **TS-54 proves only BR-LOC-01** (localisation rule, B-MKT) — mismatched ref for an accessibility test. **Resolution:** treat TS-54 as proving WCAG 2.2 AA NFR (not BR-LOC-01); fix ref in spec.json later.
6. **Edge cases mapped to tests that do not assert the edge behaviour:** E-PER-03 (future-dated order rejected) → TS-13 covers only past/late; E-GEN-13 depth-limit+1 → TS-20 covers only outside-downline; E-SEC-06 (erasure deferred with open payable/receivable) → TS-28 expected says only pseudonymise; E-FIN-09 (dormant report) → TS-17 covers holds only; E-FIN-06 second change restarts cooling-off → TS-17 covers single change; E-ORD-01 out-of-order refund waits → TS-15 covers only duplicate; E-FIN-04 amount mismatch → TS-41 covers duplicate + unknown ref only. **Resolution:** extend those TS with the extra assertions rather than counting them as covered.
7. **E-FIN-16 counted "covered" (TS-18) but marked values and basis open** until a tax adviser confirms. **Resolution:** TS-18 asserts configuration-driven behaviour only; the real threshold basis is open (blocks market-pack release).
8. **QA-01 §2 lists TS-03 as Genealogy; QA-02 layer = Replay.** Harmless; layer per QA-02/spec.json is authoritative.
9. **"Business rule" type claims "All" scenarios**, while 13 rules have no test — consistent with QA-04, but BR-REV-02 and BR-TAX-04 are B/B-MKT, so MVP-B is not "every rule tested". Accept as known gap (rule content unresolved).

## 17. Open / unresolved

| Item | What is open | Blocks |
|---|---|---|
| D-R1 (E-PER-10) | Crediting event (payment / shipment / end of cooling-off): plan-version parameter, **no default** | TS-62 configured event; BR-PER-01/-02; period assignment in every golden set |
| D-R2 (E-CMP-22) | Whether a reversal may legally alter a closed period | BR-REV-02 (untested); TS-10 restatement path; TS-51; E-CMP-12 |
| OQ-17 (E-GEN-16) | Multi-country tenant with in-country storage duties | BR-DAT-09, TS-57, FR-TEN-001 region model |
| FD-06 (E-CPL-10) | Which configurations are blocked / warned / reported (counsel) | FR-CPL-007/-008, TS-26, TS-27, TS-66, guardrail rule set |
| E-FIN-17 | Unclaimed balance legal duties unverified | FR-PAY-007 dormant handling, BR-PAY-12 |
| E-FIN-16 / BR-TAX-01 | Withholding threshold values and basis per market (tax adviser) | TS-18, TS-19, TS-38 real rates, Market pack release gate |
| BR-TAX-04 | Year-end form rules per market | FR-TAX-003, B-MKT pack release |
| OQ-05 | Engine/genealogy performance at assumed scale (Phase C spike) | NFR-PERF-04/-05/-07/-08, TS-29, ADR-04, ADR-18, MVP-B RC gate |
| OQ-03 | Distributor needs (devices, language) | NFR-PERF-06, TS-30 |
| FR-CPL-013 | No AC | India market pack activation; TS-68 |
| Corpus-plan and tenant golden datasets | Do not exist | Engine release gate (100% golden), tenant go-live |
| G-E2E-01 follow-ons (a)(b)(c) | Expected values not yet computed | Clawback-policy, sponsor-correction replay, proportional-cap golden tests |
| Performance targets | All Proposed; benchmark not run | MVP-B RC gate |
| RPO ≤ 5 min / RTO ≤ 4 h (NFR-DR) | Proposed; founder sets | Restore drill (MVP-B RC) |
| Usability/accessibility with real users | Not done | UX acceptance |
| 39 "TO ADD" edge cases | Behaviour defined, no TS | Write with the increment that builds them (see §14) |
