# Increment B2 — HANDOFF (2026-11-17)

Contract: `PLAN.md` (D-B2-01..21, §R, §1–§8, §C, §P). This file records what exists, what is open and what to do next. Facts come from the B2 agent results, the agent memories and the records-step run below; nothing here is inferred.

## 1. State
- **Scope built:** FR-PAR-001, 002, 003, 005, 006; FR-GEN-001..009; FR-ORD-001..005; FR-CRM-001, 002; FR-INT-002. All are I T V except FR-GEN-009 (I T, no browser surface). CAS is mounted with four case types (`genealogy_change`, `genealogy_correction`, `transfer`, `duplicate`). B1 OI-2 (key-caller actor without FK, D-B2-03) and OI-3 (evidence-vs-submit race test) are closed.
- **Migrations:** 0200–0208 (`packages/db/migrations`). 0207 = DB review fixes (10 findings). 0208 = security round 3: only an active position services customers (C1) or takes customers on termination (C3). No applied migration was edited. Next free number: **0209**.
- **Database levels (checked 2026-11-17 22:15):** nmp_test_4 at 0208 (reset for the run below); nmp_dev, nmp_e2e, nmp_test_2, nmp_test_3 at 0207; **nmp_test at 0109**.
- **Full suite (records step, nmp_test_4, `scripts/heavy.sh pnpm vitest run`):** 148 files passed, **2739 tests passed**, 0 failed, 0 skipped (51 s). `pnpm -s typecheck` and `tsc -p apps/web --noEmit`: clean. Log: `var/b2-records-vitest.log`.
- **Browser:** QA rounds 1–2 (2026-11-17). Round 1: W-B2-1..10 pass, BUG-069 MEDIUM + BUG-070..080 LOW, Impeccable 12/16. Round 2: BUG-069..080 verified fixed (075/076 with residuals BUG-081/082), BUG-081..083 LOW new, every B2 screen without page overflow at 390 (SC-29 also at 1440/1280), MVP-A regression intact (import counts, R1 16.61 %, audit chain), no 5xx, Impeccable 14/16. Reports: `testing/UI_TESTING_REPORT.md`, `testing/VISUAL_REGRESSION_REPORT.md` ("Increment B2 — round 1/2"); evidence `var/qa-b2/`. No third round was reported.

## 2. What exists
| Module | What | Where |
|---|---|---|
| DB | 19 tables (participants, types, signals, agreements, positions + status history + ownership, relationship + guard trigger, path model/nodes, servicing, volumes, inbound events, orders/lines/events, late transactions); write contracts G1–G5, C1, C3, P2; read functions; `gen_stale_models`, `gen_analyze_genealogy`, `connector_for_webhook` | `packages/db/migrations/0200..0208`, tests `packages/db/test/b2-guards.test.ts`, `case-evidence-race.test.ts` |
| PAR | Types with SoD, participants (masked contact, unmask), enrolment, duplicates (HMAC digests, system cases), agreement versions and acceptances, `duplicate` case type | `apps/api/src/modules/par` |
| GEN | Positions and status, tree reads (read model or bitemporal system of record), change/correction/transfer case types, visibility (`viewer`), read model + `gen.paths.rebuild` job | `apps/api/src/modules/gen` |
| CRM | Servicing (API-35), reassignment on termination via C3 | `apps/api/src/modules/crm` |
| ORD | API-10/11 ingestion (key only, natural-key idempotency, held queue, retry), volumes, attribution, late queue, summary | `apps/api/src/modules/ord` |
| INT / PAY | Shopify and WooCommerce inbound webhooks (`POST /v1/connectors/:id/webhooks`), connector rows (sealed secret), sync health (API-37) | `apps/api/src/modules/{int,pay}` |
| CAS / TEN / AUD / IAM | Case PATCH + counts + system-opened cases; `approverPermission` on settings; agreement document class; 18 permissions, `participants:write` / `orders:write` scopes, B2 navigation, CSRF exemptions | respective modules, `lib/permissions.ts`, `iam/api-scopes.ts` |
| Web | `/people`, SC-09 `/people/[id]`, SC-07 `/genealogy`, SC-08 `/cases/genealogy/new` + `/cases/duplicates`, SC-06 `/cases` + `/cases/[id]`, SC-31 `/orders`, SC-32 `/periods/late`, SC-13 connectors + health tabs, SC-29 B2 part, SC-17 agreement item | `apps/web/src/app/(staff)/**`, `features/*` |
| Seed | support@ and dpo@ per tenant; e2e-only NL market (live, monthly calendar, past periods committed) | `apps/api/src/seed.ts` |

## 3. Contracts later increments rely on
- **SQL write contracts** (SECURITY INVOKER, tenant realm, TS caller audits): `par_create_customer`, `gen_create_position`, `gen_apply_relationship` (GN001 cycle, GN002 overlap, GN003 leg, GN004, GN005; queues `genealogy.changed`), `gen_auto_place`, `gen_transfer_ownership` (GN008), `gen_set_position_status` (GN006 incl. before current `status_from`, GN007 committed period, PA003 open duplicate case), `crm_set_servicer` (CR001, CR002 non-active position, per-customer advisory lock), `crm_reassign_customers` (CR003; notice_days 0..90 else 22023; sponsor only while active). Exact signatures: `agent-memory/database/MEMORY.md` and PLAN §4.2.
- **Reads:** `committed_periods_overlapping`, `market_period_at` (NULL for markets with several calendars, shortcut), `latest_committed_end`, `par_type_at`, `par_display`, `par_search`, `gen_owner_at`, `gen_positions_of`, `crm_servicer_at`, `approval_setting_keys()`.
- **Guards:** system-time columns (`relationship.recorded_at/superseded_at`, `position_status_history.recorded_at`, `agreement_version.published_at`) must equal `now()` for nmp_app (42501); inbound payload only while held; late_transaction inserted pending only; one reversal per chargeback of the same order; volumes are integer strings (`volumes_valid`, `volume_effect_valid`); every relationship write marks `path_model` stale.
- **Permissions:** 18 new (privileged: `participant.terminate`, `participant_type.approve`, `agreement.publish`, `case.genealogy.approve`, `case.duplicate.approve`, `privacy.manage`); DPO is a privileged role; support sessions exclude the privileged and write-only ones. Reinstating a terminated position needs `participant.terminate` + step-up (awaiting architect sign-off).
- **Key scopes:** `participants:write` (personal data; minting needs `integration.manage`, `participant.manage`, `servicing.manage` for all markets), `orders:write` (`integration.manage`). API-10/11 are key-only (session → 403 API_KEY_REQUIRED).
- **Settings (no defaults, DEC-14):** `participants.duplicate_matching`, `customers.reassignment_rule`, `orders.crediting_event`, `orders.purpose_required`, `orders.attribution_precedence`, `orders.new_buyer_type`, `orders.restocking_fee_volume_effect`, `integrations.sync_health`, `genealogy.visibility_policy` (DPO approval), `genealogy.placement_width` (B3 moves it to the plan version).
- **Config (D-B2-19):** `ORDER_FUTURE_TOLERANCE_SECONDS`, `GENEALOGY_FALLBACK_MAX_DEPTH`, `GENEALOGY_PAGE_MAX` (in `.env.example`).
- **Outbox topics:** `order.ingested`, `genealogy.changed`; `case.decided` covers the new case types.
- **Decisions:** D-B2-01..21 summarised as E-ADR-39 in `ARCHITECTURE_DECISION_LOG.md`.

## 4. Open defects and issues
| ID | Sev | What | Owner / when |
|---|---|---|---|
| BUG-081 | LOW | Connector mapping refusal codes (BUYER_MISSING, SKU_MISSING, …) shown raw in the SC-31 exception queue and SC-13 "Last refusal" | frontend (`orders/format.ts` REFUSAL_LABELS) |
| BUG-082 | LOW | SC-31 exception queue Source shows `connector:<uuid>` instead of the connector name | frontend |
| BUG-083 | LOW | Approving a settings change whose effective time has passed shows the raw "effective_from cannot be in the past." | frontend/TEN |
| SEC-B2-1 | MEDIUM | `POST /v1/participants/:id/signals` matches digests tenant-wide: an identity-signal oracle across markets | security review. **Partly fixed in tree:** the response names only a duplicate case the caller can read (`readableDuplicateCase`), and cases naming another market's participant need read over both markets (`relatedMarketSql`); matching itself stays tenant-wide. Unconfirmed, unregistered |
| SEC-B2-2 | MEDIUM | A `participants:write` key could be minted with `integration.manage` only (privilege escalation) | **fix in tree:** scope `permissions[]` = integration.manage + participant.manage + servicing.manage, all markets. Unconfirmed, unregistered |
| SEC-B2-3 | MEDIUM | A duplicate-held (pending) position still took attribution and first-order servicing | **fix in tree:** attribution hints count only positions active at crediting time; 0208 C1/C3 active only. Unconfirmed, unregistered |
| SEC-B2-4 | LOW | `PATCH /v1/cases/:id` let any create-holder rewrite another user's open case | **fix in tree:** user-opened cases only by opener or assignee. Unconfirmed, unregistered |
| SEC-B2-5 | LOW | Error codes reveal records in other markets (PARTICIPANT_EXISTS, SPONSOR_*) | **partly fixed:** out-of-scope sponsor → SPONSOR_NOT_ELIGIBLE without details; PARTICIPANT_EXISTS kept (tenant-wide unique external_ref). Unconfirmed, unregistered |
| OI-1 | – | nmp_dev and nmp_e2e at 0207, nmp_test at 0109 | migrate each to 0208 (nmp_e2e then `seed:e2e`) |
| OI-2 | – | GEN deviations need architect sign-off: reinstatement permission (PLAN §2.5); correction may start at a future row's start (E-GEN-04, PLAN §2.4); change/correction proposed parent unscoped (D-B2-21) | architect |
| OI-3 | – | DB follow-ups: `path_model.valid_until` and position-insert stale mark (then drop the read-path scans in `gen/read-model.ts`, shortcut comment there); case decision guard should exclude 'updated' actors; `par_create_customer` created flag; G2's redundant path_model upsert | database, 0209+ |
| OI-4 | – | `crm_set_servicer` raises unmapped 23514 when a new row would start at/before the current one (manual servicing route → 500) | backend: validate the date or map the code |
| OI-5 | – | Unknown connector id answers 404 while a known id without signature answers 401 (existence answer); IP_NOT_ALLOWED runs before any limiter | decision (security/backend) |
| OI-6 | – | Shortcuts with comments: one GET per row for case subjects (SC-06) and late-item currency (SC-32); `market_period_at` NULL with several calendars; conservative cycle check; owner valid-time only in tree nodes; int/test-support repeats ord fixtures | upgrade when the comment's condition is met |
| OI-7 | – | Volume regex allows 19 digits (can exceed bigint) and negative per-unit volumes | database |
| OI-8 | – | FR-CAS-001 is now mounted and browser-exercised through the B2 case types; its TRACEABILITY status was left at I T (not in this step's list) | records owner |

**Not exercised in the browser** (QA): WooCommerce, connector rotate/withdraw, webhook refunds/cancel, merge/terminate duplicate outcomes, servicing and type change dialogs, later agreement acceptance, sync behind/held 24 h, support session on B2 pages, placement tree and known-at in the explorer, scheduled-only visibility banner, BUG-060 browser re-check. Integration tests cover the API side.

## 5. Deferred (PLAN §8, unchanged)
Connector pull side, reconciliation, Woo partial refunds (hosted/V1); change windows, payout impact, restatement routing, replay equality (B3/B4); placement rule and width, rule re-parenting, positions-per-participant limit, household rule, fractional roll-ups, run consumption of late items, run blocking on sync health (B3); payouts on termination, payout hold, identity documents in the sensitive store, combined statement (B4); attribution-conflict case, customer notices/choice, portal genealogy callers, sync alerts (B5); subscription events (V1); global search (B6); back-dated enrolment history (migration tooling, B6); market-scoped genealogy readers (on demand); order/inbound partitioning and purge (V1/ops); pack-driven agreement and purpose requirements (B-MKT).

## 6. Next steps (in order)
1. Security agent: confirm SEC-B2-1..5 against their repros (scratchpad `b2sec/b2.test.ts` pattern), decide whether R1 needs market-scoped matching, and register all five in `BUG_REGISTER.md`.
2. Migrate nmp_dev, nmp_e2e (then `seed:e2e`) and nmp_test to 0208 (OI-1).
3. Architect: sign off or reverse the GEN deviations and D-B2-21 parent scoping; copy the result into PLAN §2.4/§2.5 (OI-2).
4. Frontend: BUG-081, 082, 083 with regression tests; backend: map the C1 23514 (OI-4).
5. Database (0209+): OI-3 items, then remove the read-path scans in `gen/read-model.ts`; tighten the volume regex (OI-7).
6. QA: a round 3 for the not-exercised paths above, including WooCommerce and duplicate merge/terminate outcomes.
7. Start B3 (plans, engine, runs; migrations 0300–0399). Run the performance spike items first (OQ-05, TS-29; MASTER_PROJECT_MEMORY). B3 owns `genealogy.placement_width` → plan version, rule re-parenting (`event_type 'rule'`), late-item consumption and run blocking on sync health.
