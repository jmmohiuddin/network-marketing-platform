# 22 — PRODUCT REQUIREMENT GAP ANALYSIS
## Which product documents each gap must change — and the traceability scheme they should be born with

| Field | Value |
|---|---|
| Document ID | GAP-22 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Situation | **None of the product documents exists yet** (GAP-100). The matrix below is therefore a **specification of what the first versions must contain**, so that research findings do not get lost when product writing starts |

## 1. GAP-100 — No product, technical or financial documentation exists

| Field | Content |
|---|---|
| **Category** | Strategy, technical |
| **Previous research coverage** | Roadmap Waves 4–9 not started (01 of this audit §3) |
| **Missing element** | Vision, positioning, feature catalog, MVP scope, PRD, FR/NFR, business rules (final), stories, acceptance criteria, flows, wireframes, IA, database, ER, API, architecture, security, integration, testing, roadmap, pricing, financial model |
| **Evidence** | Repository inventory (01 of this audit) |
| **Why it matters** | The audit brief assumes a development-ready set; a team asked to build now would guess on every hard question in 08–10 |
| **Affected stakeholders** | Founder, any development team, investors |
| **Product implications** | Development must not start; the next work is decisions (35) and the minimum document set (§3) |
| **Technical implications** | — |
| **Recommended solution** | Write the minimum document set in §3 **after** the founder decisions FD-01..FD-06 in 35, using the trace scheme in §2 from the first line |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | High |
| **Documentation changes required** | All future documents |

## 2. Traceability scheme for the first product documents

| ID prefix | Artefact | Must trace to |
|---|---|---|
| `GAP-xxx` | This audit's gaps | Evidence `G-Sxx` / `S-xxx` |
| `F-xx` | Features (23) | ≥ 1 GAP, problem `P-xx`, or compliance requirement `CMP-xx` |
| `BR-xxx-nn` | Business rules (original 15 + 24) | Basis (source or decision ID) and `basis_status` |
| `US-xx` | User stories (25) | ≥ 1 F |
| `AC-xx.n` | Acceptance criteria (26) | 1 US |
| `FL-xx` / `SC-xx` | Flows and screens (27) | US |
| `ENT-xx` / `ADR-xx` | Entities and architecture decisions (28) | GAP, BR |
| `SEC-xx` / `CPL-xx` | Security and compliance requirements (29) | GAP, law or contract, mandatory/recommended class |
| `TS-xx` | Test scenarios (30) | AC, BR, EX/T examples |

**Gate rule (adapted from G4 and G8):** an MVP feature without a trace to a GAP, problem or compliance requirement is removed; a requirement without acceptance criteria and a test scenario is not "ready".

## 3. Minimum document set before any build

| # | Document | Depends on | Why it is in the minimum set |
|---|---|---|---|
| 1 | Positioning and segment decision (one page) | FD-01..FD-03 (35) | Every other choice depends on it (GAP-075, GAP-076) |
| 2 | Plan corpus and primitive set | GAP-020 desk task | The engine design cannot start without it |
| 3 | Compensation engine specification (periods, caps, money, reversals, provenance) | 2; 09, 24 | Core IP and core risk |
| 4 | Genealogy and ledger data design | 08, 10, 28 | Critical gaps GAP-010, GAP-030 |
| 5 | Launch-market compliance and tax spec | Counsel and tax adviser (FD-04, FD-05) | GAP-031, GAP-085, GAP-087 |
| 6 | Integration spec (commerce ingestion, payment and payout providers) | Provider eligibility (GAP-004) | Go-live blocker |
| 7 | Security baseline | 16, 29 | Critical gap GAP-065 |
| 8 | MVP PRD with stories and acceptance criteria | 1–7; 23, 25, 26 | Build input |
| 9 | Test strategy with golden datasets | 30 | Engine correctness |
| 10 | Unit-economics sheet | 18 §4 inputs | Viability (G7) |

## 4. Gap-to-document matrix

Columns: **Vis** vision/positioning/strategy · **Cat** feature catalog · **PRD** functional requirements · **NFR** non-functional · **BR** business rules · **US/AC** stories and acceptance · **UX** flows, wireframes, IA · **DB** database/ER · **API** API · **Arch** system architecture · **Sec** security · **Int** integration · **QA** testing · **RM** roadmap · **Fin** pricing/financial. `●` = must change or be created.

| Gap | Vis | Cat | PRD | NFR | BR | US/AC | UX | DB | API | Arch | Sec | Int | QA | RM | Fin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GAP-001 claims | ● | ● | ● | | | ● | | | ● | | | ● | | ● | |
| GAP-002 disputes | | ● | ● | | ● | ● | ● | ● | | | ● | | ● | | |
| GAP-003 honesty | ● | ● | ● | | ● | ● | ● | | | | | | | | |
| GAP-004 providers | ● | | ● | | | | | | | ● | | ● | ● | ● | ● |
| GAP-005 signals | | ● | ● | | ● | ● | | ● | | | ● | | ● | | |
| GAP-006 channels | | | ● | | ● | | | | | | | | | ● | |
| GAP-010 genealogy model | | | ● | | ● | ● | | ● | ● | ● | | | ● | | |
| GAP-011 storage/benchmark | | | | ● | | | | ● | | ● | | | ● | ● | |
| GAP-012 visibility | | | ● | ● | ● | ● | ● | | ● | | ● | | ● | | |
| GAP-013 structure vs calc | | | ● | | ● | | | ● | | | | | ● | | |
| GAP-020 primitives | ● | ● | ● | | ● | | | ● | | ● | | | ● | ● | |
| GAP-021 money | | | ● | ● | ● | ● | | ● | | | | | ● | | |
| GAP-022 caps | | | ● | | ● | ● | ● | ● | | | | | ● | | |
| GAP-023 periods | | ● | ● | ● | ● | ● | ● | ● | ● | ● | | | ● | | |
| GAP-024 credits | | ● | ● | | ● | | ● | ● | ● | | | ● | ● | ● | |
| GAP-025 qualification state | | | ● | | ● | ● | ● | ● | | | | | ● | | |
| GAP-026 test harness | | ● | ● | | | ● | ● | | | ● | | | ● | | |
| GAP-027 provenance | | ● | ● | ● | | ● | ● | ● | ● | | | | ● | | |
| GAP-028 participant types | | | ● | | ● | ● | | ● | ● | | | | ● | | |
| GAP-030 ledger | | | ● | ● | ● | ● | | ● | ● | ● | ● | | ● | | |
| GAP-031 tax | ● | ● | ● | | ● | ● | ● | ● | | | | ● | ● | ● | ● |
| GAP-032 clawback policy | | | ● | | ● | ● | ● | ● | | | | | ● | | |
| GAP-033 boundaries/GL | ● | ● | ● | | | | | ● | ● | | | ● | | | |
| GAP-034 FX | | | ● | | ● | | ● | ● | | | | | ● | ● | |
| GAP-035 payout failures | | | ● | ● | ● | ● | ● | ● | ● | | ● | ● | ● | | |
| GAP-040 attribution | | ● | ● | | ● | ● | ● | ● | ● | | | ● | ● | | |
| GAP-041 contacts | | ● | ● | | ● | | | ● | | | ● | | | ● | |
| GAP-045 commerce | ● | ● | ● | | | | | | ● | ● | | ● | | ● | ● |
| GAP-046 subscriptions | | ● | ● | | ● | ● | | ● | ● | | | ● | ● | ● | |
| GAP-047 returns | | | ● | | ● | ● | | ● | ● | | | ● | ● | | |
| GAP-050 metrics | ● | ● | ● | | | | ● | | | | | | | ● | |
| GAP-051 language/a11y | | | | ● | | ● | ● | | | | | | ● | | |
| GAP-055 IA/screens | | | | | | ● | ● | | | | | | | | |
| GAP-060 architecture | | | | ● | | | | ● | ● | ● | ● | | ● | ● | ● |
| GAP-061 residency | | | | ● | | | | ● | | ● | ● | | ● | ● | ● |
| GAP-062 SQL/export | | ● | ● | ● | | | | ● | ● | ● | ● | | | | |
| GAP-065 insider/fraud | | | ● | ● | ● | ● | ● | ● | ● | ● | ● | | ● | | |
| GAP-066 attestations | ● | | | ● | | | | | | | ● | | | ● | ● |
| GAP-070/071 AI | ● | ● | | | | | | | | | | | | ● | |
| GAP-075 business model | ● | | | | | | | | | | | | | ● | ● |
| GAP-076 segment/market | ● | | | | | | | | | | | | | ● | ● |
| GAP-077 migration | ● | ● | ● | | | ● | ● | ● | ● | | | ● | ● | ● | ● |
| GAP-080/081 competition | ● | ● | | | | | | | | | | | | ● | ● |
| GAP-085 privacy | | | ● | ● | ● | ● | ● | ● | ● | ● | ● | | ● | | |
| GAP-086 FTC substantiation | | ● | ● | | ● | | | ● | | | | | ● | ● | |
| GAP-087 guardrails | ● | ● | ● | | ● | ● | ● | | | ● | | | ● | | |
| GAP-088 other law | | | ● | | ● | | | | | | | | | ● | |
| GAP-095 multi-brand | | | | | | | | ● | | ● | | | | ● | |
| GAP-096 exit | ● | | ● | | | | | | ● | | | | | | ● |
| GAP-097 plan change governance | | ● | ● | | ● | ● | ● | ● | | | | | ● | | |
| GAP-098 wind-down | | | ● | | | | | | | | | | | ● | |

## 5. Example of the trace the brief asked for

**Finding:** historical commission calculations cannot be reproduced reliably when genealogy is corrected or orders are refunded after close (GAP-010, GAP-023).

| Artefact | Concrete change |
|---|---|
| Engine | Runs bind to one plan version and one input snapshot; committed periods immutable (BR-PER-03, 24) |
| Orders | Store attribution, buyer type, purpose, volume per line at ingestion; never recompute from current master data (BR-ATT-02) |
| Records | Each payout line stores run id, rule id and a compact trace (GAP-027) |
| Database | Effective-dated relationships with recorded time; append-only ledger (ENT-04, ENT-12, 28) |
| Admin tools | Period screen with states; restatement request with approval (SC-01, SC-06, 27) |
| QA | Replay test: re-running a committed period after a later correction reproduces the original output byte-for-byte (TS-03, 30) |
