# Engineering manager memory

## B1 records step (2026-11-17)
- Updated TRACEABILITY (8 FRs; CAS = I T only), DEVELOPMENT_PROGRESS (B1 rows per module), IMPLEMENTATION_TASKS (T-B1-00..18), STITCH_DESIGN_INVENTORY (SC-13/17/29 verified notes, SC-06/08 deferred), RELEASE_NOTES, MASTER_PROJECT_MEMORY (B1 section), wrote increments/B1/HANDOFF.md.
- Security fixes for the B1 review (0109, api-keys scope, TRUST_PROXY, limiter) appeared in the tree at 04:45–04:48 with tests, but no fix report reached the records step: recorded as "in tree, unconfirmed" (SEC-B1-1..4), not registered in BUG_REGISTER (security owns it).
- Full run on nmp_test_6: 123/124 files; role-matrix beforeAll hit 10 s hook timeout under load (alone 31/31). Count per module by grepping the vitest log `(N tests)` lines.
- Migration levels are in table `schema_migration` (not schema_migrations).
