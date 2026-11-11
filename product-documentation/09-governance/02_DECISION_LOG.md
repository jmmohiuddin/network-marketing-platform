# 02 — DECISION LOG
## Important decisions with context, alternatives, reasoning, consequences and status

| Field | Value |
|---|---|
| Document ID | GOV-02 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Founder (product and strategy decisions); CTO role (architecture decisions) |
| Status | Draft |

**Status values:** **Decided (founder)** = chosen by the founder for this documentation on 12 November 2026 · **Provisional** = working assumption taken from the research's recommendation; needs the founder, counsel, an adviser or a spike before it is relied on · **Proposed** = engineering proposal in these documents, not yet reviewed.

Nothing in this log has been approved by an independent reviewer (FD-07).

## 1. Product and strategy decisions

| ID | Decision | Context | Alternatives considered | Reasoning | Consequences | Status |
|---|---|---|---|---|---|---|
| DEC-01 | Product scope follows the research path: compliance-analytics overlay first (MVP-A), then engine plus compliance, API-first (MVP-B), conditional on the demand gate | The brief asked for an all-in-one platform with 25 modules; the research concludes "do not start building" and rejects all-in-one positioning (FD-01) | Narrow core plus full all-in-one roadmap; full all-in-one | Breadth is table stakes; market is unbundling; only compliance analytics is unclaimed in sources read; cheapest test first | Storefront, inventory, LMS, marketing, CRM pipelines, general ledger are integrated or dropped; MVP-B is conditional | **Decided (founder)** |
| DEC-02 | Specifications are market-neutral; market-specific rules live in market packs | Launch market undecided (FD-02); Malaysia and India were "priority" without competition or access analysis | Assume Malaysia; India; United States | Avoids inventing tax and legal rules; keeps the choice open | Tax, guardrail, window, language and form values are not in these documents; each pack needs advisers | **Decided (founder)** |
| DEC-03 | The platform calculates and instructs; it never holds participant funds; no wallets, e-pins or crypto | Holding balances may be a regulated activity in every market read | Provider-hosted wallet (later option); platform-operated stored value | Lowest regulatory exposure; matches top-end competitor pattern | Tenants bring their own provider accounts; "earnings balance owed by the tenant" replaces "wallet" | Provisional (counsel Q-2) |
| DEC-04 | Guardrail stance: Moderate (block where a market bans; warn and log; report) | Vendor liability for tenants' plans is unknown (FD-06, Q-1) | Strict; Neutral | Research default proposal | BR-GRD-01..05 as written; override path limited | Provisional (founder, counsel) |
| DEC-05 | Product honesty policy: no income projections, no recruit leaderboards, disclosures from real payouts | Distributor-outcome evidence; regulatory direction (FD-09) | Modify; none | Ethics, trust, regulatory exposure | UI and API contain no projection feature; BR-HON | Provisional (founder) |
| DEC-06 | Commerce is integrated, not built | Build-versus-integrate undecided in research; market unbundling | Native storefront | A storefront is large and undifferentiated | Ingestion API and connectors; no customer-facing commerce screens | Provisional (revisit if buyers want one vendor) |
| DEC-07 | Pricing direction: per active payee plus fixed-scope implementation; never a percentage of volume | Platform business model absent (GAP-075) | Flat tiers; modular; percentage of volume; one-time licence | Tracks cost to serve; does not tie revenue to recruitment volume | "Active payee" must be auditable; values unset | Provisional (FD-03) |
| DEC-08 | Two MVPs: MVP-A (18 requirements) before MVP-B (85) | Audit's feature list and roadmap disagree on what "MVP" is | Engine first | Cheapest test of the riskiest assumption first | Compliance module is built to serve both through a fact layer | Provisional |
| DEC-09 | Earnings-distribution computation is in MVP-A; publication workflow is V1 | Audit marks F-25 V1; the Phase A prototype already computes it | All in V1 | It is part of the demand test and cheap | FR-CPL-005 in A; FR-CPL-009 in V1 | Proposed |
| DEC-10 | Placement trees and multiple positions exist in the data model from MVP-B; serialised binary placement is "Could" | Corpus: placement trees in 4 of 16 hold-out plans; sample is US-heavy | Must; defer entirely | Cheap in the model, costly to build fully; depends on segment | FR-GEN-005 priority Could (OQ-13) | Provisional |
| DEC-11 | No workflow builder; fixed approval flows with a status component | Brief lists a workflow builder; no requirement needs one | Build one | Configurable workflows could weaken separation of duties | UI-04 §3.8 | Proposed |
| DEC-12 | No native mobile app in MVP; the portal is a responsive, installable web application | Mobile use is assumed by vendors, not evidenced | Native apps | Cost; unverified need | WF-06, UI-05 | Proposed |
| DEC-13 | Customers are not users of the product; only two public pages are customer-facing | Product boundary (DEC-06) | Customer account and storefront screens | Belongs to commerce | WF-05 | Proposed |
| DEC-14 | No numeric rate, threshold or window is defined anywhere in these documents | Research forbids inventing rules and legal values | Fill with typical values | Would be fabrication | Settings and packs carry values; tests use labelled fixtures | Decided as a rule of this documentation |
| DEC-17 | The product is sold in two editions from one codebase: hosted SaaS (primary) and a licensed self-hosted edition | Founder instruction 12 Nov 2026 ("for sale as a digital product"; "both editions"). Research rejects one-time licences as a fit for a hosted regulated-data service | Hosted only; self-hosted only; sell the codebase | Opens buyers who require their own servers; one codebase limits cost | Self-hosted is the single-tenant cell; signed licence and updates; no source edition; no cloud-specific dependencies in the core; sequenced at V1; pricing and liability open (OQ-24, OQ-25) | **Decided (founder)**; details Proposed |
| DEC-18 | A licence lapse never blocks calculation, payout, statements or export | Self-hosted edition | Hard stop on expiry | A stop would cause wrong or missed pay | BR-LIC-01 | Proposed |
| DEC-19 | Phase 2 research is scoped to Bangladesh and India | Founder instruction 12 Nov 2026: "Complete the missing research" — all four scope items; "Now do it for Bangladesh and india" | Malaysia and US; market-neutral only | The founder's chosen markets for the remaining desk work | Research 70–79 in `research-completion`; PD-04. FD-02 (launch market) is **not** decided by this | **Decided (founder)** |
| DEC-20 | Do not sell to Bangladeshi MLM operators; no Bangladesh MLM pack. A single-level affiliate pack is considered only after Bangladeshi counsel answers AQ-13 | No MLM licence since 2015; 2022 site closures; 2025 central-bank warning (research 70) | Serve unlicensed operators; ignore Bangladesh | Selling for an activity no one is licensed to run exposes the founder and the company | Bangladesh may still host the build team; tenants cannot select Bangladesh for multi-level plans | Provisional (counsel AQ-13) |
| DEC-21 | India is the recommended first market pack, with a compliance-led offer (MVP-A first) | Market re-score 3.20 against 1.45 and 2.35 (research 75); concrete Indian duties match MVP-A reports | Bangladesh-affiliate first; no pack until FD-02 | Only lawful MLM framework of the two; duties map onto the product's differentiator | PD-04 India pack drafted; India cell (ap-south-1 with ap-south-2 backup); FD-02 still needs founder access scored | Proposed (founder FD-02) |

## 2. Architecture decisions

ADR-01 to ADR-14 are the recommendations of the gap audit (28 §2), adopted here; ADR-15 and ADR-16 are new.

| ID | Decision | Context | Alternatives considered | Reasoning | Consequences | Status |
|---|---|---|---|---|---|---|
| ADR-01 | Modular monolith with a separate calculation worker pool | Small team; ledger and runs need strong consistency | Microservices; hybrid | One deployable; single-database transactions; self-hostable | Separation only on stated triggers (SDD-01 §1) | Provisional |
| ADR-02 | Regional cells; tenant routing supporting pooled and dedicated databases; row-level security everywhere | Residency and large tenants without day-one cost | Shared schema only; schema per tenant; database per tenant only | Start cheap, isolate when needed, same code | Routing layer and RLS from the first release | Provisional |
| ADR-03 | Bitemporal, append-only genealogy; positions separate from participants | Reproducibility and disputes | Update-in-place parent column | History is never lost; corrections and changes differ | `relationship` model (SDD-08) | Provisional |
| ADR-04 | In-memory tree per run; materialised-path read model for interactive use | Deep binary trees; no recursive SQL per node | Closure table; nested sets; graph database | O(N) runs; cheap ancestor tests | Read model is derived and can be stale; **spike must prove it** | Provisional (spike) |
| ADR-05 | Declarative primitives plus a controlled extension point (expressions; platform modules); no tenant-specific code | Corpus: 0 of 16 hold-out plans fit the original blocks; 11 need something new | Code per tenant; fixed list only; DSL only | Breadth with auditability | Extension tiers (SDD-07 §3.2); coverage target needed (OQ-12) | Provisional |
| ADR-06 | Money in minor units; round once per line; largest-remainder allocation; residue to a named account | Stress tests showed cent drift | Floats; per-step rounding | Exact totals | BR-MNY | Provisional |
| ADR-07 | Double-entry obligations sub-ledger with GL export; no general ledger | Tenants have ERPs | General ledger in product | Proves totals without duplicating accounting | SDD-09 | Provisional |
| ADR-08 | Integrate commerce through an idempotent ingestion API and connectors | DEC-06 | Native storefront | — | TRD-05 | Provisional |
| ADR-09 | Provider-adapter interface; at least two payout routes per launch market; tenant-owned accounts | Mainstream providers restrict MLM merchants | Single mainstream provider | No single dependency; eligibility is per merchant | Launch blocker until providers confirm in writing | Provisional |
| ADR-10 | Transactional outbox for all external effects; idempotency keys everywhere | Payout safety | Direct calls | At-least-once delivery, at-most-once effect | SDD-01 §4 | Provisional |
| ADR-11 | Reporting on replica or export; never ad-hoc SQL on the primary | Buyers expect SQL-level access | Shared BI on primary | Protects runs and isolation | Export in MVP-B; replica V1 | Provisional |
| ADR-12 | Vendor access only through tenant-approved, logged sessions | Insider risk across tenants | Standing admin access | Trust; processor duties | FR-IAM-005 | Provisional |
| ADR-13 | Erasure by pseudonymisation where ledger retention applies | Privacy rights versus retention | Hard delete | Keeps ledger integrity | Needs counsel per market | Provisional (counsel) |
| ADR-14 | Brand and market dimensions in the data model from the first release | Multi-brand tenants later | Add later | Cheap now, costly later | Columns on plans, positions, orders | Provisional |
| ADR-15 | Compliance fact layer shared by the overlay and the engine | Reports must be the same in MVP-A and MVP-B | Separate report code per source | One report engine; MVP-A work is reused | `cpl_fact_*` tables written by import or by `RunCommitted` | Proposed |
| ADR-16 | Both editions from one codebase; the self-hosted edition is a single-tenant cell; only standard, self-hostable components in the core | DEC-17 | Fork; separate product | Halves maintenance; same safeguards | TR-CON-11; SDD-11 §8 | Proposed |
| ADR-17 | PostgreSQL 16+ as the single system of record, including the job queue and outbox | Transactions; `ltree`; RLS; small team | MySQL; graph database; distributed SQL; separate queue | Fewest moving parts; transactional enqueue | TRD-02 | Proposed |
| ADR-18 | TypeScript end to end with the engine as an isolated, portable package | No technology research exists; team skills unknown | JVM; .NET; Go; Rust engine | One language; reversible for the engine | Decision rule tied to the spike (TRD-02 §3; OQ-18) | Proposed |
| ADR-19 | Self-hosted OIDC identity provider per cell with three realms | Millions of distributors; residency; self-hosted edition | Managed identity service; in-app authentication | No per-user cost; in region | Must be operated | Proposed |
| ADR-20 | Domain events inside the monolith through the outbox; no distributed bus at MVP | Gap audit 15 §6 | Kafka or similar | Simplicity; consistency | Revisit on separation triggers | Provisional |
| ADR-21 | Run snapshots by reference to immutable or effective-dated sources, with an input hash | Reproducibility without copying inputs | Full physical copy per run | Storage cost; sources are already immutable | Depends on database-enforced immutability | Proposed |

## 3. Decisions the founder still has to make

Listed with their dependencies in `03_OPEN_QUESTIONS.md` §1 (FD-02 to FD-10 and OQ-12, OQ-13, OQ-24, OQ-26).
