# Increment B1 — HANDOFF (2026-11-17)

Contract: `PLAN.md` (D-B1-01..19, §R, §1–§8, §P, §B). This file records what exists, what is open and what to do next. Facts come from the agent results of the B1 workflow and the full-suite run below; nothing here is inferred.

## 1. State
- **Scope built:** FR-TEN-002, FR-TEN-003, FR-TEN-004, FR-IAM-004, FR-IAM-006, FR-INT-001, FR-CPL-012 (built, tested, browser-verified); FR-CAS-001 (framework built and tested, **not mounted**, no production case types, D-B1-13). The 10 MVP-A LOW web defects (BUG-023, 025–029, 045–048) were verified fixed in the browser in B1 round 1.
- **Migrations:** 0100–0109 (`packages/db/migrations`). 0108 = review fixes (actor binding, case/evidence guards, money-key backstop, pack-rule EXCLUDE). 0109 = tenant-wide approvers (`approval_eligible_users(..., p_all_markets)`), from the security fix round. No applied migration was edited.
- **Database levels (checked 2026-11-17):** nmp_dev, nmp_e2e and nmp_test are at **0108**; 0109 is not applied there. nmp_test_6 was reset to 0109 for the run below.
- **Full suite (records step, nmp_test_6, `scripts/heavy.sh pnpm vitest run`):** 124 files: 123 passed, 1 failed; 2150 tests passed, 31 skipped (2181). The failed file is `apps/api/test/authz/role-matrix.test.ts`: its `beforeAll` (reset + seed) hit the 10 s hook timeout under full-suite load, which skipped its 31 tests. Re-run alone on the same slot: 31/31 passed in 2.3 s. `pnpm -s typecheck` and `tsc -p apps/web --noEmit`: clean. Treat the role-matrix hook timeout as an open flake (OI-6).
- **Browser:** two QA rounds (2026-11-17). Round 2 passed every B1 screen at 1440/1280/768/390 and the MVP-A regression; 0 API 5xx. Reports: `testing/UI_TESTING_REPORT.md` and `testing/VISUAL_REGRESSION_REPORT.md` ("Increment B1 — round 1/2"); evidence `var/qa-b1/`. Impeccable 14/16 (round 1: 11/16). A third round was not reported.

## 2. What exists
| Module | What | Where |
|---|---|---|
| TEN | Markets, brands, calendars + generated periods (structure snapshotted into settings versions, D-B1-02); settings timeline with rebase (D-B1-01); money-key change requests with Finance approval; launch checklist, go-live request and two-person sign-off with risk acceptance for screening-status mandatory rules | `apps/api/src/modules/ten` |
| PAY | Provider eligibility records only (no credentials, no adapter, D-B1-12) | `apps/api/src/modules/pay` |
| IAM | SoD primitive `recordApproval` / `eligibleApprovers` in `@nmp/db` (D-B1-03); service accounts and API keys (scopes, rate tiers, IP allow-list, rotate with grace, revoke, shown once); key authentication facade | `packages/db/src/approvals.ts`, `apps/api/src/modules/iam` |
| INT | Public read API for key callers, OpenAPI for the integration surface, webhook endpoints (sealed secrets, rotation grace), outbox dispatch with Standard Webhooks signatures, SSRF-safe egress, retry/backoff/dead | `apps/api/src/modules/int` |
| CPL | Pack rules with basis status (`guardrail_rule`, `tax_rule`: title, mandatory, source_ref, reviewed_by, `rule_key`); public snapshot reads by key | `apps/api/src/modules/cpl` |
| AUD | Evidence documents (upload once, reference once by the uploader, magic-byte check, SHA-256) | `apps/api/src/modules/aud` |
| CAS | Case tables, state machine, evidence, SoD decisions, events, type registry (`createCasModule`, `casModule`); not in `defaultModules` | `apps/api/src/modules/cas` |
| Web | SC-29 `/settings` (B part), `/settings/markets` (markets, brands, calendars), SC-17 `/settings/markets/[id]`, SC-13 `/settings/integrations` (API keys, webhooks) | `apps/web/src/app/(staff)/settings/**`, `features/{markets,integrations,admin/settings}` |
| Seed | finance@ Finance approver per tenant; DEMO market draft; e2e-only fixture pack `e2e-fixture` (one screening guardrail rule, one counsel_confirmed tax rule) | `apps/api/src/seed.ts` |

## 3. Contracts later increments rely on
- **Permissions:** `settings.approve`, `market.manage`, `market.signoff`, `integration.manage` (all privileged except `market.manage`); base roles updated in 0106.
- **Key callers:** `request.apiKey: ApiKeyCaller {keyId, tenantId, serviceAccountId, scopes, rateTier}`, `request.auth` null; `inTenant` runs them with `app.user_id = serviceAccountId`, actor type `service_account`. Key scopes are the only authority (D-B1-05). Minting/rotating a `compliance:read` key needs `compliance.read` for all markets (security fix).
- **Approvals:** a tenant-wide object (setting change request) is approved only by an all-markets holder (`p_all_markets`, 0109).
- **DB error codes (0108):** 42501 when an actor column is not the acting user (case submit/withdraw, evidence, case events, provider withdraw, service-account disable); 23514 evidence only while the case is open (→ 409 CASE_STATE_CONFLICT); 23514 case submission/content frozen after submit; 42501 approved setting change must name the version carrying its approval; deferred money guard 42501 at COMMIT; 23514/23P01 pack-rule id format and overlapping versions.
- **Config (D-B1-16):** `apiKeyRate{Standard,High}PerMinute`, `apiKeyMaxGraceMinutes`, `webhookTimeoutMs`, `webhookAllowedPorts`, `webhookRetry{Base,Max}Seconds`, `webhookGiveUpHours`, `evidenceMaxFileBytes`, `trustProxy` (`TRUST_PROXY`, default none).
- **Outbox topics subscribable in B1:** `compliance.snapshot.ready`, `market.went_live`, `case.decided`.

## 4. Open defects and issues
| ID | Sev | What | Owner / when |
|---|---|---|---|
| BUG-060 | LOW | SC-17 gate inspector: `break-all` splits "mandatory" mid-word (`gate-inspector.tsx:74`) | frontend, next web touch |
| SEC-B1-1 | HIGH | `integration.manage` with any market scope could mint a `compliance:read` key reading every market | security review 2026-11-17. Fix code and tests are in the tree (`iam/api-keys*.ts`, tests "minting or rotating a compliance:read key needs compliance.read for all markets", "a Tenant admin limited to one market cannot … mint a key"); no fix report reached this step — security to confirm and register |
| SEC-B1-2 | MEDIUM | Tenant-wide money settings approvable by a market-scoped approver | fix in tree: migration 0109 + `ten/change-requests.ts`; security to confirm and register |
| SEC-B1-3 | MEDIUM | No Fastify `trustProxy`: behind the Next `/v1` rewrite `request.ip` is the proxy, so `ip_allow` and the failed-lookup limiter see one address | fix in tree: `TRUST_PROXY` config + `app.ts`, test "without TRUST_PROXY the socket peer counts…"; `.env.example` lacks `TRUST_PROXY` (integrator) |
| SEC-B1-4 | LOW | A valid key used outside its `ip_allow` was never rate limited | fix in tree: test "a valid key used from outside its allow-list is limited per address…"; security to confirm |
| OI-1 | – | `webhook_delivery → outbox_event` FK has no ON DELETE: the planned outbox purge would be blocked by delivery history | decide with retention (V1/ops) |
| OI-2 | – | Key callers run as `app.user_id = service account id`: a future key write route inserting a `user_account` FK column (e.g. `created_by`) fails | B2 when write scopes arrive |
| OI-3 | – | Evidence-vs-submit race protection (`FOR SHARE`) is reasoned, not covered by a concurrency test | database, B2 when CAS mounts |
| OI-4 | – | 0109 not applied to nmp_dev / nmp_e2e / nmp_test | run `MIGRATE_DATABASE_URL=postgres://127.0.0.1:5432/<db> pnpm --filter @nmp/db migrate` for each |
| OI-5 | – | PLAN §0 D-B1-01..19 not yet copied into `ARCHITECTURE_DECISION_LOG.md` | orchestrator |
| OI-6 | – | `role-matrix.test.ts` `beforeAll` (resetApiDb + seedTenants) exceeds the 10 s hook timeout under full-suite load (passes alone in 2.3 s) | QA/integrator: give that hook an explicit timeout or lighten its seed |
| Notes | – | Rebased version reasons nest ("Rebased v10 onto v11: Rebased v8 …"); after go-live the checklist still shows "Needs risk acceptance 1" (accepted risk visible only in the go-live requests table); "Endpoints failing" counts a disabled endpoint; SC-13 "failed deliveries 24 h" KPI shown as "Endpoints failing" (no count route) | not registered; consider in B2 polish |

**Not exercised in the browser** (QA round 2): delivery `dead` after 72 h, withdrawing a change or go-live request, go-live rejection, calendar delete, brand rename/delete, key rate-limit 429, server-side half of BUG-055, `SCOPE_MISSING` (catalogue has one scope). Integration tests cover the API side of these.

## 5. Deferred (PLAN §8, unchanged)
Case types and SC-06/SC-08 UI (B2/B4/B5/B-MKT); automatic agreement/plan checklist checks, pack-specific items, market suspend (B2/B3/B-MKT/B6); calendar horizon top-up, period state transitions (B3); provider credentials/adapters (B4, sandbox only); visibility policy and write-off/min-payout/cooling-off/dispute settings (B2/B4/B5); key write scopes and CSRF exemption for bearer writes (B2); staff OpenAPI (B6); outbox/webhook/idempotency purge (V1/ops); India pack data (B-MKT); shared-store rate limiting (hosted); service-account role assignment and per-key pagination caps (B2); beneficiary/related-party SoD data (B2/B4); system/portal-opened cases (B4/B5); further rule kinds (B-MKT); further webhook topics (with their producers); SC-29 participant types (B2).

## 6. Next steps (in order)
1. Security agent: confirm the four SEC-B1 fixes against their repros, register them in `BUG_REGISTER.md` with status, and add `TRUST_PROXY` to `.env.example` (integrator).
2. Apply 0109 to nmp_dev, nmp_e2e and nmp_test (OI-4); fix the role-matrix hook timeout (OI-6) so the full suite is green in one run.
3. Fix BUG-060 (`gate-inspector.tsx`: break only the rule id, not the label) with a regression test.
4. Copy D-B1-01..19 into `ARCHITECTURE_DECISION_LOG.md` (OI-5).
5. Optional B1 round 3 browser pass for the not-exercised paths above (rate-limit 429, request withdraw/reject, calendar delete).
6. Start B2 (`engineering/workflows/mvpb-increment.js`, migrations 0200–0299): mount `casModule` with the first case types (genealogy change, duplicate, transfer), build SC-06/SC-08, resolve OI-2 before key write routes, add the evidence/submit concurrency test (OI-3).
