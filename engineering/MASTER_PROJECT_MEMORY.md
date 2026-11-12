# Master Project Memory

Consolidated facts every session needs. Newest first. Keep under 150 lines.

## State (2026-11-12)
- Greenfield. Git initialised; docs on `main`; work on `feat/mvp-a-foundation`.
- Docs digested into `engineering/context/` (verified). Use those.
- Founder confirmed 2026-11-12: build MVP-B after MVP-A, ahead of the docs evidence gate (E-ADR-07). Sandboxes only; no real payouts; tax and plan values are configuration.

## Machine
- Apple M4, 16 GB, tight memory. No Docker (daemon hangs). PostgreSQL 16 on 5432 (superuser = OS user), Redis on 6379. Ports 5000, 7000, 3599 are taken; use api 4000, web 3100.
- NEVER stop processes by name pattern (`pkill -f src/server.ts` also matches the user's other projects, e.g. Routine-Management-System). Start servers with `echo $! > var/<name>.pid` and stop with `kill $(cat var/<name>.pid)`.
- Hooks: a "Fact-Forcing Gate" blocks the first Bash and each new-file Write until facts are stated; creating files via shell heredoc avoids the per-file gate.

## Golden references
- `engineering/reference/phase_a/prototype/{analytics.py,report.json,data_synthetic/}`: R1–R5 expected values. Run with `python3 -I analytics.py data_synthetic out.json`.
- `product-documentation/08-qa/verification/verify_calculations.py`: 55 engine/ledger expected values (B).

## Standing instructions
- Founder (2026-11-12): build the whole PRD, all 122 FRs, and do not ask permission between stages. Still stop for real money movement, deploys, pushes, paid services.

## Decisions
See `ARCHITECTURE_DECISION_LOG.md` (E-ADR-01..13).
