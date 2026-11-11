# 29 — MISSING SECURITY AND COMPLIANCE REQUIREMENTS
## Requirements with their class (mandatory, contractual, recommended) and basis

| Field | Value |
|---|---|
| Document ID | GAP-29 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Classes | **M** mandatory by law or binding order (in the named market) · **K** contractual (provider terms) · **R** recommended (good practice, self-regulation or buyer expectation) · **D** design rule (our decision) |
| Not legal advice | M items are screening-grade until counsel confirms (A-07) |

## 1. Security requirements

| ID | Requirement | Class | Basis | Gap | Stage |
|---|---|---|---|---|---|
| SEC-01 | Tenant isolation enforced in the data layer; automated cross-tenant tests for every API endpoint in CI | D (M as processor security duty in MY) | 16 T1; G-S14 | GAP-065 | MVP |
| SEC-02 | No standing vendor-staff access to tenant data; approved, time-boxed, logged sessions visible to the tenant | D | 16 T3 | GAP-065 | MVP |
| SEC-03 | MFA for tenant admins, payout preparers and approvers, vendor staff | R | 16 T10 | GAP-065 | MVP |
| SEC-04 | Preparer ≠ approver for payout batches and plan activations; no self-approval of adjustments | D | MH-REQ-02; 16 T6 | GAP-065 | MVP |
| SEC-05 | Bank-detail changes: re-authentication, notice to previous contact, cooling-off | D | 16 T5 | GAP-035 | MVP |
| SEC-06 | Signed, idempotent payout instructions; provider allow-list per tenant | D | 16 T13 | GAP-035 | MVP |
| SEC-07 | Sensitive documents (ID, tax IDs) in a separate encrypted store; signed short-lived URLs; masked display | R | 16 T12; P-04 | GAP-065 | MVP |
| SEC-08 | Field-level downline visibility enforced server-side; export limits and logging | D | 08 GAP-012 | GAP-012 | MVP |
| SEC-09 | Immutable audit log in a separate store, retained per policy | R | S-120 audit duties | GAP-065 | MVP |
| SEC-10 | Per-key API rate limits; pagination caps; no bulk personal-data endpoints | R | 16 T11 | GAP-065 | MVP |
| SEC-11 | Backup restore tests on a schedule; RPO/RTO set by the founder | R | 15 §6 | GAP-060 | MVP |
| SEC-12 | Controls mapped to SOC 2 / ISO 27001 from day one; external attestation timed with first enterprise prospect | R (buyer expectation) | G-S31, S-096 | GAP-066 | V1 |
| SEC-13 | Card data never touches the platform (tokenised by providers) | K (PCI DSS via providers) | 10 §1 | GAP-030 | MVP |

## 2. Privacy requirements

| ID | Requirement | Class | Basis | Gap | Stage |
|---|---|---|---|---|---|
| PRV-01 | Appoint a data protection officer function for the platform as processor when serving Malaysian tenants | M (MY) | G-S14 | GAP-085 | MVP if MY |
| PRV-02 | Breach-notification runbook: notify tenants without delay with facts they need to notify regulators and individuals | M (MY from Jun 2025; IN from May 2027) | G-S10, G-S14 | GAP-085 | MVP |
| PRV-03 | Data-processing agreement with each tenant (roles, sub-processors, transfers, deletion) | M (GDPR-type regimes); R elsewhere | G-S10, G-S14 | GAP-085 | MVP |
| PRV-04 | Data-subject request tooling: access, correction, erasure (pseudonymisation in ledger), portability | M (MY portability; IN from 2027) | G-S10, G-S14 | GAP-085 | MVP |
| PRV-05 | Retention timers per data class; deletion jobs with logs | M (IN from 2027); R | G-S10 | GAP-085 | V1 |
| PRV-06 | Data region per tenant; transfer controls and support access by region | M (IN Rule 5(5) as reported; VN) | S-039, S-048 | GAP-061 | MVP if IN |
| PRV-07 | Prospect data private to the distributor by default; consent before marketing messages | M (consent law per market) | CMP-15 | GAP-041 | V1 |

## 3. Compliance capabilities (tenant-facing)

| ID | Requirement | Class | Basis | Gap | Stage |
|---|---|---|---|---|---|
| CPL-01 | Platform guardrails: blocked / warned / reported (BR-GRD-01..05) | D (C: counsel) | GAP-087 | GAP-087 | MVP |
| CPL-02 | Participant types and order purpose so retail share is measurable | R; M for one company under its order | G-S02 | GAP-028 | MVP |
| CPL-03 | Reports: retail-customer share, personal-consumption share of rewarded volume, payout-source mix | R | S-020, G-S02 | GAP-081 | MVP |
| CPL-04 | Earnings disclosure from payouts (all participants, zero earners), versioned with method | R (US self-regulation); M if the FTC NPRM is adopted | G-S03, G-S15 | GAP-086 | V1 |
| CPL-05 | Substantiation retention for earnings figures used in tenant materials | Proposed (US) | G-S03 | GAP-086 | V1 |
| CPL-06 | Plan-version filing status per market blocks activation where filing is required | M (MY) | S-043 | GAP-097 | MVP if MY |
| CPL-07 | Cooling-off and buy-back windows per market drive reversals | M (MY, several US states) | S-015, S-124 | — (original CMP-07) | MVP |
| CPL-08 | Grievance register with response-time tracking | M (IN, as reported) | S-085 | — (original CMP-09) | MVP if IN |
| CPL-09 | Delisted-seller register publishable on the tenant site | M (IN, as reported) | S-085 | — (original CMP-17) | MVP if IN |
| CPL-10 | Withholding computation and year-end statements per market | M | G-S05, G-S12, G-S13 | GAP-031 | MVP (launch market) |
| CPL-11 | Payment and payout provider eligibility recorded per tenant and market before go-live | K | G-S04, G-S20, G-S21 | GAP-004 | MVP |
| CPL-12 | Approved-claims catalogue and disclosure feed for monitoring partners | R | G-S15, G-S18 | GAP-001 | V1 |
| CPL-13 | Market gating of enrolment and shipping | M where markets are unlicensed for the tenant | 51 §3.2 | GAP-006 | MVP |
| CPL-14 | Product honesty policy: no income projection features; disclosures linked wherever earnings appear | D | G-S16, G-S27 | GAP-003 | MVP |
| CPL-15 | Each rule's `basis_status` (screening / primary read / counsel-confirmed) stored in configuration metadata | D | GAP-102 | GAP-102 | MVP |
