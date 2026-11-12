# qa — TEST_RESULTS

_Agent: qa. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — packages/compliance
- vitest: 4 files, 98 tests pass. tsc clean. Golden compares every numeric figure of R1–R5 (values only, via parseFloat; not numerator/denominator, not population text).
- Fuzz vs prototype: 0 diffs in 47,556 figures. No float money arithmetic, no Date/random/locale found.

## 2026-11-12 — T-A07
- `pnpm vitest run apps/api/test`: 5 files, 372 tests pass (3 are test.fails for BUG-006/BUG-007, verified to fail on the defect assertion: 200 instead of 403/422). `tsc -p apps/api --noEmit` clean. Runtime about 2 s for both new files.
- Guards checked by mutation: removing a case -> coverage + per-route tests fail; a wrong matrix expectation -> every role's test fails.
