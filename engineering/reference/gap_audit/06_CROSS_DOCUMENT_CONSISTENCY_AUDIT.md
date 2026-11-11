# 06 — CROSS-DOCUMENT CONSISTENCY AUDIT
## Contradictions and stale statements inside the original repository

| Field | Value |
|---|---|
| Document ID | GAP-06 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Scope | The 21 original Markdown documents and 3 scripts |

## 1. What could not be checked

The brief's consistency questions concern **PRD vs system design, database vs requirements, journeys vs modules, permission models, compensation requirements across documents, MVP vs strategy, UX vs workflows, API vs architecture.** Of these, only "compensation requirements across documents" and "journeys vs modules" have material on both sides. The rest compare documents that **do not exist** (GAP-100). Their consistency must be designed in from the start: 22 of this audit sets out the traceability scheme the first PRD should use.

## 2. Inconsistencies found

Severity: **Moderate** = could mislead a decision; **Minor** = could mislead a reader; **Cosmetic** = metadata.

| # | Documents | Inconsistency | Severity | Resolution |
|---|---|---|---|---|
| IC-01 | 06 P-16 vs 51 §5.3 | 06 says merchant-account risk "has no source"; 51 cites S-116 that banks treat MLM as high risk | Moderate | **51 is right and understated.** First-party provider policies confirm it (G-S04, G-S20, G-S21). Update 06 P-16; see GAP-004 |
| IC-02 | 11 §1 diagram vs 15 BR-VOL-02 / D-R1 | The core-chain diagram credits volume **after fulfilment**; 15 lists the volume-crediting event as an open decision | Moderate | Mark the diagram as one option; decide D-R1 with the period model (GAP-023) |
| IC-03 | 07 P-05 rating vs 06 P-05 caveat | 07 rates P-05 "High (documented)" on a sanction that 06 says punished conduct, not an evidence gap | Moderate | Re-rate P-05 as Medium on the strict rubric; keep "High if it occurs" (02 A-10) |
| IC-04 | 04 §2, 05 H-4 and H-8 vs vendor documentation | "No vendor states reversal handling or simulation" is used as gap evidence; vendor help centres document both | Moderate | Not an internal contradiction, but a contradiction with the sources the documents should have read; see GAP-081 |
| IC-05 | 02 §6 "priority" for Malaysia and India vs 03 §8 and 05 §0 | 02 ranks the two markets as priority while 03 notes India-linked low-end vendors and 05 says local vendors were not searched | Moderate | Re-open the market choice with competition and access (GAP-076) |
| IC-06 | 13 EX-9, 51 CMP-19 vs the Herbalife order | Cap modelled as proportional scaling of all compensation; the order excludes wholesale commissions and has one-third rules | Moderate | Correct per 09 of this audit (GAP-022) |
| IC-07 | 13 EX-6 vs S-141 | Example pool is "6.25% of company CV"; the source describes the pool on commissionable volume of a defined base | Minor | State the pool base explicitly as a plan parameter |
| IC-08 | 66 §5 vs 66 §7.4 | §5 says D3 "Not started (Wave 3)"; §7.4 says "Partly" | Minor | §5 is a superseded Wave 2 table; label it so |
| IC-09 | 66 OQ-01 and OQ-08 vs gate G3 | Both are "needed by: before G3"; G3 was assessed without them | Minor | Move their "needed by" to "before D1/D2 decision"; they now block the market choice (GAP-076) |
| IC-10 | 01 §3 vs 13 | 01 still says plan families are "source pending"; 13 sources them | Minor | Add a pointer in 01 |
| IC-11 | Roadmap header vs content | Header "v1.2 (Wave 2 results…)" but the document holds Wave 3 results and §13.5 | Cosmetic | Bump version |
| IC-12 | Register "Recapture and gaps (to resolve in Wave 2)" | Heading and items still open after Wave 3 | Cosmetic | Retitle; see GAP-102 |
| IC-13 | 08 ST-01 vs 08 §6 | ST-01 "Super Admin (platform operator)" mixes the tenant's administrator and the vendor's own staff; §6 lists "platform admin" and "tenant admin" separately | Moderate | Split into ST-01a tenant administrator and ST-25 vendor operations staff (GAP-065) |
| IC-14 | 15 BR-ORD-01 vs real plans | Buyer type is binary (customer or participant); real plans have affiliates, influencers, VIP and preferred customers, promoter and builder tracks (G-S25, G-S26, G-S28) | Moderate | Replace with a participant-type model (GAP-028) |

## 3. Compensation requirements across documents

| Requirement | 13 | 15 | 51 | 10/11 | Consistent? |
|---|---|---|---|---|---|
| Versioned plans with effective dates | §7.1 | BR-CMP-01 | CMP-04 | J-02 | Yes |
| Calculation order (individual → matching → pools → caps → minimums) | §7.2 | BR-CMP-08 | CMP-19 | — | Yes internally; **wrong for priority caps** (IC-06) |
| Reversal reaches closed periods or posts adjustments | §7.1 | BR-REV-02 (open) | Q-10 | 11 §4 | Yes (all mark it open) |
| Negative balance policy | EX-8 | BR-REV-03 (open) | Q-10 | J-17 | Yes (open) |
| Volume crediting event | — | BR-VOL-02 (open) | — | 11 §1 assumes fulfilment | **No** (IC-02) |
| Buyer type tagging | §6 | BR-ORD-01 | CMP-01 | J-08 | Yes internally; **too coarse** (IC-14) |
| Preparer/approver separation | §7.1 | BR-PAY-02 | MH-REQ-02 | J-11 | Yes |
| No payout lines solely for recruiting | §6 | BR-CMP-03 | CMP-03 | — | Yes |

## 4. Journeys vs modules

| Journey | Module(s) implied | Module researched? |
|---|---|---|
| J-01, J-02 | A Company admin, G Compensation | No (R-MOD-A, G not started) |
| J-03..J-05, J-14, J-16 | B Distributor management, C Genealogy | No |
| J-06, J-07 | D CRM | No |
| J-08, J-09, J-17 | E Commerce, F Inventory | No |
| J-10..J-12 | G Compensation, H Financial | Partly (13, 51 §5) |
| J-13 | L Analytics, J Communication | No |
| J-15 | Support (not a module in the brief) | No |

**Finding:** customer support has a journey (J-15) but **no module** in the brief's A–M list. Support tooling (case history, statement explanation, masked data) needs a home in the module plan (27 of this audit).
