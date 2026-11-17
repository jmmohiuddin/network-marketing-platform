# qa — TEST_RESULTS

_Agent: qa. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — packages/compliance
- vitest: 4 files, 98 tests pass. tsc clean. Golden compares every numeric figure of R1–R5 (values only, via parseFloat; not numerator/denominator, not population text).
- Fuzz vs prototype: 0 diffs in 47,556 figures. No float money arithmetic, no Date/random/locale found.

## 2026-11-12 — T-A07
- `pnpm vitest run apps/api/test`: 5 files, 372 tests pass (3 are test.fails for BUG-006/BUG-007, verified to fail on the defect assertion: 200 instead of 403/422). `tsc -p apps/api --noEmit` clean. Runtime about 2 s for both new files.
- Guards checked by mutation: removing a case -> coverage + per-route tests fail; a wrong matrix expectation -> every role's test fails.

## 2026-11-12 — Browser E2E W1–W10 (Playwright MCP, nmp_e2e, api :4000, web :3100 `next start`)
| W | Result | Notes |
|---|---|---|
| W1 vendor | pass (with setup) | MFA sign-in, provision `initech` (DPA must be a UUID), self-approval refused 422; only 1 seeded vendor -> created operator2 in DB (BUG-011), operator2 approved, first-admin mail written. Tenant list has metadata only. Vendor audit not viewable (BUG-012) |
| W2 new admin | pass | .eml link, fragment token stripped from URL, password set, link single-use, forced enrolment via manual key, lands on /compliance |
| W3 tenant admin | fail | enrol, invite, privileged grant -> pending, self-approval hidden + API 422 SOD_SELF_APPROVAL; admin2 cannot approve Compliance officer (BUG-010 HIGH); Tenant admin (DEMO via market picker) approved by admin2; immediate non-privileged DEMO grant; step-up dialog + auto-retry on revoke; deactivate; LAST_ADMIN on revoke and deactivate; dual-control deadlock (BUG-014) |
| W4 settings | pass | 4 thresholds + breach contact saved as versions; stale banner (BUG-017) |
| W5 import | pass | control totals 1466/4775/7442 and sums equal CSV sums; mapping draft by admin, approved by compliance officer; loaded; forbidden `email` column rejected row 1/col email FORBIDDEN_COLUMN |
| W6 compliance | pass | R1 2025-01, R2/R4 2025-12, R3 year (22.55/15.27/10.80/51.38), R5 (449, 73.27, mean 205.47, median 80.21, p75/p90/p99/max, bands) equal report.json; drill-down sums line; CSV export 132 rows + watermark; SC-46; period compare; chart as table; new mapping draft -> Outdated |
| W7 audit | pass | events present, filters (action, object_type) in URL, event detail, export 8 rows + download, cap refusal (API restarted with EXPORT_ROW_CAP=10: "44 rows; limit 10"), chain intact (42) |
| W8 support | pass | refused without session (REALM_FORBIDDEN, vendor log NO_SESSION), region approval required, read-only frame, writes 403 SUPPORT_SESSION_READ_ONLY, tenant log lists views/refusals, end -> SUPPORT_SESSION_INACTIVE. ACCESSED logged for refused read (BUG-013) |
| W9 isolation | pass | globex admin: 11 acme URLs -> 404 (audit export download 403 permission first); analyst nav = Compliance only, admin pages NotAvailable, admin APIs 403, no export button |
| W10 responsive/a11y | pass (LOW findings) | overview 390 px no overflow; approvals table clipped (BUG-022); keyboard sign-in + MFA + Create snapshot dialog: focus into dialog, trapped, Escape returns focus |
- No 5xx in API log; console errors only expected 4xx + favicon 404. Screenshots var/e2e-screens (31). Exports var/e2e-fixtures/exports.

## 2026-11-12 — Browser retest R2 (fixed BUG-010..023, then W1–W10; nmp_e2e, api :4000, web :3100 `next start`)
- Fix checks: BUG-010/011/012/013/015/016/017/019/020/021/022 verified fixed; BUG-014 fixed for acme, residual -> BUG-024; BUG-018 fixed except "1 events" -> BUG-027; BUG-023 dialog fixed, tenant card still "Vendor user <id>" (open part).
| W | Result | Notes |
|---|---|---|
| W1 vendor | pass | keyboard sign-in + MFA, DPA UUID hint, self-approval 422, invited operator2 in console (no DB insert), operator2 approved initech, last-vendor-user deactivate refused, /vendor/audit + filter |
| W2 new admin | pass (defect) | mail link, password, forced enrolment (manual key), lands on next; initech has one admin -> privileged grant stuck forever (BUG-024) |
| W3 tenant admin | pass | Compliance officer + Finance approver (DEMO via picker) approved by admin2; self-approval 422 SOD_SELF_APPROVAL; revoke; deactivate; SECOND_ADMIN_REQUIRED on revoke/deactivate of admin2 (LAST_ADMIN unreachable with 2 admins); step-up dialog + retry seen (breach contacts) |
| W4 settings | pass (defect) | 4 thresholds + contact, banner gone; "In force since" wrong (BUG-025) |
| W5 import | pass | 1466/4775/7442 + sums = CSV; mapping by admin, approved by compliance; loaded; email column rejected row 1 FORBIDDEN_COLUMN |
| W6 compliance | pass | R1 2025-01, R2/R3/R4 2025-12, R3 year, R5 (449/73.27/205.47/80.21/232.68/545.70/1,630.95/2,306.38, bands) = report.json; drill sums match; CSV 2439+7121 rows; SC-46; compare; view as table; mapping draft -> Outdated |
| W7 audit | pass (defect) | names in list, action filter, chain intact (41), export 1 row, cap 10 refused "43 rows" (API restarted with EXPORT_ROW_CAP=10, then default); "1 events" (BUG-027) |
| W8 support | pass | REALM_FORBIDDEN without session, region approval, read-only frame, write 403 READ_ONLY, refused read logged ACCESS_REFUSED only, log shows params, end -> INACTIVE, vendor log has refusals |
| W9 isolation | pass | globex admin: 11 acme API ids 404 (audit download 403 permission first), pages NotAvailable; analyst nav Compliance only, admin pages NotAvailable |
| W10 responsive/a11y | pass (defects) | approvals 390 stacked cards, reject at 390; overview 390 no overflow; dialog focus trap + Escape; month inputs vs hint (BUG-026); focus to body after revoke (BUG-028) |
- New: BUG-024 MEDIUM, BUG-025..029 LOW. No 5xx in API log; console errors only intended 4xx/probes. Screens var/e2e-screens/R2-*.png (26); exports var/e2e-fixtures/exports-r2.

## 2026-11-12 — Browser retest R3 (fixed BUG-024, then W1–W10; nmp_e2e, api :4000, web :3100 `next start`, build already contained the fix)
- Fix check: BUG-024 verified fixed (Second admin fieldset required; empty/same-as-first refused; both initech admins invited + Tenant admin at approval; bob@initech approved admin@initech's Compliance officer request for carol, 200). Still open and re-seen: BUG-023 (requester "Vendor user <id>"), 025, 026 (hint unchanged), 027, 028, 029.
| W | Result | Notes |
|---|---|---|
| W1 vendor | pass | keyboard sign-in + MFA (focus mfa-code, then main), invited operator2 in console, initech with second admin, self-approval 422 SOD_SELF_APPROVAL, operator2 approved, tenant list metadata only, /vendor/audit + action filter |
| W2 new admin | pass | .eml links, password, forced enrolment (manual key), lands on /compliance; second admin present |
| W3 tenant admin | pass (known defect) | forced enrolment blocks /settings/users; invite dave; Compliance officer -> pending, self-approval API 422; Finance approver DEMO via market picker -> pending; Executive read-only DEMO immediate; admin2 approved both with StepUp dialog (fresh TOTP, auto-retry); revoke; deactivate; revoke of admin@ -> "would leave one administrator" (SECOND_ADMIN_REQUIRED); focus to BODY after revoke (BUG-028) |
| W4 settings | pass (known defect) | 5000 / ranks 5000+10000 / day 27 / 1 of 3 / contact; banner gone; all "version 5" (BUG-025) |
| W5 import | pass | 1466/4775/7442, amounts = CSV sums; mapping v1 by admin, approved by compliance at /compliance/mappings; loaded; email column rejected row 1 FORBIDDEN_COLUMN |
| W6 compliance | pass | R1 2025-01 16.61/1,517,950; R2 2025-12 41.26/4.54; R3 2025 22.55/15.27/10.80/51.38; R4 2025-12 277/55.23/52/0; R5 449/73.27/205.47/80.21 = report.json; drill sums line; CSV 132 rows + watermark; overview; trend figure switch + view as table; mapping v2 draft -> Outdated |
| W7 audit | pass (known defect) | filter in URL, export 1 row + download, "1 events" (BUG-027), chain intact (38), cap: API restarted with EXPORT_ROW_CAP=10 -> "38 rows; limit 10", then default |
| W8 support | pass (new LOW) | REALM_FORBIDDEN without session; request; admin approved with region checkbox; read-only frame; write 403 READ_ONLY; refused reads ACCESS_REFUSED only; tenant log with params; end -> SUPPORT_SESSION_INACTIVE. Outdated banner offers "Create a new snapshot" in the read-only session (BUG-030) |
| W9 isolation | pass | globex admin: acme snapshot/batch/mapping/rows pages NotAvailable; API ids 404 incl. grant decision and deactivate writes; analyst nav Compliance only, admin pages NotAvailable, admin APIs 403, /vendor redirects to /compliance |
| W10 responsive/a11y | pass | 390x844: approvals stacked (table 17–358, buttons visible), overview no overflow; keyboard sign-in; Create snapshot dialog focus in, trapped, Escape returns to trigger |
- New: BUG-030 LOW. No 5xx; console errors only intended 4xx from probes/refusals (list in var/e2e-fixtures/exports-r3/mcp-console). Screens var/e2e-screens/R3-*.png (27).

## 2026-11-12 — UI testing round 1 (Stitch re-skin; Levels 1–3)
- L1 W1–W10 all pass (known BUG-023/025/027/028/029 still present). Figures = report.json; totals 1466/4775/7442. Not executed: export row cap, step-up dialog (all actions < 10 min after MFA), BUG-030 retest, support-session expiry, go-live.
- L2 harness: 11 screens x 4 viewports, results testing/visual/results/*.json; shell matches sc_01; most `high` flags are canonical-catalogue values (design notes). Real: SC-10 composition/tabs/charts, SC-25 390 overflow, SC-46 card wrap, visible captions.
- L3: scripted a11y pass on 14 routes clean except BUG-040/041 (+ known 028); detector: only side-tab border-l-4 (Stitch banner anatomy, note). Score 12/16 (performance not scored).
- New: BUG-032..034 MEDIUM, BUG-035..043 LOW. Reports: testing/UI_TESTING_REPORT.md, testing/VISUAL_REGRESSION_REPORT.md. Screens var/e2e-screens/R4-*.png; exports var/e2e-fixtures/exports-r4.

## 2026-11-12 — UI testing round 2 (retest)
- Fix checks: BUG-032..043 all verified fixed; BUG-030 not reproduced; 023, 025–029 still present.
- L1 W1–W10 pass (figures = report.json; 1466/4775/7442; export cap "66 rows; limit 10" with API restarted EXPORT_ROW_CAP=10; step-up dialog seen). L2 harness 11 screens x 4 widths: no page overflow anywhere; remaining flags are canonical values. L3 scripted a11y on 23 routes clean; detector source/rendered as round 1. Score 14/16.
- New: BUG-044 MEDIUM (dialogs stretch to 90vh at ≥640 px: `sm:h-auto` on `<dialog>`), BUG-045..048 LOW. Evidence var/e2e-screens/R5-*.png, var/e2e-fixtures/exports-r5.

## 2026-11-12 — UI testing round 3 (retest)
- Fix check: BUG-044 verified fixed (dialogs = content height, centred; long content caps at 90vh with scrolling body + visible footer, also 1280x720). BUG-030 not reproduced; 023, 025–029, 045–048 still present (028 also after Reject grant and End now).
- L1 W1–W10 pass (figures = report.json; 1466/4775/7442; export cap "40 rows; limit 10"; step-up seen on Approve vendor access; first grant rejection exercised). L2 harness 11 x 4: same flags as round 2, captures viewport-wide. L3: detector source (2 side-tab notes) + rendered /signin,/signin/vendor clean; scripted a11y 25 routes clean. Score 15/16.
- No new defects. Evidence var/e2e-screens/R6-*.png, var/e2e-fixtures/exports-r6. No 5xx.

## 2026-11-17 — B1 browser round 1 (W-B1-1..6 + MVP-A regression, harness SC-29/13/17, Impeccable + a11y)
- W-B1-1..6 all pass (W-B1-4 SCOPE_MISSING not executable: one scope in catalogue). Polish BUG-023, 025–029, 045–048 verified fixed. Regression sign-in/import (1466/4775/7442, sums = CSV)/snapshot (R1 2025-01 16.61 %)/audit (chain intact 100) pass. Isolation: analyst 403/NotAvailable, globex 404.
- New: BUG-049, 050, 051 MEDIUM; BUG-052..059 LOW. No 5xx; console errors only intended 4xx. Evidence var/qa-b1/. Impeccable 11/16 (perf not scored).

## 2026-11-17 — B1 browser round 2 (retest of BUG-049..059, quick W-B1-1..5 + regression, harness SC-29/13/17, Impeccable + a11y)
- BUG-049..059 all verified fixed (055 client path only). W-B1-1..5 pass (new: webhook secret rotation with grace). Regression import 1466/4775/7442 + sums, snapshot R1 16.61 %/42.06 %, audit chain intact 44, isolation analyst/globex pass. No 5xx; console only intended 4xx.
- New: BUG-060 LOW (gate inspector `break-all` splits "mandatory"). Score 14/16. Evidence var/qa-b1/R2-*.

## 2026-11-17 — B2 browser round 1 (W-B2-1..11, MVP-A regression, harness 9 screens, Impeccable + a11y)
- W-B2-1..10 pass (all with LOW/MEDIUM defects noted in the report); regression import 1466/4775/7442 + sums, R1 2025-01 16.61 %, audit chain intact 134, globex isolation 404. SCOPE_MISSING now exercised (403). No 5xx; no PII in API log, audit or outbox.
- New: BUG-069 MEDIUM (SC-29 masking card overflow at 1440/1280), BUG-070..080 LOW. Impeccable 12/16 (perf not scored). Evidence var/qa-b2/R1-*.

## 2026-11-17 — B2 browser round 2 (retest of BUG-069..080, quick W-B2-1..11, regression, harness 9 screens, Impeccable + a11y)
- BUG-069..074, 077, 078, 080 verified fixed; 075/076 fixed where scoped, residuals BUG-081/082; 079 count verified, scheduled-only banner state not re-created. Regression import 1466/4775/7442 + sums, R1 16.61 %, audit chain intact 154. No 5xx; console only intended 4xx/expired-session 401.
- New: BUG-081, 082, 083 LOW. Impeccable 14/16. Evidence var/qa-b2/R2-*.

## 2026-11-18 — B3 browser round 1 (W-B3-1..9, harness 9 screens, Impeccable + a11y)
- W-B3-1/2/3/5/6/7/8 pass (with defects), W-B3-4 FAIL: quantity>1 lines count volume quantity² (BUG-084 CRITICAL: gross 73.00 vs 47.00). W-B3-2..7 needed a DB settings backdate (BUG-085). W-B3-9 partial (import 1466/4775/7442 + sums, R1 16.61 %, audit chain intact 127, globex 404). No 5xx; console only intended 4xx.
- New: BUG-084 CRITICAL, BUG-085..089 MEDIUM, BUG-090..093 LOW. Impeccable 12/16. Evidence var/qa-b3/R1-*.

## 2026-11-18 — B3 browser round 2 (retest of BUG-084..093, quick W-B3-1..8, MVP-A regression, harness 9 screens, Impeccable + a11y)
- Verified fixed: BUG-084 (Aug 47.00, B 24.00, A 23.00), 085 (fresh seed, no DB workaround), 086, 087, 088. Partly: 089 → BUG-094 MEDIUM (SC-01 table clipped at 1440/1280, row actions off-screen), 091 → BUG-095 LOW (late queue period in viewer zone), 092 → BUG-096 LOW (SC-42 raw acknowledgement_required). Still open as registered: 090 engine text, 092 engine trace µs, 093 web What-changed copy.
- W-B3-1..8 pass (restatement B −8.00, A +3.00 = PLAN). Regression import 1466/4775/7442 + sums, R1 16.61 %, audit chain intact, globex 404. No 5xx; console only intended 4xx. Impeccable 12/16. Evidence var/qa-b3/r2/.

## 2026-11-18 — B3 browser round 3 (retest of BUG-094, quick repeat on round-2 data, regression, harness 9 screens, Impeccable + a11y)
- BUG-094 verified fixed (1440: table 1169 in 1169 box; 1280: 1009/1009; all row actions visible; row menu keyboard-correct; Replay via menu → Match). Restatement dialog via menu ok (not submitted). Row Calculate not executed (no calculable period). Regression: fresh sign-in, imports 1466/4775/7442 (read), R1 16.61 %, audit chain intact. No 5xx; no console errors except intended 401.
- New: BUG-097 LOW (Gross amount wraps from currency), BUG-098 LOW (768 table still scrolls, chips break per word). Impeccable 13/16. Evidence var/qa-b3/r3/.
