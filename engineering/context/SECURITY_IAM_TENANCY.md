# SECURITY, IAM AND TENANCY — Implementation Brief

Domain: SECURITY_IAM_TENANCY
Primary sources: `04-system-design/10_SECURITY_ARCHITECTURE.md` (SDD-10 v0.1), `03-trd/04_SECURITY_REQUIREMENTS.md` (TRD-04 v0.1).
Cross-checked against: `09-governance/traceability-data/spec.json` (FR/BR/US/AC/TS/SC/API/ENT), `02-prd/03_NON_FUNCTIONAL_REQUIREMENTS.md` (NFR-SEC-*), `04-system-design/04_DATABASE_DESIGN.md` §1, `04-system-design/06_API_DESIGN.md`, `03-trd/03_API_REQUIREMENTS.md`, ADR list, `03-trd/02_TECH_STACK_EVALUATION.md`.
Status of all sources: Draft, not approved; threat model never independently reviewed (FD-07).

Release tags: **A** = MVP-A (compliance overlay, first design partner), **B** = MVP-B (full commission engine), **B-MKT** = market-pack-dependent B, **V1** = later. "A/B" = partly in each (split stated where known).

Requirement classes (TRD-04): **M** mandatory by law in a named market · **K** contractual (provider terms) · **R** recommended practice / buyer expectation · **D** design rule.

---

## 1. Assets and attacker goals (SDD-10 §1)

Platform never holds funds. Targets:
- payout instructions, bank details, plan rules, manual adjustments
- personal data of very large distributor populations
- cross-tenant access ("many companies at once")

## 2. Trust boundaries (SDD-10 §2)

| Boundary | Components | Notes |
|---|---|---|
| Untrusted | staff browsers, distributor phones, integration clients, provider webhooks, public forms | |
| Edge | TLS, WAF, rate limits, bot protection | everything enters here, incl. commerce webhooks |
| Application (per cell = one region) | API (authn, tenant resolver, schema validation) → Policy (RBAC + ABAC, SoD) → Modules → Workers | API layer contains no business logic |
| Data (DB-enforced) | RLS per tenant; insert-only financial tables; tenant data | |
| Sensitive | KMS per-tenant keys; sensitive store; secrets manager (provider credentials, signing keys) | workers read secrets manager |
| Audit store | append-only, **separate credentials** | |
| Vendor | Vendor console (separate realm) → API **only via approved support session**; break-glass prod access (second approval, recorded) | |
| Third parties | payout providers, commerce, tenant SSO (IdP) | |

## 3. Identity realms and authentication

### 3.1 Realms (SEC-21, rel A; ADR-19 Proposed)

| Realm | `user_account.realm` value | Users | Token audience | Release |
|---|---|---|---|---|
| Tenant staff | `tenant` | tenant employees | Staff API | A |
| Distributors | `portal` | distributors (participants with can-earn flag) | Portal API `/v1/me/...` | B (FR-IAM-007) |
| Vendor staff | `vendor` | our employees; `tenant_id` NULL | Vendor API / console | A |

- A credential from one realm is **never** valid in another (SEC-21).
- IdP: self-hosted OIDC provider (Keycloak-class) **per cell**, three realms (ADR-19, TRD-02 recommendation). Managed IdP acceptable only for staff realm; ruled out for distributors on cost. Must be self-hostable (self-hosted edition, K9).
- Self-hosted edition (V1): licensee operates IdP (SDD-10 §8).

### 3.2 Credentials per caller type (TR-API-03; SDD-06 §1)

| Caller | Auth mechanism | Tenant resolution |
|---|---|---|
| Staff web app | OIDC access token (staff realm), short-lived | sign-in hostname (`tenant.slug`) → bound in token |
| Distributor portal | OIDC access token (portal realm) | bound in token; session scoped to participant + owned positions |
| Integrations | API key in `Authorization: Bearer`, hashed at rest; tied to service account | key bound to one tenant |
| Provider webhooks (API-26) | provider signature + timestamp; dedupe by provider event id | endpoint path secret + provider account; no tenant token |
| Vendor console | OIDC token (vendor realm) + approved support session for any tenant data | from support session |
| Public (privacy form SC-41, disclosure page V1) | none; strict rate limits + bot protection | n/a; returns only confirmation |

### 3.3 Session contents (FR-IAM-001, rel A)

Every human session carries: **tenant id, user id, roles, assurance level** (vendor console: no tenant id until a support session). No request served without it.
- Tenant id is taken from the authenticated session only; never from client input (BR-SEC-04, SEC-01). No handler accepts a tenant id parameter (SDD-10 §4 layer 2).
- Issued: short-lived access token + rotating refresh token bound to the tenant.
- Additional context that must be derivable per request: role assignments with `market_ids[]`, `brand_ids[]` scope; last factor-verification time (for step-up); device binding for approvers (SEC-36, B); `support_session_id` for vendor calls; for portal: `participant_id` and owned positions.
- Audit event on sign-in: `AUTH.SIGN_IN`.

Sign-in flow (FR-IAM-001 logic): verify credential at IdP → resolve tenant from hostname → issue tokens → audit.
- Validation: account not locked; tenant active; clock skew within tolerance.
- Errors: wrong credential → generic message + counter; locked account; tenant archived → read-only notice; IdP unavailable → retry page.
- Endpoint: API-07 `POST /v1/auth/sessions` (sub-resources: sign-in, MFA verification, step-up, refresh, sign-out). Auth: Public, rate limited per IP and per account. Rel A. Screen SC-27 (A).

### 3.4 Session management (SEC-34, SEC-35, SEC-36; NFR-SEC-04)

| ID | Rule | Rel |
|---|---|---|
| SEC-34 | Short-lived access tokens; rotating refresh tokens with **reuse detection**; absolute + idle limits; server-side revocation on role change, password change, deactivation | A |
| NFR-SEC-04 (Proposed) | Admin session: **12 h absolute, 30 min idle**; step-up factor **≤ 10 min old** | A |
| SEC-35 | Cookies `Secure`, `HttpOnly`, `SameSite`; CSRF protection on cookie-authenticated writes; strict CSP | A |
| SEC-36 | Approver sessions bound to device that passed MFA; new device forces MFA | B |

Not specified anywhere: access-token TTL, refresh-token TTL, distributor (portal) session limits, non-admin staff limits. See Open.

### 3.5 Passwords and lockout (SEC-23, rel A; AC-35.2)

- Breached-password list check; length-based policy; slow hash; lockout with generic messages; rate limits per account and per IP.
- AC-35.2: **5 failed sign-ins inside the lockout window → 6th attempt: account temporarily locked**; response does not reveal whether the account exists. Window length and lock duration: unspecified.
- Unknown identifier on portal: generic response (FR-IAM-007).

### 3.6 MFA and assurance levels

**SEC-03 (R, rel A):** MFA (TOTP or WebAuthn) mandatory for:
- tenant admins
- payout preparers and approvers
- plan approvers
- compliance officers
- DPO
- all vendor staff

Optional for other staff and distributors. NFR-SEC-02: 100% coverage of privileged roles and vendor staff.

Implementation:
- `role.mfa_required boolean` flags roles; user with any MFA-required role and `user_account.mfa_enrolled = false` → forced enrolment; **cannot reach any page** until enrolled (AC-35.1, TS-35).
- Privileged session assurance level = **AAL2** (FR-IAM-002 output). Only AAL levels named in sources: AAL2 ("User session AAL2 fresh" on API-20, API-25 approve; "AAL2" on API-41).
- Invalid code: limited retries. Code must be unused.
- Lost device: admin-assisted reset is a logged case requiring **Tenant admin + second approver** (FR-IAM-002).
- Self-service enrolment.
- Tenant SSO federation (OIDC/SAML) — SEC-22, rel **B**; MFA assurance must be asserted by the IdP or enforced by us.

### 3.7 Step-up (SEC-20, D, rel A/B; FR-IAM-002)

Actions requiring a factor verified within the step-up window (≤ 10 min, NFR-SEC-04):

| Action | Rel of action | Endpoint |
|---|---|---|
| Approve role grant (admin/approver) | A | API-40 |
| Unmask sensitive field | B (sensitive store SEC-07 is B) | participant record SC-09 |
| Commit run | B | API-20 (`User session AAL2 fresh`) |
| Approve payout batch | B | API-25 approve (`AAL2 fresh`) |
| Activate plan | B | API-16 |
| Approve adjustment or write-off | B | API-30 decision |
| Change bank details | B | API-27 (`Portal session (fresh) or case`) |

- Stale factor → `403` with code `STEP_UP_REQUIRED` (TR-API, SDD-06). UI shows second-factor prompt; action proceeds only after it passes (AC-07.2).
- Approval records store `factor_verified_at` and assurance level (FR-IAM-002, T18).

### 3.8 Distributor sign-in (FR-IAM-007, SEC-24, rel B)

- Email or phone one-time code, or password; optional second factor.
- Pre: participant has type flag can-earn and a verified contact.
- Portal session scoped to participant and positions they own; permission = self only.
- Bank-detail and tax-profile changes require fresh re-authentication (AC-17.2: without fresh re-auth → refused, no version created).
- Terminated participants keep read access to past statements for the retention period.

## 4. Authorisation

### 4.1 Pipeline (SDD-10 §5) — order is normative

1. Authenticate token / key → tenant + realm.
2. RBAC: permission in role? no → `403` or `404` (404 when existence is sensitive).
3. ABAC attribute checks:
   - A1 market / brand scope
   - A2 self or downline + depth
   - A3 actor ≠ preparer
   - A4 related party / new account
   - A5 support-session scope + region
4. Step-up needed and factor stale → `403 STEP_UP_REQUIRED`.
5. Field filter: visibility policy, masking.
6. Handler.
7. RLS backstop in DB.

Navigation: each dashboard/nav item tied to a permission; server returns the navigation model for the user's permissions and scopes; every data endpoint re-enforces.

### 4.2 RBAC (SEC-25, D, rel A; FR-IAM-003 rel A)

- Permissions granted only through roles. `role.permissions text[]` must exist in the **permission catalogue** (validated on save).
- Platform base roles (`role.tenant_id IS NULL`, `is_base = true`) can be cloned into tenant roles.
- Assignment scope: `role_assignment.market_ids[]`, `brand_ids[]`, `valid_from`, `valid_to`. AC-36.2: user scoped to market X requesting market Y data → API returns **no rows** for Y.
- Changes effective immediately on approval; all audited.
- Errors: conflicting duty pair (refused with explanation); sole remaining admin cannot remove own admin role.

IAM entities (spec.json, all rel A, tenant-scoped "Y"):

| Entity | Columns | Indexes / invariants / audit |
|---|---|---|
| `user_account` | `id uuid PK`, `tenant_id uuid FK tenant` (nullable), `realm text NN`, `idp_subject text NN`, `email text NN`, `display_name text`, `mfa_enrolled boolean NN`, `state text NN`, `participant_id uuid FK participant`, `last_sign_in_at timestamptz` | `(realm, idp_subject) UQ`; `(tenant_id, email) UQ`; `realm in (tenant, portal, vendor)`; vendor users have null `tenant_id`; sign-in, lock, role changes audited |
| `role` | `id uuid PK`, `tenant_id uuid FK tenant` (null = platform base role), `name text NN`, `permissions text[] NN`, `is_base boolean NN`, `mfa_required boolean NN` | `(tenant_id, name) UQ`; permissions must exist in the permission catalogue; changes audited |
| `role_assignment` | `id uuid PK`, `tenant_id uuid NN FK`, `user_id uuid NN FK user_account`, `role_id uuid NN FK role`, `market_ids uuid[]`, `brand_ids uuid[]`, `valid_from timestamptz NN`, `valid_to timestamptz`, `approval_id uuid FK approval` | index `(tenant_id, user_id)`; privileged roles require `approval_id`; grant and revoke audited; alert on new admin |
| `approval` | see §8.2 | `CHECK approver_id <> preparer_id`; `decision in (approved, rejected)`; immutable |

**Base roles (SEC-25):** Tenant admin, Commission analyst, Plan administrator, Finance approver, Payout officer, Compliance officer, Support agent, DPO, Implementation consultant, Executive read-only, Integration.
Plus non-tenant: Distributor (portal realm, self scope), Vendor ops roles (vendor realm; names not defined).

### 4.3 Permission catalogue (compiled; exact strings as they appear)

No single catalogue document exists. Strings below are verbatim from API (API-xx) and screen (SC-xx) specs. Two namespaces exist: **role permissions** (dot-separated) and **API-key scopes** (colon-separated).

Role permissions:

| Permission | Used by | Rel |
|---|---|---|
| `import.manage` | API-01, API-02, SC-24 | A |
| `mapping.edit` | API-03, SC-25 | A |
| `mapping.approve` | API-03, SC-25 | A |
| `snapshot.create` | API-04, SC-10 | A |
| `compliance.read` | API-05, API-06, SC-10, SC-26, SC-46, SC-45(V1) | A |
| `export` | API-06 (`?export=true`), SC-26, SC-33 | A |
| `vendor_access.decide` | API-08 decision, SC-14 | A |
| `audit.read` | API-09, SC-30 | A |
| `settings.manage` (+ "item-specific") | API-39, SC-29 | A (API) / B (SC-29) |
| `user.manage` | API-40, SC-28 | A |
| `participant.manage` | API-12 (user session) | B |
| `participant.read` | SC-09, SC-43 | B |
| `genealogy.read` | API-13 (staff), API-14, SC-07 | B |
| `case.genealogy.create` / `case.genealogy.approve` | API-15 (written "case.genealogy.create / approve"); SC-08 `case.genealogy.*` | B |
| `case.duplicate.*` | SC-08 | B |
| `case.<type>.read` / `case.<type>.act` | SC-06; API-30 "by case type" | B |
| `plan.read` | SC-04 | B |
| `plan.edit` | API-16, SC-04, SC-05 | B |
| `plan.approve` | API-16, SC-44 | B |
| `plan.simulate` | API-17, SC-42 | B |
| `period.read` | SC-01 | B |
| `run.execute` | API-18, SC-01 | B |
| `run.review` | API-19, SC-02 | B |
| `run.commit` | API-20, SC-02 ("not preparer", step-up) | B |
| `trace.read` | API-21 | B |
| `restatement.request` / `restatement.approve` | API-22 | B |
| `ledger.read` | API-23, SC-33 | B |
| `ledger.export` | API-24 | B |
| `payout.prepare` | API-25, SC-03 | B |
| `payout.approve` | API-25, SC-03 ("not preparer", step-up) | B |
| `payout.reconcile` | SC-34 | B |
| `privacy.manage` | API-31, SC-15 | B |
| `export.full` | API-32 | B |
| `servicing.manage` | API-35 | B |
| `tax.read` | SC-12 | B |
| `tax.forms` | API-36, SC-12 | B-MKT |
| `integration.read` | API-37 | B |
| `integration.manage` | SC-13 | B |
| `migration.manage` / `signoff` | API-38, SC-16 (written "migration.manage / signoff") | B |
| `market.manage` / `market.signoff` | SC-17 | B |
| `guardrail.read` / `override.approve` | SC-11 | B |
| `order.read` | SC-31 | B |
| `late.manage` | SC-32 | B |
| `dashboard.exec` | SC-35 | B |
| `disclosure.publish` | SC-23 | V1 |
| `system.manage` | API-41, SC-47 (self-hosted) | V1 |
| (unnamed) unmask permission | SC-09 "unmask needs extra permission" | B |

API-key scopes (FR-IAM-006, rel B): `orders:write` (API-10, API-11; AC-22.3: missing scope → 403, nothing stored), `participants:write` (API-12). Validation: scopes from catalogue; **no bulk personal-data scope without stated purpose**.

Pseudo-permissions (not catalogue entries): `self`, `self downline`, `public`, `vendor role(s)`, "case approval", "by role", "by case type".

### 4.4 Base role matrix (SDD-10 §5; full matrix = test fixture TS-36, rel A)

● = full; "read" etc. as stated. Column names as in SDD-10 (mapping to SEC-25 names: Analyst = Commission analyst; Plan admin = Plan administrator; Support = Support agent; Executive = Executive read-only). Implementation consultant and Integration have no column.

| Capability | Tenant admin | Analyst | Plan admin | Finance approver | Payout officer | Compliance officer | Support | DPO | Executive | Distributor |
|---|---|---|---|---|---|---|---|---|---|---|
| Users, roles, settings | ● (2nd admin for privileged) | — | — | approve money settings | — | — | — | — | — | — |
| Imports, mapping | ● | — | — | — | — | approve mapping | — | — | — | — |
| Compliance reports | read | read | read | read | — | ● | — | read | read | — |
| Plans: edit / approve / activate | — | read | edit | activate (2nd) | — | approve | — | — | — | — |
| Run: execute / commit | — | execute | — | commit | — | — | — | — | — | — |
| Payout: prepare / approve | — | — | — | approve | prepare | hold | — | — | — | — |
| Adjustments, restatements | — | propose | — | approve | — | request, review | — | — | — | — |
| Genealogy cases | — | read | — | — | — | approve | file | — | — | request own |
| Participant record | read | read | — | read | read | read | read (masked) | read | — | self |
| Unmask sensitive field | — | — | — | step-up, audited | step-up, audited | — | — | step-up, audited | — | self |
| Ledger, exports | — | read | — | ● | read | read | — | — | — | — |
| Privacy requests | — | — | — | — | — | — | — | ● | — | request own |
| Audit log | ● | — | — | — | — | ● | — | read | — | — |
| Vendor session decisions | ● | — | — | — | — | — | — | — | — | — |
| Statements | — | staff view | — | staff view | — | — | staff view (masked) | — | — | self |

Other role-bound rules from FRs:
- Tenant settings: Tenant admin; money-affecting keys need Finance approver (FR-TEN-003, B).
- Market go-live: Tenant admin prepares; Compliance officer signs off (FR-TEN-004, B).
- Visibility policy: edited by Tenant admin **with DPO approval** (FR-GEN-006, B).
- Bank details: payee self-service; Support agent **only through a case with evidence** (FR-PAY-005, B); staff changes by case with second person (SDD-10 T5).
- Manual adjustment: Commission analyst proposes; Finance approver approves (FR-CAS-002, B).
- Breach contacts: Tenant admin edits; Vendor ops reads (FR-PRV-004, A).
- API keys / service accounts: Tenant admin (FR-IAM-006, B).
- Tenant provisioning: Vendor ops with second-person approval (FR-TEN-001, A). Archive: Vendor ops with tenant confirmation (FR-TEN-005, V1).

### 4.5 Privileged grants (SEC-27, BR-SEC-05, rel A)

- Grant of an admin or approver role → opens an approval request; takes effect **only after a second admin approves**; both actions audited (AC-36.1). `role_assignment.approval_id` required for privileged roles.
- A user cannot grant a permission they lack.
- Alert on **every** new admin.
- Step-up on approve role grant (SEC-20).

### 4.6 ABAC attributes (SEC-26, D, rel A/B)

TRD-04 gives only "A/B" for SEC-26. The per-attribute split below is **inferred** from the releases of the FRs that use each attribute (FR-IAM-003/AC-36.2 A; FR-IAM-005 A; FR-IAM-007, FR-GEN-006, FR-IAM-004, FR-CAS-002 B).

| Code | Attribute | Rel (inferred) |
|---|---|---|
| (a) | market and brand scope on role assignment | A |
| (b) | downline relationship and depth for distributor-facing data | B |
| (c) | self (own statements, own details) | B |
| (d) | separation of duties from recorded actor ids | B |
| (e) | related-party and new-account conditions on adjustments | B |
| (f) | support-session scope and region for vendor staff | A |

### 4.7 Separation of duties (SEC-04 D rel B; FR-IAM-004 rel B; BR-SEC-06; BR-ADJ-02/03)

Preparer ≠ approver for (union of SEC-04 and FR-IAM-004):
- payout batches
- run commits
- plan activations
- settings that affect money
- erasure
- update activation (self-hosted, V1)
- adjustments (no self-approval)

Rules:
- Evaluated in the **service layer from recorded actor ids** on the object, not role names (BR-SEC-06).
- Approver compared with preparer **and all contributors** to the object; refuse if equal.
- Adjustments: also refuse if approver is the beneficiary payee or declared related party; adjustments to accounts younger than N days (tenant setting) blocked or escalated (BR-ADJ-03, SEC-41).
- Above tenant threshold → second approver (BR-ADJ-02).
- DB backstop: `approval` CHECK `approver_id <> preparer_id`; `decision in (approved, rejected)`; immutable.
- Refusal: reason code `SOD-01` (FR-IAM-004); HTTP `422 SOD_SELF_APPROVAL` (SDD-06).
- No eligible approver: delegation rule lists eligible users; never self-approval.
- Role editor rejects role combinations that break SoD (FR-IAM-003).
- Tests: TS-42 (B) preparer refused on commit, batch approval, plan activation, adjustment; different approver succeeds. AC-07.1.

### 4.8 Genealogy visibility (SEC-08 D rel B; FR-GEN-006; BR-DAT-03)

- Tenant field-by-depth policy (e.g. name and rank to depth n; contact only for personally sponsored; aggregates beyond). Safe default when unconfigured.
- Authorise via `path_node` (ltree) read model: viewer is ancestor of target at depth d.
- Out-of-scope → **404, identical to not found** (AC-05.2). Beyond depth → aggregates only, from API not client (AC-05.1).
- Stale read model → fall back to system of record; never return a node outside the downline (TS-64).
- Policy version recorded on response logs. Depth/breadth caps per request (FR-GEN-007). Rate limit and log exports. Scraping detection (SEC-45).

## 5. Vendor access

### 5.1 Support sessions (SEC-02 D rel A; FR-IAM-005 rel A; BR-SEC-01; ADR-12; NFR-SEC-05 = 0 access outside session)

Entity `support_session` (ENT-23, rel A):

| Column | Type | Flags |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | NN, FK tenant |
| requester_id | uuid | NN, FK user_account (vendor realm) |
| reason | text | NN |
| scope | jsonb | NN (modules; read-only or named write action) |
| requested_minutes | int | NN |
| state | text | NN |
| decided_by | uuid | FK user_account |
| starts_at | timestamptz | |
| ends_at | timestamptz | |

State enum: `requested, approved, denied, active, expired, ended`. Invariant: `ends_at - starts_at` within tenant maximum.

```
requested --(tenant admin approves)--> approved --(first use / start)--> active
requested --(tenant admin denies)--> denied
requested --(no decision before request expiry)--> denied (auto-denied)
active --(ends_at reached)--> expired
active --(tenant admin "end session now" / vendor ends)--> ended
```

Flow (API-08):
1. Vendor ops: `POST /v1/support-sessions {tenant, reason, scope, minutes}` (vendor session, "vendor role"; Idempotency-Key required). Pre: vendor user has MFA; tenant has ≥ 1 admin.
2. Notify tenant admins.
3. Tenant admin: `POST /v1/support-sessions/{id}/decision {approved, minutes}` — permission `vendor_access.decide` (SC-14, rel A).
4. On approval mint a **time-boxed, scoped credential**.
5. Every screen view, query and API call → tenant-visible session log; audit events carry `support_session_id`.
6. Auto-expiry → credential invalid; session report to tenant. `GET /v1/support-sessions/{id}/log`.

Rules:
- Read-only by default; writes only if a named write action is in scope. Out-of-scope action → blocked and logged.
- Region-bound: requester outside tenant region needs **explicit region approval** (FR-IAM-005, PRV-06, AC-31.1, TS-57).
- Duration within tenant maximum (value unspecified).
- Without session: tenant business-data endpoints refuse; logged in **both vendor and tenant audit logs** (AC-29.3, TS-37).
- Vendor reads tenant audit log only inside a session (SEC-37).

### 5.2 Vendor operations console (FR-OPS-001, rel A; SC-39; US-57)

- Separate app area + separate identity realm.
- Shows: tenant list with region, tier, state, job health; provisioning; support-session requests; market-pack maintenance.
- Never shows participant, order or payout data without session (AC-57.1).
- All actions → vendor audit log; tenant-affecting actions also → tenant's log.

### 5.3 Break-glass and change management

| ID | Rule | Rel |
|---|---|---|
| SEC-49 | Engineer production access by break-glass with second-person approval and full recording; no DB consoles for routine work | A |
| SEC-50 | Reviewed PRs; signed artefacts; deploy approver ≠ author | A |
| SEC-51 | Self-hosted: no vendor access path; signed releases; support-bundle redaction test (TS-71); licensee duties in installation guide | V1 |

## 6. Tenant isolation

### 6.1 Tenant model (FR-TEN-001 rel A; ENT-01)

`tenant` (not tenant-scoped, no RLS): `id uuid PK, legal_name text NN, slug text NN UQ, region text NN, isolation_tier text NN, db_route text NN, state text NN, dpa_document_id uuid, created_at timestamptz NN`.
- `state in (provisioning, implementation, live, archived)`.
- `isolation_tier`: pooled | dedicated (database).
- `region` immutable after first data load. Region change = migration project, not a setting.
- Provisioning (Vendor ops + second-person approval): routing entry; DB or schema objects; apply RLS policies; first-admin invitation; record DPA reference and breach contacts. Pre: signed DPA recorded. Failure → idempotent retry, stays `provisioning`.
- All tenant data, backups and exports stay in region (BR-DAT-09, NFR-PRIV-03).
- All tenant changes → vendor audit log and tenant audit log.

### 6.2 Layered isolation (SDD-10 §4)

| Layer | Control | Rel |
|---|---|---|
| 1 Identity | token bound to one tenant + realm; API key bound to one tenant | A |
| 2 Request | tenant resolver sets context once; no handler accepts a tenant id; cross-cell requests redirected | A |
| 3 Data access | `SET LOCAL app.tenant_id` at transaction start; query without it fails (RLS default deny) | A |
| 4 Database | RLS `USING (tenant_id = current_setting('app.tenant_id')::uuid)` **and** `WITH CHECK` on every tenant-scoped table; app role has no `BYPASSRLS`; migrations run as separate role; migration test fails if a tenant table lacks a policy | A |
| 5 Placement | dedicated DB or cell for large / residency-bound tenants; dedicated DBs **still enable RLS** (SDD-01) | A (routing), placement as needed |
| 6 Other stores | object keys, cache keys, queue jobs, search indexes, logs, exports carry tenant prefix; per-tenant encryption keys for sensitive data | A (prefixing, SEC-29) / B (keys, SEC-30) |
| 7 Verification | generated cross-tenant test per endpoint in CI (TS-21); canary rows per tenant; periodic pen test | A |
| 8 People | vendor via support sessions only; break-glass with second approval | A |

### 6.3 Database rules (SDD-04 §1)

- Every tenant-scoped table: `tenant_id uuid NOT NULL` + RLS policy as above.
- Insert-only financial/result tables: `UPDATE`/`DELETE` revoked from app role and blocked by trigger (NFR-INT-05; TS-39 → statement rejected + alert).
- PK UUIDv7 generated by app.
- Sensitive values never in plain columns (rule 10).
- Background jobs cannot run without explicit tenant context (SEC-29).
- `outbox_event.tenant_id NN`.

Reference SQL shape (derived from SDD-10 §4 layer 4; role names not specified in sources):

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
-- per transaction:
SET LOCAL app.tenant_id = '<uuid from session>';
```
Note: `current_setting('app.tenant_id')` without `missing_ok` raises when unset → satisfies "query without it fails".

### 6.4 Isolation requirements

| ID | Requirement | Class | Rel |
|---|---|---|---|
| SEC-01 | Tenant id enforced in data layer (RLS pooled; separate DB dedicated); app DB role cannot bypass; tenant id never from client | D (M as processor duty in MY, as reported) | A |
| SEC-28 | Automated cross-tenant test for **every** endpoint generated from OpenAPI; build fails if endpoint uncovered | D | A |
| SEC-29 | Jobs, caches, object keys, search indexes, logs, exports namespaced by tenant; job cannot run without explicit tenant context | D | A |
| SEC-30 | Per-tenant encryption keys for sensitive fields and documents | R | B |
| NFR-SEC-01 | Cross-tenant access via any endpoint = 0; suite covers 100% endpoints | Confirmed | A |
| TS-21 | Tenant A credential vs every endpoint with Tenant B ids → every request fails without leaking existence | Isolation | A |
| TS-36 | Table-driven role matrix incl. market scope | Authorisation | A |
| TS-57 | Writes, backups, export destinations in tenant region; out-of-region support session needs explicit approval | Functional | A |
| TS-67 | Static: no branch on a tenant identifier in engine code | Static | B |

Monitoring: T1 canary rows per tenant — alert when another tenant's row appears in a response.

## 7. Data protection and encryption

### 7.1 Encryption and secrets

| ID | Requirement | Class | Rel |
|---|---|---|---|
| SEC-31 | TLS 1.2+ for all traffic incl. internal service and DB connections | R | A |
| SEC-32 | Encryption at rest: DBs, backups, object storage (NFR-SEC-03: AES-256, Proposed) | R | A |
| SEC-07 | Sensitive docs/values (identity docs, tax ids, bank details) in separate encrypted store; short-lived signed URLs; masked display; every unmask audited | R | B |
| SEC-30 | Per-tenant keys (KMS) | R | B |
| SEC-33 | Secrets (provider credentials, signing keys, webhook secrets) only in secrets manager; rotated; never in code, images, logs or DB columns | R | A |
| SEC-13 | Card data never touches the platform | K | A |

DB references to secrets: `provider_config.credentials_secret_ref`, `webhook_endpoint.secret_ref` (refs only).

### 7.2 Sensitive data classes (SDD-10 §6)

| Data | Protection | Storage | Rel |
|---|---|---|---|
| Bank details | encrypted per tenant before storage; keyed-hash fingerprint for duplicate detection; masked value for display; decrypted **only by dispatcher inside a worker at instruction time** | `bank_detail_version(details_ciphertext bytea, fingerprint bytea, masked text, created_via in (self, case, migration), cooling_off_until, verified_at, superseded_at)` insert-only except `superseded_at` | B |
| Tax ids, identity documents | sensitive store; masked column; unmask = separate audited call with step-up | `tax_profile.tax_id_document_id`, `tax_id_masked`; `document.class = sensitive_id` | B |
| Contact data | `participant.contact`; visible by role + visibility policy; removed on pseudonymisation | | B |
| Overlay facts | pseudonymous ids only; forbidden-column rejection (SEC-47, PRV-20, NFR-PRIV-04) | `cpl_fact_*` | A |
| Logs / traces | no personal data, secrets or bank details; automated scanning | | A |
| Backups | encrypted; in region; same access controls; pseudonymisation not retroactive (age out by retention) | | A |
| Exports | logged, limited, expiring links; destination in tenant region (`export_job` invariant) | | A |

`document.class in (evidence, agreement, tax_form, export, sensitive_id, disclosure)`; sensitive class access logged **per read**.

### 7.3 Files (SEC-46..48)

| ID | Rule | Rel |
|---|---|---|
| SEC-46 | Uploads: content-inspection type allow-list, size limit, malware scan, outside web root under random keys, signed URLs with `Content-Disposition: attachment` | A |
| SEC-47 | Overlay imports: forbidden-column check before storage; rejected files deleted immediately | A |
| SEC-48 | Generated files private, expiring download links, logged on access | B |
| T14 | CSV exports: values starting with `=`, `+`, `-`, `@` prefixed (no formula execution) | A |

## 8. Audit

### 8.1 Requirements

| ID | Requirement | Rel |
|---|---|---|
| SEC-09 | Immutable, hash-chained audit log in separate store; covers sign-ins, role/permission changes, settings, plan transitions, runs, commits, approvals, adjustments, payouts, bank-detail and tax changes, unmasking, exports, guardrail decisions, vendor sessions and every action inside them | A |
| SEC-37 | Tenants read own audit log incl. vendor actions; vendor reads only inside a session | A |
| SEC-38 | Retention per market; chain verification **daily**; alert on break | A |
| FR-AUD-001 / BR-SEC-07 | Event: actor, action, object, before/after refs, tenant, time, request id; written in same transaction via outbox; hash-chained per tenant; searchable by actor, object, time | A |
| FR-AUD-002 / BR-SEC-03 | Personal-data exports: row cap per role; respect visibility; async for large; watermark with requester id; logged with who, filter, row count; above cap → refused with path to scheduled export | A |
| NFR-SEC-06 | 100% audit coverage of money, role, plan, export, vendor actions | A |

Failure mode: audit store unavailable → events buffered in outbox; **money actions blocked if buffer exceeds a limit** (limit unspecified).

### 8.2 Entity `audit_event` (ENT-24, rel A; separate store, separate credentials)

| Column | Type | Flags |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | NN |
| seq | bigint | NN; UQ (tenant_id, seq) |
| occurred_at | timestamptz | NN |
| actor_type | text | NN |
| actor_id | uuid | |
| support_session_id | uuid | |
| action | text | NN (e.g. `AUTH.SIGN_IN`) |
| object_type | text | |
| object_id | uuid | |
| before_ref | text | |
| after_ref | text | |
| request_id | text | |
| prev_hash | bytea | |
| hash | bytea | NN |

- Invariant: insert only; `hash = H(prev_hash, payload)`. Hash algorithm unspecified.
- Indexes: `(tenant_id, seq) UQ`, `(tenant_id, object_type, object_id)`, `(tenant_id, actor_id, occurred_at)`.
- Read: `GET /v1/audit-events` (API-09, `audit.read`); SC-30.
- Tests: AC-54.1 (export → event with actor, view, filters, row count), AC-54.2 / TS-56 (tamper → chain break reported), TS-34.

`approval` (rel A) is itself an immutable audit record: `id, tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, factor_verified_at, decided_at`.

## 9. API security and rate limits

| ID | Requirement | Rel |
|---|---|---|
| SEC-10 | Scoped API keys; per-key rate limits; pagination caps; no bulk personal-data endpoints without purpose scope; IP allow-lists per key | B |
| FR-IAM-006 | Key shown once, only hash stored (`api_key.key_hash UQ`); rotation keeps old key valid for a grace period; errors 401 expired/revoked, 403 scope missing, 429 + `Retry-After` | B |
| SEC-39 | Schema validation; output encoding; parameterised queries only; upload scanning; size limits; SSRF protection on outbound webhooks (public HTTPS only) | A |
| SEC-06 | Signed, idempotent payout instructions; provider allow-list per tenant; inbound webhooks verified by signature | B |
| TR-API-12 | Token bucket per key and per user; tiers per key; `429` + `Retry-After`; separate, stricter limits on auth and public endpoints; pagination caps | A/B |
| T16 | Webhook URLs: HTTPS only; resolve and block private and link-local ranges; egress proxy (`webhook_endpoint` invariant https only) | B |
| T15 | Inbound webhook: signature + timestamp; dedupe by event id; settlement amounts must match instruction | B |
| API-33 | Outbound webhooks (`run.committed`, `period.closed`, `payout.settled`, `payout.returned`, `plan.activated`, `disclosure.published`) signed with **HMAC**; event id; retries with backoff; secret held as `webhook_endpoint.secret_ref` | B |

`api_key` (rel B): `id, tenant_id NN, name NN, key_hash NN UQ, scopes text[] NN, rate_tier text NN, ip_allow cidr[], expires_at, revoked_at`.

Status codes: 401 missing/invalid credential; 403 lacks permission when existence not sensitive, or `STEP_UP_REQUIRED`; **404 not found or outside caller's scope**; 422 `SOD_SELF_APPROVAL`; 429 rate limited.

Rate-limit numbers: **none specified** in any source.

## 10. Fraud controls with security impact (all rel B unless stated)

| ID | Rule | Threat |
|---|---|---|
| SEC-05 / FR-PAY-005 / BR-PAY-08 | Bank-detail change: re-auth, notify old (and new) contact, cooling-off (`cooling_off_until`), payouts inside it held | T5 |
| SEC-40 | Signal: several payees changing to same account; changes shortly before pay day | T5 |
| SEC-41 / FR-CAS-002 | Adjustments: reason code, evidence, second-approver threshold, block own/related/young accounts; volume-by-user report | T6 |
| SEC-42 | Plan versions need simulation + approval; alert when change concentrates gains on few payees | T7 |
| SEC-43 | Duplicate detection: hashed identity, payment fingerprint, address, device | T8 |
| SEC-44 | Volume-manipulation integrity signals (FR-CPL-010) | T9 (V1) |
| SEC-45 | Export limits by role; watermarking; genealogy scraping detection | T4, T11 (A/B) |

Policy: rules first, tenant thresholds; no ML until labelled cases exist.

## 11. Privacy items owned by security (TRD-04 §11)

| ID | Requirement | Class | Rel |
|---|---|---|---|
| PRV-01 | DPO function for platform as processor (Malaysian tenants) | M (MY) | A if MY |
| PRV-02 / FR-PRV-004 | Breach runbook; tenant contacts + timelines; affected-subject report. Missing contact blocks go-live / first data load (AC-53.1) | M (MY; IN from May 2027) | A |
| PRV-03 | DPA with each tenant | M (GDPR-type) / R | A |
| PRV-04 | DSR tooling: access, correction, erasure by pseudonymisation, portability | M | B |
| PRV-05 | Retention timers per data class; logged deletion jobs | M (IN 2027) / R | V1 |
| PRV-06 | Data region per tenant; transfer controls; support access by region | M (IN Rule 5(5); VN) | A |
| PRV-07 | Prospect data private to distributor; consent before marketing | M | V1 |
| PRV-20 | Overlay: pseudonymous ids only | D | A |
| PRV-21 | Record of processing + sub-processor list | R | A |

## 12. Threat register (SDD-10 §3) — controls engineers must implement

| # | Threat | Prevent (build) | Detect (alert) | Respond |
|---|---|---|---|---|
| T1 | Cross-tenant access | token-only tenant; RLS everywhere; routing; namespaced keys; dedicated DB for large tenants | CI isolation suite; canary rows per tenant (anomaly on another tenant's rows in a response) | incident runbook; notify affected tenants (PRV-02) |
| T2 | Privilege escalation in tenant | least privilege; 2nd admin for privileged grants; can't grant what you lack | alert on new admin | role-change history |
| T3 | Vendor reads tenant data | no standing access; approved, scoped, time-boxed, region-bound sessions | every action logged, tenant-visible | tenant-visible log; session report |
| T4 | Genealogy scraping | server visibility policy; depth/page limits; no bulk endpoints | rate limits; pattern alerts | export log; suspend portal session |
| T5 | Bank-detail change before payout | re-auth; notices to old contact; cooling-off; staff change only by case + second person | many payees→one account; pre-payday changes | hold payouts; case |
| T6 | Manual adjustment fraud | reason/evidence; thresholds; no self-approval; related-party/new-account blocks | volume by user; adjustments to young accounts | immutable case history |
| T7 | Plan-rule manipulation | simulation + approval; committed periods immutable | diff alert on concentrated gains | version diff and approver |
| T8 | Fake/duplicate/multiple accounts | hashed-attribute duplicate matching; market identity rules | clusters sharing attributes | duplicate case |
| T9 | Volume manipulation | plan design; guardrail warnings | integrity signals (V1); R4 report | compliance case |
| T10 | Account takeover / session hijack | MFA privileged; step-up; short sessions; refresh rotation + reuse detection; device binding approvers | new device on approver; impossible travel | revoke sessions |
| T11 | API mass extraction | scoped keys; rate limits; pagination caps; IP allow-lists | per-key volume anomalies | revoke key |
| T12 | Sensitive doc exposure | separate encrypted store; signed short-lived URLs; masking | many docs by one user | access log |
| T13 | Payout instruction tamper/replay | signed instructions verified before dispatch; idempotency keys; provider allow-list | reconciliation breaks | instruction trail |
| T14 | Malicious upload/import | content inspection; size limits; malware scan; CSV parsed defensively; formula prefixing in exports | validation reports | reject batch |
| T15 | Forged webhook | signature + timestamp; event-id dedupe; settlement amount must match instruction | unknown reference exceptions | ignore; alert |
| T16 | SSRF via webhooks | HTTPS only; resolve + block private/link-local; egress proxy | egress logs | disable endpoint |
| T17 | Injection | parameterised queries; output encoding; strict CSP; expression language not SQL, no I/O | WAF signals; error rates | patch |
| T18 | Repudiation of approvals | approval record: actor, factor time, object hash; hash-chained audit | chain verification | evidence export |
| T19 | History tampering | insert-only; app role lacks UPDATE/DELETE; break-glass recorded; audit separate store/credentials | chain break; projection/replay mismatch | restore; investigate |
| T20 | DoS at period end | rate limits; queue ingestion; per-tenant worker limits; autoscale web tier | latency/queue alerts | shed non-critical work |
| T21 | Supply chain | pinned deps; signed artefacts; scanning; minimal images | scanner alerts | patch per NFR-SEC-07 (critical ≤ 7 d, high ≤ 30 d) |
| T22 | Secrets leak | secrets manager; no secrets in logs/code/DB; rotation | secret scanning CI + logs | rotate; revoke |
| T23 | Expression abuse | pure typed bounded language; reads only payee's declared inputs | evaluation cost metrics | reject version |
| T24 | Self-hosted tamper / licence forgery (V1) | signed packages verified offline; signed licence bound to installation | verification failure log | refuse package; read-only on invalid licence, **never on mere expiry** |
| T25 | Overlay re-identification | pseudonymous ids; forbidden-column rejection; data terms; region-bound storage; deletion on request | — | delete batch |

Monitoring alert list (SDD-10 §7): T1 canaries, new admins, bank-detail clusters, adjustment volume, chain break, unbalanced entry attempts, replay mismatch, dead letters.

## 13. Security operations

| Area | Rule | Rel |
|---|---|---|
| Vulnerability mgmt | dependency + container scanning in CI; NFR-SEC-07 critical ≤ 7 days, high ≤ 30 days | A |
| Pen test | NFR-SEC-08: before first production tenant in MVP-B, then yearly | B |
| Backups | SEC-11 scheduled restore tests; NFR-DR-01 RPO ≤ 5 min, NFR-DR-02 RTO ≤ 4 h, NFR-DR-03 quarterly per region (all Proposed; founder sets) | A |
| Attestation | SEC-12 controls mapped to SOC 2 + ISO 27001 from first release; external attestation with first enterprise prospect | V1 (mapping from start) |
| Incident response | runbook with severity levels; tenant notification per contract/market; affected-subject report | A |

Self-hosted shared responsibility (SDD-10 §8, V1): licensee owns infra, network, backups, OS/DB patching, IdP, incident response as controller; app controls (RBAC, SoD, immutability, audit, signing) built in and **cannot be disabled by configuration**; vendor access none by default.

## 14. Build checklist by release

**MVP-A (A):** three realms (tenant + vendor active; portal realm infra); OIDC IdP per cell; API-07; MFA for privileged + vendor (SEC-03); forced enrolment; lockout (SEC-23); sessions/cookies/CSRF/CSP (SEC-34/35); RBAC + base roles + catalogue + clone (SEC-25); market/brand scope; second-admin grants + new-admin alert (SEC-27); support sessions + vendor console (SEC-02, FR-OPS-001); tenant provisioning with region/tier/routing; RLS + `SET LOCAL app.tenant_id` + no BYPASSRLS + migration role + policy-coverage migration test; namespacing (SEC-29); CI cross-tenant suite (SEC-28, TS-21); TLS/at-rest/secrets (SEC-31/32/33); audit store + hash chain + daily verify (SEC-09/37/38); export caps/logging (FR-AUD-002); upload handling (SEC-46/47); SSRF/validation (SEC-39); breach contacts; break-glass; change mgmt. Step-up for role-grant approval. Tests TS-21, TS-34, TS-35, TS-36, TS-37, TS-56, TS-57.

**MVP-B (B):** portal sign-in (SEC-24); SSO federation (SEC-22); device binding (SEC-36); SoD service layer (SEC-04, FR-IAM-004); step-up for commit/batch/activate/adjust/write-off/bank/unmask; downline ABAC + visibility (SEC-08); API keys/service accounts (SEC-10, FR-IAM-006); sensitive store + per-tenant KMS (SEC-07, SEC-30); signed payout instructions + webhook verification (SEC-06); fraud rules SEC-05, 40–43; generated-file controls (SEC-48); pen test before first B production tenant. Tests TS-39, TS-42, TS-64, TS-67.

**V1:** SEC-12 attestation, SEC-44, SEC-51 self-hosted, licence controls (T24), PRV-05, PRV-07. Tests TS-70, TS-71.

---

## Conflicts found

1. **MFA population differs across documents.** SEC-03: tenant admins, payout preparers + approvers, plan approvers, compliance officers, **DPO**, all vendor staff. FR-IAM-002 omits DPO. BR-SEC-02 lists only payout approvers, tenant admins, vendor staff. **Resolution:** implement the SEC-03 union (superset); `role.mfa_required = true` for Tenant admin, Payout officer, Finance approver, Plan administrator (if it approves), Compliance officer, DPO, all vendor roles. DPO holds unmask, so MFA is required anyway.
2. **Step-up action list.** SEC-20 includes approve role grant, unmask, write-off; FR-IAM-002 trigger list omits them. **Resolution:** SEC-20 superset applies. Role-grant approval step-up is in A; the others ship with their features in B.
3. **SoD scope.** SEC-04 covers payout batches, run commits, plan activations, money settings, erasure, update activation, adjustments. FR-IAM-004 covers only batch, commit, plan activation, adjustment. **Resolution:** implement SEC-04 union using one generic `approval` mechanism. Also, SEC-04 and FR-IAM-004 are rel B, but SEC-27 privileged-grant approval (A) and FR-TEN-001 provisioning second-person approval (A) need preparer ≠ approver in A. Ship the generic approval + CHECK constraint in A.
4. **SoD error identifier.** FR-IAM-004 says refusal reason code `SOD-01`. SDD-06 / TR-API use HTTP `422 SOD_SELF_APPROVAL`. **Resolution:** API returns `422` with `code: SOD_SELF_APPROVAL`; audit/refusal record stores `reason_code: SOD-01`. Both are used; document the mapping.
5. **Base role list vs matrix columns.** SEC-25 lists 11 roles incl. Implementation consultant and Integration. SDD-10 matrix has neither, uses short names, and adds Distributor. **Resolution:** seed all 11 SEC-25 base roles with SEC-25 names. Implementation consultant and Integration permission sets are undefined (Open). The Integration role likely maps to API-key service accounts (FR-IAM-006).
6. **Audit log readers.** Matrix: DPO = read. FR-AUD-001: read = Tenant admin, Compliance officer only. **Resolution:** grant `audit.read` to DPO as well. The matrix is the TS-36 fixture source and DPO needs it for breach work (FR-PRV-004).
7. **Plan activation permission.** Matrix: Finance approver "activate (2nd)", Compliance officer "approve", Plan admin "edit". API-16 has only `plan.edit`, `plan.approve`. **Resolution (provisional):** add `plan.activate` (Finance approver, step-up, SoD) separate from `plan.approve` (Compliance officer). Confirm it.
8. **SSO release.** FR-IAM-001 (A) lists "SSO assertion" as input. SEC-22 puts tenant IdP federation in B. **Resolution:** A ships local IdP credentials (password/passkey + TOTP/WebAuthn). Federation is B.
9. **Permission naming namespaces.** API-key scopes use colons (`orders:write`, `participants:write`) and user permissions use dots (`participant.manage`). API-12 lists both. **Resolution:** keep two catalogues, role permissions (dot) and key scopes (colon), and validate each against its own catalogue (FR-IAM-006 "scopes from the catalogue").
10. **Support-session auto-deny state.** FR-IAM-005 says "auto-denied" on request expiry, while the state enum has both `denied` and `expired`. **Resolution:** an undecided request goes to `denied` (decided_by NULL, reason auto). `expired` only means an active session reached `ends_at`.
11. **Vendor audit log has no entity.** FR-OPS-001 and AC-29.3 need a vendor audit log, but `audit_event.tenant_id` is NOT NULL and there is no vendor-side table. **Resolution:** add a vendor audit stream in the same separate store (tenant_id nullable or a separate chain keyed by "vendor"). This needs a schema decision (Open).
12. **Unmask permitted roles vs FR.** Matrix allows unmask for Finance approver, Payout officer and DPO. SC-09 says only "unmask needs extra permission" with no string. **Resolution:** define `participant.unmask` (step-up, audited per read) for those three roles. The name is provisional.
13. **Encryption detail level.** SEC-32 gives no algorithm. NFR-SEC-03 (Proposed) says AES-256 and per-tenant keys. SEC-30 puts per-tenant keys in B. **Resolution:** AES-256 at rest from A. Per-tenant KMS keys in B, when bank and tax data first appear. MVP-A overlay data carries no bank or identifier data (NFR-PRIV-04).
14. **Session limits apply to "admin" only.** NFR-SEC-04 values (12 h / 30 min / 10 min) are labelled for admin sessions. SEC-34 applies limits to everyone. **Resolution:** apply 12 h / 30 min to all staff-realm sessions until told otherwise. The 10-min step-up window applies to every step-up action, including the portal bank-detail change.
15. **NULL `tenant_id` rows in tenant-scoped IAM tables.** spec.json marks `user_account` and `role` as tenant-scoped, but vendor users and platform base roles have `tenant_id` NULL. The layer-4 RLS policy (`tenant_id = current_setting('app.tenant_id')::uuid`) hides NULL rows, so base roles could not be read for cloning and vendor accounts could not be resolved. This also breaks the SDD-04 rule "every tenant-scoped table: `tenant_id NOT NULL`". **Resolution (provisional):** for `role`, use a read policy `USING (tenant_id = current_setting(...)::uuid OR tenant_id IS NULL)` with `WITH CHECK` still strict. Read vendor `user_account` rows only through the vendor-realm path, under a separate role. This needs a schema decision.

## Open / unresolved

| Item | Blocks |
|---|---|
| Access-token TTL, refresh-token TTL, portal session absolute/idle limits not specified | SEC-34, FR-IAM-001, FR-IAM-007, API-07 |
| NFR-SEC-04 values are "Proposed", not confirmed | SEC-34, SEC-20, TS-35 |
| Lockout window length and lock duration (only "5 failures → lock on 6th") | SEC-23, AC-35.2, TS-35 |
| No numeric rate limits (per IP, per account, per key tier, public endpoints) and no pagination cap values | TR-API-12, SEC-10, SEC-23, FR-IAM-006, API-07, API-31 |
| No authoritative permission catalogue. Missing strings: unmask, plan activate, vendor roles, Implementation consultant and Integration role contents | FR-IAM-003, SEC-25, TS-36, SC-09, API-08, API-16 |
| Vendor-realm role names and permissions ("vendor role(s)") undefined | FR-OPS-001, API-08, SC-39, FR-TEN-001 |
| Tenant maximum support-session duration and request-expiry time not set | FR-IAM-005, SEC-02, TS-37 |
| Step-up window for distributors (portal "fresh" re-auth) not quantified | SEC-24, FR-IAM-007, AC-17.2, API-27 |
| Export row caps per role not set | FR-AUD-002, SEC-45, TS-56 |
| Audit outbox buffer limit that blocks money actions not set; hash algorithm not named | FR-AUD-001, SEC-09 |
| Vendor audit log entity and schema missing | FR-OPS-001, AC-29.3, TS-37 |
| DB role names (app, migration, audit writer) and grants not specified | SEC-01, NFR-INT-05, TS-39 |
| Whether MFA becomes mandatory for distributors (SDD-10 §9; optional by default; revisit with fraud evidence) | SEC-03, FR-IAM-007 |
| Device and behavioural signals for duplicates need DPO and counsel view per market | SEC-43, FR-PAR-003 |
| Cross-region genealogy under residency rules (OQ-17). MVP = one region per tenant | FR-TEN-001, PRV-06 |
| Self-hosted shared-responsibility and liability terms (OQ-25) | SEC-51, FR-LIC-* (V1) |
| Vendor liability for tenant plans (Q-1); which market's processor duties apply first (FD-02); whether buyers require attestation pre-purchase | SEC-12, PRV-01, PRV-02 |
| Threat model never independently reviewed (FD-07); IdP choice ADR-19 only "Proposed" | entire domain; ADR-19 |
| Whether SoD (preparer ≠ approver) applies to import mapping approval in A (matrix: Compliance officer "approve mapping") | API-03, `mapping.approve`, FR-IMP-002 |
