# 11 — CRM AND SALES INTELLIGENCE GAP RESEARCH
## Where CRM data becomes commission data, and who owns a customer

| Field | Value |
|---|---|
| Document ID | GAP-11 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 5 |
| Gaps | GAP-040, GAP-041 |

## 1. Finding: in direct selling, CRM is not a side module

The original research marked prospect management and lead conversion "not researched" (10 J-06, J-07) and placed CRM at priority P2 (Master Plan R-MOD-D). That ordering misses one point: **who a customer "belongs to" decides who gets paid.** Real plans pay on personally acquired customers (Modere "Customer POD", G-S26), count active customers for rank (Modere ACC), give lifetime percentages for referred customers (USANA Affiliate and Refer-a-Friend, G-S25), and require personally enrolled volume per leg (Arieyl, G-S28). The chain the brief draws, **company CRM → distributor CRM → customer database → sales orders → commission engine**, is therefore one data path, not five modules.

| Link | Data that crosses it | Where it fails |
|---|---|---|
| Company CRM → distributor CRM | Leads from company campaigns assigned to distributors | Assignment rules; lead hoarding; consent scope |
| Distributor CRM → customer database | A prospect becomes a customer | Duplicates; which distributor gets credit |
| Customer database → orders | Orders attributed to a customer and through them to a distributor | Customer with several distributors; guest checkout |
| Orders → commission engine | Attribution, buyer type, purpose | Mis-attribution changes pay and retail-share evidence (CMP-01) |

## 2. Gap records

### GAP-040 — Customer ownership and attribution are commission inputs

| Field | Content |
|---|---|
| **Category** | Financial, operational |
| **Previous research coverage** | BR-ORD-01 (buyer type); J-06, J-07 not researched |
| **Missing element** | Rules for: who owns a customer; how ownership is set (link, code, enrolment, first order); what happens when the distributor leaves or is terminated (reassign to sponsor? to company? to customer's choice?); duplicates; conflicts between two distributors; referral attribution windows |
| **Evidence** | Customer-based bonuses and qualifications in current plans (G-S25, G-S26, G-S28); Fluid markets "FairShare attribution" tying each order to the rep who sold it (G-S07) — attribution is a selling point for new entrants |
| **Why it matters** | Attribution errors are pay errors and evidence errors; ownership disputes are a recognised industry problem (brief Domain 1) |
| **Affected stakeholders** | Distributors, customers, Support, Compliance |
| **Product implications** | Customer record with an effective-dated "serviced by" relationship; reassignment workflow with reason; attribution report per order |
| **Technical implications** | Attribution decided at order time and stored on the order (immutable); changes affect future orders only |
| **Recommended solution** | MVP: attribution and ownership rules, reassignment on termination, duplicate flag. Later: pipelines, scoring, forecasting |
| **Priority** | High |
| **Implementation stage** | MVP (attribution); V2 (sales-pipeline CRM) |
| **Confidence** | Medium |
| **Documentation changes required** | 10 (new journey: customer reassignment), 15 (new BR-ATT rules), 13 §3 |

### GAP-041 — Contacts that distributors store: controllership and consent

| Field | Content |
|---|---|
| **Category** | Compliance |
| **Previous research coverage** | CMP-15, BR-DAT-04 (marketing consent [HY]) |
| **Missing element** | Whether the tenant, the distributor or both are responsible for a prospect's personal data entered by a distributor; consent for messages sent through the platform |
| **Evidence** | Malaysia PDPA amendments bind processors and require DPOs (G-S14); India DPDP duties from May 2027 (G-S10) |
| **Why it matters** | A prospect list typed into the platform by an independent contractor is personal data with an unclear owner |
| **Affected stakeholders** | Distributors, prospects, Tenant DPO, the platform as processor |
| **Product implications** | Consent capture before marketing messages; prospect data not visible to upline by default; deletion on request |
| **Technical implications** | Prospect records scoped to the distributor; retention timer; export and deletion |
| **Recommended solution** | Ask counsel in the launch market; until then, treat the tenant as controller and the platform as processor, keep prospect data private to the distributor |
| **Priority** | Medium |
| **Implementation stage** | V1 |
| **Confidence** | Medium |
| **Documentation changes required** | 51 CMP-15, 15 BR-DAT-04 |

## 3. Company-level vs distributor-level CRM

| Need | Company (admin) CRM | Distributor CRM |
|---|---|---|
| Purpose | Customer service, retention, campaign reporting | Personal follow-up |
| Data scope | All customers of the tenant | Own customers and prospects |
| Key features | Case history, attribution report, reassignment | Contacts, reminders, share links with attribution |
| Build or integrate | Integrate with the tenant's support desk and messaging tools (Ziplingo-type messaging already syncs with back offices, G-S33) | Small native feature set tied to attribution |
| Stage | MVP: attribution + reassignment only | V1: contacts and reminders |

**Do not build** lead scoring, pipeline forecasting or AI lead prioritisation for distributors: no evidence of need (P-10 unrated), and they push toward recruitment activity (17 of this audit).
