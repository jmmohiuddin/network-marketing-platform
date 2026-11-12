# security — MEMORY

_Agent: security. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## T-A07b identity hardening (2026-11-12): what exists
- Migration `0040_identity_hardening.sql` (security owns 0040-0049; 0041+ unused). Adds `app_user_id()` (NULL when unset).
- support_session `vendor_request` WITH CHECK binds `requester_id = app_user_id()` (BUG-001; 0011 trigger covers other realms).
- password_credential / mfa_credential: policy `acting_user` = `user_id = app_user_id()` AND user row visible in the realm (BUG-002). Any code writing credentials must run with app.user_id = that user (sign-in reads hashes via auth_find_user; invitation accept runs asUser; seed.ts `asSelf` switches app.user_id inside its tx).
- session (BUG-003): nmp_app has UPDATE on (last_seen_at, revoked_at) only. Trigger `session_identity_pinned` for every role (owner too): id, token_hash, user_id, tenant_id, realm, created_at fixed; expires_at only earlier; revoked_at set once. Assurance only via SECURITY DEFINER `auth_elevate_session(p_session_id, p_new_token_hash) -> (session_id, session_expires_at)`: acting user's own live session in its own realm/tenant, else 42501. With a token hash: old row revoked, NEW row (aal2, keeps created_at/expires_at/ip/user_agent). NULL hash = step-up, needs aal2 already.
- BUG-004: auth_find_session needs user active + tenant not archived; SECURITY DEFINER trigger fn `revoke_sessions_of_closed_account` on user_account (state <> 'active') and tenant (state = 'archived').
- API: lib/session.ts `elevateSession(tx, sessionId, rotate)` (42501 -> 401 UNAUTHENTICATED) replaced rotateSessionToken; deactivateUser no longer revokes sessions itself; resolveAuth no longer writes AUTH.SESSION_REVOKED (closed accounts never resolve).
- Seed: SEED_PASSWORD only for nmp_dev/nmp_e2e (assertSeedable(env, db, fixedPassword)); vendor otpauth printed in development or with SEED_PASSWORD; tenant users get no MFA. `pnpm --filter @nmp/api seed:e2e` RESETS nmp_e2e (db reset) then seeds as nmp_app with NODE_ENV=test, SEED_PASSWORD=E2e-Local-Only-Pa55; verified 9 accounts, only vendor has a factor.
- Regression tests: packages/db/test/{support-session,auth,session-integrity}.test.ts, apps/api/test/app.test.ts (BUG-004), iam/mfa.test.ts (ended session -> 401). Full repo 474 tests green twice in a row, tsc clean. Also fixed a pre-existing order-dependent flake: test helper resetApiDb now truncates pgboss.job (resetTestDb leaves the pgboss schema; a job left queued by ops.test made the next run count 2 sends).

## Review fixes after T-A07b (2026-11-12): what exists
- Migration `0041_session_open_hardening.sql`: REVOKE INSERT ON session FROM nmp_app; SECURITY DEFINER `auth_open_session(p_token_hash bytea, p_minutes int, p_ip inet, p_user_agent text) -> (session_id, session_expires_at)`: AAL1, no factor/step-up, user = app_user_id() (active, realm = app_realm(), tenant = app_tenant_id() unless vendor), 1..720 min else 22023; not acting user -> 42501. `session_guard` also refuses a future last_seen_at (only when changed).
- API: lib/session.ts `insertSession(tx, {absoluteMinutes, ip, userAgent})` calls auth_open_session (user/realm/tenant from the tx context; sign-in runs asUser). config: SESSION_ABSOLUTE_MINUTES max 720 (E-ADR-27).
- Tests that need sessions as nmp_app use packages/db/test/support.ts `openSession(tx, minutes?, tokenHash?)`; raw session INSERTs only via the owner (references.test.ts FK cases now run as owner; apps/api test helpers already used the owner).
- seed.ts: `assertSeedable(env, {database, serverAddress}, fixedPassword)`; seed() reads `host(inet_server_addr())`; only NULL (socket) or loopback accepted (BUG-008).
- IAM: `RoleGrant.validTo`; `holdsWithin(auth, permissions, marketIds, validTo)` counts only grants lasting until validTo; grantRole sends self-grants to the request path (BUG-009). Support-session pseudo-grant carries validTo = support_session.ends_at.
- Full suite 986 tests green; tsc -b clean.
