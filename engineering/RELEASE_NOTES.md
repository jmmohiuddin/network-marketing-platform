# Release Notes

## Unreleased

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
