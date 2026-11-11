# ENGINE + GENEALOGY — implementation brief

Domain: ENGINE (genealogy engine, plan/rule model, compensation engine, runs, periods, replay, restatement, golden tests).
Sources (paths relative to `product-documentation/`): SDD-07 `04-system-design/07_COMPENSATION_ENGINE_DESIGN.md` · SDD-08 `04-system-design/08_GENEALOGY_ENGINE_DESIGN.md` · PRD-02 `02-prd/02_FUNCTIONAL_REQUIREMENTS.md` (FR-PLN, FR-COMP, FR-GEN, FR-PAR, FR-ORD, FR-CRM) · PRD-04 `02-prd/04_BUSINESS_RULES.md` · `08-qa/verification/verify_calculations.py` + `verification_output.txt` (55 of 55 checks pass). Cross-checked against `09-governance/traceability-data/spec.json` (entities, APIs, screens, ACs, TS), QA-01 §6 (worked example G-E2E-01), TRD-01 TR-ENG-10..18, PRD-03 NFR-PERF, `09-governance/03_OPEN_QUESTIONS.md`.

All sources are v0.1 drafts dated 2026-11-12. **Nothing is benchmarked**; all plan numbers are hypothetical fixtures, not recommendations.

Release tags: **A** = MVP-A (compliance overlay) · **B** = MVP-B (engine) · **B-MKT** = MVP-B, only when the launch market pack needs it · **V1**. PRD-04 writes "MVP-B"; spec.json writes "B" — same thing. **Everything in this brief is B unless tagged otherwise.**

---

## 1. Scope map

| Area | Requirements | Rules | Release |
|---|---|---|---|
| Positions, ownership | FR-GEN-001, FR-PAR-004 (V1) | BR-GEN-01, BR-GEN-10 (V1) | B / V1 |
| Bitemporal relationships | FR-GEN-002, FR-GEN-003 | BR-GEN-02, -03, -04 | B |
| Change / correction cases | FR-GEN-004 | BR-GEN-03, -04, -05 | B |
| Serialised placement | FR-GEN-005 (**Could**) | BR-GEN-06 | B |
| Visibility | FR-GEN-006, FR-GEN-007 | BR-DAT-03, BR-SEC-03 | B |
| Path read model | FR-GEN-008 | BR-GEN-12 | B |
| Structure ≠ pay rule | FR-GEN-009 | BR-GEN-07, -08 | B |
| Participants, status | FR-PAR-001, -002, -003, -005, -006 | BR-PTY-01 (A), -02, BR-GEN-09, -11, BR-REG-04, -05 (B-MKT) | B |
| Orders, returns, late queue | FR-ORD-001..005, FR-ORD-006 (V1) | BR-ORD-01, -04, -05, BR-VOL-01, -03, BR-RET-01..03, BR-REV-06, BR-PTY-03, BR-ATT-02, BR-PER-04 | B / V1 |
| Customer attribution | FR-CRM-001, -002, FR-CRM-003 (V1) | BR-ATT-01, -03, -04, BR-DAT-08 (V1) | B / V1 |
| Plans | FR-PLN-001..008 | BR-CMP-01, BR-PLN-01..06, BR-CAP-01..03, BR-RNK-05..09, BR-PER-01 | B (BR-PLN-03 B-MKT) |
| Engine, runs, periods | FR-COMP-001..010, -012; FR-COMP-011 (V1) | BR-PER-01..06, BR-PER-07 (V1), BR-MNY-01..05, BR-RNK-05..09, BR-REV-07 | B / V1 |

---

## 2. Genealogy data model (SDD-08 §1; ENT-04, ENT-05, ENT-07)

### 2.1 Concepts (all B)

| Concept | Rule |
|---|---|
| Position ≠ participant | Tree nodes are **positions** (business centres). A participant owns ≥1 positions via effective-dated `position_ownership`. Volume and qualification evaluated **per position** unless plan version says per participant (BR-GEN-01). Statements roll positions up per owner (TS-22). Plan may limit positions per participant (FR-GEN-001 validation; error "limit exceeded"). |
| Two trees | `kind ∈ {sponsor, placement}`. Sponsor = who enrolled whom. Placement = where the position sits, with `leg` (binary) or slot (matrix). **Each bonus names the tree it uses** (FR-PLN-002 validation). |
| Valid time | `[valid_from, valid_to)` — when the relationship is true in the business; `valid_to NULL` = open. |
| Recorded time | `recorded_at` — when the system learned it; `superseded_at` set ⇒ row was once believed and is kept; `NULL` = current knowledge. |
| Root | One company root position per tenant per kind. |
| Termination | Status change only (`position.status = terminated` from date); **no relationship change** (BR-GEN-07). |

### 2.2 Tables

**`position`** (ENT-04, B): `id uuid PK; tenant_id NN; position_ref text NN; market_id NN; brand_id; plan_id; status text NN; status_from timestamptz NN; created_at NN`. UQ `(tenant_id, position_ref)`. `status ∈ (pending, active, suspended, terminated)`. History in `position_status_history` (same cols + `reason`, `actor`). Status changes audited with reason.

**`position_ownership`** (ENT-04, B): `id PK; tenant_id; position_id NN; participant_id NN; valid_from NN; valid_to; case_id`. Idx `(position_id, valid_from)`, `(participant_id)`. `EXCLUDE` overlapping valid ranges per position.

**`relationship`** (ENT-05, B):

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid NN → tenant | RLS |
| kind | text NN | `sponsor` \| `placement` |
| parent_position_id | uuid NN → position | |
| child_position_id | uuid NN → position | |
| leg | text | placement only |
| valid_from | timestamptz NN | |
| valid_to | timestamptz | NULL = open; set **once** |
| recorded_at | timestamptz NN | |
| superseded_at | timestamptz | NULL = current knowledge; set **once** |
| event_type | text NN | `enrolment` \| `change` \| `correction` \| `rule` \| `migration` |
| case_id | uuid → case | |

- Indexes: `(tenant_id, kind, child_position_id, valid_from)`; `(tenant_id, kind, parent_position_id) WHERE superseded_at IS NULL`.
- Constraints: insert-only except setting `valid_to` once and `superseded_at` once (**DB trigger**); `EXCLUDE` overlapping valid ranges per `(kind, child)` among rows with `superseded_at IS NULL`; no cycles (checked in transaction under tree lock); every row links to enrolment, case or rule.
- Invariant (FR-GEN-002): at any valid time a child has **at most one parent per kind**; no cycles.

**`path_node`** (ENT-07, B, derived): `tenant_id NN; kind NN; position_id NN; path ltree NN; depth int NN; model_version bigint NN; subtree_count int`. PK `(tenant_id, kind, position_id)`; GiST on `path`. Never a source of truth; **never read by the engine**.

**`customer_servicing`** (ENT-08, B): `id; tenant_id; customer_id NN → participant; servicing_position_id → position (NULL = company); source text NN; valid_from NN; valid_to; case_id`. `EXCLUDE` overlapping ranges per customer (BR-ATT-01: one serviced-by at a time).

### 2.3 Event → row effects (SDD-08 §2; worked example)

B under S1. Day 200: approved **change** moves B to S2 effective day 201. Day 300: **correction** says C (enrolled day 10 under S1) belonged under S3 from day 10.

| Event | Rows before | Rows after | Committed periods |
|---|---|---|---|
| Enrolment of B under S1, day 1 | — | `(S1→B, valid [1,∞), recorded 1)` | none |
| **Change** B→S2 eff. 201, recorded 200 | `(S1→B, valid [1,∞))` | `(S1→B, valid [1,201), recorded 1)` closed; `(S2→B, valid [201,∞), recorded 200)` | none (past validity unchanged) |
| **Correction** C→S3 from 10, recorded 300 | `(S1→C, valid [10,∞), recorded 10)` | `(S1→C, valid [10,∞), recorded 10, superseded 300)`; `(S3→C, valid [10,∞), recorded 300)` | periods day 10..300 **flagged**; replay unchanged (their `known_at` < 300); restatement policy decides |
| Termination of B, day 250 | — | no relationship change; `position.status = terminated` from 250 | none |
| Rule-generated change (e.g. loss of sponsorship rights) | — | as a change with `event_type = rule` + rule id | none |

- **Change** (BR-GEN-03): effective from an approved **current or future** date; never alters committed periods. Closes current row at effective date (`valid_to`), inserts new row.
- **Correction** (BR-GEN-04): records the **original** valid date; supersedes old row (`superseded_at`), inserts corrected row; committed periods it affects are flagged → restatement policy (BR-PER-05). At (P, T).
- **Subtree move**: one change row for the subtree root; descendants keep their rows; read model rebuilds the subtree paths (SDD-08 §8).
- **Re-parenting on termination** (BR-GEN-08, V-level rule): dated change event generated by a stated rule per plan version; goes through the same event path as approved cases, **rule id as approver** (FR-GEN-009). TS-64.
- **Reinstatement** (BR-GEN-11): status event on the **same position**; rank and placement after return follow a plan-version rule. TS-64.
- **Merge of duplicates**: case decides surviving participant; position ownership transferred; positions + history remain. Merge that would create a cycle or double-ownership conflict is **blocked** (FR-PAR-003).
- **Transfer / succession / divorce / sale** (V1, BR-GEN-10, FR-PAR-004): new `position_ownership` row from effective date; tree unchanged; new payee needs tax profile + bank details under change controls.

### 2.4 Bitemporal query — "tree as of D, as known at T" (FR-GEN-003)

```sql
SELECT child_position_id, parent_position_id, leg
FROM   relationship
WHERE  tenant_id = :tenant AND kind = :kind
  AND  valid_from <= :D AND (valid_to IS NULL OR valid_to > :D)
  AND  recorded_at <= :T AND (superseded_at IS NULL OR superseded_at > :T);
```

- `T = now` → current knowledge. `T = run.snapshot.known_at` → exactly what the run saw.
- Validation: `known_at` not in the future (FR-GEN-003).
- Staff as-of history view: recursive query on `relationship` with this predicate, **depth-limited and paginated**; lazy by depth. API-14 `GET /v1/genealogy/tree` (`genealogy.read`). SC-07.
- AC-01.1: correction to B's sponsor recorded today, valid 1 March → as of 15 March known 1 April shows **old** sponsor; known today shows **new** sponsor.

### 2.5 Writing relationships safely (SDD-08 §4) — `RelationshipStore.apply(kind, child, newParent, validFrom, eventType, caseId)`

Single transaction, in order:
1. `BEGIN; pg_advisory_xact_lock(tenant, kind)` — serialises structural writes per (tenant, tree kind). Binary auto-placement: lock per **target leg** where contention is measured (FR-GEN-005, BR-GEN-06).
2. Validate parent exists, active, same tenant and same tree.
3. **Cycle check**: walk upline of `newParent` as of `validFrom`; fail if `child` found. Uses `path_node` when current, recursive query on `relationship` when stale; depth-bounded.
4. (placement) width/leg free at `validFrom`, else deterministic next slot.
5. Close (`valid_to`) or supersede (`superseded_at`) the current row.
6. Insert new row (exclusion constraint guards overlaps).
7. Outbox: `GenealogyChanged(tenant, kind, child, validFrom)`; set read-model **stale flag** in the same transaction.
8. `COMMIT`.

Only callers: enrolment, approved case, or rule (FR-GEN-002 permissions: "only through enrolment or an approved case").

**Validation errors**

| Code | HTTP | Meaning |
|---|---|---|
| `GEN_CYCLE` | 409 | proposed parent is a descendant; **no row written** (AC-02.2, TS-45) |
| `GEN_SLOT_TAKEN` | — | placement slot occupied; enrolment retries with deterministic alternative (FR-PAR-002) |
| `OUTSIDE_CHANGE_WINDOW` | — | rejected with window rule shown, or routed to exception approver if plan allows (AC-02.1) |
| `AFFECTS_COMMITTED_PERIOD` | — | **warning**, not refusal; routes to restatement policy (FL-07) |
| overlap / parent in other tenant or tree | — | refused (FR-GEN-002) |

### 2.6 Placement (FR-GEN-005, **Could**, B; OQ-13)

- Plan rule examples: outside leg, weakest leg, left-to-right breadth-first.
- Tie-break: **enrolment time, then position id**; tie-break stored on the case or enrolment record.
- Concurrency: lock target leg → find slot → insert → release. Lock timeout → retry. Slot must be free at commit.
- AC-42.1 / TS-45: two concurrent enrolments into one binary slot → exactly one takes it; the other placed by plan rule with tie-break recorded.
- Pairing primitive itself is **Could** (SDD-07 §3.1) even though TS-04 is tagged B.

### 2.7 Change / correction cases (FR-GEN-004; API-15; SC-08)

Flow: Support agent files (`case.genealogy.create`) → policy check (change window + approvals from plan-version params, BR-GEN-05) → simulate cycle + occupancy → for corrections compute **affected committed periods + estimated payout impact** (shown before approval, AC-03.1) → Compliance officer approves (`case.genealogy.approve`; `POST /v1/genealogy-cases/{id}/decision`) → apply via §2.5 → route affected periods to restatement → notifications → read-model rebuild job. Evidence required. Idempotency-Key required.

AC-03.2 / TS-61: approved change with future effective date → when the date arrives the new row is valid; no committed period output changes on replay; earlier row closed, not updated in place.

---

## 3. Path read model (FR-GEN-008, BR-GEN-12; SDD-08 §5–6)

| Workload | Strategy |
|---|---|
| Calculation | **Not** `path_node`. Snapshot loaded once into flat arrays (§6.4) |
| Interactive subtree | `path <@ :ancestor_path` (GiST) |
| Upline | `path @> :node_path` |
| Authorisation | `ltree` compare of viewer and target paths; depth = level difference; one index lookup |
| As-of history | recursive bitemporal query on `relationship`, depth-limited, paginated, staff only |
| Org reporting | volume summaries stored per position by each committed run, aggregated by path prefix; no live recursion |

Rejected: closure table (N×depth rows; moves rewrite many rows), nested sets (write cost), graph DB (second store).

**Rebuild pipeline**: `GenealogyChanged(tenant, kind, subtree root)` → rebuild job → scope: leaf/small subtree ⇒ update subtree paths in batches; large subtree ⇒ build new model version in background → bump `model_version` (atomic switch) → invalidate subtree counts + team-list caches for affected viewers → clear stale flag.

| Item | Rule |
|---|---|
| Source of truth | `relationship`; `path_node` rebuildable any time |
| Staleness | stale flag set in the **same transaction** as the write; cleared when rebuild commits |
| Authorisation while stale | recursive check on `relationship` for the specific pair; if it cannot finish within its limit ⇒ **DENY**. A stale model never widens access (TS-64) |
| Cache keys | `(tenant, kind, model_version, position)`; new version makes old keys unreachable. Cache only subtree counts + first-level lists |
| Not cached | anything derived from open-period volumes |
| Scope | read model = valid-now, known-now only; history from system of record |
| Consistency | nightly: `count(path_node)` = active positions; sampled paths verified vs `relationship` (FR-GEN-008 validation "path count equals active position count") |
| Rebuild failure | retry; views keep stale notice; authz falls back to SoR check |

`ltree` limits: label ≤ 1,000 chars; path ≤ 65,535 labels. Depth-5,000 binary leg path/index size = **spike** (OQ-29). Fallback: chunked path with skip pointers every k levels; ancestor test in ≤ depth ÷ k steps.

Targets (proposed, NFR): NFR-PERF-07 authz check p95 ≤ 100 ms, subtree page p95 ≤ 300 ms; NFR-PERF-08 rebuild after moving a 100,000-position subtree ≤ 10 min without blocking writes.

### 3.1 Visibility policy (FR-GEN-006/007, BR-DAT-03; SDD-08 §7)

Tenant setting (safe default shipped; edited by Tenant admin with DPO approval; policy version recorded on response logs). Enforced server-side in `VisibilityPolicy` for **every** portal endpoint.

| Viewer → target | Default fields |
|---|---|
| Self | all own data |
| Personally sponsored (depth 1, sponsor tree) | name, rank, status, contact (if tenant enables), personal volume |
| Depth 2..n (n = tenant setting) | name, rank, status |
| Beyond n | counts and volume aggregates only (AC-05.1: API returns aggregates, not hidden client-side) |
| Outside downline | nothing; **404 identical to not found** (AC-05.2, TS-20) |
| Customers | only servicing distributor sees a customer; uplines see counts |

Explorer (FR-GEN-007): opens on search + focused node; lazy expand; depth and breadth caps per request; counts for collapsed branches; breadcrumbs to root; staff search by id/name/rank; distributors per FR-GEN-006; stale banner. APIs: API-13 `GET /v1/positions/{id}/downline` (`genealogy.read` / self downline), API-34 `GET /v1/me/team` (portal, self downline). Export limits + rate limits; scraping patterns alert (SEC-45).

---

## 4. Order and attribution inputs the engine consumes

| Fact | Rule | Release |
|---|---|---|
| Order identity | unique per `(tenant_id, source_system, source_order_id)`; replay same body ⇒ 200 no-op; same key different body ⇒ 409 (BR-ORD-04, TS-15) | B |
| Fixed at ingestion | buyer participant type (`buyer_type_id`, BR-ORD-01), purpose, attribution, line volumes — never recomputed from master data (BR-ATT-02, FR-ORD-003). Corrections arrive as new order events | B |
| Purpose | `order.purpose ∈ (resale, personal, unspecified, customer)`; required-but-missing ⇒ stored `unspecified`, counted in data quality (TS-65) | B |
| Line volumes | from `product_volume_map` effective at **crediting event time** (BR-VOL-01); `volumes jsonb` = named measures (e.g. `qv`, `cv`) in minor units per unit | B |
| Period assignment | crediting event (payment · shipment · end of cooling-off) — **D-R1 unresolved**, configurable per plan version, no default shipped; converted to calendar time zone; half-open `[start, end)` (BR-PER-02, TS-62) | B |
| Returns | reverse volume **per returned line**, proportional (BR-RET-01, BR-VOL-03); returned qty ≤ purchased − already returned | B |
| Exchange | equal-value flagged exchange: no reversal, no re-credit (BR-RET-02, TS-47) | B |
| Restocking fee | reduces refund; volume effect = tenant setting (BR-RET-03, TS-65) | B |
| Chargeback | treated like refund for volume and pay (BR-REV-06) | B |
| `order_event.type` | `refund, return, exchange, chargeback, chargeback_reversed, renewal_failed, cancelled` | B (subscription events FR-ORD-006 V1) |
| Late transaction | order/event whose crediting time is in a **Committed** period ⇒ `late_transaction` (`handling ∈ (adjust, restatement)`, consumed once, `consumed_by_run_id`); default = adjustment in current open period linked to original period (BR-PER-04, FR-ORD-005, TS-13) | B |
| Attribution | decided at ingestion from link, code, enrolment or servicing relationship by tenant precedence rule; conflicting claims ⇒ case (FR-CRM-001) | B |
| Fractional roll-up | customer volume split is a plan parameter applied at calculation, e.g. 70/30 (BR-ATT-04, TS-65) | B |
| Reassignment on termination | tenant rule (sponsor, company, customer choice), effective-dated, optional notice; past orders keep attribution; no eligible target ⇒ company (BR-ATT-03, FR-CRM-002, TS-49) | B |
| Sync guard | run may not start while order sync lag > tenant threshold at cut-off (BR-ORD-05, AC-06.2: refused with last successful sync time) | B |

Participant types (BR-PTY-01, **A**): tenant-defined flags `can_earn`, `counts_as_end_customer`, `can_sponsor`, `can_hold_positions`; flags immutable once referenced by a committed run (new code instead). Type assignment effective-dated, `EXCLUDE` overlaps; changes never re-label past orders (BR-PTY-02, TS-48).

Participant record (FR-PAR-001): external id unique per tenant; market Live; **one active type at any time**; type definitions by Tenant admin with Compliance officer approval; Support agent creates. Entities `participant`, `participant_type`, `participant_type_assignment`.

Duplicates (FR-PAR-003, BR-GEN-09): new/changed participants compared on identity reference, payment fingerprint, address, device signals (**hash comparison only**; raw payment data never stored); deterministic matching with tenant thresholds; match ⇒ duplicate case and, where tenant enables, **hold activation or payouts** until decided (AC-43.1); outcomes merge / allow with reason / terminate; Support agent investigates, Compliance officer decides. API-30, SC-08.

Position status (FR-PAR-005): `Pending, Active, Suspended, Terminated`; each change dated with reason + actor; termination for cause needs human approver (Compliance officer); open payouts follow tenant policy (hold or pay); customers reassigned (FR-CRM-002); effective date not before last committed period end unless handled as correction (back-dated ⇒ restatement policy).

Agreements (FR-PAR-006, BR-REG-05 **B-MKT**, Should): agreement versions per market; acceptance stored with version + time; missing acceptance at enrolment blocked where the pack requires (AC-42.2); Compliance officer publishes versions.

Order ingestion validation (FR-ORD-001): totals = sum of lines; currency = market currency (MVP single currency); buyer exists or is created as customer; unknown product ⇒ order held in exception queue; market not Live ⇒ rejected (TS-50); key without `orders:write` ⇒ 403, nothing stored (AC-22.3). Returns (FR-ORD-004): original period open ⇒ adjust inputs, else create `late_transaction` for the reversal policy; unknown order ⇒ held for retry, alert after timeout. Late queue (FR-ORD-005): analyst (`late.manage`, SC-32) may accept default handling in bulk with preview.

Enrolment (FR-PAR-002, API-12 `POST /v1/participants`): only for a **Live** market (else 422 `MARKET_NOT_LIVE`); sponsor must exist, be active and `can_sponsor`; duplicate checks; creates participant + initial position (if type holds positions) + sponsor + placement relationships in **one transaction**; agreement acceptance where pack requires (AC-42.2, B-MKT); household rule check where plan declares one.

---

## 5. Plan / version / rule model (FR-PLN-*, ENT-11)

### 5.1 Entities

| Table | Key columns | Constraints |
|---|---|---|
| `plan` | `id, tenant_id, name, brand_id, market_ids uuid[]` | UQ `(tenant_id, name)` |
| `plan_version` | `id, plan_id, version int, state, effective_from, justification, engine_version NN, filing_status jsonb, notice_sent_at, approval_id, content_hash bytea` | UQ `(plan_id, version)`; idx `(plan_id, effective_from)`; `state ∈ (draft, in_review, approved, scheduled, active, retired)`; rules immutable from **approved** onward |
| `plan_rule` | `id, plan_version_id, rule_key, kind, pass text, params jsonb, depends_on text[], reversal_policy` | UQ `(plan_version_id, rule_key)`; `kind` from primitive catalogue or `expression` or `module`; dependency graph **acyclic** |
| `plan_transition` | `id, to_version_id, state_item, rule, params` | UQ `(to_version_id, state_item)`; `rule ∈ (carry, map, reset)` |
| `golden_dataset` | `id, tenant_id (NULL = platform), plan_version_id, name, input_doc_id, expected_doc_id, last_result` | expected totals = sum of expected lines |
| `simulation` | `id, plan_version_id, period_id, baseline_run_id, kind, state, totals, requested_by` | `kind ∈ (simulation, parallel_run, restatement_sandbox)`; results in `sim_result_line` (same shape as `result_line`) |

### 5.2 Version lifecycle (FR-PLN-001, FR-PLN-007)

`Draft → In review → Approved → Scheduled → Active → Retired`

| Gate | Rule |
|---|---|
| Save | schema + reference validation; guardrail evaluation on save (blocked ⇒ refused with rule id, TS-27; warned ⇒ acknowledgement, TS-26) |
| Effective date | at a **period boundary of every calendar** the plan uses |
| Activation blocked unless | full-historical-period simulation exists (BR-PLN-02, AC-10.2); all golden cases reproduce exactly (BR-PLN-06; AC-10.3 blocks **submission for review** with the failing lines; FR-PLN-006 failures block activation and engine release; TS-46); filing status recorded where pack requires (BR-PLN-03, **B-MKT**, AC-27.1); notice period (tenant setting) met (BR-PLN-04, TS-68); every state item has a declared transition (FR-PLN-008) |
| Approvals | Plan administrator edits (`plan.edit`); Compliance officer approves; **second approver activates** (`plan.approve`); preparer cannot approve (TS-42) |
| One version per run | run uses exactly one plan version chosen by effective date (BR-CMP-01) |
| Immutability | activated version immutable; `content_hash`; diff available at every state |

API-16: `POST /v1/plans/{id}/versions`; `…/{v}/submit`, `…/approve`, `…/schedule`; If-Match version; Idempotency-Key on transitions. SC-04, SC-05, SC-44.

### 5.3 Rule document shape (SDD-07 §3; hypothetical values)

A plan version = document of rules. Each rule: `key`, `kind`, params, `pass`, declared dependencies. Every **bonus** must name **tree**, **measure**, **reversal policy** (FR-PLN-002 validation). Errors: unknown measure; cyclic dependency.

```json
{
  "plan": "Core plan", "version": 7, "effective_from": "2027-02-01T00:00:00+08:00",
  "calendars": ["monthly"],
  "measures": [
    {"key": "pv",  "kind": "volume.personal", "source": "line.volumes.qv", "exclude_item_classes": ["starter_kit", "sample"]},
    {"key": "cv",  "kind": "volume.line",     "source": "line.volumes.cv"},
    {"key": "gv",  "kind": "volume.group",    "of": "pv", "tree": "sponsor", "include_self": true},
    {"key": "active_customers", "kind": "count.customers", "window": {"type": "period"}, "min_order_volume": 1}
  ],
  "ladders": [{"key": "main", "ranks": [
      {"key": "R1", "requires": [{"measure": "pv", "gte": 100}]},
      {"key": "R2", "requires": [{"measure": "gv", "gte": 700}, {"measure": "active_customers", "gte": 2}],
       "maintenance": {"grace_periods": 1}}]}],
  "bonuses": [
    {"key": "retail", "kind": "pay.retail_margin", "source_kind": "retail_sale", "rate": 0.25, "reversal_policy": "order_line"},
    {"key": "unilevel", "kind": "pay.percent_by_level", "tree": "sponsor", "measure": "cv",
     "levels": [0.08, 0.05, 0.04, 0.04, 0.04], "compression": "dynamic", "requires_rank": "R1",
     "source_kind": "downline_volume", "reversal_policy": "order_line"},
    {"key": "rank_bonus", "kind": "pay.percent_of_measure", "measure": "gv",
     "by_rank": {"R1": 0.05, "R2": 0.10}, "source_kind": "downline_volume", "reversal_policy": "restatement"},
    {"key": "match", "kind": "pay.matching", "of": ["rank_bonus"], "tree": "sponsor", "generations": 1, "rate": 0.20,
     "source_kind": "match", "reversal_policy": "restatement"},
    {"key": "pool", "kind": "pay.pool", "base": {"measure": "cv", "scope": "market"}, "rate": 0.0625,
     "allocation": {"type": "shares", "by_rank": {"R2": 1}}, "source_kind": "pool"}
  ],
  "caps": [{"key": "cap_leaders", "scope": ["rank_bonus", "match"], "base": {"expr": "net_sales(market)"}, "rate": 0.10,
     "method": {"type": "priority", "reduce": ["match"]}, "residue": "retain_as_breakage"}],
  "transitions": [{"state_item": "carry.*", "rule": "carry"}, {"state_item": "titles.main", "rule": "map", "map": {"Leader": "R2"}}]
}
```

Enums visible in the example: measure kinds `volume.personal`, `volume.line`, `volume.group`, `count.customers`; bonus kinds `pay.retail_margin`, `pay.percent_by_level`, `pay.percent_of_measure`, `pay.matching`, `pay.pool`; `reversal_policy ∈ {order_line, restatement}` (+ write-off threshold as tenant setting); `source_kind ∈ {retail_sale, downline_volume, match, pool}` (also `clawback` in TS-31 lines); `compression: "dynamic"`; cap `method.type ∈ {proportional, priority, per_person}`; `residue: "retain_as_breakage"`; allocation `type ∈ {shares, rank_order, first_n}`. The full JSON schema for the catalogue is **not written** in any source — engineers must define it (see Open).

### 5.4 Primitive catalogue (tier 1; SDD-07 §3.1, FR-PLN-002) — all B

| Family | Kinds | Corpus count (of 21) |
|---|---|---|
| Volume measures | personal, line, group, personally-enrolled group, derived expression; per-line item rules (exclude item classes, tax-exclusive base, category crediting) | 19–21; item rules 4 |
| Counts | customers, personally enrolled, qualified legs; each with own definition of "active" | 14 |
| Hierarchy | sponsor tree; placement tree with legs (data model now; **pairing Could**) | 21; 7 |
| Qualification | thresholds, leg limits, windows (period, rolling n, per order), profile-fact predicates | 21; 15; 8 |
| Ladders | several per participant; paid-as and title; maintenance, grace, demotion | 9–13 |
| Payout functions | retail margin; percent by level; generations with compression; differential; override; matching; fast start; flat and one-time; pool (shares, rank-ordered, first-N) | 16; 16; 10; 10; 16; 10; 5 |
| Limits | per order, per period, per person, scoped company caps with method + residue | 13 |
| State | carry with conditions, cap, expiry; streak counters; one-time flags; banked points | 8; 10 |
| Timing | several calendars; pay-date rules | 11 |
| Conversion | points-to-currency factor, effective-dated per market (BR-MNY-05, TS-23) | 4 |
| Attribution | fractional roll-up of customer volume (BR-ATT-04) | 4 |

### 5.5 Exact primitive semantics (as fixed by the test oracle)

All arithmetic: `Decimal`, exact; `r2(x)` = quantize to 0.01 **ROUND_HALF_UP**. Rounding once per payout line (§7).

| Primitive | Semantics | Proof |
|---|---|---|
| **percent_by_level (unilevel)** | For payee P, level k = k-th generation below P in the named tree. `pay = Σ_k rate[k] × measure(level k)`; levels beyond `len(rates)` pay 0 | TS-01 |
| **compression (dynamic)** | Calculation-time only (BR-GEN-07). Walking down the chain, an **inactive** (non-qualified) position **does not consume a level**; its own volume is **not paid** in either mode. Without compression an inactive position consumes its level and that level pays 0. Relationship rows unchanged | TS-02, AC-44.2 |
| **retail margin** | `rate × serviced customers' order value` attributed to the position | E2E |
| **percent_of_measure by rank** | `rate[paid_as_rank] × measure` (e.g. GV) | E2E, TS-10 |
| **matching** | `rate × Σ(pass-4 bonuses named in "of")` of positions `generations` below in the tree; runs **after** individual bonuses (pass 5); **never** on a reversed bonus (TR-ENG-16) | TS-44, E2E |
| **override** | `rate × measure` (TS-43: 3% × 6,000 = 180.00) | TS-43 |
| **differential** | `(own_rate − downline_rate) × measure` (TS-43: (21% − 15%) × 6,000 = 360.00). The plan rule must state override vs differential | TS-43 |
| **fast start** | `min(rate × order, per-order cap)` per tier (TS-12: 20% cap 200; upline 10% cap 80 on order 1,200 ⇒ 200, 80); one-time bonuses use once-only keys | TS-12, TS-25 |
| **binary pairing** (Could) | `n = min(L // (lu×unit), R // (ru×unit))`; `carryL = L − n×lu×unit`; `carryR = R − n×ru×unit` | TS-04 |
| **carry-forward** | `carry = min(prev + new, cap) if qualified else 0` | TS-05 |
| **pool** | base scoped by market × rate; allocation by shares / rank order / first-N; split by **largest remainder** with deterministic ties | TS-06 |
| **caps** | scope (bonus types), base expression, rate, method (proportional / priority list / per person), residue rule (BR-CAP-01). Per-participant constraints **before** company caps (BR-CAP-02). Simulation shows payees affected + amounts removed per cap (BR-CAP-03) | TS-07..09, TS-12 |
| **cap/pool config validation** (FR-PLN-004) | scope bonuses must exist; priority list must cover the scope; residue rule must be set; scope overlapping another cap without stated precedence ⇒ error; preview on a chosen historical period shows payees affected + amounts removed. Plan administrator, SC-05, API-16/17 | AC-11.1, AC-11.2 |
| **cap: proportional** | factor = cap ÷ proposed; scaled lines allocated by largest remainder so they sum **exactly** to cap | TS-07, TS-08 |
| **cap: priority** | reduce listed bonuses in order until within cap; remaining excess (if any) then reduced proportionally (E2E: matching first, then rank bonus by largest remainder) | TS-08, E2E |
| **cap: order-structure base** (expression/module) | if `G2/(G1+G2) > 1/3` then base = `1.5 × G1` else `G1+G2`; cap = `r2(base × rate)`; applied only to in-scope lines; out-of-scope untouched | TS-09 |
| **qualification / ladders** | paid-as rank per ladder per period **and** highest-achieved title stored separately (BR-RNK-05); windows per requirement: period-end, rolling n periods, per order (BR-RNK-06); several ladders per participant (BR-RNK-09); maintenance, grace, demotion | TS-63, AC-46.1 |
| **points → currency** | effective-dated factor per market; each period uses its own factor; shown on statement | TS-23 |

**Largest-remainder algorithm (normative; BR-MNY-03, FR-COMP-012):**

```python
def largest_remainder(total, weights, keys=None):
    keys = keys or list(range(len(weights))); ws = sum(weights)
    raw = [total * w / ws for w in weights]
    fl  = [x.quantize(CENT, rounding=ROUND_DOWN) for x in raw]
    left = int(((total - sum(fl)) / CENT).to_integral_value())
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - fl[i]), keys[i]))  # frac desc, then key asc
    for i in order[:left]: fl[i] += CENT
    return fl
```
Tie-break check: 100.00 over 3 equal shares, keys P1,P2,P3 ⇒ `[33.34, 33.33, 33.33]`.

### 5.6 Extension point (ADR-05, FR-PLN-003, BR-PLN-05)

| Tier | What | Author | Controls |
|---|---|---|---|
| 1 Primitives | catalogue §5.4 | Plan administrator | schema validation, guardrails, simulation |
| 2 Expressions | typed, pure language over measures, state, profile facts: decimal arithmetic, comparisons, `min`, `max`, `if`, aggregations over declared scope. **No loops, no I/O, bounded evaluation cost** | Implementation consultant | type check; **≥1 golden case per expression**; recorded verbatim in traces. Errors: type error; evaluation bound exceeded |
| 3 Platform modules | named, parameterised calculation in platform codebase behind fixed interface (in: snapshot view + params; out: lines or state); available to **every** tenant | Vendor engineers only | code review; golden tests; engine version bump; **never tenant-specific** |

Start as tier 3 / events: requirement banking, volume transfers, credit-risk gating, sell-through gates, rotation assignment, household rule, rule-triggered genealogy change. Promote to primitive when a second tenant needs it. TS-67 static check: no branch on a tenant identifier in engine code; no binary float in money paths.

### 5.7 Transitions (FR-PLN-008, BR-PLN-01)

Each new version declares per state item (titles, carry balances, streak counters, banked points, one-time flags): `carry` | `map` | `reset` (with reason). Undeclared item ⇒ activation blocked. Applied in **pass 0 of the first run** under the new version; before and after stored; **transition report** lists every participant whose state changed (AC-27.2). TS-24: streak 24 carried ⇒ 25 after first period under new version.

---

## 6. Run model and execution

### 6.1 Engine contract (SDD-07 §2)

`Run = f(snapshot, plan version, settings version, market-pack version, engine version)` — nothing else. Engine: **no clock, no randomness, no I/O, defined iteration order**. Portable package (could be compiled for another runtime).

| Inputs (read-only) | Outputs |
|---|---|
| orders + order events up to watermark | result lines + compact traces |
| tree snapshot (valid at period end, known at T) | qualification state candidates |
| prior qualification state (last committed run) | volume summaries per position |
| compiled plan version | tax lines |
| settings version + market pack | control totals + ordered hash |
| adjustment origins (late items, cases, restatements) | warnings and exceptions |
| tax profiles as of pay date | |

Orchestrator (module COMP) owns all I/O; stores outputs in staging keyed by run id.

### 6.2 Entities (ENT-12..15)

| Table | Columns | Constraints |
|---|---|---|
| `calendar` | `id, tenant_id, market_id, name, cadence, cutoff_time_zone` | UQ `(tenant_id, market_id, name)` |
| `period` | `id, calendar_id, starts_at, ends_at, state, committed_run_id` | UQ `(calendar_id, starts_at)`; `state ∈ (open, calculating, calculated, committed, paid, closed)`; EXCLUDE overlapping ranges per calendar; ≤1 committed run |
| `run` | `id, period_id, run_request_id, plan_version_id, settings_version_id, snapshot_id, engine_version, state, totals jsonb, lines_hash bytea, prepared_by, approval_id, started_at, finished_at` | UQ `(tenant_id, period_id, run_request_id)`; `state ∈ (queued, running, failed, calculated, committed, discarded)`; one committed per period |
| `run_snapshot` | `id, period_id, known_at NN, order_watermark bigint NN, prior_state_run_id, manifest_doc_id, inputs_hash bytea NN` | immutable; committed snapshots retained for legal retention period |
| `result_line` | `id, run_id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass, amount_minor bigint, currency char(3), origin_type, origin_id, trace jsonb` | partitioned by period; insert-only; `Σ amount_minor per run = run.totals.gross`; UQ `(run_id, origin_type, origin_id)` where origin_id NOT NULL |
| `qualification_state` | `run_id, position_id, paid_as_rank jsonb, highest_titles jsonb, counters jsonb, carry jsonb, one_time_flags text[], banked jsonb` | PK `(run_id, position_id)`; authoritative **only when run committed**; insert-only |
| `restatement` | `id, period_id, case_id, simulation_id, diff_doc_id, state, applied_in_run_id` | `state ∈ (requested, calculated, approved, applied, rejected)` |

### 6.3 Period state machine (FR-COMP-001, BR-PER-03, SDD-07 §5)

```
[*] → Open
Open → Calculating            run requested after cut-off, sync healthy
Calculating → Calculated      run finished, invariants pass
Calculating → Open            run failed (first run)
Calculated → Calculating      re-run (inputs or plan fixed)
Calculated → Committed        approved by non-preparer (step-up)
Committed → Paid              all payout instructions terminal (settled, or returned/failed and resolved)
Paid → Closed                 reconciliation signed off
Committed → Committed         late item → adjustment in open period / restatement request
```
At Committed: inputs + outputs frozen, ledger entry posted, state authoritative. Illegal transition ⇒ 409. Events: `PeriodCutOff`, `PeriodCommitted`, `PeriodClosed`. Permissions: Commission analyst operates (`period.read`, `run.execute`); Finance approver commits (`run.commit`, MFA step-up AAL2 fresh).

| Period rule | Design |
|---|---|
| Assignment | crediting event (D-R1) in calendar time zone; `[start, end)`; TS-62: ±1 s around cut-off on weekly + monthly calendars |
| Several calendars | each has own periods and runs; a monthly run may read weekly-run state through declared dependencies (BR-PER-01) |
| Late transactions | detected at ingestion when target period ≥ Committed; queued with estimated effect; default handling by bonus reversal policy |
| Run lock | advisory lock on `(tenant, calendar, period)`; unique `(tenant, period, run_request_id)` (BR-PER-06) |
| Cut-off guard | ingestion watermark past cut-off **and** sync health = Healthy |
| Provisional runs | **V1** (FR-COMP-011, BR-PER-07): provisional commits and pays; final run posts only the difference; validation final − provisional = true-up per payee; negative true-up via clawback policy |

### 6.4 Run lifecycle (run.state) and transactions (SDD-07 §7, §12; FR-COMP-002)

`queued → running → calculated → committed`; `running → failed`; `calculated → discarded` (superseded by re-run; staged lines dropped by partition).

| Step | Transaction |
|---|---|
| Start | insert `run_snapshot` + `run (queued)`; acquire advisory lock; duplicate request ⇒ same run id (AC-06.3, TS-14); lock held ⇒ return running run id |
| Calculate | worker writes staged result lines + state candidates **in batches** under run id; visible only through the run; progress reported |
| Commit (API-20, `run.commit`, not preparer, Idempotency-Key) | **one transaction**: `run.state = committed`; `period.state = committed`, `committed_run_id`; state candidates authoritative; journal entry + postings (expense, payables, withholding, residue); adjustment origins marked consumed; outbox `RunCommitted`. Deferred constraints: entry balances, totals match. Approver = preparer ⇒ refused (AC-07.1) |
| After commit | workers build statements, compliance facts (`cpl_fact_*`), exports from outbox |

Preconditions to run: period at cut-off, state Open or Calculated; plan version active for period; snapshot complete; prior committed state exists (else "period cannot be calculated; migration required", FR-COMP-004).

| Failure | Behaviour |
|---|---|
| Worker dies | run `failed`; staged output dropped; restart reuses snapshot |
| Invariant fails | run `failed` with violated invariant + offending lines; nothing committable |
| OOM | as crash; tenant moved to larger worker class |
| Plan compile error | impossible by design (only approved, compiled versions runnable); if it happens run fails |
| Two run requests | second returns first's run id |
| Engine defect after commit | fix in new engine version; affected periods corrected by restatement; old version kept for replay |
| Overflow on extreme values | run fails (FR-COMP-012) |

### 6.5 Snapshot (SDD-07 §6)

| Versioned thing | Pinned on run |
|---|---|
| Plan | `plan_version_id` (immutable from approval, content hash) |
| Tenant settings | `settings_version_id` |
| Market pack | signed pack version in manifest |
| Engine | `engine_version` (semver; old versions remain runnable) |
| Inputs | `snapshot_id` |

| Input | Stored reference |
|---|---|
| Orders, lines, order events (insert-only) | ingestion sequence watermark (`order_watermark`) + period id |
| Genealogy (bitemporal, append-only) | `known_at`: rows recorded ≤ `known_at`, not superseded at `known_at`, valid at evaluation date |
| Prior state | `prior_state_run_id` |
| Adjustment origins | list of origin ids in manifest (consumed once) |
| Product volume map, participant types, tax profiles | evaluation dates (effective-dated, never updated in place) |

Manifest = JSON in object storage, hashed, with references + row counts. **`inputs_hash`** computed while loading; replay recomputes and **fails loudly on mismatch**.

**In-memory tree** (SDD-08 §5): load once into flat arrays `id[]`, `parentIndex[]` per kind, `status[]`, `owner[]`; topologically sort so children come after parents; group volumes by **one reverse pass** (O(N)); upline payments by following `parentIndex`. No SQL recursion. Snapshot load target 2M positions ≤ 2 min (proposed). Genealogy contract to engine: arrays of position ids, parent index per tree kind, status at evaluation date, owner; built once per run (SDD-07 §11).

### 6.6 Passes (SDD-07 §4) — fixed order

Inside a pass: rules in **dependency (topological) order**; payees in **ascending position id**. High-precision decimals until pass 10.

| # | Pass | Does |
|---|---|---|
| 0 | Transition | apply transition rules on first run of a new plan version; transition report |
| 1 | Line volume | each measure per order line; return/reversal effects of the period; item rules |
| 2 | Position volume | aggregate personal measures; one bottom-up pass for group measures; leg and roll-up measures (O(N)) |
| 3 | Qualification | requirements, windows, counts; paid-as rank per ladder; titles; maintenance + grace; counters + carry; stores what was evaluated and on which data |
| 4 | Individual bonuses | retail, level, generation, differential, override, fast start, flat, one-time (once-only keys) |
| 5 | Matching | % of other payees' pass-4 bonuses; never on a reversed bonus |
| 6 | Pools | base scoped by market; shares / rank order / first-N; deterministic ties; largest remainder |
| 7 | Per-participant constraints | e.g. max share of a participant's pay from personal-use volume; **before** company caps (BR-CAP-02) |
| 8 | Caps | scoped company caps: proportional (largest remainder), priority list, per person; residue per rule (TS-07/08/09) |
| 9 | Adjustments | late transactions, clawbacks by policy, manual adjustments, restatement differences — each with origin id (once-only, FR-COMP-010); included in control totals by category; origin withdrawn before run ⇒ skipped and logged; manual adjustments need reason code, evidence, case (BR-ADJ-01) |
| 10 | Minimums and rounding | points → currency by effective factor; **round once per payout line**; post residue lines (BR-MNY-02) |
| 11 | Netting and withholding | net clawback receivable against gross per payee; withholding from market pack + tax profile ⇒ tax lines; `gross = net + withholding` |
| 12 | Invariants and totals | TR-ENG-16 checks; control totals; ordered hash; failure aborts run |

**Invariants (TR-ENG-16, FR-COMP-003)**: lines sum to run total; every allocation sums to its total; no cap exceeded; no payout to a position terminated before the period unless the plan says so; matching never pays on a reversed bonus; `gross = net + withholding` per payee. Commit adds: ledger entry balances; `Σ payables + withholding + residue = run total` (FR-COMP-006, AC-14.2).

### 6.7 Determinism, trace, replay

- **Determinism**: fixed pass order; topological rule order; ascending position id; largest-remainder ties by fractional part desc then key asc; decimal only (BR-MNY-01; binary float prohibited, TS-67); no clock/random/I/O. Spike item: hash equality across machines and builds.
- **Ordered hash**: `run.lines_hash` = hash of ordered result lines (ordering beyond pass/rule/payee not specified — see Open).
- **Compact trace** (~1 KB, `result_line.trace`):

```json
{"rule": "unilevel", "pass": 4, "plan_version": 7, "engine": "1.4.2",
 "payee_position": "POS-000123", "rank_evaluated": {"main": "R1"},
 "inputs": {"level": 2, "source_position": "POS-000456", "measure": "cv", "volume_minor": 250000,
            "orders": ["ord_…a1", "ord_…b7"], "compressed_over": ["POS-000321"]},
 "rate": "0.05", "raw": "12500.00", "cap": null, "rounding": {"mode": "half_up", "to_minor": 12500},
 "tree_ref": {"kind": "sponsor", "known_at": "2027-03-01T02:00:00Z"}}
```
  Full detail by replaying the rule for that payee (FR-COMP-007, API-21 `GET /v1/result-lines/{id}/trace`, `trace.read`). Trace totals = line amount. Distributors see a template from the compact trace, downline sources reduced per visibility policy (FR-DIST-002). Archived snapshot ⇒ async retrieval.
- **Replay** (FR-COMP-008, API-18 `POST …/replay`): load by manifest, run **pinned** engine version with pinned plan + settings, compare ordered hash with `run.lines_hash`. Hash equality required. Engine versions must stay runnable for the retention period. TS-03, AC-01.2, TS-60 (differential: new release vs previous on all golden datasets + sampled committed periods; zero unexplained differences or release blocked).
- **Volume summaries** per position and measure stored with the run for reporting and leader views; never recomputed live.

### 6.8 Reversals and restatements (SDD-07 §8; FR-COMP-009, BR-REV-07, BR-PER-05)

| Policy (per bonus) | Mechanics | Use |
|---|---|---|
| `order_line` (**default**, BR-REV-07) | refunded order in a committed period ⇒ negative lines equal to lines whose trace cites that order, **at amounts paid** | bonuses paid directly on the order |
| `restatement` | sandbox re-run of the original period for affected payees with corrected inputs; difference ⇒ adjustment lines | rank-dependent and matching bonuses |
| write-off threshold | receivable below tenant threshold written off **with approval** (BR-REV-08) | small amounts |

- Reversal lines always in the **open** period, linked to original period and order; committed lines never edited.
- Clawbacks post to payee clawback receivable; netted in pass 11; platform **never** debits a bank account (BR-REV-09).
- Restatement flow: Compliance officer requests (`restatement.request`, reason + evidence) → sandbox replay (`simulation.kind = restatement_sandbox`) → `diff = lines' − committed lines` per payee per bonus → review → Finance approver approves (**not the requester**, `restatement.approve`) → one adjustment origin per payee and bonus → included once in next open run → postings at commit. Committed period P unchanged; `replay(P)` still matches its hash. Diff totals = sum of adjustments; empty diff ⇒ closed, no action. API-22, SC-06, TS-51.
- D-R2 (may a reversal alter a closed period) **unresolved**; provisional default: adjust in open period; restatement only by approved request.

### 6.9 Simulation (SDD-07 §9; FR-PLN-005, -006; API-17 `plan.simulate`; SC-42)

| Use | Inputs | Output | Storage |
|---|---|---|---|
| Plan change | historical snapshot + draft version | per-payee + per-bonus diff vs committed run; distribution of change; cap effects; guardrail flags; totals reconcile to each run (AC-10.1) | `simulation`, `sim_result_line` |
| Golden dataset | fixture inputs | exact expected lines; pass/fail line by line | `golden_dataset` |
| Parallel run (FR-MIG-002) | imported history + legacy payout file | per-payee difference with classification | `kind = parallel_run` |
| Restatement sandbox | committed snapshot + corrected inputs | diff | `kind = restatement_sandbox` |

Same engine code path and passes; a flag only redirects output. Simulations **never** write state, ledger or outbox. Requires a full historical period; missing snapshot ⇒ cannot simulate.

---

## 7. Money rules (BR-MNY, FR-COMP-012)

| Rule | Value |
|---|---|
| Representation | integers in **minor units**; intermediates fixed-precision decimals; binary float prohibited (BR-MNY-01) |
| Rounding | **once per payout line**, at pass 10; mode = tenant setting, platform default **half-up** (BR-MNY-02) |
| Splits / pools / scaled caps | largest remainder; ties by fractional part desc, then payee id asc (BR-MNY-03) |
| Residue | unavoidable residue posts to a named residue account (BR-MNY-04) |
| Points | effective-dated per market, shown on statement (BR-MNY-05) |
| Currency | MVP single currency per market (FR-ORD-001); multi-currency V1 (BR-CMP-09, FR-FIN-007) |

---

## 8. Golden test values (verified by `verify_calculations.py`: 55/55 ok)

| TS | Rel | Input | Expected |
|---|---|---|---|
| TS-01 | B | unilevel rates 8,5,4,4,4 %; level volumes 1,000; 2,500; 4,000; 6,000; 8,000 | 80.00, 125.00, 160.00, 240.00, 320.00; **total 925.00** |
| TS-02 | B | chain of 6, 2nd inactive; CV 1,000; 2,500; 4,000; 6,000; 8,000; 5,000; same rates | **800.00** without compression; **1,040.00** with; relationship rows unchanged |
| TS-03 | B | sponsor correction after commit, replay | hash equal; correction flagged with affected periods |
| TS-04 | B | binary 620 vs 900, ratio 2:3, unit 100 | **3 pairs; carry L 20, R 0** |
| TS-05 | B | carry prev 2,800 + 900, cap 3,000; next period +100 unqualified | **3,000 then 0** |
| TS-06 | B | pool 62,500.00 over 66 shares (40×1, 10×2, 2×3) | largest remainder sums **62,500.00**; naive per-share rounding **62,500.02** |
| TS-07 | B | 8 lines 1234.57, 987.65, 45.67, 0.37, 12.34, 6789.01, 333.33, 0.99 (Σ **9,403.93**); cap = r2(9,403.93 × 0.8856) | cap **8,328.12**; exact scaled Σ 8,328.12; naive **8,328.14** |
| TS-08 | B | cap 10% × 1,000,000 = 100,000; team 70,000, leadership 45,000 | priority(reduce leadership): **70,000.00 / 30,000.00**; proportional: **60,869.57 / 39,130.43** (moves 9,130.43) |
| TS-09 | B | G1 500,000, G2 300,000 (>⅓), net sales 1,000,000, in-scope 340,000, rate 41.75% | base **750,000**; ratio 75% < 80%; cap **313,125.00**; factor **0.9210**; out-of-scope untouched |
| TS-10 | B | rank bonus 10% if GV ≥ 700 else 5%; GV 800 incl. refunded 500; matching 20% | paid A **80.00**, C **16.00**; order-line clawback A **−50.00**, C **0.00** (leaves 30.00 / 16.00 vs true 15.00 / 3.00); restatement A **−65.00**, C **−13.00** |
| TS-11 | B | clawback 40.00 vs next earnings 25.00 | payable **0.00**; receivable **15.00** carried; write-off 15.00 only with approval; no debit instruction |
| TS-12 | B | fast start 20% cap 200/order; upline 10% cap 80; order 1,200 | 240 → **200.00**; 120 → **80.00** |
| TS-13 | B | order inside committed period | late queue; adjustment in open run linked; committed hash unchanged |
| TS-14 | B | 2 concurrent run requests | one run; same run id |
| TS-22 | B | 3 positions 100.10, 250.25, 49.65 | grouped per position; person total **400.00** |
| TS-23 | B | points factor changes between periods | each period own factor; shown |
| TS-24 | B | streak 24 + transition `carry` | **25** after first new-version period |
| TS-25 | B | one-time rank bonus; demote, re-qualify | not paid twice (once-only key) |
| TS-29 | B | 50k / 500k / 2M; balanced binary, deep-leg binary depth 5,000, wide unilevel | NFR-PERF-04 (mid-market full run ≤ 5 min), NFR-PERF-05 (2M ≤ 60 min, ≤ 8 GB) — spike |
| TS-43 | B | GV 6,000; override 3%; differential 21% − 15% | **180.00**; **360.00** |
| TS-44 | B | matching 10% of 10.00 and 480.00 | **1.00**; **48.00** (matching pass) |
| TS-45 | B | change outside window; cycle; concurrent slot | rejected with rule; `GEN_CYCLE`; exactly one takes slot |
| TS-47 | B | return 1 of 2 lines; equal-value exchange | only that line reversed; no reversal |
| TS-51 | B | restatement | diff stored; adjustments = diff; no posting edited; original hash unchanged |
| TS-60 | B | new engine vs previous on goldens + sampled replays | zero unexplained differences |
| TS-61 | B | enrolment, future-dated change, queries before/after | one row valid before, new row after; earlier closed not updated; no committed output change |
| TS-62 | B | ±1 s around cut-off, weekly + monthly | each order in correct period per calendar by configured crediting event |
| TS-63 | B | 2 ladders; title > paid-as; rolling 4-period requirement | both ladders, title, paid-as stored separately; exactly 4 periods used |
| TS-64 | B | reinstatement; rule re-parenting; stale-model authz | same position id; rows `event_type = rule` + rule id; fallback to SoR, never outside downline |
| TS-65 | B | restocking fee volume off/on; chargeback; missing purpose; 70/30 roll-up | refund reduced by fee; chargeback reverses like refund; `unspecified` counted; credited 70 and 30 |
| TS-67 | B | static checks | no float in money paths; no tenant-id branch in engine |
| — | B | largest remainder 100.00 over 3 equal shares | **33.34, 33.33, 33.33** (lowest key gets the cent) |

Non-numeric scenarios in this domain (spec.json, not in the oracle):

| TS | Rel | Scenario | Expected |
|---|---|---|---|
| TS-15 | B | duplicate order webhook | one order; second delivery acknowledged without change (AC-22.1) |
| TS-20 | B | leader requests node outside downline by id | 404 identical to unknown id (AC-05.2) |
| TS-26 | B | starter kit configured to carry commissionable volume | warning stored as guardrail decision; acknowledgement required |
| TS-27 | B | bonus triggered only by enrolment in a market whose pack bans it | save refused with rule id |
| TS-38 | B | commit gross 1,234.56, withholding 2.00% fixture | withholding **24.69**; payable **1,209.87**; entry balances |
| TS-42 | B | separation of duties on run commit, plan activation, adjustment (and batch approval) | preparer refused; different approver succeeds |
| TS-46 | B | activation without simulation; without filing status where pack requires; failing golden case | blocked in each case with reason |
| TS-48 | B | type change customer → distributor on 10 June; May recomputed | May orders remain customer orders |
| TS-49 | B | termination with reassignment rule = sponsor | customers move from effective date; past orders keep attribution |
| TS-50 | B | market not Live: enrolment and order | rejected `MARKET_NOT_LIVE` |
| TS-52 | B | parallel run with legacy payout file; import with genealogy cycle | per-payee difference report; sign-off blocked while unexplained differences; cyclic import blocked |
| TS-58 | B | sync lag above threshold at cut-off | run refused (AC-06.2 shows last successful sync time) |
| TS-59 | B | run review dataset; qualification-state direct edit; adjustment once-only; duplicate hold; agreement requirement; trace by replay | each behaves as its AC states (AC-06.1, AC-46.1/.2, AC-43.1, AC-42.2, AC-13.1, AC-03.2, AC-10.1 …) |
| TS-68 | B | activation scheduled sooner than tenant notice period | scheduling refused |

Clawback ACs: AC-20.1 order-line clawback line = commission paid on that order; AC-20.2 restatement adjustment = restated − paid for every affected payee incl. matching earners (TS-10); AC-20.3 clawback > next earnings ⇒ payable 0, remainder in receivable, no debit instruction (TS-11).

### 8.1 Worked end-to-end golden G-E2E-01 (QA-01 §6; oracle "E2E")

Tree (sponsor): A → B, A → C, B → D. Own orders: A 100, B 200, C 100, D 300. Serviced customers: K1 (by B) 400, K2 (by D) 150.
Plan: PV = own + serviced customers' orders; GV = PV self + sponsor downline; R1 if PV ≥ 100, R2 if GV ≥ 700; retail 25% of serviced customers' orders; unilevel 8% L1 PV, 5% L2 PV; rank bonus 5% GV at R1, 10% at R2; matching 20% of rank bonus of personally sponsored; cap: rank bonus + matching ≤ 20% of net sales, priority (matching first, then rank bonus proportional by largest remainder), residue not earned; withholding fixture 2% per payee.

| Step | A | B | C | D | Total |
|---|---|---|---|---|---|
| PV | 100 | 600 | 100 | 450 | |
| GV | 1,250 | 1,050 | 100 | 450 | |
| Rank | R2 | R2 | R1 | R1 | |
| Retail | — | 100.00 | — | 37.50 | 137.50 |
| Unilevel | 56.00 + 22.50 = 78.50 | 36.00 | — | — | 114.50 |
| Rank bonus pre-cap | 125.00 | 105.00 | 5.00 | 22.50 | 257.50 |
| Matching pre-cap | 22.00 | 4.50 | — | — | 26.50 |
| Cap | net sales 1,250 × 20% = **250.00**; in scope 284.00; excess 34.00 | | | | |
| Matching post-cap | 0.00 | 0.00 | — | — | 0.00 (−26.50) |
| Rank bonus post-cap (−7.50) | 121.36 | 101.94 | 4.85 | 21.85 | 250.00 |
| **Gross** | **199.86** | **237.94** | **4.85** | **59.35** | **502.00** |
| Withholding 2% | 4.00 | 4.76 | 0.10 | 1.19 | 10.05 |
| Net payable | 195.86 | 233.18 | 4.75 | 58.16 | 491.95 |

Allocation detail: raw 121.3592, 101.9417, 4.8544, 21.8447; floors Σ 249.98; 2 cents to largest fractions (A, D). Ledger: Dr commission expense 502.00 · Cr payee payable 491.95 · Cr withholding payable 10.05. Compliance: R1 customer share 550 ÷ 1,250 = 44.00%; R3 retail 27.39%, downline 72.61%, matching 0%. Pending follow-on cases (no expected values yet): K1 refund under each policy; D's sponsor corrected B→C after commit + replay; proportional cap variant.

Other oracle values in this domain: TS-38 gross 1,234.56, withholding 2% ⇒ 24.69, payable 1,209.87.

---

## 9. APIs, screens, permissions (engine domain, all B)

| API | Path | Authz | Idempotency |
|---|---|---|---|
| API-10 | `POST /v1/orders` | `orders:write` (API key) | Idempotency-Key; natural key source_system + source_order_id |
| API-11 | `POST /v1/order-events` | `orders:write` | Idempotency-Key; natural key source_event_id |
| API-12 | `POST /v1/participants`; `PATCH …/{id}/type`, `…/{id}/status` | `participants:write`; `participant.manage` | Idempotency-Key |
| API-13 | `GET /v1/positions/{id}/downline` | `genealogy.read` / self downline | safe |
| API-14 | `GET /v1/genealogy/tree` (as-of + known-at) | `genealogy.read` | safe |
| API-15 | `POST /v1/genealogy-cases`; `POST …/{id}/decision` | `case.genealogy.create` / `approve` | Idempotency-Key |
| API-16 | `POST /v1/plans/{id}/versions`; `…/{v}/submit`, `…/approve`, `…/schedule` | `plan.edit`, `plan.approve` | If-Match; Idempotency-Key on transitions |
| API-17 | `POST /v1/simulations`; GET result/comparison; golden runs | `plan.simulate` | Idempotency-Key |
| API-18 | `POST /v1/periods/{id}/runs`; GET status; `POST …/replay` | `run.execute` | Run-Request-Id required |
| API-19 | `GET /v1/runs/{id}/review` | `run.review` | safe |
| API-20 | `POST /v1/runs/{id}/commit` | `run.commit`; not preparer; AAL2 fresh | Idempotency-Key |
| API-21 | `GET /v1/result-lines/{id}/trace` | `trace.read` | safe |
| API-22 | `POST /v1/restatements`; GET diff; POST decision | `restatement.request` / `approve` | Idempotency-Key |
| API-34 | `GET /v1/me/team` | portal, self downline + visibility policy | safe |
| API-35 | `PUT /v1/customers/{id}/servicing` | `servicing.manage` | Idempotency-Key |

Screens: SC-01 periods/runs (`period.read; run.execute`), SC-02 run review (`run.review; run.commit`), SC-04 plan versions (`plan.edit; plan.read`), SC-05 caps/pools (`plan.edit`), SC-06 cases/restatements (`case.<type>.read/act`), SC-07 genealogy explorer (`genealogy.read`), SC-08 genealogy + duplicate cases (`case.genealogy.*; case.duplicate.*`), SC-09 participant (`participant.read`), SC-19 rank status (self), SC-20 team (self downline), SC-31 orders (`order.read`), SC-32 late queue (`late.manage`), SC-42 simulation/golden (`plan.simulate`), SC-43 qualification detail (`participant.read`), SC-44 plan change workflow (`plan.approve`).

Run review (FR-COMP-005): totals vs previous run, variance by bonus type, top-k movers, exception list (invariant warnings, guardrail warnings, held payees, unusually large lines — thresholds from tenant settings), input and plan changes; totals = run control totals; sync stale after run ⇒ banner, commit blocked until re-run or acknowledged by rule.

Qualification state (FR-COMP-004): never edited directly; any API attempt outside run commit, restatement or approved migration import ⇒ refused (AC-46.2). Domain events: `GenealogyChanged`, `OrderIngested`, `PeriodCutOff`, `PeriodCommitted`, `PeriodClosed`, `RunCommitted`.

---

## 10. Phase C spike items (OQ-05, OQ-29; TS-29)

1. Run time + memory at 50k / 500k / 2M positions × balanced binary, deep-leg binary (depth 5,000), wide unilevel (NFR-PERF-04 ≤ 5 min mid-market; NFR-PERF-05 ≤ 60 min, ≤ 8 GB at 2M).
2. Upline payment walk n levels per order, 1M orders.
3. Expression evaluator cost per payee.
4. Result-line + trace size/write time at 600k lines.
5. Corpus coverage: 5 hold-out plans end-to-end, count tier-3 needs (OQ-12; today 5 of 16 covered).
6. Determinism across machines/builds (hash equality).
7. `ltree` path length and index size at depth 5,000 (OQ-29); subtree move of 100k (NFR-PERF-08); authz p95 (NFR-PERF-07).
8. Snapshot load 2M positions PostgreSQL → arrays ≤ 2 min.
Thresholds must be confirmed by founder/CTO **before** the spike.

---

## Conflicts found

| # | Conflict | Documents | Resolution (reasoned) |
|---|---|---|---|
| C1 | Tail pass order. FR-COMP-003: caps → **netting of clawbacks → minimums → rounding → withholding**. SDD-07 §4: caps → adjustments(9) → **minimums + rounding(10) → netting + withholding(11)** → invariants(12); FR also omits pass 0 (transition) and pass 9/12 | PRD-02 vs SDD-07 | Implement **SDD-07 order** (design-level, more complete). Netting after rounding keeps netting in exact minor units and lets `gross = net + withholding` be checked per payee. Ask product to amend FR-COMP-003 |
| C2 | Snapshot write atomicity. FR-COMP-002: "write result lines, qualification state candidates and control totals in **one transaction**". SDD-07 §7: staged writes **in batches**, visible only through the run | PRD-02 vs SDD-07 | Use batched staging (600k-line runs); atomicity achieved by the single `run.state → calculated` flip and the single commit transaction. Visibility semantics are identical |
| C3 | Failed re-run. SDD-07 defines `Calculating → Open` only for a failed **first** run; no transition for a failed re-run from Calculated | SDD-07 / FR-COMP-001 | Failed re-run ⇒ period returns to **Calculated** with the previous calculated run still current (not discarded); a run is `discarded` only when a successful re-run supersedes it |
| C4 | Tree evaluation instant. SDD-07 §11 `validAt = period end`; predicate `valid_from <= D AND valid_to > D`; periods are `[start, end)` and plan/genealogy changes take effect at boundaries. With D = `ends_at`, a change effective at the next period's start would apply to the closing period | SDD-07 vs SDD-08 vs period model | Evaluate at **last instant inside the period** (`ends_at − 1 µs`) or use `valid_from < :end AND (valid_to IS NULL OR valid_to >= :end)`. Pin the choice in a golden test (TS-61/TS-62 style) |
| C5 | Bitemporal purity of "change". SDD-08 closes an existing row by setting `valid_to` in place without a new `recorded_at`; "as known at T" between recording of the old row and the change then shows the closed range retroactively | SDD-08 §2 | Acceptable because BR-GEN-03 only allows **current or future** effective dates and runs use `known_at = now` for past period ends; future-dated as-of queries are forecasts. If strict bitemporality is wanted later: supersede + insert closed copy. Document the limitation |
| C6 | Rule id storage. FR-GEN-009 / TS-64 require rule-generated rows to carry "the rule id"; `relationship` (ENT-05) has only `case_id` | PRD-02 / QA vs spec.json entity | Add nullable `rule_ref text` (plan_rule key + plan_version_id) to `relationship`, or always create a system case holding the rule id. Prefer the column (DATABASE brief owner to confirm) |
| C7 | Purpose enum. BR-PTY-03 / FR-ORD-003: resale, personal use, unspecified. ENT-09: `(resale, personal, unspecified, customer)` | PRD-04 vs entity | Use entity enum; `customer` is for orders whose buyer type `counts_as_end_customer` (TS-31 uses it); participant orders use the other three |
| C8 | Largest-remainder tie key. BR-MNY-03 "payee id ascending"; FR-COMP-012 "fractional part desc, then payee id asc"; SDD-07 iterates "ascending position id"; `result_line` has both position and participant payee ids | PRD-04 / PRD-02 / SDD-07 | Primary: fractional part desc; secondary: **payee position id asc** (engine works per position; matches the oracle's key order) |
| C9 | Replay engine version. FR-COMP-008: reproduce "regardless of … engine releases flagged compatible". SDD-07 §6: replay runs the **pinned** version | PRD-02 vs SDD-07 | Replay always uses pinned version; "compatible" applies to TS-60 differential tests of new releases |
| C10 | Cap residue naming. SDD-07 example `residue: "retain_as_breakage"`; QA-01 E2E "residue not earned"; BR-MNY-04 residue → named residue account; SDD-07 §11 ledger "residue and breakage to their accounts" | SDD-07 vs QA-01 vs PRD-04 | Treat **cap-removed amounts** as breakage (not earned, no payee line; E2E ledger shows none) and **rounding residue** as the BR-MNY-04 residue account. Whether breakage needs a posting is for the ledger brief to fix |
| C11 | Enrolment API scope. FR-PAR-002 "API key scope **enrol**"; API-12 authz `participants:write` | PRD-02 vs spec.json | Use `participants:write` (API catalogue is the contract) |
| C12 | Change lock granularity. SDD-08 per (tenant, kind); BR-GEN-06 / FR-GEN-005 per target leg | SDD-08 vs PRD-04 | Default per (tenant, kind); per-leg only for binary auto-placement where contention is measured (SDD-08 states this explicitly) |
| C13 | Binary pairing release. SDD-07 / FR-GEN-005: pairing **Could**; TS-04 and TS-05 tagged **B** | SDD-07 vs spec.json | Data model + carry primitive in B; pairing primitive only if OQ-13 says the segment uses binary. Keep TS-04 as a golden for when it ships |
| C15 | Qualification-state key. FR-COMP-004 validation "one row per position, period, calendar"; ENT-15 `qualification_state` PK `(run_id, position_id)` (+ idx `(tenant_id, position_id)`) | PRD-02 vs spec.json | Equivalent once restricted to committed runs (a run binds one period of one calendar); enforce "one authoritative row" via the period's single committed run |
| C14 | Example plans differ. SDD-07 plan: unilevel on `cv`, 5 levels, dynamic compression, `requires_rank R1`, R2 needs `active_customers ≥ 2`, cap 10%. G-E2E-01: unilevel on PV, 2 levels, no compression, R2 by GV only, cap 20% | SDD-07 vs QA-01 | Not a real conflict: both hypothetical. Golden fixtures must use the QA-01 plan exactly; do not reuse SDD-07 parameters in G-E2E-01 |

## Open / unresolved

| ID | Item | Blocks |
|---|---|---|
| D-R1 | Crediting event (payment · shipment · end of cooling-off); configurable per plan version, **no default shipped** | BR-PER-02, FR-COMP-001, FR-ORD-001, TS-62 |
| D-R2 | Whether a reversal may alter a closed period (default: adjust in open period) | BR-REV-02, FR-FIN-003 |
| D-R3 | Negative balance after clawback (default carry receivable, net, write off with approval) | BR-REV-07..09, TS-11 |
| D-R5 / OQ-22 | Missing original rule catalogue: BR-RNK-01..04, BR-REV-01/-03..-05, BR-TRM, BR-VOL-02 text unknown | rank/termination rules in FR-COMP-004, FR-GEN-009 |
| OQ-05 | Engine + genealogy performance unproven | NFR-PERF-04/05/07/08, ADR-04, TS-29 |
| OQ-12 | Primitive coverage target (today 5 of 16 hold-out plans fully covered) | FR-PLN-002/003 scope, ADR-05 |
| OQ-13 | Binary/matrix in target segment | FR-GEN-005, pairing primitive, TS-04 |
| OQ-17 | One genealogy across in-country-storage markets (MVP: one region per tenant) | multi-region genealogy |
| OQ-18 | Backend language (TypeScript proposed; decimal library choice follows) | engine package, ADR-18 |
| OQ-29 | `ltree` path size at depth 5,000; chunked-path fallback | FR-GEN-008, NFR-PERF-07/08 |
| — | Compression variants: SDD-08 names "standard or dynamic"; only one behaviour is defined by TS-02. Also undefined: whether an inactive position's own volume rolls up to the next active upline | FR-GEN-009, pay.percent_by_level, AC-44.2 |
| — | Formal JSON schema of the primitive catalogue, expression language grammar and bounded-cost limits are not written | FR-PLN-002, FR-PLN-003 |
| — | Ordered-hash definition (line ordering key, hash algorithm, which fields) not specified | FR-COMP-008, TS-03, TS-60 |
| — | Meaning of "minimums" in pass 10 (per-line minimum vs market minimum payout, which FR-PAY-007 handles as accumulation) | FR-COMP-003, FR-PAY-007 |
| — | Definition of "active"/qualified for compression and of "terminated before the period" invariant per plan | TR-ENG-16, FR-PAR-005 |
| — | Restatement scope: "affected payees" selection rule for sandbox replay not defined (whole period vs subset) | FR-COMP-009, TS-10, TS-51 |
| — | G-E2E-01 follow-on cases (K1 refund, D sponsor correction, proportional cap) have no expected values yet | FR-PLN-006, golden set |
| — | Rule-id column on `relationship` (C6) | FR-GEN-009, TS-64 |
| — | Snapshot evaluation instant at period end (C4) | FR-COMP-002, TS-61/62 |
| — | NFR-PERF thresholds and snapshot-load ≤ 2 min are proposals; founder/CTO must confirm before spike | TS-29 |
