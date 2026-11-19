# Engineering manager memory

## B1 records step (2026-11-17)
- Updated TRACEABILITY (8 FRs; CAS = I T only), DEVELOPMENT_PROGRESS (B1 rows per module), IMPLEMENTATION_TASKS (T-B1-00..18), STITCH_DESIGN_INVENTORY (SC-13/17/29 verified notes, SC-06/08 deferred), RELEASE_NOTES, MASTER_PROJECT_MEMORY (B1 section), wrote increments/B1/HANDOFF.md.
- Security fixes for the B1 review (0109, api-keys scope, TRUST_PROXY, limiter) appeared in the tree at 04:45–04:48 with tests, but no fix report reached the records step: recorded as "in tree, unconfirmed" (SEC-B1-1..4), not registered in BUG_REGISTER (security owns it).
- Full run on nmp_test_6: 123/124 files; role-matrix beforeAll hit 10 s hook timeout under load (alone 31/31). Count per module by grepping the vitest log `(N tests)` lines.
- Migration levels are in table `schema_migration` (not schema_migrations).

## B2 records step (2026-11-17)
- Updated TRACEABILITY (22 FRs I T V, GEN-009 I T; B2 note on V limits), DEVELOPMENT_PROGRESS (8 B2 rows), IMPLEMENTATION_TASKS (T-B2-00..17; closed T-B1-11..17), STITCH_DESIGN_INVENTORY (9 rows verified with harness %), RELEASE_NOTES, MASTER_PROJECT_MEMORY, ADL E-ADR-39 (PLAN §0 says records copies D-B2), wrote increments/B2/HANDOFF.md.
- Full run nmp_test_4 reset to 0208: 148 files, 2739 tests, all green; typecheck clean (log var/b2-records-vitest.log). Per-module counts: awk over `✓ <file> (N tests)` lines.
- Truncated agent summaries: read the agents' memory files (backend MEMORY "B2 review round 3" showed the security fixes; 0208 existed but no DB report mentioned it). Security findings recorded as SEC-B2-1..5 "fix in tree, unconfirmed" (security registers them).

## B3 records step (2026-11-18)
- Updated TRACEABILITY (19 B3 FRs I T V, PLN-002/COMP-004 partial per PLAN §8; FR-CAS-001 + all 18 Release A rows I T V per PLAN §B), DEVELOPMENT_PROGRESS (7 B3 rows), IMPLEMENTATION_TASKS (TK-B3-00..18: PLAN uses T-B3-nn for TEST ids; closed T-B2-11..15), STITCH_DESIGN_INVENTORY (8 B3 rows verified with harness %, SC-06/07/09 touches), RELEASE_NOTES, MASTER_PROJECT_MEMORY, BUG_REGISTER (SEC-B2-1..5 registered, BUG-081..083 fixed in code, OPEN-ENG-01 partly resolved), SPIKE_REPORT §6 (S-1/S-2 numbers), wrote increments/B3/HANDOFF.md.
- Full run nmp_test_4 reset to 0306: 173 files, 3303 tests, all green; typecheck clean (logs var/b3-records-*.log). Module counts: awk over `✓ <file> (N tests)`.
- PLAN §B/§S assign extra records-phase duties (bug registration, Release A rows, SPIKE_REPORT §6): read PLAN for "records phase" before starting.
- Truncated agent summaries: backend MEMORY sections "State after B3 BE1/BE2", "backend-lead integration", "security review fixes"; frontend MEMORY B3 sections; QA reports in testing/. Security fixes recorded as SEC-B3-1..8 "fix in tree, not re-reviewed" in HANDOFF only (security registers).
- nmp_test carries a foreign row 0250_firebase_identity.sql (applied 2026-11-18 00:12, file not in repo): flagged, not touched.

## B4 records step (2026-11-19)
- Updated TRACEABILITY (14 B4 FRs I T V + B4 note with V limits), DEVELOPMENT_PROGRESS (8 B4 rows, replaced "FIN/TAX/PAY Not Started"), IMPLEMENTATION_TASKS (TK-B4-00..17; closed/updated T-B2-16, TK-B3-11..17), STITCH_DESIGN_INVENTORY (SC-03/09/13/17/28/33/34 verified with round-2 harness %, B4 notes on SC-01/02/06/29), RELEASE_NOTES, MASTER_PROJECT_MEMORY, BUG_REGISTER (BUG-090..098 fixed in code; SEC-B3-1/2 verified; SEC-B4-1..7 registered), ADL (E-ADR-47, E-ADR-36 superseded), wrote increments/B4/HANDOFF.md.
- Full run nmp_test_4 reset to 0412: 198 files, 3857 tests, all green (123 s); typecheck clean (logs var/b4-records-*.log).
- Facts behind truncated summaries: backend MEMORY "B4 …" sections (incl. "B4 security review fixes" = 0412 + SEC fixes), frontend MEMORY "B4 …", security MEMORY "B4 adversarial review", UI_TESTING_REPORT "Increment B4 — round 2". Migration numbers can have gaps (0408/0410 unused); list the dir, do not assume contiguous.
