# 14 — ADVANCED UX AND WIREFRAME GAP RESEARCH
## No UX documents exist: what the first IA, screens and states must cover

| Field | Value |
|---|---|
| Document ID | GAP-14 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 8 |
| Gap | GAP-055 |
| Basis | Workflows in 10, 11 and this audit (07–13); enterprise SaaS patterns are stated as design reasoning [IP], not as research findings |

## 1. GAP-055 — No information architecture, screens or states

| Field | Content |
|---|---|
| **Category** | UX |
| **Previous research coverage** | None (UX was Wave 6) |
| **Missing element** | IA by role, screen inventory, states, statement and genealogy usability, admin bulk operations, permission states |
| **Evidence** | Reviews cite "not intuitive", learning curve and "cumbersome" reporting at three of four vendors (03 §6) |
| **Why it matters** | The admin surface is where change cost (the main buyer complaint) is felt; the statement is where distributor trust is won or lost |
| **Affected stakeholders** | All users |
| **Product implications** | §2–§5 |
| **Technical implications** | Server-side permission checks drive visible states; every list is filterable, sortable, exportable within limits |
| **Recommended solution** | Start UX with the five highest-risk screens (§3) and test them with analysts and distributors before building others |
| **Priority** | High |
| **Implementation stage** | Before UX work |
| **Confidence** | High |
| **Documentation changes required** | Future 26–30 (UX research, IA, flows, wireframes) |

## 2. Information architecture by role (proposal)

| Role | Top-level areas | Notes |
|---|---|---|
| Tenant admin and analyst | Periods & runs · Plans (versions, simulation) · Participants & genealogy · Orders & returns (ingested) · Adjustments & disputes · Payouts · Compliance reports · Settings | **Periods & runs is the home screen**: the work is cyclical |
| Finance approver | Payout batches · Approvals queue · Ledger & exports · Tax | Approve-only views; no edit rights on plans |
| Compliance officer | Compliance reports · Plan change approvals · Investigations · Disclosures | Read-mostly; can place holds |
| Support agent | Search (person, order, statement) · Case view · Statement explanation | Masked personal data by default |
| Distributor (mobile-first) | Earnings & statements · My customers · Rank status · Team (privacy-limited) · Orders | No income projections (GAP-003) |
| Vendor operations staff | Tenant list · Support access requests (time-boxed, approved) · Health | Separate application or strongly separated area (GAP-065) |

## 3. The five highest-risk screens

| Screen | Why risky | Must have |
|---|---|---|
| **Period run review** | Wrong approval pays thousands of people | Totals vs previous run; variance by bonus and by top payees; exception list; "what changed" (inputs, plan version); approve with second person |
| **Plan version compare and simulate** | Change cost and legal effect | Side-by-side rule diff in plain language; payee-level impact distribution; cap effects (09 T3); compliance flags (CMP-02) |
| **Distributor statement** | Trust; disputes | Gross, withholding, clawbacks, net; each line → "how calculated"; rank used; period; disclosure link |
| **Genealogy explorer** | Privacy; scale | Search-first; lazy expansion; depth limit; aggregated counts beyond the visibility depth; "as of date" selector for staff |
| **Adjustment and dispute case** | Fraud vector; audit | Reason codes; evidence attachments; approval thresholds; effect preview; immutable history |

## 4. States every screen must design

| State | Example |
|---|---|
| Empty | New tenant with no periods: show "import or connect orders" steps |
| Loading long jobs | A run of 2M positions: progress, not a spinner; safe to leave |
| Partial data | Commerce sync behind: banner with last sync time; runs blocked until reconciled |
| Permission-limited | Leader sees counts but not names beyond depth n; explain why |
| Locked | Committed period: read-only with "request restatement" path |
| Error recovery | Payout batch partly failed: retry failed lines only, idempotent |
| Stale | Exchange rate older than policy allows: block conversion with explanation |

## 5. Patterns for data-heavy admin work [IP]

- Saved views and filters per user for large tables; column chooser; server-side pagination.
- Bulk actions only with preview and an undo window where the action is reversible; never bulk-edit money without a case and approval.
- Exports respect visibility rules and are logged (16).
- Keyboard-friendly tables for analysts; plain-language summaries above every table for owners.
- Low-bandwidth distributor pages: server-rendered, small payloads, statements readable without JavaScript where possible (GAP-051).

## 6. Screens that are probably unnecessary in an MVP

Social feeds, gamified leaderboards, recruit-tracking boards, built-in video training, a native storefront (GAP-045), and AI chat for distributors (17). Each adds scope without evidence of need, and several push toward recruitment.
