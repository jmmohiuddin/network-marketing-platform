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
