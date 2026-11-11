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
