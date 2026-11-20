# Release Notes

## Unreleased

### Increment B-MKT — market packs: registers, withholding per market, year-end tax statements, German portal (2026-11-20)
Sandbox only: no real provider is called, no money moves and nothing is filed with a tax authority. Tax and register rules come only from released market packs; the platform ships no rates or thresholds. The India pack is not released (it waits for founder and counsel confirmation).

**Withholding per market (SC-12, SC-02)**
- A market pack can define a withholding rule: a rate, an optional threshold per tax year (cumulative this year or the payer's total last year), a higher rate when no tax id is on file, and the rounding. A rule without a rate means no withholding duty.
- Each run applies the rule in force at the period end for each payee. The withheld amount is a separate line, posted to the withholding liability at commit, and shown on the distributor's statement with its rate and reason. Commit is refused if the tax rules or profiles changed after the run was calculated.
- New Tax page (`/tax`): the market's withholding rules, tax year and tax-id format in words, withholding lines per run, payees without a tax id. Finance sees the run's withheld total on the run review.
- Tax ids are checked against the market's format ("This is not a valid FX tax id.").

**Year-end tax statements**
- After the tax year is closed in the ledger, Finance generates one statement per payee (step-up). Payees without a tax id are held until one is recorded; totals must equal the ledger, and a change creates a new version (older versions stay downloadable).
- Distributors find their statements under More › Tax statements (CSV) and get a notification. Finance can export a filing file with the full tax ids (step-up, recorded in the audit log); the platform does not file it.

**Registers (SC-06)**
- Grievances are a case type: received date, channel, category and reference; acknowledgement and resolution deadlines come from the market pack, overdue cases are flagged and an hourly job escalates them once per deadline. Resolve as upheld or not upheld; a related staff member cannot decide.
- New Registers page (`/cases/registers`): the grievance register and the delisted-seller register (participants whose positions are all terminated), each with an audited CSV export without names.
- Plan filing duties can now come from the market pack as well as from the tenant setting.

**Distributor portal in German**
- Distributors choose English or German under More › Language (markets offer the languages they list). Pages, amounts, dates, explanations, rank texts and e-mails follow the choice; without a choice the browser language is used.
- Home, earnings, statement and rank pages are rendered on the server and readable without JavaScript.

**Staff**
- Staff can record a contact e-mail for a participant who has none (SC-09), so the participant can be invited to the portal; the person who recorded it cannot send the invitation.

**Fixed**
- B6 carry-over: the plan-change notice date in the plan's time zone (BUG-128); the notice-days setting can be cleared (BUG-129).
- B-MKT browser findings BUG-130, BUG-133..138, BUG-140 (grievances on markets in implementation, contact e-mail path, German bank-detail mail, German not-found page, tax wording, German labels, journal event label).

**Known limits**
- The statement page transfers about 180 KB on a slow connection, above the 150 KB target (BUG-132); content shows in under half a second.
- Analysts do not yet see the withheld total on the run review (BUG-131). The grievance register CSV prints the internal case state (BUG-139). One German tax e-mail still uses the word "Bescheinigung" (BUG-142).
- Market size: a run of 2 million positions still does not fit in memory; the engine now handles 1 million positions in a 4 GB heap and 1.5 million in 7 GB.
- Payments made before the first committed run do not count toward a withholding threshold.

### Increment B6 — plan-change governance, full data export, dashboards, saved views, history import, parallel runs, period close (2026-11-20)
Sandbox only: no real provider is called and no money moves. Exports stay in the platform (no upload to external storage). English only.

**Plan-change governance (SC-44)**
- Each plan version has a change workflow page: draft, simulation, compliance review, filing, notice and scheduled, with a checklist that says what is missing and why.
- Where a market requires a filing (new setting "Plan filing requirements", approved by a market sign-off holder), Compliance records the filing status with reference, date and evidence before Finance can schedule the version. A filing applies to the exact content it was recorded for.
- When a version is scheduled, the notice sent to distributors and the number of recipients are recorded. The transition report of the first run shows which rank and carry items reset or carry over.

**Period close**
- Finance closes a Paid period after a step-up (SC-01). The close is refused while anything is still open: late items, payout exceptions, payouts in transit, open restatements, returned-payment cases or open payout batches; the dialog also lists GL accounts that still need a mapping. Closing creates the GL journal export and sends the `period.closed` webhook. Nothing can be posted into a closed period.

**Full data export (SC-13 Exports tab)**
- Tenant admins run a full export of the tenant data model on request or on a schedule (new setting "Full export schedule"). Each table is one gzipped JSON Lines file from a single consistent snapshot, with a manifest signed with Ed25519; the public key is published. Credentials and sessions are never exported. Also available to API keys with the `exports:full` scope.

**Dashboards and lists**
- Executive overview (SC-35): net sales, commission paid, payout share of sales, retail share and active earners per market and finished period, each with its definition, plus a 12-period trend. No projections, targets or rankings.
- Finance KPIs on the ledger (SC-33) and Compliance KPIs (SC-46: guardrail warnings, open cases).
- Orders (SC-31) and ledger entries (SC-33): sort, choose columns, save views (default, shared with a role) and export CSV; every export is recorded in the audit log.

**Migration from a legacy system (SC-16, SC-24)**
- Implementation consultants import a market's history as a migration batch (participants, positions, current sponsor, servicing, orders and refunds, legacy payout lines); sponsor cycles and orphan sponsors are reported per member.
- Opening balances and opening rank/carry state are uploaded with a control total and posted after Finance approval.
- A parallel run compares the platform's result for the cutover period with the legacy payout per payee; each difference is classified and accepted by a second person, and a sign-off is required before go-live and before the cutover period can be committed.
- Not imported yet: bank and tax profiles, placement relationships, per-period rank history (waiting for product confirmation).

**Settings**
- New settings without defaults: plan filing requirements per market, full export schedule. The order crediting event setting is retired: each plan version sets it.

**Fixed**
- B5 carry-over: team enrolment dates and statement explanation wording, payout batch period times (API parts of BUG-112/119/120); erasure now waits for a case being opened for the same person.
- B6 browser findings BUG-121..127 (Compliance can approve filing requirements, migration mappings listed for the approver, keyboard definition popover, plan dates in the plan's time zone, legacy bonus types listed in the parallel run, "Migration clearing" label, executive overview layout).

**Known limits**
- Market size: a run of 2 million positions does not fit in memory yet. The calculation engine alone handles 1 million positions with a 7 GB heap; the full commit path has been measured only up to 100,000 positions (55 s).
- BUG-128 (a checklist date in ISO form) and BUG-129 (the notice-days setting cannot be removed once set) are open.

### Increment B5 — distributor portal: sign-in, statements, line explanation, rank, team, customers, self-service bank/tax, notifications, disputes, data-subject requests, erasure (2026-11-19)
Sandbox only: payouts still go to the sandbox provider or a downloaded bank file, mails are written to the local mail folder, and no real provider is called. English only.

**Distributor portal (mobile first)**
- Distributors are invited by Support from the participant record (SC-09) and sign in at `/portal/signin` with an emailed one-time code (the default), a password set through the invitation, or Google/Firebase when configured (SC-27). Staff pages refuse portal sessions and the portal refuses staff.
- Home (SC-37): identity, paid-as rank, the latest net amount and its payout state, notices.
- Earnings (SC-18): one statement per committed period with every line, refunds, restatements, recoveries, the net arithmetic and the payout state; CSV download. Each line has a plain explanation (rule, base, rate, rank used, period, rounding) that names no other person.
- Rank (SC-19): paid-as and titles per committed period, grace, measured values against requirements; no targets, streaks or projections.
- Team (SC-20): named people down to the policy's named depth, totals only below; anyone outside your downline is "not found". Customers (SC-21): current and past customers with masked contact, last order and order count.
- Payment details and tax (SC-22): change your bank account or tax profile after confirming your password; a new account has a cooling-off period, and an account shared with other payees goes to staff review first.
- Notifications (SC-38): inbox for statements, payouts (sent, returned, held with the reason), disputes, privacy requests, plan changes and security; email per topic can be switched off except security, privacy and plan changes.

**Disputes**
- A distributor disputes a statement line from the explanation; the line's trace is attached automatically, one open dispute per line. Staff (SC-06) start a review, uphold or reject with an explanation the distributor sees, then propose an adjustment or request a restatement. Overdue disputes are mailed to staff.

**Data-subject requests**
- Requests for access, portability, correction or erasure from the portal (My data), the public form (SC-41, reference number only) or recorded by staff. The DPO verifies, submits with a retention basis and a second DPO approves (SC-15); deadlines follow the privacy policy.
- Access and portability give one JSON export of the subject's own data.
- Erasure pseudonymises the person (name, contact, sign-in credentials, tax id, sealed bank details, session addresses and exports cleared; bank fingerprints, tax residency and case history kept) while ledger entries, runs and snapshots stay, so committed periods replay identically. It waits while money is owed, a payout is in flight or a hold applies.

**Settings**
- New settings without defaults: dispute policy (window and response days per market), privacy policy (response days, escalation), and whether distributors see customer contact details (DPO approval).

**Fixed**
- B4 carry-over: splitting an adjustment or write-off across cases no longer avoids the second approver; a staff member related to the payee cannot propose a write-off; the case queue names a write-off's payee.
- B5 browser findings BUG-109..118 (names no longer stored in case previews, authenticator set-up inside the step-up dialog, second payout officer in the seed, invitation time, "No payout due", approver text, readable privacy previews, dispute wording, adjustment period, portal wording).
- Security: setting up an authenticator in the portal now needs your password first; email verification alone no longer authorises an erasure or correction; a DPO related to the subject cannot decide its request; erasure also clears the previous account digits in notices; sign-in codes are limited per account; any pending staff bank-detail review blocks a self-service change.

**Known issues**
- Some distributor-facing API text still uses the UTC day or engine wording (team enrolment date, explanation text, invitation mail), and the payout batch view shows its period with the server offset (BUG-112, BUG-119, BUG-120, all LOW).
- The B5 security fixes are tested but not yet re-reviewed or checked in the browser.

### Increment B4 — ledger, balances, clawbacks, write-offs, GL export, payouts (sandbox), bank details, tax profile, manual adjustments (2026-11-19)
Sandbox only: payouts go to an in-process sandbox provider or to a bank file you download; no real provider is called and no money moves. Withholding is not computed yet (tax rules come with the market packs).

**Ledger**
- Committing a run now posts one balanced journal entry for its payables and receivables. Entries and postings can never be changed or deleted; corrections are new entries.
- Ledger and journal export (SC-33): a "debits = credits" check, payables, in transit, receivables and settled clearing per market, journal entries with their postings and approver, accounts with balances, receivables by age.
- Balances are always summed from postings, never stored. A participant record shows payable, in transit and receivable per market.
- A clawback first reduces what the payee is still owed; only the rest becomes a receivable, which later earnings recover.
- Write-offs of a receivable are cases with a policy: eligibility by amount or age, and a second approver above a threshold.
- GL export: map each account type to a GL code per market, then generate a balanced CSV for a committed or paid period; the stored file has a SHA-256 and downloads the same every time. Also available to API keys with the `ledger:export` scope.

**Manual adjustments**
- A one-off credit or debit for a payee's position is a case with a reason, a note and evidence. A Finance approver decides; above the policy threshold a second approver is needed. Proposals for a related account (declared relatives) or a new account are blocked or escalated by policy. Approved adjustments appear as lines of the next run of that period.
- Tenant admins record which staff are related to which participants (Users, SC-28); related staff cannot approve that payee's adjustments, write-offs or payout batches.

**Payouts (sandbox)**
- Payout batches (SC-03) per market and provider: every payee with a payable, minus those excluded with the reason in words (below the minimum, no bank details, bank-detail cooling-off, open duplicate or returned-payment case, missing tax profile, hold). Submit by the preparer, approval by Finance with a step-up; nobody approves their own batch.
- Each payout is a signed instruction with an idempotency key; the dispatcher asks the provider for the status before any resend. A bank-file provider produces a CSV you upload yourself (step-up).
- Reconciliation (SC-34): settlement and returns come from signed sandbox webhooks or an imported result file; unknown items go to an exceptions queue resolved with a note; a returned payment opens a case and puts the amount back in payable. A committed period whose payouts are all final becomes Paid.
- Payout holds with a reason, released by someone who does not prepare payouts; dormant-balance report.
- Payout providers (SC-13, SC-17): choose the sandbox or bank-file adapter, record providers on a live market, review dates with reminder mails.

**Bank details and tax profile**
- Bank-detail changes are requested by Support with a step-up and approved as a case; the new account is masked, has a cooling-off period, and the payee is told by mail. Accounts shared by several payees are flagged. Full account numbers are never shown.
- Tax profile per participant (residency, entity type, tax id): versions, never back-dated; the tax id is masked and can be shown once with a step-up, which is audited.

**Settings**
- New policies without defaults: minimum payout and tax-profile requirement per market, cooling-off hours, shared-account threshold, dormant days, reminder days, adjustment policy, write-off policy. The tenant clawback policy is retired: set it per bonus on the plan version.

**Fixed**
- Engine: plain-language rules print amounts in market units; traces print readable known-at instants. Run review "What changed" on the first run of a version; late queue original period as dates; simulation guardrail reasons in words; periods table amounts and tablet layout.
- B4 browser findings BUG-099..107 (live-market provider record, notice dates, sign-in console error, double import notice, write-off case subject, exclusion instants, plan variant text, minimum-payout approval text, case tab counts).
- Security: result files only for bank-file providers and never imported by the batch preparer; related staff excluded from write-off and batch approvals; hold release separated from payout preparation; hold reads scoped to the caller's markets; sandbox webhooks signed over event id, timestamp and body.

**Known issues**
- The engine handles up to 750,000 positions in a 4 GB worker; larger tenants need a bigger worker or the streaming output (open).

### Increment B3 — plans, runs, commit, replay, restatement, adjustments, guardrails (2026-11-18)
Sandbox only: a commit records the run and its approval but posts nothing to a ledger and pays nobody (payouts and the ledger are B4); no provider is called and no money moves.

**Plans**
- Plans per market and calendar (Plans, SC-04) with versions: draft, in review, approved, scheduled, active, retired. Rules come from a declarative library (volumes, group volume, ladders, percentage bonuses, caps, pools, clawback policy, structural rules) and are shown in plain language. A version records its crediting event and placement width.
- Controlled extension point: derived measures and requirements written as expressions (min, max, arithmetic, comparisons, sums over direct children). Each extension rule needs a golden dataset that covers it before the version can be submitted.
- Caps and pools (SC-05) in precedence order with a preview on a past period.
- Simulations on any ended period (SC-42): payee impact, by bonus, distribution, cap effects, comparison with the version in force; a simulation can be frozen as a golden dataset. Simulations are staff-only and change nothing.
- Approval by a second person (the author and the rule editors cannot approve), activation scheduled by Finance with a step-up and an effective time (a past time takes effect at once).

**Guardrails**
- Plan rules are checked against the market pack's guardrails when saved: a block refuses the save with the rule, the explanation and its basis status; a warning must be acknowledged or overridden.
- Overrides (SC-11) need a justification, evidence and an approver with the override permission who did not write the matched rules; every decision is kept in the overrides log.

**Periods and runs**
- Periods and runs (SC-01) per calendar: state, cut-off in the calendar's zone, blockers (order sync behind or failing, no plan version, late items pending), Calculate and Re-run, replay, restatement requests.
- A run reads a stored snapshot of genealogy, orders and settings; the same inputs always give the same lines and hashes. Replay of a committed period answers Match or shows the difference.
- Run review (SC-02): totals, variance against the previous period, top movers, exceptions, every line with its trace (orders, rates, rounding) and a full replay of one line, what changed in qualification, adjustments.
- Commit needs a second person with the commit permission and a step-up, and an acknowledgement of each blocking exception; a run whose inputs changed since calculation is refused and must be re-run.
- Qualification history per position (SC-43): paid-as and title ranks, measures, carry, by period.

**Corrections**
- Late refunds and chargebacks of committed periods become clawback lines in the next run, linked to the original period; the late queue shows the run that consumed each item.
- Restatement of a committed period is a case: the preview shows the difference per payee and bonus, a Finance approver decides, and the difference is paid or recovered in the next run. The committed run itself never changes.

**Genealogy and orders**
- Placement width and crediting event now come from the plan version (the old settings remain as a fallback; the placement width setting is retired). Plan rules can re-parent the children of a terminated position, limit positions per participant and allow sponsor changes only within a window after enrolment.

**Access**
- 14 new permissions (privileged: approve plans, commit runs, approve restatements, approve overrides). New seed role Plan administrator.

**Fixes**
- B3 defects BUG-084..089, 091, 094 (BUG-084: volumes of multi-unit order lines were multiplied by the quantity twice in runs and simulations). B2 BUG-081, 082, 083 fixed in code.

**Known issues**
- The engine handles 150,000 positions on a 4 GB worker; 500,000 and 2,000,000 positions run out of memory. Larger tenants need the memory work listed in the B3 handoff.
- LOW display defects: plan plain language and line traces print raw minor units and microsecond instants (BUG-090, BUG-092); stale "What changed" sentence (BUG-093); late-queue period in the viewer's zone (BUG-095); raw guardrail outcome code on simulations (BUG-096); period table amount wrap and tablet width (BUG-097, BUG-098).
- Restatements correct money only; qualification state of the restated period is not recomputed.
- Security review fixes (late clawback share, override separation of duties and five LOW items) are in the code and await the security re-check.

### Increment B2 — participants, genealogy, orders, first case types (2026-11-17)
Sandbox only: storefront connectors only receive signed webhooks; nothing calls a real store, provider or bank, and no money moves.

**People**
- Participant types (earning, sponsoring, holding positions, end customer) are proposed by a Tenant admin and approved by a Compliance officer; you cannot approve your own type.
- People list and participant record (SC-09): positions, type history, customer servicing, agreements and case links. Contact details are masked; showing them needs a step-up and is audited without the values.
- Enrolment in one step: type, market, positions, sponsor and placement (explicit leg or automatic when a placement width is set), agreement acceptance where the market requires it, and identity signals. Enrolment is refused without a required acceptance.
- Duplicate detection: identity signals are stored only as keyed digests. A match opens a duplicate case and holds the new position as pending until the case is decided (allow, merge or terminate).
- Agreement versions per market, published by a Compliance officer with the agreement document; the launch checklist's agreement item now completes by itself.
- Position status (pending, active, suspended, terminated) with history; terminating and reinstating need the terminate permission and a step-up. Terminating a position hands its customers on under the tenant's reassignment rule.

**Genealogy**
- Sponsor and placement trees as of any date and as known at any time; history is never rewritten (corrections supersede rows).
- Genealogy explorer (SC-07): search, lazy children with counts, as-of and known-at, read-model banner, "View as distributor" preview of the DPO-approved visibility policy (deeper levels as counts only).
- Changes go through cases (SC-08, SC-06): sponsor/placement change, correction with evidence and a list of affected committed periods, ownership transfer, duplicate investigation. Cycles, overlapping rows and taken legs are refused by the database. Approvals follow separation of duties with a step-up.

**Orders**
- Order and order-event ingestion by API key (`orders:write`), idempotent on the store's order id: a replay answers the same order, a changed body is refused and listed as a conflict. Unknown products wait in an exception queue and can be retried once volumes exist.
- Shopify and WooCommerce webhooks (HMAC-verified) per market; sync-health tab with per-source state.
- Orders and returns explorer (SC-31): buyer type at order time, purpose, attribution with its source and conflicts, line volumes, returns, refunds, chargebacks and exchanges with their volume effect, product volumes.
- Late-transaction queue (SC-32) for orders that land in committed periods: preview, accept in bulk, or raise a restatement.
- Settings with no default (they must be set before use): crediting event, purpose required, attribution precedence, new buyer type, restocking-fee effect, reassignment rule, duplicate matching, sync-health thresholds, placement width, visibility policy (DPO approval).

**Access**
- 18 new permissions (six privileged: terminate, approve types, publish agreements, approve genealogy cases, decide duplicate cases, privacy). New staff roles in the seed: Support agent, DPO. New key scopes `participants:write` and `orders:write`.

**Fixes**
- B2 defects BUG-069..080; B1 BUG-060 (code fix).

**Known issues**
- BUG-081, BUG-082, BUG-083 (LOW): some connector refusal codes and the connector source shown raw; approving a settings change after its effective time shows a raw message.
- Security review findings from B2 (identity-signal matching across markets, `participants:write` key minting, pending positions taking attribution, case edits by others, existence codes) have fixes in the code that await confirmation; two are only partly closed.

### Increment B1 — MVP-B foundations (2026-11-17)
Sandbox only: no real provider is called and no money moves.

**Tenant setup**
- Markets (country, currency, time zone, languages, market pack), brands and calendars with generated periods, under Settings › Markets. Every change is saved as a new settings version with a reason.
- Settings versions can take a future effective date. Money settings (rounding mode, clawback default) need a Finance approver; you cannot approve your own change. Scheduled changes survive later edits. Each value shows when it came into force.
- Market launch checklist: evidence upload with SHA-256, attestations, payout and payment provider eligibility records, market-pack rules with their basis status. A market goes live only after a go-live request and a sign-off by someone else; a mandatory rule still at screening status needs a written risk acceptance. New markets start as draft.

**Integrations**
- Service accounts and API keys: scopes, rate tier, IP allow-list, expiry, rotation with a grace period, revoke. A key is shown once and only reads what its scope allows.
- Public read API for compliance snapshots and the OpenAPI description of the integration surface.
- Webhooks: HTTPS endpoints with signed deliveries (Standard Webhooks format), secret rotation, test events, retries with backoff and Retry now. Private and loopback addresses are refused.

**Controls**
- Separation of duties: one rule for every approval, shown with the list of people who can approve.
- Case framework (internal; case types and screens arrive from B2).
- New permissions: settings.approve, market.manage, market.signoff, integration.manage.

**Fixes**
- MVP-A interface defects BUG-023, 025–029, 045–048; B1 defects BUG-049..059.

**Known issues**
- BUG-060 (LOW): a rule label in the launch-checklist inspector can break mid-word (fixed in B2).
- Security fixes from the B1 review (key market scope, tenant-wide approvers, proxy-aware client address, limiter for keys outside their allow-list): confirmed and registered as BUG-061..064.

## Earlier
- Engineering workspace, readiness assessment, verified context briefs.
