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

## T-A11 (2026-11-12)
- Core must add `cplModule` to `defaultModules` in apps/api/src/modules/index.ts (server then starts the 'cpl.compute-snapshot' worker). Not done: file owned by core.
- CPL reads IMP's `import_batch` (state, market, period, mapping_id) and `market` (code, minor_unit) directly in SQL, and its migration puts triggers on import_batch. If IMP wants a facade instead, replace `cpl_loaded_batch_ids` callers; keep the trigger or an equivalent call in IMP's load/supersede transaction.
- `cpl_fact_order.order_date` is NOT NULL, so a missing order day cannot reach R4 (spec: missing day -> late indicators omitted). IMP must not invent a day; needs a nullable day/column or a batch flag (DB owner decision).
- Snapshot stays 'computing' if the job exhausts pg-boss retries on a non-input error (e.g. DB outage); no sweeper yet.
- AC-40.1 (mapping edited without reload -> snapshot outdated) is not covered: only batch set changes outdate. Native facts (source='native', batch_id NULL, release B) are ignored.
- Drill-down recomputes the whole snapshot per page; fine for overlay volumes, cache or persist ids if tenants export far larger files.
- Settings lookup at created_at + 1 ms: a settings write starting within that millisecond after snapshot creation fails the snapshot (clear reason); a facade `getSettingsVersion(tx, id)` in TEN would remove the window.
- TR-API-19 ETag/long cache for ready snapshots not applied (core sets no-store globally).

## T-A11-R1 (2026-11-12) — resolves from T-A11: settings lookup window, AC-40.1, CPL TS reads of import_batch, most of "stays computing"
- Still open: core must add `cplModule` (and `impModule`) to `defaultModules`.
- A snapshot can still stay computing if transient errors (SQLSTATE 08/40/53/57/58, lost connections) persist through every pg-boss retry; no sweeper.
- `resolveMarket` reads `market` directly (TEN has no market facade; IMP create-batch and IAM grants do the same). One TEN facade for all three would close it.
- Edits outside my ownership, additive, owners to accept: TEN `getSettingsVersion`; IMP `lockLoads`/`tryLockLoads`/`batchDataQuality` (load.ts now calls lockLoads); lib/csv.ts numeric exemption (formats.test.ts updated: '-1' is no longer prefixed — security owner to confirm against T14 wording); packages/db/test/seed.ts (facts written while batch mapped).
- Observed, not mine: apps/api/src/modules/ops/ops.test.ts "second-person approval" expects 1 queued invitation job, gets 2 (OPS files were being edited at the time).
- Native facts (batch_id NULL, release B) bypass the fact guard and are ignored by snapshots; release B must define both.
