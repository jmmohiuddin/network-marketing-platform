# compensation — OPEN_ISSUES

_Agent: compensation. Read before every task; update after every task. Keep concise — facts and decisions, not transcripts._

## B3 review fixes (2026-11-18)
- ESCALATED (architect + records): S-1 engine OOM at 500k/2M positions with 4 GB heap (~16 KB RSS/position, packages/engine/results/s1-bench.json); TS-29 / NFR-PERF-04/05 not met; re-plan engine memory (per-line trace objects, input graph) and D-B3-21 worker sizing before COMP relies on in-process runs.
- Architect decision needed: new versions copy the base version's incoming transitions (PLAN 2.1); they satisfy TRANSITION_MISSING silently.
- Contract deviation for UI: SOD_SELF_APPROVAL eligible_approvers items are the platform EligibleApprover {user_id, display_name, email} (cpl/sod.ts, ten/sod.ts), not PLAN section 2 {id, display_name}.
- A superseded due version stays 'scheduled' (DB has no scheduled -> retired); DB agent may add that transition.
- Not mine, failing: apps/api/test/authz/role-matrix.test.ts and test/isolation/isolation.test.ts seed PUT genealogy.placement_width -> 422 SETTING_RETIRED.

## B2 GEN (2026-11-17)
- gen_create_position does not mark path_model stale: a position created without a relationship write is no read-model node until the next rebuild (reads fall back to SoR for it; top-level list from the model misses it). DB fix: mark both kinds stale on position insert.
- Downline contact read directly from participant.contact and masked in GEN (no PAR SQL contract returns contact).
- Integrator: add genModule + genCaseTypes, isolation cases and role-matrix rows for the 5 routes.

## B engine review fixes (2026-11-13) — supersedes older lines where they differ
- BLOCKED on product semantics (finding 8, catalogue gaps; not built, not "done"): banked points (no accrue/redeem rule; state passes through), carry balance readable by measures/requirements/payouts, `limit.max_per_order` (per order of what: pay or volume?), tier-2 expression language (FR-PLN-003 Must; grammar unwritten), cross-calendar state (BR-PER-01), pass-10 "minimums" (ENGINE_GENEALOGY Open). Binary pairing (Could) absent.
- Order-line clawback origin: for group/generation measures the orders are cited only in a full trace; the clawback component must replay the paid run with fullTraceFor = the order_line lines whose payee is the refunded order's credit position or an ancestor in the rule's tree.
- Withholding on gross - netted is PROVISIONAL (MONEY O-5, tax adviser); pinned by the TS-38 + receivable test, so a change is an engine version bump.
- Compression "active" = earner && eligibleIf (finding 6) — record in ENGINE_GENEALOGY open item (outside my edit scope).
- max_share is not re-checked after rounding (rounded lines carry no purpose part); it is exact in pass 7.
- Static test still allows Math.max/min (integer rank indexes in rank.ts) and number `/`; money fields are guarded at runtime by inputsHash (non-bigint *Minor/*Us refused).

## B engine pass 3 rank.ts (2026-11-13)
- run.ts (run owner) must add new one_time flags from pass-4 `pay.one_time` lines to the committed state rows; pass 3 only carries prior oneTimeFlags/banked through.
- Readings to confirm with product: demotion goes straight to the qualified rank (no step-down); leg rule on period window only; whole-balance carry expiry (not FIFO); negative carry clamped to 0; non-earner/terminated positions still get ranks (compression via holdsRank sees them).
- "Change windows" (BR-GEN-05) are genealogy-case policy, not an engine input: nothing in pass 3 for them.
- snapshot.history PeriodSummary with duplicate position ids would double-count a rolling window (not validated).

## B engine payout primitives (2026-11-13)
- Contract gap: nothing records a paid one_time onceKey into the next state row (pass 3 runs before pass 4). run.ts (or a pass after 4) must add `onceKey` to `oneTimeFlags` of the state candidate for every pay.one_time line, else TS-25 pays twice.
- Shared payout helpers sit in primitives/unilevel.ts; proposal: move them to primitives/payout-lines.ts (owner decision; retail/percent-of-measure owner may duplicate them).
- retail.ts / percent-of-measure.ts not in this agent's ownership and absent at hand-off: run.ts fails tsc until they land.
- Readings to confirm with product: differential source keeps own rate (level 0 unpaid); matching cites no order ids even under order_line; fast-start window half-open; pool parts without holders unpaid.

## B engine contracts (2026-11-13)
- Not built (no owner): binary pairing + leg measures (Could, OQ-13; TS-04 fixture kept), tier-2 expression language and tier-3 modules other than CapBase order_structure (grammar unwritten), banked-points rule, cross-calendar state dependencies, pass-10 "minimums" (meaning open), provisional runs (V1).
- Order-line clawback amount (TS-10 A -50.00) is an adjustment-origin input; which component computes it from committed traces is undecided (needs fullTraceFor replay).
- Assumed readings to confirm with product: pool `rank_order` (part per exact rank, equal split) and `first_n` (top n by measure desc); restockingFeeAffectsVolume semantics; taxable base after netting (tax adviser); differential/override multi-level semantics beyond TS-43's single source.
- run.ts imports every primitive: until they land the run owner must stub registry entries.
- Root tsconfig now references packages/engine; `tsc -b` was not run (would rebuild other packages' dist).


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

## 2026-11-19 (B5 review)
- BLOCKED on lib §1.7 (integrator/DB): portal sessions resolve to null (lib/session.ts), no createPortalUser; then switch comp/portal-routes.ts to lib and delete comp/portal.ts.
- lib/idempotency.ts: per-user route key for portal sessions (PLAN §R) — integrator; covered by comp/portal-routes.test.ts.
- Staging check for committed runs with result_line but no run_settlement (pre-B4) — needs operator/DB agent; would 500 INVARIANT_FAILED on statement detail.
- dispute due_at stored up to 999 µs before submitted_at + days (JS Date in CaseTypeDefinition.dueAt, cas/types.ts); exact at API ms precision.
- 2026-11-20 D-B6-12 AC-S1-2: 2M positions OOM at 7 GB heap; engine rework (columnar input, traces on chunk exit, pass 10 per payee range) or architect amends AC-S1-2 (E-ADR-49). Unmeasured at 1M: S-2 end to end, simulation, parallel run.
- 2026-11-20 TS-28 erasure-replay settles A's payable with a hand-made entry; real PAY batch → sandbox settle → erasure → replay needs an apps/api/test cross-module test (integrator/QA).
- 2026-11-20 close-check / close / ledger entries export lack isolation cases + role-matrix rows (apps/api/test, integrator).

## B-MKT BE2 (2026-11-20)
- Integrator: isolation cases + role-matrix probes for 10 tax routes (GET /v1/tax/rules, /lines, /year-end, /year-end-generations, /year-end-forms, /year-end-forms/:id/download; POST /v1/tax/year-end-forms, /year-end-forms/export; portal GET /v1/me/tax-forms, /:id/download).
- e2e markets whose languages lack a catalogue (e.g. nl) now show checklist item portal_languages missing (by design).

## 2026-11-20 (B-MKT BE1)
- AC-S1-2 (2M) still not met after TK-B6-14: ceiling 1M at 4 GB, 1.5M at 7 GB (SPIKE §9). Next: traces built at chunk exit + columnar input, or architect amends AC-S1-2/E-ADR-35. S-2 and simulation at 1M not run (machine swap).
- tax_line.tax_year falls back to the calendar year when the pack has no tax_year rule (shortcut in comp/results.ts); DB/TAX to decide whether such markets may write tax lines.
- No staff statement view exists in COMP; staff withholding is TAX's GET /v1/tax/lines.
- Web: explanation parts[].rate keeps the data sentinel 'rates vary' (web catalogue must translate it); portal market createWorld default '{de}'.
- apps/api/test (integrator): isolation cases / role matrix missing for TAX, CPL registers, PUT /v1/me/locale routes; boundaries.test flags cpl/tax test-support cross imports (not COMP).
