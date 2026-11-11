# compensation — COMPLETED_TASKS

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## T-A10 — @nmp/compliance pure reports (2026-11-12) — DONE
- src: types, percent, stats, figure, context, validate, r1..r5, index (812 lines, largest file 132).
- test: golden.test.ts (all R1–R4 months, R3 year, R5 vs report.json; fact-order independence), ts31.test.ts (all TS-31 checks), edge.test.ts (zero denominators, unset thresholds, missing day, unattributable lines, refunds, empty input, C-9b/C-11/C-16, drill cap, input errors), static.test.ts (no parseFloat / Number( / Math.round / toFixed / `/ 100` / Date / random / non-sibling imports in src).
- Result: 98 tests pass; typecheck clean. Nothing outside packages/compliance was modified.

## T-A10 review fixes — config resolution and R4 tie-break (2026-11-12) — DONE
- validate.ts: `resolveConfig` validates all four settings (bigint, non-negative volumes; flag = bigint fraction) and drops null/absent ones; context.ts stores the resolved config. `computeReports` now accepts `ComplianceConfigInput` (each setting `| null`).
- r4.ts: tie-break unchanged (day, orderRef); now stated in the `late_threshold_crossing_orders` method text.
- edge.test.ts: null settings = unset, 9 new rejected-config cases, same-day orders out of reference order. 109 tests pass; typecheck clean.

## T-A11 — CPL snapshots API (2026-11-12) — DONE
- migration 0030_cpl_snapshots.sql; src modules/cpl: snapshot-row, snapshots, inputs, compute, figures, drill, routes, index (+ test-fixtures).
- tests: snapshots.test.ts (13), drill.test.ts (8), golden.test.ts (15: all R1-R4 months, R3 year, R5 vs report.json, drill of flagged payees). packages/db suite still green (78 incl. boundaries).
- `tsc -p apps/api` clean for cpl; at hand-off it failed only in other agents' in-progress modules (imp earlier, ops/provisioning.ts now).

## T-A11-R1 — CPL review fixes (2026-11-12) — DONE
- Fixed: HIGH settings race (exact version), MEDIUM deadlock (lock order + test proven to fail without fix), export market scope, R2/R4/R5 drill measures + TS-34 test over every figure, range coverage, AC-40.1 mapping trigger; LOW fact guard, CSV negative numbers, stuck computing, INPUTS_CHANGING + computing->failed, IMP facades, response shape recorded (E-ADR-25, E-ADR-26).
- Files: migration 0031; cpl/{snapshot-row,snapshots,inputs,compute,measures(new),drill,routes,test-fixtures,states.test(new),concurrency.test(new),snapshots.test,drill.test}; outside CPL (additive): ten/{settings,index} getSettingsVersion; imp/{batches,load,index} lockLoads/tryLockLoads/batchDataQuality; lib/csv.ts + formats.test.ts; packages/db/test/seed.ts.
- Results: cpl 47/47, packages/db 76/76, apps/api 272/273 (1 failure in ops.test.ts, OPS files edited concurrently by another agent; nothing of mine touched).
