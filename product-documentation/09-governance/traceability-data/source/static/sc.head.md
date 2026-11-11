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

