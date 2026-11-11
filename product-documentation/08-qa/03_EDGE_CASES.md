# 03 — EDGE CASES
## Edge cases for complex workflows, with the expected behaviour and where it is specified

| Field | Value |
|---|---|
| Document ID | QA-03 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | QA architect role |
| Depends on | QA-01, QA-02; research 13 §5; gap audit 08 §2, 09 §3, 15 §3 |
| Status | Draft. "Open" in the last column means the behaviour depends on an unresolved rule and must not be assumed |

Each case names the expected behaviour, the rule or design section that defines it, and the test that covers it (or "to add").

## 1. Period and timing

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-PER-01 | Order credited one second before or after cut-off in the calendar's time zone, placed from another time zone | Assigned by the crediting event converted to the calendar's zone; half-open interval | BR-PER-01, -02 | TS-62 |
| E-PER-02 | Daylight-saving change on the cut-off day | Cut-off is a wall-clock time in the calendar's zone, resolved to one instant; no hour is counted twice or skipped | SDD-07 §5 | To add |
| E-PER-03 | Order with a credited time in the future, or far in the past | Future beyond tolerance rejected; past into a committed period → late queue | FR-ORD-001, -005 | TS-13 |
| E-PER-04 | Two analysts start a run at the same moment | One run; both get the same run id | BR-PER-06 | TS-14 |
| E-PER-05 | Run requested while order sync is behind | Refused with last sync time | BR-ORD-05 | TS-58 |
| E-PER-06 | Orders keep arriving during a run | The run uses its watermark; later orders belong to the next calculation of the same open period or, after commit, the late queue | SDD-07 §6 | To add |
| E-PER-07 | Weekly and monthly calendars overlap month end | Each calendar assigns independently; a bonus names its calendar | BR-PER-01 | TS-62 |
| E-PER-08 | Period with no orders at all | Run completes with zero lines; state and carry still advance; commit allowed | SDD-07 | To add |
| E-PER-09 | Commit attempted on a run superseded by a re-run | Refused (`RUN_SUPERSEDED`) | SDD-06 §3.4 | To add |
| E-PER-10 | The crediting event itself (payment, shipment, end of cooling-off) | **Open** (D-R1): plan-version parameter, no default | PRD-04 §3 | — |

## 2. Genealogy

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-GEN-01 | Proposed parent is a descendant of the child | Refused `GEN_CYCLE` | SDD-08 §4 | TS-45 |
| E-GEN-02 | Two enrolments target the same binary slot concurrently | Exactly one gets it; the other is placed by the plan's rule; tie-break recorded | BR-GEN-06 | TS-45 |
| E-GEN-03 | Correction recorded after the period was committed | Committed output unchanged on replay; affected periods flagged; restatement policy applies | BR-GEN-04 | TS-03 |
| E-GEN-04 | Change with a future effective date, then cancelled before it takes effect | Cancellation is a new case that supersedes the pending row; nothing is deleted | BR-GEN-02 | To add |
| E-GEN-05 | Two corrections to the same relationship in sequence | Each supersedes the previous; "as known at" any time returns the belief at that time | SDD-08 §2 | To add |
| E-GEN-06 | Change request outside the plan's window | Rejected or exception route if the plan allows | BR-GEN-05 | TS-45 |
| E-GEN-07 | Mid-tree position terminated | Status change only; downline untouched; compression or roll-up at calculation time | BR-GEN-07 | TS-02 |
| E-GEN-08 | Plan requires re-parenting on termination | Rule-generated dated change rows with the rule id | BR-GEN-08 | TS-64 |
| E-GEN-09 | Terminated position reinstated | Same position, new status event; rank and placement per plan rule | BR-GEN-11 | TS-64 |
| E-GEN-10 | Participant owns three positions; one is terminated | Other positions unaffected; statement shows remaining positions | BR-GEN-01 | To add |
| E-GEN-11 | Very deep leg (depth 5,000) and very wide node (50,000 direct children) | Run within targets; explorer pages children; path length within limits or chunked fallback | SDD-08 §5 | TS-29 |
| E-GEN-12 | Subtree of 100,000 moved | One change row; read model rebuilt asynchronously; views stale meanwhile; authorisation never widens | BR-GEN-12 | TS-64 |
| E-GEN-13 | Leader requests a node outside their downline, or exactly at the depth limit plus one | 404 identical to unknown; aggregates only beyond the limit | BR-DAT-03 | TS-20 |
| E-GEN-14 | Duplicate merge where both accounts own positions in the same leg | Blocked if it would create double ownership conflict or cycle; case decides | FR-PAR-003 | To add |
| E-GEN-15 | Sponsor differs from placement parent and a bonus requires personally enrolled volume per placement leg | Bonus evaluates a sponsor-tree predicate inside a placement-tree rule | SDD-07 §3 (M19) | To add |
| E-GEN-16 | Tenant operating in several countries with in-country storage duties | **Open** (OQ-17) | SDD-01 §3.2 | — |

## 3. Orders, returns, attribution

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-ORD-01 | Same webhook delivered twice; delivered out of order (refund before order) | One order; the refund waits for the order and alerts after a timeout | BR-ORD-04; FR-ORD-004 | TS-15 |
| E-ORD-02 | Same idempotency key, different body | `409 IDEMPOTENCY_CONFLICT` | TRD-03 | To add |
| E-ORD-03 | Order edited in the store after ingestion | Arrives as an order event; original facts unchanged; after commit → late queue | BR-ATT-02 | TS-13 |
| E-ORD-04 | Unknown SKU | Held in exception queue; not lost; run blocked if exceptions exceed a tenant threshold at cut-off | FR-ORD-001 | To add |
| E-ORD-05 | Partial return of one line of several; return of part of a quantity | Volume reversed per returned unit of that line only | BR-RET-01 | TS-47 |
| E-ORD-06 | Return of a bundle component | Volume per the product volume map of the bundle's lines; if the store reports the bundle as one line, proportional by the map | BR-RET-01 | To add |
| E-ORD-07 | Equal-value exchange; unequal exchange | Equal: no reversal. Unequal: treated as return plus new order | BR-RET-02 | TS-47 |
| E-ORD-08 | Restocking fee | Refund reduced; volume effect by tenant setting | BR-RET-03 | TS-65 |
| E-ORD-09 | Returned quantity exceeds purchased minus already returned | Rejected | SDD-04 `order_event` | To add |
| E-ORD-10 | Chargeback, later reversed in the merchant's favour | Treated as refund; then reversal entry | BR-REV-06; SDD-09 §3 (13) | TS-65 |
| E-ORD-11 | Customer becomes a distributor mid-period | Type effective-dated; earlier orders keep the customer label | BR-PTY-02 | TS-48 |
| E-ORD-12 | Two distributors claim one customer (link from one, code from another) | Tenant precedence rule decides at ingestion; conflict opens a case; later change affects future orders only | BR-ATT-01, -02 | To add |
| E-ORD-13 | Servicing distributor terminated; no eligible sponsor | Customers assigned to the company | BR-ATT-03 | TS-49 |
| E-ORD-14 | Participant order with no purpose where required | Stored as unspecified; counted in data-quality figures | BR-PTY-03 | TS-65 |
| E-ORD-15 | Order for a market that is not Live | Rejected `MARKET_NOT_LIVE` | BR-REG-04 | TS-50 |

## 4. Compensation calculation

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-CMP-01 | Pool or split leaves a remainder | Largest remainder; ties by payee id; exact total | BR-MNY-03 | TS-06 |
| E-CMP-02 | Cap equals proposed amount exactly; cap larger than proposed | No change; no residue | BR-CAP-01 | To add |
| E-CMP-03 | Priority cap where reducing the first bonus to zero is not enough | Continue down the priority list; the last listed is scaled by largest remainder | BR-CAP-01 | G-E2E-01 |
| E-CMP-04 | Two caps with overlapping scope | Rejected at configuration unless precedence is stated | FR-PLN-004 | To add |
| E-CMP-05 | Per-participant constraint and company cap both apply | Constraint first, then cap | BR-CAP-02 | TS-09 |
| E-CMP-06 | Rank tie at a threshold (exactly equal) | Thresholds are inclusive (`gte`) unless the rule says otherwise; stated in the rule | SDD-07 §3 | G-E2E-01 |
| E-CMP-07 | Demotion after a return; grace period | Paid-as recalculated per window; title kept; grace counter decrements | BR-RNK-05..07 | TS-63 |
| E-CMP-08 | One-time bonus re-qualified after demotion | Not paid twice | BR-RNK-07 | TS-25 |
| E-CMP-09 | Streak counter across a plan version change | Transition rule decides; reported | BR-PLN-01 | TS-24 |
| E-CMP-10 | Carry with cap, expiry and loss when unqualified | Truncate; expire; zero | BR-RNK-08 | TS-05 |
| E-CMP-11 | Matching on a bonus that is clawed back in the same run | Matching computed on the net of the base bonus | Invariant I7 | To add |
| E-CMP-12 | Pool base changes after a late reversal | Pool of the committed period is not recomputed; effect by the pool bonus's reversal policy (restatement recommended) | SDD-07 §8 | To add |
| E-CMP-13 | Negative gross for a payee after adjustments | Payable never negative; shortfall becomes clawback receivable | SDD-09 §6 | TS-11 |
| E-CMP-14 | Points-to-currency factor changes at a period boundary; mid-period change requested | Effective at boundary; mid-period refused | BR-MNY-05 | TS-23 |
| E-CMP-15 | Rounding mode changed by the tenant | New settings version effective next period; committed periods replay with their own version | FR-TEN-003 | TS-59 |
| E-CMP-16 | Extremely large amounts or volumes | Overflow guard fails the run rather than wrapping | FR-COMP-012 | To add |
| E-CMP-17 | Compression where every position on the path is inactive | Volume rolls to the first qualified position or to the company by plan rule; never lost silently (breakage account if retained) | SDD-09 §2 | To add |
| E-CMP-18 | Differential versus override ambiguity | The rule kind states the model; both exist as separate primitives | TS-43 | TS-43 |
| E-CMP-19 | Plan activated mid-period | Not possible: effective dates snap to period boundaries | FR-PLN-001 | To add |
| E-CMP-20 | Mechanism not expressible in primitives or expressions | Cannot be configured; logged as an extension request; never tenant-specific code | BR-PLN-05 | TS-67 |
| E-CMP-21 | Refund of an order that set a rank threshold, under order-line policy | Under-recovery is expected and shown in simulation; restatement policy gives exact figures | SDD-07 §8 | TS-10 |
| E-CMP-22 | Whether a reversal may legally alter a closed period | **Open** (D-R2) | PRD-04 §3 | — |

## 5. Ledger and payouts

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-FIN-01 | Instruction times out; provider actually received it | Status query before any re-send; same key; one payment | BR-PAY-10 | TS-16 |
| E-FIN-02 | Provider rejects 3 of 1,000 lines | Three failed, amounts back to payable; retry failed lines only | FR-PAY-002 | To add |
| E-FIN-03 | Payment returned days after settlement | Return entry; case; payee notified | BR-PAY-09 | TS-40 |
| E-FIN-04 | Same settlement webhook twice; webhook for an unknown reference; amount differs from instruction | One posting; exception; exception | FR-PAY-004 | TS-41 |
| E-FIN-05 | Payee balance changes between batch draft and approval | Amount re-checked in the approval transaction; batch returns to Draft for that line | SDD-06 §3.7 | To add |
| E-FIN-06 | Bank details changed two days before payout; changed twice inside cooling-off | Held; cooling-off restarts from the latest version | BR-PAY-08 | TS-17 |
| E-FIN-07 | Many payees change to the same account | Signal; case; payouts held | SEC-40 | To add |
| E-FIN-08 | Clawback larger than all future earnings; payee terminated with a receivable | Receivable ages; write-off with approval; never a debit | BR-REV-08, -09 | TS-11 |
| E-FIN-09 | Payable below the minimum for months | Accumulates; appears in the dormant report | BR-PAY-12 | TS-17 |
| E-FIN-10 | Approver tries to approve their own batch, run or adjustment; approver is the beneficiary | Refused | BR-ADJ-02, -03 | TS-42 |
| E-FIN-11 | Attempt to edit or delete a posting | Database rejects; alert | BR-LED-02 | TS-39 |
| E-FIN-12 | Process dies between ledger entry and outbox write | Impossible: same transaction; fault-injection test | SDD-09 | QA-01 §8 |
| E-FIN-13 | Database restored to a point before settlements | Reconciliation required before dispatch resumes; no duplicate instruction | SDD-01 §5 | QA-01 §8 |
| E-FIN-14 | Provider pays twice by its own error | Second settlement is an unmatched exception; case with provider | SDD-01 §5 | To add |
| E-FIN-15 | Payee without tax profile where the pack requires one; tax id supplied after payout | Hold or higher rate per pack; later id applies from the next pay date | BR-TAX-03 | TS-19 |
| E-FIN-16 | Withholding threshold crossed mid-year | Per the market rule's threshold basis; **values and basis open** until a tax adviser confirms | BR-TAX-01 | TS-18 |
| E-FIN-17 | Unclaimed balances | **Open**: legal duties unverified | PRD-04 §3 | — |

## 6. Compliance, imports, guardrails

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-CPL-01 | Export contains a forbidden column under an unusual name (for example `e_mail_addr`, `iban`) | Detected by name patterns and content sampling; batch rejected | BR-IMP-01 | TS-32 |
| E-CPL-02 | Denominator zero (no sales in a month) | Figure null with reason, not zero | FR-CPL-001 | To add |
| E-CPL-03 | Payout line without a source order | Counted and reported as unattributable; excluded from R2 base | FR-CPL-002 | To add |
| E-CPL-04 | Re-import while a snapshot is computing | Snapshot aborted and retried, or completes on the old batch and is marked Outdated | FR-CPL-006 | TS-33 |
| E-CPL-05 | Mapping changed after a snapshot was shared | New version; old snapshot unchanged, marked Outdated | BR-IMP-03 | TS-33 |
| E-CPL-06 | Partial year for the earnings distribution | Labelled partial; cannot be published | FR-CPL-005 | To add |
| E-CPL-07 | All participants earned zero | Distribution valid: 0% above zero, median 0 | FR-CPL-005 | To add |
| E-CPL-08 | Guardrail predicate cannot read an extension module | Treated as warned; routed to compliance review | FR-CPL-007 | To add |
| E-CPL-09 | Guardrail rule at screening status blocks a configuration the tenant believes lawful | Override only where the rule is overridable, with justification; blocked-by-law rules never overridable; basis status shown | BR-GRD-05 | TS-66 |
| E-CPL-10 | Which configurations are blocked, warned or reported | **Open** (FD-06, counsel) | PRD-04 §3 | — |

## 7. Access, tenancy, privacy

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-SEC-01 | Tenant A token with tenant B object id, on every endpoint | Denied without revealing existence | BR-SEC-04 | TS-21 |
| E-SEC-02 | User scoped to one market requests another market's data | No rows | SEC-26 | TS-36 |
| E-SEC-03 | Sole admin removes own admin role; last approver deactivated | Refused; warning that approvals would be impossible | FR-IAM-003 | To add |
| E-SEC-04 | Vendor session expires mid-request; write attempted in a read-only session | Request fails; write blocked; both logged | BR-SEC-01 | TS-37 |
| E-SEC-05 | Role changed while the user is signed in | Session permissions refreshed or revoked immediately | SEC-34 | To add |
| E-SEC-06 | Erasure request from a payee with an open payable or receivable | Deferred with explanation | FR-PRV-002 | TS-28 |
| E-SEC-07 | Pseudonymised participant appears in a later restatement | Lines computed on the pseudonymous record; statement not deliverable; amounts handled by tenant policy | ADR-13 | To add |
| E-SEC-08 | Audit store unavailable during an approval | Buffered; money actions blocked beyond the buffer limit | FR-AUD-001 | To add |
| E-SEC-09 | Step-up factor older than the window at the moment of approval | `STEP_UP_REQUIRED` | SEC-20 | TS-35 |

## 8. Plan change and migration

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-PLN-01 | Activation without simulation, with a failing golden case, without filing where required, or inside the notice period | Blocked with the reason | BR-PLN-02..04, -06 | TS-46, TS-68 |
| E-PLN-02 | A state item has no transition rule | Activation blocked | FR-PLN-008 | To add |
| E-PLN-03 | Late order for a period under the previous plan version | Adjustment computed with the **original** period's plan version | SDD-07 §8 | To add |
| E-PLN-04 | Migration import with cycles, orphans or opening balances that do not match | Blocked with the list | FR-MIG-001 | TS-52 |
| E-PLN-05 | Parallel run differs only by rounding | Classified "rounding"; must still be explained and approved, or the rounding setting aligned | FR-MIG-002 | TS-52 |
| E-PLN-06 | Legacy payout file has totals but no bonus detail | Payee-level comparison only, flagged | FR-MIG-002 | TS-52 |

## 9. Distributor portal and self-hosted edition

| # | Edge case | Expected behaviour | Defined in | Test |
|---|---|---|---|---|
| E-DST-01 | Statement opened before the period is committed | Status only, no numbers | FR-DIST-001 | TS-53 |
| E-DST-02 | Statement line from an extension rule without an explanation template | Generic explanation listing inputs; flagged to implementation | FR-DIST-002 | To add |
| E-DST-03 | Statement viewed offline; connection lost while submitting bank details | Last loaded statement shown with its time; form keeps input and reports failure, never a silent queue | UX-05 §8 | To add |
| E-DST-04 | Terminated distributor signs in | Read access to past statements for the retention period; no changes | FR-IAM-007 | To add |
| E-DST-05 | Language missing a translation key | Market default language shown; logged | BR-LOC-01 | TS-30 |
| E-LIC-01 | Licence expired, invalid, wrong installation, clock rolled back, no network | Expired: runs and payouts continue. Invalid or wrong installation: read-only with export. Rollback detected. Offline works | BR-LIC-01, -02 | TS-69 |
| E-LIC-02 | Update with bad signature, failing golden case or failing migration | Refused or rolled back with a report | BR-LIC-03 | TS-70 |

## 10. Summary

| Group | Cases | With a test | To add | Open (rule unresolved) |
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
| **Total** | **112** | **68** | **39** | **5** |

"To add" cases have defined expected behaviour but no numbered scenario in QA-02 yet; they are written as tests when the corresponding increment is built.
