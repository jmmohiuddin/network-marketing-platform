# compensation — MEMORY

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._

## 2026-11-12 — Phase C spike REPORT written: `engineering/increments/S/SPIKE_REPORT.md`
- Verdicts: NFR-PERF-05/04 met for measured parts (end-to-end 2M not measured); NFR-PERF-07 authz met, root subtree page NOT met (388 ms); NFR-PERF-08 time met, non-blocking unmeasured; NFR-PERF-02 not measurable; TR-GEN-03 snapshot ≤ 2 min met (26 s); reconciliation 0 diff.
- Decisions logged E-ADR-32 (ADR-04 kept, ltree prefix GiST), -33 (btree replaces EXCLUDE), -34 (engine stays TS), -35 (calc worker 4 GB), -36 (ledger entry per payee).


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

## 2026-11-12 — Phase C spike TASK 2: engine core benchmark (packages/spike/src/engine, NOT the product engine)
- Files: money.ts (parseRate -> ppm bigint, halfUpDiv, largestRemainder), cap.ts (allocateCap: priority then proportional, LR to exact cap), tree.ts (ids sorted, CSR children, BFS; cycle/unknown-sponsor errors), run.ts (passes 1-5,7,8,10,12 + sha256 linesHash/summaryHash), generate.ts (mulberry32 seeded generator, shuffle, BENCH_PLAN), bench.ts.
- Money: bigint only; raw = minor x 10^6 (rates <= 6 dp); round half-up once per line; capped scope allocated by largest remainder (ties = canonical index = payee id asc, then bonus order). Matching accumulates at 10^12 and rounds once to 10^6 (shortcut).
- Upline walks use nearest-active / nearest-leader ancestor arrays (top-down pass) => O(N x levels), depth-5,000 leg costs nothing extra.
- Tests: `scripts/heavy.sh node_modules/.bin/vitest run packages/spike/test/engine` (17: TS-01, TS-02, TS-06/07/08, tie-break, G-E2E-01 incl. cap 250.00 / total 502.00; hand-derived generations, leg rules, per-payee cap; shuffle determinism).
- Measured (16 GB laptop, ~7 GB swap in use, Node 26, in-memory, all mechanisms, cap binding): 100k 0.21 s / peak RSS 223 MB; 500k 1.1 s / 522 MB; 2M ~5.0-6.4 s / 1.66 GB (random and deep-leg 5,000). Hashes equal with shuffled input and across processes. Results: packages/spike/results/engine/bench.jsonl.
- Not covered: PG snapshot load, result-line + trace writes, reversals, binary pairing, expressions, wide-unilevel shape, maintenance/grace.

## 2026-11-12 — Phase C spike TASK 3: ledger prototype (packages/spike/src/ledger, db nmp_spike)
- Schema `src/ledger/schema.sql` (MONEY.md §1): ledger_account (unique key NULLS NOT DISTINCT), journal_entry (unique tenant+idempotency_key), posting partitioned by posted month, account_balance projection, run_commit guard, outbox_event. DB enforces: deferred constraint triggers (posting + entry) Σdebit=Σcredit and ≥2 postings; one-sided postings; append-only (UPDATE/DELETE/TRUNCATE trigger, SQLSTATE 42501); projection via statement-level trigger with transition table (same tx, ORDER BY account_id).
- `commitRun` (run-commit.ts): one tx = run_commit guard row (concurrent second commit blocks, then gets `already_committed`) + one entry per payee via one CTE statement per batch + blocking control totals + `run.committed` outbox row. `postEntry`/`reverseEntry`/`postClawback` in poster.ts. MONEY.md row #1 says ONE entry per run (`run:{run_id}`); spike used one per payee (`run:{run}:payee:{payee}`) as tasked — decide before build.
- Gotcha: never round-trip timestamptz through JS Date (µs lost → posting.posted_at ≠ entry.posted_at → trigger rejects). Keep posted_at in SQL (now() / join journal_entry).
- Measured (16 GB laptop in swap, PG16 default 128 MB shared_buffers): 10k lines 1.7 s, 100k 24.5 s, 1M 300.7 s (3.3k lines/s, 10k postings/s); deferred balance triggers = 39% at 1M (117.9 s inside COMMIT). Node RSS ≤ 149 MB (streamed); sampled PG backend RSS ≤ 235 MB. Payee balance from postings p95 0.19 ms, projection p95 0.05 ms; hot market expense account derived over 1M postings 167 ms fresh / 68 ms after VACUUM (use projection). Reconcile 1M accounts / 3M postings 6.2 s, 0 mismatches. Disk ≈ 1.5 GB per 1M lines.
- Tests: `scripts/heavy.sh node node_modules/vitest/vitest.mjs run --config packages/spike/vitest.ledger.config.ts` (15, *.int.ts so the root suite never runs them). Bench: `scripts/heavy.sh node --max-old-space-size=1024 --import tsx packages/spike/src/ledger/bench.ts --lines N`; results in packages/spike/results/ledger/.

## 2026-11-12 — Phase C spike, genealogy (OQ-05, OQ-29, TS-29) — packages/spike/src/genealogy
- Code: `generate.ts` (mulberry32 seeded; preferential attachment long tail + chain depth 5,000 under root; 1% changes close-in-place, 0.5% corrections supersede; parent idx < child idx always ⇒ acyclic in every slice; `asOfParents` = FR-GEN-003 predicate), `tree.ts` (Int32Array parent/firstChild/nextSibling/depth + BFS order; `rollUp` BigInt64Array one reverse pass; `upline`), `db.ts` (schema `genealogy` in nmp_spike, dropped after run), `bench.ts` (run via scripts/heavy.sh). Tests: `pnpm vitest run packages/spike/test/genealogy` (8, naive oracles). Results: `packages/spike/results/genealogy-*.json`.
- OQ-29 ANSWER: plain GiST on `path` FAILS past ~1,000 levels ("index row requires 8512 bytes, maximum size is 8191"; ltree levels are MAXALIGN(len+2) ⇒ 8 B/level for labels ≤ 6 chars, uncompressed in index; heap TOAST compresses: depth-5,000 path 16,474 B stored). Labels must be short (base-36 seq ≤ 6 chars); 7+ chars doubles to 16 B/level.
- Working fallback (measured): GiST on `ltree_prefix(path,128)` (SQL fn, inlined so index matches) + exact recheck `path <@ a.path` + cheap `depth >= a.depth` prefilter before detoast. Ancestors by label lookup (`position.label = any(labels)`), no GiST needed. Authz = 2 PK lookups + `@>`.
- 2M measured: snapshot load PG→arrays 26.0 s, peak RSS 667 MB (target ≤ 2 min); roll-up 12.7 ms p50; authz p95 0.99 ms; subtree page p95 2.8 ms but ROOT page 388 ms (> 300 ms: page query scans whole subtree — page children via relationship parent index / stored subtree_count instead); move 100k subtree 3.39 s (NFR-PERF-08 ≤ 10 min); full path build 38.6 s.
- relationship EXCLUDE (DATABASE.md order tenant,kind,child,range): ADD CONSTRAINT 89.8 s at 100k; child-first 19.8 s; at 2M child-first > 900 s (timeout). Per-row GiST probe 3.07 ms vs btree 0.44 ms. Recommend: unique partial btree (tenant,kind,child) WHERE superseded_at IS NULL AND valid_to IS NULL + overlap check in trigger via (tenant,kind,child,valid_from) btree under the existing per-tree advisory lock.
- Path build MUST run after ANALYZE: without stats it went quadratic (354 s at 100k vs 2.97 s).
