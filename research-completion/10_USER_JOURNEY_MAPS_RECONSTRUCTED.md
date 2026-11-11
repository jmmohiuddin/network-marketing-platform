# 10 — USER JOURNEY MAPS (RECONSTRUCTED)
## J-01..J-17: identity, module, evidence status and where the product documentation now covers each

| Field | Value |
|---|---|
| Document ID | 10-R (reconstruction of `10_USER_JOURNEY_MAPS.md`) |
| Version | 0.1-R |
| Date | 2026-11-12 |
| Status | **Partial reconstruction.** The original (3,286 words, "17 journeys J-01..J-17 with evidence status", per `GAP_AUDIT/01` row 14) is missing (OQ-22). Its step-by-step content cannot be recovered |
| Rebuilt from | Every citation of a J-number in the repository: `GAP_AUDIT/03`, `/06` §journey-module map, `/07`, `/08` S8 and S11, `/11`, `/12`, `/13`, `/18`, `/27`; `13_COMPENSATION_PLAN_RESEARCH` §5; `11_USER_WORKFLOW_ANALYSIS` |
| Rule used | A journey's **subject** is stated only where a citation states it. Where only the module is known, the title is marked *inferred* and must not be used as a requirement |

## 1. What is recoverable

| ID | Subject | Basis for the subject | Module (gap audit 06) | Evidence status in the original | Linked rules or items | Covered now by |
|---|---|---|---|---|---|---|
| J-01 | Company onboarding and **parallel run** of a new platform against the legacy engine | `GAP_AUDIT/18`: "J-01 (parallel run)"; changes required "10 J-01" | A Company admin, G Compensation | Not stated | P-18 | UJ-13 (migration with parallel run) |
| J-02 | **Plan versioning** with effective dates | `GAP_AUDIT/06` row "Versioned plans with effective dates … J-02" | A, G | Not stated | BR-CMP-01, CMP-04 | UJ-08 (plan change rollout) |
| J-03 | *Inferred:* distributor enrolment and registration | Module B/C only | B Distributor mgmt, C Genealogy | Not stated | BR-REG-02..04 | UJ-17 partly; enrolment is outside MVP-A |
| J-04 | *Inferred:* sponsor or placement change | Module B/C only; `13` §5 edge case 1 | B, C | Not stated | BR-REG-02 | UJ-03 (genealogy change) |
| J-05 | *Inferred:* distributor status, activity or rank view | Module B/C only | B, C | Not stated | BR-RNK-01..04 | UJ-16 partly |
| J-06 | **Prospect management** | `GAP_AUDIT/11`: "prospect management and lead conversion 'not researched' (10 J-06, J-07)" | D CRM | **Not researched** | BR-ORD-01 | FR-CRM (V1), OQ-27 |
| J-07 | **Lead conversion and approved content**, including an unapproved earnings claim by a distributor | `GAP_AUDIT/07`: J-07 notes "monitoring is outside the platform unless materials are managed" | D CRM | **Not researched** | CMP-05 | Honesty policy (DEC-05); disclosure V1 |
| J-08 | Customer order with **buyer-type tagging** | `GAP_AUDIT/06` row "Buyer type tagging … J-08" | E Commerce, F Inventory | Not stated | BR-ORD-01 (too coarse, IC-14) | Ingestion API; participant types |
| J-09 | *Inferred:* recurring order (autoship) | Module E/F; P-11 | E, F | Not stated | BR-ORD-03 | Integrated commerce (DEC-06) |
| J-10 | *Inferred:* commission period run | Module G/H; `GAP_AUDIT/06` "Partly (13, 51 §5)" | G, H | Partly researched | BR-CMP-05..09 | UJ-02 (period close) |
| J-11 | **Payout approval** with preparer/approver separation | `GAP_AUDIT/06` row "Preparer/approver separation … J-11" | G, H | Partly researched | BR-PAY-02 | UJ-02 |
| J-12 | *Inferred:* payout execution and reconciliation, or tax documentation | Module G/H only | G, H | Partly researched | BR-PAY-06, BR-PAY-07 | UJ-02, UJ-14 |
| J-13 | Leader or distributor **analytics and communication** | `GAP_AUDIT/06` (L Analytics, J Communication); `/13` "journeys J-13, J-14 with no evidence" | L, J | **No evidence** | P-06, P-10 | Not in MVP; analytics deferred |
| J-14 | **Re-entry and reinstatement** of a distributor | `GAP_AUDIT/08` S11 "Re-entry and reinstatement — J-14" | B, C | **No evidence** | BR-TRM-03/04 (no rules) | Data model (reinstatement event); no journey |
| J-15 | **Customer support**: case history, statement explanation, masked data | `GAP_AUDIT/06`: "customer support has a journey (J-15) but no module" | Support (no module in the brief) | Not stated | — | UJ-05, UJ-11, UJ-16 |
| J-16 | **Termination** of a mid-tree distributor (downline and compression) | `GAP_AUDIT/08` S8; `13` §5 item 4 | B, C | Not stated | BR-TRM-03, BR-CMP-07 | UJ-15 (customer reassignment) |
| J-17 | **Return or refund after payout**, negative balance | `GAP_AUDIT/06` "Negative balance policy … J-17"; `/12` "BR-VOL-03 (proportional reversal), J-17" | E, F | Not stated | BR-VOL-03, BR-REV-01..03 | UJ-06, UJ-07 |

**Recovered with a stated subject:** 11 of 17 (J-01, 02, 06, 07, 08, 11, 13, 14, 15, 16, 17). **Inferred from module only:** 6 (J-03, 04, 05, 09, 10, 12).

## 2. What is lost

- Step tables, actors, emotions, pain points and touchpoints of every journey.
- The evidence-status label of each journey (the inventory says each had one; only J-06, J-07 "not researched" and J-13, J-14 "no evidence" survive).
- The original order of journeys within modules.

## 3. Bangladesh and India notes on the journeys (from Phase 2, not from the original)

| Journey | India | Bangladesh |
|---|---|---|
| J-03 enrolment | Written agreement, KYC and ID card are duties of the entity under the Direct Selling Rules (71); **no entry fee** may be charged | If MLM: unlawful without a licence, none issued since 2015 (70). Affiliate or single-level sign-up: needs counsel |
| J-07 content | The entity must keep a register of direct sellers (and delisted sellers) on its website (71); rules on claims made by sellers not read in full | Not applicable to MLM (closed) |
| J-11, J-12 payout | Withholding 2% under s.393 (≥ ₹20,000 a year; 20% without PAN); Form 26Q quarterly (71) | Withholding 10% on commission under s.94 (secondary source); bKash corporate disbursement exists (72) |
| J-15 support | Grievance acknowledgement in 48 hours, resolution in one month; nodal officer | Digital Commerce Guidelines: complaint response in 72 hours for e-commerce sellers |
| J-17 refund | Buy-back or return duties under the Rules **not verified in this phase** (not in the summaries read); counsel question AQ-IN-04 | Digital Commerce Guidelines: refund within 10 days on delayed delivery |
