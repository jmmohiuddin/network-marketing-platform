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
