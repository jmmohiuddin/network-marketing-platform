# 72 — PAYMENT AND PAYOUT PROVIDER SCREEN: BANGLADESH AND INDIA
## Which providers might let a tenant collect for products and pay commissions — from published terms only

| Field | Value |
|---|---|
| Document ID | P2-72 |
| Version | 0.1 |
| Date | 2026-11-12 |
| Extends | Phase A `P2_PAYMENT_PROVIDER_SCREEN.md` (US, Malaysia, India) |
| Grade | Published terms and product pages only. **No provider has answered in writing.** AQ-01 remains a launch blocker |
| Sources | P2-S40..P2-S50 (79); Phase A G-S21, G-S23, G-S54, G-S55 |

## 1. India

| Provider | Service | What the published terms say about MLM | Status | Source |
|---|---|---|---|---|
| Cashfree | Payments, Payouts, Cashgram | Does not support "Multi-level marketing collection fees, Ponzi schemes, or matrix schemes" | **P** — fees named; product sales by a registered entity unclear | G-S54 |
| Zoho Payments | Cards, UPI | Prohibited: "Multi-level marketing collection fees" | **P** | G-S21 |
| Razorpay / RazorpayX | Payments; bulk payouts | No MLM entry in documents read; RazorpayX terms (last updated 17 Jan 2022) contain no MLM, pyramid or prohibited-business list | **?** — silence, not permission | G-S23, G-S55, P2-S41 |
| PayGlocal | Cross-border payments | Prohibits "Get-rich-quick schemes or pyramid schemes"; MLM not named | **?** | P2-S42 |
| PayU | Payments (sub-merchant terms PDF) | No MLM mention in the document read | **?** | P2-S43 |
| Google Pay for Business | UPI | No MLM mention in the policy read | **?** | P2-S44 |

**Regulatory frame for providers:** RBI Master Direction on Payment Aggregators (15 Sep 2025, as summarised): CKYCR-based merchant KYC, FIU-IND registration, ongoing transaction monitoring. No MLM category in the summary read (P2-S45). Providers therefore decide merchant eligibility under their own risk policies.

**Reading.** In India the pattern is the same as in Phase A: the explicit restrictions target **joining fees** ("MLM collection fees"), which the Direct Selling Rules already prohibit (no entry fee, 71). A registered entity that charges no entry fee **may** be eligible for product collection and commission payouts. **Only written answers settle this.**

## 2. Bangladesh

| Provider | Service | Finding | Status | Source |
|---|---|---|---|---|
| bKash | Corporate Disbursement | Offered for payments to employees, distributors' sales officers and "partners"; no API or eligibility terms found | **?** | P2-S46 |
| SSLCommerz | Payment gateway | Onboarding page lists documents (trade licence, TIN, bank details); no business-type restrictions on the page read | **?** | P2-S47 |
| Nagad, bank transfer (BEFTN) | Disbursement | **Not read** | — | — |

**Reading.** For **MLM** this is moot (70). For a single-level affiliate programme, bKash corporate disbursement is the most likely payout route (mobile wallets are the main retail rail), but eligibility for commission payments to non-employees is unknown.

## 3. Consequences for the product

| Item | Consequence |
|---|---|
| Adapter list for an India pack | Bank-file (NEFT/IMPS) fallback first — needs no provider approval; then RazorpayX and Cashfree Payouts adapters **only after** written eligibility |
| Bangladesh | No adapter until AQ-BD-01 is answered; bKash corporate disbursement is the first candidate |
| Guardrail BR-GRD-02 (no participant fees where prohibited) | Also protects the tenant's payment eligibility in India |
| Platform's own billing | Selling the software to Indian tenants is ordinary B2B SaaS billing; the provider screen above concerns **tenants'** money, which the platform never holds (DEC-03) |

## 4. Letters to send (template in Phase A P2 §5)

| To | Ask |
|---|---|
| RazorpayX, Cashfree Payouts, PayU | Eligibility of a DPIIT-registered direct-selling entity (no joining fee) for product collection and commission payouts; definition of "MLM collection fees"; funds-in-transit holder |
| bKash (corporate) | Whether corporate disbursement may pay commission to independent affiliates; API availability; KYC of payees |
