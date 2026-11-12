# Agent Registry

Concurrency policy (revised 2026-11-12 after measurement: 16 GB, swap 7.3/8 GB used, CPU load ~3 of 10 cores — RAM is the limit, not CPU or agents):
- Up to **7 agents at once** (raised 2026-11-13 at the founder's request; 67 % memory free at the time) (agents run on the API; local cost is the commands they run).
- Each agent gets a private test database slot `nmp_test_1..6` via `NMP_TEST_DB` (vitest.config.ts); `nmp_test` is for the main session only.
- Heavy commands (test suite, typecheck, benchmarks) go through `scripts/heavy.sh` — 2 machine-wide slots.
- `next build` only via `scripts/next-build.sh` — 1 at a time.
- 1 browser (Playwright MCP) and 1 API+web pair on ports 4000/3100 with nmp_e2e at a time.
- Drop to 2 agents if `memory_pressure` reports < 20 % free. Quitting Docker Desktop (not needed here) frees ~2–4 GB.

| Agent | Owns (may modify) | Must not modify | Memory |
|---|---|---|---|
| Orchestrator (main session) | `engineering/*.md`, root config, `packages/db/migrations` ordering, integration, merges | — | `MASTER_PROJECT_MEMORY.md` |
| Backend | `apps/api/src/modules/<assigned>` | other modules, migrations already applied, `apps/web` | `agent-memory/backend/` |
| Frontend | `apps/web` | `apps/api`, `packages/db` | `agent-memory/frontend/` |
| Database | `packages/db` | app code | `agent-memory/database/` |
| Compensation & Genealogy | `packages/engine`, `apps/api/src/modules/{gen,pln,comp}` | ledger/payout modules | `agent-memory/compensation/` |
| QA | `tests/`, `apps/*/test`, `e2e/` | production code (report bugs to `BUG_REGISTER.md`) | `agent-memory/qa/` |
| Security & Review | read-only; writes `agent-memory/security/*`, `BUG_REGISTER.md` | all code | `agent-memory/security/` |

Task contract given to every agent: objective · source context files (`engineering/context/*`) · allowed files · forbidden files · dependencies · standards (`PROJECT_ENGINEERING_CONTEXT.md` §Standards) · tests required · deliverables · completion criteria. Hand-offs are written into the agent's memory files, never left only in conversation.
