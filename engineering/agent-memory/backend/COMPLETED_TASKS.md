# backend — COMPLETED_TASKS

_Agent: backend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._

## API foundation + T-A02 + T-A03 + T-A04 (2026-11-12)
- Foundation: app.ts (buildApp), server.ts (listen, workers, graceful close), config.ts (zod env, fail fast), lib: errors, http, auth (context + guards), session (cookie, resolve, idle/absolute expiry), db (realm tx helpers + actor context), audit, outbox, idempotency, pagination, web-security (CSRF header, rate limits), secret-box (AES-256-GCM), totp, passwords (argon2id), permissions (catalogue), exports, csv, jobs (pg-boss), module type. seed.ts (dev data).
- T-A02 (FR-IAM-001/002): POST /v1/auth/sessions, POST /v1/auth/vendor-sessions, DELETE /v1/auth/sessions/current, POST /v1/auth/mfa/totp, POST /v1/auth/mfa/totp/confirm, POST /v1/auth/sessions/current/mfa, POST /v1/auth/sessions/current/step-up, POST /v1/auth/invitations/accept, GET /v1/me.
- T-A03 (FR-IAM-003): GET/POST /v1/users, GET /v1/users/:id, POST /v1/users/:id/invitation, POST /v1/users/:id/deactivate, GET/POST /v1/roles, POST /v1/users/:id/role-assignments, POST /v1/role-assignments/:id/revoke, GET /v1/role-grant-requests, POST /v1/role-grant-requests/:id/decision. Catalogue + TS-36 fixture.
- T-A04 (FR-AUD-001/002): GET /v1/audit-events, POST /v1/audit-exports, GET /v1/audit-exports/:id/download, GET /v1/audit-chain/verification, daily jobs aud.verify-chains -> aud.verify-tenant-chain.
- TEN settings foundation: GET/PUT /v1/settings/:key, facade getSetting/getEffectiveSettings.
- Migrations 0007, 0008; packages/db/test updated for the two new tables (migrations, isolation, seed).
- Verified: `pnpm vitest run apps/api` 127/127, `pnpm vitest run packages` 185/185, `pnpm exec tsc -p apps/api --noEmit` clean. nmp_dev and nmp_e2e not touched (not migrated to 0007/0008).

## Review fixes R1 (2026-11-12): 11 findings, all fixed with regression tests
- HIGH MFA retry race and MEDIUM sign-in lockout race: shared `modules/iam/attempts.ts` reserves a failed login_attempt under `pg_advisory_xact_lock` before argon2/TOTP; success row resets. Tests: 20 parallel wrong codes -> 5x422 + 15x429; 30 parallel passwords from 30 IPs -> 5x401 + 25 SIGN_IN_LOCKED, one ACCOUNT_LOCKED (both verified to fail without the lock).
- HIGH market-scope widening: `holdsWithin(auth, perms, marketIds)` replaces holdsAll; scoped admin granting all markets -> 202.
- MEDIUM LAST_ADMIN race: per-tenant advisory lock in assertAdminRemains (deactivate + revoke); concurrent tests (fail 3/3 without lock).
- MEDIUM sign-in limits: per-IP and per-account limiters (`signInRateLimit`), accept route per-IP.
- MEDIUM invitation token: no longer returned; `iam.send-invitation` job mints the token and mails it (mail drop); inviter in user_invitation.created_by.
- MEDIUM config: NODE_ENV required, COOKIE_SECURE default true, seed only into nmp_dev/nmp_test/nmp_e2e.
- LOW: valid_to future-only (400) and 422 GRANT_EXPIRED on approve; session token rotated on AAL2 elevation; session expiry/revocation audited in the same tx; MFA lock refusals audited; idempotency in-progress branch removed.
- Verified: `pnpm vitest run apps/api` 139/139, `tsc -p apps/api --noEmit` clean. No migration added (0009 still unused).

## T-A08 + T-A09 IMP (FR-IMP-001..003) (2026-11-12)
- Upload + validation (V1-V15 + C-17/C-18 additions), FileStore on disk, row errors, warnings, control totals; mapping versions draft -> approved (SoD, step-up, approval row); attach + load into cpl_fact_* in one tx with control-total reconciliation, data-quality report, supersede of overlapping loaded batches, AC-53.1 breach-contact gate.
- Synthetic dataset loads with 1466 / 4775 / 7442 rows, sums 53195001 / 53195001 / 2600070 / 9225679; TS-32 forbidden columns rejected with columns named, zero rows and no files stored.
- Verified: `pnpm vitest run apps/api` 223/223 (imp 34), `pnpm vitest run packages/db` green with 0020, `pnpm exec tsc -p apps/api --noEmit` clean. Only nmp_test was migrated.

## IMP review fixes R1 (2026-11-12): 10 findings
- HIGH forbidden columns: camelCase/acronym split, joined adjacent words, strong parts, wider word list (forbidden-columns.ts); email content sampling of extra columns; only the published columns are stored (projectCsv), load re-checks files.<f>.stored_sha256.
- MEDIUM supersede: only loaded batches inside the new period; partial overlap -> 409 IMPORT_PERIOD_OVERLAP {batch_ids}.
- MEDIUM AC-40.1: fixed by CPL's 0031 (on version creation). My 0021 (approval trigger) conflicted with 0031's guard and is withdrawn by 0022; test via PUT in mappings.test.
- MEDIUM pseudonymity: '@' rule on every id copied into facts (sponsor, buyer, payee, order, line, source order).
- MEDIUM sync load: per-process import gate (429 IMPORT_BUSY, Retry-After 10), default IMPORT_MAX_FILE_BYTES 10 MiB (measured 0.8 s / 290 MiB per 10 MiB orders file). 202+job not built (see OPEN_ISSUES).
- MEDIUM module wiring: UPLOAD_DIR resolved against apps/api; defaultModules/config.ts not owned (escalated).
- LOW: no email echo in any detail; ids <= 200, codes <= 100, <= 1000 distinct codes per vocabulary; order amounts >= 0; starter-kit codes mapped (starter_kits section).
- Verified: imp 45/45, packages/db migrations.test 15/15 (fresh apply incl. 0021+0022), tsc clean for imp. Full apps/api run: imp green; failures only in cpl/ops/support from other agents' concurrent 0011/0031 work.

## T-A05 + T-A06 + T-A12 OPS / SUPPORT / PRV (FR-TEN-001, FR-OPS-001, FR-IAM-005, FR-PRV-004) (2026-11-12)
- modules/ops: GET /v1/tenants, GET /v1/tenants/:id (metadata + markets + job health), POST /v1/tenants (provisioning, vendor Idempotency-Key), POST /v1/tenants/:id/approve (second vendor user, step-up), POST /v1/tenants/:id/go-live (breach contact required); job ops.send-first-admin-invitation.
- modules/support: POST /v1/support-sessions (vendor), GET /v1/support-sessions, GET /v1/support-sessions/:id (both realms), POST /v1/support-sessions/:id/decision (vendor_access.decide + step-up + Idempotency-Key), POST /v1/support-sessions/:id/end (vendor or tenant), GET /v1/support-sessions/:id/log; onRequest hook `supportSessionAccess`; system job support.expire-sessions (every minute).
- modules/prv: GET /v1/tenants/:id/breach-contacts (vendor read); facade `breachContacts(tx)`, `assertBreachContactRecorded(tx)`.
- Migration 0010_vendor_operations.sql (nullable idempotency_key + request_hash on tenant and support_session, unique per creator; index for expiry). No table, no policy, no key: packages/db tests unchanged and green.
- Verified: 32 tests in ops/support/prv; `pnpm vitest run apps/api packages/db` 317/317; `pnpm exec tsc -p apps/api --noEmit` clean. Only nmp_test migrated.

## Review fixes R2 ops/support/prv (2026-11-12): 11 findings, all fixed with regression tests
- HIGH actorOf: in-session handler events now actor_type vendor_user (probe test). HIGH wiring: ops/support/prv in defaultModules, app.ts installs registerSupportSessionAccess; app-level test support/app-session.test.ts.
- MEDIUM: vendor without session refused REALM_FORBIDDEN logged (vendor log, NO_SESSION, onError hook); migration 0011 guard follows actor vendor_user into the tenant realm (support/vendor-guard.test.ts mirrors the psql repro); requester region from user_account.work_region, body region dropped; ACCESSED carries query, in-session 401/403 logged as ACCESS_REFUSED in both logs.
- LOW: session re-checked under lock in recordAccess and in every in-session inTenant tx (test ends the session mid-request); vendor ends only own session (403 PERMISSION_DENIED); approve takes Idempotency-Key (columns on tenant, 0011); first admin's Tenant admin grant + ROLE.GRANTED move to the approval (approver = actor); assertDeciderExists marked shortcut; E-ADR-21..24 and API.md 3.2/4.11 updated.
- Verified: `pnpm vitest run apps/api` 273/273, `pnpm vitest run packages/db` 76/76, tsc clean. Mutation check: reverting actorOf / inTenant re-check fails 2 access tests. Only nmp_test migrated (0011).

## BUG-006/007 + web contract (markets, limits, drill sums, invitation links, me in session) (2026-11-12)
- BUG-006 fixed (iam/grants.ts `mayApprove`), BUG-007 fixed (revokeAssignment/deactivateUser take auth + step-up check). role-matrix `test.fails` flipped to `test`, plus allowed-within-own-market cases; grants/users tests extended. BUG_REGISTER rows Fixed.
- New routes: GET /v1/markets (ten/markets.ts), GET /v1/support-sessions/limits (vendor), GET /v1/imports/limits (import.manage). Isolation cases + TS-36 probes added.
- Snapshot list/detail/create carry `market {id, code, name}`; drill rows meta `sums` + `component`; order rows gained `net_minor` (also in CSV export); invitation links `${WEB_URL}/invitation?tenant=<slug>#token=`; GET /v1/me gives `support_session` (null outside) and, in session, the vendor user via runInVendor.
- Session INSERT binding (task 3): already done by 0041 (no INSERT for nmp_app; auth_open_session binds app_user_id()). No migration written; 0042-0049 unused.
- Verified: `pnpm vitest run` 1040 passed, 5 failed — all 5 in apps/web (compliance-overview, snapshot-report: `marketLabel` missing from web format.ts, frontend agent editing at the time); `pnpm -s typecheck` clean; `tsc -p apps/web` fails on the same in-flight web files.

## Browser defects BUG-010, 011, 012, 013, 014, 019 (2026-11-12)
- Fixed at root cause with regression tests; BUG_REGISTER rows updated (011/012: console screens open for web). E-ADR-28, E-ADR-29 added.
- Files: iam/{grants,admins,invitations,vendor-users,vendor-users-routes,index}.ts, ops/{routes,tenant-creation,first-admin-invitation}.ts, support/access.ts, aud/{events,routes}.ts, cpl/compute.ts, packages/compliance/src/{types,figure,r2,r3,r4}.ts, migration 0042; tests in iam, ops, support, cpl, packages/compliance, packages/db (migrations pins, auth), test/isolation/cases.ts, test/authz/role-matrix.test.ts.
- Verified: `pnpm vitest run` 83 files / 1116 tests green; `pnpm -s typecheck` and `tsc -p apps/web --noEmit` clean.
- 2026-11-17 B1 BE1: FR-IAM-006 keys + apiKeyOrSession, FR-INT-001 int module (OpenAPI, endpoints, dispatcher, SSRF guard), FR-CPL-012 pack rules API, key reads of snapshots, nav anyOf, BUG-023 API, support scope exclusions. 295 module tests green on nmp_test_2.

## B2 BE1 par-crm-cas-ten-aud (2026-11-17)
- PAR + CRM modules, CAS system cases/PATCH/counts/openSystemCase, TEN approver generalisation + automatic agreement item, AUD agreement class. 168 tests green in par, crm, cas, ten, aud, boundaries (nmp_test_2); tsc clean except BE3's int/connectors.test.ts.

## B2 API integrator (2026-11-17)
- modules/index.ts: par, crm, gen, ord + `createCasModule({ types: caseTypes })` (`caseTypes` = gen + par, exported). Fixture CAS module no longer in SUITE_MODULES (SUITE_MODULES = defaultModules).
- lib/auth.ts now owns `requireAnyPermission`, `scopeOfAny`; ten/scope.ts keeps only `inScope`; ord/access.ts deleted; cpl local copy removed.
- int/openapi.ts: participants:write paths (POST /v1/participants, /:id/type|positions|agreement-acceptances|signals, PUT /v1/customers/:id/servicing) from publicParticipantSchemas/publicServicingSchemas (+ test).
- Isolation seed: agreement versions published via POST /v1/documents class=agreement + POST /v1/agreement-versions (agreement item is automatic); PLAN B2 6 objects (types, participants, positions, servicing, acceptance, duplicate + genealogy cases, path model, volumes, late order + refund, held event, connector). Cases + TS-36 probes for all 45 B2 routes; Access 'key', `unsignedAnswer`, `answerOf` echo-normalised phantom comparison; dedicated sponsor/placement/servicer cross-tenant test. SEED_TIMEOUT_MS 120 s on both seeding hooks (B1 OI-6). .env.example D-B2-19 keys.
- Verified on nmp_test_1: `pnpm vitest run` 142 files / 2629 tests green; `pnpm -s typecheck` + `tsc -p apps/web` clean. nmp_dev migrated to 0207; API smoke on :4000 (openapi paths, 401 participants, 404 webhook) stopped by PID.
- 2026-11-18 B3 BE1 engine-plans-guardrails: engine 0.2.0 (expressions, derived measures, expression requirements, half_even, plan validate/compile/render), S-1 bench, PLN module (22 routes + activation cron), CPL guardrail catalogue/decisions/overrides (3 routes). Engine 324 tests, pln+cpl+boundaries green on nmp_test_2.

## B3 BE2 runs (COMP) (2026-11-18)
- S-2 bench (write path 100k/600k, e2e 2k/10k/20k), module comp (17 routes, 2 jobs, restatement case type), int topics/exports, iam nav. 53 comp tests + boundaries green on nmp_test_1; iam/support/int 173 green; `pnpm -s typecheck` + `tsc -p apps/api` clean.

## B4 BE1 engine-and-controls (2026-11-18)
- S-1 compact layout + release (engine 0.2.0 byte-identical), s1-bench.json + SPIKE_REPORT §7; BUG-090/092; OI-3a/3b; OI-2; D-B4-10 two approvals; D-B4-11 related-party routes. Tests: engine 331, pln/aud/cas/iam on nmp_test_2.

- 2026-11-18 B4 BE3 payouts-and-tax: PAY batches/dispatcher/settlement/bank files/bank details/holds/dormant/notices/reminders, TAX profiles, INT provider webhook + payout topics. Tests: pay 9 files, tax 1; full apps/api green except isolation + role-matrix coverage (integrator).
- B4 BE1 review fixes (2026-11-18): CAS views never let approvalsRequired decide readability (list null while open, single views catch ApiError -> null; N+1 gone); excluded approvers pinned at submit in the `submitted` case_event data (hidden from views) and unioned at each decision; IAM.RELATED_PARTY_WITHDRAWN audit carries user/participant/relation before+after. Tests: cas, iam related-parties, comp adjustment green on nmp_test_4; full run only integrator coverage (isolation/role-matrix) red.

## B5 BE3 self-service-and-notifications (2026-11-19)
- dist module (inbox, preferences, delivery cron, templates), GEN /v1/me/team, CRM /v1/me/customers(+/:id), PAY /v1/me/bank-details + payout notices + selection via pay_payee_blockers + reduced pay.notice.send, TAX /v1/me/tax-profile.
- Tests: dist/notifications + templates, pay/self-service, tax/self-service, gen/team, crm/my-customers; regression gen/crm/pay/tax/dist 21 files / 155 tests green on nmp_test_3 (with the temporary 1.7 stand-in); typecheck clean apart from BE1 iam tests that need the real createPortalUser options.
- 2026-11-19 B5 BE1 identity-and-privacy: portal sign-in/codes/reauth/accounts/me, PRV privacy case + routes + jobs, PAR erased label; 216 tests iam/prv/par green in clone with lib patch.
- 2026-11-19 B5 BE2 statements-and-cases: COMP statements/explanation/rank/disputes + overdue cron, CAS openPortalCase/escalateCase/submitCase, adjustment SEC-B4-7 + dispute link, LED write-off SEC-B4-7 + TK-B4-14, PLN notify_plan_change, commit notify_run_statements. comp/cas/led/pln 20 files / 220 tests green on nmp_test_1.
- 2026-11-19 B5 BE3 review fixes: bank-detail stale review (409 REVIEW_PENDING + SUPERSEDED), approval-time exclusions (0510), per-row delivery + NOTIFICATION audits, read audits, team search truncated, staff tax notice, PATCH of SHARED_ACCOUNT case, terminated payee test.
- 2026-11-19 B5 API integration: §1.7 lib contract, dist/prv mounted, portal idempotency key, support-session portal leak fix, isolation (portal access, tenant-B portal, T-B5-40) + role-matrix rows for 38 new routes; API smoke on nmp_dev:4000.
- 2026-11-20 B6 BE2 plans-migration: PLN filings/governance/filing gate/notice record, TEN fallback removal + migration_parallel_run item, IMP migration kind + cycle/orphan checks + kind-separated mappings, new MIG module (create/apply/cancel, opening CSVs/submit/decision, parallel runs, compare cron, classify/accept/sign-off). mig/imp/pln/ten 18 files / 203 tests green on nmp_test_1; typecheck clean for owned modules.
- 2026-11-20 B6 BE3 exports-reporting: INT full export (model, generation, signature, routes, schedule, retention, erasure), D-B6-05 ORD/INT fallback removal, ORD sort + CSV export, RPT dashboards + saved views, BUG-112 GEN/IAM. int/ord/gen/iam/rpt 32 files / 435 tests green on nmp_test_3; api typecheck clean in owned modules, web tsc clean.

## B6 BE1 engine-runs-ledger (nmp_test_2, 2026-11-20)
- D-B6-12 runIncremental + COMP adoption; bench 1M/2M at 4096 and 7168 (SPIKE §8, results/s1-bench.json B6); S-2 100k e2e 55 s.
- D-B6-04 period close routes (comp/close.ts), PAY 409 PERIOD_CLOSED; D-B6-10 chain start; D-B6-11 parallel_run calc + MIGRATION_NOT_SIGNED_OFF; D-B6-08 ledger entries sort + CSV export; TS-28 erasure-replay; BUG-112/119/120.
- Verified: engine + comp + led + pay 561/561, api typecheck clean for owned files.

## B-MKT BE3 registers-locale (2026-11-20)
- D-BM-08/09 grievance case type, registers + exports, escalation cron; D-BM-11 IAM/DIST locale (me/locale, portal mails, DIST de templates + tax_form.available); tests registers.test.ts (10), locale.test.ts (8), templates.test.ts (8).
- B-MKT BE3 review fixes (2026-11-20): market-subject grievance evidence refused (CAS hook), no grievances on draft markets, delisted cursor = participant_id, delisted export counts first; regression tests in cpl/registers.test.ts + cas/cases.test.ts.
