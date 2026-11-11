# 26 — MISSING ACCEPTANCE CRITERIA
## Testable criteria for the stories in 25

| Field | Value |
|---|---|
| Document ID | GAP-26 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Format | Given / When / Then. Thresholds that need a founder or tenant value are written as `<parameter>` rather than invented |

| AC | Story | Given | When | Then |
|---|---|---|---|---|
| AC-01.1 | US-01 | A correction to B's sponsor recorded today with valid date 1 March | The analyst views the tree "as of 15 March, as known on 1 April" | B appears under the old sponsor; viewing "as known today" shows the new sponsor |
| AC-01.2 | US-01 | Period March committed before the correction | March is replayed | Output equals the committed output exactly (all lines, cents) |
| AC-02.1 | US-02 | A sponsor change requested outside the plan's change window | The agent submits it | It is rejected with the window rule shown, or routed to the exception approver if the plan allows |
| AC-03.1 | US-03 | A correction affecting committed periods | The compliance officer opens it | The affected periods and estimated payout impact are listed before approval |
| AC-04.1 | US-04 | A distributor with three positions | The statement is generated | Lines are grouped per position with a per-person total; the total equals the sum of positions |
| AC-05.1 | US-05 | Visibility policy "names to depth `<n>`, aggregates beyond" | A leader opens a node at depth n+1 | Only aggregates are returned by the API (not hidden in the client) |
| AC-05.2 | US-05 | A leader requests a node outside their downline by ID | The request is made | 404/403 without revealing existence |
| AC-06.1 | US-06 | A calculated run | The analyst opens review | Variance vs previous run by bonus type, top `<k>` movers and exception list are shown |
| AC-07.1 | US-07 | User X prepared the run | X tries to approve | Approval is refused; a different authorised user can approve |
| AC-08.1 | US-08 | Period committed | An order dated inside it arrives | It is queued; its effect posts as an adjustment in the open period with a link to the original period |
| AC-09.1 | US-09 | A restatement request | Approved | A diff (per payee, per bonus) is stored; payouts are corrected by adjustments; no posting is edited |
| AC-10.1 | US-10 | Plan version v2 drafted | Simulation runs on period P | A per-payee comparison v1 vs v2 is produced with totals reconciling to each run |
| AC-10.2 | US-10 | No simulation run on a full historical period | Activation is attempted | Activation is blocked (BR-PLN-02) |
| AC-11.1 | US-11 | Cap 10% of sales on {team bonus, leadership bonus}, method priority = [leadership] | Proposed amounts exceed the cap | Only leadership bonus is reduced; team bonus unchanged; totals match 09 T3 structure |
| AC-11.2 | US-11 | A proportional cap that scales 8 lines | Applied | The scaled lines sum exactly to the cap (09 T2) |
| AC-12.1 | US-12 | A statement line | The distributor taps "how calculated" | Rule name, base volume, rate, rank used, period and rounding are shown; no other person's personal data appears |
| AC-13.1 | US-13 | A payout line | Support opens the trace | Trace lists source orders (IDs), plan version, rule, intermediate values; the same trace is reproducible by replay |
| AC-14.1 | US-14 | A pool of 62,500.00 split over 66 shares | Allocated | Allocations sum to 62,500.00 exactly (09 T1) |
| AC-14.2 | US-14 | Any committed run | Ledger totals are checked | Expense = payable + withholding + residue; zero unexplained difference |
| AC-15.1 | US-15 | A tenant chart-of-accounts mapping | Period export runs | Journal lines balance and reference run IDs |
| AC-16.1 | US-16 | A payout instruction times out | It is retried | The provider receives the same idempotency key; at most one payment results |
| AC-16.2 | US-16 | A payment is returned by the bank | Reconciliation runs | Amount returns to payee payable; a case opens; payee notified |
| AC-17.1 | US-17 | Bank details changed | Next payout due within `<cooling-off>` | Payout is held; old contact and new contact are notified |
| AC-18.1 | US-18 | Payee resident individual, prior-year total from this payer above `<threshold>` | Payout computed | Withholding at `<rate>` is a separate line and posts to the liability account; rates and thresholds come from effective-dated configuration (values confirmed by a tax adviser) |
| AC-18.2 | US-18 | Year end | Forms generated | One CP58-format statement per payee with totals equal to ledger totals |
| AC-19.1 | US-19 | Payee without PAN | Payout computed | The higher configured rate applies and is shown |
| AC-20.1 | US-20 | Refund after payout; policy = order-line clawback | Next run | Clawback line equals commission paid on that order; receivable reduced accordingly |
| AC-20.2 | US-20 | Policy = restatement for a rank-dependent bonus | Next run | Adjustment equals restated minus paid for every affected payee, including matching bonus earners (09 T5) |
| AC-21.1 | US-21 | Participant types configured | Retail share report runs | Only types flagged "counts as end customer" are in the numerator |
| AC-22.1 | US-22 | Same order webhook delivered twice | Ingested | One order exists; second delivery acknowledged without change |
| AC-22.2 | US-22 | Order edited in the store after period commit | Ingested | Treated as a late change (AC-08.1) |
| AC-23.1 | US-23 | Distributor terminated | Reassignment rule = sponsor | Customers move with an effective date; past orders keep original attribution |
| AC-24.1 | US-24 | A period | Reports run | Each figure links to its population and method; totals reconcile with the committed run |
| AC-25.1 | US-25 | Disclosure for a year | Generated | Includes all participants who held an agreement in the year, including those with zero earnings; method and version stored |
| AC-26.1 | US-26 | Market rule blocks pay solely for enrolment | Admin configures such a bonus | Save is refused with the rule ID and an explanation; override path exists only if the platform policy allows (BR-GRD-05) |
| AC-27.1 | US-27 | Market requires plan-amendment filing | Activation attempted without filing status | Blocked (BR-PLN-03) |
| AC-27.2 | US-27 | Version change | Activated | Transition report lists every participant whose carry, streak or title changed |
| AC-28.1 | US-28 | Parallel run for period P | Comparison runs | Per-payee difference report; go-live checklist requires differences = 0 or each explained and approved |
| AC-29.1 | US-29 | Vendor engineer requests access | Tenant approves for `<hours>` read-only | Access expires automatically; every query and screen view is logged and visible to the tenant |
| AC-29.2 | — (security) | Any API request | Tenant A's token used to read Tenant B's object ID | Request fails; automated test suite covers every endpoint for this (16 T1) |
| AC-30.1 | US-30 | Erasure request from a payee with ledger history | Processed | Identity fields pseudonymised; postings retained; request logged with legal basis |
| AC-31.1 | US-31 | Tenant region set to India | Data written | Personal data and backups stay in the configured region; vendor support from outside the region needs explicit approval |
| AC-32.1 | US-32 | Export scheduled | Runs | Export matches the published data model; row counts reconcile |
| AC-33.1 | US-33 | Threshold rule "orders in last `<d>` days lifting a position above a rank threshold" | Period closes | Flag list produced with evidence; flags are labelled as indicators, not findings |
| AC-34.1 | US-34 | Locale Malay or Hindi | Statement opened on a 3G-class connection | Page usable within `<budget>` KB and `<seconds>`; all labels translated; numbers formatted for locale |
