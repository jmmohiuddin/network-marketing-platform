# Implementation Master Plan

Scope and order follow PRD-07. Each increment ends with: migrations applied from zero, unit + integration tests green, browser workflow passed, commit on a feature branch, registers updated.

| # | Increment | Requirements | Exit |
|---|---|---|---|
| 0 | Repo, tooling, databases, env | — | `pnpm test` runs; migrations apply to an empty database |
| A1 | Foundation: schema A, RLS, IAM, sessions, MFA, roles, approvals, audit chain, vendor realm, tenant provisioning, support sessions | FR-IAM-001/002/003/005, FR-TEN-001, FR-OPS-001, FR-AUD-001/002 | isolation suite + RLS coverage test green; sign-in/MFA in browser |
| A2 | Import: upload, validate, map, load | FR-IMP-001..003 | synthetic export loads; rejected file shows row errors |
| A3 | Compliance: R1–R5, snapshots, drill-down, method notes | FR-CPL-001..006 | golden values equal `report.json`; TS-31 fixture passes |
| A4 | Breach contacts, export limits | FR-PRV-004, FR-AUD-002 | — |
| A5 | Web: SC-10, 14, 24–28, 30, 39, 46 | all A | full MVP-A browser workflow, two tenants, no console errors |
| A6 | Review: security audit, code review, fix | — | no Critical/High open |
| — | Gate: founder confirmed MVP-B on 2026-11-12 | E-ADR-07 | done |
| S | Spike: tree generator, engine benchmark, ledger prototype | OQ-05, TS-29 | numbers recorded against NFR-PERF-04/05 |
| B1–B6 | per PRD-07 §3 | 81 FRs | each increment as above |

After B6: **B-MKT** (4 FRs; pack values shipped as "sourced, not confirmed", E-ADR-15), then **V1** (19 FRs: FR-LIC-001..003, FR-FIN-006/007, FR-CPL-009..011, FR-PAR-004, FR-ORD-006, FR-COMP-011, FR-PRV-003, FR-INT-004, FR-TEN-005, FR-CRM-003, FR-DIST-009, FR-AI-001/002, FR-IMP-004). Never: the refusal list (E-ADR-16).
