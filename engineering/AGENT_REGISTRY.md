# Agent Registry

Concurrency policy (16 GB machine): max 2 heavy coding agents + 1 light (review/QA/research). Only ONE process may run builds, the test suite or a browser at a time. Reduce to 1 coding agent when `memory_pressure` free < 20 %.

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
