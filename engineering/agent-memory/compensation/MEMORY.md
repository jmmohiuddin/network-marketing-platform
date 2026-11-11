# compensation — MEMORY

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._


## 2026-11-12 — T-A10 @nmp/compliance (pure R1–R5)
- Package `packages/compliance` is done and green: `pnpm vitest run packages/compliance` (98 tests), `tsc --noEmit -p packages/compliance/tsconfig.json` clean. No dependencies, no I/O.
- Entry: `computeReports(facts, config, options?)` → `{ methodVersion, months, years, reports: ReportPeriod[] }`. `ReportPeriod = { report, period ('YYYY-MM' | 'YYYY'), periodKind, partial, figures, omitted[{key,reason}], notes }`. Figure keys are the prototype JSON keys (`customer_share_pct`, `share_pct.retail_sale`, `bands.0 or less`), so they map 1:1 to `compliance_figure.key`.
- `Figure.value` is always a decimal string or null ("62.50", "16000", "14.30"); `numerator`/`denominator` are bigint (callers must serialise). `METHOD_VERSION = 'cpl-method-1.0.0'`.
- Facts use `'YYYY-MM'` month strings + `orderDay: number | null`; the caller converts `order_date`/`pay_month`/`enrolled_month` dates.
- See TECHNICAL_DECISIONS.md and OPEN_ISSUES.md for the choices a caller must know.

## 2026-11-12 — T-A11 CPL API module (apps/api/src/modules/cpl, migration 0030)
- `cplModule` (index.ts) exports routes + `jobs: [computeSnapshotJob]` ('cpl.compute-snapshot', payload `{snapshotId}`). NOT yet in `modules/index.ts` defaultModules (core owns that file).
- Routes: `POST /v1/compliance/snapshots` (snapshot.create, Idempotency-Key, body `{market: code, period_from, period_to: 'YYYY-MM', reports?: R1..R5}` -> 202 `{data: snapshot}`); `GET /v1/compliance/snapshots` (compliance.read, cursor = snapshot id, newest first); `GET /v1/compliance/snapshots/:id` (+ `results[{report, period, period_kind, partial, notes, figures[], omitted[{key, reason}]}]`, meta.notice = BR-HON-01); `GET .../figures/:figure/rows?set=numerator|denominator&cursor&limit` and `?export=true` (needs `export` too; text/csv of both sets with watermark; 422 EXPORT_ROW_CAP_EXCEEDED above cap). Figure id = `{report}.{period}.{key}` (URL-encode: keys contain spaces/commas).
- All routes apply `marketScope` (snapshot.create for POST, compliance.read for reads).
- Inputs = loaded `import_batch` rows of the market overlapping the range (`cpl_loaded_batch_ids()` SQL fn); facts read by those batch ids; payout lines filtered to the range; participants deduped (latest load wins).
- Tests: `pnpm vitest run apps/api/src/modules/cpl` (36 tests: snapshots, drill, golden on full synthetic set). Fixtures in `test-fixtures.ts` (loadBatch/supersede/saveSettings write in the tenant realm).

## 2026-11-12 — T-A11-R1 CPL review fixes (migration 0031) — supersedes T-A11 lines where they differ
- Snapshot states now exactly FR-CPL-006: computing -> ready | failed; ready -> outdated (guard enforces it). An input change while computing (batch load/supersede, new mapping version) FAILS the snapshot with a reason; it never goes computing -> outdated.
- Reproduction loads exactly `settings_version_id` via TEN `getSettingsVersion` (no time lookup). Job lock order: `cpl_lock_inputs(tenant, market)` -> snapshot row FOR UPDATE -> audit chain; every trigger path takes cpl_lock_inputs first (deadlock regression: concurrency.test.ts).
- Creation: `tryLockLoads` (IMP) -> 409 INPUTS_CHANGING; inputs from IMP `loadedBatches` under cpl_lock_inputs; every month of the range must lie in a loaded batch, else 422 NO_DATA_FOR_RANGE with `details.uncovered_months`.
- input_refs = {batch_ids, mapping_ids, mapping_versions, reports}. View adds `input_mapping_versions`; GET /:id adds `input_data_quality[{batch_id, data_quality}]` (IMP `batchDataQuality`).
- Drill: participant rows carry measures: R2 `multilevel_pay_minor`, `personal_use_pay_minor`; R4 `personal_volume_minor`; R5 `earnings_minor` (measures.ts). Export scope = compliance.read scope ∩ export scope (404 outside).
- DB (0031): mapping trigger `cpl_mapping_version_created`; fact guard: cpl_fact_* INSERT/DELETE only while batch state 'mapped' (fixtures and db seed insert facts as mapped, then set loaded); `cpl_loaded_batch_ids` requires mapping_id NOT NULL (same set as loadedBatches).
- Non-transient job errors (anything but SQLSTATE 08/40/53/57/58) fail the snapshot with a generic reason (logged); transient ones are rethrown for pg-boss.
- Tests: `pnpm vitest run apps/api/src/modules/cpl` = 47 tests in 5 files (snapshots, states, drill, golden, concurrency).
