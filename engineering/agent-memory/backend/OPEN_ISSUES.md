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
- Fixed in R2: global hook, actorOf, defaultModules (ops/support/prv). GET /v1/me in session fixed 2026-11-12.
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

## From BUG-006/007 + web contract (2026-11-12)
- Product to confirm: approving an approver/admin role needs the approver to hold the role's permissions, so a Tenant admin cannot approve Compliance officer or Finance approver grants on their own (seeded owner holds every role). Removals have no dual control (only scope + step-up).
- Market names are English ISO region names derived from the code; codes that are not ISO (only direct inserts/tests) are named by the code.
- Drill `component.key` = sums key (documented for the web); frontend must not read it as 'numerator'/'denominator'.
- Web tests/typecheck were failing on in-flight frontend edits (`marketLabel` missing in features/data/format.ts) when the full suite ran; API side green.


## From BUG-010..014, 019 (2026-11-12)
- Web (owner frontend): vendor users screen and vendor audit log screen (UI_UX `/audit`), provisioning form `second_admin`, invitation page `?realm=vendor` -> /signin/vendor, show SECOND_ADMIN_REQUIRED in revoke/deactivate dialogs.
- A tenant provisioned with only one admin still cannot approve privileged grants (no second admin can be made). Product decision: require `second_admin`, or a vendor-assisted bootstrap.
- With exactly two admins, a hostile second admin cannot be removed (SECOND_ADMIN_REQUIRED) and need not approve a third: needs a break-glass/vendor path.
- Admin count ignores market scope: two admins scoped to different markets count as two although neither can approve the other's all-markets grants.
- Vendor invitation mail is sent inside the request transaction (no vendor job runner); commit failure after send = dead link. work_region still has no API (vendor-user invite could take it; region catalogue lives in ops).
- One person controlling two vendor accounts (invited by themselves) defeats two-person provisioning; only the vendor log shows who invited whom.
- Old CPL snapshots keep their previous population_count until recomputed. nmp_dev / nmp_e2e not migrated to 0042.

## From B1 BE1 (2026-11-17)
- Integrator: register `intModule` in modules/index.ts; add API_KEY_*, WEBHOOK_* to .env.example; workers pick the int job up from defaultModules.
- Integrator: lib/web-security.ts registerRateLimit allowList for `Authorization: Bearer nmpk_` (D-B1-18) — until then bearer requests also count against ip:<ip>, so a high-tier key cannot exceed API_RATE_LIMIT_PER_MINUTE.
- Integrator: test/isolation/seed.ts SUPPORT_SCOPE must drop settings.approve, market.signoff, integration.manage (use `supportScopePermission.options`); isolation cases + role matrix for the new routes.
- Not built: per-key pagination caps (deferred B2); OpenAPI validated structurally only (no validator dependency).

## From B1 BE2 ten-pay (2026-11-17)
- Integrator: add `payModule` to modules/index.ts; isolation cases + role matrix for every new TEN/PAY route; role-matrix SETTING_READERS needs the 3 new keys (tsc error until then).
- Period extension (POST /v1/calendars/:id/periods) does not append a structure version (structure holds calendars, not periods).
- Country validation = Intl region name minus user-assigned/EU/EZ/UN codes; exceptionally reserved codes CLDR names (IC, EA, TA...) are accepted.
- Immediate settings writes are refused while now() lies in a committed period (only possible with owner-pool fixtures in B1).
- (B1 review) Undecryptable webhook secret: delivery stays scheduled and is re-claimed each lease, never dead-lettered. Needs a 01xx migration (DB owner) adding 'SECRET_UNAVAILABLE' to webhook_delivery.error CHECK; then catch `open()` in dispatch attempt() and return that error.
- (B1 review) int/test-tls.ts (self-signed cert + key, test-only) sits in src; move to apps/api/test/helpers (integrator-owned). PLAN §2.7 table should read PATCH webhook endpoint = step-up for url / re-enable.

## From B1 integration (2026-11-17)
- CAS: POST /v1/cases parses the body before the create-permission check, so a caller without any create permission gets 400 for a bad body (role-matrix probe sends a valid body). Schema only, nothing tenant-specific leaks.
- Still open for DB owner/BE1: SECRET_UNAVAILABLE in webhook_delivery.error CHECK; IAM assertMarkets FOR KEY SHARE; PLAN decision on market-scoped authority over tenant-wide objects; PLAN §2.7 PATCH step-up text and D-B1-18 wording.
- (2026-11-17) Root `.env.example` (not owned) should document TRUST_PROXY (e.g. `loopback` when the web app proxies /v1). Not verified that Next's rewrite proxy sets X-Forwarded-For (needs servers running).

## From B2 BE1 (2026-11-17)
- Integrator: mount parModule, crmModule, createCasModule({types:[...genCaseTypes, ...parCaseTypes]}) in modules/index.ts; openapi key paths from publicParticipantSchemas/publicServicingSchemas.
- Integrator: test/isolation/seed.ts line ~197 records an `agreement_versions` checklist entry -> now 422 ITEM_NOT_RECORDABLE; publish an agreement version instead (POST /v1/documents class=agreement + POST /v1/agreement-versions by a Compliance officer). Isolation cases + role matrix rows for every B2 BE1 route.
- int/connectors, openapi, webhooks tests failing on nmp_test_2 while BE3 is in flight (not BE1 code).
- Pre-existing: ten/change-requests.ts listChangeRequests uses Promise.all on one tx client (pg deprecation warning).

## From B2 GEN review fixes (2026-11-17)
- DB agent: add `path_model.valid_until` (next valid_from/valid_to > now() at build) + list it in gen_stale_models, then drop the per-read relationship scan in gen/read-model.ts STATE_SQL (shortcut comment there).
- GEN scope (fixed 2026-11-17 for transfer: to_participant outside the filer's create markets = 422 PARTICIPANT_NOT_FOUND). genealogy_change/correction leave proposed_parent unscoped under D-B2-21 (sponsor chains cross markets): architect to confirm.
- Architect sign-off needed (GEN deviations from PLAN): (a) §2.5 reinstating a terminated position needs participant.terminate + step-up (PLAN gives participant.manage for all but `terminated`; positions.test asserts Support 403); (b) §2.4 correction valid_from may also equal the start of a non-superseded future row (E-GEN-04 cancel a pending change) — copy into PLAN §2.4.
- DB agent (optional): AFTER INSERT on position upserting path_model stale for both kinds, then drop the position.created_at scan in gen/read-model.ts STATE_SQL.
- Decision recorded: reinstating a terminated position is the reversal of a termination -> participant.terminate + step-up (FR-PAR-005). Role matrix: Support agent can no longer change a terminated position.

## From B2 API integrator (2026-11-17)
- POST /v1/connectors/:id/webhooks answers a known id without signature 401 SIGNATURE_INVALID, an unknown id 404 (PLAN 2.6): an existence answer for whoever holds the UUID. Isolation case documents it (`unsignedAnswer`); decide whether unknown ids should also be 401.
- int/test-support.ts still repeats ord/test-support.ts fixtures (boundaries.test forbids cross-module test-support imports); moving them into apps/api/test/helpers not done.
- Open from packages, not integrator scope: DB 0208+ (case decision guard vs 'updated' contributors; position insert marks path_model stale; path_model.valid_until), GEN validateCreate ignores market scope (decision), PLAN §2.4/§2.5 deviations need sign-off, resolveSponsor concurrency test, ten/change-requests Promise.all on one client.
- Resolved by the integrator: module mounting, openapi PAR/CRM paths, agreement_versions seed, B2 isolation cases + role-matrix rows, ord/ten requireAnyPermission/scopeOfAny copies, TRUST_PROXY + D-B2-19 in .env.example, role-matrix hook timeout (OI-6).

## From B2 backend-lead check (2026-11-17)
- Resolved: imp/access requireAnyPermission/scopeForAny copies removed; ten/change-requests Promise.all on one client.
- Still open (not backend-lead scope): web format.ts lists SIGNAL_MATCH as a user reason code (frontend); DuplicatePreview could show matched_participant (frontend); DB 0208+ items (position insert marks path_model stale, path_model.valid_until, par_create_customer created flag, case decision guard vs 'updated' actors); PLAN §2.4/§2.5 GEN deviations need architect sign-off; int/test-support repeats ord fixtures; unknown connector id answers 404 vs 401 (decision).

## From B3 BE3 b2-carryover (2026-11-18)
- Integrator: test/isolation/seed.ts must stop PUT genealogy.placement_width (now 422 SETTING_RETIRED) and stop recording a plan_variant entry (automatic now, ITEM_NOT_RECORDABLE): insert a plan covering the market with an active version (width 2) through the owner pool instead. isolation + role-matrix suites fail in seed until then.
- Web (W2): enrol dialog and genealogy case page read GET /v1/settings/genealogy.placement_width; the width now comes from the plan version (no API exposes placement_width_for yet); evidence-forms.tsx still offers a plan_variant note.
- Reparent shortcut: placement children keep their leg (a taken leg refuses the termination 409 GEN_SLOT_TAKEN); a root's children stay under it. Confirm with architect if a plan uses placement re-parenting.
- PLN (BE1) must validate structural rule params with the shapes in ten/plan-structure.ts (else GEN/PAR readers 500 on a bad stored rule).

## B3 BE1 (2026-11-18)
- Integrator: mount plnModule in modules/index.ts; isolation cases + role-matrix probes for every PLN route and the 3 /v1/guardrail-decisions routes; int/topics.ts WEBHOOK_TOPICS needs plan.version.activated (BE2).
- S-1: engine OOM at 500k/2M with a 4 GB heap (~16 KB per position) -> E-ADR-34/35 re-evaluation in the records phase (traces and JS input objects dominate).
- Deviations: SoD refusal list keeps the existing {user_id, display_name, email} shape; override justification length -> 422 VALIDATION_FAILED (shape errors stay 400); expression consts are minor units; renderRule shows minor units raw (no currency digits known).

## From B3 BE2 runs (2026-11-18)
- HIGH (BE1, packages/engine/src/json.ts): stringifyEngineJson is O(n²) — the replacer adds array indexes to the key list. Fix: in the first pass add the key only when the holder is not an array (`function (key, item) { if (!Array.isArray(this)) keys.add(key) ... }`). Blocks snapshot store at 100k positions (S-2 e2e not measured at 100k).
- Integrator: mount compModule; createCasModule types += compCaseTypes; isolation cases + role-matrix probes for the 17 COMP routes; isolation seed rows of §6 (run, snapshot, lines, state, origin, simulation, restatement).
- Not covered by COMP tests: CSV 50,000-row refusal (needs 50k lines), TS-03 affected_committed_periods flag (GEN), order_line tax (no column: amount_ex_tax = amount, shortcut), amount-only refunds and renewal_failed carry no volume reversal (shortcut).

## From B3 BE2 review fixes (2026-11-18)
- Simulation on a committed period still uses settingsVersionAt(now) instead of the baseline run's settings_version_id (D-B3-15 deviation): fixing it needs comp_simulation_source (0302) to return the baseline run's version too, i.e. a new migration; deferred to avoid a 03xx number clash during the parallel review round.
- marketSync: an index on sales_order (tenant_id, market_id, source_system) would make the API-source probe O(sources); per-period preflight (plan_version_for_period x2 + previousPeriod) in GET /v1/periods is still per row. int syncHealth's DISTINCT over inbound_event scans the tenant's events.
- Restatement items arriving after a restatement was submitted are never consumed (DB guard allows consumption of adjust items only); they stay origin_skipped until another restatement covers them.
- Sandbox holds the market periods lock exclusively during the synchronous sandbox calculation: late detection and commits of that market wait for it.
- PLAN §0.1 says "positions of the market"; snapshot keeps all positions (D-B2-21), state rows per market only: architect to record as deviation.


## From B4 BE1 engine-and-controls (2026-11-18)
- Integrator: isolation cases + role-matrix probes for GET/POST /v1/users/:id/related-participants and POST /v1/users/:id/related-participants/:rid/withdraw (Tenant admin only; user.manage all markets). Isolation/role-matrix tests fail until added.
- S-1 target (2M in 4 GB) not met: largest passing 750k. E-ADR-35 revision (8 GB worker, ~1.2M) and the streaming output API (D-B4-22 additive, COMP adoption) are architect decisions.
- W2: guardrail outstanding reason `compliance_review_required` needs words in features/plans/ui.tsx; ack button must hide whenever outstanding reason = `compliance_review_required` (outcome may be `warned` on a pre-B4 row; 409 COMPLIANCE_REVIEW_REQUIRED); PATCH version now returns `validation`.
- W2 contract (review fix): case LIST shows `approvals_required: null` for open cases (no hook per row); single-case views (detail, create, assign, PATCH) show the hook's answer while open, or null when the hook refuses (e.g. adjustment period committed); submit re-runs it and refuses with the real error.
- DB agent (CPL review LOW, latent): guardrail evaluation dedupe unique index (0300: plan_version_id, rule_id, content_sha256, md5(detail::text)) has no outcome, so a warned evaluation (opaque or not) acknowledged before its rule's outcome changes to blocked stays satisfied; re-evaluation cannot store the blocked row. Fix: 04xx migration adding `outcome` to the index + `ON CONFLICT` target in cpl/guardrails.ts storeEvaluation (BE1 one-line follow-up) + test (warned opaque acked, rule -> blocked, save again, submit 409 GUARDRAIL_OUTSTANDING). No rows on nmp_dev/nmp_e2e. Opaque rows FIXED in 0411 (review keys on the rule's current outcome; override allowed); still open for NON-opaque warned rows acked before their rule turned blocked.

## B4 BE3 (2026-11-18) — for the integrator
- modules/index.ts: add `taxModule` to defaultModules; add `...payCaseTypes` to caseTypes. INT already registers the provider webhook.
- Isolation cases + role-matrix probes for the new routes: PATCH /v1/provider-configs/:id; PUT /v1/provider-configs/:id/adapter; POST/GET /v1/payout-batches; GET /v1/payout-batches/:id, /lines, /instructions; POST /v1/payout-batches/:id/submit, /approve, /cancel, /retry-failed, /bank-file; POST /v1/payout-providers/:id/settlement-reports (text/csv); POST /v1/webhooks/providers/:providerConfigId (signed, unsignedAnswer 401/404); GET /v1/payout-reconciliation/summary, /items; GET /v1/payout-exceptions; POST /v1/payout-exceptions/:id/resolve; GET/POST /v1/payees/:id/holds; POST /v1/payout-holds/:id/release; GET /v1/payouts/dormant; POST /v1/participants/:id/bank-detail-requests; GET /v1/participants/:id/bank-details; GET/PUT /v1/participants/:id/tax-profile; POST /v1/participants/:id/tax-profile/unmask. OpenAPI paths too.
- GET /v1/provider-configs readers now include integration.manage, integration.read, payout.read (Commission analyst holds integration.read and now reads them).

## B4 BE2 (2026-11-18)
- Integrator: mount ledModule + ledCaseTypes; isolation cases + role-matrix probes for GET /v1/ledger/summary, /accounts, /accounts/:id/postings, /entries, /entries/:id, /receivables, /gl-mappings, PUT /v1/ledger/gl-mappings/:marketId/:accountType, POST+GET /v1/ledger/journal-exports, GET /v1/ledger/journal-exports/:id/file (key 'ledger:export' too), GET /v1/payees/:id/balances; lib/exports recordExport must set requested_by only for actor type user (key-created export currently fails the FK/CHECK) + key-create test.
- BE1/CAS: two-approval flow untested end to end for adjustment/write_off (hooks unit-tested); CAS create outside scope answers 422 SUBJECT_NOT_FOUND (AC-FIN4-3 wants 403 SCOPE_NOT_HELD).
- T-B4-29 (late item of a Paid period consumed) has the code change but no test (needs a Paid period fixture from PAY).

## B4 BE3 review fixes (2026-11-18)
- Architect (PLAN gap, not built): bank_detail case has no excludedApprovers (a staff member related to the payee can approve the payee's account change) and payout approve does not exclude users related to a line's payee (D-B4-10 covers adjustment/write_off only).
- Known limit (shortcut comment in settlement.ts): a provider event arriving while an ambiguous submit left provider_ref NULL becomes an unknown_reference exception and is not re-applied when the status query later learns the reference.
- OpenAPI: PAY/TAX routes are session-only, so they are not in /v1/openapi.json (the document lists key-accessible paths); payout.* webhook topics are already in WEBHOOK_TOPICS.
- Integrator: ledModule + ledCaseTypes still unmounted; their isolation cases/probes are needed when mounted.
- W1/W2 (B4 review): case `approvals_required` is `1|2|null` everywhere — null on every open row of GET /v1/cases and on an open case whose hook refuses; the open single-case value is advisory for the reader (PLAN §2). Related-party withdraw of a declaration about the caller -> 422 SOD_SELF_APPROVAL (show the message); withdraw takes no Idempotency-Key (PLAN §2 exception).
