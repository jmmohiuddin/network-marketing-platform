# 16 — SECURITY AND FRAUD GAP RESEARCH
## Threats specific to a multi-tenant commission and payout platform

| Field | Value |
|---|---|
| Document ID | GAP-16 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 10 |
| Gaps | GAP-065, GAP-066 (fraud signals in GAP-005) |

## 1. Threat model summary

Columns: **Prevent / Detect / Investigate** controls. The platform never holds funds (A-02), so the highest-value targets are **payout instructions, bank details, plan rules and manual adjustments**, plus the personal data of very large distributor populations (P-04).

| # | Threat | Actor | Prevent | Detect | Investigate |
|---|---|---|---|---|---|
| T1 | Cross-tenant data access | External attacker, bug | Tenant id enforced in the data layer (row-level security or per-tenant DB); no tenant id from the client | Automated cross-tenant access tests in CI; anomaly on queries returning other tenants' ids | Per-request tenant audit |
| T2 | Privilege escalation inside a tenant | Tenant user | Role model with least privilege; approval for role grants | Alert on new admin roles | Role-change history |
| T3 | **Vendor staff access to tenant data** | Our support or engineers | No standing access; time-boxed, tenant-approved "support sessions"; read-only by default; region-bound | Every vendor-staff action logged and visible to the tenant | Tenant-visible access log |
| T4 | Unauthorised genealogy access | Distributor or leader | Server-side visibility policy (08 GAP-012) | Rate limits; scraping detection | Export log |
| T5 | **Bank-detail change before payout** | Account takeover, insider | Re-authentication; notice to old contact; cooling-off before first payout to new details | Many payees changing to the same account; changes just before pay day | Payout trace to account history |
| T6 | **Manual adjustment fraud** | Tenant staff | Reason codes; amount thresholds needing a second approver; no self-approval; adjustments to own or related accounts blocked | Adjustment volume by user; adjustments to recently created accounts | Immutable case history |
| T7 | Plan-rule manipulation | Tenant staff | Plan versions need approval and simulation; committed periods immutable | Diff alerts on rules affecting few payees heavily | Version diff and approver |
| T8 | Fake and duplicate accounts; multiple-account abuse | Distributors | KYC per market; duplicate detection on identity, payment instrument, device, address | Clusters sharing attributes; positions created to fill legs | Case workflow (07 GAP-002) |
| T9 | Volume manipulation (bonus buying, inventory loading) | Distributors | Plan design (customer-count qualification, caps) | Signals in GAP-005 | Order and return history |
| T10 | Account takeover and session hijack | External | MFA for admins and payout approvers; MFA option for distributors; short admin sessions; device binding for approvals | Impossible travel; new device on approver | Session log |
| T11 | API abuse and mass extraction | Integrators, attackers | Scoped API keys; per-key rate limits; pagination caps; no bulk personal-data endpoints without purpose | Volume anomalies per key | Key audit |
| T12 | Sensitive document exposure (ID cards, tax IDs) | Any | Separate encrypted store; short-lived signed URLs; masked display | Access to many documents by one user | Document access log |
| T13 | Payout instruction tampering or replay | Attacker, bug | Signed instructions; idempotency keys; provider allow-list | Reconciliation breaks (10) | Instruction trail |

## 2. Gap records

### GAP-065 — Vendor-staff access, insider threat, payout fraud and tenant isolation

| Field | Content |
|---|---|
| **Category** | Security |
| **Previous research coverage** | P-04 (breach case), MH-REQ-02 (preparer/approver), 08 §6 RBAC sketch (platform admin, tenant admin) |
| **Missing element** | T1, T3, T5, T6, T7 and their controls; the vendor-staff role (06 IC-13) |
| **Evidence** | Breach of distributor credentials and addresses (S-133); manual payment and adjustment procedures at operators (S-132); incumbents document payable adjustments and approvals (G-S30); processors are directly bound by Malaysia's security principle (G-S14) |
| **Why it matters** | The platform concentrates many companies' payout instructions and personal data; one insider or isolation bug is a multi-tenant incident |
| **Affected stakeholders** | Tenants, distributors, the platform |
| **Product implications** | Support-session workflow visible to tenants; approval thresholds; bank-detail change controls; adjustment rules |
| **Technical implications** | Data-layer tenant enforcement; CI isolation tests; immutable audit log stored separately; secrets and signing for payout instructions |
| **Recommended solution** | Treat T1, T3, T5, T6 as **MVP acceptance criteria** (26), not hardening work |
| **Priority** | **Critical** |
| **Implementation stage** | MVP |
| **Confidence** | High |
| **Documentation changes required** | 08 (new ST-25 vendor operations staff), 15 (BR-SEC rules), future security architecture |

### GAP-066 — Buyers expect security attestations

| Field | Content |
|---|---|
| **Category** | Commercial, security |
| **Previous research coverage** | 04 (two vendors claim certifications; unverified) |
| **Missing element** | The cost and timing of obtaining an attestation, and whether buyers in the target segment require one |
| **Evidence** | Exigo claims SOC 2 Type II, GDPR, PCI DSS (G-S31); Infinite claims ISO 27001 and SOC 2 Type II (S-096) — even a low-price vendor markets them |
| **Why it matters** | Without an attestation, enterprise procurement may stop; with a one-time licence competitor claiming one, mid-market buyers may ask too |
| **Affected stakeholders** | Founder, sales, security |
| **Product implications** | Controls in GAP-065 double as attestation evidence |
| **Technical implications** | Logging, access reviews, change management from day one |
| **Recommended solution** | Build controls to SOC 2 / ISO 27001 standard from the start; decide the audit timing with the first enterprise prospect; ask buyers in interviews whether they require it (add to G-EXEC) |
| **Priority** | High |
| **Implementation stage** | V1 |
| **Confidence** | Medium |
| **Documentation changes required** | 66 Appendix A (G-EXEC question), future security documents |

## 3. Fraud detection: rules first

Detection should start as **documented rules with thresholds the tenant sets** (GAP-005, T5, T6, T8). Machine-learning models are not justified until there are labelled cases from operations (17).
