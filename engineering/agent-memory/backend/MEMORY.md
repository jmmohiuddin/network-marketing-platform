# backend — MEMORY

_Agent: backend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._

## State after T-A02/T-A03/T-A04 + API foundation (2026-11-12)
- `apps/api`: Fastify 5 app with modules iam, ten, aud; 139 tests after review fixes R1 (`pnpm vitest run apps/api`), tsc clean.
- Migrations owned: 0007_iam_api.sql (base roles, role_grant_request, user_invitation, auth_find_invitation, system_tenant_ids), 0008_job_queue.sql (pg-boss 10.4 schema v24). 0009 unused.
- `tsc -p apps/api --noEmit` reads the d.ts of referenced projects: after changing packages/db or packages/compliance source run `pnpm exec tsc -b packages/db packages/compliance` first (dist is gitignored).

## How to write a module (contract other agents rely on)
- `src/modules/<m>/index.ts` exports `<m>Module: ApiModule = { name, register(app), jobs? }` and any facade functions. Add it to `src/modules/index.ts`. Other modules import ONLY `modules/<m>/index.ts` (test/boundaries.test.ts); lib never imports modules.
- Route guards (preHandler): `requireRealm('tenant')`, `requirePermission(...perms)` (all required), `requireStepUp(maxAgeSec?)`, `requireAuth()`. Assert forms: `currentAuth(request)`, `assertStepUp(request)`, `hasPermission`, `marketScope(auth, perm)` (null = all markets).
- DB: `inTenant(request, tx => ...)` (tenant from session), `inVendor`, `inOwnRealm`; jobs/system: `runInTenant(ctx, actor, fn)`, `SYSTEM_ACTOR_ID`.
- Body/query: `parse(zodSchema, value)` -> 400 VALIDATION_FAILED; use `z.strictObject` on writes. Respond `envelope(data, meta)`; errors `throw new ApiError(status, CODE, message, details)`.
- Creating POST: `inTenant(request, tx => idempotent(tx, request, async () => ({ statusCode, body })))`, then `return sendIdempotent(reply, result)`. Never put a one-time secret in body: it is stored for replays.
- Every state change: `recordAudit(tx, { action: 'DOMAIN.VERB', objectType, objectId, before, after, reason })` in the same tx; events/alerts `enqueueOutbox(tx, { type, payload, key? })`; exports `recordExport(tx, { kind, filters, rowCount, rowCap: app.config.exportRowCap })`.
- Lists: `pageQuery` fields, `decodeCursor(cursor, schema)`, fetch limit+1, `toPage(rows, limit, keyOf)`.
- Settings facade (`modules/ten/index.ts`): `getSetting(tx, key)`, `getEffectiveSettings(tx, at?)`; keys `compliance.active_pv_minor`, `compliance.rank_thresholds_pv_minor`, `compliance.late_order_day`, `compliance.personal_share_flag`, `privacy.breach_contacts`. No defaults: unset = null.
- Jobs: `defineTenantJob({ name, payload: zod, run(tx, payload, ctx) })`, ctx = `{ jobId, log, config }`; `enqueue(tx, job, payload)` inside a tenant tx (tenant read from the tx), list the job in `ApiModule.jobs`; server.ts starts workers (`startWorkers({ config, log, jobs })`). Tests run queued jobs with `runQueuedJobs(job)` (helpers).
- Mail: `sendMail(config.mailDir, { to, subject, text })` (lib/mailer.ts) writes .eml files; send only from jobs, last step before commit. Tests: `mailsTo(address)`, `invitationToken(mail)`; testConfig points MAIL_DIR at a tmp dir.
- Lockout: `reserveAttempt(tx, config, key, ip)` in a withSystem tx before any slow credential check, `recordSuccess(key, ip)` after; never count-then-check.
- Serialising check-then-act: `SELECT pg_advisory_xact_lock(hashtextextended('<topic>:' || app_tenant_id(), 0))` as the first statement (see admins.ts).
- Tests: `import { buildTestApp, call, closePoolsAfterAll, resetApiDb, createTenant, createSignedInUser, createMarket, baseRoleId, totpCode, ownerRows, auditActions } from '<rel>/test/helpers/index.js'`. `resetApiDb()` (truncate + reseed base roles) in beforeAll; `createSignedInUser({ tenantId, roles: ['Tenant admin'], mfa?, stepUp?, marketIds? })` returns a caller for `call(app, { method, url, as, body, idempotencyKey: true })`. Every route: one cross-tenant 404/no-rows test and one missing-permission 403 test. Helpers also: `sessionFrom(response)` (cookie set by sign-in/MFA), `call(..., { remoteAddress })`.

## Contracts changed by review fixes R1 (2026-11-12)
- POST /v1/users -> 201 `{ data: { user } }`; POST /v1/users/:id/invitation -> 202 `{ data: { user } }`. No token in any response; the invitee gets `${WEB_URL}/invitation#token=<token>` by mail (web accept page must read the fragment and POST /v1/auth/invitations/accept).
- MFA verification (sign-in) and enrolment confirmation rotate the session token: the response sets a new nmp_session cookie, the old token is dead. Step-up keeps the token.
- Sign-in/vendor sign-in: 429 RATE_LIMITED (+ Retry-After) per IP and per tenant:email; accept-invitation per IP only. Config SIGN_IN_RATE_LIMIT_PER_MINUTE applies to each counter.
- New env: NODE_ENV required (no default), COOKIE_SECURE (default true), MAIL_DIR (default var/mail), WEB_URL (default http://127.0.0.1:3100).
- New error codes: GRANT_EXPIRED (422). Removed: IDEMPOTENCY_REQUEST_IN_PROGRESS (could never occur).
- New audit actions: USER.INVITATION_SENT, AUTH.SESSION_EXPIRED (actor system); AUTH.MFA_FAILED after = { purpose, reason: invalid_code | locked }. AUTH.SESSION_REVOKED removed in T-A07b (closed accounts never resolve; 0040 triggers revoke).
- `auditInRealm(tx, realm, event)` now lives in lib/audit.ts.

## State after T-A08/T-A09 IMP module (2026-11-12)
- `apps/api/src/modules/imp/`: `createImpModule({ uploadDir?, maxFileBytes? })` and `impModule` (env UPLOAD_DIR default var/uploads, IMPORT_MAX_FILE_BYTES default 10 MiB (was 50), parsed with zod at register). NOT yet in `modules/index.ts` defaultModules (core owns that file).
- Migration owned: 0020_import_api.sql (import_batch.files/source_values/report/data_quality jsonb, import_row_error.seq identity, import_batch_guard lifecycle trigger); 0021+0022 withdrawn pair; 0023-0029 unused.
- 34 tests in modules/imp (validate unit, imports, mappings, load); full `pnpm vitest run apps/api` 223/223, tsc clean.
- Routes: POST /v1/imports (multipart: market, period_from, period_to YYYY-MM; files participants, orders, payout_lines; Idempotency-Key) -> 201 batch validated|rejected (sync validation); GET /v1/imports (?state, cursor), GET /v1/imports/:id, GET /v1/imports/:id/errors (cursor = seq), GET /v1/imports/:id/source-values, POST /v1/imports/:id/mapping {mapping_id}, POST /v1/imports/:id/load -> {data: batch, meta: {superseded}}; GET /v1/import-mappings (ETag latest), GET /v1/import-mappings/:id, PUT /v1/import-mappings {mappings, notes?} + If-Match "<latest>"/"0" -> 201 draft, POST /v1/import-mappings/:id/approve {reason?} (mapping.approve + step-up, author != approver).
- Facade (modules/imp/index.ts): `loadedBatches(tx, marketId, fromDate, toDate)` -> [{id, mappingId, mappingVersion, periodFrom, periodTo}] (state loaded, period overlap).
- Test fixtures: modules/imp/test-support.ts (`upload`, `multipartBody`, `syntheticFiles`, `SYNTHETIC_MAPPING`, `tinyFiles`, `TINY_MAPPING`, `ORDERS_HEADER`, `LINES_HEADER`, `recordBreachContact`, `approvedMappingId`).
- After review R1: migrations 0021 (approval trigger) + 0022 (drops it) are a withdrawn pair; 0023-0029 unused. New contracts: 409 IMPORT_PERIOD_OVERLAP {batch_ids}; 429 IMPORT_BUSY (+ Retry-After) on POST /v1/imports and /load; files.<f>.stored_sha256; source_values.starter_kits; mapping `starter_kits` (optional); IMPORT_MAX_FILE_BYTES default 10 MiB; test hook `acquireImportSlot()` (import-gate.ts). 45 imp tests.

## State after T-A05/T-A06/T-A12 (ops, support, prv) (2026-11-12)
- Modules `opsModule` (ops), `supportModule` (support), `prvModule` (prv): in defaultModules since review R2. Migrations owned: 0010, 0011 (0012-0019 unused).
- Import graph: ops -> support, prv; prv -> support, ten. support imports no module.
- support/index.ts exports (vendor plumbing other modules may use):
  - `inVendorThenTenant(request, vendorPart(tx) => {tenantId,...}, tenantPart(tx, v))`: ONE tx, vendor realm first, then `set_config(app.realm='tenant', app.tenant_id)` for the tenant part, actor stays the vendor user (vendor_user). Use for vendor actions that must hit both audit logs atomically; tenantId must come from a row the vendor part read/wrote.
  - `lockTenant(tx, id)` (vendor realm, FOR UPDATE, 404), `TenantRow`.
  - `vendorIdempotency(request)` -> {key, hash}; `assertSameRequest(storedHash, idem)`: vendor creating POSTs keep key+hash on the created row (unique per creator); replay returns the CURRENT resource with Idempotent-Replayed: true via lib `sendIdempotent`.
  - `registerSupportSessionAccess(app)` (app.ts calls it right after resolveAuth: onRequest in-session hook + onError refusal logger) + `SUPPORT_SESSION_HEADER` ('x-support-session'). `enterTenant(tx, tenantId)` is support-internal.
- prv/index.ts: `assertBreachContactRecorded(tx)` -> 422 BREACH_CONTACT_REQUIRED (same code imp uses), `breachContacts(tx)` (tenant tx).
- In-session contract: vendor sends `X-Support-Session: <id>`; while the session is approved|active, inside [starts_at, ends_at), requested by that vendor user and MFA verified, request.auth becomes {realm 'tenant', tenantId, supportSessionId, roles [{name 'Support session', permissions = scope.permissions, marketIds null}], stepUpAt null}. GET/HEAD only. The hook re-checks the session under FOR UPDATE in the tenant tx, first use approved -> active (SUPPORT_SESSION.STARTED), then SUPPORT_SESSION.ACCESSED {method, route, params, query}. lib/db.ts inTenant re-checks the session (FOR SHARE) in every handler tx -> 403 SUPPORT_SESSION_INACTIVE. Handler audit events are actor_type vendor_user (actorOf). Refusals: hook 403 SUPPORT_SESSION_INACTIVE / SUPPORT_SESSION_READ_ONLY and any in-session 401/403 of a route -> SUPPORT_SESSION.ACCESS_REFUSED {.., refusal: code} in vendor + tenant log; a vendor without session refused REALM_FORBIDDEN -> vendor log only, refusal NO_SESSION (E-ADR-22).
- support_session.scope = { permissions: Permission[] (catalogue minus participant.unmask), requester_region: string | null } (region = user_account.work_region of the requester, E-ADR-24). Request body `{tenant, reason, scope: {permissions}, minutes (1..480)}` (no region: 400 if sent); decision body `{approved, minutes (required if approved, <= requested), region_approved, reason?}`. POST /v1/tenants/:id/approve needs Idempotency-Key (replay -> 200 current tenant, Idempotent-Replayed).
- buildApp/buildTestApp always install the hook: in-session tests just mount the tenant module (support/access.test.ts). Vendor test users need `UPDATE user_account SET work_region = 'eu'` to be in an 'eu' tenant's region.
- Audit actions added: TENANT.CREATED, TENANT.PROVISIONING_APPROVED, TENANT.WENT_LIVE (vendor + tenant logs), SUPPORT_SESSION.{REQUESTED, APPROVED, DENIED, STARTED, ACCESSED, ACCESS_REFUSED, ENDED, EXPIRED, AUTO_DENIED}, BREACH_CONTACTS.READ. Outbox topics: support_session.requested, support_session.decided, support_session.ended, support_session.closed.
- Error codes added: 409 SLUG_TAKEN, TENANT_STATE_INVALID, SUPPORT_SESSION_NOT_OPEN; 422 REGION_UNAVAILABLE, TIER_NOT_AVAILABLE, TENANT_NOT_AVAILABLE, TENANT_HAS_NO_ADMIN, SUPPORT_SESSION_DURATION_INVALID, SUPPORT_SCOPE_NOT_HELD, REGION_APPROVAL_REQUIRED, SUPPORT_REQUEST_EXPIRED, BREACH_CONTACT_REQUIRED; 403 SUPPORT_SESSION_INACTIVE, SUPPORT_SESSION_READ_ONLY. Reused REQUEST_ALREADY_DECIDED, SOD_SELF_APPROVAL, IDEMPOTENCY_KEY_*.

## Security changes T-A07b (2026-11-12) that bind backend code (details: agent-memory/security/MEMORY.md)
- Credentials (password_credential, mfa_credential) are visible only with app.user_id = their user. Session columns: nmp_app may UPDATE last_seen_at and revoked_at only; MFA elevation = `elevateSession(tx, sessionId, rotate)` in lib/session.ts (sign-in/enrolment verification creates a NEW session row: the session id changes with the cookie). Closing a user or archiving a tenant revokes sessions in the database.

## Contracts after BUG-006/007 + web contract (2026-11-12)
- Grants: approving needs the approver's user.manage markets to cover the request (NULL only from an all-markets admin); a privileged role also needs `holdsWithin(approver, role.permissions, markets, valid_to)`. Revoke/deactivate: caller's user.manage markets cover the target's assignment(s), privileged target -> step-up. Refusal 403 SCOPE_NOT_HELD. `coversMarkets(auth, marketLists)` + `StepUpCheck` in iam/grants.ts; routes pass `() => assertStepUp(request)`.
- GET /v1/markets (tenant realm, no permission) -> [{id, code, name, currency}] by code. name = `marketName(code)` (ten facade: Intl English region name of the ISO code, the code itself otherwise; no name column exists).
- Snapshots: `market: {id, code, name}` beside market_id (SNAPSHOT_COLUMNS selects market_code by subquery).
- Drill rows meta: `sums {<col>_minor: bigint string}` over the whole set; `component {key, expected_minor} | null` where key is the sums key that must equal the set's component (meta.set says numerator/denominator), null when the component is a row count (R4, counts, R5 mean denominator). Mapping COMPONENT_COLUMN in cpl/drill.ts. Order rows have `net_minor` (= amount - refunded; R1's measure).
- GET /v1/me: always `support_session` (null outside a session); in session `{id, tenant_slug, ends_at, scope}` and `user` = the vendor user read with runInVendor. support/index exports `getSupportSession`.
- GET /v1/support-sessions/limits (vendor) -> {max_minutes, scopes}; GET /v1/imports/limits (import.manage) -> {max_file_bytes}.
- iam/index exports `invitationLink(webUrl, slug, token)` (ops first-admin mail uses it).


## Contracts after browser-defect fixes BUG-010..014, 019 (2026-11-12) — web builds against these
- Migration owned: 0042_vendor_user_management.sql (0043-0049 unused). Run `pnpm --filter @nmp/db reset` (test) / migrate nmp_dev, nmp_e2e before QA.
- Grants (E-ADR-28): approver needs user.manage over the request's markets until its valid_to, not the role's permissions (Tenant admin approves Compliance officer/Finance approver). Revoke/deactivate leaving one active admin -> 422 SECOND_ADMIN_REQUIRED (none -> LAST_ADMIN): web should show the message (revoke/deactivate dialogs).
- POST /v1/tenants: optional `second_admin: {email, display_name|null}` (must differ from first_admin, 400 otherwise); both invited, both granted Tenant admin at approval. Tenant log TENANT.CREATED after has `first_admin_ids` (array). First-admin mail: "You are an administrator of <tenant>".
- Vendor users (E-ADR-29, vendor realm): GET /v1/vendor-users (cursor = email) -> [{id, email, display_name, state, mfa_enrolled, last_sign_in_at, created_at, created_by}]; POST /v1/vendor-users {email, display_name?} step-up + Idempotency-Key -> 201 {data:{user}} (409 EMAIL_TAKEN); POST /v1/vendor-users/:id/invitation -> 202 {data:{user}} (409 USER_NOT_INVITED); POST /v1/vendor-users/:id/deactivate step-up -> 200 user (422 LAST_VENDOR_USER). Vendor invitation link `${WEB_URL}/invitation?realm=vendor#token=<t>`: same POST /v1/auth/invitations/accept; web then links to /signin/vendor; first vendor sign-in -> next_step mfa_enrolment.
- GET /v1/vendor-audit-events (vendor realm): same query (actor_id, action, object_type, object_id, from, to, cursor, limit) and event shape as GET /v1/audit-events, over audit.vendor_event.
- In-session log: SUPPORT_SESSION.ACCESSED is written by an onSend hook after the route answers, only when not 401/403; after = {method, route, params, query, status}. A refused request has ACCESS_REFUSED only. The current request's ACCESSED is not visible in its own response.
- CPL population_count = @nmp/compliance `Figure.populationCount` (count of the set the population text names). R4 of_which_refunded_later population text changed to "Late threshold crossings of the month (an order counts once for each threshold it crosses)".
- support/access.ts exports `logSessionAccess` (onSend); iam/invitations.ts exports `issueInvitation` (works in the vendor realm: app_tenant_id() NULL).

## Contracts after BUG-031 (2026-11-12) — web builds against these
- POST /v1/vendor-users now creates a PENDING invitation: no mail, user.invitation_status 'pending_approval'. Vendor user view adds `invitation_status` ('pending_approval'|'approved'|'rejected'|null for bootstrap users), `invitation_decided_by`, `invitation_decided_at`.
- POST /v1/vendor-users/:id/approve and /reject (vendor realm, step-up, Idempotency-Key, no body) -> 200 {data:{user}} (replay: Idempotent-Replayed). Approve mails the invitation; reject deactivates. Errors: 422 SOD_SELF_APPROVAL (inviter), 403 APPROVER_NOT_INDEPENDENT, 409 REQUEST_ALREADY_DECIDED. POST /v1/vendor-users/:id/invitation before approval -> 409 INVITATION_NOT_APPROVED.
- Tenant approve and go-live: 422 SOD_SELF_APPROVAL (creator) / 403 APPROVER_NOT_INDEPENDENT, details {action, initiator_id}. Go-live is now second-person: the tenant's creator cannot go live (seeded tenants, created_by NULL, unaffected); tenant.went_live_by recorded.
- iam/index exports `assertSecondPerson(tx, {actorId, initiatorId, action})` and `loggingSecondPersonRefusals(request, {objectType, objectId}, fn)` (route wrapper: logs SECOND_PERSON.REFUSED {action, initiator_id, refusal} in its own vendor tx). Any new vendor second-person action must use both. Also exports `bootstrapVendorUser`, `acceptInvitation`.
- New vendor audit actions: USER.INVITATION_APPROVED, USER.INVITATION_REJECTED, USER.BOOTSTRAPPED, SECOND_PERSON.REFUSED. USER.INVITATION_SENT is now written by the approver.
- Seed: operator@ and operator2@vendor.example (both MFA, independent). Test helper `signInExisting(user, stepUp?)` opens a verified session for an existing user. `pnpm --filter @nmp/api create-vendor-user --email ...`.

## Contracts after BUG-031 review fixes (2026-11-12) — web builds against these
- POST /v1/tenants/:id/go-live now needs step-up (403 STEP_UP_REQUIRED): the web Go-live action must run the step-up prompt first.
- Vendor Idempotency-Key hash includes the route: reusing a key across approve/reject (or any two vendor routes) -> 422 IDEMPOTENCY_KEY_REUSED.
- A rejected/deactivated vendor email can be invited again via POST /v1/vendor-users (new user id; the closed row stays in the list). 409 EMAIL_TAKEN only while a non-deactivated vendor user has the address. GET /v1/vendor-users is ordered by (email, id); the cursor is still opaque.
- 403 APPROVER_NOT_INDEPENDENT also covers the whole invitation line (migration 0044); message text changed.
- create-vendor-user CLI: refuses (unless --i-understand + NMP_ALLOW_VENDOR_BOOTSTRAP=yes) any database that is not local nmp_dev/test/e2e; refuses when 2 usable vendor users already exist. `BootstrapVendorUser` input now needs `operator: {osUser, host}`.
