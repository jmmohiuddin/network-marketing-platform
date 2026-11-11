# 01 — SCREEN INVENTORY
## Master list of screens with purpose, content, permissions and trace

| Field | Value |
|---|---|
| Document ID | WF-01 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Product (CPO role) |
| Depends on | UX-02 (IA), PRD-02; gap audit 27 |
| Status | Draft. Not approved |

## 1. Scope of the inventory

The inventory follows the product boundary chosen for this documentation (research path: MVP-A overlay, then MVP-B engine plus compliance). Screen IDs SC-01 to SC-23 keep the numbering of the gap audit (27 §2); SC-24 to SC-46 were added here.

**Screen categories in the brief that are deliberately absent**, with the reason (see `01-product-definition/03_PRODUCT_MODULE_ARCHITECTURE.md` §4):

| Brief category | Decision | Reason |
|---|---|---|
| Product catalogue, checkout, storefront, purchase history | Integrate | Commerce is unbundling; build would compete with Shopify, WooCommerce, Fluid (GAP-045) |
| Inventory, warehouse, stock transfers, purchase orders | Integrate | Lives in the commerce or ERP system (GAP-047) |
| Training: catalogue, course, progress, assessments | Partner | LMS vendors exist; no evidence of need (audit 13 §3) |
| Marketing: campaigns, lead forms, materials | Not built | Claims monitoring and content are partner territory (GAP-001); referral links belong to the commerce front end, the platform records attribution |
| CRM dashboard, pipeline, lead directory | Not built (attribution only) | No evidence of need; pushes toward recruitment (GAP-041) |
| AI assistant, recommendations | Not built in MVP | GAP-070: variance explainer and internal configuration assistant in V1 only |
| Customer account, subscription management, customer support | Integrate | Merchant of record owns them (GAP-046). Customer-facing screens here are SC-40 and SC-41 only |

Areas: **Admin** (tenant staff web application), **Distributor** (mobile-first portal), **Vendor** (vendor operations console), **Public** (unauthenticated pages), **Shared**.

## 2. Index

| ID | Screen | Area | Release | Wireframe | Requirements |
|---|---|---|---|---|---|
| SC-01 | Periods and runs (analyst home) | Admin | MVP-B | Yes | FR-COMP-001, FR-COMP-002, FR-COMP-008, FR-COMP-011, FR-INT-002, FR-RPT-001 |
| SC-02 | Run review | Admin | MVP-B | Yes | FR-IAM-004, FR-COMP-003, FR-COMP-005, FR-COMP-006, FR-COMP-007, FR-COMP-010, FR-COMP-012, FR-AI-001 |
| SC-03 | Payout batches and approvals | Admin | MVP-B | Yes | FR-IAM-004, FR-PAY-001, FR-PAY-002, FR-PAY-003, FR-PAY-007 |
| SC-04 | Plan versions: edit, compare, simulate | Admin | MVP-B | Yes | FR-CPL-007, FR-GEN-009, FR-PLN-001, FR-PLN-002, FR-PLN-003, FR-PLN-005, FR-AI-002 |
| SC-05 | Cap and pool configuration | Admin | MVP-B | Yes | FR-PLN-004 |
| SC-06 | Cases: adjustments, disputes, restatements | Admin | MVP-B | Yes | FR-CPL-013, FR-COMP-007, FR-COMP-009, FR-FIN-003, FR-CAS-001, FR-CAS-002, FR-CAS-003 |
| SC-07 | Genealogy explorer (staff, as-of) | Admin | MVP-B | Yes | FR-GEN-001, FR-GEN-002, FR-GEN-003, FR-GEN-005, FR-GEN-007, FR-GEN-008 |
| SC-08 | Genealogy change and duplicate cases | Admin | MVP-B | Yes | FR-PAR-003, FR-PAR-004, FR-GEN-004, FR-CAS-001 |
| SC-09 | Participant record | Admin | MVP-B | Yes | FR-PAR-001, FR-PAR-002, FR-PAR-005, FR-PAR-006, FR-GEN-001, FR-CRM-001, FR-CRM-002, FR-PAY-005, FR-TAX-001 |
| SC-10 | Compliance reports | Admin | MVP-A | Yes | FR-CPL-001, FR-CPL-002, FR-CPL-003, FR-CPL-004, FR-CPL-005, FR-CPL-006 |
| SC-11 | Guardrails and overrides log | Admin | MVP-B | Specified in text only | FR-CPL-007, FR-CPL-008 |
| SC-12 | Tax configuration and year-end forms | Admin | MVP-B | Specified in text only | FR-TAX-002, FR-TAX-003 |
| SC-13 | Integrations and sync health | Admin | MVP-B | Yes | FR-IAM-006, FR-ORD-001, FR-ORD-002, FR-PAY-002, FR-PAY-006, FR-INT-001, FR-INT-002, FR-INT-003, FR-INT-004 |
| SC-14 | Vendor access sessions | Admin | MVP-A | Yes | FR-IAM-005 |
| SC-15 | Privacy requests | Admin | MVP-B | Specified in text only | FR-PRV-001, FR-PRV-002, FR-PRV-003 |
| SC-16 | Migration workspace and parallel-run report | Admin | MVP-B | Yes | FR-MIG-001, FR-MIG-002 |
| SC-17 | Market launch checklist | Admin | MVP-B | Yes | FR-TEN-004, FR-CPL-012, FR-PAY-006 |
| SC-18 | Distributor: statements and line explanation | Distributor | MVP-B | Yes | FR-FIN-002, FR-CAS-003, FR-DIST-001, FR-DIST-002, FR-DIST-007 |
| SC-19 | Distributor: rank status | Distributor | MVP-B | Yes | FR-COMP-004, FR-DIST-003 |
| SC-20 | Distributor: team | Distributor | MVP-B | Yes | FR-GEN-006, FR-GEN-007, FR-DIST-004, FR-DIST-009 |
| SC-21 | Distributor: my customers | Distributor | MVP-B | Yes | FR-CRM-001, FR-CRM-003, FR-DIST-005 |
| SC-22 | Distributor: bank details and tax profile | Distributor | MVP-B | Yes | FR-PAY-005, FR-TAX-001, FR-DIST-006 |
| SC-23 | Earnings disclosure builder | Admin | V1 | Specified in text only | FR-CPL-009, FR-CPL-011 |
| SC-24 | Data imports | Admin | MVP-A | Yes | FR-IMP-001, FR-IMP-003, FR-IMP-004 |
| SC-25 | Import mapping | Admin | MVP-A | Yes | FR-IMP-002 |
| SC-26 | Figure drill-down | Admin | MVP-A | Yes | FR-CPL-006, FR-AUD-002 |
| SC-27 | Sign-in and second factor | Shared | MVP-A | Yes | FR-IAM-001, FR-IAM-002, FR-IAM-007 |
| SC-28 | Users and roles | Admin | MVP-A | Yes | FR-IAM-003 |
| SC-29 | Tenant settings | Admin | MVP-B | Specified in text only | FR-TEN-002, FR-TEN-003, FR-PRV-004 |
| SC-30 | Audit log | Admin | MVP-A | Specified in text only | FR-AUD-001, FR-AUD-002 |
| SC-31 | Orders and returns (ingested) | Admin | MVP-B | Specified in text only | FR-ORD-001, FR-ORD-003, FR-ORD-004, FR-ORD-006, FR-RPT-002 |
| SC-32 | Late-transaction queue | Admin | MVP-B | Yes | FR-ORD-005 |
| SC-33 | Ledger and journal export | Admin | MVP-B | Yes | FR-FIN-001, FR-FIN-002, FR-FIN-003, FR-FIN-004, FR-FIN-005, FR-FIN-006, FR-FIN-007, FR-RPT-002 |
| SC-34 | Payout reconciliation and returned payments | Admin | MVP-B | Specified in text only | FR-PAY-004 |
| SC-35 | Executive overview | Admin | MVP-B | Yes | FR-RPT-001 |
| SC-36 | Global search | Admin | MVP-B | Specified in text only | FR-RPT-002 |
| SC-37 | Distributor home (mobile) | Distributor | MVP-B | Yes | FR-IAM-007, FR-DIST-001, FR-DIST-007 |
| SC-38 | Distributor notifications and profile | Distributor | MVP-B | Specified in text only | FR-DIST-008 |
| SC-39 | Vendor operations console | Vendor | MVP-A | Yes | FR-IAM-005, FR-TEN-001, FR-TEN-005, FR-OPS-001 |
| SC-40 | Public earnings disclosure page | Public | V1 | Specified in text only | FR-CPL-009 |
| SC-41 | Public privacy request form | Public | MVP-B | Yes | FR-PRV-001 |
| SC-42 | Simulation results and golden datasets | Admin | MVP-B | Yes | FR-PLN-005, FR-PLN-006 |
| SC-43 | Rank and qualification detail (staff) | Admin | MVP-B | Specified in text only | FR-COMP-004 |
| SC-44 | Plan change workflow | Admin | MVP-B | Yes | FR-PLN-007, FR-PLN-008 |
| SC-45 | Integrity signals | Admin | V1 | Specified in text only | FR-CPL-010 |
| SC-46 | Compliance overview (overlay home) | Admin | MVP-A | Yes | FR-CPL-001, FR-RPT-001 |
| SC-47 | Licence, updates and diagnostics (self-hosted edition) | Admin | V1 | Yes | FR-LIC-001, FR-LIC-002, FR-LIC-003 |

## 3. Screen records

### SC-01 — Periods and runs (analyst home)

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Commission analyst; Finance approver |
| Business objective | Operate period close as a controlled process |
| User goal | See what state each period is in and act |
| Entry point | Sign-in landing for analysts; nav Periods |
| Primary action | Calculate / open review |
| Secondary actions | Replay; open late queue; open batches |
| Information displayed | Calendars; periods with state, cut-off, sync health, last run totals, blockers |
| Components | State timeline; period table; health banner; progress panel |
| Data required | `calendar`, `compliance_report_snapshot`, `inbound_event`, `period`, `provider_config`, `result_line`, `run`, `run_snapshot` |
| Permissions | period.read; run.execute |
| Navigation destinations | SC-02, SC-32, SC-03, SC-13 |
| Related requirements | FR-COMP-001, FR-COMP-002, FR-COMP-008, FR-COMP-011, FR-INT-002, FR-RPT-001 |
| Wireframe | `wireframes/SC-01.svg` |

### SC-02 — Run review

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Commission analyst; Finance approver |
| Business objective | Catch mistakes before money moves |
| User goal | Compare, investigate, request or give commit |
| Entry point | From SC-01 |
| Primary action | Request commit / Commit (approver) |
| Secondary actions | Export; open line trace; re-run |
| Information displayed | Totals vs previous run; variance by bonus; top movers; exceptions; what changed |
| Components | KPI cards; variance table; movers table; exception list; trace drawer; approval bar |
| Data required | `approval`, `journal_entry`, `late_transaction`, `outbox_event`, `period`, `posting`, `result_line`, `run`, `run_snapshot` |
| Permissions | run.review; run.commit (approver, step-up) |
| Navigation destinations | SC-01, SC-06, SC-03 |
| Related requirements | FR-IAM-004, FR-COMP-003, FR-COMP-005, FR-COMP-006, FR-COMP-007, FR-COMP-010, FR-COMP-012, FR-AI-001 |
| Wireframe | `wireframes/SC-02.svg` |

### SC-03 — Payout batches and approvals

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Payout officer; Finance approver |
| Business objective | Release money safely |
| User goal | Prepare a batch; approve; follow progress |
| Entry point | Nav Payouts |
| Primary action | Prepare batch / Approve |
| Secondary actions | Retry failed lines; open exclusions; open payee |
| Information displayed | Batches with state, totals, counts; inclusion and exclusion lists with reasons; instruction status |
| Components | Batch table; detail with tabs Included, Excluded, Instructions; approval bar |
| Data required | `approval`, `case`, `outbox_event`, `payout_batch`, `payout_instruction`, `posting`, `provider_config` |
| Permissions | payout.prepare; payout.approve |
| Navigation destinations | SC-34, SC-09, SC-06 |
| Related requirements | FR-IAM-004, FR-PAY-001, FR-PAY-002, FR-PAY-003, FR-PAY-007 |
| Wireframe | `wireframes/SC-03.svg` |

### SC-04 — Plan versions: edit, compare, simulate

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Plan administrator; Compliance officer |
| Business objective | Make plan change predictable |
| User goal | Build a version and know its effect |
| Entry point | Nav Plans |
| Primary action | Save draft / Simulate |
| Secondary actions | Compare versions; submit for review; view guardrails |
| Information displayed | Rule list in plain language; parameters; guardrail outcomes; version diff |
| Components | Version header; rule list; rule editor drawer; diff view; guardrail panel |
| Data required | `guardrail_decision`, `guardrail_rule`, `plan`, `plan_rule`, `plan_version`, `relationship`, `result_line`, `simulation` |
| Permissions | plan.edit; plan.read |
| Navigation destinations | SC-05, SC-42, SC-44, SC-11 |
| Related requirements | FR-CPL-007, FR-GEN-009, FR-PLN-001, FR-PLN-002, FR-PLN-003, FR-PLN-005, FR-AI-002 |
| Wireframe | `wireframes/SC-04.svg` |

### SC-05 — Cap and pool configuration

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Plan administrator |
| Business objective | Caps behave as the plan document says |
| User goal | Configure and preview who is cut |
| Entry point | From SC-04 |
| Primary action | Save cap |
| Secondary actions | Preview on period |
| Information displayed | Scope, base, rate, method, priority, residue; preview of payees and amounts removed |
| Components | Form; priority list; preview table |
| Data required | `plan_rule`, `simulation` |
| Permissions | plan.edit |
| Navigation destinations | SC-04, SC-42 |
| Related requirements | FR-PLN-004 |
| Wireframe | `wireframes/SC-05.svg` |

### SC-06 — Cases: adjustments, disputes, restatements

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Commission analyst; Compliance officer; Finance approver |
| Business objective | Every exception has reason, evidence and approver |
| User goal | Work a case to a decision |
| Entry point | Nav Cases; links from lines and queues |
| Primary action | Approve / Reject / Submit |
| Secondary actions | Attach evidence; preview effect; reassign |
| Information displayed | Case list by type and state; case detail with history, evidence, effect preview, approvals |
| Components | Filterable table; case layout with timeline; evidence uploader; effect preview; approval bar |
| Data required | `approval`, `case`, `case_event`, `document`, `posting`, `restatement`, `result_line`, `run_snapshot` |
| Permissions | case.<type>.read/act |
| Navigation destinations | SC-02, SC-09, SC-33 |
| Related requirements | FR-CPL-013, FR-COMP-007, FR-COMP-009, FR-FIN-003, FR-CAS-001, FR-CAS-002, FR-CAS-003 |
| Wireframe | `wireframes/SC-06.svg` |

### SC-07 — Genealogy explorer (staff, as-of)

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Commission analyst; Support agent |
| Business objective | Explain structure at any date |
| User goal | Find a position and see its upline and downline at a date |
| Entry point | Nav Genealogy |
| Primary action | Search |
| Secondary actions | Set as-of and known-at; switch sponsor or placement tree; open participant |
| Information displayed | Focused node, breadcrumbs to root, children with counts, status and rank |
| Components | Search box; date selectors; tree kind toggle; lazy tree; node panel |
| Data required | `path_node`, `position`, `position_ownership`, `relationship` |
| Permissions | genealogy.read |
| Navigation destinations | SC-09, SC-08 |
| Related requirements | FR-GEN-001, FR-GEN-002, FR-GEN-003, FR-GEN-005, FR-GEN-007, FR-GEN-008 |
| Wireframe | `wireframes/SC-07.svg` |

### SC-08 — Genealogy change and duplicate cases

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Support agent; Compliance officer |
| Business objective | Structural changes are reviewed |
| User goal | File or decide a change, correction or duplicate |
| Entry point | From SC-07, SC-09, Cases |
| Primary action | Submit request / Approve |
| Secondary actions | Compare records; view affected periods |
| Information displayed | Request form; policy check result; affected periods and impact; duplicate comparison |
| Components | Form wizard; policy result panel; side-by-side comparison |
| Data required | `approval`, `case`, `case_event`, `document`, `participant`, `position_ownership`, `relationship` |
| Permissions | case.genealogy.*; case.duplicate.* |
| Navigation destinations | SC-06, SC-07 |
| Related requirements | FR-PAR-003, FR-PAR-004, FR-GEN-004, FR-CAS-001 |
| Wireframe | `wireframes/SC-08.svg` |

### SC-09 — Participant record

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Support agent; Finance manager |
| Business objective | One place for a person's facts and history |
| User goal | Answer a question or start a case |
| Entry point | Search; links |
| Primary action | Start case |
| Secondary actions | Unmask field (audited); open statement; open tree |
| Information displayed | Identity (masked), types history, positions, status history, servicing, tax profile, bank detail history, cases |
| Components | Header; tabs; history tables; masked fields |
| Data required | `agreement_acceptance`, `bank_detail_version`, `customer_servicing`, `document`, `notification`, `order`, `participant`, `participant_type`, `participant_type_assignment`, `position`, `position_ownership`, `relationship`, `tax_profile` |
| Permissions | participant.read; unmask needs extra permission |
| Navigation destinations | SC-07, SC-06, SC-43, SC-18 |
| Related requirements | FR-PAR-001, FR-PAR-002, FR-PAR-005, FR-PAR-006, FR-GEN-001, FR-CRM-001, FR-CRM-002, FR-PAY-005, FR-TAX-001 |
| Wireframe | `wireframes/SC-09.svg` |

### SC-10 — Compliance reports

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Compliance officer; Executive |
| Business objective | Defensible numbers from transaction data |
| User goal | Produce and read R1 to R5 for a period |
| Entry point | Nav Compliance; overlay home |
| Primary action | Create snapshot |
| Secondary actions | Open figure; export; compare periods |
| Information displayed | Figures with populations, method notes, data-quality warnings, trend |
| Components | Period selector; figure cards; charts; method drawer; snapshot list |
| Data required | `compliance_figure`, `compliance_report_snapshot` |
| Permissions | compliance.read; snapshot.create |
| Navigation destinations | SC-26, SC-46 |
| Related requirements | FR-CPL-001, FR-CPL-002, FR-CPL-003, FR-CPL-004, FR-CPL-005, FR-CPL-006 |
| Wireframe | `wireframes/SC-10.svg` |

### SC-11 — Guardrails and overrides log

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Compliance officer |
| Business objective | Visible platform policy decisions |
| User goal | Review decisions and overrides |
| Entry point | Nav Compliance |
| Primary action | Approve override |
| Secondary actions | Filter by outcome |
| Information displayed | Decisions with rule id, basis status, outcome, version; overrides with justification |
| Components | Table; detail drawer |
| Data required | `guardrail_decision`, `guardrail_rule` |
| Permissions | guardrail.read; override.approve |
| Navigation destinations | SC-04 |
| Related requirements | FR-CPL-007, FR-CPL-008 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-12 — Tax configuration and year-end forms

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Finance manager |
| Business objective | Meet withholding and reporting duties |
| User goal | Review rules; produce forms |
| Entry point | Nav Tax |
| Primary action | Generate forms |
| Secondary actions | Fix missing tax ids; export |
| Information displayed | Rules with effective dates and basis status; year totals; missing ids |
| Components | Rules table; year-end wizard; validation list |
| Data required | `posting`, `tax_form`, `tax_line`, `tax_rule` |
| Permissions | tax.read; tax.forms |
| Navigation destinations | SC-09 |
| Related requirements | FR-TAX-002, FR-TAX-003 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-13 — Integrations and sync health

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Tenant admin; Integration developer |
| Business objective | Runs never start on partial data |
| User goal | See health and fix connections |
| Entry point | Nav Settings › Integrations |
| Primary action | Re-authorise / Create key |
| Secondary actions | Backfill; view differences; manage webhooks; export schedule |
| Information displayed | Connectors and providers with state, lag, errors; API keys; webhooks; exports |
| Components | Status cards; tables; key creation modal |
| Data required | `api_key`, `audit_event`, `document`, `export_job`, `inbound_event`, `order`, `order_line`, `payout_instruction`, `product_volume_map`, `provider_config`, `tenant`, `webhook_delivery`, `webhook_endpoint` |
| Permissions | integration.manage |
| Navigation destinations | SC-01, SC-17 |
| Related requirements | FR-IAM-006, FR-ORD-001, FR-ORD-002, FR-PAY-002, FR-PAY-006, FR-INT-001, FR-INT-002, FR-INT-003, FR-INT-004 |
| Wireframe | `wireframes/SC-13.svg` |

### SC-14 — Vendor access sessions

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Tenant admin |
| Business objective | Vendor cannot access data silently |
| User goal | Decide requests and read session reports |
| Entry point | Notification; nav Settings › Vendor access |
| Primary action | Approve / Deny |
| Secondary actions | Set duration; end session now |
| Information displayed | Requests with reason, scope; active sessions; session logs |
| Components | Request cards; log table |
| Data required | `audit_event`, `support_session` |
| Permissions | vendor_access.decide |
| Navigation destinations | SC-30 |
| Related requirements | FR-IAM-005 |
| Wireframe | `wireframes/SC-14.svg` |

### SC-15 — Privacy requests

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | DPO |
| Business objective | Honour rights within deadlines |
| User goal | Work requests to closure |
| Entry point | Nav Privacy |
| Primary action | Fulfil |
| Secondary actions | Verify identity; record retention basis |
| Information displayed | Requests with type, deadline, state |
| Components | Table with deadline indicators; case detail |
| Data required | `case`, `participant`, `privacy_request` |
| Permissions | privacy.manage |
| Navigation destinations | SC-06 |
| Related requirements | FR-PRV-001, FR-PRV-002, FR-PRV-003 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-16 — Migration workspace and parallel-run report

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Implementation consultant; Finance approver |
| Business objective | Safe switching |
| User goal | Import history and prove equal pay |
| Entry point | Implementation menu |
| Primary action | Run comparison / Sign off |
| Secondary actions | Upload extracts; map; classify differences |
| Information displayed | Import steps and validation; per-payee differences by class |
| Components | Stepper; validation list; difference table; sign-off bar |
| Data required | `approval`, `import_batch`, `journal_entry`, `qualification_state`, `relationship`, `simulation` |
| Permissions | migration.manage; signoff |
| Navigation destinations | SC-42, SC-04 |
| Related requirements | FR-MIG-001, FR-MIG-002 |
| Wireframe | `wireframes/SC-16.svg` |

### SC-17 — Market launch checklist

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Tenant admin; Compliance officer |
| Business objective | No launch before blockers are cleared |
| User goal | Complete items and go live |
| Entry point | Nav Settings › Markets |
| Primary action | Request go-live / Sign off |
| Secondary actions | Attach evidence |
| Information displayed | Items with owner, evidence, basis status, state |
| Components | Checklist; evidence uploader; sign-off bar |
| Data required | `approval`, `document`, `guardrail_rule`, `market`, `provider_config`, `tax_rule` |
| Permissions | market.manage; market.signoff |
| Navigation destinations | SC-13, SC-12, SC-29 |
| Related requirements | FR-TEN-004, FR-CPL-012, FR-PAY-006 |
| Wireframe | `wireframes/SC-17.svg` |

### SC-18 — Distributor: statements and line explanation

| Field | Content |
|---|---|
| Module / area | Distributor |
| Release | MVP-B |
| Target persona | Distributor |
| Business objective | Trust in pay |
| User goal | Understand what I was paid and why |
| Entry point | Portal home; notification |
| Primary action | Open line explanation |
| Secondary actions | Download; dispute line; switch period |
| Information displayed | Gross, withholding, clawbacks, adjustments, net, payout status, per position groups, disclosure link |
| Components | Period picker; summary block; grouped line list; explanation sheet |
| Data required | `case`, `ledger_account`, `notification`, `posting`, `result_line`, `statement`, `tax_line` |
| Permissions | self only |
| Navigation destinations | SC-37, SC-19, SC-22 |
| Related requirements | FR-FIN-002, FR-CAS-003, FR-DIST-001, FR-DIST-002, FR-DIST-007 |
| Wireframe | `wireframes/SC-18.svg` |

### SC-19 — Distributor: rank status

| Field | Content |
|---|---|
| Module / area | Distributor |
| Release | MVP-B |
| Target persona | Distributor |
| Business objective | Fewer rank disputes |
| User goal | Know where I stand (facts only) |
| Entry point | Portal nav Rank |
| Primary action | — |
| Secondary actions | View history |
| Information displayed | Paid-as rank, titles, requirements with measured values, grace status |
| Components | Status block; requirement list; history list |
| Data required | `qualification_state` |
| Permissions | self only |
| Navigation destinations | SC-18 |
| Related requirements | FR-COMP-004, FR-DIST-003 |
| Wireframe | `wireframes/SC-19.svg` |

### SC-20 — Distributor: team

| Field | Content |
|---|---|
| Module / area | Distributor |
| Release | MVP-B |
| Target persona | Team leader |
| Business objective | Coaching within privacy limits |
| User goal | Find and view team members |
| Entry point | Portal nav Team |
| Primary action | Search |
| Secondary actions | Expand branch |
| Information displayed | Permitted fields by depth; aggregates beyond |
| Components | Search; lazy list tree; limited-data notice |
| Data required | `order`, `path_node`, `tenant_setting_version` |
| Permissions | self downline |
| Navigation destinations | SC-37 |
| Related requirements | FR-GEN-006, FR-GEN-007, FR-DIST-004, FR-DIST-009 |
| Wireframe | `wireframes/SC-20.svg` |

### SC-21 — Distributor: my customers

| Field | Content |
|---|---|
| Module / area | Distributor |
| Release | MVP-B |
| Target persona | Distributor |
| Business objective | Customer-centred activity |
| User goal | See who I serve and who reordered |
| Entry point | Portal nav Customers |
| Primary action | Filter |
| Secondary actions | Open customer |
| Information displayed | Customers with last order, repeat indicator; reassigned history |
| Components | List; filter chips |
| Data required | `customer_servicing`, `order`, `participant` |
| Permissions | self only |
| Navigation destinations | SC-37 |
| Related requirements | FR-CRM-001, FR-CRM-003, FR-DIST-005 |
| Wireframe | `wireframes/SC-21.svg` |

### SC-22 — Distributor: bank details and tax profile

| Field | Content |
|---|---|
| Module / area | Distributor |
| Release | MVP-B |
| Target persona | Distributor |
| Business objective | Safe self-service |
| User goal | Keep payment and tax details correct |
| Entry point | Portal nav Profile |
| Primary action | Save change (re-authenticate) |
| Secondary actions | View history |
| Information displayed | Masked details; cooling-off status; tax profile |
| Components | Masked fields; form; status banner |
| Data required | `bank_detail_version`, `notification`, `tax_profile` |
| Permissions | self only, fresh authentication |
| Navigation destinations | SC-38 |
| Related requirements | FR-PAY-005, FR-TAX-001, FR-DIST-006 |
| Wireframe | `wireframes/SC-22.svg` |

### SC-23 — Earnings disclosure builder

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | V1 |
| Target persona | Compliance officer |
| Business objective | Substantiated claims |
| User goal | Draft and publish a disclosure |
| Entry point | Nav Compliance |
| Primary action | Publish |
| Secondary actions | Preview; compare versions |
| Information displayed | Snapshot figures; template; versions |
| Components | Editor; preview; version list |
| Data required | `compliance_report_snapshot`, `document` |
| Permissions | disclosure.publish |
| Navigation destinations | SC-40, SC-10 |
| Related requirements | FR-CPL-009, FR-CPL-011 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-24 — Data imports

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Implementation consultant |
| Business objective | Clean, minimal data in |
| User goal | Upload, validate and load an export |
| Entry point | Overlay nav Data |
| Primary action | Upload files / Load |
| Secondary actions | Download error report; view batches |
| Information displayed | Batches with state, counts, control totals; validation errors |
| Components | Upload zone; batch table; validation report |
| Data required | `cpl_fact_order`, `cpl_fact_participant`, `cpl_fact_payout_line`, `import_batch`, `import_row_error` |
| Permissions | import.manage |
| Navigation destinations | SC-25, SC-10 |
| Related requirements | FR-IMP-001, FR-IMP-003, FR-IMP-004 |
| Wireframe | `wireframes/SC-24.svg` |

### SC-25 — Import mapping

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Compliance officer; Implementation consultant |
| Business objective | Visible judgement behind the numbers |
| User goal | Map source codes to platform categories |
| Entry point | From SC-24 |
| Primary action | Approve mapping |
| Secondary actions | Add note |
| Information displayed | Distinct values with counts; target category; version history |
| Components | Mapping table; version selector |
| Data required | `import_mapping` |
| Permissions | mapping.edit; mapping.approve |
| Navigation destinations | SC-24, SC-10 |
| Related requirements | FR-IMP-002 |
| Wireframe | `wireframes/SC-25.svg` |

### SC-26 — Figure drill-down

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Compliance officer |
| Business objective | Evidence behind each figure |
| User goal | See population and rows |
| Entry point | From SC-10 |
| Primary action | Export (logged) |
| Secondary actions | Page; filter |
| Information displayed | Definition; numerator and denominator rows; sums |
| Components | Definition panel; paged table |
| Data required | `audit_event`, `compliance_figure`, `compliance_report_snapshot`, `export_job` |
| Permissions | compliance.read; export |
| Navigation destinations | SC-10 |
| Related requirements | FR-CPL-006, FR-AUD-002 |
| Wireframe | `wireframes/SC-26.svg` |

### SC-27 — Sign-in and second factor

| Field | Content |
|---|---|
| Module / area | Shared |
| Release | MVP-A |
| Target persona | All |
| Business objective | Only authorised access |
| User goal | Sign in |
| Entry point | Tenant URL |
| Primary action | Sign in |
| Secondary actions | Enrol factor; recover |
| Information displayed | Credential fields; factor prompt |
| Components | Form |
| Data required | `approval`, `audit_event`, `participant`, `user_account` |
| Permissions | public |
| Navigation destinations | role home |
| Related requirements | FR-IAM-001, FR-IAM-002, FR-IAM-007 |
| Wireframe | `wireframes/SC-27.svg` |

### SC-28 — Users and roles

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Tenant admin |
| Business objective | Least privilege |
| User goal | Invite and scope colleagues |
| Entry point | Nav Settings › Users |
| Primary action | Invite / Assign role |
| Secondary actions | Approve privileged grant; deactivate |
| Information displayed | Users with roles, scopes, MFA state; role permission matrix; pending approvals |
| Components | Table; role editor; permission matrix |
| Data required | `approval`, `audit_event`, `role`, `role_assignment` |
| Permissions | user.manage |
| Navigation destinations | SC-30 |
| Related requirements | FR-IAM-003 |
| Wireframe | `wireframes/SC-28.svg` |

### SC-29 — Tenant settings

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Tenant admin |
| Business objective | Reproducible configuration |
| User goal | Change a setting with history |
| Entry point | Nav Settings |
| Primary action | Save with effective date |
| Secondary actions | View versions; request approval |
| Information displayed | Markets, brands, calendars, participant types, policies (rounding, clawback, visibility, thresholds), breach contacts |
| Components | Section list; forms; version history drawer |
| Data required | `approval`, `brand`, `calendar`, `market`, `period`, `tenant_setting_version` |
| Permissions | settings.manage |
| Navigation destinations | SC-17, SC-13 |
| Related requirements | FR-TEN-002, FR-TEN-003, FR-PRV-004 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-30 — Audit log

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Compliance officer; Tenant admin |
| Business objective | Investigation and attestation |
| User goal | Find who did what |
| Entry point | Nav Settings › Audit |
| Primary action | Search |
| Secondary actions | Open event; export |
| Information displayed | Events with actor, action, object, time |
| Components | Filter bar; table; event drawer |
| Data required | `audit_event`, `export_job`, `outbox_event` |
| Permissions | audit.read |
| Navigation destinations | — |
| Related requirements | FR-AUD-001, FR-AUD-002 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-31 — Orders and returns (ingested)

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Support agent; Commission analyst |
| Business objective | See the facts pay is based on |
| User goal | Find an order and its fixed facts |
| Entry point | Nav Orders |
| Primary action | Search |
| Secondary actions | Open order; saved views |
| Information displayed | Orders with buyer type, purpose, attribution, volumes, period, events |
| Components | Filterable table; order detail with event timeline |
| Data required | `inbound_event`, `late_transaction`, `order`, `order_event`, `order_line`, `product_volume_map`, `user_account` |
| Permissions | order.read |
| Navigation destinations | SC-09, SC-32 |
| Related requirements | FR-ORD-001, FR-ORD-003, FR-ORD-004, FR-ORD-006, FR-RPT-002 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-32 — Late-transaction queue

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Commission analyst |
| Business objective | Nothing lost after commit |
| User goal | Decide handling of late items |
| Entry point | From SC-01 |
| Primary action | Accept default (bulk with preview) |
| Secondary actions | Raise restatement |
| Information displayed | Items with original period, effect estimate, proposed handling |
| Components | Table; bulk bar; preview modal |
| Data required | `late_transaction` |
| Permissions | late.manage |
| Navigation destinations | SC-06, SC-01 |
| Related requirements | FR-ORD-005 |
| Wireframe | `wireframes/SC-32.svg` |

### SC-33 — Ledger and journal export

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Finance manager |
| Business objective | Prove totals |
| User goal | Inspect postings and export |
| Entry point | Nav Finance |
| Primary action | Generate export |
| Secondary actions | Open account; receivables ageing; propose write-off |
| Information displayed | Accounts with balances; postings; exports; receivables |
| Components | Account table; postings table; export panel |
| Data required | `case`, `credit_type`, `export_job`, `fx_rate`, `journal_entry`, `ledger_account`, `posting`, `result_line`, `user_account` |
| Permissions | ledger.read; export |
| Navigation destinations | SC-06, SC-34 |
| Related requirements | FR-FIN-001, FR-FIN-002, FR-FIN-003, FR-FIN-004, FR-FIN-005, FR-FIN-006, FR-FIN-007, FR-RPT-002 |
| Wireframe | `wireframes/SC-33.svg` |

### SC-34 — Payout reconciliation and returned payments

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Payout officer |
| Business objective | Nobody paid twice or not at all |
| User goal | Resolve exceptions |
| Entry point | Nav Payouts › Reconciliation |
| Primary action | Resolve item |
| Secondary actions | Open case; import report |
| Information displayed | Settled, returned, failed, unmatched with amounts |
| Components | Summary cards; exception table |
| Data required | `case`, `inbound_event`, `payout_instruction`, `posting` |
| Permissions | payout.reconcile |
| Navigation destinations | SC-03, SC-06 |
| Related requirements | FR-PAY-004 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-35 — Executive overview

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Executive |
| Business objective | Owner visibility |
| User goal | See the business with definitions |
| Entry point | Sign-in landing for executives |
| Primary action | Change period or market |
| Secondary actions | Open definition; open compliance |
| Information displayed | Sales, active earners, payout share of sales, retail share, by market |
| Components | KPI cards; trend charts; market table |
| Data required | `compliance_report_snapshot`, `run` |
| Permissions | dashboard.exec |
| Navigation destinations | SC-10 |
| Related requirements | FR-RPT-001 |
| Wireframe | `wireframes/SC-35.svg` |

### SC-36 — Global search

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Support agent |
| Business objective | Fast answers |
| User goal | Find person, order, statement |
| Entry point | Header search |
| Primary action | Search |
| Secondary actions | — |
| Information displayed | Grouped results with masked fields |
| Components | Command palette; result groups |
| Data required | `user_account` |
| Permissions | by role |
| Navigation destinations | SC-09, SC-31 |
| Related requirements | FR-RPT-002 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-37 — Distributor home (mobile)

| Field | Content |
|---|---|
| Module / area | Distributor |
| Release | MVP-B |
| Target persona | Distributor |
| Business objective | Clear starting point |
| User goal | See latest pay and status |
| Entry point | Portal sign-in |
| Primary action | Open latest statement |
| Secondary actions | Notifications; rank; customers |
| Information displayed | Latest net pay and payout status; rank; alerts (cooling-off, dispute update) |
| Components | Summary cards; bottom navigation |
| Data required | `notification`, `participant`, `result_line`, `statement`, `tax_line`, `user_account` |
| Permissions | self only |
| Navigation destinations | SC-18, SC-19, SC-21, SC-38 |
| Related requirements | FR-IAM-007, FR-DIST-001, FR-DIST-007 |
| Wireframe | `wireframes/SC-37.svg` |

### SC-38 — Distributor notifications and profile

| Field | Content |
|---|---|
| Module / area | Distributor |
| Release | MVP-B |
| Target persona | Distributor |
| Business objective | Reach the person for security and pay notices |
| User goal | Read notices; set language and channels |
| Entry point | Portal nav More |
| Primary action | — |
| Secondary actions | Change language; channel preferences |
| Information displayed | Inbox; preferences |
| Components | List; toggles |
| Data required | `notification`, `outbox_event` |
| Permissions | self only |
| Navigation destinations | SC-22 |
| Related requirements | FR-DIST-008 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-39 — Vendor operations console

| Field | Content |
|---|---|
| Module / area | Vendor |
| Release | MVP-A |
| Target persona | Vendor ops |
| Business objective | Operate without standing access |
| User goal | See tenant health; request access |
| Entry point | Vendor sign-in |
| Primary action | Request support session |
| Secondary actions | Provision tenant; maintain market packs |
| Information displayed | Tenants with region, tier, state, job health; session requests |
| Components | Table; request modal; provisioning wizard |
| Data required | `audit_event`, `export_job`, `support_session`, `tenant`, `tenant_setting_version` |
| Permissions | vendor roles |
| Navigation destinations | — |
| Related requirements | FR-IAM-005, FR-TEN-001, FR-TEN-005, FR-OPS-001 |
| Wireframe | `wireframes/SC-39.svg` |

### SC-40 — Public earnings disclosure page

| Field | Content |
|---|---|
| Module / area | Public |
| Release | V1 |
| Target persona | Prospect; Distributor |
| Business objective | Honest expectations |
| User goal | Read the current disclosure |
| Entry point | Link from statements and tenant site |
| Primary action | — |
| Secondary actions | Change language |
| Information displayed | Published disclosure version |
| Components | Static page |
| Data required | `compliance_report_snapshot`, `document` |
| Permissions | public |
| Navigation destinations | — |
| Related requirements | FR-CPL-009 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-41 — Public privacy request form

| Field | Content |
|---|---|
| Module / area | Public |
| Release | MVP-B |
| Target persona | Any data subject |
| Business objective | Rights without an account |
| User goal | Submit a request |
| Entry point | Link on tenant site |
| Primary action | Submit |
| Secondary actions | — |
| Information displayed | Request type; identity details |
| Components | Form |
| Data required | `case`, `privacy_request` |
| Permissions | public, rate limited |
| Navigation destinations | — |
| Related requirements | FR-PRV-001 |
| Wireframe | `wireframes/SC-41.svg` |

### SC-42 — Simulation results and golden datasets

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Plan administrator; Implementation consultant |
| Business objective | Proof before activation |
| User goal | Read impact; maintain golden cases |
| Entry point | From SC-04 |
| Primary action | Run simulation |
| Secondary actions | Export; add golden case |
| Information displayed | Totals v1 vs v2; distribution of change; payee table; golden pass or fail |
| Components | KPI cards; histogram; table; golden list |
| Data required | `golden_dataset`, `result_line`, `simulation` |
| Permissions | plan.simulate |
| Navigation destinations | SC-04, SC-44 |
| Related requirements | FR-PLN-005, FR-PLN-006 |
| Wireframe | `wireframes/SC-42.svg` |

### SC-43 — Rank and qualification detail (staff)

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Commission analyst; Support agent |
| Business objective | Rank disputes resolved with facts |
| User goal | Read state for any period |
| Entry point | From SC-09 |
| Primary action | — |
| Secondary actions | Compare periods |
| Information displayed | Paid-as, titles, counters, carry, flags per period with source run |
| Components | Period table; diff highlight |
| Data required | `qualification_state` |
| Permissions | participant.read |
| Navigation destinations | SC-09 |
| Related requirements | FR-COMP-004 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-44 — Plan change workflow

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-B |
| Target persona | Plan administrator; Compliance officer |
| Business objective | Governed change |
| User goal | Move a version to activation |
| Entry point | From SC-04 |
| Primary action | Approve / Schedule |
| Secondary actions | Record filing; set notice |
| Information displayed | Checklist: simulation, guardrails, filing per market, notice, transition rules |
| Components | Stepper; checklist; approval bar |
| Data required | `approval`, `document`, `plan_transition`, `plan_version`, `qualification_state` |
| Permissions | plan.approve |
| Navigation destinations | SC-04, SC-42 |
| Related requirements | FR-PLN-007, FR-PLN-008 |
| Wireframe | `wireframes/SC-44.svg` |

### SC-45 — Integrity signals

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | V1 |
| Target persona | Compliance officer |
| Business objective | Indicators for investigation |
| User goal | Review flags |
| Entry point | Nav Compliance |
| Primary action | Open case |
| Secondary actions | Set thresholds |
| Information displayed | Flags with evidence |
| Components | Table |
| Data required | `integrity_signal` |
| Permissions | compliance.read |
| Navigation destinations | SC-06 |
| Related requirements | FR-CPL-010 |
| Wireframe | Not drawn; behaviour specified here and in WF-02 |

### SC-46 — Compliance overview (overlay home)

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | MVP-A |
| Target persona | Compliance officer; Executive |
| Business objective | The demand test's first screen |
| User goal | See headline indicators and data status |
| Entry point | Sign-in landing in MVP-A |
| Primary action | Create snapshot |
| Secondary actions | Open reports; open imports |
| Information displayed | Latest R1 to R5 headline figures; data coverage; warnings |
| Components | KPI cards; trend sparkline; data status panel |
| Data required | `compliance_figure`, `compliance_report_snapshot`, `run` |
| Permissions | compliance.read |
| Navigation destinations | SC-10, SC-24 |
| Related requirements | FR-CPL-001, FR-RPT-001 |
| Wireframe | `wireframes/SC-46.svg` |

### SC-47 — Licence, updates and diagnostics (self-hosted edition)

| Field | Content |
|---|---|
| Module / area | Admin |
| Release | V1 |
| Target persona | Licensee administrator |
| Business objective | Keep a self-hosted installation correct and current |
| User goal | See entitlement, apply updates, check health |
| Entry point | Nav Settings › System |
| Primary action | Apply update (second approver) |
| Secondary actions | Load licence; run diagnostics; generate support bundle |
| Information displayed | Entitlement state and limits; installed versions; available updates and advisories; health checks; last backup and restore test |
| Components | Status cards; update list with check results; diagnostics table |
| Data required | `license_entitlement`, `update_log` |
| Permissions | system.manage |
| Navigation destinations | SC-30 |
| Related requirements | FR-LIC-001, FR-LIC-002, FR-LIC-003 |
| Wireframe | `wireframes/SC-47.svg` |

## 4. States every screen must handle

The state matrix (initial, loading, empty, success, error, validation, permission denied, disabled, partial data, offline) is specified once in `02_WIREFRAMING_SPECIFICATION.md` §3 and applied per screen there.
