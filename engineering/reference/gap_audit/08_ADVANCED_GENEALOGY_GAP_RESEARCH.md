# 08 — ADVANCED GENEALOGY GAP RESEARCH
## Sponsor and placement trees, history, change, scale — and what breaks naive designs

| Field | Value |
|---|---|
| Document ID | GAP-08 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 2 |
| Gaps | GAP-010 to GAP-013 |
| Evidence | Current public plans (G-S25..G-S28), PostgreSQL documentation (G-S35), original 13 §3–5. Workload figures below are **labelled assumptions**, not data |

## 1. What the original research said

One row in the building-block table ("Hierarchy: sponsor tree; placement tree; depth limits") and three edge cases (sponsor change, compression after termination, spillover with no free slot). The large-tree benchmark V-06 and the T6 hierarchy probes were planned and **not done**. There is no genealogy model.

## 2. Scenarios that break naive genealogy implementations

"Naive" = one `parent_id` column per distributor, updated in place, queried recursively at request time.

| # | Scenario | Real-world basis | What breaks | Required design property |
|---|---|---|---|---|
| S1 | A person holds **several positions** (business centres) in a binary tree | USANA gives three per person and more on "maximising" (G-S25) | Node = person assumption; commissions summed per person but volume flows per position | **Position ≠ person**; positions owned by a participant |
| S2 | Sponsor tree and placement tree differ | Binary and matrix plans (13 §2; G-S25, G-S28) | One parent column cannot hold both; bonuses use different trees (Modere PSTOP excludes placement-moved volume, G-S26) | Two relationship types, each effective-dated |
| S3 | Sponsor or placement changes inside a permitted window | USANA 10 days; Modere 60 days (G-S25, G-S26) | Updating in place rewrites every past calculation that used the old parent | **Effective-dated, append-only** relationships |
| S4 | A business centre is moved after 6 months' inactivity with ethics approval | G-S25 | Volume history of the moved subtree; who earns on past periods | Change event with approval; past periods unchanged |
| S5 | Correction of an **error** (wrong sponsor entered on day 1) vs a **change** (approved move on day 200) | Implied by change windows | Both look like an update; a correction should be retroactive, a change should not | Two event kinds: *correction* (retroactive within rules, triggers recalculation) and *change* (prospective) — see the bitemporal model in §4 |
| S6 | Concurrent enrolments into the same binary "outside leg" slot | Automatic placement / spillover (13 EX-4) | Two people land in one slot, or placement depends on timing | Serialised placement per tree (lock on the target leg), deterministic tie-break |
| S7 | Very deep chains | Binary spillover and long single legs [IP] | Recursive queries per request; closure tables grow as N × depth | Calculation does not query the tree recursively per node (§5) |
| S8 | Termination of a mid-tree distributor | J-16; BR-TRM-03 | Deleting the node orphans the downline; moving the downline loses history | Node stays with status; compression or roll-up happens **at calculation time** by plan rule (GAP-013) |
| S9 | Compression vs roll-up vs breakaway | 13 EX-1b, EX-3; Modere dynamic generations (G-S26) | Treating all three as "skip inactive" pays wrong amounts | Distinct, versioned plan behaviours |
| S10 | One genealogy across several countries | Multi-market operators (P-03) | Per-country trees break cross-border lines; one global tree conflicts with in-country data rules | Global relationship graph with per-market personal data placement (GAP-061) |
| S11 | Re-entry and reinstatement | J-14; matrix "re-entry" in the brief | New account vs reactivated position; rank and placement after return | Reinstatement as an event on the same position, rule per plan version |
| S12 | Downline visibility | 08 §6; P-04 breach | Leaders see personal data of thousands of people | Field-level visibility rules by depth and relationship (GAP-012) |
| S13 | Merging two companies' genealogies | Brand acquisitions (GAP-095) | ID collisions; duplicate people across trees | Tenant-scoped IDs; person-matching workflow |

## 3. Gap records

### GAP-010 — No effective-dated genealogy model; positions, people and history are not separated

| Field | Content |
|---|---|
| **Category** | Technical, financial |
| **Previous research coverage** | 13 §3 (hierarchy row), 13 §5 edge case 1 |
| **Missing element** | A data model in which (a) a participant may own several positions; (b) sponsor and placement relationships are separate and effective-dated; (c) corrections and changes are different events; (d) history is never overwritten |
| **Evidence** | Multiple positions and change windows in current plans (G-S25, G-S26); reproducibility requirement (13 §7.1) |
| **Why it matters** | Commission reproducibility, dispute handling and audit all depend on knowing **what the tree looked like on the date a period was calculated** |
| **Affected stakeholders** | Distributors, Finance, Compliance, Support, auditors |
| **Product implications** | Genealogy change requests (GAP-002); "tree as of date" view; per-position statements rolled up per person |
| **Technical implications** | Entities: Participant, Position, Relationship(type ∈ {sponsor, placement}, parent_position, child_position, valid_from, valid_to, recorded_at, superseded_by, event_id). Append-only; a period snapshot is taken at commit (§4) |
| **Recommended solution** | Adopt the bitemporal relationship model in §4 as a design constraint for the first database document |
| **Priority** | **Critical** |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 13 §3 (split Hierarchy block), 15 (new BR-GEN rules), first database and ER documents |

### GAP-011 — No storage and query strategy, benchmark or workload model

| Field | Content |
|---|---|
| **Category** | Technical |
| **Previous research coverage** | Master Plan R-26 names closure table, nested set, materialised path, graph; V-06 benchmark planned; none done |
| **Missing element** | A decision on how the tree is stored for (a) calculation, (b) interactive views, (c) history, with trade-offs and a benchmark plan |
| **Evidence** | PostgreSQL `ltree` supports ancestor/descendant operators with GiST indexes; labels ≤ 1,000 characters; paths ≤ 65,535 labels (G-S35) |
| **Why it matters** | The wrong choice either fails at scale (recursive queries per node during a run) or explodes storage (closure tables on deep trees) |
| **Affected stakeholders** | Engineering, operations, distributors (view speed) |
| **Product implications** | Large-tree views must be search-first and lazy-loaded (14) |
| **Technical implications** | See §5 comparison and the recommended split |
| **Recommended solution** | Adjacency (effective-dated) as the system of record; **in-memory tree per run** for calculation; a **materialised path** read model for interactive "is X in Y's downline" and subtree search; no closure table for deep binary trees. Prove with the benchmark in §6 before architecture sign-off |
| **Priority** | High |
| **Implementation stage** | Before MVP (technical spike) |
| **Confidence** | Medium (reasoned; benchmark pending) |
| **Documentation changes required** | Master Plan V-06 (define), first architecture and database documents |

### GAP-012 — Downline visibility, privacy, search and display for large trees

| Field | Content |
|---|---|
| **Category** | Security, UX |
| **Previous research coverage** | BR-DAT-03 (visibility "as plan and privacy rules allow"), P-04 |
| **Missing element** | Rules for which fields a leader may see at which depth; search within one's own downline; display patterns for trees with thousands of nodes |
| **Evidence** | Breach case (S-133); data-protection duties for processors (G-S14) |
| **Why it matters** | Genealogy views are the largest personal-data exposure surface in the product |
| **Affected stakeholders** | Distributors (data subjects), leaders, Compliance, DPO |
| **Product implications** | Visibility matrix per plan: e.g., name and rank to depth n; contact data only for personally sponsored; volume aggregates beyond depth n; export limits |
| **Technical implications** | Authorisation check "viewer's position is an ancestor of target at depth ≤ n" on every request (path read model); rate limits and export logging (16) |
| **Recommended solution** | Field-level visibility policy as tenant configuration with a safe default; server-side enforcement; no client-side filtering |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | Medium |
| **Documentation changes required** | 08 §6, 15 BR-DAT-03, future security architecture |

### GAP-013 — Placement, spillover, compression, roll-up, breakaway and re-parenting are different behaviours

| Field | Content |
|---|---|
| **Category** | Financial, technical |
| **Previous research coverage** | EX-1b (one compression definition), EX-3 (override vs differential), EX-4 (matrix capacity), BR-TRM-03 |
| **Missing element** | Explicit, versioned definitions that separate **structural** operations (placement, spillover, re-parenting on termination) from **calculation-time** operations (compression, roll-up of an emptied matrix position, breakaway, dynamic generations) |
| **Evidence** | Modere dynamic generations with compression to the next qualified member (G-S26); USANA roll-up percentages for customer volume (G-S25) |
| **Why it matters** | Mixing structure and calculation either loses history (moving people to "compress") or pays incorrectly |
| **Affected stakeholders** | Distributors, Finance |
| **Product implications** | Plan configuration names which behaviour applies to which bonus |
| **Technical implications** | Structure changes only through dated events; calculation-time behaviours are pure functions of (snapshot, plan version) |
| **Recommended solution** | Rule: **the tree structure never changes to implement a pay rule.** Compression, roll-up and breakaway are calculation behaviours |
| **Priority** | High |
| **Implementation stage** | MVP for plan types in the first release |
| **Confidence** | High |
| **Documentation changes required** | 13 §3 and §5, 15 BR-CMP-07, BR-TRM-03 |

## 4. Recommended relationship model (design constraint, not a schema)

Two time axes:

- **Valid time** (`valid_from`, `valid_to`): when the relationship is true in the business.
- **Recorded time** (`recorded_at`, `superseded_at`): when the system learned it.

| Event | Valid time | Recorded time | Effect on committed periods |
|---|---|---|---|
| Enrolment | from enrolment date | now | none |
| **Change** (approved move) | from the approved effective date (future or today) | now | none |
| **Correction** (data-entry error) | from the original date | now; old row superseded | affected committed periods are **flagged** for review; restatement or adjustment per plan policy (GAP-023) |
| Termination | position status change from date | now | none; downline handled by calculation rules |

At **period commit**, the engine stores the snapshot it used (or a reference to the recorded-time instant), so a run can be replayed exactly even after later corrections.

## 5. Storage and query options (for the calculation and view workloads)

| Option | Good at | Weak at | Fit |
|---|---|---|---|
| Adjacency list + recursive CTE | Simple; cheap changes; easy effective dating | Recursive queries per request become slow on deep trees | **System of record** |
| Closure table (ancestor, descendant, depth) | Fast subtree and upline queries | Rows grow as N × average depth; every move rewrites many rows; poor for deep binary legs | Avoid for deep binary; possible for shallow unilevel |
| Materialised path (`ltree`) | Ancestor/descendant tests with GiST index; subtree search (G-S35) | Path length grows with depth; a move rewrites the subtree's paths | **Read model** for views and authorisation, rebuilt asynchronously |
| Nested sets | Fast reads | Very expensive writes | Not suitable |
| Graph database | Traversals | Another datastore to run, secure and back up | Not justified at MVP |
| **In-memory tree per run** | One bottom-up pass aggregates all group volumes in O(N); deterministic | Needs the tree loaded per tenant per run | **Calculation** |

**Workload model (assumptions, for sizing the spike):** a mid-market tenant with 50,000 positions and an enterprise tenant with 2,000,000; average 1–3 orders per active position per month; 30–60% of positions inactive; binary depth up to several thousand on spillover legs. **All four figures are assumptions** to be replaced by interview data (G-OPS) or a design partner's export.

Under these assumptions an in-memory representation of 2 million positions at a few hundred bytes each is in the hundreds of megabytes: feasible for a calculation worker, which is why the calculation path should not depend on SQL recursion.

## 6. Benchmark plan (replaces V-06)

| Test | Dataset | Pass condition (to be set by the founder or CTO) |
|---|---|---|
| Bottom-up group-volume pass | Synthetic trees: 50k, 500k, 2M positions; shapes: balanced binary, deep-leg binary (depth 5,000), wide unilevel | Run time and memory within the period-close window |
| Upline payment walk (n levels per order) | Same trees, 1M orders | Throughput target |
| Subtree search and authorisation check | `ltree` read model | Interactive latency target at p95 |
| Move a subtree of 100k positions | Read-model rebuild | Completes without blocking writes |
| Replay a committed period after a correction | Bitemporal model | Bit-for-bit identical output for the original run |

Thresholds are deliberately left to the founder: setting them here would invent requirements.
