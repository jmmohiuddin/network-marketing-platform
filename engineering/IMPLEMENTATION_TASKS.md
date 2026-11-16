# Implementation Tasks (MVP-A)

MVP-B tasks are written per increment when it starts. Done = code + tests green + browser check + registers updated.

| ID | Module | Description | Agent | Depends | Source | Pri | Status |
|---|---|---|---|---|---|---|---|
| T-000 | infra | Workspace, tsconfig, lint, vitest, databases, roles, .env.example | orchestrator | - | - | P0 | Completed |
| T-A01 | db | Migrations for 20 rel-A tables + RLS + audit schema + policy-coverage test | orchestrator | T-000 | DATABASE.md | P0 | Completed |
| T-A02 | IAM | Sessions, argon2id, TOTP, forced MFA, step-up, lockout | orchestrator | T-A01 | FR-IAM-001 002 | P0 | Completed |
| T-A03 | IAM | Roles, permissions catalogue, role grants with second-admin approval | orchestrator | T-A02 | FR-IAM-003 | P0 | Implemented |
| T-A04 | AUD | Hash-chained audit events, read API, export with caps, verification job | orchestrator | T-A01 | FR-AUD-001 002 | P0 | Completed |
| T-A05 | TEN/OPS | Vendor console API: provision tenant, region, states; vendor audit | orchestrator | T-A03 | FR-TEN-001 FR-OPS-001 | P0 | Implemented |
| T-A06 | IAM | Vendor support sessions: request, decide, expire, read-only | orchestrator | T-A05 | FR-IAM-005 | P0 | Implemented |
| T-A07 | security | Generated cross-tenant isolation suite over every route (TS-21) | qa | T-A06 | TS-21 | P0 | Implemented |
| T-A07b | db/IAM | Hardening migration 0040 for BUG-001..004 (support request impersonation, credential row scope, session column immutability, sessions of deactivated users) + BUG-005 grant market scope | security | stage 2 | BUG_REGISTER | P0 | Implemented |
| T-A07c | IAM | Fix BUG-006 (approver scope on pending grants) and BUG-007 (revoke/deactivate scope + step-up) | security | stage 3 | BUG_REGISTER | P0 | Completed |
| T-A07d | IAM/OPS | Fix BUG-031 vendor-user invitation two-person control | security | — | BUG_REGISTER | P0 | Completed |
| T-A08 | IMP | Upload, validation (15 rules, forbidden tokens), row errors | backend | T-A05 | FR-IMP-001 | P1 | Implemented |
| T-A09 | IMP | Mapping (draft/approved), load to cpl_fact_*, supersede | backend | T-A08 | FR-IMP-002 003 | P1 | Implemented |
| T-A10 | CPL | packages/compliance: R1–R5 pure, bigint, golden + TS-31 tests | compensation | T-000 | FR-CPL-001..005 | P1 | Completed |
| T-A11 | CPL | Snapshots, figures, drill-down, outdated on new load, method notes | backend | T-A09 T-A10 | FR-CPL-006 | P1 | Implemented |
| T-A12 | PRV | Breach contacts in tenant settings | backend | T-A05 | FR-PRV-004 | P2 | Implemented |
| T-A13 | web | Shell, tokens, sign-in, MFA, nav from permissions | frontend | T-A03 | SC-39 | P1 | Completed |
| T-A14 | web | Vendor console, tenant admin: users, roles, approvals, support sessions, audit | frontend | T-A13 | SC-10 14 30 46 | P1 | Completed |
| T-A15 | web | Imports and compliance report screens | frontend | T-A11 T-A13 | SC-24..28 | P1 | Completed |
| T-A16 | qa | Playwright MCP workflow, two tenants, all A roles | qa | T-A15 | AC rel A | P1 | Completed |
| T-A17 | security | Security audit + code review of A; fix Critical/High | security | T-A16 | SEC-* | P1 | Completed |

## Increment B1 — MVP-B foundations (2026-11-17, contract `increments/B1/PLAN.md`, state `increments/B1/HANDOFF.md`)

| ID | Module | Description | Agent | Depends | Source | Pri | Status |
|---|---|---|---|---|---|---|---|
| T-B1-00 | plan | PLAN.md: D-B1-01..19, §R, schema/API/permission contracts, screens, workflows, deferrals | architect | - | spec.json | P0 | Completed |
| T-B1-01 | db | Migrations 0100–0107, SoD primitive `@nmp/db` approvals, permissions catalogue, seed (finance@, DEMO draft, e2e fixture pack), config D-B1-16, `lib/db.ts` key caller | database | T-B1-00 | PLAN §1 §3 §6 | P0 | Completed |
| T-B1-02 | db | Review fixes 0108: case submit/withdraw/evidence actor binding, money-key backstop at same effective_from, webhook scheduled CHECK, actor columns, pack-rule rule_key + EXCLUDE | database | T-B1-01 | review findings | P0 | Completed |
| T-B1-03 | IAM/INT/CPL/support | BE1: service accounts, API keys, key auth, public API, webhooks + outbox dispatch, pack-rule API, support requester (BUG-023) | backend | T-B1-01 | FR-IAM-006 FR-INT-001 FR-CPL-012 | P0 | Completed |
| T-B1-04 | TEN/PAY | BE2: markets, brands, calendars, settings timeline with rebase, money change requests, launch checklist, go-live sign-off, provider eligibility | backend | T-B1-01 | FR-TEN-002/003/004 FR-IAM-004 | P0 | Completed |
| T-B1-05 | CAS/AUD | BE3: case framework (registry, state machine, evidence, SoD decisions; not mounted) and evidence documents | backend | T-B1-01 | FR-CAS-001 | P0 | Completed |
| T-B1-06 | api | Integration: modules/index.ts (int, pay), isolation seed and cases, role matrix, `.env.example` | integrator | T-B1-03..05 | PLAN §P | P0 | Completed |
| T-B1-07 | web | W1: SC-29 B part, Markets/Brands/Calendars, SC-17 checklist | frontend | T-B1-06 | PLAN §5 | P1 | Completed |
| T-B1-08 | web | W2: SC-13 API keys + webhooks; MVP-A polish BUG-023, 025–029, 045–048 | frontend | T-B1-06 | PLAN §5 §B | P1 | Completed |
| T-B1-09 | qa | Browser rounds 1–2 (W-B1-1..6, 4 viewports, visual harness, Impeccable); BUG-049..059 found, fixed, verified | qa | T-B1-07/08 | PLAN §7 | P1 | Completed |
| T-B1-10 | security | Adversarial review: SEC-B1-1 HIGH key market-scope escalation, SEC-B1-2 MEDIUM tenant-wide approvers, SEC-B1-3 MEDIUM trustProxy, SEC-B1-4 LOW ip_allow limiter | security | T-B1-06 | SEC review | P0 | Completed |
| T-B1-11 | security | Confirm the SEC-B1-1..4 fixes now in the tree (0109, api-keys scope check, TRUST_PROXY, per-address limiter) and register them in BUG_REGISTER | security | T-B1-10 | HANDOFF §4 | P0 | Open |
| T-B1-12 | db | Apply 0109 to nmp_dev, nmp_e2e, nmp_test | orchestrator | T-B1-11 | HANDOFF OI-4 | P1 | Open |
| T-B1-13 | web | BUG-060 SC-17 inspector `break-all` splits "mandatory" | frontend | - | BUG_REGISTER | P3 | Open |
| T-B1-14 | qa | role-matrix `beforeAll` hook timeout under full-suite load (OI-6) | qa | - | records full run | P2 | Open |
| T-B1-15 | infra | Add `TRUST_PROXY` to `.env.example` | integrator | T-B1-11 | HANDOFF SEC-B1-3 | P2 | Open |
| T-B1-16 | records | Copy D-B1-01..19 into ARCHITECTURE_DECISION_LOG | orchestrator | - | PLAN §0 | P2 | Open |
| T-B1-17 | db/CAS | Evidence-vs-submit concurrency test; key-caller `created_by` FK model before key write routes | database | - | HANDOFF OI-2 OI-3 | P2 | Open (B2) |
| T-B1-18 | db | Outbox purge vs `webhook_delivery` FK (ON DELETE decision) | database | - | HANDOFF OI-1 | P3 | Open (V1/ops) |
