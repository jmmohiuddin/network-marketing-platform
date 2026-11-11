# P2 — PAYMENT AND PAYOUT PROVIDER SCREEN (US, MALAYSIA, INDIA)
## What providers' own published policies say about MLM merchants — and the questions to confirm in writing

| Field | Value |
|---|---|
| Document ID | PA-P2 |
| Version | 0.1 |
| Date | 2026-11-11 (all pages accessed this date) |
| Task | Phase A, item 2 (GAP-004, AQ-01) |
| Status | **Desk screen only. Nothing has been confirmed with any provider; no message has been sent.** Policies change; a provider's written answer overrides anything here |
| Not advice | Provider terms are contracts; whether a tenant's plan fits a provider's category is the provider's decision |

## 0. Result in five lines

1. **Mainstream card acceptance is closed or conditional for MLM merchants** in all three markets: Stripe prohibits MLM; PayPal requires pre-approval; Zoho Payments India and Cashfree prohibit "multi-level marketing collection fees"; iPay88 (Malaysia) lists MLM among "banned and high-risk industries".
2. **The wording varies and is not always a full ban.** iPay88 lists "Multi-level marketing businesses, Unlicensed Multi-level marketing" under *banned and high-risk*; Cashfree and Zoho name "MLM **collection fees**" (joining fees), which may or may not cover product sales by a licensed direct seller. Only a written answer settles it.
3. **Specialist payout providers serve direct sellers** (PayQuicker, i-payout, Hyperwallet appear with direct-selling brands and back-office vendors), but the pages read **do not mention Malaysia or India** and do not say who holds funds.
4. **For the platform this means:** tenants bring their own merchant and payout accounts (Option 1, original 51 §5.4); the platform must support **several adapters** and record **each tenant's provider approval** before go-live (BR-PAY-11, CPL-11).
5. **The platform's own billing** (charging tenants a subscription) is a separate question: a SaaS vendor is not itself an MLM, but whether providers will bill a vendor whose customers are MLMs is **unconfirmed** — ask.

## 1. Screen

**Status codes:** **P** prohibited by published policy · **A** requires provider approval · **H** listed as banned/high-risk (status per case) · **S** markets itself to direct sellers (eligibility still to confirm) · **?** policy not found.

| Provider | Role | Market | Published wording (quoted) | Status | Source |
|---|---|---|---|---|---|
| Stripe | Cards, payouts | Global (US) | Prohibited: "Pyramid schemes"; "Multilevel marketing services offering commission or recruitment-based sales" | **P** | G-S04 |
| PayPal | Wallet, cards | Global | Prohibits transactions that "support pyramid or ponzi schemes, matrix programs, other 'get rich quick' schemes or certain multi-level marketing programs"; MLM and direct selling require pre-approval | **A** | G-S20 |
| Zoho Payments | Cards, UPI | India | Prohibited: "Multi-level marketing collection fees" | **P** (fees; product sales unclear) | G-S21 |
| Cashfree | Cards, UPI, payouts | India | Does not support "Multi-level marketing collection fees, Ponzi schemes, or matrix schemes" | **P** (fees; product sales unclear) | G-S54 |
| Razorpay / RazorpayX | Cards, UPI, payouts | India (Curlec in Malaysia) | No MLM entry found in the documents read; extra certifications "depending on the line of business" | **?** | G-S23, G-S55 |
| iPay88 | Cards, FPX, e-wallets | Malaysia | "Non-exhaustive list of Banned and High-Risk Industries": "Multi-level marketing businesses, Unlicensed Multi-level marketing"; "Pyramid or ponzi scheme, matrix program and other 'get rich quick' schemes" | **H** | G-S56 |
| Nexio | Card processing | Global (listed by Exigo) | Exigo calls Nexio its "trusted partner"; page gives no country list and no statement on MLM merchant accounts | **S** (via back-office vendors) | G-S57 |
| PayQuicker | Payouts, e-wallet | 210+ countries (claim) | Partner of Exigo; branded wallets for Young Living and MONAT (trade news) | **S** | S-114, S-115, G-S58 |
| i-payout | Payouts, e-wallet | 180–200+ countries (claim) | Serves "direct sales"; NMLS ID 2689748 shown; integrations with Exigo, DirectScale, InfoTrax (vendor-authored comparison, 2025–26) | **S** | G-S58 |
| Hyperwallet (PayPal) | Payouts | Global | Logo on InfoTrax page; trade press on direct-seller payouts (title only) | **S** | S-093 |
| High-risk merchant-account brokers (e.g., PaymentCloud "MLM credit card processing") | Card acquiring via partner banks | US | Market MLM merchant accounts (title only) | **S** (US) | search result only |
| Billplz, Fiuu (Razer), Curlec | Payments | Malaysia | Not read | **?** | — |
| PayU, CCAvenue | Payments | India | Not read | **?** | — |

## 2. What this means for the product (no change to the audit's design stance)

| Design point | Reason |
|---|---|
| Tenant-owned merchant and payout accounts; the platform holds no funds | Provider eligibility is decided per merchant; the platform cannot underwrite for them (A-02) |
| At least two payout adapters per launch market, plus a bank-file fallback | Specialist providers do not show coverage of Malaysia or India |
| Go-live checklist records provider name, approval date and approved business description per tenant | Policies distinguish "collection fees" from product sales; the approved description is evidence (CPL-11) |
| Guardrail BR-GRD-02 (no participant fees where prohibited) also protects payment eligibility | Two Indian providers name **MLM collection fees** specifically |
| Order ingestion must not depend on one checkout provider | Tenants in the same market may use different processors |

## 3. Written-confirmation requests (drafts for the founder to send; not sent)

Send from your own business address. Replace bracketed text. Do not describe any tenant's plan as approved until the provider says so in writing.

**Q-set A — to payment and payout providers (per market)**

> Subject: Eligibility question: software platform for licensed direct-selling companies in [Malaysia / India / US]
>
> Hello [Provider] team,
> I am [NAME], [ROLE] at [COMPANY]. We are designing software that calculates sales commissions for **licensed direct-selling companies** and sends payout instructions to the company's own payment provider. Our platform **does not hold or move funds itself**.
> Before we go further, could you confirm in writing:
> 1. Whether a direct-selling company **licensed or registered** in [market] (for example under [Malaysia: Act 500 / India: Consumer Protection (Direct Selling) Rules 2021]) can open a merchant account with you to accept **payments for products**.
> 2. Whether that changes if the company also collects **starter-kit or membership fees**, and how you define "MLM collection fees" in your policy (for India) or "Multi-level marketing businesses" in your high-risk list (for Malaysia).
> 3. Whether the company can use your **payout service** to pay commissions to individual distributors in [market], by which methods (bank transfer, DuitNow/UPI, wallet, card), and who holds the funds in transit.
> 4. What documents you need (licence, compensation plan, refund policy, income disclosure) and how long review takes.
> 5. Whether you would allow **API integration** by a third-party software platform acting on the company's instructions, and any certification needed.
> Thank you. [CONTACT]

**Q-set B — to the provider you would use for the platform's own subscription billing**

> We sell software subscriptions to direct-selling companies. We are not a direct-selling company and do not take part in any compensation plan. Would you accept us as a merchant for our own subscription billing, and is there any restriction because our customers are direct-selling companies?

## 4. What would change the plan

| Answer | Consequence |
|---|---|
| No provider in the launch market accepts licensed MLM merchants for product payments | **Stop trigger** for that market (32 §5 of the audit); choose another market or stop |
| Providers accept product payments but not fees | Platform blocks fee configurations for that market (BR-GRD-02) |
| No payout provider covers the market | Bank-file payouts only (slower; more reconciliation work); price it into implementation |
| Platform's own billing refused by mainstream providers | Use a different billing provider or invoice by bank transfer |

## 5. Sources (accessed 2026-11-11)

| ID | Source | URL |
|---|---|---|
| G-S04 | Stripe — Restricted and Prohibited Businesses | https://stripe.com/legal/restricted-businesses |
| G-S20 | PayPal — Acceptable Use Policy (UK) | https://www.paypal.com/uk/webapps/mpp/ua/acceptableuse-full |
| G-S21 | Zoho Payments India — prohibited and restricted businesses | https://www.zoho.com/in/payments/prohibited-restricted-businesses.html |
| G-S23 | RazorpayX — bulk payouts documentation | https://razorpay.com/docs/razorpayx/bulk-payouts/ |
| G-S54 | Cashfree — Onboarding FAQs | https://www.cashfree.com/docs/help/onboarding-related/onboarding-faqs |
| G-S55 | Razorpay — business types and KYC documents | https://razorpay.com/docs/build/llm-docs/payments/business-types-kyc-documents.md |
| G-S56 | iPay88 Malaysia — merchant agreement Appendix B (undated) | https://ipay88.com/agreement/myrgateway/Appendix_B.pdf |
| G-S57 | Exigo — Nexio partner page | https://www.exigo.com/company/partners/nexio/ |
| G-S58 | i-payout — "i-payout vs PayQuicker" (vendor-authored, 24 Jan 2025, updated 4 Feb 2026) | https://i-payout.com/blog/i-payout-vs-payquicker-choosing-the-best-global-payout-solution-for-your-business |
| S-114, S-115 | Exigo and trade news on PayQuicker (original register) | — |
