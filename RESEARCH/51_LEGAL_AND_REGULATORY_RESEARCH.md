# 51 — LEGAL AND REGULATORY RESEARCH
## Jurisdiction screen v0.1 (promoted to Wave 1 as an early gate)

| Field | Value |
|---|---|
| Document ID | 51_LEGAL_AND_REGULATORY_RESEARCH |
| Version | 0.1 (**screening-grade**; supersedes nothing) |
| Date | 2026-11-11 |
| Research IDs | R-35 (jurisdiction by jurisdiction); starts R-36 (compliance safeguards); **R-39 (wallet/payout legality) is NOT started** |
| Sources | `S-xxx` IDs refer to 00_RESEARCH_SOURCE_REGISTER.md |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV] |

> **This is research, not legal advice.** I am not a lawyer. Most legal items below were read as **search excerpts of statutes, regulator pages, law-firm notes and news**, not as full primary texts (see register "Read" column). Every jurisdiction row needs a full primary-text read and **review by local counsel** before the founder, an investor or a product design depends on it. The purpose of this document is to find **category-level blockers early** and to derive candidate product requirements.

---

## 1. Questions this screen answers

1. Where is direct selling / MLM lawful, so that companies in the category can be our customers?
2. Where is a licence, registration or local presence required of the **customer**, and what does it demand from software (data location, disclosures, contracts, grievance handling)?
3. Which markets look like **no-go** or **high-risk** for an MLM-operator customer base?
4. What compliance features should the product contain (candidate requirements)?

It does **not** yet answer: whether a **software vendor** is itself exposed when a customer's plan is unlawful (§6, Q-1), or whether holding or moving participant money requires a financial licence (§5).

---

## 2. Summary matrix

Confidence: **M** = medium (multiple consistent excerpts, one or more primary or A-grade); **L** = low (single or secondary source, or sources conflict).

| Jurisdiction | MLM lawful? | Pyramid ban | Licence / registration of the company | Notable obligations touching software | Enforcement posture | Our-customer viability | Conf. |
|---|---|---|---|---|---|---|---|
| **United States** | Yes (not unlawful per se) | Yes (FTC, case law) | None federal; state rules **[UV]** | Documenting retail sales; incentive design | Active: Koscot, BurnLounge, Vemma; 2024 guidance | **Viable** | M |
| **United Kingdom** | Yes | Yes (DMCCA 2024 Sch 20 from 6 Apr 2025; earlier CPRs 2008) | None general; trading-scheme rules apply **[UV]** | Recruitment materials, agreements (Trading Schemes Regs 1997, per earlier notes) | CMA prosecuting; 9 convictions in one case | **Viable** (small market) | M |
| **EU** | Yes, subject to national law | Yes, absolute (UCPD Annex I pt 14) | National; not yet researched | Member-state specifics pending | CJEU broad reading of pyramid schemes | **Viable baseline; research needed** | M (EU level), L (national) |
| **India** | Yes under Rules | Yes (Direct Selling Rules 2021) | Rules apply to all direct selling entities incl. foreign; physical office, contracts | Written contracts, ID cards/KYC, website disclosures, grievance officer, **sensitive personal data stored in India** (per IMPRI) | State-level monitoring | **Viable, with localization** | M/L |
| **Malaysia** | Yes, **licensed** | Yes (Part VA, Act 500) | **Licence required; Malaysian-incorporated company** | Cooling-off rules; licence conditions | Active; 34 licences revoked (as of Aug 2020); Act under review | **Viable, licensed customers only** | M |
| **Bangladesh** | **Practically no** | MLM Act 2013 licence regime | Licensed 4 firms; **none renewed after 2015; ministry says no legal MLM companies** | E-commerce guidelines bar MLM via e-commerce; central-bank warnings | Six e-commerce sites shut (2022); fraud cases | **Not viable for MLM operators** [SR] | M/L |
| **UAE** | Unclear | Not clearly codified (conflicting reports) | Conflicting: "no specific licence" vs registration regime | Consumer-protection and marketing consent rules **[UV]** | Few cases found | **Unclear; tiny channel** | L |
| **Indonesia** | Yes, **licensed** | Yes | **SIUPL licence mandatory**; PP 3/2026 tightens requirements | No virtual offices; licensed sellers barred from marketplaces (C-grade source) | Tightening | **Viable but declining market** | M/L |
| **Philippines** | Yes | Yes (Consumer Act) | No dedicated law; voluntary DTI Seal of Legitimacy; draft rule would make recognition mandatory **[UV]** | Seal criteria | Moderate | **Viable but declining** | L |
| **Vietnam** | Yes, **licensed** | Yes | **Licence under Decree 40/2018**; website, complaint system, **IT system with a server in Vietnam**; deposits from participants prohibited | **In-country server** | Active | **Viable with data residency** | M |
| **Thailand** | Yes, **registered** | Yes | **OCPB registration; compensation plan reviewed**; draft capital/guarantee rules **[UV]** | Plan filing | Tightened in 2025 | **Viable but declining** | M/L |
| **Singapore** | **Generally prohibited**; exclusion order for legitimate schemes | Yes | Exemption by order; details **[UV]** | Narrow lawful set | Strict | **Do not enter yet** | M/L |

---

## 3. Jurisdiction notes

### 3.1 United States [VF, excerpt-level: S-020, S-021]

- FTC Business Guidance on MLM: published Jan 2018, **revised 30 Apr 2024** (date from earlier read, re-confirm). It is **non-binding staff guidance**.
- **No percentage test and no safe harbors.** The "primarily retail sales" rule of thumb is **not** the legal standard. Compensation incentives matter; **purchases made to qualify for recruitment rewards are evidence of a pyramid.** The FTC emphasizes documenting retail sales to real customers.
- Reference cases cited in law-firm analysis: Koscot (the origin of the pyramid test), BurnLounge, Vemma (S-021).
- **Unknown [UV]:** state pyramid, business-opportunity and consumer-protection statutes; earnings-claim rules (to be confirmed in a full read of S-020); privacy law (state level) obligations for the platform.

### 3.2 Bangladesh [high risk]

**Evidence.**
- The MLM (Control) Act regime dates from **2013**; operating without a licence carries up to **10 years' imprisonment and a Tk50 lakh fine** [VF, S-032; full read]. Licensing was under the Companies Act framework with annual renewal (earlier reading of S-033/S-034, excerpt).
- The ministry licensed **four** applicants, including Destiny 2000; **none renewed after 2015**; ministry sources said there are **currently no legal MLM companies in Bangladesh** [VF as to what ministry sources said, S-032 full read; S-031 excerpt, 14 May 2022].
- The 2021 Digital Commerce guidelines bar MLM through e-commerce (s3.1, per earlier read; S-035); six e-commerce sites were ordered shut in July 2022 [VF, S-032; corroborated by S-036, C-grade].
- Bangladesh Bank warned the public against investing in MLM schemes (Mar 2025, S-037, excerpt); a financial-intelligence report describes MLM fraud in disguised form (S-038, excerpt).

**Reading [SR, preliminary].** With no licensed operators and with active enforcement, **Bangladeshi MLM operators are not a viable customer base**, and building for them could expose the founder and the company to legal and reputational harm. Direct-selling-like models that are **not** MLM (single-level reselling, affiliate, distributor networks with documented customers) would need a separate analysis. **Decision needed from the founder: OQ-02 in file 66.** Confirm with Bangladeshi counsel; the status may have changed after 2022.

### 3.3 India

- **Consumer Protection (Direct Selling) Rules, 2021**, notified 28 Dec 2021 [RB, S-039, S-040, S-041; excerpts; notified text not yet read].
- Apply to **all direct selling entities, including foreign ones**. Reported obligations: prohibit pyramid and money-circulation schemes; **written contracts** between company and direct seller; a **physical office** in India; **website disclosures**; a **grievance officer**; **ID cards with KYC**; **storage of sensitive personal data in India** (Rule 5(5) per IMPRI, S-039); monitoring by state governments.
- **Unknown [UV]:** banning-of-schemes and unregulated-deposit legislation (not yet researched); the data-protection statute's interaction with Rule 5(5); how the state-monitoring mechanism operates in practice.
- **Product consequence [HY].** Data-residency option, e-contract capture, KYC, a grievance workflow and disclosure pages become **core features** for India, not add-ons.

### 3.4 Malaysia

- **Direct Sales and Anti-Pyramid Scheme Act 1993 (Act 500)**; KPDN (Ministry of Domestic Trade and Cost of Living) regulates [VF, S-042, S-043, S-014 (full)]. A **licence** is required; the company must be **incorporated in Malaysia**; Part VA bans pyramid schemes.
- **34** direct sales companies' licences were revoked for violations as of Aug 2020 [VF, S-015, full read]; a review of the Act was announced then and again on **10 Mar 2025** ("comprehensively amending", S-014, full read). On 10 Mar 2025 KPDN presented **45 licences** (18 new, 27 renewals).
- The KPDN-hosted PDF of the Act carries an odd "repealed" footnote and is **not relied on**; the Attorney-General's Chambers copy is the reference (S-042).
- **Unknown [UV]:** content of the pending amendments; whether the 10-working-day cooling-off period changed; the size discrepancy between Bernama (RM34.4B) and WFDSA (see 02 D-4).

### 3.5 United Kingdom

- Pyramid schemes were banned under **CPRs 2008 Sch 1 item 14**; the **DMCCA 2024** (Part 4 Ch 1, Sch 20) replaced the CPRs from **6 Apr 2025** [VF, S-022 to S-025; excerpts; S-024 is the commencement instrument, SI 2025/272].
- MLM is lawful but trading-scheme rules apply: **Trading Schemes Regulations 1997** govern recruitment materials and direct-seller agreements, with criminal liability for breach (earlier notes; **primary text not re-read**; S-027 is Part XI of the Fair Trading Act 1973). **Post-DMCCA status [UV].**
- The CMA obtained **nine convictions** in a gifting-style scheme (S-026). A 2008 High Court decision involving Amway is noted (S-028; case name unverified).
- The UK channel is small and declining (see 02): **$1,171M, −10.5% CAGR**.

### 3.6 European Union

- **UCPD 2005/29/EC Annex I point 14** prohibits establishing, operating or promoting a pyramid promotional scheme in all circumstances [VF, S-029 excerpt].
- The CJEU (15 Dec 2016, reported in S-030) is reported to hold that a financial contribution plus a (possibly indirect) link between new members' payments and existing members' compensation can suffice for a pyramid scheme. **Judgment not read; case number not recorded.**
- **Unknown [UV]:** national direct-selling laws (start with Germany: $19.1B, 11.6% of global sales); GDPR duties for a processor of rep data; consumer withdrawal rights and distance-selling rules.

### 3.7 UAE

- A 2017 report says the UAE has **no direct-selling statute** and describes a DSA-UAE registration regime covering 11 companies at that time (S-053). A DSA-UAE director said no specific licence is needed. **These statements conflict.** A practitioner blog (S-054, C-grade) describes licensing differently.
- A trade licence is needed to operate; the federal consumer-protection decree-law (reported as No. 14 of 2023) applies, including opt-in marketing (S-054; **needs a primary read**).
- **Reading [SR].** The domestic channel is tiny ($31.7M, 02). The UAE's relevance is as a **corporate base** for operators elsewhere, which raises counterparty-risk questions (a UAE entity running a high-risk plan in a third country). Do not treat the UAE as a market until the law is read.

### 3.8 Indonesia

- **SIUPL** (direct selling business licence) is required (S-055, C-grade; S-044, B). **Government Regulation PP 3/2026 (15 Jan 2026)** tightens trade licensing; Grade C sources add: no virtual offices (S-045). A law-firm source states **licensed direct sellers are barred from marketplaces or indirect channels** (needs primary confirmation).
- The market is **$1,092M, −11.3% in 2024** (02).

### 3.9 Philippines

- No dedicated direct-selling statute; the Consumer Act bans pyramid/chain distribution (S-056, C). DTI's **Seal of Legitimacy (DAO 21-09)** is voluntary (S-046, S-047); a draft order would make recognition mandatory (status **[UV]**).

### 3.10 Vietnam

- MLM is **allowed** under **Decree 40/2018/ND-CP** (effective 2 May 2018, replacing Decree 42/2014) [RB, S-048 excerpt]. Requirements reported: licence; **an IT system with a server in Vietnam**; a website; a complaint-handling system; **no deposits from participants**. Thirty-three MLM companies were reported as operating in 2018 (recheck).

### 3.11 Thailand

- **Direct Sale and Direct Marketing Act B.E. 2545 (2002)**: registration with the Office of the Consumer Protection Board (OCPB); the **compensation plan** is reviewed (S-049, S-050). Draft amendments propose paid-up capital of at least THB 10M and a guarantee of at least THB 500k; **current status [UV]**. OCPB tightened oversight in 2025 (S-049).

### 3.12 Singapore

- The **Multi-Level Marketing and Pyramid Selling (Prohibition) Act 1973** generally prohibits MLM and pyramid selling; an **exclusion order (2000)** exempts legitimate schemes (S-051, S-052). **Which schemes qualify [UV].** The market is small ($442M).

---

## 4. Candidate product requirements (provisional, to be validated in R-36)

These are **requirements the legal screen suggests**, not decisions. Each needs: (a) a primary-source check, (b) counsel review, (c) a place in the MVP scope decision (G4). `CMP-xx` IDs will be carried into the requirements specification and the traceability matrix.

| ID | Candidate requirement | Driven by | Label | Status |
|---|---|---|---|---|
| CMP-01 | Record and tag sales by **buyer type** (end customer vs participant/self-consumption) and report the retail-customer share | FTC emphasis on documented retail sales (3.1); EU/UK pyramid tests ("sale or consumption of products") | [SR] | Candidate |
| CMP-02 | Flag where **rank qualification or payout depends on personal purchases or required volume**, with a report per plan version | FTC: purchases to qualify are evidence of a pyramid (3.1) | [SR] | Candidate |
| CMP-03 | **Attribute every payout line to its source** (retail sale, team volume, recruitment-linked bonus), enabling the "derived primarily from introducing others" analysis | EU UCPD pt 14; CJEU reading; UK Sch 20 | [SR] | Candidate; needs counsel input on method |
| CMP-04 | **Versioned compensation plans** with approval, effective dates and an immutable audit trail | All; Thailand plan review; India disclosures | [SR] | Candidate |
| CMP-05 | **Earnings-disclosure reports** generated from actual payout data | FTC guidance on earnings claims (to be confirmed in a full read) | [HY] | Candidate; confirm |
| CMP-06 | **Electronic direct-seller agreements**, with retention and versioning | India (written contracts); UK trading-scheme rules; Vietnam | [SR] | Candidate |
| CMP-07 | Configurable **cooling-off / returns / buy-back** workflow per market | Malaysia (10 working days, S-015); others [UV] | [SR] | Candidate |
| CMP-08 | **In-country data storage option** per tenant | India Rule 5(5) (S-039); Vietnam in-country server (S-048) | [SR] | Candidate; has architecture cost |
| CMP-09 | **Grievance register and officer assignment** | India | [SR] | Candidate |
| CMP-10 | **KYC and ID-card issuance** for sellers | India | [SR] | Candidate |
| CMP-11 | **Public disclosure pages** (company, plan summary, contacts) | India | [SR] | Candidate |
| CMP-12 | **Licence/registration evidence per tenant** gating go-live and displayed to operators (Malaysian licence number, SIUPL, OCPB registration, Vietnam licence) | Malaysia, Indonesia, Thailand, Vietnam, India | [SR] | Candidate |
| CMP-13 | **Channel restrictions** (for example, no marketplace listing for tenants barred from it) | Indonesia (C-grade source) | [HY] | Needs primary confirmation |
| CMP-14 | **Participant-money guardrails**: block configurations that take deposits or non-refundable joining fees where prohibited | Vietnam (no deposits); general pyramid indicators | [HY] | Needs counsel |
| CMP-15 | **Marketing-consent management** | UAE decree (S-054, C); GDPR (to be researched) | [HY] | Needs primary source |
| CMP-16 | **Tenant acceptance policy and review**: onboarding questions and the ability to refuse or monitor tenants whose plan pays mainly on recruitment | Master Plan challenge C6; OQ-03 | [SR] | Needs founder decision |

---

## 5. Wallets, ledgers and payouts (R-39) — not started

What is known from this screen:

- Regulators treat **participant money flows** with suspicion: Vietnam prohibits participant deposits (S-048); Bangladesh Bank issued warnings on MLM schemes (S-037).
- **[HY, source pending]** In many jurisdictions, holding or transmitting funds for third parties can trigger money-transmission, e-money or payment-institution rules; platform "wallets" that hold rep balances are the highest-risk design. **Not verified for any jurisdiction here.**
- **[SR, provisional]** Design the MVP so the platform **calculates and instructs** payouts through a **licensed payment or payout provider** instead of **holding** funds. Validate in R-39 and with counsel before any wallet feature enters scope.

---

## 6. Open legal questions for counsel

| ID | Question | Why it matters | Jurisdiction |
|---|---|---|---|
| Q-1 | Could the software vendor be exposed (aiding, facilitating, or as a "promoter") if a customer's plan is held to be a pyramid scheme? | Determines the ethical-use policy, contracts and insurance | US, UK, EU, Malaysia, India |
| Q-2 | Does a platform that calculates commissions and instructs payouts need a licence? Does holding balances? | Decides wallet scope | Each target market |
| Q-3 | Is the Bangladesh position (no licensed MLM firms since 2015) current, and are non-MLM direct-selling or affiliate models lawful and in scope? | OQ-02 | Bangladesh |
| Q-4 | Which UK trading-scheme rules survive the DMCCA 2024? | UK requirements | UK |
| Q-5 | How do India's Rule 5(5) data-localization requirement and the data-protection law interact? | Architecture decision (CMP-08) | India |
| Q-6 | What do the pending Malaysian amendments change? | Product scope for a priority market | Malaysia |
| Q-7 | Which Singapore schemes are exempt? | Whether Singapore is ever viable | Singapore |
| Q-8 | What is the UAE position on direct selling licences? | Whether UAE is a market or just a corporate base | UAE |

---

## 7. Gate G1 (legal part): conditional pass

| Criterion (Roadmap §5) | Result |
|---|---|
| At least two target markets with a lawful direct-selling framework identified | **Met** at screening grade: US, UK, EU baseline, India, Malaysia (also Vietnam, Thailand, Indonesia, Philippines) |
| No regulatory finding that makes the whole category non-viable | **Met**: no category-wide blocker found. Bangladesh is a **market-level** blocker for MLM operators; Singapore is restricted |
| Evidence quality | **Screening-grade only**; 4 of 12 jurisdictions rest mostly on C-grade or secondary sources (UAE, Indonesia, Philippines, parts of Thailand) |

**Required before G2:** full reads of primary texts for US (FTC), Malaysia (Act 500), India (Rules), and counsel review of Q-1 and Q-2.
