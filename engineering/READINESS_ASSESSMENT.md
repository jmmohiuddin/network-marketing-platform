# Engineering Readiness Assessment

Date: 2026-11-12 · Branch: `feat/mvp-a-foundation` · Author: orchestrator session

## 1. Repository and documentation assessment

| Item | Finding |
|---|---|
| Code | **None existed.** No frontend, backend, schema, tests or CI. Greenfield. |
| Git | Was not a repository. Initialised; docs committed on `main` (`982c42e`). |
| Docs | 51 Markdown documents, 42 wireframe SVGs, `spec.json` (122 FR, 58 US, 102 AC, 119 BR, 71 TS, 47 SC, 41 API, 75 tables), a calculation verifier (55/55 pass). Internally consistent by the docs' own audit. |
| Research | `RESEARCH/`, `research-completion/`; a working Python prototype of reports R1–R5 with synthetic data and golden output (`engineering/reference/phase_a/prototype`). |
| Digest | 10 verified implementation briefs in `engineering/context/` (8,112 lines). Engineers and agents read these, not the source docs. |

**The documentation gates its own build (GOV-04):**

| Scope | Docs' verdict | Engineering position |
|---|---|---|
| MVP-A — compliance-analytics overlay, 18 FRs | Buildable now | **Build first.** No requirement is hard-blocked. |
| MVP-B — genealogy, plan engine, ledger, payouts, portal, 81 FRs | Specified; "must not start" before demand evidence, provider/tax/counsel answers and a performance spike | Buildable as software against sandboxes. Starting it is a **founder decision** (E-ADR-07). Market values (tax rates, thresholds) stay configuration with no shipped defaults (DEC-14). |
| B-MKT (4 FRs), V1 (19 FRs) | Later | Not in this build. |

**Master-prompt modules the docs exclude** (docs win, per the prompt's own rule):
storefront/checkout/inventory, LMS/training, marketing, general CRM pipeline and lead scoring → "integrate or partner"; wallets, e-pins, crypto, income projections, recruit leaderboards, AI recruiting content → "not recommended" (X-01..X-24, BR-HON-01). AI assistant → V1/V2. CRM in scope is only customer servicing/attribution (FR-CRM-001, -002).

Gaps in the docs that engineering must fill provisionally (recorded in `ARCHITECTURE_DECISION_LOG.md`): no permission catalogue or full role matrix; no numeric session/lockout/rate-limit/export-cap values; no vendor audit entity; nullable `tenant_id` vs RLS on `role`/`user_account`; partition keys missing from some primary keys; only 11 of 41 endpoints fully specified.

## 2. Technology stack confirmation

Docs' recommendation (TRD-02, all "provisional") adopted, with two hardware-driven deviations marked ⚠.

| Layer | Choice | Note |
|---|---|---|
| Language | TypeScript end to end, Node 26, pnpm workspace | TRD-02 §3 |
| API | Fastify + zod schemas → OpenAPI; modular monolith, boundary test in CI | "NestJS-style" satisfied with fewer parts |
| Database | PostgreSQL 16 (local Homebrew instance), RLS, `ltree`, `btree_gist`, `citext`, `pgcrypto` — all available | ADR-17 |
| Data access | `pg` + SQL, one `withTenant()` transaction helper that does `SET LOCAL app.tenant_id`; app role without BYPASSRLS; separate migration role | no ORM: RLS and bitemporal SQL are clearer by hand |
| Migrations | Forward-only versioned SQL, tiny runner | TR-DEP |
| Queue / outbox | pg-boss (PostgreSQL-backed) | TRD-02 §5 |
| Cache | Redis (running locally) — rate limits only at first | |
| Web | Next.js (App Router, server-rendered), design tokens from UI-03 as CSS variables | TRD-02 §4 |
| Identity ⚠ | In-app auth behind an `IdentityProvider` interface: argon2id, TOTP, server-side sessions, three realms | Docs want a Keycloak-class IdP. It needs ~1 GB RAM and Docker (daemon unresponsive here). Swap is contained by the interface. E-ADR-02 |
| Audit store ⚠ | Separate schema + insert-only role, hash-chained | Hosted target is a separate database; docs allow schema for self-hosted (C13). E-ADR-05 |
| Money | `bigint` minor units; lint rule + test forbid `number` arithmetic in money code | TR-ENG-06, TS-67 |
| Tests | Vitest (unit + integration against a real test database), Playwright MCP for browser workflows | |

## 3. Engineering architecture summary

One codebase, three process types (api, general worker, calc worker — B). Modules own their tables; cross-module calls go through typed facades or the outbox; one transaction per use case. Tenant comes from the session, never from the client. Every tenant table has RLS `USING` + `WITH CHECK`. Audit event and outbox row are written in the same transaction as the state change. Pure packages with no I/O: `packages/compliance` (A), `packages/engine` (B).

```
apps/api        Fastify; src/modules/{iam,ten,ops,aud,imp,cpl,prv,int,...}
apps/web        Next.js: staff admin, vendor console, (B) distributor portal
packages/db     migrations/*.sql, runner, withTenant, test helpers
packages/compliance   R1–R5 pure functions (ported from the prototype, golden-tested)
packages/engine (B)   plan primitives, deterministic run
engineering/    context briefs, plans, registers, agent memory
```

Full detail: `context/ARCHITECTURE.md`, `context/SECURITY_IAM_TENANCY.md`.

## 4. Agent execution plan

| Phase | Orchestrator | Parallel agents |
|---|---|---|
| Foundation (schema, RLS, auth, audit, tenancy) | Writes it directly — shared contracts must not be parallelised | 1 reviewer (security, read-only) after |
| MVP-A modules | Integrates, runs tests | Backend: IMP · Backend: CPL (pure package) · then Frontend |
| Verification | Playwright MCP, one browser | QA agent writes tests; security agent audits isolation |
| MVP-B (if approved) | Contracts first per increment B1–B6 | Compensation/genealogy specialist + backend + frontend, max 2 heavy |

Each agent gets a task contract (objective, context brief paths, allowed/forbidden files, tests, done criteria) and reads/updates `agent-memory/<role>/`. See `AGENT_REGISTRY.md`.

## 5. Maximum safe concurrency (this machine)

Measured: Apple **M4** (the brief said M5), 10 cores, 16 GB, 31 % memory free at idle, heavy pageouts already; Claude app + two MCP daemons ≈ 1.6 GB.

| Activity | Limit |
|---|---|
| Coding subagents (API-side; local cost is their tool processes) | **2** |
| Extra light agent (review/research, no builds) | **1** |
| Processes running install / build / test suite | **1 at a time, system-wide** |
| Browsers | **1** (Playwright MCP, headless shell) |
| Dev servers | api + web only; no duplicate instances; Next dev stopped during test runs if free memory < 20 % |

Docker stays off (saves 1–2 GB). Drop to 1 coding agent whenever `memory_pressure` reports < 20 % free.

## 6. Agent memory implementation

Created: `engineering/agent-memory/{backend,frontend,database,compensation,qa,security}/` with the files the brief specifies, plus `MASTER_PROJECT_MEMORY.md`, `AGENT_REGISTRY.md`, `TASK_REGISTRY.md`, `ARCHITECTURE_DECISION_LOG.md`. Rule: read before a task, append after; hand-offs are written there. Claude's native project memory holds only cross-session user preferences.

## 7. MCP and plugin availability

| Need | Available | Use |
|---|---|---|
| Browser E2E | **Playwright MCP** (`mcp__playwright__*`), Chromium installed; chrome-devtools MCP; built-in browser pane | Playwright MCP is primary |
| Library docs | context7 (connected instance) | API verification |
| Database | Prisma-Local MCP (not needed — no Prisma); `psql` | psql |
| Git/GitHub | git CLI, `gh`, GitHub MCP | local git only; nothing pushed |
| Review/security | ecc reviewers, pr-review-toolkit, claude-security, sonarqube skills | code + security review agents |
| Design | Figma MCP, Stitch | not needed: wireframes and tokens are in the docs |
| Task tracking | taskmaster-ai, ruflo | not used: repo-file registers are the single source |
| Failed / unavailable | ruflo-core (timeout), davinci-resolve, palmier-pro, Docker daemon (hung) | none required |

**Nothing needs installing beyond npm packages.** Missing by design: Keycloak, MinIO, OpenTelemetry backend (production concerns; see risk register).

## 8. Playwright testing setup

1. Dedicated database `nmp_e2e`, seeded by script: vendor operator, two tenants (A, B) with admin / compliance officer / analyst users, the synthetic export.
2. api on :4000, web on :3100 (5000/7000/3599 are taken on this machine).
3. One Playwright MCP browser session; workflows per module as it lands: sign-in + forced MFA enrolment → vendor provisions tenant → role grant with second-admin approval → upload/validate/map/load import → reports R1–R5 with drill-down → snapshot → audit log → support session request/approve → cross-tenant denial.
4. Console and network inspected on every flow; defects go to `BUG_REGISTER.md` with steps.
5. Roles from the master prompt that are MVP-B (finance approver, distributor) are tested when those modules exist; "sales manager / team leader / customer" logins are not in the documented product.

## 9. Module dependency and implementation sequence

See `MODULE_DEPENDENCY_MAP.md` and `IMPLEMENTATION_MASTER_PLAN.md`.

```
A:  db+RLS → IAM → TEN/OPS → AUD → IMP → CPL(R1–R5) → PRV-004 → web screens → E2E
B1: settings versions, SoD, API keys, cases, public API, outbox dispatch
B2: participants → positions/bitemporal genealogy → orders/returns/attribution
B3: plans/versions/primitives → calendars/runs/commit/replay → guardrails
B4: ledger → tax profile → payouts/reconciliation → adjustments
B5: distributor portal, statements, disputes, privacy
B6: plan change governance, migration/parallel run, dashboards, export
```

## 10. Development risk register

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Building MVP-B before the docs' evidence gate wastes effort or bakes in guessed tax/provider behaviour | H | H | Founder confirms scope; market values are config only; providers are sandbox adapters |
| R2 | Scope (99 FRs for A+B, 70 tables, 43 screens) exceeds one session | Certain | M | Increments end in tested, committed states; handoff file kept current |
| R3 | In-app auth instead of an OIDC IdP | M | H | Interface boundary; argon2id/TOTP from maintained libraries; security review; swap before production |
| R4 | Cross-tenant leak | L | Critical | RLS on every table + policy-coverage test + generated isolation suite (TS-21) before any module builds on the foundation |
| R5 | Engine performance unproven (2M-node tree, NFR-PERF-05) | M | H | Spike benchmark is the first B3 task; engine is an isolated package |
| R6 | Float arithmetic on money | L | Critical | bigint minor units, lint, static test TS-67 |
| R7 | Docs gaps filled by engineering (permission matrix, limits) drift from intent | M | M | Every provisional choice logged with the doc ID it fills |
| R8 | Memory pressure on 16 GB | M | M | §5 limits; no Docker; one build at a time |
| R9 | No legal/tax confirmation for India pack | Certain | H (for go-live) | Pack not built; not a software blocker for A |
| R10 | Node 26 is very new; library incompatibilities | M | L | Pin versions; fall back to an LTS via nvm if a native module fails |

## Decision needed from you

**Should the build continue past MVP-A into MVP-B (engine, ledger, payouts) ahead of the evidence gate your own documentation sets?** Work proceeds on MVP-A either way; all MVP-A code is reused by MVP-B.
