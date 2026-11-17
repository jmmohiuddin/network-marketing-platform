# Stitch design inventory

Source: `design/stitch/stitch_complete_ui_screen_design/`: **48** `sc_*/code.html` + `screen.png` and the design system `ledger_integrity/DESIGN.md`. 38 files came in the first export; **10 more (SC-23, 26, 29, 36, 38, 40, 41, 43, 45, 46) were added to the same folder on 2026-11-12 08:20 while this inventory was being written** ("batch 2"; an identical DESIGN.md copy sits in `design/stitch/batch2/stitch_complete_ui_screen_design/ledger_integrity/`, same MD5). All 48 are inventoried below; every product screen SC-01..SC-47 now has a Stitch file. The folder also holds `ruvector.db` (and `design/stitch/` holds another `ruvector.db` and `.claude-flow/`): agent-tooling artefacts, not Stitch output; ignore them.
Cross-checked against `product-documentation/09-governance/traceability-data/spec.json` (screens), `engineering/context/UI_UX.md` (SC-01..SC-47, navigation, hard rules) and `apps/web/src` (routes as of 2026-11-12).
Method: every `code.html` was parsed (DOM walk: landmarks, nav items, headings, buttons, inputs, tables, overlays, responsive classes, inline scripts, external resources; visible text scanned for BR-HON-01 terms). `screen.png` viewed for sc_13, sc_24, sc_37. Binding implementation rules are in `engineering/DESIGN_IMPLEMENTATION_GUIDELINES.md`; gaps in `engineering/DESIGN_COVERAGE_AND_GAP_REPORT.md`.

## 0. Findings that affect every file

1. **Tailwind config: identical values in all 48 files.** After evaluating each `tailwind.config` object, all 48 hash to the same theme (47 colours, 13 font families, 13 font sizes, 4 radii, 11 spacing keys, `darkMode: "class"`). Text differs only in key order and formatting (sc_15 and sc_31 are pretty-printed with quoted keys; the rest are minified). The extracted theme is in `design/stitch/tailwind-theme.json`.
   - **4 files carry a broken config, not a different one:** `sc_13`, `sc_24`, `sc_25`, `sc_28` end with `…]}}}</script>` (20 closing braces for 21 opening). The script throws `SyntaxError: Unexpected end of input`, so the Play CDN never received the theme, and their `screen.png` renders are unstyled (verified for sc_13 and sc_24). For these four screens use the markup plus the shared theme as the reference, not the PNG.
   - **One file differs in its head, not its theme:** `sc_18` loads a static Material Symbols instance (`opsz,wght,FILL,GRAD@24,400,0,0`) **in addition to** the shared variable one (`wght,FILL@100..700,0..1`), so two `@font-face` rules compete for the same family, loads JetBrains Mono 500/600 only, sets `html,body{width:100vw;background-color:#f8f9ff}` and its `<body>` has no `font-body-md` class. Port it with the shared head.
   - **Theme vs DESIGN.md radii:** the config shifts radii one step down relative to DESIGN.md: `rounded` = 0.125rem (DESIGN.md DEFAULT 0.25rem), `rounded-lg` = 0.25rem, `rounded-xl` = 0.5rem, `rounded-full` = **0.75rem** (not a circle on elements wider than 24px). `sm`/`md` are not overridden (Tailwind defaults 0.125rem/0.375rem). The renders use the config values; port them unchanged.
   - Colours: the markup uses the Material-style tokens (`primary` #003883, `primary-container` #1e4fa3, `tertiary*` greens, `error*`). DESIGN.md prose hexes (#F8FAFC page, #1E4FA3 action, #173E82 hover, semantic success/warning/danger/info) appear only as arbitrary classes (`text-[#14633A] bg-[#E8F5EE] border-[#A3D9B8]`, `text-[#7A4900] bg-[#FFF4D6] border-[#F5D580]`, `bg-[#0F172A]/70`, `bg-[#f8fafc]`). Warnings use the default Tailwind amber palette (`bg-amber-100 text-amber-900 border-amber-300` etc., 28 elements in sc_03 (12), sc_06 (11), sc_46 (4), sc_09 (1)) because the theme has no warning token; sc_03 and sc_46 also use default `blue-50/200/900`, `green-50/200/900`, `red-100/600`. So the config must stay an `extend` (default palette kept).
   - No `dark:` class appears in any file. DESIGN.md defines light tokens only.
2. **External dependencies (all 48):** `https://cdn.tailwindcss.com` (Play CDN, Tailwind v3 runtime config syntax); Google Fonts CSS for Inter 400/500/600/700 and JetBrains Mono (400/500/600, or 500/600 in sc_05, 08, 12, 18, 42, 44, 47); Material Symbols Outlined variable font (2 to 4 `<link>`s per file, mostly duplicates or differing axis ranges); `preconnect` to fonts.googleapis.com / fonts.gstatic.com in most files. Hot-linked images (`lh3.googleusercontent.com`): header logo "Platform Integrity Logo" in sc_01, 02, 02-modal, 03, 04, 06, 07, 10, 23, 26, 29, 33, 36, 43, 45, 46; five staff-portrait avatars in sc_20; two decorative photos in sc_35. All are replaced (guidelines §3).
3. **Plugin classes that were no-ops in the renders:** `animate-in fade-in zoom-in-95 duration-150` (tailwindcss-animate, not loaded; sc_02-modal), `backdrop-blur-xs` (not in v3; sc_16), `py-0.2` (not a v3 spacing step; sc_01, sc_02-modal). Do not add plugins to make them work.
4. **Sample data everywhere:** tenant "Acrobex Global (TEN-842)", "Global Direct Inc.", "Apex Health"; users "Elena Rostova", "Sarah Jenkins"; payees "Elena Gomez (POS-01948)", "Marcus Vance"; amounts ($4,812,490.50 etc.); hashes; provider names (Wells Fargo, Hyperwallet, Shopify). Product wordmark "AuditLedger" is a Stitch placeholder (brand undecided, OQ-23). None of it ships.
5. **Static claims with no data source:** status footers ("SYSTEM: ONLINE | BUILD v2.4.1 | ENGINE 2026.11-PROD | STATUTORY AUDIT LOCK ACTIVE"), sidebar footer (Cell / Version / Engine), header chips ("FTC/SEC INVARIANTS: ENFORCED", "REGULATORY AUDIT CONFORMANT", "SOC-2 Type II Certified · FIPS 140-3 Compliant"), legal-conclusion badges ("SUBSTANTIATED & COMPLIANT", "Safe Harbor Compliant", "BENCHMARK ACHIEVED"). Not rendered.
6. **Motion:** `animate-ping`/`animate-pulse` status dots in 25 files (urgency styling, forbidden by UI_UX §0); `animate-spin` only as a loading spinner is allowed.
   - **Gradients:** `bg-gradient-to-*` decorative rules/fills in sc_02, sc_02-modal, sc_07, sc_12, sc_27, and SVG `linearGradient` area fills in the sc_13 sparkline and sc_46 trend chart. UI_UX forbids gradients on work screens: use flat fills.
7. **Inline behaviour:** inline `<script>` blocks in sc_03, 07, 09, 14, 16, 18, 19, 20, 22, 23, 25, 26, 27, 29, 32, 33, 35, 37, 38, 40, 41, 44, 45 and `onclick` attributes in sc_03, 16, 18, 20, 29, 32, 38, 41, 43, 45 (drawer/modal toggles, tab switching, fake countdowns, `window.confirm`/`alert` in sc_09, 22, 29, 32, 33, 40, 43 (unmask, bulk accept, rollback, navigation stubs), TOTP slot focus). They document intended interactions only; behaviour is re-implemented in React (no inline JS, CSP).
8. **Inline `style` attributes:** progress-bar widths (`width: 68.4%` etc.) in 21 files, `font-variation-settings: 'FILL' 1` in 10 files (sc_19 sets it from JS) and a `border-left: 4px solid #ba1a1a` in sc_38. Production CSP (`style-src 'self' 'nonce-…'`) blocks style attributes; see guidelines §5.

## 1. Shell variants found

| ID | Files | Header | Sidebar | Nav items shown |
|---|---|---|---|---|
| **S1 (canonical staff)** | sc_01, sc_02, sc_02-modal, sc_03, sc_04, sc_06, sc_07, sc_10, sc_33; batch 2: sc_23, sc_26, sc_29, sc_36, sc_43, sc_45, sc_46 | `fixed h-12` full width: logo img + wordmark, tenant chip with dropdown, market chip, search input (`/` or Ctrl K, ⌘K hint), bell with count, Glossary, avatar + name + role (`hidden lg:flex`), sign-out | `aside fixed top-12 w-52` (208 px) under header, `nav[data-active-classes="bg-primary-container text-on-primary font-semibold"]`, footer Cell/Version/Engine | Overview · Periods & Runs · Compensation Plans · People & Tree · Orders & Returns · Cases & Exceptions · Payouts · Finance & Ledger · Compliance Reports · Data Imports · Settings & Audit (11, `data-path` keys) |
| S2 | sc_13, sc_24, sc_25, sc_28 | `h-12`, wordmark only, "Acrobex Global" + "US - USD" buttons, search button, Glossary, bell | `w-[208px]`, groups "Commission System" / "Data & Administration", footer ONLINE · SECURE; page footer ENV/VERSION | Overview · Periods & Runs · Comp Plans · People & Tree · Orders & Returns · Exceptions · Payouts · Finance & Ledger · Compliance · Data Imports · Settings & Audit |
| S3 | sc_05, sc_08 | `left-72 h-16`, labelled Tenant + Market/Currency selectors, Ctrl+K search, bell | `w-72` full height, 4 grouped navs, SC ids beside labels | 19 items incl. Audit Log, Privacy Requests, Migration & Parallel, Market Launch, Vendor Access, Users & Roles, Integrations, **Vendor Console**, System & Diagnostics |
| S4 | sc_09, sc_11, sc_34 | `left-72 h-14`, Tenant + "Statutory Market" + "FTC/SEC INVARIANTS: ENFORCED" chip, search | `w-72`, single nav, "(SC-xx)" suffixes | 18 items (as S3 minus System & Diagnostics) |
| S5 | sc_12, sc_42, sc_44, sc_47 | `left-72 h-14`, **multi-tenant switcher** (Main / Sub-Tenant / Audit Mirror), market, search | `w-72`, single nav, SC ids | 19 items |
| S6 | sc_14, sc_30 | `left-72 h-16`, translucent `bg-surface/85 backdrop-blur-xl`, shadow instead of border | `w-72`, shadow, 2 navs (9 + 8) | 17 items; fixed status footer `h-8` |
| S7 | sc_15, sc_31 | `left-72 h-14` | `w-72`, single nav, SC ids | 18 items incl. Privacy Requests |
| S8 | sc_16, sc_17, sc_32, sc_35, sc_39 | `left-72 h-16` translucent | `w-72 bg-surface-container-low`, "Commission System" (9) + "Data & Administration" (5: Data Imports, Migration & Parallel, Market Launch, Vendor Console, Settings & Audit) | fixed status footer `h-10` |
| P1 (portal phone) | sc_19, sc_20, sc_21, sc_22, sc_37, sc_38 | `fixed top-0` translucent, "AuditLedger • Apex Health" + page title, bell, avatar (`pt-safe`) | none; bottom nav `fixed bottom-0 pb-safe` | Home · Earnings · Rank · Customers · **Team** |
| P2 (portal phone, canonical) | sc_18 | as P1 plus back arrow and SYNCED chip | bottom nav | Home · Earnings · Rank · Customers · **More** (matches UI_UX §4.4) |
| C1 (card / public document) | sc_27, sc_40, sc_41 | page header with wordmark and claims strip | none | none (T4 card `max-w-[480px]`; sc_40 document column) |

All batch-2 staff files use S1, so S1 is now the majority shell (16 of 38 staff files). All staff shells are desktop-only: the sidebar is always fixed and content is offset (`pl-52` / `left-72`); no menu button, drawer or collapsed (56 px) state exists in any file. Portal files (sc_18–22, 37, 38) contain **no** `sm:`/`md:`/`lg:` classes at all (phone-only drawings); the public files sc_40/sc_41 do have `sm:`/`md:` classes.

## 2. Inventory table (one row per file)

Release from spec.json. Status: **Pending** = no route in `apps/web`. MVP-A status as of UI round 3 (2026-11-12, `testing/UI_TESTING_REPORT.md`): **Implemented** = follows its Stitch drawing; the only differences are omissions the rules require (no API route, must-not-implement content) and canonical-catalogue token values (guidelines §1.4, §8). **Implemented with deviations** = also differs in structure or carries an open UI defect; the deviations are listed.

| # | Folder | Screen (spec.json) | Roles (personas) | Module | Rel | Shell | Implementation status |
|---|---|---|---|---|---|---|---|
| 1 | sc_01_periods_runs_analyst_home | SC-01 Periods and runs (analyst home) | Commission analyst; Finance approver | Periods | B | S1 | Pending |
| 2 | sc_02_run_review | SC-02 Run review | Commission analyst; Finance approver | Periods | B | S1 | Pending |
| 3 | sc_02_run_review_step_up_commit_modal | SC-02 Run review: critical-approval (commit) modal with step-up | Finance approver | Periods | B | S1 + modal | Pending as the SC-02 commit dialog. Its modal anatomy is implemented as the shared `Modal` and `StepUpModal` (TOTP instead of the drawn hardware key) used by every MVP-A dialog |
| 4 | sc_03_payout_batches_approvals | SC-03 Payout batches and approvals | Payout officer; Finance approver | Payouts | B | S1 | Pending |
| 5 | sc_04_plan_versions_simulation | SC-04 Plan versions: edit, compare, simulate | Plan administrator; Compliance officer | Plans | B | S1 | Pending |
| 6 | sc_05_cap_and_pool_configuration | SC-05 Cap and pool configuration | Plan administrator | Plans | B | S3 | Pending |
| 7 | sc_06_cases_exceptions | SC-06 Cases: adjustments, disputes, restatements | Commission analyst; Compliance officer; Finance approver | Cases | B | S1 | Implemented with deviations (B2): `/cases` (KPI cards from `/v1/cases/counts`, type tabs, filters incl. `subject_type`+`subject_id` chip, queue) and `/cases/[id]` (subject, payload, evidence, effect preview, timeline, eligible approvers, decision bar with step-up). Not rendered: manual adjustment cases, Payee Disputes / Manual Adjustments / Restatements tabs, raw trace, export (no types or routes); case rows show the subject ref and name (BUG-070 fixed; one GET per row, shortcut) and people as You / approver name / Another user (API returns ids). Browser-verified B2 rounds 1–2 (W-B2-5/6; 1440/1280/768/390, no overflow at 390; harness queue 4.66/4.70/5.28/2.78 %, detail 4.67/4.80/5.47/2.85 %; BUG-070, 078, 080 fixed) |
| 8 | sc_07_genealogy_explorer_staff_as_of | SC-07 Genealogy explorer (staff, as-of) | Commission analyst; Support agent | People | B | S1 | Implemented with deviations (B2): `/genealogy?root&kind&asOf&knownAt&viewer`: search, sponsor/placement, as-of and known-at, read-model banner, focused node card, lazy children, position inspector (links to SC-09 and Request change to SC-08), View as distributor. Not rendered: graphic graph, volume bars, ranks/PV, path audit, tree config, export, reparenting sign-off, inspector unmask. Browser-verified B2 rounds 1–2 (W-B2-4/5; 4 viewports; harness 8.82/8.70/6.08/4.13 %; BUG-079 fixed; the scheduled-only policy banner state was not re-created in round 2) |
| 9 | sc_08_genealogy_change_and_duplicate_cases | SC-08 Genealogy change and duplicate cases | Support agent; Compliance officer | Cases | B | S3 | Implemented with deviations (B2): `/cases/genealogy/new` (change/correction, ownership transfer, evidence upload, effect preview with committed periods) and `/cases/duplicates` (queue, side-by-side records with signal kinds, proposed outcome). Not rendered: dual sign-off / WebAuthn wording, payout impact, upline money table, full trace, request evidence. `?position=` pre-fill from SC-07 not read yet. Browser-verified B2 rounds 1–2 (W-B2-5/6; 4 viewports; harness 8.16/7.91/6.23/2.28 %; no defects) |
| 10 | sc_09_participant_deep_fact_record | SC-09 Participant record | Support agent; Finance manager | People | B | S4 | Implemented with deviations (B2): `/people` list + enrol, `/people/[id]` (`?tab=`): masked identity with step-up unmask, positions with status dialog, types history, customer servicing, agreements, case links and Start case. Not rendered: tax/withholding, banking (B4), earnings/rank cards, ledger statement; no controls yet for later agreement acceptance or adding a position (routes exist, not in PLAN §5); Change servicer only on participants without positions. Browser-verified B2 rounds 1–2 (W-B2-3/6/9; 4 viewports; harness 7.04/7.05/5.35/2.20 %; BUG-073, 080 fixed); servicing and type change dialogs not exercised in the browser |
| 11 | sc_10_compliance_reports | SC-10 Compliance reports | Compliance officer; Executive | Compliance | A | S1 | Implemented with deviations: `/compliance/snapshots`, `/compliance/snapshots/[id]`. Reports R1–R5 on tabs (sc_10 draws all five on one page); opens on the latest period; export dossier and copy hash not rendered (no route); legal-conclusion badges not rendered (must not). No open defect |
| 12 | sc_11_guardrails_policy_overrides_log | SC-11 Guardrails and overrides log | Compliance officer | Compliance | B | S4 | Pending |
| 13 | sc_12_tax_configuration_year_end_forms | SC-12 Tax configuration and year-end forms | Finance manager | Finance | B | S5 | Pending |
| 14 | sc_13_integrations_and_sync_health | SC-13 Integrations and sync health | Tenant admin; Integration developer | Settings | B | S2 | Implemented with deviations: `/settings/integrations` (`?tab=api-keys|webhooks`): service accounts and public API keys (create, rotate, revoke, shown-once token), webhook endpoints (add, edit/disable, rotate secret, send test) and deliveries (Retry now). Storefront connectors, payment/payout providers, backfill, ingest audit and the certification strip not rendered (no route). KPI "failed deliveries 24 h" shown as "Endpoints failing" (no count route; it also counts a disabled endpoint). Browser-verified B1 round 2 (W-B1-4, W-B1-5; 4 viewports pass; BUG-056, 057 fixed). B2 tabs `?tab=connectors|health`: storefront connector cards (add with write-only secret, webhook URL copy, rotate, withdraw) and sync-health KPIs + table; payment/payout providers still not rendered. B2 tabs browser-verified rounds 1–2 (W-B2-7/10; 4 viewports; harness 5.43/5.62/4.47/2.71 %; BUG-075, 077 fixed; open BUG-081: unmapped connector refusal codes shown raw in "Last refusal"); WooCommerce and connector rotate/withdraw not exercised in the browser |
| 15 | sc_14_vendor_access_sessions_authorizations | SC-14 Vendor access sessions | Tenant admin | Settings | A | S6 | Implemented with deviations: `/settings/vendor-access` (one page: queue, open sessions with trace, history). Open: requester shown as "Vendor user &lt;id&gt;" (BUG-023, needs API); step-up dialog stacked over Approve (BUG-045); "You will be asked for a code" copy (BUG-046); focus to body after End now (BUG-028) |
| 16 | sc_15_privacy_requests_dpo_fulfillment | SC-15 Privacy requests | DPO | Cases | B | S7 | Pending |
| 17 | sc_16_migration_workspace_parallel_run | SC-16 Migration workspace and parallel-run report | Implementation consultant; Finance approver | Data | B | S8 | Pending |
| 18 | sc_17_market_launch_checklist | SC-17 Market launch checklist | Tenant admin; Compliance officer | Settings | B | S8 | Implemented with deviations: `/settings/markets/[id]` (`?item=`, `?filter=`), reached from `/settings/markets` (markets, brands, calendars). Gate table + inspector (evidence upload, attestation, provider approval), request go-live and two-person sign-off with risk statement. "Override" and "Filing Packet (.PDF)" not rendered (no route); KPI strip uses sc_17 strip-card markup locally; no risk-acceptance document upload at sign-off. Browser-verified B1 round 2 (W-B1-3; 1440/1280/768/390 pass, BUG-051..053, 058, 059 fixed); BUG-060 fixed in B2 (only the rule id breaks). B2: `agreement_versions` item is automatic and shows the current version; browser-verified B2 round 1 (W-B2-2, item complete with NL v1) |
| 19 | sc_18_distributor_statement_line_explanation | SC-18 Distributor: statements and line explanation | Distributor | Portal | B | P2 | Pending |
| 20 | sc_19_distributor_rank_status | SC-19 Distributor: rank status | Distributor | Portal | B | P1 | Pending |
| 21 | sc_20_distributor_team_view | SC-20 Distributor: team | Team leader | Portal | B | P1 | Pending |
| 22 | sc_21_distributor_customers | SC-21 Distributor: my customers | Distributor | Portal | B | P1 | Pending |
| 23 | sc_22_distributor_bank_details_tax_profile | SC-22 Distributor: bank details and tax profile | Distributor | Portal | B | P1 | Pending |
| 24 | sc_23_earnings_disclosure_builder | SC-23 Earnings disclosure builder | Compliance officer | Compliance | V1 | S1 | Pending |
| 25 | sc_24_data_imports | SC-24 Data imports | Implementation consultant | Data | A | S2 | Implemented with deviations: `/imports`, `/imports/new`, `/imports/[id]` (list, upload and batch detail are separate routes; sc_24 draws one page); schema manifest, audit trace and ledger postings not rendered (no route). Open: month-field hint (BUG-026) |
| 26 | sc_25_import_mapping | SC-25 Import mapping | Compliance officer; Implementation consultant | Data | A | S2 | Implemented with deviations: `/imports/mappings`, `/compliance/mappings`; add rule, discard, impact preview and the 70 % projection not rendered (no route / must not). Open: author and approver named only "you" / "another user" (BUG-029) |
| 27 | sc_26_figure_drill_down | SC-26 Figure drill-down | Compliance officer | Compliance | A | S1 | Implemented: `/compliance/snapshots/[id]/rows`; donut gauge, cohort filter, period compare, column chooser and first/last page not rendered (no route); definition panel smaller than the formula card when the figure has no denominator |
| 28 | sc_27_sign_in_and_second_factor | SC-27 Sign-in and second factor | All | Shared (auth) | A | C1 | Implemented: `/signin`, `/signin/vendor`, `/signin/mfa`, `/signin/enrol`, `/invitation`; gradient bar, WebAuthn path and certification footer not rendered (no route / must not). Harness: no style finding at any width |
| 29 | sc_28_users_and_roles | SC-28 Users and roles | Tenant admin | Settings | A | S2 | Implemented with deviations: `/settings/users` (tabs users, role permission matrix, pending approvals as inspector cards). Open: focus to body after Revoke, Deactivate, Reject (BUG-028); step-up dialog stacked over Approve grant (BUG-045); "You will be asked for a code" copy (BUG-046) |
| 30 | sc_29_tenant_settings | SC-29 Tenant settings | Tenant admin | Settings | B | S1 | Implemented with deviations: `/settings` (one `GET /v1/settings`): thresholds, money policies and breach contacts with "In force since" per value (BUG-025 fixed), "Save new version" with effective date (money keys go to an approval request), pending change requests, versions table and diff drawer (`?version=`, md:w-[540px] lg:w-[600px]). Not rendered: Revert, prospect-data ownership, retention timers (must not / no API). Browser-verified B1 round 2 (W-B1-2; 4 viewports pass; BUG-049, 050, 055, 056 fixed). Markets/brands/calendars page `/settings/markets` (no Stitch drawing; sc_29/sc_28 patterns) verified W-B1-1, BUG-054 fixed. B2: participant types (propose, approve/reject, withdraw), downline depth masking (`genealogy.visibility_policy`, safe default stated when unset), B2 policy cards with unset consequences, agreement versions per market (publish with upload, acceptance counts). B2 part browser-verified rounds 1–2 (W-B2-1/2; no horizontal scroll at 1440/1280/768/390; harness 3.43/3.77/3.92/2.43 %; BUG-069 MEDIUM and BUG-074 fixed; open BUG-083: raw "effective_from cannot be in the past." when approving a change whose time has passed) |
| 31 | sc_30_immutable_audit_log_verification | SC-30 Audit log | Compliance officer; Tenant admin | Settings | A | S6 | Implemented with deviations: `/settings/audit` (and the vendor variant `/vendor/audit`); filters and open event in the URL. Open: export text "1 events" (BUG-027) |
| 32 | sc_31_ingested_orders_returns_explorer | SC-31 Orders and returns (ingested) | Support agent; Commission analyst | Orders | B | S7 | Implemented with deviations (B2): `/orders` (`?tab=orders|exceptions|volumes`, `?order=` inspector), `/orders/[id]`: KPI cards, filters, orders table, inspector (buyer type at order, attribution, line volumes, events, late items, Open in genealogy), exception queue with Retry, product volumes with Set volumes. Not rendered: commission distribution, storefront reconcile, export, manual batch ingest, saved views, Flag for case; tables not stacked on phone (scroll inside their card). Browser-verified B2 rounds 1–2 (W-B2-7/9/10; 4 viewports; harness with `?order=` 6.65/6.49/5.84/3.02 %; BUG-075, 076 fixed; open BUG-081 raw connector refusal codes, BUG-082 exception-queue Source shows the connector id) |
| 33 | sc_32_late_transaction_queue | SC-32 Late-transaction queue | Commission analyst | Periods | B | S8 | Implemented with deviations (B2): `/periods/late`: KPI cards from `meta.counts` (labelled; counts ignore the market filter), selectable table, Accept proposed handling preview + decide, item diagnostic, Raise restatement instead. Amounts in the market currency (BUG-071 fixed; one GET /v1/orders/:id per order, shortcut). Not rendered: M11 wording, threshold matrix, export, freeze banner. Browser-verified B2 rounds 1–2 (W-B2-8; 4 viewports; harness 4.96/4.87/4.35/2.10 %; BUG-071, 072 fixed) |
| 34 | sc_33_ledger_journal_export | SC-33 Ledger and journal export | Finance manager | Finance | B | S1 | Pending |
| 35 | sc_34_payout_reconciliation_returned_payments | SC-34 Payout reconciliation and returned payments | Payout officer | Payouts | B | S4 | Pending |
| 36 | sc_35_executive_overview | SC-35 Executive overview | Executive | Home (exec) | B | S8 | Pending |
| 37 | sc_36_global_search_command_palette | SC-36 Global search | Support agent | People (header search) | B | S1 | Pending |
| 38 | sc_37_distributor_home | SC-37 Distributor home (mobile) | Distributor | Portal | B | P1 | Pending |
| 39 | sc_38_distributor_notifications_profile | SC-38 Distributor notifications and profile | Distributor | Portal | B | P1 | Pending |
| 40 | sc_39_vendor_operations_console | SC-39 Vendor operations console | Vendor ops | Vendor console | A | S8 (wrong: tenant shell) | Implemented with deviations: in the vendor shell, not the drawn tenant shell: `/vendor`, `/vendor/tenants/[id]`, `/vendor/provisioning/new`, `/vendor/support-sessions`, `/vendor/users`, `/vendor/audit`; fleet KPIs, filter search and docked request panel not rendered (no API). Open: request dialog offers areas a Tenant admin cannot approve (BUG-047) and "Compensation plans" (BUG-048) |
| 41 | sc_40_public_earnings_disclosure_page | SC-40 Public earnings disclosure page | Prospect; Distributor | Public | V1 | C1 (document) | Pending |
| 42 | sc_41_public_privacy_request_form | SC-41 Public privacy request form | Any data subject | Public | B | C1 | Pending |
| 43 | sc_42_simulation_results_golden_datasets | SC-42 Simulation results and golden datasets | Plan administrator; Implementation consultant | Plans | B | S5 | Pending |
| 44 | sc_43_rank_and_qualification_detail_staff | SC-43 Rank and qualification detail (staff) | Commission analyst; Support agent | People | B | S1 | Pending |
| 45 | sc_44_plan_change_governance_workflow | SC-44 Plan change workflow | Plan administrator; Compliance officer | Plans | B | S5 | Pending |
| 46 | sc_45_integrity_signals | SC-45 Integrity signals | Compliance officer | Compliance | V1 | S1 | Pending |
| 47 | sc_46_compliance_overview_overlay_home | SC-46 Compliance overview (overlay home) | Compliance officer; Executive | Compliance (MVP-A home) | A | S1 | Implemented: `/compliance`; acknowledge, countersign and export summary not rendered (no route); legal-conclusion labels and invented benchmark lines not rendered (must not) |
| 48 | sc_47_licence_updates_diagnostics_for_self_hosted_edition | SC-47 Licence, updates and diagnostics (self-hosted edition) | Licensee administrator | Settings › System | V1 | S5 | Pending |

Folder names match the screen drawn in every file (all 48) (checked against each `<h1>`/title). Content-level deviations from the folder name or the spec are listed per file below.

## 3. Per-file detail

### 3.1 First export (38 files)

Notation: **Layout** = shell + content grid. **Components** = named sections (from the file's own section comments). **Interactive** = controls drawn. **Responsive** = breakpoint classes present. **Deps** = beyond the common set in §0.2. **Must not implement** = BR-HON-01 / UI_UX §0 refusal-list content or claims with no source.

#### sc_01_periods_runs_analyst_home — SC-01
- **Layout:** S1. Command bar (SC chip, `h1` title-lg, summary, action cluster) → 7-step state timeline ribbon (Open → Cut-off → Calculating → Calculated → Committed → Paid → Closed) → 4 KPI cards → `xl:grid-cols-12`: period register (8 cols) + run diagnostics panel (4 cols) → fixed bottom two-person authorisation bar (`left-52`).
- **Components:** page header; state timeline; KPI cards (target period, ingestion sync, gross payout, run readiness); calendar tabs (underline); filter input + status filter chips; period table (8 cols, status chips, row actions, overflow menu); pagination footer; exceptions preview list; engine-pass progress list; approval bar.
- **Interactive:** Sync Health, Late-Transaction Queue (count), Replay Historical Run, primary "Open Run Review"; calendar tabs; status chips; Review Run / More / Statement / Ledger Log / Dry Run; Verify Trace, Inspect Tree, View Audit Log, Recalculate, Manage Routing Rules, Export Audit Manifest, "Sign & Forward to Review (SC-02)". 6 icon-only buttons, 2 with `title`.
- **Responsive:** `md:grid-cols-2 xl:grid-cols-4` KPIs, `lg:flex-row` header, `xl:grid-cols-12` work area, table `overflow-x-auto`; timeline is a fixed `grid-cols-7` (does not wrap; spec says wrap at md).
- **Deps:** header logo image.
- **Deviations:** two primaries (header "Open Run Review" + bar "Sign & Forward"); spec allows one. `animate-ping` on the active period dot.

#### sc_02_run_review — SC-02
- **Layout:** S1. Invariant/status banner → title + actions → 4 KPI tiles → tab bar → `lg:grid-cols-12`: bonus variance table + exception acknowledgement checklist (8) | docked trace drawer (4) → fixed approval bar.
- **Components:** banner; KPI tiles; tabs (Variance & Bonus Breakdown, Top Payee Movers (25), Exceptions & Invariants (4), Line Item Provenance Trace, Input Snapshot & Diff); filter bar (category select, min-variance input, payee search, density toggle Compact/Standard); variance table (Bonus, Pass, Prior, Current, Delta $, Delta %, Status); exception checklist (checkboxes); trace viewer (entity id + hash, provenance steps, formula, rounding, referenced orders); approval bar (prepared by, SOD-01 notice, sign-off note input, Reject / Recalculate, Acknowledge All, Commit).
- **Interactive:** Export Run Audit, Replay Historical Run, Recalculate Run, tabs, filters, checkboxes, "Inspect Full JSON Bitemporal Trace", Reject / Recalculate, Acknowledge All, "Commit Run & Post". 2 labelled inputs.
- **Responsive:** `xl:grid-cols-4` KPIs, `lg:grid-cols-12` split, `sm:grid-cols-2`.
- **Must not implement:** sample row "Fast Start Enrolment Bonus — Surge attributed to 428 enrollments" (enrolment-driven bonus narrative; bonus names come only from the run API); decorative `bg-gradient-to-br` fill.

#### sc_02_run_review_step_up_commit_modal — SC-02 commit dialog
- **Layout:** S1 with inert background run view, `role="dialog" aria-modal="true" aria-labelledby="modal-title"` scrim `bg-[#0F172A]/70 backdrop-blur-md`, 720 px card.
- **Components:** modal header (icon, `h2`, code chip, run meta, close); SOD verification banner; totals and double-entry tie-out strip; per-exception acknowledgement list (4 checkboxes with labels); irreversible-action callout; step-up block (FIDO2 key prompt, TOTP fallback link); footer (audit ref, Cancel, primary Commit with amount).
- **Interactive:** close, 4 checkboxes, Tap Hardware Key, Use Backup 6-Digit TOTP, Cancel & Return to Review, Commit Run & Post.
- **Responsive:** `sm:flex-row` footer and prompt rows, `md:grid-cols-4` totals.
- **Must not implement:** WebAuthn/hardware-key path and "Platform Biometrics" (API offers TOTP step-up only: `POST /v1/auth/sessions/current/step-up`); "Challenge Expires 2m 45s" countdown; decorative gradient rule (`bg-gradient-to-r`, UI_UX forbids gradients on work screens).

#### sc_03_payout_batches_approvals — SC-03
- **Layout:** S1. Clearance ribbon → header + actions + provider status micro-indicators → 4 KPI cards → tab bar → `xl:grid-cols-12`: batch table (7) + batch inspector/sign-off drawer (5).
- **Components:** ribbon; KPI cards; tabs as `nav` (Active Batches, Included Payees, Exclusions & Holds, Instruction Dispatch Log, Provider Adapters); table toolbar (filter, density); batch table (7 cols); distribution bar; batch execution bar; inspector (financial summary, provider eligibility checklist, exclusions and holds list, step-up PIN `input[type=password]`, Authorize & Commit, Reject & Void).
- **Interactive:** Export Batch Register, Provider Health & Limits, Prepare New Disbursement Batch, tabs, Inspect/Details/Archive, Download Bank Instruction File, Retry Failed Lines, Verify, Authorize & Commit Batch, Inspect Payee List, Reject & Void Batch.
- **Responsive:** `sm:grid-cols-2 lg:grid-cols-4` KPIs, `xl:grid-cols-12` split.
- **Deviations:** "NACHA Window: Cut-off in 1h 24m" countdown (show the cut-off time instead); inline JS fakes the commit spinner. Inline `style` widths on the distribution bar.

#### sc_04_plan_versions_simulation — SC-04
- **Layout:** S1. Sub-header (version, state and baseline badges) → tabs → 4 KPI cards → `lg:grid-cols-12`: rule list with plain-language diff (7) + simulation analytics (5) → sticky governance bar.
- **Components:** version header with state chips; tabs (Rule Editor & Plain Language Diff, Simulation Results & Payee Distribution, Cap & Pool Configuration, Golden Datasets & Regression, Market Filings & Governance); rule groups by pass (measures, ladders, bonuses, caps) with diff boxes and rate-tier matrix diff; SVG histogram; top impacted payees table (5 rows); guardrail warning banner; governance bar.
- **Interactive:** Golden Dataset Test Suite, Guardrail Evaluation, Run Historical Simulation, tabs, All Passes / Changed Rules Only filter, rule filter input, Attach Compliance Memo, Export Audit Dossier, "Proceed to Plan Change Workflow (SC-44)".
- **Responsive:** `md:grid-cols-2 lg:grid-cols-4` KPIs, `lg:grid-cols-12`.
- **Deviations:** "Projected Payout Total" label (use "Simulated payout total"; staff-only simulation figure, never shown to participants); no "Save draft" control although spec primary is Save draft / Simulate; rule editor drawer not drawn.

#### sc_05_cap_and_pool_configuration — SC-05
- **Layout:** S3. Title + actions → cap definition form → shared pool allocation → priority curtailment ladder → simulation snapshot (`lg:grid-cols-12`).
- **Components:** form with 10 labels (text, checkbox, radio method proportional/priority); ladder rows with `drag_indicator` handles; preview cards; waterfall.
- **Interactive:** Preview on Period, Export Cap Model (.JSON), Save Cap Configuration (primary), Reset Default Invariants; radio/checkbox inputs.
- **Responsive:** `sm:grid-cols-2/4`, `md:grid-cols-2/3`, `lg:grid-cols-4/12`.
- **Deviations:** drag-only reordering (spec requires move up/down buttons); no section comments in markup.

#### sc_06_cases_exceptions — SC-06
- **Layout:** S1. Context ribbon → header + actions → 4 KPI cards → view tabs + filter fields → master-detail: case queue (`lg:col-span-7`) + case detail/evidence/decision panel (5).
- **Components:** case-type tabs (All, Payee Disputes, Manual Adjustments, Committed Restatements, Genealogy Changes); filter bar (search, select); queue list rows with selected accent bar; history context card; detail: subject payee, statement and notes, attached trace evidence, effect preview, pre-flight invariant checks, SOD approver gates, decision buttons.
- **Interactive:** Export Case Register, "+ Create Manual Adjustment Case", tabs, filters, pagination, Raw Calculation Trace, Reject Case, Request Evidence, Approve Adjustment (+$740.00).
- **Responsive:** `md:grid-cols-2 xl:grid-cols-4` KPIs, `lg:grid-cols-12`.
- **Deviations:** queue drawn as div rows, not a `<table>` (use the data table); evidence uploader not drawn.

#### sc_07_genealogy_explorer_staff_as_of — SC-07
- **Layout:** S1. Toolbar → bitemporal parameter bar (search, tree-kind segmented control, as-of date, known-at timestamp, diff switch) → read-model banner + case diff banner → `lg:grid-cols-12`: breadcrumbs, focused node card, node metrics, frontline legs list with lazy expand (8) + position inspector (4).
- **Components:** search; segmented control (Sponsor Tree / Placement Tree); date + datetime inputs; banners; breadcrumbs to root; node card; legs list (expand buttons with `title`); volume share bars; position attributes, ownership, multi-position mapping, upline lineage; audited unmask; case actions.
- **Interactive:** Tree Config, Export Subtree, Run Path Audit, segmented control, breadcrumb buttons, expand/collapse (7 icon buttons all titled), Table View / Graphic Graph switch, Focus Node, Audited Unmask, Reject Proposal, Sign & Authorize Reparenting.
- **Responsive:** richest staff file: `sm:block`, `md:flex`, `md:grid-cols-2/4`, `lg:grid-cols-12`, `xl:col-span-2/3`.
- **Deviations:** "Graphic Graph" view toggle (UI_UX: never a whole-tree canvas as the only view; an indented list is the default; graph view not rendered until specified).

#### sc_08_genealogy_change_and_duplicate_cases — SC-08
- **Layout:** S3. Breadcrumb context → header + dual sign-off actions → tabs (Sponsor & Placement Change Request, Duplicate Account Investigation, Ownership Transfer & Succession) → 60/40 split: case form, policy validation matrix, affected committed periods with upline delta table | side-by-side topology comparison.
- **Components:** change-kind segment (Correction / Standard), participant and target grid, transfer path, evidence vault, rules checklist (4), warning, impact metrics, dense delta table, topology diagram (inline SVG stems), merge/allow/terminate choice.
- **Interactive:** Reject Request, Request Evidence, Approve Sponsor Transfer (Dual Sign-Off), tabs, segment buttons, Merge / Allow Distinct / Terminate Dup, "Authenticate WebAuthn & Commit Tree Mutation", View Full Trace.
- **Responsive:** `md:grid-cols-2/3`, `xl:grid-cols-12`.
- **Deviations:** only the change-request tab is drawn; the duplicate side-by-side record comparison (spec) is reduced to three buttons; WebAuthn wording (step-up is TOTP).

#### sc_09_participant_deep_fact_record — SC-09
- **Layout:** S4. Breadcrumbs → title + badges + actions → 4 stat cards → horizontal tabs (`nav`) → 65/35 split.
- **Components:** breadcrumbs; stat cards; tabs (Overview & Identity, Position Ownership & Genealogy, Participant Types History, Customer Servicing & Attribution, Tax Profile & Withholding, Banking Coordinates History, Disputes & Cases); masked identity block; effective-dated types table; serviced customers table; payout coordinates with cooling-off; tax profile with unmask; cases list; audit footprint; bottom notice banner.
- **Interactive:** View Downline Tree, Download Ledger Statement, Start Case (primary), tabs, Reveal TIN (Audited Step-Up), View All 42 Customers, Audit Ledger, Download.
- **Responsive:** `sm:grid-cols-2`, `md:grid-cols-2`, `lg:grid-cols-12`, `xl:grid-cols-4`.
- **Deviations:** unmask uses `window.confirm`/`alert` (use step-up dialog); only the Overview tab content is drawn.

#### sc_10_compliance_reports — SC-10
- **Layout:** S1. Sticky context ribbon → header + scope meta strip → `lg:grid-cols-12`: R1–R5 figure cards (8) + docked methodology inspector (4).
- **Components:** safe-harbour status banner; figure cards R1 (segmentation bar, 4-period trend), R2, R3 (breakdown table), R4 and R5 (distribution mini-chart); methodology & trace inspector; seal details; reference box.
- **Interactive:** Methodology & Legal Basis, Compare Snapshots, Export Dossier (.ZIP), Create New Snapshot (primary), copy hash, more menu, Review 14 Cases, "Open Figure Drill-Down (SC-26)".
- **Responsive:** `md:grid-cols-2/12`, `lg:grid-cols-12`, `sm:block`.
- **Must not implement:** legal-conclusion copy ("Statutory Defense Posture: SUBSTANTIATED & COMPLIANT", "BENCHMARK ACHIEVED", "Certified under federal safe harbor", "Optimal target ≥ 60.0%", "0% RECRUITMENT VERIFIED FTC Anti-Pyramid Defense"). Figures show value, population, method and data-quality warnings only; thresholds come from tenant settings.
- **Route before the Stitch re-skin (historical; current status in §2):** current `/compliance/snapshots/[id]` has report tabs and a "Compare periods" table; the Stitch file shows all five figures on one page with a docked method panel.

#### sc_11_guardrails_policy_overrides_log — SC-11
- **Layout:** S4. Breadcrumb/status → title + actions → 4 KPI cards → 70/30: filter bar + applied chips + guardrail table + pagination | decision inspector → bottom notice.
- **Components:** filters (search, outcome, market pack, plan version selects; 3 labels, 1 `aria-label`); chips with "Clear all filters"; table (Rule ID & Basis, Target, Predicate, Jurisdiction, Outcome & Severity, Actions); inspector sections (target, rule logic, mandate and risk, justification and override status, audit signature).
- **Interactive:** Export Guardrail Audit, Evaluate Active Comp Plans, Request Policy Override, chip close, row actions (Inspect Decision, View Statutory Cite, View Justification, Audit Trail, Submit Override Request, Inspect Rule), Open Rule Designer, Compliance Reference Manual.
- **Responsive:** `sm:grid-cols-2 xl:grid-cols-4`, `lg:grid-cols-12`.

#### sc_12_tax_configuration_year_end_forms — SC-12
- **Layout:** S5. Stat bar → header + actions → 4 KPI cards → tabs → 65/35: 4-step wizard stepper, warning banner, filter bar, payee table (7 cols), pagination | form inspector (identity, staged boxes preview), withholding rule matrix (US, Malaysia, Canada).
- **Interactive:** Batch Export Form Manifest, Generate Year-End Tax Forms (Wizard), tabs (Year-End Forms Generation, Jurisdictional Withholding Rules, Missing Taxpayer Identification Queue (42), Historical Year-End Exports), Inspect 42 Exceptions, row icon buttons (10 of 12 titled), Previous/Next, Download Sample Form 1099-NEC, "Generate 18,416 Sealed Forms (Dual Sign-Off)".
- **Responsive:** `sm:grid-cols-2/4`, `lg:grid-cols-12`, `xl:grid-cols-4`.
- **Deviations:** header carries a multi-tenant switcher (S5); tenant is resolved from hostname, no picker (UI_UX §4.1).

#### sc_13_integrations_and_sync_health — SC-13
- **Layout:** S2 (broken config; PNG unstyled). Title row → cut-off guardrail banner → 4 telemetry cards → tabs → 8/4: connector cards (Shopify Plus, WooCommerce, Wells Fargo ACH, Hyperwallet SWIFT) with telemetry bars | diagnostics panel (inline SVG sparkline, reconciliation integrity, API key quota, audit footprint, run diagnostics) → sticky two-person ingestion certification strip; page footer.
- **Interactive:** Trigger Global Backfill, Manage API Keys & Webhooks, Add Integration Connector (primary), tabs (Storefront Connectors, Payment & Payout Providers, Public API Keys, Webhook Subscriptions), per-connector Test Webhook / Sync History / Re-authenticate / Re-sync / Configure / Connection Diagnostics / Manage Keys / Inspect Adapter / FX Ticker Logs, Run Comprehensive Ingest Audit.
- **Responsive:** `sm:grid-cols-2/4`, `lg:grid-cols-12`, `xl:grid-cols-4`.
- **Deviations:** API-key creation modal ("shown once") and webhook/export tables not drawn; spec primary is Re-authorise / Create key.

#### sc_14_vendor_access_sessions_authorizations — SC-14
- **Layout:** S6. Breadcrumb + header + utilities → statutory notice banner → 4 KPI cards → 7/5: pending request card (requester grid, justification, guardrail box, dual-approval progression, duration segmented 30 min / 1 hour / 2 hours, Deny, Approve & Sign) | live session monitor (progress, metric pills, log terminal, terminate strip) → historical sessions table (8 cols) + pagination → spec strip; fixed footer.
- **Interactive:** Access Policy Spec, View Audit Stream (SC-30), End Session Now, duration buttons, Deny Request, Approve & Sign (Requires MFA), Terminate Session Immediately, download icon, Audit Trace, pagination.
- **Responsive:** `md:grid-cols-2 lg:grid-cols-4`, `xl:grid-cols-12`.
- **Deps/behaviour:** inline JS countdown (the support-session countdown is the only permitted countdown, UI_UX §3.3).
- **Route before the Stitch re-skin (historical; current status in §2):** `/settings/vendor-access` uses tabs Requests / Active / History with decision and log dialogs; durations come from `GET /v1/support-sessions/limits` (Stitch hard-codes them).

#### sc_15_privacy_requests_dpo_fulfillment — SC-15
- **Layout:** S7. Breadcrumb + title → actions → 4 KPI cards → 7/5: filter bar + chips + dense request table (deadline clock column) + pagination + reference bar | subject inspector (profile, identity proof, balancing matrix erase vs retain, reason select, dual-admin signatures, submit actions) → notice banner.
- **Interactive:** Verify Identity Token, Record Legal Basis, Export Data Map, Fulfil Request (Dual-Sign), Filters (3), Sync, Reset All, row icon buttons (5, none labelled), pagination, View Legal Precedent Brief, Approve & Execute Irreversible Pseudonymization, Export Redacted Dossier.
- **Responsive:** `md:grid-cols-2 lg:grid-cols-4`, `lg:grid-cols-12`.
- **Notes:** deadline shown as "18d remaining" text (allowed deadline indicator). Head has a 200-line pretty-printed config.

#### sc_16_migration_workspace_parallel_run — SC-16
- **Layout:** S8. Breadcrumbs → header + toolbar → 5-step pipeline stepper → 5 KPI cards → invariant banner → 8/4: classification table with segmented filter (All / Mismatches / Rounding / Structural), deviation chart | invariant checklist + dual-key sign-off gate → hidden modal "Secondary Key Authorization" (`fixed inset-0`, password input, Cancel, Commit Production Cutover); fixed footer.
- **Interactive:** Upload Extract (.ZIP), Export Difference Log, Run Parallel Simulation, View Raw Telemetry, filter pills, row View Lines / Inspect Trace / Review Case, pagination, Sign Off Migration & Enable Production (Dual-Key), modal close/cancel/commit. 4 `onclick` attributes.
- **Responsive:** `sm:grid-cols-2`, `md:grid-cols-4/5`, `lg:grid-cols-5`, `xl:grid-cols-12`.
- **Deviations:** modal lacks `role="dialog"`; hardware-token password field (step-up is TOTP).

#### sc_17_market_launch_checklist — SC-17
- **Layout:** S8. Context bar → halt banner → 4 KPI cards (with mini progress bar) → 8/4: filter tabs (All Gates, Regulatory & Legal, Payment & Payout, Taxation, Plan & Disclosures) + gate table (ID, mandate, basis, evidence hash, verification) | gate inspector (defect narrative, file upload area, two-person rule box).
- **Interactive:** Upload Evidence, Filing Packet (.PDF), Request Go-Live (primary), filter tabs, Attach Evidence File, Override.
- **Responsive:** `sm:grid-cols-2 lg:grid-cols-4`, `xl:grid-cols-12`.
- **Deviations:** "Override" on a blocked gate (spec: go-live disabled with missing items named; overrides only with written risk acceptance for screening-status rules).

#### sc_18_distributor_statement_line_explanation — SC-18
- **Layout:** P2. Sub-header (statement period, PDF) → status banner (Committed & Disbursed) → net pay hero → reconciliation card (formula G − W − C = Net; gross, withholding with rate, clawback, prior adjustments, total) → earnings by position grouped lines with "How calculated" inline expanders → clawback explanation card → disclosure section → inquiry trigger → bottom sheet "Line Audit Inspector" (`fixed bottom-0`, `translate-y-full` animation, backdrop `bg-black/45`) → toast.
- **Interactive:** back, bell, PDF, How calculated (toggle), Trace Line & Rules (opens sheet), Open an Audited Inquiry, sheet close, Dispute this Specific Line Item, Confirm & Return. 9 `onclick` attributes; 3 `aria-label`s.
- **Responsive:** none (phone only; no T2 tablet/desktop layout, no side panel at ≥1024).
- **Must not implement:** "Fast Start Accelerator Bonus — 2 new qualified personal enrollee cohorts" sample line; disclosure link "View 2025 Statutory Earnings Disclosure – Form R5" only when a disclosure is published (V1, BR-HON-02).

#### sc_19_distributor_rank_status — SC-19
- **Layout:** P1. Identity + period strip → cycle selector (`select`) → rank status tile (paid-as, highest achieved, grace engine) → requirements checklist (4) → frontline leg matrix → history table (Cycle, Paid Rank, GV, PV) → disclosure text.
- **Interactive:** period select, history icon button.
- **Responsive:** none (phone only). Inline JS highlights the Rank tab, but the drawn nav has no active state on load.
- **Must not implement:** "8 consecutive cycles" streak; requirement progress expressed as "710.0% of Target" / "128.1% of Target" (show measured value vs requirement and met / not met only); named frontline legs with their GV shares, including the "Qualified Frontline Leaders 4 / 3 — Thomas K. (Sr Dir), Maya L. (Dir) +2 more" requirement detail and "Strongest leg (Thomas K.) constitutes 47.5%…" (not in SC-19 key content; only via the team visibility policy; the requirement shows the count vs required only); the max-leg plan rule labelled "statutory 55.0% threshold" (it is a plan rule, label from the plan). No next-rank prompt is drawn (good).
- **Deviation:** bottom nav ends with Team, not More.

#### sc_20_distributor_team_view — SC-20
- **Layout:** P1. Tree-kind segmented toggle → identity/scope card → metrics grid → search → privacy policy banner → frontline legs cards with collapsible level-2 sub-nodes → deep generations aggregate (levels 3–8) with SVG bar distribution → privacy explanation → actions ribbon → toast.
- **Interactive:** Sponsor Tree / Placement Tree, search, clear (icon, unlabelled), Inspect Leg Subtree, Export Team Summary (Masked CSV), View Downline Policy Guidelines, toast close. 10 `onclick` attributes.
- **Responsive:** none (phone only).
- **Deps:** 5 hot-linked portrait photos of named downline members.
- **Must not implement:** "Level 2 Key Builders (Verified)" (ranks downline members by volume), "Active Builders" counts per leg, "Downline Nodes n Positions" head counts per leg, "Total Network 4,120 positions" headline and "Direct Legs 4 · 100% active" tile, "Qualified for Tier 4 Bonus" on the deep-generation aggregate (bonus-qualification prompt), portraits. Allowed: own first level per visibility policy, aggregates beyond depth as "n people · volume v (totals only)".

#### sc_21_distributor_customers — SC-21
- **Layout:** P1. Identity + attribution badge → title → 4 metric bento cards → quick actions → search + scrollable filter chips → customer cards (repeat/auto-delivery/one-time; reassigned with banner) → regulatory notice.
- **Interactive:** Share Store Link, Export CSV, search, chips (All, Repeat Buyers, New This Month, Auto-Delivery).
- **Responsive:** none (spec: phone stacked cards, sm 2-col cards, md+ table).
- **Must not implement:** "FTC Validated" chip and "BR-HON-01 Compliant" heading badge (legal conclusions on a participant page), "+3 this cycle" growth delta, "Target: >70% (FTC)" invented target, "Share Store Link" (no API; promotional call to action), "Direct Profit" amounts per customer (earnings belong to committed statements, SC-18). Customer contact fields only if tenant policy allows.

#### sc_22_distributor_bank_details_tax_profile — SC-22
- **Layout:** P1. Header title wrongly reads "Distributor Home". Context block (next payout date) → direct-deposit card (masked account, routing) → update action with re-auth note → cooling-off banner → tax profile and W-9 card with TIN unmask toggle → backup-withholding notice → 1099-NEC item → version history (v2.1, v2.0, v1.0) → custody disclosure.
- **Interactive:** Update Direct Deposit Details, TIN visibility toggle (`aria-label`), PDF, Banking & Tax Version History.
- **Responsive:** none (phone only).
- **Deviations:** the change form itself (one question group per screen, numeric keyboard, re-authentication) is not drawn; passkey / FIDO2 wording (re-auth is TOTP-based today); TIN reveal uses `alert()`.
- **Must not implement:** "SOC-2 Type II Certified Financial Ledgers", "TLS 1.3 … HSM" and "KYC & Payout Verified" claims unless an API field states them; trace session / ledger node footer.

#### sc_24_data_imports — SC-24
- **Layout:** S2 (broken config; PNG unstyled, verified). PII-enforcement banner → header + actions → 7/5: staging upload box (drag-and-drop canvas, three file trackers participants/orders/payout lines) | pre-flight diagnostics (link completeness, orphans, duplicates, control totals, parser progress) → batches table (7 cols: batch + hash, period, stage, counts and control totals, validation, timestamp, actions) + pagination → three FR notes.
- **Interactive:** Download Schema Manifest (.JSON), Upload New Export Package (primary), Full Audit Trace Log, Filter input + button, row actions Open Mapping (SC-25) / Report / Load Batch / View Details / Ledger Postings / Download Errors, PREV / page / NEXT.
- **Responsive:** `md:grid-cols-3`, `xl:grid-cols-12`.
- **Route before the Stitch re-skin (historical; current status in §2):** current app splits upload (`/imports/new`, XHR progress, market + period fields) from the list (`/imports`) and detail (`/imports/[id]`: findings table, attach mapping, Load confirm, superseded banner). Stitch shows upload and list on one page and has no detail view.

#### sc_25_import_mapping — SC-25
- **Layout:** S2 (broken config). Command bar + toolbar → version and audit context strip → unresolved-categorisation banner → domain tabs (Participant Types (Flags), Order Purpose & Buyer Types, Payout Source Classifications, Starter-Kit Volume Exclusions) → 8/4: mapping table (Source code, Occurrences, Target category select, End-Cust / Can Earn / Can Sponsor flags, Basis, Actions) | governance and impact preview drawer (R1 metric with 70% target marker, head-count bounty invariant, SOD gate, inline commit) → sticky two-person approval bar.
- **Interactive:** Add Mapping Rule, Save Draft, Approve Mapping Version, Jump to Entry, tabs, filter, target select, Assign, row icon buttons (all titled), Submit for Statutory Review, Discard Staged Edits, Approve Mapping Version (Two-Person Key).
- **Responsive:** `lg:grid-cols-12` only.
- **Must not implement:** "Live projection of statutory ratio thresholds" impact preview and the 70% "regulatory target" marker (no API; invented threshold).

#### sc_27_sign_in_and_second_factor — SC-27
- **Layout:** C1. Wordmark + claims strip → tenant context chip → auth card (`max-w-[480px]`): "Step 2 / 2", identity box, FIDO2 key chamber with pulse rings, WebAuthn button, divider, 6-slot TOTP input, "Remember workstation session" checkbox, Verify & Enter Workspace, policy callout, "Sign in as a different staff member" → attestation footer.
- **Interactive:** Use Security Key, 6 TOTP slot inputs (1 `label[for]`), checkbox, Verify, switch account link. Inline JS handles slot focus/paste.
- **Responsive:** `sm:flex-row`, `md:flex-row`, `sm:px-gutter`.
- **Gaps vs spec:** only step 2 (second factor) is drawn; step 1 (company, email, password), enrolment (QR + confirm), recovery, vendor sign-in, invitation acceptance, lockout and error states are absent.
- **Must not implement:** WebAuthn path, "Remember workstation session" (no API), "SOC-2 Type II Certified · FIPS 140-3 Compliant" and other certification claims, animated pulse rings.

#### sc_28_users_and_roles — SC-28
- **Layout:** S2 (broken config). Title + toolbar → SOD invariant banner (VIEW CONFLICT MATRIX) → 4 KPI cards → sub-tabs (Active Staff Users, Role Permission Matrix, Pending Privileged Approvals, Session Security & MFA Logs) → quick filter → 8/4: users table (member, role, scoped markets and brands, MFA method, SOD invariant, last active, action) + pagination | pending privileged grant inspector (warning, grant details, conflict cross-check, hash, Approve Grant (MFA step-up), Deny & Revoke).
- **Interactive:** Export Access Audit, Manage Role Definitions, Invite Staff User (primary), tabs, Role Filter, row Edit Scope / Manage / Edit, PREV/NEXT, Approve Grant, Deny & Revoke Request.
- **Responsive:** `sm:grid-cols-2 xl:grid-cols-4`, `xl:grid-cols-12`.
- **Gaps:** permission matrix tab, invite dialog, role editor not drawn. Existing `/settings/users` already has users / roles (matrix + diff) / approvals tabs and invite, grant, deactivate dialogs.

#### sc_30_immutable_audit_log_verification — SC-30
- **Layout:** S6. Breadcrumb + status banner → actions → 4 KPI cards → filter console (search, actor select, domain select, date range select, active filter tags) → 7/5: event table (Event ID / Time, Actor & Assurance, Action & Domain, Target Object, Merkle Block Hash, Status) + pagination | event inspector (metadata grid, before/after state, cryptographic proof, actions) → storage notice; fixed footer.
- **Interactive:** Run Full Hash Chain Verification, Export Audit Log, Reset All, pagination (Previous, 1, 2, 3, 29,857, Next), Download Merkle Proof (.JSON), Report Anomalous Query.
- **Responsive:** `sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-4`, `lg:grid-cols-12`.
- **Route before the Stitch re-skin (historical; current status in §2):** `/settings/audit` has filters in the URL, cursor pagination (no page-number jumps, per UI_UX), export dialog; no event drawer. `GET /v1/audit-chain/verification` exists, so "Run Full Hash Chain Verification" is backed.

#### sc_31_ingested_orders_returns_explorer — SC-31
- **Layout:** S7. Command/context bar → title + actions → 4 KPI cards → filter bar (search, crediting period, purpose tag, storefront source, status selects) + filter tags → 8/4: orders table (8 cols) + pagination | order inspector (attribution invariant, line volume breakdown, downline commission distribution, event history, actions) → bottom ribbon.
- **Interactive:** Saved Views, Reconcile Storefront Sync, Export Orders, Ingest Manual Order Batch, chip close, Clear all filters, Compact/Comfortable, pagination, Inspect Downline Genealogy Trace, View Webhook Log, Flag for Case (SC-06).
- **Responsive:** `md:grid-cols-2 lg:grid-cols-4`, `xl:grid-cols-12`.

#### sc_32_late_transaction_queue — SC-32
- **Layout:** S8. Context bar + actions → non-dismissible freeze banner → 4 KPI cards → 8/4: bulk action strip + queue table (checkbox column, 8 cols) + ledger metadata + inline SVG cut-off timeline | item diagnostic (crediting meta, lineage and delta per payee, handling rule callout, escalation action, invariant checklist).
- **Interactive:** Export Queue, Threshold Matrix, Accept Default Handling (Route to M11) (primary), row checkboxes, manage_search icon buttons, Escalate to Full Restatement (SC-06). Bulk accept uses `alert()`.
- **Responsive:** `sm:grid-cols-2 lg:grid-cols-12 xl:grid-cols-4`.
- **Gap:** the bulk preview modal (count, total effect, affected payees) required by the spec is not drawn.

#### sc_33_ledger_journal_export — SC-33
- **Layout:** S1. Action/meta header → accounting invariant banner (balance check) → 4 KPI cards (with sparkline bar) → tabs (Journal Postings Register, General Ledger Accounts, Clawback Receivables & Ageing, ERP Chart of Accounts Mapping) → 9/3: filter toolbar (period select, account filter, min threshold, search, density) + postings table (9 cols: posting time, JE id, origin, debit account, credit account, debit, credit, approvers, status) + ageing bands | ERP export panel (radio target system, mapping status, download), integrity diagnostic, two-person status → toast.
- **Interactive:** Receivables Ageing Analysis, Propose Clawback Write-Off, Generate ERP Journal Export (primary), tabs, filters, radios, Previous/Next, Download Verified Journal (.CSV).
- **Responsive:** `sm:grid-cols-3`, `md:grid-cols-2`, `xl:grid-cols-4/12`.

#### sc_34_payout_reconciliation_returned_payments — SC-34
- **Layout:** S4. Breadcrumbs + title + state badges + actions → validation status strips → 4 KPI cards (disbursed, settled, returned, unmatched) → 8/4: filter bar + chips + exceptions table (7 cols) + pagination with bulk status | inspector (instruction facts, bank return event, ledger postings, corrective action flow, actions) → rule banner.
- **Interactive:** Import Provider Settlement File (.CSV / BAI2), Run Daily Clearing Reconciler, Batch Resolve Selected Exceptions, Reset all filters, row actions (Inspect Trace, Include in M11, Request Bank Update, Open Succession Case, Manual Query Status, Notify Payee), Prev/Next, Confirm Payee Notification & Route to M11 Batch, Download Settlement Audit Dossier.
- **Responsive:** `md:grid-cols-2 lg:grid-cols-4`, `xl:grid-cols-12`.

#### sc_35_executive_overview — SC-35
- **Layout:** S8. Command/filter bar (period scope, market scope dropdown, actions) → anti-pyramid invariant banner → 5 KPI cards (`xl:grid-cols-5`) → 7/5: 12-month SVG bar + line chart, market table | defensibility posture, safeguards, two image cards, sign-offs → right overlay drawer "Ledger Trace Inspector" (`fixed inset-y-0 right-0 w-full sm:w-[480px] translate-x-full`, backdrop).
- **Interactive:** period and market scope, Export Dossier (.PDF), SC-10 Compliance, Change Cohort, Audit Trace, View Sign-Off Certificate, drawer close, Download Cryptographic Proof.
- **Responsive:** `md:grid-cols-2 xl:grid-cols-5`, `lg:grid-cols-12`, `sm:w-[480px]` drawer.
- **Deps:** 2 hot-linked decorative photos (fulfilment centre, compliance vault).
- **Must not implement:** the two photos (no imagery in product) and their captions ("No garage stockholding", "GOV-SEC CERTIFIED"), "OPTIMAL" grading and "Target Band 32–35%" corridor unless the tenant configures one, "FTC / Omnitrition Safe Harbor Compliant" legal conclusion, the whole "Statutory Defensibility Posture" grading ("5/5 PASS", "SAFE", "LOW RISK", "FTC-COMPLIANT", "Statutory Defensibility Grade AAA-STATUTORY", invented thresholds ≥ 50 % / ≤ 30 % / > 8 % with "buffer" figures), "MUTUAL IMMUTABILITY CERTIFIED". The KPI set itself (net sales, commission paid, payout share, retail share, active earners) is allowed; no projections are drawn (good). The "+312 Net Active Earners" delta uses a `person_add` (recruiting) icon: show the delta only if the API returns it, without that icon. Chart has no "View as table" toggle (required).

#### sc_37_distributor_home — SC-37
- **Layout:** P1. Identity strip (position, market, rank chip, cycle) → net settled earnings hero (status chip, amount `display`, settlement meta, bank last 4, primary button "View Statement & Audit Breakdown") → "Activity & Volume Snapshot" 2×2 tiles → notices (plan transition notice, bank verified) → three module link cards (Rank, Customers, Team) → disclosure card.
- **Interactive:** bell, avatar, primary statement link, notice link, module cards (all `<a>`); no `<button>`. Inline JS sets the active nav item.
- **Responsive:** none (phone only).
- **Must not implement:** "Direct Active Legs — 4 Qualified" tile (downline/leg count on home), the snapshot block as a whole (spec: no targets dashboard on home; only net pay, payout status, rank chip, alerts), "maintenance counters on target" and "55% max leg rule compliant" wording on the Rank card, "84% repeat order rate". "Customer Volume 384,200 Across 4 Frontline Legs" is mislabelled GV. The footer link "Annual Statutory Earnings Disclosure (Form R5)" renders only when a disclosure is published (V1, BR-HON-02).
- **Deviation:** bottom nav Team instead of More.

#### sc_39_vendor_operations_console — SC-39
- **Layout:** S8 (tenant staff shell with tenant sidebar; wrong for the vendor realm). Security boundary banner → header + action cluster → search/filter strip → 4 fleet KPI cards → 8/4: tenant filter tabs + tenant table (7 cols) + pagination + SVG ingestion sparkline | support-session request form (target tenant, scope select, duration segmented, justification `textarea`, attestation checkboxes, notification advisory, submit).
- **Interactive:** Audit Specs, Global Market Packs, Fleet Diagnostics (SC-47), Provision Tenant Org, Sync Fleet State, tier tabs, Open Console / Request Session per row, Previous/Next, duration buttons, Submit Request to Tenant Admin. Only form in the set (`<form>`, 7 labels).
- **Responsive:** `sm:grid-cols-2 lg:grid-cols-4`, `xl:grid-cols-12`.
- **Deviations:** must use the vendor console navigation (Tenants · Support sessions · Vendor users · Audit log from `features/admin/vendor/console-nav.tsx`), never the tenant sidebar; header shows tenant "Acrobex Global" (vendor realm has no tenant). Fleet telemetry KPIs and fleet diagnostics have no API; "Global Market Packs" matches the spec secondary "maintain market packs" but has no API yet (market pack is only a field on tenant markets).
- **Must not implement:** session scope options "Ledger State Verification (Dual Officer Key Req)" and "Pipeline Worker Configuration Override (High Risk)" (support sessions are read-only; scope/duration come from `GET /v1/support-sessions/limits`), the "FIPS 140-3 Hardware Key" attestation checkbox (step-up is TOTP), "ZERO STANDING ACCESS AUDITED (SOC 2 TYPE II / ISO 27001)" and "POLICY ENGINE: ENFORCING" claims.

#### sc_42_simulation_results_golden_datasets — SC-42
- **Layout:** S5. Sandbox banner → header + actions → 4 KPI cards → 65/35: tabs (Payee Impact & Bonus Variance, Bonus Mechanism Comparison, Golden Dataset Regression Suite (16), Cap & Pool Distribution Histogram) + 5-bucket histogram + SVG spread sparkline + filter controls + payee comparison table (7 cols) + pagination | payee variance inspector (shift overview, bonus line shifts) + golden test suite panel.
- **Interactive:** Export Simulation Delta, Run New Period Simulation (primary), tabs, selects, filter, row visibility icons (6 icon-only, none labelled), pagination, Open Complete Calculation DAG Trace, Attach Simulation to Change Docket (SC-44), Download Verification Dossier.
- **Responsive:** `sm:grid-cols-2`, `md:grid-cols-5`, `lg:grid-cols-4/12`.
- **Gap:** "Add golden case" (spec secondary) not drawn.

#### sc_44_plan_change_governance_workflow — SC-44
- **Layout:** S5. Statutory banner → header + actions → 4 KPI cards → 65/35: 6-step stepper (completed, active, notice window, locked) + filing checklist table per market (US, UK, Canada, Malaysia) + title transition matrix (title mapping, streak counters, volume carry) | dual authorisation sign-off block (3 actors), cutover rule card, filing upload widget → sticky SOD approval bar → hidden blocking modal "Invariant Gate Enforcement".
- **Interactive:** Download Plan Change Docket, Schedule Activation (Requires Dual Sign-Off) (primary), Add Market Addendum, Upload Ack, TRANSITION_SPEC.JSON, Request Urgent Sign-off (Escalate), Inspect Engine Replay Boundary Tests, Commit Document to SC-30 Audit Log, Export Audit Bundle, disabled "Awaiting Final Sign-Off (Locked)", modal close and "Understood, Return to Dossier".
- **Responsive:** `sm:grid-cols-2`, `md:grid-cols-3`, `lg:grid-cols-4/12`.
- **Notes:** "Streak Counters" here are plan transition rules (rank-maintenance carry-over), a legitimate plan concept on a staff screen, not gamification. Modal has no `role="dialog"`.

#### sc_47_licence_updates_diagnostics_for_self_hosted_edition — SC-47
- **Layout:** S5. Breadcrumb → header + two-person readiness actions → non-expiring-run banner → 4 KPI cards (licence, engine version, diagnostics, backup/restore) → 8/4: tabs (Signed Engine & Market Pack Updates, System Health & Node Diagnostics, Offline Cryptographic Licence Details, Automated Backup & Restore Attestation) + update package box (signature verification, advisory, 3 pre-activation checks, dual-approval callout) + diagnostics table | redacted support-bundle generator (redaction status, export buttons) + licence certificate card (payee capacity meter).
- **Interactive:** Generate Redacted Support Bundle, Apply Signed Engine Update (Dual Sign-Off), tabs, Run Instant Check, Preview Redacted Manifest, Export Sealed Diagnostic Bundle, View Release Notes & Diff, Provide Second Admin Step-Up & Activate.
- **Responsive:** `sm:flex-row`, `md:grid-cols-2/3`, `lg:grid-cols-12`, `xl:grid-cols-4`.
- **Gap:** "Load licence" (spec secondary) not drawn.


### 3.2 Batch 2 (10 files added 2026-11-12 08:20)

All ten share the S1 staff shell, P1 portal shell or C1 card/document layout, the same theme and the same Google Fonts / Play CDN dependencies; staff files hot-link the S1 header logo.

#### sc_23_earnings_disclosure_builder — SC-23 (V1)
- **Layout:** S1. Status/invariant ribbon → header + action cluster → bound data source and population bento (source metadata, total population, earners split with bar, medians and averages) → percentile bracket table (7 cols: tier, count, % of earners, annual gross range, avg active tenor, median, audit status) with summary row → split: public page preview card (SC-40 card) | statutory wording and legal attestation (non-editable disclaimer, checkboxes) → hidden compare modal "2025 vs 2026" → toast.
- **Interactive:** Compare with 2025, Export Audit Manifest, Preview Public Page (SC-40), Publish Disclosure Document (Dual Sign-Off) (primary), Bracket Boundaries, Recalculate Bounds, Dispatch Signature Reminder, modal close. 3 labels; inline JS for modal/toast.
- **Responsive:** `md:grid-cols-2/3`, `lg:grid-cols-12`.
- **Must not implement:** "Avg Active Tenor" column (time-in-business per tier reads as time-to-earn); auditor attestation ("Ernst & Young"), "Verified against US GAAP ASC-606" claims unless they come from the snapshot record; "hardware FIDO2 key or corporate SSO certificate" signature wording (step-up is TOTP); "Download Embedded SVG Snippet" (no API). The zero-earner count is drawn separately (keep: spec requires the zero band). Sample inconsistency to ignore: "Annual Median (All Active)" $482.50 is the earners-only median (sc_40 shows $240.00 for all participants).

#### sc_26_figure_drill_down — SC-26 (A)
- **Layout:** S1. Audit-trail sub-header → header + actions → formula card (numerator / denominator expression, metric micro-cards) + SVG donut gauge with a 70 % threshold marker → `xl:grid-cols-12`: tab bar (Numerator: End-Customer Orders, Internal Consumption Exclusions, Refund Reversals) + aggregate summary strip + dense table (10 cols: order fact id, credited UTC, masked buyer, buyer class, purpose tag, gross, clawback, net volume, classification rule, inspect) + pagination (first/prev/next/last) | docked method & provenance inspector (statutory authority box).
- **Interactive:** copy hash, Method Specs (toggles inspector), Filter Cohort, Compare Period, Export Dataset (Audit #…) (primary, logged), tabs, column chooser and search icon buttons, first/prev/next/last (15 icon-only buttons, 11 titled), filter input, select.
- **Responsive:** `sm:grid-cols-4`, `md:flex-row`, `lg:w-80`, `xl:grid-cols-12`, `xl:w-96`.
- **Deviations:** first/last page jumps (cursor pagination only); threshold marker at 70 % is invented (thresholds only from settings); "Compare Period", "Filter Cohort", column chooser have no API.
- **Route before the Stitch re-skin (historical; current status in §2):** `/compliance/snapshots/[id]/rows?figure=&set=` already has numerator/denominator sets, sums line with success/danger banner and logged CSV export.

#### sc_29_tenant_settings — SC-29 (B, part A)
- **Layout:** S1. Sticky sub-header with SOD warning → actions → guardrail banner → bento: 1. money policies (rounding mode, clawback recovery method, write-off threshold with tier-2 escalation, minimum payout, bank-change cooling-off) (8 cols) | 2. privacy and visibility (downline depth masking mini-chart, prospect data ownership, retention timers) (4 cols) → 3. breach contacts and DPO runbook cards → versions table (7 cols) → diff inspector drawer (`fixed inset-y-0 right-0 md:w-[540px] lg:w-[600px]`) → two modals: "Initiate Policy Rollback", "Draft SET-v2026.5" (effective date, reason textarea).
- **Interactive:** View Version History Drawer, Revert to SET-v2026.3, Save New Version with Effective Date (primary), View Diff, drawer close, Cancel, Submit for Approval, Commit to Approval Pipeline; select, textarea, text input (4 labels). 10 `onclick` attributes.
- **Responsive:** `md:grid-cols-2`, `lg:grid-cols-12`, drawer `md:w-[540px] lg:w-[600px]`.
- **Must not implement / no API:** "Prospect Data Ownership — pre-enrolled prospect leads belong to the recruiting distributor" (lead-ownership policy is not a product setting); retention timers (V1); "Revert" (not in spec: changes are new versions with an effective date). Only keys the API exposes (`GET/PUT /v1/settings/:key`: compliance thresholds, `privacy.breach_contacts`) are rendered today.

#### sc_36_global_search_command_palette — SC-36 (B)
- **Layout:** S1 with the palette as page content: command header and scope bar (Esc, ⌘K) → master search input → filter tokens (All, Participants, Positions, Orders, Statements, Cases, Postings with counts) → 8/4: grouped results (participants and positions, orders, cases, statements; masked SSN/tax ids) | focused entity fact sheet (identity, positions owned, paid-as rank, YTD earnings, holds, 6-month sparkline, deep-link actions to SC-09/07/18/06) → shortcut hints.
- **Interactive:** search input, type tokens, result rows, Open Deep Fact Record ↵, View Tree in Genealogy, Open Most Recent Statement, Create Support / Exception Case.
- **Responsive:** `lg:grid-cols-12`, `xl:col-span-4/8`.
- **Deviations:** drawn as a full page; spec = command palette overlay (full-screen on phone, centred on desktop). Staff record "Elena Rostova" appears in participant results (staff users are not search results in UI_UX §4.8). "+14.2% YoY" delta only if the API returns it.

#### sc_38_distributor_notifications_profile — SC-38 (B)
- **Layout:** P1 (header title wrongly "Distributor Home"). Notification header + live security banner → segmented control (Security & Alerts (3), Delivery Channels, Preferences) → view 1: inbox cards (cooling-off hold with release date, statement ready, dispute updated with SLA, disclosure published) with filter bar → view 2: channel toggles (email verified, SMS mandatory locked, statement/payout dispatch toggles) + policy notice → view 3: profile summary (initials avatar), language radio list, currency/date locale, session info.
- **Interactive:** Mark all read, segmented control (with `aria-selected` in JS), toggles (`peer` switch pattern, 6 labelled inputs), radios, Verify Identity, Open Statement, Download PDF.
- **Responsive:** none (phone only).
- **Notes:** canonical **Switch** pattern (immediate settings only). Mandatory channels (security, bank change, plan change) shown locked, as required. "Release Date … 14 calendar days" comes from the payout hold API. Bottom nav ends with Team, not More.

#### sc_40_public_earnings_disclosure_page — SC-40 (V1)
- **Layout:** C1 document. Shell header with claims → attestation and hash ribbon → "honest reality" box → key metrics grid (total participants, earned non-zero, earned zero, medians) with 53.9/46.1 % bar → percentile distribution table (6 tiers, rank labels, % all, % earners, annual range, median, **avg. time to reach**) → disclosures and footnotes (independent contractor, expenses, buyback, prohibited claims) → links and download bar → audit footprint.
- **Interactive:** Copy Verification Data, Download Certified PDF Report (fake spinner in JS), external links.
- **Responsive:** `sm:grid-cols-2`, `md:grid-cols-2/3`, `sm:px-gutter`.
- **Must not implement:** "Avg. Time to Reach" column (implies attainable earnings over time; spec = bands with count and share incl. zero band, basis statement, population definition, version and date); rank/tier labels in the band table unless the published disclosure defines them; footnote "Earnings shown reflect gross amounts paid … **and estimated retail markup**" (an estimate inside the earnings figures: figures are amounts actually paid from the snapshot); certification and legal-conclusion claims ("FTC 16 CFR §437 Compliant", SOC-2/FIPS, "SEC Form 10-K", auditor seal) unless part of the published disclosure; sample legal copy ("90% Buyback Protection Guarantee", expense amounts, prohibited-claims text) unless it is the published disclosure text; "Download Certified PDF" and "Copy Verification Data" (no API). No call to action to join is drawn (good).

#### sc_41_public_privacy_request_form — SC-41 (B)
- **Layout:** C1. Compliance ribbon → title + context → SLA tracker micro-bar → step 1 request type (4 radio cards: access, erasure, rectification, opt-out) → step 2 identity (full name, email, relationship select, optional ID, residence select with SLA badge) → step 3 retention notice + affirmation checkbox → hidden confirmation box (reference number, "6-digit code dispatched … 15 minutes") → actions (Back to Home, Submit Privacy Request & Send Code) → footprint. The only `<form>` besides sc_39 (10 labels, 5 `label[for]`).
- **Interactive:** radio cards (`onclick`), inputs, selects, checkbox, submit. Inline JS updates the SLA badge per region.
- **Responsive:** `sm:grid-cols-2`, `sm:order-1/2`, `sm:p-space-xl`.
- **Deviations:** email-code verification step and "assigned DPO" name are not in the spec (confirmation shows the reference number only and never confirms that a person exists); "under penalty of perjury" and SLA texts are sample legal copy (market-pack content). Bot protection is server-side; no CAPTCHA widget.

#### sc_43_rank_and_qualification_detail_staff — SC-43 (B)
- **Layout:** S1. Breadcrumb + actions bar → header summary + status badge strip → 5 metric cards (PV, GV, qualified direct legs, retail customer count, max-leg rule) → multi-period qualification matrix (12 cols: period, committed run id, paid-as, title held, PV, GV, leg 1 capped, leg 2, leg 3+, carry balance, streak, outcome) with a dispute showcase row → carry-forward and banked volume card with left/right leg bars → audit record.
- **Interactive:** Compare Periods, Audit Trace (SC-02), Open Sponsor Tree (SC-07), Export CSV, View Spec; 4 `onclick` attributes.
- **Responsive:** `md:grid-cols-2/3`, `lg:grid-cols-3`, `xl:grid-cols-5`.
- **Notes:** staff-only screen; leg counts and streak counters are qualification facts here (allowed for staff, never on distributor pages). "Export CSV" has no API yet. The four header/footer actions are `alert()` stubs. "FTC Invariant Met" on the retail-customer card is a legal-conclusion label (show met / not met against the plan requirement).

#### sc_45_integrity_signals — SC-45 (V1)
- **Layout:** S1. Non-dismissible compliance banner → header + actions → 4 indicator cards (period-end threshold surges, post-qualification returns, shared fingerprint clusters, autoship saturation) → filter ribbon (All, Critical Only, Unreviewed, In Case; risk rule; period) → 8/4: signals table (8 cols incl. confidence %) + footer | evidence inspector (indicator-only disclaimer, 72 h volume SVG, metric evidence incl. device/IP telemetry, actions) + "Active Tenant Threshold Bounds" panel (3 thresholds with "Edit Bound" buttons, dual-authorisation note).
- **Interactive:** Export Signals Report, Configure Thresholds, Open Investigation Case (SC-06) (primary), filter buttons, row Create Case / View Case / Freeze Payouts / Review, pagination, Route to Case Framework, Place Hold on Payout, Dismiss Indicator.
- **Responsive:** `md:grid-cols-2/3`, `xl:grid-cols-4/12`.
- **Must not implement:** "Freeze Payouts" / "Place Hold on Payout" from a signal and "Clawback Auto-Draft: ON" (spec: an indicator is not a finding; actions are Open case and Set thresholds; holds and clawbacks go through cases); "Confidence %" unless the API defines it; raw IP address / user-agent evidence (no data source; personal data shown only if the API returns it masked).

#### sc_46_compliance_overview_overlay_home — SC-46 (A)
- **Layout:** S1. Command/action bar → active threshold-exception alert (Inspect Exceptions, Acknowledge) → five figure cards R1–R5 (value, delta, benchmark line, sub-metrics) → 8/4: 12-month retail vs personal share SVG trend with reference lines | data coverage and freshness panel (order reconciliation, unmapped codes, freshness, seal) → recorded snapshots table (8 cols) + pagination → two-person sign-off ribbon.
- **Interactive:** Export Summary (Logged), Data Imports & Coverage (SC-24), Open Full Reports (SC-10), Create Snapshot (primary), Inspect Exceptions, Acknowledge, Force Ledger Reconciliation Run, row icon buttons (10, all titled), pagination, Affirm & Countersign.
- **Responsive:** `sm:block`, `md:grid-cols-2`, `lg:grid-cols-3/12`, `xl:grid-cols-5`.
- **Must not implement:** legal-conclusion labels ("Compliant", "In Bounds", "Low Risk", "FTC Standard", "FTC BENCHMARK", "All 12 recorded periods satisfy Section 46 and DSA Code of Ethics"), the R5 label "Median Annual Return" (investment framing; use the glossary term for median annual earnings), decorative `linearGradient` chart fill, invented benchmark lines (≥ 51 %, ≤ 33.3 %, ≤ 5 %, "50% Invariant") unless configured as tenant thresholds; "Acknowledge", "Force Ledger Reconciliation Run", "Affirm & Countersign", "Export Summary" (no API). "Fast Start: 7.2%" in R3 is sample data.
- **Route before the Stitch re-skin (historical; current status in §2):** `/compliance` (ComplianceOverview) shows the newest ready/outdated snapshot per market with headline figures and a data status panel; no trend chart, no snapshots table on the page.

## 4. BR-HON-01 / refusal-list summary (must not implement, even though drawn)

| File | Content | Rule |
|---|---|---|
| sc_37 | "Direct Active Legs — 4 Qualified"; "Activity & Volume Snapshot" targets block | BR-HON-01 (recruit/leg counts), UI_UX §4.4 "Home has no targets dashboard" |
| sc_20 | "Level 2 Key Builders (Verified)"; "Active Builders" per leg; "Total Network" headline; portraits | BR-HON-01 (recruit counts as rankings), UI_UX §0 (no imagery) |
| sc_19 | "8 consecutive cycles" streak; "% of Target" progress framing; named leg contributions | UI_UX §0 (no gamification), SC-19 key content |
| sc_21 | "+3 this cycle"; "Target: >70% (FTC)"; "Share Store Link"; per-customer "Direct Profit" | BR-HON-01, UI_UX §0, no API |
| sc_18, sc_02 | enrolment-driven bonus sample lines ("new qualified personal enrollee cohorts", "428 enrollments") | BR-HON-01 (sample only; names come from API) |
| sc_04 | "Projected Payout Total" wording | Glossary; projection wording reserved-out (staff simulation total is allowed as "Simulated") |
| sc_25 | "Live projection of statutory ratio thresholds"; 70% target marker | no API; invented threshold |
| sc_10, sc_35 | legal-conclusion badges and "safe harbor compliant"/"OPTIMAL" grading | the product reports figures and methods, it does not certify legality |
| sc_35 | decorative photos | UI_UX §0 (no imagery) |
| sc_40, sc_23 | "Avg. Time to Reach" / "Avg Active Tenor" per earnings tier | BR-HON-01 (implies attainable earnings over time); SC-40 spec content |
| sc_29 | "Prospect Data Ownership" (leads belong to the recruiting distributor) | not a product setting; recruiting/CRM content |
| sc_45 | "Freeze Payouts" / "Place Hold on Payout" from an indicator; "Confidence %" | SC-45 spec: indicator is not a finding; actions go through cases |
| sc_46, sc_26 | "Compliant" / "FTC BENCHMARK" labels, invented benchmark lines (≥51 %, ≤33.3 %, 70 % marker) | the product reports figures and methods; thresholds only from tenant settings |
| sc_40, sc_41, sc_23 | auditor seals, SOC-2/FIPS claims, "under penalty of perjury" copy, named DPO | no data source; legal copy belongs to market packs / published disclosures |
| sc_27, all S-shells | certification claims, "STATUTORY AUDIT LOCK ACTIVE", "FTC/SEC INVARIANTS: ENFORCED" | no data source |
| 25 files | `animate-ping` / `animate-pulse` dots; sc_02-modal and sc_03 countdowns | UI_UX §0 (no urgency styling; only the support-session countdown) |
| sc_20 | "Downline Nodes n Positions" per leg; "Qualified for Tier 4 Bonus" | BR-HON-01 (head counts), no qualification prompts on participant pages |
| sc_21, sc_22 | "FTC Validated", "BR-HON-01 Compliant", "SOC-2 Type II Certified" badges on participant pages | no data source; legal conclusions |
| sc_35 | "Statutory Defensibility Grade AAA-STATUTORY", "FTC-COMPLIANT", PASS/SAFE/LOW RISK grading with invented thresholds; `person_add` on the active-earner delta | the product reports figures and methods; thresholds only from tenant settings |
| sc_40 | "estimated retail markup" included in the disclosed earnings figures | BR-HON-01/02: disclosed figures are amounts actually paid, no estimates |
| sc_45 | "Clawback Auto-Draft: ON"; IP/user-agent evidence | indicator is not a finding; no data source |
| sc_39 | write-capable support-session scopes; FIPS hardware-key attestation | support sessions are read-only; step-up is TOTP |
| 7 files | `bg-gradient-*` / SVG `linearGradient` (sc_02, 02-modal, 07, 12, 13, 27, 46) | UI_UX: no gradients on work screens |

No file draws an income projection widget, earnings calculator, "earn up to" copy, next-rank prompt or the word "wallet" (the `account_balance_wallet` icon appears; "Hyperwallet" is a provider name). The closest items are the time-to-reach / tenor columns in sc_40 and sc_23, the "estimated retail markup" in the sc_40 figures, and sc_20's volume-ranked "Level 2 Key Builders" list (a downline leaderboard in all but name; listed above). Staff-only "Top 5 Sample Outliers" (sc_04), "Top Payee Movers" (sc_02) and "Top Curtailed Payees" (sc_05) are audit samples, not leaderboards, and stay staff-only.
