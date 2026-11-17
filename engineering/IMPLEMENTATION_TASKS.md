# Implementation Tasks (MVP-A)

MVP-B tasks are written per increment when it starts. Done = code + tests green + browser check + registers updated.

| ID | Module | Description | Agent | Depends | Source | Pri | Status |
|---|---|---|---|---|---|---|---|
| T-000 | infra | Workspace, tsconfig, lint, vitest, databases, roles, .env.example | orchestrator | - | - | P0 | Completed |
| T-A01 | db | Migrations for 20 rel-A tables + RLS + audit schema + policy-coverage test | orchestrator | T-000 | DATABASE.md | P0 | Completed |
| T-A02 | IAM | Sessions, argon2id, TOTP, forced MFA, step-up, lockout | orchestrator | T-A01 | FR-IAM-001 002 | P0 | Completed |
| T-A03 | IAM | Roles, permissions catalogue, role grants with second-admin approval | orchestrator | T-A02 | FR-IAM-003 | P0 | Implemented |
| T-A04 | AUD | Hash-chained audit events, read API, export with caps, verification job | orchestrator | T-A01 | FR-AUD-001 002 | P0 | Completed |
| T-A05 | TEN/OPS | Vendor console API: provision tenant, region, states; vendor audit | orchestrator | T-A03 | FR-TEN-001 FR-OPS-001 | P0 | Implemented |
| T-A06 | IAM | Vendor support sessions: request, decide, expire, read-only | orchestrator | T-A05 | FR-IAM-005 | P0 | Implemented |
| T-A07 | security | Generated cross-tenant isolation suite over every route (TS-21) | qa | T-A06 | TS-21 | P0 | Implemented |
| T-A07b | db/IAM | Hardening migration 0040 for BUG-001..004 (support request impersonation, credential row scope, session column immutability, sessions of deactivated users) + BUG-005 grant market scope | security | stage 2 | BUG_REGISTER | P0 | Implemented |
| T-A07c | IAM | Fix BUG-006 (approver scope on pending grants) and BUG-007 (revoke/deactivate scope + step-up) | security | stage 3 | BUG_REGISTER | P0 | Completed |
| T-A07d | IAM/OPS | Fix BUG-031 vendor-user invitation two-person control | security | — | BUG_REGISTER | P0 | Completed |
| T-A08 | IMP | Upload, validation (15 rules, forbidden tokens), row errors | backend | T-A05 | FR-IMP-001 | P1 | Implemented |
| T-A09 | IMP | Mapping (draft/approved), load to cpl_fact_*, supersede | backend | T-A08 | FR-IMP-002 003 | P1 | Implemented |
| T-A10 | CPL | packages/compliance: R1–R5 pure, bigint, golden + TS-31 tests | compensation | T-000 | FR-CPL-001..005 | P1 | Completed |
| T-A11 | CPL | Snapshots, figures, drill-down, outdated on new load, method notes | backend | T-A09 T-A10 | FR-CPL-006 | P1 | Implemented |
| T-A12 | PRV | Breach contacts in tenant settings | backend | T-A05 | FR-PRV-004 | P2 | Implemented |
| T-A13 | web | Shell, tokens, sign-in, MFA, nav from permissions | frontend | T-A03 | SC-39 | P1 | Completed |
| T-A14 | web | Vendor console, tenant admin: users, roles, approvals, support sessions, audit | frontend | T-A13 | SC-10 14 30 46 | P1 | Completed |
| T-A15 | web | Imports and compliance report screens | frontend | T-A11 T-A13 | SC-24..28 | P1 | Completed |
| T-A16 | qa | Playwright MCP workflow, two tenants, all A roles | qa | T-A15 | AC rel A | P1 | Completed |
| T-A17 | security | Security audit + code review of A; fix Critical/High | security | T-A16 | SEC-* | P1 | Completed |

## Increment B1 — MVP-B foundations (2026-11-17, contract `increments/B1/PLAN.md`, state `increments/B1/HANDOFF.md`)

| ID | Module | Description | Agent | Depends | Source | Pri | Status |
|---|---|---|---|---|---|---|---|
| T-B1-00 | plan | PLAN.md: D-B1-01..19, §R, schema/API/permission contracts, screens, workflows, deferrals | architect | - | spec.json | P0 | Completed |
| T-B1-01 | db | Migrations 0100–0107, SoD primitive `@nmp/db` approvals, permissions catalogue, seed (finance@, DEMO draft, e2e fixture pack), config D-B1-16, `lib/db.ts` key caller | database | T-B1-00 | PLAN §1 §3 §6 | P0 | Completed |
| T-B1-02 | db | Review fixes 0108: case submit/withdraw/evidence actor binding, money-key backstop at same effective_from, webhook scheduled CHECK, actor columns, pack-rule rule_key + EXCLUDE | database | T-B1-01 | review findings | P0 | Completed |
| T-B1-03 | IAM/INT/CPL/support | BE1: service accounts, API keys, key auth, public API, webhooks + outbox dispatch, pack-rule API, support requester (BUG-023) | backend | T-B1-01 | FR-IAM-006 FR-INT-001 FR-CPL-012 | P0 | Completed |
| T-B1-04 | TEN/PAY | BE2: markets, brands, calendars, settings timeline with rebase, money change requests, launch checklist, go-live sign-off, provider eligibility | backend | T-B1-01 | FR-TEN-002/003/004 FR-IAM-004 | P0 | Completed |
| T-B1-05 | CAS/AUD | BE3: case framework (registry, state machine, evidence, SoD decisions; not mounted) and evidence documents | backend | T-B1-01 | FR-CAS-001 | P0 | Completed |
| T-B1-06 | api | Integration: modules/index.ts (int, pay), isolation seed and cases, role matrix, `.env.example` | integrator | T-B1-03..05 | PLAN §P | P0 | Completed |
| T-B1-07 | web | W1: SC-29 B part, Markets/Brands/Calendars, SC-17 checklist | frontend | T-B1-06 | PLAN §5 | P1 | Completed |
| T-B1-08 | web | W2: SC-13 API keys + webhooks; MVP-A polish BUG-023, 025–029, 045–048 | frontend | T-B1-06 | PLAN §5 §B | P1 | Completed |
| T-B1-09 | qa | Browser rounds 1–2 (W-B1-1..6, 4 viewports, visual harness, Impeccable); BUG-049..059 found, fixed, verified | qa | T-B1-07/08 | PLAN §7 | P1 | Completed |
| T-B1-10 | security | Adversarial review: SEC-B1-1 HIGH key market-scope escalation, SEC-B1-2 MEDIUM tenant-wide approvers, SEC-B1-3 MEDIUM trustProxy, SEC-B1-4 LOW ip_allow limiter | security | T-B1-06 | SEC review | P0 | Completed |
| T-B1-11 | security | Confirm the SEC-B1-1..4 fixes now in the tree (0109, api-keys scope check, TRUST_PROXY, per-address limiter) and register them in BUG_REGISTER | security | T-B1-10 | HANDOFF §4 | P0 | Completed (BUG-061..064 registered Fixed) |
| T-B1-12 | db | Apply 0109 to nmp_dev, nmp_e2e, nmp_test | orchestrator | T-B1-11 | HANDOFF OI-4 | P1 | Completed for nmp_dev/nmp_e2e (now at 0207); nmp_test still at 0109, see T-B2-16 |
| T-B1-13 | web | BUG-060 SC-17 inspector `break-all` splits "mandatory" | frontend | - | BUG_REGISTER | P3 | Completed (code; browser re-check open) |
| T-B1-14 | qa | role-matrix `beforeAll` hook timeout under full-suite load (OI-6) | qa | - | records full run | P2 | Completed (B2 integrator: SEED_TIMEOUT_MS 120 s; B2 full run 148/148 files) |
| T-B1-15 | infra | Add `TRUST_PROXY` to `.env.example` | integrator | T-B1-11 | HANDOFF SEC-B1-3 | P2 | Completed (B2 integrator) |
| T-B1-16 | records | Copy D-B1-01..19 into ARCHITECTURE_DECISION_LOG | orchestrator | - | PLAN §0 | P2 | Completed (E-ADR-37) |
| T-B1-17 | db/CAS | Evidence-vs-submit concurrency test; key-caller `created_by` FK model before key write routes | database | - | HANDOFF OI-2 OI-3 | P2 | Completed (B2: OI-2 actor pair without FK, D-B2-03; OI-3 case-evidence-race.test.ts) |
| T-B1-18 | db | Outbox purge vs `webhook_delivery` FK (ON DELETE decision) | database | - | HANDOFF OI-1 | P3 | Open (V1/ops) |

## Increment B2 — participants, bitemporal genealogy, orders, attribution, first case types (2026-11-17, contract `increments/B2/PLAN.md`, state `increments/B2/HANDOFF.md`)

| ID | Module | Description | Agent | Depends | Source | Pri | Status |
|---|---|---|---|---|---|---|---|
| T-B2-00 | plan | PLAN.md: D-B2-01..21, §R for 22 FRs, schema/API/permission/SQL contracts, screens, seed, W-B2-1..11, deferrals, §C | architect | - | spec.json | P0 | Completed |
| T-B2-01 | db | Migrations 0200–0206 (19 tables, B1 table changes, read functions, write contracts G1–G5/C1/C3/P2), 18 permissions, key scopes, config D-B2-19, settings registry + approverPermission, seed (support, DPO, e2e NL market), b2-guards + OI-3 race tests | database | T-B2-00 | PLAN §1 §3 §4.2 §6 | P0 | Completed |
| T-B2-02 | db | Review fixes 0207: G5 back-dated status (GN006), C3 back-dated termination, system-time columns, inbound payload held-only, late_transaction insert guard, chargeback reversal binding, order_line actor pair, volume CHECKs, C1 advisory lock, relationship writes mark path_model stale | database | T-B2-01 | DB review | P0 | Completed |
| T-B2-03 | PAR/CRM/CAS/TEN/AUD | BE1: participant types (SoD), participants (masked contact, unmask), enrolment, duplicates (HMAC digests, system cases), agreements, servicing, CAS PATCH/counts/system cases, approverPermission | backend | T-B2-01 | FR-PAR-001/002/003/006 FR-CRM-001/002 | P0 | Completed |
| T-B2-04 | GEN | BE2: positions/status, tree as-of/known-at, change/correction/transfer case types, visibility policy (viewer), path read model + rebuild job | backend | T-B2-01 | FR-GEN-001..009 FR-PAR-005 | P0 | Completed |
| T-B2-05 | ORD/INT/IAM/PAY | BE3: order/event ingestion (keys, idempotent natural key, held queue), volumes, attribution, late queue, Shopify/WooCommerce inbound webhooks (HMAC), sync health, navigation, CSRF exemptions | backend | T-B2-01 | FR-ORD-001..005 FR-INT-002 | P0 | Completed |
| T-B2-06 | api | Integration: mount modules + createCasModule(caseTypes), OpenAPI PAR/CRM paths, isolation seed/cases + role-matrix rows for every B2 route, `.env.example` D-B2-19 + TRUST_PROXY | integrator | T-B2-03..05 | PLAN §P | P0 | Completed |
| T-B2-07 | web | W1: People, SC-09, SC-07, SC-13 connectors + health, SC-29 B2 part, SC-17 touch, permission labels | frontend | T-B2-06 | PLAN §5 | P1 | Completed |
| T-B2-08 | web | W2: SC-06, SC-08, SC-31, SC-32 | frontend | T-B2-06 | PLAN §5 | P1 | Completed |
| T-B2-09 | qa | Browser rounds 1–2 (W-B2-1..11, 4 viewports, harness 9 screens, Impeccable 12→14/16); BUG-069..080 found, fixed, verified; BUG-081..083 found | qa | T-B2-07/08 | PLAN §7 | P1 | Completed |
| T-B2-10 | security | Adversarial reviews (BE3 and full); round 3 fixes in tree (api-scopes permissions[], active-only attribution + 0208, case PATCH opener/assignee, readable duplicate case, relatedMarketSql) | security/backend | T-B2-06 | SEC review | P0 | Completed (fixes unconfirmed, see T-B2-11) |
| T-B2-11 | security | Confirm SEC-B2-1..5 fixes against their repros and register them in BUG_REGISTER (R1 identity oracle and R5 existence codes only partly closed) | security | T-B2-10 | HANDOFF §4 | P0 | Completed (B3 records: SEC-B2-1..5 registered in BUG_REGISTER from the B2 round-3 fixes; repro re-run not reported) |
| T-B2-12 | web | BUG-081 connector refusal codes in words, BUG-082 exception-queue Source as connector name, BUG-083 approval after effective time passed | frontend | - | BUG_REGISTER | P3 | Completed (B3 W1/W2, regression tests; browser re-check not executed) |
| T-B2-13 | architect | Sign off GEN deviations (reinstatement needs participant.terminate + step-up; correction may start at a future row's start, E-GEN-04) and unscoped proposed parent (D-B2-21); copy into PLAN §2.4/§2.5 | architect | - | backend OPEN_ISSUES | P2 | Completed (architect 2026-11-17, E-ADR-40) |
| T-B2-14 | db | 0209+: path_model.valid_until and position-insert stale mark (drop read-path scans in gen/read-model.ts), case decision guard excludes 'updated' actors, par_create_customer created flag, drop G2's redundant path_model upsert | database | T-B2-13 | DB/backend OPEN_ISSUES | P2 | Completed (0303 + BE3: valid_until, position stale mark, read-path scans removed) |
| T-B2-15 | api | Map crm_set_servicer 23514 (new row at/before current) for the manual servicing route; decide unknown connector id 404 vs 401; IP_NOT_ALLOWED before any limiter | backend | - | DB/backend OPEN_ISSUES | P2 | Completed (BE3: 409 SERVICING_CHANGE_PENDING; OI-5 decided no change, B3 PLAN §B) |
| T-B2-16 | db | Migrate nmp_dev and nmp_e2e to 0208 (then seed:e2e) and nmp_test to 0208 | orchestrator | - | HANDOFF OI | P1 | Open in part: nmp_dev/nmp_e2e at 0305 (0306 missing); nmp_test has no B3 migration, see TK-B3-16 |
| T-B2-17 | qa | Not exercised in the browser: WooCommerce, connector rotate/withdraw, webhook refunds/cancel, merge/terminate duplicate outcomes, servicing/type change dialogs, later agreement acceptance, sync behind/held 24 h, support session on B2 pages, placement tree + known-at, BUG-060 re-check | qa | T-B2-12 | QA OPEN_ISSUES | P2 | Open |

## Increment B3 — plans, primitives, calendars, runs, commit, replay, restatement, adjustments, guardrails (2026-11-18, contract `increments/B3/PLAN.md`, state `increments/B3/HANDOFF.md`)

Task ids are TK-B3-nn because PLAN §R uses T-B3-nn for test ids.

| ID | Module | Description | Agent | Depends | Source | Pri | Status |
|---|---|---|---|---|---|---|---|
| TK-B3-00 | plan | PLAN.md: D-B3-01..23, §S performance items, §B carry-over, §R for 19 FRs + B2-owned items, schema/API/permission/SQL contracts, screens, seed, W-B3-1..9, deferrals, §C (24 conflicts); E-ADR-40..46 | architect | - | spec.json | P0 | Completed |
| TK-B3-01 | db | Migrations 0300–0304 (16 tables, period/late_transaction/path_model changes, guards, append-only triggers, §4.2 SQL contracts, OI-3/OI-7 fixes, 14 permissions + base roles), settings registry (runs.exception_thresholds, retired placement width), engine JSON codec, seed (planadmin, fixture guardrail predicates, e2e DE market) | database | TK-B3-00 | PLAN §1 §3 §4.2 §6 | P0 | Completed |
| TK-B3-02 | db | Review fixes 0305: run/simulation row locks (lines after calculation), adjustment_origin insert checks, line-to-origin match + deferred consumption check, restatement follows its case, based_on in the same plan, frozen run/version timestamps | database | TK-B3-01 | DB review (6 findings) | P0 | Completed |
| TK-B3-03 | engine/PLN/CPL | BE1: S-1 benchmark; engine 0.2.0 (expressions, plan validation/compile/render, half_even); PLN module (plans, versions, rules, transitions, compare, goldens, lifecycle, activation job); CPL guardrail evaluation, acknowledgement, override, log | compensation/backend | TK-B3-01 | FR-PLN-001..006 FR-CPL-007/008 | P0 | Completed |
| TK-B3-04 | COMP | BE2: S-2 write-path benchmark; COMP module (periods, preflight + sync gate, snapshot store, runs, review, commit, trace, replay, simulations, late adjustments, restatement case type, qualification) | backend | TK-B3-01 | FR-COMP-001..010, 012 | P0 | Completed |
| TK-B3-05 | GEN/PAR/ORD/TEN/CRM | BE3: placement width and crediting event by plan version, rule re-parenting, change window, positions limit, checklist plan_variant automatic, OI-3 read model, OI-4 mapping, OI-7 18 digits | backend | TK-B3-01 | PLAN §B, §R B2-owned | P0 | Completed |
| TK-B3-06 | api | Integration: mount plnModule + compModule + compCaseTypes, codec O(n²) fix, shared plan fixture, isolation seed (compWorld, seedCompensation) + role-matrix probes for every B3 route, nmp_dev to 0305 | integrator | TK-B3-03..05 | PLAN §P | P0 | Completed |
| TK-B3-07 | web | W1: SC-01, SC-02 + commit dialog, SC-43, restatement case, SC-32 consumed link, BUG-081/082 | frontend | TK-B3-06 | PLAN §5 | P1 | Completed |
| TK-B3-08 | web | W2: SC-04 list/version, SC-05, SC-42, SC-11, BUG-083, retired width row | frontend | TK-B3-06 | PLAN §5 | P1 | Completed |
| TK-B3-09 | qa | Browser rounds 1–3 (W-B3-1..8 pass in round 2; 4 viewports, harness 9 screens, Impeccable 12→13/16); BUG-084..098 found; 084–089, 091, 094 verified fixed | qa | TK-B3-07/08 | PLAN §7 | P1 | Completed |
| TK-B3-10 | security | B3 adversarial review (1 HIGH clawback, 1 MEDIUM override SoD, 6 LOW); backend fixes in tree incl. 0306 (review-opened by GET kept per D-B3-11) | security/backend | TK-B3-06 | SEC review | P0 | Completed (fixes not re-reviewed, see TK-B3-11) |
| TK-B3-11 | security | Re-run the B3 repros (scratchpad b3sec/{clawback,override}.test.ts) against the fixes and register SEC-B3-1..8 in BUG_REGISTER; re-run SEC-B2-1..5 repros (PLAN §B) | security | TK-B3-10 | HANDOFF §4 | P0 | Open |
| TK-B3-12 | engine | S-1: engine runs out of memory at 500k and 2M positions with a 4 GB heap (~16 KB per position); decide memory layout or worker sizing, re-evaluate E-ADR-34/35 | architect/compensation | - | SPIKE_REPORT §6 | P0 | Open |
| TK-B3-13 | COMP | S-2: re-run the 100k end-to-end run after the codec fix (was O(n²)) | backend | - | backend MEMORY | P1 | Open |
| TK-B3-14 | COMP | 409 RUN_SUPERSEDED gate (reason e.g. origins_consumed) when a restatement origin carried by this run was consumed by another committed run (now 23514 → 500 at COMMIT) | backend | - | DB fix open issue | P1 | Open |
| TK-B3-15 | web/engine | LOW defects: BUG-090/092 engine text (minor units, µs known-at), BUG-093 web What-changed copy, BUG-095, BUG-096, BUG-097, BUG-098 | frontend/compensation | - | BUG_REGISTER | P3 | Open |
| TK-B3-16 | db | Apply 0306 to nmp_dev and nmp_e2e (then seed:e2e); migrate nmp_test to head and explain its 0250_firebase_identity.sql row (no such file in the repo) | orchestrator | - | HANDOFF §1 | P1 | Open |
| TK-B3-17 | architect | Open decisions: placement re-parenting in trees with legs (GEN_SLOT_TAKEN), opaque enrolment_only_pay acknowledgement vs override.approve | architect | - | backend MEMORY | P2 | Open |
| TK-B3-18 | qa | W-B3-9 parts not executed: WooCommerce webhook, duplicate merge/terminate outcomes, BUG-081/082/083 re-checks, B1 markets, support session on B3 pages, SC-05 pools + reorder, row Calculate/Re-run after BUG-094 | qa | TK-B3-15 | QA rounds 2–3 | P2 | Open |
