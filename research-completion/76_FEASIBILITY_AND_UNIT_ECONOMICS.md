# 76 — FEASIBILITY AND UNIT ECONOMICS (INDIA, ILLUSTRATIVE)
## Which inputs decide whether the business can work — with every assumption labelled

| Field | Value |
|---|---|
| Document ID | P2-76 |
| Version | 0.1 |
| Date | 2026-11-12 |
| Model | `models/unit_economics.py`; output `models/unit_economics_output.txt` |
| Status | **Illustrative.** Every input below is an assumption (UE-xx), not a finding. The research has no price, cost or volume evidence for this product (OQ-09). Do not quote these figures as forecasts |

## 1. Assumptions

| ID | Input | Value used | Why this value | How to replace it |
|---|---|---|---|---|
| UE-01 | INR per USD | 85 | Round figure for comparison only | Use the rate on the day |
| UE-02 | Lean team cost | ₹6 lakh/month | A founder plus about three engineers at South-Asian rates | Founder (FD-03) |
| UE-03 | Standard team cost | ₹15 lakh/month | Adds product, support, sales | Founder (FD-03) |
| UE-04 | Fixed infrastructure per tenant | ₹8,000/month | Share of a pooled cell, backups, monitoring | Spike cost measurement |
| UE-05 | Infrastructure per active payee | ₹0.30/month | Storage and compute per payee | Spike |
| UE-06, 07 | Support | 10 hours/tenant/month at ₹1,000/hour | Placeholder | First tenants |
| UE-08 | Billing and collection loss | 3% of revenue | Typical card/transfer fees | Billing provider quote |
| UE-09 | Price per active payee | ₹3, ₹6, ₹10/month | Range to test, not a proposal | Interviews; design partner |
| UE-10 | Monthly minimum | ₹40,000 | Makes small tenants cover support | Interviews |
| UE-11 | Active payees per tenant | 2,000 / 10,000 / 50,000 | Mid-market range; no evidence | IDSA members; design partner export |
| UE-12, 13 | MVP-A flat fee | ₹30,000 / 60,000 / 1,00,000 per month; lighter cost | Range to test | Demand test (FD-10) |
| UE-14, 15 | Implementation | Fee ₹5 lakh; 250 hours | Placeholder | OQ-09 |

## 2. Results

**Model 1 — engine plus compliance (MVP-B), break-even number of tenants** (rounded to the nearest whole tenant; exact values in the output file)

| Price per payee | 2,000 payees | 10,000 payees | 50,000 payees |
|---|---|---|---|
| ₹3 | 30 (lean) / 74 (standard) | 34 / 84 | 5 / 13 |
| ₹6 | 30 / 74 | 16 / 40 | 2 / 6 |
| ₹10 | 30 / 74 | 8 / 20 | 1 / 3 |

**Model 2 — MVP-A compliance analytics only, flat fee**

| Monthly fee | Lean team | Standard team |
|---|---|---|
| ₹30,000 | 27 tenants | 68 tenants |
| ₹60,000 | 12 | 29 |
| ₹1,00,000 | 7 | 17 |

**Local anchor:** a mid-size tenant (10,000 payees at ₹6) would pay ₹7.2 lakh a year — about **1.6 times** the one-time price of Infinite MLM's Standard licence ($5,399 ≈ ₹4.6 lakh) **every year**.

## 3. What decides viability

1. **Tenant size.** Below about 10,000 active payees the monthly minimum, not the per-payee price, sets revenue, and break-even needs 30–80 tenants. Viability rests on reaching **large** Indian companies.
2. **Price acceptance against one-time licences.** The product must justify paying each year more than competitors charge once. Only compliance evidence and correctness can do that; the demand test measures it.
3. **Team cost.** A lean team halves the number of tenants needed. This favours building from a low-cost location (Bangladesh or India) — consistent with Bangladesh as build location (75).
4. **Implementation hours** (OQ-09): if a plan takes 250 hours, implementation is profitable at ₹5 lakh; if it takes 1,000 hours, it loses money.

## 4. Feasibility verdict

| Question | Answer |
|---|---|
| Is there a version of these assumptions under which India works? | Yes — 5–20 mid-to-large tenants at ₹6–10 per payee, or 7–30 MVP-A subscribers at ₹60,000–1,00,000 a month |
| Is there evidence that those numbers are achievable? | **No.** Company counts, price acceptance and tenant sizes are all unmeasured |
| Cheapest test | MVP-A with one Indian design partner at a stated price (FD-08, FD-10); ask IDSA for a member list to count the 10,000+ payee companies |
