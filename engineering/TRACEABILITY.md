# Requirement Traceability

Generated from `spec.json`. Status column is maintained by hand as work lands: `-` not started · `I` implemented · `T` tested (unit+integration) · `V` verified in browser.

## Release A (18)

| FR | Title | Stories | ACs | Rules | Tests | Screens | APIs | Tables | Status |
|---|---|---|---|---|---|---|---|---|---|
| FR-IAM-001 | Tenant-scoped authentication and sessions | US-35 | AC-35.1 AC-35.2 | BR-SEC-04 | TS-21 TS-35 | SC-27 | API-07 | user_account audit_event | - |
| FR-IAM-002 | Multi-factor authentication for privileged roles | US-35 | AC-35.1 AC-35.2 | BR-SEC-02 | TS-35 | SC-27 | API-07 | user_account approval | - |
| FR-IAM-003 | Roles, permissions and attribute scopes | US-36 | AC-36.1 AC-36.2 | BR-SEC-05 | TS-36 | SC-28 | API-40 | role role_assignment approval audit_event | - |
| FR-IAM-005 | Vendor support sessions | US-29 | AC-29.1 AC-29.2 AC-29.3 | BR-SEC-01 | TS-21 TS-37 | SC-14 SC-39 | API-08 | support_session audit_event | - |
| FR-TEN-001 | Tenant provisioning and data region | US-31 | AC-31.1 | BR-DAT-09 | TS-57 | SC-39 | API-39 | tenant tenant_setting_version | - |
| FR-IMP-001 | Export upload and schema validation | US-39 | AC-39.1 AC-39.2 AC-39.3 | BR-IMP-01 BR-IMP-02 | TS-32 TS-33 | SC-24 | API-01 API-02 | import_batch import_row_error | - |
| FR-IMP-002 | Value mapping with versions | US-40 | AC-40.1 | BR-IMP-03 BR-PTY-01 | TS-31 TS-33 | SC-25 | API-03 | import_mapping | - |
| FR-IMP-003 | Import batch lifecycle and data-quality report | US-39 | AC-39.1 AC-39.2 AC-39.3 | BR-IMP-04 | TS-32 TS-33 | SC-24 | API-01 API-02 | import_batch cpl_fact_participant cpl_fact_order cpl_fact_payout_line | - |
| FR-CPL-001 | Retail-customer share report (R1) | US-24 | AC-24.1 AC-24.2 | BR-GRD-04 BR-CPL-01 | TS-31 TS-59 | SC-10 SC-46 | API-04 API-05 | compliance_report_snapshot compliance_figure | - |
| FR-CPL-002 | Personal-use share of rewarded volume (R2) | US-24 | AC-24.1 AC-24.2 | BR-GRD-03 BR-CAP-02 | TS-09 TS-26 TS-31 TS-59 | SC-10 | API-04 API-05 | compliance_report_snapshot compliance_figure | - |
| FR-CPL-003 | Payout source mix (R3) | US-24 | AC-24.1 AC-24.2 | BR-GRD-04 | TS-31 TS-59 | SC-10 | API-04 API-05 | compliance_report_snapshot compliance_figure | - |
| FR-CPL-004 | Qualification-by-purchase and period-end threshold orders (R4) | US-24 | AC-24.1 AC-24.2 | BR-GRD-03 | TS-26 TS-31 TS-59 | SC-10 | API-04 API-05 | compliance_report_snapshot compliance_figure | - |
| FR-CPL-005 | Earnings distribution over all participants (R5) | US-25 | AC-25.1 AC-25.2 | BR-GRD-04 BR-HON-01 | TS-31 TS-53 TS-59 | SC-10 | API-04 API-05 | compliance_report_snapshot compliance_figure | - |
| FR-CPL-006 | Report snapshots, method versions and drill-down | US-41 | AC-41.1 | BR-CPL-01 | TS-31 TS-34 | SC-10 SC-26 | API-04 API-05 API-06 | compliance_report_snapshot compliance_figure | - |
| FR-PRV-004 | Breach-notification contacts and runbook data | US-53 | AC-53.1 | BR-DAT-07 | TS-50 | SC-29 | API-39 | tenant_setting_version | - |
| FR-AUD-001 | Immutable audit log | US-54 | AC-54.1 AC-54.2 | BR-SEC-07 | TS-34 TS-56 | SC-30 | API-09 | audit_event outbox_event | - |
| FR-AUD-002 | Export limits and logging | US-54 | AC-54.1 AC-54.2 | BR-SEC-03 | TS-34 TS-56 | SC-30 SC-26 | API-06 | export_job audit_event | - |
| FR-OPS-001 | Vendor operations console | US-57 | AC-57.1 | BR-SEC-01 | TS-37 | SC-39 | API-08 | tenant support_session | - |

## Release B (81)

| FR | Title | Stories | ACs | Rules | Tests | Screens | APIs | Tables | Status |
|---|---|---|---|---|---|---|---|---|---|
| FR-IAM-004 | Separation of duties | US-07 | AC-07.1 AC-07.2 | BR-ADJ-02 BR-SEC-06 | TS-35 TS-42 | SC-02 SC-03 | API-20 API-25 | approval | - |
| FR-IAM-006 | API keys and service accounts | US-22 | AC-22.1 AC-22.2 AC-22.3 | BR-SEC-03 | TS-13 TS-15 TS-34 TS-59 | SC-13 | API-10 | api_key audit_event | - |
| FR-IAM-007 | Distributor sign-in | US-12 | AC-12.1 | BR-PAY-08 | TS-17 TS-53 | SC-27 SC-37 | API-07 | user_account participant | - |
| FR-TEN-002 | Markets, brands, currencies and calendars | US-37 | AC-37.1 | BR-PER-01 | TS-59 TS-62 | SC-29 | API-39 | market brand calendar period | - |
| FR-TEN-003 | Versioned tenant settings | US-37 | AC-37.1 | BR-MNY-02 | TS-06 TS-59 | SC-29 | API-39 | tenant_setting_version approval | - |
| FR-TEN-004 | Market launch checklist | US-38 | AC-38.1 AC-38.2 | BR-PAY-11 BR-REG-04 | TS-50 | SC-17 | API-39 | market document provider_config approval | - |
| FR-CPL-007 | Platform guardrails | US-26 | AC-26.1 AC-26.2 | BR-GRD-01 BR-GRD-02 BR-GRD-03 BR-GRD-04 | TS-26 TS-27 TS-31 TS-66 | SC-04 SC-11 | API-16 | guardrail_rule guardrail_decision | - |
| FR-CPL-008 | Guardrail overrides log | US-26 | AC-26.1 AC-26.2 | BR-GRD-05 | TS-26 TS-27 TS-66 | SC-11 | API-16 | guardrail_decision | - |
| FR-CPL-012 | Rule basis status in configuration | US-38 | AC-38.1 AC-38.2 | BR-CPL-03 | TS-50 | SC-17 | API-39 | guardrail_rule tax_rule | - |
| FR-PAR-001 | Participant record and effective-dated participant types | US-21 | AC-21.1 AC-21.2 | BR-PTY-01 BR-PTY-02 | TS-31 TS-48 | SC-09 | API-12 | participant participant_type participant_type_assignment | - |
| FR-PAR-002 | Enrolment intake with market gating | US-42 | AC-42.1 AC-42.2 | BR-REG-04 | TS-45 TS-50 TS-59 | SC-09 | API-12 | participant position relationship agreement_acceptance | - |
| FR-PAR-003 | Duplicate-account detection queue | US-43 | AC-43.1 | BR-GEN-09 | TS-59 | SC-08 | API-30 | case participant | - |
| FR-PAR-005 | Participant and position status lifecycle | US-23 | AC-23.1 | BR-GEN-07 BR-GEN-11 | TS-02 TS-49 TS-64 | SC-09 | API-12 | participant position | - |
| FR-PAR-006 | Agreement versions and acceptance records | US-42 | AC-42.1 AC-42.2 | BR-REG-05 | TS-45 TS-46 TS-59 | SC-09 | API-12 | document agreement_acceptance | - |
| FR-GEN-001 | Positions separate from participants | US-04 | AC-04.1 AC-04.2 | BR-GEN-01 | TS-22 TS-53 | SC-09 SC-07 | API-12 | position position_ownership | - |
| FR-GEN-002 | Effective-dated sponsor and placement relationships | US-01 | AC-01.1 AC-01.2 | BR-GEN-02 BR-GEN-03 BR-GEN-04 | TS-03 TS-61 | SC-07 | API-14 API-15 | relationship | - |
| FR-GEN-003 | Tree as of a date and as known at a time | US-01 | AC-01.1 AC-01.2 | BR-GEN-02 | TS-03 TS-61 | SC-07 | API-14 | relationship path_node | - |
| FR-GEN-004 | Genealogy change and correction cases | US-02 US-03 | AC-02.1 AC-02.2 AC-03.1 AC-03.2 | BR-GEN-03 BR-GEN-04 BR-GEN-05 | TS-03 TS-45 TS-59 TS-61 | SC-08 | API-15 | case relationship | - |
| FR-GEN-005 | Serialised placement for binary and matrix plans | US-42 | AC-42.1 AC-42.2 | BR-GEN-06 | TS-45 TS-59 | SC-07 | API-12 | relationship | - |
| FR-GEN-006 | Downline visibility policy enforced on the server | US-05 | AC-05.1 AC-05.2 | BR-DAT-03 BR-SEC-03 | TS-20 TS-34 | SC-20 | API-13 API-34 | path_node tenant_setting_version | - |
| FR-GEN-007 | Search-first genealogy explorer | US-05 | AC-05.1 AC-05.2 | BR-DAT-03 | TS-20 | SC-07 SC-20 | API-13 API-14 | path_node | - |
| FR-GEN-008 | Path read model and rebuild | US-05 | AC-05.1 AC-05.2 | BR-GEN-12 | TS-20 TS-64 | SC-07 | API-13 | path_node | - |
| FR-GEN-009 | Structure is never changed to implement a pay rule | US-44 | AC-44.1 AC-44.2 | BR-GEN-07 BR-GEN-08 | TS-01 TS-02 TS-64 | SC-04 | API-16 | plan_rule relationship | - |
| FR-ORD-001 | Order ingestion API with idempotency | US-22 | AC-22.1 AC-22.2 AC-22.3 | BR-ATT-02 BR-ORD-04 BR-ORD-01 BR-VOL-01 | TS-13 TS-15 TS-47 TS-48 TS-59 | SC-31 SC-13 | API-10 | order order_line inbound_event product_volume_map | - |
| FR-ORD-002 | Shopify and WooCommerce connectors | US-22 | AC-22.1 AC-22.2 AC-22.3 | BR-ORD-04 | TS-13 TS-15 TS-59 | SC-13 | API-10 API-37 | provider_config inbound_event | - |
| FR-ORD-003 | Purpose tag and fixed order facts | US-21 | AC-21.1 AC-21.2 | BR-PTY-03 BR-ATT-02 | TS-31 TS-48 TS-65 | SC-31 | API-10 | order order_line | - |
| FR-ORD-004 | Returns, refunds, chargebacks and exchanges | US-45 | AC-45.1 AC-45.2 | BR-RET-01 BR-RET-02 BR-RET-03 BR-REV-06 BR-VOL-03 | TS-47 TS-65 | SC-31 | API-11 | order_event late_transaction | - |
| FR-ORD-005 | Late-transaction queue | US-08 | AC-08.1 | BR-PER-04 | TS-13 | SC-32 | API-10 API-11 | late_transaction | - |
| FR-CRM-001 | Customer servicing relationship and attribution | US-23 | AC-23.1 | BR-ATT-01 BR-ATT-02 BR-ATT-04 | TS-48 TS-49 TS-65 | SC-09 SC-21 | API-35 | customer_servicing order | - |
| FR-CRM-002 | Customer reassignment on termination | US-23 | AC-23.1 | BR-ATT-03 | TS-49 | SC-09 | API-35 | customer_servicing | - |
| FR-PLN-001 | Plan versions | US-27 | AC-27.1 AC-27.2 | BR-CMP-01 BR-PLN-01 | TS-01 TS-24 TS-46 | SC-04 | API-16 | plan plan_version plan_rule | - |
| FR-PLN-002 | Declarative primitive library | US-44 | AC-44.1 AC-44.2 | BR-RNK-05 BR-RNK-06 BR-RNK-09 BR-PER-01 | TS-01 TS-02 TS-62 TS-63 | SC-04 | API-16 | plan_rule | - |
| FR-PLN-003 | Controlled extension point | US-44 | AC-44.1 AC-44.2 | BR-PLN-05 | TS-01 TS-02 TS-67 | SC-04 | API-16 | plan_rule | - |
| FR-PLN-004 | Caps and pools configuration | US-11 | AC-11.1 AC-11.2 | BR-CAP-01 BR-CAP-02 BR-CAP-03 BR-MNY-03 | TS-06 TS-07 TS-08 TS-09 TS-12 | SC-05 | API-16 API-17 | plan_rule simulation | - |
| FR-PLN-005 | Simulation and version comparison | US-10 | AC-10.1 AC-10.2 AC-10.3 | BR-PLN-02 | TS-46 TS-59 | SC-04 SC-42 | API-17 | simulation result_line | - |
| FR-PLN-006 | Golden datasets | US-10 | AC-10.1 AC-10.2 AC-10.3 | BR-PLN-06 | TS-43 TS-44 TS-46 TS-59 TS-60 | SC-42 | API-17 | golden_dataset | - |
| FR-PLN-007 | Plan-change governance | US-27 | AC-27.1 AC-27.2 | BR-PLN-02 BR-PLN-03 BR-PLN-04 | TS-24 TS-46 TS-68 | SC-44 | API-16 | plan_version approval document | - |
| FR-PLN-008 | Transition rules between versions | US-27 | AC-27.1 AC-27.2 | BR-PLN-01 BR-RNK-07 | TS-24 TS-25 TS-46 | SC-44 | API-16 | plan_transition qualification_state | - |
| FR-COMP-001 | Calendars and period lifecycle | US-06 | AC-06.1 AC-06.2 AC-06.3 | BR-PER-01 BR-PER-02 BR-PER-03 BR-PER-04 | TS-03 TS-13 TS-14 TS-58 TS-59 TS-60 TS-62 | SC-01 | API-18 | calendar period | - |
| FR-COMP-002 | Run execution with snapshot, lock and idempotency | US-06 | AC-06.1 AC-06.2 AC-06.3 | BR-PER-06 BR-CMP-01 | TS-01 TS-14 TS-29 TS-58 TS-59 | SC-01 | API-18 | run run_snapshot result_line | - |
| FR-COMP-003 | Multi-pass calculation order | US-14 | AC-14.1 AC-14.2 AC-14.3 | BR-CAP-02 BR-MNY-02 BR-TAX-02 | TS-06 TS-09 TS-38 TS-39 | SC-02 | API-18 | result_line | - |
| FR-COMP-004 | Qualification state across periods | US-46 | AC-46.1 AC-46.2 | BR-RNK-05 BR-RNK-06 BR-RNK-07 BR-RNK-08 BR-RNK-09 | TS-04 TS-05 TS-25 TS-59 TS-63 | SC-43 SC-19 | API-19 | qualification_state | - |
| FR-COMP-005 | Run review | US-06 | AC-06.1 AC-06.2 AC-06.3 | BR-PER-03 | TS-03 TS-14 TS-58 TS-59 TS-60 | SC-02 | API-19 | run result_line | - |
| FR-COMP-006 | Commit with second-person approval | US-07 | AC-07.1 AC-07.2 | BR-PER-03 BR-ADJ-02 | TS-03 TS-35 TS-42 TS-60 | SC-02 | API-20 | run period journal_entry posting approval outbox_event | - |
| FR-COMP-007 | Per-line provenance and trace | US-13 | AC-13.1 | BR-PAY-06 | TS-53 TS-59 | SC-02 SC-06 | API-21 | result_line run_snapshot | - |
| FR-COMP-008 | Replay of committed periods | US-01 | AC-01.1 AC-01.2 | BR-PER-03 | TS-03 TS-60 | SC-01 | API-18 | run run_snapshot | - |
| FR-COMP-009 | Restatement of a committed period | US-09 | AC-09.1 | BR-PER-05 | TS-51 | SC-06 | API-22 | restatement result_line case | - |
| FR-COMP-010 | Adjustment lines from late transactions and cases | US-08 | AC-08.1 | BR-PER-04 BR-ADJ-01 | TS-13 TS-42 | SC-02 | API-19 | result_line late_transaction | - |
| FR-COMP-012 | Money arithmetic | US-14 | AC-14.1 AC-14.2 AC-14.3 | BR-MNY-01 BR-MNY-02 BR-MNY-03 BR-MNY-04 BR-MNY-05 | TS-06 TS-07 TS-23 TS-38 TS-39 TS-67 | SC-02 | API-18 | result_line posting | - |
| FR-FIN-001 | Double-entry obligations ledger | US-14 | AC-14.1 AC-14.2 AC-14.3 | BR-LED-01 BR-LED-02 BR-MNY-04 | TS-06 TS-38 TS-39 TS-40 | SC-33 | API-23 | ledger_account journal_entry posting | - |
| FR-FIN-002 | Derived payee balances | US-14 | AC-14.1 AC-14.2 AC-14.3 | BR-LED-02 | TS-06 TS-38 TS-39 TS-40 | SC-33 SC-18 | API-23 API-28 | posting ledger_account | - |
| FR-FIN-003 | Clawback policy and receivables | US-20 | AC-20.1 AC-20.2 AC-20.3 | BR-REV-07 BR-REV-09 BR-REV-02 | TS-10 TS-11 | SC-06 SC-33 | API-22 API-23 | posting result_line | - |
| FR-FIN-004 | Write-off with approval | US-20 | AC-20.1 AC-20.2 AC-20.3 | BR-REV-08 | TS-10 TS-11 | SC-33 | API-30 | posting case | - |
| FR-FIN-005 | General-ledger journal export | US-15 | AC-15.1 | BR-LED-03 | TS-59 TS-67 | SC-33 | API-24 | export_job ledger_account | - |
| FR-PAY-001 | Payout batch lifecycle | US-47 | AC-47.1 AC-47.2 | BR-PAY-02 BR-ADJ-02 | TS-17 TS-40 TS-42 | SC-03 | API-25 | payout_batch payout_instruction approval | - |
| FR-PAY-002 | Provider adapters and bank-file fallback | US-16 | AC-16.1 AC-16.2 AC-16.3 | BR-PAY-11 | TS-16 TS-40 TS-41 TS-50 | SC-03 SC-13 | API-25 | provider_config payout_instruction | - |
| FR-PAY-003 | Signed, idempotent payout instructions through an outbox | US-16 | AC-16.1 AC-16.2 AC-16.3 | BR-PAY-10 | TS-16 TS-40 TS-41 | SC-03 | API-25 | payout_instruction outbox_event posting | - |
| FR-PAY-004 | Settlement reconciliation and returned payments | US-16 | AC-16.1 AC-16.2 AC-16.3 | BR-PAY-09 | TS-16 TS-40 TS-41 | SC-34 | API-26 | inbound_event payout_instruction posting case | - |
| FR-PAY-005 | Bank-detail versions and change controls | US-17 | AC-17.1 AC-17.2 | BR-PAY-08 | TS-17 TS-59 | SC-22 SC-09 | API-27 | bank_detail_version notification | - |
| FR-PAY-006 | Provider eligibility record | US-38 | AC-38.1 AC-38.2 | BR-PAY-11 | TS-50 | SC-17 SC-13 | API-39 | provider_config document | - |
| FR-PAY-007 | Minimum payout, holds and dormant balances | US-47 | AC-47.1 AC-47.2 | BR-PAY-12 | TS-17 TS-40 | SC-03 | API-25 | payout_batch case | - |
| FR-TAX-001 | Payee tax profile | US-48 | AC-48.1 | BR-TAX-01 BR-TAX-03 | TS-18 TS-19 TS-56 | SC-22 SC-09 | API-27 | tax_profile | - |
| FR-CAS-001 | Case framework | US-02 | AC-02.1 AC-02.2 | BR-ADJ-01 | TS-42 TS-45 | SC-06 SC-08 | API-30 | case case_event approval document | - |
| FR-CAS-002 | Manual adjustments with thresholds and second approver | US-49 | AC-49.1 AC-49.2 | BR-ADJ-01 BR-ADJ-02 BR-ADJ-03 | TS-42 TS-59 | SC-06 | API-30 | case approval | - |
| FR-CAS-003 | Commission dispute from a statement line | US-50 | AC-50.1 | BR-ADJ-04 | TS-59 TS-68 | SC-18 SC-06 | API-30 | case result_line | - |
| FR-DIST-001 | Distributor statement | US-04 | AC-04.1 AC-04.2 | BR-PAY-06 BR-HON-01 | TS-22 TS-53 | SC-18 SC-37 | API-28 | statement result_line tax_line | - |
| FR-DIST-002 | Line explanation | US-12 | AC-12.1 | BR-PAY-06 BR-DAT-03 | TS-20 TS-53 | SC-18 | API-29 | result_line | - |
| FR-DIST-003 | Rank status, factual | US-51 | AC-51.1 | BR-HON-01 BR-RNK-05 | TS-53 TS-63 | SC-19 | API-28 | qualification_state | - |
| FR-DIST-004 | Team view, privacy-limited | US-05 | AC-05.1 AC-05.2 | BR-DAT-03 | TS-20 | SC-20 | API-34 | path_node | - |
| FR-DIST-005 | My customers | US-52 | AC-52.1 | BR-ATT-01 | TS-49 | SC-21 | API-28 | customer_servicing order | - |
| FR-DIST-006 | Bank details and tax profile self-service | US-17 | AC-17.1 AC-17.2 | BR-PAY-08 | TS-17 TS-59 | SC-22 | API-27 | bank_detail_version tax_profile | - |
| FR-DIST-008 | Notifications | US-17 | AC-17.1 AC-17.2 | BR-PAY-08 BR-PLN-04 | TS-17 TS-59 TS-68 | SC-38 | API-28 | notification outbox_event | - |
| FR-PRV-001 | Data-subject requests | US-30 | AC-30.1 | BR-DAT-06 | TS-28 | SC-15 SC-41 | API-31 | privacy_request case | - |
| FR-PRV-002 | Erasure by pseudonymisation | US-30 | AC-30.1 | BR-DAT-06 | TS-28 | SC-15 | API-31 | participant privacy_request | - |
| FR-INT-001 | Public API and webhooks | US-22 | AC-22.1 AC-22.2 AC-22.3 | BR-SEC-03 | TS-13 TS-15 TS-34 TS-59 | SC-13 | API-10 API-33 | api_key webhook_endpoint webhook_delivery | - |
| FR-INT-002 | Integration and sync health | US-55 | AC-55.1 | BR-ORD-05 | TS-58 | SC-13 SC-01 | API-37 | provider_config inbound_event | - |
| FR-INT-003 | Scheduled export of the full tenant data model | US-32 | AC-32.1 | BR-DAT-12 | TS-58 | SC-13 | API-32 | export_job | - |
| FR-RPT-001 | Role dashboards | US-56 | AC-56.1 | BR-CPL-01 | TS-31 TS-58 | SC-35 SC-46 SC-01 | API-05 API-19 | compliance_report_snapshot run | - |
| FR-RPT-002 | Operational lists with saved views | US-56 | AC-56.1 | BR-SEC-03 | TS-34 TS-58 | SC-31 SC-33 SC-36 | API-23 | user_account | - |
| FR-MIG-001 | History import | US-28 | AC-28.1 AC-28.2 | BR-MIG-01 | TS-52 | SC-16 | API-38 | import_batch relationship qualification_state journal_entry | - |
| FR-MIG-002 | Parallel-run reconciliation | US-28 | AC-28.1 AC-28.2 | BR-MIG-02 | TS-52 | SC-16 | API-38 | simulation approval | - |

## Release B-MKT (4)

| FR | Title | Stories | ACs | Rules | Tests | Screens | APIs | Tables | Status |
|---|---|---|---|---|---|---|---|---|---|
| FR-CPL-013 | Market-pack registers |  |  | BR-ADJ-04 | TS-68 | SC-06 | API-30 | case | - |
| FR-TAX-002 | Withholding rules per market | US-18 US-19 | AC-18.1 AC-18.2 AC-19.1 | BR-TAX-01 BR-TAX-02 BR-TAX-03 | TS-18 TS-19 TS-38 TS-59 | SC-12 | API-39 | tax_rule tax_line posting | - |
| FR-TAX-003 | Year-end statements | US-18 | AC-18.1 AC-18.2 | BR-TAX-04 | TS-18 TS-38 TS-59 | SC-12 | API-36 | tax_form tax_line | - |
| FR-DIST-007 | Localisation and low-bandwidth delivery | US-34 | AC-34.1 | BR-LOC-01 | TS-30 TS-54 TS-55 | SC-18 SC-37 | API-28 | notification | - |

## Release V1 (19)

| FR | Title | Stories | ACs | Rules | Tests | Screens | APIs | Tables | Status |
|---|---|---|---|---|---|---|---|---|---|
| FR-TEN-005 | Tenant archive and offboarding |  |  | BR-DAT-10 |  | SC-39 | API-32 | tenant export_job | - |
| FR-IMP-004 | Read-only database connector |  |  | BR-IMP-01 | TS-32 | SC-24 | API-01 | import_batch | - |
| FR-CPL-009 | Earnings disclosure publication and substantiation | US-25 | AC-25.1 AC-25.2 | BR-HON-02 | TS-31 TS-59 | SC-23 SC-40 | API-05 | compliance_report_snapshot document | - |
| FR-CPL-010 | Integrity signals | US-33 | AC-33.1 | BR-GRD-03 | TS-26 TS-59 | SC-45 | API-05 | integrity_signal | - |
| FR-CPL-011 | Approved-claims catalogue and disclosure feed |  |  | BR-HON-02 |  | SC-23 | API-33 | document | - |
| FR-PAR-004 | Account types and ownership transfer |  |  | BR-GEN-10 |  | SC-08 | API-30 | position_ownership case | - |
| FR-ORD-006 | Subscription and dispute events |  |  | BR-REV-06 | TS-65 | SC-31 | API-11 | order_event | - |
| FR-CRM-003 | Distributor contacts and reminders |  |  | BR-DAT-08 |  | SC-21 | API-28 | participant | - |
| FR-COMP-011 | Provisional runs with true-up |  |  | BR-PER-07 |  | SC-01 | API-18 | run | - |
| FR-FIN-006 | Non-cash rewards ledger |  |  | BR-CRD-01 BR-CRD-02 |  | SC-33 | API-23 | credit_type posting | - |
| FR-FIN-007 | Multi-currency with effective-dated rates |  |  | BR-CMP-09 |  | SC-33 | API-23 | fx_rate | - |
| FR-DIST-009 | Leader dashboard on customers served |  |  | BR-HON-01 | TS-53 | SC-20 | API-34 | order | - |
| FR-PRV-003 | Retention timers |  |  | BR-DAT-11 |  | SC-15 | API-31 | privacy_request | - |
| FR-INT-004 | Read-only analytical replica for dedicated tenants |  |  | BR-DAT-12 | TS-58 | SC-13 | API-32 | tenant | - |
| FR-AI-001 | Run variance explainer |  |  | BR-AI-01 |  | SC-02 | API-19 | run | - |
| FR-AI-002 | Plan-document-to-configuration assistant (internal) |  |  | BR-AI-01 |  | SC-04 | API-16 | plan_rule | - |
| FR-LIC-001 | Licence entitlement for the self-hosted edition | US-58 | AC-58.1 AC-58.2 AC-58.3 AC-58.4 | BR-LIC-01 BR-LIC-02 BR-LIC-05 | TS-69 TS-70 TS-71 | SC-47 | API-41 | license_entitlement | - |
| FR-LIC-002 | Signed updates and market-pack distribution | US-58 | AC-58.1 AC-58.2 AC-58.3 AC-58.4 | BR-LIC-03 BR-CPL-03 | TS-50 TS-69 TS-70 TS-71 | SC-47 | API-41 | license_entitlement update_log | - |
| FR-LIC-003 | Self-hosted installation, diagnostics and support bundle | US-58 | AC-58.1 AC-58.2 AC-58.3 AC-58.4 | BR-SEC-01 BR-LIC-04 | TS-37 TS-69 TS-70 TS-71 | SC-47 | API-41 | license_entitlement update_log | - |
