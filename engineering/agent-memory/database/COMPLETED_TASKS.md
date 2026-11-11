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
