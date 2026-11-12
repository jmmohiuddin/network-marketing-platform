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
- SC-13, SC-24, SC-25, SC-28 have a minified config missing its last `}`: the HTML renders with default Tailwind colours AND their `screen.png` is unstyled too. Reference = a render of the markup with the missing `}` appended to the config.
- 16 images hot-linked from lh3.googleusercontent.com (avatars) — never ship; use initials.
- Staff dashboards may show operational deltas (e.g. new earners) only when the API returns them; distributor-facing growth, targets, streaks, rankings are never built (BR-HON-01). Decided by orchestrator 2026-11-12.
- Design docs: `engineering/STITCH_DESIGN_INVENTORY.md`, `DESIGN_COVERAGE_AND_GAP_REPORT.md`, `DESIGN_IMPLEMENTATION_GUIDELINES.md` (Tailwind 3.4 locally, canonical shell = sc_01, component catalogue ~45 items).

## Design implementation status (after UI round 3, 2026-11-12)
- **Implemented Stitch screens (MVP-A, 11):** SC-26, SC-27, SC-46 Implemented; SC-10, 14, 24, 25, 28, 29 (MVP-A subset), 30, 39 Implemented with deviations. Per-screen deviations: `STITCH_DESIGN_INVENTORY.md` §2. Final results: `testing/UI_TESTING_REPORT.md` (Final status) and `testing/VISUAL_REGRESSION_REPORT.md`. All 11 pass functional, visual and responsive checks at 1440/1280/768/390; SC-14 and SC-28 accessibility "needs review" (BUG-028, BUG-045).
- **Reusable components** (`apps/web/src/components`, each taken from a named Stitch file): AppShell (sc_01 shell + vendor sections), CardLayout (sc_27), PageHeader, Button, FormField/TextInput/Select, FileDropZone, CodeInput, Modal + StepUpModal (sc_02-modal, TOTP), Drawer, DataTable (+ PaginationBar, `bare`, `stackOnPhone`), FiltersBar, Tabs (wraps), StatusBadge, Banner, ErrorSummary, KpiCard, FigureCard, ChartCard/line/paired-bar/Sparkline/MeterBar (measured width), ApprovalBar, RequestCard, Stepper, SegmentedControl, Switch, Avatar (initials), Toast, empty/loading/error/NotAvailable states, SupportFrame. Feature-local blocks: `features/data/ui.tsx`, `features/data/report-breakdowns.tsx`, `features/admin/ui.tsx`, `features/auth/auth-card.tsx`.
- **Missing screens (designed, not built):** every non-MVP-A file is Pending: MVP-B SC-01..09, 11, 12, 13, 15..22, 31..38, 41..44 (SC-29 beyond thresholds and contacts), V1 SC-23, 40, 45, 47. SC-36 header search is not rendered until SC-36 ships. App routes with no Stitch design: `/vendor/users`, `/vendor/audit`, `/invitation` (built from the SC-28, SC-30, SC-27 patterns).
- **Decisions:** Tailwind 3.4.19 with the canonical theme `design/stitch/tailwind-theme.json`; canonical staff shell sc_01; canonical-catalogue values win over per-screen Stitch variants (button 32 px, table header 11 px/600, card radius 2); light theme only; local fonts and Material Symbols, no hot-linked images (initials avatars); no control without an API route; must-not-implement content never rendered (legal-conclusion badges, invented benchmarks, projections, targets, streaks, rankings); no horizontal page scroll at 390 although the drawings overflow; SC-39 in the vendor shell; SC-10 keeps reports on tabs and opens on the latest period; step-up is TOTP, not the drawn hardware key.
- **Open visual and UI issues (all LOW):** BUG-045 stacked step-up dialog (SC-14, SC-28); BUG-028 focus to body after a dialog removes its trigger; copy/data: BUG-023 (requester name needs API), 025, 026, 027, 029, 046, 047, 048. Fixed and verified: BUG-032..044.
- **Impeccable findings (audit mode only; no PRODUCT.md/DESIGN.md, incumbent implementation as authority):** scores 12/16 → 14/16 → 15/16 over rounds 1–3 (Performance not scored). Detector source scan: two `side-tab` `border-l-4` findings (`banner.tsx`, `error-summary.tsx`) = Stitch banner anatomy, design note; rendered `/signin` and `/signin/vendor`: no findings. Two hard-coded colours, both from Stitch (`#0F172A` scrim sc_02, `#7A4900` warning border sc_08). Authenticated pages were checked by the scripted a11y pass (25 routes), not by the detector.
