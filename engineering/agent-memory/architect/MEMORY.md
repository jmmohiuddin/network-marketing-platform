# architect — MEMORY

_Agent: principal architect (increment plans). Read before planning an increment; keep concise._

## B1 plan (2026-11-12) — engineering/increments/B1/PLAN.md
- Packages: DB (migrations 0100-0199 + `@nmp/db` approvals primitive + permissions.ts + seed.ts) → BE1 iam+int+cpl+support, BE2 ten+pay, BE3 cas+aud → W1 settings/markets (SC-29, markets page, SC-17), W2 polish + SC-13.
- Parallel backend packages must not import each other's TS: cross-package contracts are SQL functions or FKs built by the DB agent first (SoD primitive in @nmp/db, `market_pack_rules`, `document_references`, `approval_eligible_users`). Repeat this pattern in B2+.
- Decisions D-B1-01..16 (settings timeline rebase, structure in settings versions, SoD in @nmp/db, documents by id, service accounts, secret-free idempotent replays, sealed webhook secrets, Standard Webhooks headers, SSRF rules, TEN owns calendar/period until B3, PAY provider eligibility, no case types in B1, pack-rule columns, platform checklist, engineering limits) — copy to ARCHITECTURE_DECISION_LOG in records.
- Existing code facts: idempotency replay of a different body = 422 IDEMPOTENCY_KEY_REUSED (not 409); navigation model lives in iam/me-routes.ts; provisioned markets are `live`; market grants already include INSERT/UPDATE/DELETE (0006); outbox events had no dispatcher before B1.
- Workflow facts: pipeline runs up to 2 agents at once, so package order gives no sequencing; testing/visual/screens.json must have one owner per increment.
- B1 review fixes (2026-11-12): added D-B1-17 (provisioned markets `draft`, insert guard for nmp_app; owner exempt), D-B1-18 (bearer requests skip global IP limiter), D-B1-19 (actor type `service_account`, `API_KEY.READ` audit). Platform tables still need ENABLE+FORCE RLS (read-only policy) — migrations.test invariant. New SQL contracts: `market_references`, `brand_references`, `document_summary`, `assert_document_referenceable` (single-use, uploader-only evidence). CAS exported but not mounted until B2. minor_unit from pinned ISO 4217 table, never Intl/CLDR.
- Lesson: always name an owner for shared files a package needs before the integrator runs (config.ts, lib/db.ts, lib/web-security.ts, web lib/*.ts) and check existing invariant tests (migrations.test, support scope enum, format.ts labels) before declaring schema/permission changes.
