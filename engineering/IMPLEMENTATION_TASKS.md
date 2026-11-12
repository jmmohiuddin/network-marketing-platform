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
