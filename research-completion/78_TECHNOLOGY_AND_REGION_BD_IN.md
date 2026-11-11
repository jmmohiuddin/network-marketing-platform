# 78 — TECHNOLOGY AND HOSTING REGION: BANGLADESH AND INDIA
## Where tenant data can live, and what the India and Bangladesh packs need technically

| Field | Value |
|---|---|
| Document ID | P2-78 |
| Version | 0.1 |
| Date | 2026-11-12 |
| Closes | OQ-19 partly (regions for the candidate markets) |
| Sources | P2-S80..P2-S83 (79) |

## 1. Cloud regions

| Market | Hyperscaler region | Notes | Source |
|---|---|---|---|
| India | AWS **ap-south-1 Mumbai**; AWS **ap-south-2 Hyderabad** (opened Nov 2022); AWS Local Zone in Delhi; Google Cloud has two Indian regions (Mumbai, Delhi) | Two AWS regions allow an in-country primary and in-country backup | P2-S80, P2-S81, P2-S82 |
| Bangladesh | **No AWS, Azure or Google Cloud region found** | If strict localisation applies (70 §3), Bangladeshi data needs a local data centre or a local provider | P2-S83 (absence in search; verify on provider region pages) |

## 2. Consequences for the architecture

| Item | India | Bangladesh |
|---|---|---|
| Cell | India cell in ap-south-1 with backups in ap-south-2 (both in India) | None hosted; self-hosted edition on a local data centre if a lawful buyer appears |
| Backups, logs, support access | All in India; vendor support through approved, logged sessions only (ADR-12) | — |
| Cross-border analytics | Off by default for India tenants; aggregated metrics only | — |
| Self-hosted edition | Gains importance: buyers who read the Rules strictly may want their own servers | The only route if localisation is strict and no cloud region exists |
| No cloud-specific dependencies (TR-CON-11, ADR-16) | Keeps both paths open | Same |

## 3. Pack-level technical items

| Item | India pack | Bangladesh affiliate pack (conditional) |
|---|---|---|
| Currency, rounding | INR, paise (minor unit 2) | BDT, poisha (minor unit 2) |
| Withholding | Per-payee FY aggregation; threshold; PAN switch; 26Q export | Flat withholding line; TIN capture; statement export (format unknown) |
| Identity | PAN; KYC status; e-agreement version | TIN; NID — **restricted data** under the PDPO narrow reading |
| Grievance | Register with 48-hour acknowledgement and one-month resolution timers | 72-hour complaint response (e-commerce guideline) |
| Public outputs | Seller and delisted-seller register export | — |
| Payout files | NEFT/IMPS bank file; RazorpayX/Cashfree adapters after confirmation | bKash corporate disbursement file (after confirmation) |
| Languages | English first; Hindi and regional languages for distributor statements (OQ-03) | Bangla |
| Calendar | Financial year April–March | Fiscal year July–June (to confirm) |

## 4. Open items

| ID | Item |
|---|---|
| OQ-19 | Confirm region list on provider pages before a contract; check Azure India regions |
| OQ-38 | Bangladesh local hosting providers and their certifications — only if AQ-BD-01 opens a market |
