# compensation — OPEN_ISSUES

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## T-A10 (2026-11-12)
- R5 assumes 100 minor units per currency unit (constant `MINOR_PER_UNIT` in r5.ts); needs a per-market exponent before a 0- or 3-decimal currency is onboarded.
- R5 band boundaries and percentile set are still the prototype's (OQ-A7); `METHOD_VERSION` value and versioning policy are my choice (OQ-A5); refund attribution follows the prototype (OQ-A12).
- A late order crossing two thresholds counts twice in `late_threshold_crossing_orders` but appears once in the drill ids (numeratorCount = distinct orders). TS-34 "sums equal components" for that figure should compare against crossings, not distinct orders, or the API should expose crossings as rows.
- Drill ids are capped at 1000 by default; the API drill-down (API-06) must pass a larger `drillIdCap` or re-query facts for full pagination/export.
- `refundMonth` and `bonusType` are carried on the fact types but not used by any current formula.

## T-A10 review fixes (2026-11-12)
- MVP_A_SPEC section 5 R4 still says "sorted by day (stable)"; the spec owner should record the (day, orderRef) tie-break as a resolved deviation (file is outside packages/compliance, not edited). If file order is wanted instead, the order fact needs a source row sequence column and an `orderSeq` field, plus a METHOD_VERSION bump.
- If figures are persisted before release, decide whether a method-text-only change requires a METHOD_VERSION bump (OQ-A5).
