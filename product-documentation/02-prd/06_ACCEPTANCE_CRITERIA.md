# 06 — ACCEPTANCE CRITERIA
## Given / When / Then criteria that QA can verify independently

| Field | Value |
|---|---|
| Document ID | PRD-06 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Product (CPO role) |
| Depends on | PRD-05; gap audit 26; QA-02 |
| Status | Draft. Not approved |

Thresholds that need a founder, tenant or adviser value are written as settings, not numbers. "Minor units" means the smallest unit of the currency (cents, sen, paise). The *Tests* column is generated from `08-qa/02_TEST_SCENARIOS.md`.

| AC | Story | Given | When | Then | Tests |
|---|---|---|---|---|---|
| AC-01.1 | US-01 | A correction to B's sponsor recorded today with valid date 1 March | The analyst views the tree as of 15 March, as known on 1 April | B appears under the old sponsor; viewing as known today shows the new sponsor | TS-03 |
| AC-01.2 | US-01 | Period March committed before the correction | March is replayed | Output equals the committed output exactly (all lines, minor units) | TS-03 |
| AC-02.1 | US-02 | A sponsor change requested outside the plan's change window | The agent submits it | It is rejected with the window rule shown, or routed to the exception approver if the plan allows | TS-45 |
| AC-02.2 | US-02 | A proposed parent that is a descendant of the position | The agent submits it | The request is refused with reason GEN_CYCLE and no relationship row is written | TS-45 |
| AC-03.1 | US-03 | A correction affecting committed periods | The compliance officer opens it | The affected periods and estimated payout impact are listed before approval | TS-03 |
| AC-03.2 | US-03 | An approved change with a future effective date | The date arrives | The new relationship row becomes valid and no committed period output changes on replay | TS-59, TS-61 |
| AC-04.1 | US-04 | A distributor with three positions | The statement is generated | Lines are grouped per position with a per-person total; the total equals the sum of positions | TS-22 |
| AC-04.2 | US-04 | A statement with withholding and a netted clawback | It is displayed | Gross, withholding, clawback and net are separate lines and net equals gross minus withholding minus clawback | TS-53 |
| AC-05.1 | US-05 | Visibility policy names to depth n, aggregates beyond | A leader opens a node at depth n+1 | Only aggregates are returned by the API (not hidden in the client) | TS-20 |
| AC-05.2 | US-05 | A leader requests a node outside their downline by id | The request is made | The response is 404 and does not reveal whether the node exists | TS-20 |
| AC-06.1 | US-06 | A calculated run | The analyst opens review | Variance against the previous run by bonus type, top k movers and the exception list are shown | TS-59 |
| AC-06.2 | US-06 | Order sync lag above the tenant threshold at cut-off | The analyst starts calculation | The run is refused with the last successful sync time | TS-58 |
| AC-06.3 | US-06 | Two run requests for the same period arrive concurrently | Both are processed | One run executes and both callers receive the same run id | TS-14 |
| AC-07.1 | US-07 | User X prepared the run | X tries to approve | Approval is refused; a different authorised user can approve | TS-42 |
| AC-07.2 | US-07 | An approver without a factor verified inside the step-up window | They press commit | A second-factor prompt appears and commit proceeds only after it passes | TS-35 |
| AC-08.1 | US-08 | Period committed | An order dated inside it arrives | It is queued; its effect posts as an adjustment in the open period with a link to the original period | TS-13 |
| AC-09.1 | US-09 | A restatement request | Approved | A diff per payee and per bonus is stored; payouts are corrected by adjustments; no posting is edited | TS-51 |
| AC-10.1 | US-10 | Plan version v2 drafted | Simulation runs on period P | A per-payee comparison v1 against v2 is produced with totals reconciling to each run | TS-59 |
| AC-10.2 | US-10 | No simulation run on a full historical period | Activation is attempted | Activation is blocked (BR-PLN-02) | TS-46 |
| AC-10.3 | US-10 | A golden dataset attached to the version | The version is submitted for review | All golden cases reproduce exactly or submission is blocked with the failing lines | TS-46 |
| AC-11.1 | US-11 | Cap 10% of sales on team bonus and leadership bonus, method priority = leadership | Proposed amounts exceed the cap | Only the leadership bonus is reduced; team bonus unchanged; totals match test TS-08 | TS-08 |
| AC-11.2 | US-11 | A proportional cap that scales 8 lines | Applied | The scaled lines sum exactly to the cap (TS-07) | TS-07 |
| AC-12.1 | US-12 | A statement line | The distributor taps how calculated | Rule name, base volume, rate, rank used, period and rounding are shown; no other person's personal data appears | TS-53 |
| AC-13.1 | US-13 | A payout line | Support opens the trace | The trace lists source order ids, plan version, rule and intermediate values; the same trace is reproduced by replay | TS-59 |
| AC-14.1 | US-14 | A pool of 62,500.00 split over 66 shares | Allocated | Allocations sum to 62,500.00 exactly (TS-06) | TS-06 |
| AC-14.2 | US-14 | Any committed run | Ledger totals are checked | Expense equals payable plus withholding plus residue; zero unexplained difference | TS-38 |
| AC-14.3 | US-14 | Any attempt to update or delete a posting | Executed by any database role used by the application | The statement fails and an alert is raised | TS-39 |
| AC-15.1 | US-15 | A tenant chart-of-accounts mapping | Period export runs | Journal lines balance and reference run ids | TS-59 |
| AC-16.1 | US-16 | A payout instruction times out | It is retried | The provider receives the same idempotency key; at most one payment results | TS-16 |
| AC-16.2 | US-16 | A payment is returned by the bank | Reconciliation runs | The amount returns to payee payable; a case opens; the payee is notified | TS-40 |
| AC-16.3 | US-16 | The same settlement webhook is delivered twice | Both are processed | One settlement posting exists and the second delivery is acknowledged without change | TS-41 |
| AC-17.1 | US-17 | Bank details changed | Next payout due within the cooling-off | Payout is held; old contact and new contact are notified | TS-17 |
| AC-17.2 | US-17 | A bank-detail change submitted without fresh re-authentication | The request is made | It is refused and no version is created | TS-59 |
| AC-18.1 | US-18 | Payee meets the rule's conditions (for example prior-year total from this payer above the threshold) | Payout computed | Withholding at the configured rate is a separate line and posts to the liability account; rate and threshold come from effective-dated configuration | TS-18, TS-38 |
| AC-18.2 | US-18 | Year end | Forms generated | One statement per payee in the market format with totals equal to ledger totals | TS-59 |
| AC-19.1 | US-19 | Payee without a tax id in a market whose rule sets a higher rate | Payout computed | The higher configured rate applies and is shown | TS-19 |
| AC-20.1 | US-20 | Refund after payout; policy = order-line clawback | Next run | The clawback line equals commission paid on that order; receivable reduced accordingly | TS-10 |
| AC-20.2 | US-20 | Policy = restatement for a rank-dependent bonus | Next run | Adjustment equals restated minus paid for every affected payee, including matching bonus earners (TS-10) | TS-10 |
| AC-20.3 | US-20 | A clawback larger than the payee's next earnings | Netted | Payable reaches zero, the remainder stays in clawback receivable, and no debit instruction is created | TS-11 |
| AC-21.1 | US-21 | Participant types configured | Retail share report runs | Only types flagged counts as end customer are in the numerator | TS-31 |
| AC-21.2 | US-21 | A customer becomes a distributor on 10 June | Reports for May are recomputed | Their May orders still count as customer orders | TS-48 |
| AC-22.1 | US-22 | Same order webhook delivered twice | Ingested | One order exists; second delivery acknowledged without change | TS-15 |
| AC-22.2 | US-22 | Order edited in the store after period commit | Ingested | Treated as a late change (AC-08.1) | TS-13 |
| AC-22.3 | US-22 | An API key without scope orders:write | It posts an order | The response is 403 and nothing is stored | TS-59 |
| AC-23.1 | US-23 | Distributor terminated | Reassignment rule = sponsor | Customers move with an effective date; past orders keep original attribution | TS-49 |
| AC-24.1 | US-24 | A period | Reports run | Each figure links to its population and method; totals reconcile with the committed run or the loaded batch control totals | TS-59 |
| AC-24.2 | US-24 | The hand-checked fixture of three participants, three orders and four payout lines (QA TS-31) | Reports run | R1 customer share is 62.50%, R2 personal-use share is 60.00%, R3 retail share is 80.65% and downline share 19.35% | TS-31 |
| AC-25.1 | US-25 | A year | Distribution generated | It includes all participants who held an earning agreement in the year, including those with zero earnings; method and version are stored | TS-59 |
| AC-25.2 | US-25 | The fixture of TS-31 | Distribution generated | Population is 2, share earning more than zero is 50.00%, median is 14.30 | TS-31 |
| AC-26.1 | US-26 | Market rule blocks pay solely for enrolment | Admin configures such a bonus | Save is refused with the rule id and an explanation; an override path exists only if the platform policy allows (BR-GRD-05) | TS-27 |
| AC-26.2 | US-26 | A starter kit configured to carry commissionable volume | The version is saved | A warning is logged as a guardrail decision and acknowledgement is required | TS-26 |
| AC-27.1 | US-27 | Market requires plan-amendment filing | Activation attempted without filing status | Blocked (BR-PLN-03) | TS-46 |
| AC-27.2 | US-27 | Version change | Activated | Transition report lists every participant whose carry, streak or title changed | TS-24 |
| AC-28.1 | US-28 | Parallel run for period P | Comparison runs | Per-payee difference report; go-live checklist requires differences = 0 or each explained and approved | TS-52 |
| AC-28.2 | US-28 | Imported genealogy containing a cycle | Validation runs | The load is blocked and the cycle members are listed | TS-52 |
| AC-29.1 | US-29 | Vendor engineer requests access | Tenant approves for a set number of hours read-only | Access expires automatically; every query and screen view is logged and visible to the tenant | TS-37 |
| AC-29.2 | US-29 | Any API request | Tenant A's token is used to read Tenant B's object id | The request fails; an automated suite covers every endpoint for this | TS-21 |
| AC-29.3 | US-29 | A vendor user without an approved session | They request tenant business data | The request is refused and logged in both vendor and tenant audit logs | TS-37 |
| AC-30.1 | US-30 | Erasure request from a payee with ledger history | Processed | Identity fields pseudonymised; postings retained; request logged with legal basis | TS-28 |
| AC-31.1 | US-31 | Tenant region set | Data written | Personal data and backups stay in the configured region; vendor support from outside the region needs explicit approval | TS-57 |
| AC-32.1 | US-32 | Export scheduled | Runs | Export matches the published data model; row counts reconcile | TS-58 |
| AC-33.1 | US-33 | Threshold rule orders in the last d days lifting a position above a rank threshold | Period closes | Flag list produced with evidence; flags are labelled as indicators, not findings | TS-59 |
| AC-34.1 | US-34 | Locale of the market's second language | Statement opened on a 3G-class connection | Page usable within the page-weight and time budget in NFR-PERF-06; all labels translated; numbers formatted for locale | TS-30, TS-55 |
| AC-35.1 | US-35 | A user with the Finance approver role and no enrolled factor | They sign in | They cannot reach any page until a factor is enrolled | TS-35 |
| AC-35.2 | US-35 | Five failed sign-ins inside the lockout window | A sixth attempt is made | The account is temporarily locked and the response does not reveal whether the account exists | TS-35 |
| AC-36.1 | US-36 | A role assignment that grants admin or approver permissions | Submitted by one admin | It takes effect only after a second admin approves; both actions are audited | TS-36 |
| AC-36.2 | US-36 | A user scoped to market X | They request data of market Y in the same tenant | The API returns no rows for market Y | TS-36 |
| AC-37.1 | US-37 | A change to the rounding mode with an effective date inside a committed period | Saved | It is refused; a date at the next period boundary is accepted and creates a new settings version | TS-59 |
| AC-38.1 | US-38 | A market with no recorded payout-provider approval | Go-live is requested | It is blocked and the missing item is named | TS-50 |
| AC-38.2 | US-38 | A market not Live | An enrolment or order for that market arrives | It is rejected with MARKET_NOT_LIVE | TS-50 |
| AC-39.1 | US-39 | A participants file containing a column named email or bank_account | Uploaded | The batch is rejected, no row is stored and the offending columns are named | TS-32 |
| AC-39.2 | US-39 | A valid batch loaded for a period already loaded | Load completes | The earlier batch is marked Superseded, remains readable and existing snapshots keep pointing to it | TS-33 |
| AC-39.3 | US-39 | A payout line whose payee id is not in the participants file | Validated | The row is reported and the batch is not loadable until resolved or the tolerance setting allows it | TS-32 |
| AC-40.1 | US-40 | A mapping version used by a published snapshot | The mapping is edited | A new version is created; the published snapshot still shows the old version and is marked Outdated | TS-33 |
| AC-41.1 | US-41 | A figure in a snapshot | The user opens drill-down | Numerator and denominator row sets are returned, their sums equal the figure's components, and the export is logged | TS-34 |
| AC-42.1 | US-42 | Two concurrent enrolments targeting the same binary slot | Both are processed | Exactly one takes the slot and the other is placed by the plan's rule with the tie-break recorded | TS-45 |
| AC-42.2 | US-42 | An enrolment without acceptance of the current agreement version in a market whose pack requires it | Posted | It is rejected | TS-59 |
| AC-43.1 | US-43 | A new participant sharing a hashed payment fingerprint with an existing distributor, with holds enabled | Enrolled | A duplicate case opens and activation is held until a decision is recorded | TS-59 |
| AC-44.1 | US-44 | A unilevel bonus of 8, 5, 4, 4, 4 percent on five levels | Run on level volumes 1,000; 2,500; 4,000; 6,000; 8,000 | Payout is 925.00 (TS-01) | TS-01 |
| AC-44.2 | US-44 | A terminated mid-tree position and a plan with compression | Run | The tree rows are unchanged and compression is applied only in the calculation (TS-02) | TS-02 |
| AC-45.1 | US-45 | An order of two lines, one line returned | Processed | Only that line's volume is reversed | TS-47 |
| AC-45.2 | US-45 | An exchange flagged equal value | Processed | No volume reversal and no re-credit are created | TS-47 |
| AC-46.1 | US-46 | A position paid at a lower rank than its highest title | State is displayed | Paid-as rank and highest title are shown separately for the period | TS-59 |
| AC-46.2 | US-46 | Any attempt to change qualification state outside a run commit, restatement or approved migration import | Made through the API | It is refused | TS-59 |
| AC-47.1 | US-47 | A payee below the minimum payout and a payee inside bank-detail cooling-off | Batch prepared | Both are excluded with their reasons and their payables remain | TS-17 |
| AC-47.2 | US-47 | An approved batch | Instructions are created | Batch total equals the sum of instructions and equals the amount moved from payable to in transit | TS-40 |
| AC-48.1 | US-48 | A stored tax id | Displayed to the payee or to staff | It is masked except the last characters and unmasking by staff is audited | TS-56 |
| AC-49.1 | US-49 | An adjustment to the proposer's own account or a declared related account | Submitted | It is blocked or escalated per tenant setting and cannot be approved by the proposer | TS-42 |
| AC-49.2 | US-49 | An approved adjustment | The open run is calculated | One adjustment line with the case reference appears and is not created again on re-run | TS-59 |
| AC-50.1 | US-50 | A dispute opened from a line | The analyst opens the case | The line's trace is already attached and the response-time clock is running | TS-59 |
| AC-51.1 | US-51 | The rank status page | Rendered for any distributor | It contains no projected or potential income figure and no recruiting target | TS-53 |
| AC-52.1 | US-52 | A customer reassigned from distributor A to B on a date | A and B open My customers | B sees the customer as current; A sees them as past with the end date; neither sees the other's remaining customers | TS-49 |
| AC-53.1 | US-53 | A tenant without a breach contact | Go-live or first data load is attempted | It is blocked until a contact is recorded | TS-50 |
| AC-54.1 | US-54 | An export of rows with personal data | Performed | An audit event records actor, view, filters and row count | TS-34 |
| AC-54.2 | US-54 | The audit chain verification job | Run after any event is altered in storage | It reports the break | TS-56 |
| AC-55.1 | US-55 | Connector heartbeat older than the threshold | The page is opened | Status shows Behind or Failing with the last successful sync time and the period run screen shows the same block | TS-58 |
| AC-56.1 | US-56 | The executive overview for a committed period | Displayed | Payout total equals the committed run total and retail share equals the compliance snapshot figure for the same period | TS-58 |
| AC-57.1 | US-57 | The vendor console tenant list | Opened without a support session | It shows operational metadata only (status, region, tier, job health) and no participant, order or payout data | TS-37 |
| AC-58.1 | US-58 | A self-hosted installation whose licence expired yesterday | A period is calculated, committed and paid | All three succeed; administrators see a lapse notice; installing a newer engine or market pack is refused | TS-69 |
| AC-58.2 | US-58 | An update package with an invalid signature, or one whose engine fails a golden dataset | The licensee tries to activate it | Activation is refused, the running version is unchanged and a report names the cause | TS-70 |
| AC-58.3 | US-58 | A support bundle generated on an installation with participants, bank details and provider credentials | The bundle is scanned | It contains no personal data, bank details or secrets | TS-71 |
| AC-58.4 | US-58 | A self-hosted installation with no outbound network access | It starts and runs a period | Licence verification and all functions work offline | TS-69 |
