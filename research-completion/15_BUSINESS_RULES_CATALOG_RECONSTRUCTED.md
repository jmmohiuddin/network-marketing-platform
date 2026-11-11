# 15 — BUSINESS RULES CATALOG (RECONSTRUCTED)
## The original 57 candidate rules: what can be recovered, what cannot, and the open decisions D-R1..D-R6

| Field | Value |
|---|---|
| Document ID | 15-R (reconstruction of `15_BUSINESS_RULES_CATALOG.md`) |
| Version | 0.1-R |
| Date | 2026-11-12 |
| Status | **Partial reconstruction.** The original (2,503 words, v0.1 draft, "57 candidate rules in 10 domains; open decisions D-R1..D-R6", SHA-256 `a1885b87…5bb15` in the gap audit snapshot) is missing (OQ-22) |
| Rebuilt from | Every citation of a rule ID that the gap audit attributes to "15", or that is cited in the gap audit as "previous research coverage" and is not defined in `GAP_AUDIT/24_MISSING_BUSINESS_RULES.md` |
| Method | All BR IDs in the repository were listed (99 distinct). IDs defined in 24 (71) were removed. The remaining 28 are original-catalogue IDs. Ranges cited in text (for example "BR-REV-01 to BR-REV-06", "BR-RNK-01..04", "BR-DAT-01..05") add IDs whose existence is known but whose text is not |

## 1. Domains (10)

Inferred from the prefixes of recovered original IDs: **ORD** orders · **VOL** volume · **RNK** rank · **CMP** compensation · **PAY** payout · **REV** reversals · **TRM** termination · **REG** registration · **DAT** data · **CPL** compliance. Exactly ten prefixes appear; this matches the inventory's "10 domains".

## 2. Recovered rules

**Text column:** quoted or closely paraphrased from the citing document. "Subject only" means only the topic is known.

| ID | Recovered content | Status in original | Citing source | Successor in product documentation |
|---|---|---|---|---|
| BR-ORD-01 | Each order carries a **buyer type** (customer or participant) | Candidate; audit: too coarse (IC-14) | GAP_AUDIT/06, /09, /11 | Participant-type model; BR-PTY rules (PRD-04) |
| BR-ORD-03 | Subject: recurring orders and consent records | Candidate | GAP_AUDIT/12 | Integrated commerce events |
| BR-VOL-01 | Products map to **volume values** | Candidate | GAP_AUDIT/12 | Product volume mapping |
| BR-VOL-02 | The **volume-crediting event** (payment, shipment or end of cooling-off) | **Open** (D-R1) | GAP_AUDIT/06 IC-02, /09, /24 | BR-PER-02 (24) |
| BR-VOL-03 | **Proportional reversal** of volume on a partial return | Candidate | GAP_AUDIT/12 | Reversal rules (PRD-04) |
| BR-RNK-01..04 | Rank qualification; BR-RNK-03 (advancement and maintenance) marked **"not researched"** | 03 not researched | GAP_AUDIT/03, /09 | BR-RNK-05..09 (24); paid-as vs title |
| BR-CMP-01 | A run uses **exactly one plan version** chosen by effective date | Candidate; audit: correct | GAP_AUDIT/06, /09 | Plan versioning |
| BR-CMP-03 | **No payout lines solely for recruiting** | Candidate | GAP_AUDIT/06 | Guardrail BR-GRD (PRD-04) |
| BR-CMP-05 | Subject: **caps** (one proportional scale) | Candidate; audit: caps must be scoped and prioritised (GAP-022) | GAP_AUDIT/09 | BR-CAP-01..03 (24) |
| BR-CMP-07 | Subject: **compression** behaviour | Candidate; audit: placement, spillover, compression, roll-up, breakaway are different behaviours (GAP-013) | GAP_AUDIT/08 | Compression per plan version |
| BR-CMP-08 | **Calculation order:** individual → matching → pools → caps → minimums | Candidate; audit: wrong for priority caps (IC-06) | GAP_AUDIT/06 | Ordered stages in engine design |
| BR-CMP-09 | "**Rounding and currency follow a tenant policy**" | Candidate; audit: insufficient (cent drift) | GAP_AUDIT/09, /10 | BR-MNY-01..05 |
| BR-PAY-02 | **Preparer and approver are different people** | Candidate | GAP_AUDIT/06 | Separation of duties |
| BR-PAY-06 | Subject: per-line provenance and explanation of payouts | Candidate | GAP_AUDIT/09 GAP-027 | Statement line explanation |
| BR-PAY-07 | **US 1099** year-end reporting; threshold "may have changed" | Candidate; audit: threshold $600 → $2,000 for 2026 payments (G-S05) | 02 A-4, GAP_AUDIT/10 | BR-TAX-01..04 (24); market packs |
| BR-REV-01 | Subject: reversal of commission on return | Candidate | GAP_AUDIT/12; 06 P-12 | Reversal rules |
| BR-REV-02 | Whether a **reversal reaches a closed period** or posts an adjustment | **Open** (D-R2) | GAP_AUDIT/06, /09, /10 | BR-REV-02 in PRD-04 (unresolved) |
| BR-REV-03 | **Negative-balance policy** (carry, write off, collect) | **Open** (D-R3) | GAP_AUDIT/06, /10 | Clawback receivable; counsel Q-10 |
| BR-REV-04, -05 | **Cooling-off and buy-back** per market | Candidate | GAP_AUDIT/20 table | Market packs |
| BR-REV-06 | A **chargeback is treated like a refund** for volume and pay | Candidate | GAP_AUDIT/12 | Reversal rules |
| BR-TRM-03 | Subject: termination of a mid-tree distributor (node stays with status) | Candidate | GAP_AUDIT/08 S8, /09 | Genealogy status |
| BR-TRM-04 | Subject: termination or re-entry (cited with 03 as "no rules") | Candidate | GAP_AUDIT/03 | Reinstatement event |
| BR-REG-02, -03 | Subject: duplicate or fake accounts; sponsor change | Candidate | GAP_AUDIT/07 GAP-002 | Duplicate cases (FL-03) |
| BR-REG-04 | **Market gating at registration** | Candidate | GAP_AUDIT/07 GAP-006 | Market eligibility |
| BR-DAT-01 | Subject: **data residency** | Candidate | GAP_AUDIT/15, /20 | Regional cells |
| BR-DAT-03 | Downline visibility "**as plan and privacy rules allow**" | Candidate | GAP_AUDIT/08 | Privacy-limited team view |
| BR-DAT-04 | **Marketing consent per channel** (email, SMS, WhatsApp) [HY] | Candidate | GAP_AUDIT/11, /20 | Consent records |
| BR-CPL-02 | Subject: plan-change governance with the field | Candidate | GAP_AUDIT/21 GAP-097 | Change notices |

## 3. Count

| Measure | Count |
|---|---|
| Rules in the original | 57 |
| IDs recovered with content or subject | 28 explicit IDs + 7 known from ranges (RNK-02, RNK-04, DAT-02, DAT-05, REV-05, REG-03, TRM-04 partly) ≈ **35** |
| Rules with recovered **text** (not subject only) | **14** |
| Rules lost entirely | **about 22** (no ID or subject anywhere) |

## 4. Open decisions D-R1..D-R6

| ID | Decision | Recovered from | Product handling |
|---|---|---|---|
| D-R1 | Which event credits volume (payment, shipment, end of cooling-off) | GAP_AUDIT/06 IC-02, /12 | Configurable per plan version and market pack |
| D-R2 | May a reversal alter a closed period, or only post an adjustment? | Roadmap; GAP_AUDIT/09 | Adjustment in the open period by default; counsel Q-10 |
| D-R3 | How negative balances are recovered | Roadmap; GAP_AUDIT/10 | Clawback receivable; counsel |
| D-R4 | A compliance or acceptance question (with D-R6) | GAP_AUDIT/20 GAP-087 "which compliance behaviour is mandatory platform behaviour" | Guardrails (DEC-04) |
| D-R5 | **Not recoverable** — no citation | — | — |
| D-R6 | As D-R4 (vendor liability / acceptance policy) | GAP_AUDIT/20 | Q-1 counsel |

## 5. Effect on the product documentation

PRD-04 already carries 119 rules built from 24 and the recovered items. The ~22 lost rules cannot be recreated without inventing them. **Recommendation:** close OQ-22 as "partly recovered; original needed for the remainder" and do not invent replacements.
