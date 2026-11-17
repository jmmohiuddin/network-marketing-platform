# Development Progress

Statuses: Not Started · Planning · In Progress · Blocked · Implemented · Testing · Failed · Ready for Review · Completed. Completed only after tests and browser verification pass.

B1 figures (2026-11-17): unit/integration = test counts of each module in the records-step full run on nmp_test_6 (124 files, 2150 passed, 31 skipped: role-matrix beforeAll timed out under load, passes alone 31/31). Details `increments/B1/HANDOFF.md`.

B2 figures (2026-11-17): records-step full run on nmp_test_4 (reset to 0208): 148 files, 2739 tests passed, 0 failed, 0 skipped; api + web typecheck clean. Unit column = test count of that module in this run (isolation 956 and role-matrix 31+11 cover every B2 route). Details `increments/B2/HANDOFF.md`.

| Module | Rel | Agent | Status | Backend | Frontend | DB | Unit | Integration | Playwright | Review | Open defects | % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| db/RLS | A | database | Implemented | n/a | n/a | done | 76 pass | 76 pass | - | reviewed+fixed | 0 | 70 |
| IAM | A | backend | Implemented | done | built | done | pass | pass | - | reviewed+fixed | BUG-006, BUG-007 | 80 |
| AUD | A | backend | Implemented | done | - | done | pass | pass | - | reviewed+fixed | 0 | 75 |
| TEN/OPS | A | backend | Implemented | done | - | done | pass | pass | - | reviewed+fixed | 0 | 75 |
| IMP | A | backend | Implemented | done | - | done | pass | pass | - | reviewed+fixed | 0 | 75 |
| CPL reports | A | compensation | Implemented | done | - | done | pass | pass | - | reviewed+fixed | 0 | 75 |
| PRV-004 | A | backend | Implemented | done | - | done | pass | pass | - | reviewed+fixed | 0 | 75 |
| Web (A screens, Stitch) | A | frontend | Completed | - | Stitch re-skin done | - | 251 pass | - | W1–W10 + visual 4 viewports pass (round 3) | reviewed+Impeccable | 0 (BUG-023,025–029,045–048 verified fixed in B1 round 1) | 100 |
| B1 db/RLS (0100–0109, SoD primitive, seed) | B1 | database | Ready for Review | n/a | n/a | done | packages/db 137 pass | pass | - | reviewed+fixed (0108); 0109 from security fixes | 0109 not applied to dev/e2e/test | 90 |
| B1 TEN (markets, brands, calendars, settings timeline, checklist, go-live) | B1 | backend BE2 | Ready for Review | done | built | done | 72 pass | pass | W-B1-1..3 pass (round 2) | reviewed; SEC-B1-2 fix unconfirmed | 0 bugs open | 90 |
| B1 PAY (provider eligibility only) | B1 | backend BE2 | Implemented | done | built (SC-17 dialog) | done | 4 pass | pass | W-B1-3 pass | reviewed | 0 | 30 (FR-PAY-006 rest in B4) |
| B1 IAM (SoD, service accounts, API keys) | B1 | backend BE1 | Ready for Review | done | built | done | 116 pass | pass | W-B1-2..4 pass | reviewed; SEC-B1-1/3/4 fixes in tree, unconfirmed | 0 bugs open | 90 |
| B1 INT (public API, OpenAPI, webhooks, outbox dispatch) | B1 | backend BE1 | Ready for Review | done | built | done | 102 pass | pass | W-B1-4..5 pass | reviewed | 0 | 90 |
| B1 CPL pack rules (basis status) | B1 | backend BE1 | Ready for Review | done | built (SC-17) | done | 53 pass | pass | W-B1-3 pass | reviewed | 0 | 90 |
| B1 AUD evidence documents | B1 | backend BE3 | Ready for Review | done | built (SC-17 upload) | done | 21 pass | pass | W-B1-3 pass | reviewed+fixed (0108) | 0 | 90 |
| B1 CAS framework (mounted in B2, see B2 CAS row) | B1 | backend BE3 | Implemented | done | - (SC-06/08 in B2) | done | 24 pass | pass | - | reviewed+fixed (0108) | 0 | 40 (types + UI in B2+) |
| B1 Web (SC-29 B, Markets, SC-17, SC-13, MVP-A polish) | B1 | frontend W1/W2 | Completed | - | Stitch | - | apps/web 351 pass | - | rounds 1–2, 4 viewports pass; Impeccable 14/16 | reviewed | LOW: BUG-060 | 95 |
| B2 db/RLS (0200–0208: participants, bitemporal genealogy + guard trigger, path model, servicing, orders/events/late, connectors, G1–G5/C1/C3/P2 SQL contracts) | B2 | database | Ready for Review | n/a | n/a | done | packages/db 181 pass | pass | - | reviewed; 10 findings fixed (0207); security round 3 fix 0208 | 0207/0208 not on nmp_dev/e2e (at 0207) or nmp_test (at 0109) | 90 |
| B2 PAR (types with SoD, participants, enrolment, duplicates, agreements) | B2 | backend BE1 | Ready for Review | done | built | done | 39 pass | pass | W-B2-1..3, 6 pass | reviewed+fixed (3 rounds); SEC-B2-1, -5 partly fixed in tree, unconfirmed | 0 bugs open | 90 |
| B2 GEN (positions, relationships, as-of/known-at, cases change/correction/transfer, visibility, read model + rebuild job) | B2 | backend BE2 | Ready for Review | done | built | done | 44 pass | pass | W-B2-4..6, 9 pass | reviewed+fixed (2 rounds); PLAN §2.4/§2.5 deviations await architect sign-off | 0 bugs open | 90 |
| B2 CRM (servicing, reassignment on termination) | B2 | backend BE1 | Ready for Review | done | built | done | 8 pass | pass | W-B2-7, 9 pass | reviewed+fixed; SEC-B2-3 fix in tree (0208, ord attribution), unconfirmed | 0 bugs open | 90 |
| B2 ORD (ingestion API, events, volumes, attribution, late queue) | B2 | backend BE3 | Ready for Review | done | built | done | 45 pass | pass | W-B2-7, 8 pass | reviewed+fixed (2 rounds) | 0 bugs open | 90 |
| B2 INT (Shopify/WooCommerce inbound connectors, sync health) + IAM key scopes | B2 | backend BE3 | Ready for Review | done | built | done | int 121, iam 119 pass | pass | W-B2-7, 10 pass | reviewed+fixed; SEC-B2-2 fix in tree, unconfirmed | 0 bugs open | 90 |
| B2 CAS mounted (types genealogy_change, genealogy_correction, transfer, duplicate) | B2 | backend BE1/BE2 | Ready for Review | done | built | done | 30 pass | pass | W-B2-5, 6 pass | reviewed+fixed; SEC-B2-4 fix in tree, unconfirmed | 0 bugs open | 90 |
| B2 Web (People, SC-09, SC-07, SC-08, SC-06, SC-31, SC-32, SC-13 B2 tabs, SC-29 B2 part, SC-17 touch) | B2 | frontend W1/W2 | Completed | - | Stitch | - | apps/web 446 pass | - | rounds 1–2, 4 viewports pass; Impeccable 14/16 | reviewed | LOW: BUG-081, 082, 083 | 95 |
| PLN/COMP | B | - | Not Started | - | - | - | - | - | - | - | 0 | 0 |
| FIN/TAX/PAY | B | - | Not Started | - | - | - | - | - | - | - | 0 | 0 |
| DIST portal | B | - | Not Started | - | - | - | - | - | - | - | 0 | 0 |
| MIG/RPT | B | - | Not Started | - | - | - | - | - | - | - | 0 | 0 |
| B-MKT India pack | B-MKT | - | Not Started | - | - | - | - | - | - | - | 0 | 0 |
| V1 (19 FRs) | V1 | - | Not Started | - | - | - | - | - | - | - | 0 | 0 |
