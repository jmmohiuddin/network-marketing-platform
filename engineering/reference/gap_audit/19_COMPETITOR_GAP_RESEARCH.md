# 19 — COMPETITOR GAP RESEARCH
## Competitors the original missed, and what vendor documentation shows that marketing pages did not

| Field | Value |
|---|---|
| Document ID | GAP-19 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 13 |
| Gaps | GAP-080, GAP-081 |
| Reading rule (kept from the original) | A vendor's statement about itself is a claim. A **help-centre article** is stronger evidence than a marketing page that a feature exists, but it is not evidence that the feature works well |

## 1. Competitors and adjacent players not in the original map

| Entity | Category | Evidence | Why it matters |
|---|---|---|---|
| **Fluid** | Commerce, payments, attribution, rep tools and AI "purpose-built for direct selling"; syncs to existing back offices | Raised $15M, 13 Mar 2026 (G-S07) | Best-funded recent entrant; **unbundles** commerce from the comp engine; potential partner for an engine-first entrant or a competitor to an all-in-one |
| **Pillars**, **TeqTank** | Direct-selling back offices (listed as sync targets) | Ziplingo integration list (G-S33) | Missing from the 18-vendor list; not researched further |
| **Flight Commerce** | Commerce for direct sellers | V0 in original 03 §3.2; Ziplingo list (G-S33) | Was listed but not worked |
| **Momentum Factor (FieldWatch)** | Internet-wide monitoring of distributor claims | G-S17 | Field-claims compliance is already a vendor category |
| **Masset** | Approved-content library with per-market hubs and an MCP server for distributor AI | 7 Jul 2026 (G-S18) | Approved-claims workflow already productised |
| **Hussle, PromoRepublic** | Distributor social content and compliance tooling | Search results (titles only) | Same category; not verified further |
| **Ziplingo** | Messaging synced to back-office events (autoship cancelled, declined card) | G-S33 | Communication module (Master Plan J) is served by specialists |
| **Specialist payment and payout providers** (Nexio, PayQuicker, FlexPay, Hyperwallet, Paysafe) | Payments for a high-risk category | S-091, S-093, S-114, G-S22 | Necessary partners because mainstream providers restrict MLM (GAP-004) |
| **VYROX, UwonTech and other Malaysian developers** | Local MLM software | G-S19 | Local competition in a "priority" market |
| **Infinite MLM (Calicut, India)** | Low-price vendor with Malaysian presence since 2023 | G-S06 | Price floor in both priority markets |
| **WooCommerce MLM plug-ins** | DIY tier for small operators | G-S24 | Lowest-price substitute; relevant to a founder who builds on WordPress-class stacks |
| **In-house builds on ERP** (SAP, Oracle) | Large companies | Postings and filings name SAP, Oracle Fusion (S-121, S-130..S-132) | S1 and S5 buy differently (projects, integrators) |

## 2. What incumbent documentation shows (vs the original matrix)

| Capability | Original 04 | Documentation found | Revised status |
|---|---|---|---|
| Clawback of commissions on refunds after close | Not stated by any vendor | DirectScale: deducted from next check (G-S29) | **Table stakes** |
| Payable adjustments, overrides, import of adjustments | Not stated | DirectScale (G-S30) | **Table stakes** |
| Payment approvals, batch-failure handling | Not stated | DirectScale (G-S30) | **Table stakes** |
| Committed (locked) commission periods; volume adjustments only in uncommitted periods | Not stated | DirectScale (G-S30) | **Table stakes** |
| Projected commissions | Not stated | DirectScale (G-S30) | Table stakes (distributor-facing) |
| Plan testing before deployment | Not stated | Exigo "secure sandbox" (G-S31) | **Table stakes** |
| SQL access to data | Not stated | Exigo "full SQL access"; DirectScale client SQL reports (G-S30, G-S31) | **Table stakes** |
| Uptime and scale claims | Not captured | Exigo 99.99%, millions of orders (G-S31, claim) | Buyer expectation |
| Income disclosure statements | 0 of 8 | Epixel: **manual** generator, figures typed by the user (G-S32) | Still no vendor found that computes disclosures **from payout data** |
| Retail-customer share, personal-consumption share, payout-source attribution | 0 of 8 | None found | **Still unclaimed** (narrow whitespace) |
| Per-market reversal rules (cooling-off, statutory buy-back) | 0 of 8 | None found | Unclaimed but possibly custom work |

## 3. Gap records

### GAP-080 — Competitors and adjacent players were missed

| Field | Content |
|---|---|
| **Category** | Market |
| **Previous research coverage** | 03 (14 names verified; 18 vendors at V1+; 7 at V2p) |
| **Missing element** | §1 entities |
| **Evidence** | §1 sources |
| **Why it matters** | The landscape is moving toward specialised layers (commerce, messaging, claims compliance, payouts). An all-in-one entrant competes with every layer; an engine entrant can partner with several |
| **Affected stakeholders** | Founder |
| **Product implications** | Integration-first module plan (23); partner list |
| **Technical implications** | Public API and webhooks from MVP |
| **Recommended solution** | Add §1 to the competitor map; capture documentation (V3) for Fluid, Pillars, TeqTank, ByDesign and one Malaysian vendor |
| **Priority** | High |
| **Implementation stage** | Before MVP |
| **Confidence** | High (existence); Medium (positioning) |
| **Documentation changes required** | 03 §3, 04, 05 |

### GAP-081 — Several "gaps" are documented incumbent features

| Field | Content |
|---|---|
| **Category** | Strategy |
| **Previous research coverage** | 04 §2 (0 of 8 state CMP features), 05 H-4, H-8, 07 opportunity statuses |
| **Missing element** | Documentation-level verification |
| **Evidence** | §2 |
| **Why it matters** | Building a product around reversals, plan testing or adjustments would enter a market where buyers already have them |
| **Affected stakeholders** | Founder, investors |
| **Product implications** | These capabilities are **required** in the MVP (hygiene) but are not the positioning |
| **Technical implications** | — |
| **Recommended solution** | Narrow the whitespace claim to **compliance analytics computed from transaction data** and test it (18 P4) |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | High |
| **Documentation changes required** | 04 §2, 05 §7, 07 opportunity statuses, 66 §7 |

## 4. Customer-review evidence (unchanged)

No new review mining was done in this audit; the original's themes (cost of change, surprise charges, learning curve; no commission-error complaints) stand at the same weak grade. **A competitor's missing feature is not treated as demand** (brief §5 Domain 13).
