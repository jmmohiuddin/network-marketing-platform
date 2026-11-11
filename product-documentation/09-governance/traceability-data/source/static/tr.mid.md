## 3. End-to-end chains for the critical capabilities

| Business problem | User need | Feature | Requirement | Story | Acceptance | Screen | API | Entity | Test |
|---|---|---|---|---|---|---|---|---|---|
| Regulators and counsel ask what share of sales goes to real customers; no vendor computes it from transactions (GAP-081) | Compliance officer answers from the system | F-24 | FR-CPL-001 | US-24 | AC-24.1, AC-24.2 | SC-10, SC-46 | API-04, API-05 | `compliance_report_snapshot`, `compliance_figure` | TS-31 |
| A figure that cannot be explained is not evidence (GAP-027) | Open any figure to its rows | F-12-lite | FR-CPL-006 | US-41 | AC-41.1 | SC-26 | API-06 | `cpl_fact_*` | TS-34 |
| Past pay cannot be reproduced after genealogy corrections (GAP-010) | Analyst sees the tree as it was | F-02 | FR-GEN-002, FR-GEN-003, FR-COMP-008 | US-01 | AC-01.1, AC-01.2 | SC-07 | API-14, API-18 | `relationship`, `run_snapshot` | TS-03, TS-61 |
| Late orders silently change paid history or are lost (GAP-023) | Committed periods stay fixed | F-09 | FR-COMP-001, FR-ORD-005 | US-08 | AC-08.1 | SC-32 | API-10 | `period`, `late_transaction` | TS-13 |
| Cents do not reconcile (GAP-021, GAP-030) | Ledger reconciles to the minor unit | F-14, F-15 | FR-COMP-012, FR-FIN-001 | US-14 | AC-14.1..3 | SC-33 | API-23 | `journal_entry`, `posting` | TS-06, TS-38, TS-39 |
| Retried instructions pay twice (GAP-035) | Nobody paid twice | F-16 | FR-PAY-003, FR-PAY-004 | US-16 | AC-16.1..3 | SC-03, SC-34 | API-25, API-26 | `payout_instruction`, `outbox_event` | TS-16, TS-40, TS-41 |
| A cap applied to the wrong lines moves money between groups (GAP-022) | Cap behaves as the plan says | F-13 | FR-PLN-004 | US-11 | AC-11.1, AC-11.2 | SC-05 | API-16, API-17 | `plan_rule` | TS-07, TS-08, TS-09 |
| One insider or isolation bug is a multi-tenant incident (GAP-065) | Tenant controls vendor access; tenants isolated | F-32 | FR-IAM-005, FR-IAM-001 | US-29 | AC-29.1..3 | SC-14 | API-08 | `support_session`, `audit_event` | TS-21, TS-37 |
| Bank-detail change redirects payouts (GAP-035) | Payouts wait; payee is told | F-17 | FR-PAY-005 | US-17 | AC-17.1, AC-17.2 | SC-22 | API-27 | `bank_detail_version` | TS-17 |
| Distributors do not understand or trust pay (GAP-027, GAP-003) | See how a line was calculated | F-38, F-12 | FR-DIST-001, FR-DIST-002 | US-04, US-12 | AC-04.1, AC-04.2, AC-12.1 | SC-18 | API-28, API-29 | `statement`, `result_line` | TS-22, TS-53 |
| Switching fear blocks adoption (GAP-077) | Go live only when payouts match | F-29 | FR-MIG-001, FR-MIG-002 | US-28 | AC-28.1, AC-28.2 | SC-16 | API-38 | `simulation` | TS-52 |
| Platform could help configure an unlawful plan (GAP-087) | Blocked with a reason | F-26 | FR-CPL-007 | US-26 | AC-26.1, AC-26.2 | SC-04, SC-11 | API-16 | `guardrail_decision` | TS-26, TS-27, TS-66 |

