# Project Engineering Context (source of truth for engineers and agents)

Read this first, then only the `context/*.md` brief for your module. Do not re-read `product-documentation/` unless a brief is ambiguous; if it is, fix the brief.

## Product
A multi-tenant back end for direct-selling companies: "the compensation and compliance back end you can audit".
- **MVP-A** (rel A, 18 FRs): compliance-analytics overlay. A tenant uploads back-office exports (participants, orders, payout lines); the product validates, maps and loads them and computes indicator reports R1–R5 with populations, methods, snapshots and drill-down. Plus identity, tenancy, vendor console, support sessions, audit, breach contacts.
- **MVP-B** (rel B, 81 FRs): participants, bitemporal genealogy, order ingestion, configurable plan engine, runs, ledger, tax, payouts, cases, distributor portal, migration, reports. Increments B1–B6.
- **Never build** (X-01..X-24): income projections/earnings calculators, recruit leaderboards, wallets/e-pins/crypto/held funds, AI recruiting content, lead scoring, tenant-specific code, shipped default thresholds/rates (DEC-14). Storefront, LMS, GL are integrations.

## Briefs
| Brief | Use for |
|---|---|
| `context/ARCHITECTURE.md` | modules, call matrix, outbox, queues, NFR targets, ADRs |
| `context/DATABASE.md` | every table/column/constraint/RLS — write migrations from this |
| `context/SECURITY_IAM_TENANCY.md` | realms, sessions, MFA, permissions, roles, SoD, isolation, audit |
| `context/API.md` | conventions, 41 endpoints, adapters |
| `context/MVP_A_SPEC.md` | all rel-A requirements, formats, formulas, ACs, golden values |
| `context/ENGINE_GENEALOGY.md` · `context/MONEY.md` | MVP-B core |
| `context/UI_UX.md` | tokens, components, 47 screens |
| `context/QA.md` | test layers, TS-*, edge cases |
| `context/DECISIONS_AND_OPEN_QUESTIONS.md` | DEC/ADR/FD/OQ registers, refusals |
| `TRACEABILITY.md` | FR → stories, ACs, rules, screens, APIs, tables, status |

## Stack (confirmed for this build)
TypeScript · Node 26 · pnpm workspace · Fastify + zod · PostgreSQL 16 (RLS, ltree, btree_gist, citext, pgcrypto) via `pg` and SQL · forward-only SQL migrations · pg-boss · Redis · Next.js App Router · Vitest · Playwright MCP.

## Repository
```
apps/api/src/{server.ts, lib/, modules/<mod>/{routes.ts,service.ts,*.test.ts}}
apps/web/            Next.js (staff admin + vendor console; portal in B5)
packages/db/         migrations/NNNN_name.sql, migrate.ts, pool.ts (withTenant, withVendor), testing.ts
packages/compliance/ pure R1–R5
packages/engine/     (B) pure plan engine
engineering/         this folder
```

## Multi-tenancy (non-negotiable)
- Tenant id comes from the session only. Never from body, query or header.
- All tenant data access goes through `withTenant(tenantId, fn)`: one transaction, `SET LOCAL app.tenant_id`, `SET LOCAL app.user_id`.
- Every tenant-scoped table: `tenant_id uuid not null`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `USING` and `WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`.
- App connects as `nmp_app` (no BYPASSRLS, no DDL). Migrations run as the owner role. Vendor-realm code uses `withVendor` and can read only vendor tables and tenant metadata, never business data.
- A migration test fails if any table with a `tenant_id` column lacks a policy.

## AuthN / AuthZ
Realms: `tenant`, `vendor` (A), `portal` (B). Server-side sessions (opaque token, hashed at rest, HttpOnly cookie). argon2id passwords. TOTP MFA mandatory for privileged roles (SEC-03); forced enrolment blocks all pages (AC-35.1). Step-up for sensitive actions (SEC-20). Authorisation = permission strings checked by `requirePermission()` in the route, plus RLS as backstop. Role grants of privileged roles need a second admin (SEC-27). `approval` rows carry `CHECK (approver_id <> preparer_id)`.

## Standards
- Money: `bigint` minor units. No `number` arithmetic, no floats, in any money or volume path. Percentages for display: integer math, round half up to 2 dp.
- Determinism in pure packages: no `Date.now()`, no randomness, stable sort keys.
- Every state change writes an `audit_event` in the same transaction. Financial and audit tables are append-only (no UPDATE/DELETE grants).
- API: `/v1`, envelope `{data, meta}` / `{error:{code,message,details}}`, cursor pagination, `Idempotency-Key` on creating POSTs, zod at every boundary.
- Modules own their tables; cross-module access via exported facade functions only (`modules/<m>/index.ts`). Boundary test enforces it.
- Files < 400 lines typical, functions < 50, early returns, immutable updates, named constants, no secrets in code, no `console.log`.
- Tests: unit for pure logic, integration against a real database for every route (including a cross-tenant denial case), browser workflow per module. 80 % coverage target.
- Conventional commits on feature branches. No push, no deploy.

## Naming
Tables and columns: snake_case singular (as DATABASE.md). TS: camelCase values, PascalCase types. Permissions: `noun.verb` (`import.manage`). Error codes: UPPER_SNAKE. IDs: uuid v7 where ordering helps, else `gen_random_uuid()`.

## Environment
Local PostgreSQL 16 on 5432 (superuser = OS user), Redis 6379. Databases: `nmp_dev`, `nmp_test`, `nmp_e2e`. Ports: api 4000, web 3100. Config by environment variables only (`.env.example`).

## Unresolved (see `ARCHITECTURE_DECISION_LOG.md` for provisional choices)
Permission catalogue and role matrix · numeric session/lockout/rate/export limits · vendor audit entity · IdP product · cloud/region · whether MVP-B proceeds before the gate.
