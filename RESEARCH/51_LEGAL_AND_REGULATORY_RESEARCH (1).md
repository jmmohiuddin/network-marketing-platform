# 51 — LEGAL AND REGULATORY RESEARCH
## Jurisdiction screen v0.1 (promoted to Wave 1 as an early gate)

| Field | Value |
|---|---|
| Document ID | 51_LEGAL_AND_REGULATORY_RESEARCH |
| Version | 0.2 (**screening-grade**; Wave 2: FTC, India and Malaysia detail added; §5 R-39/R-38 first pass; supersedes v0.1) |
| Date | 2026-11-11 |
| Research IDs | R-35 (jurisdiction by jurisdiction); starts R-36 (compliance safeguards); **R-39 (wallet/payout legality) first pass in §5**; R-38 (payment localization) first pass in §5.6 |
| Sources | `S-xxx` IDs refer to 00_RESEARCH_SOURCE_REGISTER.md |
| Labels | [VF] · [RB] · [IP] · [HY] · [SR] · [UV] |

> **This is research, not legal advice.** I am not a lawyer. Most legal items below were read as **search excerpts of statutes, regulator pages, law-firm notes and news**, not as full primary texts (see register "Read" column). Every jurisdiction row needs a full primary-text read and **review by local counsel** before the founder, an investor or a product design depends on it. The purpose of this document is to find **category-level blockers early** and to derive candidate product requirements.

---

## 1. Questions this screen answers

1. Where is direct selling / MLM lawful, so that companies in the category can be our customers?
2. Where is a licence, registration or local presence required of the **customer**, and what does it demand from software (data location, disclosures, contracts, grievance handling)?
3. Which markets look like **no-go** or **high-risk** for an MLM-operator customer base?
4. What compliance features should the product contain (candidate requirements)?

It does **not** answer whether a **software vendor** is itself exposed when a customer's plan is unlawful (§6, Q-1). Whether holding or moving participant money requires a financial licence has a **first-pass answer in §5** (screening grade, counsel questions Q-2 and Q-9 open).

---

## 2. Summary matrix

Confidence: **M** = medium (multiple consistent excerpts, one or more primary or A-grade); **L** = low (single or secondary source, or sources conflict).

| Jurisdiction | MLM lawful? | Pyramid ban | Licence / registration of the company | Notable obligations touching software | Enforcement posture | Our-customer viability | Conf. |
|---|---|---|---|---|---|---|---|
| **United States** | Yes (not unlawful per se) | Yes (FTC, case law) | None federal; state rules **[UV]** | Documenting retail sales; incentive design | Active: Koscot, BurnLounge, Vemma; 2024 guidance | **Viable** | M |
| **United Kingdom** | Yes | Yes (DMCCA 2024 Sch 20 from 6 Apr 2025; earlier CPRs 2008) | None general; trading-scheme rules apply **[UV]** | Recruitment materials, agreements (Trading Schemes Regs 1997, per earlier notes) | CMA prosecuting; 9 convictions in one case | **Viable** (small market) | M |
| **EU** | Yes, subject to national law | Yes, absolute (UCPD Annex I pt 14) | National; not yet researched | Member-state specifics pending | CJEU broad reading of pyramid schemes | **Viable baseline; research needed** | M (EU level), L (national) |
| **India** | Yes under Rules | Yes (Direct Selling Rules 2021) | Rules apply to all direct selling entities incl. foreign; physical office, contracts; **461+ registered entities (2025, secondary)** | Written contracts, seller identity records, website disclosures, grievance officer and nodal person, delisted-seller list, **sensitive personal data stored in India** (per IMPRI) | State-level monitoring | **Viable, with localization** | M/L |
| **Malaysia** | Yes, **licensed** | Yes (Part VA, Act 500) | **Licence required; Malaysian-incorporated company**; about 400 licensed companies, 18% foreign (2023, S-082); **application needs a sample contract, a buy-back policy, price-structure and marketing-plan-amendment forms (S-043)** | Cooling-off rules; licence conditions (not stated on the page read) | Active; 34 licences revoked (as of Aug 2020); Act under review | **Viable, licensed customers only** | M |
| **Bangladesh** | **Practically no** | MLM Act 2013 licence regime | Licensed 4 firms; **none renewed after 2015; ministry says no legal MLM companies** | E-commerce guidelines bar MLM via e-commerce; central-bank warnings | Six e-commerce sites shut (2022); fraud cases | **Not viable for MLM operators** [SR] | M/L |
| **UAE** | Unclear | Not clearly codified (conflicting reports) | Conflicting: "no specific licence" vs registration regime | Consumer-protection and marketing consent rules **[UV]** | Few cases found | **Unclear; tiny channel** | L |
| **Indonesia** | Yes, **licensed** | Yes | **SIUPL licence mandatory**; PP 3/2026 tightens requirements | No virtual offices; licensed sellers barred from marketplaces (C-grade source) | Tightening | **Viable but declining market** | M/L |
| **Philippines** | Yes | Yes (Consumer Act) | No dedicated law; voluntary DTI Seal of Legitimacy; draft rule would make recognition mandatory **[UV]** | Seal criteria | Moderate | **Viable but declining** | L |
| **Vietnam** | Yes, **licensed** | Yes | **Licence under Decree 40/2018**; website, complaint system, **IT system with a server in Vietnam**; deposits from participants prohibited | **In-country server** | Active | **Viable with data residency** | M |
| **Thailand** | Yes, **registered** | Yes | **OCPB registration; compensation plan reviewed**; draft capital/guarantee rules **[UV]** | Plan filing | Tightened in 2025 | **Viable but declining** | M/L |
| **Singapore** | **Generally prohibited**; exclusion order for legitimate schemes | Yes | Exemption by order; details **[UV]** | Narrow lawful set | Strict | **Do not enter yet** | M/L |

---

## 3. Jurisdiction notes

### 3.1 United States [VF, S-020 read in full in Wave 2; S-021 excerpt]

- **FTC Business Guidance Concerning Multi-Level Marketing:** published 4 Jan 2018, **last modified 30 Apr 2024** (confirmed in Wave 2). It is **non-binding staff guidance** (S-020, Grade A).
- **No percentage test and no safe harbors.** The guidance says there is "no percentage-based test" and "no safe harbor". Sales receipts are relevant but "not dispositive". **Purchases made to qualify for recruitment incentives point toward a pyramid** (the guidance calls this inventory loading).
- **Earnings claims.** Claims should reflect what the **typical participant** earns; an MLM without evidence of that "should refrain from making any earnings claims". Income disclosures must not omit participants who lost money.
- **"Means and instrumentalities."** The guidance says MLMs may be liable if they provide the means and instrumentalities for others' false representations. **It does not mention software vendors or payment processors.** Whether a software vendor could be reached by this or any other theory is **counsel question Q-1; no conclusion is drawn here.**
- Reference cases in law-firm analysis: Koscot (origin of the pyramid test), BurnLounge, Vemma (S-021).
- **Unknown [UV]:** state pyramid, business-opportunity and consumer-protection statutes; state privacy-law duties for the platform; money-transmitter rules (§5).

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
- **Wave 2 detail (secondary sources only: S-083, S-084, S-085; rule numbers unreliable and not cited):** an enforceable written contract with sellers; a registered office in India; website disclosures; a **grievance officer** (reported: acknowledgement within 48 hours, resolution within one month) and a **nodal compliance person**; **seller records including identity and contact details**; a **list of delisted sellers published on the company's website**; personal data stored in India; convergence with the National Consumer Helpline. The Department of Consumer Affairs figure of **461+ registered direct selling entities (2025)** is quoted by a law-firm page (S-083).
- **Correction to v0.1 [HY]:** "ID cards" in v0.1 was reported as a general KYC feature. Wave 2 secondary sources describe **seller identity records** and, as reported, ID cards for sellers who visit consumers; the Rules' text was not read, so CMP-10 is reworded (§4).
- **Unknown [UV]:** banning-of-schemes and unregulated-deposit legislation (not yet researched); the data-protection statute's interaction with Rule 5(5); how the state-monitoring mechanism operates in practice; the Rules' own text (Gazette notification).
- **Product consequence [HY].** Data-residency option, e-contract capture, KYC, a grievance workflow and disclosure pages become **core features** for India, not add-ons.

### 3.4 Malaysia

- **Direct Sales and Anti-Pyramid Scheme Act 1993 (Act 500)**; KPDN (Ministry of Domestic Trade and Cost of Living) regulates [VF, S-042, S-043, S-014 (full)]. A **licence** is required; the company must be **incorporated in Malaysia**; Part VA bans pyramid schemes.
- **34** direct sales companies' licences were revoked for violations as of Aug 2020 [VF, S-015, full read]; a review of the Act was announced then and again on **10 Mar 2025** ("comprehensively amending", S-014, full read). On 10 Mar 2025 KPDN presented **45 licences** (18 new, 27 renewals).
- **KPDN licence application (S-043, Grade A, read in full in Wave 2).** New and renewal applications use **Form AJL-1** plus: a company information and performance form, a **sample sales contract**, a **sample buy-back policy**, a price-structure form (Format A), a form justifying **amendments to the marketing plan** (Format B), and checklists. **The page does not state eligibility, fees, validity or licence conditions.** These documents tell us what a licensed company must be able to produce: they are the basis for CMP-04 and CMP-07.
- The KPDN-hosted PDF of the Act carries an odd "repealed" footnote and is **not relied on**. The Attorney-General's Chambers copy (S-042) is the reference, but it is **robots-disallowed and could not be fetched in Wave 2**; the Act's text remains unread.
- **Unknown [UV]:** content of the pending amendments; whether the 10-working-day cooling-off period changed; the Malaysian size discrepancy (Bernama RM34.4B vs WFDSA 46,667M local currency; 02 D-4 and §2.2); the Act's primary text; licence conditions.

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
| CMP-04 | **Versioned compensation plans** with approval, effective dates and an immutable audit trail; **a record of each amendment and its justification** | All; Thailand plan review; India disclosures; **Malaysia: form justifying marketing-plan amendments (S-043)** | [SR] | Candidate |
| CMP-05 | **Earnings-disclosure reports** generated from actual payout data, covering the typical participant and including participants who earned little or nothing | **FTC guidance, read in full: earnings claims must reflect the typical participant; disclosures must not omit those who lost money (S-020)** | [RB] | Candidate; counsel to confirm form |
| CMP-06 | **Electronic direct-seller agreements**, with retention and versioning | India (written contracts); UK trading-scheme rules; Vietnam | [SR] | Candidate |
| CMP-07 | Configurable **cooling-off / returns / buy-back** workflow per market, with a stored **buy-back policy** per tenant | Malaysia (10 working days, S-015; **sample buy-back policy required in the licence application, S-043**); others [UV] | [SR] | Candidate |
| CMP-08 | **In-country data storage option** per tenant | India Rule 5(5) (S-039); Vietnam in-country server (S-048) | [SR] | Candidate; has architecture cost |
| CMP-09 | **Grievance register and officer assignment**, with response-time tracking (as reported: 48-hour acknowledgement, one-month resolution) and a named compliance contact | India (S-085, secondary) | [SR] | Candidate; confirm against the Rules' text |
| CMP-10 | **Seller identity records** (and ID cards where required for sellers who visit consumers) | India (S-085; ID-card scope not confirmed, see §3.3) | [HY] | Candidate; reworded in v0.2 |
| CMP-11 | **Public disclosure pages** (company, plan summary, contacts) | India | [SR] | Candidate |
| CMP-12 | **Licence/registration evidence per tenant** gating go-live and displayed to operators (Malaysian licence number, SIUPL, OCPB registration, Vietnam licence) | Malaysia, Indonesia, Thailand, Vietnam, India | [SR] | Candidate |
| CMP-13 | **Channel restrictions** (for example, no marketplace listing for tenants barred from it) | Indonesia (C-grade source) | [HY] | Needs primary confirmation |
| CMP-14 | **Participant-money guardrails**: block configurations that take deposits or non-refundable joining fees where prohibited | Vietnam (no deposits); general pyramid indicators | [HY] | Needs counsel |
| CMP-15 | **Marketing-consent management** | UAE decree (S-054, C); GDPR (to be researched) | [HY] | Needs primary source |
| CMP-16 | **Tenant acceptance policy and review**: onboarding questions and the ability to refuse or monitor tenants whose plan pays mainly on recruitment | Master Plan challenge C6; OQ-03 | [SR] | Needs founder decision |
| CMP-17 | **Delisted-seller register**, publishable on the tenant's website | India (S-085, secondary) | [SR] | Candidate; new in v0.2 |

---

## 5. Wallets, ledgers and payouts (R-39) and payment localization (R-38): first pass

**Status.** First pass at **screening grade**. Regulators' texts were read in part: FinCEN ruling in full (S-110); FCA page in full (S-111); the BNM policy page as a summary only, with the PDF unread (S-112); the RBI directions through a law-firm summary (S-113). **This is not legal advice**, and no jurisdiction's rules have been applied to a specific design by counsel. Q-2 and Q-9 (§6) are open.

### 5.1 The question

Our platform would **calculate commissions** for a tenant company and then either (a) **instruct** payment from the tenant's funds to its sellers, or (b) **hold balances** for sellers. The first is a software function; the second may be a regulated financial service. Which side of that line each design falls on depends on the market.

### 5.2 What the sources say (principles, per market)

| Market | Source | What it says | What it does **not** settle | Label |
|---|---|---|---|---|
| **US** | FinCEN Ruling FIN-2014-R009 (S-110, A-grade, 27 Aug 2014) | A "payment processor" can be exempt from money-transmitter status under 31 CFR 1010.100(ff)(5)(ii)(B) where it **facilitates the purchase of goods or services**, operates through clearance and settlement systems that admit only BSA-regulated institutions, and has a formal agreement at least with the seller or creditor that receives the funds. The ruling is fact-specific and the method of disbursement matters | Whether paying **commissions to sellers** fits an exemption written around purchases of goods or services; state money-transmitter licensing (not read) | [RB] for the text; fit to commission payouts [UV], counsel |
| **UK** | FCA commercial agent exclusion (S-111, A-grade, updated 17 Feb 2023) | The Payment Services Regulations 2017 do not apply to a payment made through a commercial agent authorised by formal agreement to negotiate or conclude sales for **either the payer or the payee, not both**. A business acting for both, for example by receiving funds into an account it controls first, "is likely to require our authorisation or registration" | Whether a software platform that only instructs payments is an agent at all; PERG guidance (not read) | [RB] |
| **Malaysia** | Bank Negara Malaysia e-money policy (S-112, A-grade, 31 Jan 2025; summary only) | The policy applies to e-money issuers **approved under s. 11 of the Financial Services Act 2013**. Limited-purpose e-money is excluded by a 2024 exemption order (P.U.A. 463/2024) | The scope of the exemption, capital and balance limits, approval process (all in the PDF, not read) | [RB] for the approval requirement; the rest [UV] |
| **India** | RBI Master Directions on Prepaid Payment Instruments, 27 Aug 2021 (S-113, B-grade law-firm summary) | **Closed-system** PPIs, usable **only to buy from the issuer**, are outside RBI regulation. Other PPIs fall in categories such as small PPIs and full-KYC PPIs | Whether a wallet that allows **cash-out to a bank account** is outside the closed-system category: by the summary's definition it appears not to be [HY]; current limits (the summary quotes older ones) | [RB] for the definition; application [HY] |
| **Vietnam** | Decree 40/2018 (S-048, excerpt) | Participant **deposits** are prohibited | How "deposit" is defined | [RB] |
| **Bangladesh** | Bangladesh Bank PSP licensing news (S-118, excerpt) | The central bank licenses payment service providers for e-wallets and warns against unauthorized online payment platforms | Not a target market for MLM operators (OQ-02) | [IP] |
| **EU, Singapore, UAE, Indonesia, Philippines, Thailand** | Not researched for payments | | | [UV] |

**Reading [HY].** In the four jurisdictions read (US, UK, Malaysia, India), the sources centre on **holding or controlling funds for others**, and each offers a narrow exclusion that depends on facts (a purchase, an agent for one side only, a closed or limited-purpose scheme). **None of the sources addresses a software platform that only calculates commissions and instructs payment from the tenant's funds.** The inference that such a design lies outside these regimes is mine and is **for counsel to confirm (Q-2)**. A design in which the platform holds balances needs a licence, a licensed partner holding the funds, or an exclusion that counsel confirms.

### 5.3 What competitors do

| Observation | Evidence | Label |
|---|---|---|
| Exigo lists FlexPay, Global Access, Nexio, PayQuicker and Worldpay as payment partners; PayQuicker is described as a "global payouts orchestration solution" reaching "over 210 countries and territories" by debit card, mobile wallet and bank transfer. **The page does not say who holds funds** and makes no licensing claim | S-091, S-114 | [IP] |
| A direct-selling brand launched a branded "YL Wallet" through PayQuicker with weekly payouts (6 Aug 2026). Who holds balances is not stated | S-115 | [IP] |
| DirectScale authorizes commission payments to a customer-integrated "payment provider"; none named; who holds funds not stated | S-117 | [IP] |
| InfoTrax shows Nexio, Avalara and Hyperwallet logos | S-093 | [IP, weak] |
| Low-end vendors advertise in-software wallets and e-pins (Infinite, Epixel) and **cryptocurrency** wallets or payments (Epixel: 15+ coins; Infinite: a crypto payment option). No licensing statement was retained | S-095, S-096 | [IP] |
| Processors treat MLM as high risk: "many banks and issuers still consider multi-level marketing to be high risk" because of chargebacks, and "the average MLM business holds a merchant account for less than one year" (the latter a vendor claim, 2019) | S-116 | [IP, weak] |

**Reading [HY].** The top-end pattern is **provider-hosted payouts and wallets**, in which a third party, not the software vendor, is the licensed party. The low-end pattern is **platform-operated wallets and crypto**, where the licensing basis is not visible. This supports design stance A-02 but does **not** prove that competitors comply or that provider-hosted wallets are licensed everywhere.

### 5.4 Architecture options

| Option | Description | Funds touch the platform? | Screening-grade exposure | Evidence of use | Recommendation [SR] |
|---|---|---|---|---|---|
| **1. Calculate and instruct** | Platform computes commissions, produces approved payout batches, sends instructions to the **tenant's** bank or payout provider, and reconciles results | **No** | Lowest | DirectScale (customer-integrated provider, S-117); Exigo's partner list | **MVP default** |
| **2. Provider-hosted wallet or payout account** | A licensed provider holds balances and runs payouts; the platform integrates through its API | **No** (provider holds) | Low to medium; depends on the provider's licence and on contract structure (tenant vs platform as customer) | Exigo with PayQuicker; a branded wallet via PayQuicker (S-114, S-115) | **Next step after MVP**, with counsel on who contracts with the provider (Q-9) |
| **3. Platform-operated stored value** | Platform holds balances, e-pins or stored value | **Yes** | **Highest**: money transmission, e-money or prepaid-instrument rules in the markets read | Low-end vendors (S-095, S-096) | **Not in scope** unless a licensed partner or licence is obtained |
| **4. Cryptocurrency balances or payouts** | Platform or tenant pays in crypto | Varies | Not researched; likely high | Epixel, Infinite | **Excluded** from scope pending a separate legal study |

### 5.5 Module H: draft specification inputs (from the legal screen, not from competitor documentation)

These are **requirements implied by Option 1 and Option 2**, each with its driver. They are inputs to the MVP decision (G4), not a design.

| ID | Requirement | Driver | Label |
|---|---|---|---|
| MH-REQ-01 | The commission **ledger records obligations of the tenant company to its sellers**, not funds held by the platform; no field or workflow may represent platform-held seller balances in the MVP | A-02; §5.2 | [SR] |
| MH-REQ-02 | Payout batches have a lifecycle (calculated, reviewed, approved, instructed, settled, failed) with **separate preparer and approver roles** and an audit trail | Fraud and audit control; CMP-04 | [SR] |
| MH-REQ-03 | A **provider adapter** interface: one integration per payout provider or bank file format; idempotent instructions; provider reference stored | Option 1 and 2; S-114, S-117 | [SR] |
| MH-REQ-04 | **Reconciliation** of instructed payouts to provider or bank statements, with exceptions queue | Operational need; V-02 will test its importance | [HY] |
| MH-REQ-05 | **Reversals and clawbacks** linked to returns, chargebacks and refunds, and visible on seller statements | Chargeback risk (S-116); Module E | [SR] |
| MH-REQ-06 | **Per-market payout rules**: thresholds, currencies, rails, and tax or identity data passed to the provider when the provider requires it | R-38; provider documentation (not read) | [HY] |
| MH-REQ-07 | **Block configurations that take deposits** or non-refundable joining fees from participants where prohibited, and flag others for review | Vietnam (S-048); CMP-14 | [HY] |
| MH-REQ-08 | **No cryptocurrency or e-pin payout** in the MVP | §5.4 option 4 | [SR] |
| MH-REQ-09 | Seller **statements** itemize each payout line by source, to support CMP-03 and earnings-disclosure reports (CMP-05) | FTC guidance (S-020); India records (S-085) | [SR] |
| MH-REQ-10 | **Provider and contract record per tenant**, showing which party holds funds and under which licence, shown to the tenant | §5.3: buyers cannot see this today; Q-2 | [HY] |

### 5.6 Payment localization (R-38): first pass

| Market | Evidence retained | Unknown (source pending) |
|---|---|---|
| Malaysia | BNM approval needed for e-money issuers (S-112). Payout by orchestration providers is described as global (S-114) | DuitNow and local bank rails (PayNet pages could not be fetched); language and tax practice; delivery |
| India | RBI PPI categories (S-113). Provider reach as above | UPI and bank rails (NPCI pages could not be fetched); languages; GST treatment; delivery |
| US | FinCEN and processor risk (S-110, S-116). ACH and card payout are offered by vendors (S-096) | State rules; tax reporting for payees (not researched) |
| UK, EU | FCA agent exclusion (S-111). SEPA and Faster Payments not sourced | Rails, PSD2 and local practice |
| Vietnam, Thailand, Indonesia, Philippines | Deposits prohibited in Vietnam (S-048) | Rails and wallet landscape |

**Not done:** per-market language, currency, mobile-wallet and logistics coverage was not sourced. R-38 remains open for Wave 6 (integration) and as input to H-6 in 05.

### 5.7 Result for gate G2 (payout criterion)

**Met at screening grade.** A feasible payout architecture exists: Option 1 for the MVP and Option 2 as a later step, with no platform-held balances. **Conditions:** (a) counsel confirm Q-2 and Q-9 for the first market; (b) the provider's licence and contract structure are checked before launch; (c) the BNM and RBI primary texts are read before any wallet-like feature is specified for Malaysia or India. No finding makes the category non-viable.

---

## 6. Open legal questions for counsel

| ID | Question | Why it matters | Jurisdiction |
|---|---|---|---|
| Q-1 | Could the software vendor be exposed (aiding, facilitating, or as a "promoter") if a customer's plan is held to be a pyramid scheme? | Determines the ethical-use policy, contracts and insurance | US, UK, EU, Malaysia, India |
| Q-2 | Does a platform that calculates commissions and instructs payouts (Option 1) need a licence? Does a provider-hosted wallet it integrates (Option 2)? Does holding balances (Option 3)? | Decides wallet scope (§5.4) | Each target market; start with the first market (OQ-01) |
| Q-3 | Is the Bangladesh position (no licensed MLM firms since 2015) current, and are non-MLM direct-selling or affiliate models lawful and in scope? | OQ-02 | Bangladesh |
| Q-4 | Which UK trading-scheme rules survive the DMCCA 2024? | UK requirements | UK |
| Q-5 | How do India's Rule 5(5) data-localization requirement and the data-protection law interact? | Architecture decision (CMP-08) | India |
| Q-6 | What do the pending Malaysian amendments change? | Product scope for a priority market | Malaysia |
| Q-7 | Which Singapore schemes are exempt? | Whether Singapore is ever viable | Singapore |
| Q-8 | What is the UAE position on direct selling licences? | Whether UAE is a market or just a corporate base | UAE |
| Q-9 | In a provider-hosted payout design, should the **tenant** or the **platform** contract with the payout provider, and does either arrangement bring the platform into an agency-for-both-sides or money-transmission position (UK commercial agent exclusion, US exemption fit, Malaysian and Indian equivalents)? | Determines Option 2 structure and contracts (§5.4) | UK, US, Malaysia, India |

---

## 7. Gate G1 (legal part): conditional pass

| Criterion (Roadmap §5) | Result |
|---|---|
| At least two target markets with a lawful direct-selling framework identified | **Met** at screening grade: US, UK, EU baseline, India, Malaysia (also Vietnam, Thailand, Indonesia, Philippines) |
| No regulatory finding that makes the whole category non-viable | **Met**: no category-wide blocker found. Bangladesh is a **market-level** blocker for MLM operators; Singapore is restricted |
| Evidence quality | **Screening-grade only**; 4 of 12 jurisdictions rest mostly on C-grade or secondary sources (UAE, Indonesia, Philippines, parts of Thailand) |

**Status after Wave 2 (toward G2):**

| Required before G2 (v0.1) | Status |
|---|---|
| Full read of the FTC guidance (S-020) | **Done**; summarized in §3.1 |
| Full read of Malaysia's Act 500 | **Not done**: the AGC PDF is robots-disallowed; the KPDN application page was read in full instead (S-043) |
| Full read of India's Direct Selling Rules | **Not done**: only secondary summaries (S-083 to S-085) |
| Counsel review of Q-1 and Q-2 | **Not done**: no counsel engaged; needs a founder decision (see 66 OQ-09) |
| Payout feasibility (R-39) | **First pass done** (§5); met at screening grade |
