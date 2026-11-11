# 01 — EXISTING DOCUMENTATION INVENTORY
## What the previous research repository contains, read document by document

| Field | Value |
|---|---|
| Document ID | GAP-01 |
| Version | 0.1 |
| Date | 2026-11-11 |
| Scope | Every file in the original repository, read in full before any assessment |
| Preservation | The original repository is copied unchanged to `_snapshot_original/` (read-only), with SHA-256 checksums in `_snapshot_SHA256SUMS.txt` (25 files). No original document was edited by this audit |
| Sources | `S-xxx` = original register; `G-Sxx` = new sources in `00_GAP_SOURCE_REGISTER.md` |

> **Independence caveat.** The original research and this audit were produced by the same AI system in the same working session. I have tried to read the work as an outside reviewer would and to verify claims against new sources, but this is **not** an independent audit in the sense a board would expect. A human reviewer or a separate firm should check at least the critical findings in 32 (see 35, FD-01).

## 1. The single most important inventory fact

**The repository is a research repository at the end of Wave 3 of a 10-wave plan. It contains no product or system documentation.** There is no PRD, functional specification, feature catalog, MVP scope, roadmap, information architecture, user flow, wireframe, design system, technology evaluation, system architecture, database design, ER diagram, API specification, security architecture, integration architecture, test strategy, pricing, financial model or business case.

The audit brief asks whether "the PRD and system design agree", whether "the database supports all functional requirements" and whether "API requirements align with the architecture". **Those checks cannot be run, because those documents do not exist.** Where this audit's deliverables (22 to 31) refer to product documentation, they specify **what the first versions of those documents must contain**, rather than changes to existing ones.

## 2. File inventory

Words counted with `wc -w`. "Read" = how this audit read it.

| # | File | Kind | Words | Version / state | What it is | Read |
|---|---|---|---|---|---|---|
| 1 | 00_RESEARCH_MASTER_PLAN.md | Plan | 6,009 | v1.0, Wave 0 | Decision D0–D9, objectives RO-1..10, research topics R-01..R-40 and R-MOD-A..M, evidence standards ([VF] [RB] [IP] [HY] [SR] [UV]), challenges C1–C8, validation needs V-01..V-08, 67-document target | Full |
| 2 | 00_RESEARCH_EXECUTION_ROADMAP.md | Plan + status | 4,284 | Header says v1.2 (Wave 2) but body includes Wave 3 and §13.5 | Waves 0–9, gates G1–G8, dependency graph, results of Waves 1–3, founder decision Option A | Full |
| 3 | 00_RESEARCH_SOURCE_REGISTER.md | Register | 7,577 | v0.4 | 129 sources (S-001..S-148): Grade A 27, B 44, C 57, one ungraded; 57 read in full, 72 as excerpts; 41 undated | Full (profiled by script) |
| 4 | 01_INDUSTRY_RESEARCH.md | Research | 2,190 | v0.1, Wave 1 (not updated since) | Definitions, WFDSA 2024 statistics, plan families ("source pending"), segments S1–S5 | Full |
| 5 | 02_MARKET_SIZE_AND_OPPORTUNITY.md | Research | 3,978 | v0.2 | Channel size, 9-market table, WFDSA vs national gap (~1.3x), company counts (US 660+, MY ~400, IN 461+), price anchors, order-of-magnitude bound, qualitative market screen | Full |
| 6 | 02_market_calcs.py | Script | — | — | Reproduces derived figures in 01 and 02 | Run; output matches |
| 7 | 03_COMPETITOR_ANALYSIS.md | Research | 3,723 | v0.2 | Verification of 14 brief names, 18+ vendors at V1+, 7 at V2p (one marketing page each), review themes, payout architecture | Full |
| 8 | 04_COMPETITIVE_FEATURE_MATRIX.md | Research | 1,750 | v0.1 | 18 capability rows × 8 vendors from marketing pages; 0 of 8 state CMP-01..12 | Full |
| 9 | 05_MARKET_GAP_ANALYSIS.md | Research | 2,571 | v0.2 draft | Gap hypotheses H-1..H-9; three unsupported assumptions; segment view | Full |
| 10 | 06_PROBLEM_RESEARCH.md | Research | 5,346 | v0.1 | 18 problem records P-01..P-18 with the brief's 12 fields; evidence classes R F J I K P A B V | Full |
| 11 | 07_PROBLEM_SEVERITY_MATRIX.md | Research | 1,849 | v0.1 (script-generated) | Strict severity rubric; 2 High; opportunity status; G3 test | Full |
| 12 | 08_STAKEHOLDER_ANALYSIS.md | Research | 1,934 | v0.1 | ST-01..ST-24; buying roles all [HY] | Full |
| 13 | 09_USER_PERSONAS.md | Research | 2,472 | v0.1 | 7 role profiles: 0 research-based, 1 document-based, 6 hypotheses | Full |
| 14 | 10_USER_JOURNEY_MAPS.md | Research | 3,286 | v0.1 | 17 journeys J-01..J-17 with evidence status | Full |
| 15 | 11_USER_WORKFLOW_ANALYSIS.md | Research | 1,455 | v0.1 | Order→payout chain, failure propagation, handoffs, timing | Full |
| 16 | 12_BUSINESS_MODEL_ANALYSIS.md | Research | 1,581 | v0.1 | The tenant's business model; product vs recruitment payment classification | Full |
| 17 | 13_COMPENSATION_PLAN_RESEARCH.md | Research | 3,349 | v0.1 | 14 plan types, 10 building blocks, EX-1..EX-9, engine requirements, legal-risk indicators | Full |
| 18 | 13_comp_examples.py | Script | — | — | Worked examples | Run; output matches the document |
| 19 | 15_BUSINESS_RULES_CATALOG.md | Research | 2,503 | v0.1 draft | 57 candidate rules in 10 domains; open decisions D-R1..D-R6 | Full |
| 20 | 51_LEGAL_AND_REGULATORY_RESEARCH.md | Research | 5,967 | v0.3 screening-grade | 12 jurisdictions; CMP-01..CMP-19; payout options 1–4; MH-REQ-01..10; counsel questions Q-1..Q-10 | Full |
| 21 | 66_OPEN_QUESTIONS_AND_ASSUMPTIONS.md | Register | 6,340 | v0.4 | OQ-01..OQ-10, A-01..A-14, U-01..U-29, gate decisions; Appendix A (interview guides, surveys, decision rules) | Full |
| 22 | 66_APPENDIX_B_FIELDWORK_KIT.md | Kit | 2,710 | v0.1 | Recruitment routes, screeners, invitation and consent texts, protocol, coding | Full |
| 23 | r37_fieldwork/interview_log_template.csv | Template | — | — | Header-only log | Checked |
| 24 | r37_fieldwork/pipeline_tracker_template.csv | Template | — | — | Header-only tracker | Checked |
| 25 | r37_fieldwork/r37_decision_check.py | Script | — | — | Applies decision rules; tested on a synthetic fixture | Run on the empty template |

**Total:** 21 Markdown documents (~70,900 words), 3 scripts, 2 CSV templates.

## 3. Coverage of the planned 67 documents

| Planned group (Master Plan §16) | Planned files | Exist |
|---|---|---|
| Plans, register | 00 ×3 | 3 |
| Industry, market, competitors, gaps (01–05) | 5 | 5 (05 is a draft) |
| Problems, stakeholders, personas, journeys, workflows (06–11) | 6 | 6 |
| Business model, compensation, process analysis, business rules (12–15) | 4 | 3 (**14 missing**; 15 is a draft) |
| Financial feasibility, business case (16–17) | 2 | **0** |
| Vision, positioning, opportunity, catalog, module specs, MVP, roadmap, analytics (18–25) | 8 | **0** |
| UX research, IA, sitemap, flows, wireframes, design system (26–33) | 8 | **0** |
| Technology, architecture, database, ER, API, security, integration, infrastructure (34–44) | 11 | **0** |
| Growth, pricing, GTM (45–50) | 6 | **0** |
| Legal research, compliance requirements, risk register (51–54) | 4 | 1 (51 only) |
| PRD, FRS, NFR, stories, acceptance, edge cases, system design, QA, executive (55–67) | 13 | 1 (66 only) |
| **Total** | **~67** | **19 + 2 scripts + kit** |

## 4. State of decisions, as the repository records them

| Item | Recorded state | Where |
|---|---|---|
| D0 build or not | Not decidable | 66 §7.4 |
| D1 markets | Provisional: Malaysia, India (deep); US (reference); Singapore, UAE, Bangladesh MLM excluded | 02 §6, 66 §5 |
| D2 segment | Open; best candidate S2 mid-market (hypothesis) | 05 §4 |
| D3 problem real and under-served | Partly; compliance cluster moderate; under-service weak; willingness to pay unknown | 66 §7.4 |
| D5 MVP | Not started; narrow-wedge default | 66 OQ-07 |
| D6 funds | Provisional: do not hold funds; calculate and instruct (Option 1) | 51 §5.4, A-02 |
| D7 architecture | Not started | 66 §5 |
| D8 viability | Not started; needs founder threshold OQ-04 | 66 |
| Gates | G1 conditional pass (never converted); G2 not passed; G3 not passed | Roadmap §10 |
| Primary research | Option A chosen; kit ready; **no interview conducted, no access provided** | 66 OQ-10, Appendix B |

## 5. What the repository does well (kept in view for the rest of the audit)

- **Evidence discipline is unusually strict.** Every claim carries a label; vendor content is excluded from evidence counts; "not stated on a page" is never read as "absent"; arithmetic is reproducible by script.
- **It challenges its own brief.** It rejects "commission errors are the central pain", "all-in-one is a differentiator" and "AI is a differentiator" as unsupported, and refuses to pass its own gates.
- **It records what it does not know** (29 unknowns, 10 founder questions) instead of filling gaps.

These strengths are also the source of its main weakness: **a strict evidence filter plus desk research produced mostly negative or "unknown" results, and several sources that could have reduced uncertainty without interviews were not used** (see 02 §4 and 04).
