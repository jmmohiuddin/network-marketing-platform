# 12 — COMMERCE AND CUSTOMER EXPERIENCE GAP RESEARCH
## Build or integrate commerce, subscriptions, returns — and purchasing that does not reward artificial volume

| Field | Value |
|---|---|
| Document ID | GAP-12 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 6 |
| Gaps | GAP-045 to GAP-047 |

## 1. Market signal: commerce is unbundling from the back office

| Signal | Source |
|---|---|
| DirectScale offers e-commerce "own or Shopify" | S-090 |
| ByDesign integrates Shopify; a reviewer says its own cart lags Shopify-class carts | S-092, S-098 |
| Fluid (raised $15M, Mar 2026) sells commerce, payments, attribution and rep tools **and syncs to an existing back office, keeping the comp plan where it is** | G-S07 |
| WooCommerce has MLM plug-ins (binary, unilevel, forced matrix) | G-S24 |
| Messaging vendors sync to many back offices (Ziplingo: ByDesign, Exigo, InfoTrax, Pillars, TeqTank, Fluid, Flight Commerce) | G-S33 |

**Reading [IP]:** the commerce front end and the compensation back end are increasingly sold separately. A new entrant that builds a storefront competes with Shopify, WooCommerce and Fluid; one that builds an **engine with clean order-ingestion APIs** can sit behind all of them.

## 2. Gap records

### GAP-045 — Build vs integrate commerce is undecided

| Field | Content |
|---|---|
| **Category** | Strategy, technical |
| **Previous research coverage** | Master Plan R-MOD-E "build vs integrate" question; not researched |
| **Missing element** | The decision and its consequences |
| **Evidence** | §1 |
| **Why it matters** | A storefront is a large build (catalogue, variants, tax, shipping, checkout, PCI scope, payments with MLM-eligible processors — GAP-004) that does not differentiate |
| **Affected stakeholders** | Founder, engineering, tenants |
| **Product implications** | MVP ingests orders, refunds and customers from the tenant's commerce platform; provides attribution links and buyer-type tagging at checkout via plug-in or API |
| **Technical implications** | Order-ingestion API and webhooks; idempotent upserts; mapping of products to volume values (BR-VOL-01); returns events |
| **Recommended solution** | **Integrate first** (Shopify and WooCommerce connectors, generic API). Revisit a native storefront only if interviews show buyers want one vendor for both |
| **Priority** | High |
| **Implementation stage** | Before MVP (decision) |
| **Confidence** | Medium |
| **Documentation changes required** | Master Plan R-MOD-E, future module plan (23), architecture (28) |

### GAP-046 — Subscription lifecycle and chargebacks

| Field | Content |
|---|---|
| **Category** | Operational, compliance |
| **Previous research coverage** | P-11, CMP-18 (consent records), BR-ORD-03, BR-REV-06 |
| **Missing element** | Failed renewals (retry, dunning), pausing, skipping, cancellation channels, chargeback handling and its commission effect, and what happens to a distributor's qualification when a customer's autoship fails |
| **Evidence** | Consumer case of an unrecognised order and reversed disputes (S-134); FTC negative-option history (S-126, S-127); autoship cancellation and declined-card triggers in messaging tools (G-S33) |
| **Why it matters** | Autoship volume often drives qualification; involuntary churn and disputes move ranks and pay |
| **Affected stakeholders** | Customers, distributors, Support, Finance |
| **Product implications** | If commerce is integrated (GAP-045), the platform consumes subscription events; it must treat a chargeback like a refund for volume and pay (BR-REV-06) |
| **Technical implications** | Event types: renewal succeeded / failed / cancelled / disputed / dispute won or lost |
| **Recommended solution** | V1: subscription and dispute events with commission effects; consent records stay with the commerce platform where it is the merchant of record |
| **Priority** | Medium |
| **Implementation stage** | V1 |
| **Confidence** | Medium |
| **Documentation changes required** | 15 BR-ORD-03, BR-REV-06 |

### GAP-047 — Returns, exchanges and partial returns

| Field | Content |
|---|---|
| **Category** | Financial |
| **Previous research coverage** | BR-VOL-03 (proportional reversal), J-17 |
| **Missing element** | Exchanges (same value, no reversal?), partial returns of bundles (which volume?), restocking fees (Nu Skin 10%, S-122) and their effect on volume; inventory returned to which warehouse (integration) |
| **Evidence** | S-122 return policy; bundles and starter kits (S-141) |
| **Why it matters** | Each case changes volume and therefore pay |
| **Affected stakeholders** | Finance, Support |
| **Product implications** | Return line items carry volume adjustments; exchange flag avoids reversal and re-credit churn |
| **Technical implications** | Volume per order line, not per order |
| **Recommended solution** | Rules in 24 (BR-RET); warehouse and inventory stay in the commerce or ERP system |
| **Priority** | Medium |
| **Implementation stage** | MVP (rules) |
| **Confidence** | Medium |
| **Documentation changes required** | 15 BR-VOL-03, BR-REV-01 |

## 3. Purchasing that does not reward artificial volume (brief question)

| Design choice | Effect | Source |
|---|---|---|
| Separate **purpose** on participant orders (resale, personal use) and report the personal-use share of rewarded volume | Makes the Herbalife-order style one-third test computable | G-S02 |
| Count **active customers** (not only volume) in qualification, as Modere does | Rewards customer acquisition rather than self-purchase | G-S26 |
| Flag orders just above a rank threshold at period end, and returns after qualification | Detects bonus buying | GAP-005 |
| Do not let starter kits carry commissionable volume unless the tenant overrides with a reason | Removes a named red flag | S-141 |
| Volume credited after the cooling-off period in markets that have one (D-R1) | Prevents pay on orders that are later returned under statutory rights | S-015 |

These are **configurable defaults**, not legal determinations (13 §6).
