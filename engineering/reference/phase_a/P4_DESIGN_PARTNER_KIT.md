# P4 — DESIGN-PARTNER KIT FOR THE COMPLIANCE-REPORTS DEMAND TEST
## How to find one company, run the five reports on its real data, and decide whether to build further

| Field | Value |
|---|---|
| Document ID | PA-P4 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Task | Gap audit 31 §1, Phase B: "a clickable prototype of compliance reports on a design partner's export (option P4)"; feeds gates G3′(a) and G4′ |
| Status | **Prepared, not used.** No company has been contacted and no data has been received. Every message below is a draft for the founder to send from their own address |
| Demo | "Compliance Evidence Reports" page (published privately; share it from its Share menu before sending the link). Built on **synthetic data only** (`prototype/data_synthetic`, seed 20261111) |
| Code | `prototype/analytics.py` (five reports), `prototype/validate_export.py` (checks an export before use), `prototype/test_analytics.py` (hand-checked fixture) |
| Evidence labels | [VF] verified · [RB] reasoned from sources · [HY] hypothesis/judgement · [UV] unverified |

---

## 0. What the test has to answer

**Hypothesis [HY]:** compliance and finance leads at licensed direct-selling companies will **give real data and commit money** to get five evidence reports (customer-sales share, personal-use share of rewarded volume, payout sources, activity without customers, earnings disclosure over everyone) without changing their back office.

**Decision it feeds:** whether to build MVP-A (compliance analytics overlay on existing back offices) and, only if buyers pay, whether to go further toward the full commission engine (MVP-B). A fail stops further build spend on this positioning.

**Why reports first:** they need read-only exports, no payment flows and no plan engine, so a pilot costs days, not months [RB: gap audit 31/32].

---

## 1. Pass/fail rule — fix it before the first call

Proposed as founder decision **FD-10 (provisional until the founder confirms it; numbers are a judgement [HY], not a benchmark)**.

| Term | Definition |
|---|---|
| Qualified conversation | A company licensed or registered for direct selling in the launch market, talking through someone who owns compliance, finance or operations reporting |
| Commitment A — data | The company sends a real one-year export (pseudonymised, under NDA) within 30 days of the call |
| Commitment B — money | The company signs a paid-pilot letter **or** names a budget figure and the person who approves it |
| Not a commitment | "Interesting", "send more information", "we'd use it", compliments, a second meeting with no data |

| Outcome | Rule |
|---|---|
| **PASS** | ≥ 3 companies give Commitment B (the Phase B rule in 31 §1 of the gap audit: operators with budget authority, named budget) **and** ≥ 2 of those 3 also gave Commitment A. The second condition is added here because saying costs less than sending data |
| **FAIL** | After 10 qualified conversations, ≤ 1 company gives Commitment A, **or** nobody gives Commitment B after seeing results on their own data |
| **Unclear** | Anything in between: run up to 10 more qualified conversations **once**, then apply the same rule. Do not move the bar after seeing results |

Record every conversation in the log (§9) on the day, with the person's exact words for any commitment.

---

## 2. Who to approach

| Criterion | Reason |
|---|---|
| Licensed/registered direct-selling company in the launch market (FD-02) | The reports matter where a regulator or counsel asks for them |
| Has an existing back office that can export orders and commission detail | MVP-A reads exports; it does not replace systems |
| A named compliance, finance or COO-level contact | Commitment B needs someone who controls budget |
| Not currently in enforcement proceedings | Avoid being positioned as "cover"; ask counsel (Brief A, L-1, L-8) before talking to any such company |

**Where to find candidates [UV — not checked in this pass]:** the regulator's published list of direct-selling licence holders in Malaysia; direct-selling entities' published declarations in India; industry association member directories (e.g., national Direct Selling Associations). Verify each list's current location and terms of use before building a target list. Do not scrape personal contact details; use company channels or introductions.

**Do not approach:** individual distributors (they are not buyers of this product), or anyone with an offer framed as "proof your plan is legal".

---

## 3. Outreach drafts (founder sends; not sent)

Send from your own business address. Replace bracketed text. Attach nothing; link the demo only after sharing it.

> **Subject:** How do you produce your retail-sales and earnings figures today?
>
> Hello [Name],
> I'm [NAME], building software for direct-selling companies in [market]. Before we build further, I'm talking to compliance and finance leads about one task: producing evidence such as the share of sales to customers outside the network, what multi-level pay was earned on, and an earnings statement that includes people who earned nothing.
> Could I have 30 minutes to learn how [Company] does this today? I'm not selling anything on this call. If it's useful, I can show a prototype that runs on invented data.
> [NAME] · [ROLE] · [COMPANY]

**Short version (LinkedIn or intro request):**
> I'm researching how direct-selling companies in [market] produce retail-sales and earnings-disclosure evidence. 30 minutes to hear how you do it today? No pitch; there's a prototype on invented data if you want to see it.

---

## 4. Conversation script (30–40 minutes)

**Rules for the interviewer:** ask about what they did last time, not what they would do. Don't describe the product before Part 2. Don't mention price before they do in Part 3. Never say the reports show a plan is compliant.

### Part 1 — how it works today (15 min)
1. When did someone last ask you for figures like retail-customer share or an earnings disclosure? Who asked, and what did you send?
2. Walk me through how that was produced. Who did it, from which systems, how long did it take?
3. What was hard about it? What did you have to estimate or leave out?
4. Did any number surprise you or cause a change to the plan, policies or training? What happened next?
5. What do you spend today on this kind of work (staff time, consultants, auditors, back-office reports)?
6. Who decides on spending for compliance tooling, and how did the last such purchase happen?

### Part 2 — the demo (10 min)
Open the demo page. Say first: *"Everything here is invented data from a made-up company."*
7. Which of these five would you use first, and for whom?
8. Which definition is wrong for your plan? (e.g., who counts as a customer, what counts as activity)
9. What is missing that your counsel or regulator has asked for?

### Part 3 — the ask (5–10 min)
10. *"Would you send one year of your back-office export, pseudonymised, under an NDA, so we run these five reports on your own data and walk your team through them within two weeks?"* → Commitment A (record yes/no/condition and date).
11. If yes or maybe: *"If the results are useful, what would a year of this be worth in your budget, and who would approve it?"* → Commitment B (record the figure or the refusal, in their words).
12. Who else should I talk to, here or at another company?

---

## 5. Data request (send after Commitment A and a signed NDA)

**Scope:** one year of history, all markets the company wants reviewed. Three files, CSV, UTF-8, amounts as **whole cents** (integers).

| File | Columns | Notes |
|---|---|---|
| participants.csv | participant_id, type, enrolled_month (YYYY-MM), sponsor_id, market, status | `type` uses the company's own labels (e.g., distributor, customer, preferred customer); for a customer, `sponsor_id` = the distributor who services them |
| orders.csv | order_id, month, day, buyer_id, amount_cents, volume_cents, purpose, is_starter_kit (0/1), refunded_cents, refund_month | `purpose`: customer, personal, resale, unknown or enrolment. If the company does not record purpose, send `unknown` — the reports then say so |
| payout_lines.csv | line_id, month, payee_id, bonus_type, source_kind, source_order_id, amount_cents | One line per commission component. `source_order_id` is needed for order-based pay (retail, downline volume, enrolment) and for clawbacks |

**Mapping help (generic; confirm with the company's own field meanings):**

| Typical back-office notion | Our column / value |
|---|---|
| Retail / customer order, customer autoship | buyer is a customer type; `purpose` = customer |
| Distributor wholesale order flagged for own use | `purpose` = personal |
| Distributor order flagged for resale | `purpose` = resale (shown separately in R1, because a tag is a claim) |
| Enrolment pack, starter kit, business kit | `is_starter_kit` = 1, `purpose` = enrolment |
| Retail profit/commission, customer bonus | `source_kind` = retail_sale |
| Unilevel, level, team, binary, generation commission on volume | `source_kind` = downline_volume |
| Fast start / enrolment bonus paid on kit orders | `source_kind` = enrolment_order |
| Leadership pool, global pool | `source_kind` = pool |
| Matching / check match | `source_kind` = match |
| Chargeback, commission reversal | `source_kind` = clawback (negative amount) |

**Pseudonymise before sending:** replace every person's ID with a random code (keep the mapping inside the company), and drop names, emails, phone numbers, addresses, national IDs, tax numbers and bank details. `validate_export.py` refuses files with such column names and checks IDs, months, whole-cent amounts and links between files.

---

## 6. Data-handling terms (draft for counsel to review before first use)

Counsel should confirm these against Brief A questions L-6 and L-8 (processor duties, aggregate use) and the market's privacy law.

1. **Purpose:** the data is used only to compute the five reports for this company and to discuss them with this company.
2. **Role:** we act on the company's instructions (processor). The company remains responsible for having a lawful basis to share pseudonymised records.
3. **Storage and access:** stored encrypted, in one named location, accessible only to named people; no copies on personal devices.
4. **Retention:** deleted within 30 days after the readout unless the company signs a paid pilot; deletion confirmed in writing.
5. **No reuse:** no aggregation with other companies' data, no benchmarking, no model training, no publication, unless the company agrees in writing to a specific use.
6. **Results:** the reports belong to the company. We never describe them to others as showing the company is compliant or not.

---

## 7. Pilot runbook

| Day | Step | Output |
|---|---|---|
| 0 | NDA and data terms signed; company confirms which `type` labels are non-participant customers and the plan's activity threshold | Config for `analytics.py` (end-customer types, active volume, thresholds, late-order day) |
| 1 | Company sends export | Files in the agreed location |
| 1 | `python3 -I validate_export.py <dir>` | "usable" or a list of fixes to send back |
| 2 | `python3 -I analytics.py <dir> report.json` | Five reports, monthly |
| 2–5 | Check results by hand on ten sample orders and five payees; compare total payouts with the company's own figure | Reconciliation note (difference and reason) |
| 5–10 | Readout with the company (§8) | Recorded answers to Commitment B |
| ≤ 30 after readout | Delete data unless a paid pilot is signed | Written deletion confirmation |

---

## 8. Readout template (one page per report)

| Section | Content |
|---|---|
| Figure | Value for the year and each month |
| Population | Exactly who is counted (e.g., "all 449 distributors with an agreement during 2025, including those who earned nothing") |
| Method | The definitions used, including the company's own labels |
| Data quality | Share of orders with unknown purpose, lines without a source order, reconciliation difference |
| Questions for your counsel | What the figure might prompt them to ask; **no verdict** |

Never write "compliant", "non-compliant", "safe" or "passes"; review thresholds on the demo are examples, and the company's counsel sets real ones.

---

## 9. Conversation log (one row per conversation)

| Column | Example of what to enter |
|---|---|
| date | 2026-12-03 |
| company | (name kept in the founder's private log only) |
| market | MY / IN / US |
| role of contact | Head of compliance |
| qualified (y/n) | y |
| last time evidence was requested (who, when) | "Regulator, March, plan amendment" |
| current method and effort | "Finance analyst, 2 weeks, spreadsheets" |
| current spend mentioned | their words, or "not said" |
| first report they'd use | R5 |
| definitions they corrected | "preferred customers count as participants for us" |
| Commitment A (export) | yes / no / conditional + date sent |
| Commitment B (money) | figure + approver, or refusal, in their words |
| referrals | names of other companies or people |

Score only Commitments A and B against §1.

---

## 10. Limits

- No company has been contacted; nothing in this kit is evidence of demand.
- The pass/fail numbers are a proposal; the founder must fix them before the first call.
- Regulator and association lists were not checked in this pass [UV].
- The data-handling terms are drafts, not legal advice; counsel must review them.
- The prototype's definitions (customer share, personal-use share, activity, late threshold orders) are a starting point. Each company's plan will need its own configuration, and some plans will not map cleanly onto three files (e.g., binary carry-forward, product credits); record such cases as new requirements rather than forcing them.
