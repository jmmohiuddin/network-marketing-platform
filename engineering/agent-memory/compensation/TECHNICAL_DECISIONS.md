# compensation — TECHNICAL_DECISIONS

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._

## B engine review fixes (2026-11-13)
- Purpose split is a line field (RawLine.purposeRaw) computed in pass 4-6 from per-purpose measures (pass 2), not from the trace: trace display limits never change money.
- Order attribution: source raw split over orders by their value in the measure (largestRemainder, ties order id asc); aggregate measures attributed in full traces only (bounded trace size).
- A limit binds when Σ roundRaw(line) exceeds it; bound totals: cap = roundRaw(base x rate), max_per_period = maxMinor, max_share = roundRaw(kept raw); then largestRemainder.
- Tree-walking primitives (percent_by_level, override, differential, generations) take volume.personal only; TS-43 pinned on a three-level personal tree (A 360).
- Points pools convert the pool total once (pass 6, 'points' step before 'allocation'); a points line with an allocation is an INVARIANT error in pass 10.
- inputsHash sorts snapshot rows (row order carries no meaning); plan arrays keep order. resultHash includes volume summaries ('V').

## B engine contracts (2026-11-13)
- Pass order = SDD-07 (C1). Pass 11: netting first, then withholding on gross - netted (FR-COMP-003 and MONEY 4.3 both put netting before withholding); gross = netted + withheld + netPayable; negative gross becomes receivable.
- Result-line grain: (payee position, rule) per run, plus one per adjustment origin; compact trace keeps <= TRACE_SOURCE_LIMIT (16) sources + omitted {count, raw}; RunOptions.fullTraceFor expands a line (FR-COMP-007).
- Matching base = pre-cap raw of the named pass-4 lines (spike choice; E2E identical either way).
- Pools and caps produce `allocatedMinor` via largestRemainder; pass 10 never re-rounds those.
- eligibleIf (RankRef, ">= rank") is both payee eligibility and the compression "active" predicate; payees also need ctx.earner (owner type canEarn, not terminated before the period).
- Customer fractional roll-up (BR-ATT-04) belongs to pass 1 (volume.ts), not pools.ts: it must precede GV and qualification.
- Fixture money as minor-unit strings; rates as decimal strings; instants as µs strings.


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

## T-A11 (2026-11-12)
- compliance_figure: `value_num` changed to unconstrained `numeric` (keeps '62.50' scale, no overflow); added period_kind, position, unit (NULL = omitted indicator, reason in note), population, method, method_version, partial, period_notes; unique key now (snapshot_id, report, period_kind, period, key) because R3 month and year can share a start date. Year period stored as YYYY-01-01. All new columns nullable/defaulted so the db seed still inserts.
- compliance_report_snapshot.failure_reason (CHECK only when failed); guard function replaced to allow it alongside state.
- Outdating is in the database: AFTER INSERT/UPDATE OF state triggers on import_batch (state into/out of 'loaded') mark computing/ready snapshots of that market outdated when `cpl_loaded_batch_ids(range)` differs from input_refs.batch_ids, and write audit SNAPSHOT.OUTDATED in the same transaction. `cpl_lock_inputs(tenant, market)` advisory lock is taken by the trigger and by snapshot creation so no load slips between reading inputs and committing a snapshot.
- Drill ids are NOT stored (would be rows x figures). Drill-down recomputes from the snapshot's recorded inputs (batch ids, settings version via getEffectiveSettings(created_at + 1 ms), METHOD_VERSION) with every id, and refuses with 409 SNAPSHOT_NOT_REPRODUCIBLE unless value/numerator/denominator equal the stored figure.
- Job only acts on state 'computing' (idempotent re-runs); ComplianceInputError / settings-or-method mismatch -> failed with reason; other errors throw for pg-boss retry. Ready writes outbox 'compliance.snapshot.ready'.
- population_count = drill denominatorCount when > 0, else numeratorCount.
- R5 refused (422 CURRENCY_NOT_SUPPORTED) for markets whose minor_unit != 2 (package assumes 100 minor units).
- Audit actions added: SNAPSHOT.CREATED, SNAPSHOT.READY, SNAPSHOT.FAILED, SNAPSHOT.OUTDATED; exports use EXPORT.CREATED/REFUSED with kind 'compliance_rows'. Error codes added: NO_DATA_FOR_RANGE, CURRENCY_NOT_SUPPORTED (422), SNAPSHOT_NOT_READY, SNAPSHOT_NOT_REPRODUCIBLE (409), FIGURE_OMITTED (422).

## T-A11-R1 (2026-11-12)
- Input change while computing -> failed (not outdated), reason stored, SNAPSHOT.FAILED audited by the DB helper `cpl_retire_snapshots(tenant, ids, cause, reason)`; ready -> outdated with SNAPSHOT.OUTDATED. Audit before_ref = {state: previous}.
- AC-40.1: any new import_mapping row (saving always creates a version, draft included) retires snapshots whose mapping_ids contain an earlier version. Only markets locked by the trigger are touched; a snapshot created concurrently in another market is serially "after" and stays.
- Settings saved in flight at creation: the snapshot records the version it read (old) even if the new version's effective_from precedes created_at; reproduction uses the recorded id, so figures stay reproducible. No lock shared with settings writes (optional in the review).
- Coverage rule: month m is covered when some loaded batch has period_from's month <= m <= period_to's month.
- Job holds cpl_lock_inputs for the whole computation (simplest correct order); loads, creations and mapping saves for that market wait for it.
- CSV: plain numbers /^-?\d+(\.\d+)?$/ are exempt from the formula apostrophe (T14 intent kept; any other value starting with = + - @ tab CR is still prefixed).
- API-05 shape kept (grouped results, numerator/denominator): E-ADR-26. DB-level IMP->CPL contract and lock order: E-ADR-25.
