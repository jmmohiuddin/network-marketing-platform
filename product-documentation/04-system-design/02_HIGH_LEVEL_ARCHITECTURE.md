# 02 — HIGH-LEVEL ARCHITECTURE
## Components, their responsibilities and the main runtime flows

| Field | Value |
|---|---|
| Document ID | SDD-02 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Solution architect role |
| Depends on | SDD-01, TRD-02 |
| Status | Draft |

## 1. System context

```mermaid
flowchart TB
  CO[Compliance officer<br/>Analyst · Finance · Admin] --> SYS
  DI[Distributor · Team leader] --> SYS
  VE[Vendor operations staff] --> SYS
  DS[Data subject<br/>public privacy form] --> SYS
  SYS[[Compensation and compliance platform]]
  SYS <--> COM[Commerce platforms]
  BO[Existing back office] --> SYS
  SYS <--> PAY[Payout providers / banks]
  SYS --> ERP[Tenant ERP]
  SYS --> MSG[Email / SMS providers]
  SYS <--> IDP[Tenant SSO]
  SYS --> DW[Tenant storage / warehouse]
  SYS -.V1.-> MON[Claims-monitoring partners]
```

## 2. Container diagram (one cell)

```mermaid
flowchart TB
  subgraph CLIENTS[Clients]
    WEB[Staff web application<br/>React, server-rendered shell]
    PORTAL[Distributor portal<br/>mobile-first, server-rendered, installable]
    VC[Vendor console]
    EXTAPI[Integrations<br/>API keys, webhooks]
  end
  subgraph EDGE[Edge]
    CDN[CDN + TLS]
    WAF[WAF + rate limiting]
  end
  subgraph APP[Application - one deployable, two process types]
    direction TB
    API[API / backend entry point<br/>REST /v1, auth middleware,<br/>tenant resolver, validation]
    subgraph MODS[Backend modules]
      IAM[Identity & access]
      TEN[Tenant & market config]
      IMP[Data import]
      CPL[Compliance & guardrails]
      PAR[Participants]
      GEN[Genealogy]
      ORD[Orders & attribution]
      PLN[Plans]
      CAL[Calculation orchestration]
      LED[Ledger]
      PO[Payouts]
      TAX[Tax]
      CAS[Cases]
      DST[Distributor read API]
      PRV[Privacy]
      INT[Integration: connectors, adapters, webhooks]
      RPT[Reporting read models]
    end
    WRK[General workers<br/>ingest · dispatch · rebuild · export · schedule]
    CW[Calculation workers<br/>engine package, in-memory tree]
  end
  subgraph DATA[Data stores]
    PG[(PostgreSQL primary<br/>pooled DB + dedicated DBs<br/>includes job queue + outbox)]
    RR[(Read replica)]
    RD[(Redis<br/>cache, rate limits)]
    OS[(Object storage<br/>documents, snapshots, exports)]
    SS[(Sensitive store<br/>separate keys)]
    AU[(Audit store<br/>append-only)]
  end
  subgraph PLAT[Platform services]
    IDP[Identity provider<br/>realms: staff, portal, vendor]
    SEC[Secrets manager + KMS]
    OBS[Monitoring: metrics, traces, logs, alerts]
    PA[Product analytics<br/>self-hosted, no personal data]
  end
  subgraph EXT[External integrations]
    SHOP[Shopify / WooCommerce / custom commerce]
    PP[Payout providers / bank files]
    ERP[Tenant ERP]
    MSG[Email / SMS]
    TSSO[Tenant SSO]
  end
  WEB & PORTAL & VC & EXTAPI --> CDN --> WAF --> API
  API --> MODS
  API <--> IDP
  IDP <--> TSSO
  MODS --> PG
  MODS --> RD
  MODS --> OS
  MODS --> SS
  MODS -->|outbox| AU
  PG --> RR --> RPT
  PG -->|jobs| WRK
  PG -->|jobs| CW
  CW --> PG
  CW --> OS
  WRK --> PG
  WRK --> INT
  INT <--> SHOP
  INT <--> PP
  INT --> ERP
  INT --> MSG
  APP --> SEC
  APP --> OBS
  WEB --> PA
```

## 3. Component responsibilities

| Component | Responsibility | Technology (provisional, TRD-02) | Scales by |
|---|---|---|---|
| Staff web application | Role-specific admin UI | React, TypeScript | CDN; stateless |
| Distributor portal | Statements, rank, team, customers, details; low bandwidth | Server-rendered React, small bundles | CDN; stateless |
| Vendor console | Tenant operations without business data | Same codebase, separate realm and hostname | — |
| Mobile application | **None at MVP.** The portal is a responsive, installable web application; native apps only if distributor research shows a need (P-09 unverified) | — | — |
| API entry point | TLS termination upstream; authentication; tenant resolution; schema validation; rate limits; idempotency | Node.js process | Horizontal |
| Backend modules | Business logic; each owns its tables | Modular monolith | With API processes |
| General workers | Ingestion, outbox dispatch, read-model rebuild, exports, schedules | Same artefact, worker entry point | Horizontal |
| Calculation workers | Runs, simulations, replays; the engine package has no I/O except through its input and output ports | Same artefact, engine package | Pool with per-tenant limits; memory-optimised instances |
| PostgreSQL | System of record; queue and outbox | PostgreSQL 16+ | Vertical; dedicated DB per large tenant |
| Read replica | Dashboards, reports, exports | Streaming replica | Add replicas |
| Redis | Rate limits; immutable caches | Managed Redis | — |
| Object storage | Evidence, agreements, forms, run snapshot manifests, exports | S3-compatible | — |
| Sensitive store | Identity documents, tax ids, bank-detail ciphertext keys | Separate bucket and KMS hierarchy | — |
| Audit store | Append-only audit events | Separate database or schema with insert-only role; archives to write-once storage | — |
| Identity provider | Authentication, MFA, federation | Self-hosted OIDC provider | — |
| Monitoring | Metrics, traces, logs, alerts | OpenTelemetry to a regional backend | — |
| Analytics | (a) Tenant analytics: replica read models and exports. (b) Product analytics: staff-app usage events without personal data | — | — |

## 4. Main runtime flows

### 4.1 MVP-A: from export to evidence

```mermaid
sequenceDiagram
  actor IC as Implementation consultant
  actor CO as Compliance officer
  participant API
  participant IMP as Import
  participant W as Worker
  participant CPL as Compliance
  participant DB as PostgreSQL
  IC->>API: POST /v1/imports (3 files)
  API->>IMP: create batch (uploaded)
  IMP->>W: validate job
  W->>W: schema, keys, references,<br/>forbidden-column check
  alt forbidden column or schema error
    W->>DB: batch = rejected + row errors
    W-->>IC: validation report, files deleted
  else valid
    W->>DB: batch = validated, control totals
  end
  CO->>API: PUT mapping, approve
  IC->>API: load batch
  W->>DB: write cpl_fact_* in one transaction, supersede older batch
  CO->>API: POST /v1/compliance/snapshots
  W->>CPL: compute R1..R5
  CPL->>DB: snapshot + figures (immutable)
  CO->>API: GET figure rows (drill-down)
  API->>DB: audit event if exported
```

### 4.2 MVP-B: period close

```mermaid
sequenceDiagram
  actor AN as Analyst
  actor FA as Finance approver
  participant API
  participant CAL as Calculation
  participant CW as Calc worker
  participant DB as PostgreSQL
  participant LED as Ledger
  participant OB as Outbox dispatcher
  Note over CAL: cut-off in calendar time zone
  AN->>API: POST /periods/{id}/runs (Run-Request-Id)
  API->>CAL: check sync health, lock (tenant, calendar, period)
  CAL->>DB: write run_snapshot (order watermark, known-at, versions)
  CAL->>CW: enqueue run
  CW->>DB: load facts + tree
  CW->>CW: passes 1..11 in memory, invariants
  CW->>DB: result lines + state candidates (staged), totals, hash
  AN->>API: GET /runs/{id}/review
  AN->>API: request commit
  FA->>API: POST /runs/{id}/commit (step-up MFA)
  API->>CAL: approver ≠ preparer
  CAL->>DB: BEGIN
  CAL->>DB: run, period = committed, state authoritative
  CAL->>LED: balanced journal entry
  CAL->>DB: outbox: RunCommitted
  CAL->>DB: COMMIT
  OB-->>API: statements built, compliance facts written, webhooks sent
```

## 5. Architecture qualities and how they are met

| Quality | Mechanism |
|---|---|
| Financial consistency | Single-transaction commits; database-enforced balance and immutability; idempotency keys |
| Reproducibility | Snapshots; pinned plan, settings, pack and engine versions; pure engine |
| Isolation | Row-level security; routing; namespacing; CI suite |
| Recoverability | Durable queue and outbox in the database; point-in-time recovery; reconciliation after restore |
| Operability by a small team | One artefact; managed data services; no bus; no Kubernetes at MVP |
| Portability and self-hosting | Standard components only (TR-CON-11) |
| Evolvability | Module boundaries; engine behind ports; adapters for every external system |
