# 04 — SECURITY REQUIREMENTS
## Security, privacy and fraud-prevention requirements with class and basis

| Field | Value |
|---|---|
| Document ID | TRD-04 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Security architect role |
| Depends on | TRD-01; gap audit 16, 29; SDD-10 (security architecture) |
| Status | Draft. Items of class M are screening-grade until counsel confirms |

**Classes:** **M** mandatory by law in a named market · **K** contractual (provider terms) · **R** recommended practice or buyer expectation · **D** design rule. IDs `SEC-`, `PRV-` and `CPL-` 01 onward keep the numbering of gap audit 29; items numbered from 20 are added here.

## 1. Authentication

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-03 | MFA (TOTP or WebAuthn) for tenant admins, payout preparers and approvers, plan approvers, compliance officers, DPO and all vendor staff; optional for other staff and for distributors | R | A |
| SEC-20 | Step-up: commit run, approve batch, activate plan, approve adjustment or write-off, approve role grant, unmask sensitive field, change bank details require a factor verified within the step-up window | D | A/B |
| SEC-21 | Three separate identity realms: tenant staff, distributors, vendor staff. A credential from one realm is never valid in another | D | A |
| SEC-22 | Tenant staff may federate to the tenant's own identity provider (OIDC or SAML); MFA assurance must be asserted or enforced by us | R | B |
| SEC-23 | Passwords, where used: checked against breached-password lists, length-based policy, slow hash; lockout with generic messages; rate limits per account and per IP | R | A |
| SEC-24 | Distributor sign-in by one-time code to verified contact or password; re-authentication for bank and tax changes | D | B |

## 2. Authorisation: RBAC and ABAC

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-25 | **RBAC:** permissions granted through roles; platform base roles (Tenant admin, Commission analyst, Plan administrator, Finance approver, Payout officer, Compliance officer, Support agent, DPO, Implementation consultant, Executive read-only, Integration) can be cloned into tenant roles | D | A |
| SEC-26 | **ABAC where RBAC is not enough:** (a) market and brand scope on a role assignment; (b) downline relationship and depth for distributor-facing data; (c) self (own statements, own details); (d) separation of duties from recorded actor ids; (e) related-party and new-account conditions on adjustments; (f) support-session scope and region for vendor staff | D | A/B |
| SEC-04 | Preparer ≠ approver for payout batches, run commits, plan activations, settings that affect money, erasure, update activation; no self-approval of adjustments | D | B |
| SEC-27 | Grant of an admin or approver role needs a second admin; a user cannot grant a permission they lack; alert on every new admin | D | A |
| SEC-08 | Field-level downline visibility enforced on the server; out-of-scope objects indistinguishable from missing ones | D | B |

## 3. Tenant isolation

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-01 | Tenant id enforced in the data layer (row-level security in pooled databases; separate database for dedicated tenants); the application database role cannot bypass it; tenant id never taken from the client | D (M as processor security duty in Malaysia, as reported) | A |
| SEC-28 | Automated cross-tenant test for **every** endpoint, generated from the OpenAPI document; the build fails if an endpoint is not covered | D | A |
| SEC-29 | Background jobs, caches, object-storage keys, search indexes, logs and exports are all namespaced by tenant; a job cannot run without an explicit tenant context | D | A |
| SEC-30 | Per-tenant encryption keys for sensitive fields and documents | R | B |

## 4. Encryption and secrets

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-31 | TLS 1.2 or later for all traffic including internal service and database connections | R | A |
| SEC-32 | Encryption at rest for databases, backups and object storage | R | A |
| SEC-07 | Sensitive documents and values (identity documents, tax ids, bank details) in a separate encrypted store; short-lived signed URLs; masked display; every unmask audited | R | B |
| SEC-33 | Secrets (provider credentials, signing keys, webhook secrets) only in a secrets manager; rotated; never in code, images, logs or database columns | R | A |
| SEC-13 | Card data never touches the platform | K | A |

## 5. Session management

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-34 | Short-lived access tokens; rotating refresh tokens with reuse detection; absolute and idle limits (NFR-SEC-04); server-side revocation on role change, password change and deactivation | R | A |
| SEC-35 | Cookies `Secure`, `HttpOnly`, `SameSite`; CSRF protection on cookie-authenticated writes; strict content security policy | R | A |
| SEC-36 | Approver sessions bound to the device that passed MFA; a new device forces MFA | R | B |

## 6. Audit logs

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-09 | Immutable, hash-chained audit log in a separate store; covers sign-ins, role and permission changes, settings, plan transitions, runs, commits, approvals, adjustments, payouts, bank-detail and tax changes, unmasking, exports, guardrail decisions, vendor sessions and every action inside them | R | A |
| SEC-37 | Tenants can read their own audit log including vendor actions; vendor staff read it only inside a session | D | A |
| SEC-38 | Audit retention per market; chain verification daily; alert on a break | R | A |

## 7. API security

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-10 | Scoped API keys; per-key rate limits; pagination caps; no bulk personal-data endpoints without a purpose scope; IP allow-lists per key | R | B |
| SEC-39 | Input validation by schema; output encoding; parameterised queries only; upload scanning; size limits; SSRF protection on outbound webhooks (allow public HTTPS only) | R | A |
| SEC-06 | Signed, idempotent payout instructions; provider allow-list per tenant; inbound provider webhooks verified by signature | D | B |

## 8. Fraud prevention

Rules first, with thresholds the tenant sets; no machine-learning model until labelled cases exist (gap audit 16 §3).

| ID | Requirement | Threat | Class | Release |
|---|---|---|---|---|
| SEC-05 | Bank-detail change: re-authentication, notice to previous contact, cooling-off, hold of payouts inside it | T5 | D | B |
| SEC-40 | Signal: several payees changing to the same account; changes shortly before pay day | T5 | D | B |
| SEC-41 | Manual adjustments: reason code, evidence, threshold for second approver, block on own or related accounts and on accounts younger than a setting; report of adjustment volume by user | T6 | D | B |
| SEC-42 | Plan versions need simulation and approval; alert when a rule change concentrates gains on few payees | T7 | D | B |
| SEC-43 | Duplicate-account detection on hashed identity, payment fingerprint, address and device | T8 | D | B |
| SEC-44 | Integrity signals for volume manipulation (FR-CPL-010) | T9 | D | V1 |
| SEC-45 | Export limits by role; watermarking; scraping detection on genealogy endpoints | T4, T11 | D | A/B |

## 9. Secure file handling

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-46 | Uploads: type allow-list by content inspection, size limit, malware scan, stored outside the web root under random keys, served only through signed URLs with content-disposition attachment | R | A |
| SEC-47 | Overlay imports: forbidden-column check before storage; rejected files deleted immediately | D | A |
| SEC-48 | Generated files (statements, forms, exports) are private, expire from download links, and are logged on access | R | B |

## 10. Vendor staff and operations

| ID | Requirement | Class | Release |
|---|---|---|---|
| SEC-02 | No standing vendor access to tenant data; approved, time-boxed, scoped, read-only-by-default sessions, visible to the tenant | D | A |
| SEC-49 | Production access for engineers is by break-glass with second-person approval and full recording; database consoles are not used for routine work | R | A |
| SEC-50 | Change management: reviewed pull requests, signed artefacts, separation between author and approver of production deployments | R | A |
| SEC-11 | Backup restore tests on a schedule; RPO and RTO set by the founder | R | A |
| SEC-12 | Controls mapped to SOC 2 and ISO 27001 from the first release; external attestation timed with the first enterprise prospect | R | V1 |
| SEC-51 | Self-hosted edition: no vendor access path; signed releases; support bundle redaction test; the licensee's security duties are listed in the installation guide (shared-responsibility table) | D | V1 |

## 11. Privacy

| ID | Requirement | Class | Release |
|---|---|---|---|
| PRV-01 | Data protection officer function for the platform as processor when serving Malaysian tenants | M (MY, as reported) | A if MY |
| PRV-02 | Breach-notification runbook; tenant contacts and timelines stored | M (MY; IN from May 2027, as reported) | A |
| PRV-03 | Data-processing agreement with each tenant (roles, sub-processors, transfers, deletion) | M in GDPR-type regimes; R elsewhere | A |
| PRV-04 | Data-subject request tooling: access, correction, erasure by pseudonymisation, portability | M (MY portability; IN from 2027, as reported) | B |
| PRV-05 | Retention timers per data class; deletion jobs with logs | M (IN from 2027, as reported); R | V1 |
| PRV-06 | Data region per tenant; transfer controls; support access by region | M (IN Rule 5(5) as reported; VN) | A |
| PRV-07 | Prospect data private to the distributor; consent before marketing messages | M (consent law per market) | V1 |
| PRV-20 | Data minimisation in the overlay: pseudonymous ids only | D | A |
| PRV-21 | Record of processing activities and sub-processor list maintained by the vendor | R | A |

## 12. Compliance capabilities

CPL-01 to CPL-15 are implemented by functional requirements: guardrails (FR-CPL-007, -008), participant types and purpose (FR-PAR-001, FR-ORD-003), reports (FR-CPL-001..006), disclosure (FR-CPL-009), filing status (FR-PLN-007), cooling-off and buy-back windows (FR-ORD-004), registers (FR-CPL-013), withholding and forms (FR-TAX-002, -003), provider eligibility (FR-PAY-006), claims feed (FR-CPL-011), market gating (FR-PAR-002), honesty policy (BR-HON-01), basis status (FR-CPL-012).

## 13. Open security questions

| Question | Owner |
|---|---|
| Do buyers in the target segment require an attestation before purchase? | Interviews (G-EXEC) |
| Which market's processor duties apply first? | FD-02, counsel |
| Shared-responsibility and liability terms for the self-hosted edition | Counsel (OQ-25) |
