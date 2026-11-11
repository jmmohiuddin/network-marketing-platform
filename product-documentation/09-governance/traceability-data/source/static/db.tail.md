## 5. Partitioning, retention and volume

Sizing uses the **assumed** workload model in the research (gap audit 15 §2): a large tenant with 2,000,000 positions, 3,000,000 orders a month and 600,000 payout lines per run. These are assumptions to be replaced by a design partner's data.

| Table | Growth driver | Strategy |
|---|---|---|
| `result_line`, `sim_result_line` | Lines per run (about 1 KB with trace) | Range-partition by period month; simulation partitions dropped after a retention setting |
| `posting` | 2 to 4 per payout line | Range-partition by `posted_at` month; never dropped inside retention |
| `sales_order`, `order_line`, `order_event` | Orders | Range-partition by `credited_at` month |
| `audit_event` | All actions | Separate database or schema; partition by month; write-once storage for archives |
| `inbound_event`, `outbox_event`, `webhook_delivery` | Traffic | Partition by week; purge after the idempotency window (setting; proposed 35 days) |
| `relationship` | One row per enrolment or change | Not partitioned; partial index on current rows |
| `path_node` | One row per position per tree kind | Rebuilt; versioned by `model_version` |
| `cpl_fact_*` | Rows per imported batch | Partition by tenant and batch for cheap supersede |

## 6. Invariants enforced in the database (not only in code)

| Invariant | Mechanism | Rule |
|---|---|---|
| Entry balances | Deferred constraint trigger on `journal_entry` comparing sums of its postings at commit | BR-LED-01 |
| No edit of postings, result lines, relationships (except close), audit events | Revoked privileges plus `BEFORE UPDATE OR DELETE` triggers raising an error | BR-LED-02, BR-GEN-02 |
| One parent per kind per child at any valid time | `EXCLUDE USING gist (tenant_id WITH =, kind WITH =, child_position_id WITH =, tstzrange(valid_from, valid_to) WITH &&) WHERE (superseded_at IS NULL)` | ENT-05 |
| One committed run per period | Partial unique index on `run(period_id) WHERE state = 'committed'` | ENT-13 |
| Idempotency | Unique indexes on idempotency keys (`journal_entry`, `payout_instruction`, `inbound_event`, `run`) | BR-PER-06, BR-PAY-10 |
| Approver is not preparer | `CHECK (approver_id <> preparer_id)` on `approval` | BR-ADJ-02 |
| Tenant isolation | RLS policy on every tenant-scoped table; a migration test fails if a table with `tenant_id` lacks a policy | BR-SEC-04 |

Cycle prevention in `relationship` cannot be a declarative constraint; it is checked inside the write transaction under a per-tenant, per-tree advisory lock (SDD-08 §4).

## 7. Migration and export

- Schema migrations are forward-only, versioned and run per database (pooled and each dedicated tenant database) by the deployment pipeline; a migration that rewrites an insert-only table is rejected in review.
- The **published data model** for tenant export (FR-INT-003) is this document minus `outbox_event`, `inbound_event`, `webhook_delivery`, `path_node` and secrets; export column names equal the names here.
