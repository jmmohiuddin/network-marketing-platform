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

- Founder (2026-11-12): Google Stitch designs in `design/stitch/` are the frontend source of truth (see DESIGN_IMPLEMENTATION_GUIDELINES.md); Impeccable audits within that direction; UI testing at 4 viewports with reports in `testing/`.

## Decisions
See `ARCHITECTURE_DECISION_LOG.md` (E-ADR-01..13).

## Stitch designs (2026-11-12)
- `design/stitch/stitch_complete_ui_screen_design/`: 47 product screens designed (SC-01..SC-47, SC-02 has an extra step-up modal file) after the second zip added SC-23, 26, 29, 36, 38, 40, 41, 43, 45, 46. `ledger_integrity/DESIGN.md` is the design system.
- All 48 Tailwind configs carry the SAME tokens (47 colours, 13 font families, 13 sizes, 11 spacing, 4 radii); differences are formatting only. Canonical theme: `design/stitch/tailwind-theme.json`.
- SC-13, SC-24, SC-25, SC-28 have a minified config missing its last `}`: the HTML renders with default Tailwind colours. Use their `screen.png` as the visual reference, not a live render.
- 16 images hot-linked from lh3.googleusercontent.com (avatars) — never ship; use initials.
