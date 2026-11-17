# database — COMPLETED_TASKS

_Agent: database. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## T-A01 — release A schema, RLS, db package (2026-11-12)
- 0001 foundation (extensions pgcrypto/citext/btree_gist/ltree, schema `audit`, helpers), 0002 TEN+IAM + session/password_credential/mfa_credential/login_attempt, 0003 audit.audit_event + audit.vendor_event with DB-assigned seq and SHA-256 hash chain + verify functions, 0004 document/import/compliance, 0005 outbox_event/export_job/idempotency_key, 0006 RLS policies, auth functions, grants.
- `migrate.ts` (ordered, one tx per file, advisory lock, checksum check, `--reset` only on nmp_*), `pool.ts` (`getPool`, `closePool`, `withTenant`, `withVendor`, `withSystem`), `testing.ts`.
- Verified: `reset` on nmp_test, `pnpm vitest run packages/db` 90/90, `tsc -p packages/db --noEmit` clean, nmp_dev migrated.

## T-A01-R1 — review fixes: 4 findings, all confirmed and fixed (2026-11-12)
- HIGH vendor self-approval of support sessions: vendor policy split into `vendor_read` / `vendor_request` (INSERT only as `requested`, no decision or window, requester a vendor user) / `vendor_end` (active -> ended); trigger `support_session_vendor_may_only_end` pins all other columns; 4 CHECKs (decider is not requester, approved/active need a decider, active needs a window, window <= requested_minutes); `decided_by` is a composite key to a user of the tenant.
- MEDIUM cross-tenant references: every key between tenant-scoped rows is now `(tenant_id, <id>)` against `UNIQUE (tenant_id, id)`; `session` also has `(user_id, realm)`; `role_assignment.role_id` is checked by trigger `role_assignment_role_in_tenant`.
- MEDIUM realm separation: `tenant_isolation` and `tenant_self_read` require `app_realm() = 'tenant'`; all three pool helpers start from a blank context (`NO_CONTEXT`).
- MEDIUM vacuous tests: `test/seed.ts` puts a tenant A row and a vendor row in every readable table; isolation is a context x table matrix; `migrations.test.ts` compares the full policy set and lists every key that lacks tenant_id.
- Migrations 0001, 0002, 0004, 0005, 0006 were edited in place (pre-release, as instructed); nmp_test and nmp_dev rebuilt with `--reset`.
- Verified: `pnpm vitest run packages/db` 76/76 (fewer, wider tests), `tsc -p packages/db --noEmit` clean. Mutation checks: a `USING (true)` policy on import_row_error fails 7 isolation tests; removing the blank context from withVendor/withSystem fails the pool test.

## B1 review fixes — 8 findings confirmed (2026-11-12)
- 0107: HIGH document takeover/swap (revoke UPDATE + trigger); HIGH forged sign-offs (actor binding, born-pending/open, approval must match object/decision/decider, case SoD); MEDIUM backdated money baseline (deferred chain walk); LOW UNIQUE (tenant_id,id) on case_event/case_evidence/webhook_delivery, webhook insert guard + outcome CHECK, withdraw reason, document reference race (advisory lock).
- Tests: +29 (approvals, b1-guards, catalogue pins); red without 0107. `pnpm vitest run packages apps/api`: 947 pass, 26 fail = same set as baseline (ops/seed/permissions/second-person, outside packages/db). typecheck clean.

## B1 DB package completion (2026-11-17)
- Schema 0100-0107 already in place and verified (all §1 tables FORCE RLS, all §1.4/1.5/1.7/1.8 functions present); no new migration needed.
- §3: permissions.test.ts pins B1 catalogue + matrix, 0007 = RELEASE_A_BASE_ROLES_SEED, 0106 = renderBaseRoleUpdate(B1_UPDATED_BASE_ROLES), 0007+0106 = BASE_ROLES. mfa.test /v1/me fixture gains market.signoff.
- §6 seed.ts: finance@ staff (Finance approver, approved grant), approvals written as admin2 via asSelf, DEMO market draft, `seedFixturePack` (owner pool, refuses if owner DB != app DB) on nmp_e2e only; seed:e2e passes MIGRATE_DATABASE_URL=nmp_e2e to the seed step (.env points it at nmp_dev).
- §P: config.ts D-B1-16 keys (+ retry base/max/give-up) with test in formats.test; db.ts `ApiKeyCaller`, `request.apiKey`, ActorType 'service_account', inTenant key branch (db.test.ts); ops tenant-creation inserts markets draft.
- Verified: `pnpm vitest run packages/db apps/api` 869/869, typecheck + web tsc clean, seed:e2e run OK.
- 2026-11-17 B1 review round 2: 0108 (actor binding, case submission/evidence integrity, money same-date supersede, webhook scheduled CHECK, pack-rule versions EXCLUDE) + 7 regression tests in b1-guards.test.ts. `pnpm vitest run packages apps/api` 1266/1266, typecheck clean.

## B2 schema (2026-11-17)
- Migrations 0200-0206 (19 tables, guards, shared SQL, base roles), permissions catalogue (+18, 6 privileged, B2_UPDATED_BASE_ROLES; B1 list removed), API_SCOPES +participants:write/orders:write, config D-B2-19 keys, settings registry (10 keys + approverPermission), seed STAFF support/dpo + seedFixtureMarket (nmp_e2e NL), support-session exclusions (PLAN 3, done here because the catalogue change exposed them).
- Verified on nmp_test_2: packages/db 174/174, apps/api 1309/1309, typecheck (api + web) clean.
