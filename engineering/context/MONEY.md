# MONEY — Implementation brief (ledger, payouts, reversals, tax, cases)

Sources (all read in full for the money sections): `04-system-design/09_FINANCIAL_SYSTEM_DESIGN.md` (SDD-09), `02-prd/02_FUNCTIONAL_REQUIREMENTS.md` §3.11–3.14 (FR-FIN, FR-PAY, FR-TAX, FR-CAS) plus FR-COMP-003/-006/-009/-010/-011/-012, FR-IAM-004, FR-TEN-004, FR-MIG-001, FR-DIST-006, `02-prd/04_BUSINESS_RULES.md` (PRD-04), `01-product-definition/04_MARKET_PACKS_INDIA_BANGLADESH.md` (PD-04), `09-governance/traceability-data/spec.json` (stories, ACs, tests, APIs, screens, entities), `09-governance/02_DECISION_LOG.md` (DEC/ADR rows cited).

Release tags: **A** = MVP-A, **B** = MVP-B, **B-MKT** = MVP-B delivered with a market pack, **V1**. Every money capability in this domain is **B** unless marked otherwise. Nothing in the money domain ships in A except the shared generic objects `approval`, `outbox_event`, `export_job` (entities tagged A).

Rule-status codes (PRD-04): **R** primary source read · **S** screening · **D** design rule · **C** needs counsel/tax adviser. "At": **P** platform · **T** tenant setting · **M** market pack · **V** plan version. Precedence: **P > M > T > V** (a tenant cannot relax P; a plan cannot relax M; guardrail overrides BR-GRD-05 are the single exception).

---

## 0. Non-negotiable invariants (build these first)

| # | Invariant | Source | Rel |
|---|---|---|---|
| I-1 | Platform records **obligations of the tenant**, never funds. No wallet, stored value, e-pin, crypto. The word "wallet" must not appear in the UI message catalogue (build fails, TS-67). UI label: "earnings balance owed by the tenant" | BR-LED-03, DEC-03 (provisional, counsel Q-2), FR-FIN-002 | B |
| I-2 | Every journal entry balances: Σ debit = Σ credit (deferred constraint trigger at commit) | BR-LED-01, SDD-09 §4 | B |
| I-3 | `journal_entry` and `posting` are append-only: `UPDATE`/`DELETE` revoked from app roles **and** blocked by trigger; attempt raises alert (AC-14.3, TS-39) | BR-LED-02 | B |
| I-4 | Balances are sums of postings; no editable balance column anywhere. Projection is a cache, rebuildable, verified nightly | BR-LED-02, FR-FIN-002 | B |
| I-5 | Every entry: unique `(tenant_id, idempotency_key)`; duplicate insert returns the existing entry | SDD-09 §4/§8 | B |
| I-6 | Every entry carries `origin_type`, `origin_id`, and `approval_id` where a human decided | BR-LED-01 | B |
| I-7 | **No human posting.** Only entry point = posting rules triggered by approved objects (run commit, approved instruction, provider event, approved case) | SDD-09 §4, FR-FIN-001 perms "System only" | B |
| I-8 | Never a negative payable; shortfall is a positive `clawback_receivable`. Platform **never initiates a debit** from a payee's bank account (no debit instruction object may exist) | BR-REV-09, AC-20.3, TS-11 | B |
| I-9 | Money in integer minor units (`bigint *_minor`) or fixed-precision decimals; binary floating point prohibited (build-time static check TS-67) | BR-MNY-01, FR-COMP-012 | B |
| I-10 | Rounding once per payout line at the rounding pass; mode = tenant setting, platform default **half-up** | BR-MNY-02 | B |
| I-11 | Splits/pools/scaled caps by **largest remainder**; tie-break: fractional part descending, then payee id ascending; parts sum exactly to total | BR-MNY-03, FR-COMP-012 | B |
| I-12 | Unavoidable residue posts to named account `rounding_residue` | BR-MNY-04 | B |
| I-13 | Preparer ≠ approver, evaluated from recorded actor ids (not role names), enforced in service (`PolicyService`) **and** DB (`CHECK approver_id <> preparer_id` on `approval`) | BR-PAY-02, BR-ADJ-02, BR-SEC-06, FR-IAM-004 | B (constraint itself A) |
| I-14 | No parameter value (rate, threshold, window, cooling-off length, minimum payout) is hard-coded; values come from tenant settings, plan versions or market packs (DEC-14). Tests use labelled fixtures | DEC-14, PRD-04 §1 | all |
| I-15 | Restatements and late transactions never edit committed lines or postings; they post as adjustments in the open period | BR-PER-04, BR-PER-05 | B |
| I-16 | AI output may never write to the ledger | BR-AI-01 | V1 |
| I-17 | Licence lapse never blocks calculation, commit, payout, statements or export | BR-LIC-01 | V1 |

Boundaries (SDD-09 §1): Commission statement = generate. Obligations ledger = **system of record**. Wallet = none. Payment processing = integrate via adapters, never touch funds. Regulated account = none. The tenant's bank and GL are outside; the platform's ledger ends at "instruction settled". Remittance of withholding to the authority is the tenant's act outside the platform.

---

## 1. Chart of ledger accounts (ENT-16 `ledger_account`, B)

One set per **tenant × market (currency)**, created at market set-up. Payee-level accounts created on first use.

| `type` (enum, verbatim) | Normal balance (SDD-09) | Granularity | Meaning | Rel |
|---|---|---|---|---|
| `commission_expense` | Debit | Market | Gross compensation earned | B |
| `payee_payable` | Credit | Payee | Owed to payee, not yet instructed | B |
| `withholding_payable` | Credit | Market | Withheld, to be remitted by the tenant | B |
| `payout_in_transit` | Credit | Market | Instructed, not yet settled (clearing) | B |
| `clawback_receivable` | Debit | Payee | Owed back by payee after reversal | B |
| `rounding_residue` | Either | Market | Minor units from allocation | B |
| `breakage` | Credit | Market | Earned by rule but retained (cap residue rule or title mismatch), disclosed | B |
| `write_off` | Debit | Market | Clawbacks not recovered | B |
| `credit_liability` | Credit | Payee × credit type | Non-cash rewards outstanding. **Account type exists from MVP-B; usage V1** | V1 |
| `settled_clearing` | Debit (see Conflict C-3) | Market | Contra for settled payouts; tenant makes its bank entry in its own GL from the export | B |

Columns: `id uuid PK, tenant_id uuid NN→tenant, market_id uuid NN→market, type text NN, payee_participant_id uuid→participant, credit_type_id uuid, currency char(3) NN, gl_code text`.
Unique: `(tenant_id, market_id, type, payee_participant_id, credit_type_id)`. CHECK `type in (...)` the 10 values above. Audit: `gl_code` changes audited.

### 1.1 `journal_entry` (ENT-16, B)
`id uuid PK, tenant_id NN, event_type text NN, origin_type text NN, origin_id uuid NN, idempotency_key text NN, approval_id uuid→approval, posted_at timestamptz NN`.
Indexes: `(tenant_id, idempotency_key) UNIQUE`; `(tenant_id, origin_type, origin_id)`. Insert only; deferred constraint Σdebit=Σcredit over its postings. Is the financial audit record.

### 1.2 `posting` (ENT-16, B; partitioned by posted month)
`id uuid PK, tenant_id NN, entry_id uuid NN→journal_entry, account_id uuid NN→ledger_account, debit_minor bigint NN, credit_minor bigint NN, currency char(3) NN`.
Indexes: `(account_id, id)`; `(entry_id)`. Constraints: insert only (UPDATE/DELETE revoked + trigger); **exactly one of debit, credit non-zero**; amounts ≥ 0.

### 1.3 Balance projection (B)
Projection table per account, updated **in the same transaction** as postings; nightly check projection = Σ postings; mismatch → rebuild + alert (FR-FIN-002). Table not defined in spec.json entities (see Open O-12).

---

## 2. Posting rules per business event (SDD-09 §3)

Every event produces **exactly one balanced entry** with an idempotency key derived from the event. Example amounts are for one payee.

| # | Event | Idempotency key | Debit | Credit | Rel |
|---|---|---|---|---|---|
| 1 | Run committed: gross 100.00, withholding 2.00 | `run:{run_id}` (**one entry for the whole run**) | `commission_expense` 100.00 | `payee_payable` 98.00; `withholding_payable` 2.00 | B |
| 2 | Payout instructed 98.00 | `instr:{instruction_id}:instructed` | `payee_payable` 98.00 | `payout_in_transit` 98.00 | B |
| 3 | Provider confirms settlement | `instr:{id}:settled` | `payout_in_transit` 98.00 | `settled_clearing` 98.00 | B |
| 4 | Payout returned or failed after instruction | `instr:{id}:returned` | `payout_in_transit` 98.00 | `payee_payable` 98.00 | B |
| 5 | Refund after payout: clawback 40.00 | `claw:{origin_id}` (within the run entry of the open period) | `clawback_receivable` 40.00 | `commission_expense` 40.00 | B |
| 6 | Netting against next run's gross 25.00 | Part of that run's entry | `payee_payable` 25.00 | `clawback_receivable` 25.00 | B |
| 7 | Write-off of remaining 15.00 (approved) | `writeoff:{case_id}` | `write_off` 15.00 | `clawback_receivable` 15.00 | B |
| 8 | Manual adjustment +10.00 (approved case) | Within run entry, origin = case | `commission_expense` 10.00 | `payee_payable` 10.00 | B |
| 9 | Rounding residue 0.02 on a pool | Within run entry | `rounding_residue` 0.02 | `commission_expense` 0.02 (or reverse, by sign) | B |
| 10 | Cap residue retained as breakage 15,000.00 | Within run entry | `commission_expense` 15,000.00 | `breakage` 15,000.00 | B |
| 11 | Migration opening balance 55.00 payable | `migration:{batch}:{payee}` | `commission_expense` (opening) 55.00 | `payee_payable` 55.00 | B |
| 12 | Chargeback | Same as refund (#5) by policy | — | — | B |
| 13 | Chargeback reversed in merchant's favour | `claw-rev:{origin_id}` | `commission_expense` | `clawback_receivable` (or `payee_payable` if already netted) | B |
| — | Non-cash credit award / redemption / expiry | not specified | postings to `credit_liability`; expiry posts reversal (BR-CRD-02) | | V1 |
| — | FX difference | not specified | "FX difference account" (not in enum) | | V1 |

Implementation notes derived from the rules:
- The run entry (#1) aggregates: gross lines (expense), netting (#6), adjustments (#8), clawback lines (#5), residue (#9), breakage (#10), withholding. Once-only per origin is enforced at result-line level: `result_line (run_id, origin_type, origin_id) UNIQUE where origin_id is not null` (see C-1).
- Run commit (FR-COMP-006, B): **single DB transaction**: mark run and period Committed, write qualification state, post balanced entry (expense, payables, withholding, residue), write outbox events (`run.committed`). Requires approver ≠ preparer, Finance approver with MFA step-up. Invariant fail → rollback.
- Instruction (#2) is written in the **same transaction** as the `payout_instruction` row and its `outbox_event` row (FR-PAY-003, SDD-09 §5).
- Posting writer runs in the same DB transaction as the business event (SDD-09 §4 diagram).

### 2.1 Worked checks (must be automated tests)

| Test | Scenario | Expected | Rel |
|---|---|---|---|
| TS-38 | Gross 1,234.56; fixture withholding 2.00% | Withholding 24.69; payable 1,209.87; expense 1,234.56 = 1,209.87 + 24.69 | B |
| TS-40 | Commit 98.00 → instruct → return → re-instruct → settle | Payable +98 −98 +98 −98 = 0; in transit +98 −98 +98 −98 = 0; settled clearing 98; each step one balanced entry; Σ postings per account = projection | B |
| TS-11 | Clawback 40.00 vs next earnings 25.00, then approved write-off | Payable 0.00; receivable 15.00 carried; write-off posts 15.00 only with approval; no debit instruction exists | B |
| TS-39 | UPDATE/DELETE on `posting`/`journal_entry` by app role | Rejected by DB; alert | B |
| TS-06 | Pool 62,500.00 over 66 shares (40×1, 10×2, 2×3) | Largest remainder sums to exactly 62,500.00 (naive would pay 62,500.02) | B |
| TS-07 | Proportional cap 8,328.12 over 8 lines Σ 9,403.93 (cap rate 0.8856) | Scaled lines sum exactly 8,328.12 (naive 8,328.14) | B |
| TS-10 | Refund after payout; rank threshold 700 (10% above, 5% below); group volume 800 incl. refunded order 500; matching 20% | Paid A 80.00, C 16.00. Order-line clawback: A −50.00, C 0.00. Restatement: A −65.00, C −13.00 | B |
| TS-23 | Points-to-currency factor changed between periods | Each period uses its own effective factor; statement shows factor | B |
| TS-67 | Static build checks | No binary float in money paths; no branch on tenant id in engine; no "wallet" in UI catalogue → build fails | B |
| TS-53 | Statement arithmetic (BR-PAY-06) | net = gross − withholding − clawback; each payout line itemised by source | B |
| TS-47 | Return of one of two lines; equal-value exchange | Only that line's volume reversed; no reversal for the exchange (BR-RET-01/02, BR-VOL-03) | B |
| TS-65 | Restocking fee with volume effect off/on; chargeback | Refund reduced by fee in both, volume effect per setting; chargeback reverses volume like a refund (BR-RET-03, BR-REV-06) | B |
| TS-15 | Duplicate order webhook | One order; second delivery acknowledged without change (BR-ORD-04) | B |

---

## 3. Balance derivation (FR-FIN-002, B)

- Payee balances shown: **payable** (`payee_payable`), **in transit** (`payout_in_transit` attributable to payee's open instructions), **receivable** (`clawback_receivable`). All are Σ postings as of a time.
- Input: payee, as-of time. Processing: aggregate by account; cached projection rebuilt from postings and verified nightly.
- Permissions: finance roles (`ledger.read`); payee sees own (portal, API-28).
- API-23 `GET /v1/ledger/accounts/{id}/postings` and `GET /v1/payees/{id}/balances` — auth user session, authz `ledger.read`, Safe. Rel B.
- Screens: SC-33 Ledger and journal export (Finance manager, B); SC-18 Distributor statements (B).
- `payout_in_transit` is per market, not per payee; per-payee in-transit = Σ amounts of that payee's instructions in `instructed`/`accepted` (derive from instructions; reconcile against the market account daily).

### 3.1 Nightly / daily integrity checks (SDD-09 §4, §7)

| Control | Check | Frequency | Effect |
|---|---|---|---|
| Run control totals | Σ lines = run total; Σ lines by payee = payable + withholding postings; residue and breakage explained | At commit (**blocking**) | Commit refused |
| Ledger integrity | Every entry balanced; projection = Σ postings | Nightly | Alert; rebuild projection |
| In-transit ageing | Σ `payout_in_transit` = Σ instructions in `instructed` or `accepted`; items older than provider settlement window flagged | Daily | Alert/flag |
| Provider reconciliation | Each settlement line matches one instruction by reference and amount | Per report/webhook | Exception queue |
| Period close | Period → Paid when all instructions terminal; → Closed after sign-off that exceptions resolved (period states per BR-PER-03: Open, Calculating, Calculated, Committed, Paid, Closed; inputs and outputs frozen at Committed) | Per period | State change |
| GL export | Export balances and equals ledger movement for the period | Per export | Export refused if not |

AC-14.2: any committed run — expense = payable + withholding + residue; zero unexplained difference (see C-4 for breakage).

---

## 4. Clawback, reversal, write-off (FR-FIN-003, FR-FIN-004; BR-REV, BR-RET)

### 4.1 Rules

| ID | Rule | At | Status | Rel |
|---|---|---|---|---|
| BR-REV-02 | Whether a reversal changes a closed period or posts an adjustment is tenant policy within platform rules. UNRESOLVED legally (D-R2) | T, M | C | B |
| BR-REV-06 | Chargeback treated like a refund for volume and pay | P | D | B |
| BR-REV-07 | Default clawback method = order-line clawback against future earnings; restatement available per bonus type | T | D/C | B |
| BR-REV-08 | Clawback receivables below a tenant threshold may be written off with approval | T | D | B |
| BR-REV-09 | Platform never initiates a debit from a distributor's bank account | P | D | B |
| BR-RET-01 | Returns reverse volume per returned line, not per order | P | D | B |
| BR-RET-02 | Exchange of equal value flagged as such does not reverse and re-credit volume | T | D | B |
| BR-RET-03 | Restocking fees reduce the refund; volume effect is a tenant setting | T | D | B |
| BR-VOL-03 | Volume reversal proportional to returned lines | P | D | B |
| BR-PER-04 | Transactions arriving after Committed post as adjustments in the current open period | P | D | B |
| BR-PER-05 | Restatement reopens nothing: sandbox recalculation with approval, reason, stored diff; paid amounts corrected by adjustments, never by editing postings | T | D | B |
| BR-PER-07 | Provisional run paid and later trued up by a final run posting only the difference | V | R | V1 |

BR-REV-01, -03..-05 are in the missing original catalogue (OQ-22) — not reproducible; do not invent.

Unresolved defaults (PRD-04 §3): **D-R2** default = adjust in open period; restatement only by approved request. **D-R3** negative balance default = carry as receivable, net against future earnings, write off with approval; never debit a bank account (Q-10 counsel).

### 4.2 Reversal flow by case (SDD-09 §6)

| Case | Flow |
|---|---|
| Refund, period still open | Volume reversed in inputs; **no ledger effect** yet |
| Refund after commit, before payout | Late transaction → adjustment in the open period; earlier payable reduced by netting in next run. **Batches already approved are not altered**; receivable recovered from future earnings |
| Refund after payout | Clawback line per the bonus's policy → entry #5 → netting #6 → carried receivable → optional write-off #7 |
| Partial return | Per line (BR-RET-01); restocking fee reduces refund; volume effect by setting |
| Exchange of equal value | No reversal (BR-RET-02) |
| Chargeback | As refund (BR-REV-06); if later won by merchant → entry #13 |
| Cooling-off and buy-back windows | Market-pack parameters decide when volume is credited and how long reversals may arrive (D-R1, CPL-07). India: **To decide** (AQ-IN-04) |
| Negative balance | Never negative payable; shortfall = positive `clawback_receivable` (BR-REV-09) |

### 4.3 Clawback policy (FR-FIN-003, B)
- Setting per **bonus type**: `order_line` (default) or `restatement`.
  - Order-line: reverse the commission lines whose source is the order.
  - Restatement: sandbox recalculation of the original period for affected payees (FR-COMP-009); includes downstream earners (e.g. matching bonus — AC-20.2).
- Post receivable; net against payable in the **next run up to the available amount**; remainder carried.
- Validation: receivable never exceeds amounts previously paid on affected lines (order-line) or the restated difference (restatement).
- No future earnings → receivable ages; write-off rule applies.
- Policy change: effective at a **period boundary**; prepared by Tenant admin (SDD-09 §9) / Finance manager (FR-FIN-003) — approved by Finance approver (C-7).
- Engine pass order (FR-COMP-003): volumes → qualification/paid-as rank → individual bonuses → matching → pools → per-participant constraints → caps → **netting of clawbacks** → minimums → **rounding once per payout line** → **withholding**.
- ACs: AC-20.1 (order-line: clawback line = commission paid on that order), AC-20.2 (restatement: adjustment = restated − paid for every affected payee incl. matching earners, TS-10), AC-20.3 (clawback > next earnings: payable reaches zero, remainder stays receivable, no debit instruction).
- Screens/APIs: SC-06, SC-33 / API-22 `POST /v1/restatements` (+ GET diff, POST decision; authz `restatement.request` / `restatement.approve`; Idempotency-Key required, B), API-23.

### 4.4 Write-off (FR-FIN-004, B)
- Eligible: receivable below tenant threshold **or** older than an age limit (both tenant settings, no values).
- Single or batch with preview; case type `write_off`; posting #7 on approval only.
- Validation: amount ≤ receivable. Error: above threshold without second approver.
- Finance manager proposes; Finance approver approves (≠ proposer). API-30 `POST /v1/cases`. Screen SC-33 (receivables ageing; propose write-off). US-20 alt: payee with no future earnings → receivable ages until written off.

### 4.5 Restatement (FR-COMP-009, B) and adjustment lines (FR-COMP-010, B)
- Restatement: request with reason → sandbox run with corrected inputs → per-payee per-bonus diff → second-person approval → adjustment lines in open run referencing the restatement; statement shows them separately. Validation: diff totals = Σ adjustments. Diff empty → closed, no action. TS-51: diff stored; adjustments equal diff; no posting edited; original period hash unchanged.
- Open run includes adjustment lines from: late transactions, clawback netting, approved manual adjustments, restatements — each with `origin_type`, `origin_id`; each origin consumed **once** (unique `(run_id, origin_type, origin_id)`). Origin withdrawn before run → skipped, logged. Included in control totals by category.
- TS-13: order dated inside a committed period → late-transaction queue; adjustment line in open run linked to original period; committed period hash unchanged.

---

## 5. Idempotency (SDD-09 §8)

| Boundary | Key | Guard | Rel |
|---|---|---|---|
| Run request | `(tenant, period, run_request_id)` (BR-PER-06 adds calendar) | Unique index; advisory lock against concurrent runs. TS-14: two concurrent requests → one run, both callers same run id | B |
| Ledger entry | `(tenant, idempotency_key)` derived from origin (keys in §2) | Unique index; duplicate returns existing entry | B |
| Payout instruction | `(tenant, idempotency_key)`; **same key sent to the provider** | Unique index + provider-side idempotency | B |
| Inbound provider event | `(tenant, provider, event_id)` → `inbound_event (tenant_id, source, idempotency_key) UNIQUE`; same key with different `payload_hash` rejected | Handler also checks instruction state | B |
| Adjustment origin | `(run_id, origin_type, origin_id)` | Unique index on `result_line` | B |
| Order / order event | `(tenant, source_system, source_id)` | Unique index (BR-ORD-04) | B |
| Mutating APIs | `Idempotency-Key` header required on API-22, -24, -25, -27, -30, -36; API-39 uses `If-Match` version | | B (API-39 A) |

AC-16.1 / TS-16: instruction times out → retried → provider receives same key; at most one payment (sandbox shows one).
AC-16.3: same settlement webhook twice → one settlement posting; second acknowledged without change.
Outbox (ADR-10, provisional): at-least-once delivery, at-most-once effect. `outbox_event` (A): `id, tenant_id, seq bigserial, topic, key, payload jsonb, available_at, attempts, dispatched_at, dead boolean`; index `(dispatched_at, available_at) WHERE dispatched_at IS NULL`; written in same transaction as the state change.

---

## 6. Payouts

### 6.1 Payout batch state machine (FR-PAY-001, ENT-17 `payout_batch`, B)

States (DB enum, verbatim): `draft, reviewed, approved, instructing, partially_settled, settled, failed, cancelled`.

| From | To | Trigger / guard |
|---|---|---|
| (new) | `draft` | Payout officer prepares (`payout.prepare`) |
| `draft` | `reviewed` | Preparer submits |
| `reviewed` | `draft` | Payee balance changed since draft (line recalculated) or edit |
| `reviewed` | `approved` | Finance approver (`payout.approve`), **≠ preparer**, step-up MFA (AAL2 fresh); second approver above settings threshold |
| `reviewed` | `cancelled` | Cancel |
| `approved` | `instructing` | Instructions created; payable → in transit (entry #2 per instruction) |
| `instructing` | `partially_settled` | Some instructions terminal |
| `instructing` | `settled` | All settled |
| `partially_settled` | `settled` | Remaining settled or resolved |
| `instructing` | `failed` | Provider rejects whole batch |
| `failed` | `instructing` | Retry after fix — **failed lines only** (API-25 `…/retry-failed`) |

Columns: `id, tenant_id, market_id NN, provider_config_id NN, state NN, total_minor bigint NN, currency char(3) NN, exclusions jsonb, prepared_by NN→user_account, approval_id→approval`. Index `(tenant_id, state)`. Transitions audited.

Grouping: one batch per **market × provider × currency**.
Preconditions: period Committed; provider configured and eligible (FR-PAY-006).
Validation: batch total = Σ instruction amounts; each instruction ≤ payee payable. AC-47.2: total = Σ instructions = amount moved payable → in transit.
Errors: approver = preparer; provider not eligible; payee balance changed since draft (line recalculated, batch back to Draft).
API-25 `POST /v1/payout-batches`, `…/{id}/submit`, `…/approve`, `…/retry-failed`; authz `payout.prepare` / `payout.approve`; "not preparer"; Idempotency-Key required. Screen SC-03 (Payout officer; Finance approver).
Outbound events: `payout.batch.approved`; webhooks API-33 `payout.settled`, `payout.returned` (+ internal `payout.failed`).

### 6.2 Selection and holds (FR-PAY-001, FR-PAY-007, BR-PAY-12)

Selection: payees with `payee_payable` **≥ market minimum** and **no hold**.
Hold reasons (each excluded payee listed with reason in `exclusions`):
1. bank-detail cooling-off (`bank_detail_version.cooling_off_until` in future),
2. open duplicate case,
3. missing tax profile where the market pack requires it,
4. manual/tenant hold with reason (by rule or authorised user).

- Below-minimum payables accumulate. Minimum = market-level setting (T, M); no value defined.
- Holds are **dated events with reason, owner and release** (validation: reason and owner required). Placed by Payout officer; Compliance officer for holds.
- Dormant balance report: payables with no successful payout for a configurable time (no duty assumed — GAP-035 open).
- AC-47.1: payee below minimum and payee in cooling-off → both excluded with reasons; payables remain. TS-17: bank detail changed 2 days before payout with cooling-off > 2 days → held; notices recorded.

### 6.3 Payout instruction state machine (ENT-17 `payout_instruction`, B)

DB enum (verbatim): `pending, instructed, accepted, settled, returned, failed, cancelled`.

| From | To | Trigger | Ledger |
|---|---|---|---|
| (new) | `pending` | Batch approved; row created with key + signature + outbox row in one txn | #2 posted at creation (payable → in transit) |
| `pending` | `instructed` | Dispatcher sends with idempotency key | — |
| `instructed` | `instructed` | Timeout → **status query** → resend **same key** | — |
| `instructed` | `accepted` | Provider acknowledges | — |
| `accepted` | `settled` | Settlement confirmed | #3 |
| `accepted` | `returned` | Bank returns | #4; amount back to payable; **case opened** (`returned_payment`); payee notified |
| `instructed` | `failed` | Permanent rejection | #4 (key `instr:{id}:returned`); amount back to payable |
| `settled`/`returned`/`failed` | terminal | | |

Columns: `id, tenant_id, batch_id NN, payee_participant_id NN, bank_detail_version_id NN, amount_minor bigint NN, idempotency_key text NN, signature bytea NN, state NN, provider_ref text, attempts int NN, last_error text`. Indexes: `(tenant_id, idempotency_key) UNIQUE`; `(batch_id, state)`; `(provider_ref)`. CHECK `amount > 0`. State changes audited via ledger entries and inbound events.

Re-instruction of a returned/failed amount = a **new instruction** (new id, new key) in a later batch (US-16; TS-40).

### 6.4 Dispatch, signature, adapters (FR-PAY-002, FR-PAY-003, B)

- **Signature** (BR-PAY-10, threat T13): HMAC or asymmetric signature over `(tenant, instruction id, payee, bank-detail version, amount, currency, key)` with a **per-tenant signing key from the secrets manager**; verified before dispatch; tampered row refused.
- Dispatcher: exponential backoff; stores provider reference; **never re-sends without a status query when outcome is unknown**.
- Adapter interface: `submit`, `query status`, `parse settlement report`, `verify webhook`. One adapter per payout provider + one bank-file adapter per file format (produces file for manual upload, accepts result file).
- Tenants bring their own provider accounts (ADR-09, DEC-03); credentials encrypted per tenant; `provider_config.credentials_secret_ref` points to the secrets manager — secrets never in the table.
- Provider must be on tenant allow-list for the market. Errors: provider rejects batch → retry failed lines only; invalid credentials → batch paused.
- ADR-09 (provisional): at least two payout routes per launch market.
- Permissions: system; Tenant admin manages provider config (SC-13).

### 6.5 Provider eligibility (FR-PAY-006, BR-PAY-11, B)
`provider_config`: `id, tenant_id, market_id, kind in (payout, payment, commerce, messaging), provider, credentials_secret_ref NN, approved_description, approval_document_id→document, approved_at date, funds_holder, state NN, last_ok_at`; unique `(tenant_id, kind, provider, market_id)`; changes audited.
Per tenant × market: provider, approval date, approved business description, who holds funds, evidence document (required). Go-live blocked without it (FR-TEN-004; AC-38.1: blocked, missing item named; TS-50). Reminders before expiry/review dates. API-39 `PUT /v1/settings/{key}` (`settings.manage`, If-Match). Screens SC-17, SC-13. Tenant admin records; Compliance officer signs off checklist.

### 6.6 Settlement reconciliation and returns (FR-PAY-004, BR-PAY-09, B)
- Inputs: provider webhooks (API-26 `POST /v1/webhooks/providers/{provider}`; auth provider signature; provider allow-list per tenant; provider event id deduplicated) and settlement report imports.
- Match each settlement line to one instruction by reference **and** amount. Amount ≠ instruction amount → exception.
- Exceptions queue reasons: `unknown reference`, `amount mismatch`, `duplicate settlement`, `missing settlement`. Duplicate webhook → acknowledged without change.
- Daily reconciliation totals per provider; period → Paid when all instructions terminal.
- Payout officer resolves exceptions (`payout.reconcile`). Screen SC-34.
- AC-16.2: returned → amount to payable, case opens, payee notified.

### 6.7 Bank-detail controls (FR-PAY-005, BR-PAY-08, ENT-19 `bank_detail_version`, B)
- Encrypted versions: `id, tenant_id, participant_id NN, details_ciphertext bytea NN, fingerprint bytea NN, masked text NN, created_via in (self, case, migration), cooling_off_until timestamptz NN, verified_at, superseded_at`. Indexes `(participant_id, superseded_at)`, `(tenant_id, fingerprint)`. Insert only except `superseded_at`. Creation audited; notices recorded.
- New/changed version requires **fresh re-authentication** (AC-17.2: without it → refused, no version created); validate format per market; account-holder name match where pack requires; notify **old and new** contacts; set `cooling_off_until` (length = tenant setting, no value); payouts due inside cooling-off held (AC-17.1).
- Signal when many payees change to the same account (fingerprint); shared above threshold → case.
- US-17 alt: payout due inside cooling-off is held and the hold is **shown on the statement**.
- Staff change: Support agent only through a case (`bank_detail`) with evidence + **second staff member** approval; cooling-off still applies.
- Instruction pins `bank_detail_version_id` (part of signature).
- API-27 `PUT /v1/payees/{id}/bank-details` (portal session fresh, or case; authz self / case approval; Idempotency-Key). Screens SC-22 (distributor), SC-09 (staff). FR-DIST-006 self-service view (masked) of bank details, tax profile, cooling-off status and affected payouts.

---

## 7. Approvals and separation of duties (SDD-09 §9, FR-IAM-004, BR-ADJ-02/03)

| Action | Preparer | Approver | Extra | Rel |
|---|---|---|---|---|
| Commit run | Commission analyst | Finance approver | Step-up; review opened | B |
| Approve payout batch | Payout officer | Finance approver | Step-up (AAL2 fresh); second approver above threshold | B |
| Manual adjustment | Commission analyst | Finance approver | Reason, evidence; related-party and new-account blocks; second approver above tenant threshold | B |
| Write-off | Finance manager | Finance approver | Threshold (second approver above it) | B |
| Restatement | Compliance officer or analyst | Finance approver | Diff reviewed | B |
| Clawback policy or rounding mode change | Tenant admin | Finance approver | Effective at period boundary | B |
| Bank-detail change by staff | Support agent (case) | Second staff member | Evidence; cooling-off still applies | B |
| Opening balances (migration) | Implementation consultant | Tenant Finance approver | Once (BR-MIG-01) | B |

Enforcement: service layer (`PolicyService`) + DB `approval` (A): `id, tenant_id, object_type NN, object_id NN, preparer_id NN, approver_id NN, decision in (approved, rejected), reason, factor_verified_at, decided_at NN`; `CHECK approver_id <> preparer_id`; immutable audit record.
FR-IAM-004 extra: compare approver with preparer **and all contributors** to the object; refuse if approver is the beneficiary payee or a declared related party (adjustments). No eligible approver → delegation rule lists eligible users; never self-approval.
TS-42: preparer refused on run commit, batch approval, plan activation, adjustment; different approver succeeds.
Step-up required for: commit, batch approve, activate, adjust, write-off, bank change, unmask.

Permission strings in this domain: `ledger.read`, `ledger.export`, `payout.prepare`, `payout.approve`, `payout.reconcile`, `restatement.request`, `restatement.approve`, `tax.forms`, `tax.read`, `settings.manage`, case permissions "by case type" (screen SC-06: `case.<type>.read/act`; SC-08: `case.genealogy.*`, `case.duplicate.*`). Run-side: `run.execute`, `run.review`, `run.commit`. Screen-level (spec.json): `participant.read` + extra permission to unmask (SC-09), `integration.manage` (SC-13, provider/connector config), `market.manage` / `market.signoff` (SC-17 launch checklist).

---

## 8. Cases (FR-CAS, B)

### 8.1 Framework (FR-CAS-001)
`case` (SQL table name `case_file`, ENT-06): `id, tenant_id, type NN, subject_type NN, subject_id NN, reason_code NN, state NN, payload jsonb NN, effect_preview jsonb, due_at, opened_by, assigned_to, approval_id`. Indexes `(tenant_id, type, state)`, `(tenant_id, subject_type, subject_id)`.
`type in (genealogy_change, genealogy_correction, duplicate, transfer, adjustment, dispute, restatement, returned_payment, write_off, bank_detail, grievance, privacy)`.
`case_event`: `id, tenant_id, case_id NN, occurred_at NN, actor_id, kind NN, data jsonb`; index `(case_id, occurred_at)` — insert only; is the audit record; every case change is a case_event. `case.state` values are not enumerated in spec.json (only dispute states, §8.3).
Roles: Support agent; Commission analyst; Compliance officer. Precondition: user has permission for the case type. Business rule BR-ADJ-01. Story US-02 (AC-02.1 change outside window rejected or routed to exception approver; AC-02.2 cycle refused `GEN_CYCLE`).
Processing: type-specific workflow and policy checks; SLA timers from market pack or tenant setting; **effect preview before approval**. Reason code from the type's list; missing evidence where required → error. API-30 `POST /v1/cases`, `…/{id}/decision` (user or portal session; authz by case type; Idempotency-Key). Screens SC-06, SC-08.

### 8.2 Manual adjustment (FR-CAS-002, BR-ADJ-01..03)
- Case `adjustment` with reason code + evidence (BR-ADJ-01). Amount non-zero; payee in tenant. Precondition: open period.
- Above tenant threshold → second approver; nobody approves own (BR-ADJ-02).
- Adjustments to approver's own account, declared relatives, or accounts created in last *n* days (setting) → **blocked or escalated** per tenant setting (BR-ADJ-03). AC-49.1 states the same for the **proposer's** own or declared related account (and the proposer cannot approve) — enforce for both approver and proposer.
- Commission analyst proposes; Finance approver approves. Screen SC-06; API-30.
- On approval → one adjustment line in the open run (FR-COMP-010) → posting #8 inside run entry. AC-49.2: one line with case reference; not recreated on re-run.

### 8.3 Commission dispute (FR-CAS-003, BR-ADJ-04)
- States (verbatim): `opened`, `under review`, `resolved upheld`, `resolved not upheld`. Response time per market where required (T, M; status S).
- Opened from a statement line; trace attached automatically; one open dispute per line; dispute window = tenant setting (expired → explanation shown). Upheld → adjustment or restatement request; outcome + explanation sent.
- Permissions: line owner (Distributor) opens; Commission analyst resolves. Screens SC-18 (dispute line), SC-06; API-30; entities `case`, `result_line`.
- AC-50.1: trace attached and response clock running. TS-68: dispute unanswered past market response time → escalated, shown overdue.

---

## 9. Tax: profile and withholding (FR-TAX)

### 9.1 Rules

| ID | Rule | At | Status | Rel |
|---|---|---|---|---|
| BR-TAX-01 | Withholding rules effective-dated, market-scoped: rate, threshold, threshold basis, payee conditions | M | S/C | B-MKT |
| BR-TAX-02 | Withholding computed after gross commission and before payout instruction; posts to withholding liability | P | D | B |
| BR-TAX-03 | Missing tax id applies market's higher rate where law sets one | M | S/C | B-MKT |
| BR-TAX-04 | Year-end statements per market form with thresholds per tax year | M | S/C | B-MKT |

### 9.2 Payee tax profile (FR-TAX-001, ENT-18 `tax_profile`, B)
`id, tenant_id, participant_id NN, residency, entity_type, tax_id_document_id→document, tax_id_masked, prior_year_totals jsonb, valid_from NN, valid_to`. Index `(participant_id, valid_from)`. `EXCLUDE` overlapping ranges per participant. Unmask logged.
- Tax id stored in the **sensitive store**, masked on display (last characters only); staff unmask audited (AC-48.1).
- Validate format per market pack; version the profile; missing id flags payee for higher rate where rule sets one; missing profile → payout hold if pack requires.
- Edited by payee (API-27 `PUT …/tax-profile`) or Finance manager through a case. Screens SC-22, SC-09.
- US-19 alt: tax id supplied later applies from the **next pay date**; no retroactive change unless the market's rule requires.

### 9.3 Withholding rule and computation (FR-TAX-002, B-MKT)
`tax_rule` (not tenant-scoped; pack data): `id text PK, market_pack NN, kind NN, conditions jsonb NN, rate numeric(9,6), threshold_minor bigint, threshold_basis text, missing_id_rate numeric(9,6), rounding text NN, effective_from date NN, effective_to date, basis text NN, basis_status NN`. Index `(market_pack, effective_from)`. `basis_status in (screening, primary_read, counsel_confirmed)`; **no values ship without a basis**; pack releases versioned.
`tax_line` (insert only): `id, tenant_id, run_id NN, payee_participant_id NN, rule_id NN→tax_rule, taxable_minor NN, withheld_minor NN`; index `(run_id, payee_participant_id)`.

Algorithm (engine pass 11 = last pass, after rounding):
1. Select rule for **market and pay date** (effective-dated).
2. Evaluate payee conditions (tax profile; threshold vs threshold basis, e.g. prior-year total from this payer).
3. Rate = `missing_id_rate` if no valid tax id and rule sets one, else `rate`.
4. Withholding = taxable base × rate, rounded per `rounding`.
5. Write `tax_line`; separate statement line; at commit credit `withholding_payable`, reduce payable.
6. Validation: gross = net + withholding per payee.
7. No rule for market and date → **zero withholding + exception flag for review**.
Precondition: pack tax rules at counsel-confirmed status **or written risk acceptance** (see C-9). Rules maintained in market packs; tenant Finance manager reviews (SC-12, API-39).
Tests (B-MKT): TS-18 (below threshold zero; above → configured rate; values from configuration only), TS-19 (missing id → higher rate shown), TS-38.

### 9.4 Year-end (FR-TAX-003, B-MKT)
Precondition: tax year closed in the ledger. Totals per payee per form type from tax lines and postings; missing tax ids listed and those payees' forms held; form templates in market pack; regeneration creates new version, never overwrites (`tax_form`: `id, tenant_id NN, market_id NN, tax_year int NN, form_type NN, participant_id NN, totals jsonb NN, document_id NN→document, version int NN`; unique `(tenant_id, tax_year, form_type, participant_id, version)`; generation audited); form totals = ledger totals (AC-18.2). Distributed to payees and exported for tenant filing tool. API-36 `POST /v1/tax/year-end-forms` (`tax.forms`, Idempotency-Key). Screen SC-12.

---

## 10. GL export, migration, currency, non-cash

| Item | Spec | Rel |
|---|---|---|
| GL journal export (FR-FIN-005) | At period Committed/Closed or on request: aggregate postings by mapped account (`ledger_account.gl_code` → tenant chart) and dimension; lines reference run ids; balanced file; recorded as `export_job` (re-downloadable; destination must be in tenant region). Unmapped account → export blocked with list. API-24 `POST /v1/ledger/journal-exports` (`ledger.export`, session or API key, Idempotency-Key). AC-15.1 | B |
| Period reporting | Exports group postings by period through the origin run or batch (`posted_at` is not the period) | B |
| Migration opening balances (FR-MIG-001, BR-MIG-01) | Entry #11 per payee, key `migration:{batch}:{payee}`; posted **once** with tenant Finance approver; identifiable as migration; opening balances = legacy balances by payee. Bank details imported with `created_via = migration` | B |
| Parallel run (BR-MIG-02) | Go-live requires zero unexplained per-payee differences (TS-52) | B |
| Currency | One currency per market; every amount carries currency; no conversion. INR 2 decimals | B |
| Multi-currency (FR-FIN-007, BR-CMP-09) | `fx_rate (tenant_id, base, quote, rate numeric(20,10), source, valid_from)` unique `(tenant_id, base, quote, valid_from)`; conversion at one defined pass; stale rate (older than policy) blocks; statements show original, rate, converted; FX difference account. No ACs yet | V1 |
| Non-cash rewards (FR-FIN-006, BR-CRD-01/02) | `credit_type (code, unit_value_minor, expiry_days, redemption_scope, taxable)`; balances are postings on `credit_liability`; redemption ≤ balance; expired redemption refused; expiry posts reversal and notifies in advance. No ACs yet | V1 |
| Provisional + true-up (FR-COMP-011) | Final − provisional = true-up per payee; negative true-up handled by clawback policy | V1 |
| Points-to-currency (BR-MNY-05) | Effective-dated per market; shown on statements | B |
| Statement itemisation (BR-PAY-06) | Statements itemise each payout line by source (gross, withholding, clawbacks, adjustments, net, payout status on SC-18); TS-53: net = gross − withholding − clawback | B |

---

## 11. India market pack (IN-2026.0) — money-relevant values and status

Pack status values: **Confirmed** (may ship) · **Sourced** (not shippable; confirm first) · **To decide** · **Product default** (behaviour ships, value may not). **No item in PD-04 is Confirmed today.** Release rule: a pack version is released only when (a) every shipped item is Confirmed, (b) golden-dataset tests pass, (c) change notice lists changes (FR-LIC-002 for self-hosted).

| Item | Value | Status | Blocks / question | `tax_rule.basis_status` mapping |
|---|---|---|---|---|
| Withholding on commission — rate | **2%** | Sourced (s.393, Income-tax Act 2025; PD-04 §2.2, research 70–71) | Tax adviser / CA | `screening` |
| Annual threshold per payee | **₹20,000** (threshold basis: per financial year) | Sourced | Tax adviser; `threshold_basis` enum undefined (O-6) | `screening` |
| Rate without PAN (`missing_id_rate`) | **20%** | Sourced | Tax adviser | `screening` |
| Financial year | **April–March** | Sourced | — | — |
| Payee tax profile | PAN, PAN status | Product default | — | — |
| Return export | Quarterly withholding return data (**Form 26Q**) | Form name Sourced; layout **To confirm** | AQ-12 (AQ-IN-06) | — |
| GST on commission | — | **To decide** | AQ-12 (AQ-IN-06) | none |
| Buy-back and cooling-off | — | **To decide** | AQ-12 (AQ-IN-04); blocks reversal windows | none |
| Payout routes | Bank file (**NEFT/IMPS**) first; **RazorpayX** and **Cashfree Payouts** after written eligibility | Product default; providers To confirm | AQ-01 | — |
| Currency | INR, 2 decimal places | "Confirmed by currency standard" (see C-11) | — | — |
| Grievance timers | Ack **48 hours** / resolution **one month** | Product default behaviour; values Sourced | — | — |
| Entry fee guardrail | Blocked | Sourced | BR-GRD-02 | — |
| Pay on enrolment alone | Blocked | Sourced | BR-GRD-01 | — |
| Personal purchase requirement to earn | Blocked/Warned/Reported **To decide**; R4 always reports | To decide | AQ-10 | — |
| Registration evidence | DPIIT registration recorded; go-live blocked without it | Sourced | FR-TEN-004 | — |
| Data region | India cell; backups and logs in India | Product default; scope of "consumer data" To decide | AQ-11 (AQ-IN-02) | — |
| DPDP processor duties | Breach notification; erasure by **pseudonymisation where ledger retention applies** | Sourced (phases to May 2027); counsel | — | — |
| Statement languages | English; Hindi and regional languages for distributor statements | To decide | OQ-03 | — |
| Plan mechanics first | Stairstep differential; company-wide pools by shares with per-person monthly caps; accumulated-volume ranks | Research 74 (weak) | — | — |

Engineering consequence: the IN pack's `tax_rule` row can be authored with `rate=0.020000`, `threshold_minor=2000000` (₹20,000.00 in paise), `missing_id_rate=0.200000`, `basis='s.393 Income-tax Act 2025'`, `basis_status='screening'`, but the pack version **must not be released** and go-live in India is blocked until the CA confirms (or written risk acceptance per C-9). TS-38's 2% is a labelled fixture, not the India value.

### Bangladesh (DEC-20, provisional; AQ-13)
No MLM pack; tenants cannot select Bangladesh for any plan with a multi-level component. Conditional BD-AFF single-level pack **not specified for build**, and exists only if Bangladeshi counsel answers AQ-BD-01 favourably; guardrail Blocked for any component paying on recruits' sales or recruitment; withholding 10% flat (s.94 Income Tax Act 2023, Sourced, To confirm) + TIN capture; payout route bKash corporate disbursement file (To confirm); complaint timer 72 h (Sourced); BDT; Bangla.

### US-18 / US-19 example packs
US-18 (B-MKT) example pack: Malaysia (rate and threshold to be confirmed). US-19 (B-MKT) example pack: India missing-PAN higher rate (to be confirmed by a chartered accountant).

---

## 12. Screens and APIs index (money)

| ID | Name / path | Authz | Rel |
|---|---|---|---|
| SC-03 | Payout batches and approvals | Payout officer; Finance approver (`payout.prepare`; `payout.approve`) | B |
| SC-06 | Cases: adjustments, disputes, restatements | Commission analyst; Compliance officer; Finance approver (`case.<type>.read/act`) | B |
| SC-09 | Participant record | Support agent; Finance manager (`participant.read`; unmask needs extra permission, audited) | B |
| SC-12 | Tax configuration and year-end forms | Finance manager (`tax.read`; `tax.forms`) | B |
| SC-13 | Integrations and sync health | Tenant admin; Integration developer (`integration.manage`) | B |
| SC-17 | Market launch checklist | Tenant admin; Compliance officer (`market.manage`; `market.signoff`) | B |
| SC-18 | Distributor: statements and line explanation | Distributor (self only) | B |
| SC-22 | Distributor: bank details and tax profile | Distributor (self only, fresh authentication) | B |
| SC-33 | Ledger and journal export | Finance manager (`ledger.read`; export) | B |
| SC-34 | Payout reconciliation and returned payments | Payout officer (`payout.reconcile`) | B |
| API-22 | `POST /v1/restatements` (+GET diff, POST decision) | `restatement.request` / `approve` | B |
| API-23 | `GET /v1/ledger/accounts/{id}/postings`; `GET /v1/payees/{id}/balances` | `ledger.read` | B |
| API-24 | `POST /v1/ledger/journal-exports` | `ledger.export` | B |
| API-25 | `POST /v1/payout-batches`; `…/{id}/submit`, `…/approve`, `…/retry-failed` | `payout.prepare` / `payout.approve`; not preparer; approve AAL2 fresh | B |
| API-26 | `POST /v1/webhooks/providers/{provider}` | Provider signature; provider allow-list per tenant | B |
| API-27 | `PUT /v1/payees/{id}/bank-details`; `PUT …/tax-profile` | self (fresh portal session) / case approval | B |
| API-28 | `GET /v1/me/statements` | self | B |
| API-30 | `POST /v1/cases`; `…/{id}/decision` | by case type | B |
| API-33 | Outbound webhooks `run.committed, period.closed, payout.settled, payout.returned, …` | HMAC signature | B |
| API-36 | `POST /v1/tax/year-end-forms` | `tax.forms` | B |
| API-39 | `PUT /v1/settings/{key}` (provider records, checklist) | `settings.manage` + item-specific; If-Match | A |

Stories/ACs: US-14 (AC-14.1..3), US-15 (AC-15.1), US-16 (AC-16.1..3), US-17 (AC-17.1..2), US-18 B-MKT (AC-18.1..2), US-19 B-MKT (AC-19.1), US-20 (AC-20.1..3), US-38 (AC-38.1..2), US-47 (AC-47.1..2), US-48 (AC-48.1), US-49 (AC-49.1..2), US-50 (AC-50.1). FR-FIN-006, FR-FIN-007 have **no ACs** (traceability gap).

---

## 13. Tenant settings / pack parameters this domain consumes (no values defined anywhere)

| Parameter | Level | Used by |
|---|---|---|
| Rounding mode (default half-up) | T | BR-MNY-02 |
| Clawback policy per bonus type (`order_line` default / `restatement`) | T | FR-FIN-003 |
| Write-off eligibility threshold; age limit; second-approver threshold | T | FR-FIN-004, BR-REV-08 |
| Manual-adjustment second-approver threshold; new-account window *n* days; block vs escalate | T | BR-ADJ-02/03 |
| Payout batch second-approver threshold | T | SDD-09 §5 |
| Minimum payout | M/T | BR-PAY-12 |
| Bank-detail cooling-off length; shared-account threshold | T | BR-PAY-08 |
| Dormant balance age | T | FR-PAY-007 |
| Dispute window; dispute response time | T, M | FR-CAS-003, BR-ADJ-04 |
| Restocking-fee volume effect | T | BR-RET-03 |
| Withholding rate, threshold, basis, missing-id rate, rounding | M | FR-TAX-002 |
| Provider settlement window (in-transit ageing) | provider | SDD-09 §7 |
| FX rate staleness policy | T | FR-FIN-007 (V1) |
| Order sync-lag threshold blocking a run | P, T | BR-ORD-05 |

Money-affecting settings need Finance approver; effective at a period boundary (clawback policy, rounding mode).

---

## Conflicts found

| # | Conflict | Sources | Resolution |
|---|---|---|---|
| C-1 | Run commit is "one entry for the whole run" with key `run:{run_id}`, yet clawback (#5) is given key `claw:{origin_id}` "within the run entry"; an entry has one key | SDD-09 §3 #1, #5 | `claw:{origin_id}` is the **line-origin key**, enforced by `result_line (run_id, origin_type, origin_id) UNIQUE`, not a `journal_entry.idempotency_key`. Run entry key stays `run:{run_id}` |
| C-2 | Entry #13 (chargeback reversed) has its own key `claw-rev:{origin_id}` but nothing says whether it is standalone or inside a run; I-7 forbids postings outside approved triggers | SDD-09 §3 #13, §4 | Treat as an adjustment line in the next open run (origin_type `claw-rev`), same pattern as #5; keep `claw-rev:{origin_id}` as origin key. Confirm with finance architect |
| C-3 | `settled_clearing` listed with normal balance **Debit** but posting #3 only ever credits it | SDD-09 §2 vs §3 #3 | Store signed balances (Σdebit − Σcredit); treat normal-balance as display metadata; display `settled_clearing` as credit-normal. Raise to doc owner |
| C-4 | AC-14.2 / FR-COMP-006: expense = payable + withholding + residue; posting #10 adds breakage to expense; SDD-09 §7 says "residue and breakage explained" | AC-14.2, FR-COMP-006, SDD-09 #10, §7 | Commit control total: expense = payable + withholding ± residue + breakage (+ netting/clawback categories). Implement the superset; AC-14.2 holds when breakage = 0 |
| C-5 | Migration entry debits "Commission expense (opening)" — no such account type in the enum | SDD-09 #11 vs ENT-16 CHECK | Post to `commission_expense` with `origin_type = migration`; GL mapping can split by origin dimension. No new enum value |
| C-6 | Posting partitioned by posted month, SDD says "postings carry `posted_at`", but `posted_at` is only on `journal_entry` | SDD-09 §4 vs ENT-16 | Denormalise `posted_at` onto `posting` (copied from entry, immutable) to enable partitioning |
| C-7 | Who prepares a clawback-policy change: Tenant admin (SDD-09 §9) vs Finance manager "with approval" (FR-FIN-003) | SDD-09 §9, FR-FIN-003 | Either role may prepare (`settings.manage`); Finance approver approves; effective at period boundary |
| C-8 | Write-off threshold semantics: BR-REV-08 = eligibility (only below threshold); FR-FIN-004 = eligible below threshold **or** older than age, and "above threshold without second approver" is an error; SDD-09 §9 "Threshold" | BR-REV-08, FR-FIN-004, SDD-09 §9 | Two settings: eligibility (amount ≤ X or age ≥ Y) and second-approver threshold. Above eligibility only with second approver |
| C-9 | Tax rule precondition: "counsel-confirmed **or written risk acceptance**" (FR-TAX-002, US-38 alt) vs pack "released only when every item Confirmed" (PD-04 §5) | FR-TAX-002, PD-04 | Pack versions are **released** only when Confirmed. A tenant may go live on an unreleased (screening) rule only via written risk acceptance recorded on the launch checklist, shown in compliance reports. Founder to confirm (DEC-14 spirit) |
| C-10 | DEC-14: "no numeric rate, threshold or window is defined anywhere in these documents", but PD-04 lists 2%, ₹20,000, 20%, 48 h, 1 month, 10%, 72 h | DEC-14 vs PD-04 | Values may exist as **pack data with basis and `basis_status=screening`**; never in code, never shipped until Confirmed |
| C-11 | PD-04 says "No item in this document is Confirmed today" but marks INR 2 dp "Confirmed by currency standard" | PD-04 §1 vs §2.4 | Treat INR minor-unit exponent 2 as an ISO 4217 fact, not a pack legal item; usable |
| C-12 | PD-04 status vocabulary (Confirmed/Sourced/To decide/Product default) ≠ `tax_rule.basis_status` enum (screening/primary_read/counsel_confirmed) ≠ PRD-04 status (R/S/D/C) | PD-04, ENT-18, PRD-04 | Map Sourced→`screening`, primary source read→`primary_read`, Confirmed→`counsel_confirmed`; To decide → no row |
| C-13 | Minimum payout: "≥ market minimum" (SDD-09 §5) vs "above the minimum" (FR-PAY-001) | SDD-09, FR-PAY-001 | Use **≥** (SDD more specific) |
| C-14 | Instruction enum includes `cancelled` (and `pending`) but SDD instruction state machine has no Cancelled; batch Cancelled only reachable from Reviewed (before instructions exist) | ENT-17 vs SDD-09 §5 | Keep enum; `cancelled` only for `pending` instructions never dispatched (e.g. failed batch abandoned) — entry #4 posts to return amount to payable. Needs owner confirmation |
| C-15 | Failed instruction posts with key `instr:{id}:returned` — same key name for return and failure | SDD-09 #4 | Accept: an instruction can only end in one of returned/failed, so the key is unique per instruction |
| C-16 | Signature covers `currency`, but `payout_instruction` has no currency column | SDD-09 §5 vs ENT-17 | Sign with `payout_batch.currency`; consider adding immutable `currency` column to instruction |
| C-17 | Restatement requester: "Compliance officer or analyst" (SDD-09 §9) vs "Compliance officer requests" (FR-COMP-009) | SDD-09, FR-COMP-009 | Grant `restatement.request` to both roles; Finance approver approves |
| C-18 | Run idempotency key `(tenant, period, run_request_id)` (SDD-09 §8) vs "tenant, calendar, period and run request id" (BR-PER-06) | SDD-09, BR-PER-06 | Include calendar (superset) |
| C-19 | Inbound event key `(tenant, provider, event_id)` vs entity `(tenant_id, source, idempotency_key)` | SDD-09 §8, `inbound_event` | Same thing: `source` = provider, `idempotency_key` = provider event id |
| C-20 | MFA population for money roles: BR-SEC-02 lists only payout approvers, tenant admins, vendor staff | BR-SEC-02 vs SEC-03 | Per SECURITY_IAM_TENANCY context: use SEC-03 superset (Payout officer, Finance approver, Tenant admin, Compliance officer, …) |
| C-21 | US-18 example pack is Malaysia while DEC-19 scopes research to India/Bangladesh; FD-02 launch market undecided | US-18, DEC-19 | Build pack-agnostic; use labelled fixtures (TS-18/19); India is the only drafted pack |

---

## Open / unresolved

| # | Item | Owner | Blocks |
|---|---|---|---|
| O-1 | Legal treatment of clawbacks and negative balances per market (Q-10, D-R3) | Counsel | FR-FIN-003, FR-FIN-004, BR-REV-07..09 (defaults usable) |
| O-2 | Whether a reversal may alter a closed period (D-R2, BR-REV-02, status C) | Tenant + counsel | FR-FIN-003, FR-COMP-009 |
| O-3 | Crediting event assigning volume to a period (D-R1, BR-PER-02); India buy-back/cooling-off (AQ-IN-04 / AQ-12) | Tenant + counsel | Reversal windows; FR-COMP-001; IN pack |
| O-4 | Withholding rates, thresholds, forms per market (GAP-031, FD-05); India 2% / ₹20,000 / 20% unconfirmed; Form 26Q layout; GST on commission (AQ-IN-06 / AQ-12) | Tax adviser / CA | FR-TAX-002, FR-TAX-003, US-18, US-19, IN pack release |
| O-5 | Withholding taxable base relative to clawback netting (pass order puts netting before withholding) and whether a clawback reverses previously withheld tax | Tax adviser | FR-TAX-002, FR-FIN-003, posting #5/#6 |
| O-6 | `threshold_basis` enum (prior-year total from this payer vs current-FY aggregate as in India) and tax rounding modes (`tax_rule.rounding` values) | Tax adviser + product | FR-TAX-002, TS-18 |
| O-7 | Whether calculate-and-instruct needs a licence in the launch market (Q-2, DEC-03 provisional) | Counsel | Entire payout module go-live |
| O-8 | Unclaimed/dormant balances creating duties (GAP-035) — only a report today | Counsel | FR-PAY-007 |
| O-9 | Provider capabilities: idempotency support, status query, settlement report formats; eligibility in writing (AQ-01) for NEFT/IMPS file, RazorpayX, Cashfree Payouts | Providers | FR-PAY-002 adapters, ADR-09, FR-PAY-006, IN go-live |
| O-10 | Original rules BR-REV-01, -03..-05, BR-PAY-01, -03..-05 missing (OQ-22) | Product | Full reversal/payout rule set |
| O-11 | Holds as an entity: "dated events with reason, owner and release" — no `payout_hold` table in spec.json | Data design | FR-PAY-007, AC-47.1 |
| O-12 | Balance projection table not defined in entities | Data design | FR-FIN-002 |
| O-13 | FX difference account not in `ledger_account.type` enum; FR-FIN-006/-007 have no ACs | Finance architect | FR-FIN-007, FR-FIN-006 (V1) |
| O-14 | Exact second-approver thresholds and approval rules for batches, adjustments, write-offs (values) | Tenant settings (DEC-14) | FR-PAY-001, FR-CAS-002, FR-FIN-004 |
| O-15 | Audit-outbox buffer limit that blocks money actions when audit store unavailable is unspecified | Security | All money actions (SEC-09) |
| O-16 | Entry #13 placement (C-2) and instruction `cancelled` semantics (C-14) need doc-owner confirmation | Finance architect | FR-PAY-004, chargeback flow |
| O-17 | India data-region scope (AQ-IN-02/03 / AQ-11) — affects where ledger/backups live | Indian counsel | IN cell; BR-DAT-09 |
| O-18 | Bangladesh affiliate pack (AQ-13 / AQ-BD-01..06) | Bangladeshi counsel | BD-AFF pack (not for build) |
