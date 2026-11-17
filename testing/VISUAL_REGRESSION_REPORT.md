# Visual regression report — Stitch fidelity

Owner: QA. Harness: `testing/visual/` (usage in `testing/visual/README.md`). The run log at the end is appended by
`compare.ts`; the sections above it summarise. Only measured results are recorded; anything not run says `not executed`.

## Final status (after round 3, 2026-11-12)

| Screen | Stitch | Round 1 visual | Round 2 visual | Round 3 visual | Remaining harness flags (judged) |
|---|---|---|---|---|---|
| SC-10 | `sc_10_compliance_reports` | fail (BUG-032..036) | pass | pass | table header missing on the R1 tab (the R3 table is on its own tab: tab state); title 20 px at 390 (mobile token) |
| SC-14 | `sc_14_vendor_access_sessions_authorizations` | pass | pass | pass | primary missing in rounds 1 and 3 (request already decided: data state); canonical button and table header |
| SC-24 | `sc_24_data_imports` | pass (BUG-042) | pass | pass | canonical tokens (sc_24's own config is broken and uses non-token colours) |
| SC-25 | `sc_25_import_mapping` | pass | pass | pass | canonical tokens |
| SC-26 | `sc_26_figure_drill_down` | pass | pass | pass | canonical button weight and table header |
| SC-27 | `sc_27_sign_in_and_second_factor` | pass | pass | pass | none at any width |
| SC-28 | `sc_28_users_and_roles` | pass | fail (BUG-044 dialogs) | pass | canonical tokens |
| SC-29 | `sc_29_tenant_settings` | pass | pass | pass | primary and history table missing (no API: correct omission) |
| SC-30 | `sc_30_immutable_audit_log_verification` | pass | pass | pass | canonical primary size and table header |
| SC-39 | `sc_39_vendor_operations_console` | pass | pass | pass | canonical values; fleet KPIs and docked request panel not drawn (no API) |
| SC-46 | `sc_46_compliance_overview_overlay_home` | needs review (BUG-035, 043) | pass | pass | canonical button, table header, card radius |

Shell landmarks (header 48 px, sidebar 208 px) match the canonical sc_01 shell at 1440 and 1280 on every screen in every round. From round 2 on, every app capture is exactly the viewport width at 1440, 1280, 768 and 390 (no horizontal page scroll). Pixel mismatch stays 1.4–11.1 % (informational: API data and page heights differ from the drawings).

Visual defects: BUG-032..037, 042, 043 fixed after round 1 and verified in round 2; BUG-044 fixed after round 2 and verified in round 3. Open: BUG-045 (LOW, design quality: step-up dialog stacked on the action dialog, outside the page captures). No other visual defect is open.

## Screenshots captured

- **Stitch references:** 48 screens x 4 viewports = 192 full-page PNGs in `testing/ui-screenshots/reference/<sc_folder>/<WxH>.png`
  (2026-11-12, Chromium 1234 headless shell via `@playwright/test` 1.62.1, Tailwind Play CDN + Google Fonts loaded from network).
  - sc_13, sc_24, sc_25, sc_28: their inline `tailwind.config` lacks the final `}` (their own `screen.png` is unstyled). They were
    rendered from a temporary copy with the brace appended (OS temp dir, deleted after rendering); the design files are unchanged.
- **Harness self-check renders:** `testing/ui-screenshots/self-check/<module>/<screen>/self-check/` (Stitch vs Stitch, see Retest results).
- **App screens (round 1, 2026-11-12):** all 11 MVP-A screens x 4 viewports = 44 full-page captures plus diff images in
  `testing/ui-screenshots/app/<module>/<screen>/<role>/<WxH>.png` and `<WxH>.diff.png`; JSON per screen in
  `testing/visual/results/<SC>__<role>.json`. Data: `nmp_e2e` after workflows W1–W9 (snapshot `dcad3d61…` Ready, batch `e0ef7ddd…`
  Loaded, mapping v1 approved, no pending vendor request). Roles: anonymous (SC-27), compliance officer (SC-10/26/46),
  tenant admin admin@acme (SC-24/25), tenant admin admin2@acme (SC-14/28/29/30), vendor operator2 (SC-39).
  Note: full-page captures draw fixed elements (sidebar) only within the first viewport height; that is a capture artifact, not a defect.

- **App screens (round 2, 2026-11-12, retest):** the same 11 screens x 4 viewports re-captured into the same paths (round-1 PNGs
  overwritten; round-1 JSON kept only in the run log below). Data: fresh `nmp_e2e` after W1–W7 (snapshot `ea7ac414…` Ready, batch
  `ea704235…` Loaded, mapping v1 approved, one vendor request pending so SC-14 shows its Approve primary). Same roles as round 1.

- **App screens (round 3, 2026-11-12, retest):** the same 11 screens x 4 viewports re-captured into the same paths (round-2 PNGs
  overwritten; earlier JSON kept in the run log). Data: fresh `nmp_e2e` after W1–W9 (snapshot `0215ba51…` Ready, batch `82ce26a3…`
  Loaded, mapping v1 approved, vendor request already approved so SC-14 shows an open session and no Approve primary). Roles:
  anonymous (SC-27), compliance officer (SC-10/26/46), tenant admin admin@acme (SC-14/24/25/28/29/30), vendor operator (SC-39).

## References compared

- MVP-A screens configured in `testing/visual/screens.json`: SC-10, SC-14, SC-24, SC-25, SC-26, SC-27, SC-28, SC-29, SC-30, SC-39, SC-46.
- Shell landmarks (header, sidebar) are compared against the canonical staff shell `sc_01_periods_runs_analyst_home`
  (DESIGN_IMPLEMENTATION_GUIDELINES §1.4), not against the S2/S6/S8 shell variants drawn in individual screens.
- App vs reference: executed for all 11 screens (round 1). URLs: SC-10 `/compliance/snapshots/<id>?report=R1`,
  SC-26 `/compliance/snapshots/<id>/rows?figure=R1.2025-01.net_sales_cents`, SC-25 `/imports/mappings?version=<v1>&batch=<id>`,
  the others at their `screens.json` route.

## Viewports

1440x900, 1280x800, 768x1024, 390x844 (full page). Shell landmarks are compared at 1440 and 1280 only: below 1280 the app
collapses (1024–1279) or overlays (<1024) the sidebar by design (guidelines §responsive), which Stitch does not draw.

## Differences

- **App vs Stitch, round 1 (2026-11-12).** Shell landmarks (header 48 px, sidebar 208 px, backgrounds) match sc_01 on every screen at
  1440 and 1280. Pixel mismatch 1.5–11.1 % everywhere (informational: data, and the app's page heights differ from the drawings).
  Harness style findings and QA judgement (screenshot paths are `testing/ui-screenshots/app/<module>/<screen>/<role>/<WxH>.png`):

  | Screen | Harness finding (viewports) | Judgement |
  |---|---|---|
  | SC-27 | none (all four) | matches |
  | SC-46 | primary 30→32 px (1440/1280/768), table header 12/700/on-surface-variant → 11/600/secondary (all), card radius 0→2 (all), title 24→20 px and primary 48→32 px at 390 | canonical catalogue values (§1.4, §8) and mobile title token: design notes. Real differences found by eye: headline card change text wraps to 4 lines beside the sparkline (BUG-043, `compliance/compliance-overview/compliance-officer/1440x900.png`); trend x-axis labels 2025-11/2025-12 overlap (BUG-035) |
  | SC-10 | tableHeader missing-in-app (all), title 24→20 px at 390 | real: R3 breakdown table, R5 distribution bars and R1 segmentation bar of sc_10 not rendered; generic per-figure cards per period instead (BUG-032); default "All periods" makes the page 15,312 px at 1440 / 26,170 px at 390 vs 1,757 / 7,057 for the drawing (BUG-033); report tabs clipped at 1440/1280/768 (BUG-034); chart labels overlap and unreadable at 390 (BUG-035); hero value "1,517,950 minor units" wraps (BUG-036). Evidence `compliance/compliance-reports/compliance-officer/{1440x900,1280x800,768x1024,390x844}.png` |
  | SC-26 | primary weight 400→600, table header (all), title at 390 | canonical values: design notes. Formula card smaller than sc_26's (figure without denominator): note |
  | SC-24 | page background slate-50→background, primary primary-container→primary 36→32 px, header 12→11 px (all), title at 390 | canonical tokens: design notes (sc_24 config was broken; it uses non-token colours). Visible duplicate table caption (BUG-042) |
  | SC-25 | page background, table header (all), title at 390 | design notes. 390: version meta strip overflows the page (384 px) (BUG-037, `data/import-mapping/tenant-admin/390x844.png`, `var/e2e-screens/R4-W10-SC25-390.png`) |
  | SC-28 | page background, primary colour, section heading line height 20→24, table header (all), title at 390 | design notes (canonical); approvals tab not captured (default Users tab) |
  | SC-29 | primary and table header missing-in-app (all), card radius 0→2, title at 390 | sc_29's "Save new version" primary and version-history table have no API (§6.4): correct omission, design note |
  | SC-14 | primary missing-in-app (1440/1280/768/390), table header (all), title 32→26 at 390 | data state (no pending request at capture; Approve exists, verified in W8): not a defect |
  | SC-30 | primary 36→32 px and 16→13 px (desktop), 84→32 at 390, table header (all), title at 390 | canonical values: design notes |
  | SC-39 | section heading line height, primary 34→32 px / 12→13 px, header, card radius (all), title at 390 | canonical values: design notes; fleet KPIs and docked request panel not drawn (no API) |
- **App vs Stitch, round 2 (2026-11-12, retest).** Shell landmarks still match sc_01 at 1440/1280. Every app capture is exactly the
  viewport width (no horizontal page scroll at any width). Pixel mismatch 1.4–11.1 % (informational).

  | Screen | Harness finding (viewports) | Judgement |
  |---|---|---|
  | SC-27 | none | matches |
  | SC-46 | as round 1 (canonical button, table header, card radius; mobile title) | design notes. BUG-043 and BUG-035 gone: change text one line under the value, axis labels clear (`compliance/compliance-overview/compliance-officer/1440x900.png`) |
  | SC-10 | tableHeader missing-in-app (all; the R1 capture has no table: the R3 table is on its own tab), title at 390 | tab/data state, not a defect. sc_10 anatomy now present: segmentation bar, R3 breakdown table, R5 band bars; one period; tabs fit; page 2,289 px at 1440 (reference 1,757), 4,151 at 390 (reference 7,057 and 545 px wide) (`compliance/compliance-reports/compliance-officer/*.png`) |
  | SC-26 | as round 1 | design notes |
  | SC-24 | as round 1 | design notes; caption no longer visible |
  | SC-25 | as round 1 | design notes; 390 capture now 390 px wide (BUG-037 fixed, `data/import-mapping/tenant-admin/390x844.png`) |
  | SC-28 | as round 1 | design notes |
  | SC-29 | as round 1 | design notes |
  | SC-14 | primary 34→32 px (desktop), 88→32 at 390, table header, title at 390 | Approve primary now captured (pending request); canonical sizes: design notes |
  | SC-30 | as round 1 | design notes |
  | SC-39 | as round 1 | design notes |
  - New real difference found outside the page captures: every dialog stretches to 90vh at ≥ 640 px with an empty area below its
    footer (sc_02-modal hugs content): BUG-044 (`var/e2e-screens/R5-dialog-invite-1440.png`, `R5-dialog-create-snapshot-1280.png`,
    `R5-W3-stepup-stacked.png`); step-up dialog stacked over the action dialog: BUG-045.
- **App vs Stitch, round 3 (2026-11-12, retest).** Shell landmarks match sc_01 at 1440/1280 on every screen; every capture is exactly
  the viewport width. Pixel mismatch 1.4–11.1 % (informational). Harness findings identical to round 2 for SC-10, 24, 25, 26, 27, 28,
  29, 30, 39, 46 (canonical-catalogue values and tab state: design notes). SC-14: primary missing-in-app at all widths because the
  only request had been approved before the capture (data state, as round 1; the Approve primary was exercised in W8).
  Judged by eye (`compliance/compliance-reports/compliance-officer/1440x900.png`, `settings/vendor-access/tenant-admin/1440x900.png`,
  `compliance/compliance-overview/compliance-officer/390x844.png`): no new real difference. At 390 the SC-46 recent-snapshots table
  scrolls inside its `overflow-x-auto` container with the last column cut at the edge (the guideline's scroll affordance; note).
  Dialogs (outside the page captures): BUG-044 fixed: Invite user 334.5 px tall at 1440x900, Create snapshot 592 px at 1280x800,
  step-up 426 px, each equal to its content and centred; long content caps at 90vh with a scrolling body and visible footer
  (`var/e2e-screens/R6-BUG044-*.png`). The step-up dialog still opens on top of the action dialog (BUG-045, `var/e2e-screens/R6-W8-stepup.png`).
- **Findings in the Stitch references themselves** (measured from the renders, relevant when judging app responsiveness):
  - At 390x844, 38 of 48 references are wider than the viewport (page width 434–982 px), i.e. horizontal scroll; the drawings are
    not phone layouts. MVP-A: sc_10 545, sc_14 608, sc_24 537, sc_25 664, sc_26 528, sc_28 537, sc_29 982, sc_30 491, sc_39 851, sc_46 458;
    only sc_27 fits (390).
  - At 768x1024, 12 references overflow (MVP-A: sc_29 982, sc_30 1292, sc_39 851).
  - At 1280x800, sc_30 overflows (1292 px).
  - Consequence: pixel diffs at 768 and 390 compare against an overflowing drawing; the app must not reproduce the overflow
    (no horizontal page scroll, guidelines §responsive), so mismatch % there is expected to be high.

## Severity

Style-fidelity findings are rated by the harness: high = shell (header, sidebar), page background/font or primary button drift,
or a landmark missing in the app; medium = title, section heading, table header or card drift; info = landmark Stitch does not draw.
Pixel mismatch % is informational only (API data differs from Stitch sample data). Round 1: the harness flags `high` on 10 of 11
screens, but almost all are deliberate canonical-catalogue values (see Differences). Real visual defects, as registered:
BUG-032 (MEDIUM), BUG-033 (MEDIUM), BUG-034 (MEDIUM), BUG-035, BUG-036, BUG-037, BUG-042, BUG-043 (LOW).

Round 2: BUG-032..037, 042, 043 verified fixed; new visual defect BUG-044 (MEDIUM, dialogs), design-quality BUG-045 (LOW).

Round 3: BUG-044 verified fixed; no new visual defect. Open design-quality defect BUG-045 (LOW) unchanged.

## Root causes

- SC-10: the report page keeps its pre-Stitch structure (tabs per report, one generic `FigureCard` per figure per period) instead of
  the sc_10 per-report card anatomy; default period choice is "All periods".
- Tabs: the tab strip sits in the 8-column report column and scrolls horizontally instead of wrapping or shortening labels.
- Charts: x labels placed at every other period plus the last one, so the last two collide; the SVG scales with its viewBox, so text
  shrinks with the container at phone width.
- SC-25: the version meta strip (`flex items-center` dt/dd pairs) has no wrap.
- FigureCard (BUG-036): the unit words were part of the `data-mono-lg` hero value.
- DataTable (BUG-042): the caption was rendered visibly.
- SC-46 (BUG-043): the change text sat beside the sparkline in a narrow column.
- Modal (BUG-044, round 2): `sm:h-auto` on a modal `<dialog>` (fixed, top and bottom 0) fills the height up to `sm:max-h-[90vh]`
  instead of fitting the content.
- StepUpModal (BUG-045, open): it is opened on STEP_UP_REQUIRED over whatever dialog started the action, so two modals are open.

## Corrections

QA does not fix code; the frontend owner made these corrections and QA re-measured them (defects in `engineering/BUG_REGISTER.md`):

- After round 1 (BUG-032..043): `features/data/report-breakdowns.tsx` (R1 segmentation bar, R3 source-kind table, R5 band bars);
  report opens on the latest period; report tabs full width above the 8/4 split and the shared Tabs strip wraps; charts draw at
  their measured width with x labels counted back from the last period; hero value and unit separated (`figureAmount`,
  `figureUnit`); ScopeStrip pairs wrap; DataTable caption `sr-only`; SC-46 change under the value; plus the functional and
  accessibility fixes BUG-038..041. Verified in round 2.
- After round 2 (BUG-044): `apps/web/src/components/modal.tsx` `sm:h-auto` → `sm:h-fit`, with a regression test. Verified in round 3.
- After round 3: none.

## Retest results

- **App retest round 2 (2026-11-12):** all 11 screens x 4 viewports re-run (`testing/visual/results/*.json`, run log below).
  BUG-032, 033, 034, 035, 036, 037, 042, 043 verified fixed (measurements in `testing/UI_TESTING_REPORT.md`, Round 2). Remaining
  harness `high`/`medium` flags are the canonical-catalogue values and data/tab states judged as design notes in round 1.
- **App retest round 3 (2026-11-12):** all 11 screens x 4 viewports re-run (results JSON and run log updated). BUG-044 verified
  fixed (measurements in `testing/UI_TESTING_REPORT.md`, Round 3). No regression against round 2; remaining harness flags are the
  canonical-catalogue values and data/tab states judged as design notes.
- **Harness self-check, 2026-11-12** (`compare.ts --self`: reference PNG vs a fresh render of the same Stitch file; landmark styles
  measured from two independent loads), all 11 MVP-A screens x 4 viewports:
  - Style fidelity: every configured landmark found and identical on every screen and viewport (worst severity `none`).
    The first SC-10/26/27/28/29/30 runs in the log reported `info` (landmark absent in Stitch): those drawings use styled `span`s
    instead of `h1`/`h2`, so per-screen Stitch selectors were added to `screens.json` and the six screens re-run; the later entries supersede them.
  - Pixel mismatch: 0% on 41 of 44 captures; 0.48% (SC-10 1440x900), 0.41% (SC-25 768x1024), 0.28% (SC-28 390x844). The diff pixels
    are scattered across the page (text anti-aliasing), consistent with network-loaded fonts/images settling differently between
    loads; cause not isolated. Treat pixel mismatch below 1% as render noise.

## Run log

### 2026-11-12T02:47:15.013Z · SC-24 imports — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_24_data_imports` · Stitch: `sc_24_data_imports` · config brace patched: sc_24_data_imports
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/data/imports/self-check/1440x900.png` | `testing/ui-screenshots/self-check/data/imports/self-check/1440x900.diff.png` | 0% | 1440x1369 / 1440x1369 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/data/imports/self-check/1280x800.png` | `testing/ui-screenshots/self-check/data/imports/self-check/1280x800.diff.png` | 0% | 1280x1547 / 1280x1547 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/data/imports/self-check/768x1024.png` | `testing/ui-screenshots/self-check/data/imports/self-check/768x1024.diff.png` | 0% | 768x2462 / 768x2462 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/data/imports/self-check/390x844.png` | `testing/ui-screenshots/self-check/data/imports/self-check/390x844.diff.png` | 0% | 537x4894 / 537x4894 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:47:51.441Z · SC-10 compliance-reports — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_10_compliance_reports` · Stitch: `sc_10_compliance_reports`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1440x900.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1440x900.diff.png` | 0% | 1440x1757 / 1440x1757 | 7/7 | info |
| 1280x800 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1280x800.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1280x800.diff.png` | 0% | 1280x1817 / 1280x1817 | 7/7 | info |
| 768x1024 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/768x1024.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/768x1024.diff.png` | 0% | 768x3080 / 768x3080 | 5/5 | info |
| 390x844 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/390x844.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/390x844.diff.png` | 0% | 545x7057 / 545x7057 | 5/5 | info |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | absent-in-stitch | info | — | — | — |
| 390x844 | sectionHeading | absent-in-stitch | info | — | — | — |

### 2026-11-12T02:48:13.214Z · SC-14 vendor-access — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_14_vendor_access_sessions_authorizations` · Stitch: `sc_14_vendor_access_sessions_authorizations`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/1440x900.png` | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/1440x900.diff.png` | 0% | 1440x2216 / 1440x2216 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/1280x800.png` | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/1280x800.diff.png` | 0% | 1280x2546 / 1280x2546 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/768x1024.png` | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/768x1024.diff.png` | 0% | 768x3840 / 768x3840 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/390x844.png` | `testing/ui-screenshots/self-check/settings/vendor-access/self-check/390x844.diff.png` | 0% | 608x8049 / 608x8049 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:48:34.560Z · SC-25 import-mapping — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_25_import_mapping` · Stitch: `sc_25_import_mapping` · config brace patched: sc_25_import_mapping
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/data/import-mapping/self-check/1440x900.png` | `testing/ui-screenshots/self-check/data/import-mapping/self-check/1440x900.diff.png` | 0% | 1440x1241 / 1440x1241 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/data/import-mapping/self-check/1280x800.png` | `testing/ui-screenshots/self-check/data/import-mapping/self-check/1280x800.diff.png` | 0% | 1280x1437 / 1280x1437 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/data/import-mapping/self-check/768x1024.png` | `testing/ui-screenshots/self-check/data/import-mapping/self-check/768x1024.diff.png` | 0.41% | 768x2006 / 768x2006 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/data/import-mapping/self-check/390x844.png` | `testing/ui-screenshots/self-check/data/import-mapping/self-check/390x844.diff.png` | 0% | 664x3936 / 664x3936 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:48:59.257Z · SC-26 figure-drill-down — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_26_figure_drill_down` · Stitch: `sc_26_figure_drill_down`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1440x900.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1440x900.diff.png` | 0% | 1440x1483 / 1440x1483 | 7/7 | info |
| 1280x800 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1280x800.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1280x800.diff.png` | 0% | 1280x1525 / 1280x1525 | 7/7 | info |
| 768x1024 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/768x1024.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/768x1024.diff.png` | 0% | 768x2817 / 768x2817 | 5/5 | info |
| 390x844 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/390x844.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/390x844.diff.png` | 0% | 528x4447 / 528x4447 | 5/5 | info |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | absent-in-stitch | info | — | — | — |
| 390x844 | sectionHeading | absent-in-stitch | info | — | — | — |

### 2026-11-12T02:49:14.833Z · SC-27 sign-in — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_27_sign_in_and_second_factor` · Stitch: `sc_27_sign_in_and_second_factor`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1440x900.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1440x900.diff.png` | 0% | 1440x1462 / 1440x1462 | 4/4 | info |
| 1280x800 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1280x800.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1280x800.diff.png` | 0% | 1280x1462 / 1280x1462 | 4/4 | info |
| 768x1024 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/768x1024.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/768x1024.diff.png` | 0% | 768x1478 / 768x1478 | 4/4 | info |
| 390x844 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/390x844.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/390x844.diff.png` | 0% | 390x1737 / 390x1737 | 4/4 | info |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | absent-in-stitch | info | — | — | — |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | absent-in-stitch | info | — | — | — |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | absent-in-stitch | info | — | — | — |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | sectionHeading | absent-in-stitch | info | — | — | — |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-12T02:49:36.105Z · SC-28 users-and-roles — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_28_users_and_roles` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1440x900.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1440x900.diff.png` | 0% | 1440x1154 / 1440x1154 | 7/7 | info |
| 1280x800 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1280x800.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1280x800.diff.png` | 0% | 1280x1314 / 1280x1314 | 7/7 | info |
| 768x1024 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/768x1024.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/768x1024.diff.png` | 0% | 768x1949 / 768x1949 | 5/5 | info |
| 390x844 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/390x844.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/390x844.diff.png` | 0.28% | 537x4179 / 537x4179 | 5/5 | info |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | absent-in-stitch | info | — | — | — |
| 390x844 | sectionHeading | absent-in-stitch | info | — | — | — |

### 2026-11-12T02:50:02.450Z · SC-29 tenant-settings — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_29_tenant_settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1440x900.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1440x900.diff.png` | 0% | 1440x1818 / 1440x1818 | 6/6 | info |
| 1280x800 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1280x800.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1280x800.diff.png` | 0% | 1280x1992 / 1280x1992 | 6/6 | info |
| 768x1024 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/768x1024.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/768x1024.diff.png` | 0% | 982x3723 / 982x3723 | 4/4 | info |
| 390x844 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/390x844.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/390x844.diff.png` | 0% | 982x8578 / 982x8578 | 4/4 | info |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | absent-in-stitch | info | — | — | — |
| 1440x900 | sectionHeading | absent-in-stitch | info | — | — | — |
| 1280x800 | title | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | absent-in-stitch | info | — | — | — |
| 768x1024 | title | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | absent-in-stitch | info | — | — | — |
| 390x844 | title | absent-in-stitch | info | — | — | — |
| 390x844 | sectionHeading | absent-in-stitch | info | — | — | — |

### 2026-11-12T02:50:24.887Z · SC-30 audit-log — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_30_immutable_audit_log_verification` · Stitch: `sc_30_immutable_audit_log_verification`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1440x900.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1440x900.diff.png` | 0% | 1440x1560 / 1440x1560 | 6/6 | info |
| 1280x800 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1280x800.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1280x800.diff.png` | 0% | 1292x1680 / 1292x1680 | 6/6 | info |
| 768x1024 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/768x1024.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/768x1024.diff.png` | 0% | 1292x2672 / 1292x2672 | 4/4 | info |
| 390x844 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/390x844.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/390x844.diff.png` | 0% | 491x8188 / 491x8188 | 4/4 | info |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | absent-in-stitch | info | — | — | — |
| 1440x900 | sectionHeading | absent-in-stitch | info | — | — | — |
| 1280x800 | title | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | absent-in-stitch | info | — | — | — |
| 768x1024 | title | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | absent-in-stitch | info | — | — | — |
| 390x844 | title | absent-in-stitch | info | — | — | — |
| 390x844 | sectionHeading | absent-in-stitch | info | — | — | — |

### 2026-11-12T02:50:46.997Z · SC-39 operations-console — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_39_vendor_operations_console` · Stitch: `sc_39_vendor_operations_console`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/1440x900.png` | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/1440x900.diff.png` | 0% | 1440x1450 / 1440x1450 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/1280x800.png` | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/1280x800.diff.png` | 0% | 1280x1609 / 1280x1609 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/768x1024.png` | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/768x1024.diff.png` | 0% | 851x2869 / 851x2869 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/390x844.png` | `testing/ui-screenshots/self-check/vendor/operations-console/self-check/390x844.diff.png` | 0% | 851x5544 / 851x5544 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:51:13.492Z · SC-46 compliance-overview — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_46_compliance_overview_overlay_home` · Stitch: `sc_46_compliance_overview_overlay_home`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/1440x900.png` | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/1440x900.diff.png` | 0% | 1440x1567 / 1440x1567 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/1280x800.png` | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/1280x800.diff.png` | 0% | 1280x1709 / 1280x1709 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/768x1024.png` | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/768x1024.diff.png` | 0% | 768x3291 / 768x3291 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/390x844.png` | `testing/ui-screenshots/self-check/compliance/compliance-overview/self-check/390x844.diff.png` | 0% | 458x5981 / 458x5981 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:52:16.567Z · SC-10 compliance-reports — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_10_compliance_reports` · Stitch: `sc_10_compliance_reports`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1440x900.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1440x900.diff.png` | 0.48% | 1440x1757 / 1440x1757 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1280x800.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/1280x800.diff.png` | 0% | 1280x1817 / 1280x1817 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/768x1024.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/768x1024.diff.png` | 0% | 768x3080 / 768x3080 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/390x844.png` | `testing/ui-screenshots/self-check/compliance/compliance-reports/self-check/390x844.diff.png` | 0% | 545x7057 / 545x7057 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:52:41.523Z · SC-26 figure-drill-down — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_26_figure_drill_down` · Stitch: `sc_26_figure_drill_down`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1440x900.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1440x900.diff.png` | 0% | 1440x1483 / 1440x1483 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1280x800.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/1280x800.diff.png` | 0% | 1280x1525 / 1280x1525 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/768x1024.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/768x1024.diff.png` | 0% | 768x2817 / 768x2817 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/390x844.png` | `testing/ui-screenshots/self-check/compliance/figure-drill-down/self-check/390x844.diff.png` | 0% | 528x4447 / 528x4447 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:52:59.819Z · SC-27 sign-in — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_27_sign_in_and_second_factor` · Stitch: `sc_27_sign_in_and_second_factor`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1440x900.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1440x900.diff.png` | 0% | 1440x1462 / 1440x1462 | 4/4 | none |
| 1280x800 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1280x800.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/1280x800.diff.png` | 0% | 1280x1462 / 1280x1462 | 4/4 | none |
| 768x1024 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/768x1024.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/768x1024.diff.png` | 0% | 768x1478 / 768x1478 | 4/4 | none |
| 390x844 | `testing/ui-screenshots/self-check/auth/sign-in/self-check/390x844.png` | `testing/ui-screenshots/self-check/auth/sign-in/self-check/390x844.diff.png` | 0% | 390x1737 / 390x1737 | 4/4 | none |

Style differences: none.


### 2026-11-12T02:53:23.040Z · SC-28 users-and-roles — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_28_users_and_roles` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1440x900.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1440x900.diff.png` | 0% | 1440x1154 / 1440x1154 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1280x800.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/1280x800.diff.png` | 0% | 1280x1314 / 1280x1314 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/768x1024.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/768x1024.diff.png` | 0% | 768x1949 / 768x1949 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/390x844.png` | `testing/ui-screenshots/self-check/settings/users-and-roles/self-check/390x844.diff.png` | 0.28% | 537x4179 / 537x4179 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:53:48.182Z · SC-29 tenant-settings — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_29_tenant_settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1440x900.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1440x900.diff.png` | 0% | 1440x1818 / 1440x1818 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1280x800.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/1280x800.diff.png` | 0% | 1280x1992 / 1280x1992 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/768x1024.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/768x1024.diff.png` | 0% | 982x3723 / 982x3723 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/390x844.png` | `testing/ui-screenshots/self-check/settings/tenant-settings/self-check/390x844.diff.png` | 0% | 982x8578 / 982x8578 | 6/6 | none |

Style differences: none.


### 2026-11-12T02:54:11.703Z · SC-30 audit-log — role self-check (harness self-check: Stitch vs Stitch)

- Page: `stitch:sc_30_immutable_audit_log_verification` · Stitch: `sc_30_immutable_audit_log_verification`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1440x900.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1440x900.diff.png` | 0% | 1440x1560 / 1440x1560 | 8/8 | none |
| 1280x800 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1280x800.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/1280x800.diff.png` | 0% | 1292x1680 / 1292x1680 | 8/8 | none |
| 768x1024 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/768x1024.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/768x1024.diff.png` | 0% | 1292x2672 / 1292x2672 | 6/6 | none |
| 390x844 | `testing/ui-screenshots/self-check/settings/audit-log/self-check/390x844.png` | `testing/ui-screenshots/self-check/settings/audit-log/self-check/390x844.diff.png` | 0% | 491x8188 / 491x8188 | 6/6 | none |

Style differences: none.


### 2026-11-12T03:39:25.535Z · SC-27 sign-in — role anonymous

- Page: `http://localhost:3100/signin` · Stitch: `sc_27_sign_in_and_second_factor`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/auth/sign-in/anonymous/1440x900.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/1440x900.diff.png` | 4.12% | 1440x900 / 1440x1462 | 4/4 | none |
| 1280x800 | `testing/ui-screenshots/app/auth/sign-in/anonymous/1280x800.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/1280x800.diff.png` | 4.89% | 1280x800 / 1280x1462 | 4/4 | none |
| 768x1024 | `testing/ui-screenshots/app/auth/sign-in/anonymous/768x1024.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/768x1024.diff.png` | 6.73% | 768x1024 / 768x1478 | 4/4 | none |
| 390x844 | `testing/ui-screenshots/app/auth/sign-in/anonymous/390x844.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/390x844.diff.png` | 11.08% | 390x844 / 390x1737 | 4/4 | none |

Style differences: none.


### 2026-11-12T03:39:40.309Z · SC-46 compliance-overview — role compliance-officer

- Page: `http://localhost:3100/compliance` · Stitch: `sc_46_compliance_overview_overlay_home`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1440x900.diff.png` | 7.88% | 1440x1424 / 1440x1567 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1280x800.diff.png` | 7.82% | 1280x1437 / 1280x1709 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/768x1024.diff.png` | 5.7% | 768x2291 / 768x3291 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/390x844.diff.png` | 4.3% | 390x2945 / 458x5981 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `48px` | `32px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T03:39:59.644Z · SC-10 compliance-reports — role compliance-officer

- Page: `http://localhost:3100/compliance/snapshots/dcad3d61-10f9-45ef-a98b-793463da6de6?report=R1` · Stitch: `sc_10_compliance_reports`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1440x900.diff.png` | 3.25% | 1440x15312 / 1440x1757 | 7/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1280x800.diff.png` | 3.27% | 1280x16779 / 1280x1817 | 7/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/768x1024.diff.png` | 5.46% | 768x16700 / 768x3080 | 5/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/390x844.diff.png` | 4.62% | 390x26170 / 545x7057 | 4/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |

### 2026-11-12T03:40:13.679Z · SC-26 figure-drill-down — role compliance-officer

- Page: `http://localhost:3100/compliance/snapshots/dcad3d61-10f9-45ef-a98b-793463da6de6/rows?figure=R1.2025-01.net_sales_cents` · Stitch: `sc_26_figure_drill_down`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1440x900.diff.png` | 4.76% | 1440x2403 / 1440x1483 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1280x800.diff.png` | 5.06% | 1280x2458 / 1280x1525 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/768x1024.diff.png` | 5.35% | 768x3494 / 768x2817 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/390x844.diff.png` | 3.74% | 390x3790 / 528x4447 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T03:40:26.350Z · SC-24 imports — role tenant-admin

- Page: `http://localhost:3100/imports` · Stitch: `sc_24_data_imports` · config brace patched: sc_24_data_imports
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/data/imports/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/1440x900.diff.png` | 5.65% | 1440x900 / 1440x1369 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/data/imports/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/1280x800.diff.png` | 5.57% | 1280x800 / 1280x1547 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/data/imports/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/768x1024.diff.png` | 5.31% | 768x1024 / 768x2462 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/data/imports/tenant-admin/390x844.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/390x844.diff.png` | 2.92% | 390x1023 / 537x4894 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |

### 2026-11-12T03:40:39.287Z · SC-25 import-mapping — role tenant-admin

- Page: `http://localhost:3100/imports/mappings?version=dc5e3a35-cf2a-4582-b25e-cf3403e657c2&batch=e0ef7ddd-ae25-469e-a105-d3208b3e9c79` · Stitch: `sc_25_import_mapping` · config brace patched: sc_25_import_mapping
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1440x900.diff.png` | 7.05% | 1440x900 / 1440x1241 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1280x800.diff.png` | 6.57% | 1280x800 / 1280x1437 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/768x1024.diff.png` | 8.4% | 768x1024 / 768x2006 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/390x844.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/390x844.diff.png` | 3.19% | 390x1014 / 664x3936 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T03:40:51.441Z · SC-28 users-and-roles — role tenant-admin

- Page: `http://localhost:3100/settings/users` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1440x900.diff.png` | 7.5% | 1440x900 / 1440x1154 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1280x800.diff.png` | 7.17% | 1280x1080 / 1280x1314 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/768x1024.diff.png` | 7.3% | 768x1365 / 768x1949 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/390x844.diff.png` | 3.2% | 390x1669 / 537x4179 | 1/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T03:41:05.696Z · SC-29 tenant-settings — role tenant-admin

- Page: `http://localhost:3100/settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.diff.png` | 4.84% | 1440x1192 / 1440x1818 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.diff.png` | 4.99% | 1280x1192 / 1280x1992 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.diff.png` | 3.31% | 768x1210 / 982x3723 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.diff.png` | 1.53% | 390x1810 / 982x8578 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T03:41:18.279Z · SC-14 vendor-access — role tenant-admin

- Page: `http://localhost:3100/settings/vendor-access` · Stitch: `sc_14_vendor_access_sessions_authorizations`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1440x900.diff.png` | 6.91% | 1440x935 / 1440x2216 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1280x800.diff.png` | 6.42% | 1280x935 / 1280x2546 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/768x1024.diff.png` | 6.64% | 768x1399 / 768x3840 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/390x844.diff.png` | 1.83% | 390x1806 / 608x8049 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `34px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `34px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `34px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `88px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T03:41:31.641Z · SC-30 audit-log — role tenant-admin

- Page: `http://localhost:3100/settings/audit` · Stitch: `sc_30_immutable_audit_log_verification`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1440x900.diff.png` | 5.03% | 1440x3970 / 1440x1560 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1280x800.diff.png` | 5.41% | 1280x3970 / 1292x1680 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/768x1024.diff.png` | 4.56% | 768x4194 / 1292x2672 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/390x844.diff.png` | 2.89% | 390x4564 / 491x8188 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `84px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T03:41:43.882Z · SC-39 operations-console — role vendor-operator

- Page: `http://localhost:3100/vendor` · Stitch: `sc_39_vendor_operations_console`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1440x900.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1440x900.diff.png` | 5.76% | 1440x900 / 1440x1450 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1280x800.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1280x800.diff.png` | 5.84% | 1280x800 / 1280x1609 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/768x1024.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/768x1024.diff.png` | 4.48% | 768x1024 / 851x2869 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/390x844.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/390x844.diff.png` | 1.46% | 390x899 / 851x5544 | 1/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1440x900 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1280x800 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 768x1024 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 390x844 | primaryButton | mismatch | high | height | `64px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T04:16:10.358Z · SC-27 sign-in — role anonymous

- Page: `http://localhost:3100/signin` · Stitch: `sc_27_sign_in_and_second_factor`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/auth/sign-in/anonymous/1440x900.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/1440x900.diff.png` | 4.12% | 1440x900 / 1440x1462 | 4/4 | none |
| 1280x800 | `testing/ui-screenshots/app/auth/sign-in/anonymous/1280x800.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/1280x800.diff.png` | 4.89% | 1280x800 / 1280x1462 | 4/4 | none |
| 768x1024 | `testing/ui-screenshots/app/auth/sign-in/anonymous/768x1024.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/768x1024.diff.png` | 6.73% | 768x1024 / 768x1478 | 4/4 | none |
| 390x844 | `testing/ui-screenshots/app/auth/sign-in/anonymous/390x844.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/390x844.diff.png` | 11.08% | 390x844 / 390x1737 | 4/4 | none |

Style differences: none.


### 2026-11-12T04:16:25.075Z · SC-46 compliance-overview — role compliance-officer

- Page: `http://localhost:3100/compliance` · Stitch: `sc_46_compliance_overview_overlay_home`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1440x900.diff.png` | 7.74% | 1440x1299 / 1440x1567 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1280x800.diff.png` | 7.72% | 1280x1373 / 1280x1709 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/768x1024.diff.png` | 5.59% | 768x2248 / 768x3291 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/390x844.diff.png` | 4.27% | 390x3108 / 458x5981 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `48px` | `32px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T04:16:39.607Z · SC-10 compliance-reports — role compliance-officer

- Page: `http://localhost:3100/compliance/snapshots/ea7ac414-2f58-4c8d-8987-007a74f46077?report=R1` · Stitch: `sc_10_compliance_reports`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1440x900.diff.png` | 7.36% | 1440x2289 / 1440x1757 | 7/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1280x800.diff.png` | 7.59% | 1280x2433 / 1280x1817 | 7/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/768x1024.diff.png` | 9.8% | 768x2772 / 768x3080 | 5/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/390x844.diff.png` | 4.86% | 390x4151 / 545x7057 | 4/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |

### 2026-11-12T04:16:53.897Z · SC-26 figure-drill-down — role compliance-officer

- Page: `http://localhost:3100/compliance/snapshots/ea7ac414-2f58-4c8d-8987-007a74f46077/rows?figure=R1.2025-01.net_sales_cents` · Stitch: `sc_26_figure_drill_down`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1440x900.diff.png` | 4.8% | 1440x2371 / 1440x1483 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1280x800.diff.png` | 5.14% | 1280x2426 / 1280x1525 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/768x1024.diff.png` | 5.36% | 768x3462 / 768x2817 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/390x844.diff.png` | 3.72% | 390x3758 / 528x4447 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:17:06.115Z · SC-24 imports — role tenant-admin

- Page: `http://localhost:3100/imports` · Stitch: `sc_24_data_imports` · config brace patched: sc_24_data_imports
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/data/imports/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/1440x900.diff.png` | 5.48% | 1440x900 / 1440x1369 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/data/imports/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/1280x800.diff.png` | 5.4% | 1280x800 / 1280x1547 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/data/imports/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/768x1024.diff.png` | 5.1% | 768x1024 / 768x2462 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/data/imports/tenant-admin/390x844.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/390x844.diff.png` | 2.84% | 390x850 / 537x4894 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |

### 2026-11-12T04:17:17.986Z · SC-25 import-mapping — role tenant-admin

- Page: `http://localhost:3100/imports/mappings?version=73c3d0d7-7a1a-4c7e-9a2e-7e2aee8308d2&batch=ea704235-7a19-46fd-b39f-e4104272b633` · Stitch: `sc_25_import_mapping` · config brace patched: sc_25_import_mapping
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1440x900.diff.png` | 7.05% | 1440x900 / 1440x1241 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1280x800.diff.png` | 6.6% | 1280x800 / 1280x1437 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/768x1024.diff.png` | 8.44% | 768x1024 / 768x2006 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/390x844.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/390x844.diff.png` | 3.22% | 390x1081 / 664x3936 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:17:31.607Z · SC-28 users-and-roles — role tenant-admin

- Page: `http://localhost:3100/settings/users` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1440x900.diff.png` | 7.3% | 1440x900 / 1440x1154 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1280x800.diff.png` | 7.19% | 1280x1106 / 1280x1314 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/768x1024.diff.png` | 7.33% | 768x1431 / 768x1949 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/390x844.diff.png` | 3.22% | 390x1776 / 537x4179 | 1/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:17:45.574Z · SC-29 tenant-settings — role tenant-admin

- Page: `http://localhost:3100/settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.diff.png` | 4.84% | 1440x1192 / 1440x1818 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.diff.png` | 4.99% | 1280x1192 / 1280x1992 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.diff.png` | 3.32% | 768x1210 / 982x3723 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.diff.png` | 1.53% | 390x1810 / 982x8578 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T04:17:58.149Z · SC-14 vendor-access — role tenant-admin

- Page: `http://localhost:3100/settings/vendor-access` · Stitch: `sc_14_vendor_access_sessions_authorizations`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1440x900.diff.png` | 7.44% | 1440x1224 / 1440x2216 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1280x800.diff.png` | 6.87% | 1280x1262 / 1280x2546 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/768x1024.diff.png` | 7.16% | 768x1712 / 768x3840 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/390x844.diff.png` | 2.13% | 390x2348 / 608x8049 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | primaryButton | mismatch | high | height | `88px` | `32px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:18:11.377Z · SC-30 audit-log — role tenant-admin

- Page: `http://localhost:3100/settings/audit` · Stitch: `sc_30_immutable_audit_log_verification`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1440x900.diff.png` | 4.88% | 1440x3678 / 1440x1560 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1280x800.diff.png` | 5.34% | 1280x3678 / 1292x1680 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/768x1024.diff.png` | 4.44% | 768x3902 / 1292x2672 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/390x844.diff.png` | 2.87% | 390x4272 / 491x8188 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `84px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:18:23.895Z · SC-39 operations-console — role vendor-operator

- Page: `http://localhost:3100/vendor` · Stitch: `sc_39_vendor_operations_console`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1440x900.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1440x900.diff.png` | 5.75% | 1440x900 / 1440x1450 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1280x800.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1280x800.diff.png` | 5.81% | 1280x800 / 1280x1609 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/768x1024.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/768x1024.diff.png` | 4.47% | 768x1024 / 851x2869 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/390x844.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/390x844.diff.png` | 1.44% | 390x859 / 851x5544 | 1/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1440x900 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1280x800 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 768x1024 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 390x844 | primaryButton | mismatch | high | height | `64px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T04:47:41.789Z · SC-10 compliance-reports — role compliance-officer

- Page: `http://127.0.0.1:3100/compliance/snapshots/0215ba51-9f4f-4462-b9f2-cbf453012b04?report=R1` · Stitch: `sc_10_compliance_reports`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1440x900.diff.png` | 7.36% | 1440x2289 / 1440x1757 | 7/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/1280x800.diff.png` | 7.59% | 1280x2433 / 1280x1817 | 7/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/768x1024.diff.png` | 9.8% | 768x2772 / 768x3080 | 5/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/compliance-reports/compliance-officer/390x844.diff.png` | 4.86% | 390x4151 / 545x7057 | 4/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `none` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(230, 238, 255)` | — |

### 2026-11-12T04:47:54.916Z · SC-14 vendor-access — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/vendor-access` · Stitch: `sc_14_vendor_access_sessions_authorizations`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1440x900.diff.png` | 8.55% | 1440x1214 / 1440x2216 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/1280x800.diff.png` | 7.93% | 1280x1232 / 1280x2546 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/768x1024.diff.png` | 10.18% | 768x1644 / 768x3840 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/vendor-access/tenant-admin/390x844.diff.png` | 2.86% | 390x2181 / 608x8049 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `34px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `34px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `34px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `88px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:48:07.239Z · SC-24 imports — role tenant-admin

- Page: `http://127.0.0.1:3100/imports` · Stitch: `sc_24_data_imports` · config brace patched: sc_24_data_imports
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/data/imports/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/1440x900.diff.png` | 5.48% | 1440x900 / 1440x1369 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/data/imports/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/1280x800.diff.png` | 5.4% | 1280x800 / 1280x1547 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/data/imports/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/768x1024.diff.png` | 5.11% | 768x1024 / 768x2462 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/data/imports/tenant-admin/390x844.png` | `testing/ui-screenshots/app/data/imports/tenant-admin/390x844.diff.png` | 2.84% | 390x850 / 537x4894 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |

### 2026-11-12T04:48:19.628Z · SC-25 import-mapping — role tenant-admin

- Page: `http://127.0.0.1:3100/imports/mappings?version=5ad0fabf-3c7c-4e8b-ae92-93387953e0e1&batch=82ce26a3-013b-483c-b7f7-f3aa6af4c4e2` · Stitch: `sc_25_import_mapping` · config brace patched: sc_25_import_mapping
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1440x900.diff.png` | 7.05% | 1440x900 / 1440x1241 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/1280x800.diff.png` | 6.59% | 1280x800 / 1280x1437 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/768x1024.diff.png` | 8.43% | 768x1024 / 768x2006 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/390x844.png` | `testing/ui-screenshots/app/data/import-mapping/tenant-admin/390x844.diff.png` | 3.22% | 390x1081 / 664x3936 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:48:34.351Z · SC-26 figure-drill-down — role compliance-officer

- Page: `http://127.0.0.1:3100/compliance/snapshots/0215ba51-9f4f-4462-b9f2-cbf453012b04/rows?figure=R1.2025-01.net_sales_cents` · Stitch: `sc_26_figure_drill_down`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1440x900.diff.png` | 4.8% | 1440x2371 / 1440x1483 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/1280x800.diff.png` | 5.14% | 1280x2426 / 1280x1525 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/768x1024.diff.png` | 5.36% | 768x3462 / 768x2817 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/figure-drill-down/compliance-officer/390x844.diff.png` | 3.72% | 390x3758 / 528x4447 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:48:42.954Z · SC-27 sign-in — role anonymous

- Page: `http://127.0.0.1:3100/signin` · Stitch: `sc_27_sign_in_and_second_factor`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/auth/sign-in/anonymous/1440x900.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/1440x900.diff.png` | 4.12% | 1440x900 / 1440x1462 | 4/4 | none |
| 1280x800 | `testing/ui-screenshots/app/auth/sign-in/anonymous/1280x800.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/1280x800.diff.png` | 4.89% | 1280x800 / 1280x1462 | 4/4 | none |
| 768x1024 | `testing/ui-screenshots/app/auth/sign-in/anonymous/768x1024.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/768x1024.diff.png` | 6.73% | 768x1024 / 768x1478 | 4/4 | none |
| 390x844 | `testing/ui-screenshots/app/auth/sign-in/anonymous/390x844.png` | `testing/ui-screenshots/app/auth/sign-in/anonymous/390x844.diff.png` | 11.08% | 390x844 / 390x1737 | 4/4 | none |

Style differences: none.


### 2026-11-12T04:48:55.127Z · SC-28 users-and-roles — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/users` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1440x900.diff.png` | 7.22% | 1440x900 / 1440x1154 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/1280x800.diff.png` | 7.16% | 1280x1048 / 1280x1314 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/768x1024.diff.png` | 7.3% | 768x1333 / 768x1949 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/users-and-roles/tenant-admin/390x844.diff.png` | 3.2% | 390x1678 / 537x4179 | 1/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:49:09.890Z · SC-29 tenant-settings — role tenant-admin

- Page: `http://127.0.0.1:3100/settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.diff.png` | 4.83% | 1440x1192 / 1440x1818 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.diff.png` | 4.98% | 1280x1192 / 1280x1992 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.diff.png` | 3.31% | 768x1210 / 982x3723 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.diff.png` | 1.53% | 390x1810 / 982x8578 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `500` | — |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T04:49:23.875Z · SC-30 audit-log — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/audit` · Stitch: `sc_30_immutable_audit_log_verification`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1440x900.diff.png` | 4.89% | 1440x3938 / 1440x1560 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/1280x800.diff.png` | 5.38% | 1280x3938 / 1292x1680 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/768x1024.diff.png` | 4.47% | 768x4162 / 1292x2672 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/audit-log/tenant-admin/390x844.diff.png` | 2.92% | 390x4532 / 491x8188 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | mismatch | high | height | `36px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `84px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-12T04:49:36.133Z · SC-39 operations-console — role vendor-operator

- Page: `http://127.0.0.1:3100/vendor` · Stitch: `sc_39_vendor_operations_console`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1440x900.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1440x900.diff.png` | 5.74% | 1440x900 / 1440x1450 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1280x800.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/1280x800.diff.png` | 5.8% | 1280x800 / 1280x1609 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/768x1024.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/768x1024.diff.png` | 4.47% | 768x1024 / 851x2869 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/390x844.png` | `testing/ui-screenshots/app/vendor/operations-console/vendor-operator/390x844.diff.png` | 1.44% | 390x859 / 851x5544 | 1/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1440x900 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 1280x800 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 768x1024 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `24px` |
| 390x844 | primaryButton | mismatch | high | height | `64px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-size | `12px` | `13px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-12T04:49:50.915Z · SC-46 compliance-overview — role compliance-officer

- Page: `http://127.0.0.1:3100/compliance` · Stitch: `sc_46_compliance_overview_overlay_home`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1440x900.diff.png` | 7.74% | 1440x1299 / 1440x1567 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/1280x800.diff.png` | 7.72% | 1280x1373 / 1280x1709 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/768x1024.diff.png` | 5.59% | 768x2248 / 768x3291 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/compliance-overview/compliance-officer/390x844.diff.png` | 4.27% | 390x3108 / 458x5981 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 1280x800 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 768x1024 | primaryButton | mismatch | high | height | `30px` | `32px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `0px` | `2px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `48px` | `32px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `0px` | `2px` |

### 2026-11-16T22:01:46.414Z · SC-29 tenant-settings — role tenant-admin

- Page: `http://127.0.0.1:3100/settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.diff.png` | 4.66% | 1440x2662 / 1440x1818 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.diff.png` | 5.05% | 1280x2716 / 1280x1992 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.diff.png` | 4.61% | 768x3184 / 982x3723 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.diff.png` | 1.92% | 390x4202 / 982x8578 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |

### 2026-11-16T22:01:58.528Z · SC-13 integrations — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/integrations` · Stitch: `sc_13_integrations_and_sync_health` · config brace patched: sc_13_integrations_and_sync_health
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1440x900.diff.png` | 5.61% | 1440x900 / 1440x1513 | 6/7 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1280x800.diff.png` | 5.79% | 1280x800 / 1280x1647 | 6/7 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/768x1024.diff.png` | 4.48% | 768x1024 / 831x3141 | 4/5 | high |
| 390x844 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/390x844.diff.png` | 2.68% | 390x1292 / 553x6873 | 3/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-16T22:02:10.843Z · SC-17 market-launch-checklist — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/markets/bbc9ad7e-4517-4298-8d4d-566793fc8202` · Stitch: `sc_17_market_launch_checklist`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1440x900.diff.png` | 9.51% | 1440x1406 / 1440x1153 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1280x800.diff.png` | 9.87% | 1280x1410 / 1280x1226 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/768x1024.diff.png` | 7.1% | 768x1918 / 993x2508 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/390x844.diff.png` | 4.46% | 526x2482 / 597x4730 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |


## Increment B1 — round 1 (2026-11-17)

Harness `testing/visual/compare.ts`, role tenant-admin, session cookie from a saved storage state, app on `next start` :3100 (nmp_e2e after the B1 workflows: FR live, versions 1–11, one service account with three keys, one disabled webhook endpoint). Results `testing/visual/results/SC-{29,13,17}__tenant-admin.json`, captures `testing/ui-screenshots/app/settings/{tenant-settings,integrations,market-launch-checklist}/tenant-admin/`, run sections above (2026-11-16T22:01Z UTC). The Markets page has no Stitch reference (guidelines §9) and was judged in the browser only.

| Screen | 1440x900 | 1280x800 | 768x1024 | 390x844 | Harness findings | Judgement |
|---|---|---|---|---|---|---|
| SC-29 Tenant settings | 4.66 % | 5.05 % | 4.61 % | 1.92 % | high: primary button `#003883` vs sc_29 `#1E4FA3`; medium: table header 11 px/600 vs 12 px/700, title 20 vs 24 px at 390 | canonical sc_01 tokens (same as MVP-A, design note). Real differences are content by plan: privacy/visibility, retention, write-off, payout cards and Revert are must-not-implement in B1. Versions table content misleading (BUG-049, BUG-050) |
| SC-13 Integrations | 5.61 % | 5.79 % | 4.48 % | 2.68 % | high: page background `#F8F9FF` vs `#F8FAFC`; medium: title size at 390 | canonical background (design note). Connector cards, sync telemetry, backfill and sparkline omitted by plan. No real defect in the capture |
| SC-17 Market launch checklist | 9.51 % | 9.87 % | 7.10 % | 4.46 % | high: primary button missing in app; medium: table header weight/size, title size at 390 | "missing" primary is state, not drift: FR is Live, so Request go-live is not shown. Real differences: the gate table is clipped beside the inspector at 1440/1280 (BUG-052); the 390 capture is 526 px wide, the page scrolls sideways (BUG-051). Override, Filing Packet and statutory-lock banner omitted by plan |

Shell landmarks (header, sidebar) matched sc_01 at 1440 and 1280 on all three screens. No new style drift beyond the canonical values recorded for MVP-A.
### 2026-11-16T22:33:16.487Z · SC-29 tenant-settings — role tenant-admin

- Page: `http://127.0.0.1:3100/settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.diff.png` | 4.6% | 1440x2731 / 1440x1818 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.diff.png` | 4.75% | 1280x2929 / 1280x1992 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.diff.png` | 4.67% | 768x3287 / 982x3723 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.diff.png` | 1.93% | 390x4305 / 982x8578 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |

### 2026-11-16T22:33:28.622Z · SC-13 integrations — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/integrations` · Stitch: `sc_13_integrations_and_sync_health` · config brace patched: sc_13_integrations_and_sync_health
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1440x900.diff.png` | 5.6% | 1440x900 / 1440x1513 | 6/7 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/1280x800.diff.png` | 5.79% | 1280x800 / 1280x1647 | 6/7 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/768x1024.diff.png` | 4.48% | 768x1024 / 831x3141 | 4/5 | high |
| 390x844 | `testing/ui-screenshots/app/settings/integrations/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/integrations/tenant-admin/390x844.diff.png` | 2.68% | 390x1292 / 553x6873 | 3/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-16T22:33:41.214Z · SC-17 market-launch-checklist — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/markets/5d0b3dd0-2498-43fe-8035-905c30c697cd` · Stitch: `sc_17_market_launch_checklist`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1440x900.diff.png` | 10.24% | 1440x1319 / 1440x1153 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/1280x800.diff.png` | 8.57% | 1280x1743 / 1280x1226 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/768x1024.diff.png` | 7.09% | 768x1915 / 993x2508 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/market-launch-checklist/tenant-admin/390x844.diff.png` | 4.08% | 390x2430 / 597x4730 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(220, 233, 255)` | `rgb(239, 244, 255)` |


## Increment B1 — round 2 (2026-11-17)

Harness runs above dated 2026-11-16T22:33Z (UTC): role tenant-admin, `--url` on `next start` :3100, cookie from the saved storage state; `nmp_e2e` after the round-2 workflows (FR live, versions 1–12, one service account with keys, one disabled webhook endpoint).

| Screen | 1440x900 | 1280x800 | 768x1024 | 390x844 | Harness findings | Judgement |
|---|---|---|---|---|---|---|
| SC-29 Tenant settings | 4.60 % | 4.75 % | 4.67 % | 1.93 % | as round 1 (canonical primary colour, table header weight, title size at 390) | design notes only; versions table now shows requester as Author and the right changed key (BUG-049/050 fixed) |
| SC-13 Integrations | 5.60 % | 5.79 % | 4.48 % | 2.68 % | as round 1 (canonical background, title size at 390) | no real defect |
| SC-17 Market launch checklist | 10.24 % | 8.57 % | 7.09 % | 4.08 % | as round 1: primary button "missing" (FR is Live, no Request go-live), table header weight/size | BUG-051 fixed: capture 390 px wide (round 1: 526). BUG-052 fixed: all four columns visible beside the inspector at 1440, inspector below at 1280. New BUG-060 LOW: "mandatory" split mid-word in the inspector's rule line (`break-all`). Higher 1440 % is the taller page (1319 vs 1153 px reference) |

Shell landmarks matched sc_01 at 1440 and 1280 on all three screens. No new style drift.
## Increment B2 — round 1 (2026-11-17)

Harness runs below dated 2026-11-17T11:15–11:17Z (UTC): `--url` on `next start` :3100, cookie from each user's saved storage state; `nmp_e2e` after the B2 workflows (types DIST/RETAIL, NL v1, participants A–E, K, buyers NL-N1…N5, 4 cases, 9 orders, connector "NL Shopify store"). Results `testing/visual/results/{SC-09,SC-08}__support-agent.json`, `{SC-07,SC-32}__commission-analyst.json`, `{SC-06,SC-06-detail}__compliance-officer.json`, `{SC-31,SC-13-connectors,SC-29}__tenant-admin.json`; captures under `testing/ui-screenshots/app/{people,cases,orders,settings}/`. People list has no Stitch reference (guidelines §9) and was judged in the browser only.

| Screen | 1440x900 | 1280x800 | 768x1024 | 390x844 | Harness findings | Judgement |
|---|---|---|---|---|---|---|
| SC-09 Participant record | 7.04 % | 7.05 % | 5.35 % | 2.20 % | high: primary `#003883` vs `#1E4FA3`; table header "missing" (overview tab has no table); medium: title 20 vs 24 px at 390 | canonical tokens (design note). Header, tabs and masked identity card follow sc_09; stat cards, payout/tax panels, ledger statement and "View All 42" omitted by plan. No real defect in the capture |
| SC-07 Genealogy explorer | 8.82 % | 8.70 % | 6.08 % | 4.13 % | medium: title size at 390 only | faithful: controls bar, read-model line, breadcrumb, focused node card, lazy children list, inspector. Graph view, volume bars, path audit omitted by plan |
| SC-08 Genealogy case (new) | 8.16 % | 7.91 % | 6.23 % | 2.28 % | high: page font 16 vs 14 px; section heading and table header "missing"; primary weight 600 vs 500; medium: card radius | Stitch draws a queue table and section headings that the form tab does not have (content, not drift); page 16 px base is the canonical body size (as MVP-A). Dual sign-off and money tables omitted by plan |
| SC-06 Cases | 4.75 % | 4.78 % | 5.40 % | 2.86 % | high: section heading and primary "missing"; medium: card radius 8 vs 2 px | primary missing = "+ Create Manual Adjustment Case" is must-not-implement; KPI card radius is the shared KPI card (note). Queue subject column lacks the reference (BUG-070) |
| SC-06 Case detail | 4.68 % | 4.80 % | 5.47 % | 2.85 % | high: primary "missing" (case approved, no decision bar by state); medium: section label 12 px uppercase vs 16 px | state, not drift; the 12 px uppercase labels follow sc_06's card labels in the app's shared style (note). BUG-078, BUG-080 seen in the capture |
| SC-31 Orders and returns | 6.99 % | 6.87 % | 6.07 % | 3.18 % | high: page font 16 vs 14 px; primary "missing"; medium: title weight 600 vs 700, table header 11 px/600 | primary missing = "Ingest Manual Order Batch" (must-not). Columns wrap beside the inspector at 1440 exactly as sc_31 draws them. Connector source shown as uuid (BUG-076) |
| SC-32 Late-transaction queue | 5.11 % | 5.03 % | 4.53 % | 2.17 % | high: primary "missing"; medium: table header size/weight/colour | primary is the bulk "Accept proposed handling", shown only with a selection (state). 390: empty-state text clipped in the scrolling table (BUG-072). Money as "minor units" (BUG-071) |
| SC-13 Connectors tab | 5.42 % | 5.62 % | 4.47 % | 2.71 % | high: page background `#F8F9FF` vs `#F8FAFC`; medium: title size at 390 | canonical background (as B1). Connector card follows sc_13; telemetry and provider cards omitted by plan |
| SC-29 Tenant settings | 3.40 % | 3.56 % | 4.00 % | 2.43 % | high: primary colour/weight; medium: table header, title at 390. Capture widths 1485 and 1378 px | real defect: the Downline depth masking card overflows and the page scrolls sideways at 1440 and 1280 (BUG-069); other findings canonical |

Shell landmarks (header, sidebar) matched sc_01 at 1440 and 1280 on all nine runs. Real differences: BUG-069 (MEDIUM), BUG-072, BUG-076 (LOW, visible in captures); everything else is canonical-token drift already recorded for MVP-A, state-dependent landmarks, or content removed by PLAN §5 must-not lists.

### 2026-11-17T11:15:28.905Z · SC-09 participant-record — role support-agent

- Page: `http://127.0.0.1:3100/people/919429c2-6c02-4347-8e83-a130be779563` · Stitch: `sc_09_participant_deep_fact_record`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/participant-record/support-agent/1440x900.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/1440x900.diff.png` | 7.04% | 1440x900 / 1440x1824 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/people/participant-record/support-agent/1280x800.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/1280x800.diff.png` | 7.05% | 1280x800 / 1280x2042 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/people/participant-record/support-agent/768x1024.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/768x1024.diff.png` | 5.35% | 768x1024 / 768x3612 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/people/participant-record/support-agent/390x844.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/390x844.diff.png` | 2.2% | 390x1020 / 601x7545 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |

### 2026-11-17T11:15:43.229Z · SC-07 genealogy-explorer — role commission-analyst

- Page: `http://127.0.0.1:3100/genealogy?root=3f92963a-096f-42dd-915c-3ee1879bd6c8` · Stitch: `sc_07_genealogy_explorer_staff_as_of`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1440x900.diff.png` | 8.82% | 1440x900 / 1440x1685 | 6/6 | info |
| 1280x800 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1280x800.diff.png` | 8.7% | 1280x831 / 1280x1837 | 6/6 | info |
| 768x1024 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/768x1024.diff.png` | 6.08% | 768x1300 / 774x3271 | 4/4 | info |
| 390x844 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/390x844.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/390x844.diff.png` | 4.13% | 390x1613 / 502x7995 | 3/4 | medium |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-17T11:15:58.832Z · SC-08 genealogy-case — role support-agent

- Page: `http://127.0.0.1:3100/cases/genealogy/new` · Stitch: `sc_08_genealogy_change_and_duplicate_cases`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1440x900.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1440x900.diff.png` | 8.16% | 1440x1018 / 1440x1965 | 3/8 | high |
| 1280x800 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1280x800.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1280x800.diff.png` | 7.91% | 1280x1018 / 1280x2188 | 3/8 | high |
| 768x1024 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/768x1024.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/768x1024.diff.png` | 6.23% | 768x1054 / 824x4013 | 1/6 | high |
| 390x844 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/390x844.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/390x844.diff.png` | 2.28% | 390x1338 / 824x9261 | 0/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 390x844 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 390x844 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |

### 2026-11-17T11:16:11.952Z · SC-06 cases — role compliance-officer

- Page: `http://127.0.0.1:3100/cases` · Stitch: `sc_06_cases_exceptions`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/cases/cases/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/1440x900.diff.png` | 4.75% | 1440x900 / 1440x1866 | 4/7 | high |
| 1280x800 | `testing/ui-screenshots/app/cases/cases/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/1280x800.diff.png` | 4.78% | 1280x815 / 1280x2066 | 4/7 | high |
| 768x1024 | `testing/ui-screenshots/app/cases/cases/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/768x1024.diff.png` | 5.4% | 768x1105 / 768x2891 | 2/5 | high |
| 390x844 | `testing/ui-screenshots/app/cases/cases/compliance-officer/390x844.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/390x844.diff.png` | 2.86% | 390x2041 / 512x6697 | 1/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 1280x800 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 768x1024 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 390x844 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 390x844 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `8px` |

### 2026-11-17T11:16:26.846Z · SC-06-detail case-detail — role compliance-officer

- Page: `http://127.0.0.1:3100/cases/52dc1234-90f3-459c-85ba-99e482397c6c` · Stitch: `sc_06_cases_exceptions`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1440x900.diff.png` | 4.68% | 1440x900 / 1440x1866 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1280x800.diff.png` | 4.8% | 1280x869 / 1280x2066 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/768x1024.diff.png` | 5.47% | 768x1148 / 768x2891 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/390x844.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/390x844.diff.png` | 2.85% | 390x1465 / 512x6697 | 2/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 1440x900 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 1280x800 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 768x1024 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 390x844 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-17T11:16:47.323Z · SC-31 orders — role tenant-admin

- Page: `http://127.0.0.1:3100/orders?order=bc756369-d92c-4d86-865c-a3aa7940975f` · Stitch: `sc_31_ingested_orders_returns_explorer`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/orders/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/1440x900.diff.png` | 6.99% | 1440x1492 / 1440x1760 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/orders/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/1280x800.diff.png` | 6.87% | 1280x1516 / 1280x1946 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/orders/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/768x1024.diff.png` | 6.07% | 768x2532 / 768x3416 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/orders/tenant-admin/390x844.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/390x844.diff.png` | 3.18% | 390x3178 / 681x6164 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `30px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `30px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `30px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `84px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-17T11:17:00.319Z · SC-32 late-transactions — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/late` · Stitch: `sc_32_late_transaction_queue`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.diff.png` | 5.11% | 1440x900 / 1440x1434 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.diff.png` | 5.03% | 1280x800 / 1280x1714 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.diff.png` | 4.53% | 768x1024 / 768x2678 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.diff.png` | 2.17% | 390x1102 / 538x5664 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-17T11:17:13.834Z · SC-13-connectors integrations-connectors — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/integrations?tab=connectors` · Stitch: `sc_13_integrations_and_sync_health` · config brace patched: sc_13_integrations_and_sync_health
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1440x900.diff.png` | 5.42% | 1440x900 / 1440x1513 | 6/7 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1280x800.diff.png` | 5.62% | 1280x800 / 1280x1647 | 6/7 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/768x1024.diff.png` | 4.47% | 768x1024 / 831x3141 | 4/5 | high |
| 390x844 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/390x844.diff.png` | 2.71% | 390x1362 / 553x6873 | 3/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-17T11:17:29.240Z · SC-29 tenant-settings — role tenant-admin

- Page: `http://127.0.0.1:3100/settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.diff.png` | 3.4% | 1485x4463 / 1440x1818 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.diff.png` | 3.56% | 1378x4551 / 1280x1992 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.diff.png` | 4% | 768x5470 / 982x3723 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.diff.png` | 2.43% | 390x7772 / 982x8578 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |

## Increment B2 — round 2 (2026-11-17, retest after the fixes of BUG-069..080)

Harness runs below are dated 2026-11-17T15:41–15:45Z (UTC). They used `--url` on `next start` :3100 (build of 17:36, with no source file newer), with the cookie taken from each user's storage state. The data was `nmp_e2e`, reseeded and rebuilt by the round-2 workflows: types DIST/RETAIL, NL v1, participants A–F, K and buyers NL-N2/N3, a change case, a duplicate case and a transfer case, 7 orders, and the connector "NL Shopify store". SC-07 and SC-31 ran first without their query state (`?root`, `?order`), so the focused-node and inspector landmarks were missing. They were run again with `?root=<P-A>` and `?order=<O-1001>`, and those reruns (15:44Z, the last two sections) are the ones that count. Results are in `testing/visual/results/*.json` (overwritten), captures in `testing/ui-screenshots/app/{people,cases,orders,settings}/`, and logs in `var/qa-b2/R2-visual-*.log`.

| Screen | 1440x900 | 1280x800 | 768x1024 | 390x844 | Harness findings | Judgement |
|---|---|---|---|---|---|---|
| SC-09 Participant record | 7.04 % | 7.05 % | 5.35 % | 2.20 % | high: primary colour; table header missing (overview tab); medium: title at 390 | same as round 1: canonical tokens and plan omissions. No real defect |
| SC-07 Genealogy explorer (`?root=P-A`) | 8.82 % | 8.70 % | 6.08 % | 4.13 % | medium: title size at 390 only | faithful, same as round 1 |
| SC-08 Genealogy case (new) | 8.16 % | 7.91 % | 6.23 % | 2.28 % | high: page font 16 vs 14 px; section heading/table header missing; primary weight; medium: card radius | same as round 1 (content and canonical body size) |
| SC-06 Cases | 4.66 % | 4.70 % | 5.28 % | 2.78 % | high: section heading and primary missing; medium: KPI card radius | primary = must-not "Create Manual Adjustment Case". The Subject column now names the subject (BUG-070 fixed) |
| SC-06 Case detail | 4.67 % | 4.80 % | 5.47 % | 2.85 % | high: primary missing (approved case); medium: section label | state, not drift. Evidence "1 KB" (BUG-078 fixed); subject "P-C" and "Parent when submitted" (BUG-080 fixed) |
| SC-31 Orders and returns (`?order=O-1001`) | 6.65 % | 6.49 % | 5.84 % | 3.02 % | high: page font; primary missing; medium: title weight, table header | same as round 1. Connector orders show "NL Shopify store · NL" (BUG-076 fixed). The exception queue (not a harness route) still shows `connector:<uuid>` (BUG-082) |
| SC-32 Late-transaction queue | 4.96 % | 4.87 % | 4.35 % | 2.10 % | high: primary missing (bulk action needs a selection); medium: table header | state. Money is now "25.00 EUR" (BUG-071 fixed). The 390 empty state sits under the table and is not clipped (BUG-072 fixed, `var/qa-b2/R2-390-late.png`) |
| SC-13 Connectors tab | 5.43 % | 5.62 % | 4.47 % | 2.71 % | high: page background (canonical); medium: title at 390 | same as round 1 |
| SC-29 Tenant settings | 3.43 % | 3.77 % | 3.92 % | 2.43 % | high: primary colour/weight; medium: table header, title at 390. Captures are 1440 and 1280 px wide (round 1: 1485 / 1378) | BUG-069 fixed: no horizontal page scroll at any width, and the masking row is stacked inside its card (`var/qa-b2/R2-sc29-masking-card-1280.png`). The rest is canonical |

Shell landmarks (header, sidebar) matched sc_01 at 1440 and 1280 on every run. The round has no new visual defect. BUG-069 and BUG-072 are confirmed fixed in the captures. The other flags are canonical-token drift, page state, or content removed by the PLAN §5 must-not lists, as in round 1.

### 2026-11-17T15:41:43.425Z · SC-09 participant-record — role support-agent

- Page: `http://127.0.0.1:3100/people/0a76ef62-fbc8-478b-a791-3785d852dc35` · Stitch: `sc_09_participant_deep_fact_record`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/participant-record/support-agent/1440x900.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/1440x900.diff.png` | 7.04% | 1440x900 / 1440x1824 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/people/participant-record/support-agent/1280x800.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/1280x800.diff.png` | 7.05% | 1280x800 / 1280x2042 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/people/participant-record/support-agent/768x1024.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/768x1024.diff.png` | 5.35% | 768x1024 / 768x3612 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/people/participant-record/support-agent/390x844.png` | `testing/ui-screenshots/app/people/participant-record/support-agent/390x844.diff.png` | 2.2% | 390x1020 / 601x7545 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(67, 71, 82)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.6px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgba(239, 244, 255, 0.7)` | — |

### 2026-11-17T15:41:57.546Z · SC-08 genealogy-case — role support-agent

- Page: `http://127.0.0.1:3100/cases/genealogy/new` · Stitch: `sc_08_genealogy_change_and_duplicate_cases`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1440x900.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1440x900.diff.png` | 8.16% | 1440x1018 / 1440x1965 | 3/8 | high |
| 1280x800 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1280x800.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/1280x800.diff.png` | 7.91% | 1280x1018 / 1280x2188 | 3/8 | high |
| 768x1024 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/768x1024.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/768x1024.diff.png` | 6.23% | 768x1054 / 824x4013 | 1/6 | high |
| 390x844 | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/390x844.png` | `testing/ui-screenshots/app/cases/genealogy-case/support-agent/390x844.diff.png` | 2.28% | 390x1338 / 824x9261 | 0/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1440x900 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1440x900 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1440x900 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 1280x800 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 1280x800 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 1280x800 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 768x1024 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 768x1024 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 768x1024 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 390x844 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 390x844 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | tableHeader | missing-in-app | high | font-size | `12px` | — |
| 390x844 | tableHeader | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | missing-in-app | high | color | `rgb(86, 94, 116)` | — |
| 390x844 | tableHeader | missing-in-app | high | text-transform | `uppercase` | — |
| 390x844 | tableHeader | missing-in-app | high | letter-spacing | `0.12px` | — |
| 390x844 | tableHeader | missing-in-app | high | background | `rgb(239, 244, 255)` | — |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `0px 0px 2px 2px` |

### 2026-11-17T15:42:11.308Z · SC-07 genealogy-explorer — role commission-analyst

- Page: `http://127.0.0.1:3100/genealogy` · Stitch: `sc_07_genealogy_explorer_staff_as_of`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1440x900.diff.png` | 6.84% | 1440x900 / 1440x1685 | 4/6 | high |
| 1280x800 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1280x800.diff.png` | 7.18% | 1280x800 / 1280x1837 | 4/6 | high |
| 768x1024 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/768x1024.diff.png` | 4.3% | 768x1024 / 774x3271 | 2/4 | high |
| 390x844 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/390x844.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/390x844.diff.png` | 3.29% | 390x844 / 502x7995 | 1/4 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | mismatch | medium | font-size | `20px` | `16px` |
| 1440x900 | sectionHeading | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `28px` | `24px` |
| 1440x900 | sectionHeading | mismatch | medium | color | `rgb(255, 255, 255)` | `rgb(13, 28, 46)` |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1440x900 | card | missing-in-app | high | border-radius | `8px` | — |
| 1440x900 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 1440x900 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |
| 1280x800 | sectionHeading | mismatch | medium | font-size | `20px` | `16px` |
| 1280x800 | sectionHeading | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `28px` | `24px` |
| 1280x800 | sectionHeading | mismatch | medium | color | `rgb(255, 255, 255)` | `rgb(13, 28, 46)` |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | card | missing-in-app | high | border-radius | `8px` | — |
| 1280x800 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 1280x800 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |
| 768x1024 | sectionHeading | mismatch | medium | font-size | `20px` | `16px` |
| 768x1024 | sectionHeading | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `28px` | `24px` |
| 768x1024 | sectionHeading | mismatch | medium | color | `rgb(255, 255, 255)` | `rgb(13, 28, 46)` |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | card | missing-in-app | high | border-radius | `8px` | — |
| 768x1024 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 768x1024 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | font-size | `20px` | `16px` |
| 390x844 | sectionHeading | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `28px` | `24px` |
| 390x844 | sectionHeading | mismatch | medium | color | `rgb(255, 255, 255)` | `rgb(13, 28, 46)` |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | card | missing-in-app | high | border-radius | `8px` | — |
| 390x844 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 390x844 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |

### 2026-11-17T15:42:25.806Z · SC-32 late-transactions — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/late` · Stitch: `sc_32_late_transaction_queue`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.diff.png` | 4.96% | 1440x900 / 1440x1434 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.diff.png` | 4.87% | 1280x800 / 1280x1714 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.diff.png` | 4.35% | 768x1024 / 768x2678 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.diff.png` | 2.1% | 390x1113 / 538x5664 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-17T15:42:40.158Z · SC-06 cases — role compliance-officer

- Page: `http://127.0.0.1:3100/cases` · Stitch: `sc_06_cases_exceptions`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/cases/cases/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/1440x900.diff.png` | 4.66% | 1440x900 / 1440x1866 | 4/7 | high |
| 1280x800 | `testing/ui-screenshots/app/cases/cases/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/1280x800.diff.png` | 4.7% | 1280x800 / 1280x2066 | 4/7 | high |
| 768x1024 | `testing/ui-screenshots/app/cases/cases/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/768x1024.diff.png` | 5.28% | 768x1024 / 768x2891 | 2/5 | high |
| 390x844 | `testing/ui-screenshots/app/cases/cases/compliance-officer/390x844.png` | `testing/ui-screenshots/app/cases/cases/compliance-officer/390x844.diff.png` | 2.78% | 390x1841 / 512x6697 | 1/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 1280x800 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 768x1024 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-weight | `600` | — |
| 390x844 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 390x844 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `8px` |

### 2026-11-17T15:42:53.955Z · SC-06-detail case-detail — role compliance-officer

- Page: `http://127.0.0.1:3100/cases/d97e1c32-c0b2-4391-8f94-4ee2f18971e2` · Stitch: `sc_06_cases_exceptions`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1440x900.diff.png` | 4.67% | 1440x900 / 1440x1866 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/1280x800.diff.png` | 4.8% | 1280x869 / 1280x2066 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/768x1024.diff.png` | 5.47% | 768x1148 / 768x2891 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/390x844.png` | `testing/ui-screenshots/app/cases/case-detail/compliance-officer/390x844.diff.png` | 2.85% | 390x1465 / 512x6697 | 2/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 1440x900 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 1280x800 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 768x1024 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | font-size | `16px` | `12px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `24px` | `16px` |
| 390x844 | sectionHeading | mismatch | medium | color | `rgb(13, 28, 46)` | `rgb(86, 94, 116)` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(30, 79, 163)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-17T15:43:07.488Z · SC-31 orders — role tenant-admin

- Page: `http://127.0.0.1:3100/orders` · Stitch: `sc_31_ingested_orders_returns_explorer`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/orders/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/1440x900.diff.png` | 6.45% | 1440x1023 / 1440x1760 | 2/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/orders/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/1280x800.diff.png` | 6.27% | 1280x1118 / 1280x1946 | 2/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/orders/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/768x1024.diff.png` | 5.61% | 768x1368 / 768x3416 | 0/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/orders/tenant-admin/390x844.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/390x844.diff.png` | 2.86% | 390x1960 / 681x6164 | 0/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1440x900 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `30px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | missing-in-app | high | border-radius | `4px` | — |
| 1440x900 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 1440x900 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 1280x800 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `30px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | missing-in-app | high | border-radius | `4px` | — |
| 1280x800 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 1280x800 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 768x1024 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `30px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | missing-in-app | high | border-radius | `4px` | — |
| 768x1024 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 768x1024 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-size | `16px` | — |
| 390x844 | sectionHeading | missing-in-app | high | font-weight | `700` | — |
| 390x844 | sectionHeading | missing-in-app | high | line-height | `24px` | — |
| 390x844 | sectionHeading | missing-in-app | high | color | `rgb(13, 28, 46)` | — |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `84px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | missing-in-app | high | border-radius | `4px` | — |
| 390x844 | card | missing-in-app | high | box-shadow | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | — |
| 390x844 | card | missing-in-app | high | background-color | `rgb(255, 255, 255)` | — |

### 2026-11-17T15:43:20.723Z · SC-13-connectors integrations-connectors — role tenant-admin

- Page: `http://127.0.0.1:3100/settings/integrations?tab=connectors` · Stitch: `sc_13_integrations_and_sync_health` · config brace patched: sc_13_integrations_and_sync_health
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1440x900.diff.png` | 5.43% | 1440x900 / 1440x1513 | 6/7 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/1280x800.diff.png` | 5.62% | 1280x800 / 1280x1647 | 6/7 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/768x1024.diff.png` | 4.47% | 768x1024 / 831x3141 | 4/5 | high |
| 390x844 | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/integrations-connectors/tenant-admin/390x844.diff.png` | 2.71% | 390x1362 / 553x6873 | 3/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-17T15:43:36.397Z · SC-29 tenant-settings — role tenant-admin

- Page: `http://127.0.0.1:3100/settings` · Stitch: `sc_29_tenant_settings`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1440x900.diff.png` | 3.43% | 1440x4412 / 1440x1818 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/1280x800.diff.png` | 3.77% | 1280x4462 / 1280x1992 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/768x1024.diff.png` | 3.92% | 768x5431 / 982x3723 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.png` | `testing/ui-screenshots/app/settings/tenant-settings/tenant-admin/390x844.diff.png` | 2.43% | 390x7625 / 982x8578 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |

### 2026-11-17T15:44:38.351Z · SC-07 genealogy-explorer — role commission-analyst

- Page: `http://127.0.0.1:3100/genealogy?root=6df38cdb-82a2-4cc4-8b3a-3ddbe23c90c6` · Stitch: `sc_07_genealogy_explorer_staff_as_of`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1440x900.diff.png` | 8.82% | 1440x900 / 1440x1685 | 6/6 | info |
| 1280x800 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/1280x800.diff.png` | 8.7% | 1280x831 / 1280x1837 | 6/6 | info |
| 768x1024 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/768x1024.diff.png` | 6.08% | 768x1300 / 774x3271 | 4/4 | info |
| 390x844 | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/390x844.png` | `testing/ui-screenshots/app/people/genealogy-explorer/commission-analyst/390x844.diff.png` | 4.13% | 390x1613 / 502x7995 | 3/4 | medium |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | absent-in-stitch | info | — | — | — |
| 1280x800 | tableHeader | absent-in-stitch | info | — | — | — |
| 768x1024 | tableHeader | absent-in-stitch | info | — | — | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | absent-in-stitch | info | — | — | — |

### 2026-11-17T15:44:50.893Z · SC-31 orders — role tenant-admin

- Page: `http://127.0.0.1:3100/orders?order=cc312419-77ef-4abb-a48c-0169b9ed07cb` · Stitch: `sc_31_ingested_orders_returns_explorer`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/orders/tenant-admin/1440x900.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/1440x900.diff.png` | 6.65% | 1440x1328 / 1440x1760 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/orders/tenant-admin/1280x800.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/1280x800.diff.png` | 6.49% | 1280x1352 / 1280x1946 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/orders/tenant-admin/768x1024.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/768x1024.diff.png` | 5.84% | 768x2056 / 768x3416 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/orders/tenant-admin/390x844.png` | `testing/ui-screenshots/app/orders/orders/tenant-admin/390x844.diff.png` | 3.02% | 390x2630 / 681x6164 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `30px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `30px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `30px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `84px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

## Increment B3 — round 1 (2026-11-18)

Harness runs below dated 2026-11-17T21:07–21:09Z (UTC): `--url` on `next start` :3100 (build of 2026-11-18 02:29 +06, no source newer than `.next/BUILD_ID`), cookie from each user's saved storage state; `nmp_e2e` after the W-B3-1..8 workflows (plan DE core v1 active, v2 draft with cap `total_cap`, DE periods Aug/Sep/Oct 2026 committed, restatement applied). Results `testing/visual/results/<SC>__<role>.json`, captures `testing/ui-screenshots/app/{periods,people,plans,compliance}/…`. Harness logs `var/qa-b3/R1-visual-*.log`.

| Screen | 1440x900 | 1280x800 | 768x1024 | 390x844 | Harness findings | Judgement |
|---|---|---|---|---|---|---|
| SC-01 Periods and runs | 5.91 % | 5.75 % | 6.25 % | 3.86 % | high: primary "missing"; medium: title 20 px at 390 | primary missing = state (the newest unfinished period, Nov 2026, has not reached its cut-off, so neither Calculate nor Open review applies). Shell, timeline, KPI cards, calendar tabs, diagnostics panel follow sc_01. **Real difference:** the period table is cramped at 1440/1280 — period and cut-off cells wrap to five lines, the Blockers column is ~80 px and wraps per word, future rows repeat two blocker sentences, rows reach 170 px (BUG-089) |
| SC-02 Run review | 5.00 % | 4.53 % | 4.10 % | 3.12 % | high: primary "missing"; medium: title 24 vs 16 px, table header 11 px, card radius 8 vs 4 px | captured on the committed Aug run, so no approval bar / commit button (state). Trace is a drawer, not sc_02's right column (PLAN §5 trace drawer); "Mandatory sign-off checklist", hardware key, Reject, "& Post" omitted by plan. Title size = the shared PageHeader (canonical) |
| SC-43 Qualification | 5.88 % | 5.45 % | 6.13 % | 3.81 % | high: primary height 32 vs 34 px, weight 600 vs 400; medium: table header 11 px | canonical button and table-header tokens. Metric cards, period matrix and Compare periods follow sc_43; leg bars, Export CSV, dispute row omitted by plan. Measures print raw minor units ("50,000" for 500.00 pv, BUG-090) |
| SC-32 Late queue (touch) | 5.05 % | 5.06 % | 4.24 % | 2.14 % | high: primary "missing" (bulk accept needs a selection); medium: table header | state + canonical tokens; consumed item lacks "Adjusted in run" (BUG-086) |
| SC-04 Plans list (sc_28 pattern) | 5.47 % | 5.43 % | 5.68 % | 2.51 % | high: page background `#F8F9FF` vs `#F8FAFC`, primary `#003883` vs `#1E4FA3`; medium: section heading 20 vs 16 px, table header, card radius | canonical tokens, as every sc_28-pattern screen since MVP-A (note) |
| SC-04 Plan version | 6.22 % | 6.16 % | 6.72 % | 4.38 % | high: primary colour/weight; medium: title weight 600 vs 700 and colour ink vs primary | canonical tokens. Header facts strip, KPI cards, tab bar, pass-grouped rules with plain-language lines, sticky governance bar with gate checklist follow sc_04. "Projected Payout Total" renamed "Simulated payout total", Market Filings tab, compliance memo, audit dossier omitted by plan |
| SC-05 Caps and pools | 6.01 % | 6.39 % | 5.28 % | 1.31 % | high: page font 16 vs 14 px, primary font 13 vs 16 px | canonical body size / button size. KPI strip, precedence list with Up/Down, cap form (scope, base, method radio, residue line), pools, preview table follow sc_05; Export Cap Model, Reset Default Invariants omitted by plan |
| SC-42 Simulation | 5.80 % | 5.80 % | 3.88 % | 1.73 % | high: primary height 32 vs 40 px, weight; medium: table header, card radius | canonical tokens. "Staff only" banner, KPI cards, tabs (payee impact, by bonus, distribution buckets, cap effects, golden) follow sc_42. Warning list prints the raw outcome code `acknowledgement_required` (BUG-092) |
| SC-11 Guardrails | 8.86 % | 8.35 % | 7.23 % | 3.02 % | medium: table header 11 px and colour, card radius 8 vs 2 px | canonical tokens (exit 0, no high). KPI cards, filters, decision table, inspector drawer with override form follow sc_11; "Evaluate Active Comp Plans", rule designer, manual, statutory cite, export omitted by plan |

Shell landmarks (header, sidebar) matched sc_01 at 1440 and 1280 on all nine runs. No page scrolls sideways at any of the four widths (also checked in the browser on 13 B3 routes at 390 and 768: `scrollWidth = clientWidth`, no element past the viewport outside a scrolling container). Real differences this round: BUG-089 (MEDIUM, SC-01 table at desktop widths) and the content defects BUG-086, BUG-090, BUG-092 visible in the captures; everything else is canonical-token drift already recorded since MVP-A, state-dependent landmarks, or content removed by PLAN §5 must-not lists.

### 2026-11-17T21:07:36.695Z · SC-01 periods-runs — role commission-analyst

- Page: `http://127.0.0.1:3100/periods` · Stitch: `sc_01_periods_runs_analyst_home`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1440x900.diff.png` | 5.91% | 1440x1683 / 1440x1383 | 7/8 | high |
| 1280x800 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1280x800.diff.png` | 5.75% | 1280x1861 / 1280x1571 | 7/8 | high |
| 768x1024 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/768x1024.diff.png` | 6.25% | 768x2254 / 768x2572 | 5/6 | high |
| 390x844 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/390x844.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/390x844.diff.png` | 3.86% | 390x3394 / 541x5229 | 4/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |

### 2026-11-17T21:07:48.670Z · SC-02 run-review — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/377df309-346c-4ca8-b15f-f7bb1ab31671/runs/5ef06f6e-d03e-4009-89a9-beb27cab202c/review` · Stitch: `sc_02_run_review`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1440x900.diff.png` | 5% | 1440x900 / 1440x1866 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1280x800.diff.png` | 4.53% | 1280x800 / 1280x1982 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/768x1024.diff.png` | 4.1% | 768x1024 / 768x3009 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/390x844.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/390x844.diff.png` | 3.12% | 390x1216 / 484x6037 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | mismatch | medium | font-size | `16px` | `24px` |
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | title | mismatch | medium | line-height | `24px` | `32px` |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `36px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 1280x800 | title | mismatch | medium | font-size | `16px` | `24px` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | title | mismatch | medium | line-height | `24px` | `32px` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `36px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 768x1024 | title | mismatch | medium | font-size | `16px` | `24px` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | title | mismatch | medium | line-height | `24px` | `32px` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `36px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `16px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `24px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `36px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `4px` | `8px` |

### 2026-11-17T21:08:01.373Z · SC-43 qualification — role commission-analyst

- Page: `http://127.0.0.1:3100/people/6b412f84-a2f5-4fdb-ba42-ebfb0a08e4ad/qualification` · Stitch: `sc_43_rank_and_qualification_detail_staff`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/qualification/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/1440x900.diff.png` | 5.88% | 1440x1372 / 1440x1526 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/people/qualification/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/1280x800.diff.png` | 5.45% | 1280x1426 / 1280x1737 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/people/qualification/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/768x1024.diff.png` | 6.13% | 768x1690 / 768x2637 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/people/qualification/commission-analyst/390x844.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/390x844.diff.png` | 3.81% | 390x2268 / 434x5659 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `88px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |

### 2026-11-17T21:08:13.161Z · SC-32 late-transactions — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/late?state=consumed` · Stitch: `sc_32_late_transaction_queue`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.diff.png` | 5.05% | 1440x900 / 1440x1434 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.diff.png` | 5.06% | 1280x800 / 1280x1714 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.diff.png` | 4.24% | 768x1024 / 768x2678 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.diff.png` | 2.14% | 390x923 / 538x5664 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-17T21:08:25.010Z · SC-04-list plans — role plan-administrator

- Page: `http://127.0.0.1:3100/plans` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/plans/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/1440x900.diff.png` | 5.47% | 1440x900 / 1440x1154 | 3/8 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/plans/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/1280x800.diff.png` | 5.43% | 1280x800 / 1280x1314 | 3/8 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/plans/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/768x1024.diff.png` | 5.68% | 768x1024 / 768x1949 | 1/6 | high |
| 390x844 | `testing/ui-screenshots/app/plans/plans/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/390x844.diff.png` | 2.51% | 390x844 / 537x4179 | 0/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `4px` |

### 2026-11-17T21:08:37.722Z · SC-04 plan-version — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/ccb1200a-047d-4229-aba7-7ef570e5cb4e/versions/1` · Stitch: `sc_04_plan_versions_simulation`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1440x900.diff.png` | 6.22% | 1440x1787 / 1440x1583 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1280x800.diff.png` | 6.16% | 1280x1803 / 1280x1759 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/768x1024.diff.png` | 6.72% | 768x2003 / 768x2951 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/390x844.diff.png` | 4.38% | 390x2765 / 489x6853 | 3/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |

### 2026-11-17T21:08:50.062Z · SC-05 caps-and-pools — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/ccb1200a-047d-4229-aba7-7ef570e5cb4e/versions/2/caps?preview=5c6715e8-c392-43ae-a6b1-8ed0e0c86c17` · Stitch: `sc_05_cap_and_pool_configuration`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1440x900.diff.png` | 6.01% | 1440x900 / 1440x1941 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1280x800.diff.png` | 6.39% | 1280x800 / 1280x2055 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/768x1024.diff.png` | 5.28% | 768x1049 / 768x4021 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/390x844.diff.png` | 1.31% | 390x1477 / 599x10872 | 2/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | font-size | `16px` | `13px` |

### 2026-11-17T21:09:02.497Z · SC-42 simulation — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/ccb1200a-047d-4229-aba7-7ef570e5cb4e/versions/2/simulations/5c6715e8-c392-43ae-a6b1-8ed0e0c86c17` · Stitch: `sc_42_simulation_results_golden_datasets`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1440x900.diff.png` | 5.8% | 1440x966 / 1440x1762 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1280x800.diff.png` | 5.8% | 1280x966 / 1280x1920 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/768x1024.diff.png` | 3.88% | 768x1110 / 996x3406 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/390x844.diff.png` | 1.73% | 390x1607 / 694x7915 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 1280x800 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 768x1024 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | card | mismatch | medium | border-radius | `4px` | `8px` |

### 2026-11-17T21:09:14.154Z · SC-11 guardrails — role compliance-officer

- Page: `http://127.0.0.1:3100/compliance/guardrails` · Stitch: `sc_11_guardrails_policy_overrides_log`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1440x900.diff.png` | 8.86% | 1440x900 / 1440x1415 | 4/6 | medium |
| 1280x800 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1280x800.diff.png` | 8.35% | 1280x929 / 1280x1616 | 4/6 | medium |
| 768x1024 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/768x1024.diff.png` | 7.23% | 768x1263 / 768x2692 | 2/4 | medium |
| 390x844 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/390x844.diff.png` | 3.02% | 390x1635 / 551x6173 | 1/4 | medium |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `8px` |

## Increment B3 — round 2 (2026-11-18, retest after the fixes of BUG-084..093)

Harness runs below dated 2026-11-17T21:44–21:47Z (UTC): `--url` on `next start` :3100 (build of 2026-11-18 03:28 +06, no source newer than `.next/BUILD_ID`), cookie from each user's storage state saved in this round; `nmp_e2e` freshly seeded, then W-B3-1..8 run again (DE core v1 active, v2 draft, DE Aug/Sep/Oct 2026 committed, restatement applied in Oct). Results `testing/visual/results/<SC>__<role>.json`, captures `testing/ui-screenshots/app/{periods,people,plans,compliance}/…`, logs `var/qa-b3/r2/R2-visual-*.log`.

| Screen | 1440x900 | 1280x800 | 768x1024 | 390x844 | Harness findings | Judgement |
|---|---|---|---|---|---|---|
| SC-01 Periods and runs | 6.63 % | 6.41 % | 5.90 % | 3.86 % | high: primary "missing"; medium: title 20 px at 390 | primary missing = state (newest unfinished period Nov 2026 before cut-off). **BUG-089 partly fixed:** period/cut-off cells are one line now and blockers are short chips, but the table is 1024 px wide inside a 781 px (1440) / 665 px (1280) scrolling box: Late pending, Blockers and the row actions (Calculate, Re-run, Open review, Replay, Request restatement) are cut off and reachable only by scrolling the table sideways; committed rows are still ~110 px tall and the blocker chips are clipped ("Previo", "Order"). Registered as **BUG-094** (MEDIUM). 768/390: table scrolls inside its box, no page scroll |
| SC-02 Run review | 5.00 % | 4.53 % | 4.10 % | 3.12 % | high: primary "missing"; medium: title, table header, card radius | as round 1 (captured on the committed Aug run: no approval bar = state; canonical tokens). Amounts now correct (BUG-084 fixed) |
| SC-43 Qualification | 5.93 % | 5.50 % | 6.17 % | 3.84 % | high: primary height/weight; medium: table header | canonical tokens; measures on the market scale (PV/GV/CAPPED_PV 300.00, ENROLLED 0 — BUG-090 SC-43 part fixed) |
| SC-32 Late queue (touch) | 5.07 % | 5.08 % | 4.26 % | 2.15 % | high: primary "missing"; medium: table header | state + canonical tokens; consumed row shows "Adjusted in run 6be68487" link (BUG-086 fixed); effect "-200.00 pv". Original period is printed as viewer-zone instants "Aug 1, 2026, 4:00 AM GMT+6 – Sep 1, 2026, 4:00 AM GMT+6" (BUG-095) |
| SC-04 Plans list (sc_28 pattern) | 5.47 % | 5.43 % | 5.68 % | 2.51 % | high: page background, primary colour; medium: section heading, table header, card | canonical tokens (note, unchanged since MVP-A) |
| SC-04 Plan version | 6.21 % | 6.15 % | 6.72 % | 4.36 % | high: primary colour/weight; medium: title weight/colour | canonical tokens; header "Effective from Aug 1, 2026, 12:00 AM GMT+2" names the zone (BUG-091 fixed here) |
| SC-05 Caps and pools | 5.89 % | 6.29 % | 5.19 % | 1.26 % | high: page font 16 vs 14 px, primary font 13 vs 16 px | canonical body/button size (as round 1) |
| SC-42 Simulation | 5.79 % | 5.79 % | 3.87 % | 1.73 % | high: primary height/weight; medium: table header, card radius | canonical tokens; the "Open guardrail decisions" warning still prints `e2e-starter-kit-volume@2026-01-01: acknowledgement_required` (BUG-096) |
| SC-11 Guardrails | 8.86 % | 8.37 % | 7.22 % | 3.02 % | medium: table header, card radius | canonical tokens (exit 0) |

Shell landmarks matched sc_01 at 1440 and 1280 on all nine runs. No page scrolls sideways at 1440, 768 or 390 on 13 B3 routes checked in the browser (`scrollWidth ≤ innerWidth`). Real differences this round: BUG-094 (MEDIUM, SC-01 table clipped at desktop widths, residual of BUG-089); content defects BUG-095, BUG-096 (LOW). Everything else is the canonical-token drift recorded since MVP-A or state-dependent landmarks.

### 2026-11-17T21:44:15.558Z · SC-01 periods-runs — role commission-analyst

- Page: `http://127.0.0.1:3100/periods?calendar=a73e2419-522f-4c5d-85ec-96b360fca159` · Stitch: `sc_01_periods_runs_analyst_home`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1440x900.diff.png` | 6.63% | 1440x1309 / 1440x1383 | 7/8 | high |
| 1280x800 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1280x800.diff.png` | 6.41% | 1280x1325 / 1280x1571 | 7/8 | high |
| 768x1024 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/768x1024.diff.png` | 5.9% | 768x1718 / 768x2572 | 5/6 | high |
| 390x844 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/390x844.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/390x844.diff.png` | 3.86% | 390x3386 / 541x5229 | 4/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |

### 2026-11-17T21:44:28.658Z · SC-02 run-review — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/3f726fac-9e7d-4788-b439-f59cfa89a239/runs/b4f98f59-22b0-4195-a023-2e32dcd23b85/review` · Stitch: `sc_02_run_review`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1440x900.diff.png` | 5% | 1440x900 / 1440x1866 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1280x800.diff.png` | 4.53% | 1280x800 / 1280x1982 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/768x1024.diff.png` | 4.1% | 768x1024 / 768x3009 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/390x844.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/390x844.diff.png` | 3.12% | 390x1216 / 484x6037 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | mismatch | medium | font-size | `16px` | `24px` |
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | title | mismatch | medium | line-height | `24px` | `32px` |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `36px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 1280x800 | title | mismatch | medium | font-size | `16px` | `24px` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | title | mismatch | medium | line-height | `24px` | `32px` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `36px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 768x1024 | title | mismatch | medium | font-size | `16px` | `24px` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | title | mismatch | medium | line-height | `24px` | `32px` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `36px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `16px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `24px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `36px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `4px` | `8px` |

### 2026-11-17T21:44:41.853Z · SC-43 qualification — role commission-analyst

- Page: `http://127.0.0.1:3100/people/bf560ebe-e987-4c3e-990d-a416cda147a7/qualification` · Stitch: `sc_43_rank_and_qualification_detail_staff`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/qualification/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/1440x900.diff.png` | 5.93% | 1440x1372 / 1440x1526 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/people/qualification/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/1280x800.diff.png` | 5.5% | 1280x1426 / 1280x1737 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/people/qualification/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/768x1024.diff.png` | 6.17% | 768x1690 / 768x2637 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/people/qualification/commission-analyst/390x844.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/390x844.diff.png` | 3.84% | 390x2268 / 434x5659 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `88px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |

### 2026-11-17T21:44:54.771Z · SC-32 late-transactions — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/late?state=consumed` · Stitch: `sc_32_late_transaction_queue`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.diff.png` | 5.07% | 1440x900 / 1440x1434 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.diff.png` | 5.08% | 1280x800 / 1280x1714 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.diff.png` | 4.26% | 768x1024 / 768x2678 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.diff.png` | 2.15% | 390x955 / 538x5664 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-17T21:45:07.711Z · SC-04-list plans — role plan-administrator

- Page: `http://127.0.0.1:3100/plans` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/plans/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/1440x900.diff.png` | 5.47% | 1440x900 / 1440x1154 | 3/8 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/plans/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/1280x800.diff.png` | 5.43% | 1280x800 / 1280x1314 | 3/8 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/plans/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/768x1024.diff.png` | 5.68% | 768x1024 / 768x1949 | 1/6 | high |
| 390x844 | `testing/ui-screenshots/app/plans/plans/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/390x844.diff.png` | 2.51% | 390x844 / 537x4179 | 0/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `4px` |

### 2026-11-17T21:45:21.056Z · SC-04 plan-version — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/e42ba34e-058f-414f-841f-bfc53d996bb4/versions/1` · Stitch: `sc_04_plan_versions_simulation`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1440x900.diff.png` | 6.21% | 1440x1787 / 1440x1583 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1280x800.diff.png` | 6.15% | 1280x1803 / 1280x1759 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/768x1024.diff.png` | 6.72% | 768x2003 / 768x2951 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/390x844.diff.png` | 4.36% | 390x2781 / 489x6853 | 3/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |

### 2026-11-17T21:45:34.179Z · SC-05 caps-and-pools — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/e42ba34e-058f-414f-841f-bfc53d996bb4/versions/2/caps` · Stitch: `sc_05_cap_and_pool_configuration`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1440x900.diff.png` | 5.89% | 1440x900 / 1440x1941 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1280x800.diff.png` | 6.29% | 1280x800 / 1280x2055 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/768x1024.diff.png` | 5.19% | 768x1024 / 768x4021 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/390x844.diff.png` | 1.26% | 390x1280 / 599x10872 | 2/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | font-size | `16px` | `13px` |

### 2026-11-17T21:45:47.661Z · SC-42 simulation — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/e42ba34e-058f-414f-841f-bfc53d996bb4/versions/2/simulations/78176a4b-12f2-4a71-84c7-d2e3be652366` · Stitch: `sc_42_simulation_results_golden_datasets`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1440x900.diff.png` | 5.79% | 1440x966 / 1440x1762 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1280x800.diff.png` | 5.79% | 1280x966 / 1280x1920 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/768x1024.diff.png` | 3.87% | 768x1110 / 996x3406 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/390x844.diff.png` | 1.73% | 390x1607 / 694x7915 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 1280x800 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 768x1024 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | card | mismatch | medium | border-radius | `4px` | `8px` |

### 2026-11-17T21:46:00.717Z · SC-11 guardrails — role compliance-officer

- Page: `http://127.0.0.1:3100/compliance/guardrails` · Stitch: `sc_11_guardrails_policy_overrides_log`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1440x900.diff.png` | 8.86% | 1440x900 / 1440x1415 | 4/6 | medium |
| 1280x800 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1280x800.diff.png` | 8.37% | 1280x929 / 1280x1616 | 4/6 | medium |
| 768x1024 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/768x1024.diff.png` | 7.22% | 768x1263 / 768x2692 | 2/4 | medium |
| 390x844 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/390x844.diff.png` | 3.02% | 390x1635 / 551x6173 | 1/4 | medium |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `8px` |

## Increment B3 — round 3 (2026-11-18, retest after the fix of BUG-094)

Harness runs below dated 2026-11-17T22:01–22:03Z (UTC): `--url` on `next start` :3100 (build of 2026-11-18 03:54 +06, no source newer than `.next/BUILD_ID`), cookies from the round-2 storage states, `nmp_e2e` in its round-2 end state. Results `testing/visual/results/<SC>__<role>.json`, captures `testing/ui-screenshots/app/…`, logs `var/qa-b3/r3/R3-visual-*.log`.

| Screen | 1440x900 | 1280x800 | 768x1024 | 390x844 | Harness findings | Judgement |
|---|---|---|---|---|---|---|
| SC-01 Periods and runs | 6.89 % | 6.78 % | 6.38 % | 3.82 % | high: primary "missing"; medium: title 20 px at 390 | primary missing = state (Nov 2026 before cut-off). **BUG-094 verified fixed**: table fits its box at 1440 (1169/1169) and 1280 (1009/1009), every row action visible, rows 53–65 px, no clipped chip. Run diagnostics now stack below the table under 1920 px — a deliberate deviation from sc_01 (whose own table is clipped at 1440). Residuals: BUG-097 (Gross amount wraps from "EUR"), BUG-098 (768: table scrolls sideways, chips break per word) |
| SC-02 Run review | 5.00 % | 4.53 % | 4.10 % | 3.12 % | as round 2 | unchanged (identical figures) |
| SC-43 Qualification | 5.93 % | 5.50 % | 6.17 % | 3.84 % | as round 2 | unchanged |
| SC-32 Late queue | 5.07 % | 5.08 % | 4.26 % | 2.15 % | as round 2 | unchanged; BUG-095 open |
| SC-04 Plans list | 5.47 % | 5.43 % | 5.68 % | 2.51 % | as round 2 | unchanged |
| SC-04 Plan version | 6.21 % | 6.15 % | 6.72 % | 4.36 % | as round 2 | unchanged |
| SC-05 Caps and pools | 5.89 % | 6.29 % | 5.19 % | 1.26 % | as round 2 | unchanged |
| SC-42 Simulation | 5.79 % | 5.79 % | 3.87 % | 1.73 % | as round 2 | unchanged; BUG-096 open |
| SC-11 Guardrails | 8.86 % | 8.37 % | 7.22 % | 3.02 % | as round 2 (exit 0) | unchanged |

No page scrolls sideways at 1440, 1280, 768 or 390 on SC-01, and at 1440 on the other eight routes. Real differences this round: BUG-097, BUG-098 (LOW, SC-01); everything else is the canonical-token drift recorded since MVP-A or state-dependent landmarks.

### 2026-11-17T22:01:30.613Z · SC-01 periods-runs — role commission-analyst

- Page: `http://127.0.0.1:3100/periods?calendar=a73e2419-522f-4c5d-85ec-96b360fca159` · Stitch: `sc_01_periods_runs_analyst_home`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1440x900.diff.png` | 6.89% | 1440x1342 / 1440x1383 | 7/8 | high |
| 1280x800 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/1280x800.diff.png` | 6.78% | 1280x1410 / 1280x1571 | 7/8 | high |
| 768x1024 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/768x1024.diff.png` | 6.38% | 768x1708 / 768x2572 | 5/6 | high |
| 390x844 | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/390x844.png` | `testing/ui-screenshots/app/periods/periods-runs/commission-analyst/390x844.diff.png` | 3.82% | 390x3234 / 541x5229 | 4/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |

### 2026-11-17T22:01:43.204Z · SC-02 run-review — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/3f726fac-9e7d-4788-b439-f59cfa89a239/runs/b4f98f59-22b0-4195-a023-2e32dcd23b85/review` · Stitch: `sc_02_run_review`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1440x900.diff.png` | 5% | 1440x900 / 1440x1866 | 4/8 | high |
| 1280x800 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/1280x800.diff.png` | 4.53% | 1280x800 / 1280x1982 | 4/8 | high |
| 768x1024 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/768x1024.diff.png` | 4.1% | 768x1024 / 768x3009 | 2/6 | high |
| 390x844 | `testing/ui-screenshots/app/periods/run-review/commission-analyst/390x844.png` | `testing/ui-screenshots/app/periods/run-review/commission-analyst/390x844.diff.png` | 3.12% | 390x1216 / 484x6037 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | mismatch | medium | font-size | `16px` | `24px` |
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | title | mismatch | medium | line-height | `24px` | `32px` |
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `36px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 1280x800 | title | mismatch | medium | font-size | `16px` | `24px` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | title | mismatch | medium | line-height | `24px` | `32px` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `36px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 768x1024 | title | mismatch | medium | font-size | `16px` | `24px` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | title | mismatch | medium | line-height | `24px` | `32px` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `36px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `16px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `24px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `36px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `700` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `4px` | `8px` |

### 2026-11-17T22:01:56.310Z · SC-43 qualification — role commission-analyst

- Page: `http://127.0.0.1:3100/people/bf560ebe-e987-4c3e-990d-a416cda147a7/qualification` · Stitch: `sc_43_rank_and_qualification_detail_staff`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/people/qualification/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/1440x900.diff.png` | 5.93% | 1440x1372 / 1440x1526 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/people/qualification/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/1280x800.diff.png` | 5.5% | 1280x1426 / 1280x1737 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/people/qualification/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/768x1024.diff.png` | 6.17% | 768x1690 / 768x2637 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/people/qualification/commission-analyst/390x844.png` | `testing/ui-screenshots/app/people/qualification/commission-analyst/390x844.diff.png` | 3.84% | 390x2268 / 434x5659 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | primaryButton | mismatch | high | height | `34px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | height | `88px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `400` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |

### 2026-11-17T22:02:09.136Z · SC-32 late-transactions — role commission-analyst

- Page: `http://127.0.0.1:3100/periods/late?state=consumed` · Stitch: `sc_32_late_transaction_queue`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1440x900.diff.png` | 5.07% | 1440x900 / 1440x1434 | 6/8 | high |
| 1280x800 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/1280x800.diff.png` | 5.08% | 1280x800 / 1280x1714 | 6/8 | high |
| 768x1024 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/768x1024.diff.png` | 4.26% | 768x1024 / 768x2678 | 4/6 | high |
| 390x844 | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.png` | `testing/ui-screenshots/app/orders/late-transactions/commission-analyst/390x844.diff.png` | 2.15% | 390x955 / 538x5664 | 3/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1440x900 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1440x900 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1440x900 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1440x900 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 1280x800 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 1280x800 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 1280x800 | primaryButton | missing-in-app | high | height | `32px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 1280x800 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 768x1024 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 768x1024 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 768x1024 | primaryButton | missing-in-app | high | height | `32px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 768x1024 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | missing-in-app | high | background-color | `rgb(0, 56, 131)` | — |
| 390x844 | primaryButton | missing-in-app | high | color | `rgb(255, 255, 255)` | — |
| 390x844 | primaryButton | missing-in-app | high | border-radius | `2px` | — |
| 390x844 | primaryButton | missing-in-app | high | height | `32px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-family | `Inter` | — |
| 390x844 | primaryButton | missing-in-app | high | font-size | `13px` | — |
| 390x844 | primaryButton | missing-in-app | high | font-weight | `600` | — |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |

### 2026-11-17T22:02:21.741Z · SC-04-list plans — role plan-administrator

- Page: `http://127.0.0.1:3100/plans` · Stitch: `sc_28_users_and_roles` · config brace patched: sc_28_users_and_roles
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/plans/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/1440x900.diff.png` | 5.47% | 1440x900 / 1440x1154 | 3/8 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/plans/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/1280x800.diff.png` | 5.43% | 1280x800 / 1280x1314 | 3/8 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/plans/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/768x1024.diff.png` | 5.68% | 768x1024 / 768x1949 | 1/6 | high |
| 390x844 | `testing/ui-screenshots/app/plans/plans/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/plans/plan-administrator/390x844.diff.png` | 2.51% | 390x844 / 537x4179 | 0/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1440x900 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 1440x900 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 1280x800 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 1280x800 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 1280x800 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 768x1024 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 768x1024 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 768x1024 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `4px` |
| 390x844 | page | mismatch | high | background | `rgb(248, 250, 252)` | `rgb(248, 249, 255)` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | sectionHeading | mismatch | medium | font-size | `16px` | `20px` |
| 390x844 | sectionHeading | mismatch | medium | line-height | `20px` | `28px` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | background | `rgb(230, 238, 255)` | `rgb(239, 244, 255)` |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `4px` |

### 2026-11-17T22:02:34.302Z · SC-04 plan-version — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/e42ba34e-058f-414f-841f-bfc53d996bb4/versions/1` · Stitch: `sc_04_plan_versions_simulation`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1440x900.diff.png` | 6.21% | 1440x1787 / 1440x1583 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/1280x800.diff.png` | 6.15% | 1280x1803 / 1280x1759 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/768x1024.diff.png` | 6.72% | 768x2003 / 768x2951 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/plan-version/plan-administrator/390x844.diff.png` | 4.36% | 390x2781 / 489x6853 | 3/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | title | mismatch | medium | font-weight | `700` | `600` |
| 1440x900 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 1440x900 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | title | mismatch | medium | font-weight | `700` | `600` |
| 1280x800 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 1280x800 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | title | mismatch | medium | font-weight | `700` | `600` |
| 768x1024 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 768x1024 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | font-weight | `700` | `600` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | title | mismatch | medium | color | `rgb(0, 56, 131)` | `rgb(13, 28, 46)` |
| 390x844 | primaryButton | mismatch | high | background-color | `rgb(30, 79, 163)` | `rgb(0, 56, 131)` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |

### 2026-11-17T22:02:47.204Z · SC-05 caps-and-pools — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/e42ba34e-058f-414f-841f-bfc53d996bb4/versions/2/caps` · Stitch: `sc_05_cap_and_pool_configuration`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1440x900.diff.png` | 5.89% | 1440x900 / 1440x1941 | 5/7 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/1280x800.diff.png` | 6.29% | 1280x800 / 1280x2055 | 5/7 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/768x1024.diff.png` | 5.19% | 768x1024 / 768x4021 | 3/5 | high |
| 390x844 | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/caps-and-pools/plan-administrator/390x844.diff.png` | 1.26% | 390x1280 / 599x10872 | 2/5 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | page | mismatch | high | font-size | `14px` | `16px` |
| 1440x900 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 1280x800 | page | mismatch | high | font-size | `14px` | `16px` |
| 1280x800 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 768x1024 | page | mismatch | high | font-size | `14px` | `16px` |
| 768x1024 | primaryButton | mismatch | high | font-size | `16px` | `13px` |
| 390x844 | page | mismatch | high | font-size | `14px` | `16px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | primaryButton | mismatch | high | font-size | `16px` | `13px` |

### 2026-11-17T22:03:00.715Z · SC-42 simulation — role plan-administrator

- Page: `http://127.0.0.1:3100/plans/e42ba34e-058f-414f-841f-bfc53d996bb4/versions/2/simulations/78176a4b-12f2-4a71-84c7-d2e3be652366` · Stitch: `sc_42_simulation_results_golden_datasets`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1440x900.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1440x900.diff.png` | 5.79% | 1440x966 / 1440x1762 | 5/8 | high |
| 1280x800 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1280x800.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/1280x800.diff.png` | 5.79% | 1280x966 / 1280x1920 | 5/8 | high |
| 768x1024 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/768x1024.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/768x1024.diff.png` | 3.87% | 768x1110 / 996x3406 | 3/6 | high |
| 390x844 | `testing/ui-screenshots/app/plans/simulation/plan-administrator/390x844.png` | `testing/ui-screenshots/app/plans/simulation/plan-administrator/390x844.diff.png` | 1.73% | 390x1607 / 694x7915 | 2/6 | high |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 1440x900 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 1280x800 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 1280x800 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 768x1024 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 768x1024 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | card | mismatch | medium | border-radius | `4px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `32px` | `26px` |
| 390x844 | title | mismatch | medium | line-height | `40px` | `32px` |
| 390x844 | primaryButton | mismatch | high | height | `40px` | `32px` |
| 390x844 | primaryButton | mismatch | high | font-weight | `500` | `600` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | card | mismatch | medium | border-radius | `4px` | `8px` |

### 2026-11-17T22:03:13.061Z · SC-11 guardrails — role compliance-officer

- Page: `http://127.0.0.1:3100/compliance/guardrails` · Stitch: `sc_11_guardrails_policy_overrides_log`
- Pixel mismatch is informational (sample data differs from API data); style fidelity is the check.

| Viewport | Screenshot | Diff image | Pixel mismatch | App / reference size | Landmarks matched | Worst severity |
|---|---|---|---|---|---|---|
| 1440x900 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1440x900.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1440x900.diff.png` | 8.86% | 1440x900 / 1440x1415 | 4/6 | medium |
| 1280x800 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1280x800.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/1280x800.diff.png` | 8.37% | 1280x929 / 1280x1616 | 4/6 | medium |
| 768x1024 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/768x1024.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/768x1024.diff.png` | 7.22% | 768x1263 / 768x2692 | 2/4 | medium |
| 390x844 | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/390x844.png` | `testing/ui-screenshots/app/compliance/guardrails/compliance-officer/390x844.diff.png` | 3.02% | 390x1635 / 551x6173 | 1/4 | medium |

Style differences:

| Viewport | Landmark | Status | Severity | Property | Stitch | App |
|---|---|---|---|---|---|---|
| 1440x900 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1440x900 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1440x900 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 1280x800 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 1280x800 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 1280x800 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 768x1024 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 768x1024 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 768x1024 | card | mismatch | medium | border-radius | `2px` | `8px` |
| 390x844 | title | mismatch | medium | font-size | `24px` | `20px` |
| 390x844 | title | mismatch | medium | line-height | `32px` | `28px` |
| 390x844 | tableHeader | mismatch | medium | font-size | `12px` | `11px` |
| 390x844 | tableHeader | mismatch | medium | color | `rgb(67, 71, 82)` | `rgb(86, 94, 116)` |
| 390x844 | card | mismatch | medium | border-radius | `2px` | `8px` |

