# Increment B3 — HANDOFF (2026-11-18)

Contract: `PLAN.md` (D-B3-01..23, §S, §B, §R, §1–§8, §C, §P). This file records what exists, what is open and what to do next. Facts come from the B3 agent results, the agent memories, the QA and security reports and the records-step run below; nothing here is inferred.

## 1. State
- **Scope built:** FR-PLN-001, 003, 004, 005, 006; FR-COMP-001, 002, 003, 005..010, 012; FR-CPL-007, 008: all I T V. FR-PLN-002 and FR-COMP-004 are I T V but partial by PLAN §8 (rules scoped by market only, no profile facts; restatements correct money, not qualification state). B2-owned items finished (placement width and crediting event by plan version, rule re-parenting, change window, positions limit, automatic `plan_variant` checklist item). PLAN §B carry-over closed: OI-2 signed off (E-ADR-40), OI-3/OI-4/OI-7 fixed, OI-5 decided, BUG-081..083 fixed in code, SEC-B2-1..5 registered, FR-CAS-001 and every Release A row set to I T V in TRACEABILITY.
- **Migrations:** 0300–0306 (`packages/db/migrations`). 0305 = DB review fixes (6 findings). 0306 = security fix (guardrail override SoD by rule authors). No applied migration was edited. Next free number: **0307**.
- **Database levels (checked 2026-11-18 by the records step):** nmp_test_4 at 0306 (reset for the run below); nmp_dev, nmp_e2e, nmp_test_2, nmp_test_3 at 0305; **nmp_test has no B3 migration**: its newest row is `0250_firebase_identity.sql` (applied 2026-11-18 00:12), a file that is not in `packages/db/migrations`.
- **Full suite (records step, nmp_test_4, `NMP_TEST_DB=nmp_test_4 scripts/heavy.sh pnpm vitest run`):** 173 files passed, **3303 tests passed**, 0 failed, 0 skipped (76 s). `pnpm -s typecheck` and `tsc -p apps/web --noEmit`: clean. Logs: `var/b3-records-vitest.log`, `var/b3-records-tsc.log`, reset `var/b3-records-reset.log`. Per module: db 203, engine 328, pln 43, comp 62, cpl 62, gen 52, par 42, ord 49, ten 80, isolation 1208, role-matrix 31+11, web 530.
- **Browser (QA, `testing/UI_TESTING_REPORT.md` / `VISUAL_REGRESSION_REPORT.md` "Increment B3 — round 1/2/3", evidence `var/qa-b3/`):** round 1 found BUG-084 CRITICAL (quantity² volumes) and BUG-085..093; round 2 (fresh seed, no DB workaround) passed W-B3-1..8, verified BUG-084..088 fixed and BUG-089..093 fixed in part, found BUG-094 MEDIUM and BUG-095/096 LOW; round 3 verified BUG-094 fixed and found BUG-097/098 LOW. MVP-A regression intact (import counts, R1 16.61 %, audit chain), isolation probes 404/403, no 5xx. Impeccable 12/16 → 13/16. W-B3-9 regression was partial (see §4).
- **Performance (§S, numbers in `../S/SPIKE_REPORT.md` §6):** S-1 engine 50k all shapes 1.1–1.5 s; 150k binary 2.4 GB; **500k and 2M out of memory with a 4 GB heap**. S-2 write path 600k lines in 149 s in one transaction (C-B3-17 decided). 100k end to end not measured (codec was O(n²); fixed afterwards, not re-run).

## 2. What exists
| Module | What | Where |
|---|---|---|
| DB | 16 tables (plan, plan_market, plan_calendar, plan_version, plan_rule, plan_transition, golden_dataset, guardrail_decision, run_snapshot, run, result_line, qualification_state, simulation, sim_result_line, adjustment_origin, restatement), period/late_transaction/path_model changes, guards and append-only triggers, §4.2 SQL contracts, 14 permissions + base roles | `packages/db/migrations/0300..0306`, tests `packages/db/test/b3-guards.test.ts` |
| Engine 0.2.0 | JSON-AST expressions (E-ADR-41), `validateRule`/`validatePlan`/`compilePlan`/`renderRule`, half_even, codec `stringifyEngineJson`/`parseEngineJson` | `packages/engine/src/{expression,plan,json}.ts` |
| PLN | Plans, versions, rules (recompile + guardrails on every draft write), transitions, compare, goldens, submit/decision/schedule/activate with SoD, activation cron `pln.versions.activate` | `apps/api/src/modules/pln` |
| CPL | Guardrail catalogue (`enrolment_only_pay`, `starter_kit_volume`), evaluation, acknowledgement, override with evidence, decisions log | `apps/api/src/modules/cpl/guardrail*.ts`, `sod.ts` |
| COMP | Periods + preflight (sync gate), snapshot loader/store, runs (jobs `comp.run.calculate`, `comp.simulation.run`), review, commit, lines/CSV/trace/replay, simulations, late adjustments, restatement case type + sandbox, qualification | `apps/api/src/modules/comp` |
| B2 modules | `ten/plan-structure.ts` (width, structural rules), crediting by plan (ord), positions limit (par), re-parenting + change window (gen), SETTING_RETIRED, CALENDAR_IN_PLAN, checklist plan_variant | `apps/api/src/modules/{gen,par,ord,ten,crm}` |
| Web | SC-01 `/periods`, SC-02 review + commit dialog, SC-43 qualification, SC-04 `/plans` + version, SC-05 caps, SC-42 simulation, SC-11 `/compliance/guardrails`; restatement case, SC-32 consumed link, SC-07/09 rule origin, enrol Leg/Automatic, `RowMenu` component | `apps/web/src/features/{periods,plans,guardrails,qualification,cases,orders,people,genealogy}`, `components/row-menu.tsx` |
| Seed | planadmin@acme/globex; fixture guardrail predicates; e2e DE market (7 periods from M-3, A←B←C, K serviced by C, FX-1 = 100.00 pv) with settings v1 at the first DE period; isolation `seedCompensation` (NL, TS-10 plan, 2 committed runs, simulation, restatement case, draft v2) | `apps/api/src/seed.ts`, `apps/api/test/isolation/seed.ts` |

## 3. Contracts later increments rely on
- **Decisions:** D-B3-01..23 (PLAN §0), E-ADR-40..46 in `ARCHITECTURE_DECISION_LOG.md`.
- **DB write contracts** (database agent memory and the DB result): approval rows by object type `plan_version` (approver ≠ submitter; activation approver ≠ submitter and compliance approver), `run` (approver ∉ {prepared_by, commit_requested_by}), `guardrail_decision` (override approver = decided_by; not a rule author, 0306). Runs: queued → running (snapshot) → calculated (totals.gross_minor decimal string = Σ lines; one calculated run per period, deferred) → committed | discarded | failed. Lines and state rows only while running (row locks, 0305). Origins: inserted unconsumed; a line carrying an origin copies its type, payee, rule, source, amount and original period; the commit transaction must consume every origin its lines carry (else 23514 at COMMIT). Restatement: empty diff calculated→applied; else calculated→approved→applied in the commit transaction; follows its case decision. All refusals 23514 / 42501.
- **SQL functions:** `plan_version_for_period`, `plan_crediting_event`, `placement_width_for`, `plan_rules_in_force`, `pln_due_activations`, `plan_version_simulated`, `guardrail_rules_hash`, `guardrail_outstanding`, `guardrail_rule_authors`, `comp_late_catch_up`, `comp_simulation_source`, `gen_path_valid_until`; `par_create_customer` returns `(id, created)`.
- **Engine:** rules stored in engine shape, compiled per calendar into `plan_version.compiled`; COMP never imports new engine code. Snapshots = gzip(canonical engine JSON) + sha256; instants are µs text from SQL. Engine event ids `<order_event id>:<line_no>`. `order_line.volumes` are line totals: divide by quantity before the engine (BUG-084).
- **API:** commit = second person + `run.commit` + step-up + acknowledged blocking exceptions; staleness → 409 RUN_SUPERSEDED (newer_run, plan_version_changed, settings_version_changed, late_items_changed, discarded). Review opened by `GET /v1/runs/:id/review` (D-B3-11). No ledger posting at commit (B4). Long jobs `enqueueLong` (75 min expiry).
- **Permissions:** 14 new; privileged `plan.approve`, `run.commit`, `restatement.approve`, `override.approve`. Base roles `B3_UPDATED_BASE_ROLES`; seed role Plan administrator. Support sessions exclude privileged/write-only per PLAN §2.7 (read-only catalogue now 23 permissions).
- **Settings:** `runs.exception_thresholds {large_line_minor}` (no default); `genealogy.placement_width` retired (fallback only, PUT → 422 SETTING_RETIRED); minor strings ≤ 18 digits.
- **Outbox topics:** `run.committed`, `plan.version.activated`; `case.decided` covers `restatement`.

## 4. Open defects and issues
| ID | Sev | What | Owner / when |
|---|---|---|---|
| S-1 | HIGH (scale) | Engine runs out of memory at 500k and 2M positions with a 4 GB heap (~16 KB per position); NFR-PERF scale for large tenants not met. E-ADR-34/35 to re-evaluate | architect + compensation (TK-B3-12) |
| S-2 | – | 100k end-to-end run not measured after the codec fix | backend (TK-B3-13) |
| SEC-B3-1 | HIGH | Late clawbacks under-computed (reversed share divided by the gross order, not P's applied input) | **fix in tree** (`comp/late.ts`); not re-reviewed, unregistered |
| SEC-B3-2 | MEDIUM | Guardrail override SoD excluded only the evaluator, not the matched rules' authors | **fix in tree** (0306 `guardrail_rule_authors`, override route `contributorIds`); not re-reviewed, unregistered |
| SEC-B3-3..6, 8 | LOW | Golden GET returned the frozen input to plan.read (now null unless genealogy.read + order.read over all markets); acknowledge/evaluate outside draft (now 409 VERSION_NOT_DRAFT); simulation reads used a union scope (now one permission must cover every plan market); draft audit without values (now before/after values); amount-only in-period refunds dropped (now blocking exception `unreversed_event:<id>`) | **fixes in tree**; not re-reviewed, unregistered |
| SEC-B3-7 | LOW | Review-opened commit gate is set by a GET | not changed: PLAN D-B3-11 contract, session cookie SameSite=Strict |
| OI-1 | MEDIUM | A restatement origin carried by two calculated runs: the second commit fails at COMMIT with 23514 → HTTP 500; needs a 409 RUN_SUPERSEDED gate (reason e.g. `origins_consumed`) | backend (TK-B3-14) |
| OI-2 | – | Guardrail evidence documents (market NULL) are readable only by `market.manage`/`market.signoff` in `aud/documents.ts`; should use `guardrail.read` | integrator |
| OI-3 | – | Architect decisions: placement re-parenting in trees with legs (GEN_SLOT_TAKEN), opaque `enrolment_only_pay` acknowledgement vs `override.approve` | architect (TK-B3-17) |
| OI-4 | – | 0306 not on nmp_dev/nmp_e2e; nmp_test has no B3 migration and a foreign `0250_firebase_identity.sql` row; nmp_e2e then needs `seed:e2e` | orchestrator (TK-B3-16) |
| OI-5 | – | Not enforced in SQL (API checks only): rule-author SoD and eligible approvers across all plan markets, commit staleness gates, notice-period and crediting gates | by design (DB result) |
| BUG-090 | LOW | Engine plain language prints raw minor units ("pv ≥ 10000 minor units") | compensation (engine renderRule) |
| BUG-092 | LOW | Engine trace prints "known at <µs>" | compensation (engine explain) |
| BUG-093 | LOW | SC-02 "What changed" says "not the first under a new plan version" on the first run of v1 | frontend (`features/periods/review-tabs.tsx`) |
| BUG-095 | LOW | SC-32 original period as viewer-zone instants | frontend |
| BUG-096 | LOW | SC-42 "Open guardrail decisions" prints the raw outcome code | frontend |
| BUG-097 | LOW | SC-01 Gross amount wraps away from "EUR" | frontend |
| BUG-098 | LOW | SC-01 at 768: table scrolls sideways in its box, chips break per word | frontend |
| OPEN-ENG-01 | MEDIUM | `limit.max_per_order` and banked points still need product semantics (expressions, readable carry, clawback built) | product decision |
| SEC-B2-1, -5 | MEDIUM/LOW | Registered as fixed in part (matching stays tenant-wide; PARTICIPANT_EXISTS kept); PLAN §B asked the B3 security review to re-run the SEC-B2 repros: not reported | security (TK-B3-11) |

**Not exercised in the browser** (QA rounds 2–3): WooCommerce webhook, duplicate merge/terminate outcomes, BUG-081/082/083 re-checks, B1 markets, support session on B3 pages, SC-05 pools form and Move up/down, row Calculate/Re-run after the BUG-094 change (no calculable period in the round-2 end state). Integration tests cover the API side.

Shortcuts with comments: SC-01 target period from the newest 50 periods; SC-02 one GET per payee name; placement width falls back to the retired setting when no version covers the market (B6); SC-04 effective time uses the market zone for the cut-off zone.

## 5. Deferred (PLAN §8, unchanged)
Ledger entry at commit, settlement, clawback receivables, withholding, Paid/Closed (B4); manual adjustment cases FR-CAS-002 (B4); PeriodCutOff event and calendar top-up job (when a consumer exists); filing-status gate, SC-44, transition report screen, FR-PLN-007/008 governance (B-MKT/B6); restated qualification state (product decision/B6); per-rule participant-type scope and profile facts (B6); parallel run (B6); provisional runs FR-COMP-011 (V1); banked points, `limit.max_per_order`, binary pairing, pass-10 minimums, cross-calendar state (product decision); product categories (when a source exists); several engine versions and cold-storage snapshots; vendor review of overrides (B6); fee guardrail and personal-consumption threshold; household rule; distributor views (B5); partitioning, simulation-line purge, separate calc worker (after §S / ops); held payees (B4).

## 6. Next steps (in order)
1. Architect + compensation: S-1 memory (500k/2M OOM) — choose the engine memory layout or worker size and re-evaluate E-ADR-34/35 before B4 relies on large runs; backend re-runs the S-2 100k end-to-end bench.
2. Security: re-run `b3sec/{clawback,override}.test.ts` and the SEC-B2-1..5 repros against the tree; register SEC-B3-1..8 in `BUG_REGISTER.md`.
3. Backend: 409 RUN_SUPERSEDED gate for consumed restatement origins (OI-1) with a regression test; integrator: guardrail evidence readers (OI-2).
4. Apply 0306 to nmp_dev and nmp_e2e (then `seed:e2e`); find out where nmp_test's `0250_firebase_identity.sql` came from before migrating it (OI-4).
5. Frontend/compensation: BUG-090, 092, 093, 095..098 with regression tests.
6. QA: a round for the not-exercised paths above (WooCommerce, duplicate outcomes, BUG-081..083, SC-05 pools, row Calculate after a reseed, support session on B3 pages).
7. Start B4 (ledger, payouts, tax; migrations 0400–0499). B4 owns posting at commit, clawback receivables, manual adjustment cases and holds.
