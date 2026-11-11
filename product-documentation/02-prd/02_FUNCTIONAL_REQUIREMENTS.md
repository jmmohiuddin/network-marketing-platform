# 02 — FUNCTIONAL REQUIREMENTS
## Every functional capability, by module, with full requirement records

| Field | Value |
|---|---|
| Document ID | PRD-02 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Product (CPO role) |
| Depends on | PRD-01, PRD-04 (business rules), PRD-05/06 (stories, acceptance), research gap audit 22–29 |
| Status | Draft. Not approved |

**How to read this document.** Each requirement has a unique ID (`FR-<module>-<nnn>`) that never changes or is reused. *Release* is **MVP-A** (compliance-analytics overlay, the demand test), **MVP-B** (engine plus compliance, built only if the Phase B gate passes), **MVP-B (market pack)** (needed only when the launch market's pack requires it), or **V1**. *Traces to* points at the research: `GAP-…` gaps and `F-…` features in the gap audit, `CMP-…` and `MH-REQ-…` in the legal research, `SEC/PRV/CPL-…` in gap audit 29, `P1` and `P4` in Phase A. A requirement with no research trace does not exist in this document (gate rule G4′).

**Status of confidence.** Persona needs behind these requirements are hypotheses: no interview has been conducted. Requirements marked Must are *hygiene* (needed to be credible and safe) unless they are in the compliance module, which is the unvalidated differentiator. Thresholds written as "tenant setting" or "market pack" are deliberately not given values here.

## 1. Summary

| Release | Requirements |
|---|---|
| MVP-A | 18 |
| MVP-B | 81 |
| V1 | 19 |
| MVP-B (market pack) | 4 |
| **Total** | **122** |

| Module | Prefix | MVP-A | MVP-B | Later |
|---|---|---|---|---|
| Identity and access | FR-IAM | 4 | 3 | 0 |
| Tenant and market configuration | FR-TEN | 1 | 3 | 1 |
| Data import (overlay) | FR-IMP | 3 | 0 | 1 |
| Compliance analytics and guardrails | FR-CPL | 6 | 4 | 3 |
| Participants | FR-PAR | 0 | 5 | 1 |
| Genealogy | FR-GEN | 0 | 9 | 0 |
| Orders and returns | FR-ORD | 0 | 5 | 1 |
| Customer attribution | FR-CRM | 0 | 2 | 1 |
| Plans | FR-PLN | 0 | 8 | 0 |
| Calculation engine | FR-COMP | 0 | 11 | 1 |
| Obligations ledger | FR-FIN | 0 | 5 | 2 |
| Payouts | FR-PAY | 0 | 7 | 0 |
| Tax | FR-TAX | 0 | 3 | 0 |
| Cases | FR-CAS | 0 | 3 | 0 |
| Distributor portal | FR-DIST | 0 | 8 | 1 |
| Privacy | FR-PRV | 1 | 2 | 1 |
| Audit | FR-AUD | 2 | 0 | 0 |
| Integration | FR-INT | 0 | 3 | 1 |
| Reporting | FR-RPT | 0 | 2 | 0 |
| Migration | FR-MIG | 0 | 2 | 0 |
| Vendor operations | FR-OPS | 1 | 0 | 0 |
| AI assistance | FR-AI | 0 | 0 | 2 |
| Editions and licensing | FR-LIC | 0 | 0 | 3 |

## 2. Requirement index

| ID | Title | Release | Priority |
|---|---|---|---|
| FR-IAM-001 | Tenant-scoped authentication and sessions | MVP-A | Must |
| FR-IAM-002 | Multi-factor authentication for privileged roles | MVP-A | Must |
| FR-IAM-003 | Roles, permissions and attribute scopes | MVP-A | Must |
| FR-IAM-004 | Separation of duties | MVP-B | Must |
| FR-IAM-005 | Vendor support sessions | MVP-A | Must |
| FR-IAM-006 | API keys and service accounts | MVP-B | Must |
| FR-IAM-007 | Distributor sign-in | MVP-B | Must |
| FR-TEN-001 | Tenant provisioning and data region | MVP-A | Must |
| FR-TEN-002 | Markets, brands, currencies and calendars | MVP-B | Must |
| FR-TEN-003 | Versioned tenant settings | MVP-B | Must |
| FR-TEN-004 | Market launch checklist | MVP-B | Must |
| FR-TEN-005 | Tenant archive and offboarding | V1 | Should |
| FR-IMP-001 | Export upload and schema validation | MVP-A | Must |
| FR-IMP-002 | Value mapping with versions | MVP-A | Must |
| FR-IMP-003 | Import batch lifecycle and data-quality report | MVP-A | Must |
| FR-IMP-004 | Read-only database connector | V1 | Could |
| FR-CPL-001 | Retail-customer share report (R1) | MVP-A | Must |
| FR-CPL-002 | Personal-use share of rewarded volume (R2) | MVP-A | Must |
| FR-CPL-003 | Payout source mix (R3) | MVP-A | Must |
| FR-CPL-004 | Qualification-by-purchase and period-end threshold orders (R4) | MVP-A | Must |
| FR-CPL-005 | Earnings distribution over all participants (R5) | MVP-A | Must |
| FR-CPL-006 | Report snapshots, method versions and drill-down | MVP-A | Must |
| FR-CPL-007 | Platform guardrails | MVP-B | Must |
| FR-CPL-008 | Guardrail overrides log | MVP-B | Must |
| FR-CPL-009 | Earnings disclosure publication and substantiation | V1 | Should |
| FR-CPL-010 | Integrity signals | V1 | Should |
| FR-CPL-011 | Approved-claims catalogue and disclosure feed | V1 | Could |
| FR-CPL-012 | Rule basis status in configuration | MVP-B | Must |
| FR-CPL-013 | Market-pack registers | MVP-B (market pack) | Should |
| FR-PAR-001 | Participant record and effective-dated participant types | MVP-B | Must |
| FR-PAR-002 | Enrolment intake with market gating | MVP-B | Must |
| FR-PAR-003 | Duplicate-account detection queue | MVP-B | Must |
| FR-PAR-004 | Account types and ownership transfer | V1 | Should |
| FR-PAR-005 | Participant and position status lifecycle | MVP-B | Must |
| FR-PAR-006 | Agreement versions and acceptance records | MVP-B | Should |
| FR-GEN-001 | Positions separate from participants | MVP-B | Must |
| FR-GEN-002 | Effective-dated sponsor and placement relationships | MVP-B | Must |
| FR-GEN-003 | Tree as of a date and as known at a time | MVP-B | Must |
| FR-GEN-004 | Genealogy change and correction cases | MVP-B | Must |
| FR-GEN-005 | Serialised placement for binary and matrix plans | MVP-B | Could |
| FR-GEN-006 | Downline visibility policy enforced on the server | MVP-B | Must |
| FR-GEN-007 | Search-first genealogy explorer | MVP-B | Must |
| FR-GEN-008 | Path read model and rebuild | MVP-B | Must |
| FR-GEN-009 | Structure is never changed to implement a pay rule | MVP-B | Must |
| FR-ORD-001 | Order ingestion API with idempotency | MVP-B | Must |
| FR-ORD-002 | Shopify and WooCommerce connectors | MVP-B | Must |
| FR-ORD-003 | Purpose tag and fixed order facts | MVP-B | Must |
| FR-ORD-004 | Returns, refunds, chargebacks and exchanges | MVP-B | Must |
| FR-ORD-005 | Late-transaction queue | MVP-B | Must |
| FR-ORD-006 | Subscription and dispute events | V1 | Should |
| FR-CRM-001 | Customer servicing relationship and attribution | MVP-B | Must |
| FR-CRM-002 | Customer reassignment on termination | MVP-B | Must |
| FR-CRM-003 | Distributor contacts and reminders | V1 | Could |
| FR-PLN-001 | Plan versions | MVP-B | Must |
| FR-PLN-002 | Declarative primitive library | MVP-B | Must |
| FR-PLN-003 | Controlled extension point | MVP-B | Must |
| FR-PLN-004 | Caps and pools configuration | MVP-B | Must |
| FR-PLN-005 | Simulation and version comparison | MVP-B | Must |
| FR-PLN-006 | Golden datasets | MVP-B | Must |
| FR-PLN-007 | Plan-change governance | MVP-B | Must |
| FR-PLN-008 | Transition rules between versions | MVP-B | Must |
| FR-COMP-001 | Calendars and period lifecycle | MVP-B | Must |
| FR-COMP-002 | Run execution with snapshot, lock and idempotency | MVP-B | Must |
| FR-COMP-003 | Multi-pass calculation order | MVP-B | Must |
| FR-COMP-004 | Qualification state across periods | MVP-B | Must |
| FR-COMP-005 | Run review | MVP-B | Must |
| FR-COMP-006 | Commit with second-person approval | MVP-B | Must |
| FR-COMP-007 | Per-line provenance and trace | MVP-B | Must |
| FR-COMP-008 | Replay of committed periods | MVP-B | Must |
| FR-COMP-009 | Restatement of a committed period | MVP-B | Must |
| FR-COMP-010 | Adjustment lines from late transactions and cases | MVP-B | Must |
| FR-COMP-011 | Provisional runs with true-up | V1 | Should |
| FR-COMP-012 | Money arithmetic | MVP-B | Must |
| FR-FIN-001 | Double-entry obligations ledger | MVP-B | Must |
| FR-FIN-002 | Derived payee balances | MVP-B | Must |
| FR-FIN-003 | Clawback policy and receivables | MVP-B | Must |
| FR-FIN-004 | Write-off with approval | MVP-B | Must |
| FR-FIN-005 | General-ledger journal export | MVP-B | Must |
| FR-FIN-006 | Non-cash rewards ledger | V1 | Should |
| FR-FIN-007 | Multi-currency with effective-dated rates | V1 | Should |
| FR-PAY-001 | Payout batch lifecycle | MVP-B | Must |
| FR-PAY-002 | Provider adapters and bank-file fallback | MVP-B | Must |
| FR-PAY-003 | Signed, idempotent payout instructions through an outbox | MVP-B | Must |
| FR-PAY-004 | Settlement reconciliation and returned payments | MVP-B | Must |
| FR-PAY-005 | Bank-detail versions and change controls | MVP-B | Must |
| FR-PAY-006 | Provider eligibility record | MVP-B | Must |
| FR-PAY-007 | Minimum payout, holds and dormant balances | MVP-B | Must |
| FR-TAX-001 | Payee tax profile | MVP-B | Must |
| FR-TAX-002 | Withholding rules per market | MVP-B (market pack) | Must |
| FR-TAX-003 | Year-end statements | MVP-B (market pack) | Must |
| FR-CAS-001 | Case framework | MVP-B | Must |
| FR-CAS-002 | Manual adjustments with thresholds and second approver | MVP-B | Must |
| FR-CAS-003 | Commission dispute from a statement line | MVP-B | Must |
| FR-DIST-001 | Distributor statement | MVP-B | Must |
| FR-DIST-002 | Line explanation | MVP-B | Must |
| FR-DIST-003 | Rank status, factual | MVP-B | Must |
| FR-DIST-004 | Team view, privacy-limited | MVP-B | Must |
| FR-DIST-005 | My customers | MVP-B | Must |
| FR-DIST-006 | Bank details and tax profile self-service | MVP-B | Must |
| FR-DIST-007 | Localisation and low-bandwidth delivery | MVP-B (market pack) | Must |
| FR-DIST-008 | Notifications | MVP-B | Must |
| FR-DIST-009 | Leader dashboard on customers served | V1 | Could |
| FR-PRV-001 | Data-subject requests | MVP-B | Must |
| FR-PRV-002 | Erasure by pseudonymisation | MVP-B | Must |
| FR-PRV-003 | Retention timers | V1 | Should |
| FR-PRV-004 | Breach-notification contacts and runbook data | MVP-A | Must |
| FR-AUD-001 | Immutable audit log | MVP-A | Must |
| FR-AUD-002 | Export limits and logging | MVP-A | Must |
| FR-INT-001 | Public API and webhooks | MVP-B | Must |
| FR-INT-002 | Integration and sync health | MVP-B | Must |
| FR-INT-003 | Scheduled export of the full tenant data model | MVP-B | Must |
| FR-INT-004 | Read-only analytical replica for dedicated tenants | V1 | Should |
| FR-RPT-001 | Role dashboards | MVP-B | Must |
| FR-RPT-002 | Operational lists with saved views | MVP-B | Should |
| FR-MIG-001 | History import | MVP-B | Must |
| FR-MIG-002 | Parallel-run reconciliation | MVP-B | Must |
| FR-OPS-001 | Vendor operations console | MVP-A | Must |
| FR-AI-001 | Run variance explainer | V1 | Could |
| FR-AI-002 | Plan-document-to-configuration assistant (internal) | V1 | Could |
| FR-LIC-001 | Licence entitlement for the self-hosted edition | V1 | Must |
| FR-LIC-002 | Signed updates and market-pack distribution | V1 | Must |
| FR-LIC-003 | Self-hosted installation, diagnostics and support bundle | V1 | Must |

## 3. Requirement records

### 3.1 Identity and access (FR-IAM)

#### FR-IAM-001 — Tenant-scoped authentication and sessions

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Every human user signs in to exactly one tenant context (or the vendor console); the session carries tenant id, user id, roles and assurance level, and no request is served without it. |
| Business justification | Tenant isolation is a Critical gap; the client must never supply the tenant id. |
| Traces to (research) | GAP-065, SEC-01 |
| User role | All staff roles |
| Preconditions | User account exists and is active in the tenant. |
| Trigger | User opens the sign-in page or a session expires. |
| Inputs | Email or SSO assertion; password or passkey; second factor when required. |
| Processing logic | Verify credential at the identity provider; resolve tenant from the sign-in hostname; issue a short-lived access token and a rotating refresh token bound to the tenant; record an audit event. |
| Expected outputs | Authenticated session; audit event AUTH.SIGN_IN. |
| Business rules | BR-SEC-04 |
| Validation rules | Account not locked; tenant active; clock skew within tolerance. |
| Error scenarios | Wrong credential (generic message, counter incremented); locked account; tenant archived (read-only notice); IdP unavailable (retry page). |
| Permissions | Public endpoint; rate limited per IP and per account. |
| Dependencies | FR-AUD-001 |
| User stories | US-35 |
| Acceptance criteria | AC-35.1, AC-35.2 |
| Screens / APIs / Entities | SC-27 / API-07 / `user_account`, `audit_event` |

#### FR-IAM-002 — Multi-factor authentication for privileged roles

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Tenant admins, payout preparers and approvers, plan approvers, compliance officers and all vendor staff must pass a second factor; approvals require a fresh factor (step-up) within a configurable window. |
| Business justification | Account takeover of an approver redirects money (threat T10). |
| Traces to (research) | GAP-065, SEC-03 |
| User role | Tenant admin; Finance approver; Vendor ops |
| Preconditions | Role flagged MFA-required. |
| Trigger | Sign-in, or an action flagged step-up (approve batch, commit run, activate plan, approve adjustment, change bank details). |
| Inputs | TOTP code or WebAuthn assertion. |
| Processing logic | Deny privileged session without enrolled factor; for step-up actions require a factor verified within the step-up window; record assurance level on the approval record. |
| Expected outputs | Session assurance level AAL2; approval records carry factor time. |
| Business rules | BR-SEC-02 |
| Validation rules | Factor enrolled; code unused; within window. |
| Error scenarios | No factor enrolled (forced enrolment); invalid code (limited retries); lost device (admin-assisted reset is a logged case with second approver). |
| Permissions | Self-service enrolment; reset needs Tenant admin plus second approver. |
| Dependencies | FR-IAM-001 |
| User stories | US-35 |
| Acceptance criteria | AC-35.1, AC-35.2 |
| Screens / APIs / Entities | SC-27 / API-07 / `user_account`, `approval` |

#### FR-IAM-003 — Roles, permissions and attribute scopes

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Permissions are granted through roles; each assignment can be scoped by market and brand; distributor-facing access is additionally scoped by downline relationship (see FR-GEN-006). Platform-defined base roles can be cloned into tenant roles. |
| Business justification | UX requires role-specific navigation and the security model requires least privilege. |
| Traces to (research) | GAP-065, GAP-012, SEC-04 |
| User role | Tenant admin |
| Preconditions | Tenant admin signed in with MFA. |
| Trigger | Admin creates a role, edits permissions or assigns a user. |
| Inputs | Role name; permission set; scope (markets, brands); assignee. |
| Processing logic | Validate against the permission catalogue; reject combinations that break separation of duties (FR-IAM-004); a grant of an admin or approver role opens an approval request for a second admin; all changes audited and effective immediately on approval. |
| Expected outputs | Role, role assignment, audit events, alert on new admin role. |
| Business rules | BR-SEC-05 |
| Validation rules | Permission exists; scope values exist; assigner cannot grant permissions they do not hold. |
| Error scenarios | Conflicting duty pair; sole remaining admin cannot remove own admin role. |
| Permissions | Tenant admin (grant of admin or approver role needs second admin). |
| Dependencies | FR-IAM-001 |
| User stories | US-36 |
| Acceptance criteria | AC-36.1, AC-36.2 |
| Screens / APIs / Entities | SC-28 / API-40 / `role`, `role_assignment`, `approval`, `audit_event` |

#### FR-IAM-004 — Separation of duties

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | The person who prepares a payout batch, a run commit, a plan activation or an adjustment cannot approve it; the rule is enforced in the service layer from recorded actor ids, not by role names alone. |
| Business justification | No single person may release money or change pay rules. |
| Traces to (research) | GAP-065, SEC-04, MH-REQ-02 |
| User role | Finance approver; Commission analyst |
| Preconditions | An approvable object exists with a recorded preparer. |
| Trigger | A user attempts an approval. |
| Inputs | Object id; approver identity; step-up factor. |
| Processing logic | Compare approver with preparer and with all contributors to the object; refuse if equal; refuse if the approver is the beneficiary payee or a declared related party (adjustments); record the decision. |
| Expected outputs | Approval record or refusal with reason code SOD-01. |
| Business rules | BR-ADJ-02, BR-SEC-06 |
| Validation rules | Approver holds the approval permission in scope. |
| Error scenarios | Self-approval; no eligible approver available (delegation rule lists eligible users; never self-approval). |
| Permissions | Approver permission per object type. |
| Dependencies | FR-IAM-002, FR-IAM-003 |
| User stories | US-07 |
| Acceptance criteria | AC-07.1, AC-07.2 |
| Screens / APIs / Entities | SC-02, SC-03 / API-20, API-25 / `approval` |

#### FR-IAM-005 — Vendor support sessions

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Vendor staff have no standing access to tenant data. Access is a request with reason and scope that a tenant admin approves for a fixed duration; sessions are read-only by default, region-bound, fully logged and visible to the tenant. |
| Business justification | The platform concentrates many tenants' payout and personal data (threat T3). In MVP-A the vendor handles a design partner's export, so the control is needed from the first tenant. |
| Traces to (research) | GAP-065, F-32, SEC-02 |
| User role | Tenant admin; Vendor ops |
| Preconditions | Vendor user has MFA; tenant has at least one admin. |
| Trigger | Vendor engineer requests access. |
| Inputs | Tenant; reason; scope (modules, read-only or named write action); duration. |
| Processing logic | Create request; notify tenant admins; on approval mint a time-boxed scoped credential; log every screen view, query and API call to the tenant-visible session log; expire automatically; produce a session report. |
| Expected outputs | Support session, session log, session report. |
| Business rules | BR-SEC-01 |
| Validation rules | Duration within tenant maximum; requester outside the tenant's region needs explicit region approval. |
| Error scenarios | No decision before expiry of the request (auto-denied); attempted action outside scope (blocked and logged). |
| Permissions | Request: Vendor ops. Decide: Tenant admin. |
| Dependencies | FR-AUD-001 |
| User stories | US-29 |
| Acceptance criteria | AC-29.1, AC-29.2, AC-29.3 |
| Screens / APIs / Entities | SC-14, SC-39 / API-08 / `support_session`, `audit_event` |

#### FR-IAM-006 — API keys and service accounts

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Integrations authenticate with scoped, rotatable keys tied to a service account with its own role, rate limit and IP allow-list. |
| Business justification | Commerce connectors and tenant systems write orders; mass extraction must be bounded (threat T11). |
| Traces to (research) | GAP-065, SEC-10 |
| User role | Integration developer; Tenant admin |
| Preconditions | Tenant admin signed in. |
| Trigger | Admin creates or rotates a key. |
| Inputs | Name; scopes; rate limit tier; allowed IP ranges; expiry. |
| Processing logic | Generate key, show once, store only a hash; attach scopes; enforce per-key rate limits and pagination caps; rotation keeps the old key valid for a grace period. |
| Expected outputs | Key id; audit event. |
| Business rules | BR-SEC-03 |
| Validation rules | Scopes from the catalogue; no bulk personal-data scope without a stated purpose. |
| Error scenarios | Expired or revoked key (401); scope missing (403); limit exceeded (429 with Retry-After). |
| Permissions | Tenant admin. |
| Dependencies | FR-IAM-003 |
| User stories | US-22 |
| Acceptance criteria | AC-22.1, AC-22.2, AC-22.3 |
| Screens / APIs / Entities | SC-13 / API-10 / `api_key`, `audit_event` |

#### FR-IAM-007 — Distributor sign-in

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Distributors sign in to the portal with email or phone one-time code or password, optional second factor, and re-authentication for sensitive changes. |
| Business justification | The distributor population is large and varied; sign-in must work on low-end phones without weakening bank-detail controls. |
| Traces to (research) | GAP-051, GAP-035 |
| User role | Distributor |
| Preconditions | Participant with type flag can-earn has a verified contact. |
| Trigger | Distributor opens the portal. |
| Inputs | Identifier; one-time code or password. |
| Processing logic | Issue portal session scoped to the participant and the positions they own; bank-detail and tax-profile changes require fresh re-authentication. |
| Expected outputs | Portal session. |
| Business rules | BR-PAY-08 |
| Validation rules | Contact verified; participant not terminated (terminated participants keep read access to past statements for the retention period). |
| Error scenarios | Unknown identifier (generic response); code expired. |
| Permissions | Self only. |
| Dependencies | FR-IAM-001, FR-PAR-001 |
| User stories | US-12 |
| Acceptance criteria | AC-12.1 |
| Screens / APIs / Entities | SC-27, SC-37 / API-07 / `user_account`, `participant` |

### 3.2 Tenant and market configuration (FR-TEN)

#### FR-TEN-001 — Tenant provisioning and data region

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | A tenant is created with a data region, an isolation tier (pooled or dedicated database) and a routing entry; all tenant data, backups and exports stay in that region. |
| Business justification | Residency duties and large tenants must be served without re-architecture. |
| Traces to (research) | GAP-060, GAP-061, F-34, PRV-06 |
| User role | Vendor ops |
| Preconditions | Signed data-processing agreement recorded. |
| Trigger | Vendor ops creates a tenant. |
| Inputs | Legal name; region; isolation tier; first admin contact. |
| Processing logic | Create routing entry and database (or schema objects in the pooled database); apply row-level security policies; create first admin invitation; record DPA reference and breach contacts. |
| Expected outputs | Tenant, routing entry, admin invitation. |
| Business rules | BR-DAT-09 |
| Validation rules | Region available; tier allowed in region. |
| Error scenarios | Provisioning step fails (idempotent retry; tenant stays in state Provisioning). |
| Permissions | Vendor ops with second-person approval. |
| Dependencies | FR-IAM-003 |
| User stories | US-31 |
| Acceptance criteria | AC-31.1 |
| Screens / APIs / Entities | SC-39 / API-39 / `tenant`, `tenant_setting_version` |

#### FR-TEN-002 — Markets, brands, currencies and calendars

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A tenant defines brands and the markets it has opened; each market has a currency, time zone, language set, market pack reference and calendars with cut-off time zones. |
| Business justification | Plans, orders, tax and compliance rules are market-scoped; the brand dimension is cheap now and costly later. |
| Traces to (research) | GAP-095, F-43, GAP-023 |
| User role | Tenant admin |
| Preconditions | Tenant active. |
| Trigger | Admin adds or edits a market, brand or calendar. |
| Inputs | Market code; currency; time zone; languages; calendar definitions. |
| Processing logic | Store as a new settings version; calendars generate periods ahead; a market cannot be deleted once referenced. |
| Expected outputs | Market, brand, calendar, generated periods. |
| Business rules | BR-PER-01 |
| Validation rules | ISO currency and country codes; no overlapping periods within a calendar. |
| Error scenarios | Change would alter a committed period (refused). |
| Permissions | Tenant admin. |
| Dependencies | FR-TEN-003 |
| User stories | US-37 |
| Acceptance criteria | AC-37.1 |
| Screens / APIs / Entities | SC-29 / API-39 / `market`, `brand`, `calendar`, `period` |

#### FR-TEN-003 — Versioned tenant settings

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Tenant settings (rounding mode, clawback policy, visibility policy, thresholds, notice periods) are versioned and audited like plan versions; every run records the settings version it used. |
| Business justification | A run must be reproducible; a silent settings change would break replay. |
| Traces to (research) | GAP-060, GAP-021 |
| User role | Tenant admin |
| Preconditions | Tenant admin signed in. |
| Trigger | A setting is changed. |
| Inputs | Setting key; new value; effective date; reason. |
| Processing logic | Create a new immutable settings version effective from the date; settings that change money need a second approver. |
| Expected outputs | Settings version; audit event. |
| Business rules | BR-MNY-02 |
| Validation rules | Value within platform bounds; effective date not inside a committed period. |
| Error scenarios | Back-dated change (refused); missing approver. |
| Permissions | Tenant admin; money-affecting keys need Finance approver. |
| Dependencies | FR-IAM-004 |
| User stories | US-37 |
| Acceptance criteria | AC-37.1 |
| Screens / APIs / Entities | SC-29 / API-39 / `tenant_setting_version`, `approval` |

#### FR-TEN-004 — Market launch checklist

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A market can be switched to Live only when the checklist is complete: licence or registration evidence, payment and payout provider eligibility, tax rules, agreement versions, data region, plan variant. |
| Business justification | Operating before a licence or without an eligible provider is a launch blocker. |
| Traces to (research) | GAP-004, CMP-12, CPL-11, FL-09 |
| User role | Tenant admin; Compliance officer |
| Preconditions | Market exists in Draft. |
| Trigger | Admin opens the checklist or requests go-live. |
| Inputs | Evidence documents; provider approval record; tax configuration reference. |
| Processing logic | Each item has an owner, evidence and status; go-live needs all mandatory items for that market pack plus compliance sign-off; enrolment and order ingestion for the market are blocked until Live. |
| Expected outputs | Market status Live; checklist record. |
| Business rules | BR-PAY-11, BR-REG-04 |
| Validation rules | Evidence attached for each mandatory item; provider approval names the approved business description. |
| Error scenarios | Missing item (blocked with list). |
| Permissions | Tenant admin prepares; Compliance officer signs off. |
| Dependencies | FR-PAY-006, FR-TAX-002 |
| User stories | US-38 |
| Acceptance criteria | AC-38.1, AC-38.2 |
| Screens / APIs / Entities | SC-17 / API-39 / `market`, `document`, `provider_config`, `approval` |

#### FR-TEN-005 — Tenant archive and offboarding

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | A tenant can be moved to read-only archive after a final run and a complete export; data is retained per law and then deleted. |
| Business justification | Distributors and regulators may need records after a tenant closes. |
| Traces to (research) | GAP-098, GAP-096, F-44 |
| User role | Vendor ops; Tenant admin |
| Preconditions | Contract terminated or tenant request. |
| Trigger | Offboarding request. |
| Inputs | Final period; export destination; retention basis. |
| Processing logic | Run final period; produce full export; switch to archive; schedule deletion. |
| Expected outputs | Archive state; export manifest. |
| Business rules | BR-DAT-10 |
| Validation rules | No open payout batches. |
| Error scenarios | Open obligations (listed). |
| Permissions | Vendor ops with tenant confirmation. |
| Dependencies | FR-INT-003 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-39 / API-32 / `tenant`, `export_job` |

### 3.3 Data import (overlay) (FR-IMP)

#### FR-IMP-001 — Export upload and schema validation

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | A design partner's back-office export (participants, orders, payout lines) is uploaded as files and validated against the published schema before any row is stored. |
| Business justification | MVP-A reads an operator's existing data; it must refuse personal or bank data it does not need. |
| Traces to (research) | GAP-081, F-24, P4 |
| User role | Implementation consultant; Compliance officer |
| Preconditions | Tenant exists; data terms accepted. |
| Trigger | User uploads files or drops them in the tenant's inbound location. |
| Inputs | Three CSV files; declared period range; market; currency. |
| Processing logic | Check required columns, types, key uniqueness and referential links; reject files containing columns that look like names, contacts, addresses, identity or bank data; compute row counts and control totals; store the batch in state Validated or Rejected with a row-level error report. |
| Expected outputs | Import batch; validation report. |
| Business rules | BR-IMP-01, BR-IMP-02 |
| Validation rules | Participant ids pseudonymous; amounts are integers in minor units; months in range; every order buyer and payout payee exists. |
| Error scenarios | Schema mismatch; forbidden column present; orphan references above tolerance; duplicate keys. |
| Permissions | Implementation consultant; Tenant admin. |
| Dependencies | FR-TEN-001 |
| User stories | US-39 |
| Acceptance criteria | AC-39.1, AC-39.2, AC-39.3 |
| Screens / APIs / Entities | SC-24 / API-01, API-02 / `import_batch`, `import_row_error` |

#### FR-IMP-002 — Value mapping with versions

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | The partner's own codes are mapped to the platform vocabulary: participant types to flags (earns, counts as end customer), order purpose, payout source kind, starter-kit flag. A mapping is versioned and every report records the mapping version. |
| Business justification | Retail share depends on which types count as customers; the mapping is a judgement that must be visible. |
| Traces to (research) | GAP-028, F-20, CMP-01, CMP-03 |
| User role | Compliance officer; Implementation consultant |
| Preconditions | A validated batch exists. |
| Trigger | User opens mapping. |
| Inputs | Source values; target vocabulary; notes. |
| Processing logic | List distinct source values with counts; require a target for each; unmapped values default to unknown and are reported; saving creates a new mapping version. |
| Expected outputs | Mapping version. |
| Business rules | BR-IMP-03, BR-PTY-01 |
| Validation rules | Every source value mapped or explicitly left unknown. |
| Error scenarios | Mapping changed after a snapshot was published (new snapshot required; old one keeps its version). |
| Permissions | Compliance officer approves; consultant drafts. |
| Dependencies | FR-IMP-001 |
| User stories | US-40 |
| Acceptance criteria | AC-40.1 |
| Screens / APIs / Entities | SC-25 / API-03 / `import_mapping` |

#### FR-IMP-003 — Import batch lifecycle and data-quality report

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Batches move Uploaded, Validated, Mapped, Loaded, Superseded; loading writes compliance facts; a data-quality report states coverage and unknowns. |
| Business justification | Reports on poor data must say so. |
| Traces to (research) | GAP-081, GAP-102 |
| User role | Implementation consultant |
| Preconditions | Batch validated and mapping approved. |
| Trigger | User loads the batch. |
| Inputs | Batch id; mapping version. |
| Processing logic | Load into compliance fact tables in one transaction per batch; re-import of the same period supersedes the earlier batch without deleting it; compute share of orders with unknown purpose, refunds without month, payout lines without source order. |
| Expected outputs | Loaded facts; data-quality report. |
| Business rules | BR-IMP-04 |
| Validation rules | Control totals after load equal totals at validation. |
| Error scenarios | Load interrupted (transaction rolled back; batch stays Mapped). |
| Permissions | Implementation consultant. |
| Dependencies | FR-IMP-002 |
| User stories | US-39 |
| Acceptance criteria | AC-39.1, AC-39.2, AC-39.3 |
| Screens / APIs / Entities | SC-24 / API-01, API-02 / `import_batch`, `cpl_fact_participant`, `cpl_fact_order`, `cpl_fact_payout_line` |

#### FR-IMP-004 — Read-only database connector

| Field | Content |
|---|---|
| Release / priority | V1 / Could |
| Description | Instead of files, facts are pulled from the partner's back office through read-only SQL access on a schedule. |
| Business justification | Incumbents expose SQL access; removes manual export. Unvalidated demand. |
| Traces to (research) | GAP-062, P4 |
| User role | Integration developer |
| Preconditions | Connection approved by the partner. |
| Trigger | Schedule. |
| Inputs | Connection reference; query templates per vendor. |
| Processing logic | Run parameterised read-only queries; land rows as a batch; same validation as files. |
| Expected outputs | Import batch. |
| Business rules | BR-IMP-01 |
| Validation rules | Queries return only schema columns. |
| Error scenarios | Connection refused; schema drift. |
| Permissions | Tenant admin. |
| Dependencies | FR-IMP-001 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-24 / API-01 / `import_batch` |

### 3.4 Compliance analytics and guardrails (FR-CPL)

#### FR-CPL-001 — Retail-customer share report (R1)

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Per period: net sales, share bought by participant types flagged as end customers, share including declared resale, starter-kit share, and share of participant orders with unknown purpose. |
| Business justification | The share of sales to non-participants is the number regulators look at; no vendor material read computes it from transaction data. |
| Traces to (research) | GAP-081, F-24, CMP-01, CPL-03 |
| User role | Compliance officer |
| Preconditions | Facts loaded (overlay) or period committed (engine). |
| Trigger | User requests a snapshot for a period range. |
| Inputs | Period range; market; mapping or settings version. |
| Processing logic | Net sales = amount minus refunded amount per order; numerator = orders whose buyer type counts as end customer; second figure adds participant orders with purpose resale; all figures stored with population counts and method version. |
| Expected outputs | Report snapshot with figures and method notes. |
| Business rules | BR-GRD-04, BR-CPL-01 |
| Validation rules | Denominator not zero, otherwise figure is null with reason. |
| Error scenarios | Facts superseded during computation (snapshot aborted, retried). |
| Permissions | Compliance officer, Tenant admin, Executive (read). |
| Dependencies | FR-CPL-006 |
| User stories | US-24 |
| Acceptance criteria | AC-24.1, AC-24.2 |
| Screens / APIs / Entities | SC-10, SC-46 / API-04, API-05 / `compliance_report_snapshot`, `compliance_figure` |

#### FR-CPL-002 — Personal-use share of rewarded volume (R2)

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Of the order volume on which multi-level pay was earned in a period, the share from orders tagged personal use and the share with unknown purpose; plus the count of payees whose multi-level pay from personal-use volume exceeds a tenant threshold. |
| Business justification | Makes a one-third style test computable; the threshold is the tenant's counsel's, not the platform's. |
| Traces to (research) | GAP-081, GAP-005, F-24, CMP-02, CPL-03 |
| User role | Compliance officer |
| Preconditions | Payout lines carry source order references. |
| Trigger | Snapshot request. |
| Inputs | Period; threshold setting. |
| Processing logic | Select positive payout lines of source kind downline volume; sum volume of their distinct source orders by purpose; per payee compare pay from personal-use orders with the threshold share of that payee's multi-level pay. |
| Expected outputs | Figures; flagged payee list (ids only). |
| Business rules | BR-GRD-03, BR-CAP-02 |
| Validation rules | Lines without a source order are counted and reported as unattributable. |
| Error scenarios | Threshold not set (figure shown, flag count omitted). |
| Permissions | Compliance officer. |
| Dependencies | FR-CPL-006 |
| User stories | US-24 |
| Acceptance criteria | AC-24.1, AC-24.2 |
| Screens / APIs / Entities | SC-10 / API-04, API-05 / `compliance_report_snapshot`, `compliance_figure` |

#### FR-CPL-003 — Payout source mix (R3)

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Per period and per year: gross payouts by source kind (retail sale, downline volume, enrolment order, pool, match, other) and clawbacks shown separately. |
| Business justification | Shows what money was paid for, the basis of the "derived primarily from introducing others" analysis. |
| Traces to (research) | GAP-081, F-24, CMP-03, MH-REQ-09 |
| User role | Compliance officer; Executive |
| Preconditions | Payout lines classified by source kind. |
| Trigger | Snapshot request. |
| Inputs | Period range. |
| Processing logic | Sum amounts by source kind excluding clawbacks for shares; report clawbacks as a separate negative total; shares sum to 100 within rounding. |
| Expected outputs | Figures and chart data. |
| Business rules | BR-GRD-04 |
| Validation rules | Every line has a source kind (unknown allowed, reported). |
| Error scenarios | None specific. |
| Permissions | Compliance officer, Executive. |
| Dependencies | FR-CPL-006 |
| User stories | US-24 |
| Acceptance criteria | AC-24.1, AC-24.2 |
| Screens / APIs / Entities | SC-10 / API-04, API-05 / `compliance_report_snapshot`, `compliance_figure` |

#### FR-CPL-004 — Qualification-by-purchase and period-end threshold orders (R4)

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Per period: distributors active under the plan's own-purchase rule, the share of them with no customer order, and orders placed on or after a configurable day that lift the buyer across a rank threshold, with how many were later refunded. |
| Business justification | Purchases to qualify and period-end buying are named indicators; they need operational definitions. |
| Traces to (research) | GAP-005, CMP-02, F-24 |
| User role | Compliance officer |
| Preconditions | Thresholds configured. |
| Trigger | Snapshot request. |
| Inputs | Active threshold; rank thresholds; late-order day. |
| Processing logic | Accumulate personal volume per distributor in day order; detect crossings by late orders; join refunds. |
| Expected outputs | Figures; crossing list. |
| Business rules | BR-GRD-03 |
| Validation rules | Thresholds present. |
| Error scenarios | Missing day field in orders (indicator omitted with note). |
| Permissions | Compliance officer. |
| Dependencies | FR-CPL-006 |
| User stories | US-24 |
| Acceptance criteria | AC-24.1, AC-24.2 |
| Screens / APIs / Entities | SC-10 / API-04, API-05 / `compliance_report_snapshot`, `compliance_figure` |

#### FR-CPL-005 — Earnings distribution over all participants (R5)

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | For a year: every participant who held an earning agreement at any time, including those who earned nothing; share earning more than zero, mean, median, percentiles, bands. Basis stated as gross commissions net of clawbacks, before expenses. |
| Business justification | Disclosures must reflect the typical participant; this is the internal computation that a published disclosure (FR-CPL-009) later uses. |
| Traces to (research) | GAP-003, GAP-086, F-25, CMP-05, CPL-04 |
| User role | Compliance officer |
| Preconditions | A full year of payout lines. |
| Trigger | Snapshot request. |
| Inputs | Year; population rule. |
| Processing logic | Population = earning-type participants enrolled on or before year end; earnings = sum of payout lines per participant, zero when none; compute statistics; band counts sum to the population. |
| Expected outputs | Distribution figures. |
| Business rules | BR-GRD-04, BR-HON-01 |
| Validation rules | Population count equals band total. |
| Error scenarios | Partial year (labelled partial; not publishable). |
| Permissions | Compliance officer. |
| Dependencies | FR-CPL-006 |
| User stories | US-25 |
| Acceptance criteria | AC-25.1, AC-25.2 |
| Screens / APIs / Entities | SC-10 / API-04, API-05 / `compliance_report_snapshot`, `compliance_figure` |

#### FR-CPL-006 — Report snapshots, method versions and drill-down

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Each report run is an immutable snapshot recording inputs (batch ids or run ids), mapping or settings version, method version, figures and populations. Any figure can be opened to its population and source rows. |
| Business justification | A compliance figure that cannot be reproduced or explained is not evidence. |
| Traces to (research) | GAP-081, GAP-027, F-12, ENT-21 |
| User role | Compliance officer |
| Preconditions | Facts or committed runs exist. |
| Trigger | Snapshot creation or a figure is opened. |
| Inputs | Report set; period; versions. |
| Processing logic | Compute in a job; store figures with keys; drill-down query returns the rows that formed numerator and denominator, paginated, export logged. |
| Expected outputs | Snapshot; figure rows. |
| Business rules | BR-CPL-01 |
| Validation rules | Recomputing a snapshot from the same inputs and versions gives identical figures. |
| Error scenarios | Inputs superseded (snapshot marked Outdated, never changed). |
| Permissions | Compliance officer; drill-down export logged. |
| Dependencies | FR-AUD-002 |
| User stories | US-41 |
| Acceptance criteria | AC-41.1 |
| Screens / APIs / Entities | SC-10, SC-26 / API-04, API-05, API-06 / `compliance_report_snapshot`, `compliance_figure` |

#### FR-CPL-007 — Platform guardrails

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Platform-level rules, separate from tenant plan rules, evaluate plan configurations and fee configurations per market with one of three outcomes: blocked, warned and logged, or reported. |
| Business justification | Decides whether the platform helps configure an unlawful plan; default stance Moderate pending founder and counsel. |
| Traces to (research) | GAP-087, F-26, CPL-01, CMP-14, CMP-16 |
| User role | Plan administrator; Compliance officer |
| Preconditions | Market pack loaded with guardrail rules and their basis status. |
| Trigger | Plan version saved, submitted or activated; fee configured. |
| Inputs | Plan version; market. |
| Processing logic | Evaluate each guardrail predicate over the declarative configuration; blocked outcomes refuse save with rule id and explanation; warned outcomes require acknowledgement; every decision stored immutably. |
| Expected outputs | Guardrail decisions. |
| Business rules | BR-GRD-01, BR-GRD-02, BR-GRD-03, BR-GRD-04 |
| Validation rules | Rule has a basis status; counsel-required rules marked provisional until confirmed. |
| Error scenarios | Extension module opaque to predicates (treated as warned, routed to compliance review). |
| Permissions | System; visible to Plan administrator and Compliance officer. |
| Dependencies | FR-PLN-001, FR-CPL-012 |
| User stories | US-26 |
| Acceptance criteria | AC-26.1, AC-26.2 |
| Screens / APIs / Entities | SC-04, SC-11 / API-16 / `guardrail_rule`, `guardrail_decision` |

#### FR-CPL-008 — Guardrail overrides log

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Where platform policy permits an override, the tenant records a written justification and approver; overrides appear in compliance reports and in the vendor's tenant review. |
| Business justification | Overrides must be visible, not silent. |
| Traces to (research) | GAP-087, F-26 |
| User role | Compliance officer |
| Preconditions | A warned or overridable decision exists. |
| Trigger | User requests override. |
| Inputs | Decision id; justification; evidence. |
| Processing logic | Only outcomes marked overridable can be overridden; needs Compliance officer approval; blocked-by-law outcomes are never overridable. |
| Expected outputs | Override record. |
| Business rules | BR-GRD-05 |
| Validation rules | Justification present. |
| Error scenarios | Not overridable (refused). |
| Permissions | Compliance officer. |
| Dependencies | FR-CPL-007 |
| User stories | US-26 |
| Acceptance criteria | AC-26.1, AC-26.2 |
| Screens / APIs / Entities | SC-11 / API-16 / `guardrail_decision` |

#### FR-CPL-009 — Earnings disclosure publication and substantiation

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | A disclosure document is generated from an R5 snapshot, reviewed, published with a version and kept with its method and data references for the retention period. |
| Business justification | Substantiation on demand if the US proposal is adopted; trust feature elsewhere. |
| Traces to (research) | GAP-086, GAP-003, F-25, CPL-04, CPL-05 |
| User role | Compliance officer |
| Preconditions | Full-year snapshot. |
| Trigger | Compliance officer drafts a disclosure. |
| Inputs | Snapshot id; template; language. |
| Processing logic | Draft, review, publish; published versions immutable; public page shows the current version; statements link to it. |
| Expected outputs | Disclosure version; public page. |
| Business rules | BR-HON-02 |
| Validation rules | Snapshot is full-year and not outdated. |
| Error scenarios | Snapshot outdated (blocked). |
| Permissions | Compliance officer publishes. |
| Dependencies | FR-CPL-005 |
| User stories | US-25 |
| Acceptance criteria | AC-25.1, AC-25.2 |
| Screens / APIs / Entities | SC-23, SC-40 / API-05 / `compliance_report_snapshot`, `document` |

#### FR-CPL-010 — Integrity signals

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | Documented, configurable signals with tenant thresholds: period-end threshold orders, returns after qualification, shared payment fingerprints or addresses between a distributor and their customers. |
| Business justification | Bonus buying and fake customers need measurable definitions; signals are indicators, never findings. |
| Traces to (research) | GAP-005, F-27 |
| User role | Compliance officer |
| Preconditions | Order and attribute data available. |
| Trigger | Period close. |
| Inputs | Thresholds. |
| Processing logic | Compute signals; list flags with evidence; open cases on request. |
| Expected outputs | Flag list. |
| Business rules | BR-GRD-03 |
| Validation rules | Each flag labelled as indicator. |
| Error scenarios | Missing attributes (signal disabled with note). |
| Permissions | Compliance officer. |
| Dependencies | FR-ORD-001 |
| User stories | US-33 |
| Acceptance criteria | AC-33.1 |
| Screens / APIs / Entities | SC-45 / API-05 / `integrity_signal` |

#### FR-CPL-011 — Approved-claims catalogue and disclosure feed

| Field | Content |
|---|---|
| Release / priority | V1 / Could |
| Description | Versioned approved claims per market and the current disclosure figures are exposed by API and webhook to claims-monitoring partners. |
| Business justification | Claims on social media are frequent; monitoring is integrated, not built. |
| Traces to (research) | GAP-001, F-37, CPL-12 |
| User role | Compliance officer |
| Preconditions | Disclosure published. |
| Trigger | Catalogue change. |
| Inputs | Claim text; market; validity dates. |
| Processing logic | Store versions; emit change events. |
| Expected outputs | Feed. |
| Business rules | BR-HON-02 |
| Validation rules | Claim linked to a disclosure where it mentions earnings. |
| Error scenarios | None specific. |
| Permissions | Compliance officer. |
| Dependencies | FR-CPL-009, FR-INT-001 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-23 / API-33 / `document` |

#### FR-CPL-012 — Rule basis status in configuration

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Every market-pack rule (guardrail, tax, cooling-off, filing) stores its basis and basis status: screening, primary read, or counsel-confirmed, with source reference and review date. |
| Business justification | Legal content is screening-grade until counsel confirms; the product must not present it as settled. |
| Traces to (research) | GAP-102, CPL-15 |
| User role | Compliance officer; Vendor ops |
| Preconditions | Market pack exists. |
| Trigger | Rule created or reviewed. |
| Inputs | Basis text; status; reviewer; date. |
| Processing logic | Status shown wherever the rule is applied; a market cannot go Live with mandatory rules still at screening status unless the tenant accepts the risk in writing. |
| Expected outputs | Rule metadata. |
| Business rules | BR-CPL-03 |
| Validation rules | Status in the allowed set. |
| Error scenarios | Go-live with screening-status mandatory rule (blocked or risk acceptance recorded). |
| Permissions | Vendor ops maintains packs; Compliance officer accepts. |
| Dependencies | FR-TEN-004 |
| User stories | US-38 |
| Acceptance criteria | AC-38.1, AC-38.2 |
| Screens / APIs / Entities | SC-17 / API-39 / `guardrail_rule`, `tax_rule` |

#### FR-CPL-013 — Market-pack registers

| Field | Content |
|---|---|
| Release / priority | MVP-B (market pack) / Should |
| Description | Where a market pack requires them: grievance register with response-time tracking and a publishable delisted-seller register. |
| Business justification | Reported duties in India; included only when that pack is activated and confirmed. |
| Traces to (research) | CMP-09, CMP-17, CPL-08, CPL-09 |
| User role | Compliance officer |
| Preconditions | Market pack with the register enabled. |
| Trigger | Grievance filed or seller delisted. |
| Inputs | Case details. |
| Processing logic | Grievances run on the case framework with market deadlines; delisted register is a published view of terminated participants per the pack's rule. |
| Expected outputs | Register entries. |
| Business rules | BR-ADJ-04 |
| Validation rules | Deadlines from the pack. |
| Error scenarios | Deadline near (escalation). |
| Permissions | Compliance officer. |
| Dependencies | FR-CAS-001 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-06 / API-30 / `case` |

### 3.5 Participants (FR-PAR)

#### FR-PAR-001 — Participant record and effective-dated participant types

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A participant is a person or entity known to the tenant. Types are tenant-defined with flags (can earn, counts as end customer, can sponsor, can hold positions); a participant's type is effective-dated and a change never re-labels past orders. |
| Business justification | Real plans have affiliates, preferred customers, promoters and builders; retail share depends on the flags. |
| Traces to (research) | GAP-028, F-20, CPL-02 |
| User role | Support agent; Compliance officer |
| Preconditions | Participant types configured. |
| Trigger | Enrolment, import or type change. |
| Inputs | External id; type; market; identity references; contact data. |
| Processing logic | Create participant; type assignment rows with valid-from and valid-to; sensitive documents go to the separate encrypted store. |
| Expected outputs | Participant; type assignment. |
| Business rules | BR-PTY-01, BR-PTY-02 |
| Validation rules | External id unique per tenant; market Live; one active type at any time. |
| Error scenarios | Duplicate suspicion (FR-PAR-003); market not Live. |
| Permissions | Support agent creates; type definitions by Tenant admin with Compliance officer approval. |
| Dependencies | FR-TEN-002 |
| User stories | US-21 |
| Acceptance criteria | AC-21.1, AC-21.2 |
| Screens / APIs / Entities | SC-09 / API-12 / `participant`, `participant_type`, `participant_type_assignment` |

#### FR-PAR-002 — Enrolment intake with market gating

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Enrolments arrive by API or connector; an enrolment is accepted only for a Live market the participant is resident in, and creates the participant, an initial position where the type holds positions, and sponsor and placement relationships. |
| Business justification | A distributor enrolling someone in an unopened market creates legal exposure. |
| Traces to (research) | GAP-006, F-40, CPL-13 |
| User role | Integration developer; Support agent |
| Preconditions | Sponsor position exists and is active. |
| Trigger | Enrolment request. |
| Inputs | Participant data; sponsor reference; placement preference; agreement version accepted. |
| Processing logic | Validate market; run duplicate checks; create records in one transaction; household rule check where the plan declares one. |
| Expected outputs | Participant, position, relationships, agreement acceptance. |
| Business rules | BR-REG-04 |
| Validation rules | Sponsor can sponsor; placement target valid for the plan. |
| Error scenarios | Market closed (422 MARKET_NOT_LIVE); sponsor inactive; placement slot taken (retry with deterministic alternative). |
| Permissions | API key scope enrol; Support agent. |
| Dependencies | FR-GEN-001, FR-GEN-002, FR-PAR-003 |
| User stories | US-42 |
| Acceptance criteria | AC-42.1, AC-42.2 |
| Screens / APIs / Entities | SC-09 / API-12 / `participant`, `position`, `relationship`, `agreement_acceptance` |

#### FR-PAR-003 — Duplicate-account detection queue

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | New and changed participants are compared on identity reference, payment fingerprint, address and device signals; matches create a duplicate case and, where the tenant enables it, hold activation or payouts until reviewed. |
| Business justification | Multiple accounts are legitimate in some plans and abuse in others; decisions need a trail. |
| Traces to (research) | GAP-002, F-04, FL-03 |
| User role | Support agent; Compliance officer |
| Preconditions | Matching attributes available. |
| Trigger | Enrolment, bank-detail change or scheduled sweep. |
| Inputs | Hashed attributes. |
| Processing logic | Deterministic matching rules with tenant thresholds; outcome merge, allow with reason, or terminate; history stays on positions. |
| Expected outputs | Duplicate case; hold flag. |
| Business rules | BR-GEN-09 |
| Validation rules | Hash comparison only; raw payment data never stored. |
| Error scenarios | Merge would create a cycle or double ownership conflict (blocked). |
| Permissions | Support agent investigates; Compliance officer decides. |
| Dependencies | FR-CAS-001 |
| User stories | US-43 |
| Acceptance criteria | AC-43.1 |
| Screens / APIs / Entities | SC-08 / API-30 / `case`, `participant` |

#### FR-PAR-004 — Account types and ownership transfer

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | Individual, joint and business-entity accounts; succession, divorce division and sale are transfers of position ownership with documents, approval and an effective date. |
| Business justification | Transfers move future income; needs counsel per market. |
| Traces to (research) | GAP-002, F-05, FL-04 |
| User role | Support agent; Compliance officer |
| Preconditions | Request with documents. |
| Trigger | Transfer request. |
| Inputs | Position; new owner; documents; effective date. |
| Processing logic | Case with legal check; new ownership row; new payee needs tax profile and bank details under change controls. |
| Expected outputs | Ownership change. |
| Business rules | BR-GEN-10 |
| Validation rules | New owner eligible. |
| Error scenarios | Missing documents. |
| Permissions | Compliance officer approves. |
| Dependencies | FR-GEN-001, FR-PAY-005 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-08 / API-30 / `position_ownership`, `case` |

#### FR-PAR-005 — Participant and position status lifecycle

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Statuses Pending, Active, Suspended, Terminated, with reinstatement as an event on the same position; each change is dated with reason and actor. |
| Business justification | Termination and reinstatement drive pay eligibility and must not rewrite history. |
| Traces to (research) | GAP-010, GAP-013 |
| User role | Support agent; Compliance officer |
| Preconditions | Participant exists. |
| Trigger | Status change request or rule. |
| Inputs | New status; effective date; reason; evidence. |
| Processing logic | Append status row; termination for cause needs a human approver; open payouts follow tenant policy (hold or pay); customers reassigned (FR-CRM-002). |
| Expected outputs | Status history; events. |
| Business rules | BR-GEN-07, BR-GEN-11 |
| Validation rules | Effective date not before last committed period end unless handled as correction. |
| Error scenarios | Back-dated termination into committed period (routed to restatement policy). |
| Permissions | Compliance officer approves terminations. |
| Dependencies | FR-CRM-002 |
| User stories | US-23 |
| Acceptance criteria | AC-23.1 |
| Screens / APIs / Entities | SC-09 / API-12 / `participant`, `position` |

#### FR-PAR-006 — Agreement versions and acceptance records

| Field | Content |
|---|---|
| Release / priority | MVP-B / Should |
| Description | The tenant's distributor agreement and policy documents are versioned per market; each participant's acceptance is recorded with version and time. |
| Business justification | Written agreements are required in several markets (candidate requirement, to confirm per pack). |
| Traces to (research) | CMP-06 |
| User role | Compliance officer |
| Preconditions | Agreement version published. |
| Trigger | Enrolment or new version requiring re-acceptance. |
| Inputs | Version id; acceptance evidence. |
| Processing logic | Store acceptance; re-acceptance campaigns tracked. |
| Expected outputs | Acceptance record. |
| Business rules | BR-REG-05 |
| Validation rules | Version current for the market. |
| Error scenarios | Acceptance missing at enrolment (blocked where the pack requires). |
| Permissions | Compliance officer publishes versions. |
| Dependencies | FR-PAR-002 |
| User stories | US-42 |
| Acceptance criteria | AC-42.1, AC-42.2 |
| Screens / APIs / Entities | SC-09 / API-12 / `document`, `agreement_acceptance` |

### 3.6 Genealogy (FR-GEN)

#### FR-GEN-001 — Positions separate from participants

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | The tree is made of positions. A participant may own one or more positions; ownership is effective-dated; volume and qualification are evaluated per position unless the plan version says per participant. |
| Business justification | Plans give several business centres per person; node equals person breaks them. |
| Traces to (research) | GAP-010, F-01 |
| User role | Commission analyst; Distributor |
| Preconditions | Participant type can hold positions. |
| Trigger | Enrolment or plan rule grants a position. |
| Inputs | Owner; market; brand; plan. |
| Processing logic | Create position with ownership row; statements roll positions up per owner. |
| Expected outputs | Position. |
| Business rules | BR-GEN-01 |
| Validation rules | Plan's limit on positions per participant. |
| Error scenarios | Limit exceeded. |
| Permissions | System on enrolment; Support agent by case. |
| Dependencies | FR-PAR-001 |
| User stories | US-04 |
| Acceptance criteria | AC-04.1, AC-04.2 |
| Screens / APIs / Entities | SC-09, SC-07 / API-12 / `position`, `position_ownership` |

#### FR-GEN-002 — Effective-dated sponsor and placement relationships

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Sponsor and placement are separate relationship kinds, each row carrying valid time and recorded time; rows are never updated in place; at any valid time a child has at most one parent per kind and no cycles exist. |
| Business justification | Reproducibility, disputes and audit depend on knowing what the tree was when a period was calculated. |
| Traces to (research) | GAP-010, F-02, ADR-03 |
| User role | Commission analyst |
| Preconditions | Positions exist. |
| Trigger | Enrolment, approved change, approved correction. |
| Inputs | Kind; parent; child; valid-from; event reference. |
| Processing logic | Change closes the current row at the effective date and inserts a new one; correction supersedes the old row (recorded time) and inserts the corrected row with the original valid date; cycle and uniqueness checks run inside the transaction under a per-tree lock. |
| Expected outputs | Relationship rows; domain event GenealogyChanged. |
| Business rules | BR-GEN-02, BR-GEN-03, BR-GEN-04 |
| Validation rules | No cycle; no overlap of valid ranges for the same child and kind among non-superseded rows. |
| Error scenarios | Cycle (409 GEN_CYCLE); overlap; parent not in same tenant and tree. |
| Permissions | Only through enrolment or an approved case. |
| Dependencies | FR-GEN-001 |
| User stories | US-01 |
| Acceptance criteria | AC-01.1, AC-01.2 |
| Screens / APIs / Entities | SC-07 / API-14, API-15 / `relationship` |

#### FR-GEN-003 — Tree as of a date and as known at a time

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Staff can view any subtree as of a valid date and optionally as known at a past recorded time; runs reference the recorded-time instant they used. |
| Business justification | Explaining a past payout after later corrections. |
| Traces to (research) | GAP-010, F-02 |
| User role | Commission analyst; Support agent |
| Preconditions | Relationship history exists. |
| Trigger | User selects dates in the explorer or opens a run's tree. |
| Inputs | Root position; as-of date; known-at time; depth. |
| Processing logic | Query non-superseded-as-of-known-at rows valid at the date; lazy by depth. |
| Expected outputs | Subtree page. |
| Business rules | BR-GEN-02 |
| Validation rules | Dates not in the future for known-at. |
| Error scenarios | Read model rebuilding (served from the system of record with a notice, depth-limited). |
| Permissions | Staff roles with genealogy read. |
| Dependencies | FR-GEN-002, FR-GEN-008 |
| User stories | US-01 |
| Acceptance criteria | AC-01.1, AC-01.2 |
| Screens / APIs / Entities | SC-07 / API-14 / `relationship`, `path_node` |

#### FR-GEN-004 — Genealogy change and correction cases

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Sponsor or placement changes and corrections are requested as cases with reason and evidence, checked against the plan's change windows, reviewed, and applied with an effective date (change) or original date (correction, listing affected committed periods). |
| Business justification | A genealogy change moves future income between people. |
| Traces to (research) | GAP-002, F-03, FL-02 |
| User role | Support agent; Compliance officer |
| Preconditions | Requester identified. |
| Trigger | Agent or distributor files a request. |
| Inputs | Position; kind; proposed parent; change or correction; dates; evidence. |
| Processing logic | Policy check (window, approvals); simulate cycle and occupancy; for corrections compute affected committed periods and estimated payout impact; on approval apply through FR-GEN-002 and route affected periods to the restatement policy. |
| Expected outputs | Case; relationship rows; notifications; read-model rebuild job. |
| Business rules | BR-GEN-03, BR-GEN-04, BR-GEN-05 |
| Validation rules | Evidence attached; proposed parent valid. |
| Error scenarios | Outside window (rejected or exception route if the plan allows); would create a cycle; target leg occupied; affects committed period (flag, FL-07). |
| Permissions | Support agent files; Compliance officer approves. |
| Dependencies | FR-CAS-001, FR-GEN-002, FR-COMP-009 |
| User stories | US-02, US-03 |
| Acceptance criteria | AC-02.1, AC-02.2, AC-03.1, AC-03.2 |
| Screens / APIs / Entities | SC-08 / API-15 / `case`, `relationship` |

#### FR-GEN-005 — Serialised placement for binary and matrix plans

| Field | Content |
|---|---|
| Release / priority | MVP-B / Could |
| Description | Automatic placement and spillover place a new position in a deterministic slot; concurrent enrolments into the same leg are serialised and the tie-break recorded. |
| Business justification | Two people must not land in one slot. Priority depends on the segment decision; binary appeared in 4 of 16 hold-out plans. |
| Traces to (research) | GAP-010, GAP-013, P1 |
| User role | System |
| Preconditions | Plan declares a placement tree with width. |
| Trigger | Enrolment with automatic placement. |
| Inputs | Sponsor position; leg preference. |
| Processing logic | Take a lock on the target leg; find the slot by the plan's rule; insert; release. |
| Expected outputs | Placement relationship; tie-break record. |
| Business rules | BR-GEN-06 |
| Validation rules | Slot free at commit. |
| Error scenarios | Lock timeout (retry). |
| Permissions | System. |
| Dependencies | FR-GEN-002 |
| User stories | US-42 |
| Acceptance criteria | AC-42.1, AC-42.2 |
| Screens / APIs / Entities | SC-07 / API-12 / `relationship` |

#### FR-GEN-006 — Downline visibility policy enforced on the server

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A tenant policy states which fields a viewer may see at which depth and relationship (for example name and rank to depth n, contact data only for personally sponsored, aggregates beyond); the API returns only permitted fields and never reveals the existence of positions outside the viewer's downline. |
| Business justification | Genealogy views are the largest personal-data exposure surface. |
| Traces to (research) | GAP-012, F-06, SEC-08 |
| User role | Team leader; DPO |
| Preconditions | Policy configured (safe default applies otherwise). |
| Trigger | Any distributor-facing genealogy or team request. |
| Inputs | Viewer position; target; fields. |
| Processing logic | Authorise by path read model (viewer is ancestor of target, depth d); apply the field matrix; aggregate beyond the depth limit; rate limit and log exports. |
| Expected outputs | Filtered response. |
| Business rules | BR-DAT-03, BR-SEC-03 |
| Validation rules | Policy version recorded on response logs. |
| Error scenarios | Target outside downline (404, same as not found). |
| Permissions | Policy edited by Tenant admin with DPO approval. |
| Dependencies | FR-GEN-008 |
| User stories | US-05 |
| Acceptance criteria | AC-05.1, AC-05.2 |
| Screens / APIs / Entities | SC-20 / API-13, API-34 / `path_node`, `tenant_setting_version` |

#### FR-GEN-007 — Search-first genealogy explorer

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Explorers open on search and a focused node, expand lazily, cap depth and breadth per request, and show counts for collapsed branches. |
| Business justification | Trees with thousands of nodes cannot be drawn whole. |
| Traces to (research) | GAP-012, GAP-055, F-07 |
| User role | Support agent; Commission analyst; Team leader |
| Preconditions | Read model current or marked stale. |
| Trigger | User searches or expands. |
| Inputs | Query; node; depth. |
| Processing logic | Search by id, name (staff), rank; subtree counts from the read model; breadcrumbs to root. |
| Expected outputs | Node list and counts. |
| Business rules | BR-DAT-03 |
| Validation rules | Page size limits. |
| Error scenarios | Stale read model banner. |
| Permissions | Staff per role; distributors per FR-GEN-006. |
| Dependencies | FR-GEN-008 |
| User stories | US-05 |
| Acceptance criteria | AC-05.1, AC-05.2 |
| Screens / APIs / Entities | SC-07, SC-20 / API-13, API-14 / `path_node` |

#### FR-GEN-008 — Path read model and rebuild

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A materialised-path read model per tree kind supports ancestor tests and subtree search; it is rebuilt asynchronously from the relationship rows after changes and is marked stale meanwhile. |
| Business justification | Interactive authorisation checks must not run recursive queries on deep trees. |
| Traces to (research) | GAP-011, ADR-04, ENT-07 |
| User role | System |
| Preconditions | Relationship rows. |
| Trigger | GenealogyChanged event. |
| Inputs | Changed subtree root. |
| Processing logic | Recompute paths for the moved subtree in batches; version the read model; switch atomically. |
| Expected outputs | Updated paths; staleness flag cleared. |
| Business rules | BR-GEN-12 |
| Validation rules | Path count equals active position count. |
| Error scenarios | Rebuild failure (retry; views keep stale notice; authorisation falls back to system-of-record check). |
| Permissions | System. |
| Dependencies | FR-GEN-002 |
| User stories | US-05 |
| Acceptance criteria | AC-05.1, AC-05.2 |
| Screens / APIs / Entities | SC-07 / API-13 / `path_node` |

#### FR-GEN-009 — Structure is never changed to implement a pay rule

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Termination changes status only. Compression, roll-up, breakaway and dynamic generations are calculation-time behaviours of a plan version; re-parenting of a terminated position's downline, where a plan requires it, is a dated change event generated by a stated rule. |
| Business justification | Mixing structure and calculation loses history or pays wrongly. |
| Traces to (research) | GAP-013 |
| User role | Plan administrator |
| Preconditions | Plan version declares behaviours. |
| Trigger | Run or termination. |
| Inputs | Snapshot; plan version. |
| Processing logic | Calculation applies behaviours as pure functions of snapshot and plan; rule-generated genealogy events go through the same event path as approved cases, with the rule id as approver. |
| Expected outputs | Result lines; optional generated events. |
| Business rules | BR-GEN-07, BR-GEN-08 |
| Validation rules | Behaviours named per bonus. |
| Error scenarios | None specific. |
| Permissions | System. |
| Dependencies | FR-PLN-002 |
| User stories | US-44 |
| Acceptance criteria | AC-44.1, AC-44.2 |
| Screens / APIs / Entities | SC-04 / API-16 / `plan_rule`, `relationship` |

### 3.7 Orders and returns (FR-ORD)

#### FR-ORD-001 — Order ingestion API with idempotency

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Orders, order lines and customers are upserted through a public API and webhooks from the tenant's commerce system; each write carries an idempotency key and source system id. |
| Business justification | Commerce is integrated, not built; duplicates and retries are normal. |
| Traces to (research) | GAP-045, F-21, ADR-08 |
| User role | Integration developer |
| Preconditions | API key with scope orders:write; market Live. |
| Trigger | Commerce system posts an order. |
| Inputs | Source order id; buyer reference; lines (product, quantity, price, tax); payment status; event times; attribution hint; purpose. |
| Processing logic | Deduplicate on tenant, source system, source id; resolve buyer and attribution; compute volumes per line from the product volume map effective at the crediting event time; fix buyer type, purpose, attribution and volumes on the order; assign to period by the crediting event rule; emit OrderIngested. |
| Expected outputs | Order with lines; 200 on replay with the same body, 409 on same key with different body. |
| Business rules | BR-ATT-02, BR-ORD-04, BR-ORD-01, BR-VOL-01 |
| Validation rules | Totals equal sum of lines; currency equals market currency (MVP single currency); buyer exists or is created as customer. |
| Error scenarios | Unknown product (order held in exception queue); period committed (late queue, FR-ORD-005); market not Live. |
| Permissions | API key scope. |
| Dependencies | FR-IAM-006, FR-CRM-001 |
| User stories | US-22 |
| Acceptance criteria | AC-22.1, AC-22.2, AC-22.3 |
| Screens / APIs / Entities | SC-31, SC-13 / API-10 / `order`, `order_line`, `inbound_event`, `product_volume_map` |

#### FR-ORD-002 — Shopify and WooCommerce connectors

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Packaged connectors subscribe to order, refund and customer events, map fields to the ingestion API, pass attribution from link or code, and expose sync status. |
| Business justification | The two most common commerce platforms behind which the engine can sit. |
| Traces to (research) | GAP-045, F-21 |
| User role | Operations manager; Integration developer |
| Preconditions | Store credentials authorised by tenant. |
| Trigger | Store event or reconciliation poll. |
| Inputs | Store events. |
| Processing logic | Verify signatures; transform; call ingestion; nightly reconciliation of counts and totals; backfill by date range. |
| Expected outputs | Orders; sync status. |
| Business rules | BR-ORD-04 |
| Validation rules | Signature valid. |
| Error scenarios | Store API limit (backoff); mapping gap (exception queue). |
| Permissions | Tenant admin installs. |
| Dependencies | FR-ORD-001, FR-INT-002 |
| User stories | US-22 |
| Acceptance criteria | AC-22.1, AC-22.2, AC-22.3 |
| Screens / APIs / Entities | SC-13 / API-10, API-37 / `provider_config`, `inbound_event` |

#### FR-ORD-003 — Purpose tag and fixed order facts

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Every participant order carries a purpose (resale, personal use, unspecified) where the market or tenant requires it; buyer type, purpose, attribution and line volumes are fixed at ingestion and later master-data changes do not alter them. |
| Business justification | Reports and commissions must not be recomputed from current master data. |
| Traces to (research) | GAP-028, F-20, CPL-02 |
| User role | Compliance officer |
| Preconditions | Purpose requirement configured. |
| Trigger | Ingestion. |
| Inputs | Purpose from checkout or default. |
| Processing logic | Store facts; corrections arrive as new order events with reason, not edits. |
| Expected outputs | Immutable order facts. |
| Business rules | BR-PTY-03, BR-ATT-02 |
| Validation rules | Purpose in vocabulary. |
| Error scenarios | Purpose required but missing (stored as unspecified and counted in data-quality figures). |
| Permissions | System. |
| Dependencies | FR-ORD-001 |
| User stories | US-21 |
| Acceptance criteria | AC-21.1, AC-21.2 |
| Screens / APIs / Entities | SC-31 / API-10 / `order`, `order_line` |

#### FR-ORD-004 — Returns, refunds, chargebacks and exchanges

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Return events reference order lines and carry amounts and volume effects per line; an exchange flagged as equal value does not reverse and re-credit volume; chargebacks are treated like refunds for volume and pay; cooling-off and buy-back windows come from the market pack. |
| Business justification | Each case changes volume and therefore pay. |
| Traces to (research) | GAP-047, GAP-046, F-23, CPL-07 |
| User role | Integration developer; Finance manager |
| Preconditions | Original order exists. |
| Trigger | Commerce system posts an event. |
| Inputs | Order line references; quantities; refund amount; restocking fee; event type. |
| Processing logic | Create order event; compute volume reversal per line; if the original period is open adjust inputs, otherwise create a late transaction for the reversal policy (FR-FIN-003). |
| Expected outputs | Order event; late transaction when applicable. |
| Business rules | BR-RET-01, BR-RET-02, BR-RET-03, BR-REV-06, BR-VOL-03 |
| Validation rules | Returned quantity not above purchased minus already returned. |
| Error scenarios | Unknown order (held for retry until order arrives; alert after timeout). |
| Permissions | API key scope. |
| Dependencies | FR-ORD-001, FR-ORD-005 |
| User stories | US-45 |
| Acceptance criteria | AC-45.1, AC-45.2 |
| Screens / APIs / Entities | SC-31 / API-11 / `order_event`, `late_transaction` |

#### FR-ORD-005 — Late-transaction queue

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Any order or order event whose crediting time falls in a committed period is queued; by default its effect posts as an adjustment in the current open period with a link to the original period. |
| Business justification | Committed periods stay reproducible while late facts are not lost. |
| Traces to (research) | GAP-023, F-09 |
| User role | Commission analyst |
| Preconditions | Period committed. |
| Trigger | Ingestion detects a committed period. |
| Inputs | Transaction. |
| Processing logic | Queue with original period, effect estimate and proposed handling (adjust or restatement request); analyst can accept default in bulk with preview. |
| Expected outputs | Late transaction; adjustment inputs for the open run. |
| Business rules | BR-PER-04 |
| Validation rules | Linked original period exists. |
| Error scenarios | None specific. |
| Permissions | Commission analyst. |
| Dependencies | FR-COMP-001, FR-COMP-010 |
| User stories | US-08 |
| Acceptance criteria | AC-08.1 |
| Screens / APIs / Entities | SC-32 / API-10, API-11 / `late_transaction` |

#### FR-ORD-006 — Subscription and dispute events

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | Renewal succeeded, failed, cancelled, disputed, dispute won or lost are consumed from the commerce platform and drive volume and commission effects. |
| Business justification | Autoship volume often drives qualification. |
| Traces to (research) | GAP-046 |
| User role | Integration developer |
| Preconditions | Commerce platform emits events. |
| Trigger | Event. |
| Inputs | Subscription reference; event type. |
| Processing logic | Map to order events; consent records stay with the merchant of record. |
| Expected outputs | Order events. |
| Business rules | BR-REV-06 |
| Validation rules | Reference known. |
| Error scenarios | Unknown reference. |
| Permissions | API key scope. |
| Dependencies | FR-ORD-004 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-31 / API-11 / `order_event` |

### 3.8 Customer attribution (FR-CRM)

#### FR-CRM-001 — Customer servicing relationship and attribution

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Each customer has at most one serviced-by position at a time, effective-dated; attribution of an order is decided at ingestion from link, code, enrolment or servicing relationship by the tenant's precedence rule and stored on the order. |
| Business justification | Who a customer belongs to decides who is paid. |
| Traces to (research) | GAP-040, F-22 |
| User role | Support agent |
| Preconditions | Customer exists. |
| Trigger | First order, link visit recorded by commerce, or manual assignment. |
| Inputs | Customer; position; source of attribution. |
| Processing logic | Apply precedence; write servicing row; fractional roll-ups are plan parameters applied at calculation. |
| Expected outputs | Servicing row; order attribution. |
| Business rules | BR-ATT-01, BR-ATT-02, BR-ATT-04 |
| Validation rules | One active servicer. |
| Error scenarios | Conflict between two claims (case opened with attribution report). |
| Permissions | Support agent for manual changes. |
| Dependencies | FR-PAR-001 |
| User stories | US-23 |
| Acceptance criteria | AC-23.1 |
| Screens / APIs / Entities | SC-09, SC-21 / API-35 / `customer_servicing`, `order` |

#### FR-CRM-002 — Customer reassignment on termination

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | When a servicing position is terminated its customers are reassigned by the tenant rule (sponsor, company or customer choice) with an effective date and optional notice; past orders keep their attribution. |
| Business justification | Customers keep being served and attribution stays correct. |
| Traces to (research) | GAP-040, F-22, FL-15 |
| User role | Support agent |
| Preconditions | Termination effective. |
| Trigger | Termination event. |
| Inputs | Rule; effective date. |
| Processing logic | Close servicing rows; open new ones; notify. |
| Expected outputs | New servicing rows. |
| Business rules | BR-ATT-03 |
| Validation rules | Target eligible. |
| Error scenarios | No eligible target (assigned to company). |
| Permissions | System by rule; Support agent overrides by case. |
| Dependencies | FR-PAR-005 |
| User stories | US-23 |
| Acceptance criteria | AC-23.1 |
| Screens / APIs / Entities | SC-09 / API-35 / `customer_servicing` |

#### FR-CRM-003 — Distributor contacts and reminders

| Field | Content |
|---|---|
| Release / priority | V1 / Could |
| Description | A distributor keeps private contacts and follow-up reminders; prospect data is private to that distributor by default. |
| Business justification | Small native feature tied to attribution; controllership needs counsel. |
| Traces to (research) | GAP-041 |
| User role | Distributor |
| Preconditions | Counsel view on controllership for the market. |
| Trigger | Distributor adds a contact. |
| Inputs | Contact data; consent flag. |
| Processing logic | Store scoped to the distributor; retention timer; deletion on request. |
| Expected outputs | Contact. |
| Business rules | BR-DAT-08 |
| Validation rules | Consent before marketing messages. |
| Error scenarios | None specific. |
| Permissions | Self only. |
| Dependencies | FR-PRV-003 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-21 / API-28 / `participant` |

### 3.9 Plans (FR-PLN)

#### FR-PLN-001 — Plan versions

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A plan has versions with states Draft, In review, Approved, Scheduled, Active, Retired; an activated version is immutable; each version has an effective date, approver, justification, transition rules and per-market filing status. |
| Business justification | A run uses exactly one plan version; changes need a record of who approved what and why. |
| Traces to (research) | GAP-020, GAP-097, CMP-04, ENT-11 |
| User role | Plan administrator |
| Preconditions | Plan exists for brand and market. |
| Trigger | Admin creates or edits a draft. |
| Inputs | Rules; parameters; effective date; justification. |
| Processing logic | Validate schema and references; guardrail evaluation on save; version diff available at every state. |
| Expected outputs | Plan version. |
| Business rules | BR-CMP-01, BR-PLN-01 |
| Validation rules | Effective date at a period boundary of each calendar the plan uses. |
| Error scenarios | Guardrail blocked; validation errors listed per rule. |
| Permissions | Plan administrator edits; Compliance officer and second approver approve. |
| Dependencies | FR-CPL-007 |
| User stories | US-27 |
| Acceptance criteria | AC-27.1, AC-27.2 |
| Screens / APIs / Entities | SC-04 / API-16 / `plan`, `plan_version`, `plan_rule` |

#### FR-PLN-002 — Declarative primitive library

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Rules are composed from versioned primitives: volume measures per order line with item rules; hierarchy selector; qualification predicates including counts and profile facts; rank ladders with paid-as, title, maintenance and grace; payout functions (percent by level, generations with compression, differential, override, matching, fast start, flat, pool by shares); limits; carry state; calendars. |
| Business justification | The most common mechanisms in the 21-plan corpus must be configuration, not code. |
| Traces to (research) | GAP-020, F-08, P1 |
| User role | Plan administrator; Implementation consultant |
| Preconditions | Draft version. |
| Trigger | Admin adds a rule. |
| Inputs | Primitive type; parameters; scope (market, participant types, bonus name). |
| Processing logic | Typed parameter validation; dependency graph between rules determines pass order; plain-language rendering of each rule. |
| Expected outputs | Plan rules. |
| Business rules | BR-RNK-05, BR-RNK-06, BR-RNK-09, BR-PER-01 |
| Validation rules | No dependency cycle; every bonus names the tree and the volume measure it uses and its reversal policy. |
| Error scenarios | Unknown measure; cyclic dependency. |
| Permissions | Plan administrator. |
| Dependencies | FR-PLN-001 |
| User stories | US-44 |
| Acceptance criteria | AC-44.1, AC-44.2 |
| Screens / APIs / Entities | SC-04 / API-16 / `plan_rule` |

#### FR-PLN-003 — Controlled extension point

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Mechanisms outside the primitives are expressed first in a pure, typed expression language (no I/O, bounded evaluation) and, where that is insufficient, as platform-reviewed plan modules shipped in the platform codebase, versioned, parameterised and available to all tenants. Tenant-specific code branches are not allowed. |
| Business justification | 11 of 16 hold-out plans need at least one mechanism outside any fixed list. |
| Traces to (research) | GAP-020, P1, ADR-05 |
| User role | Implementation consultant; Vendor engineer |
| Preconditions | Mechanism documented with examples from the plan document. |
| Trigger | A rule cannot be expressed with primitives. |
| Inputs | Expression or module reference with parameters; golden cases. |
| Processing logic | Expressions are type-checked and evaluated deterministically; modules require golden tests and vendor code review before release; both are versioned and recorded in traces. |
| Expected outputs | Extension rule. |
| Business rules | BR-PLN-05 |
| Validation rules | At least one golden case per extension rule. |
| Error scenarios | Type error; evaluation bound exceeded. |
| Permissions | Implementation consultant authors expressions; modules by vendor release only. |
| Dependencies | FR-PLN-006 |
| User stories | US-44 |
| Acceptance criteria | AC-44.1, AC-44.2 |
| Screens / APIs / Entities | SC-04 / API-16 / `plan_rule` |

#### FR-PLN-004 — Caps and pools configuration

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A cap has scope (set of bonus types), base expression, rate, method (proportional, priority list, per person) and residue rule; per-participant constraints are evaluated before company-level caps. Pools have a base scoped by market and an allocation rule (shares, rank-ordered, first-N). |
| Business justification | Two readings of one cap moved 9,130.43 between leader groups in the stress test. |
| Traces to (research) | GAP-022, F-13 |
| User role | Plan administrator |
| Preconditions | Draft version. |
| Trigger | Admin configures a cap or pool. |
| Inputs | Scope; base; rate; method; priority order; residue rule. |
| Processing logic | Validate scope bonuses exist; preview on a chosen historical period shows payees affected and amounts removed. |
| Expected outputs | Cap or pool rule; preview. |
| Business rules | BR-CAP-01, BR-CAP-02, BR-CAP-03, BR-MNY-03 |
| Validation rules | Priority list covers the scope; residue rule set. |
| Error scenarios | Scope overlaps another cap without stated precedence. |
| Permissions | Plan administrator. |
| Dependencies | FR-PLN-005 |
| User stories | US-11 |
| Acceptance criteria | AC-11.1, AC-11.2 |
| Screens / APIs / Entities | SC-05 / API-16, API-17 / `plan_rule`, `simulation` |

#### FR-PLN-005 — Simulation and version comparison

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A draft version is run on historical input snapshots without touching live results; the comparison shows per-payee and per-bonus differences against the current version, distribution of gains and losses, cap effects and guardrail flags, with totals reconciling to each run. |
| Business justification | Table stakes for credibility; activation is blocked without it. |
| Traces to (research) | GAP-026, F-11 |
| User role | Plan administrator; Compliance officer |
| Preconditions | At least one committed period or imported history snapshot. |
| Trigger | Admin starts a simulation. |
| Inputs | Version; period(s). |
| Processing logic | Worker job using the same engine code path with a simulation flag; results stored separately; diff computed in the database. |
| Expected outputs | Simulation with comparison report. |
| Business rules | BR-PLN-02 |
| Validation rules | Period is a full historical period. |
| Error scenarios | Snapshot missing (cannot simulate). |
| Permissions | Plan administrator. |
| Dependencies | FR-COMP-002 |
| User stories | US-10 |
| Acceptance criteria | AC-10.1, AC-10.2, AC-10.3 |
| Screens / APIs / Entities | SC-04, SC-42 / API-17 / `simulation`, `result_line` |

#### FR-PLN-006 — Golden datasets

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Frozen inputs with expected payout lines are kept per plan version and per platform primitive; every engine release and every plan version must reproduce them exactly. |
| Business justification | Deterministic proof that a rule does what the plan document says. |
| Traces to (research) | GAP-026, F-11 |
| User role | Implementation consultant |
| Preconditions | Examples from the plan document or a parallel run. |
| Trigger | Authoring or CI. |
| Inputs | Input fixture; expected lines. |
| Processing logic | Run and compare line by line; failures block activation and release. |
| Expected outputs | Pass or fail report. |
| Business rules | BR-PLN-06 |
| Validation rules | Expected totals equal sum of expected lines. |
| Error scenarios | Mismatch listed per line. |
| Permissions | Implementation consultant. |
| Dependencies | FR-PLN-001 |
| User stories | US-10 |
| Acceptance criteria | AC-10.1, AC-10.2, AC-10.3 |
| Screens / APIs / Entities | SC-42 / API-17 / `golden_dataset` |

#### FR-PLN-007 — Plan-change governance

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A version moves through draft, simulation, compliance review with guardrails, filing status per market, field notice and effective date; activation is blocked without a full-period simulation and, where the market pack requires a filing, without recorded filing status. |
| Business justification | A change that silently wipes accrued state is a dispute and possibly a legal issue. |
| Traces to (research) | GAP-097, F-28, FL-08, CPL-06 |
| User role | Plan administrator; Compliance officer |
| Preconditions | Draft complete. |
| Trigger | Submit for review. |
| Inputs | Simulation reference; filing evidence; notice date. |
| Processing logic | Checklist per market; second-person approval; scheduled activation at period boundary; notice period from tenant setting. |
| Expected outputs | Scheduled version; notices. |
| Business rules | BR-PLN-02, BR-PLN-03, BR-PLN-04 |
| Validation rules | All checklist items complete. |
| Error scenarios | Missing simulation; missing filing status; notice period not met. |
| Permissions | Compliance officer approves; a second approver activates. |
| Dependencies | FR-PLN-005, FR-CPL-007 |
| User stories | US-27 |
| Acceptance criteria | AC-27.1, AC-27.2 |
| Screens / APIs / Entities | SC-44 / API-16 / `plan_version`, `approval`, `document` |

#### FR-PLN-008 — Transition rules between versions

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Each new version declares how titles, carry balances, streak counters, banked points and one-time flags move from the previous version; a transition report lists every participant whose state changed. |
| Business justification | Real plans carry long-horizon state that a change would otherwise cut. |
| Traces to (research) | GAP-097, GAP-025 |
| User role | Plan administrator |
| Preconditions | Previous version has committed state. |
| Trigger | Activation. |
| Inputs | Mapping functions per state item. |
| Processing logic | Apply transition functions as the first step of the first run under the new version; store before and after. |
| Expected outputs | Transition report. |
| Business rules | BR-PLN-01, BR-RNK-07 |
| Validation rules | Every state item has a declared rule (carry, map, reset with reason). |
| Error scenarios | Undeclared item (activation blocked). |
| Permissions | Plan administrator. |
| Dependencies | FR-COMP-004 |
| User stories | US-27 |
| Acceptance criteria | AC-27.1, AC-27.2 |
| Screens / APIs / Entities | SC-44 / API-16 / `plan_transition`, `qualification_state` |

### 3.10 Calculation engine (FR-COMP)

#### FR-COMP-001 — Calendars and period lifecycle

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Each period of each calendar has a state: Open, Calculating, Calculated, Committed, Paid, Closed. Inputs and outputs are frozen at Committed. A transaction is assigned to a period by its crediting event and the calendar's cut-off time zone. |
| Business justification | Without a lifecycle a late order either silently changes paid history or is lost. |
| Traces to (research) | GAP-023, F-09, ENT-12 |
| User role | Commission analyst |
| Preconditions | Calendar configured. |
| Trigger | Cut-off time reached; analyst actions. |
| Inputs | Period id; action. |
| Processing logic | State machine with guarded transitions; Calculated is re-runnable and disposable; Committed requires approval; Paid when all batches for the period are settled or resolved; Closed after reconciliation sign-off. |
| Expected outputs | Period state; events PeriodCutOff, PeriodCommitted, PeriodClosed. |
| Business rules | BR-PER-01, BR-PER-02, BR-PER-03, BR-PER-04 |
| Validation rules | Transition allowed from current state; ingestion sync healthy before Calculating. |
| Error scenarios | Sync behind (calculation blocked with last sync time); illegal transition (409). |
| Permissions | Commission analyst operates; Finance approver commits. |
| Dependencies | FR-INT-002 |
| User stories | US-06 |
| Acceptance criteria | AC-06.1, AC-06.2, AC-06.3 |
| Screens / APIs / Entities | SC-01 / API-18 / `calendar`, `period` |

#### FR-COMP-002 — Run execution with snapshot, lock and idempotency

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A run binds one period, one plan version, one settings version and one input snapshot (orders, order events, genealogy as known at an instant, prior qualification state). It executes on a worker pool, is idempotent per run request id and locked per tenant, calendar and period. |
| Business justification | Two analysts pressing run, or a retry, must not create two results. |
| Traces to (research) | GAP-023, GAP-060, ENT-13 |
| User role | Commission analyst |
| Preconditions | Period at cut-off, state Open or Calculated. |
| Trigger | Analyst requests a run. |
| Inputs | Period; run request id; plan version (by effective date). |
| Processing logic | Acquire advisory lock; write snapshot reference; load tree and facts into memory; calculate; write result lines, qualification state candidates and control totals in one transaction; release lock; progress reported. |
| Expected outputs | Run in state Calculated with totals; duplicate request returns the same run id. |
| Business rules | BR-PER-06, BR-CMP-01 |
| Validation rules | Plan version active for the period; snapshot complete. |
| Error scenarios | Worker crash (run marked Failed; resumable from snapshot; no partial results visible); lock held (returns the running run id). |
| Permissions | Commission analyst. |
| Dependencies | FR-COMP-001, FR-PLN-001 |
| User stories | US-06 |
| Acceptance criteria | AC-06.1, AC-06.2, AC-06.3 |
| Screens / APIs / Entities | SC-01 / API-18 / `run`, `run_snapshot`, `result_line` |

#### FR-COMP-003 — Multi-pass calculation order

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Passes run in a fixed order: volumes per line and per position; qualification and paid-as rank; individual bonuses; matching; pools; per-participant constraints; caps; netting of clawbacks; minimums; rounding once per payout line; withholding. |
| Business justification | Matching depends on others' bonuses, pools on company volume, caps on everything before them. |
| Traces to (research) | GAP-022, GAP-021, 13 §7.2 |
| User role | System |
| Preconditions | Snapshot loaded. |
| Trigger | Run. |
| Inputs | Snapshot; plan rules. |
| Processing logic | Topological order of rule dependencies inside each pass; high-precision arithmetic until the rounding pass; allocation by largest remainder where a total is split. |
| Expected outputs | Result lines with pass and rule ids. |
| Business rules | BR-CAP-02, BR-MNY-02, BR-TAX-02 |
| Validation rules | Engine invariants: lines sum to run total; caps not exceeded; allocations sum to their totals. |
| Error scenarios | Invariant breach (run fails; nothing committed). |
| Permissions | System. |
| Dependencies | FR-COMP-012 |
| User stories | US-14 |
| Acceptance criteria | AC-14.1, AC-14.2, AC-14.3 |
| Screens / APIs / Entities | SC-02 / API-18 / `result_line` |

#### FR-COMP-004 — Qualification state across periods

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Per position and period the engine stores paid-as rank, highest title per ladder, counters, streaks, carry balances, banked points and one-time flags. State is an output of a committed run and an input to the next; it is never edited directly. |
| Business justification | Rank is the main driver of pay; mutable fields make disputes unprovable. |
| Traces to (research) | GAP-025, ENT-15 |
| User role | Commission analyst; Distributor |
| Preconditions | Prior committed state or migration import. |
| Trigger | Run commit. |
| Inputs | Run results. |
| Processing logic | Candidate state written with the run; becomes authoritative at commit; corrections only through restatement or migration import with approval. |
| Expected outputs | Qualification state rows. |
| Business rules | BR-RNK-05, BR-RNK-06, BR-RNK-07, BR-RNK-08, BR-RNK-09 |
| Validation rules | One row per position, period, calendar. |
| Error scenarios | Missing prior state (period cannot be calculated; migration required). |
| Permissions | System; read by staff and by the owner. |
| Dependencies | FR-COMP-006 |
| User stories | US-46 |
| Acceptance criteria | AC-46.1, AC-46.2 |
| Screens / APIs / Entities | SC-43, SC-19 / API-19 / `qualification_state` |

#### FR-COMP-005 — Run review

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Before commit the analyst sees totals against the previous run, variance by bonus type, top movers, exception list (invariant warnings, guardrail warnings, held payees, unusually large lines) and what changed in inputs and plan version. |
| Business justification | A wrong approval pays thousands of people. |
| Traces to (research) | GAP-023, F-10 |
| User role | Commission analyst; Finance manager |
| Preconditions | Run Calculated. |
| Trigger | Analyst opens review. |
| Inputs | Run id; comparison run. |
| Processing logic | Deterministic diff queries; thresholds for exceptions from tenant settings. |
| Expected outputs | Review dataset; export. |
| Business rules | BR-PER-03 |
| Validation rules | Totals equal control totals of the run. |
| Error scenarios | Sync became stale after the run (banner; commit blocked until re-run or acknowledged by rule). |
| Permissions | Commission analyst, Finance approver. |
| Dependencies | FR-COMP-002 |
| User stories | US-06 |
| Acceptance criteria | AC-06.1, AC-06.2, AC-06.3 |
| Screens / APIs / Entities | SC-02 / API-19 / `run`, `result_line` |

#### FR-COMP-006 — Commit with second-person approval

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Committing a run freezes inputs and outputs, makes qualification state authoritative and posts the ledger entry; it requires an approver who did not prepare the run. |
| Business justification | Reproducibility and separation of duties. |
| Traces to (research) | GAP-023, GAP-065, F-10 |
| User role | Finance approver |
| Preconditions | Run Calculated; review opened; no blocking exceptions. |
| Trigger | Approver commits. |
| Inputs | Run id; step-up factor. |
| Processing logic | Single database transaction: mark run and period Committed, write state, post balanced journal entry (expense, payables, withholding, residue), write outbox events. |
| Expected outputs | Committed run; journal entry; RunCommitted event. |
| Business rules | BR-PER-03, BR-ADJ-02 |
| Validation rules | Ledger entry balances; sum of payables plus withholding plus residue equals run total. |
| Error scenarios | Approver equals preparer (refused); invariant fails (transaction rolled back). |
| Permissions | Finance approver with MFA step-up. |
| Dependencies | FR-IAM-004, FR-FIN-001 |
| User stories | US-07 |
| Acceptance criteria | AC-07.1, AC-07.2 |
| Screens / APIs / Entities | SC-02 / API-20 / `run`, `period`, `journal_entry`, `posting`, `approval`, `outbox_event` |

#### FR-COMP-007 — Per-line provenance and trace

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Every result line stores run id, plan version, rule id, pass, payee position, compact inputs (order line ids or aggregate keys, volume, rate, rank as evaluated, tree snapshot reference), intermediate values and rounding. A full trace is regenerated by replay. |
| Business justification | Proving why a commission was calculated; disputes and support cost. |
| Traces to (research) | GAP-027, F-12, ENT-14 |
| User role | Support agent; Commission analyst |
| Preconditions | Run exists. |
| Trigger | User opens a line. |
| Inputs | Result line id. |
| Processing logic | Return stored compact trace; on demand replay the rule for that payee from the snapshot and expand. |
| Expected outputs | Trace document. |
| Business rules | BR-PAY-06 |
| Validation rules | Trace totals equal line amount. |
| Error scenarios | Snapshot archived to cold storage (asynchronous retrieval). |
| Permissions | Staff with trace permission; distributors see the simplified explanation only (FR-DIST-002). |
| Dependencies | FR-COMP-008 |
| User stories | US-13 |
| Acceptance criteria | AC-13.1 |
| Screens / APIs / Entities | SC-02, SC-06 / API-21 / `result_line`, `run_snapshot` |

#### FR-COMP-008 — Replay of committed periods

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Re-running a committed period from its snapshot with its plan and settings versions reproduces every line exactly, regardless of later corrections or engine releases flagged compatible. |
| Business justification | The core audit property. |
| Traces to (research) | GAP-010, GAP-023 |
| User role | Commission analyst; Auditor |
| Preconditions | Committed run. |
| Trigger | Replay request or CI differential test. |
| Inputs | Run id. |
| Processing logic | Engine version pinned per run; replay executes in a sandbox and compares hash of ordered lines. |
| Expected outputs | Match or diff. |
| Business rules | BR-PER-03 |
| Validation rules | Hash equality. |
| Error scenarios | Engine version retired (must remain runnable for the retention period). |
| Permissions | Commission analyst. |
| Dependencies | FR-COMP-002 |
| User stories | US-01 |
| Acceptance criteria | AC-01.1, AC-01.2 |
| Screens / APIs / Entities | SC-01 / API-18 / `run`, `run_snapshot` |

#### FR-COMP-009 — Restatement of a committed period

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A restatement is requested with a reason, recalculated in a sandbox copy with corrected inputs, shown as a per-payee and per-bonus diff, approved, and applied as adjustments in the open period. No posting or committed line is edited. |
| Business justification | Real errors must be corrected openly. |
| Traces to (research) | GAP-023, F-09, FL-07 |
| User role | Compliance officer; Commission analyst |
| Preconditions | Committed period; triggering case. |
| Trigger | Restatement request. |
| Inputs | Period; corrected inputs reference; reason. |
| Processing logic | Sandbox run; diff; approval by a second person; adjustment lines created in the open run referencing the restatement; statement shows them separately. |
| Expected outputs | Restatement record; diff; adjustments. |
| Business rules | BR-PER-05 |
| Validation rules | Diff totals equal sum of adjustments. |
| Error scenarios | Approval refused; diff empty (closed with no action). |
| Permissions | Compliance officer requests; Finance approver approves. |
| Dependencies | FR-COMP-008, FR-CAS-001 |
| User stories | US-09 |
| Acceptance criteria | AC-09.1 |
| Screens / APIs / Entities | SC-06 / API-22 / `restatement`, `result_line`, `case` |

#### FR-COMP-010 — Adjustment lines from late transactions and cases

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | The open run includes adjustment lines generated from late transactions, clawback netting, approved manual adjustments and restatements, each linked to its origin. |
| Business justification | Everything that changes pay flows through a run and the ledger. |
| Traces to (research) | GAP-023, GAP-032 |
| User role | Commission analyst |
| Preconditions | Origins approved where approval is required. |
| Trigger | Run. |
| Inputs | Queue of origins. |
| Processing logic | Generate lines with origin type and id; include in control totals by category. |
| Expected outputs | Adjustment lines. |
| Business rules | BR-PER-04, BR-ADJ-01 |
| Validation rules | Each origin consumed once (once-only key). |
| Error scenarios | Origin withdrawn before run (skipped, logged). |
| Permissions | System. |
| Dependencies | FR-ORD-005, FR-CAS-002 |
| User stories | US-08 |
| Acceptance criteria | AC-08.1 |
| Screens / APIs / Entities | SC-02 / API-19 / `result_line`, `late_transaction` |

#### FR-COMP-011 — Provisional runs with true-up

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | A calendar can declare provisional payments (weekly advances or estimated pool payouts) that a later final run trues up. |
| Business justification | Two hold-out plans pay provisionally; needs a state the MVP lifecycle does not have. |
| Traces to (research) | P1, GAP-023 |
| User role | Plan administrator |
| Preconditions | Plan declares provisional component. |
| Trigger | Provisional calendar cut-off. |
| Inputs | Component; final period. |
| Processing logic | Provisional run commits and pays; final run computes the final amount and posts the difference. |
| Expected outputs | True-up lines. |
| Business rules | BR-PER-07 |
| Validation rules | Final minus provisional equals true-up per payee. |
| Error scenarios | Negative true-up handled by clawback policy. |
| Permissions | As runs. |
| Dependencies | FR-COMP-001 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-01 / API-18 / `run` |

#### FR-COMP-012 — Money arithmetic

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Amounts are integers in minor units; intermediate values use fixed-precision decimals; binary floating point is prohibited. Rounding happens once per payout line (default half-up, tenant setting); splits, pools and scaled caps are allocated by largest remainder; unavoidable residue posts to a named account; points-to-currency factors are effective-dated per market. |
| Business justification | Cents that do not reconcile break the ledger and trust. |
| Traces to (research) | GAP-021, F-14, ADR-06 |
| User role | Finance manager |
| Preconditions | Currency minor unit known. |
| Trigger | Calculation. |
| Inputs | Amounts; rounding mode. |
| Processing logic | Decimal library with explicit scale; deterministic tie-break in largest remainder (by fractional part descending, then payee id ascending). |
| Expected outputs | Exact totals. |
| Business rules | BR-MNY-01, BR-MNY-02, BR-MNY-03, BR-MNY-04, BR-MNY-05 |
| Validation rules | Sum of parts equals total for every allocation. |
| Error scenarios | Overflow guard on extreme values (run fails). |
| Permissions | System. |
| Dependencies | FR-TEN-003 |
| User stories | US-14 |
| Acceptance criteria | AC-14.1, AC-14.2, AC-14.3 |
| Screens / APIs / Entities | SC-02 / API-18 / `result_line`, `posting` |

### 3.11 Obligations ledger (FR-FIN)

#### FR-FIN-001 — Double-entry obligations ledger

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | An append-only journal of balanced entries records what the tenant owes each payee and what payees owe back. Accounts: commission expense, payee payable, withholding payable, payout in transit, settled clearing, clawback receivable, rounding residue, breakage, write-off, and per credit type liability (SDD-09 §2). The platform never records platform-held funds. |
| Business justification | Without double entry totals cannot be proved; the word wallet is not used. |
| Traces to (research) | GAP-030, F-15, ADR-07, MH-REQ-01 |
| User role | Finance manager |
| Preconditions | Chart of ledger accounts provisioned per tenant and market. |
| Trigger | Run commit, payout instruction, settlement, return, clawback, write-off, adjustment. |
| Inputs | Event with amounts and references. |
| Processing logic | Posting rules per event type; entry rejected unless debits equal credits; each entry carries idempotency key, run or case reference and approver; no update or delete. |
| Expected outputs | Journal entry with postings. |
| Business rules | BR-LED-01, BR-LED-02, BR-MNY-04 |
| Validation rules | Balanced; idempotency key unique. |
| Error scenarios | Duplicate key returns existing entry; unbalanced entry rejected (alert). |
| Permissions | System only; humans act through approved cases. |
| Dependencies | FR-COMP-006 |
| User stories | US-14 |
| Acceptance criteria | AC-14.1, AC-14.2, AC-14.3 |
| Screens / APIs / Entities | SC-33 / API-23 / `ledger_account`, `journal_entry`, `posting` |

#### FR-FIN-002 — Derived payee balances

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A payee's payable, in-transit and receivable balances are sums of postings; nothing is stored as an editable balance. Displayed as earnings balance owed by the tenant. |
| Business justification | Balances that can be edited cannot be audited. |
| Traces to (research) | GAP-030, GAP-033 |
| User role | Finance manager; Distributor |
| Preconditions | Postings exist. |
| Trigger | Balance query. |
| Inputs | Payee; as-of time. |
| Processing logic | Aggregate by account; cached projection rebuilt from postings and verified nightly. |
| Expected outputs | Balances. |
| Business rules | BR-LED-02 |
| Validation rules | Projection equals sum of postings. |
| Error scenarios | Mismatch (projection rebuilt; alert). |
| Permissions | Finance roles; payee sees own. |
| Dependencies | FR-FIN-001 |
| User stories | US-14 |
| Acceptance criteria | AC-14.1, AC-14.2, AC-14.3 |
| Screens / APIs / Entities | SC-33, SC-18 / API-23, API-28 / `posting`, `ledger_account` |

#### FR-FIN-003 — Clawback policy and receivables

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Per bonus type the tenant chooses order-line clawback against future earnings or restatement; the resulting amount posts to the payee's clawback receivable and is netted in later runs; the platform never initiates a debit from a distributor's bank account. |
| Business justification | The policy decides who bears the cost of a refund; the two methods give different money. |
| Traces to (research) | GAP-032, F-19, FL-06 |
| User role | Finance manager |
| Preconditions | Policy set per bonus type (default order-line). |
| Trigger | Refund, return or chargeback after payout. |
| Inputs | Order event; policy. |
| Processing logic | Order-line: reverse the commission lines whose source is the order. Restatement: sandbox recalculation of the original period for affected payees. Post receivable; net against payable in the next run up to the available amount; remainder carried. |
| Expected outputs | Clawback lines; receivable postings; statement lines. |
| Business rules | BR-REV-07, BR-REV-09, BR-REV-02 |
| Validation rules | Receivable never exceeds amounts previously paid on the affected lines (order-line) or the restated difference (restatement). |
| Error scenarios | Payee has no future earnings (receivable ages; write-off rule). |
| Permissions | Policy set by Finance manager with approval. |
| Dependencies | FR-ORD-004, FR-COMP-009 |
| User stories | US-20 |
| Acceptance criteria | AC-20.1, AC-20.2, AC-20.3 |
| Screens / APIs / Entities | SC-06, SC-33 / API-22, API-23 / `posting`, `result_line` |

#### FR-FIN-004 — Write-off with approval

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Clawback receivables below a tenant threshold or older than an age limit may be written off with a reason and approval; the posting moves the amount to the write-off account. |
| Business justification | Receivables that will never be recovered should not sit forever. |
| Traces to (research) | GAP-032 |
| User role | Finance manager |
| Preconditions | Receivable balance exists. |
| Trigger | Finance proposes a write-off (single or batch with preview). |
| Inputs | Payees; amounts; reason. |
| Processing logic | Case with approval; posting on approval. |
| Expected outputs | Write-off postings. |
| Business rules | BR-REV-08 |
| Validation rules | Amount not above receivable. |
| Error scenarios | Above threshold without second approver. |
| Permissions | Finance manager proposes; Finance approver approves. |
| Dependencies | FR-CAS-002 |
| User stories | US-20 |
| Acceptance criteria | AC-20.1, AC-20.2, AC-20.3 |
| Screens / APIs / Entities | SC-33 / API-30 / `posting`, `case` |

#### FR-FIN-005 — General-ledger journal export

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | At period end a journal export maps ledger accounts to the tenant's chart of accounts and is delivered by file and API; the tenant's ERP stays the general ledger. |
| Business justification | Building a general ledger duplicates what every tenant has. |
| Traces to (research) | GAP-033, F-15 |
| User role | Finance manager |
| Preconditions | Account mapping configured. |
| Trigger | Period Committed or Closed; manual request. |
| Inputs | Period; mapping. |
| Processing logic | Aggregate postings by mapped account and dimension; lines reference run ids; export is itself recorded and re-downloadable. |
| Expected outputs | Balanced journal file. |
| Business rules | BR-LED-03 |
| Validation rules | Export balances. |
| Error scenarios | Unmapped account (export blocked with list). |
| Permissions | Finance manager. |
| Dependencies | FR-FIN-001 |
| User stories | US-15 |
| Acceptance criteria | AC-15.1 |
| Screens / APIs / Entities | SC-33 / API-24 / `export_job`, `ledger_account` |

#### FR-FIN-006 — Non-cash rewards ledger

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | Credit types with value, expiry, redemption scope and tax-treatment flag; balances are liabilities per type; expiry posts a reversal and notifies the holder in advance. The liability account type exists from MVP. |
| Business justification | Thirteen of 21 plans pay non-cash rewards. |
| Traces to (research) | GAP-024, F-35 |
| User role | Finance manager |
| Preconditions | Credit type defined. |
| Trigger | Run awards credits; redemption event from commerce; expiry job. |
| Inputs | Credit type; amount. |
| Processing logic | Postings to credit liability; redemption hook API. |
| Expected outputs | Credit balances. |
| Business rules | BR-CRD-01, BR-CRD-02 |
| Validation rules | Redemption not above balance. |
| Error scenarios | Expired credit redemption refused. |
| Permissions | Finance manager. |
| Dependencies | FR-FIN-001 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-33 / API-23 / `credit_type`, `posting` |

#### FR-FIN-007 — Multi-currency with effective-dated rates

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | Rate table with source and time; conversion performed once at a defined step; statements show original and converted amounts and the rate. MVP is one currency per tenant market. |
| Business justification | A plan paying on volume in several currencies is ambiguous without a defined conversion step. |
| Traces to (research) | GAP-034, F-36 |
| User role | Finance manager |
| Preconditions | Rate source configured. |
| Trigger | Run in a multi-currency plan. |
| Inputs | Rates. |
| Processing logic | Conversion pass; stale rate blocks conversion. |
| Expected outputs | Converted lines. |
| Business rules | BR-CMP-09 |
| Validation rules | Rate not older than policy. |
| Error scenarios | Stale rate. |
| Permissions | Finance manager. |
| Dependencies | FR-COMP-003 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-33 / API-23 / `fx_rate` |

### 3.12 Payouts (FR-PAY)

#### FR-PAY-001 — Payout batch lifecycle

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Payable balances above the minimum and not on hold are gathered into a batch per market, provider and currency. States: Draft, Reviewed, Approved, Instructing, Partially settled, Settled, Failed, Cancelled. Preparer and approver differ. |
| Business justification | Wrong money is the worst failure. |
| Traces to (research) | GAP-030, GAP-035, F-16, MH-REQ-02 |
| User role | Payout officer; Finance approver |
| Preconditions | Period Committed; provider configured and eligible. |
| Trigger | Payout officer prepares a batch. |
| Inputs | Period(s); market; provider; inclusion rules. |
| Processing logic | Select payees; exclude holds (bank-detail cooling-off, duplicate case, missing tax profile where required, tenant hold); show totals and exclusions; approval with step-up; on approval create instructions. |
| Expected outputs | Batch with instructions; approval record. |
| Business rules | BR-PAY-02, BR-ADJ-02 |
| Validation rules | Batch total equals sum of instruction amounts; each instruction not above payee payable. |
| Error scenarios | Approver equals preparer; provider not eligible; payee balance changed since draft (line recalculated, batch back to Draft). |
| Permissions | Payout officer prepares; Finance approver approves. |
| Dependencies | FR-FIN-002, FR-PAY-005, FR-PAY-006 |
| User stories | US-47 |
| Acceptance criteria | AC-47.1, AC-47.2 |
| Screens / APIs / Entities | SC-03 / API-25 / `payout_batch`, `payout_instruction`, `approval` |

#### FR-PAY-002 — Provider adapters and bank-file fallback

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A provider-adapter interface (submit, query status, parse settlement report, verify webhook) with one adapter per payout provider and a bank-file adapter per file format. Tenants bring their own provider accounts; credentials are stored encrypted per tenant. |
| Business justification | Mainstream providers restrict MLM merchants; no dependence on a single provider. |
| Traces to (research) | GAP-004, F-16, ADR-09, MH-REQ-03 |
| User role | Integration developer; Payout officer |
| Preconditions | Provider record with approval evidence. |
| Trigger | Batch approved. |
| Inputs | Instructions. |
| Processing logic | Adapter maps instruction to provider request; stores provider reference; bank-file adapter produces a file for manual upload and accepts a result file. |
| Expected outputs | Provider submissions or bank file. |
| Business rules | BR-PAY-11 |
| Validation rules | Provider on the tenant's allow-list for the market. |
| Error scenarios | Provider rejects batch (retry failed lines only); credentials invalid (batch paused). |
| Permissions | System; Tenant admin manages provider configuration. |
| Dependencies | FR-PAY-003 |
| User stories | US-16 |
| Acceptance criteria | AC-16.1, AC-16.2, AC-16.3 |
| Screens / APIs / Entities | SC-03, SC-13 / API-25 / `provider_config`, `payout_instruction` |

#### FR-PAY-003 — Signed, idempotent payout instructions through an outbox

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Each instruction carries an idempotency key and signature and is sent from a transactional outbox; a retry after timeout sends the same key so that at most one payment results. |
| Business justification | Retried instructions must not pay twice. |
| Traces to (research) | GAP-035, SEC-06, ADR-10 |
| User role | System |
| Preconditions | Batch Approved. |
| Trigger | Outbox dispatcher. |
| Inputs | Instruction. |
| Processing logic | Ledger posting payable to in-transit and outbox row in one transaction; dispatcher sends with exponential backoff; ambiguous outcomes resolved by status query before any re-send. |
| Expected outputs | Instruction state Instructed or Accepted. |
| Business rules | BR-PAY-10 |
| Validation rules | Signature verifies; key unique per instruction. |
| Error scenarios | Timeout (status query, then retry with same key); permanent rejection (state Failed, amount returned to payable). |
| Permissions | System. |
| Dependencies | FR-FIN-001 |
| User stories | US-16 |
| Acceptance criteria | AC-16.1, AC-16.2, AC-16.3 |
| Screens / APIs / Entities | SC-03 / API-25 / `payout_instruction`, `outbox_event`, `posting` |

#### FR-PAY-004 — Settlement reconciliation and returned payments

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Provider webhooks and settlement reports are matched to instructions; settled amounts clear in-transit; returned payments move the amount back to payee payable and open a case; unmatched items go to an exceptions queue. |
| Business justification | Nobody is paid twice or not at all. |
| Traces to (research) | GAP-035, F-16, MH-REQ-04 |
| User role | Payout officer; Finance manager |
| Preconditions | Instructions sent. |
| Trigger | Webhook or report import. |
| Inputs | Provider reference; status; amount. |
| Processing logic | Idempotent inbound event handling; post settlement or return entries; daily reconciliation totals per provider; period moves to Paid when all instructions are terminal. |
| Expected outputs | Reconciliation report; cases for returns. |
| Business rules | BR-PAY-09 |
| Validation rules | Amount equals instruction amount (differences are exceptions). |
| Error scenarios | Unknown reference; amount mismatch; duplicate webhook (acknowledged without change). |
| Permissions | Payout officer resolves exceptions. |
| Dependencies | FR-PAY-003 |
| User stories | US-16 |
| Acceptance criteria | AC-16.1, AC-16.2, AC-16.3 |
| Screens / APIs / Entities | SC-34 / API-26 / `inbound_event`, `payout_instruction`, `posting`, `case` |

#### FR-PAY-005 — Bank-detail versions and change controls

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Bank details are stored as encrypted versions. A new or changed version requires re-authentication, notifies the previous contact, and starts a cooling-off before the first payout to it; payouts due inside the cooling-off are held. |
| Business justification | Bank-detail change is a classic payout-fraud vector. |
| Traces to (research) | GAP-035, GAP-065, F-17, SEC-05, FL-10 |
| User role | Distributor; Support agent |
| Preconditions | Payee authenticated. |
| Trigger | Payee or agent submits new details. |
| Inputs | Bank details; fresh authentication. |
| Processing logic | Validate format per market; create version; notify old and new contacts; set cooling-off-until; signal when many payees change to the same account. |
| Expected outputs | Bank-detail version; notifications; hold flag. |
| Business rules | BR-PAY-08 |
| Validation rules | Format valid; account holder name matches payee where the market pack requires. |
| Error scenarios | Re-authentication failed; details shared with other payees above threshold (case). |
| Permissions | Payee self-service; Support agent only through a case with evidence. |
| Dependencies | FR-IAM-007 |
| User stories | US-17 |
| Acceptance criteria | AC-17.1, AC-17.2 |
| Screens / APIs / Entities | SC-22, SC-09 / API-27 / `bank_detail_version`, `notification` |

#### FR-PAY-006 — Provider eligibility record

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | For each tenant and market the platform records the payment and payout providers, approval date, approved business description and who holds funds; go-live is blocked without it. |
| Business justification | Provider eligibility for MLM merchants is decided per merchant and is a launch blocker. |
| Traces to (research) | GAP-004, CPL-11, MH-REQ-10 |
| User role | Tenant admin; Compliance officer |
| Preconditions | Provider approval obtained by the tenant. |
| Trigger | Admin records the approval. |
| Inputs | Provider; evidence document; description; dates. |
| Processing logic | Store; show on the launch checklist; reminder before expiry or review dates. |
| Expected outputs | Provider record. |
| Business rules | BR-PAY-11 |
| Validation rules | Evidence attached. |
| Error scenarios | Missing evidence (go-live blocked). |
| Permissions | Tenant admin. |
| Dependencies | FR-TEN-004 |
| User stories | US-38 |
| Acceptance criteria | AC-38.1, AC-38.2 |
| Screens / APIs / Entities | SC-17, SC-13 / API-39 / `provider_config`, `document` |

#### FR-PAY-007 — Minimum payout, holds and dormant balances

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A market-level minimum payout threshold keeps small payables until they accumulate; holds can be placed on a payee by rule or by an authorised user with reason; a dormant balance report lists payables with no successful payout for a configurable time. |
| Business justification | Fees make tiny payouts uneconomic; unclaimed balances may become liabilities. |
| Traces to (research) | GAP-035 |
| User role | Payout officer |
| Preconditions | Thresholds configured. |
| Trigger | Batch preparation; hold action. |
| Inputs | Threshold; hold reason. |
| Processing logic | Excluded payees listed with reason in the batch; holds are dated events with release. |
| Expected outputs | Exclusion list; dormant report. |
| Business rules | BR-PAY-12 |
| Validation rules | Hold has reason and owner. |
| Error scenarios | None specific. |
| Permissions | Payout officer; Compliance officer for holds. |
| Dependencies | FR-PAY-001 |
| User stories | US-47 |
| Acceptance criteria | AC-47.1, AC-47.2 |
| Screens / APIs / Entities | SC-03 / API-25 / `payout_batch`, `case` |

### 3.13 Tax (FR-TAX)

#### FR-TAX-001 — Payee tax profile

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Per payee: residency status, tax identifier (stored in the sensitive store, masked on display), entity type and prior-year totals per payer where a rule needs them. |
| Business justification | Withholding changes the net amount on every payout line. |
| Traces to (research) | GAP-031, F-18 |
| User role | Distributor; Finance manager |
| Preconditions | Payee exists. |
| Trigger | Payee completes the profile or staff updates through a case. |
| Inputs | Residency; tax id; documents. |
| Processing logic | Validate format per market pack; version the profile; missing id flags the payee for the higher rate where a rule sets one. |
| Expected outputs | Tax profile version. |
| Business rules | BR-TAX-01, BR-TAX-03 |
| Validation rules | Identifier format. |
| Error scenarios | Invalid format; missing profile (payout hold if the pack requires). |
| Permissions | Payee; Finance manager through case. |
| Dependencies | FR-PAR-001 |
| User stories | US-48 |
| Acceptance criteria | AC-48.1 |
| Screens / APIs / Entities | SC-22, SC-09 / API-27 / `tax_profile` |

#### FR-TAX-002 — Withholding rules per market

| Field | Content |
|---|---|
| Release / priority | MVP-B (market pack) / Must |
| Description | Effective-dated, market-scoped rules define rate, threshold, threshold basis, payee conditions and the rate when the tax id is missing. Withholding is computed after gross commission and before payout instruction, shown as a separate statement line and posted to a withholding liability. No rate or threshold is built into the platform; values come from the market pack confirmed by a tax adviser. |
| Business justification | Mandatory for the tenant as payer in the candidate markets. |
| Traces to (research) | GAP-031, F-18, CPL-10 |
| User role | Finance manager |
| Preconditions | Market pack with tax rules at counsel-confirmed status, or written risk acceptance. |
| Trigger | Withholding pass of a run. |
| Inputs | Payee tax profile; gross amount; rule set for the pay date. |
| Processing logic | Select applicable rule; compute withholding on the taxable base; round per rule; write tax line; ledger posting at commit. |
| Expected outputs | Tax lines; liability postings. |
| Business rules | BR-TAX-01, BR-TAX-02, BR-TAX-03 |
| Validation rules | Gross equals net plus withholding per payee. |
| Error scenarios | No rule for market and date (zero withholding with exception flag for review). |
| Permissions | Rules maintained in market packs; tenant Finance manager reviews. |
| Dependencies | FR-TAX-001, FR-CPL-012 |
| User stories | US-18, US-19 |
| Acceptance criteria | AC-18.1, AC-18.2, AC-19.1 |
| Screens / APIs / Entities | SC-12 / API-39 / `tax_rule`, `tax_line`, `posting` |

#### FR-TAX-003 — Year-end statements

| Field | Content |
|---|---|
| Release / priority | MVP-B (market pack) / Must |
| Description | At year end totals per payee per form type are validated (missing tax ids listed), forms generated in the market's format, distributed to payees and exported for the tenant's filing tool. |
| Business justification | Annual reporting duty of the payer. |
| Traces to (research) | GAP-031, F-18, FL-14 |
| User role | Finance manager |
| Preconditions | Tax year closed in the ledger. |
| Trigger | Finance starts year end. |
| Inputs | Tax year; market. |
| Processing logic | Totals from tax lines and postings; form templates in the market pack; regeneration creates a new version, never overwrites. |
| Expected outputs | Forms; export file. |
| Business rules | BR-TAX-04 |
| Validation rules | Form totals equal ledger totals. |
| Error scenarios | Missing tax ids (listed; forms for those payees held). |
| Permissions | Finance manager. |
| Dependencies | FR-TAX-002 |
| User stories | US-18 |
| Acceptance criteria | AC-18.1, AC-18.2 |
| Screens / APIs / Entities | SC-12 / API-36 / `tax_form`, `tax_line` |

### 3.14 Cases (FR-CAS)

#### FR-CAS-001 — Case framework

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | One case model serves genealogy changes, duplicates, disputes, manual adjustments, restatements, returned payments, bank-detail exceptions, grievances and privacy requests: type, subject, reason code, evidence, state, assignments, approvals, deadlines and an immutable event history. |
| Business justification | Every exceptional change needs reason, evidence and approver in one place. |
| Traces to (research) | GAP-002, GAP-065, ENT-06 |
| User role | Support agent; Commission analyst; Compliance officer |
| Preconditions | User has permission for the case type. |
| Trigger | User or system opens a case. |
| Inputs | Type; subject; reason; evidence. |
| Processing logic | Type-specific workflow and policy checks; SLA timers from market pack or tenant setting; effect preview before approval. |
| Expected outputs | Case with history. |
| Business rules | BR-ADJ-01 |
| Validation rules | Reason code from the type's list. |
| Error scenarios | Missing evidence where required. |
| Permissions | By case type. |
| Dependencies | FR-AUD-001 |
| User stories | US-02 |
| Acceptance criteria | AC-02.1, AC-02.2 |
| Screens / APIs / Entities | SC-06, SC-08 / API-30 / `case`, `case_event`, `approval`, `document` |

#### FR-CAS-002 — Manual adjustments with thresholds and second approver

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A manual adjustment is a case with reason code and evidence; above a tenant threshold it needs a second approver; nobody approves their own; adjustments to the approver's own or declared related accounts, or to accounts created within a configurable number of days, are blocked or escalated. |
| Business justification | Manual adjustment is the main insider-fraud vector. |
| Traces to (research) | GAP-065, GAP-002 |
| User role | Commission analyst; Finance approver |
| Preconditions | Open period exists. |
| Trigger | Analyst proposes an adjustment. |
| Inputs | Payee; amount; reason; evidence. |
| Processing logic | Policy checks; effect preview; on approval the adjustment enters the open run as a line (FR-COMP-010). |
| Expected outputs | Approved adjustment origin. |
| Business rules | BR-ADJ-01, BR-ADJ-02, BR-ADJ-03 |
| Validation rules | Amount non-zero; payee in tenant. |
| Error scenarios | Self-approval; related account; threshold exceeded without second approver. |
| Permissions | Commission analyst proposes; Finance approver approves. |
| Dependencies | FR-CAS-001, FR-IAM-004 |
| User stories | US-49 |
| Acceptance criteria | AC-49.1, AC-49.2 |
| Screens / APIs / Entities | SC-06 / API-30 / `case`, `approval` |

#### FR-CAS-003 — Commission dispute from a statement line

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A distributor opens a dispute from a statement line; the trace is attached automatically; states Opened, Under review, Resolved upheld, Resolved not upheld; response time tracked per market where required. |
| Business justification | Disputes resolved with facts instead of hours of tracing. |
| Traces to (research) | GAP-002, GAP-027, FL-05, CMP-09 |
| User role | Distributor; Commission analyst |
| Preconditions | Statement line exists. |
| Trigger | Distributor taps dispute. |
| Inputs | Line id; message. |
| Processing logic | Create case with trace; analyst resolves; upheld leads to adjustment or restatement request; outcome and explanation sent to the distributor. |
| Expected outputs | Dispute case; notification. |
| Business rules | BR-ADJ-04 |
| Validation rules | One open dispute per line. |
| Error scenarios | Dispute window passed (tenant setting; explanation shown). |
| Permissions | Line owner opens; Commission analyst resolves. |
| Dependencies | FR-COMP-007, FR-CAS-002 |
| User stories | US-50 |
| Acceptance criteria | AC-50.1 |
| Screens / APIs / Entities | SC-18, SC-06 / API-30 / `case`, `result_line` |

### 3.15 Distributor portal (FR-DIST)

#### FR-DIST-001 — Distributor statement

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Per pay period and per person: lines grouped by position and bonus, gross, withholding, clawbacks and adjustments as separate lines, net, payout status, rank used, period, and the disclosure link where one is published. No income projection appears anywhere. |
| Business justification | The statement is where distributor trust is won or lost. |
| Traces to (research) | GAP-027, GAP-003, F-38, MH-REQ-09, CPL-14 |
| User role | Distributor |
| Preconditions | Run committed. |
| Trigger | Distributor opens statements. |
| Inputs | Period. |
| Processing logic | Read from committed result lines, tax lines and payout status; cacheable after commit; totals per position and per person. |
| Expected outputs | Statement view; downloadable document. |
| Business rules | BR-PAY-06, BR-HON-01 |
| Validation rules | Person total equals sum of positions; net equals gross minus withholding minus netted clawbacks plus adjustments. |
| Error scenarios | Period not yet committed (shows status only, no estimates). |
| Permissions | Self only; Support agent with masked data. |
| Dependencies | FR-COMP-006 |
| User stories | US-04 |
| Acceptance criteria | AC-04.1, AC-04.2 |
| Screens / APIs / Entities | SC-18, SC-37 / API-28 / `statement`, `result_line`, `tax_line` |

#### FR-DIST-002 — Line explanation

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Each statement line opens a plain-language explanation generated from the trace by template: rule name, base volume, rate, rank used, period, rounding. No other person's personal data appears. |
| Business justification | A distributor can trust or dispute a line with facts. |
| Traces to (research) | GAP-027, F-12 |
| User role | Distributor |
| Preconditions | Trace exists. |
| Trigger | Distributor taps a line. |
| Inputs | Line id. |
| Processing logic | Template per rule type filled from the compact trace; downline sources shown as counts and aggregates per the visibility policy. |
| Expected outputs | Explanation. |
| Business rules | BR-PAY-06, BR-DAT-03 |
| Validation rules | Explanation amount equals line amount. |
| Error scenarios | Template missing for an extension rule (generic explanation with inputs listed; flagged to implementation). |
| Permissions | Self only. |
| Dependencies | FR-COMP-007, FR-GEN-006 |
| User stories | US-12 |
| Acceptance criteria | AC-12.1 |
| Screens / APIs / Entities | SC-18 / API-29 / `result_line` |

#### FR-DIST-003 — Rank status, factual

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Shows paid-as rank and titles for recent periods, the requirements of the current rank with the participant's measured values, and maintenance or grace status. It states facts only; it does not project income or show what could be earned. |
| Business justification | Rank ambiguity produces disputes; the honesty policy forbids projections. |
| Traces to (research) | GAP-025, GAP-003, CPL-14 |
| User role | Distributor |
| Preconditions | Qualification state exists. |
| Trigger | Distributor opens rank status. |
| Inputs | Position. |
| Processing logic | Read state and plan requirements; current open period values are labelled not final. |
| Expected outputs | Rank view. |
| Business rules | BR-HON-01, BR-RNK-05 |
| Validation rules | Values equal state rows for committed periods. |
| Error scenarios | Plan change in progress (transition notice). |
| Permissions | Self only. |
| Dependencies | FR-COMP-004 |
| User stories | US-51 |
| Acceptance criteria | AC-51.1 |
| Screens / APIs / Entities | SC-19 / API-28 / `qualification_state` |

#### FR-DIST-004 — Team view, privacy-limited

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A leader searches their own downline and sees only the fields the visibility policy allows; beyond the depth limit only aggregates. |
| Business justification | Leaders help their team without seeing private data. |
| Traces to (research) | GAP-012, F-06, F-07 |
| User role | Team leader |
| Preconditions | Policy configured. |
| Trigger | Leader opens Team. |
| Inputs | Search; node. |
| Processing logic | FR-GEN-006 enforcement; explains why data is limited. |
| Expected outputs | Team list and node view. |
| Business rules | BR-DAT-03 |
| Validation rules | Server-side filtering. |
| Error scenarios | Outside downline (not found). |
| Permissions | Self downline only. |
| Dependencies | FR-GEN-006, FR-GEN-007 |
| User stories | US-05 |
| Acceptance criteria | AC-05.1, AC-05.2 |
| Screens / APIs / Entities | SC-20 / API-34 / `path_node` |

#### FR-DIST-005 — My customers

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A distributor sees the customers they service with order recency and repeat-order indicator, and customers reassigned to or from them with dates. |
| Business justification | Customer-based metrics are the defensible measure of productive activity. |
| Traces to (research) | GAP-040, GAP-050 |
| User role | Distributor |
| Preconditions | Servicing relationships exist. |
| Trigger | Distributor opens My customers. |
| Inputs | Filters. |
| Processing logic | Read servicing rows and attributed orders; contact fields per tenant policy. |
| Expected outputs | Customer list. |
| Business rules | BR-ATT-01 |
| Validation rules | Only current and past own servicing rows. |
| Error scenarios | None specific. |
| Permissions | Self only. |
| Dependencies | FR-CRM-001 |
| User stories | US-52 |
| Acceptance criteria | AC-52.1 |
| Screens / APIs / Entities | SC-21 / API-28 / `customer_servicing`, `order` |

#### FR-DIST-006 — Bank details and tax profile self-service

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | The distributor views masked bank details and tax profile, submits changes with re-authentication, and sees cooling-off status and affected payouts. |
| Business justification | Self-service reduces support load while keeping change controls. |
| Traces to (research) | GAP-035, GAP-031 |
| User role | Distributor |
| Preconditions | Signed in. |
| Trigger | Distributor opens Payment details. |
| Inputs | New details. |
| Processing logic | FR-PAY-005 and FR-TAX-001. |
| Expected outputs | Pending version; notices. |
| Business rules | BR-PAY-08 |
| Validation rules | As FR-PAY-005. |
| Error scenarios | As FR-PAY-005. |
| Permissions | Self only. |
| Dependencies | FR-PAY-005, FR-TAX-001 |
| User stories | US-17 |
| Acceptance criteria | AC-17.1, AC-17.2 |
| Screens / APIs / Entities | SC-22 / API-27 / `bank_detail_version`, `tax_profile` |

#### FR-DIST-007 — Localisation and low-bandwidth delivery

| Field | Content |
|---|---|
| Release / priority | MVP-B (market pack) / Must |
| Description | Distributor pages and statements are available in the launch market's languages, with locale-aware numbers and dates, server-rendered small payloads and readable type sizes. |
| Business justification | The user base is multilingual with a large share aged 55 and over; statement comprehension depends on language. |
| Traces to (research) | GAP-051 |
| User role | Distributor |
| Preconditions | Translations complete for the market pack languages. |
| Trigger | Locale selection or browser preference. |
| Inputs | Locale. |
| Processing logic | Message catalogues; no text in images; statement core readable without client-side scripts where possible. |
| Expected outputs | Localised pages. |
| Business rules | BR-LOC-01 |
| Validation rules | No untranslated key in release. |
| Error scenarios | Missing translation falls back to market default language and is logged. |
| Permissions | All portal users. |
| Dependencies | FR-DIST-001 |
| User stories | US-34 |
| Acceptance criteria | AC-34.1 |
| Screens / APIs / Entities | SC-18, SC-37 / API-28 / `notification` |

#### FR-DIST-008 — Notifications

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Transactional notifications by email and, where the tenant configures a provider, SMS or messaging: statement ready, payout sent or returned, bank details changed, dispute update, plan-change notice, credit expiry. In-app inbox mirrors them. |
| Business justification | Security notices and plan-change notices are required by other rules. |
| Traces to (research) | GAP-035, GAP-097 |
| User role | Distributor |
| Preconditions | Verified contact. |
| Trigger | Domain event. |
| Inputs | Template; recipient; locale. |
| Processing logic | Outbox-driven; per-channel preferences except mandatory security notices; delivery status stored. |
| Expected outputs | Notification records. |
| Business rules | BR-PAY-08, BR-PLN-04 |
| Validation rules | Template exists in recipient locale or default. |
| Error scenarios | Delivery failure (retry; fallback channel for security notices). |
| Permissions | System. |
| Dependencies | FR-INT-001 |
| User stories | US-17 |
| Acceptance criteria | AC-17.1, AC-17.2 |
| Screens / APIs / Entities | SC-38 / API-28 / `notification`, `outbox_event` |

#### FR-DIST-009 — Leader dashboard on customers served

| Field | Content |
|---|---|
| Release / priority | V1 / Could |
| Description | Leaders see customers served, repeat-order rate, returns and time to first customer for their team within visibility limits. No recruit leaderboards. |
| Business justification | Productivity defined by retail customers, not recruits; unvalidated need. |
| Traces to (research) | GAP-050, F-39 |
| User role | Team leader |
| Preconditions | Attribution data. |
| Trigger | Leader opens dashboard. |
| Inputs | Period. |
| Processing logic | Aggregates from attributed orders. |
| Expected outputs | Dashboard. |
| Business rules | BR-HON-01 |
| Validation rules | Aggregates only beyond depth limit. |
| Error scenarios | None specific. |
| Permissions | Self downline. |
| Dependencies | FR-DIST-004 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-20 / API-34 / `order` |

### 3.16 Privacy (FR-PRV)

#### FR-PRV-001 — Data-subject requests

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Access, correction, erasure and portability requests are logged, identity-verified, fulfilled within the market deadline and closed with the legal basis for anything retained. |
| Business justification | The platform is a processor with direct duties in some markets. |
| Traces to (research) | GAP-085, F-33, PRV-04, FL-12 |
| User role | DPO; Distributor |
| Preconditions | Request received through the portal, public form or tenant staff. |
| Trigger | Request. |
| Inputs | Subject; type; verification evidence. |
| Processing logic | Privacy case with deadline; access export assembled from personal-data map; erasure per FR-PRV-002. |
| Expected outputs | Fulfilment record; export file. |
| Business rules | BR-DAT-06 |
| Validation rules | Identity verified. |
| Error scenarios | Verification failed; deadline approaching (escalation). |
| Permissions | DPO. |
| Dependencies | FR-CAS-001 |
| User stories | US-30 |
| Acceptance criteria | AC-30.1 |
| Screens / APIs / Entities | SC-15, SC-41 / API-31 / `privacy_request`, `case` |

#### FR-PRV-002 — Erasure by pseudonymisation

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Where ledger and tax retention applies, erasure replaces identity fields with a pseudonym and deletes sensitive documents; postings, result lines and relationships are retained. |
| Business justification | Ledger integrity and retention law versus erasure rights. |
| Traces to (research) | GAP-085, ADR-13 |
| User role | DPO |
| Preconditions | Approved erasure request. |
| Trigger | Fulfilment. |
| Inputs | Participant. |
| Processing logic | Irreversible replacement of identity fields; key destruction for the sensitive store entries; audit of the operation. |
| Expected outputs | Pseudonymised participant. |
| Business rules | BR-DAT-06 |
| Validation rules | No identity field remains in primary or read models; backups age out per retention. |
| Error scenarios | Open payable balance or legal hold (erasure deferred with explanation). |
| Permissions | DPO with second approver. |
| Dependencies | FR-PRV-001 |
| User stories | US-30 |
| Acceptance criteria | AC-30.1 |
| Screens / APIs / Entities | SC-15 / API-31 / `participant`, `privacy_request` |

#### FR-PRV-003 — Retention timers

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | Retention period per data class and market; deletion jobs with logs. |
| Business justification | Mandatory in some markets from stated dates. |
| Traces to (research) | GAP-085, PRV-05 |
| User role | DPO |
| Preconditions | Retention schedule approved. |
| Trigger | Timer. |
| Inputs | Class; period. |
| Processing logic | Scheduled jobs; legal holds respected. |
| Expected outputs | Deletion log. |
| Business rules | BR-DAT-11 |
| Validation rules | Schedule exists. |
| Error scenarios | Hold present. |
| Permissions | DPO. |
| Dependencies | FR-PRV-002 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-15 / API-31 / `privacy_request` |

#### FR-PRV-004 — Breach-notification contacts and runbook data

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Per tenant and market the platform stores breach contacts and notification timelines, and can produce the list of affected data subjects and data classes for a given scope. |
| Business justification | Processor duty to notify tenants without delay with the facts they need. |
| Traces to (research) | GAP-085, PRV-02 |
| User role | DPO; Vendor ops |
| Preconditions | Tenant provisioned. |
| Trigger | Tenant onboarding; incident. |
| Inputs | Contacts; timelines. |
| Processing logic | Stored in settings; incident tooling queries audit and data maps. |
| Expected outputs | Contact record; affected-subject report. |
| Business rules | BR-DAT-07 |
| Validation rules | At least one contact per tenant. |
| Error scenarios | Missing contact blocks go-live. |
| Permissions | Tenant admin edits; Vendor ops reads. |
| Dependencies | FR-TEN-001 |
| User stories | US-53 |
| Acceptance criteria | AC-53.1 |
| Screens / APIs / Entities | SC-29 / API-39 / `tenant_setting_version` |

### 3.17 Audit (FR-AUD)

#### FR-AUD-001 — Immutable audit log

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Every security-relevant and money-relevant action writes an audit event (actor, action, object, before and after references, tenant, time, request id) to an append-only store separate from the application tables. |
| Business justification | Investigation and attestation evidence from day one. |
| Traces to (research) | GAP-065, SEC-09, ENT-24 |
| User role | Tenant admin; Compliance officer |
| Preconditions | None. |
| Trigger | Any audited action. |
| Inputs | Event. |
| Processing logic | Written in the same transaction through the outbox to the audit store; hash-chained per tenant; searchable by actor, object and time. |
| Expected outputs | Audit event. |
| Business rules | BR-SEC-07 |
| Validation rules | Chain verification job passes. |
| Error scenarios | Audit store unavailable (events buffered in outbox; money actions blocked if the buffer exceeds a limit). |
| Permissions | Read: Tenant admin, Compliance officer; vendor reads only inside a support session. |
| Dependencies | — |
| User stories | US-54 |
| Acceptance criteria | AC-54.1, AC-54.2 |
| Screens / APIs / Entities | SC-30 / API-09 / `audit_event`, `outbox_event` |

#### FR-AUD-002 — Export limits and logging

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | Exports of rows containing personal data are limited in size per role, respect visibility rules, and are logged with who, what filter and how many rows. |
| Business justification | Mass extraction is a breach path. |
| Traces to (research) | GAP-065, SEC-08, SEC-10 |
| User role | All staff roles |
| Preconditions | User has export permission. |
| Trigger | Export. |
| Inputs | View; filters. |
| Processing logic | Row cap per role; asynchronous for large exports; watermark with requester id. |
| Expected outputs | Export file; audit event. |
| Business rules | BR-SEC-03 |
| Validation rules | Within cap. |
| Error scenarios | Above cap (refused with path to request a scheduled export). |
| Permissions | By role. |
| Dependencies | FR-AUD-001 |
| User stories | US-54 |
| Acceptance criteria | AC-54.1, AC-54.2 |
| Screens / APIs / Entities | SC-30, SC-26 / API-06 / `export_job`, `audit_event` |

### 3.18 Integration (FR-INT)

#### FR-INT-001 — Public API and webhooks

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Versioned REST API under /v1 with OpenAPI description, idempotency keys on writes, cursor pagination, per-key rate limits, and signed outbound webhooks with retries for domain events. |
| Business justification | The product is API-first behind any commerce front end. |
| Traces to (research) | GAP-045, GAP-060 |
| User role | Integration developer |
| Preconditions | API key. |
| Trigger | Client call; domain event. |
| Inputs | Requests. |
| Processing logic | Standards in the TRD API requirements. |
| Expected outputs | Responses; webhook deliveries. |
| Business rules | BR-SEC-03 |
| Validation rules | Schema validation. |
| Error scenarios | Standard error envelope. |
| Permissions | Scopes. |
| Dependencies | FR-IAM-006 |
| User stories | US-22 |
| Acceptance criteria | AC-22.1, AC-22.2, AC-22.3 |
| Screens / APIs / Entities | SC-13 / API-10, API-33 / `api_key`, `webhook_endpoint`, `webhook_delivery` |

#### FR-INT-002 — Integration and sync health

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | For each connector and provider: last successful sync, lag, error counts, reconciliation differences; runs are blocked when order sync is behind the cut-off. |
| Business justification | A run on partial data pays wrongly. |
| Traces to (research) | GAP-060, B1 |
| User role | Tenant admin; Commission analyst |
| Preconditions | Connectors installed. |
| Trigger | Continuous; viewed on demand. |
| Inputs | Heartbeats; reconciliation results. |
| Processing logic | Health states Healthy, Behind, Failing with thresholds; alerts. |
| Expected outputs | Health view; block signal. |
| Business rules | BR-ORD-05 |
| Validation rules | Heartbeat fresh. |
| Error scenarios | Connector credentials expired (Failing; guidance). |
| Permissions | Tenant admin; analyst read. |
| Dependencies | FR-ORD-002 |
| User stories | US-55 |
| Acceptance criteria | AC-55.1 |
| Screens / APIs / Entities | SC-13, SC-01 / API-37 / `provider_config`, `inbound_event` |

#### FR-INT-003 — Scheduled export of the full tenant data model

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | A documented, versioned export of the tenant's complete data (genealogy history, orders, runs, lines, traces, ledger, cases) in open formats on a schedule to the tenant's storage, with row counts that reconcile. |
| Business justification | Analysts will not adopt a platform that hides their data; exit rights lower switching risk. |
| Traces to (research) | GAP-062, GAP-096, F-30 |
| User role | Analyst; Tenant admin |
| Preconditions | Destination configured in the tenant's region. |
| Trigger | Schedule or manual. |
| Inputs | Scope; destination. |
| Processing logic | Snapshot-consistent export from the replica; manifest with counts and checksums. |
| Expected outputs | Files; manifest. |
| Business rules | BR-DAT-12 |
| Validation rules | Counts equal source counts at snapshot. |
| Error scenarios | Destination unreachable (retry; alert). |
| Permissions | Tenant admin. |
| Dependencies | FR-AUD-002 |
| User stories | US-32 |
| Acceptance criteria | AC-32.1 |
| Screens / APIs / Entities | SC-13 / API-32 / `export_job` |

#### FR-INT-004 — Read-only analytical replica for dedicated tenants

| Field | Content |
|---|---|
| Release / priority | V1 / Should |
| Description | Dedicated-database tenants get read-only SQL access to a replica schema of their own data. |
| Business justification | Buyer expectation set by incumbents; never on shared schema or primary. |
| Traces to (research) | GAP-062, F-31 |
| User role | Analyst |
| Preconditions | Dedicated tier. |
| Trigger | Tenant request. |
| Inputs | Network allow-list. |
| Processing logic | Replica with documented views; credentials per user; query limits. |
| Expected outputs | Access. |
| Business rules | BR-DAT-12 |
| Validation rules | Tier dedicated. |
| Error scenarios | Pooled tenant (not available). |
| Permissions | Tenant admin grants. |
| Dependencies | FR-TEN-001 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-13 / API-32 / `tenant` |

### 3.19 Reporting (FR-RPT)

#### FR-RPT-001 — Role dashboards

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Executive overview (sales, active earners, payout as share of sales, retail share, market view), finance dashboard (payables, in transit, receivables, withholding, failed payouts), analyst home (periods and runs), compliance overview (report figures, guardrail warnings, open cases). Each figure has a stated definition. |
| Business justification | Different roles need different homes; owners rely on staff for numbers today. |
| Traces to (research) | GAP-055, GAP-050 |
| User role | Executive; Finance manager; Compliance officer |
| Preconditions | Data exists. |
| Trigger | User opens home. |
| Inputs | Period; market. |
| Processing logic | Read models refreshed on commit and on ingestion; definitions in the reporting catalogue. |
| Expected outputs | Dashboards. |
| Business rules | BR-CPL-01 |
| Validation rules | Figures reconcile with committed runs and ledger. |
| Error scenarios | Partial data banner when sync is behind. |
| Permissions | By role and market scope. |
| Dependencies | FR-COMP-006, FR-CPL-006 |
| User stories | US-56 |
| Acceptance criteria | AC-56.1 |
| Screens / APIs / Entities | SC-35, SC-46, SC-01 / API-05, API-19 / `compliance_report_snapshot`, `run` |

#### FR-RPT-002 — Operational lists with saved views

| Field | Content |
|---|---|
| Release / priority | MVP-B / Should |
| Description | Every large table supports server-side filtering, sorting, column choice, saved views per user and export within limits. |
| Business justification | Reviews of incumbents cite cumbersome reporting. |
| Traces to (research) | GAP-055, GAP-062 |
| User role | Commission analyst; Support agent |
| Preconditions | None. |
| Trigger | User saves a view. |
| Inputs | Filters; columns. |
| Processing logic | Stored per user; shareable within role. |
| Expected outputs | Saved view. |
| Business rules | BR-SEC-03 |
| Validation rules | Columns permitted for role. |
| Error scenarios | None specific. |
| Permissions | By role. |
| Dependencies | FR-AUD-002 |
| User stories | US-56 |
| Acceptance criteria | AC-56.1 |
| Screens / APIs / Entities | SC-31, SC-33, SC-36 / API-23 / `user_account` |

### 3.20 Migration (FR-MIG)

#### FR-MIG-001 — History import

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | Import of genealogy history, positions, rank and title history, carry balances, counters, open balances and bank and tax profiles from a legacy system through a mapping workspace with validation reports. |
| Business justification | Switching cost is the barrier every entrant must lower. |
| Traces to (research) | GAP-077, F-29, FL-13 |
| User role | Implementation consultant |
| Preconditions | Tenant in implementation state. |
| Trigger | Consultant uploads legacy extracts. |
| Inputs | Files; mappings. |
| Processing logic | Staged load; validation (cycles, orphans, totals); opening qualification state and opening ledger entry posted with approval. |
| Expected outputs | Imported data; validation report. |
| Business rules | BR-MIG-01 |
| Validation rules | Opening ledger balances equal legacy balances by payee. |
| Error scenarios | Cycles or orphans (listed; load blocked). |
| Permissions | Implementation consultant; opening entry approved by tenant Finance approver. |
| Dependencies | FR-GEN-002, FR-COMP-004, FR-FIN-001 |
| User stories | US-28 |
| Acceptance criteria | AC-28.1, AC-28.2 |
| Screens / APIs / Entities | SC-16 / API-38 / `import_batch`, `relationship`, `qualification_state`, `journal_entry` |

#### FR-MIG-002 — Parallel-run reconciliation

| Field | Content |
|---|---|
| Release / priority | MVP-B / Must |
| Description | For at least one full period the new platform's results are compared per payee and per bonus with the legacy system's payouts; go-live requires differences of zero or each difference explained and approved. |
| Business justification | Proof that the new system pays the same is the switching lever and the go-live safety. |
| Traces to (research) | GAP-077, GAP-026, F-29 |
| User role | Implementation consultant; Finance approver |
| Preconditions | History imported; legacy payout file for the period. |
| Trigger | Consultant starts a comparison. |
| Inputs | Period; legacy file. |
| Processing logic | Simulation-harness run; diff report; each difference classified (rule, data, rounding) and resolved or accepted with approver. |
| Expected outputs | Difference report; go-live checklist item. |
| Business rules | BR-MIG-02 |
| Validation rules | Unexplained differences equal zero for sign-off. |
| Error scenarios | Legacy file lacks bonus detail (payee-level comparison only, flagged). |
| Permissions | Implementation consultant; Finance approver signs off. |
| Dependencies | FR-PLN-005 |
| User stories | US-28 |
| Acceptance criteria | AC-28.1, AC-28.2 |
| Screens / APIs / Entities | SC-16 / API-38 / `simulation`, `approval` |

### 3.21 Vendor operations (FR-OPS)

#### FR-OPS-001 — Vendor operations console

| Field | Content |
|---|---|
| Release / priority | MVP-A / Must |
| Description | A separate application area for vendor staff: tenant list with region, tier and health; provisioning; support-session requests; market-pack maintenance. It shows no tenant business data outside an approved session. |
| Business justification | Vendor staff are a distinct, high-risk role. |
| Traces to (research) | GAP-065, IC-13 |
| User role | Vendor ops |
| Preconditions | Vendor staff account with MFA. |
| Trigger | Vendor user signs in. |
| Inputs | None. |
| Processing logic | Separate identity realm; all actions audited to a vendor audit log and, for tenant-affecting actions, to the tenant's log. |
| Expected outputs | Console views. |
| Business rules | BR-SEC-01 |
| Validation rules | No tenant data without session. |
| Error scenarios | Attempt to open tenant data without session (blocked, logged). |
| Permissions | Vendor ops roles. |
| Dependencies | FR-IAM-005 |
| User stories | US-57 |
| Acceptance criteria | AC-57.1 |
| Screens / APIs / Entities | SC-39 / API-08 / `tenant`, `support_session` |

### 3.22 AI assistance (FR-AI)

#### FR-AI-001 — Run variance explainer

| Field | Content |
|---|---|
| Release / priority | V1 / Could |
| Description | A summary of the deterministic run diff in plain language, citing the lines and inputs it summarises. |
| Business justification | Analysts trace variances by hand; only after deterministic diff reports exist. |
| Traces to (research) | GAP-070, F-42 |
| User role | Commission analyst |
| Preconditions | Run review dataset. |
| Trigger | Analyst requests a summary. |
| Inputs | Diff dataset. |
| Processing logic | Model receives only the diff; output must cite line ids; never writes to plans or ledger. |
| Expected outputs | Summary with citations. |
| Business rules | BR-AI-01 |
| Validation rules | Every figure in the summary matches a cited value. |
| Error scenarios | Citation check fails (summary discarded). |
| Permissions | Commission analyst. |
| Dependencies | FR-COMP-005 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-02 / API-19 / `run` |

#### FR-AI-002 — Plan-document-to-configuration assistant (internal)

| Field | Content |
|---|---|
| Release / priority | V1 / Could |
| Description | For implementation staff: drafts plan rules and golden cases from a plan document; every rule is confirmed by a person and by golden tests. |
| Business justification | Implementation cost decides margins; untested idea. |
| Traces to (research) | GAP-071, F-41 |
| User role | Implementation consultant |
| Preconditions | Plan document; primitive library. |
| Trigger | Consultant uploads a plan. |
| Inputs | Document. |
| Processing logic | Draft only; human sign-off; simulation required. |
| Expected outputs | Draft rules; draft golden cases. |
| Business rules | BR-AI-01 |
| Validation rules | No draft can be activated without FR-PLN-006 passing. |
| Error scenarios | Unsupported mechanism (listed for extension). |
| Permissions | Implementation consultant. |
| Dependencies | FR-PLN-002, FR-PLN-006 |
| User stories | — |
| Acceptance criteria | **None yet** (listed in traceability gaps) |
| Screens / APIs / Entities | SC-04 / API-16 / `plan_rule` |

### 3.23 Editions and licensing (FR-LIC)

#### FR-LIC-001 — Licence entitlement for the self-hosted edition

| Field | Content |
|---|---|
| Release / priority | V1 / Must |
| Description | A self-hosted installation runs under a signed licence file stating licensee, edition, enabled modules, payee band, market packs, support and update entitlement and expiry. The application verifies the signature offline at start and daily. It never stops calculating or paying because a licence lapsed: on expiry it keeps running, shows a notice to administrators, and stops accepting new engine versions and market-pack updates. |
| Business justification | Founder decision DEC-17: the product is sold both as hosted SaaS and as a licensed self-hosted edition. A lapse must never cause wrong or missed pay. |
| Traces to (research) | DEC-17, GAP-075, GAP-096 |
| User role | Tenant admin (licensee); Vendor ops |
| Preconditions | Licence issued by the vendor for the installation id. |
| Trigger | Installation, start-up, daily check, licence renewal. |
| Inputs | Licence file; installation id. |
| Processing logic | Verify signature with the embedded public key; compare installation id and limits; compute entitlement; expose state Active, Grace, Lapsed; write audit events; no network call is required. |
| Expected outputs | Entitlement state; administrator notice; audit event. |
| Business rules | BR-LIC-01, BR-LIC-02, BR-LIC-05 |
| Validation rules | Signature valid; installation id matches; clock rollback detected by monotonic checkpoint. |
| Error scenarios | Invalid signature (application starts in read-only mode with export enabled); payee band exceeded (notice and report only; no blocking of runs). |
| Permissions | Tenant admin installs a licence; nobody can edit entitlement. |
| Dependencies | FR-AUD-001 |
| User stories | US-58 |
| Acceptance criteria | AC-58.1, AC-58.2, AC-58.3, AC-58.4 |
| Screens / APIs / Entities | SC-47 / API-41 / `license_entitlement` |

#### FR-LIC-002 — Signed updates and market-pack distribution

| Field | Content |
|---|---|
| Release / priority | V1 / Must |
| Description | Application releases, engine versions and market packs for self-hosted installations are delivered as signed packages that the licensee applies deliberately. Each package states its version, compatibility, migrations and, for market packs, the basis status of every rule. An installation shows how far it is behind and which known defects affect the version it runs. |
| Business justification | An unpatched self-hosted engine or an out-of-date tax rule pays people wrongly; the vendor cannot fix it remotely. |
| Traces to (research) | DEC-17, GAP-031, GAP-102 |
| User role | Tenant admin (licensee) |
| Preconditions | Active update entitlement. |
| Trigger | Licensee downloads a package or the installation checks the update feed (optional, outbound only). |
| Inputs | Signed package. |
| Processing logic | Verify signature and compatibility; run golden datasets and a replay sample against the new engine before it can be activated; apply migrations; committed runs keep their pinned engine version; market-pack changes take effect from their effective dates only. |
| Expected outputs | Installed version; update log; advisories list. |
| Business rules | BR-LIC-03, BR-CPL-03 |
| Validation rules | Package signed by the vendor; target version reachable from current version. |
| Error scenarios | Golden or replay check fails (update not activated, report produced); migration fails (automatic rollback to the pre-update snapshot). |
| Permissions | Tenant admin with second approver for engine and market-pack updates. |
| Dependencies | FR-PLN-006, FR-COMP-008, FR-LIC-001 |
| User stories | US-58 |
| Acceptance criteria | AC-58.1, AC-58.2, AC-58.3, AC-58.4 |
| Screens / APIs / Entities | SC-47 / API-41 / `license_entitlement`, `update_log` |

#### FR-LIC-003 — Self-hosted installation, diagnostics and support bundle

| Field | Content |
|---|---|
| Release / priority | V1 / Must |
| Description | The self-hosted edition installs as a single-tenant deployment from a documented package (containers with a reference configuration), with a preflight check, health diagnostics, backup and restore tooling and a support bundle that contains configuration and logs but no personal data, bank details or secrets. Vendor support works only through licensee-approved sessions or on the bundle. |
| Business justification | The licensee operates the system; the vendor has no access by default. |
| Traces to (research) | DEC-17, GAP-065, GAP-060 |
| User role | Tenant admin (licensee); Vendor ops |
| Preconditions | Infrastructure meets the published minimum. |
| Trigger | Installation, upgrade, incident. |
| Inputs | Configuration; infrastructure endpoints (database, object storage, identity provider, mail). |
| Processing logic | Preflight verifies versions, extensions, encryption settings, time sync and backup target; diagnostics page shows job queues, outbox age, replication, last backup and restore-test date; support bundle generator redacts by allow-list. |
| Expected outputs | Running installation; diagnostics; support bundle. |
| Business rules | BR-SEC-01, BR-LIC-04 |
| Validation rules | Bundle passes the redaction test before it can be exported. |
| Error scenarios | Preflight failure (installation refuses to proceed with the list); backup target unreachable (alert; runs can be blocked by setting). |
| Permissions | Tenant admin. |
| Dependencies | FR-LIC-001 |
| User stories | US-58 |
| Acceptance criteria | AC-58.1, AC-58.2, AC-58.3, AC-58.4 |
| Screens / APIs / Entities | SC-47 / API-41 / `license_entitlement`, `update_log` |
