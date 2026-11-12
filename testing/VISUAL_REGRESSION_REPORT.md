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

