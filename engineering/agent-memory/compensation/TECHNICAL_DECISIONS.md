# compensation — TECHNICAL_DECISIONS

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## T-A10 (2026-11-12)
- Rounding: half up on magnitude (= Decimal ROUND_HALF_UP) in bigint; reproduces report.json exactly. `percent()` → "62.50" | null.
- R5 and R3-year are computed for **every calendar year present** in the data (no year setting needed). Lines filtered to the year; population = `canEarn` and `enrolledMonth <= YYYY-12`; `partial = true` when the year has < 12 distinct payout months (also set on the R3 year period).
- R5 statistics are exact rationals over minor units (percentile k = (n-1)·p/100 with integer index arithmetic), formatted to 2 dp currency units.
- C-9b: R1 participant orders = `!countsAsEndCustomer`; R4 distributors and R5 population = `canEarn`. In R4 a buyer that is neither earning nor an end customer is ignored.
- C-12: R2 lines with null/unknown source order → figures `unattributable_lines` and `unattributable_amount_cents`; excluded from rewarded volume; their amount **does** count in the payee's multi-level pay total (never as personal pay) for the flag test.
- R2 flag is an exact `Ratio`; test is `personal * den > num * total` (strict). Unset → `payees_above_flag` and `flag_threshold` listed in `omitted`.
- R4: active figures need `activePvMinor`; late figures need `lateOrderDay`, non-empty `rankThresholdsPvMinor` and a day on every order of the month; each missing piece omits only its own figures. Orders accumulate by (day, orderRef) so results do not depend on input order (prototype used file order; identical on the synthetic set).
- Drill-down: each figure has `drill { entity, numeratorIds, numeratorCount, denominatorIds, denominatorCount }`, ids distinct, sorted, capped (`options.drillIdCap`, default 1000); counts are uncapped. `flagged_payees_sample` = first 10 `payees_above_flag` numerator ids.
- Bad input (unknown buyer, duplicate refs, malformed month/day, zero flag denominator) throws `ComplianceInputError`; the importer is expected to prevent these.

## T-A10 review fixes (2026-11-12)
- A null setting is **unset** (omitted indicator), not an error and never 0; a malformed or negative setting throws `ComplianceInputError`. A null/negative value inside `rankThresholdsPvMinor` throws. Zero thresholds are accepted.
- R4 same-day tie-break stays (day, orderRef ascending): `cpl_fact_order` has no row sequence, so the prototype's file order cannot be reproduced. Deliberate deviation from the prototype; figures differ only when one buyer has several same-day orders whose ids are not in file order. `METHOD_VERSION` kept at cpl-method-1.0.0 (computation unchanged, nothing persisted yet; only the method text was clarified).
