# 06 — API DESIGN
## API boundaries, the endpoint catalogue and representative specifications

| Field | Value |
|---|---|
| Document ID | SDD-06 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Backend architect role |
| Depends on | TRD-03 (standards), PRD-02, SDD-03 |
| Status | Draft. Contracts are representative, not final OpenAPI; every endpoint traces to a requirement (catalogue column *Requirements*) |

## 1. API boundaries

```mermaid
flowchart LR
  subgraph Clients
    S[Staff app]
    P[Distributor portal]
    V[Vendor console]
    I[Integrations]
    PR[Providers]
    PUB[Public forms]
  end
  subgraph API["/v1"]
    A1["auth, users, settings, audit"]
    A2["imports, compliance"]
    A3["participants, positions, genealogy, customers"]
    A4["orders, order-events"]
    A5["plans, simulations"]
    A6["periods, runs, result-lines, restatements"]
    A7["ledger, payout-batches, payees, tax"]
    A8["cases, privacy-requests"]
    A9["me: portal read API"]
    A10["webhooks/providers: inbound"]
    A11["support-sessions, system"]
  end
  S --> A1 & A2 & A3 & A5 & A6 & A7 & A8
  P --> A9 & A8
  V --> A11
  I --> A4 & A3 & A2 & A7
  PR --> A10
  PUB --> A8
```

| Boundary | Audience | Authentication | Notes |
|---|---|---|---|
| Staff API | Staff web application | OIDC token (staff realm) | Same endpoints are available to tenant automation with API keys where the scope exists |
| Portal API (`/v1/me/...`) | Distributors | OIDC token (portal realm) | Read-mostly; every response filtered to self or permitted downline |
| Integration API | Commerce connectors, tenant systems | API key with scopes | Writes are idempotent |
| Provider webhooks | Payout providers | Provider signature | No tenant token; tenant resolved from the endpoint path secret and provider account |
| Vendor API | Vendor console | OIDC token (vendor realm) | Tenant business data only inside an approved support session |
| Public | Privacy request form; (V1) disclosure page | None; strict rate limits and bot protection | No data returned beyond confirmation |

The API is one surface in one deployable. Module facades sit behind it; the API layer contains no business logic.

## 2. Endpoint catalogue

Paths list the main resource; sub-resources named in *Purpose* follow the same standards.

