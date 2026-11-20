# Phase C performance spike: report (OQ-05, OQ-29, TS-29, ADR-04)

Date 2026-11-12. Code: `packages/spike` (`src/genealogy`, `src/engine`, `src/ledger`). Raw results: `packages/spike/results/`. Database: `nmp_spike` (disposable; the genealogy and ledger bench schemas were dropped after the runs).

**Every number here was measured on this laptop unless it is marked EXTRAPOLATED.** The laptop understates a server: 16 GB RAM with 7.15 of 8 GB swap in use, 0.1 to 1.2 GB RAM free during runs, disk at 97% during the genealogy runs, PostgreSQL 16 at default settings (128 MB shared_buffers, synchronous_commit on), and another workflow building the product at the same time. Treat timings as upper bounds. Outliers (for example one 530 ms ancestor query) may come from swap.

All runs went through `scripts/heavy.sh` (2 machine-wide slots) with a `--max-old-space-size` cap. Generators are seeded (mulberry32). Money is bigint minor units.

## 1. Verdict per target

| Target | Value | Result | Evidence |
|---|---|---|---|
| NFR-PERF-05 full run, 2M positions, depth 5,000 | ≤ 60 min, worker ≤ 8 GB | **Met for every measured part; end-to-end not measured** | In-memory calculation 5.0–6.4 s, peak RSS 1.66 GB (random tree and 5,000-deep leg). Snapshot load PG → arrays 26.0 s, peak RSS 667 MB. Ledger posting for 2M payees ≈ 10 min, **EXTRAPOLATED** from 3,326 lines/s at 1M (throughput fell with size: 5,836 → 4,076 → 3,326 lines/s, so it may be slower). Not measured: writing result lines and traces, reversals, binary pairing, expressions, wide-unilevel shape. |
| NFR-PERF-04 full run, mid-market | ≤ 5 min | **Met for every measured part** | Engine 100k 0.21 s / 223 MB, 500k 1.1 s / 522 MB. Snapshot load 100k 0.39 s. Ledger commit 100k lines 24.5 s. Same gaps as above. |
| NFR-PERF-07 authorisation check | p95 ≤ 100 ms | **Met** | 2M: p95 0.99 ms over 200 checks (2 PK lookups + ancestor test). |
| NFR-PERF-07 subtree page | p95 ≤ 300 ms | **Not met for the root; met otherwise** | 2M: p95 2.8 ms over 200 random nodes (max 78.4 ms); chain node at depth 2,500: 96.9 ms; **root page 388 ms**. The page query reads the whole subtree before sorting. Subtree count p95 14.9 ms. |
| NFR-PERF-08 rebuild after moving 100k subtree | ≤ 10 min, without blocking writes | **Time met; "without blocking writes" not measured** | 2M: 101,088 paths rewritten in one transaction in 3.39 s; ~10k move 0.80 s. The UPDATE locks only the moved rows, but concurrent writers were not tested. |
| NFR-PERF-01 read latency | p95 ≤ 300 ms | **Met (ledger balance reads only)** | 1M-line ledger: payee balance from postings p95 0.19 ms, from balance table p95 0.05 ms. Market account summed over 1M postings: p50 167 ms after bulk load, 67.8 ms after VACUUM. |
| NFR-PERF-02 write latency | p95 ≤ 500 ms | **Not measurable here** | Only the per-row cost of the relationship overlap check was measured: GiST exclusion probe 3.07 ms avg, btree probe 0.44 ms avg (2,000 probes at 2M). No API write was timed. |
| NFR-PERF-03, -06, -09 | — | **Out of spike scope** | — |
| TR-GEN-03 / SDD-08 snapshot load 2M | ≤ 2 min | **Met** | 26.0 s, peak RSS 667 MB (keyset pages, uuid map, typed arrays). |
| TR-GEN-03 O(N) bottom-up pass | one pass | **Met** | Subtree volume roll-up at 2M: 12.7 ms p50 of 5 (BigInt64Array, one reverse pass). Upline walk to root p95 0.001 ms; 5,000-level tail 0.012 ms; 1M walks capped at 10 levels 64.5 ms. |
| FR-GEN-003 as-of queries | correct | **Met** | 2M: as-of parent p95 1.42 ms; as-of recursive upline p95 3.27 ms (depth 5,000: 23.2 ms); full as-of snapshot count 333 ms for 1,002,739 edges, equal to the in-memory result. |
| TR-FIN-06 / NFR-INT-01 reconciliation | 0 unexplained difference | **Met** | 0 differences at 10k, 100k and 1M lines (1M accounts / 3M postings in 6.2 s). The check catches a balance row changed by hand. |
| Engine correctness (oracle) | `verify_calculations.py` values | **Met** | 17 tests reproduce TS-01 (925.00), TS-02 (800.00 / 1040.00), TS-06/07/08, the 33.34/33.33/33.33 tie-break, and the worked example (cap 250.00, run total 502.00). Shuffled input gives identical sha256 hashes at every size. Generations, leg rules and per-payee cap use hand-derived values (the oracle has none). |
| Ledger invariants (MONEY.md, TS-11, TS-38, TS-39) | enforced | **Met** | 15 tests: balance at COMMIT, no UPDATE/DELETE/TRUNCATE, idempotency, concurrent double commit posts once, TS-38 1,234.56 → 24.69 / 1,209.87, TS-11 clawback 40.00 vs 25.00. |
| Genealogy correctness | naive recursive versions | **Met** | 8 tests compare roll-up, upline walk, depth and as-of against naive recursive implementations; tree loaded from PostgreSQL equals the generated one; a moved subtree's new path is correct. |
| OQ-29 ltree at depth 5,000 | answer | **Answered: plain design fails** | See §2.2. |

## 2. Decisions the spike settles for B2–B4

### 2.1 ADR-04 in-memory tree per run + ltree read model: **yes, keep it, with changes** (E-ADR-32, E-ADR-33)
The run side is proven: 2M snapshot in 26 s and 667 MB, roll-up in milliseconds, depth 5,000 costs nothing extra. The read model works with the changes in 2.2 and these:
- Page the root and other very large subtrees by direct children (relationship `(tenant, kind, parent)` where `superseded_at IS NULL`) or a stored `subtree_count`, not by scanning the subtree (root page 388 ms today).
- The `path_node` rebuild job runs `ANALYZE` on relationship and position first. Without statistics the 100k build took 354 s; with them 2.97 s (2M: 38.6 s).
- Replace the DATABASE.md relationship `EXCLUDE` constraint. Adding it took 89.8 s at 100k (documented column order), 19.8 s with `child_position_id` first, and did not finish within 900 s at 2M. Use a unique partial btree on `(tenant_id, kind, child_position_id) WHERE superseded_at IS NULL AND valid_to IS NULL` (113 MB at 2M; probe 0.44 ms vs 3.07 ms via GiST, 470 MB) plus an overlap check in the trigger under the existing per-tree advisory lock. Minimum fallback: put `child_position_id` first in the EXCLUDE.

### 2.2 ltree at depth 5,000 (OQ-29): **plain GiST on `path` does not work; use the measured prefix fallback** (E-ADR-32)
- A GiST index on `path_node.path` fails at about 1,000 levels: "index row requires 8512 bytes, maximum size is 8191" (8,664 bytes at 2M). Each level costs 8 bytes in the index, uncompressed, for labels up to 6 characters, 16 bytes for 7 or more.
- In the table a depth-5,000 path (5,001 levels, 18,671 text bytes) is stored TOAST-compressed at 16,474 bytes.
- Fallback that works (measured at 2M): GiST on `ltree_prefix(path, 128)` (build 13.6 s, 318 MB; 128-level prefix = 1,032 bytes) with a full-path recheck and a cheap `depth >=` filter before the long path is unpacked. Ancestor queries look positions up by label (p95 3.5 ms; depth 5,000 returns 5,001 rows in 35.6 ms) and need no GiST.
- Labels must be base-36 position numbers of at most 6 characters.
- The SDD-08 chunked path with skip pointers was not built. It is needed only if the prefix fallback fails under real deep legs (open issue 3).

### 2.3 Engine language (ADR-18, TRD-02 §3 decision rule): **stay TypeScript** (E-ADR-34)
The rule says move the engine to the JVM or Go only if the benchmark misses NFR-PERF-05 after reasonable optimisation. The in-memory calculation at 2M took 5.0–6.4 s against 60 min, with no optimisation pass. The rule is not triggered. Caveat: the unimplemented mechanisms (binary pairing, expressions, reversals, maintenance) were not timed; re-check when they exist.

### 2.4 Calc worker memory sizing (E-ADR-35)
Measured peaks at 2M: engine process 1.66 GB (ran under a 6 GB heap cap), snapshot load 667 MB (3 GB cap). They ran as separate processes; in one process the combined peak would be at most about 2.3 GB (**EXTRAPOLATED** by adding the two; shared arrays would lower it). Recommendation: size the calc worker at 4 GB with a heap cap of about 3 GB, keep 8 GB as the NFR ceiling, and re-measure once result-line and trace writing is added. Ledger posting needs under 150 MB in Node (streamed in batches of 5,000); the PostgreSQL backend peaked at about 235 MB (sampled every 200 ms).

### 2.5 Ledger design changes (E-ADR-36)
1. **One journal entry per payee per run** (key `run:{run_id}:payee:{payee_id}`), not one per run as MONEY.md posting rule #1 says. Per-payee keeps each balance check small; a single entry of up to 3M postings was not measured. Needs the MONEY.md owner's agreement.
2. The deferred balance check at COMMIT took 39% of the 1M run (117.9 s of 300.7 s), because it fires per posting and per entry (about 4M checks). Check once per entry plus a cheap guard against adding postings to a committed entry. Not built or measured.
3. A run commit holds row locks on market-level balance rows (commission_expense, withholding_payable) for the whole transaction (about 5 min at 1M lines). Clawbacks, netting and write-offs to those accounts wait. Not measured under load.
4. Read market-level balances from `account_balance`, not by summing postings (167 ms after bulk load).
5. Keep `posted_at` in SQL (`now()` or a join); a JavaScript `Date` drops microseconds and the database then rejects the posting.
6. Add a job that creates future `posting` partitions (the spike creates now() ±2 months plus a default).
7. Disk: about 1.53 GB per 1M result lines (3M postings).

## 3. Measured results (selected)

| What | Size | Time | Peak RSS |
|---|---|---|---|
| Generate tree (chain 5,000, 1% changes, 0.5% corrections) | 2M | 37.8 ms | 172.5 MB |
| Bulk write position + relationship | 100k / 2M | 1.53 s / 72.2 s | 179.5 / 320.7 MB |
| Full `path_node` build after ANALYZE | 100k / 2M | 2.97 s / 38.6 s | 179.5 / 320.7 MB |
| Full `path_node` build without ANALYZE | 100k | 353.8 s | 163.9 MB |
| Snapshot load PG → typed arrays | 100k / 2M | 0.39 s / 26.0 s | 181.5 / 667 MB |
| Engine full run (all mechanisms, cap binding) | 10k / 100k / 500k / 2M | 27 ms / 206 ms / 1.09 s / 5.02 s | 107 / 223 / 522 / 1,663 MB |
| Engine full run, deep leg 5,000 | 100k / 2M | 180 ms / 5.20 s | 217 / 1,651 MB |
| Ledger run commit (lines / postings) | 10k / 100k / 1M | 1.7 s / 24.5 s / 300.7 s | 101 / 119 / 149 MB (Node) |
| Ledger time inside COMMIT | 1M | 117.9 s | PG backend ~235 MB |
| Concurrent double commit of one run | 10k | 3.5 s | posts once |
| Genealogy schema on disk (no EXCLUDE) | 2M | — | 1,636 MB disk |

Full lists: `packages/spike/results/genealogy-*.json`, `results/engine/bench.jsonl`, `results/ledger/bench-ledger-*.json`.

**EXTRAPOLATED, not measured:** a large-tenant run posting 1.2–2.4M postings at ~10k postings/s ≈ 2–4 min; 2M payees at 3,326 lines/s ≈ 10 min. Run total for 2M (snapshot + calculation + ledger) ≈ 11 min before result-line and trace writes, leaving about 49 min of the 60-minute budget for the unmeasured parts.

## 4. Open issues

1. End-to-end 2M run not measured: result lines and traces are not written; reversals, binary pairing and carry, pools, expression language, rank maintenance and grace are not implemented.
2. TS-29 shapes not covered: balanced binary, wide unilevel (50,000 direct children), placement tree with binary legs; sizes 50k and 500k for genealogy (engine did 500k).
3. The generator's 5,000-deep chain never sponsors anyone, so `path_node` volume under deep legs is not represented. A real deep leg would add roughly depth × 8 bytes per position, and those positions rely on the prefix-plus-recheck fallback.
4. NFR-PERF-08 "without blocking writes", the relationship immutability trigger and the cycle check under the advisory lock were not tested under concurrency.
5. Determinism across machines and builds (spike item 6) checked on one machine only. Line ordering inside the hash (payee id, then fixed bonus order) is the spike's choice; ENGINE_GENEALOGY leaves it open. Matching accumulates at 10^-12 of a minor unit and rounds once to 10^-6: the product engine needs a stated precision rule.
6. Ledger items not built: app-role REVOKE, mutation alert raised outside the failing transaction, RLS, never-negative payable (I-8), approver ≠ preparer, projection rebuild, currency-vs-account check, payout events (TS-40).
7. Package wiring: `packages/spike/node_modules/pg` and `@types/pg` are symlinks into the pnpm store; `@nmp/spike` is not in `pnpm-lock.yaml`, so `pnpm install --frozen-lockfile` will likely fail until the lockfile is updated.
8. DATABASE.md, ENT-07 DDL and MONEY.md need amending by their owners for the decisions in §2 (recorded as E-ADR-32..36).

## 5. How much load this laptop takes

Measured: 16 GB RAM, 10 cores (4 performance, 6 efficiency), swap 7.15 of 8 GB used, 0.1–1.2 GB RAM free during runs, load average about 3. Disk was 6.5 GB free (97%) during the genealogy runs and 8.2 GB free after the bench schemas were dropped.
- The spike processes are light: the heaviest Node process peaked at 1.66 GB (engine at 2M); ledger and genealogy stayed under 700 MB. The limits are swap and disk (PostgreSQL wrote 1.5–1.6 GB per large bench).
- Keep heavy jobs (benchmarks, test suites, builds) at 2 at once, the existing `scripts/heavy.sh` limit. Two heavy jobs ran together without failure.
- Agents that only read and edit code are much lighter: 4 Claude processes measured 1.24 GB together. About 4–6 agents at once is the practical ceiling; free disk first.

## 6. B3 measurements (2026-11-18, copied by the B3 records step from the package results; B3 PLAN §S)

Laptop in swap; upper bounds. Product engine 0.2.0, not the spike prototype.

**S-1 engine** (`packages/engine/results/s1-bench.json`, `scripts/heavy.sh node --max-old-space-size=4096 --import tsx packages/engine/test/run/bench.ts <shape> <n>`, G-E2E-01 plan + `measure.derived` capped_pv):
- 50k positions, every shape (random, binary, wide 50,000 direct children, deep 5,000-level leg): first run 1.1–1.5 s, peak RSS 0.8–1.1 GB; shuffled input gives the same result hash.
- 150k binary: 3.2 s, 2.4 GB (~16 KB per position).
- **500k and 2M: out of memory at 4 GB for every shape.** The spike's 2M / 1.66 GB was the typed-array prototype. E-ADR-34 (engine in TypeScript) and E-ADR-35 (calc worker 4 GB) must be re-evaluated before tenants above ~200k positions (TK-B3-12).

**S-2 write path** (`apps/api/test/bench/write-path.results.json`, one transaction, triggers on, as nmp_app): 100k lines + 100k state rows 128 s (under swap contention); 600k lines + 100k state rows 149 s (lines 142 s, state 4.7 s, flip 1.6 s; result_line 1.56 GB). Within NFR-PERF-04's 5 min → one transaction for write + flip (C-B3-17).

**S-2 end to end** (`apps/api/test/bench/end-to-end.results.json`, TS-10 plan, binary tree, one order per position): 2k 0.9 s, 10k 15.3 s, 20k 40.7 s, dominated by the snapshot store (codec O(n²) on array indexes). The integrator fixed the codec afterwards (`packages/engine/src/json.ts`); **100k end to end not measured, re-run pending** (TK-B3-13).

## 7. B4 S-1 re-measure (2026-11-18, BE1; B4 PLAN §S, D-B4-22)

Engine 0.2.0, same bench (`packages/engine/test/run/bench.ts`, G-E2E-01 + `measure.derived`), laptop in swap. Raw numbers: `packages/engine/results/s1-bench.json`.

**What changed (internal layout only).** Heap profile at 150k binary (forced gc after each pass): the caller's RunInput ~1 KB per position; the RunOutput ~3.85 KB per position (lines with compact traces ~950 B per line, state rows, evaluations, summaries); intermediate pass outputs ~2 KB per position (pass 4-8 RawLines and credited lines kept until the end of the run). Changes: one shared frozen copy of repeated sub-objects (empty arrays, trace tree reference, "nothing omitted", rank references in traces, state rows and summaries; `src/compact.ts`); credited lines released after pass 4 and pass 4-8 lines after pass 10 (`RELEASE_AFTER` in `pipeline.ts`; pass 8 now computes the breakage and the allocation check); the result hash streams its records; the duplicate-line check compares neighbours instead of a set of keys. 150k binary: retained 1,036 → 633 MB at the end of the run, RunOutput 577 → 455 MB, peak RSS 1,563 → 954 MB.

**Byte-identical.** Before the change and after it, resultHash, inputsHash, linesHash and a hash over every RunOutput field are equal for the four shapes at 50k and every golden case (RUN_FIXTURES); all 331 engine tests pass, TS fixtures unchanged. `ENGINE_VERSION` stays 0.2.0, so committed runs keep replaying.

| Shape | Positions | Run 1 / shuffled run 2 | Peak RSS MB | Result hash (shuffled) |
|---|---|---|---|---|
| random | 50,000 | 1.0 s / 1.3 s | 821 | equal |
| binary | 50,000 | 0.9 s / 0.8 s | 895 | equal |
| wide | 50,000 | 0.6 s / 0.8 s | 499 | equal |
| deep | 50,000 | 1.0 s / 0.9 s | 815 | equal |
| random | 500,000 | 13.6 s / 18.3 s | 3,202 | equal |
| binary | 500,000 | 10.7 s / 17.1 s | 3,185 | equal |
| wide | 500,000 | 15.3 s / 18.1 s | 2,881 | equal |
| deep | 500,000 | 13.8 s / 16.8 s | 3,137 | equal |
| random | 750,000 | 28.7 s / 33.8 s | 4,043 | equal |
| binary | 750,000 | 30.1 s / 31.1 s | 4,100 | equal |
| wide | 750,000 | 26.2 s / 30.2 s | 4,059 | equal |
| deep | 750,000 | 31.5 s / 38.6 s | 3,912 | equal |
| random | 1,000,000 | OOM after 42 s | 4,419 | — |
| binary | 1,000,000 | OOM after 34 s | 4,405 | — |
| wide | 1,000,000 | OOM after 38 s | 4,405 | — |
| deep | 1,000,000 | OOM after 46 s | 4,395 | — |
| random | 2,000,000 | OOM after 87 s | 4,346 | — |
| binary | 2,000,000 | OOM after 57 s | 4,706 | — |
| wide | 2,000,000 | OOM after 57 s | 4,679 | — |
| deep | 2,000,000 | OOM after 62 s | 4,506 | — |

**Verdict.** Target (2M within a 4 GB heap) **not met**. Largest passing size: **750k for every shape** (peak 3.9–4.1 GB RSS, ~5.6 KB per position, about 30 s per run); 1M and 2M run out of memory at 4 GB. Before B4 the engine failed at 500k (~16 KB per position at 150k). The floor is not the layout: at the end of a run the caller's input (~1 KB/position) and the unchanged RunOutput (~3 KB/position) are both resident, so 2M needs roughly 8–9 GB of heap with any internal layout.

**E-ADR-34 (engine stays TypeScript): keep.** Time is not the constraint (750k in ~30 s against NFR-PERF-05's 60 min); memory is, and it comes from the output shape, which a JVM/Go engine producing the same objects would also hold. No move-to-JVM/Go trigger.

**E-ADR-35 (calc worker 4 GB, heap ~3 GB): revise.** Proposed: calc worker 8 GB (the NFR ceiling) with `--max-old-space-size=7168`, which covers market runs up to ~1.2M positions (extrapolated from 5.6 KB/position, not measured on this laptop). Above that, the additive streaming output API D-B4-22 allows (lines, state rows and summaries handed to COMP in chunks, input loaded columnar from the snapshot), with COMP adoption as a recorded follow-up; not built in B4. Until then, a tenant above ~700k positions per market needs the 8 GB worker; above ~1.2M it needs the streaming API.

S-2 100k end to end is re-run by the API integrator after BE1 lands (§P).

## 8. B6 S-1 streaming output and 1M/2M measure (2026-11-20, BE1; B6 PLAN D-B6-12)

Engine 0.2.0, bench `packages/engine/test/run/bench.ts` (G-E2E-01 + `measure.derived`, one personal order per position, one customer order per third position) now drains `runIncremental` the way COMP does: every chunk hashed, then dropped. Command `scripts/heavy.sh /usr/bin/time -l node --max-old-space-size=<heap> --import tsx packages/engine/test/run/bench.ts <shape> <positions>`, laptop in swap. Raw numbers: `packages/engine/results/s1-bench.json` (`B6.results`, `B6.verdict`).

**What changed.** `runIncremental(input, options): Generator<RunChunk, RunSummary>` yields the final lines in chunks of `OUTPUT_CHUNK_LINES = 10_000`, then state rows, volume summaries and payees, and returns the rest of `RunOutput`; passes 11–12 read each line once as it leaves (settlement gross, invariants, limits, control totals, one-time keys, streamed result hash). `run()` is the collected stream. COMP writes each chunk in tx B (`writeRunOutput`, lines hash from the chunks); simulations and replay keep `run()`.

**Byte-identical (T-B6-60).** resultHash, inputsHash, linesHash and a hash over every RunOutput field equal the pre-change engine for every golden and the four shapes at 50k (`B6.byteIdentical`); `test/run/incremental.test.ts` re-checks the goldens and all four shapes at 50k on every run, and that the collected stream equals `run()`. All 343 engine tests pass; `ENGINE_VERSION` unchanged.

| Heap | Shape | Positions | Run 1 / shuffled run 2 | Peak RSS MB (footprint) | Lines | Result hash (shuffled) |
|---|---|---|---|---|---|---|
| 4096 | all four | 1,000,000 | OOM after 38–54 s | 4,178–4,460 | — | — |
| 4096 | all four | 2,000,000 | OOM after 60–64 s | 4,546–4,641 | — | — |
| 7168 | random | 1,000,000 | 27.6 s / 39.1 s | 5,298 (6,500) | 1,754,088 | equal (`1bee1263…`) |
| 7168 | binary | 1,000,000 | 30.1 s / 40.8 s | 5,041 (6,486) | 1,761,684 | equal (`7dd9993d…`) |
| 7168 | wide | 1,000,000 | 38.8 s / 51.4 s | 4,787 (6,442) | 1,746,713 | equal (`6cf05b0f…`) |
| 7168 | deep | 1,000,000 | 40.4 s / 51.8 s | 4,955 (6,484) | 1,729,530 | equal (`30aab6a6…`) |
| 7168 | all four | 2,000,000 | OOM after 112–282 s (GC thrash, swap) | 5,441–7,475 | — | — |

**Verdict.** Target (2M positions within the worker heap) **not met**, neither at 4 GB nor at `--max-old-space-size=7168`. Largest passing size: 1M in every shape with a 7 GB heap (about 30–40 s per run, deterministic under shuffle); with 4 GB the B4 figure stands (750k; 1M fails). The streaming API lowers what a run holds after pass 10 (the caller never holds the whole output), but the peak is earlier: the input (~1.2 KB/position) plus the pass 0–10 working set and the sorted line array of pass 10 (~4 KB/position at 1M), all resident before the first chunk leaves. 2M needs roughly 10–11 GB of heap with this pass structure.

**S-2 end to end, 100k, with the streaming adoption** (`apps/api/test/bench/end-to-end.results.json`, nmp_test_2, 4 GB heap, TS-10 plan, binary tree): request 3.0 s, snapshot load + store 19.6 s, engine 1.7 s, write + flip 30.9 s, **total 55.2 s** (B4: 134.5 s, write + flip 114.0 s), peak RSS 837 MB.

**D-B6-12 / AC-S1-2 status: NOT met, not done.** The streaming output is delivered and kept; the 2M target is not. Closing the gap is one of two things, and the records step must not do it by editing E-ADR-35 alone: (a) the engine work above (columnar input, traces built as each chunk leaves, pass 10 emitting lines per payee range), then a re-bench at 2M; or (b) the architect amends AC-S1-2 and the FR scale target in E-ADR-49 and lists it in the HANDOFF open items as a **product-visible limit** ("a market above the supported size is not supported on the 8 GB worker"), for product confirmation.

**What the 1M figure covers (and does not).** Every 1M number above is the engine alone (`bench.ts` drains `runIncremental` from a generated in-memory input). Not measured at 1M: (1) the COMP commit path end to end (S-2: the pg result rows and the RunInput built in tx A, the qualification-state rows `writeRunOutput` keeps, the pg-boss worker) — S-2 was measured only at 100k; (2) simulations, parallel runs, replay and restatement sandboxes, which still call the non-streaming `run()` and insert the whole output in one transaction (`comp/simulations.ts`, `comp/lines.ts`; `pln/goldens.ts` for goldens). FR-PLN-007 requires a full-period simulation before any activation, so the size a tenant can actually use is bounded by path (2), which is unmeasured above 100k. Next measure (not run here: 16 GB laptop in swap, both heavy slots shared): S-2 end to end, one simulation and one parallel run at 1M (or the largest size that fits) with `--max-old-space-size=7168`, recorded in this section.

**E-ADR-35 (proposed revision, for the records step; valid only together with option (b) above).** "The calc worker runs with 8 GB and `--max-old-space-size=7168` (NFR-PERF-05 ceiling). Measured (B6 S-1, engine 0.2.0 with streaming output, **engine alone**): one market run of up to 1M positions in every TS-29 shape completes in about 30–40 s at a peak RSS of about 5.3 GB (footprint about 6.5 GB); 2M does not fit (needs about 10–11 GB). The COMP commit path end to end is measured only at 100k (55 s), and simulations, parallel runs, replay and restatement (non-streaming `run()`) are unmeasured above 100k; the supported market size is therefore not yet established above 100k for those paths. Tenants with a market above 1M positions are not supported on the 8 GB worker (AC-S1-2 amended, E-ADR-49, product-visible) until the engine's pass working set is reduced (input loaded columnar, traces built when a line chunk leaves instead of in passes 4–10, pass 10 emitting lines per payee range instead of one sorted array) and the simulation path streams too; this is a recorded follow-up, not a heap increase. The streaming output (D-B6-12) stays: COMP writes chunks, so the commit write path no longer holds the whole output (S-2 100k end to end 55 s, was 135 s)."

## 9. B-MKT TK-B6-14 engine pass working set and 1M/2M re-measure (2026-11-20, BE1; B-MKT PLAN D-BM-05 (b))

Engine 0.2.0 (unchanged), same bench and command as §8 (`scripts/heavy.sh /usr/bin/time -l node --max-old-space-size=<heap> --import tsx packages/engine/test/run/bench.ts <shape> <positions>`), laptop in swap (4.5 of 5 GB swap used). Raw numbers: `packages/engine/results/s1-bench.json` (`BMKT.results`, `BMKT.verdict`).

**What changed.** (1) Pass 10 settles every amount, the zero-line drop, the RESULT_HASH order (an index sort with the index as last tie-break, equal to the stable sort) and every refusal inside the pass, but makes the `ResultLine` objects one `OUTPUT_CHUNK_LINES` chunk at a time as `runIncremental` drains them, releasing each raw line once made: the full final line array never exists. (2) Pass 8 updates pass 7's line array in place and the pass 4–6 arrays are released after pass 7, so a pre-cap line is garbage as soon as its capped copy replaces it; the breakage is computed from the first constraint/cap step of each line (its `beforeRaw` is the pass 4–6 value). Not done: traces are still built in passes 4–9 (deferring them to chunk exit means re-running each rule per payee range), and the input is not columnar. Measured working set above the input at 200k random: 672 MB → 547 MB (−19 %; peak moved from pass 10 to passes 8–10).

**Byte-identical.** Every golden and the four shapes at 50k still equal the B6 recorded hashes (`test/run/incremental.test.ts`, 351 engine tests green), and every 1M result hash below equals the B6 1M hash of its shape; the shuffled second run gives the same hash everywhere.

| Heap | Shape | Positions | Run 1 / shuffled run 2 | Peak RSS MB (footprint) | Lines | Result hash |
|---|---|---|---|---|---|---|
| 4096 | random | 1,000,000 | 75.2 s / 74.3 s | 4,263 (4,703) | 1,754,088 | `1bee1263…` (B6 equal) |
| 4096 | binary | 1,000,000 | 58.6 s / 87.1 s | 4,303 (4,725) | 1,761,684 | `7dd9993d…` |
| 4096 | wide | 1,000,000 | 64.6 s / 68.0 s | 4,287 (4,659) | 1,746,713 | `6cf05b0f…` |
| 4096 | deep | 1,000,000 | 78.1 s / 74.7 s | 4,209 (4,695) | 1,729,530 | `30aab6a6…` |
| 4096 | all four | 2,000,000 | OOM after 58–85 s | 4,306–4,633 | — | — |
| 7168 | random | 1,000,000 | 30.8 s / 46.8 s | 5,054 (6,257) | 1,754,088 | `1bee1263…` |
| 7168 | binary | 1,000,000 | 30.3 s / 46.7 s | 4,821 (6,276) | 1,761,684 | `7dd9993d…` |
| 7168 | wide | 1,000,000 | 30.6 s / 38.0 s | 5,383 (6,355) | 1,746,713 | `6cf05b0f…` |
| 7168 | deep | 1,000,000 | 32.7 s / 40.6 s | 5,329 (6,329) | 1,729,530 | `30aab6a6…` |
| 7168 | random | 1,500,000 | 67.2 s / 89.7 s | 6,258 (7,458) | 2,631,610 | `e7d6edee…` (ceiling probe) |
| 7168 | all four | 2,000,000 | OOM after 91–128 s | 5,623–7,387 | — | — |

**Verdict: AC-S1-2 (2M) still NOT met.** Measured ceiling per heap: **4 GB: 1M** in every shape (B6: 750k; 1M failed); **7 GB: 1.5M** (random; 2M fails in every shape, sizes between not run). At 4 GB the 1M runs are GC-bound (60–78 s vs 31–33 s at 7 GB). What remains resident before the first chunk leaves: the input (~1 KB/position), pass 3 state rows and evaluations (~0.5 KB/position, output) and the pass 4–9 lines with their traces (~2.2 KB/position); 2M needs about 7.5–8 GB of heap. The remaining lever is the one not built here: traces built when a line chunk leaves (rules re-run per payee range) plus columnar input; otherwise the architect amends AC-S1-2 / E-ADR-35 (B6 §8 option (b)). E-ADR-35 and AC-S1-2 are not edited here.

**Not run (machine).** S-2 end to end and a simulation at 1M or above: the laptop has 4.5 of 5 GB swap in use and S-2 needs a 1M-position database seed; the §8 statement on those paths (measured only at 100k; simulations, replay and parallel runs use the non-streaming `run()`) stands.
