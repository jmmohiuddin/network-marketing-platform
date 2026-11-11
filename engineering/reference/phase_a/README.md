# Phase A desk work and the compliance-reports demand test

Work that needed no interviews, done on 2026-11-11, plus the materials for the first demand test. Follows the gap audit's revised sequence (`gap_audit/31_MVP_AND_ROADMAP_REVISION_RECOMMENDATIONS.md` §1). **Nothing has been sent to any provider, adviser or company.** Every outbound message here is a draft for the founder to send from their own address.

## Status by item

| Gap-audit item | File | Status | What the founder does next |
|---|---|---|---|
| A(2) Payment and payout provider eligibility (GAP-004) | `P2_PAYMENT_PROVIDER_SCREEN.md` | Desk screen of published policies done (11 providers or groups screened; 5 more listed, not read). **Not confirmed in writing** | Pick the launch market (FD-02); send Q-set A to 3–5 providers there and Q-set B to the billing provider |
| A(3) Tax adviser on withholding (GAP-031) | `P3_ADVISER_BRIEFS.md`, Brief B | Questions drafted for MY, IN, US | Send Brief B to a tax adviser in the launch market |
| A(4) Counsel on guardrails, vendor exposure, payouts, residency (GAP-087) | `P3_ADVISER_BRIEFS.md`, Brief A | Questions L-1..L-9 drafted | Send Brief A to direct-selling counsel; include the data terms in P4 §6 for review |
| A(5) Plan corpus and primitive set (GAP-020) | `P1_PLAN_CORPUS.md`, `plan_corpus/` | 21 public plans coded; coverage measured on 16 hold-out plans | Set the coverage target for G3′(b); have someone spot-check 5 codings; obtain plans from the launch market |
| B Demand test: compliance reports on a design partner's export (option P4) | `P4_DESIGN_PARTNER_KIT.md`, `prototype/` | Prototype, tests, export validator and demo page built on **synthetic** data; kit written | Confirm the pass/fail rule (proposed FD-10) before the first call; start outreach |
| A(1) Founder decisions FD-01..FD-06 | `gap_audit/35_OPEN_DECISIONS_FOR_FOUNDERS.md` | Open | Decide, especially FD-02 (launch market), which the provider and tax work depends on |
| A(6) Competitor documentation reads (GAP-080) | — | **Not done in this pass** | — |

The full commission engine (MVP-B) is **not started**: it waits for the demand test.

## Main results

- **Plans have a long tail.** 0 of 16 hold-out plans fit the original ten building blocks; 5 of 16 fit after the audit's 19 extra mechanisms; 11 need at least one of 12 new mechanism classes. The engine needs a versioned extension point, not just a fixed list. (P1)
- **Mainstream payment acceptance is closed or conditional for MLM merchants** in all three candidate markets (Stripe prohibits; PayPal pre-approval; Zoho Payments and Cashfree name "MLM collection fees"; iPay88 lists MLM as banned/high-risk). Specialist payout providers do not document Malaysia or India coverage. Tenants must bring their own provider accounts. (P2)
- **The five compliance reports compute cleanly from three CSV files** (participants, orders, payout lines). A hand-checked fixture passes; a validator rejects files containing personal or bank data columns. (prototype)
- **Public evidence exists for the earnings-disclosure report:** Herbalife's Malaysian statement for 2025 says about 20% of distributors with a full year received commissions or bonuses in a typical month (G-S52). (P1 §7)

## Files

| Path | What it is |
|---|---|
| `00_PHASE_A_SOURCES.md` | New sources G-S36..G-S58 |
| `P1_PLAN_CORPUS.md` | Corpus method, coverage, new mechanisms, frequency table for MVP priority, limits |
| `plan_corpus/` | `plans.csv` (coding), `coded_plans.md` (evidence lines), `analyze_corpus.py`, `analysis_output.txt`, `coding_prompt.txt` |
| `P2_PAYMENT_PROVIDER_SCREEN.md` | Provider policy screen, product implications, inquiry drafts |
| `P3_ADVISER_BRIEFS.md` | Brief A (counsel), Brief B (tax: MY, IN, US) |
| `P4_DESIGN_PARTNER_KIT.md` | Pass/fail rule, target profile, outreach drafts, interview script, data request, data terms, runbook, readout and log templates |
| `prototype/synth.py` | Generates the synthetic export (seed 20261111). Not any company's data |
| `prototype/analytics.py` | Computes reports R1–R5 |
| `prototype/test_analytics.py` | Hand-checked fixture plus invariants on the synthetic export |
| `prototype/validate_export.py` | Checks a real export before use |
| `prototype/compliance_reports_demo.html` | The demo page (built from `demo_template.html` + `report.json`) |

## How to run

```
cd prototype
python3 -I synth.py data_synthetic          # regenerate synthetic export
python3 -I validate_export.py data_synthetic
python3 -I analytics.py data_synthetic report.json
python3 -I test_analytics.py
cd ../plan_corpus && python3 -I analyze_corpus.py
```

Python 3 standard library only.

## Limits

- No interviews, provider answers or adviser opinions exist yet; nothing here is evidence of demand or of eligibility.
- Corpus coding was machine-assisted and needs a human spot-check; no Malaysian plan was found publicly.
- The demo's review thresholds are examples, not legal tests. The one-third personal-use line comes from the structure of one FTC order binding one company.
- Synthetic data is invented and its patterns (e.g., late-month threshold orders, refunds) were put there on purpose to exercise the reports.
