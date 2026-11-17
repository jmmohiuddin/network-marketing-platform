# UI testing report — MVP-A screens

Owner: QA. One row per MVP-A screen with a Stitch design. A cell says `not executed` until that check has run against the re-skinned app; then it holds the result and a link to its evidence (screenshots under `testing/ui-screenshots/app/`, visual runs in `testing/VISUAL_REGRESSION_REPORT.md`, browser evidence under `var/e2e-screens/R4-*.png` / `R5-*.png` / `R6-*.png` and `var/e2e-fixtures/exports-r4/` … `exports-r6/`).

## Final status (after round 3, 2026-11-12)

Three UI rounds ran against the Stitch re-skin of the 11 MVP-A screens. Round 1 found 12 web defects (BUG-032..043); the frontend fixed them and round 2 verified all 12 fixed. Round 2 found BUG-044..048; the frontend fixed BUG-044 (shared Modal) and round 3 verified it. Round 3 found no new defect. No code was changed after round 3.

| Screen | Stitch | Functional | Visual | Responsive | Accessibility | Open defects | Final |
|---|---|---|---|---|---|---|---|
| SC-10 Compliance reports | `sc_10_compliance_reports` | pass | pass | pass | pass | — | pass |
| SC-14 Vendor access sessions | `sc_14_vendor_access_sessions_authorizations` | pass | pass | pass | needs review | BUG-023, 028, 045, 046 | pass with known defects |
| SC-24 Data imports | `sc_24_data_imports` | pass | pass | pass | pass | BUG-026 | pass with known defects |
| SC-25 Import mapping | `sc_25_import_mapping` | pass | pass | pass | pass | BUG-029 | pass with known defects |
| SC-26 Figure drill-down | `sc_26_figure_drill_down` | pass | pass | pass | pass | — | pass |
| SC-27 Sign-in and second factor | `sc_27_sign_in_and_second_factor` | pass | pass | pass | pass | — | pass |
| SC-28 Users and roles | `sc_28_users_and_roles` | pass | pass | pass | needs review | BUG-028, 046 | pass with known defects |
| SC-29 Tenant settings | `sc_29_tenant_settings` | pass | pass | pass | pass | BUG-025 | pass with known defects |
| SC-30 Audit log | `sc_30_immutable_audit_log_verification` | pass | pass | pass | pass | BUG-027 | pass with known defects |
| SC-39 Vendor operations console | `sc_39_vendor_operations_console` | pass | pass | pass | pass | BUG-047, 048 | pass with known defects |
| SC-46 Compliance overview | `sc_46_compliance_overview_overlay_home` | pass | pass | pass | pass | — | pass |

Open web defects after round 3 (all LOW, all in `engineering/BUG_REGISTER.md`):

| Bug | Kind | Screens | Summary |
|---|---|---|---|
| BUG-023 (open part) | functional | SC-14 | requester shown as "Vendor user 09f24e68"; the API must return the requester's name |
| BUG-025 | functional | SC-29 | every threshold shows "(version 5)", the latest whole-settings version |
| BUG-026 | accessibility | SC-24, Create snapshot dialog | `type=month` fields with the hint "Year and month, for example 2025-01." |
| BUG-027 | functional (copy) | SC-30 | export success text "1 events." |
| BUG-028 | accessibility | SC-28, SC-14 | focus falls to `<body>` after Revoke, Deactivate, Reject grant and End now |
| BUG-029 | functional | SC-25 | author and approver named only "you" / "another user" |
| BUG-045 | design quality | SC-14, SC-28 | step-up dialog opens on top of the action dialog (two modal dialogs) |
| BUG-046 | functional (copy) | SC-28, SC-14 | "You will be asked for a code…" when no code is asked (inside the step-up window) |
| BUG-047 | functional | SC-39 request dialog | offers "Compliance snapshots (creator's view)", which a Tenant admin cannot approve |
| BUG-048 | design quality | SC-39 request dialog | offers "Compensation plans" (`plan.activate`) although MVP-A has no plan screen or route |

BUG-030 (Outdated banner offers Create to users who cannot create) was not reproduced in rounds 2 and 3; it stays Open in the register until its owner closes it.

Fixed and verified during these rounds: BUG-032..043 (fixed after round 1, verified in round 2), BUG-044 (fixed after round 2, verified in round 3). Web unit tests after the last fix: 38 files, 262 tests, all passing (`pnpm vitest run apps/web`, run 2026-11-12 by QA while finalising this report).

Not executed in any round: support-session auto-expiry, go-live, an export above 50,000 rows, Impeccable Performance dimension (not measured), dark theme (light only by decision).

## Round 3 (2026-11-12, retest after the fix of BUG-044)

Environment: `nmp_e2e` freshly seeded (`seed:e2e`), API `:4000` (tsx, NODE_ENV=development, COOKIE_SECURE=false; restarted once with EXPORT_ROW_CAP=10 for the cap check, then default), web `:3100` (`next start`, no source file newer than `.next/BUILD_ID`). One browser at a time: Playwright MCP Chromium for Levels 1 and 3 (closed while the harness ran its own Chromium for Level 2, then reopened from saved sessions for the Outdated and session-end checks). Both servers stopped by PID at the end. Evidence: captures `testing/ui-screenshots/app/…` (overwritten by this round), `var/e2e-screens/R6-*.png`, exports `var/e2e-fixtures/exports-r6/`, API logs `var/e2e-api-r6-part1.log`, `var/e2e-api-r6-cap.log`, `var/e2e-api.log` (0 responses with status 5xx).

### Fix verification (first step)

| Bug | Result | Evidence |
|---|---|---|
| BUG-044 | fixed | Invite user at 1440x900: dialog 334.5 px = content height, centred (top 283 px); Create snapshot at 1280x800: 592 px = content (top 104 px); step-up dialog 426 px = content; long content (three breach contacts) stops at 90vh (808 px at 1440x900, 646 px at 1280x720), the body scrolls (670 of 986 px) and the footer with Save stays visible; at 390 px still a full-screen sheet. `var/e2e-screens/R6-BUG044-invite-1440.png`, `R6-BUG044-create-snapshot-1280.png`, `R6-BUG044-long-dialog-1440.png`, `R6-BUG044-long-dialog-1280x720.png`, `R6-W10-dialog-390.png` |
| BUG-030 (open, retested) | not reproduced | vendor in a read-only session sees the Outdated banner without a Create control (`R6-W8-outdated-in-session.png`) |
| BUG-023, 025–029, 045–048 (open) | still present | requester "Vendor user 09f24e68"; all thresholds "version 5"; month hint on `type=month`; "1 events"; focus on BODY after Revoke, Deactivate, Reject grant and End now; "by another user"; step-up dialog stacked over Approve vendor access; "You will be asked for a code" with no code asked; creator's view and Compensation plans offered in the vendor request |

### Per screen

| Screen | Stitch Reference | Functional Testing | Visual Fidelity | Responsive Testing | Accessibility | Impeccable Review | Defects | Fixes | Final Status |
|---|---|---|---|---|---|---|---|---|---|
| SC-10 Compliance reports | `sc_10_compliance_reports` | pass: R1 2025-01 16.61 % / 1,517,950 (bar 16.61 / 1.94 / 81.45 %); 2025-12 42.06 / 49.82 / 11.10 / 8.24 %, net 7,062,746; R2 41.26 / 4.54, rewarded 4,567,051; R3 2025-12 24.53 / 8.86 / 10.65 / 55.96 %, gross 1,326,685, clawbacks −36,316; R3 2025 22.55 / 15.27 / 10.80 / 51.38 %; R4 277 / 55.23 % / 52; R5 449 / 73.27 % / mean 205.47 / median 80.21 / p75 232.68 / p90 545.70 / p99 1,630.95, bands 120/121/188/20/0 = `report.json`; compare 2025-12 vs 2025-11 (URL `period`, `compare`, difference table); Outdated after mapping v2 draft | pass with notes: as round 2 (tableHeader missing on the R1 tab capture is tab state; title 20 px at 390 is the mobile token) | pass (capture width = viewport at all four; page 2,289 px at 1440, 4,151 at 390) | pass (one h1, no heading jump, names, contrast) | no new integrity issue | — | BUG-044 verified | pass |
| SC-14 Vendor access sessions | `sc_14_vendor_access_sessions_authorizations` | pass: request card, Approve without region confirmation refused ("Confirm access from outside your data region, or deny the request."), approve with region confirmation → step-up dialog (focus on `step-up-code`, fresh TOTP, action retried) → "Access approved for 1 h"; session log lists views and refusals with parameters; End now → vendor sent to `/vendor/support-sessions?reason=session_closed` with "Your support session is no longer open" | pass with notes: Approve primary absent in the capture because the request was already decided (data state, as round 1); canonical table header | pass | needs review: known BUG-028 (focus to BODY after End now); stacked step-up (BUG-045) | no new integrity issue | known BUG-023, 028, 045, 046 | — | pass with known defects |
| SC-24 Data imports | `sc_24_data_imports` | pass: totals 1,466 / 4,775 / 7,442, sums 53,195,001 / 53,195,001 / 2,600,070 / 9,225,679; `email` column rejected (participants.csv row 1, FORBIDDEN_COLUMN); mapping attached; Loaded | pass with notes (canonical tokens, design notes as round 1) | pass | pass | no new integrity issue | known BUG-026 | — | pass with known defects |
| SC-25 Import mapping | `sc_25_import_mapping` | pass: draft v1 by admin (13 codes mapped over four tabs), approved by the compliance officer at `/compliance/mappings?version=`, read-only approved view, v2 draft → snapshot Outdated | pass with notes (canonical tokens) | pass (390 capture 390 px wide) | pass | no new integrity issue | known BUG-029 | — | pass with known defects |
| SC-26 Figure drill-down | `sc_26_figure_drill_down` | pass: "Sums match the figure" (net 1,517,950), logged export 102 rows + watermark (`exports-r6/compliance-rows-1245e4b1….csv`); analyst sees no export | pass with notes (canonical button weight, table header) | pass | pass | no new integrity issue | — | — | pass |
| SC-27 Sign-in and second factor | `sc_27_sign_in_and_second_factor` | pass: keyboard vendor sign-in (Tab order email → password → Sign in), TOTP; invitation token stripped from the URL, password set, reuse refused ("This invitation link does not work"), `?tenant=` prefill, forced enrolment (manual key) | pass (harness: no style finding at any width) | pass | pass | detector (rendered `/signin`, `/signin/vendor`): no findings | — | — | pass |
| SC-28 Users and roles | `sc_28_users_and_roles` | pass: invite dave; Compliance officer and Finance approver (DEMO via market picker) pending; self-approval hidden + API 422 SOD_SELF_APPROVAL; Executive read-only immediate; admin2 approves Compliance officer; admin2 rejects Finance approver ("The grant request was rejected.", first rejection exercised); revoke; deactivate; revoke of admin2's Tenant admin refused ("This would leave one administrator…"); Escape returns focus to the trigger | pass with notes (canonical tokens) | pass (dialog full-screen sheet at 390) | needs review: known BUG-028 (BODY after Revoke, Deactivate, Reject) | no new integrity issue | known BUG-028, 046 | BUG-044 verified | pass with known defects |
| SC-29 Tenant settings | `sc_29_tenant_settings` | pass: 5,000 / ranks active 5,000 + leader 10,000 / day 27 / more than 1 out of 3 / breach contact (DPO) saved with reasons | pass with notes (no page primary or history table: no API) | pass | pass | no new integrity issue | known BUG-025 | BUG-044 verified (long contacts dialog) | pass with known defects |
| SC-30 Audit log | `sc_30_immutable_audit_log_verification` | pass: chain intact (38 events), action filter + chip in URL, drawer in URL (`?event=32`), focus to Close and back to the row on Escape; export by the compliance officer 1 row + download (`exports-r6/audit-export-151bbd02….csv`); cap: "This export would have 40 rows; the limit is 10 rows" | pass with notes (canonical button) | pass | pass | no new integrity issue | known BUG-027 | — | pass with known defects |
| SC-39 Vendor operations console | `sc_39_vendor_operations_console` | pass: empty submit focuses the error summary; `initech` provisioned with two admins; self-approval refused ("A second vendor user must do this step."); operator2 approves → Implementation, two invitations mailed; `/vendor`, `/vendor/users`, `/vendor/support-sessions`, `/vendor/audit?action=TENANT.CREATED` | pass with notes (no fleet KPIs: no API) | pass | pass | no new integrity issue | known BUG-047, 048 | — | pass with known defects |
| SC-46 Compliance overview | `sc_46_compliance_overview_overlay_home` | pass: R1–R5 headline figures (42.06 / 41.26 / 55.96 / 55.23 / 73.27 %) with change since 2025-11 and numerator/denominator, trend + View as table (12 rows), coverage, recent snapshots | pass with notes (canonical button, card radius); recent-snapshots table scrolls inside its container at 390 (guidelines: `overflow-x-auto`) | pass | pass | no new integrity issue | — | — | pass |

### Level 1 — workflows W1–W10 (round 3)

| W | Result | Notes |
|---|---|---|
| W1 vendor | pass | see SC-39; vendor API call without a session → 403 REALM_FORBIDDEN |
| W2 new admin | pass | see SC-27; `.eml` link from `apps/api/var/mail`, lands on the home page |
| W3 tenant admin | pass (known defects) | see SC-28 |
| W4 settings | pass (known defect) | see SC-29 |
| W5 import | pass | see SC-24/25 |
| W6 compliance | pass | see SC-10/26/46; all figures equal `report.json` |
| W7 audit | pass (known defect) | see SC-30; export cap executed |
| W8 support session | pass (known defects) | request (Data imports, Compliance reports, Audit log; 60 min); region approval + step-up; read-only frame "Vendor support session · read-only · acme"; in-scope reads 200, `/v1/users` 403 PERMISSION_DENIED (logged ACCESS_REFUSED), write 403 SUPPORT_SESSION_READ_ONLY (logged); Outdated banner without Create control; End now → SUPPORT_SESSION_INACTIVE + notice |
| W9 isolation | pass | globex admin: acme snapshot, batch, mapping, user, audit export → 404; audit download 403 PERMISSION_DENIED; grant decision, deactivate, load → 404; pages "Not found or not available to you". Analyst: nav Compliance only, five admin pages NotAvailable, `/vendor` → `/compliance`, admin APIs 403, no export or Create snapshot control |
| W10 phone + keyboard | pass (known defect) | no element past the viewport on 19 routes at 390 and 768; dialog full-screen at 390; keyboard sign-in; Create snapshot dialog keeps focus over 14 Tab + 3 Shift+Tab, Escape returns to the trigger; BUG-028 |

Console and network: every console error and 4xx is intended (self-approval 422, wrong-shape probe 400, SECOND_ADMIN_REQUIRED 422, export cap 422, step-up 403 before the retry, REALM_FORBIDDEN, support-session refusals, cross-tenant 404s, analyst 403s, the ended session); aborted requests are navigation cancels (`/v1/me`, favicon). No `pageerror`, no 5xx in the API logs.

Not executed this round: support-session auto-expiry, go-live, > 50,000-row export.

### Level 3 — Impeccable audit (audit only) and accessibility pass

Impeccable ran in audit mode only (no PRODUCT.md/DESIGN.md: incumbent implementation as authority; nothing redesigned or changed). Detector: source scan of `apps/web/src` (the same two `side-tab` `border-l-4` findings: Stitch banner anatomy, design note) and rendered scans of `/signin` and `/signin/vendor` (no findings). Hard-coded colours in source: two, both taken from Stitch (`#0F172A` scrim from sc_02, `#7A4900` warning border from sc_08). Scripted pass on 25 routes at 1440 (checker validated on an injected low-contrast text and a 16 px button): no unlabeled field, no unnamed control, no contrast failure, no target under 24 px, one h1 per page, no heading-level jump, `main`/`nav`/`header` landmarks present. Dialogs: native `<dialog>` with `aria-modal` and `aria-labelledby`, focus trap and return verified.

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | BUG-028 (focus to BODY, now also after Reject and End now); stacked step-up dialog (BUG-045) |
| 2 | Performance | not scored | not measured |
| 3 | Theming | 4 | canonical tokens, light only |
| 4 | Responsive | 4 | no overflow at 390/768 on 19 routes; harness captures exactly viewport-wide |
| 5 | Implementation integrity | 4 | dialogs now hug their content like sc_02-modal; no new drift |
| **Total** | | **15/16 (Performance not scored)** | Good |

Design notes (not defects): as rounds 1 and 2 (canonical-catalogue values, reports on tabs, R5 band links 16 px tall with spacing). New this round: none.


## Round 2 (2026-11-12, retest after fixes of BUG-032..043)

Environment: `nmp_e2e` freshly seeded, API `:4000` (tsx, NODE_ENV=development, COOKIE_SECURE=false; restarted once with EXPORT_ROW_CAP=10 for the cap check, then default), web `:3100` (`next start`, build newer than every source file). One browser at a time: Playwright MCP Chromium for Levels 1 and 3, closed while the harness ran its own Chromium for Level 2. Both servers stopped by PID at the end. Evidence: captures `testing/ui-screenshots/app/…` (overwritten by this round), `var/e2e-screens/R5-*.png`, exports `var/e2e-fixtures/exports-r5/`, API logs `var/e2e-api-r5-part1.log`, `var/e2e-api-r5-cap.log`, `var/e2e-api.log` (0 responses with status 5xx).

### Fix verification (first step)

| Bug | Result | Evidence |
|---|---|---|
| BUG-032 | fixed | R1 "Net sales by buyer" bar (2,970,336 / 548,461 / 3,543,949 = 42.06 / 7.77 / 50.18 %), R3 table (2025-12: 24.53 / 8.86 / 10.65 / 55.96 %; 2025: 22.55 / 15.27 / 10.80 / 51.38 %), R5 band bars (120/121/188/20/0) |
| BUG-033 | fixed | opens on 2025-12; R1 shows 7 h3; page 2,289 px at 1440, 4,151 px at 390 (was 15,312 / 26,170) |
| BUG-034 | fixed | all tabs inside the strip: one row at 1440/1280, two rows at 768, wrapped list at 390 |
| BUG-035 | fixed | x labels 2025-02 … 2025-12, no overlap; axis text 11 px at all four widths |
| BUG-036 | fixed | "7,062,746" on one line with "minor units" beside it |
| BUG-037 | fixed | SC-25 at 390: page 390 px wide, meta strip wraps |
| BUG-038 | fixed | 60 min approval reads "1 h" / "First one ends in 1 h" |
| BUG-039 | fixed | `?event=30` on open, reopens after reload, Escape returns focus to the row button, banner for an event not in the list |
| BUG-040 | fixed | event buttons 24×28 px |
| BUG-041 | fixed | H1 > H2 (Tenant, Markets, First admin, Second admin) > H3 Market 1 |
| BUG-042 | fixed | captions visually hidden (still the tables' names) |
| BUG-043 | fixed | change text one line under the value |
| BUG-030 (open, retested) | not reproduced | vendor in a read-only session sees the Outdated banner without a Create snapshot control |
| BUG-023, 025–029 (open) | still present | requester "Vendor user 67f00ae6"; all settings "version 5"; month hint; "1 events"; focus on BODY after Revoke/Deactivate; "another user" |

### Per screen

| Screen | Stitch Reference | Functional Testing | Visual Fidelity | Responsive Testing | Accessibility | Impeccable Review | Defects | Fixes | Final Status |
|---|---|---|---|---|---|---|---|---|---|
| SC-10 Compliance reports | `sc_10_compliance_reports` | pass: R1 2025-01 16.61 % / 1,517,950 and 2025-12 42.06 / 49.82 / 11.10 % / 7,062,746; R2 41.26 / 4.54; R3 table 2025-12 and 2025; R4 277 / 55.23 / 52 / 0; R5 449 / 73.27 / 205.47 / 80.21 / 232.68 / 545.70, bands = `report.json`; compare 2025-12 vs 2025-11 (URL `period`, `compare`, difference table); Outdated after mapping v2 draft | pass with notes: per-report anatomy of sc_10 now present (segmentation bar, R3 table, R5 bars); reports stay on tabs (sc_10 draws all five on one page), so the harness reports the table header missing on the R1 capture (data/tab state, not a defect) | pass (no overflow at 1440/1280/768/390; chart text 11 px at 390; tabs wrap) | pass: one h1, no heading jumps, all controls named, contrast clean; R5 band links 16 px tall (spacing exception, note) | no new integrity issue | BUG-044 (dialogs) | BUG-032..036 verified | pass with defects |
| SC-14 Vendor access sessions | `sc_14_vendor_access_sessions_authorizations` | pass: pending request captured with Approve primary; region approval required ("Confirm access from outside your data region, or deny the request."); Deny; Approve 60 min → "1 h"; session log lists views and refusals; End session → vendor redirected with "no longer open" notice | pass with notes: canonical button 32 vs 34 px, canonical table header | pass | pass | no new integrity issue | BUG-046, BUG-047; known BUG-023 | BUG-038 verified | pass with defects |
| SC-24 Data imports | `sc_24_data_imports` | pass: totals 1,466 / 4,775 / 7,442, sums 53,195,001 / 53,195,001 / 2,600,070 / 9,225,679; load blocked until a breach contact exists; Loaded; `email` column rejected (participants.csv row 1, FORBIDDEN_COLUMN) | pass with notes: canonical tokens (design notes as round 1); caption no longer visible | pass | pass | no new integrity issue | known BUG-026 | BUG-042 verified | pass with known defects |
| SC-25 Import mapping | `sc_25_import_mapping` | pass: draft v1 by admin, approved by compliance officer at `/compliance/mappings?version=`, read-only approved view, v2 draft → snapshot Outdated | pass with notes (canonical tokens) | pass (390 px wide at 390) | pass | no new integrity issue | known BUG-029 | BUG-037 verified | pass with known defects |
| SC-26 Figure drill-down | `sc_26_figure_drill_down` | pass: "Sums match the figure" (net 1,517,950), logged export 102 rows + watermark (`exports-r5/compliance-rows-ad6ea415….csv`); analyst sees no export | pass with notes (canonical button weight, table header) | pass | pass | no new integrity issue | — | — | pass |
| SC-27 Sign-in and second factor | `sc_27_sign_in_and_second_factor` | pass: keyboard vendor sign-in (email → password → Sign in), focus on the code field, TOTP; invitation token stripped from URL, link single-use, forced enrolment, `?tenant=` prefill | pass (harness: no style finding at any width) | pass | pass | detector (rendered `/signin`): no findings | — | — | pass |
| SC-28 Users and roles | `sc_28_users_and_roles` | pass: invite, Compliance officer and Finance approver (DEMO) pending, self-approval hidden + API 422 SOD_SELF_APPROVAL, Executive read-only immediate, admin2 approves (step-up dialog seen and retried), revoke, deactivate, "This would leave one administrator…" | fail: every dialog stretches to 90vh at ≥ 640 px (BUG-044); the page itself as round 1 (canonical tokens) | pass | needs review: known BUG-028 (focus to BODY); step-up dialog stacked (BUG-045) | no new integrity issue | BUG-044, BUG-045, BUG-046; known BUG-028 | — | pass with defects |
| SC-29 Tenant settings | `sc_29_tenant_settings` | pass: 5,000 / ranks active 5,000 + leader 10,000 / day 27 / more than 1 out of 3 / breach contact saved with reasons | pass with notes (no page primary or history table: no API) | pass | pass | no new integrity issue | BUG-046; known BUG-025 | — | pass with defects |
| SC-30 Audit log | `sc_30_immutable_audit_log_verification` | pass: chain intact (36), action filter + chip in URL, drawer in URL, export 1 row + download (`exports-r5/audit-export-4f42f8de….csv`), cap: "This export would have 66 rows; the limit is 10 rows" | pass with notes (canonical button) | pass | pass (24×28 targets) | no new integrity issue | known BUG-027 | BUG-039, BUG-040 verified | pass with known defects |
| SC-39 Vendor operations console | `sc_39_vendor_operations_console` | pass: provisioning with error summary focused, second admin must differ, self-approval refused ("A second vendor user must do this step."), operator2 approves, lists, audit filter; cross-tenant isolation | pass with notes (no fleet KPIs: no API) | pass | pass (heading outline fixed) | no new integrity issue | BUG-047, BUG-048 | BUG-041 verified | pass with defects |
| SC-46 Compliance overview | `sc_46_compliance_overview_overlay_home` | pass: R1–R5 headline figures with change since 2025-11, numerators, trend + View as table (12 rows), coverage, recent snapshots | pass with notes (canonical button, card radius) | pass | pass | no new integrity issue | — | BUG-035, BUG-043 verified | pass |

### Level 1 — workflows W1–W10 (round 2)

| W | Result | Notes |
|---|---|---|
| W1 vendor | pass | keyboard sign-in + TOTP; provision `initech` with a second admin; self-approval 422; operator2 approves (Implementation); `/vendor`, `/vendor/users`, `/vendor/support-sessions`, `/vendor/audit?action=TENANT.CREATED` (1 row) |
| W2 new admin | pass | `.eml` link (MAIL_DIR `apps/api/var/mail`), token stripped, password set, reuse refused, forced enrolment, lands on `/compliance` |
| W3 tenant admin | pass (defects) | see SC-28; step-up seen (admin2 > 10 min after MFA) |
| W4 settings | pass (known defect) | see SC-29 |
| W5 import | pass | see SC-24/25 |
| W6 compliance | pass | see SC-10/26/46; all figures equal `report.json` |
| W7 audit | pass (known defect) | see SC-30; export cap executed |
| W8 support session | pass (defects) | REALM_FORBIDDEN without session; first request (with snapshot creation) not approvable by the admin (BUG-047) and denied; second request approved with region confirmation; read-only frame "Vendor support session · read-only · acme"; in-scope read 200, `/v1/users` and settings 403 PERMISSION_DENIED and logged ACCESS_REFUSED, write 403 SUPPORT_SESSION_READ_ONLY; end → SUPPORT_SESSION_INACTIVE + notice |
| W9 isolation | pass | globex admin: 10 acme ids → 404 (incl. grant decision, deactivate, load), audit download 403; pages "Not found or not available"; analyst nav Compliance only, admin pages NotAvailable without API calls, admin APIs 403, no export |
| W10 phone + keyboard | pass (defect) | no page overflow on 23 routes at 390/768/1280 (+ harness at 4 widths); keyboard: sign-in, dialog focus trap + Escape return, drawer, first Tab after navigation lands inside `<main>`; dialogs full-screen at 390 but stretched at ≥ 640 (BUG-044) |

Console and network: every console error is an intended 4xx (self-approval, refusals, probes, cross-tenant 404s, step-up 403 before retry, ended session); no `pageerror`, no failed request other than navigation aborts, no 5xx in the API logs.

Not executed this round: support-session auto-expiry, go-live, > 50,000-row export, rejection of a grant.

### Level 3 — Impeccable audit (audit only) and accessibility pass

Detector: source scan of `apps/web/src` (same two `side-tab` findings as round 1: Stitch banner anatomy, design note) and rendered scan of `/signin` (no findings). Scripted pass on 23 routes at 1440: no unlabeled field, no unnamed control, no contrast failure found, one h1 per page, no heading-level jump, landmarks present; only text links under 24 px tall (breadcrumbs, "Open the rows…", R5 band links), each with spacing around it (WCAG 2.5.8 spacing exception; note).

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | BUG-028 still open; stacked step-up dialog (BUG-045) |
| 2 | Performance | not scored | SC-10 page now 2,289 px at 1440 (was 15,312) |
| 3 | Theming | 4 | canonical tokens, light only |
| 4 | Responsive | 4 | no overflow on 23 routes at 390/768/1280 |
| 5 | Implementation integrity | 3 | SC-10 follows sc_10 anatomy; dialogs stretched (BUG-044) |
| **Total** | | **14/16 (Performance not scored)** | Good |

Design notes (not defects): reports on tabs instead of sc_10's single page; at 390 the report tabs wrap into a vertical list; R5 band links 16 px tall; canonical-catalogue values listed in round 1 still apply.


## Round 1 (2026-11-12, after the Stitch re-skin)

Environment: `nmp_e2e` freshly seeded (`seed:e2e`), API `:4000` (tsx, NODE_ENV=development, COOKIE_SECURE=false), web `:3100` (`next start` on the current build: no source newer than `.next/BUILD_ID`). One browser at a time: Playwright MCP Chromium for Levels 1 and 3, the harness's own Chromium (Playwright 1.62.1) for Level 2. Both servers stopped by PID at the end.

| Screen | Stitch Reference | Functional Testing | Visual Fidelity | Responsive Testing | Accessibility | Impeccable Review | Defects | Fixes | Final Status |
|---|---|---|---|---|---|---|---|---|---|
| SC-10 Compliance reports | `sc_10_compliance_reports` | pass: W6 R1–R5 figures equal `report.json` (R1 2025-01 16.61 % / 1,517,950; R2 2025-12 41.26 / 4.54 / 116 / 75; R3 2025 22.55 / 15.27 / 10.80 / 51.38; R4 2025-12 277 / 55.23 / 52 / 0; R5 449 / 73.27 / 205.47 / 80.21 / 232.68 / 545.70 / 1,630.95 / 2,306.38, bands 120/121/188/20/0); trend "View as table"; compare 2025-12 vs 2025-11 (URL `period`, `compare`); Outdated banner after mapping draft v2 | fail: composition departs from sc_10 (generic per-figure cards, no R3 breakdown table, no R5 distribution bars, no R1 segmentation bar); report tabs clipped at every desktop width; chart axis labels overlap; hero value wraps. Harness: tableHeader missing-in-app (high), title 20 px at 390 (medium, mobile token) | pass (no page overflow at 1440/1280/768/390); default "All periods" renders 60 cards (15,312 px at 1440, 26,170 px at 390); chart text unreadable at 390 | pass with notes: labels/names complete, contrast checks clean, Create snapshot dialog traps focus and returns it; 60 h3 headings on the default view | integrity issues: see BUG-032..036 | BUG-032, BUG-033, BUG-034, BUG-035, BUG-036 | not executed (QA does not fix) | fail |
| SC-14 Vendor access sessions | `sc_14_vendor_access_sessions_authorizations` | pass: W8 request card, region approval required ("Confirm access from outside your data region"), approve, session log with refusals and params, End now, vendor redirected with "no longer open" notice | pass with notes: no request was pending at capture time, so the page primary (Approve) is absent in the capture (data state); table header uses canonical sc_01 style | pass (no overflow at all four widths) | pass: labels, names, contrast; Approve/Deny names carry no request context (one card at a time, noted) | no new integrity issue | BUG-038 (time left shows 1 h 1 min for a 60 min window); known BUG-023 (requester "Vendor user &lt;id&gt;") | not executed | pass with defects |
| SC-24 Data imports | `sc_24_data_imports` | pass: W5 upload of `data_synthetic` totals 1,466 / 4,775 / 7,442, sums 53,195,001 / 53,195,001 / 2,600,070 / 9,225,679 equal CSV sums; Validated → Mapped → Loaded; `email` column rejected row 1 col email FORBIDDEN_COLUMN; data-quality report | pass with notes: list, upload form and batch detail are separate routes (Stitch draws them on one page); page background and primary colour follow the canonical sc_01 tokens, not sc_24's own; visible table caption duplicates the subheading | pass (no overflow; list 390 px) | pass | no new integrity issue | BUG-042 | not executed | pass with defects |
| SC-25 Import mapping | `sc_25_import_mapping` | pass: draft v1 by admin, approval by compliance officer at `/compliance/mappings?version=`, read-only approved view, "Start a new draft" → v2 draft marks the snapshot Outdated | pass with notes: tabs, partner-code table, side panels and approval bar follow sc_25; canonical table header | fail at 390: version meta strip does not wrap (page 384 px wide) | pass | no new integrity issue | BUG-037; known BUG-029 ("another user") | not executed | pass with defects |
| SC-26 Figure drill-down | `sc_26_figure_drill_down` | pass: 102 numerator rows, sums line "Sums match the figure", logged CSV export (102 rows + watermark), Back to snapshot; analyst sees no export | pass with notes: definition panel is far smaller than sc_26's formula card (net sales has no denominator); canonical button weight 600 vs sc_26 400 | pass | pass | no new integrity issue | — | not executed | pass |
| SC-27 Sign-in and second factor | `sc_27_sign_in_and_second_factor` | pass: keyboard-only vendor sign-in (Tab order email → password, Enter) and TOTP; invitation link strips the token, single-use ("This invitation link does not work"), forced enrolment via manual key; tenant prefilled from `?tenant=` | pass: all landmarks match (worst severity none); decorative gradient bar, WebAuthn path and footer claims correctly omitted | pass | pass | detector (rendered `/signin`): no findings | — | not executed | pass |
| SC-28 Users and roles | `sc_28_users_and_roles` | pass: W3 invite dave, Compliance officer grant pending, self-approval hidden and API 422 SOD_SELF_APPROVAL, Executive read-only (DEMO) immediate, admin2 approves, revoke, deactivate, "would leave one administrator" refusal | pass with notes: primary colour and table header follow canonical tokens; section-heading line height 24 vs 20 | pass (approvals stacked at 390) | fail (LOW, known BUG-028): focus falls to body after Revoke and Deactivate | no new integrity issue | known BUG-028 | not executed | pass with known defects |
| SC-29 Tenant settings (MVP-A subset) | `sc_29_tenant_settings` | pass: W4 four thresholds and a breach contact saved as versions with reasons | pass with notes: no page primary and no version-history table (no API for history; changes are per-setting dialogs); card radius 2 vs 0 | pass | pass | no new integrity issue | known BUG-025 (all "version 5") | not executed | pass with known defects |
| SC-30 Audit log | `sc_30_immutable_audit_log_verification` | pass: chain verified intact (39 events), action filter in URL with removable chip, event drawer (dialog, focus to Close, Escape returns focus), export 1 row + download | pass with notes: canonical primary 32 px / 13 px vs sc_30 36 px / 16 px; table header canonical | pass | fail (LOW): "Open event N" buttons 20×28 px | no new integrity issue | BUG-039, BUG-040; known BUG-027 ("1 events") | not executed | pass with defects |
| SC-39 Vendor operations console | `sc_39_vendor_operations_console` | pass: W1 provisioning with validation summary, self-approval refused ("A second vendor user must do this step."), operator2 approves, tenant detail, vendor users, vendor audit filter in URL; W9 cross-tenant isolation (11 acme API ids → 404, download 403; pages "Not found or not available") | pass with notes: fleet KPIs, filter search and docked request panel not drawn (no API) | pass (console is desktop-only by rule; no overflow anyway) | fail (LOW): provisioning headings jump h1 → h3 | no new integrity issue | BUG-041 | not executed | pass with defects |
| SC-46 Compliance overview | `sc_46_compliance_overview_overlay_home` | pass: headline figures R1–R5 latest period with change since previous month, numerator/denominator, trend, data coverage, recent snapshots, data status | needs review: canonical button 32 px vs 30, table header and card radius canonical; headline card change text wraps to four lines beside the sparkline; chart axis labels overlap (BUG-035) | pass | pass; chart points focusable with visible focus stroke | no new integrity issue | BUG-035, BUG-043 | not executed | pass with defects |

## Level 1 — workflows W1–W10

| W | Result | Notes |
|---|---|---|
| W1 vendor | pass | Keyboard sign-in + TOTP; provision `initech` (error summary focused when market pack missing); self-approval refused; operator2 approves; `/vendor/users`, `/vendor/audit?action=TENANT.CREATED` (1 row) |
| W2 new admin | pass | `.eml` link → token stripped from URL, password set, link single-use, forced enrolment (manual key), lands on `/compliance` |
| W3 tenant admin | pass (known defect) | See SC-28; BUG-028 still present |
| W4 settings | pass (known defect) | See SC-29; BUG-025 still present |
| W5 import | pass | See SC-24/SC-25 |
| W6 compliance | pass | See SC-10/SC-26/SC-46; Outdated checked at the end of the run so the visual capture used a Ready snapshot |
| W7 audit | pass (known defect) | See SC-30; BUG-027 still present. Export row-cap refusal: not executed this round (needs an API restart with EXPORT_ROW_CAP) |
| W8 support session | pass (known defect) | REALM_FORBIDDEN without session; request; region approval; read-only frame "Vendor support session · read-only · acme"; write → 403 SUPPORT_SESSION_READ_ONLY; out-of-scope reads 403 and logged ACCESS_REFUSED; end → redirect with notice. BUG-023 open part still present. BUG-030 (Outdated banner in a session): not executed this round |
| W9 isolation | pass | globex admin: every acme id 404 (audit download 403 by permission first), pages NotAvailable; acme analyst: nav Compliance only, admin pages NotAvailable, admin APIs 403, no export control |
| W10 phone + keyboard | pass (defects) | Overflow sweep of 15 routes × 4 widths: only SC-25 at 390 overflows (BUG-037). Keyboard: sign-in, dialog focus trap and return, drawer Escape. Step-up dialog not seen this round (every action came within 10 min of the user's MFA) |

Console and network: every console error is an intended 4xx (probes, self-approval, refusals, cross-tenant 404s, ended session); aborted requests are RSC prefetch cancels on navigation. No `pageerror`, no CSP violation, no 5xx in the API log (`var/e2e-api.log`). Console logs: `var/e2e-fixtures/exports-r4/mcp-console/`.

## Level 3 — Impeccable audit (audit only) and accessibility pass

Impeccable ran in audit mode only (no PRODUCT.md/DESIGN.md: it used the incumbent implementation as authority). Detector: source scan of `apps/web/src` and rendered scan of `/signin`; authenticated pages were not scanned by the detector (it cannot carry a session), they were checked by the scripted pass below.

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | Labels, accessible names, landmarks, `aria-current`, dialog semantics (native `<dialog>`, `aria-modal`, labelled) and contrast checks clean on 14 routes; gaps: focus to body after Revoke (BUG-028), 20×28 px event buttons (BUG-040), h1→h3 jump (BUG-041) |
| 2 | Performance | not scored | Not measured. Observation: SC-10 default view renders 60 figure cards (BUG-033) |
| 3 | Theming | 4 | Tokens from the canonical Stitch theme, light-only as decided; no hard-coded colours found by the detector |
| 4 | Responsive | 3 | No page overflow on 14 of 15 routes at 390; SC-25 meta strip overflows; SC-10 chart text unreadable at 390 |
| 5 | Implementation integrity | 2 | SC-10 departs from its Stitch composition (BUG-032, 033, 034); otherwise coherent with the catalogue |
| **Total** | | **12/16 (Performance not scored)** | Acceptable to good: SC-10 needs the most work |

Detector findings, judged against Stitch:
- `side-tab` accent border on `components/banner.tsx:26` and `components/error-summary.tsx:32` (`border-l-4`): this is the Stitch banner anatomy (sc_17 l.37, sc_08, sc_10, sc_15). Design note, not a defect.

Design notes (issues in the original design or deliberate catalogue choices, not defects):
- Per-screen Stitch values differ from the canonical catalogue (§1.4, §8): button height 30/34/36 px vs canonical 32; table header 12 px/700 vs canonical sc_01 11 px/600; page background `slate-50` and primary `primary-container` in sc_24/25/28 vs canonical `background`/`primary`; card radius 0 vs 2. The app follows the canonical instances, as the guidelines require.
- Stitch MVP-A drawings overflow at 390 (and sc_29/30/39 at 768); the app correctly does not reproduce that.
- After every route change AppShell focuses `<main>`, so the first Tab lands inside the page and the skip link is reached only with Shift+Tab. Acceptable (the user is already at the main content); noted for the frontend lead.
- A Compliance officer sees other actors as "User fa261b42" in the audit log (no `user.read`); by permission design.
- In a support session scoped to "Compliance reports", `GET /v1/settings/compliance.late_order_day` returns 200 (other settings and users are refused). Plausibly part of the compliance read scope; for the API owner to confirm, not registered.
- Approve/Deny on SC-14 request cards are named "Approve"/"Deny" without the request reference; fine with one card, ambiguous with several.

## Increment B1 — round 1 (2026-11-17)

Environment: `nmp_e2e` freshly seeded (`seed:e2e`, fixture pack `e2e-fixture`), API `:4000` with workers (tsx, NODE_ENV=development, COOKIE_SECURE=false), web `:3100` (`next start`, no source file newer than `.next/BUILD_ID`). One browser at a time: Playwright MCP Chromium (one context per user: admin, admin2, compliance, finance, analyst @acme, admin @globex, operator @vendor), closed before the harness ran its own Chromium. Browser time zone Asia/Dhaka. Both servers stopped by PID tree at the end. Evidence: `var/qa-b1/` (screens W1-…–W6-…, R390-…, audit export CSV, harness logs), API log `var/e2e-api.log` (0 responses 5xx, 0 error-level lines). Payment and payout providers were recorded as sandbox names only; the only outbound call was the webhook dispatcher's DNS lookup of `hooks.invalid.example` (reserved TLD, fails by design).

### Workflows (PLAN §7)

| Workflow | Result | Evidence and notes |
|---|---|---|
| W-B1-1 Markets, brands, calendars | pass (defects) | FR created (EUR · 2 decimals, Europe/Paris, fr, `e2e-fixture`) as Draft; empty submit lists six errors; duplicate FR → "The tenant already has market FR."; brand "Acme Nutrition"; calendar "FR monthly" from 2026-12-01, 12 ahead → drawer 12 periods Dec 1 2026 00:00 … Dec 1 2027 00:00 "in local time of Europe/Paris"; renamed "France monthly"; Extend through 2028-02-01 → "3 periods added", 15; delete FR refused "It is referenced by 1 calendar." (no version written); versions 1–5 with reasons, diff drawer (600 px) "Markets added: FR, DEMO" / "Calendars added: FR monthly", Escape returns focus to the row button. Defect: Generated through in viewer time zone (BUG-054) |
| W-B1-2 Money settings with SoD | pass (defects) | Rounding mode Half even, effective 2026-12-01 05:00 local (= Paris midnight) → "Waiting for Finance approval", Can approve: Finance Approver (finance@acme.example) only; past date refused (raw message, BUG-055); admin's own decision via API 403 PERMISSION_DENIED; finance@acme > Approve → step-up dialog is the only `dialog[open]`, focus `step-up-code`, fresh TOTP, retried → version 7 Scheduled with approver; Active earner threshold 5000 saved now → v8 in force, v9 "Rebased v7 onto v8" Scheduled, v7 "Superseded by version 9"; "In force since … (version 8)" for the threshold and "(version 6)" for contacts (BUG-025 fixed); finance sees breach-contact diff as "The values are hidden". Defects: approver recorded as author (BUG-049), rebased versions' diff shows the wrong key (BUG-050) |
| W-B1-3 Launch checklist and go-live | pass (defects) | Request go-live refused naming 8 items incl. Payout/Payment provider eligibility and Breach notification contacts; fake PDF refused ("Upload a PDF, PNG or JPEG file.", 415 by magic bytes); licence/tax/agreement PDFs recorded with SHA-256 equal to `shasum` of the files; payout + payment provider approvals (document, description, date ≤ today, funds holder); region and plan-variant attestations (empty note refused); breach contact added; pack rules show "E2E FIXTURE — enrolment-only bonus · Screening" and withholding "Counsel confirmed"; Request go-live → "Waiting for sign-off", Can sign off: Compliance Officer only; admin and admin2 see no sign-off control; compliance@acme Sign off without statement → "Enter your risk acceptance statement."; with statement → step-up dialog (single) → FR Live, chip Live in Markets, delete action gone; audit `MARKET.WENT_LIVE` by Compliance Officer with `approver`, `accepted_rules` [e2e-enrolment-only-bonus], outbox `market.went_live`. Defects BUG-051, 052, 053, 058, 059 |
| W-B1-4 API keys | pass (one step not executable) | Service account "BI export"; key `compliance:read`, Standard → step-up → token shown once (48 chars, `nmpk_` prefix), Done; token not in the page afterwards; bearer from page (`credentials: omit`): 200 with the acme DEMO snapshot only, detail 200, `/v1/markets` with bearer 401 UNAUTHENTICATED, unknown token 401 API_KEY_INVALID + `WWW-Authenticate: Bearer`; IP allow-list `999.1.1.1` refused in the dialog, key limited to 203.0.113.0/24 → 403 IP_NOT_ALLOWED; rotate grace 0 → old 401, new 200, old row Expired; revoke → 401, focus to the section heading; audit SERVICE_ACCOUNT.CREATED, API_KEY.CREATED/ROTATED/REVOKED, API_KEY.READ with actor_type `service_account`. Not executable: "key without the scope → 403 SCOPE_MISSING" — the B1 catalogue has one scope and a key needs at least one (`scopes: []` → 400 VALIDATION_FAILED) |
| W-B1-5 Webhooks | pass | `http://…` → "Enter an address that starts with https://."; `https://127.0.0.1/…` and `https://10.0.0.5/…` → "The address is not on the public internet."; `https://hooks.invalid.example/nmp` + `compliance.snapshot.ready` → secret shown once; Send test → queued; snapshot created → both events attempted by the dispatcher (about 85 s after the test, pg-boss cron), attempt 1 Failed "The host name could not be found." (DNS_FAILED), attempt 2 Scheduled; Retry now → "scheduled to run now" (next_attempt_at moved to now in the DB), attempt 2 failed, attempt 3 scheduled; endpoint Disabled → attempt 3 of both "Cancelled · The endpoint was disabled before the attempt."; ENDPOINTS FAILING 1. Defect BUG-057 (focus after Retry now) |
| W-B1-6 MVP-A polish retest | pass | BUG-023 tenant card "Vendor Operator (operator@vendor.example)"; BUG-025 per-value version; BUG-026 month fields are text inputs (`inputMode numeric`, pattern), typed 2025-13 refused, 2025-01 accepted in Upload export and Create snapshot; BUG-027 "1 event."; BUG-028 focus to H1/H2 after Deny, Reject grant, Revoke key, End now, and to the users table region after Revoke role; BUG-029 admin sees "Approved by Compliance Officer (compliance@acme.example)", "by you" for self; BUG-045 one `dialog[open]` during step-up (settings approval, sign-off, vendor approval, deny, reject); BUG-046 "You may be asked for a code…" in breach contacts, approve/reject grant, approve/deny vendor access; BUG-047 each area names its approving role, tenant card "You cannot approve: Row exports"; BUG-048 no "Compensation plans" |

### MVP-A regression

| Area | Result | Notes |
|---|---|---|
| Sign-in / MFA | pass | five acme staff + globex admin: password then forced enrolment (manual key) or TOTP; analyst without MFA; vendor TOTP at `/signin/vendor` |
| Import | pass | DEMO 2025-01…2025-12: 1,466 / 4,775 / 7,442 rows, 53,195,001 / 53,195,001 / 2,600,070 / 9,225,679 = CSV sums; mapping v1 by admin, approved by compliance; attached; Loaded |
| Snapshot | pass | R1–R5 DEMO 2025: Ready, R1 2025-01 16.61 %, latest 42.06 % (= report.json) |
| Audit | pass | export `?action=MARKET.WENT_LIVE` 1 event + download (`var/qa-b1/audit-export.csv`); chain Intact over 100 events |
| Support session (B1 scopes) | pass | "Market launches" approvable by Tenant admin; in session the FR checklist is read-only (no write controls), writes 403 SUPPORT_SESSION_READ_ONLY, `/v1/service-accounts` 403 (integration.manage excluded), after End now 403 SUPPORT_SESSION_INACTIVE |
| Isolation and permissions | pass | analyst: nav Compliance only, `/settings`, `/settings/markets`, `/settings/markets/:id`, `/settings/integrations` "Not found or not available to you", calendars/service accounts/webhooks/versions/checklist 403; globex admin: acme FR market and checklist 404, page Not available, own lists empty; finance: no Markets nav, approve controls only |

### Per screen

| Screen | Stitch Reference | Functional Testing | Visual Fidelity | Responsive Testing | Accessibility | Impeccable Review | Defects | Final Status |
|---|---|---|---|---|---|---|---|---|
| SC-29 Tenant settings | `sc_29_tenant_settings` | pass (W-B1-1/2) | pass with notes: canonical primary colour and table-header weight (as MVP-A); sc_29's privacy/visibility, retention, write-off and payout cards absent by plan (§5 must-not) | pass (no page overflow at 390, 768) | label-in-name (BUG-056); headings H1 → H2 → H3 in order | no detector finding (source) | BUG-049, 050, 055, 056 | pass with defects |
| Markets, brands, calendars | none (guidelines §9) | pass (W-B1-1) | consistent with sc_28/sc_29 section and table patterns | pass (390, 768) | tabs are `role=tab` with arrow-key selection; dialogs focus first field, trap Tab, Escape returns to trigger | no finding | BUG-054 | pass with defects |
| SC-17 Market launch checklist | `sc_17_market_launch_checklist` | pass (W-B1-3) | pass with notes; gate table clipped beside the inspector (BUG-052); harness "primary missing" = market is Live (no Request go-live by state) | fail at 390 (page scroll, BUG-051); pass at 768 | no contrast failure in main; Inspect buttons named per item | no finding | BUG-051, 052, 053, 058, 059 | pass with defects |
| SC-13 Integrations | `sc_13_integrations_and_sync_health` | pass (W-B1-4/5) | pass with notes: connector cards, backfill, sparkline omitted by plan; page background canonical | pass (390, 768; key table scrolls in its card) | label-in-name on Retry now (BUG-056); focus after Retry now (BUG-057) | no finding | BUG-056, 057 | pass with defects |

### Impeccable audit (audit only) and accessibility pass

- Detector (`impeccable detect`, regex mode) on `features/markets`, `features/integrations`, `features/admin/settings`: 35 files, no finding. Rendered element rules not run: the B1 pages need a signed-in session the detector's own browser does not have.
- Scripted pass on 7 routes (`/settings`, markets ×3 tabs, checklist, integrations ×2 tabs): no unnamed control, no unlabelled input, no duplicate id, no positive tabindex, no `img` without alt, heading order valid; contrast check of text in `main` on the checklist: no ratio below 4.5:1. Keyboard: Add market dialog focuses Country code, Tab stays in the dialog, Escape returns to Add market; Markets tabs move with ArrowRight.
- Scores (0–4): Accessibility 3 (BUG-056, 057), Performance not scored (no trace), Theming 3 (canonical tokens throughout, light theme only by guidelines), Responsive 2 (BUG-051 page scroll at 390, BUG-052 clipped table at 1440/1280), Implementation integrity 3 (no placeholders, refused content or dead controls seen; BUG-049/050 make the version history misleading). Total 11/16 over the four scored dimensions.

### Notes (not registered)

- Version 1's diff lists "Markets added: FR, DEMO": DEMO existed before the first version, which has nothing to compare against.
- The Rounding mode card shows only the value in force ("Platform rule"); the scheduled Half even from Dec 1 is visible only in the versions table.
- "Public API keys 1" tab counter counts service accounts (0 usable keys at that moment); "ENDPOINTS FAILING 1" still counts a disabled endpoint whose last attempt failed.
- Webhook dispatcher latency: first attempt about 85 s after Send test (cron each minute plus pg-boss jitter), within the "about a minute" copy only loosely.
- Not exercised: secret rotation with grace, delivery give-up after 72 h (`dead`), withdraw of a change or go-live request, go-live rejection, calendar delete, brand rename/delete, rate-limit 429 on keys, cases (not mounted in B1).

## Increment B1 — round 2 (2026-11-17, retest after the fixes of BUG-049..059)

Environment as round 1: `nmp_e2e` re-seeded (`seed:e2e`), API `:4000` with workers (NODE_ENV=development, COOKIE_SECURE=false), web `:3100` `next start` on the build of 04:14 (no web source newer than `.next/BUILD_ID`). One Playwright MCP browser (contexts: admin, finance, compliance, analyst @acme, admin @globex), closed before the harness. Browser time zone Asia/Dhaka. Servers stopped by PID tree. API log: 0 responses 5xx, 0 error-level lines. Evidence `var/qa-b1/R2-*`. Sandbox provider names only; the only outbound call was the dispatcher's DNS lookup of `hooks.invalid.example`.

### Fix verification (first step)

| Defect | Result | Evidence |
|---|---|---|
| BUG-049 MEDIUM | verified fixed | admin requested Rounding mode Half even from Dec 1 (Paris midnight); finance approved; `GET /v1/settings/versions` v6 `created_by` Tenant Admin, `approval.approver` Finance Approver; table Author "Tenant Admin", Finance approver "Finance Approver" |
| BUG-050 MEDIUM | verified fixed | Active earner threshold 5000 saved now (v7) → v8 "Rebased v6 onto v7" changed `[money.rounding_mode]`; drawer of v8 "Rounding mode · Before Not set · After Half even"; after go-live (v11 structure) v12 again `[money.rounding_mode]` |
| BUG-051 MEDIUM | verified fixed | checklist at 390x844: scrollWidth 375 = clientWidth, `scrollTo(300,0)` leaves scrollX 0; same for /settings, /settings/markets, /settings/integrations; harness capture 390 px wide (was 526) |
| BUG-052 LOW | verified fixed | 1440x900: gate table 772 px in a 772 px column, four columns (Item, Basis or detail, Evidence and record, Status) all visible; 1280x800: inspector below the full-width table (`var/qa-b1/R2-checklist-1440.png`, harness 1280 capture) |
| BUG-053 LOW | verified fixed | Request go-live refused with 8 items; after the licence upload the refusal alert is gone, banner "FR is not live: 7 items are missing" |
| BUG-054 LOW | verified fixed | Calendars "Generated through" "Dec 1, 2027, 00:00", after Extend "Mar 1, 2028, 00:00", same as the periods drawer |
| BUG-055 LOW | verified fixed (client path) | Effective from 2026-11-01 00:00: inline error "Enter a date and time from now on: a change cannot take effect in the past.", `aria-invalid="true"`, `aria-describedby` = the error, no request sent. The server-refusal mapping was not exercised (the client check stops it first) |
| BUG-056 LOW | verified fixed | names "View diff of version 8", "Retry now: webhook.test attempt 2" |
| BUG-057 LOW | verified fixed | after Retry now: status "The delivery is scheduled to run now.", focus on H3 "Deliveries to https://hooks.invalid.example/nmp" |
| BUG-058 LOW | verified fixed | provider rows "Recorded by Tenant Admin, Nov 17, 2026, 4:21 AM" |
| BUG-059 LOW | verified fixed | Sign off dialog "Mandatory market-pack rules still at screening status: E2E FIXTURE — enrolment-only bonus."; after go-live subtitle "FR is live: enrolments and orders for it are accepted." |

### Workflows (PLAN §7, quick repeat)

| Workflow | Result | Notes |
|---|---|---|
| W-B1-1 Markets, brands, calendars | pass | FR (EUR, Europe/Paris, fr, `e2e-fixture`) Draft; brand Acme Nutrition; FR monthly from 2026-12-01, 12 ahead → drawer 12 periods 00:00 bounds; Extend to 2028-02-01 "3 periods added" (15); renamed "France monthly"; delete FR refused "It is referenced by 1 calendar." |
| W-B1-2 Money settings with SoD | pass | pending card "Can approve: Finance Approver (finance@acme.example)" only; past date refused inline; finance approved; threshold "In force since Nov 17, 2026, 4:20 AM (version 7)"; scheduled change rebased and intact |
| W-B1-3 Launch checklist and go-live | pass | refused with 8 items; licence/tax/agreement PDFs with SHA-256 equal to `shasum -a 256`; payout + payment provider approvals; region and plan-variant attestations; breach contact; request → "Waiting for sign-off", Can sign off: Compliance Officer only; compliance: no statement → "Enter your risk acceptance statement."; with statement → FR Live; audit `MARKET.WENT_LIVE` #44 by Compliance Officer; chain Intact (44) |
| W-B1-4 API keys | pass (SCOPE_MISSING not executable, as round 1) | service account "BI export"; key shown once (48 chars) behind "I have stored the API key"; not in the page afterwards; bearer 200; rotate grace 0 → old 401, new 200; revoke → 401, focus to H2 "Service accounts and keys"; after the snapshot a new key reads 1 snapshot (DEMO) and `/v1/markets` with bearer 401 |
| W-B1-5 Webhooks | pass | `http://` refused "Enter an address that starts with https://."; `https://127.0.0.1/…` "The address is not on the public internet."; secret shown once; Send test → attempt 1 Failed "The host name could not be found." within about a minute; Retry now; snapshot → `compliance.snapshot.ready` attempt 1 Failed, attempt 2 Scheduled; disabled → pending attempts "Cancelled · The endpoint was disabled before the attempt." New this round: Rotate secret with 60 min grace → secret shown once, "Old secret valid until" 5:25 AM |
| W-B1-6 MVP-A polish | not repeated | verified in round 1; no polish fix in this round |

### MVP-A regression (quick)

| Area | Result | Notes |
|---|---|---|
| Sign-in / MFA | pass | admin, finance, compliance, globex admin: password then forced enrolment; analyst without MFA; step-up dialogs answered with fresh TOTP (403 STEP_UP_REQUIRED then retry) |
| Import | pass | DEMO 2025-01…2025-12: 1,466 / 4,775 / 7,442; 53,195,001 / 53,195,001 / 2,600,070 / 9,225,679; mapping v1 by admin, approved by compliance; attached; Loaded |
| Snapshot | pass | R1–R5 Ready; R1 2025-01 16.61 %, latest 42.06 % (= report.json) |
| Audit | pass | filter `MARKET.WENT_LIVE` 1 event; chain Intact over 44 events |
| Isolation and permissions | pass | analyst: checklist page Not available; service accounts, webhook endpoints, versions, checklist 403; globex admin: FR market and checklist 404, page Not available |

### Per screen

| Screen | Functional | Visual | Responsive | Accessibility | Impeccable | Defects | Final Status |
|---|---|---|---|---|---|---|---|
| SC-29 Tenant settings | pass | pass with notes (canonical tokens, as round 1) | pass (390, 768) | pass (label-in-name fixed) | no finding | — | pass |
| Markets, brands, calendars | pass | consistent with sc_28/sc_29 patterns | pass (390, 768) | pass | no finding | — | pass |
| SC-17 Market launch checklist | pass | pass with notes; table fits at 1440/1280 | pass (390 no page scroll; tables scroll in their own wrappers at 390/768) | pass | no finding | BUG-060 (new LOW) | pass with defects |
| SC-13 Integrations | pass | pass with notes (canonical background, omissions by plan) | pass (390, 768) | pass (Retry now name and focus fixed) | no finding | — | pass |

### Impeccable audit (audit only) and accessibility pass

- Detector (`impeccable detect`, regex mode) on `features/markets`, `features/integrations`, `features/admin/settings`, `components/data-table.tsx`: 36 files, no finding (element rules not run: signed-in pages).
- Scripted pass on 7 routes (`/settings`, markets ×3 tabs, checklist, integrations ×2 incl. deliveries): one H1 each, no unnamed control, no unlabelled input, no duplicate id, no positive tabindex, no `img` without alt, no heading skip. The label-in-name script flagged "Change", "Create key", "Rotate", "Edit", "Refresh": false positives (the icon ligature text was counted as label); each accessible name starts with the visible word ("Change rounding mode", "Create key for BI export", "Rotate key …", "Edit https://…", "Refresh deliveries to …").
- Scores (0–4): Accessibility 4, Performance not scored (no trace), Theming 3 (canonical tokens, light theme only by guidelines), Responsive 4, Implementation integrity 3 (BUG-060 word split; no placeholders, refused content or dead controls). Total 14/16 over the four scored dimensions (round 1: 11/16).
- Console errors: only intended 4xx (409 delete FR, 422 go-live refusal and webhook address, 401 revoked/rotated keys and bearer on /v1/markets, 403 step-up challenges and analyst probes, 404 globex probes and a wrong audit URL typed by QA). No page errors, no 5xx.

### Notes (not registered)

- After go-live the checklist still counts "8 of 9" complete and "Needs risk acceptance 1" for the market-pack basis: true of the rule's basis, but the accepted risk is visible only in the Go-live requests table.
- Rebased version reasons nest on every rebase ("Rebased v10 onto v11: Rebased v8 onto v9: Rebased v6 onto v7: Align rounding…").
- "ENDPOINTS FAILING 1" still counts the disabled endpoint (as round 1).
- Not exercised: delivery give-up after 72 h (`dead`), withdraw of a change or go-live request, go-live rejection, calendar delete, brand rename/delete, key rate-limit 429, SCOPE_MISSING, the server-side BUG-055 mapping.

## Increment B2 — round 1 (2026-11-17)

Environment: `nmp_e2e` freshly seeded (`seed:e2e`: STAFF incl. support@ and dpo@, acme market NL live with monthly periods, Jan–Aug 2026 committed), API `:4000` with workers (tsx, NODE_ENV=development, COOKIE_SECURE=false), web `:3100` (`next start` on the build of 16:45, no source file newer than `.next/BUILD_ID`). Servers left running from an earlier attempt (started 07:50, before that build) were stopped by PID tree first. One browser at a time: Playwright MCP Chromium with one context per user (admin, compliance, dpo, finance, support, analyst @acme; admin @globex), closed before the harness ran its own Chromium. Browser time zone Asia/Dhaka. Both servers stopped by PID tree at the end. Evidence `var/qa-b2/` (R1-*.png, harness logs `R1-visual-*.log`, `api.log`, `web.log`). API log: 0 responses 5xx, 0 error-level lines, no participant name, e-mail, identity reference or webhook secret; audit rows and outbox payloads scanned in the DB for the same values: 0 hits. No commerce or payment provider was called: orders came from the page with an `orders:write` key and a FIXTURE Shopify payload signed in the page with `crypto.subtle` to the local connector URL.

### Workflows (PLAN §7)

| Workflow | Result | Evidence and notes |
|---|---|---|
| W-B2-1 Types and policies | pass (defect) | admin proposed DIST (earn, sponsor, hold positions) and RETAIL (end customer) → "Waiting for Compliance approval", "Can approve: Compliance Officer (compliance@acme.example)", no approve control for admin; admin's decision by API 403 PERMISSION_DENIED (admin lacks `participant_type.approve`, so the SoD message is not reachable for the proposer); compliance approved both → Active. admin set crediting event paid, purpose required, precedence link → servicing, new buyers RETAIL, reassignment sponsor / 0 days, duplicate matching identity_ref + payment_fingerprint, 1 match, hold, placement width 2, sync health 60 / 240 (versions 1–8, values typed by the workflow; every unset card stated its consequence before). Visibility named_depth 1: effective date required ("Enter the date and time the change takes effect."), sent from 17:30 → "Waiting for DPO approval … CAN APPROVE Data Protection Officer (dpo@acme.example)"; finance sees no request and its decision by API 403; dpo approved → version 9 Scheduled. Defect BUG-074 |
| W-B2-2 Agreement | pass | compliance published "NL v1" for NL with `distributor-agreement.pdf`, acceptance required → Current, 0/0; SC-17 NL "Participant agreement versions · Version NL v1 · Complete" (`R1-W2-sc17-nl.png`) |
| W-B2-3 Enrolment and record | pass (defect) | support enrolled A (DIST, no sponsor), B (sponsor P-A, placement P-A auto), C (sponsor/placement P-B auto), K (RETAIL, sponsor P-C → serviced by P-C "At enrolment"), E (DIST); NL without acceptance refused in the form ("Enrolment in NL needs the participant's acceptance of NL v1.") and by API 422 AGREEMENT_ACCEPTANCE_REQUIRED; D with B's identity reference → created, chip "Duplicate review", position P-D Pending. SC-09 for B: positions, types history, servicing, agreements (NL v1), cases links, contact masked (b•••@e•••.test). finance > Show contact (> 10 min after MFA) → step-up dialog → bram@example.test shown; audit #75 PARTICIPANT.UNMASKED `after {participant_id, fields:["email"]}`, no values. Defect BUG-073 (focus) |
| W-B2-4 Explorer and visibility | pass (defect) | analyst: stale banner "The tree changed and is being rebuilt … (about a minute)" right after enrolment, read model v2 current about a minute later; search NL-A → Focus; P-B expanded → P-C ("1 direct · 1 position in subtree"); as of 2026-11-16 → "No owner at this date", no children; View as P-A → B and D named "1 level below", level 2 "1 position" only, contact masked; P-E (outside A's downline) by URL → "Not found or not available to you", API 404. Defect BUG-079 |
| W-B2-5 Change and correction cases | pass | support: "A under C" refused at open "Refused: this change would create a cycle …" (409); "C under A" from 2026-11-17 with PDF evidence → submitted, preview "Current parent P-B → P-A", "Structural check passed", "No committed period affected"; support has no decision bar, API 403; compliance approved with step-up → explorer stale banner, then v3 current with C under A. Correction of B's sponsor to P-E "When the current parent started (4:53 PM)" → preview structural check + "No committed period affected" + "Payout impact is calculated once runs exist (B3)"; compliance rejected (empty reason refused "Enter the reason."). Affected committed periods list not reachable in the browser (PLAN: covered by TS-03/T-B2-18) |
| W-B2-6 Duplicate and transfer | pass (defect) | support opened D's review on /cases/duplicates: subject NL-D vs matched NL-B side by side, "Identity reference" highlighted, hash note; proposed Allow (submit hidden until saved), submitted; compliance approved → P-D Active, chip gone. Transfer P-C → NL-E (Sale, evidence) → preview "The new owner's type can hold positions", approved → NL-C owned until 5:04 PM, NL-E owns P-C from 5:04 PM. Defect BUG-080 |
| W-B2-7 Orders by API key | pass (defects) | admin: service account + key `orders:write` (step-up) and a second key `compliance:read`; volumes SKU-1 1,000 pv, SKU-2 2,500 pv from 2026-01-01 (local). Bearer from the page with `credentials: omit`: O-1001 for NL-K with link P-C → 201, RETAIL, purpose customer, attribution P-C "Referral link", 4,500 pv; same key + body → same response; new key, same body → 200 `replayed: true`; changed body → 409 ORDER_CONFLICT and a Rejected row in the Exception queue; same Idempotency-Key with another body → 422 IDEMPOTENCY_KEY_REUSED; SKU-9 → 202 held UNKNOWN_SKU, listed Held; SKU-9 row from 2026-01-01 → Retry → "Processed", order O-1002 attributed by servicing; personal purpose for an end customer → 422 PURPOSE_INVALID; O-0820 (new buyer NL-N2, paid 2026-08-20, committed August) → late, listed on SC-31 (Late chip) and /periods/late; order for K in August → 422 BUYER_TYPE_MISSING (K had no type then, as PLAN says); return of line 2 → only line 2 reversed (-2,500 pv); equal-value exchange → "Volume effect: none"; `compliance:read` key → 403 SCOPE_MISSING (B1 "not executable" item now covered). Defects BUG-075, 076, 077 |
| W-B2-8 Late queue | pass (defects) | analyst: KPI pending 2; Diagnose O-0722 → original period, effect, "Raise restatement instead" → decided Restatement; select O-0820 → preview "Items 1, Volume 1,000 pv, Positions affected 0" → Accept 1 item → Decided; KPI decided 2. Defects BUG-071, BUG-072 |
| W-B2-9 Termination and reassignment | pass | support's status dialog offers Suspended only; compliance terminated P-C ("Termination reassigns customers" warning) → Terminated; K's servicer P-A "Reassigned on termination" from 5:07 PM; O-1001/O-1002 keep P-C; a new K order → P-A by servicing |
| W-B2-10 Connector and health | pass | admin added Shopify connector "NL Shopify store" for NL (secret write-only) → "Receiving", webhook URL copied (clipboard = the shown URL, status "The webhook URL was copied."); page-context POST without `X-Requested-With`: wrong signature → 401 SIGNATURE_INVALID; signed FIXTURE `orders/paid` (tag `nmp:NL-K`, `nmp_ref` P-B) → 200, order 820000002 for NL-K, link P-B, 12.50 EUR + tax 2.63 (an earlier payload of mine without `created_at` was stored Rejected PAYLOAD_INVALID, as designed). Sync health: thresholds note "Behind after 1 h … failing after 4 h", connector Healthy (after one Failing state caused by the refused payload), Order API source Healthy |
| W-B2-11 Regression | pass | see below; 4 viewports for every B2 screen in the harness section of VISUAL_REGRESSION_REPORT |

### MVP-A regression (quick)

| Area | Result | Notes |
|---|---|---|
| Sign-in / MFA | pass | six acme staff + globex admin: forced enrolment (manual key) and TOTP; support and analyst without MFA; step-up dialogs seen for unmask, settings approval and case decisions after 10 min |
| Import | pass | DEMO 2025-01…2025-12: 1,466 / 4,775 / 7,442 rows; 53,195,001 / 53,195,001 / 2,600,070 / 9,225,679 = CSV sums; mapping v1 by admin, approved by compliance at /compliance/mappings; attached; Loaded |
| Snapshot | pass | R1 DEMO 2025-01: Ready, end-customer share 16.61 % of 1,517,950 (= report.json) |
| Audit | pass | chain Intact over 134 events; PARTICIPANT.UNMASKED filter; actor names shown to admin (compliance sees "User <id>": no `user.read`, as before) |
| Isolation | pass | globex admin: acme participant, case, order, position 404; `/people/<acme id>` "Not found or not available to you"; participant list empty |

### Per screen

| Screen | Stitch Reference | Functional Testing | Visual Fidelity | Responsive Testing | Accessibility | Impeccable Review | Defects | Final Status |
|---|---|---|---|---|---|---|---|---|
| People list | none (guidelines §9) | pass (W-B2-3) | consistent with sc_28 table + sc_29 cards | pass (390, 768) | Enrol dialog: focus in, Tab trapped, Escape returns to trigger | no finding | – | pass |
| SC-09 Participant record | `sc_09_participant_deep_fact_record` | pass (W-B2-3/6/9) | pass with notes: tax, banking, earnings stat cards, ledger statement omitted by plan | pass (390, 768) | tabs `role=tab`; unmask focus (BUG-073) | no finding | BUG-073, 080 | pass with defects |
| SC-07 Genealogy explorer | `sc_07_genealogy_explorer_staff_as_of` | pass (W-B2-4/5) | pass with notes (graph view, volume bars, ranks omitted by plan) | pass (390, 768) | expand buttons `aria-expanded`, Enter works, visible focus outline | no finding | BUG-079 | pass with defects |
| SC-08 Genealogy and duplicate cases | `sc_08_genealogy_change_and_duplicate_cases` | pass (W-B2-5/6) | pass with notes (dual sign-off, payout impact, upline money omitted by plan) | pass (390, 768) | segment controls are `role=radio`; errors in `role=alert` | no finding | – | pass |
| SC-06 Cases | `sc_06_cases_exceptions` | pass (W-B2-5/6) | pass with notes (manual adjustment, payee dispute tabs omitted by plan) | pass (390, 768) | decision dialogs reason required, step-up single dialog | side-tab `border-l-4` on the proposal card = sc_06 anatomy (note) | BUG-070, 078 | pass with defects |
| SC-31 Orders and returns | `sc_31_ingested_orders_returns_explorer` | pass (W-B2-7/9/10) | pass with notes (export, reconcile, manual batch, payout lines omitted by plan); columns wrap at 1440 beside the inspector as in sc_31 | pass (table scrolls in its card at 390) | tabs, filters labelled | no finding | BUG-075, 076 | pass with defects |
| SC-32 Late-transaction queue | `sc_32_late_transaction_queue` | pass (W-B2-8) | pass with notes | pass at 768; empty state clipped at 390 (BUG-072) | row checkboxes named "Select order …" | no finding | BUG-071, 072 | pass with defects |
| SC-13 Integrations (connectors, health) | `sc_13_integrations_and_sync_health` | pass (W-B2-7/10) | pass with notes (telemetry, backfill, provider cards omitted by plan) | pass (390, 768) | copy button announces via `role=status` | no finding | BUG-075, 077 | pass with defects |
| SC-29 Tenant settings (B2 part) | `sc_29_tenant_settings` | pass (W-B2-1/2) | fail at 1440/1280: masking card overflow (BUG-069) | page scrolls sideways at 1440 and 1280; pass at 768, 390 | no unnamed control | no finding | BUG-069, 074 | pass with defects |
| SC-17 (touch) | existing | pass (agreement item complete) | as B1 | as B1 | as B1 | – | – | pass |

### Impeccable audit (audit only) and accessibility pass

- Detector (`impeccable detect`, regex mode, run from `apps/web`) on `features/{cases,genealogy,orders,people,integrations}` and the B2 routes under `app/(staff)`: 1 finding, side-tab `border-l-4` on the case proposal card (`features/cases/case-detail.tsx:209`), which is the sc_06 card anatomy → design note. Source read: one hard-coded colour `text-[#7A4900]` in `features/cases/effect-preview.tsx:51,53` (theming note). Rendered element rules not run (pages need a session the detector's browser does not have).
- Scripted pass on 18 B2 routes at 1440 (all four roles): no unlabelled input, no unnamed button/link/tab, no duplicate id, no image without alt, headings without skips, every tab has `aria-selected`, every table has `th`. Contrast of text in `main` on 8 routes: no ratio below 4.5:1 (3:1 large). Touch targets at 390: only labelled 16 px checkboxes and the inline breadcrumb link (both exceptions). No page overflow at 390 or 768 on any of the 18 routes; overflow at 1440/1280 on `/settings` (BUG-069).
- Keyboard: Enrol dialog focus into the dialog, Tab trapped over 40 presses, Escape returns to "Enrol participant"; explorer expand with Enter sets `aria-expanded=true` and keeps a 2 px focus outline.
- Scores (0–4): Accessibility 3 (BUG-073), Performance not scored (no trace), Theming 3 (canonical tokens; one hard-coded colour), Responsive 3 (BUG-069, BUG-072), Implementation integrity 3 (no placeholders, refused content or dead controls; raw codes and unformatted money, BUG-071/075). Total 12/16 over the four scored dimensions.

### Notes (not registered)

- The proposer of a participant type cannot reach the SoD refusal: Tenant admin lacks `participant_type.approve`, so its decision is 403 PERMISSION_DENIED; the page names the eligible approver instead (PLAN W-B2-1 wording "refused naming compliance@acme" is met by the page, not by an API message).
- The masking card keeps "Platform safe default in force" while an approved version is scheduled; the scheduled version is visible only in the versions table (same pattern as Rounding mode in B1).
- Visibility-policy hint says "choose the next period start or later", but any instant after now in an open period is accepted.
- Fixture: committed periods end at August (Sep 2026 is open because the seed compares Amsterdam period ends with the DB session's month start), so the September order O-0915 was not late; August/July orders were.
- In viewer mode the page asks `/v1/positions/:id/downline` twice (without and with `kind=sponsor`).
- Late queue periods are shown in the viewer time zone ("Jul 1, 2026, 4:00 AM – Aug 1, 2026, 4:00 AM" for an Amsterdam month), the same pattern as calendars in B1.
- Not exercised: WooCommerce connector, rotate/withdraw connector, refunds/cancellations by webhook, merge and terminate duplicate outcomes, servicing change dialog, type change dialog, agreement acceptance after enrolment, held-over-24 h and "behind" sync states, support-session read-only view of B2 pages, placement-tree kind and known-at in the explorer, affected committed periods list (needs a committed period after enrolment).

## Increment B2 — round 2 (2026-11-17, retest after the fixes of BUG-069..080)

Environment: `nmp_e2e` was reseeded (`seed:e2e`). The API ran on `:4000` with workers (tsx, NODE_ENV=development, COOKIE_SECURE=false; log `var/qa-b2/R2-api.log`), and the web on `:3100` (`next start` on the build of 17:36, with no source file newer than `.next/BUILD_ID`). Both servers were stopped by PID tree at the end. One browser at a time: Playwright MCP Chromium with one context per user (admin, compliance, dpo, finance, support, analyst @acme), in browser time zone Asia/Dhaka. It was closed before the harness ran its own Chromium. Most data setup for the quick repeat went through the API in each user's own session (fetch from the page). The checks behind each fix went through the page UI.

Test-data note: when the browser was closed, the TOTP seeds of admin@ and compliance@ were lost before their sessions were saved for the harness. So their `mfa_credential` rows were deleted in `nmp_e2e` and `mfa_enrolled` set to false, and they re-enrolled at the next sign-in. Rollback: `seed:e2e`.

API log: 0 responses with a 5xx status, 0 error-level lines, and no participant e-mail, identity reference or webhook secret. No commerce or payment provider was called. Orders came from the page with an `orders:write` key, and FIXTURE Shopify payloads were signed in the page with `crypto.subtle` and posted to the local connector URL.

### Fix verification (first step)

| Bug | Result | Evidence |
|---|---|---|
| BUG-069 | verified fixed | admin `/settings`: `scrollWidth - clientWidth` = 0 at 1440, 1280, 768 and 390. The masking row is stacked (title, then chip, consequence and Change under it), and no child sticks out of the 320–374 px card. Harness captures are 1440 and 1280 px wide (`R2-sc29-masking-card-1280.png`, `R2-sc29-1280.png`) |
| BUG-070 | verified fixed | compliance `/cases`: the Subject cell reads "P-C / Position" and "NL-D · Dirk Delta / Participant" (`R2-sc06-cases.png`) |
| BUG-071 | verified fixed | analyst `/periods/late`: effects "25.00 EUR / 2,500 pv"; diagnostic "Period state · Committed" badge. Bulk preview for O-0820 + O-0821 (NL): "Items 2, Amount 35.00 EUR, Volume 3,500 pv, Positions affected 0" (`R2-W8-01-late.png`, `R2-W8-02-preview.png`) |
| BUG-072 | verified fixed | 390x844 with 0 pending: "No late transactions are waiting" renders under the scrolling table at 88–287 px inside a 24–351 px container, with no clipping (`R2-390-late.png`) |
| BUG-073 | verified fixed | finance > NL-B > Show contact, 10.4 min after MFA. The step-up dialog appeared, and after the code `document.activeElement` = the revealed `<dl tabindex=-1>` inside the open dialog ("Email address bram@example.test"). Tab moves to "Hide and close", and Escape returns focus to "Show contact" (`R2-W3-unmask.png`) |
| BUG-074 | verified fixed | the versions table column is "APPROVER"; version 9 shows "Data Protection Officer (DPO)"; diff drawer "Approver: Data Protection Officer (DPO)", and money rows "Not needed" (`R2-sc29-versions-diff.png`) |
| BUG-075 | verified fixed for the listed codes; residual → BUG-081 | Exception queue: "Already received with a different body (corrections arrive as order events)" and "The storefront sent a body that is not an order or refund". Sync health last refusal in words for both sources. Still raw: "BUYER_MISSING", a connector mapping code that is not in `REFUSAL_LABELS` (`R2-sc31-rejected.png`) |
| BUG-076 | verified fixed (orders table, inspector); residual → BUG-082 | order 820000005 reads "NL Shopify store · NL" in the table and the inspector, and 390 shows no uuid (`R2-390-orders.png`). The exception queue Source column still reads `connector:<uuid>` |
| BUG-077 | verified fixed | key dialog: "Send it as Authorization: Bearer <key>. Its scopes: orders:write." |
| BUG-078 | verified fixed | a 162-byte PDF is listed as "1 KB" on the genealogy change and transfer cases |
| BUG-079 | verified fixed (count); banner partly | the explorer top level reads "Show the 1 position under P-E" and "Show the 3 positions under P-A". View as P-A with the approved policy in force: "This is your tenant's approved policy." The scheduled-but-not-in-force state was not re-created this round, because the policy took effect before the explorer step. The source has the new text "No tenant policy is in force yet" (downline-view.tsx:70, explorer.test.tsx) |
| BUG-080 | verified fixed | after the change (C under A), the transfer P-C → NL-E and the termination of P-C, the K servicing tab reads "P-A · Anna Alpha, Reassigned on termination, 9:26 PM – now" and "P-C, At enrolment, 8:36 PM – 9:26 PM" (no current owner on the ended row). The approved change case shows subject "P-C" and "PARENT WHEN SUBMITTED P-B → P-A". The transfer case shows "OWNER WHEN SUBMITTED NL-C → NL-E" (`R2-W9-servicing.png`, `R2-W6-transfer-case.png`) |

### Workflows (PLAN §7, quick repeat)

| Workflow | Result | Notes |
|---|---|---|
| W-B2-1 Types and policies | pass (new LOW) | admin proposed DIST/RETAIL, and compliance approved both (API). Eight settings were saved by API with `If-Match` (versions 1–8). Masking depth 1 was requested in the UI ("Waiting for DPO approval … CAN APPROVE Data Protection Officer"). The first request's effective time (4 min ahead) passed before dpo decided, and approve answered "There is a problem — effective_from cannot be in the past." (BUG-083). Withdrawn, re-requested 12 min ahead, approved by dpo in the UI → version 9 Scheduled, then in force |
| W-B2-2 Agreement | pass (API) | compliance uploaded the agreement PDF (`class=agreement`) and published "NL v1" with acceptance required |
| W-B2-3 Enrolment and record | pass | support enrolled A, B (P-A, auto), C (P-B, auto), K (RETAIL, P-C), E and F. Without acceptance → 422 AGREEMENT_ACCEPTANCE_REQUIRED. D with B's identity reference → position pending + duplicate case. Unmask with step-up (BUG-073 above) |
| W-B2-4 Explorer and visibility | pass | stale banner after enrolment, then "Read model version 3 is current". Focus P-E "1 direct · 1 position in subtree". View as P-A: B, C and D named "1 level below", "No position beyond the named levels", contact masked |
| W-B2-5 Change case | pass | UI: "A under C" refused at open ("Refused: this change would create a cycle …", 409). "C under A" with PDF evidence opened, then submitted. Preview: current parent P-B → P-A, structural check passed, no committed period affected. Support sees no decision control. Compliance approved in the UI |
| W-B2-6 Duplicate and transfer | pass (API) | support PATCHed outcome allow and submitted; compliance approved. Transfer case P-C → NL-E (SALE, evidence) submitted and approved (UI checked under BUG-080) |
| W-B2-7 Orders by API key | pass | key created in the UI (service account "Order feed"). Volumes SKU-1/SKU-2 from 2026-01-01. O-1001 for K with link P-C → 201, attribution "Referral link" P-C. Changed body → 409 ORDER_CONFLICT + Rejected row. SKU-9 → 202 held UNKNOWN_SKU (Held list, Retry offered). O-0820, O-0821 (NL-N2, August) and O-0722 (NL-N3, July) → late, chip "Late" |
| W-B2-8 Late queue | pass | Diagnose O-0722 → "Raise restatement instead" (reason required) → decided. O-0820 + O-0821 accepted ("2 late items decided with the proposed handling."). KPI: pending 0, decided 3 |
| W-B2-9 Termination and reassignment | pass (API) | support terminate → 403 PERMISSION_DENIED. Compliance terminated P-C → 1 customer reassigned, and K serviced by P-A from 9:26 PM. O-1001 keeps P-C |
| W-B2-10 Connector and health | pass (defects) | connector "NL Shopify store" created (API). Wrong signature → 401. A signed payload without a customer → 200 and Rejected BUYER_MISSING (shown raw, BUG-081). A payload without `financial_status: paid` → 200 and silently ignored (no paid time, as the mapping documents). A signed payload with `customer.tags nmp:NL-K`, `nmp_ref` P-B and paid → order 820000005, NL-K, link P-B, 12.50 EUR, flag "Conflict" (servicer P-A). Sync health: connector Failing (two refusals, no accepted event at that time), Order API Healthy, refusals in words |
| W-B2-11 Regression | pass | see below; harness section in VISUAL_REGRESSION_REPORT |

### MVP-A regression (quick)

| Area | Result | Notes |
|---|---|---|
| Sign-in / MFA | pass | six acme staff with forced enrolment (manual key) and TOTP; support and analyst without MFA. Step-up dialogs were seen for unmask. Idle sessions expired during long waits, and users signed in again |
| Import | pass | DEMO 2025-01…2025-12: 1,466 / 4,775 / 7,442 rows; 53,195,001 / 53,195,001 / 2,600,070 / 9,225,679 = CSV sums. Mapping v1 by admin, approved by compliance at /compliance/mappings. Load needed a breach contact first ("Record at least one breach-notification contact before the first data load.") → Loaded |
| Snapshot | pass | R1 DEMO 2025-01: Ready, end-customer buyers 252,178 of 1,517,950 = 16.61 % (= report.json) |
| Audit | pass | compliance verified the chain: Intact over 154 events |

### Per screen

| Screen | Functional | Visual | Responsive | Accessibility | Defects | Final status |
|---|---|---|---|---|---|---|
| People list | pass | as round 1 | 390 no overflow | Enrol dialog: focus in, 40 Tabs stayed in the dialog, Escape returns to "Enrol participant" | – | pass |
| SC-09 Participant record | pass | as round 1 | 390 no overflow | unmask focus fixed | – | pass |
| SC-07 Genealogy explorer | pass | faithful | 390 no overflow | expand controls named in the singular for one child | – | pass |
| SC-08 Genealogy cases | pass | as round 1 | 390 no overflow | errors in `role=alert` | – | pass |
| SC-06 Cases | pass | as round 1 | 390 no overflow | no finding | – | pass |
| SC-31 Orders and returns | pass | as round 1 | 390 no overflow | no finding | BUG-081, BUG-082 | pass with defects |
| SC-32 Late-transaction queue | pass | as round 1 | 390 empty state fixed | no finding | – | pass |
| SC-13 Integrations (connectors, health) | pass | as round 1 | 390 no overflow | no finding | BUG-081 (sync health would show the same raw codes) | pass with defects |
| SC-29 Tenant settings (B2 part) | pass | pass (BUG-069 fixed) | no overflow at 1440/1280/768/390 | no finding | BUG-083 | pass with defects |

### Impeccable audit (audit only) and accessibility pass

- Detector (`impeccable detect`, regex mode, from `apps/web`) on `src/features/{cases,genealogy,orders,people,integrations}`: 47 files, 1 finding, the same as round 1. It is the side-tab `border-l-4` at `features/cases/case-detail.tsx:209` (sc_06 card anatomy, design note). Source read: `text-[#7A4900]` in `features/cases/effect-preview.tsx:51,53` (theming note, unchanged). Rendered element rules not run (pages need a session).
- Scripted pass on 17 B2 routes at 1440 for all four roles: no unlabelled input, no unnamed button/link/tab/radio, no duplicate id, no image without alt, no heading skip, every tab has `aria-selected`, every table has `th`. Horizontal page overflow was 0 on all 17 routes at both 1440 and 390.
- Keyboard: Enrol dialog trapped focus and Escape returned it to the trigger; unmask focus as under BUG-073.
- Scores (0–4): Accessibility 4 (BUG-073 fixed, no findings). Performance not scored (no trace). Theming 3 (one hard-coded colour). Responsive 4 (BUG-069/072 fixed). Implementation integrity 3 (raw connector codes and connector uuid in the exception queue, BUG-081/082; raw field name in an approval error, BUG-083). Total 14/16 over the four scored dimensions (round 1: 12/16).

### Console and requests

Console errors were only the intended 4xx responses from probes and refusals, plus 401s on pages left after idle-session expiry: 428 (settings PUT without `If-Match`, my first attempt), 422 (late approval, no-acceptance enrolment, load without breach contact), 409 (cycle case, ORDER_CONFLICT), 403 (support terminate, unmask before step-up), 401 (wrong webhook signature, expired sessions). No `pageerror`, no 5xx.

### Notes (not registered)

- A Shopify `orders/paid` payload without `financial_status` paid is answered 200 and silently ignored, with no inbound row and no sync-health trace. This is by design (PLAN: "ignored" when the crediting time is missing), but a merchant has no way to see it.
- The exception queue "Natural key" column also carries the connector uuid (`order:shopify:<uuid>:<id>`). That is a technical key, so it is noted, not registered.
- Not exercised this round: WooCommerce, connector rotate/withdraw, webhook refunds, merge/terminate duplicate outcomes, servicing and type change dialogs, the support-session view of B2 pages, and the explorer banner while only a scheduled policy exists.
