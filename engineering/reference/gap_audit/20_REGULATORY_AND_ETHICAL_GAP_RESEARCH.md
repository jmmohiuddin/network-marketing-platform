# 20 — REGULATORY AND ETHICAL GAP RESEARCH
## Laws that bind the platform itself, not only its customers — and which duties are mandatory

| Field | Value |
|---|---|
| Document ID | GAP-20 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Domain | Brief §5, Domain 14 |
| Gaps | GAP-085 to GAP-088 (tax in GAP-031, payment policies in GAP-004) |
| Not legal advice | Screening-grade from law-firm and adviser summaries (Grade B) and first-party documents; counsel must confirm before any design depends on it (original A-07, OQ-09) |

## 1. What the original legal screen covered and what it left out

The original 51 asks whether **the tenant's** business is lawful in each market, and what that means for features (CMP-01..19), plus whether the platform can move money (51 §5). It does not ask which laws apply to **the platform as a business**: privacy law as a processor, tax steps in payouts, payment-provider rules, advertising rules for content it hosts, and subscription, communications and accessibility law in the markets it would serve.

## 2. Mandatory vs recommended (screening view)

**Mandatory** = a law or binding order requires it of someone in the chain (tenant or platform) in that market. **Recommended** = good practice or industry guidance. **Contractual** = required by a provider's terms.

| Requirement | Market | Binds | Class | Architecture effect | Source |
|---|---|---|---|---|---|
| No pay solely for recruiting; no pyramid | US, UK, EU, MY, IN, others | Tenant | Mandatory | Payout-line source attribution (CMP-03) | S-020, S-029, S-042, G-S02 |
| Personal-consumption share limits, retail data records | Herbalife only (binding); others as evidence | One tenant | Mandatory for one company; **recommended** elsewhere | Purpose tag; participant types (GAP-028) | G-S02 |
| Earnings claims substantiation; records on request | US (proposed rule) | Tenant | **Proposed** (Jan 2025 NPRM; status unknown) | Disclosure computed from payouts; retained substantiation (GAP-086) | G-S03 |
| Payout withholding and statements | MY (s.107D, CP58), IN (s.194H), US (1099) | Tenant as payer | Mandatory | Tax engine step in payouts (GAP-031) | G-S05, G-S12, G-S13 |
| Processor security duties; DPO; breach notification | MY (PDPA amended 2025) | **Platform** (as processor) and tenant | Mandatory | Security controls, DPO appointment, incident process (GAP-085) | G-S14 |
| Notice, consent, security, breach, retention, cross-border | IN (DPDP, from 13 May 2027) | Tenant (fiduciary); platform under contract | Mandatory (from 2027) | Consent records, retention timers, transfer controls (GAP-085) | G-S10 |
| In-country storage of certain data | IN (Rule 5(5) as reported), VN | Tenant | Mandatory (to confirm) | Regional cells (GAP-061) | S-039, S-048 |
| MLM merchant restrictions | Global (provider terms) | Tenant and platform | **Contractual** | Specialist provider adapters (GAP-004) | G-S04, G-S20, G-S21 |
| Licence filings: sample contract, buy-back policy, plan amendments | MY | Tenant | Mandatory | Versioned plans, buy-back workflow (CMP-04, CMP-07) | S-043 |
| Cooling-off and buy-back | MY, several US states | Tenant | Mandatory | Reversal rules per market (BR-REV-04, -05) | S-015, S-124 |
| Income disclosure statements | US (DSSRC guidance) | Tenant | Recommended (self-regulation) | Disclosure from payout data (CMP-05) | G-S34 (title), G-S15 |
| Distributor social-media claims monitoring | US | Tenant (liable for distributors' claims) | Mandatory outcome (no deceptive claims); monitoring method recommended | Approved-content and disclosure data; partner monitoring (GAP-001) | G-S15, G-S18 |
| Autoship consent and easy cancellation | US (ROSCA; FTC rule vacated 2025, restarted), states | Merchant of record | Mandatory (ROSCA); rule [UV] | Consent records where the platform runs checkout (GAP-046) | S-126, S-127 |
| Marketing consent (email, SMS, WhatsApp) | Most markets | Sender | Mandatory | Consent per channel (BR-DAT-04) | CMP-15 (unverified primary) |
| Accessibility of consumer e-commerce | EU (European Accessibility Act, from June 2025) | E-commerce providers | Mandatory in EU [to confirm scope] | WCAG-based distributor and customer pages (GAP-051) | Not sourced in this audit [UV] |
| Worker classification of distributors | Varies | Tenant | Mandatory (varies) | None directly; avoid employment-like controls in product copy | WFDSA flags (S-001); not researched [UV] |

## 3. Gap records

### GAP-085 — Privacy duties of the platform as a processor

| Field | Content |
|---|---|
| **Category** | Compliance, technical |
| **Previous research coverage** | CMP-08 (residency), CMP-15 (consent), BR-DAT-01..05; Q-5 (residency vs data-protection statute); DPDP named only in 06 via a Herbalife risk factor |
| **Missing element** | The platform's own obligations and their timelines |
| **Evidence** | Malaysia: processors directly bound by the security principle from 1 Apr 2025; DPO for controllers **and processors** and breach notification from 1 Jun 2025; fines up to RM1M (G-S14). India: DPDP Rules notified 13 Nov 2025; substantive duties from 13 May 2027 (G-S10) |
| **Why it matters** | A processor with tenants in Malaysia must appoint a DPO and meet security duties **from its first Malaysian tenant** |
| **Affected stakeholders** | Platform, tenants, distributors |
| **Product implications** | Data-processing agreement template; breach-notification runbook with tenant notification; data-subject request tooling (access, correction, erasure, portability) |
| **Technical implications** | Retention timers per data class; erasure that preserves ledger integrity (pseudonymise payee records rather than delete postings); audit of personal-data access |
| **Recommended solution** | Write a privacy-by-design requirement set (29) for the launch market; budget a DPO function |
| **Priority** | High |
| **Implementation stage** | MVP |
| **Confidence** | Medium-High |
| **Documentation changes required** | 51 (new §: platform obligations), 15 BR-DAT |

### GAP-086 — FTC earnings-claim proposal: substantiation and records

| Field | Content |
|---|---|
| **Category** | Compliance |
| **Previous research coverage** | 51 §4.1 (named as a Nu Skin risk heading only) |
| **Missing element** | Content of the proposal and its product meaning |
| **Evidence** | NPRM 13 Jan 2025: prohibit misleading or unsubstantiated earnings claims; provide substantiation on request in the language of the claim; keep substantiation records; bar recruitment materials with deceptive claims. ANPRM: possible required earnings disclosure and cooling-off (G-S03). Final status unknown |
| **Why it matters** | If adopted, US tenants need defensible earnings data on demand: exactly what a payout platform holds |
| **Affected stakeholders** | US tenants, Compliance |
| **Product implications** | Earnings-disclosure computation over **all** participants including zero earners; versioned, reproducible disclosure snapshots retained with the method |
| **Technical implications** | Disclosure as a committed, versioned report tied to runs |
| **Recommended solution** | Treat as V1 for US tenants; monitor the rulemaking |
| **Priority** | High (US) |
| **Implementation stage** | V1 |
| **Confidence** | Medium (content High; status Unknown) |
| **Documentation changes required** | 51 CMP-05 |

### GAP-087 — Which compliance behaviour is mandatory platform behaviour, and vendor liability

| Field | Content |
|---|---|
| **Category** | Compliance, strategy |
| **Previous research coverage** | D-R4, D-R6 (open), Q-1 (open), OQ-03 (acceptance policy assumed) |
| **Missing element** | A decision and counsel's view |
| **Evidence** | None new on vendor liability; FTC guidance mentions "means and instrumentalities" without naming software vendors (S-020). Payment providers already refuse MLM merchants contractually (G-S04, G-S20) — showing that **intermediaries in this industry protect themselves by policy** |
| **Why it matters** | It decides whether the platform blocks configurations (e.g., pay on enrolment fees), only warns, or stays neutral; it shapes contracts, insurance and brand |
| **Affected stakeholders** | Founder, counsel, tenants |
| **Product implications** | Three levels: **blocked** (e.g., payout line solely for enrolling where the market bans it), **warned and logged** (personal-consumption share above a threshold), **reported** (retail share) |
| **Technical implications** | Rule engine for platform-level guardrails separate from tenant plan rules |
| **Recommended solution** | Founder decides with counsel before MVP scope; this audit's default proposal is in 24 (BR-GRD) |
| **Priority** | **Critical** |
| **Implementation stage** | Before MVP |
| **Confidence** | Unknown (legal question) |
| **Documentation changes required** | 15 §3, 51 §6, 66 OQ-03, OQ-09 |

### GAP-088 — Communications, subscriptions outside the US, accessibility, worker status

| Field | Content |
|---|---|
| **Category** | Compliance |
| **Previous research coverage** | CMP-15 [HY]; P-11 (US only) |
| **Missing element** | Primary-source checks per launch market |
| **Evidence** | None gathered in this audit beyond §2 notes |
| **Why it matters** | Each becomes mandatory in the market where the product launches |
| **Affected stakeholders** | Tenants, platform |
| **Product implications** | Consent per channel; cancellation flows; accessible pages |
| **Technical implications** | Market-scoped configuration |
| **Recommended solution** | Research only for the chosen launch market |
| **Priority** | Medium |
| **Implementation stage** | Per market |
| **Confidence** | Low |
| **Documentation changes required** | 51 |

## 4. Ethical position (input to 33 and 35)

The evidence (G-S15, G-S16, G-S27) supports three platform-level commitments, independent of any market's law: **(1)** no income projection features; **(2)** earnings disclosures computed from real payouts including zero earners; **(3)** a written tenant acceptance policy (OQ-03) with technical guardrails (GAP-087). These also reduce the vendor-exposure question (Q-1) and are consistent with how payment providers already treat the category.
