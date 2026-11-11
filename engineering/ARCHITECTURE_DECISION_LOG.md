# Engineering Decision Log

Product decisions live in `product-documentation/09-governance/02_DECISION_LOG.md` (DEC-*, ADR-*). This log records engineering choices made while building, each **provisional** unless marked otherwise. Format: decision · fills/overrides · reason · reverse when.

| ID | Decision | Fills / deviates from | Reason | Reverse when |
|---|---|---|---|---|
| E-ADR-01 | pnpm monorepo: `apps/api` (Fastify+zod), `apps/web` (Next.js), `packages/{db,compliance,engine}` | TRD-02 "NestJS-style modular monolith" | Same properties (modules, DI by plain functions, schema-first validation) with fewer parts | Team prefers NestJS |
| E-ADR-02 | In-app identity behind `IdentityProvider`: argon2id, TOTP, opaque server sessions | **Deviates** from ADR-19 (self-hosted OIDC IdP) | 16 GB machine, Docker unavailable; Keycloak ≈ 1 GB | Before any production use |
| E-ADR-03 | `pg` + SQL, `withTenant()` sets `app.tenant_id` with `SET LOCAL`; roles `nmp_owner` (migrations) and `nmp_app` (runtime, no BYPASSRLS) | ADR-02 | RLS correctness is easiest to audit in plain SQL | — |
| E-ADR-04 | pg-boss for jobs and outbox dispatch | TRD-02 §5 | PostgreSQL-backed, transactional | — |
| E-ADR-05 | Audit store = schema `audit`, insert-only grant, per-tenant hash chain | SDD-11 wants a separate database (conflict C13) | One local instance; schema form is the documented self-hosted shape | Hosted production cell |
| E-ADR-06 | Vendor actions are audited in `audit.vendor_event` (no tenant_id) | Gap: FR-OPS-001/AC-29.3 need a vendor audit log, no entity exists | Keeps `audit_event.tenant_id NOT NULL` | Docs define an entity |
| E-ADR-07 | Build order A → B1..B6; **MVP-B start requires founder confirmation** | GOV-04 §5 gate | Business decision, not engineering | Founder says stop at A |
| E-ADR-08 | `role.tenant_id` and `user_account.tenant_id` stay nullable (system roles, vendor users); RLS policy `tenant_id IS NULL OR tenant_id = current tenant` for role, vendor users reachable only via `withVendor` | DATABASE C-3 | Matches spec.json columns | — |
| E-ADR-09 | Permission catalogue = the strings that appear on screens/APIs in the docs, plus `participant.unmask`, `plan.activate`; role matrix from SDD-10 with SEC-25 names. Kept in one typed file and tested as the TS-36 fixture | Gap: no catalogue in docs | Needed to build anything | Product publishes a catalogue |
| E-ADR-10 | Numeric limits are **configuration with engineering defaults for local use only**: session 12 h absolute / 30 min idle, step-up 10 min (NFR-SEC-04 proposed); lockout 5 failures / 15 min; support session max 8 h; export cap 50,000 rows | Gap: values unspecified | Something must run; DEC-14 concerns plan/compliance thresholds, which still ship with **no** default | Founder sets values |
| E-ADR-11 | Report thresholds (personal-share flag, late-order day, active/rank PV) are tenant settings with no default; a report whose threshold is unset omits that indicator and says so | DEC-14, MVP_A C-15 | Docs forbid shipped parameter values | — |
| E-ADR-12 | Tables are not partitioned in MVP-A; partitioning added in B where DATABASE.md requires it, with the partition key added to the PK | DATABASE C-1/C-2 | Volumes in A do not need it | B3/B4 |
| E-ADR-13 | Uploaded files stored on local disk under `var/uploads/<tenant>/` behind a `FileStore` interface | TRD-02 §7 S3-compatible | No MinIO locally | Hosted deployment |
