# 02 — TECHNOLOGY STACK EVALUATION
## Alternatives compared against this product's needs, with a recommendation for each layer

| Field | Value |
|---|---|
| Document ID | TRD-02 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | CTO role |
| Depends on | TRD-01; gap audit 08, 15, 28 |
| Status | Draft. **The research contains no technology research.** This evaluation is engineering reasoning from the product's requirements. Recommendations are provisional until (a) the team's skills are stated (OQ-18) and (b) the Phase C spike proves the engine targets |

## 1. Selection criteria (from the requirements, not from popularity)

| # | Criterion | Why it matters here |
|---|---|---|
| K1 | Transactional integrity across ledger, run commit and outbox | TR-FIN-01 |
| K2 | Exact decimal and integer arithmetic; determinism | TR-ENG-06, -09 |
| K3 | Memory-efficient processing of a 2M-node tree | TR-GEN-03 |
| K4 | Data-layer tenant isolation and placement per region | TR-DAT-07, TR-CON-05 |
| K5 | Few moving parts for a small team | TR-CON-10 |
| K6 | Self-hostable or regional for residency; no per-user pricing that explodes with millions of distributors | GAP-061 |
| K7 | Low-bandwidth, accessible distributor pages | NFR-PERF-06 |
| K8 | Long-term maintainability; hiring | — |
| K9 | Runs unchanged as a self-hosted single-tenant installation (DEC-17): only standard, self-hostable components | TR-CON-11 |

## 2. Database

| Option | For | Against | Verdict |
|---|---|---|---|
| **PostgreSQL 16+** | ACID; row-level security; `ltree` with GiST for path queries (research G-S35); range types and exclusion constraints for effective dating; partitioning; logical replication for replicas and export; every cloud offers it managed | Vertical scaling limits (not reached by the assumed workload) | **Recommended** |
| MySQL 8 | Mature; managed everywhere | No row-level security, no exclusion constraints, no `ltree` | Not chosen |
| Graph database for genealogy | Natural traversals | A second store to run, secure, back up and keep consistent with the ledger; not justified at MVP (gap audit 08 §5) | Rejected |
| Distributed SQL (CockroachDB, Yugabyte) | Horizontal scale; geo-partitioning | Operational and cost overhead; workload fits one node per tenant group | Reconsider only if a single tenant outgrows a dedicated database |
| Document store | Flexible plan documents | Ledger and bitemporal constraints need relational guarantees; plan rules fit `jsonb` in PostgreSQL | Rejected |

## 3. Backend language and framework

The engine is the deciding workload: decimal arithmetic, deterministic iteration, arrays over millions of nodes, an embedded expression evaluator.

| Option | K2 arithmetic | K3 large tree | K5 one stack | K8 | Notes |
|---|---|---|---|---|---|
| **TypeScript on Node.js (NestJS-style modular monolith)** | `BigInt` for minor units; decimal library for intermediates; determinism achievable with care | Typed arrays hold 2M nodes compactly; single-threaded worker per run is acceptable; worker threads for parallel tenants | One language across API, web, portal, connectors and engine | Large hiring pool | Risk: accidental `number` arithmetic on money; mitigated by a `Money` type, lint rule and static test TS-67 |
| Kotlin or Java (Spring) | `BigDecimal` and `long` native; strongest numeric tooling | Excellent; primitives and mature profilers | Two languages with a TypeScript front end | Strong in finance | Higher ceremony; best fit if the team already has JVM skills |
| C# (.NET) | `decimal` native | Excellent | Two languages | Strong | Comparable to JVM |
| Go | Integers fine; decimals by library | Excellent memory behaviour | Two languages | Good | Weaker for rich domain modelling and expression languages |
| Python | `Decimal` native (the research scripts use it) | Slow and memory-heavy at 2M nodes | Two languages | Good | Suitable for prototypes and QA verification, not the engine |
| Rust for the engine only | Exact and fast | Best | Three toolchains | Smaller pool | Over-engineered before a measured need |

**Recommendation (provisional):** **TypeScript end to end**, with the engine as an isolated package that depends on nothing but its inputs (so it can be rewritten for another runtime without touching the rest). **Decision rule:** if the Phase C benchmark misses NFR-PERF-05 after reasonable optimisation, move only the engine package to the JVM or Go; the architecture's worker boundary (SDD-07) makes that a contained change. If the founding team's strongest skill is JVM or .NET, choose that for the whole backend instead: the design does not depend on the language.

Framework requirements regardless of choice: explicit module boundaries enforceable in CI; dependency injection; schema-first API validation generating the OpenAPI document; first-class background jobs.

## 4. Frontend

| Option | For | Against | Verdict |
|---|---|---|---|
| **React with a server-rendering framework (Next.js or equivalent), TypeScript** | Server-rendered distributor pages for low bandwidth (K7); one component model for admin and portal; large ecosystem for tables, charts, accessibility primitives | Framework churn; care needed to keep the portal bundle small | **Recommended** |
| Server-rendered templates with light scripting (for the portal only) | Smallest payloads; works without scripts | Two UI stacks | Fallback if NFR-PERF-06 cannot be met |
| Vue or Svelte equivalents | Comparable | Smaller pool for complex data tables | Acceptable if the team prefers |
| Angular | Strong for large admin apps | Heavier client; weaker server rendering story for the portal | Not chosen |
| Native mobile apps | Push, offline | Mobile usage is unevidenced (P-09); two more codebases | **Not in MVP**; the portal is a responsive, installable web app |

Component foundation: an accessible headless component library plus the design tokens of `07-ui-design/03_DESIGN_TOKENS.md`. Virtualised tables for large lists. Charts by a library that renders accessible SVG.

## 5. Caching, queue and background work

| Need | Options | Recommendation | Reason |
|---|---|---|---|
| Job queue and outbox dispatch | PostgreSQL-backed queue (transactional enqueue) · Redis-backed queue · cloud queue (SQS and similar) · Kafka | **PostgreSQL-backed queue** | Enqueue in the same transaction as the state change (K1); one store fewer (K5); throughput is far above need. Kafka and a distributed bus are explicitly not needed at MVP (gap audit 15 §6) |
| Cache | Redis (managed) · in-process | **Redis** for rate limits, sessions metadata and immutable read-through items (plan versions, committed statements); in-process for per-request memoisation | Only immutable data is cached (gap audit 15 §6) |
| Scheduling | Queue's scheduler | Same | — |
| Calculation workers | Same codebase, separate process pool | Dedicated worker deployment with per-tenant concurrency limits | NFR-SCAL-02 |

## 6. Search

| Option | Verdict |
|---|---|
| **PostgreSQL full-text plus trigram indexes plus the path read model** | **Recommended** for MVP (gap audit 15 §6) |
| Dedicated search engine (OpenSearch and similar) | Only if staff search over millions of participants misses targets; adds a store holding personal data |

## 7. File storage

**S3-compatible object storage**, per region, private buckets, server-side encryption with managed keys; a **separate bucket and key hierarchy for sensitive documents** with short-lived signed URLs (SEC-07). Alternatives (database large objects, shared file systems) rejected for cost and access control.

## 8. Authentication and authorisation

| Option | For | Against | Verdict |
|---|---|---|---|
| **Self-hosted OpenID Connect provider (Keycloak-class) per region** | Standard protocols; MFA, WebAuthn, passwordless; tenant SSO federation (SAML, OIDC); separate realms for tenant staff, distributors and vendor; in-region; no per-user fee | Must be operated and patched | **Recommended** |
| Managed identity service (Auth0, Cognito, Entra External ID and similar) | Less to operate | Per-active-user pricing with millions of distributors; region and residency limits vary; realm separation and step-up vary | Acceptable for staff realm only; cost model rules it out for distributors |
| Authentication written in the application | Full control | Security-critical code to own | Rejected |

Authorisation is **in the application**: role permissions (RBAC) plus attribute checks (market and brand scope; downline relationship; separation of duties from actor ids), with row-level security as the tenant backstop. A policy engine (OPA, Cedar) is not needed at MVP; the permission catalogue is a typed table tested by the authorisation matrix (TS-36).

## 9. Analytics and reporting

| Need | Recommendation | Alternatives considered |
|---|---|---|
| Operational dashboards | Read models in PostgreSQL refreshed on commit and ingestion, served from the **replica** | BI tool on the primary (rejected, ADR-11) |
| Tenant analysis | Scheduled export (CSV and Parquet) to tenant storage; V1 read-only replica for dedicated tenants | Embedded BI (later, if buyers ask) |
| Product analytics (our own usage metrics) | Self-hosted, cookieless, no personal data; staff applications only at first | Third-party trackers (rejected for the portal: privacy and residency) |

## 10. Monitoring and observability

OpenTelemetry instrumentation (vendor-neutral) for traces, metrics and logs. Backend: the cloud's managed monitoring or a managed observability service **in region**; choice is cost-driven and reversible because instrumentation is standard. Error tracking with personal-data scrubbing. Alert rules of NFR-OBS-04.

## 11. Cloud infrastructure

| Criterion | AWS | Google Cloud | Azure |
|---|---|---|---|
| Regions in candidate markets | US; India (Mumbai, Hyderabad); Malaysia region launched 2024 | US; India (Mumbai, Delhi); Malaysia region announced, availability to verify | US; India (several); Malaysia West launched 2025 |
| Managed PostgreSQL with replicas, point-in-time recovery | Yes | Yes | Yes |
| Managed containers without running Kubernetes | Yes (ECS on Fargate) | Yes (Cloud Run) | Yes (Container Apps) |
| Secrets, KMS, object storage | Yes | Yes | Yes |

Region availability was **not re-verified for this document** and must be checked when the launch market is chosen (OQ-19). **Self-hosted edition:** because of K9 nothing below the application may be cloud-specific. Every recommended component (PostgreSQL, Redis, S3-compatible storage such as MinIO, a Keycloak-class identity provider, OpenTelemetry) has a self-hostable form; this is a second reason for the PostgreSQL-backed queue and against managed identity services.

**Recommendation:** choose the provider with a region in the launch market and the team's experience; default **AWS**. Keep the design portable: containers, PostgreSQL, S3-compatible storage, OpenTelemetry, infrastructure as code. No provider-specific database or queue.

## 12. Deployment and CI/CD

| Layer | Recommendation | Alternatives |
|---|---|---|
| Packaging | Containers | — |
| Runtime | Managed container service (no self-run Kubernetes at MVP) | Kubernetes when several cells and teams exist |
| Infrastructure as code | Terraform or OpenTofu; one module per cell | Cloud-specific tools (less portable) |
| CI/CD | Hosted pipeline (GitHub Actions or equivalent) with the gates of TR-DEP-04; staged rollout per cell | — |
| Database migrations | Versioned, forward-only tool run per database by the pipeline | — |

## 13. Summary of recommendations

| Layer | Choice | Confidence | Reverses if |
|---|---|---|---|
| Database | PostgreSQL 16+ | High | — |
| Backend | TypeScript modular monolith; engine as isolated package | Medium | Team skills differ; spike misses targets (engine only) |
| Frontend | React with server rendering | Medium | Portal budget missed (use server templates for the portal) |
| Queue | PostgreSQL-backed | High | Throughput measured far above assumptions |
| Cache | Redis | High | — |
| Search | PostgreSQL | Medium | Staff search misses targets |
| Storage | S3-compatible, sensitive store separate | High | — |
| Identity | Self-hosted OIDC provider per region | Medium | Team cannot operate it (managed for staff realm) |
| Cloud | AWS by default | Low–medium | Launch market or team experience |
| Deploy | Managed containers, IaC, hosted CI | High | — |
