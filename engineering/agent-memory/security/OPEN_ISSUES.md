# security — OPEN_ISSUES

_Agent: security. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 automated commit review of 0006
BUG-001..004 (MEDIUM, all confirmed present). Deferred until stage 2 lands because the core API agent is writing against these tables; fix as migration 0040 + API adjustments + regression tests (task T-A07b).

## After T-A07b (2026-11-12)
- BUG-001..004 fixed (0040); BUG-005 not reproducible (fixed in IAM R1). BUG-006/007 (approver scope, revoke/deactivate scope + step-up) are open, owned by IAM after stage 3.
- Residual: session INSERT is not bound to app.user_id (a code-path bug could still insert a session for another user of the same tenant/realm). Sign-in already runs asUser, so a policy/trigger `user_id = app_user_id()` on INSERT would fit; references.test.ts inserts foreign-user sessions to test FKs and would need its assertions adjusted.
- auth_elevate_session trusts the caller checked the TOTP (the sealed secret cannot be opened in SQL); it only narrows what a bug can do (own live session, aal2, now()).
- SECURITY DEFINER functions (all auth_*, revoke_sessions_of_closed_account) rely on the owner role bypassing RLS (local owner = superuser). Under a non-superuser owner with FORCE RLS, system-realm lookups and the archival revocation would see no rows. Decide before any hosted deployment (owner BYPASSRLS, or set realm context inside the functions).
- Revocations done by the 0040 triggers are not audited per session (the closing change is: USER.DEACTIVATED; TENANT.ARCHIVED once archival exists in V1).
- Leaving 'active' for 'locked' also revokes sessions (nothing sets 'locked' yet).

## After review fixes (2026-11-12)
- BUG-003 residual (session INSERT not bound to app.user_id) is closed by 0041. nmp_dev and nmp_e2e need `pnpm db:migrate` / `seed:e2e` (reset) to get 0041 — sign-in calls auth_open_session.
- Seed host check cannot see through a tunnel that forwards loopback to a remote server.
- holdsWithin ignores future-dated grants (loadGrants loads only valid_from <= now) — conservative.
- Still open: BUG-006/007 (IAM), SECURITY DEFINER under a non-superuser owner, per-session revocation audit.

## 2026-11-12 (backend agent)
- BUG-006/007 fixed in IAM (403 SCOPE_NOT_HELD; step-up for privileged removals; LAST_ADMIN kept). Removal has no second-admin control.
- Session INSERT binding re-checked: 0041 already binds it (nmp_app has no INSERT; auth_open_session uses app_user_id()). Nothing added.

