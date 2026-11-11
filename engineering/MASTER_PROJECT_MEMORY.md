# Master Project Memory

Consolidated facts every session needs. Newest first. Keep under 150 lines.

## State (2026-11-12)
- Greenfield. Git initialised; docs on `main`; work on `feat/mvp-a-foundation`.
- Docs digested into `engineering/context/` (verified). Use those.
- Docs gate MVP-B behind business evidence; founder confirmation pending (E-ADR-07).

## Machine
- Apple M4, 16 GB, tight memory. No Docker (daemon hangs). PostgreSQL 16 on 5432 (superuser = OS user), Redis on 6379. Ports 5000, 7000, 3599 are taken; use api 4000, web 3100.
- Hooks: a "Fact-Forcing Gate" blocks the first Bash and each new-file Write until facts are stated; creating files via shell heredoc avoids the per-file gate.

## Golden references
- `engineering/reference/phase_a/prototype/{analytics.py,report.json,data_synthetic/}`: R1–R5 expected values. Run with `python3 -I analytics.py data_synthetic out.json`.
- `product-documentation/08-qa/verification/verify_calculations.py`: 55 engine/ledger expected values (B).

## Decisions
See `ARCHITECTURE_DECISION_LOG.md` (E-ADR-01..13).
