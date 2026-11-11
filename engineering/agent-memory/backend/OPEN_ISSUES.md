# backend — OPEN_ISSUES

_Agent: backend. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._

## From API foundation, T-A02..T-A04 (2026-11-12)
- Needs product/orchestrator confirmation: BR-SEC-05 dual-control reading; Tenant admin cannot export the audit log (matrix shows ● on Audit log); envelope and 422 IDEMPOTENCY_KEY_REUSED differ from API.md (RFC 9457, 409 IDEMPOTENCY_CONFLICT) — update API.md or the code.
- Vendor realm has no roles or permissions (role_assignment.tenant_id is NOT NULL): vendor routes must guard with requireRealm('vendor'); vendor POSTs cannot use idempotent() (idempotency_key.tenant_id NOT NULL). Owner: T-A05.
- Support sessions (T-A06): AuthContext.supportSessionId is always null and inTenant requires auth.tenantId. T-A06 must extend resolveAuth to give a vendor caller tenantId + supportSessionId + read-only scope (actor_type 'vendor_user' is already set by inTenant).
- Not built: admin-assisted lost-device MFA reset (needs second approver), role edit/delete, SoD role-combination checks (B), breached-password list (SEC-23), per-role export caps, approval for money-affecting settings (B), outbox dispatcher (no delivery in A).
- AC-53.1 (no breach contact -> no go-live / first load) is for TEN/IMP: check `getSetting(tx, 'privacy.breach_contacts')`.
- Rate limits are per process (in memory); request.ip has no trustProxy (behind a proxy all clients share one IP).
- Residual timing oracle: a failed sign-in for an existing account also writes its audit event (a few ms more than an unknown account).
- Fixed in R1 for the granter. Still open: the second admin who approves a pending grant is not checked against its market scope or permissions (BR-SEC-05 reading; product to confirm).
- pgboss tables have no RLS; job data carries tenant ids: keep payloads to ids.
- E-ADR-10 values (session, lockout, export cap) are env config, not tenant settings (MVP_A C-1 suggested settings).
- Environment: `.env` SECRET_ENCRYPTION_KEY=change-me makes server and seed fail fast; set `openssl rand -base64 32`. nmp_dev needs `pnpm db:migrate` (0007, 0008); nmp_e2e needs `--reset`. Dev seed: `NODE_ENV=development pnpm seed` (refuses any database but nmp_dev/nmp_test/nmp_e2e).
- Suggest E-ADR entries for: invitation tokens, BR-SEC-05 dual control, pg-boss via migration, enqueue-in-transaction, audit ref encoding.

## From review fixes R1 (2026-11-12)
- Mail is a local file drop (MAIL_DIR); an SMTP transport (TR-CON-11) is needed before any hosted use, together with E-ADR-02 reversal. `.env.example` (not owned here) should document MAIL_DIR, WEB_URL, COOKIE_SECURE (set false only if a browser refuses Secure cookies on http://127.0.0.1) and that NODE_ENV is required.
- Web (owner: frontend): accept page at `${WEB_URL}/invitation` reading `#token=`; after MFA verification the browser gets a new cookie (automatic). The accept page does not show the inviter (no lookup endpoint); the mail names the inviter.
- Suggest E-ADR entries: login_attempt as system-realm audit exception; local mail drop; token-in-mail-only invitations.
- Rate limits stay per process (in memory); per-account limiter LRU holds 5000 keys per process.
- A queued invitation job that fails after the mail file was written but before commit leaves a dead link in the mail; the retry sends a fresh one.

## From T-A08/T-A09 IMP (2026-11-12)
- Core (reviewer MEDIUM, confirmed, not owned by backend/imp): add `impModule` to `defaultModules` in modules/index.ts; move UPLOAD_DIR and IMPORT_MAX_FILE_BYTES into config.ts/.env.example (imp parses them itself; relative UPLOAD_DIR now resolves against apps/api).
- Orphan-reference tolerance (OQ-A3, AC-39.3) has no setting: tolerance is 0. TEN owner to add a key (e.g. `import.orphan_tolerance`) and IMP to read it.
- Missing `day` blocks the batch (order_date NOT NULL); C-13 wants late-crossing omitted instead. Needs a `day_known` column on cpl_fact_order (CPL table) or a product decision.
- Pseudonymity check is only "no '@'" (now on every id copied into facts); content-based detection is OQ-30.
- Stored upload files are never deleted after load/supersede (no retention rule); rejected uploads are never written.
- At most 10,000 findings stored per batch (spec says every finding); no CSV download of the error report yet (SC-24 "Download error report").
- API-01 is synchronous (201) instead of 202 + async job. Mitigated (per-process gate, 10 MiB default); still blocks the event loop ~0.8 s per 10 MiB file and buffers files (toBuffer). A pg-boss job in the API process would not fix the block: real fix = validation/load in a separate worker process + streaming to the FileStore (infra/core decision). Fact inserts bind one array per column per table (no chunking).
- nmp_dev and nmp_e2e not migrated to 0020. Migration numbering: 0010 and 0030 (other agents) exist; 0020 applied between them on a fresh reset.
- CPL reads import_batch directly (cpl_loaded_batch_ids, snapshots.ts) instead of the `loadedBatches` facade; same rule (state loaded, period overlap). CPL's 0031 also owns AC-40.1 (trigger on import_mapping INSERT) and guards fact inserts (batch must be 'mapped'): a database-level IMP/CPL contract.
- A stored projection still has no retention/deletion rule after load or supersede (now pseudonymous columns only).
- Existing nmp_test batches validated before R1 have no stored_sha256 and cannot be loaded (test data only).

## From T-A05/T-A06/T-A12 ops, support, prv (2026-11-12)
- Fixed in R2: global hook, actorOf, defaultModules (ops/support/prv). Still open: GET /v1/me for a vendor in session (realm tenant, vendor user id) is undefined; impModule/cpl not in defaultModules (their owners).
- IAM: export an invitation facade (e.g. `inviteUser`/`sendInvitationJob` + a first-admin creator) so ops stops writing user_account/role_assignment/user_invitation directly (shortcut comments in ops/tenant-creation.ts, ops/first-admin-invitation.ts).
- LIB: lib/idempotency.ts could take a store so vendor routes reuse it (support/vendor-idempotency.ts repeats canonical hashing).
- TEN: no keys yet for per-market breach notification timelines (BR-DAT-07, FR-PRV-004), tenant max support-session minutes, request expiry; DPO cannot read privacy.breach_contacts (readPermissions = settings.manage only).
- Not built: affected-subject report (FR-PRV-004 Out; format is OQ-A10), named write actions in support scope (always read-only), market-pack maintenance (B-MKT), tenant archive (V1), DPA document upload (dpa_document_id unverified), dedicated tier (no DB creation), mail notification of tenant admins on requests (outbox only), requester identity shown to the tenant (tenant realm cannot read vendor users; tenant sees requester_id + reason).
- Vendor ops roles are undefined: every MFA-verified vendor user can provision, approve (not own), go live and request sessions; only the requester ends a session (no supervisor end).
- No API sets user_account.work_region (0011): vendor users have NULL = every request needs explicit region approval until ops records it (seed.ts does not set it).
- In-session vendors may request scope vendor_access.decide (read the tenant's session list); consider excluding it from scopePermission.
- A vendor sending X-Support-Session to a vendor-only route is switched into the tenant realm and refused REALM_FORBIDDEN (logged as an in-session refusal).
- nmp_dev / nmp_e2e not migrated to 0011.
- Region catalogue and pooled-only tier are constants in ops/tenant-creation.ts (OQ-A8/OQ-19).
- nmp_dev / nmp_e2e not migrated to 0010.
